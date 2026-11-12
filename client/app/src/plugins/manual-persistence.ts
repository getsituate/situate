import { invoke } from "@tauri-apps/api/core";
import { createApp, defineComponent, h, ref, useId, type App } from "vue";
import { SituateButton, SituateDialog } from "@situate/ui";
import { t } from "@situate/localization";

type SaveError =
  "native.plugins.stateSaveFailed" | "native.plugins.stateOutcomeUnknown";
interface PendingPersistence {
  invocationId: string;
  pluginId: string;
  error: SaveError;
}
type InvocationReply =
  | { outcome: "completed"; value: unknown }
  | { outcome: "pendingPersistence"; invocationId: string; error: SaveError };
interface PersistencePrompt {
  pending: PendingPersistence;
  waiters: { resolve(value: unknown): void; reject(error: Error): void }[];
}

function saveError(value: unknown): value is SaveError {
  return (
    value === "native.plugins.stateSaveFailed" ||
    value === "native.plugins.stateOutcomeUnknown"
  );
}
function pendingPersistence(value: unknown): value is PendingPersistence {
  if (!value || typeof value !== "object") return false;
  const pending = value as PendingPersistence;
  return (
    typeof pending.invocationId === "string" &&
    !!pending.invocationId &&
    typeof pending.pluginId === "string" &&
    !!pending.pluginId &&
    saveError(pending.error)
  );
}
function invocationReply(value: unknown): value is InvocationReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as InvocationReply;
  return (
    reply.outcome === "completed" ||
    (reply.outcome === "pendingPersistence" &&
      typeof reply.invocationId === "string" &&
      !!reply.invocationId &&
      saveError(reply.error))
  );
}

export function observeManualPersistence(
  scope: string,
  isCurrent: () => boolean,
  onError: (error: unknown) => void,
) {
  const queue = ref<PersistencePrompt[]>([]);
  const busy = ref(false);
  const failed = ref(false);
  const seenPersistences = new Set<string>();
  let disposed = false;
  let app: App | undefined;
  let container: HTMLDivElement | undefined;
  const current = () => !disposed && isCurrent();
  function dismiss() {
    const prompt = queue.value.shift();
    if (prompt)
      for (const waiter of prompt.waiters)
        waiter.reject(new Error(prompt.pending.error));
    failed.value = false;
  }
  async function retryPersistence() {
    const prompt = queue.value[0];
    if (!current() || !prompt || busy.value || failed.value) return;
    busy.value = true;
    try {
      const reply = await invoke<unknown>("plugin_executor", {
        scope,
        request: {
          operation: "retryPersistence",
          invocationId: prompt.pending.invocationId,
        },
      });
      if (!current()) return;
      if (!invocationReply(reply))
        throw new Error("native.plugins.stateOutcomeUnknown");
      if (reply.outcome === "completed") {
        queue.value.shift();
        for (const waiter of prompt.waiters) waiter.resolve(reply.value);
      } else {
        if (reply.invocationId !== prompt.pending.invocationId)
          throw new Error("native.plugins.stateOutcomeUnknown");
        prompt.pending.error = reply.error;
        onError(new Error(reply.error));
      }
    } catch (error) {
      if (current()) {
        failed.value = true;
        for (const waiter of prompt.waiters)
          waiter.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        prompt.waiters = [];
        onError(error);
      }
    } finally {
      busy.value = false;
    }
  }
  function mount() {
    if (app) return;
    container = document.createElement("div");
    document.body.append(container);
    app = createApp(
      defineComponent({
        setup() {
          const titleId = useId();
          const bodyId = useId();
          return () => {
            const prompt = queue.value[0];
            if (!prompt) return null;
            return h(
              SituateDialog,
              {
                key: prompt.pending.invocationId,
                open: true,
                "aria-labelledby": titleId,
                "aria-describedby": bodyId,
                "aria-busy": busy.value,
                onCancel: (event: Event) => {
                  event.preventDefault();
                  if (!busy.value) dismiss();
                },
              },
              {
                header: () => h("h2", { id: titleId }, t("chat.failed")),
                default: () => [
                  h(
                    "p",
                    { id: bodyId },
                    prompt.pending.error === "native.plugins.stateSaveFailed"
                      ? t("native.plugins.stateSaveFailed")
                      : t("native.plugins.stateOutcomeUnknown"),
                  ),
                  h(
                    "p",
                    { "data-localization-content": "user" },
                    prompt.pending.pluginId,
                  ),
                  failed.value
                    ? h("p", { role: "alert" }, t("chat.failed"))
                    : null,
                ],
                actions: () =>
                  failed.value
                    ? h(
                        SituateButton,
                        { variant: "secondary", onClick: dismiss },
                        () => t("pluginManagement.uninstall.close"),
                      )
                    : [
                        h(
                          SituateButton,
                          {
                            variant: "secondary",
                            autofocus: true,
                            disabled: busy.value,
                            onClick: dismiss,
                          },
                          () => t("pluginManagement.uninstall.close"),
                        ),
                        h(
                          SituateButton,
                          {
                            disabled: busy.value,
                            onClick: () => void retryPersistence(),
                          },
                          () => t("files.retrySaves"),
                        ),
                      ],
              },
            );
          };
        },
      }),
    );
    app.mount(container);
  }
  function acceptPersistence(
    pending: PendingPersistence,
  ): PersistencePrompt | undefined {
    if (!current()) return;
    const existing = queue.value.find(
      (prompt) => prompt.pending.invocationId === pending.invocationId,
    );
    if (existing) return existing;
    if (seenPersistences.has(pending.invocationId)) return;
    seenPersistences.add(pending.invocationId);
    queue.value.push({ pending, waiters: [] });
    mount();
    return queue.value[queue.value.length - 1];
  }
  const ready = (async () => {
    if (!current()) return;
    const saves = await invoke<PendingPersistence[]>("plugin_executor", {
      scope,
      request: { operation: "pendingPersistences" },
    });
    for (const value of saves)
      if (pendingPersistence(value)) acceptPersistence(value);
  })();
  void ready.catch(() => undefined);
  return {
    ready,
    async unwrap(reply: unknown, pluginId: string): Promise<unknown> {
      if (!current()) throw new Error("plugins.workspaceUnavailable");
      if (!invocationReply(reply))
        throw new Error("native.plugins.stateOutcomeUnknown");
      if (reply.outcome === "completed") return reply.value;
      onError(new Error(reply.error));
      const prompt = acceptPersistence({
        pluginId,
        invocationId: reply.invocationId,
        error: reply.error,
      });
      if (!prompt) throw new Error(reply.error);
      return new Promise((resolve, reject) => {
        prompt.waiters.push({ resolve, reject });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      app?.unmount();
      container?.remove();
      for (const prompt of queue.value)
        for (const waiter of prompt.waiters)
          waiter.reject(new Error("plugins.workspaceUnavailable"));
      queue.value = [];
    },
  };
}
