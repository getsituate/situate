import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  chatGuard,
  createAiState,
  currentWorkspace,
  modelAction,
  resolvedModelId,
  saveModel,
} from "../ai/model";
import { changePhase, createChatState, mainChatRequest } from "./model";
import { selectedThinking } from "./thinking";
import {
  createSimulation,
  reduceSimulation,
  scenarioAliases,
  canonicalScenario,
} from "../workshop/simulation";
import { scenarioForState } from "../workshop/scenario-catalog";

describe("inherited model selection", () => {
  it.each(["chat-new", "chat-one", "chat-oauth"])(
    "resolves Recommended without a conversation override in %s",
    (fixture) => {
      const ai = createAiState(fixture);
      expect(currentWorkspace(ai).model.selected).toBeNull();
      expect(currentWorkspace(ai).defaultModel).toBe("recommended");
      expect(resolvedModelId(ai)).toBe("example-chat");
      expect(chatGuard(ai)).toBe("");
    },
  );
  it("applies default changes only to conversations without an override", () => {
    const ai = createAiState("chat-new");
    currentWorkspace(ai).defaultModel = "example-fast";
    expect(resolvedModelId(ai)).toBe("example-fast");
    saveModel(ai, "example-chat");
    applyOutcome(ai, "model-saved");
    currentWorkspace(ai).defaultModel = "example-reasoning-long";
    expect(resolvedModelId(ai)).toBe("example-chat");
    saveModel(ai, null);
    expect(resolvedModelId(ai)).toBe("example-chat");
    applyOutcome(ai, "model-saved");
    expect(currentWorkspace(ai).model.selected).toBeNull();
    expect(resolvedModelId(ai)).toBe("example-reasoning-long");
  });
  it("retains an explicit choice while resetting it fails or needs readback", () => {
    const ai = createAiState("chat-existing");
    currentWorkspace(ai).defaultModel = "example-fast";
    saveModel(ai, null);
    applyOutcome(ai, "model-save-error");
    expect(resolvedModelId(ai)).toBe("example-chat");
    modelAction(ai, "retry");
    applyOutcome(ai, "model-save-uncertain");
    expect(chatGuard(ai)).not.toBe("");
    modelAction(ai, "check");
    applyOutcome(ai, "model-confirmed-new");
    expect(resolvedModelId(ai)).toBe("example-fast");
    expect(currentWorkspace(ai).model.selected).toBeNull();
  });
  it("uses inherited reasoning capabilities and snapshots the effective model during a request", () => {
    let state = createChatState("chat-complete");
    currentWorkspace(state.ai).defaultModel = "example-reasoning-long";
    expect(selectedThinking(state.ai, state.thinking)).toBe("medium");
    state = changePhase(state, "working");
    currentWorkspace(state.ai).defaultModel = "example-fast";
    expect(mainChatRequest(state)).toEqual({
      connection: "openai",
      model: "example-reasoning-long",
      thinking: "medium",
    });
    state = changePhase(state, "complete");
    expect(mainChatRequest(state)).toEqual({
      connection: "openai",
      model: "example-fast",
      thinking: null,
    });
    expect(state.run).toBeNull();
    expect(currentWorkspace(state.ai)).not.toHaveProperty("historySources");
  });
  it("connects Settings defaults to the conversation without changing its draft or active request", () => {
    let state = createSimulation("chat-complete");
    state.chat.draft = "Keep my draft";
    state.chat = changePhase(state.chat, "working");
    state = reduceSimulation(state, {
      type: "settings",
      state: { ...state.settings, chatModel: "GPT Mini" },
    });
    expect(currentWorkspace(state.chat.ai).defaultModel).toBe("example-fast");
    expect(mainChatRequest(state.chat).model).toBe("example-chat");
    expect(state.chat.draft).toBe("Keep my draft");
    state.chat = changePhase(state.chat, "complete");
    expect(mainChatRequest(state.chat).model).toBe("example-fast");
  });
  it("updates inherited defaults across tabs without replacing conversation overrides", () => {
    let state = createSimulation("tabs-single-topic");
    state = reduceSimulation(state, {
      type: "tabs",
      action: { type: "new-conversation" },
    });
    const conversations = Object.values(state.tabs.conversations);
    expect(conversations.length).toBeGreaterThan(1);
    currentWorkspace(conversations[0]!.ai).model.selected = "example-chat";
    state = reduceSimulation(state, {
      type: "settings",
      state: { ...state.settings, chatModel: "GPT Mini" },
    });
    const updated = Object.values(state.tabs.conversations);
    expect(resolvedModelId(updated[0]!.ai)).toBe("example-chat");
    expect(resolvedModelId(updated[1]!.ai)).toBe("example-fast");
    expect(currentWorkspace(updated[1]!.ai).model.selected).toBeNull();
    state = reduceSimulation(state, {
      type: "tabs",
      action: { type: "new-conversation" },
    });
    expect(
      resolvedModelId(Object.values(state.tabs.conversations).at(-1)!.ai),
    ).toBe("example-fast");
  });
  it("does not overwrite newer catalog or default changes with an in-flight draft edit", () => {
    let state = createSimulation("chat-complete");
    const before = structuredClone(state.chat);
    const draft = structuredClone(before);
    draft.draft = "Typed while the default changed";
    state = reduceSimulation(state, {
      type: "settings",
      state: { ...state.settings, chatModel: "GPT Mini" },
    });
    currentWorkspace(state.chat.ai).model.count = "one";
    state = reduceSimulation(state, {
      type: "chat",
      base: before,
      state: draft,
    });
    expect(currentWorkspace(state.chat.ai).defaultModel).toBe("example-fast");
    expect(currentWorkspace(state.chat.ai).model.count).toBe("one");
    expect(state.chat.draft).toBe("Typed while the default changed");
  });
  it("does not invent a suitable model or replace an unavailable explicit choice", () => {
    const empty = createAiState("chat-zero");
    expect(resolvedModelId(empty)).toBeNull();
    expect(chatGuard(empty)).toContain("No eligible");
    const unavailable = createAiState("chat-unavailable");
    expect(resolvedModelId(unavailable)).toBe("example-retired");
    expect(chatGuard(unavailable)).toContain("unavailable");
  });
  it.each(
    Object.keys(scenarioAliases).filter((id) =>
      id.startsWith("ai-chat"),
    ) as (keyof typeof scenarioAliases)[],
  )(
    "opens legacy %s links in Conversation without another selectable state",
    (id) => {
      const simulation = createSimulation(id);
      expect(simulation.feature).toBe("chat");
      expect(simulation.scenario).toBe(canonicalScenario(id));
      expect(scenarioForState(id).id).toBe("chat-work-history");
      expect(scenarioForState(id).states.map((s) => s.id)).not.toContain(id);
    },
  );
  it("continues setup in the shared Conversation view with the existing draft and default", () => {
    let state = createSimulation("ai-success");
    const ai = structuredClone(state.ai);
    currentWorkspace(ai).draft = "Continue after setup";
    ai.screen = "chat";
    state = reduceSimulation(state, { type: "ai", state: ai });
    expect(state.feature).toBe("chat");
    expect(state.chat.draft).toBe("Continue after setup");
    expect(currentWorkspace(state.chat.ai).model.selected).toBeNull();
    expect(resolvedModelId(state.chat.ai)).toBe("example-chat");
  });
});
