import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { invoke } from "@tauri-apps/api/core";
import { useAppearance } from "./useAppearance";
import type { AppearanceSnapshot } from "./accents";

const events = vi.hoisted(() => ({
  changed: undefined as
    undefined | ((event: { payload: { scope: string } }) => void),
  stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, handler) => {
    events.changed = handler;
    return events.stop;
  }),
}));
enableAutoUnmount(afterEach);
const violet: AppearanceSnapshot = {
  accent: "violet",
  revision: null,
  writable: true,
};
const sky: AppearanceSnapshot = {
  accent: "sky",
  revision: "sky-1",
  writable: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(
  initialScope: string | null = "garden",
  creationAccent = ref<import("./accents").Accent>(),
) {
  const scope = ref<string | null>(initialScope);
  let controller!: ReturnType<typeof useAppearance>;
  const wrapper = mount(
    defineComponent({
      setup() {
        controller = useAppearance(scope, creationAccent);
        return () => null;
      },
    }),
  );
  return { scope, controller, wrapper };
}
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(violet);
  events.stop.mockReset();
  events.changed = undefined;
});

it("applies the current workspace accent to overlays and clears it outside a workspace", async () => {
  vi.mocked(invoke).mockResolvedValue(sky);
  const { controller, scope, wrapper } = harness();
  await flushPromises();
  expect(controller.snapshot.value).toEqual(sky);
  expect(document.documentElement.dataset.workspaceAccent).toBe("sky");
  expect(
    document.documentElement.style.getPropertyValue("--situate-accent-on"),
  ).toBe("var(--situate-ink)");
  scope.value = null;
  expect(
    document.documentElement.style.getPropertyValue("--situate-accent"),
  ).toBe("");
  expect(document.documentElement.dataset.workspaceAccent).toBeUndefined();
  await flushPromises();
  expect(controller.snapshot.value?.writable).toBe(false);
  wrapper.unmount();
  expect(events.stop).toHaveBeenCalledOnce();
});

it("keeps the creation accent while the new workspace appearance loads and restores it on reopen", async () => {
  const creationAccent = ref<import("./accents").Accent | undefined>(
    "tangerine",
  );
  const { scope, controller } = harness(null, creationAccent);
  await flushPromises();
  const loading = deferred<AppearanceSnapshot>();
  vi.mocked(invoke).mockReturnValue(loading.promise);
  scope.value = "new-garden";
  expect(document.documentElement.dataset.workspaceAccent).toBe("tangerine");
  expect(controller.loading.value).toBe(true);
  const saved: AppearanceSnapshot = {
    accent: "tangerine",
    revision: "created",
    writable: true,
  };
  loading.resolve(saved);
  await flushPromises();
  expect(controller.snapshot.value).toEqual(saved);
  creationAccent.value = undefined;
  scope.value = null;
  await flushPromises();
  vi.mocked(invoke).mockResolvedValue(saved);
  scope.value = "new-garden";
  await flushPromises();
  expect(document.documentElement.dataset.workspaceAccent).toBe("tangerine");
});
it("previews immediately and serializes rapid changes using the last saved revision", async () => {
  const { controller } = harness();
  await flushPromises();
  const first = deferred<AppearanceSnapshot>();
  const last = deferred<AppearanceSnapshot>();
  vi.mocked(invoke)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => last.promise);
  controller.update("sky");
  expect(controller.accent.value).toBe("sky");
  controller.update("peach");
  controller.update("lemon");
  expect(controller.accent.value).toBe("lemon");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "appearance_update"),
  ).toHaveLength(1);
  first.resolve(sky);
  await flushPromises();
  expect(controller.accent.value).toBe("lemon");
  expect(invoke).toHaveBeenLastCalledWith("appearance_update", {
    scope: "garden",
    accent: "lemon",
    expectedRevision: "sky-1",
  });
  let flushed = false;
  const flushing = controller.flush().then(() => {
    flushed = true;
  });
  await flushPromises();
  expect(flushed).toBe(false);
  last.resolve({ accent: "lemon", revision: "lemon-2", writable: true });
  await flushing;
  expect(controller.snapshot.value?.accent).toBe("lemon");
  expect(controller.saving.value).toBe(false);
});

it("persists a return to violet even when the earlier selection is still saving", async () => {
  const { controller } = harness();
  await flushPromises();
  const first = deferred<AppearanceSnapshot>();
  vi.mocked(invoke)
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValueOnce({ ...violet, revision: "reset-2" });
  controller.update("sky");
  controller.update("violet");
  first.resolve(sky);
  await controller.flush();
  expect(invoke).toHaveBeenLastCalledWith("appearance_update", {
    scope: "garden",
    accent: "violet",
    expectedRevision: "sky-1",
  });
  expect(controller.accent.value).toBe("violet");
});

it("rolls back a failed save and reloads instead of assuming whether the write reached disk", async () => {
  const { controller } = harness();
  await flushPromises();
  const failed = deferred<AppearanceSnapshot>();
  vi.mocked(invoke)
    .mockImplementationOnce(() => failed.promise)
    .mockResolvedValueOnce(violet);
  controller.update("sky");
  const flushed = expect(controller.flush()).rejects.toBe(
    "settings.appearance.saveFailed",
  );
  failed.reject("unavailable");
  await flushed;
  expect(controller.accent.value).toBe("violet");
  expect(controller.snapshot.value).toEqual(violet);
  expect(controller.error.value).toBe("settings.appearance.saveFailed");
  expect(invoke).toHaveBeenLastCalledWith("appearance_snapshot", {
    scope: "garden",
  });
  vi.mocked(invoke)
    .mockRejectedValueOnce("uncertain")
    .mockResolvedValueOnce(sky);
  controller.update("sky");
  await expect(controller.flush()).rejects.toBe(
    "settings.appearance.saveFailed",
  );
  expect(controller.accent.value).toBe("sky");
});

it("keeps unavailable or invalid settings disabled and never issues an overwrite", async () => {
  vi.mocked(invoke).mockResolvedValue({
    accent: "custom",
    writable: true,
    revision: null,
  });
  const { controller } = harness();
  await flushPromises();
  expect(controller.snapshot.value).toBeNull();
  expect(controller.error.value).toBe("settings.appearance.loadFailed");
  controller.update("sky");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(([name]) => name === "appearance_snapshot"),
  ).toBe(true);
  vi.mocked(invoke).mockResolvedValue({ ...sky, writable: false });
  await controller.reload();
  controller.update("lemon");
  expect(controller.accent.value).toBe("sky");
});

it("ignores old loads and saves after a workspace switch, including a switch back", async () => {
  const { controller, scope } = harness();
  await flushPromises();
  const saving = deferred<AppearanceSnapshot>();
  vi.mocked(invoke).mockImplementationOnce(() => saving.promise);
  controller.update("sky");
  controller.update("peach");
  const loading = deferred<AppearanceSnapshot>();
  vi.mocked(invoke).mockImplementationOnce(() => loading.promise);
  scope.value = "reading";
  scope.value = "garden";
  await flushPromises();
  saving.resolve(sky);
  loading.resolve({ accent: "lemon", writable: true, revision: "other" });
  await flushPromises();
  expect(controller.snapshot.value).toEqual(violet);
  expect(controller.accent.value).toBe("violet");
  expect(controller.saving.value).toBe(false);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "appearance_update"),
  ).toHaveLength(1);
});

it("filters external events and defers reloads until a save completes", async () => {
  const { controller } = harness();
  await flushPromises();
  vi.mocked(invoke).mockClear();
  events.changed?.({ payload: { scope: "other" } });
  expect(invoke).not.toHaveBeenCalled();
  const pending = deferred<AppearanceSnapshot>();
  vi.mocked(invoke)
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(sky);
  controller.update("sky");
  events.changed?.({ payload: { scope: "garden" } });
  expect(invoke).toHaveBeenCalledOnce();
  pending.resolve(sky);
  await controller.flush();
  expect(invoke).toHaveBeenLastCalledWith("appearance_snapshot", {
    scope: "garden",
  });
  vi.mocked(invoke).mockResolvedValue({
    ...violet,
    revision: "external-reset",
  });
  events.changed?.({ payload: { scope: "garden" } });
  await flushPromises();
  expect(controller.accent.value).toBe("violet");
});
