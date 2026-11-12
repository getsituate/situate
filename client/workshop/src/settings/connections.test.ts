import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  beginConnection,
  chooseMethod,
  chooseProvider,
  cloneAiState,
  currentWorkspace,
} from "../ai/model";
import { changePhase, mainChatRequest } from "../chat/model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import {
  cloneSettings,
  connectionName,
  createSettingsState,
  disconnect,
  openConnection,
  renameConnection,
  selectProvider,
  updateConnection,
} from "./model";
import {
  completeModelRefresh,
  connectionCatalog,
  refreshModels,
  savedModelUnavailable,
} from "./catalog";
import { settingsThinking } from "./thinking";

function addKey(
  state: ReturnType<typeof createSettingsState>,
  provider = "openai",
) {
  openConnection(state);
  const setup = cloneAiState(state.setup!);
  chooseProvider(setup, provider);
  chooseMethod(setup, "key");
  setup.values.key = "synthetic-example";
  beginConnection(setup);
  applyOutcome(setup, "success");
  updateConnection(state, setup);
  return state.setupProvider!;
}

describe("independent connections", () => {
  it("adds, labels and reconnects the same provider without replacing another account", () => {
    const state = createSettingsState("settings-advanced");
    const original = structuredClone(state.connections.openai);
    const id = addKey(state);
    expect(id).not.toBe("openai");
    expect(state.connected).toContain("openai");
    expect(state.connections.openai).toEqual(original);
    expect(connectionName(state, id)).toBe("OpenAI 2");
    expect(state.provider).toBe("anthropic");
    expect(state.chatModel).toBe("Claude Sonnet");
    state.target = id;
    state.nameDraft = "Research account";
    renameConnection(state);
    openConnection(state, id);
    chooseMethod(state.setup!, "key");
    beginConnection(state.setup!);
    applyOutcome(state.setup!, "success");
    updateConnection(state, state.setup!);
    expect(state.setupProvider).toBe(id);
    expect(connectionName(state, id)).toBe("Research account");
    expect(state.connections.openai).toEqual(original);
    expect(state.connected).toHaveLength(3);
  });
  it("keeps an existing default name and rejects results from a previously opened connection", () => {
    const state = createSettingsState("settings-ai");
    openConnection(state, "openai");
    chooseMethod(state.setup!, "key");
    beginConnection(state.setup!);
    applyOutcome(state.setup!, "success");
    updateConnection(state, state.setup!);
    expect(connectionName(state, "openai")).toBe("OpenAI");
    const old = cloneAiState(state.setup!);
    openConnection(state, "anthropic");
    const before = cloneSettings(state);
    updateConnection(state, old);
    expect(state).toEqual(before);
  });
  it("requires distinct nonempty names and keeps identity through renaming", () => {
    const state = createSettingsState("settings-connections");
    state.target = "openai-team";
    state.dialog = "rename";
    for (const value of ["", " ", "personal openai", "x".repeat(81)]) {
      state.nameDraft = value;
      renameConnection(state);
      expect(state.nameError).not.toBe("");
      expect(state.dialog).toBe("rename");
    }
    state.nameDraft = " Studio ";
    renameConnection(state);
    expect(state.connections["openai-team"]).toMatchObject({
      id: "openai-team",
      label: "Studio",
      method: "browser",
    });
    expect(state.dialog).toBeNull();
  });
  it("retains separate defaults and method-specific model availability", () => {
    const state = createSettingsState("settings-connections");
    state.chatModel = "Example Reasoning";
    expect(settingsThinking(state)?.capability.levels).toEqual([
      "low",
      "medium",
      "high",
    ]);
    selectProvider(state, "openai-team");
    expect(connectionCatalog(state).models).toEqual(["GPT Chat"]);
    expect(state.chatModel).toBe("recommended");
    expect(settingsThinking(state)).toBeUndefined();
    selectProvider(state, "openai");
    expect(state.chatModel).toBe("Example Reasoning");
    selectProvider(state, "local-desk");
    state.chatModel = "desk-model";
    selectProvider(state, "local-lab");
    state.chatModel = "lab-model";
    selectProvider(state, "local-desk");
    expect(state.chatModel).toBe("desk-model");
  });
  it("removes only the selected connection without falling back to another account", () => {
    const state = createSettingsState("settings-connections");
    state.target = "openai";
    disconnect(state);
    expect(state.provider).toBe("");
    expect(state.connected).toContain("openai-team");
    expect(state.connections["openai-team"]?.method).toBe("browser");
    expect(state.useManaged).toBe(false);
  });
  it("binds inherited next requests to an explicit connection change, not an active request", () => {
    let state = createSimulation("chat-complete");
    state.chat.draft = "Keep this draft";
    state.chat = changePhase(state.chat, "working");
    const active = mainChatRequest(state.chat);
    const next = cloneSettings(state.settings);
    const id = addKey(next);
    selectProvider(next, id);
    state = reduceSimulation(state, { type: "settings", state: next });
    expect(currentWorkspace(state.chat.ai).connection?.id).toBe(id);
    expect(mainChatRequest(state.chat)).toEqual(active);
    expect(active.connection).toBe("openai");
    state.chat = changePhase(state.chat, "complete");
    expect(mainChatRequest(state.chat).connection).toBe(id);
    expect(state.chat.draft).toBe("Keep this draft");
  });
});

describe("connection model discovery", () => {
  it("keeps choices through refresh failure, unknown discovery and exclusion", () => {
    const state = createSettingsState("settings-connections");
    state.chatModel = "GPT Mini";
    state.activityModel = "Example Reasoning";
    for (const outcome of ["error", "unknown", "excluded"] as const) {
      refreshModels(state);
      completeModelRefresh(
        state,
        state.provider,
        connectionCatalog(state).request,
        outcome,
      );
      expect(state.chatModel).toBe("GPT Mini");
      expect(state.activityModel).toBe("Example Reasoning");
      expect(state.provider).toBe("openai");
    }
    expect(savedModelUnavailable(state)).toBe(true);
    expect(state.connections.openai).toBeDefined();
  });
  it("isolates accounts, rejects obsolete completions and cannot resurrect removed connections", () => {
    const state = createSettingsState("settings-connections");
    refreshModels(state);
    const first = connectionCatalog(state).request;
    selectProvider(state, "openai-team");
    refreshModels(state);
    completeModelRefresh(state, "openai", first, "empty");
    expect(connectionCatalog(state, "openai").models).toEqual([]);
    expect(connectionCatalog(state).status).toBe("loading");
    const second = connectionCatalog(state).request;
    completeModelRefresh(state, "openai-team", first, "empty");
    expect(connectionCatalog(state).status).toBe("loading");
    completeModelRefresh(state, "openai-team", second, "ready");
    expect(connectionCatalog(state).models).toEqual(["GPT Chat"]);
    refreshModels(state);
    const removed = connectionCatalog(state).request;
    state.target = "openai-team";
    disconnect(state);
    completeModelRefresh(state, "openai-team", removed, "ready");
    expect(state.catalogs["openai-team"]).toBeUndefined();
    expect(state.connections["openai-team"]).toBeUndefined();
  });
  it("retains the connection and blocks inherited chat when discovery finds no models", () => {
    let state = createSimulation("chat-complete");
    const next = cloneSettings(state.settings);
    refreshModels(next);
    completeModelRefresh(
      next,
      next.provider,
      connectionCatalog(next).request,
      "empty",
    );
    state = reduceSimulation(state, { type: "settings", state: next });
    expect(currentWorkspace(state.chat.ai).connection).not.toBeNull();
    expect(currentWorkspace(state.chat.ai).model.count).toBe("zero");
    expect(changePhase(state.chat, "working").phase).toBe("complete");
    expect(state.settings.chatModel).toBe("recommended");
  });
  it("resets pending discovery and names but preserves them on environment changes", () => {
    let state = createSimulation("settings-connections");
    state.settings.nameDraft = "Draft label";
    refreshModels(state.settings);
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(connectionCatalog(state.settings).status).toBe("loading");
    expect(state.settings.nameDraft).toBe("Draft label");
    state = reduceSimulation(state, { type: "reset" });
    expect(connectionCatalog(state.settings).status).toBe("ready");
    expect(state.settings.nameDraft).toBe("");
  });
});
