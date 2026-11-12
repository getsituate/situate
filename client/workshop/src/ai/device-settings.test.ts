import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  beginConnection,
  chooseMethod,
  createAiState,
  currentWorkspace,
  sendMessage,
} from "./model";
import { availableOutcomes } from "./model";
import { footerActions } from "./content";
import {
  createSettingsState,
  disconnect,
  selectProvider,
} from "../settings/model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";

describe("device-local AI choices", () => {
  it.each(["browser", "device"])(
    "blocks session-displacing %s before any authorization",
    (method) => {
      const state = createAiState("session-replacement");
      const workspaces = structuredClone(state.workspaces);
      chooseMethod(state, method);
      expect(state.screen).toBe("session-unavailable");
      beginConnection(state);
      applyOutcome(state, "success");
      expect(state.screen).toBe("session-unavailable");
      expect(state.browserOpened).toBe(false);
      expect(availableOutcomes(state)).toEqual([]);
      expect(footerActions(state).map((item) => item.action)).toEqual([
        "settings",
        "methods",
      ]);
      expect(state.workspaces).toEqual(workspaces);
      chooseMethod(state, "key");
      expect(state.screen).toBe("key");
    },
  );

  it.each(["chat-synced", "chat-unconfigured", "chat-saving"])(
    "receives history without adopting the sending device's access in %s",
    (preset) => {
      const state = createAiState(preset);
      const before = structuredClone(currentWorkspace(state));
      applyOutcome(state, "conversation-synced");
      const current = currentWorkspace(state);
      expect(current.history).toHaveLength(before.history.length + 1);
      expect(current).not.toHaveProperty("historySources");
      expect(current.connection).toEqual(before.connection);
      expect(current.model).toEqual(before.model);
      expect(current.draft).toBe(before.draft);
      if (preset === "chat-unconfigured") {
        sendMessage(state);
        expect(state.sendStatus).toContain("Message not sent");
        expect(state.handoff).toBe("");
      }
    },
  );

  it("makes managed availability independent from selection and retains local preferences", () => {
    const state = createSettingsState("settings-local");
    selectProvider(state, "situate");
    expect(state.useManaged).toBe(false);
    const local = structuredClone(state.connections);
    state.managedAvailable = true;
    expect(state.provider).toBe("llama.cpp");
    expect(state.chatModel).toBe("Local Chat");
    expect(state.useManaged).toBe(false);
    selectProvider(state, "situate");
    expect(state.useManaged).toBe(true);
    expect(state.connections).toEqual(local);
    state.managedAvailable = false;
    expect(state.useManaged).toBe(true);
    selectProvider(state, "llama.cpp");
    expect(state.useManaged).toBe(false);
    expect(state.chatModel).toBe("Local Chat");
  });

  it("shares account availability across workspaces without sharing their access choices", () => {
    let state = createSimulation("settings-managed");
    selectProvider(state.settings, "situate");
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "second", action: "open", id: "sample-2" },
    });
    expect(state.settings.managedAvailable).toBe(true);
    expect(state.settings.useManaged).toBe(false);
    expect(state.settings.provider).toBe("anthropic");
    state.settings.managedAvailable = false;
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "first", action: "open", id: "sample-1" },
    });
    expect(state.settings.managedAvailable).toBe(false);
    expect(state.settings.useManaged).toBe(true);
    expect(state.settings.chatModel).toBe("Local Chat");
  });

  it("does not fall back to available managed access when the local provider is removed", () => {
    const state = createSettingsState("settings-managed");
    state.target = "llama.cpp";
    disconnect(state);
    expect(state.provider).toBe("");
    expect(state.managedAvailable).toBe(true);
    expect(state.useManaged).toBe(false);
  });

  it("keeps local choices through viewport changes and resets them only with the starting state", () => {
    let simulation = createSimulation("settings-managed");
    selectProvider(simulation.settings, "situate");
    simulation = reduceSimulation(simulation, {
      type: "platform",
      mobile: true,
    });
    expect(simulation.settings.useManaged).toBe(true);
    expect(simulation.settings.chatModel).toBe("Local Chat");
    simulation = reduceSimulation(simulation, { type: "reset" });
    expect(simulation.settings.useManaged).toBe(false);
    expect(simulation.settings.managedAvailable).toBe(true);
    expect(simulation.settings.provider).toBe("llama.cpp");
  });
});
