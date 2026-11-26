import { invoke, isTauri } from "@tauri-apps/api/core";
import { computed, ref, watch, type Ref } from "vue";
import type { MessageKey } from "@situate/localization";
import type { WorkspaceTheme } from "./theme-tokens";

export function useThemeSelection(
  scope: Readonly<Ref<string | undefined>>,
  themes: Readonly<Ref<readonly WorkspaceTheme[]>>,
) {
  const selection = ref<string | null>(null);
  const busy = ref(false);
  const error = ref<MessageKey | "">("");
  let epoch = 0;
  const selected = computed(() =>
    themes.value.find((theme) => theme.key === selection.value),
  );
  function load(target: string) {
    return invoke<string | null>("workspace_theme_selection", {
      scope: target,
      request: { operation: "load" },
    });
  }
  watch(
    () => (themes.value.length ? scope.value : undefined),
    async (target, _, onCleanup) => {
      const current = ++epoch;
      onCleanup(() => {
        epoch++;
      });
      selection.value = null;
      error.value = "";
      busy.value = false;
      if (!target || !isTauri()) return;
      busy.value = true;
      try {
        const loaded = await load(target);
        if (current === epoch) selection.value = loaded;
      } catch {
        if (current === epoch)
          error.value = "settings.appearance.themeStorageFailed";
      } finally {
        if (current === epoch) busy.value = false;
      }
    },
    { immediate: true, flush: "sync" },
  );

  async function select(key: string | null): Promise<boolean> {
    const target = scope.value;
    if (!target || busy.value) return false;
    if (key !== null && !themes.value.some((theme) => theme.key === key))
      return false;
    if (key === selection.value) return true;
    const current = epoch;
    busy.value = true;
    try {
      await invoke("workspace_theme_selection", {
        scope: target,
        request: { operation: "save", selection: key },
      });
      if (current !== epoch) return false;
      selection.value = key;
      return true;
    } catch {
      if (current !== epoch) return false;
      error.value = "settings.appearance.themeStorageFailed";
      try {
        const saved = await load(target);
        if (current === epoch) selection.value = saved;
      } catch {
        if (current === epoch) selection.value = null;
      }
      return false;
    } finally {
      if (current === epoch) busy.value = false;
    }
  }
  return { selected, busy, error, select };
}
