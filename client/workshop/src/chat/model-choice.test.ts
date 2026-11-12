import { describe, expect, it } from "vitest";
import {
  changePhase,
  chooseThinking,
  commentRequest,
  createChatState,
  mainChatRequest,
  simulatedComment,
} from "./model";
import {
  applyOutcome,
  chatGuard,
  createAiState,
  currentWorkspace,
  modelAction,
  modelLocked,
  saveModel,
} from "../ai/model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { selectedThinking, thinkingCapability } from "./thinking";

function selectModel(state: ReturnType<typeof createChatState>, id: string) {
  saveModel(state.ai, id);
  applyOutcome(state.ai, "model-saved");
}
describe("chat model choice", () => {
  it("uses only the confirmed model for a main-chat request and keeps comment context separate", () => {
    let state = createChatState("chat-complete");
    state.draft = "Keep this private draft out of comments";
    saveModel(state.ai, "example-fast");
    expect(mainChatRequest(state)).toEqual({
      connection: "openai",
      model: "example-chat",
      thinking: null,
    });
    expect(changePhase(state, "working").phase).toBe("complete");
    applyOutcome(state.ai, "model-saved");
    state = changePhase(state, "working");
    expect(mainChatRequest(state)).toEqual({
      connection: "openai",
      model: "example-fast",
      thinking: null,
    });
    expect(commentRequest(state)).toEqual({
      context: "Checking the reading-evening plan.",
    });
    expect(simulatedComment(commentRequest(state)!, 1)).toBe(
      "Checking the last few details.",
    );
    expect(state.draft).toBe("Keep this private draft out of comments");
  });
  it.each(["complete", "cancelled", "error"] as const)(
    "ends the response without discarding a pending selection after %s",
    (phase) => {
      let state = createChatState("chat-working");
      saveModel(state.ai, "example-fast");
      expect(currentWorkspace(state.ai).model.selected).toBeNull();
      expect(mainChatRequest(state).model).toBe("example-chat");
      expect(currentWorkspace(state.ai).model.pending).toBe("example-fast");
      state = changePhase(state, phase);
      expect(commentRequest(state)).toBeNull();
      expect(currentWorkspace(state.ai).response).toBe("idle");
      expect(modelLocked(state.ai)).toBe(true);
      applyOutcome(state.ai, "model-saved");
      expect(modelLocked(state.ai)).toBe(false);
      expect(mainChatRequest(state).model).toBe("example-fast");
    },
  );
  it.each([
    "loading",
    "load-error",
    "zero",
    "unavailable",
    "saving",
    "save-error",
    "uncertain",
    "disconnected",
  ])("does not start work or change thinking while %s", (fixture) => {
    const state = createChatState("chat-complete");
    state.ai = createAiState(`chat-${fixture}`);
    expect(chatGuard(state.ai)).not.toBe("");
    expect(changePhase(state, "working")).toBe(state);
    expect(chooseThinking(state, "high")).toBe(state);
  });
  it("retains the previous choice after a failed save and waits for uncertain readback", () => {
    const state = createChatState("chat-complete");
    saveModel(state.ai, "example-fast");
    applyOutcome(state.ai, "model-save-error");
    expect(mainChatRequest(state).model).toBe("example-chat");
    modelAction(state.ai, "retry");
    applyOutcome(state.ai, "model-save-uncertain");
    expect(modelLocked(state.ai)).toBe(true);
    modelAction(state.ai, "discard");
    expect(currentWorkspace(state.ai).model.phase).toBe("uncertain");
    modelAction(state.ai, "check");
    applyOutcome(state.ai, "model-confirmed-new");
    expect(mainChatRequest(state).model).toBe("example-fast");
  });
  it("offers only declared levels and retains separate valid choices when models change", () => {
    let state = createChatState("chat-complete");
    expect(thinkingCapability(state.ai)).toBeUndefined();
    selectModel(state, "example-reasoning-long");
    expect(thinkingCapability(state.ai)?.levels).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(selectedThinking(state.ai, state.thinking)).toBe("medium");
    state = chooseThinking(state, "high");
    selectModel(state, "example-desktop");
    expect(thinkingCapability(state.ai)?.levels).toEqual(["low", "high"]);
    expect(selectedThinking(state.ai, state.thinking)).toBe("low");
    expect(chooseThinking(state, "medium")).toBe(state);
    selectModel(state, "example-fast");
    expect(selectedThinking(state.ai, state.thinking)).toBeNull();
    selectModel(state, "example-reasoning-long");
    expect(selectedThinking(state.ai, state.thinking)).toBe("high");
  });
  it("does not infer capabilities from a manual ID, missing catalog entry or another provider", () => {
    const state = createChatState("chat-complete");
    state.ai = createAiState("chat-custom");
    currentWorkspace(state.ai).model.selected = "example-reasoning-long";
    expect(thinkingCapability(state.ai)).toBeUndefined();
    state.ai = createAiState("chat-unavailable");
    expect(thinkingCapability(state.ai)).toBeUndefined();
    currentWorkspace(state.ai).model.selected = "example-reasoning-long";
    currentWorkspace(state.ai).connection!.provider = "anthropic";
    expect(thinkingCapability(state.ai)).toBeUndefined();
  });
  it("isolates thinking by workspace and falls back to a supported default for stale values", () => {
    let state = createChatState("chat-complete");
    selectModel(state, "example-reasoning-long");
    state = chooseThinking(state, "high");
    state.ai.workspaces.Studio = JSON.parse(
      JSON.stringify(currentWorkspace(state.ai)),
    );
    state.ai.workspace = "Studio";
    expect(selectedThinking(state.ai, state.thinking)).toBe("medium");
    state = chooseThinking(state, "low");
    state.ai.workspace = "Personal";
    expect(selectedThinking(state.ai, state.thinking)).toBe("high");
    selectModel(state, "example-desktop");
    state.thinking.Personal["openai/example-desktop"] = "medium";
    expect(selectedThinking(state.ai, state.thinking)).toBe("low");
  });
  it("blocks both changes during model persistence and snapshots thinking for active runs", () => {
    let state = createChatState("chat-complete");
    selectModel(state, "example-reasoning-long");
    state = chooseThinking(state, "high");
    saveModel(state.ai, "example-desktop");
    expect(chooseThinking(state, "low")).toBe(state);
    applyOutcome(state.ai, "model-save-error");
    modelAction(state.ai, "discard");
    state = changePhase(state, "working");
    expect(mainChatRequest(state)).toEqual({
      connection: "openai",
      model: "example-reasoning-long",
      thinking: "high",
    });
    state = chooseThinking(state, "low");
    expect(selectedThinking(state.ai, state.thinking)).toBe("low");
    expect(mainChatRequest(state).thinking).toBe("high");
    saveModel(state.ai, "example-fast");
    expect(currentWorkspace(state.ai).model.pending).toBe("example-fast");
    applyOutcome(state.ai, "model-saved");
    expect(mainChatRequest(state)).toEqual({
      connection: "openai",
      model: "example-reasoning-long",
      thinking: "high",
    });
    expect(changePhase(state, "working")).toBe(state);
    state = changePhase(state, "cancelled");
    expect(mainChatRequest(state)).toEqual({
      connection: "openai",
      model: "example-fast",
      thinking: null,
    });
    selectModel(state, "example-reasoning-long");
    expect(mainChatRequest(state).thinking).toBe("low");
  });
  it("preserves the draft and choices across environments and resets pending work", () => {
    let state = createSimulation("chat-empty");
    state.chat.draft = "Keep my draft";
    selectModel(state.chat, "example-reasoning-long");
    state.chat = chooseThinking(state.chat, "high");
    saveModel(state.chat.ai, "example-fast");
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.chat.draft).toBe("Keep my draft");
    expect(selectedThinking(state.chat.ai, state.chat.thinking)).toBe("high");
    expect(currentWorkspace(state.chat.ai).model.pending).toBe("example-fast");
    state = reduceSimulation(state, { type: "reset" });
    expect(state.chat.draft).toBe("");
    expect(state.chat.ai.mobile).toBe(true);
    expect(state.chat.thinking).toEqual({ Personal: {}, Studio: {} });
    expect(currentWorkspace(state.chat.ai).model.pending).toBeNull();
    applyOutcome(state.chat.ai, "model-saved");
    expect(mainChatRequest(state.chat).model).toBe("example-chat");
  });
});
