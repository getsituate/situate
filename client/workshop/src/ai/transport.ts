import type { AiState } from "./model";
import { transportCopy } from "./content";

export function normalizeDestination(value: string): string | null {
  const input = value.trim();
  const authority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1];
  if (
    !authority ||
    authority.includes("@") ||
    authority.endsWith(":") ||
    /[\s\\#]/.test(input)
  )
    return null;
  try {
    const url = new URL(input);
    if (!url.hostname || url.username || url.password || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function clearHttpConsent(state: AiState) {
  state.httpConsent = "";
  state.httpDestination = "";
}
export function setAuthValue(state: AiState, id: string, value: string) {
  if (["endpoint", "base-override"].includes(id) && state.values[id] !== value)
    clearHttpConsent(state);
  state.values[id] = value;
}
export function gateHttpDestination(state: AiState): boolean {
  const field = state.values["base-override"] ? "base-override" : "endpoint";
  const raw = state.values[field];
  if (!raw) return false;
  // Azure's exploratory resource name is not a URL override.
  if (state.provider === "azure" && field === "endpoint" && !raw.includes(":"))
    return false;
  const destination = normalizeDestination(raw);
  if (!destination) {
    clearHttpConsent(state);
    state.invalidField = field;
    state.fieldError = transportCopy.invalid;
    return true;
  }
  state.values[field] = destination;
  if (!destination.startsWith("http:") || state.httpConsent === destination)
    return false;
  state.httpConsent = "";
  state.httpDestination = destination;
  if (state.screen !== "http-warning") state.httpReturn = state.screen;
  state.screen = "http-warning";
  state.dialog = null;
  return true;
}
export function cancelHttpConsent(state: AiState) {
  state.screen = state.httpReturn;
  clearHttpConsent(state);
}
export function acceptHttpConsent(state: AiState): boolean {
  const raw = state.values["base-override"] || state.values.endpoint || "";
  const destination = normalizeDestination(raw);
  if (
    state.screen !== "http-warning" ||
    !destination ||
    destination !== state.httpDestination
  ) {
    clearHttpConsent(state);
    state.screen = state.httpReturn;
    return false;
  }
  state.httpConsent = destination;
  state.httpDestination = "";
  state.screen = state.httpReturn;
  return true;
}
