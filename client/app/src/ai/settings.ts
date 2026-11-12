import { invoke } from "@tauri-apps/api/core";
import { reactive } from "vue";

export type ThinkingLevel =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export interface ModelChoice {
  model: string;
  thinking: ThinkingLevel | "recommended";
  catalogRevision: string | null;
}
export interface WorkspaceAiSettings {
  version: 1;
  chat: ModelChoice | null;
  comment: ModelChoice | null;
  generatedComments: boolean;
  showInlineModel: boolean;
}
export function defaultAiSettings(): WorkspaceAiSettings {
  return {
    version: 1,
    chat: null,
    comment: null,
    generatedComments: true,
    showInlineModel: false,
  };
}
export function workspaceAiSettings(scope: string, connectionId?: string) {
  const cacheKey = JSON.stringify([scope, connectionId ?? null]);
  const existing = workspaces.get(cacheKey);
  if (existing) return existing;
  const state = reactive<{
    settings: WorkspaceAiSettings | null;
    loading: boolean;
    saving: boolean;
    error: boolean;
  }>({ settings: null, loading: false, saving: false, error: false });
  let revision = 0;
  async function refresh(): Promise<void> {
    if (state.saving) return;
    const request = ++revision;
    state.loading = true;
    try {
      const settings = await invoke<WorkspaceAiSettings>("ai_settings_load", {
        scope,
        ...(connectionId ? { connectionId } : {}),
      });
      if (request === revision) {
        state.settings = settings;
        state.error = false;
      }
    } catch {
      if (request === revision) state.error = true;
    } finally {
      if (request === revision) state.loading = false;
    }
  }
  async function save(settings: WorkspaceAiSettings): Promise<boolean> {
    if (state.saving || state.loading || state.error || !state.settings)
      return false;
    const request = ++revision;
    state.saving = true;
    try {
      const saved = await invoke<WorkspaceAiSettings>("ai_settings_save", {
        scope,
        ...(connectionId ? { connectionId } : {}),
        settings,
      });
      if (request !== revision) return false;
      state.settings = saved;
      state.error = false;
      return true;
    } catch {
      // A failed response can follow a durable write; require readback before another change.
      state.error = true;
      return false;
    } finally {
      if (request === revision) state.saving = false;
    }
  }
  const service = { state, refresh, save };
  workspaces.set(cacheKey, service);
  return service;
}
type Service = {
  state: {
    settings: WorkspaceAiSettings | null;
    loading: boolean;
    saving: boolean;
    error: boolean;
  };
  refresh(): Promise<void>;
  save(settings: WorkspaceAiSettings): Promise<boolean>;
};
const workspaces = new Map<string, Service>();
export async function loadAiSettings(
  scope: string,
  connectionId?: string,
): Promise<WorkspaceAiSettings> {
  const service = workspaceAiSettings(scope, connectionId);
  if (service.state.error || service.state.saving || service.state.loading)
    throw new Error("ai.modelChoicesCouldNotBeRead");
  await service.refresh();
  if (
    service.state.error ||
    service.state.saving ||
    service.state.loading ||
    !service.state.settings
  )
    throw new Error("ai.modelChoicesCouldNotBeRead");
  return JSON.parse(
    JSON.stringify(service.state.settings),
  ) as WorkspaceAiSettings;
}
export async function saveAiSettings(
  scope: string,
  settings: WorkspaceAiSettings,
  connectionId?: string,
): Promise<WorkspaceAiSettings> {
  const service = workspaceAiSettings(scope, connectionId);
  if (!service.state.settings) await service.refresh();
  if (!(await service.save(settings)))
    throw new Error("ai.reviewTheCurrentChoiceOrRetrySaving");
  return JSON.parse(
    JSON.stringify(service.state.settings),
  ) as WorkspaceAiSettings;
}
