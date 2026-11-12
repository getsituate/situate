import {
  currentEntry,
  retainPresentation,
  sameTarget,
  traverse,
  visit,
  type NavigationEntry,
  type PaneNavigation,
  type PresentationValue,
  type ViewTarget,
} from "./navigation";
import {
  insertPane,
  paneOrder,
  removePane,
  resizeSplit,
  type LayoutNode,
  type PaneEdge,
} from "./tree";

export interface Pane {
  readonly id: string;
  readonly navigation: PaneNavigation;
}

export interface TopicTab {
  readonly id: string;
  readonly name: string;
  readonly layout: LayoutNode;
  readonly panes: readonly Pane[];
  readonly activePaneId: string;
  readonly maximizedPaneId: string | null;
  readonly conversationIds: readonly string[];
}

export interface LayoutState {
  readonly tabs: readonly TopicTab[];
  readonly activeTabId: string | null;
  readonly closedTabs: readonly {
    readonly tab: TopicTab;
    readonly index: number;
  }[];
}

export interface PaneAddress {
  readonly tabId: string;
  readonly paneId: string;
}

export type LayoutIntent =
  | { readonly type: "new-tab" }
  | { readonly type: "select-tab"; readonly tabId: string }
  | {
      readonly type: "rename-tab";
      readonly tabId: string;
      readonly name: string;
    }
  | { readonly type: "close-tab"; readonly tabId: string }
  | { readonly type: "close-all-tabs" }
  | { readonly type: "close-other-tabs"; readonly tabId: string }
  | { readonly type: "reopen-tab" }
  | ({ readonly type: "select-pane" } & PaneAddress)
  | {
      readonly type: "open";
      readonly target: ViewTarget;
      readonly destination?: PaneAddress;
    }
  | ({ readonly type: "history"; readonly delta: -1 | 1 } & PaneAddress)
  | ({
      readonly type: "retain-presentation";
      readonly entryId: string;
      readonly presentation: PresentationValue;
    } & PaneAddress)
  | ({ readonly type: "split"; readonly edge: PaneEdge } & PaneAddress)
  | ({
      readonly type: "move";
      readonly targetPaneId: string;
      readonly edge: PaneEdge;
    } & PaneAddress)
  | {
      readonly type: "resize";
      readonly tabId: string;
      readonly splitId: string;
      readonly ratio: number;
    }
  | ({ readonly type: "maximize" } & PaneAddress)
  | ({ readonly type: "close-pane" } & PaneAddress);

export function emptyLayout(): LayoutState {
  return { tabs: [], activeTabId: null, closedTabs: [] };
}

export function selectedTab(state: LayoutState): TopicTab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

export function tabTitle(
  tab: TopicTab,
  titleFor: (target: ViewTarget) => string,
): string {
  const first = paneOrder(tab.layout)[0];
  const pane = tab.panes.find((item) => item.id === first)!;
  return tab.name || titleFor(currentEntry(pane.navigation).target);
}

export function tabHasActivity(
  tab: TopicTab,
  isRunning: (conversationId: string) => boolean,
): boolean {
  return tab.panes.some((pane) => {
    const target = currentEntry(pane.navigation).target;
    return target.kind === "conversation" && isRunning(target.conversationId);
  });
}

function updateTab(
  state: LayoutState,
  tabId: string,
  update: (tab: TopicTab) => TopicTab,
): LayoutState {
  const previous = state.tabs.find((tab) => tab.id === tabId);
  if (!previous) return state;
  const next = update(previous);
  return next === previous
    ? state
    : {
        ...state,
        tabs: state.tabs.map((tab) => (tab === previous ? next : tab)),
      };
}

function updatePane(tab: TopicTab, pane: Pane): TopicTab {
  return {
    ...tab,
    panes: tab.panes.map((item) => (item.id === pane.id ? pane : item)),
  };
}

function associateConversation(tab: TopicTab, target: ViewTarget): TopicTab {
  if (
    target.kind !== "conversation" ||
    tab.conversationIds.includes(target.conversationId)
  )
    return tab;
  return {
    ...tab,
    conversationIds: [...tab.conversationIds, target.conversationId],
  };
}

function focusPane(tab: TopicTab, paneId: string): TopicTab {
  if (tab.activePaneId === paneId) return tab;
  return {
    ...tab,
    activePaneId: paneId,
    maximizedPaneId: tab.maximizedPaneId ? paneId : null,
  };
}

function activate(state: LayoutState, address: PaneAddress): LayoutState {
  const tab = state.tabs.find((item) => item.id === address.tabId);
  if (!tab?.panes.some((pane) => pane.id === address.paneId)) return state;
  const focused = updateTab(state, tab.id, (item) =>
    focusPane(item, address.paneId),
  );
  return focused.activeTabId === tab.id
    ? focused
    : { ...focused, activeTabId: tab.id };
}

function openConversation(
  state: LayoutState,
  conversationId: string,
): PaneAddress | undefined {
  const active = selectedTab(state);
  const tabs = active
    ? [active, ...state.tabs.filter((tab) => tab !== active)]
    : state.tabs;
  for (const tab of tabs) {
    const order = paneOrder(tab.layout);
    const panes =
      tab === active
        ? [tab.activePaneId, ...order.filter((id) => id !== tab.activePaneId)]
        : order;
    for (const paneId of panes) {
      const pane = tab.panes.find((item) => item.id === paneId)!;
      const target = currentEntry(pane.navigation).target;
      if (
        target.kind === "conversation" &&
        target.conversationId === conversationId
      )
        return { tabId: tab.id, paneId };
    }
  }
  return undefined;
}

function entry(target: ViewTarget, nextId: () => string): NavigationEntry {
  return { id: nextId(), target, presentation: null };
}

function createPane(target: ViewTarget, nextId: () => string): Pane {
  return {
    id: nextId(),
    navigation: { entries: [entry(target, nextId)], cursor: 0 },
  };
}

function addTab(
  state: LayoutState,
  target: ViewTarget,
  nextId: () => string,
): LayoutState {
  const id = nextId();
  const pane = createPane(target, nextId);
  const tab: TopicTab = {
    id,
    name: "",
    layout: { kind: "pane", id: pane.id },
    panes: [pane],
    activePaneId: pane.id,
    maximizedPaneId: null,
    conversationIds:
      target.kind === "conversation" ? [target.conversationId] : [],
  };
  return { ...state, tabs: [...state.tabs, tab], activeTabId: id };
}

/**
 * The owner supplies fresh IDs and cancels effects on closure, even if a tab is reopened.
 * This reducer checks address existence, not the lifetime of asynchronous callers.
 */
export function reduceLayout(
  state: LayoutState,
  intent: LayoutIntent,
  nextId: () => string,
): LayoutState {
  switch (intent.type) {
    case "new-tab":
      return addTab(state, { kind: "empty" }, nextId);
    case "select-tab":
      return state.tabs.some((tab) => tab.id === intent.tabId) &&
        state.activeTabId !== intent.tabId
        ? { ...state, activeTabId: intent.tabId }
        : state;
    case "rename-tab":
      return updateTab(state, intent.tabId, (tab) =>
        tab.name === intent.name.trim()
          ? tab
          : { ...tab, name: intent.name.trim() },
      );
    case "close-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === intent.tabId);
      const tab = state.tabs[index];
      if (!tab) return state;
      const tabs = state.tabs.filter((item) => item !== tab);
      const closed: LayoutState = {
        ...state,
        tabs,
        activeTabId:
          state.activeTabId === tab.id
            ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
            : state.activeTabId,
        closedTabs: [...state.closedTabs, { tab, index }],
      };
      return tabs.length ? closed : addTab(closed, { kind: "empty" }, nextId);
    }
    case "close-all-tabs":
    case "close-other-tabs": {
      if (intent.type === "close-all-tabs" && !state.tabs.length)
        return addTab(state, { kind: "empty" }, nextId);
      const keep = intent.type === "close-other-tabs" ? intent.tabId : null;
      if (keep !== null && !state.tabs.some((tab) => tab.id === keep))
        return state;
      return [...state.tabs]
        .reverse()
        .reduce(
          (remaining, tab) =>
            tab.id === keep
              ? remaining
              : reduceLayout(
                  remaining,
                  { type: "close-tab", tabId: tab.id },
                  nextId,
                ),
          state,
        );
    }
    case "reopen-tab": {
      const closed = state.closedTabs.at(-1);
      if (!closed) return state;
      const tabs = [...state.tabs];
      tabs.splice(closed.index, 0, closed.tab);
      return {
        ...state,
        tabs,
        activeTabId: closed.tab.id,
        closedTabs: state.closedTabs.slice(0, -1),
      };
    }
    case "select-pane":
      return activate(state, intent);
    case "open": {
      if (
        intent.destination &&
        !state.tabs.some(
          (tab) =>
            tab.id === intent.destination!.tabId &&
            tab.panes.some((pane) => pane.id === intent.destination!.paneId),
        )
      )
        return state;
      if (intent.target.kind === "conversation") {
        const found = openConversation(state, intent.target.conversationId);
        if (found) return activate(state, found);
      }
      const tab = intent.destination
        ? state.tabs.find((item) => item.id === intent.destination!.tabId)
        : selectedTab(state);
      if (!tab) return addTab(state, intent.target, nextId);
      const paneId = intent.destination?.paneId ?? tab.activePaneId;
      const pane = tab.panes.find((item) => item.id === paneId)!;
      const opened = sameTarget(
        currentEntry(pane.navigation).target,
        intent.target,
      )
        ? state
        : updateTab(state, tab.id, (item) =>
            associateConversation(
              updatePane(item, {
                ...pane,
                navigation: visit(
                  pane.navigation,
                  entry(intent.target, nextId),
                ),
              }),
              intent.target,
            ),
          );
      return activate(opened, { tabId: tab.id, paneId });
    }
    case "resize":
      return updateTab(state, intent.tabId, (tab) => {
        const layout = resizeSplit(tab.layout, intent.splitId, intent.ratio);
        return layout === tab.layout ? tab : { ...tab, layout };
      });
    default:
      return updateTab(state, intent.tabId, (tab) => {
        const pane = tab.panes.find((item) => item.id === intent.paneId);
        if (!pane) return tab;
        switch (intent.type) {
          case "history": {
            const navigation = traverse(pane.navigation, intent.delta);
            return navigation === pane.navigation
              ? tab
              : associateConversation(
                  updatePane(tab, { ...pane, navigation }),
                  currentEntry(navigation).target,
                );
          }
          case "retain-presentation": {
            const navigation = retainPresentation(
              pane.navigation,
              intent.entryId,
              intent.presentation,
            );
            return navigation === pane.navigation
              ? tab
              : updatePane(tab, { ...pane, navigation });
          }
          case "split": {
            const added = createPane({ kind: "empty" }, nextId);
            return {
              ...tab,
              layout: insertPane(
                tab.layout,
                pane.id,
                added.id,
                intent.edge,
                nextId(),
              ),
              panes: [...tab.panes, added],
              activePaneId: added.id,
              maximizedPaneId: null,
            };
          }
          case "move": {
            if (
              pane.id === intent.targetPaneId ||
              !tab.panes.some((item) => item.id === intent.targetPaneId)
            )
              return tab;
            const remaining = removePane(tab.layout, pane.id)!;
            return {
              ...tab,
              layout: insertPane(
                remaining,
                intent.targetPaneId,
                pane.id,
                intent.edge,
                nextId(),
              ),
              activePaneId: pane.id,
              maximizedPaneId: null,
            };
          }
          case "maximize":
            return {
              ...tab,
              activePaneId: pane.id,
              maximizedPaneId: tab.maximizedPaneId === pane.id ? null : pane.id,
            };
          case "close-pane": {
            const layout = removePane(tab.layout, pane.id);
            if (!layout) {
              const empty = createPane({ kind: "empty" }, nextId);
              return {
                ...tab,
                layout: { kind: "pane", id: empty.id },
                panes: [empty],
                activePaneId: empty.id,
                maximizedPaneId: null,
              };
            }
            const activePaneId =
              tab.activePaneId === pane.id
                ? paneOrder(layout)[0]!
                : tab.activePaneId;
            return {
              ...tab,
              layout,
              panes: tab.panes.filter((item) => item !== pane),
              activePaneId,
              maximizedPaneId:
                tab.maximizedPaneId === pane.id ? null : tab.maximizedPaneId,
            };
          }
        }
      });
  }
}
