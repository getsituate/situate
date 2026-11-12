import { describe, expect, it } from "vitest";
import {
  activeTab,
  createTabsState,
  currentView,
  leaves,
  reduceTabs,
  tabName,
  type TabsAction,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";

describe("topic tabs", () => {
  it("renames a conversation without changing its execution or presentation", () => {
    const state = createTabsState();
    const next = reduceTabs(state, {
      type: "rename-conversation",
      id: "garden",
      title: "  Spring\nplanting  ",
    });
    expect(next.conversations.garden).toEqual({
      ...state.conversations.garden,
      title: "Spring planting",
    });
    expect(next.tabs).toEqual(state.tabs);
    expect(
      reduceTabs(next, {
        type: "rename-conversation",
        id: "garden",
        title: "  ",
      }),
    ).toEqual(next);
  });
  it.each([
    ["tabs-new-chat", 1, 1],
    ["tabs-single-topic", 1, 3],
    ["tabs-multiple-topics", 3, 1],
    ["tabs-overview", 3, 3],
  ] as const)(
    "opens %s with independent tab and pane counts",
    (scenario, tabs, panes) => {
      const state = createTabsState(scenario);
      expect(state.tabs).toHaveLength(tabs);
      expect(leaves(activeTab(state)!.layout)).toHaveLength(panes);
      expect(activeTab(createSimulation(scenario).tabs)!.id).toBe(state.active);
    },
  );
  it("uses the first pane's title until a name is supplied, without changing identity", () => {
    let state = createTabsState("tabs-empty");
    const original = activeTab(state)!;
    state = reduceTabs(state, {
      type: "open",
      id: original.active,
      view: "files",
    });
    expect(tabName(activeTab(state)!)).toBe("Files");
    state = reduceTabs(state, {
      type: "rename-tab",
      id: original.id,
      name: "  Reading  ",
    });
    expect(tabName(activeTab(state)!)).toBe("Reading");
    expect(activeTab(state)!.id).toBe(original.id);
    state = reduceTabs(state, {
      type: "rename-tab",
      id: original.id,
      name: " ",
    });
    expect(tabName(activeTab(state)!)).toBe("Files");
  });
  it("retains independent histories and discards only the forward branch", () => {
    let state = createTabsState();
    const tab = activeTab(state)!;
    const pane = tab.active;
    const others = Object.values(tab.panes).filter((p) => p.id !== pane);
    const actions: TabsAction[] = [
      { type: "draft", id: "garden", value: "Keep this draft" },
      { type: "open", id: pane, view: "chat" },
      { type: "history", id: pane, delta: -1 },
      { type: "open", id: pane, view: "files" },
      { type: "select-tab", id: state.tabs[1]!.id },
      { type: "select-tab", id: tab.id },
    ];
    for (const action of actions) state = reduceTabs(state, action);
    expect(activeTab(state)!.panes[pane]!.history).toEqual(["note", "files"]);
    expect(
      Object.values(activeTab(state)!.panes).filter((p) => p.id !== pane),
    ).toEqual(others);
    expect(state.conversations.garden!.draft).toBe("Keep this draft");
  });
  it("moves a pane across nested splits without replacing its identity or history", () => {
    let state = createTabsState();
    const tab = activeTab(state)!;
    const [note, tasks, chat] = leaves(tab.layout);
    state = reduceTabs(state, { type: "open", id: chat!, view: "files" });
    const panes = activeTab(state)!.panes;
    state = reduceTabs(state, {
      type: "move",
      id: chat!,
      target: note!,
      edge: "left",
    });
    expect(leaves(activeTab(state)!.layout)).toEqual([chat, note, tasks]);
    expect(activeTab(state)!.panes).toEqual(panes);
    state = reduceTabs(state, {
      type: "move",
      id: chat!,
      target: tasks!,
      edge: "bottom",
    });
    expect(leaves(activeTab(state)!.layout)).toEqual([note, tasks, chat]);
  });
  it("keeps split geometry during maximization and arbitrary repeated splitting", () => {
    let state = createTabsState();
    for (let i = 0; i < 12; i++)
      state = reduceTabs(state, {
        type: "split",
        id: activeTab(state)!.active,
        edge: i % 2 ? "right" : "bottom",
      });
    const tab = activeTab(state)!;
    expect(leaves(tab.layout)).toHaveLength(15);
    state = reduceTabs(state, { type: "maximize", id: tab.active });
    expect(activeTab(state)!.layout).toEqual(tab.layout);
    state = reduceTabs(state, { type: "maximize", id: tab.active });
    expect(activeTab(state)!.maximized).toBeNull();
    expect(activeTab(state)!.panes).toEqual(tab.panes);
  });
  it("closes inactive tabs without selecting them and retains the requested tab on bulk close", () => {
    const state = createTabsState();
    const inactive = state.tabs.find((item) => item.id !== state.active)!;
    const closed = reduceTabs(state, { type: "close-tab", id: inactive.id });
    expect(closed.active).toBe(state.active);
    expect(closed.tabs.map((item) => item.id)).not.toContain(inactive.id);
    const retained = reduceTabs(state, {
      type: "close-other-tabs",
      id: inactive.id,
    });
    expect(retained.tabs).toEqual([inactive]);
    expect(retained.active).toBe(inactive.id);
    expect(retained.conversations).toEqual(state.conversations);
    expect(
      reduceTabs(state, { type: "close-other-tabs", id: "missing" }),
    ).toEqual(state);
  });
  it("closing all tabs creates a fresh empty tab without clearing shared content", () => {
    const state = createTabsState();
    const closed = reduceTabs(state, { type: "close-all-tabs" });
    expect(closed.tabs).toHaveLength(1);
    const tab = activeTab(closed)!;
    expect(state.tabs.map((item) => item.id)).not.toContain(tab.id);
    expect(tab.name).toBe("");
    expect(leaves(tab.layout)).toEqual([tab.active]);
    expect(tab.panes[tab.active]!.history).toEqual(["empty"]);
    expect(closed.conversations).toEqual(state.conversations);
    expect(closed.pinnedViews).toEqual(state.pinnedViews);
    const again = reduceTabs(closed, { type: "close-tab", id: tab.id });
    expect(again.tabs).toHaveLength(1);
    expect(again.active).not.toBe(tab.id);
  });
  it("reopens closed tabs with their arrangement and shared work unchanged", () => {
    const state = createTabsState();
    expect(reduceTabs(state, { type: "reopen-tab" })).toEqual(state);
    const original = activeTab(state)!;
    const closed = reduceTabs(state, { type: "close-tab", id: original.id });
    const reopened = reduceTabs(closed, { type: "reopen-tab" });
    expect(activeTab(reopened)).toEqual(original);
    expect(reopened.closedTabs).toEqual([]);
    expect(reopened.conversations).toEqual(state.conversations);
    expect(state.closedTabs).toEqual([]);

    let bulk = reduceTabs(state, { type: "close-all-tabs" });
    for (const tab of [...state.tabs].reverse()) {
      bulk = reduceTabs(bulk, { type: "reopen-tab" });
      expect(activeTab(bulk)).toEqual(tab);
    }
    expect(bulk.closedTabs).toEqual([]);
  });
  it("clamps geometry and ignores malformed moves", () => {
    const state = createTabsState();
    const tab = activeTab(state)!;
    const resized = reduceTabs(state, {
      type: "resize",
      id: tab.layout.id,
      ratio: 2,
    });
    expect(resized.tabs[0]!.layout).toMatchObject({ ratio: 0.9 });
    expect(
      reduceTabs(state, { type: "resize", id: tab.layout.id, ratio: NaN }),
    ).toEqual(state);
    expect(
      reduceTabs(state, {
        type: "move",
        id: tab.active,
        target: "missing",
        edge: "top",
      }),
    ).toEqual(state);
  });
  it("closing panes and tabs does not clear content drafts or ongoing work", () => {
    let state = createTabsState("tabs-empty");
    state = reduceTabs(state, {
      type: "draft",
      id: "garden",
      value: "A retained draft",
    });
    state = reduceTabs(state, {
      type: "activity",
      id: "garden",
      value: "working",
    });
    state = reduceTabs(state, {
      type: "close-pane",
      id: activeTab(state)!.active,
    });
    expect(
      currentView(activeTab(state)!.panes[activeTab(state)!.active]!),
    ).toBe("empty");
    state = reduceTabs(state, { type: "close-tab", id: state.active });
    expect(state.tabs).toHaveLength(1);
    expect(
      currentView(activeTab(state)!.panes[activeTab(state)!.active]!),
    ).toBe("empty");
    expect(state.conversations.garden!.draft).toBe("A retained draft");
    expect(state.conversations.garden!.activity).toBe("working");
    state = reduceTabs(state, { type: "new-tab" });
    expect(state.tabs).toHaveLength(2);
  });
  it("preserves presentation across environment changes and resets deterministically", () => {
    let state = createSimulation("tabs-overview");
    state = reduceSimulation(state, {
      type: "tabs",
      action: { type: "draft", id: "garden", value: "Draft" },
    });
    const tabs = state.tabs;
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.tabs).toEqual(tabs);
    expect(screenControls(state)).toMatchObject({
      controls: ["tabs"],
      editing: true,
      canSetOutcome: false,
    });
    state = reduceSimulation(state, { type: "reset" });
    expect(state.tabs).toEqual(createTabsState());
    expect(state.snapshot.mobile).toBe(true);
    expect(state.epoch).toBe(1);
  });
  it("keeps tabs and drafts scoped to their workspace", () => {
    let state = createSimulation("tabs-overview");
    state = reduceSimulation(state, {
      type: "tabs",
      action: { type: "draft", id: "garden", value: "First workspace" },
    });
    const first = state.tabs;
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "second", action: "open", id: "sample-2" },
    });
    expect(state.tabs.conversations.garden!.draft).toBe("");
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "first", action: "open", id: "sample-1" },
    });
    expect(state.tabs).toEqual(first);
  });
});
