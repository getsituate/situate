import { t } from "@situate/localization";
import { isTauri } from "@tauri-apps/api/core";
import { defineAsyncComponent, watchEffect } from "vue";

const FileEditor = defineAsyncComponent(
  () => import("../files/FileEditor.vue"),
);
const ChatPane = defineAsyncComponent(
  () => import("../components/ChatPane.vue"),
);
import {
  discardUnsentChat,
  workspaceChat,
  workspaceConversations,
} from "../ai/chat";
import {
  bindCoordinator,
  createUiCoordinator,
  createViewRegistry,
} from "./registry";
import { retainLayouts, workspaceLayout } from "./session";
import { currentEntry, type ViewTarget } from "./navigation";

function createWorkspaceUi(workspaceId: string) {
  const session = workspaceLayout(workspaceId);
  const registry = createViewRegistry(workspaceId);
  registry.register({
    id: "files",
    title: () => t("navigation.files"),
    icon: "folder",
    component: FileEditor,
  });
  registry.register({
    id: "conversation",
    title: () => t("navigation.newChat"),
    icon: "chat",
    component: ChatPane,
  });
  const coordinator = createUiCoordinator(session, registry);
  const unbind = bindCoordinator(coordinator);
  let previous = new Set<string>();
  const abandoned = new Set<string>();
  const stopChats = watchEffect(() => {
    const durable = new Set(
      workspaceConversations(workspaceId).state.conversations.map(
        (item) => item.id,
      ),
    );
    const layout = session.state.document?.layout;
    const currentIds = new Set(
      layout?.tabs.flatMap((tab) =>
        tab.panes.flatMap((pane) => {
          const target = currentEntry(pane.navigation).target;
          return target.kind === "new-conversation"
            ? [target.conversationId]
            : [];
        }),
      ),
    );
    for (const id of previous) if (!currentIds.has(id)) abandoned.add(id);
    previous = currentIds;
    const discarded = new Set<string>();
    for (const id of abandoned) {
      if (currentIds.has(id) || durable.has(id)) {
        abandoned.delete(id);
        continue;
      }
      const chat = workspaceChat(workspaceId, id).state;
      if (!chat.ephemeral) {
        abandoned.delete(id);
        continue;
      }
      if (chat.running || chat.unsaved) continue;
      if (discardUnsentChat(workspaceId, id)) {
        discarded.add(id);
        abandoned.delete(id);
      }
    }
    session.mapTargets((target) => {
      if (target.kind !== "new-conversation") return target;
      if (durable.has(target.conversationId))
        return { kind: "conversation", conversationId: target.conversationId };
      return discarded.has(target.conversationId) ? { kind: "empty" } : target;
    });
  });
  let current = true;
  let inventoryTimer: ReturnType<typeof setInterval> | undefined;
  let stopPluginLayout: (() => void) | undefined;
  const plugins = isTauri()
    ? import("../plugins/runtime").then(({ createPluginRuntime }) => {
        if (!current) return undefined;
        const runtime = createPluginRuntime({
          scope: workspaceId,
          registry,
          coordinator,
          isCurrent: () => current,
        });
        inventoryTimer = setInterval(() => {
          void runtime.synchronizeInventory().catch(() => undefined);
        }, 2000);
        let installations = new Map<string, string | undefined>();
        stopPluginLayout = watchEffect(() => {
          if (runtime.state.status !== "ready") return;
          const plugins = runtime.state.plugins;
          const retained = plugins
            .filter(
              (plugin) =>
                !installations.has(plugin.id) ||
                installations.get(plugin.id) === plugin.incarnation,
            )
            .map((plugin) => plugin.id);
          installations = new Map(
            plugins.map((plugin) => [plugin.id, plugin.incarnation]),
          );
          session.retainPluginViews(retained);
          session.synchronizePluginIncarnations(
            Object.fromEntries(
              plugins.flatMap((plugin) =>
                plugin.incarnation ? [[plugin.id, plugin.incarnation]] : [],
              ),
            ),
          );
        });
        return runtime;
      })
    : undefined;
  void plugins?.catch(() => undefined);
  function titleFor(target: ViewTarget): string {
    if (target.kind === "empty") return t("layoutHost.newTab");
    if (target.kind === "new-conversation") return t("navigation.newChat");
    if (target.kind === "conversation")
      return (
        workspaceConversations(workspaceId).state.conversations.find(
          (item) => item.id === target.conversationId,
        )?.title || t("navigation.newChat")
      );
    if (target.viewId === "files" && target.contentId)
      return target.contentId.split("/").at(-1)!;
    return (
      registry.definitions.get(target.viewId)?.title() ??
      t("layoutHost.viewUnavailable")
    );
  }
  return {
    session,
    registry,
    coordinator,
    plugins,
    titleFor,
    dispose() {
      current = false;
      if (inventoryTimer) clearInterval(inventoryTimer);
      stopPluginLayout?.();
      stopChats();
      void plugins
        ?.then((runtime) => runtime?.dispose())
        .catch(() => undefined);
      unbind();
    },
  };
}
export type WorkspaceUi = ReturnType<typeof createWorkspaceUi>;
const workspaces = new Map<string, WorkspaceUi>();
export function workspaceUi(workspaceId: string): WorkspaceUi {
  let ui = workspaces.get(workspaceId);
  if (!ui) {
    ui = createWorkspaceUi(workspaceId);
    workspaces.set(workspaceId, ui);
  }
  return ui;
}
export function workspacePlugins(workspaceId: string) {
  return workspaces.get(workspaceId)?.plugins;
}
export function retainWorkspaceUi(workspaceIds: readonly string[]): void {
  for (const [id, ui] of workspaces)
    if (!workspaceIds.includes(id)) {
      ui.dispose();
      workspaces.delete(id);
    }
  retainLayouts(workspaceIds);
}
