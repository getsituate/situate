import { computed, shallowReactive } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  builtinShortcuts,
  shortcutPlatform,
  type ShortcutAction,
  type ShortcutPlatform,
} from "./shortcuts";
import type { LayoutAction, LayoutActionResult } from "./actions";

type LayoutRunner = (
  action: LayoutAction,
  isCurrent: () => boolean,
) => Promise<LayoutActionResult>;

export type ShortcutDefaults = Partial<Record<ShortcutPlatform, string>>;
export type BindingChange =
  { kind: "set"; keys: string } | { kind: "remove" } | { kind: "restore" };
export interface ShortcutSnapshot {
  revision: string | null;
  bindings: Partial<
    Record<ShortcutPlatform, Readonly<Record<string, string | null>>>
  >;
}
export interface PluginShortcut {
  id: string;
  title: string;
  plugin: string;
  defaults: ShortcutDefaults;
  available(): boolean;
  run(): Promise<void>;
}

export type ShortcutRow = {
  readonly id: string;
  readonly title: string;
  readonly group: "tabs" | "panes" | "chat" | "plugins";
  readonly plugin?: string;
  readonly keys: string | null;
  readonly standard: string | null;
  readonly modified: boolean;
  readonly action: ShortcutAction | (() => Promise<void>);
};

export function effectiveShortcuts(
  platform: ShortcutPlatform,
  snapshot: ShortcutSnapshot | null,
  plugins: readonly PluginShortcut[],
): ShortcutRow[] {
  const overrides = snapshot?.bindings[platform] ?? {};
  const rows = [
    ...builtinShortcuts.map((entry) => ({
      id: entry.id as string,
      title: entry.title(),
      group: entry.group,
      standard: entry.defaults[platform],
      action: entry.action,
    })),
    ...plugins.map((entry) => ({
      id: entry.id,
      title: entry.title,
      group: "plugins" as const,
      plugin: entry.plugin,
      standard: entry.defaults[platform] ?? null,
      action: entry.run,
    })),
  ];
  const owners = new Map<string, string>();
  for (const [id, keys] of Object.entries(overrides))
    if (keys && !owners.has(keys)) owners.set(keys, id);
  return rows.map((row) => {
    const modified = Object.hasOwn(overrides, row.id);
    const desired = modified ? (overrides[row.id] ?? null) : row.standard;
    const owner = desired && owners.get(desired);
    const keys = desired && (!owner || owner === row.id) ? desired : null;
    if (keys) owners.set(keys, row.id);
    return { ...row, modified, keys };
  });
}

export function createWorkspaceShortcuts(
  scope: string,
  platform = shortcutPlatform(navigator.userAgent),
) {
  const native = isTauri();
  const state = shallowReactive({
    snapshot: null as ShortcutSnapshot | null,
    loading: false,
    loadError: false,
    saving: false,
  });
  const contributions = shallowReactive(new Map<string, PluginShortcut>());
  let runtimeGeneration = 0;
  let loadVersion = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let publication = Promise.resolve();
  let runner: LayoutRunner | undefined;
  function bindLayout(run: LayoutRunner) {
    runner = run;
    return () => {
      if (runner === run) runner = undefined;
    };
  }
  function runLayout(
    action: LayoutAction,
    isCurrent: () => boolean,
  ): Promise<LayoutActionResult> {
    const owner = runner;
    return owner
      ? owner(action, () => runner === owner && isCurrent())
      : Promise.resolve({ status: "unavailable" });
  }
  function isActive() {
    return !!runner;
  }
  const rows = computed(() =>
    platform
      ? effectiveShortcuts(platform, state.snapshot, [
          ...contributions.values(),
        ])
      : [],
  );

  function publish() {
    if (!native || !platform) return;
    const registrations = [...contributions.values()].map(
      ({ id, defaults }) => ({ id, defaults }),
    );
    publication = publication
      .catch(() => undefined)
      .then(() =>
        invoke("keyboard_shortcuts_plugins", { scope, registrations }),
      );
    void publication.catch(() => undefined);
  }
  async function load() {
    if (!platform || state.saving) return;
    const request = ++loadVersion;
    state.loading = !state.snapshot;
    try {
      const snapshot = native
        ? await invoke<ShortcutSnapshot>("keyboard_shortcuts_snapshot", {
            scope,
          })
        : { revision: null, bindings: {} };
      if (request === loadVersion) {
        state.snapshot = snapshot;
        state.loadError = false;
      }
    } catch {
      if (request === loadVersion) state.loadError = true;
    } finally {
      if (request === loadVersion) state.loading = false;
    }
  }
  function start() {
    if (!platform || timer !== undefined) return;
    void load();
    timer = setInterval(() => void load(), 2000);
  }
  function stop() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    ++runtimeGeneration;
    ++loadVersion;
    state.loading = false;
    state.saving = false;
  }
  async function update(
    action: string,
    change: BindingChange,
    expectedRevision: string | null,
  ) {
    if (
      !native ||
      !platform ||
      !state.snapshot ||
      state.loadError ||
      state.saving
    )
      throw new Error("native.shortcuts.storage");
    if (!rows.value.some((row) => row.id === action))
      throw new Error("native.shortcuts.unavailable");
    const generation = runtimeGeneration;
    ++loadVersion;
    state.saving = true;
    try {
      await publication;
      if (generation !== runtimeGeneration)
        throw new Error("native.shortcuts.unavailable");
      const snapshot = await invoke<ShortcutSnapshot>(
        "keyboard_shortcuts_update",
        { scope, request: { action, expectedRevision, change } },
      );
      if (generation === runtimeGeneration) state.snapshot = snapshot;
    } finally {
      if (generation === runtimeGeneration) state.saving = false;
    }
  }
  function register(entries: readonly PluginShortcut[]) {
    for (const entry of entries) contributions.set(entry.id, entry);
    if (entries.length) publish();
    return () => {
      let changed = false;
      for (const entry of entries)
        if (contributions.get(entry.id) === entry) {
          contributions.delete(entry.id);
          changed = true;
        }
      if (changed) publish();
    };
  }
  return {
    platform,
    rows,
    state,
    load,
    start,
    stop,
    update,
    register,
    bindLayout,
    runLayout,
    isActive,
  };
}
export type WorkspaceShortcuts = ReturnType<typeof createWorkspaceShortcuts>;
