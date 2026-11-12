import type { Plugin, PluginState } from "./model";
import copy from "../localization/en.plugin-development.json" with { type: "json" };

export function connectionAvailability(state: PluginState, id: string) {
  const reason = state.connectionAvailability[id] ?? "ready";
  return state.connectionPlatform === "ios" &&
    !["unsupported", "not-implemented"].includes(reason)
    ? "unsupported"
    : reason;
}

export function consumerAccessReason(
  state: PluginState,
  plugin: Plugin,
): string {
  const visited = new Set<string>();
  const pending = [...plugin.dependencies];
  while (pending.length) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const dependency = state.plugins.find((item) => item.id === id);
    if (!dependency) continue;
    pending.push(...dependency.dependencies);
    if (dependency.kind !== "connector") continue;
    const availability = connectionAvailability(state, id);
    const reason = !dependency.enabled
      ? copy.dependencyDisabled
      : availability !== "ready"
        ? copy.readiness[availability]
        : !hasConnectedAccess(state, id)
          ? copy.accountAccessNeeded
          : plugin.kind === "tool" &&
              !(state.accounts[id] ?? []).some(
                (account) =>
                  account.status === "connected" &&
                  state.accountSelections[plugin.id]?.includes(account.id),
              )
            ? copy.selectAccount
            : "";
    if (reason)
      return copy.consumerAccessNeeded
        .replace("{name}", dependency.name)
        .replace("{reason}", reason);
  }
  return "";
}

export function hasConnectedAccess(state: PluginState, id: string) {
  return (
    connectionAvailability(state, id) === "ready" &&
    state.plugins.some((plugin) => plugin.id === id && plugin.enabled) &&
    (state.accounts[id] ?? []).some((account) => account.status === "connected")
  );
}
