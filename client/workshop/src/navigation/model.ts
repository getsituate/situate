import { conversations, draft, tasks, views } from "./fixtures";
import { nextGreeting } from "./greetings";

export type NavigationScene = "chat" | "dashboard" | "empty" | "draft";
export type ViewId = (typeof views)[number]["id"];
export interface NavigationTab {
  id: string;
  title: string;
  kind: "chat" | "view";
  draft: string;
  greeting?: string;
}
export interface NavigationState {
  scene: NavigationScene;
  tabs: NavigationTab[];
  activeTab: string | null;
  activeChat: string | null;
  nextChat: number;
  completedTasks: boolean[];
  conversations: {
    id: string;
    title: string;
    status: string;
    archived: boolean;
  }[];
  pendingClose: string | null;
  feedback: string;
}
export function createNavigationState(
  scene: NavigationScene = "chat",
): NavigationState {
  const chat: NavigationTab = {
    id: "chat",
    title: "New chat",
    kind: "chat",
    greeting: nextGreeting(),
    draft: scene === "draft" ? draft : "",
  };
  return {
    scene,
    tabs:
      scene === "empty"
        ? []
        : scene === "dashboard"
          ? [{ id: "day", title: "My day", kind: "view", draft: "" }, chat]
          : [chat],
    activeTab:
      scene === "empty" ? null : scene === "dashboard" ? "day" : "chat",
    activeChat: scene === "empty" ? null : "chat",
    nextChat: 2,
    completedTasks: tasks.map(() => false),
    conversations: conversations.map((item) => ({ ...item })),
    pendingClose: null,
    feedback: "",
  };
}
export function navigationScreenLabel(state: NavigationState): string {
  if (state.pendingClose) return "Discard this draft?";
  if (!state.tabs.length) return "No open tabs";
  const view = state.tabs.find((tab) => tab.kind === "view");
  if (view)
    return state.tabs.some((tab) => tab.kind === "chat")
      ? `${view.title} + chat`
      : view.title;
  return (
    state.tabs.find((tab) => tab.id === state.activeTab)?.title ?? "New chat"
  );
}
export function navigationIsEditing(state: NavigationState): boolean {
  return (
    state.pendingClose === null &&
    state.tabs.some((tab) => tab.kind === "chat" && tab.id === state.activeTab)
  );
}
export function selectTab(state: NavigationState, id: string): NavigationState {
  const tab = state.tabs.find((item) => item.id === id);
  return tab
    ? {
        ...state,
        activeTab: id,
        activeChat: tab.kind === "chat" ? id : state.activeChat,
      }
    : state;
}
export function addChat(state: NavigationState): NavigationState {
  const number = state.nextChat;
  const tab: NavigationTab = {
    id: `chat-${number}`,
    title: `New chat ${number}`,
    kind: "chat",
    draft: "",
    greeting: nextGreeting(),
  };
  return {
    ...state,
    tabs: [...state.tabs, tab],
    activeTab: tab.id,
    activeChat: tab.id,
    nextChat: number + 1,
    feedback: `${tab.title} opened.`,
  };
}
export function openChat(state: NavigationState): NavigationState {
  return state.activeChat ? selectTab(state, state.activeChat) : addChat(state);
}
export function openView(state: NavigationState, id: ViewId): NavigationState {
  const view = views.find((item) => item.id === id)!;
  const chats = state.tabs.filter((tab) => tab.kind === "chat");
  return {
    ...state,
    tabs: [{ id, title: view.label, kind: "view", draft: "" }, ...chats],
    activeTab: id,
  };
}
export function updateDraft(
  state: NavigationState,
  id: string,
  value: string,
): NavigationState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === id ? { ...tab, draft: value } : tab,
    ),
  };
}
export function closeTab(
  state: NavigationState,
  id: string,
  discard = false,
): NavigationState {
  const position = state.tabs.findIndex((tab) => tab.id === id);
  if (position < 0) return state;
  const tab = state.tabs[position]!;
  if (tab.draft && !discard) return { ...state, pendingClose: id };
  const tabs = state.tabs.filter((item) => item.id !== id);
  const neighbor = tabs[Math.min(position, tabs.length - 1)];
  return {
    ...state,
    tabs,
    pendingClose: null,
    activeTab:
      state.activeTab === id ? (neighbor?.id ?? null) : state.activeTab,
    activeChat:
      state.activeChat === id
        ? neighbor?.kind === "chat"
          ? neighbor.id
          : (tabs.find((item) => item.kind === "chat")?.id ?? null)
        : state.activeChat,
    feedback: `${tab.title} closed.${tabs.length ? "" : " No open tabs."}`,
  };
}
export function toggleTask(
  state: NavigationState,
  index: number,
): NavigationState {
  const completedTasks = state.completedTasks.map((value, i) =>
    i === index ? !value : value,
  );
  const remaining = completedTasks.filter((value) => !value).length;
  return {
    ...state,
    completedTasks,
    feedback: `${remaining} planned ${remaining === 1 ? "task" : "tasks"} remaining.`,
  };
}
export function archiveConversation(
  state: NavigationState,
  id: string,
): NavigationState {
  return {
    ...state,
    conversations: state.conversations.map((item) =>
      item.id === id ? { ...item, archived: !item.archived } : item,
    ),
  };
}
export function conversationStatus(status: string): string {
  return status === "working"
    ? "Working · Reading notes"
    : status === "approval"
      ? "Needs approval"
      : status;
}
