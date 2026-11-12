import { describe, expect, it } from "vitest";
import { securityCopy } from "./content";
import {
  acknowledgeWarning,
  cancelWarning,
  gateAccess,
  needsReview,
  restriction,
} from "./security";
import {
  applyOutcome,
  authScreen,
  beginConnection,
  chatGuard,
  chooseMethod,
  chooseProvider,
  cloneAiState,
  createAiState,
  currentWorkspace,
  modelLocked,
  navigate,
  sendMessage,
  startConnection,
  switchWorkspace,
} from "./model";

describe("provider access boundaries", () => {
  it.each(["browser", "copy"])(
    "cannot acknowledge or start prohibited Anthropic %s access",
    (method) => {
      const state = createAiState("settings");
      state.explorationMode = true;
      const previous = cloneAiState(state).workspaces;
      startConnection(state, "settings");
      chooseProvider(state, "anthropic");
      chooseMethod(state, method);
      expect(state.screen).toBe("restriction");
      state.warningChecked = true;
      expect(acknowledgeWarning(state)).toBe(false);
      beginConnection(state);
      applyOutcome(state, "success");
      expect(state.screen).toBe("restriction");
      expect(state.browserOpened).toBe(false);
      cancelWarning(state);
      expect(state.screen).toBe("methods");
      expect(state.workspaces).toEqual(previous);
      chooseMethod(state, "key");
      expect(state.screen).toBe("key");
    },
  );

  it.each(["browser", "device"])(
    "requires own-risk acknowledgement for permitted independent %s access",
    (method) => {
      const state = createAiState("methods");
      state.explorationMode = true;
      chooseProvider(state, "example-orbit");
      chooseMethod(state, method);
      expect(acknowledgeWarning(state)).toBe(false);
      state.warningChecked = true;
      expect(acknowledgeWarning(state)).toBe(true);
      authScreen(state);
      expect(state.screen).toBe(method);
      applyOutcome(state, "success");
      expect(state.screen).toBe("connecting");
      expect(currentWorkspace(state).connection).toBeNull();
      applyOutcome(state, "success");
      expect(currentWorkspace(state).connection?.warningVersion).toBe(
        `orbit-${method}-1`,
      );
      expect(needsReview(state, currentWorkspace(state).connection!)).toBe(
        false,
      );
    },
  );

  it("rechecks a changed warning before existing access without sending or losing drafts on cancellation", () => {
    const state = createAiState("warning-changed");
    const original = cloneAiState(state).workspaces;
    cancelWarning(state);
    navigate(state, "chat");
    sendMessage(state);
    expect(state.handoff).toBe("");
    expect(chatGuard(state)).toBe(securityCopy.guard);
    expect(modelLocked(state)).toBe(true);
    expect(state.workspaces).toEqual(original);
    gateAccess(state, "use");
    state.warningChecked = true;
    expect(acknowledgeWarning(state)).toBe(true);
    expect(state.handoff).toBe("");
    expect(state.screen).toBe("chat");
    expect(chatGuard(state)).toBe("");
    expect(currentWorkspace(state).draft).toBe(original.Personal.draft);
    switchWorkspace(state, "Studio");
    expect(currentWorkspace(state)).toEqual(original.Studio);
  });

  it("does not warn unaffected methods or confuse acknowledgement with permission", () => {
    expect(restriction("anthropic", "key")).toBeNull();
    expect(restriction("example-orbit", "key")).toBeNull();
    expect(restriction("openai", "browser")).toBeNull();
    const state = createAiState("settings");
    currentWorkspace(state).connection = {
      provider: "anthropic",
      method: "browser",
      warningVersion: "anthropic-subscription-1",
    };
    expect(needsReview(state, currentWorkspace(state).connection!)).toBe(true);
    expect(chatGuard(state)).toBe(securityCopy.guard);
  });

  it.each(["locked", "denied", "unavailable"])(
    "preserves the previous connection through secure-store %s and retry",
    (reason) => {
      const state = createAiState("settings");
      const original = cloneAiState(state).workspaces;
      startConnection(state, "settings");
      chooseProvider(state, "anthropic");
      chooseMethod(state, "key");
      state.values.credential = "example-only";
      beginConnection(state);
      applyOutcome(state, `store-save-${reason}`);
      expect(state.screen).toBe(`store-save-${reason}`);
      expect(state.workspaces).toEqual(original);
      state.storeRetry = true;
      applyOutcome(state, "store-ready");
      expect(state.screen).toBe("connecting");
      expect(state.workspaces).toEqual(original);
      applyOutcome(state, "success");
      expect(currentWorkspace(state).connection?.provider).toBe("anthropic");
      expect(state.workspaces.Studio).toEqual(original.Studio);
      expect(state.values).toEqual({});
    },
  );

  it("offers fresh setup on a new device without a copied connection or storage repair", () => {
    const state = createAiState("missing");
    state.storeRetry = true;
    applyOutcome(state, "store-ready");
    expect(currentWorkspace(state).unavailable).toBeNull();
    expect(chatGuard(state)).not.toBe("");
    expect(currentWorkspace(state).connection).toBeNull();
    expect(currentWorkspace(state).history).toHaveLength(2);
  });

  it("ignores a late storage retry after leaving the screen", () => {
    const state = createAiState("locked");
    state.storeRetry = true;
    navigate(state, "local");
    applyOutcome(state, "store-ready");
    expect(currentWorkspace(state).unavailable).toBe("locked");
    expect(state.screen).toBe("local");
  });
});
