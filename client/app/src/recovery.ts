import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { shallowRef } from "vue";

interface RecoveryState {
  revision: number;
  recovery: boolean;
  resumed: [string, string][];
}
const state = shallowRef<RecoveryState>();
let initialization: Promise<void> | undefined;
export function recoveryRevision(): number | undefined {
  return state.value?.revision;
}
export function recoveryMode(): boolean | undefined {
  return state.value?.recovery;
}
export function pluginMayExecute(scope: string, plugin: string): boolean {
  return (
    state.value?.recovery === false ||
    state.value?.resumed.some(
      ([workspace, id]) => workspace === scope && id === plugin,
    ) === true
  );
}
export function acceptRecoveryState(value: unknown): void {
  const candidate = value as RecoveryState | null;
  if (
    !candidate ||
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision < 0 ||
    typeof candidate.recovery !== "boolean" ||
    !Array.isArray(candidate.resumed) ||
    candidate.resumed.some(
      (key) =>
        !Array.isArray(key) ||
        key.length !== 2 ||
        key.some((part) => typeof part !== "string" || !part),
    )
  )
    throw new Error("layoutHost.pluginUnavailable");
  if (!state.value || candidate.revision >= state.value.revision)
    state.value = candidate;
}
export async function resumePlugins(
  scope: string,
  pluginId?: string,
): Promise<void> {
  acceptRecoveryState(
    await invoke("plugin_recovery_resume", {
      scope,
      pluginId: pluginId ?? null,
    }),
  );
}
export function initializeRecovery(): Promise<void> {
  initialization ??= Promise.resolve().then(async () => {
    const value: unknown = isTauri()
      ? await invoke("plugin_recovery_mode")
      : false;
    if (typeof value !== "boolean")
      throw new Error("layoutHost.pluginUnavailable");
    if (value) {
      const unlisten = await listen("plugin-recovery-changed", (event) => {
        try {
          acceptRecoveryState(event.payload);
        } catch {
          state.value = undefined;
        }
      });
      try {
        acceptRecoveryState(await invoke("plugin_recovery_state"));
      } catch (error) {
        unlisten();
        state.value = undefined;
        throw error;
      }
    } else {
      state.value = { revision: 0, recovery: false, resumed: [] };
    }
  });
  return initialization;
}
export function retryRecoveryInitialization(): Promise<void> {
  if (!state.value) initialization = undefined;
  return initializeRecovery();
}
