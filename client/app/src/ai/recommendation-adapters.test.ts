import { beforeEach, expect, test, vi } from "vitest";
import { connectionModel } from "./model-catalog";
import {
  getStatus,
  selectConversationModel,
  selectConversationThinking,
  type Config,
} from "./api";
import { checkModelAccess } from "../onboarding/model-check";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => {
  vi.resetAllMocks();
});
const scenarios = [
  {
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    api: "anthropic-messages",
    levels: ["low", "medium", "high"],
  },
  {
    provider: "openrouter",
    id: "openai/gpt-6.1-sol",
    api: "openai-completions",
    levels: ["low", "medium", "high"],
  },
  {
    provider: "openrouter",
    id: "openai/gpt-4o-mini",
    api: "openai-completions",
    levels: ["off"],
  },
  {
    provider: "openai",
    id: "gpt-4o-mini",
    api: "openai-responses",
    levels: ["off"],
  },
  {
    provider: "openai-codex",
    id: "gpt-6.1-sol",
    api: "openai-codex-responses",
    levels: ["low", "medium", "high"],
  },
] as const;
for (const scenario of scenarios) {
  const config: Config = {
    provider: scenario.provider,
    endpoint: null,
    auth: scenario.provider === "openai-codex" ? "oauth" : "api_key",
  };
  test(`${scenario.provider}/${scenario.id}: the supported catalog preserves the access protocol and explicit model identity`, () => {
    expect(connectionModel(config, scenario.id)).toMatchObject({
      id: scenario.id,
      provider: scenario.provider,
      api: scenario.api,
    });
  });
  test(`${scenario.provider}/${scenario.id}: native access denial never retries or selects a replacement`, async () => {
    native.invoke.mockRejectedValueOnce("native.ai.access.rejected");
    await expect(checkModelAccess("workspace")).rejects.toBe(
      "native.ai.access.rejected",
    );
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ai_model_check", {
      scope: "workspace",
      requestId: expect.any(String),
    });
  });
  for (const thinking of scenario.levels)
    test(`${scenario.provider}/${scenario.id}/${thinking}: model and thinking choices stay device-local and conversation-scoped`, async () => {
      native.invoke.mockResolvedValue({
        available: true,
        config,
        selectedModel: scenario.id,
        thinkingLevel: thinking,
        modelError: null,
        reason: null,
      });
      await selectConversationModel("workspace", "conversation", scenario.id);
      await selectConversationThinking("workspace", "conversation", thinking);
      expect(await getStatus("workspace", "conversation")).toMatchObject({
        config,
        selectedModel: scenario.id,
        thinkingLevel: thinking,
      });
      expect(native.invoke.mock.calls).toEqual([
        [
          "ai_select_conversation_model",
          {
            scope: "workspace",
            conversation: "conversation",
            model: scenario.id,
          },
        ],
        [
          "ai_select_conversation_thinking",
          { scope: "workspace", conversation: "conversation", thinking },
        ],
        ["ai_status", { scope: "workspace", conversation: "conversation" }],
      ]);
      expect(
        native.invoke.mock.calls.some(([command]) =>
          ["ai_conversation_action", "ai_request", "ai_begin"].includes(
            command,
          ),
        ),
      ).toBe(false);
    });
}
