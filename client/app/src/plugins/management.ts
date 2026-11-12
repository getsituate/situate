import type { DeepReadonly } from "vue";
import type { RuntimePlugin } from "./runtime";
import type { WorkspaceUi } from "../layout/runtime";

export function pluginSettingsId(
  plugin: DeepReadonly<RuntimePlugin> | undefined,
): string | undefined {
  return plugin?.enabled && plugin.status === "loaded"
    ? plugin.settingsId
    : undefined;
}

export async function openPluginSettings(
  ui: WorkspaceUi,
  plugin: DeepReadonly<RuntimePlugin> | undefined,
) {
  const viewId = pluginSettingsId(plugin);
  if (!viewId || !ui.registry.definitions.has(viewId)) return false;
  return ui.coordinator.open({ kind: "view", viewId });
}
