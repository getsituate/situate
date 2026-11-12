import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  chatGuard,
  cloneAiState,
  currentWorkspace,
  modelAction,
  modelLocked,
  saveModel,
} from "../ai/model";
import {
  changePhase,
  chooseThinking,
  createChatState,
  mainChatRequest,
} from "./model";
import { createTabsState, reduceTabs } from "../tabs/model";
import { settingsThinkingUnavailable } from "../settings/thinking";
import { createSettingsState } from "../settings/model";

describe("next-request configuration", () => {
  it.each(["model-save-error", "model-save-uncertain"])(
    "keeps the active request unchanged through %s and readback",
    (outcome) => {
      let state = createChatState("chat-complete");
      currentWorkspace(state.ai).model.selected = "example-reasoning-long";
      state = chooseThinking(state, "high");
      state = changePhase(state, "working");
      state = chooseThinking(state, "low");
      saveModel(state.ai, "example-fast");
      applyOutcome(state.ai, outcome);
      expect(mainChatRequest(state)).toEqual({
        connection: "openai",
        model: "example-reasoning-long",
        thinking: "high",
      });
      expect(currentWorkspace(state.ai).response).toBe("streaming");
      state = changePhase(state, "complete");
      expect(currentWorkspace(state.ai).model.phase).toBe(
        outcome === "model-save-error" ? "save-error" : "uncertain",
      );
      expect(chatGuard(state.ai)).not.toBe("");
      if (outcome === "model-save-error") {
        modelAction(state.ai, "discard");
        expect(mainChatRequest(state)).toEqual({
          connection: "openai",
          model: "example-reasoning-long",
          thinking: "low",
        });
      } else {
        modelAction(state.ai, "check");
        applyOutcome(state.ai, "model-confirmed-new");
        expect(mainChatRequest(state)).toEqual({
          connection: "openai",
          model: "example-fast",
          thinking: null,
        });
      }
      expect(chatGuard(state.ai)).toBe("");
    },
  );
  it("allows future choices while an earlier response awaits persistence", () => {
    let state = createChatState("chat-complete");
    currentWorkspace(state.ai).model.selected = "example-reasoning-long";
    currentWorkspace(state.ai).response = "unsaved";
    state = chooseThinking(state, "low");
    expect(mainChatRequest(state).thinking).toBe("low");
    expect(modelLocked(state.ai)).toBe(false);
    expect(chatGuard(state.ai)).toContain("Save the response");
    saveModel(state.ai, "example-fast");
    applyOutcome(state.ai, "model-response-saved");
    expect(currentWorkspace(state.ai).model.phase).toBe("saving");
    applyOutcome(state.ai, "model-saved");
    expect(mainChatRequest(state).model).toBe("example-fast");
  });
  it("isolates a tab's active request from selection updates and cancellation", () => {
    let state = createTabsState("tabs-new-chat");
    const conversation = Object.values(state.conversations).at(-1)!;
    const id = conversation.id;
    currentWorkspace(conversation.ai).model.selected = "example-reasoning-long";
    state = reduceTabs(state, {
      type: "conversation-thinking",
      id,
      value: "high",
    });
    state = reduceTabs(state, { type: "activity", id, value: "working" });
    state = reduceTabs(state, {
      type: "conversation-thinking",
      id,
      value: "low",
    });
    expect(state.conversations[id]!.run).toEqual({
      connection: "openai",
      model: "example-reasoning-long",
      thinking: "high",
    });
    const pending = cloneAiState(state.conversations[id]!.ai);
    saveModel(pending, "example-fast");
    state = reduceTabs(state, { type: "conversation-ai", id, value: pending });
    state = reduceTabs(state, { type: "activity", id, value: "ready" });
    expect(state.conversations[id]!.run).toBeNull();
    expect(currentWorkspace(state.conversations[id]!.ai).model.phase).toBe(
      "saving",
    );
    applyOutcome(pending, "model-saved");
    state = reduceTabs(state, { type: "conversation-ai", id, value: pending });
    expect(currentWorkspace(state.conversations[id]!.ai).response).toBe("idle");
    state = reduceTabs(state, { type: "activity", id, value: "working" });
    expect(state.conversations[id]!.run).toEqual({
      connection: "openai",
      model: "example-fast",
      thinking: null,
    });
  });
  it("distinguishes unsupported, unknown and unconfigured thinking controls", () => {
    expect(
      settingsThinkingUnavailable(createSettingsState("settings-ai")),
    ).toMatchObject({ label: "Not adjustable" });
    expect(
      settingsThinkingUnavailable(createSettingsState("settings-local")),
    ).toMatchObject({ label: "Unknown" });
    expect(
      settingsThinkingUnavailable(createSettingsState("settings-empty")),
    ).toMatchObject({ label: "No model available" });
  });
});
