import { describe, expect, it } from "vitest";
import { createSettingsState } from "./model";
import { settingsThinking, setSettingsThinking } from "./thinking";
import {
  changePhase,
  chooseThinking,
  createChatState,
  mainChatRequest,
} from "../chat/model";
import { currentWorkspace } from "../ai/model";
import { selectedThinking } from "../chat/thinking";
import { createSimulation, reduceSimulation } from "../workshop/simulation";

function settings() {
  const state = createSettingsState("settings-advanced");
  state.provider = "openai";
  state.chatModel = "Example Reasoning";
  return state;
}
function chat() {
  const state = createChatState("chat-complete");
  currentWorkspace(state.ai).model.selected = "example-reasoning-long";
  return state;
}

describe("thinking preferences", () => {
  it("uses the maintained recommendation and offers only supported levels", () => {
    const state = settings();
    expect(settingsThinking(state)).toMatchObject({
      preference: "recommended",
      level: "medium",
      capability: { levels: ["low", "medium", "high"] },
    });
    setSettingsThinking(state, "high");
    expect(settingsThinking(state)?.level).toBe("high");
    state.chatModel = "example-desktop";
    setSettingsThinking(state, "medium");
    expect(settingsThinking(state)).toMatchObject({
      preference: "recommended",
      level: "low",
    });
    state.chatModel = "Example Reasoning";
    expect(settingsThinking(state)?.level).toBe("high");
    setSettingsThinking(state, "recommended");
    expect(settingsThinking(state)?.level).toBe("medium");
  });
  it("does not infer adjustable thinking for unknown, ordinary, incompatible or managed models", () => {
    const state = settings();
    state.chatModel = "recommended";
    expect(settingsThinking(state)).toBeUndefined();
    state.chatModel = "unknown-model";
    expect(settingsThinking(state)).toBeUndefined();
    state.chatModel = "Example Reasoning";
    state.connections.openai!.method = "browser";
    expect(settingsThinking(state)).toBeUndefined();
    state.connections.openai!.method = "key";
    state.useManaged = true;
    expect(settingsThinking(state)).toBeUndefined();
  });
  it("separates workspace defaults, conversation overrides and Recommended", () => {
    let state = chat();
    currentWorkspace(state.ai).thinkingDefaults[
      "openai/example-reasoning-long"
    ] = "low";
    expect(selectedThinking(state.ai, state.thinking)).toBe("low");
    state = chooseThinking(state, "high");
    expect(selectedThinking(state.ai, state.thinking)).toBe("high");
    state = chooseThinking(state, null);
    expect(selectedThinking(state.ai, state.thinking)).toBe("low");
    state = chooseThinking(state, "recommended");
    expect(selectedThinking(state.ai, state.thinking)).toBe("medium");
    currentWorkspace(state.ai).model.selected = "example-fast";
    expect(selectedThinking(state.ai, state.thinking)).toBeNull();
    currentWorkspace(state.ai).model.selected = "example-reasoning-long";
    expect(selectedThinking(state.ai, state.thinking)).toBe("medium");
    expect(
      currentWorkspace(state.ai).thinkingDefaults[
        "openai/example-reasoning-long"
      ],
    ).toBe("low");
  });
  it("preserves an active request while Settings defaults change", () => {
    let state = createSimulation("chat-complete");
    state.chat = chat();
    state.chat.draft = "Keep my draft";
    const next = settings();
    setSettingsThinking(next, "high");
    state = reduceSimulation(state, { type: "settings", state: next });
    expect(mainChatRequest(state.chat).thinking).toBe("high");
    state.chat = changePhase(state.chat, "working");
    setSettingsThinking(next, "low");
    state = reduceSimulation(state, { type: "settings", state: next });
    expect(mainChatRequest(state.chat).thinking).toBe("high");
    const changed = chooseThinking(state.chat, "recommended");
    expect(mainChatRequest(changed).thinking).toBe("high");
    expect(mainChatRequest(changePhase(changed, "complete")).thinking).toBe(
      "medium",
    );
    state.chat = changePhase(state.chat, "complete");
    expect(mainChatRequest(state.chat).thinking).toBe("low");
    expect(state.chat.draft).toBe("Keep my draft");
    expect(state.chat.ai.workspaces.Studio.thinkingDefaults).toEqual({});
  });
  it("shares defaults and visibility across tab conversations without overwriting their choices", () => {
    let state = createSimulation("tabs-new-chat");
    const conversation = Object.values(state.tabs.conversations)[0]!;
    currentWorkspace(conversation.ai).model.selected = "example-reasoning-long";
    conversation.thinking.Personal["openai/example-reasoning-long"] = "high";
    const next = settings();
    next.showModelPicker = false;
    setSettingsThinking(next, "low");
    state = reduceSimulation(state, { type: "settings", state: next });
    const updated = state.tabs.conversations[conversation.id]!;
    expect(currentWorkspace(updated.ai).showModelPicker).toBe(false);
    expect(selectedThinking(updated.ai, updated.thinking)).toBe("high");
    state = reduceSimulation(state, {
      type: "tabs",
      action: { type: "new-conversation" },
    });
    const added = Object.values(state.tabs.conversations).at(-1)!;
    expect(currentWorkspace(added.ai).showModelPicker).toBe(false);
    expect(selectedThinking(added.ai, added.thinking)).toBe("low");
    state = reduceSimulation(state, { type: "reset" });
    expect(state.settings.thinkingDefaults).toEqual({});
    expect(state.settings.showModelPicker).toBe(true);
  });
});
