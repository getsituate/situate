import { describe, expect, it } from "vitest";
import { availableMethods, availableProviders } from "./providers";
import {
  createAiState,
  chooseMethod,
  chooseProvider,
  currentWorkspace,
  eligibleModels,
} from "./model";
import { authFields } from "./fields";

describe("provider inventory", () => {
  it("offers only MVP providers and authentication by default", () => {
    expect(
      availableProviders()
        .map((item) => item.id)
        .sort(),
    ).toEqual([
      "anthropic",
      "compatible",
      "llama.cpp",
      "openai",
      "openai-codex",
      "openrouter",
    ]);
    expect(availableMethods("openai")).toEqual(["browser", "key"]);
    expect(availableMethods("openai-codex")).toEqual(["device"]);
    for (const provider of ["anthropic", "openrouter"])
      expect(availableMethods(provider)).toEqual(["key"]);
    for (const provider of ["compatible", "llama.cpp"])
      expect(availableMethods(provider)).toEqual(["none", "key"]);
    const state = createAiState("providers");
    chooseProvider(state, "openai-codex");
    chooseMethod(state, "browser");
    expect(state.screen).toBe("methods");
    chooseMethod(state, "device");
    expect(state.screen).toBe("device");
    expect(authFields(createAiState("key")).map((field) => field.id)).toEqual([
      "credential",
    ]);
  });
  it("filters refreshed membership without changing eligibility, ranking or response state", () => {
    const state = createAiState("chat-streaming");
    const workspace = currentWorkspace(state);
    const original = structuredClone(workspace);
    const initial = eligibleModels(state).map((item) => item.id);
    expect(initial).toContain("example-chat");
    expect(initial).toContain("example-fast");
    workspace.catalogModelIds = [
      "example-fast",
      "example-chat",
      "example-studio",
      "example-image",
      "unknown",
    ];
    expect(eligibleModels(state).map((item) => item.id)).toEqual([
      "example-chat",
      "example-fast",
    ]);
    expect(state.workspaces.Studio.catalogModelIds).toBeUndefined();
    workspace.catalogModelIds = [];
    expect(eligibleModels(state)).toEqual([]);
    delete workspace.catalogModelIds;
    expect(eligibleModels(state).map((item) => item.id)).toEqual(initial);
    expect(workspace).toEqual(original);
  });
  it("keeps deferred fixtures behind explicit exploration state", () => {
    expect(availableProviders(true)).toHaveLength(46);
    for (const preset of [
      "cloud",
      "device",
      "advanced",
      "warning",
      "warning-device",
      "blocked-subscription",
      "session-replacement",
    ])
      expect(createAiState(preset).explorationMode).toBe(true);
    expect(createAiState("providers").explorationMode).toBe(false);
    const state = createAiState("providers");
    chooseProvider(state, "example-orbit");
    expect(state.provider).toBe("openai");
    state.explorationMode = true;
    chooseProvider(state, "example-orbit");
    expect(state.provider).toBe("example-orbit");
  });
  it.each([
    ["openai-codex", "device", "example-codex"],
    ["openrouter", "key", "example-router"],
  ])("provides synthetic eligible models for %s", (provider, method, id) => {
    const state = createAiState();
    currentWorkspace(state).connection = { provider, method };
    expect(eligibleModels(state).map((item) => item.id)).toEqual([id]);
  });
});
