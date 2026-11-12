import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isMessageKey, type MessageKey } from "@situate/localization";
import {
  accentStyle,
  isAppearanceSnapshot,
  type Accent,
  type AppearanceSnapshot,
} from "./accents";

export function useAppearance(
  scope: Readonly<Ref<string | null>>,
  creationAccent?: Readonly<Ref<Accent | undefined>>,
) {
  const snapshot = shallowRef<AppearanceSnapshot | null>(null);
  const accent = ref<Accent>("violet");
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<MessageKey | "">("");
  let alive = true;
  let epoch = 0;
  let loadRequest = 0;
  let stop: UnlistenFn | undefined;
  let queued: Accent | undefined;
  let pending: Promise<boolean> | undefined;
  let pendingReload = false;

  function current(generation: number, target: string | null): boolean {
    return alive && generation === epoch && target === scope.value;
  }
  async function reload(preserveError = false): Promise<void> {
    if (saving.value) {
      pendingReload = true;
      return;
    }
    const generation = epoch;
    const target = scope.value;
    const request = ++loadRequest;
    loading.value = true;
    if (!preserveError) error.value = "";
    try {
      const value: unknown =
        target && isTauri()
          ? await invoke("appearance_snapshot", { scope: target })
          : { accent: "violet", writable: false, revision: null };
      if (!current(generation, target) || request !== loadRequest) return;
      if (!isAppearanceSnapshot(value)) throw new Error();
      snapshot.value = value;
      accent.value = value.accent;
    } catch {
      if (current(generation, target) && request === loadRequest) {
        snapshot.value = null;
        error.value = "settings.appearance.loadFailed";
      }
    } finally {
      if (current(generation, target) && request === loadRequest)
        loading.value = false;
    }
  }

  async function save(target: string, generation: number): Promise<boolean> {
    saving.value = true;
    error.value = "";
    try {
      while (queued !== undefined && current(generation, target)) {
        const next = queued;
        queued = undefined;
        if (snapshot.value?.accent === next) continue;
        const value: unknown = await invoke("appearance_update", {
          scope: target,
          accent: next,
          expectedRevision: snapshot.value?.revision ?? null,
        });
        if (!current(generation, target)) return false;
        if (!isAppearanceSnapshot(value)) throw new Error();
        snapshot.value = value;
        if (queued === undefined) accent.value = value.accent;
      }
      return true;
    } catch (failure) {
      if (current(generation, target)) {
        queued = undefined;
        accent.value = snapshot.value?.accent ?? "violet";
        snapshot.value = null;
        error.value =
          typeof failure === "string" &&
          failure.startsWith("native.appearance.") &&
          isMessageKey(failure)
            ? failure
            : "settings.appearance.saveFailed";
        saving.value = false;
        pendingReload = false;
        await reload(true);
      }
      return false;
    } finally {
      if (current(generation, target)) {
        saving.value = false;
        if (pendingReload) {
          pendingReload = false;
          await reload(!!error.value);
        }
      }
    }
  }

  function update(value: Accent): void {
    const target = scope.value;
    if (!target || !snapshot.value?.writable || loading.value) return;
    accent.value = value;
    queued = value;
    if (!saving.value) {
      const task = save(target, epoch);
      pending = task;
      void task.finally(() => {
        if (pending === task) pending = undefined;
      });
    }
  }
  async function flush(): Promise<void> {
    if (pending && !(await pending))
      throw error.value || "settings.appearance.saveFailed";
  }

  watch(
    scope,
    () => {
      epoch++;
      queued = undefined;
      pending = undefined;
      pendingReload = false;
      snapshot.value = null;
      accent.value = creationAccent?.value ?? "violet";
      saving.value = false;
      void reload();
    },
    { immediate: true, flush: "sync" },
  );

  function clearStyle(): void {
    const root = document.documentElement;
    for (const name of Object.keys(accentStyle("violet")))
      root.style.removeProperty(name);
    delete root.dataset.workspaceAccent;
  }
  watch(
    [scope, accent],
    () => {
      clearStyle();
      if (!scope.value) return;
      const root = document.documentElement;
      for (const [name, value] of Object.entries(accentStyle(accent.value)))
        root.style.setProperty(name, value);
      root.dataset.workspaceAccent = accent.value;
    },
    { immediate: true, flush: "sync" },
  );

  if (isTauri()) {
    void listen<{ scope: string }>("appearance-changed", (event) => {
      if (event.payload.scope === scope.value) void reload();
    })
      .then((unlisten) => {
        if (!alive) unlisten();
        else {
          stop = unlisten;
          void reload();
        }
      })
      .catch(() => {
        if (alive) error.value = "settings.appearance.loadFailed";
      });
  }
  onBeforeUnmount(() => {
    alive = false;
    epoch++;
    stop?.();
    clearStyle();
  });
  return { snapshot, accent, loading, saving, error, reload, update, flush };
}
