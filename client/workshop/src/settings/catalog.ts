import { catalog } from "../ai/model";
import { catalogCopy } from "./content";
import { connectionIssue, providers, type SettingsState } from "./model";

export interface ConnectionCatalog {
  status: "ready" | "loading" | "error" | "unknown";
  source: "account" | "provider" | "compatibility";
  models: string[];
  request: number;
}
export type CatalogOutcome =
  "ready" | "empty" | "excluded" | "error" | "unknown";
export function connectionModelExamples(
  state: SettingsState,
  id: string,
): string[] {
  const connection = state.connections[id];
  if (!connection) return [];
  return (
    providers.find((provider) => provider.id === connection.provider)?.models ??
    []
  ).filter((name) => {
    const model = catalog.find(
      (item) =>
        item.provider === connection.provider &&
        (item.name === name ||
          ("settingsLabel" in item && item.settingsLabel === name)),
    );
    return !model || model.methods.includes(connection.method);
  });
}
export function connectionCatalog(
  state: SettingsState,
  id = state.provider,
): ConnectionCatalog {
  const connection = state.connections[id];
  const models = connectionModelExamples(state, id);
  return (
    state.catalogs[id] ?? {
      status: models.length ? "ready" : "unknown",
      source:
        connection?.provider === "openai-codex"
          ? "compatibility"
          : connection?.method === "browser" ||
              connection?.provider === "openrouter"
            ? "account"
            : "provider",
      models,
      request: 0,
    }
  );
}
export function refreshModels(state: SettingsState, id = state.provider) {
  if (!state.connections[id] || connectionIssue(state, id)) return;
  const current = connectionCatalog(state, id);
  if (current.status === "loading") return;
  state.catalogs[id] = {
    ...current,
    status: "loading",
    request: state.nextCatalogRequest++,
  };
}
export function completeModelRefresh(
  state: SettingsState,
  id: string,
  request: number,
  outcome: CatalogOutcome,
) {
  const current = state.catalogs[id];
  if (
    !state.connections[id] ||
    current?.status !== "loading" ||
    current.request !== request
  )
    return;
  const selected =
    state.provider === id
      ? state.chatModel
      : state.connectionDefaults[id]?.chatModel;
  const models =
    outcome === "empty"
      ? []
      : outcome === "excluded"
        ? connectionModelExamples(state, id).filter((name) => name !== selected)
        : outcome === "ready"
          ? connectionModelExamples(state, id)
          : current.models;
  state.catalogs[id] = {
    ...current,
    models,
    status: outcome === "error" || outcome === "unknown" ? outcome : "ready",
  };
}
export function catalogMessage(state: SettingsState): string {
  const current = connectionCatalog(state);
  if (current.status === "loading") return catalogCopy.loading;
  if (current.status === "error") return catalogCopy.error;
  if (current.status === "unknown") return catalogCopy.unknown;
  if (!current.models.length) return catalogCopy.empty;
  return catalogCopy.loaded(current.models.length);
}
export function savedModelUnavailable(
  state: SettingsState,
  model = state.chatModel,
): boolean {
  const current = connectionCatalog(state);
  return (
    model !== "recommended" &&
    current.status === "ready" &&
    !current.models.includes(model)
  );
}
