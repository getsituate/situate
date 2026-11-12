import { catalog, currentWorkspace, type AiState } from "../ai/model";
import { connectionIssue, type SettingsState } from "./model";

const pendingSelection = ["saving", "save-error", "uncertain", "reconciling"];
function modelId(provider: string | undefined, name: string): string {
  return (
    catalog.find(
      (model) =>
        model.provider === provider &&
        (model.name === name ||
          ("settingsLabel" in model && model.settingsLabel === name)),
    )?.id ?? name
  );
}
export function restoresInheritance(previous: AiState, next: AiState): boolean {
  const before = currentWorkspace(previous),
    after = currentWorkspace(next);
  return (
    (before.connection?.id ?? before.connection?.provider) ===
      (after.connection?.id ?? after.connection?.provider) &&
    ["saving", "reconciling"].includes(before.model.phase) &&
    before.model.pending === null &&
    !after.model.selected &&
    after.model.phase === "ready"
  );
}
export function applyConnectionDefaults(
  ai: AiState,
  settings: SettingsState,
  previous?: SettingsState,
  inherit = false,
) {
  const current = currentWorkspace(ai);
  const selected = settings.connections[settings.provider];
  current.defaultConnection = selected
    ? { ...selected, id: settings.provider }
    : null;
  current.defaultModel = modelId(selected?.provider, settings.chatModel);
  current.thinkingDefaults = { ...settings.thinkingDefaults };
  current.showModelPicker = settings.showModelPicker;
  let id = current.connection?.id ?? current.connection?.provider ?? "";
  const switchConnection =
    inherit ||
    (!!previous &&
      previous.provider !== settings.provider &&
      !current.model.selected &&
      !pendingSelection.includes(current.model.phase) &&
      !settings.useManaged);
  if (switchConnection) {
    id = settings.provider;
    current.connection = current.defaultConnection
      ? { ...current.defaultConnection }
      : null;
    current.unavailable = selected ? connectionIssue(settings, id) : null;
    current.model.phase = "ready";
    current.model.count = "many";
    current.model.manual = ["compatible", "llama.cpp"].includes(
      selected?.provider ?? "",
    );
    delete current.catalogModelIds;
  } else if (
    previous &&
    (JSON.stringify(previous.connections[id]) !==
      JSON.stringify(settings.connections[id]) ||
      connectionIssue(previous, id) !== connectionIssue(settings, id))
  ) {
    const saved = settings.connections[id];
    if (saved) current.connection = { ...saved, id };
    current.unavailable = saved ? connectionIssue(settings, id) : "missing";
  }
  const discovered = settings.catalogs[id];
  if (!discovered) {
    if (previous?.catalogs[id]) {
      delete current.catalogModelIds;
      current.model.count = "many";
      current.model.manual = ["compatible", "llama.cpp"].includes(
        current.connection?.provider ?? "",
      );
      if (!pendingSelection.includes(current.model.phase))
        current.model.phase = "ready";
    }
    return;
  }
  if (discovered.status === "ready") {
    current.catalogModelIds = discovered.models.map((name) =>
      modelId(current.connection?.provider, name),
    );
    current.model.count = discovered.models.length ? "many" : "zero";
  }
  if (pendingSelection.includes(current.model.phase)) return;
  const changed =
    switchConnection ||
    !previous ||
    JSON.stringify(previous.catalogs[id]) !== JSON.stringify(discovered);
  if (changed)
    current.model.phase =
      discovered.status === "loading"
        ? "loading"
        : discovered.status === "error" ||
            (discovered.status === "unknown" && !current.model.manual)
          ? "load-error"
          : "ready";
  if (
    discovered.status === "ready" &&
    ["ready", "unavailable"].includes(current.model.phase)
  ) {
    const choice = current.model.selected ?? current.defaultModel;
    current.model.phase =
      choice !== "recommended" &&
      !current.model.manual &&
      !current.catalogModelIds?.includes(choice)
        ? "unavailable"
        : "ready";
  }
}
