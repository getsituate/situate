import copy from "../localization/en.tabs.json" with { type: "json" };
import { createChatState, type ChatRun } from "../chat/model";
import { greetings } from "../navigation/greetings";
import {
  chatGuard,
  choiceGuard,
  resolvedModelId,
  cloneAiState,
  currentWorkspace,
  type AiState,
} from "../ai/model";
import {
  validThinkingSelection,
  selectedThinking,
  thinkingKey,
  type ThinkingChoices,
  type ThinkingSelection,
} from "../chat/thinking";

export type PinnedView =
  | "day"
  | "calendar"
  | "tasks"
  | "notes"
  | "reading"
  | "documents"
  | "review"
  | "files";
export type View = "empty" | "note" | "chat" | "views" | PinnedView;
export type ViewTarget = View | `conversation:${string}`;
export interface Conversation {
  id: string;
  title: string;
  draft: string;
  activity: "working" | "ready";
  tabIds: string[];
  messages: string[];
  archived: boolean;
  greeting: string;
  ai: AiState;
  thinking: ThinkingChoices;
  run: ChatRun | null;
}
function conversationPresentation(index = 0) {
  const { ai, thinking } = createChatState("chat-complete");
  return {
    ai,
    thinking,
    run: null,
    greeting: greetings[index % greetings.length]!,
  };
}
function setActivity(
  conversation: Conversation,
  value: Conversation["activity"],
) {
  if (
    value === "working" &&
    (conversation.activity === "working" || chatGuard(conversation.ai))
  )
    return;
  conversation.run =
    value === "working"
      ? {
          connection:
            currentWorkspace(conversation.ai).connection?.id ??
            currentWorkspace(conversation.ai).connection?.provider ??
            null,
          model: resolvedModelId(conversation.ai),
          thinking: selectedThinking(conversation.ai, conversation.thinking),
        }
      : null;
  conversation.activity = value;
  currentWorkspace(conversation.ai).response =
    value === "working" ? "streaming" : "idle";
}
export type Edge = "left" | "right" | "top" | "bottom";
export type Availability = "ready" | "loading" | "unavailable";
export interface Pane {
  id: string;
  history: ViewTarget[];
  cursor: number;
  availability: Availability;
}
export type Layout =
  | { kind: "pane"; id: string }
  | {
      kind: "split";
      id: string;
      axis: "row" | "column";
      ratio: number;
      first: Layout;
      second: Layout;
    };
export interface TopicTab {
  id: string;
  name: string;
  layout: Layout;
  panes: Record<string, Pane>;
  active: string;
  maximized: string | null;
}
export interface TabsState {
  tabs: TopicTab[];
  closedTabs: TopicTab[];
  active: string;
  next: number;
  pinnedViews: PinnedView[];
  conversations: Record<string, Conversation>;
  completed: number[];
  dashboardCompleted: boolean[];
}
export type TabsAction =
  | { type: "new-tab" }
  | { type: "reopen-tab" }
  | { type: "select-tab"; id: string }
  | { type: "rename-tab"; id: string; name: string }
  | { type: "close-tab"; id: string }
  | { type: "close-other-tabs"; id: string }
  | { type: "close-all-tabs" }
  | { type: "select-pane"; id: string }
  | { type: "open"; id: string; view: ViewTarget }
  | { type: "navigate"; view: ViewTarget }
  | { type: "new-conversation"; id?: string }
  | { type: "pin-view"; view: PinnedView }
  | { type: "archive-conversation"; id: string }
  | { type: "rename-conversation"; id: string; title: string }
  | { type: "send"; id: string }
  | { type: "conversation-ai"; id: string; value: AiState }
  | { type: "conversation-thinking"; id: string; value: ThinkingSelection }
  | { type: "history"; id: string; delta: -1 | 1 }
  | { type: "split"; id: string; edge: Edge }
  | { type: "move"; id: string; target: string; edge: Edge }
  | { type: "resize"; id: string; ratio: number }
  | { type: "maximize"; id: string }
  | { type: "close-pane"; id: string }
  | { type: "availability"; value: Availability }
  | { type: "draft"; id: string; value: string }
  | { type: "task"; index: number }
  | { type: "dashboard-task"; index: number }
  | { type: "activity"; id: string; value: Conversation["activity"] };

export const tabScenarios = [
  {
    id: "tabs-move-pane",
    label: "Move pane · touch controls",
    group: "Tabs and panes",
  },
  {
    id: "tabs-maximized",
    label: "Maximized pane · navigation",
    group: "Tabs and panes",
  },
  {
    id: "tabs-maximized-many",
    label: "Maximized pane · many long labels",
    group: "Tabs and panes",
  },
  {
    id: "tabs-overview",
    label: "Topic with three panes",
    group: "Tabs and panes",
  },
  {
    id: "tabs-single-topic",
    label: "One tab with three panes",
    group: "Tabs and panes",
  },
  {
    id: "tabs-multiple-topics",
    label: "Multiple tabs with one pane",
    group: "Tabs and panes",
  },
  { id: "tabs-empty", label: "New tab", group: "Tabs and panes" },
  {
    id: "tabs-no-pins",
    label: "New tab without pinned views",
    group: "Tabs and panes",
  },
  { id: "tabs-all-pins", label: "All views pinned", group: "Tabs and panes" },
  { id: "tabs-new-chat", label: "New conversation", group: "Tabs and panes" },
  {
    id: "tabs-many",
    label: "Many tabs and long names",
    group: "Tabs and panes",
  },
  { id: "tabs-loading", label: "Pane loading", group: "Tabs and panes" },
  {
    id: "tabs-unavailable",
    label: "Unavailable view",
    group: "Tabs and panes",
  },
] as const;
export const viewNames: Record<View, string> = copy.views;
export const viewIcons = {
  empty: "plus",
  tasks: "tasks",
  note: "notes",
  chat: "chat",
  files: "folder",
  views: "split",
  day: "calendar",
  calendar: "calendar",
  notes: "notes",
  reading: "notes",
  documents: "folder",
  review: "tasks",
} as const;
export const pinnableViews: PinnedView[] = [
  "day",
  "calendar",
  "tasks",
  "notes",
  "reading",
  "documents",
  "review",
  "files",
];
export const availableViews: View[] = [...pinnableViews, "note", "chat"];
export const currentTarget = (pane: Pane): ViewTarget =>
  pane.history[pane.cursor] ?? "empty";
export const currentView = (pane: Pane): View => {
  const target = currentTarget(pane);
  return target.startsWith("conversation:") ? "chat" : (target as View);
};
export const conversationId = (pane: Pane): string => {
  const target = currentTarget(pane);
  return target === "chat"
    ? "garden"
    : target.startsWith("conversation:")
      ? target.slice(13)
      : "";
};
export const paneTitle = (pane: Pane, state?: TabsState): string =>
  currentTarget(pane).startsWith("conversation:")
    ? (state?.conversations[conversationId(pane)]?.title ??
      copy.newConversation)
    : viewNames[currentView(pane)];
export const hasActivity = (state: TabsState, tabId: string) =>
  Object.values(state.conversations).some(
    (item) => item.activity === "working" && item.tabIds.includes(tabId),
  );
function visit(state: TabsState, tab: TopicTab, pane: Pane, view: ViewTarget) {
  if (view.startsWith("conversation:") && !state.conversations[view.slice(13)])
    return;
  if (currentTarget(pane) !== view) {
    pane.history = [...pane.history.slice(0, pane.cursor + 1), view];
    pane.cursor++;
  }
  pane.availability = "ready";
  tab.active = pane.id;
  if (tab.maximized) tab.maximized = pane.id;
  const conversation = state.conversations[conversationId(pane)];
  if (conversation && !conversation.tabIds.includes(tab.id))
    conversation.tabIds.push(tab.id);
}
export const activeTab = (state: TabsState) =>
  state.tabs.find((tab) => tab.id === state.active);
export function leaves(node: Layout): string[] {
  return node.kind === "pane"
    ? [node.id]
    : [...leaves(node.first), ...leaves(node.second)];
}
export function tabName(tab: TopicTab): string {
  const view = currentView(tab.panes[leaves(tab.layout)[0]!]!);
  return (
    tab.name ||
    (view === "empty"
      ? copy.newTab
      : paneTitle(tab.panes[leaves(tab.layout)[0]!]!))
  );
}
export function dimensions(node: Layout): { width: number; height: number } {
  if (node.kind === "pane") return { width: 280, height: 240 };
  const a = dimensions(node.first),
    b = dimensions(node.second);
  return node.axis === "row"
    ? { width: a.width + b.width + 10, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + 10 };
}
function replace(node: Layout, id: string, replacement: Layout): Layout {
  if (node.id === id) return replacement;
  return node.kind === "pane"
    ? node
    : {
        ...node,
        first: replace(node.first, id, replacement),
        second: replace(node.second, id, replacement),
      };
}
function remove(node: Layout, id: string): Layout | null {
  if (node.kind === "pane") return node.id === id ? null : node;
  const first = remove(node.first, id),
    second = remove(node.second, id);
  return first && second ? { ...node, first, second } : first || second;
}
function splitAt(
  state: TabsState,
  tab: TopicTab,
  target: string,
  pane: string,
  edge: Edge,
) {
  const before = edge === "left" || edge === "top";
  const added: Layout = { kind: "pane", id: pane };
  const existing: Layout = { kind: "pane", id: target };
  tab.layout = replace(tab.layout, target, {
    kind: "split",
    id: `split-${state.next++}`,
    axis: edge === "left" || edge === "right" ? "row" : "column",
    ratio: 0.5,
    first: before ? added : existing,
    second: before ? existing : added,
  });
  tab.active = pane;
  tab.maximized = null;
}
function newPane(id: string, view: View = "empty"): Pane {
  return { id, history: [view], cursor: 0, availability: "ready" };
}
function addTab(state: TabsState, view: View = "empty", name = "") {
  const id = `tab-${state.next++}`,
    pane = `pane-${state.next++}`;
  const tab: TopicTab = {
    id,
    name,
    layout: { kind: "pane", id: pane },
    panes: { [pane]: newPane(pane, view) },
    active: pane,
    maximized: null,
  };
  state.tabs.push(tab);
  state.active = id;
  return tab;
}
export function createTabsState(scenario = "tabs-overview"): TabsState {
  const state: TabsState = {
    tabs: [],
    closedTabs: [],
    active: "",
    next: 1,
    pinnedViews:
      scenario === "tabs-no-pins"
        ? []
        : scenario === "tabs-all-pins"
          ? [...pinnableViews]
          : ["calendar", "tasks", "notes"],
    conversations: {
      garden: {
        ...conversationPresentation(),
        id: "garden",
        title: copy.views.chat,
        draft: "",
        activity: "ready",
        tabIds: [],
        messages: [],
        archived: false,
      },
    },
    completed: [],
    dashboardCompleted: [false, false, false],
  };
  const empty = ["tabs-empty", "tabs-no-pins", "tabs-new-chat"].includes(
    scenario,
  );
  const tab = addTab(
    state,
    empty ? "empty" : "note",
    empty ? "" : "Garden weekend",
  );
  if (empty)
    return scenario === "tabs-new-chat"
      ? reduceTabs(state, { type: "new-conversation" })
      : state;
  state.conversations.garden!.tabIds = [tab.id];
  const note = tab.active;
  const chat = `pane-${state.next++}`;
  tab.panes[chat] = newPane(chat, "chat");
  splitAt(state, tab, note, chat, "right");
  if (tab.layout.kind === "split") tab.layout.ratio = 0.58;
  const tasks = `pane-${state.next++}`;
  tab.panes[tasks] = newPane(tasks, "tasks");
  splitAt(state, tab, note, tasks, "bottom");
  tab.active = note;
  if (tab.layout.kind === "split" && tab.layout.first.kind === "split")
    tab.layout.first.ratio = 0.56;
  if (scenario === "tabs-maximized-many") {
    for (let index = 0; index < 9; index++) {
      const id = `pane-${state.next++}`;
      const conversation = `study-${index}`;
      state.conversations[conversation] = {
        ...conversationPresentation(),
        id: conversation,
        title: copy.longPaneTitle.replace("{number}", String(index + 1)),
        draft: "",
        activity: "ready",
        tabIds: [tab.id],
        messages: [],
        archived: false,
      };
      tab.panes[id] = {
        ...newPane(id),
        history: ["note", `conversation:${conversation}`],
        cursor: 1,
      };
      splitAt(state, tab, chat, id, "bottom");
    }
    tab.maximized = tab.active;
  } else if (scenario === "tabs-maximized") {
    tab.active = chat;
    tab.maximized = chat;
    tab.panes[chat]!.history = ["note", "chat"];
    tab.panes[chat]!.cursor = 1;
  }
  if (scenario === "tabs-single-topic") return state;
  const week = addTab(state, "tasks", "My week");
  addTab(state, "files");
  if (scenario === "tabs-many")
    for (let i = 0; i < 16; i++)
      addTab(
        state,
        "note",
        `Reading and observations from the community garden · ${i + 1}`,
      );
  state.active = scenario === "tabs-multiple-topics" ? week.id : tab.id;
  if (scenario === "tabs-loading") tab.panes[note]!.availability = "loading";
  if (scenario === "tabs-unavailable")
    tab.panes[note]!.availability = "unavailable";
  return state;
}
export function reduceTabs(previous: TabsState, action: TabsAction): TabsState {
  const state: TabsState = JSON.parse(JSON.stringify(previous));
  const tab = activeTab(state);
  switch (action.type) {
    case "new-tab":
      addTab(state);
      break;
    case "reopen-tab": {
      const reopened = state.closedTabs.pop();
      if (reopened) {
        state.tabs.push(reopened);
        state.active = reopened.id;
      }
      break;
    }
    case "select-tab":
      if (state.tabs.some((t) => t.id === action.id)) state.active = action.id;
      break;
    case "rename-tab": {
      const target = state.tabs.find((t) => t.id === action.id);
      if (target) target.name = action.name.trim();
      break;
    }
    case "close-tab": {
      const index = state.tabs.findIndex((t) => t.id === action.id);
      if (index < 0) break;
      state.closedTabs.push(...state.tabs.splice(index, 1));
      if (!state.tabs.length) addTab(state);
      else if (state.active === action.id)
        state.active =
          state.tabs[Math.min(index, state.tabs.length - 1)]?.id ?? "";
      break;
    }
    case "close-other-tabs": {
      const retained = state.tabs.find((tab) => tab.id === action.id);
      if (retained) {
        state.closedTabs.push(
          ...state.tabs.filter((tab) => tab.id !== retained.id),
        );
        state.tabs = [retained];
        state.active = retained.id;
      }
      break;
    }
    case "close-all-tabs":
      state.closedTabs.push(...state.tabs);
      state.tabs = [];
      addTab(state);
      break;
    case "pin-view":
      if (pinnableViews.includes(action.view))
        state.pinnedViews = state.pinnedViews.includes(action.view)
          ? state.pinnedViews.filter((view) => view !== action.view)
          : [...state.pinnedViews, action.view];
      break;
    case "rename-conversation": {
      const title = action.title.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
      const conversation = state.conversations[action.id];
      if (conversation && title) conversation.title = title;
      break;
    }
    case "archive-conversation": {
      const conversation = state.conversations[action.id];
      if (conversation) conversation.archived = !conversation.archived;
      break;
    }
    case "draft":
      if (state.conversations[action.id])
        state.conversations[action.id]!.draft = action.value;
      break;
    case "activity":
      if (state.conversations[action.id])
        setActivity(state.conversations[action.id]!, action.value);
      break;
    case "conversation-ai": {
      const conversation = state.conversations[action.id];
      if (conversation) {
        const response = currentWorkspace(conversation.ai).response;
        conversation.ai = cloneAiState(action.value);
        currentWorkspace(conversation.ai).response = response;
      }
      break;
    }
    case "conversation-thinking": {
      const conversation = state.conversations[action.id];
      if (
        !conversation ||
        choiceGuard(conversation.ai) ||
        !validThinkingSelection(conversation.ai, action.value)
      )
        break;
      const choices = conversation.thinking[conversation.ai.workspace];
      if (action.value === null) delete choices[thinkingKey(conversation.ai)];
      else choices[thinkingKey(conversation.ai)] = action.value;
      break;
    }
    case "send": {
      const conversation = state.conversations[action.id];
      if (
        conversation?.draft.trim() &&
        conversation.activity !== "working" &&
        !chatGuard(conversation.ai)
      ) {
        conversation.messages.push(conversation.draft.trim());
        conversation.draft = "";
        setActivity(conversation, "working");
      }
      break;
    }
    case "new-conversation": {
      const owner = tab ?? addTab(state);
      const pane = owner.panes[action.id ?? owner.active];
      if (!pane) break;
      const id = `chat-${state.next++}`;
      state.conversations[id] = {
        ...conversationPresentation(
          Object.keys(state.conversations).length - 1,
        ),
        id,
        title: copy.newConversation,
        draft: "",
        activity: "ready",
        tabIds: [owner.id],
        messages: [],
        archived: false,
      };
      visit(state, owner, pane, `conversation:${id}`);
      break;
    }
    case "navigate": {
      const owner = tab ?? addTab(state);
      visit(state, owner, owner.panes[owner.active]!, action.view);
      break;
    }
    case "dashboard-task":
      if (action.index >= 0 && action.index < state.dashboardCompleted.length)
        state.dashboardCompleted[action.index] =
          !state.dashboardCompleted[action.index];
      break;
    case "task":
      state.completed = state.completed.includes(action.index)
        ? state.completed.filter((i) => i !== action.index)
        : [...state.completed, action.index];
      break;
    case "availability":
      if (tab) tab.panes[tab.active]!.availability = action.value;
      break;
    case "select-pane":
      if (tab?.panes[action.id]) {
        tab.active = action.id;
        if (tab.maximized) tab.maximized = action.id;
      }
      break;
    case "open": {
      const pane = tab?.panes[action.id];
      if (!pane) break;
      visit(state, tab!, pane, action.view);
      break;
    }
    case "history": {
      const pane = tab?.panes[action.id];
      if (!pane) break;
      pane.cursor = Math.max(
        0,
        Math.min(pane.history.length - 1, pane.cursor + action.delta),
      );
      pane.availability = "ready";
      break;
    }
    case "split": {
      if (!tab?.panes[action.id]) break;
      const id = `pane-${state.next++}`;
      tab.panes[id] = newPane(id);
      splitAt(state, tab, action.id, id, action.edge);
      break;
    }
    case "move": {
      if (
        !tab ||
        action.id === action.target ||
        !tab.panes[action.id] ||
        !tab.panes[action.target]
      )
        break;
      tab.layout = remove(tab.layout, action.id)!;
      splitAt(state, tab, action.target, action.id, action.edge);
      break;
    }
    case "resize": {
      if (!tab || !Number.isFinite(action.ratio)) break;
      const update = (node: Layout): void => {
        if (node.kind === "pane") return;
        if (node.id === action.id)
          node.ratio = Math.min(0.9, Math.max(0.1, action.ratio));
        else {
          update(node.first);
          update(node.second);
        }
      };
      update(tab.layout);
      break;
    }
    case "maximize":
      if (tab?.panes[action.id]) {
        tab.active = action.id;
        tab.maximized = tab.maximized === action.id ? null : action.id;
      }
      break;
    case "close-pane": {
      if (!tab?.panes[action.id]) break;
      const layout = remove(tab.layout, action.id);
      if (!layout) {
        tab.panes[action.id] = newPane(action.id);
        tab.maximized = null;
        break;
      }
      tab.layout = layout;
      delete tab.panes[action.id];
      if (tab.active === action.id) tab.active = leaves(layout)[0]!;
      if (tab.maximized === action.id) tab.maximized = null;
      break;
    }
  }
  return state;
}
