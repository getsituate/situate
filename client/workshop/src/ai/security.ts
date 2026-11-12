import type { AiState, Connection } from "./model";
import { securityCopy } from "./content";

export function restriction(provider: string, method: string, version = 1) {
  if (provider === "anthropic" && ["browser", "copy"].includes(method))
    return {
      blocked: true,
      version: "anthropic-subscription-1",
      detail: securityCopy.anthropic,
      source: "https://code.claude.com/docs/en/legal-and-compliance",
      reviewed: "2026-10-07",
    };
  if (provider === "example-orbit" && ["browser", "device"].includes(method))
    return {
      blocked: false,
      version: `orbit-${method}-${version}`,
      detail: version === 1 ? securityCopy.orbit : securityCopy.orbitChanged,
      source: "https://orbit.example.invalid/account-access",
      reviewed: version === 1 ? "2026-10-01" : "2026-10-07",
    };
  return null;
}
export function needsReview(state: AiState, connection: Connection) {
  const policy = restriction(
    connection.provider,
    connection.method,
    state.restrictionVersion,
  );
  return (
    !!policy && (policy.blocked || connection.warningVersion !== policy.version)
  );
}
export function gateAccess(state: AiState, intent: "connect" | "use") {
  const connection =
    intent === "use"
      ? state.workspaces[state.workspace].connection
      : {
          provider: state.provider,
          method: state.method,
          warningVersion: state.warningAccepted,
        };
  if (!connection || !needsReview(state, connection)) return false;
  state.warningIntent = intent;
  if (state.screen !== "restriction") state.warningReturn = state.screen;
  state.warningChecked = false;
  state.screen = "restriction";
  state.dialog = null;
  return true;
}
export function visibleRestriction(state: AiState) {
  const connection =
    state.warningIntent === "use"
      ? state.workspaces[state.workspace].connection
      : null;
  return restriction(
    connection?.provider ?? state.provider,
    connection?.method ?? state.method,
    state.restrictionVersion,
  );
}
export function acknowledgeWarning(state: AiState) {
  const policy = visibleRestriction(state);
  if (!policy || policy.blocked || !state.warningChecked) return false;
  if (state.warningIntent === "use") {
    const connection = state.workspaces[state.workspace].connection;
    if (connection) connection.warningVersion = policy.version;
  } else state.warningAccepted = policy.version;
  state.screen = state.warningReturn;
  state.warningChecked = false;
  return true;
}
export function cancelWarning(state: AiState) {
  state.screen = state.warningReturn;
  state.warningChecked = false;
}
export const requiresSessionTakeover = (state: AiState) =>
  !state.independentSession &&
  state.provider === "example-orbit" &&
  ["browser", "device"].includes(state.method);
