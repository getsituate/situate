import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { workspaceCoordinator } from "../layout/registry";

type Navigation =
  | { type: "open_view"; arguments: { viewId: string } }
  | {
      type: "reveal_content";
      arguments: { viewId: string; contentId: string; revision?: string };
    }
  | { type: "open_conversation"; arguments: { conversationId: string } };

export async function startNativePresentation(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const pending = new Map<string, AbortController>();
  let disposed = false;
  async function navigate(id: string, scope: string) {
    if (disposed || pending.has(id)) return;
    const controller = new AbortController();
    pending.set(id, controller);
    let changed = false;
    let ok: boolean;
    try {
      const action = await invoke<Navigation>("ai_presentation_take", {
        scope,
        id,
      });
      controller.signal.throwIfAborted();
      const coordinator = workspaceCoordinator(scope);
      if (!coordinator) throw new Error("layoutHost.workspaceUnavailable");
      const guard = {
        signal: controller.signal,
        isCurrent: () =>
          !disposed && workspaceCoordinator(scope) === coordinator,
      };
      if (action.type === "reveal_content") {
        changed = await coordinator.reveal(
          action.arguments.viewId,
          action.arguments.contentId,
          action.arguments.revision,
          guard,
        );
      } else if (action.type === "open_view") {
        changed = await coordinator.open(
          { kind: "view", viewId: action.arguments.viewId },
          undefined,
          guard,
        );
      } else if (action.type === "open_conversation") {
        changed = await coordinator.open(
          {
            kind: "conversation",
            conversationId: action.arguments.conversationId,
          },
          undefined,
          guard,
        );
      } else throw new Error("layoutHost.invalidNavigationArguments");
      controller.signal.throwIfAborted();
      ok = guard.isCurrent();
    } catch {
      ok = false;
    } finally {
      pending.delete(id);
    }
    await invoke("ai_presentation_ack", {
      scope,
      id,
      result: { ok, changed },
    }).catch(() => undefined);
  }
  const stopRequests = await listen<{ id: string; scope: string }>(
    "ai-presentation",
    ({ payload }) => void navigate(payload.id, payload.scope),
  );
  let stopCancellation: () => void;
  try {
    stopCancellation = await listen<{ id: string }>(
      "ai-presentation-cancel",
      ({ payload }) => pending.get(payload.id)?.abort(),
    );
  } catch (error) {
    disposed = true;
    stopRequests();
    for (const controller of pending.values()) controller.abort();
    throw error;
  }
  return () => {
    disposed = true;
    stopRequests();
    stopCancellation();
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
}
