import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { invoke } from "@tauri-apps/api/core";
import { preferences, type LocalizationSnapshot } from "@situate/localization";
import { useLocalization } from "./useLocalization";

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
const english: LocalizationSnapshot = {
  language: "en",
  formats: { time: "12", date: "mdy", number: "dot-comma" },
  writable: true,
};
const german: LocalizationSnapshot = {
  language: "de",
  formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
  writable: true,
};
const wrappers: ReturnType<typeof mount>[] = [];
function harness() {
  const scope = ref<string | null>("garden");
  let controller!: ReturnType<typeof useLocalization>;
  const wrapper = mount(
    defineComponent({
      setup() {
        controller = useLocalization(scope);
        return () => null;
      },
    }),
  );
  wrappers.push(wrapper);
  return { scope, controller, wrapper };
}
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  events.stop.mockReset();
  events.changed = undefined;
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

it("loads workspace preferences and applies received changes without changing other scopes", async () => {
  vi.mocked(invoke).mockResolvedValue(english);
  const { controller } = harness();
  await flushPromises();
  expect(controller.snapshot.value).toEqual(english);
  vi.mocked(invoke).mockResolvedValue(german);
  events.changed?.({ payload: { scope: "other" } });
  await flushPromises();
  expect(preferences.value.language).toBe("en");
  events.changed?.({ payload: { scope: "garden" } });
  await flushPromises();
  expect(preferences.value.language).toBe("de");
});

it("persists all independent fields without changing the stored selection on failure", async () => {
  vi.mocked(invoke).mockResolvedValue(english);
  const { controller } = harness();
  await flushPromises();
  vi.mocked(invoke).mockRejectedValueOnce("native.storage.unavailable");
  expect(
    await controller.update({ language: "de", formats: english.formats }),
  ).toBe(false);
  expect(controller.snapshot.value).toEqual(english);
  expect(controller.error.value).toBe("localization.saveFailed");
  const updated = { ...english, language: "de" as const };
  vi.mocked(invoke).mockResolvedValueOnce(updated);
  expect(await controller.update(updated)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("localization_update", {
    scope: "garden",
    preferences: updated,
    expected: { language: "en", formats: english.formats },
  });
  expect(preferences.value.formats).toEqual(english.formats);
});

it("does not apply a completed save to a subsequently activated workspace", async () => {
  vi.mocked(invoke).mockResolvedValue(english);
  const { controller, scope } = harness();
  await flushPromises();
  let finish!: (snapshot: LocalizationSnapshot) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const save = controller.update(german);
  scope.value = "reading";
  await flushPromises();
  expect(controller.snapshot.value).toEqual(english);
  finish(german);
  expect(await save).toBe(false);
  expect(preferences.value.language).toBe("en");
  expect(controller.saving.value).toBe(false);
});

it("keeps corrupt or unavailable settings unavailable rather than enabling overwrite", async () => {
  vi.mocked(invoke).mockRejectedValue("native.localization.invalid");
  const { controller } = harness();
  await flushPromises();
  expect(controller.snapshot.value).toBeNull();
  expect(controller.error.value).toBe("localization.loadFailed");
  const calls = vi.mocked(invoke).mock.calls.length;
  expect(await controller.update(english)).toBe(false);
  expect(vi.mocked(invoke).mock.calls).toHaveLength(calls);
});

it("does not write read-only workspaces and releases its event listener", async () => {
  vi.mocked(invoke).mockResolvedValue({ ...english, writable: false });
  const { controller, wrapper } = harness();
  await flushPromises();
  const calls = vi.mocked(invoke).mock.calls.length;
  expect(await controller.update(german)).toBe(false);
  expect(vi.mocked(invoke).mock.calls).toHaveLength(calls);
  wrapper.unmount();
  expect(events.stop).toHaveBeenCalledOnce();
});
