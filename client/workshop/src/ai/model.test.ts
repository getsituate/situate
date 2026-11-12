import { describe, expect, it } from "vitest";
import { authFields, validateAuth } from "./fields";
import { providers } from "./providers";
import { aiFixtures } from "./scenarios";
import {
  aiConnected,
  aiSetup,
  applyOutcome,
  authScreen,
  availableOutcomes,
  beginConnection,
  cancelConnection,
  chatGuard,
  chooseMethod,
  chooseProvider,
  createAiState,
  currentWorkspace,
  eligibleModels,
  modelAction,
  modelLocked,
  navigate,
  saveModel,
  sendMessage,
  startConnection,
  switchWorkspace,
} from "./model";

import { acknowledgeWarning, visibleRestriction } from "./security";

describe("AI connection and model state", () => {
  it("keeps authentication, connection and chat fixtures serializable", () => {
    expect(aiFixtures.map((item) => item.state)).toEqual([
      "warning",
      "warning-device",
      "warning-changed",
      "blocked-subscription",
      "session-replacement",
      "missing",
      "store-denied",
      "store-unavailable",
      "source",
      "access-denied",
      "offer",
      "providers",
      "methods",
      "key",
      "browser",
      "copy-code",
      "device",
      "cloud",
      "endpoint",
      "advanced",
      "connecting",
      "success",
      "cancelled",
      "denied",
      "expired",
      "offline",
      "save-error",
      "settings",
      "reconnect",
      "restored",
      "locked",
      "capability",
      "unsupported",
    ]);
    for (const fixture of aiFixtures) {
      expect(fixture.id).toBe(`ai-${fixture.state}`);
      const state = createAiState(fixture.state);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      expect(createAiState(fixture.id)).toEqual(state);
      expect(aiSetup(state)).toBe(
        ![
          "chat",
          "settings",
          "restored",
          "reconnect",
          "locked",
          "capability",
        ].includes(state.screen),
      );
    }
  });
  it("keeps all 45 providers and the synthetic provider with method-specific gates", () => {
    expect(providers).toHaveLength(46);
    for (const provider of providers)
      for (const method of [
        ...provider.methods,
        ...(provider.methods.includes("key") || provider.id === "amazon-bedrock"
          ? ["environment", "command"]
          : []),
      ]) {
        const state = createAiState("providers");
        state.explorationMode = true;
        chooseProvider(state, provider.id);
        chooseMethod(state, method);
        if (state.screen === "restriction") {
          if (visibleRestriction(state)?.blocked) {
            state.warningChecked = true;
            expect(acknowledgeWarning(state)).toBe(false);
            beginConnection(state);
            expect(state.screen).toBe("restriction");
            expect(currentWorkspace(state).connection).toBeNull();
            continue;
          }
          state.warningChecked = true;
          expect(acknowledgeWarning(state)).toBe(true);
          authScreen(state);
        }
        expect([
          "key",
          "cloud",
          "browser",
          "copy-code",
          "device",
          "endpoint",
          "advanced",
        ]).toContain(state.screen);
        expect(currentWorkspace(state).model.selected).toBeNull();
        for (const field of authFields(state))
          state.values[field.id] =
            field.options?.[0].id ||
            (field.type === "url"
              ? "https://example.invalid/v1"
              : "example-only");
        expect(validateAuth(state)).toBe(true);
        if (state.screen === "device") state.deviceIssued = true;
        if (
          state.screen === "copy-code" ||
          !["browser", "device"].includes(state.screen)
        )
          beginConnection(state);
        else {
          applyOutcome(state, "success");
          expect(state.screen).toBe("connecting");
          expect(currentWorkspace(state).connection).toBeNull();
        }
        applyOutcome(state, "success");
        expect(currentWorkspace(state).connection?.provider).toBe(provider.id);
        expect(currentWorkspace(state).connection?.method).toBe(method);
        expect(currentWorkspace(state).model.selected).toBeNull();
        expect(state.values).toEqual({});
      }
  });
  it("validates cloud source fields, optional URL overrides and browser codes", () => {
    const state = createAiState("key");
    state.explorationMode = true;
    expect(validateAuth(state)).toBe(false);
    expect(state.invalidField).toBe("credential");
    state.values.credential = "example-only";
    state.values["base-override"] = "not a URL";
    expect(validateAuth(state)).toBe(false);
    expect(state.invalidField).toBe("base-override");
    chooseProvider(state, "amazon-bedrock");
    chooseMethod(state, "chain");
    for (const [source, required] of [
      ["iam", ["access-id", "credential"]],
      ["ecs", ["container-uri"]],
      ["web", ["file", "role"]],
      ["existing", []],
    ] as const) {
      state.values = { "aws-source": source };
      expect(
        authFields(state)
          .filter((field) => field.required && !field.options)
          .map((field) => field.id),
      ).toEqual(required);
    }
    const copy = createAiState("copy-code");
    expect(copy.screen).toBe("copy-code");
    expect(availableOutcomes(copy).some((item) => item.id === "success")).toBe(
      false,
    );
    expect(validateAuth(copy)).toBe(false);
    copy.values.code = "example-code";
    expect(validateAuth(copy)).toBe(true);
    applyOutcome(copy, "success");
    expect(copy.screen).toBe("copy-code");
    beginConnection(copy);
    expect(copy.screen).toBe("connecting");
    expect(currentWorkspace(copy).connection).toBeNull();
    applyOutcome(copy, "success");
    expect(currentWorkspace(copy).connection).toMatchObject({
      provider: "openrouter",
      method: "browser",
    });
  });
  it("requires a device challenge before approval and two stages before a saved connection", () => {
    const state = createAiState("providers");
    state.explorationMode = true;
    chooseProvider(state, "github-copilot");
    chooseMethod(state, "device");
    applyOutcome(state, "success");
    expect(state.screen).toBe("device");
    expect(aiConnected(state)).toBe(false);
    state.deviceIssued = true;
    applyOutcome(state, "success");
    expect(state.screen).toBe("connecting");
    expect(aiConnected(state)).toBe(false);
    applyOutcome(state, "success");
    expect(state.screen).toBe("success");
    expect(aiConnected(state)).toBe(true);
  });
  it.each(["denied", "expired", "offline", "save-error", "unsupported"])(
    "retains the old connection on %s and only replaces after success",
    (outcome) => {
      const state = createAiState("settings");
      startConnection(state, "settings");
      chooseProvider(state, "anthropic");
      chooseMethod(state, "key");
      state.values.credential = "example-only";
      beginConnection(state);
      applyOutcome(state, outcome);
      expect(currentWorkspace(state).connection).toEqual({
        provider: "openai",
        method: "key",
      });
      if (outcome === "save-error") beginConnection(state);
      else {
        authScreen(state);
        beginConnection(state);
      }
      applyOutcome(state, "success");
      expect(currentWorkspace(state).connection).toEqual({
        provider: "anthropic",
        method: "key",
      });
    },
  );
  it("rejects cancelled, abandoned and stale returns even during a newer attempt", () => {
    const state = createAiState("browser"),
      attempt = state.attempt;
    state.values.code = "example-private-value";
    cancelConnection(state);
    applyOutcome(state, "success", attempt);
    expect(state.screen).toBe("cancelled");
    expect(state.values).toEqual({});
    expect(aiConnected(state)).toBe(false);
    authScreen(state);
    applyOutcome(state, "success", attempt);
    expect(state.screen).toBe("browser");
    applyOutcome(state, "success");
    expect(state.screen).toBe("connecting");
    navigate(state, "local");
    applyOutcome(state, "success");
    expect(state.screen).toBe("local");
    expect(aiConnected(state)).toBe(false);
  });
  it("keeps drafts, notes, model and connections independent through switching and reopening", () => {
    const state = createAiState("chat-existing");
    const personal = currentWorkspace(state);
    personal.draft = "Personal draft";
    personal.note = "Personal note";
    switchWorkspace(state, "Studio");
    expect(currentWorkspace(state).model.selected).toBe("example-studio");
    currentWorkspace(state).draft = "Studio draft";
    navigate(state, "chat");
    expect(eligibleModels(state).map((item) => item.id)).toEqual([
      "example-studio",
    ]);
    applyOutcome(state, "reopen");
    expect(state.screen).toBe("restored");
    switchWorkspace(state, "Personal");
    navigate(state, "chat");
    expect(currentWorkspace(state)).toEqual(personal);
    expect(state.workspaces.Studio.draft).toBe("Studio draft");
  });
  it.each([
    "chat",
    "chat-zero",
    "chat-disconnected",
    "chat-loading",
    "chat-load-error",
    "chat-saving",
    "chat-save-error",
    "chat-uncertain",
    "chat-unavailable",
    "chat-streaming",
    "chat-unsaved",
  ])("guards sending from %s without discarding or navigating", (fixture) => {
    const state = createAiState(fixture),
      before = JSON.stringify(currentWorkspace(state));
    sendMessage(state);
    expect(state.sendStatus).toContain("Message not sent.");
    expect(state.screen).toBe("chat");
    expect(JSON.stringify(currentWorkspace(state))).toBe(before);
  });
  it("filters by provider, method, capabilities and platform without silently replacing a saved ID", () => {
    const state = createAiState("chat-new");
    expect(eligibleModels(state).map((item) => item.id)).toEqual([
      "example-chat",
      "example-fast",
      "example-reasoning-long",
      "example-desktop",
    ]);
    currentWorkspace(state).connection!.method = "browser";
    expect(eligibleModels(state).map((item) => item.id)).toEqual([
      "example-chat",
    ]);
    currentWorkspace(state).connection!.method = "key";
    saveModel(state, "example-desktop");
    applyOutcome(state, "model-saved");
    const draft = currentWorkspace(state).draft;
    state.mobile = true;
    expect(eligibleModels(state).map((item) => item.id)).toEqual([
      "example-chat",
      "example-fast",
      "example-reasoning-long",
    ]);
    expect(currentWorkspace(state).model.selected).toBe("example-desktop");
    expect(chatGuard(state)).toContain("unavailable");
    expect(modelLocked(state)).toBe(false);
    state.mobile = false;
    expect(chatGuard(state)).toBe("");
    expect(currentWorkspace(state).draft).toBe(draft);
  });
  it.each(["model-confirmed-new", "model-confirmed-previous"])(
    "waits for readback and handles %s without inferring rollback",
    (outcome) => {
      const state = createAiState("chat-existing"),
        { draft, history } = currentWorkspace(state);
      saveModel(state, "example-fast");
      applyOutcome(state, "model-save-uncertain");
      expect(currentWorkspace(state).model.selected).toBe("example-chat");
      expect(chatGuard(state)).toContain("could not be confirmed");
      expect(modelLocked(state)).toBe(true);
      modelAction(state, "discard");
      expect(currentWorkspace(state).model.phase).toBe("uncertain");
      applyOutcome(state, outcome);
      expect(currentWorkspace(state).model.phase).toBe("uncertain");
      modelAction(state, "check");
      applyOutcome(state, outcome);
      expect(currentWorkspace(state).model.selected).toBe(
        outcome === "model-confirmed-new" ? "example-fast" : "example-chat",
      );
      expect(currentWorkspace(state).draft).toBe(draft);
      expect(currentWorkspace(state).history).toEqual(history);
      expect(chatGuard(state)).toBe("");
      expect(state.sendStatus).toBe("");
    },
  );
  it("retries or discards confirmed failures, including a first choice", () => {
    const state = createAiState("chat-new");
    saveModel(state, "example-chat");
    applyOutcome(state, "model-save-error");
    expect(currentWorkspace(state).model.selected).toBeNull();
    modelAction(state, "discard");
    expect(currentWorkspace(state).model.pending).toBeNull();
    saveModel(state, "example-chat");
    applyOutcome(state, "model-save-error");
    modelAction(state, "retry");
    applyOutcome(state, "model-saved");
    expect(chatGuard(state)).toBe("");
    sendMessage(state);
    expect(state.sendStatus).toBe("Ready to send.");
  });
  it("keeps response persistence separate from next-message selection persistence", () => {
    const state = createAiState("chat-streaming");
    saveModel(state, "example-fast");
    expect(currentWorkspace(state).model.selected).toBe("example-chat");
    applyOutcome(state, "model-response-saved");
    expect(currentWorkspace(state).response).toBe("streaming");
    applyOutcome(state, "model-response-finished");
    expect(currentWorkspace(state).response).toBe("unsaved");
    expect(currentWorkspace(state).model.phase).toBe("saving");
    expect(modelLocked(state)).toBe(true);
    applyOutcome(state, "model-saved");
    expect(modelLocked(state)).toBe(false);
    expect(chatGuard(state)).toContain("Save the response");
    saveModel(state, "example-chat");
    applyOutcome(state, "model-response-saved");
    expect(currentWorkspace(state).response).toBe("idle");
    expect(currentWorkspace(state).model.phase).toBe("saving");
    applyOutcome(state, "model-saved");
    expect(chatGuard(state)).toBe("");
  });
  it("accepts explicit custom IDs without inventing catalog access", () => {
    const state = createAiState("chat-custom");
    expect(eligibleModels(state)).toEqual([]);
    saveModel(state, "   ");
    expect(currentWorkspace(state).model.phase).toBe("ready");
    saveModel(state, " custom/model ");
    expect(currentWorkspace(state).model.pending).toBe("custom/model");
    expect(chatGuard(state)).toContain("Saving");
    applyOutcome(state, "model-saved");
    expect(chatGuard(state)).toBe("");
  });
  it("only offers outcomes for the current pending operation", () => {
    expect(availableOutcomes(createAiState("offer"))).toEqual([]);
    expect(availableOutcomes(createAiState("chat-uncertain"))).toEqual([]);
    expect(
      availableOutcomes(createAiState("chat-loading")).map((item) => item.id),
    ).toEqual(["model-loaded", "model-load-error"]);
    const state = createAiState("chat-loading");
    applyOutcome(state, "model-load-error");
    modelAction(state, "reload");
    applyOutcome(state, "model-loaded");
    expect(currentWorkspace(state).model.phase).toBe("ready");
    expect(availableOutcomes(state)).toEqual([]);
  });
});
