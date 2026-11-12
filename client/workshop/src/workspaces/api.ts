export interface Workspace {
  id: string;
  name: string;
  display: string;
  accent?: import("./first-entry").Accent;
}
export interface Snapshot {
  ready: boolean;
  mobile: boolean;
  known: Workspace[];
  open: Workspace[];
  current: Workspace | null;
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
  | "quit";
export type RunAction = (
  action: Action,
  id?: string,
  name?: string,
) => Promise<boolean>;

export function nameError(name: string): string {
  if (!name.trim() || name === "." || name === "..")
    return "Enter a workspace name.";
  if (
    // eslint-disable-next-line no-control-regex -- Workspace names must reject control characters.
    /[\u0000-\u001f\u007f-\u009f/\\<>:"|?*]/u.test(name) ||
    /[. ]$/u.test(name) ||
    new TextEncoder().encode(name).length > 240
  ) {
    return 'Use a name of at most 240 bytes without slashes, control characters, < > : " | ? *, or a trailing dot or space.';
  }
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name))
    return "This name is reserved by the operating system.";
  return "";
}
