import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onBeforeUnmount, onMounted, readonly, ref } from "vue";

const preference = ref<boolean | null>(null);
export const analyticsPreference = readonly(preference);

export async function setAnalyticsPreference(enabled: boolean): Promise<void> {
  await invoke("analytics_set_preference", { enabled });
  preference.value = enabled;
}

export function trackDailyActivity(scope: () => string | null): void {
  let stop: UnlistenFn | undefined;
  let disposed = false;
  let lastDay: string | undefined;

  function activity(event: MouseEvent | KeyboardEvent): void {
    if (
      !preference.value ||
      !event.isTrusted ||
      (event.target instanceof Element &&
        event.target.closest("[data-analytics-preference]")) ||
      ("repeat" in event && event.repeat) ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    )
      return;
    const day = new Date().toISOString().slice(0, 10);
    if (lastDay === day) return;
    lastDay = day;
    void invoke("analytics_daily_activity", { scope: scope() }).catch(() => {
      if (lastDay === day) lastDay = undefined;
    });
  }

  onMounted(async () => {
    if (!isTauri()) return;
    let preferenceChanged = false;
    try {
      const unlisten = await listen<boolean>(
        "analytics-preference-changed",
        ({ payload }) => {
          if (disposed) return;
          preferenceChanged = true;
          preference.value = payload;
        },
      );
      if (disposed) {
        unlisten();
        return;
      }
      stop = unlisten;
      const initial = await invoke<boolean | null>("analytics_preference");
      if (disposed) return;
      if (!preferenceChanged) preference.value = initial;
      window.addEventListener("click", activity, true);
      window.addEventListener("keydown", activity, true);
    } catch {
      // Analytics are unavailable if the native preference cannot be read.
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
    stop?.();
    window.removeEventListener("click", activity, true);
    window.removeEventListener("keydown", activity, true);
  });
}
