import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  deviceLanguage,
  initialFormats,
  isLocalizationSnapshot,
  isMessageKey,
  setPreferences,
  type LocalizationSnapshot,
  type MessageKey,
  type Preferences,
} from "@situate/localization";

export function useLocalization(scope: Readonly<Ref<string | null>>) {
  const snapshot = shallowRef<LocalizationSnapshot | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<MessageKey | "">("");
  let alive = true;
  let revision = 0;
  let stop: UnlistenFn | undefined;
  let pendingReload = false;
  const language = deviceLanguage(navigator.language);
  let device: LocalizationSnapshot = {
    language,
    formats: initialFormats(language),
    writable: false,
  };

  async function reload(): Promise<void> {
    if (saving.value) {
      pendingReload = true;
      return;
    }
    const request = ++revision;
    const target = scope.value;
    loading.value = true;
    error.value = "";
    try {
      const value = isTauri()
        ? await invoke<LocalizationSnapshot>("localization_snapshot", {
            scope: target,
          })
        : device;
      if (!alive || request !== revision || target !== scope.value) return;
      if (!isLocalizationSnapshot(value))
        throw new Error("localization.loadFailed");
      if (!target) device = value;
      snapshot.value = value;
      setPreferences(value);
    } catch {
      if (alive && request === revision)
        error.value = "localization.loadFailed";
    } finally {
      if (alive && request === revision) loading.value = false;
    }
  }
  async function update(preferences: Preferences): Promise<boolean> {
    const target = scope.value;
    if (!target || !snapshot.value?.writable || saving.value || loading.value)
      return false;
    const expected: Preferences = {
      language: snapshot.value.language,
      formats: { ...snapshot.value.formats },
    };
    const request = ++revision;
    saving.value = true;
    error.value = "";
    try {
      const value = await invoke<LocalizationSnapshot>("localization_update", {
        scope: target,
        preferences,
        expected,
      });
      if (!alive || request !== revision || target !== scope.value)
        return false;
      if (!isLocalizationSnapshot(value))
        throw new Error("localization.saveFailed");
      snapshot.value = value;
      setPreferences(value);
      return true;
    } catch (failure) {
      if (alive && request === revision)
        error.value =
          typeof failure === "string" && isMessageKey(failure)
            ? failure
            : "localization.saveFailed";
      return false;
    } finally {
      if (alive && request === revision) {
        saving.value = false;
        if (pendingReload) {
          pendingReload = false;
          await reload();
        }
      }
    }
  }
  watch(
    scope,
    () => {
      revision++;
      snapshot.value = null;
      saving.value = false;
      pendingReload = false;
      setPreferences(device);
      void reload();
    },
    { immediate: true },
  );
  if (isTauri()) {
    void listen<{ scope: string }>("localization-changed", (event) => {
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
        if (alive) error.value = "localization.loadFailed";
      });
  }
  function languageChanged(): void {
    if (!scope.value) void reload();
  }
  window.addEventListener("languagechange", languageChanged);
  onBeforeUnmount(() => {
    alive = false;
    revision++;
    stop?.();
    window.removeEventListener("languagechange", languageChanged);
  });
  return { snapshot, loading, saving, error, reload, update };
}
