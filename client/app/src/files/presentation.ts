import type { PresentationValue } from "../layout/navigation";
import {
  validReference,
  type ContentReference,
} from "../ai/content-references";

export interface FilePaneTarget {
  contentId?: string;
  revision?: string;
}
export type FilePaneNavigation = FilePaneTarget & {
  kind: "view";
  viewId: "files";
};
export type FilePaneReference = {
  workspaceId: string;
  path: string;
} & (
  | { kind: "live"; expectedRevision: string }
  | { kind: "historical"; revision: string }
);
export type FilePaneIdentityChange = { workspaceId: string } & (
  | { kind: "rename"; from: string; to: string }
  | { kind: "delete"; path: string }
);
export type FileHistoryPresentation = {
  currentPath: string;
  path: string;
  exactPath: boolean;
  seed: string | null;
  version: {
    revision: string;
    timestamp: number;
    message: string;
    path: string | null;
    deleted: boolean;
  };
};
export interface FilePanePresentation {
  reference?: ContentReference | null;
  mode: "read" | "source";
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  readScrollTop: number;
  treeOpen: boolean;
  treeWidth: number;
  history: FileHistoryPresentation | null;
}
export function filePresentation(
  value?: PresentationValue,
  treeOpen = false,
): FilePanePresentation {
  const data =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, PresentationValue>)
      : {};
  const position = (key: string) =>
    typeof data[key] === "number" && Number.isFinite(data[key])
      ? Math.max(0, data[key] as number)
      : 0;
  return {
    ...(Object.hasOwn(data, "reference")
      ? {
          reference:
            validReference(data.reference) && data.reference.kind === "live"
              ? data.reference
              : null,
        }
      : {}),
    mode: data.mode === "source" ? "source" : "read",
    selectionStart: position("selectionStart"),
    selectionEnd: position("selectionEnd"),
    scrollTop: position("scrollTop"),
    readScrollTop: position("readScrollTop"),
    treeOpen: typeof data.treeOpen === "boolean" ? data.treeOpen : treeOpen,
    treeWidth: position("treeWidth") || 228,
    history: readHistoryPresentation(data.history),
  };
}
function readHistoryPresentation(
  value: PresentationValue | undefined,
): FileHistoryPresentation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const history = value as Record<string, PresentationValue>;
  const version = history.version;
  if (!version || typeof version !== "object" || Array.isArray(version))
    return null;
  const entry = version as Record<string, PresentationValue>;
  if (
    typeof history.currentPath !== "string" ||
    (history.currentPath !== "" && !safeFileTarget(history.currentPath)) ||
    typeof history.path !== "string" ||
    !safeFileTarget(history.path) ||
    typeof history.exactPath !== "boolean" ||
    (history.seed !== null && typeof history.seed !== "string") ||
    typeof entry.revision !== "string" ||
    !entry.revision ||
    typeof entry.timestamp !== "number" ||
    !Number.isSafeInteger(entry.timestamp) ||
    typeof entry.message !== "string" ||
    typeof entry.deleted !== "boolean" ||
    (entry.path !== null &&
      (typeof entry.path !== "string" || !safeFileTarget(entry.path)))
  )
    return null;
  return {
    currentPath: history.currentPath,
    path: history.path,
    exactPath: history.exactPath,
    seed: history.seed,
    version: {
      revision: entry.revision,
      timestamp: entry.timestamp,
      message: entry.message,
      path: entry.path,
      deleted: entry.deleted,
    },
  };
}
export function safeFileTarget(path: string): boolean {
  return (
    !!path &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    path.split("/").every((part) => !!part && part !== "." && part !== "..")
  );
}
