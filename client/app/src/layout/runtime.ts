import { t } from "@situate/localization";
import { isTauri } from "@tauri-apps/api/core";
import { defineAsyncComponent, shallowRef, watchEffect } from "vue";
import type { PluginRuntime } from "../plugins/runtime";

const FileEditor = defineAsyncComponent(
  () => import("../files/FileEditor.vue"),
);
const ChatPane = defineAsyncComponent(
  () => import("../components/ChatPane.vue"),
);
const SettingsView = defineAsyncComponent(
  () => import("../settings/SettingsView.vue"),
);
const PluginManagement = defineAsyncComponent(
  () => import("../plugins/PluginManagement.vue"),
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
  resolveViewTarget,
} from "./registry";
import { retainLayouts, workspaceLayout } from "./session";
import type { ViewTarget } from "./navigation";
import { createWorkspaceShortcuts } from "./workspace-shortcuts";

function createWorkspaceUi(workspaceId: string) {
  const session = workspaceLayout(workspaceId);
  const shortcuts = createWorkspaceShortcuts(workspaceId);
  const registry = createViewRegistry(workspaceId);
  registry.register({
    id: "files",
    title: () => t("navigation.files"),
    icon: "folder",
    component: FileEditor,
  });
  registry.register({
    id: "settings",
    title: () => t("navigation.settings"),
    icon: "settings",
    component: SettingsView,
  });
  registry.register({
    id: "plugins",
    title: () => t("navigation.plugins"),
    icon: "plugins",
    component: PluginManagement,
  });
  registry.register({
    id: "conversation",
    title: () => t("navigation.newChat"),
    icon: "chat",
    component: ChatPane,
    availability(target) {
      if (target.kind !== "conversation") return { status: "ready" };
      const inventory = workspaceConversations(workspaceId);
      if (
        inventory.state.conversations.some(
          (item) => item.id === target.conversationId,
        )
      )
        return { status: "ready" };
      if (inventory.state.loaded) return { status: "missing" };
      if (inventory.state.error)
        return {
          status: "error",
          error: inventory.state.error,
          retry: () => inventory.refresh(),
        };
      return { status: "loading" };
    },
  });
  const coordinator = createUiCoordinator(session, registry);
  const unbind = bindCoordinator(coordinator);
  let previous = new Set<string>();
  const abandoned = new Set<string>();
  const stopChats = watchEffect(() => {
    const { conversations, deletedConversationIds } =
      workspaceConversations(workspaceId).state;
    session.forgetConversations(deletedConversationIds);
    const durable = new Set(conversations.map((item) => item.id));
    const layout = session.state.document?.layout;
    const currentIds = new Set(
      layout?.tabs.flatMap((tab) =>
        tab.panes.flatMap((pane) => {
          const { entries, cursor } = pane.navigation;
          return entries.flatMap(({ target }, index) => {
            if (target.kind !== "new-conversation") return [];
            const next = entries[index + 1]?.target;
            // An unpublished draft remains reachable after a detour into management.
            return index === cursor ||
              (next?.kind === "view" &&
                ["settings", "plugins"].includes(next.viewId))
              ? [target.conversationId]
              : [];
          });
        }),
      ),
    );
    for (const id of previous) if (!currentIds.has(id)) abandoned.add(id);
    previous = currentIds;
    const discarded = new Set<string>();
    for (const id of abandoned) {
      if (
        currentIds.has(id) ||
        durable.has(id) ||
        deletedConversationIds.has(id)
      ) {
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
  const pluginRuntime = shallowRef<PluginRuntime>();
  let inventoryTimer: ReturnType<typeof setInterval> | undefined;
  let stopPluginLayout: (() => void) | undefined;
  const plugins = isTauri()
    ? import("../plugins/runtime").then(({ createPluginRuntime }) => {
        if (!current) return undefined;
        const runtime = createPluginRuntime({
          scope: workspaceId,
          registry,
          coordinator,
          shortcuts,
          isCurrent: () => current,
        });
        pluginRuntime.value = runtime;
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
    if (
      target.kind === "empty" ||
      resolveViewTarget(target, registry, pluginRuntime.value?.state.plugins)
        .status === "missing"
    )
      return t("layoutHost.newTab");
    if (target.kind === "new-conversation") return t("navigation.newChat");
    if (target.kind === "conversation") {
      const inventory = workspaceConversations(workspaceId).state;
      const conversation = inventory.conversations.find(
        (item) => item.id === target.conversationId,
      );
      return conversation
        ? conversation.title || t("navigation.newChat")
        : t("layoutHost.conversation");
    }
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
    shortcuts,
    plugins,
    titleFor,
    dispose() {
      current = false;
      shortcuts.stop();
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
