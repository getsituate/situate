import { editorFixtures } from "./fixtures";
import {
  conflictBlocksFile,
  createConflict,
  type EditorConflict,
} from "./conflicts";

export type EditorScene =
  | "read"
  | "source"
  | "chat"
  | "history"
  | "save-error"
  | "empty"
  | "conflict"
  | "conflict-failure"
  | "conflict-race"
  | "merged";
export interface Version {
  key: string;
  label: string;
  author: string;
  note: string;
  content: string;
}
export interface EditorFile {
  key: string;
  name: string;
  folder: string;
  content: string;
  draft: string;
  versions: Version[];
  deleted: boolean;
  saveError: boolean;
}
export interface FileReference {
  fileKey: string;
  name: string;
  version: Version | null;
}
export interface EditorChat {
  key: string;
  title: string;
  draft: string;
  references: FileReference[];
}
export type ItemTarget =
  { kind: "file"; key: string } | { kind: "folder"; path: string };
export type ItemAction = "create" | "folder" | "rename" | "move" | "duplicate";
export type EditorDialogState =
  | {
      kind: "menu";
      target: ItemTarget;
      document: boolean;
      creationOnly?: boolean;
      point: { x: number; y: number };
    }
  | {
      kind: "name";
      target: ItemTarget;
      action: ItemAction;
      name: string;
      folder: string;
      error: string;
    }
  | { kind: "delete"; target: ItemTarget }
  | { kind: "id"; key: string; value: string; start: number; end: number }
  | { kind: "close"; key: string }
  | { kind: "attach"; key: string };
export interface EditorState {
  conflict: EditorConflict | null;
  dialog: EditorDialogState | null;
  selected: ItemTarget;
  files: EditorFile[];
  folders: string[];
  expanded: string[];
  currentKey: string | null;
  mode: "read" | "source";
  historical: Version | null;
  historicalComparison: string | null;
  historyOpen: boolean;
  compare: boolean;
  treeOpen: boolean;
  treeBeforeHistory: boolean;
  filter: string;
  filesOpen: boolean;
  activePane: string | null;
  activeChat: string | null;
  chats: EditorChat[];
  chatCount: number;
  saveOutcome: "success" | "failure";
  idEditingAllowed: boolean;
}
export const cloneEditorState = (state: EditorState): EditorState =>
  JSON.parse(JSON.stringify(state));
export const liveFiles = (state: EditorState) =>
  state.files.filter((file) => !file.deleted);
export const currentFile = (state: EditorState) =>
  state.files.find((file) => file.key === state.currentKey && !file.deleted);
export const editorIsEditing = (state: EditorState) =>
  !state.conflict?.open &&
  (state.dialog?.kind === "name" ||
    (!state.dialog &&
      (state.activePane === "files"
        ? state.filesOpen &&
          state.mode === "source" &&
          !state.historical &&
          !conflictBlocksFile(state, state.currentKey)
        : state.chats.some((chat) => chat.key === state.activePane))));
export function editorScreenLabel(state: EditorState): string {
  if (state.conflict?.open)
    return {
      unresolved: "Review versions",
      applying: "Applying selected version",
      refreshing: "Refreshing versions",
      failed: "Conflict save failure",
      stale: "Out-of-date versions",
      resolved: "Read a file",
    }[state.conflict.status];
  const dialog = state.dialog;
  if (dialog?.kind === "name")
    return dialog.action === "create"
      ? "New file"
      : dialog.action === "folder"
        ? "New folder"
        : `${dialog.action === "rename" ? "Rename" : dialog.action === "move" ? "Move" : "Duplicate"} ${dialog.target.kind}`;
  if (dialog)
    return {
      menu: "File actions",
      delete: "Delete confirmation",
      id: "ID confirmation",
      close: "Close chat confirmation",
      attach: "Attach a file",
    }[dialog.kind];
  if (!liveFiles(state).length) return "Empty files";
  if (
    state.activePane === "files" &&
    !state.historical &&
    conflictBlocksFile(state, state.currentKey)
  )
    return "Local file conflict";
  if (state.historical || state.historyOpen) return "Version history";
  if (currentFile(state)?.saveError) return "Save failure";
  if (state.activePane?.startsWith("chat-")) return "Chat with a file";
  return state.mode === "source" && !state.historical
    ? "Edit Markdown"
    : "Read a file";
}
export function createEditorState(scene: EditorScene = "read"): EditorState {
  const state: EditorState = {
    conflict: null,
    dialog: null,
    selected:
      scene === "empty"
        ? { kind: "folder", path: "" }
        : { kind: "file", key: "outline.md" },
    files: scene === "empty" ? [] : editorFixtures(),
    folders:
      scene === "empty"
        ? []
        : ["Projects", "Projects/Autumn workshop", "Resources", "Archive"],
    expanded: ["Projects", "Projects/Autumn workshop"],
    currentKey: scene === "empty" ? null : "outline.md",
    mode: scene === "source" || scene === "save-error" ? "source" : "read",
    historical: null,
    historicalComparison: null,
    historyOpen: false,
    compare: true,
    treeOpen: true,
    treeBeforeHistory: true,
    filter: "",
    filesOpen: true,
    activePane: "files",
    activeChat: null,
    chats: [],
    chatCount: 0,
    saveOutcome: scene === "save-error" ? "failure" : "success",
    idEditingAllowed: false,
  };
  if (scene === "history") {
    setHistory(state, true);
    inspectVersion(state, state.files[0].versions[1]);
  }
  if (scene === "chat") openChat(state, referenceForCurrent(state));
  if (scene === "save-error") {
    state.files[0].draft += "\nA thought to keep working on.\n";
    state.files[0].saveError = true;
  }
  if (scene.startsWith("conflict") || scene === "merged")
    state.conflict = createConflict(state.files[0], scene);
  return state;
}
export function saveFile(
  state: EditorState,
  key: string | null = state.currentKey,
): void {
  const file = state.files.find((item) => item.key === key && !item.deleted);
  if (!file || conflictBlocksFile(state, key)) return;
  if (file.draft === file.content) {
    file.saveError = false;
    return;
  }
  file.saveError = state.saveOutcome === "failure";
  if (file.saveError) return;
  file.content = file.draft;
  file.versions.unshift({
    key: crypto.randomUUID(),
    label: "Just now",
    author: "You",
    note: "Edited this file",
    content: file.content,
  });
}
export function flushSaves(state: EditorState): void {
  liveFiles(state).forEach((file) => saveFile(state, file.key));
}
export function selectFile(state: EditorState, key: string): void {
  if (!liveFiles(state).some((file) => file.key === key)) return;
  saveFile(state);
  state.currentKey = key;
  state.mode = "read";
  state.historical = null;
  state.idEditingAllowed = false;
  state.filesOpen = true;
  state.activePane = "files";
  state.selected = { kind: "file", key };
}
export function setMode(state: EditorState, mode: EditorState["mode"]): void {
  saveFile(state);
  state.mode = mode;
  state.historical = null;
  state.idEditingAllowed = false;
}
export function setHistory(state: EditorState, open: boolean): void {
  saveFile(state);
  if (open && !state.historyOpen) {
    state.treeBeforeHistory = state.treeOpen;
    state.treeOpen = false;
  }
  if (!open) {
    state.treeOpen = state.treeBeforeHistory;
    state.historical = null;
  }
  state.historyOpen = open;
  state.idEditingAllowed = false;
}
export function inspectVersion(
  state: EditorState,
  version: Version | null,
): void {
  state.historical = version ? { ...version } : null;
  state.historicalComparison = version
    ? (currentFile(state)?.draft ?? null)
    : null;
}
export function identities(text: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || "";
  return JSON.stringify([
    frontmatter.match(/^id:.*$/gm) || [],
    text.match(
      /situate-task-id\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[\w-]+)/g,
    ) || [],
  ]);
}
export function editDraft(state: EditorState, value: string): boolean {
  const file = currentFile(state);
  if (!file || state.historical || conflictBlocksFile(state, file.key))
    return false;
  if (!state.idEditingAllowed && identities(value) !== identities(file.draft))
    return false;
  file.draft = value;
  file.saveError = false;
  return true;
}
export function copyWithNewIdentities(text: string): string | null {
  const header = /^---\r?\n[\s\S]*?\r?\n---/.exec(text);
  const id =
    /^(id:[ \t]*)(["']?)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\2([ \t]*(?:#.*)?)\r?$/im;
  if (!header || !id.test(header[0])) return null;
  const copied = text.replace(header[0], () =>
    header[0].replace(
      id,
      (_, prefix, quote, _old, suffix) =>
        prefix + quote + crypto.randomUUID() + quote + suffix,
    ),
  );
  let valid = true;
  const result = copied.replace(/<!--[\s\S]*?-->/g, (comment) => {
    if (!comment.includes("situate-task-id")) return comment;
    const task =
      /(situate-task-id\s*[:=]\s*)(["']?)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\2(?![\w-])/gi;
    if (!task.test(comment)) {
      valid = false;
      return comment;
    }
    task.lastIndex = 0;
    return comment.replace(
      task,
      (_, prefix, quote) => prefix + quote + crypto.randomUUID() + quote,
    );
  });
  return valid ? result : null;
}
function newFile(
  name: string,
  folder: string,
  content: string,
  note = "Created this file",
): EditorFile {
  return {
    key: crypto.randomUUID(),
    name,
    folder,
    content,
    draft: content,
    deleted: false,
    saveError: false,
    versions: [
      {
        key: crypto.randomUUID(),
        label: "Just now",
        author: "You",
        note,
        content,
      },
    ],
  };
}
const below = (path: string, parent: string) =>
  path === parent || path.startsWith(parent + "/");
export function targetFolder(state: EditorState, target: ItemTarget): string {
  return target.kind === "folder"
    ? target.path
    : state.files.find((file) => file.key === target.key)?.folder || "";
}
export function targetLabel(state: EditorState, target: ItemTarget): string {
  return target.kind === "folder"
    ? target.path.split("/").at(-1) || "Personal"
    : state.files.find((file) => file.key === target.key)?.name ||
        "Unavailable file";
}
export function destinationFolders(
  state: EditorState,
  target: ItemTarget,
  action: ItemAction,
): string[] {
  return ["", ...state.folders.slice().sort()].filter(
    (path) =>
      target.kind !== "folder" ||
      !target.path ||
      action === "folder" ||
      action === "create" ||
      !below(path, target.path),
  );
}
export function applyItemAction(
  state: EditorState,
  action: ItemAction,
  target: ItemTarget,
  nameInput: string,
  folder: string,
): string | null {
  const name = nameInput.trim(),
    path = [folder, name].filter(Boolean).join("/");
  const isFolder =
    action === "folder" || (target.kind === "folder" && action !== "create");
  const moving = action === "rename" || action === "move";
  const file =
    target.kind === "file"
      ? liveFiles(state).find((item) => item.key === target.key)
      : undefined;
  const original = target.kind === "folder" ? target.path : "";
  if (!name || /[\\/]/.test(name) || name === "." || name === "..")
    return "Use a name without slashes, other than “.” or “..”.";
  if (!isFolder && !name.toLowerCase().endsWith(".md"))
    return "Use a .md filename.";
  if (folder && !state.folders.includes(folder))
    return "Choose an existing destination folder.";
  if (isFolder && action !== "folder" && below(folder, original))
    return "Choose a destination outside this folder.";
  if (
    state.folders.includes(path) &&
    !(isFolder && moving && path === original)
  )
    return "A folder with this name already exists here.";
  if (
    liveFiles(state).some(
      (item) =>
        item.folder === folder &&
        item.name === name &&
        !(moving && item === file),
    )
  )
    return "A file with this name already exists here.";
  if (
    action !== "create" &&
    action !== "folder" &&
    (target.kind === "file" ? !file : !state.folders.includes(original))
  )
    return "This item is no longer available.";
  const copies: EditorFile[] = [];
  if (action === "duplicate") {
    const sources = isFolder
      ? liveFiles(state).filter((item) => below(item.folder, original))
      : [file!];
    for (const source of sources) {
      const content = copyWithNewIdentities(source.draft);
      if (content === null)
        return `An ID in “${source.name}” cannot be copied safely. Check its file and task IDs in Source first.`;
      copies.push(
        newFile(
          isFolder ? source.name : name,
          isFolder ? path + source.folder.slice(original.length) : folder,
          content,
          "Created a copy",
        ),
      );
    }
  }
  if (action === "folder") state.folders.push(path);
  else if (isFolder) {
    const children = state.folders.filter((item) => below(item, original));
    const remap = (item: string) =>
      below(item, original) ? path + item.slice(original.length) : item;
    if (moving) {
      state.folders = state.folders.filter((item) => !below(item, original));
      liveFiles(state).forEach((item) => {
        item.folder = remap(item.folder);
      });
      state.expanded = state.expanded.map(remap);
    }
    state.folders.push(...children.map(remap));
    state.files.push(...copies);
  } else if (action === "create") {
    saveFile(state);
    const created = newFile(
      name,
      folder,
      `---\nid: ${crypto.randomUUID()}\n---\n# ${name.slice(0, -3).replace(/-/g, " ")}\n\n`,
    );
    state.files.push(created);
    selectFile(state, created.key);
    state.mode = "source";
  } else if (action === "duplicate") state.files.push(...copies);
  else {
    file!.name = name;
    file!.folder = folder;
  }
  let ancestor = isFolder ? path : folder;
  while (ancestor) {
    if (!state.expanded.includes(ancestor)) state.expanded.push(ancestor);
    ancestor = ancestor.split("/").slice(0, -1).join("/");
  }
  state.selected = isFolder
    ? { kind: "folder", path }
    : {
        kind: "file",
        key:
          action === "duplicate"
            ? copies[0].key
            : action === "create"
              ? state.currentKey!
              : file!.key,
      };
  state.filter = "";
  return null;
}
export function affectedFiles(
  state: EditorState,
  target: ItemTarget,
): EditorFile[] {
  return liveFiles(state).filter((file) =>
    target.kind === "file"
      ? file.key === target.key
      : below(file.folder, target.path),
  );
}
export function deleteItem(state: EditorState, target: ItemTarget): void {
  affectedFiles(state, target).forEach((file) => {
    file.deleted = true;
  });
  if (target.kind === "folder")
    state.folders = state.folders.filter((path) => !below(path, target.path));
  if (!currentFile(state)) {
    state.currentKey = liveFiles(state)[0]?.key || null;
    state.historical = null;
    state.mode = "read";
    state.idEditingAllowed = false;
  }
}
export function referenceForCurrent(
  state: EditorState,
): FileReference | undefined {
  const file = currentFile(state);
  return file
    ? {
        fileKey: file.key,
        name: file.name,
        version: state.historical ? { ...state.historical } : null,
      }
    : undefined;
}
export function openChat(state: EditorState, reference?: FileReference): void {
  flushSaves(state);
  const count = ++state.chatCount,
    key = `chat-${count}`;
  state.chats.push({
    key,
    title: count === 1 ? "New chat" : `New chat ${count}`,
    draft: "",
    references: reference ? [reference] : [],
  });
  state.activeChat = key;
  state.activePane = key;
  state.treeOpen = false;
}
export function resolveReference(state: EditorState, reference: FileReference) {
  const file = state.files.find((item) => item.key === reference.fileKey);
  const name = file?.name || reference.name;
  if (!file || file.deleted)
    return { name, state: "missing", detail: "File unavailable" };
  const path = file.folder || "Personal";
  if (reference.version)
    return {
      name,
      state: "historical",
      detail: `${path} · Earlier version · ${reference.version.label}`,
    };
  return {
    name,
    state: file.saveError
      ? "error"
      : file.content !== file.draft
        ? "saving"
        : "ready",
    detail:
      path +
      (file.saveError
        ? " · Couldn’t save changes"
        : file.content !== file.draft
          ? " · Saving…"
          : ""),
  };
}
export function openReference(
  state: EditorState,
  reference: FileReference,
): void {
  if (resolveReference(state, reference).state === "missing") return;
  selectFile(state, reference.fileKey);
  inspectVersion(state, reference.version);
  state.compare = false;
}
export function closePane(state: EditorState, key: string): void {
  if (key === "files") {
    flushSaves(state);
    state.filesOpen = false;
  } else state.chats = state.chats.filter((chat) => chat.key !== key);
  if (state.activeChat === key)
    state.activeChat = state.chats.at(-1)?.key || null;
  if (state.activePane === key)
    state.activePane = state.activeChat || (state.filesOpen ? "files" : null);
}
