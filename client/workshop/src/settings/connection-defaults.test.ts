import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  beginConnection,
  chooseMethod,
  chatGuard,
  currentWorkspace,
  createAiState,
  modelAction,
  saveModel,
} from "../ai/model";
import { modelIssue } from "../chat/model-issue";
import {
  createSimulation,
  reduceSimulation,
  type Simulation,
} from "../workshop/simulation";
import {
  cloneSettings,
  disconnect,
  openConnection,
  selectProvider,
  updateConnection,
} from "./model";
import {
  completeModelRefresh,
  connectionCatalog,
  refreshModels,
} from "./catalog";

function selectAnthropic(state: Simulation): Simulation {
  const next = cloneSettings(state.settings);
  next.connections.anthropic = {
    id: "anthropic",
    label: "Reading account",
    provider: "anthropic",
    method: "key",
  };
  if (!next.connected.includes("anthropic")) next.connected.push("anthropic");
  selectProvider(next, "anthropic");
  return reduceSimulation(state, { type: "settings", state: next });
}
function chatOutcome(state: Simulation, outcome: string): Simulation {
  const chat = structuredClone(state.chat);
  applyOutcome(chat.ai, outcome);
  return reduceSimulation(state, { type: "chat", state: chat });
}
describe("inherited connection reconciliation", () => {
  it("does not treat an unavailable-access example as confirmed inheritance", () => {
    let state = createSimulation("chat-complete");
    saveModel(state.chat.ai, "example-fast");
    applyOutcome(state.chat.ai, "model-saved");
    const chat = { ...state.chat, ai: createAiState("chat-disconnected") };
    state = reduceSimulation(state, { type: "chat", state: chat });
    expect(chatGuard(state.chat.ai)).not.toBe("");
    expect(modelIssue(state.chat.ai)?.kind).toBe("access");
  });
  it("uses the selected provider for a newly created conversation", () => {
    let state = selectAnthropic(createSimulation("tabs-single-topic"));
    const known = new Set(Object.keys(state.tabs.conversations));
    state = reduceSimulation(state, {
      type: "tabs",
      action: { type: "new-conversation" },
    });
    const added = Object.values(state.tabs.conversations).find(
      (item) => !known.has(item.id),
    )!;
    expect(added).toBeDefined();
    expect(currentWorkspace(added.ai).connection?.id).toBe("anthropic");
    expect(currentWorkspace(added.ai).defaultModel).toBe("recommended");
    expect(chatGuard(added.ai)).toBe("");
  });
  it("keeps an override bound to its account and restores the current default after clearing it", () => {
    let state = createSimulation("chat-complete");
    saveModel(state.chat.ai, "example-fast");
    applyOutcome(state.chat.ai, "model-saved");
    state.chat.draft = "Keep the draft";
    state = selectAnthropic(state);
    expect(currentWorkspace(state.chat.ai).connection?.provider).toBe("openai");
    const chat = structuredClone(state.chat);
    saveModel(chat.ai, null);
    state = reduceSimulation(state, { type: "chat", state: chat });
    state = chatOutcome(state, "model-saved");
    expect(currentWorkspace(state.chat.ai).connection?.id).toBe("anthropic");
    expect(currentWorkspace(state.chat.ai).model.selected).toBeNull();
    expect(state.chat.draft).toBe("Keep the draft");
    expect(chatGuard(state.chat.ai)).toBe("");
  });
  it.each(["empty", "error"] as const)(
    "does not carry %s discovery into another connection",
    (outcome) => {
      let state = createSimulation("chat-complete");
      const next = cloneSettings(state.settings);
      refreshModels(next);
      completeModelRefresh(
        next,
        next.provider,
        connectionCatalog(next).request,
        outcome,
      );
      state = reduceSimulation(state, { type: "settings", state: next });
      expect(chatGuard(state.chat.ai)).not.toBe("");
      state = selectAnthropic(state);
      expect(currentWorkspace(state.chat.ai).model.phase).toBe("ready");
      expect(currentWorkspace(state.chat.ai).model.count).toBe("many");
      expect(chatGuard(state.chat.ai)).toBe("");
    },
  );
  it.each(["key", "browser"])(
    "drops an obsolete empty catalog after reconnecting with %s",
    (method) => {
      let state = createSimulation("chat-complete");
      let next = cloneSettings(state.settings);
      refreshModels(next);
      completeModelRefresh(
        next,
        next.provider,
        connectionCatalog(next).request,
        "empty",
      );
      state = reduceSimulation(state, { type: "settings", state: next });
      expect(chatGuard(state.chat.ai)).not.toBe("");
      next = cloneSettings(state.settings);
      openConnection(next, next.provider);
      chooseMethod(next.setup!, method);
      beginConnection(next.setup!);
      applyOutcome(next.setup!, "success");
      updateConnection(next, next.setup!);
      state = reduceSimulation(state, { type: "settings", state: next });
      expect(state.settings.catalogs.openai).toBeUndefined();
      expect(currentWorkspace(state.chat.ai).catalogModelIds).toBeUndefined();
      expect(currentWorkspace(state.chat.ai).connection?.method).toBe(method);
      expect(currentWorkspace(state.chat.ai).model.count).toBe("many");
      expect(chatGuard(state.chat.ai)).toBe("");
    },
  );
  it("admits an available replacement after exclusion without a second refresh", () => {
    let state = createSimulation("chat-complete");
    let next = cloneSettings(state.settings);
    next.chatModel = "GPT Mini";
    refreshModels(next);
    completeModelRefresh(
      next,
      next.provider,
      connectionCatalog(next).request,
      "excluded",
    );
    state = reduceSimulation(state, { type: "settings", state: next });
    expect(currentWorkspace(state.chat.ai).model.phase).toBe("unavailable");
    next = cloneSettings(state.settings);
    next.chatModel = "GPT Chat";
    state = reduceSimulation(state, { type: "settings", state: next });
    expect(currentWorkspace(state.chat.ai).model.phase).toBe("ready");
    expect(chatGuard(state.chat.ai)).toBe("");
  });
  it("can explicitly return a removed account's override to inheritance through uncertain save recovery", () => {
    let state = createSimulation("chat-complete");
    state.chat.draft = "Keep this conversation";
    saveModel(state.chat.ai, "example-fast");
    applyOutcome(state.chat.ai, "model-saved");
    const next = cloneSettings(state.settings);
    next.target = "openai";
    disconnect(next);
    state = reduceSimulation(state, { type: "settings", state: next });
    state = selectAnthropic(state);
    expect(chatGuard(state.chat.ai)).not.toBe("");
    expect(modelIssue(state.chat.ai)?.actions.map((item) => item.id)).toContain(
      "inherit",
    );
    let chat = structuredClone(state.chat);
    modelAction(chat.ai, "inherit");
    state = reduceSimulation(state, { type: "chat", state: chat });
    state = chatOutcome(state, "model-save-uncertain");
    expect(modelIssue(state.chat.ai)?.kind).toBe("uncertain");
    expect(currentWorkspace(state.chat.ai).connection?.provider).toBe("openai");
    chat = structuredClone(state.chat);
    modelAction(chat.ai, "check");
    state = reduceSimulation(state, { type: "chat", state: chat });
    state = chatOutcome(state, "model-confirmed-new");
    expect(currentWorkspace(state.chat.ai).connection?.id).toBe("anthropic");
    expect(chatGuard(state.chat.ai)).toBe("");
    expect(state.chat.draft).toBe("Keep this conversation");
  });
});
