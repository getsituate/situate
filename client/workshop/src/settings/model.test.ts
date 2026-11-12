import { describe, expect, it } from "vitest";
import {
  openConnection,
  providerStates,
  setProviderState,
  currentProviderState,
  recoverProvider,
  completeProviderRetry,
  updateConnection,
  createSettingsState,
  connectionIssue,
  disconnect,
  initialFormats,
  saveShortcut,
  selectProvider,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import { acknowledgeWarning, cancelWarning, gateAccess } from "../ai/security";
import {
  scenarioCatalog,
  scenarioForState,
} from "../workshop/scenario-catalog";
import { connectionFixtures } from "../ai/scenarios";
import {
  applyOutcome,
  createAiState,
  beginConnection,
  cancelConnection,
  chooseProvider,
  cloneAiState,
  currentWorkspace,
} from "../ai/model";

describe("workspace settings", () => {
  it.each(providerStates)(
    "$id is a state of the provider overview, not a separate screen",
    ({ id }) => {
      const state = createSimulation("settings-error");
      setProviderState(state.settings, id);
      expect(currentProviderState(state.settings)).toBe(id);
      expect(state.feature).toBe("settings");
      expect(state.settings).toMatchObject({
        page: "ai",
        detail: true,
        setup: null,
      });
      expect(screenControls(state).controls).toEqual(["settings"]);
    },
  );
  it("groups provider attention and model preferences under AI settings", () => {
    expect(
      scenarioCatalog
        .filter((item) => item.group === "Settings")
        .map((item) => item.id),
    ).toEqual([
      "updates-notice",
      "release-notes-direct",
      "dictation-download-waiting",
      "settings-appearance",
      "settings-formats",
      "settings-ai",
      "settings-shortcuts",
    ]);
    for (const id of [
      "settings-advanced",
      "settings-empty",
      "settings-error",
    ] as const)
      expect(scenarioForState(id).id).toBe("settings-ai");
  });
  it.each(connectionFixtures)(
    "opens $id inside Settings with its original connection state",
    ({ id, state: preset }) => {
      const simulation = createSimulation(id);
      const settings = simulation.settings;
      const expected = currentWorkspace(createAiState(preset));
      expect(simulation.feature).toBe("settings");
      expect(settings.page).toBe("ai");
      expect(settings.detail).toBe(true);
      if (preset === "missing") {
        expect(settings.setup).toBeNull();
        expect(settings.connected).toEqual([]);
        expect(settings.provider).toBe("");
      } else {
        expect(settings.setup?.origin).toBe("settings");
        expect(currentWorkspace(settings.setup!)).toEqual(expected);
        if (expected.connection)
          expect(settings.connections[settings.setupProvider!]).toEqual(
            expected.connection,
          );
        else expect(settings.connected).toEqual([]);
      }
      expect(screenControls(simulation).controls).toEqual(["settings"]);
      expect(scenarioForState(id).id).toBe("settings-ai");
    },
  );
  it.each(["locked", "store-denied", "store-unavailable"] as const)(
    "recovers %s inline without replacing another connection",
    (id) => {
      const state = createSettingsState("settings-error");
      setProviderState(state, id);
      const other = { ...state.connections.anthropic };
      recoverProvider(state, "openai");
      expect(state.setup).toBeNull();
      expect(state.connectionStates.openai.storeRetry).toBe(true);
      expect(connectionIssue(state, "openai")).toBe(id);
      completeProviderRetry(state, "openai");
      expect(currentProviderState(state)).toBe("ready");
      expect(state.connections.anthropic).toEqual(other);
    },
  );
  it("discards pending fixture work when the provider state changes or resets", () => {
    const state = createSettingsState("settings-error");
    setProviderState(state, "locked");
    recoverProvider(state, "openai");
    setProviderState(state, "missing");
    completeProviderRetry(state, "openai");
    expect(connectionIssue(state, "openai")).toBe("missing");
    expect(state.connectionStates.openai.storeRetry).toBe(false);
    const reset = createSimulation("settings-error");
    expect(currentProviderState(reset.settings)).toBe("reconnect");
  });
  it("keeps the draft and provider guard through closing and acknowledging a changed warning", () => {
    const state = createSettingsState("settings-error");
    setProviderState(state, "restriction");
    recoverProvider(state, "example-orbit");
    const original = cloneAiState(state.setup!);
    const other = { ...state.connections.openai };
    cancelWarning(state.setup!);
    updateConnection(state, state.setup!);
    expect(connectionIssue(state, "example-orbit")).toBe("restriction");
    state.setup = null;
    openConnection(state, "example-orbit", true);
    expect(currentWorkspace(state.setup!).draft).toBe(
      currentWorkspace(original).draft,
    );
    gateAccess(state.setup!, "use");
    state.setup!.warningChecked = true;
    expect(acknowledgeWarning(state.setup!)).toBe(true);
    updateConnection(state, state.setup!);
    expect(connectionIssue(state, "example-orbit")).toBeNull();
    expect(state.unavailable).toBeNull();
    expect(currentWorkspace(state.setup!).draft).toBe(
      "Keep this reading plan.",
    );
    expect(currentWorkspace(state.setup!).history).toEqual(
      currentWorkspace(original).history,
    );
    expect(state.setup!.handoff).toBe("");
    expect(state.connections.openai).toEqual(other);
    state.setup = null;
    openConnection(state, "example-orbit", true);
    expect(connectionIssue(state, "example-orbit")).toBeNull();
  });
  it("keeps local forgetting separate from connection removal and other providers", () => {
    const state = createSettingsState("settings-error");
    setProviderState(state, "locked");
    openConnection(state, "openai", true);
    const other = { ...state.connections.anthropic };
    currentWorkspace(state.setup!).unavailable = "missing";
    state.setup!.screen = "settings";
    updateConnection(state, state.setup!);
    expect(connectionIssue(state, "openai")).toBe("missing");
    expect(state.connections.openai).toBeDefined();
    state.setup = null;
    openConnection(state, "openai", true);
    expect(currentWorkspace(state.setup!).unavailable).toBe("missing");
    currentWorkspace(state.setup!).connection = null;
    updateConnection(state, state.setup!);
    expect(state.connections.openai).toBeUndefined();
    expect(state.connectionStates.openai).toBeUndefined();
    expect(state.provider).toBe("");
    expect(state.connections.anthropic).toEqual(other);
  });
  it("preserves a connection form while another settings category has its own controls", () => {
    let state = createSimulation("settings-ai");
    openConnection(state.settings);
    chooseProvider(state.settings.setup!, "openrouter");
    state.settings.setup!.screen = "key";
    state.settings.setup!.values.credential = "example-key-draft";
    state.settings.page = "formats";
    expect(screenControls(state).label).toBe("Settings · Language & formats");
    expect(screenControls(state).editing).toBe(false);
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.settings.setup!.values.credential).toBe("example-key-draft");
    state.settings.page = "ai";
    expect(screenControls(state).editing).toBe(true);
  });

  it("uses system values independently and falls back only for missing fields", () => {
    expect(initialFormats("de", { time: "12", number: "dot-space" })).toEqual({
      time: "12",
      date: "dmy-dot",
      number: "dot-space",
    });
    expect(initialFormats("en", {})).toEqual({
      time: "12",
      date: "mdy",
      number: "dot-comma",
    });
    const state = createSettingsState();
    state.language = "de";
    expect(state.formats).toEqual({
      time: "24",
      date: "dmy-dot",
      number: "comma-dot",
    });
  });
  it("keeps recommendations and a hidden chat picker as independent defaults", () => {
    const state = createSettingsState();
    expect(state).toMatchObject({
      chatModel: "recommended",
      activityModel: "recommended",
      showModelPicker: false,
      advanced: false,
    });
    state.chatModel = "Claude Sonnet";
    expect(state.showModelPicker).toBe(false);
    selectProvider(state, "openai");
    expect(state.chatModel).toBe("recommended");
    selectProvider(state, "local");
    expect(state.provider).toBe("openai");
  });
  it("never switches providers implicitly on disconnect", () => {
    const state = createSettingsState();
    state.target = "anthropic";
    disconnect(state);
    expect(state.connected).toEqual(["openai"]);
    expect(state.provider).toBe("");
    expect(state.chatModel).toBe("recommended");
  });
  it("uses shared authentication outcomes and ignores completion after leaving setup", () => {
    const state = createSettingsState("settings-empty");
    openConnection(state);
    const setup = cloneAiState(state.setup!);
    chooseProvider(setup, "anthropic");
    beginConnection(setup);
    applyOutcome(setup, "save-error");
    updateConnection(state, setup);
    expect(state.connected).toEqual([]);
    beginConnection(setup);
    applyOutcome(setup, "success");
    updateConnection(state, setup);
    expect(state.provider).toBe("anthropic-1");
    expect(state.connections["anthropic-1"]).toEqual({
      id: "anthropic-1",
      label: "Anthropic",
      provider: "anthropic",
      method: "key",
    });
    openConnection(state);
    const cancelled = cloneAiState(state.setup!);
    chooseProvider(cancelled, "openrouter");
    beginConnection(cancelled);
    cancelConnection(cancelled);
    applyOutcome(cancelled, "success");
    updateConnection(state, cancelled);
    expect(state.connected).toEqual(["anthropic-1"]);
    state.setup = null;
    updateConnection(state, setup);
    expect(state.setup).toBeNull();
  });
  it("keeps existing providers and their models when adding or reconnecting access", () => {
    const state = createSettingsState("settings-advanced");
    openConnection(state, "anthropic");
    expect(state.setup!.screen).toBe("methods");
    expect(currentWorkspace(state.setup!).connection?.provider).toBe(
      "anthropic",
    );
    beginConnection(state.setup!);
    applyOutcome(state.setup!, "success");
    updateConnection(state, state.setup!);
    expect(state.chatModel).toBe("Claude Sonnet");
    openConnection(state);
    chooseProvider(state.setup!, "openrouter");
    beginConnection(state.setup!);
    applyOutcome(state.setup!, "success");
    updateConnection(state, state.setup!);
    expect(state.connected).toEqual(["anthropic", "openai", "openrouter-1"]);
    expect(state.provider).toBe("anthropic");
    expect(state.chatModel).toBe("Claude Sonnet");
  });
  it("preserves bindings on conflicts and allows clearing and restoring", () => {
    const state = createSettingsState();
    state.target = "chat";
    state.shortcutDraft = "Mod+K";
    saveShortcut(state);
    expect(state.shortcutError).toContain("Search workspace");
    expect(state.shortcuts[1]?.keys).toBe("Mod+Shift+N");
    state.shortcutDraft = "";
    saveShortcut(state);
    expect(state.shortcuts[1]?.keys).toBe("");
    state.shortcutDraft = state.shortcuts[1]!.original;
    saveShortcut(state);
    expect(state.shortcuts[1]?.keys).toBe("Mod+Shift+N");
  });
  it("keeps workspace preferences separate when switching open workspaces", () => {
    let state = createSimulation("settings-formats");
    state.settings.formats.time = "12";
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "second", action: "open", id: "sample-2" },
    });
    expect(state.settings.formats.time).toBe("24");
    state.settings.formats.number = "dot-space";
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "first", action: "open", id: "sample-1" },
    });
    expect(state.settings.formats.time).toBe("12");
    expect(state.settings.formats.number).toBe("comma-dot");
  });
  it("keeps settings and drafts across environmental changes and resets pending work", () => {
    let state = createSimulation("settings-ai");
    openConnection(state.settings);
    state.settings.search = "draft";
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.settings.search).toBe("draft");
    expect(screenControls(state)).toMatchObject({
      controls: ["settings"],
      canSetOutcome: false,
      label: "Choose provider",
    });
    state = reduceSimulation(state, { type: "reset" });
    expect(state.settings.setup).toBeNull();
    expect(state.settings.search).toBe("");
    expect(state.snapshot.mobile).toBe(true);
  });
});
