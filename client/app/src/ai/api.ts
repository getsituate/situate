import { invoke } from "@tauri-apps/api/core";
import { diagnosticsFor } from "../diagnostics";

export interface Config {
  provider: string;
  endpoint: string | null;
  auth?: "api_key" | "oauth";
  connectionId?: string;
  label?: string;
  httpAcknowledgement?: string;
}
export interface ModelCatalog {
  source: "account" | "provider" | "static" | "unknown";
  models: string[];
}
export interface Status {
  catalog?: ModelCatalog;
  config: Config | null;
  available: boolean;
  reason: string | null;
  selectedModel: string | null;
  modelError: string | null;
  modelInherited?: boolean;
  modelPreference?: string | null;
  thinkingInherited?: boolean;
  thinkingPreference?: string | null;
  thinkingLevel?: string | null;
  inheritedThinkingLevel?: string | null;
  recommendedThinkingLevel?: string | null;
}
export { attachmentImageSource } from "./attachment-runtime";
export const loadModelCatalog = () => import("./model-catalog");

export const getStatus = (
  scope: string,
  conversation?: string,
): Promise<Status> =>
  invoke("ai_status", { scope, ...(conversation ? { conversation } : {}) });
export const refreshModels = (
  scope: string,
  connectionId?: string,
): Promise<Status> =>
  invoke("ai_refresh_models", {
    scope,
    ...(connectionId ? { connectionId } : {}),
  });
export const saveConnection = (
  scope: string,
  config: Config,
  key: string,
): Promise<Status> => invoke("ai_save", { scope, config, key });
export const removeConnection = (
  scope: string,
  connectionId?: string,
): Promise<void> =>
  invoke("ai_remove", { scope, ...(connectionId ? { connectionId } : {}) });
export const listConnections = (scope: string): Promise<Status[]> =>
  invoke("ai_connections", { scope });
export const selectConnection = (
  scope: string,
  connectionId: string,
): Promise<Status> => invoke("ai_select_connection", { scope, connectionId });
export const forgetConnection = (
  scope: string,
  connectionId: string,
): Promise<Status> => invoke("ai_forget_connection", { scope, connectionId });

export const renameConnection = (
  scope: string,
  connectionId: string,
  label: string,
): Promise<Status> =>
  invoke("ai_rename_connection", { scope, connectionId, label });
export const selectConversationModel = (
  scope: string,
  conversation: string,
  model: string | null,
): Promise<Status> =>
  invoke("ai_select_conversation_model", { scope, conversation, model });
export const selectConversationThinking = (
  scope: string,
  conversation: string,
  thinking: string | null,
): Promise<Status> =>
  invoke("ai_select_conversation_thinking", { scope, conversation, thinking });

export const selectChatModel = (
  scope: string,
  model: string,
): Promise<Status> => invoke("ai_select_model", { scope, model });
export const startOpenAiLogin = (
  scope: string,
  connectionId?: string,
  label?: string,
): Promise<string> => {
  const diagnostic = diagnosticsFor(scope).action("connect", "button", "model");
  return invoke("ai_openai_start", {
    scope,
    ...(connectionId ? { connectionId } : {}),
    ...(label ? { label } : {}),
    ...(diagnostic ? { diagnostic } : {}),
  });
};
export interface DeviceChallenge {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}
export const startCodexLogin = (
  scope: string,
  connectionId?: string,
  label?: string,
): Promise<DeviceChallenge> =>
  invoke("ai_codex_start", {
    scope,
    ...(connectionId ? { connectionId } : {}),
    ...(label ? { label } : {}),
  });
export const waitCodexLogin = (scope: string, id: string): Promise<Status> =>
  invoke("ai_codex_wait", { scope, id });
export const cancelCodexLogin = (scope: string, id: string): Promise<void> =>
  invoke("ai_codex_cancel", { scope, id });
export const openCodexLogin = (scope: string, id: string): Promise<void> =>
  invoke("ai_codex_open", { scope, id });
export const waitOpenAiLogin = (scope: string, id: string): Promise<Status> =>
  invoke("ai_openai_wait", { scope, id });
export const cancelOpenAiLogin = (scope: string, id: string): Promise<void> =>
  invoke("ai_openai_cancel", { scope, id });
