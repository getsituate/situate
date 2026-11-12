import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  cloneAiState,
  currentWorkspace,
  saveModel,
} from "../ai/model";
import { createSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import {
  activeTab,
  conversationId,
  createTabsState,
  currentTarget,
  hasActivity,
  reduceTabs,
} from "./model";

describe("workspace navigation within topic panes", () => {
  it("creates deterministic conversation presentation state and exposes model outcomes only for visible chats", () => {
    expect(createTabsState("tabs-new-chat")).toEqual(
      createTabsState("tabs-new-chat"),
    );
    const state = createSimulation("tabs-new-chat");
    expect(screenControls(state).controls).toContain("tab-model");
    state.tabs = reduceTabs(state.tabs, {
      type: "availability",
      value: "unavailable",
    });
    expect(screenControls(state).controls).not.toContain("tab-model");
    state.tabs = reduceTabs(state.tabs, { type: "navigate", view: "notes" });
    expect(screenControls(state).controls).not.toContain("tab-model");
  });

  it("blocks sending during model saves and retains confirmed choices through active work", () => {
    let state = createTabsState("tabs-new-chat");
    const tab = activeTab(state)!;
    const id = conversationId(tab.panes[tab.active]!);
    state = reduceTabs(state, { type: "draft", id, value: "Keep this draft" });
    const pending = cloneAiState(state.conversations[id]!.ai);
    saveModel(pending, "example-fast");
    state = reduceTabs(state, { type: "conversation-ai", id, value: pending });
    expect(reduceTabs(state, { type: "send", id })).toEqual(state);
    applyOutcome(pending, "model-saved");
    expect(currentWorkspace(state.conversations[id]!.ai).model.phase).toBe(
      "saving",
    );
    state = reduceTabs(state, { type: "conversation-ai", id, value: pending });
    state = reduceTabs(state, { type: "send", id });
    expect(state.conversations[id]!.messages).toEqual(["Keep this draft"]);
    expect(currentWorkspace(state.conversations[id]!.ai).response).toBe(
      "streaming",
    );
    expect(currentWorkspace(state.conversations[id]!.ai).model.phase).toBe(
      "ready",
    );
    expect(state.conversations[id]!.run).toEqual({
      connection: "openai",
      model: "example-fast",
      thinking: null,
    });
    const working = state;
    state = reduceTabs(state, { type: "conversation-ai", id, value: pending });
    expect(state).toEqual(working);
    state = reduceTabs(state, { type: "activity", id, value: "ready" });
    expect(currentWorkspace(state.conversations[id]!.ai).model.phase).toBe(
      "ready",
    );
    expect(currentWorkspace(state.conversations[id]!.ai).model.selected).toBe(
      "example-fast",
    );
  });
  it("navigates only the active pane and preserves its layout and history", () => {
    const before = createTabsState();
    const tab = activeTab(before)!;
    const after = reduceTabs(before, { type: "navigate", view: "calendar" });
    const updated = activeTab(after)!;
    expect(after.tabs).toHaveLength(before.tabs.length);
    expect(updated.layout).toEqual(tab.layout);
    expect(updated.active).toBe(tab.active);
    expect(updated.panes[tab.active]!.history).toEqual(["note", "calendar"]);
    for (const [id, pane] of Object.entries(tab.panes)) {
      if (id !== tab.active) expect(updated.panes[id]).toEqual(pane);
    }
    const back = reduceTabs(after, {
      type: "history",
      id: tab.active,
      delta: -1,
    });
    expect(currentTarget(activeTab(back)!.panes[tab.active]!)).toBe("note");
    expect(reduceTabs(after, { type: "navigate", view: "calendar" })).toEqual(
      after,
    );
  });

  it("keeps pinned view order without changing the active pane", () => {
    const before = createTabsState("tabs-empty");
    let state = reduceTabs(before, { type: "pin-view", view: "calendar" });
    expect(state.pinnedViews).toEqual(["tasks", "notes"]);
    state = reduceTabs(state, { type: "pin-view", view: "files" });
    expect(state.pinnedViews).toEqual(["tasks", "notes", "files"]);
    state = reduceTabs(state, { type: "pin-view", view: "calendar" });
    expect(state.pinnedViews).toEqual(["tasks", "notes", "files", "calendar"]);
    expect(state.tabs).toEqual(before.tabs);
    expect(createTabsState("tabs-no-pins").pinnedViews).toEqual([]);
  });

  it("creates independent conversations in the selected pane, not additional tabs", () => {
    let state = createTabsState("tabs-empty");
    const tabId = state.active;
    const paneId = activeTab(state)!.active;
    state = reduceTabs(state, { type: "new-conversation", id: paneId });
    const first = conversationId(activeTab(state)!.panes[paneId]!);
    expect(state.tabs).toHaveLength(1);
    expect(state.active).toBe(tabId);
    state = reduceTabs(state, {
      type: "draft",
      id: first,
      value: "First draft",
    });
    state = reduceTabs(state, { type: "new-conversation", id: paneId });
    const second = conversationId(activeTab(state)!.panes[paneId]!);
    expect(second).not.toBe(first);
    expect(state.conversations[second]!.draft).toBe("");
    state = reduceTabs(state, {
      type: "draft",
      id: second,
      value: "Second draft",
    });
    state = reduceTabs(state, { type: "history", id: paneId, delta: -1 });
    expect(conversationId(activeTab(state)!.panes[paneId]!)).toBe(first);
    expect(state.conversations[first]!.draft).toBe("First draft");
    state = reduceTabs(state, { type: "send", id: first });
    expect(state.conversations[first]!.messages).toEqual(["First draft"]);
    expect(state.conversations[first]!.draft).toBe("");
    expect(state.conversations[second]!.draft).toBe("Second draft");
    expect(state.conversations.garden!.messages).toEqual([]);
    state = reduceTabs(state, { type: "navigate", view: "notes" });
    expect(hasActivity(state, tabId)).toBe(true);
    state = reduceTabs(state, { type: "close-tab", id: tabId });
    expect(state.tabs).toHaveLength(1);
    expect(state.active).not.toBe(tabId);
    expect(state.conversations[first]!.activity).toBe("working");
    state = reduceTabs(state, {
      type: "navigate",
      view: `conversation:${first}`,
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.conversations[first]!.messages).toEqual(["First draft"]);
    expect(hasActivity(state, state.active)).toBe(true);
    state = reduceTabs(state, { type: "archive-conversation", id: first });
    expect(state.conversations[first]!.archived).toBe(true);
    expect(
      currentTarget(activeTab(state)!.panes[activeTab(state)!.active]!),
    ).toBe(`conversation:${first}`);
  });

  it("creates a destination when navigating without any open tabs", () => {
    let state = createTabsState("tabs-empty");
    state = reduceTabs(state, { type: "close-tab", id: state.active });
    state = reduceTabs(state, { type: "navigate", view: "files" });
    const tab = activeTab(state)!;
    expect(state.tabs).toHaveLength(1);
    expect(currentTarget(tab.panes[tab.active]!)).toBe("files");
  });
});
