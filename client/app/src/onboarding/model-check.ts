import { invoke } from "@tauri-apps/api/core";

export async function checkModelAccess(
  scope: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  let cancelled: Promise<void> | undefined;
  const cancel = () => {
    cancelled ??= invoke<void>("ai_model_check_cancel", { scope, requestId });
    void cancelled.catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await invoke<void>("ai_model_check", { scope, requestId });
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (signal?.aborted) {
      cancel();
      await cancelled;
    }
  }
}
