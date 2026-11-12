import { shallowReactive } from "vue";
import { en } from "@situate/localization";

export type FailureBoundary =
  | "vue"
  | "view"
  | "script"
  | "resource"
  | "promise"
  | "plugins"
  | "files"
  | "conversation"
  | "workspace"
  | "onboarding"
  | "startup";
export interface Incident {
  id: string;
  boundary: FailureBoundary;
  scope?: string;
  code: string;
  description: string;
  gestureSeen: boolean;
}
export type RecoveryPage =
  "unexpected" | "report" | "mail" | "repair" | "reopen" | null;
let failureIdentities = new WeakMap<object, Incident>();
export const recoveryState = shallowReactive({
  incidents: [] as Incident[],
  active: undefined as Incident | undefined,
  page: null as RecoveryPage,
});

export function safeFailureCode(failure: unknown): string {
  let value: unknown = failure;
  try {
    if (typeof failure === "object" && failure !== null)
      value = Object.getOwnPropertyDescriptor(failure, "message")?.value;
  } catch {
    return "unknown";
  }
  return typeof value === "string" &&
    /^(native\.|plugins\.|files\.|references\.|ai\.)[A-Za-z0-9.]+$/.test(
      value,
    ) &&
    Object.hasOwn(en, value)
    ? value
    : "unknown";
}

export function captureIncident(
  boundary: FailureBoundary,
  failure: unknown,
  scope?: string,
  show = true,
): Incident {
  const identity =
    (typeof failure === "object" && failure !== null) ||
    typeof failure === "function"
      ? (failure as object)
      : undefined;
  const known = identity && failureIdentities.get(identity);
  if (known && recoveryState.incidents.includes(known)) return known;
  const code = safeFailureCode(failure);
  const previous = recoveryState.incidents.find(
    (item) =>
      item.boundary === boundary && item.scope === scope && item.code === code,
  );
  if (previous) {
    if (identity) failureIdentities.set(identity, previous);
    return previous;
  }
  const incident = shallowReactive<Incident>({
    id: crypto.randomUUID(),
    boundary,
    ...(scope ? { scope } : {}),
    code,
    description: "",
    gestureSeen: false,
  });
  if (identity) failureIdentities.set(identity, incident);
  const incidents = [...recoveryState.incidents, incident];
  if (incidents.length > 8) {
    const removable = incidents.findIndex(
      (item) => item !== recoveryState.active,
    );
    incidents.splice(removable, 1);
  }
  recoveryState.incidents = incidents;
  if (show && !recoveryState.page) openIncident(incident);
  return incident;
}
export function openIncident(
  incident: Incident,
  page: Exclude<RecoveryPage, null> = "unexpected",
) {
  if (!recoveryState.incidents.includes(incident)) return;
  recoveryState.active = incident;
  recoveryState.page = page;
}
export function dismissIncident() {
  recoveryState.page = null;
}
export function resolveIncident(incident: Incident) {
  recoveryState.incidents = recoveryState.incidents.filter(
    (item) => item !== incident,
  );
  if (recoveryState.active === incident) {
    recoveryState.page = null;
    recoveryState.active = undefined;
  }
}
export function retainIncidentScopes(scopes: readonly string[]) {
  for (const incident of [...recoveryState.incidents])
    if (incident.scope && !scopes.includes(incident.scope))
      resolveIncident(incident);
}
let retryStartup: (() => Promise<void>) | undefined;
export function registerStartupRetry(retry: () => Promise<void>): () => void {
  retryStartup = retry;
  return () => {
    if (retryStartup === retry) retryStartup = undefined;
  };
}
export function retryStartupInitialization(): Promise<void> {
  return retryStartup
    ? retryStartup()
    : Promise.reject(new Error("native.unavailable"));
}
export function resetIncidents() {
  failureIdentities = new WeakMap();
  recoveryState.incidents = [];
  recoveryState.active = undefined;
  recoveryState.page = null;
}
