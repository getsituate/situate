import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { shallowReactive, shallowRef } from "vue";

export type UpdatePhase =
  | "current"
  | "checking"
  | "downloading"
  | "ready"
  | "preparing"
  | "installing"
  | "check-failed"
  | "download-failed"
  | "install-failed"
  | "recovery-required";
export interface UpdateSnapshot {
  supported: boolean;
  installedVersion: string;
  phase: UpdatePhase;
  availableVersion: string | null;
  artifactId: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  lastSuccessfulCheck: number | null;
  error: string | null;
  runningActions: boolean;
}
export const updates = shallowReactive<UpdateSnapshot>({
  supported: false,
  installedVersion: "",
  phase: "current",
  availableVersion: null,
  artifactId: null,
  downloadedBytes: 0,
  totalBytes: null,
  lastSuccessfulCheck: null,
  error: null,
  runningActions: false,
});
export const updateRequestError = shallowRef<unknown>(null);
export const updateRequestPending = shallowRef(false);
let generation = 0;
let revision = 0;
let stop: UnlistenFn | undefined;

export async function initializeUpdates(): Promise<void> {
  const current = ++generation;
  stop?.();
  stop = undefined;
  try {
    const unlisten = await listen<UpdateSnapshot>(
      "updates-changed",
      ({ payload }) => {
        if (current !== generation) return;
        ++revision;
        updateRequestError.value = null;
        Object.assign(updates, payload);
      },
    );
    if (current !== generation) {
      unlisten();
      return;
    }
    stop = unlisten;
    const request = revision;
    const snapshot = await invoke<UpdateSnapshot>("updates_snapshot");
    if (current === generation && request === revision)
      Object.assign(updates, snapshot);
  } catch (error) {
    if (current === generation) updateRequestError.value = error;
  }
}
export function stopUpdatesListeners(): void {
  ++generation;
  stop?.();
  stop = undefined;
}
async function request(
  command: "updates_check" | "updates_install",
  args?: { artifactId: string; abortRunning: boolean; force?: boolean },
): Promise<boolean> {
  if (!updates.supported || updateRequestPending.value) return false;
  updateRequestPending.value = true;
  updateRequestError.value = null;
  const current = generation;
  const started = revision;
  try {
    const snapshot = await invoke<UpdateSnapshot>(command, args);
    if (current === generation && started === revision && snapshot)
      Object.assign(updates, snapshot);
    return true;
  } catch (error) {
    if (current === generation) updateRequestError.value = error;
    return false;
  } finally {
    updateRequestPending.value = false;
  }
}
export const checkUpdates = (): Promise<boolean> => request("updates_check");
export function installUpdate(
  artifactId: string,
  abortRunning: boolean,
  force = false,
): Promise<boolean> {
  if (!updateReady() || artifactId !== updates.artifactId) {
    updateRequestError.value = "native.updates.changed";
    return Promise.resolve(false);
  }
  return request("updates_install", {
    artifactId,
    abortRunning: abortRunning || force,
    ...(force ? { force: true } : {}),
  });
}
export function updateReady(): boolean {
  return (
    updates.supported &&
    updates.artifactId != null &&
    ["ready", "install-failed"].includes(updates.phase)
  );
}
