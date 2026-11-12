import { beforeEach, expect, test, vi } from "vitest";
import {
  getStatus,
  refreshModels,
  saveConnection,
  removeConnection,
  listConnections,
  selectConnection,
  forgetConnection,
  renameConnection,
  selectConversationModel,
  selectConversationThinking,
  selectChatModel,
  startCodexLogin,
  waitCodexLogin,
  cancelCodexLogin,
  openCodexLogin,
  waitOpenAiLogin,
  cancelOpenAiLogin,
} from "./api";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
beforeEach(() => {
  vi.resetAllMocks();
  mock.invoke.mockResolvedValue({ available: true });
});
test("status captures conversation identity only when supplied", async () => {
  await getStatus("workspace");
  expect(mock.invoke).toHaveBeenLastCalledWith("ai_status", {
    scope: "workspace",
  });
  await getStatus("workspace", "chat");
  expect(mock.invoke).toHaveBeenLastCalledWith("ai_status", {
    scope: "workspace",
    conversation: "chat",
  });
});
test.each([
  [
    () => refreshModels("workspace", "connection"),
    "ai_refresh_models",
    { scope: "workspace", connectionId: "connection" },
  ],
  [
    () => removeConnection("workspace", "connection"),
    "ai_remove",
    { scope: "workspace", connectionId: "connection" },
  ],
  [
    () => listConnections("workspace"),
    "ai_connections",
    { scope: "workspace" },
  ],
  [
    () => selectConnection("workspace", "connection"),
    "ai_select_connection",
    { scope: "workspace", connectionId: "connection" },
  ],
  [
    () => forgetConnection("workspace", "connection"),
    "ai_forget_connection",
    { scope: "workspace", connectionId: "connection" },
  ],
  [
    () => renameConnection("workspace", "connection", "Local"),
    "ai_rename_connection",
    { scope: "workspace", connectionId: "connection", label: "Local" },
  ],
  [
    () => selectConversationModel("workspace", "chat", null),
    "ai_select_conversation_model",
    { scope: "workspace", conversation: "chat", model: null },
  ],
  [
    () => selectConversationThinking("workspace", "chat", "high"),
    "ai_select_conversation_thinking",
    { scope: "workspace", conversation: "chat", thinking: "high" },
  ],
  [
    () => selectChatModel("workspace", "chosen"),
    "ai_select_model",
    { scope: "workspace", model: "chosen" },
  ],
  [
    () => startCodexLogin("workspace", "connection", "Codex"),
    "ai_codex_start",
    { scope: "workspace", connectionId: "connection", label: "Codex" },
  ],
  [
    () => waitCodexLogin("workspace", "login"),
    "ai_codex_wait",
    { scope: "workspace", id: "login" },
  ],
  [
    () => cancelCodexLogin("workspace", "login"),
    "ai_codex_cancel",
    { scope: "workspace", id: "login" },
  ],
  [
    () => openCodexLogin("workspace", "login"),
    "ai_codex_open",
    { scope: "workspace", id: "login" },
  ],
  [
    () => waitOpenAiLogin("workspace", "login"),
    "ai_openai_wait",
    { scope: "workspace", id: "login" },
  ],
  [
    () => cancelOpenAiLogin("workspace", "login"),
    "ai_openai_cancel",
    { scope: "workspace", id: "login" },
  ],
] as const)("scoped native operation %#", async (call, command, args) => {
  await call();
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith(command, args);
});
test("credentials and optional key access are delegated only to native connection storage", async () => {
  const config = {
    provider: "custom",
    endpoint: "https://example.invalid",
    auth: "api_key" as const,
  };
  await saveConnection("workspace", config, "synthetic-key");
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("ai_save", {
    scope: "workspace",
    config,
    key: "synthetic-key",
  });
});
test("native errors propagate without provider retry, alternate account or transport fallback", async () => {
  mock.invoke.mockRejectedValueOnce(new Error("native.ai.request.failed"));
  await expect(getStatus("workspace", "chat")).rejects.toThrow(
    "native.ai.request.failed",
  );
  expect(mock.invoke).toHaveBeenCalledOnce();
});
