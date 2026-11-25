import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { keyCombination, validCombination } from "./shortcut-keys";
import {
  createWorkspaceShortcuts,
  type PluginShortcut,
  type ShortcutSnapshot,
} from "./workspace-shortcuts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const ipc = vi.mocked(invoke);
const initial: ShortcutSnapshot = { revision: "initial", bindings: {} };
const newTab = "layout.new-tab";
const change = { kind: "set", keys: "Control+J" } as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
const binding = (
  store: ReturnType<typeof createWorkspaceShortcuts>,
  id = newTab,
) => store.rows.value.find((row) => row.id === id)?.keys;
function contribution(
  id: string,
  defaults: PluginShortcut["defaults"] = {},
): PluginShortcut {
  return {
    id,
    defaults,
    title: "Open note",
    plugin: "Notebook",
    available: () => true,
    run: async () => {},
  };
}
beforeEach(() => {
  ipc.mockReset().mockResolvedValue(initial);
  vi.mocked(isTauri).mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

it("uses separate platform overrides and lets plugins claim only free keys", async () => {
  const snapshot: ShortcutSnapshot = {
    revision: "edited",
    bindings: {
      windows: { [newTab]: null, "notebook:explicit": "Control+W" },
      macos: { [newTab]: "Meta+J" },
    },
  };
  ipc.mockResolvedValue(snapshot);
  const windows = createWorkspaceShortcuts("garden", "windows");
  const mac = createWorkspaceShortcuts("garden", "macos");
  const release = windows.register([
    contribution("notebook:explicit", { windows: "Control+K" }),
    contribution("notebook:first", { windows: "Control+T" }),
    contribution("notebook:second", { windows: "Control+T" }),
    contribution("notebook:manual"),
  ]);
  await Promise.all([windows.load(), mac.load()]);
  expect(binding(mac)).toBe("Meta+J");
  expect(binding(windows)).toBeNull();
  expect(binding(windows, "notebook:explicit")).toBe("Control+W");
  expect(binding(windows, "layout.close-tab")).toBeNull();
  expect(binding(windows, "notebook:first")).toBe("Control+T");
  expect(binding(windows, "notebook:second")).toBeNull();
  expect(binding(windows, "notebook:manual")).toBeNull();
  release();
  expect(binding(windows, "notebook:first")).toBeUndefined();
  await vi.waitFor(() =>
    expect(ipc).toHaveBeenLastCalledWith("keyboard_shortcuts_plugins", {
      scope: "garden",
      registrations: [],
    }),
  );
});

it("polls only while started and retries after a failed read without losing the previous bindings", async () => {
  vi.useFakeTimers();
  const store = createWorkspaceShortcuts("garden", "windows");
  const edited = {
    revision: "edited",
    bindings: { windows: { [newTab]: "Control+J" } },
  };
  ipc
    .mockResolvedValueOnce(initial)
    .mockRejectedValueOnce("unreadable")
    .mockResolvedValue(edited);
  try {
    store.start();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(binding(store)).toBe("Control+T");
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.state.loadError).toBe(true);
    expect(binding(store)).toBe("Control+T");
    await expect(store.update(newTab, change, "initial")).rejects.toThrow(
      "native.shortcuts.storage",
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.state.loadError).toBe(false);
    expect(binding(store)).toBe("Control+J");
    store.stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(ipc.mock.calls.map(([command]) => command)).toEqual(
      Array(3).fill("keyboard_shortcuts_snapshot"),
    );
  } finally {
    store.stop();
  }
});

it("sends a revision-bound edit to the owning workspace and ignores a save that resolves after stop", async () => {
  const store = createWorkspaceShortcuts("garden", "windows");
  await expect(store.update(newTab, change, null)).rejects.toThrow(
    "native.shortcuts.storage",
  );
  await store.load();
  await expect(
    store.update("missing:action", change, "initial"),
  ).rejects.toThrow("native.shortcuts.unavailable");
  const pending = deferred<ShortcutSnapshot>();
  ipc.mockReturnValueOnce(pending.promise);
  const saved = store.update(newTab, change, "initial");
  await store.load();
  await expect(store.update(newTab, change, "initial")).rejects.toThrow(
    "native.shortcuts.storage",
  );
  expect(ipc.mock.calls).toEqual([
    ["keyboard_shortcuts_snapshot", { scope: "garden" }],
    [
      "keyboard_shortcuts_update",
      {
        scope: "garden",
        request: { action: newTab, change, expectedRevision: "initial" },
      },
    ],
  ]);
  store.stop();
  pending.resolve({
    revision: "saved",
    bindings: { windows: { [newTab]: "Control+J" } },
  });
  await saved;
  expect(binding(store)).toBe("Control+T");
  expect(store.state.saving).toBe(false);
});

it("does not send a queued edit after stop or apply a stale workspace read", async () => {
  const store = createWorkspaceShortcuts("garden", "windows");
  const read = deferred<ShortcutSnapshot>();
  ipc.mockReturnValueOnce(read.promise);
  const stale = store.load();
  await store.load();
  read.resolve({
    revision: "stale",
    bindings: { windows: { [newTab]: null } },
  });
  await stale;
  expect(binding(store)).toBe("Control+T");
  const publication = deferred<void>();
  ipc.mockReturnValueOnce(publication.promise);
  store.register([contribution("notebook:open")]);
  const queued = store.update(newTab, change, "initial");
  store.stop();
  publication.resolve();
  await expect(queued).rejects.toThrow("native.shortcuts.unavailable");
  expect(ipc.mock.calls.map(([command]) => command)).not.toContain(
    "keyboard_shortcuts_update",
  );
});

it("uses in-memory defaults on the web and leaves unsupported platforms inactive", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const web = createWorkspaceShortcuts("garden", "macos");
  await web.load();
  expect(binding(web)).toBe("Meta+T");
  await expect(web.update(newTab, change, null)).rejects.toThrow(
    "native.shortcuts.storage",
  );
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
  const unsupported = createWorkspaceShortcuts("garden");
  unsupported.start();
  await unsupported.load();
  expect(unsupported.rows.value).toEqual([]);
  expect(ipc).not.toHaveBeenCalled();
});

it.each([
  [{ key: "n", metaKey: true }, "Meta+N"],
  [{ key: "+", ctrlKey: true, shiftKey: true }, "Control+Shift+Plus"],
  [{ key: " ", ctrlKey: true, altKey: true }, "Control+Alt+Space"],
  [{ key: "é", ctrlKey: true }, "Control+É"],
  [{ key: "ArrowDown", altKey: true }, "Alt+ArrowDown"],
  [{ key: "n" }, undefined],
  [{ key: "n", ctrlKey: true, isComposing: true }, undefined],
  [{ key: "Shift", ctrlKey: true, shiftKey: true }, undefined],
  [{ key: "Dead", altKey: true }, undefined],
  [
    { key: "@", ctrlKey: true, altKey: true, modifierAltGraph: true },
    undefined,
  ],
] as const)("normalizes logical keyboard events: %j", (init, expected) => {
  expect(keyCombination(new KeyboardEvent("keydown", init))).toBe(expected);
});

it.each([
  ["macos", "Meta+Q", false],
  ["macos", "Meta+N", true],
  ["windows", "Alt+F4", false],
  ["windows", "Meta+T", false],
  ["windows", "Control+Alt+Q", false],
  ["windows", "Control+Alt+Shift+ArrowUp", true],
  ["windows", "Control+Control+T", false],
  ["windows", "Shift+Control+T", false],
  ["windows", "Shift+T", false],
  ["windows", "Super+T", false],
  ["windows", "Control+t", false],
  ["windows", "Control+É", true],
  ["windows", "Control+F24", true],
  ["windows", "Control+F25", false],
  ["windows", `Control+${"X".repeat(81)}`, false],
] as const)(
  "validates recordable bindings for %s: %s",
  (platform, keys, allowed) => {
    expect(validCombination(keys, platform)).toBe(allowed);
  },
);
