import { invoke } from "@tauri-apps/api/core";
import { abortWorkspaceChats } from "../ai/chat";

export async function hasRunningProcesses(
  scopes: readonly { id: string }[] = [],
): Promise<boolean> {
  const activity = await Promise.all(
    scopes.map(({ id: scope }) =>
      invoke<{ runningActions: number }>("plugin_executor", {
        scope,
        request: { operation: "activity" },
      }),
    ),
  );
  return activity.some(({ runningActions }) => runningActions > 0);
}

export async function prepareClose(scope: string): Promise<boolean> {
  const [prepared, activity] = await Promise.all([
    invoke<{ processes: boolean } | undefined>("ai_prepare_close", { scope }),
    invoke<{ runningActions: number }>("plugin_executor", {
      scope,
      request: { operation: "activity" },
    }),
  ]);
  return !!prepared?.processes || activity.runningActions > 0;
}

export async function abortClose(scope: string): Promise<void> {
  await Promise.all([
    invoke("plugin_executor", { scope, request: { operation: "stop" } }),
    invoke("plugin_process_abort", { scope }),
    abortWorkspaceChats(scope),
  ]);
}
