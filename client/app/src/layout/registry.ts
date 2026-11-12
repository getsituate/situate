import { markRaw, shallowReactive, type Component } from "vue";
import type { IconName } from "@situate/ui";
import { pluginMayExecute } from "../recovery";
import {
  sameTarget,
  type PresentationValue,
  type ViewTarget,
} from "./navigation";
import type { LayoutSession, NavigationTicket } from "./session";
import { decodeTarget } from "./storage";
import type { LayoutIntent } from "./model";
import { dictation, guardDictation } from "../dictation/runtime";

export interface ViewDefinition {
  readonly id: string;
  readonly title: () => string;
  readonly icon: IconName;
  readonly component: Component;
  readonly reveal?: (
    contentId: string,
    revision?: string,
  ) => Promise<PresentationValue> | PresentationValue;
}
export interface PluginViews {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly views: readonly ViewDefinition[];
}
export function viewType(target: ViewTarget): string {
  return target.kind === "conversation" || target.kind === "new-conversation"
    ? "conversation"
    : target.kind === "empty"
      ? "empty"
      : target.viewId;
}
export function createViewRegistry(scope = "") {
  const state = shallowReactive({
    definitions: shallowReactive(new Map<string, ViewDefinition>()),
  });
  const owners = new Map<string, string>();
  let recovery = false;
  function register(definition: ViewDefinition, owner?: string): () => void {
    if (state.definitions.has(definition.id))
      throw new Error("layoutHost.duplicateView");
    const installed = {
      ...definition,
      component: markRaw(definition.component),
    };
    state.definitions.set(definition.id, installed);
    if (owner) owners.set(definition.id, owner);
    return () => {
      if (state.definitions.get(definition.id) === installed) {
        state.definitions.delete(definition.id);
        owners.delete(definition.id);
      }
    };
  }
  function removePlugin(pluginId: string) {
    for (const [id, owner] of owners)
      if (owner === pluginId) {
        state.definitions.delete(id);
        owners.delete(id);
      }
  }
  function registerPlugin(plugin: PluginViews): () => void {
    if (
      !pluginMayExecute(scope, plugin.pluginId) ||
      recovery ||
      !plugin.enabled
    )
      throw new Error("layoutHost.pluginUnavailable");
    if (
      !plugin.pluginId ||
      plugin.views.some(
        (view) =>
          !view.id.startsWith(`${plugin.pluginId}:`) ||
          state.definitions.has(view.id),
      ) ||
      new Set(plugin.views.map((view) => view.id)).size !== plugin.views.length
    )
      throw new Error("layoutHost.duplicateView");
    const release = plugin.views.map((view) => register(view, plugin.pluginId));
    return () => release.forEach((dispose) => dispose());
  }
  function setRecovery(value: boolean) {
    recovery = value;
    if (value)
      for (const owner of new Set(owners.values())) removePlugin(owner);
  }
  function preparePluginBatch(
    ids: ReadonlySet<string>,
    plugins: readonly PluginViews[],
  ) {
    const next = new Map(state.definitions);
    const nextOwners = new Map(owners);
    for (const [id, owner] of nextOwners)
      if (ids.has(owner)) {
        next.delete(id);
        nextOwners.delete(id);
      }
    for (const plugin of plugins) {
      if (
        !pluginMayExecute(scope, plugin.pluginId) ||
        recovery ||
        !plugin.enabled
      )
        throw new Error("layoutHost.pluginUnavailable");
      for (const view of plugin.views) {
        if (!view.id.startsWith(`${plugin.pluginId}:`) || next.has(view.id))
          throw new Error("layoutHost.duplicateView");
        next.set(view.id, { ...view, component: markRaw(view.component) });
        nextOwners.set(view.id, plugin.pluginId);
      }
    }
    return () => {
      owners.clear();
      for (const [id, owner] of nextOwners) owners.set(id, owner);
      state.definitions = shallowReactive(next);
    };
  }
  return {
    get definitions() {
      return state.definitions;
    },
    register,
    registerPlugin,
    removePlugin,
    preparePluginBatch,
    replacePlugins: (
      ids: ReadonlySet<string>,
      plugins: readonly PluginViews[],
    ) => preparePluginBatch(ids, plugins)(),
    setRecovery,
  };
}
export type ViewRegistry = ReturnType<typeof createViewRegistry>;

export interface NavigationGuard {
  readonly signal?: AbortSignal;
  readonly isCurrent?: () => boolean;
}
import type { Context } from "../diagnostics";

function checkGuard(guard?: NavigationGuard): void {
  guard?.signal?.throwIfAborted();
  if (guard?.isCurrent && !guard.isCurrent())
    throw new Error("layoutHost.workspaceUnavailable");
}

export function createUiCoordinator(
  session: LayoutSession,
  registry: ViewRegistry,
) {
  function commit(
    target: ViewTarget,
    ticket?: NavigationTicket,
    presentation?: PresentationValue,
  ): boolean {
    if (ticket && !session.current(ticket)) return false;
    const changed = session.open(target, ticket);
    const destination = ticket?.address ?? session.capture().address;
    if (presentation !== undefined && destination) {
      const tab = session.state.document?.layout.tabs.find(
        (tab) => tab.id === destination.tabId,
      );
      const pane = tab?.panes.find((pane) => pane.id === destination.paneId);
      const entry = pane?.navigation.entries[pane.navigation.cursor];
      if (entry && sameTarget(entry.target, target))
        session.dispatch({
          type: "retain-presentation",
          ...destination,
          entryId: entry.id,
          presentation,
        });
    }
    return changed;
  }
  async function open(
    target: ViewTarget,
    ticket?: NavigationTicket,
    guard?: NavigationGuard,
    presentation?: PresentationValue,
  ): Promise<boolean> {
    checkGuard(guard);
    target = decodeTarget(target);
    const definition = registry.definitions.get(viewType(target));
    if (target.kind !== "empty" && !definition)
      throw new Error("layoutHost.viewUnavailable");
    await session.load();
    checkGuard(guard);
    if (
      target.kind !== "empty" &&
      registry.definitions.get(viewType(target)) !== definition
    )
      return false;
    if (
      ((target.kind !== "conversation" && target.kind !== "new-conversation") ||
        target.conversationId !== dictation.owner?.conversation) &&
      !(await guardDictation(session.workspaceId))
    )
      return false;
    checkGuard(guard);
    return commit(target, ticket, presentation);
  }
  async function reveal(
    viewId: string,
    contentId: string,
    revision?: string,
    guard?: NavigationGuard,
  ): Promise<boolean> {
    checkGuard(guard);
    const target = decodeTarget({
      kind: "view",
      viewId,
      contentId,
      ...(revision === undefined ? {} : { revision }),
    });
    await session.load();
    checkGuard(guard);
    const definition = registry.definitions.get(viewId);
    if (!definition) throw new Error("layoutHost.viewUnavailable");
    const ticket = session.capture();
    const presentation = await definition.reveal?.(contentId, revision);
    checkGuard(guard);
    if (
      registry.definitions.get(viewId) !== definition ||
      !session.current(ticket)
    )
      return false;
    if (!(await guardDictation(session.workspaceId))) return false;
    checkGuard(guard);
    return commit(target, ticket, presentation);
  }
  function dispatch(intent: LayoutIntent, diagnostic?: Context): boolean {
    if (intent.type === "open")
      return session.dispatch(
        {
          ...intent,
          target: decodeTarget(intent.target),
        },
        diagnostic,
      );
    return session.dispatch(intent, diagnostic);
  }
  return { workspaceId: session.workspaceId, open, reveal, dispatch };
}
export type UiCoordinator = ReturnType<typeof createUiCoordinator>;
const coordinators = new Map<string, UiCoordinator>();
export function bindCoordinator(coordinator: UiCoordinator): () => void {
  coordinators.set(coordinator.workspaceId, coordinator);
  return () => {
    if (coordinators.get(coordinator.workspaceId) === coordinator)
      coordinators.delete(coordinator.workspaceId);
  };
}
export function workspaceCoordinator(
  workspaceId: string,
): UiCoordinator | undefined {
  return coordinators.get(workspaceId);
}
