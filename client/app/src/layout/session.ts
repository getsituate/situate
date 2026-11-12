import { shallowReactive } from "vue";
import { dictation, guardDictation } from "../dictation/runtime";
import { diagnosticsFor, type Context } from "../diagnostics";
import { layoutAction } from "../diagnostics/actions";
import {
  emptyLayout,
  reduceLayout,
  selectedTab,
  type LayoutIntent,
  type PaneAddress,
} from "./model";
import type { ViewTarget } from "./navigation";
import {
  decodeLayoutDocument,
  nativeLayoutStorage,
  persistedLayoutDocument,
  sameDocument,
  type LayoutDocument,
  type LayoutStorage,
} from "./storage";

export interface NavigationTicket {
  readonly workspaceId: string;
  readonly address: PaneAddress | null;
  readonly generation: number;
  readonly paneGeneration: number;
}

export function createLayoutSession(
  workspaceId: string,
  storage: LayoutStorage = nativeLayoutStorage,
  nextId: () => string = () => crypto.randomUUID(),
) {
  const state = shallowReactive<{
    document: LayoutDocument | null;
    loading: boolean;
    saving: boolean;
    dirty: boolean;
    error: unknown;
  }>({
    document: null,
    loading: false,
    saving: false,
    dirty: false,
    error: "",
  });
  let revision: string | null = null;
  let pluginIncarnations: Readonly<Record<string, string>> = {};
  let inventory: Readonly<Record<string, string>> | undefined;
  let generation = 0;
  let disposed = false;
  let loading: Promise<void> | undefined;
  let writing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failedWrite: LayoutDocument | undefined;
  const paneGenerations = new Map<string, number>();

  function schedule() {
    if (timer || state.error || disposed) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(() => {});
    }, 150);
  }
  async function load(): Promise<void> {
    if (disposed || state.document) return;
    if (loading) return loading;
    const request = generation;
    state.loading = true;
    state.error = "";
    loading = (async () => {
      try {
        const record = await storage.load(workspaceId);
        if (disposed || generation !== request) return;
        revision = record.revision;
        pluginIncarnations = record.pluginIncarnations ?? {};
        state.document =
          record.data === null
            ? {
                version: 1,
                layout: emptyLayout(),
                pinnedViews: ["files"],
              }
            : decodeLayoutDocument(record.data);
        state.dirty = record.data === null;
        if (inventory) synchronizePluginIncarnations(inventory);
        if (!state.document.layout.tabs.length) dispatch({ type: "new-tab" });
        if (state.dirty) schedule();
      } catch (error) {
        if (!disposed && generation === request) state.error = error;
      } finally {
        if (generation === request) {
          state.loading = false;
          loading = undefined;
        }
      }
    })();
    return loading;
  }
  function dispatch(intent: LayoutIntent, diagnostic?: Context): boolean {
    if (disposed || !state.document) return false;
    const layout = reduceLayout(state.document.layout, intent, nextId);
    if (layout === state.document.layout) return false;
    const owner = dictation.owner;
    if (owner?.scope === workspaceId && owner.phase !== "transcribing") {
      const tab = selectedTab(layout);
      const pane = tab?.panes.find((pane) => pane.id === tab.activePaneId);
      const target = pane?.navigation.entries[pane.navigation.cursor]?.target;
      const stays =
        (target?.kind === "conversation" ||
          target?.kind === "new-conversation") &&
        target.conversationId === owner.conversation;
      if (
        !stays &&
        !["retain-presentation", "resize", "rename-tab"].includes(intent.type)
      ) {
        const ticket = capture();
        void guardDictation(workspaceId).then((allowed) => {
          if (allowed && current(ticket)) dispatch(intent, diagnostic);
        });
        return false;
      }
    }
    const retained = new Set(
      layout.tabs.flatMap((tab) => tab.panes.map((pane) => pane.id)),
    );
    for (const tab of state.document.layout.tabs)
      for (const pane of tab.panes) {
        if (!retained.has(pane.id))
          paneGenerations.set(pane.id, (paneGenerations.get(pane.id) ?? 0) + 1);
      }
    state.document = { ...state.document, layout };
    if (intent.type !== "retain-presentation")
      diagnosticsFor(workspaceId).emit(
        "navigation.changed",
        "ui",
        { action: layoutAction(intent), component: "layout" },
        diagnostic,
        "trace",
      );
    state.dirty = true;
    schedule();
    return true;
  }
  function pin(viewId: string) {
    if (disposed || !state.document) return;
    const pins = state.document.pinnedViews;
    state.document = {
      ...state.document,
      pinnedViews: pins.includes(viewId)
        ? pins.filter((id) => id !== viewId)
        : [...pins, viewId],
    };
    state.dirty = true;
    schedule();
  }
  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    await loading;
    if (writing) {
      await writing;
      if (state.dirty) return flush();
      return;
    }
    if (disposed || !state.dirty) return;
    if (state.error) throw state.error;
    const request = generation;
    state.saving = true;
    writing = (async () => {
      while (state.dirty && state.document) {
        if (disposed || generation !== request) break;
        const document = state.document;
        const persisted = persistedLayoutDocument(document);
        try {
          const record = await storage.save(workspaceId, revision, persisted, {
            ...pluginIncarnations,
          });
          if (disposed || generation !== request) return;
          if (!record.revision || !record.data)
            throw new Error("layoutHost.saveFailed");
          revision = record.revision;
          state.dirty = state.document !== document;
          failedWrite = undefined;
        } catch (error) {
          if (!disposed && generation === request) {
            state.error = error;
            failedWrite = persisted;
          }
          throw error;
        }
      }
    })();
    try {
      await writing;
    } finally {
      if (generation === request) {
        writing = undefined;
        state.saving = false;
      }
    }
  }
  async function retry(): Promise<void> {
    if (disposed) return;
    if (!state.document) return load();
    if (writing) {
      try {
        await writing;
      } catch {
        /* Readback below resolves an uncertain save. */
      }
    }
    const request = generation;
    state.loading = true;
    try {
      const record = await storage.load(workspaceId);
      if (disposed || generation !== request) return;
      if (
        record.revision !== revision &&
        !sameDocument(record.data, failedWrite)
      )
        throw new Error("layoutHost.changedOnDisk");
      revision = record.revision;
      state.error = "";
      failedWrite = undefined;
      await flush();
    } catch (error) {
      if (!disposed && generation === request) state.error = error;
    } finally {
      if (generation === request) state.loading = false;
    }
  }
  async function reload(): Promise<void> {
    if (disposed || writing) return;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    generation++;
    state.document = null;
    state.dirty = false;
    state.error = "";
    failedWrite = undefined;
    loading = undefined;
    await load();
  }
  function capture(destination?: PaneAddress): NavigationTicket {
    const tab = state.document && selectedTab(state.document.layout);
    const address =
      destination ?? (tab ? { tabId: tab.id, paneId: tab.activePaneId } : null);
    return {
      workspaceId,
      address,
      generation,
      paneGeneration: address ? (paneGenerations.get(address.paneId) ?? 0) : 0,
    };
  }
  function current(ticket: NavigationTicket): boolean {
    if (
      disposed ||
      ticket.workspaceId !== workspaceId ||
      ticket.generation !== generation ||
      !state.document
    )
      return false;
    if (!ticket.address) return state.document.layout.tabs.length === 0;
    return (
      (paneGenerations.get(ticket.address.paneId) ?? 0) ===
        ticket.paneGeneration &&
      state.document.layout.tabs.some(
        (tab) =>
          tab.id === ticket.address!.tabId &&
          tab.panes.some((pane) => pane.id === ticket.address!.paneId),
      )
    );
  }
  function open(target: ViewTarget, ticket?: NavigationTicket): boolean {
    if (ticket && !current(ticket)) return false;
    return dispatch({
      type: "open",
      target,
      ...(ticket?.address ? { destination: ticket.address } : {}),
    });
  }
  function mapTargets(map: (target: ViewTarget) => ViewTarget): void {
    if (disposed || !state.document) return;
    const rewrite = (tab: LayoutDocument["layout"]["tabs"][number]) => {
      const conversationIds = new Set(tab.conversationIds);
      const panes = tab.panes.map((pane) => ({
        ...pane,
        navigation: {
          ...pane.navigation,
          entries: pane.navigation.entries.map((entry) => {
            const target = map(entry.target);
            if (target.kind === "conversation")
              conversationIds.add(target.conversationId);
            return {
              ...entry,
              target,
              presentation:
                entry.target.kind !== "empty" && target.kind === "empty"
                  ? null
                  : entry.presentation,
            };
          }),
        },
      }));
      return { ...tab, panes, conversationIds: [...conversationIds] };
    };
    const layout = state.document.layout;
    const document: LayoutDocument = {
      ...state.document,
      layout: {
        ...layout,
        tabs: layout.tabs.map(rewrite),
        closedTabs: layout.closedTabs.map((closed) => ({
          ...closed,
          tab: rewrite(closed.tab),
        })),
      },
    };
    if (sameDocument(document, state.document)) return;
    state.document = document;
    state.dirty = true;
    schedule();
  }
  function retainPluginViews(installedIds: readonly string[]) {
    if (disposed || !state.document) return;
    const installed = new Set(installedIds);
    const present = (viewId: string) =>
      !viewId.includes(":") || installed.has(viewId.split(":")[0]!);
    mapTargets((target) =>
      target.kind === "view" && !present(target.viewId)
        ? { kind: "empty" }
        : target,
    );
    const pins = state.document.pinnedViews.filter(present);
    if (pins.length !== state.document.pinnedViews.length) {
      state.document = { ...state.document, pinnedViews: pins };
      state.dirty = true;
      schedule();
    }
  }
  function synchronizePluginIncarnations(
    current: Readonly<Record<string, string>>,
  ) {
    inventory = { ...current };
    if (!state.document) return;
    retainPluginViews(
      Object.keys(current).filter(
        (id) => pluginIncarnations[id] === current[id],
      ),
    );
    pluginIncarnations = inventory;
  }
  function dispose() {
    disposed = true;
    generation++;
    if (timer) clearTimeout(timer);
    timer = undefined;
  }
  return {
    workspaceId,
    state,
    load,
    dispatch,
    pin,
    flush,
    retry,
    reload,
    capture,
    current,
    open,
    mapTargets,
    retainPluginViews,
    synchronizePluginIncarnations,
    dispose,
  };
}
export type LayoutSession = ReturnType<typeof createLayoutSession>;
const sessions = new Map<string, LayoutSession>();
export function workspaceLayout(workspaceId: string): LayoutSession {
  let session = sessions.get(workspaceId);
  if (!session) {
    session = createLayoutSession(workspaceId);
    sessions.set(workspaceId, session);
  }
  return session;
}
export async function flushLayouts(workspaceId?: string): Promise<void> {
  for (const [id, session] of sessions)
    if (!workspaceId || id === workspaceId) await session.flush();
}
export function retainLayouts(workspaceIds: readonly string[]): void {
  for (const [id, session] of sessions)
    if (!workspaceIds.includes(id)) {
      session.dispose();
      sessions.delete(id);
    }
}
