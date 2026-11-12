import type { DistributiveOmit, FilesOperation, FilesRequest } from "./api";

export function actionRequest(
  target: {
    operation: FilesOperation;
    path: string;
    revision?: string;
    exactPath?: boolean;
  },
  creationPath: string,
  destination: string,
): DistributiveOmit<FilesRequest, "workspaceId"> {
  const { operation, path, revision, exactPath } = target;
  switch (operation) {
    case "create":
    case "mkdir":
      return { operation, path: creationPath };
    case "rename":
    case "copy":
      return { operation, path, destination };
    case "delete":
    case "discard":
      return { operation, path };
    case "restore":
    case "historicalCopy":
    case "revert":
      if (!revision) throw new Error("Choose a retained revision.");
      if (operation === "revert") return { operation, path, revision };
      if (operation === "restore")
        return { operation, path, revision, destination };
      return { operation, path, revision, destination, exactPath };
    default:
      throw new Error("This file action is unavailable.");
  }
}

import { t } from "@situate/localization";
export type FileAction =
  | "read"
  | "source"
  | "history"
  | "create"
  | "mkdir"
  | "rename"
  | "move"
  | "copy"
  | "delete"
  | "deleted";
export interface FileMenuItem {
  action: FileAction;
  label: string;
  checked?: boolean;
  disabled?: boolean;
}
export type FileMenuEntry = FileMenuItem | null;

export function markdownWordCount(text: string): number {
  return (
    text
      .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "")
      .replace(/<!--\s*situate-task-id\b[\s\S]*?-->/giu, "")
      .trim()
      .match(/\S+/gu)?.length ?? 0
  );
}

export function compareFileEntries(
  a: { path: string; isDirectory: boolean },
  b: { path: string; isDirectory: boolean },
): number {
  const left = a.path.split("/");
  const right = b.path.split("/");
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] === right[index]) continue;
    const leftFolder = index < left.length - 1 || a.isDirectory;
    const rightFolder = index < right.length - 1 || b.isDirectory;
    if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
    return left[index]!.localeCompare(right[index]!);
  }
  return left.length - right.length;
}

export function parentFolder(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}
export function itemName(path: string): string {
  return path.split("/").at(-1) ?? "";
}
export function inFolder(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}
export function creationFolder(path: string, isDirectory: boolean): string {
  return isDirectory ? path : parentFolder(path);
}
export function duplicatePath(path: string): string {
  const name = itemName(path);
  const extension = name.lastIndexOf(".");
  return inFolder(
    parentFolder(path),
    extension > 0
      ? `${name.slice(0, extension)} copy${name.slice(extension)}`
      : `${name} copy`,
  );
}

export function fileMenu(options: {
  path: string;
  directory: boolean;
  plus: boolean;
  writable: boolean;
  live: boolean;
  mode: "read" | "source";
  selected: string;
  documentContext?: boolean;
  text?: boolean;
}): FileMenuEntry[] {
  const { path, directory, plus, writable, live, mode, selected } = options;
  const entries: FileMenuEntry[] = [];
  const active = path === selected && (live || options.documentContext);
  if (!plus && path && !directory) {
    if (options.text ?? /\.(?:md|markdown)$/iu.test(path))
      entries.push(
        {
          action: "read",
          label: t("files.read"),
          checked: !!active && mode === "read",
        },
        {
          action: "source",
          label:
            !writable || (!live && options.documentContext)
              ? t("files.viewSource")
              : t("files.editSource"),
          checked: !!active && mode === "source",
        },
      );
    entries.push({ action: "history", label: t("files.versionHistory") }, null);
  }
  entries.push(
    { action: "create", label: t("files.newFileDetail"), disabled: !writable },
    { action: "mkdir", label: t("files.newFolderDetail"), disabled: !writable },
  );
  if (!plus && path)
    entries.push(
      null,
      { action: "rename", label: t("files.renameDetail"), disabled: !writable },
      { action: "move", label: t("files.moveToDetail"), disabled: !writable },
      {
        action: "copy",
        label: t("files.duplicateDetail"),
        disabled: !writable,
      },
      null,
      { action: "delete", label: t("files.deleteDetail"), disabled: !writable },
    );
  if (plus)
    entries.push(null, { action: "deleted", label: t("files.deletedFiles") });
  return entries;
}

export function containedMenuPosition(
  anchor: { right: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number; left?: number; top?: number },
  point?: { x: number; y: number },
): { left: number; top: number } {
  const left = (viewport.left ?? 0) + 8;
  const top = (viewport.top ?? 0) + 8;
  return {
    left: Math.max(
      left,
      Math.min(
        point?.x ?? anchor.right,
        left + viewport.width - size.width - 16,
      ),
    ),
    top: Math.max(
      top,
      Math.min(
        point?.y ?? anchor.bottom + 4,
        top + viewport.height - size.height - 16,
      ),
    ),
  };
}
