import type { DeepReadonly } from "vue";
import type { RuntimePlugin } from "./runtime";
import type { WorkspaceUi } from "../layout/runtime";
import { guardDictation } from "../dictation/runtime";
import { selectedTab } from "../layout/model";
import { currentEntry, sameTarget } from "../layout/navigation";
import type { NavigationTicket } from "../layout/session";

export function pluginManagementGroup(plugin: DeepReadonly<RuntimePlugin>) {
  return plugin.manifest?.kind ?? "tool";
}

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
  ticket?: NavigationTicket,
) {
  const viewId = pluginSettingsId(plugin);
  if (!viewId) return false;
  const definition = ui.registry.definitions.get(viewId);
  if (!definition) return false;
  const target = { kind: "view", viewId } as const;
  const alreadyOpen = () => {
    if (ticket) return false;
    const layout = ui.session.state.document?.layout;
    const tab = layout && selectedTab(layout);
    const pane = tab?.panes.find((item) => item.id === tab.activePaneId);
    return !!pane && sameTarget(currentEntry(pane.navigation).target, target);
  };
  if (alreadyOpen())
    return (
      (await guardDictation(ui.session.workspaceId)) &&
      ui.registry.definitions.get(viewId) === definition &&
      alreadyOpen()
    );
  return ui.coordinator.open(target, ticket);
}
