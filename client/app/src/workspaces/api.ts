import { invoke } from "@tauri-apps/api/core";
import { localizeProvidedText } from "@situate/localization";

export interface Workspace {
  id: string;
  name: string;
  display: string;
}
export function displayWorkspaceName(workspace: Workspace): string {
  return workspace.id === "ios-documents:" ||
    workspace.id === "android-documents:"
    ? localizeProvidedText(workspace.name)
    : workspace.name;
}
export interface Snapshot {
  ready: boolean;
  mobile: boolean;
  known: Workspace[];
  open: Workspace[];
  current: Workspace | null;
  aiSetup?: boolean;
  onboarding?: boolean;
  onboardingAvailable?: boolean;
  failures: { location: Workspace; message: string }[];
  error: string | null;
}
export type Action =
  | "entry"
  | "create"
  | "pick"
  | "open"
  | "remove"
  | "close"
  | "regrant"
  | "reload"
  | "background"
  | "quit"
  | "ai-setup-done";
export type RunAction = (
  action: Action,
  id?: string,
  name?: string,
  accent?: import("../settings/accents").Accent,
) => Promise<boolean>;
export const snapshot = (): Promise<Snapshot> => invoke("workspace_snapshot");
export const chooseParent = (pick: boolean): Promise<Workspace | null> =>
  invoke("workspace_parent", { pick });
export const preflight = (parent: string, name: string): Promise<string> =>
  invoke("workspace_preflight", { parent, name });
export const action: RunAction = (action, id, name, accent) =>
  invoke("workspace_action", {
    action,
    id: id ?? null,
    name: name ?? null,
    ...(accent ? { accent } : {}),
  });

export function nameError(name: string): string {
  if (!name.trim() || name === "." || name === "..")
    return "workspace.enterAWorkspaceName";
  if (
    // eslint-disable-next-line no-control-regex -- Workspace names must reject filesystem control characters.
    /[\u0000-\u001f\u007f-\u009f/\\<>:"|?*]/u.test(name) ||
    /[. ]$/u.test(name) ||
    new TextEncoder().encode(name).length > 240
  ) {
    return "workspace.useANameOfAtMost240BytesWithout";
  }
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name))
    return "workspace.thisNameIsReservedByTheOperatingSystem";
  return "";
}
