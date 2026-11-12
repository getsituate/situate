import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LifecycleCoordinator } from "../lifecycle";
import { shallowRef } from "vue";

export const recoveryPreparing = shallowRef(false);

let complete: ((token: string) => Promise<void>) | undefined;

export async function installRecoveryLifecycle(
  lifecycle: LifecycleCoordinator,
  refresh: (scopes: readonly string[]) => Promise<void>,
): Promise<() => void> {
  if (complete) throw new Error("native.recovery.failed");
  const listeners: UnlistenFn[] = [];
  let registration: string | undefined;
  let activeToken: string | undefined;
  const settled = new Set<string>();
  let completion: { token: string; promise: Promise<void> } | undefined;
  const finish = (token: string): Promise<void> => {
    if (completion?.token === token) return completion.promise;
    const promise = (async () => {
      const status = await invoke<{ state: string; workspaceIds: string[] }>(
        "recovery_status",
        { token },
      );
      if (status.state !== "completed")
        throw new Error("native.recovery.failed");
      lifecycle.releaseRecoveryFiles(token);
      await refresh(status.workspaceIds);
      settled.add(token);
      lifecycle.finishRecovery(token, true);
      if (activeToken === token) {
        activeToken = undefined;
        recoveryPreparing.value = false;
      }
    })().catch((reason: unknown) => {
      if (completion?.promise === promise) completion = undefined;
      throw reason;
    });
    completion = { token, promise };
    return promise;
  };
  listeners.push(lifecycle.onRecoveryCompleted(finish));
  listeners.push(
    lifecycle.onRecoveryCancelled((token) => {
      settled.add(token);
      if (activeToken === token) {
        activeToken = undefined;
        recoveryPreparing.value = false;
      }
    }),
  );
  try {
    listeners.push(
      await listen<string>("recovery-prepare", ({ payload }) => {
        if (
          registration &&
          !settled.has(payload) &&
          (!activeToken || activeToken === payload)
        ) {
          activeToken = payload;
          recoveryPreparing.value = true;
          void lifecycle.prepareRecovery(payload, registration);
        }
      }),
    );
    listeners.push(
      await listen<string>("recovery-cancelled", ({ payload }) => {
        void (async () => {
          const status = await invoke<{ state: string }>("recovery_status", {
            token: payload,
          });
          if (status.state !== "cancelled") return;
          settled.add(payload);
          lifecycle.finishRecovery(payload);
          if (activeToken === payload) {
            activeToken = undefined;
            recoveryPreparing.value = false;
          }
        })().catch(() => {});
      }),
    );
    listeners.push(
      await listen<string>("recovery-completed", ({ payload }) => {
        void finish(payload).catch(() => {});
      }),
    );
    registration = await invoke<string>("recovery_register");
    complete = finish;
  } catch (reason) {
    listeners.forEach((stop) => stop());
    throw reason;
  }
  return () => {
    registration = undefined;
    listeners.forEach((stop) => stop());
    if (complete === finish) complete = undefined;
  };
}

export async function requestRecovery(
  kind: "workspace" | "restart",
  scope?: string,
): Promise<void> {
  const finish = complete;
  if (!finish) throw new Error("native.recovery.failed");
  const token = await invoke<string>("recovery_request", { kind, scope });
  if (kind === "workspace") await finish(token);
}

export async function openRecoveryEmail(body: string): Promise<boolean> {
  if (new TextEncoder().encode(body).length > 8192) return false;
  try {
    return await invoke<boolean>("recovery_open_email", { body });
  } catch {
    return false;
  }
}
