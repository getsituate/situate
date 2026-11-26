import { invoke, isTauri } from "@tauri-apps/api/core";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import type { WorkspaceTheme } from "./theme-tokens";
import { useThemeSelection } from "./useThemeSelection";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const mist: WorkspaceTheme = {
  id: "mist",
  key: '["paper","installation-a","mist"]',
  title: "Mist",
  provider: "Paper",
  variables: { "--situate-paper": "#edf4ff" },
};
const dusk: WorkspaceTheme = {
  ...mist,
  id: "dusk",
  key: '["paper","installation-a","dusk"]',
};
const storageError = "settings.appearance.themeStorageFailed";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function load(scope: string) {
  return [
    "workspace_theme_selection",
    { scope, request: { operation: "load" } },
  ];
}
function save(scope: string, selection: string | null) {
  return [
    "workspace_theme_selection",
    { scope, request: { operation: "save", selection } },
  ];
}
function setup(initial: readonly WorkspaceTheme[] = [mist, dusk]) {
  const scope = ref<string | undefined>("garden");
  const themes = ref(initial);
  const owner = effectScope();
  owners.push(owner);
  const appearance = owner.run(() => useThemeSelection(scope, themes))!;
  return { scope, themes, ...appearance };
}

const ipc = vi.mocked(invoke);
const owners: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  ipc.mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});
afterEach(() => owners.splice(0).forEach((owner) => owner.stop()));

describe("workspace theme selection", () => {
  it("waits for an available provider, restores its theme, and persists changes including a return to the built-in theme", async () => {
    const opening = deferred<string>();
    ipc.mockReturnValueOnce(opening.promise).mockResolvedValue(undefined);
    const { themes, selected, busy, select } = setup([]);
    expect(ipc).not.toHaveBeenCalled();

    themes.value = [mist, dusk];
    expect(ipc.mock.calls).toEqual([load("garden")]);
    expect(busy.value).toBe(true);
    expect(await select(dusk.key)).toBe(false);
    opening.resolve(mist.key);
    await flushPromises();
    expect(selected.value).toEqual(mist);
    expect(busy.value).toBe(false);

    expect(await select(mist.key)).toBe(true);
    expect(await select('["paper","other-installation","mist"]')).toBe(false);
    expect(ipc).toHaveBeenCalledTimes(1);
    expect(await select(dusk.key)).toBe(true);
    expect(selected.value).toEqual(dusk);
    expect(await select(null)).toBe(true);
    expect(selected.value).toBeUndefined();
    expect(ipc.mock.calls).toEqual([
      load("garden"),
      save("garden", dusk.key),
      save("garden", null),
    ]);
  });

  it("applies no plugin override when a saved provider is unavailable or the workspace closes", async () => {
    ipc.mockResolvedValue(mist.key);
    const { scope, themes, selected, select } = setup();
    await flushPromises();
    expect(selected.value).toEqual(mist);

    themes.value = [dusk];
    expect(selected.value).toBeUndefined();
    expect(ipc.mock.calls).toEqual([load("garden")]);
    themes.value = [];
    themes.value = [mist];
    await flushPromises();
    expect(selected.value).toEqual(mist);
    scope.value = undefined;
    expect(selected.value).toBeUndefined();
    expect(await select(mist.key)).toBe(false);
    expect(ipc.mock.calls).toEqual([load("garden"), load("garden")]);
  });

  it("uses the built-in appearance in the browser without reading native settings", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const { selected, busy, error } = setup();
    expect(selected.value).toBeUndefined();
    expect(busy.value).toBe(false);
    expect(error.value).toBe("");
    expect(ipc).not.toHaveBeenCalled();
  });

  it("reports a read failure without replacing an unreadable preference", async () => {
    ipc.mockRejectedValueOnce(new Error("read failed"));
    const { selected, busy, error } = setup();
    await flushPromises();
    expect(selected.value).toBeUndefined();
    expect(error.value).toBe(storageError);
    expect(busy.value).toBe(false);
    expect(ipc.mock.calls).toEqual([load("garden")]);
  });

  it.each([
    { readback: mist.key, chosen: mist },
    { readback: dusk.key, chosen: dusk },
    { readback: undefined, chosen: undefined },
  ])(
    "uses the readback after an uncertain save: $readback",
    async ({ readback, chosen }) => {
      ipc
        .mockResolvedValueOnce(mist.key)
        .mockRejectedValueOnce(new Error("uncertain save"));
      if (readback) ipc.mockResolvedValueOnce(readback);
      else ipc.mockRejectedValueOnce(new Error("read failed"));
      const { selected, busy, error, select } = setup();
      await flushPromises();
      expect(await select(dusk.key)).toBe(false);
      expect(selected.value).toEqual(chosen);
      expect(error.value).toBe(storageError);
      expect(busy.value).toBe(false);
      expect(ipc.mock.calls).toEqual([
        load("garden"),
        save("garden", dusk.key),
        load("garden"),
      ]);
    },
  );

  it.each(["success", "failure"] as const)(
    "ignores a late load %s after changing workspaces",
    async (result) => {
      const opening = deferred<string>();
      const openingNext = deferred<string>();
      ipc
        .mockReturnValueOnce(opening.promise)
        .mockReturnValueOnce(openingNext.promise);
      const { scope, selected, busy, error } = setup();
      scope.value = "reading";
      if (result === "success") opening.resolve(mist.key);
      else opening.reject(new Error("read failed"));
      await flushPromises();
      expect(selected.value).toBeUndefined();
      expect(busy.value).toBe(true);
      expect(error.value).toBe("");
      openingNext.resolve(dusk.key);
      await flushPromises();
      expect(selected.value).toEqual(dusk);
      expect(busy.value).toBe(false);
      expect(ipc.mock.calls).toEqual([load("garden"), load("reading")]);
    },
  );

  it.each(["success", "failure"] as const)(
    "ignores a late save %s after changing workspaces",
    async (result) => {
      const writing = deferred<undefined>();
      ipc
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce(writing.promise)
        .mockResolvedValueOnce(dusk.key);
      const { scope, selected, busy, error, select } = setup();
      await flushPromises();
      const pending = select(mist.key);
      expect(busy.value).toBe(true);
      scope.value = "reading";
      await flushPromises();
      if (result === "success") writing.resolve(undefined);
      else writing.reject(new Error("uncertain save"));
      expect(await pending).toBe(false);
      expect(selected.value).toEqual(dusk);
      expect(error.value).toBe("");
      expect(busy.value).toBe(false);
      expect(ipc.mock.calls).toEqual([
        load("garden"),
        save("garden", mist.key),
        load("reading"),
      ]);
    },
  );
});
