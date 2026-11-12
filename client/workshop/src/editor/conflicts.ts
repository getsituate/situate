import type { EditorFile, EditorState } from "./model";

export type ConflictChoice = "editor" | "file";
export interface EditorConflict {
  fileKey: string;
  open: boolean;
  status:
    "unresolved" | "applying" | "failed" | "stale" | "refreshing" | "resolved";
  editor: string;
  file: string;
  revision: number;
  visibleRevision: number;
  selected: ConflictChoice | null;
  inspect: ConflictChoice;
  scroll: Record<ConflictChoice, number>;
  epoch: string;
  pending: string | null;
  nextOutcome: "success" | "failure" | "race";
  message: string;
}
export function createConflict(
  file: EditorFile,
  scene: string,
): EditorConflict {
  return {
    fileKey: file.key,
    open: scene !== "merged",
    status: scene === "merged" ? "resolved" : "unresolved",
    editor: file.draft,
    file: changedText(file.draft, 1),
    revision: 1,
    visibleRevision: 1,
    selected: null,
    inspect: "editor",
    scroll: { editor: 0, file: 0 },
    epoch: crypto.randomUUID(),
    pending: null,
    nextOutcome:
      scene === "conflict-failure"
        ? "failure"
        : scene === "conflict-race"
          ? "race"
          : "success",
    message: "",
  };
}
function changedText(text: string, revision: number) {
  return (
    text
      .replace(
        "Coffee, introductions and a shared question.",
        "Tea, introductions and a shared question.",
      )
      .replace("Keep it informal.", "Include a short welcome note.") +
    (revision > 1
      ? `\nLatest file update ${revision}: bring spare notebooks.\n`
      : "")
  );
}
export const conflictBlocksFile = (state: EditorState, key: string | null) =>
  !!state.conflict &&
  state.conflict.fileKey === key &&
  state.conflict.status !== "resolved";
export function chooseConflict(state: EditorState, choice: ConflictChoice) {
  const c = state.conflict;
  if (!c || !["unresolved", "failed"].includes(c.status)) return;
  c.selected = choice;
  c.status = "unresolved";
  c.message = "";
}
export function beginConflictOperation(
  state: EditorState,
  operation: "apply" | "refresh",
) {
  const c = state.conflict;
  if (
    !c ||
    (operation === "apply"
      ? !c.selected || !["unresolved", "failed"].includes(c.status)
      : c.status !== "stale")
  )
    return;
  c.status = operation === "apply" ? "applying" : "refreshing";
  c.message = "";
  c.pending = crypto.randomUUID();
}
export function changeConflictSource(state: EditorState) {
  const c = state.conflict;
  if (!c || c.status === "resolved") return;
  c.revision++;
  c.selected = null;
  c.pending = null;
  c.status = "stale";
  c.message =
    "The file changed again. The copies below are out of date. Refresh versions before choosing; nothing was applied.";
}
function commit(file: EditorFile, content: string) {
  file.content = file.draft = content;
  file.saveError = false;
  file.versions.unshift({
    key: crypto.randomUUID(),
    label: "Just now",
    author: "You",
    note: "Updated this file",
    content,
  });
}
export function completeConflictOperation(
  state: EditorState,
  epoch: string,
  ticket: string,
  outcome?: "success" | "failure" | "race",
) {
  const c = state.conflict;
  if (!c || c.epoch !== epoch || c.pending !== ticket) return;
  if (c.status === "refreshing") {
    c.pending = null;
    c.visibleRevision = c.revision;
    c.file = changedText(c.editor, c.revision);
    c.scroll.file = 0;
    c.status = "unresolved";
    c.selected = null;
    c.message = "Versions refreshed. Review the changed file and select again.";
    return;
  }
  if (c.status !== "applying" || !c.selected) return;
  const result = outcome ?? c.nextOutcome;
  c.nextOutcome = "success";
  c.pending = null;
  if (result === "race") {
    changeConflictSource(state);
    return;
  }
  const file = state.files.find(
    (file) => file.key === c.fileKey && !file.deleted,
  );
  if (result === "failure" || !file) {
    c.status = "failed";
    c.message =
      "The local file could not be written. Check that its folder is writable, then retry.";
    return;
  }
  commit(file, c[c.selected]);
  c.status = "resolved";
  c.open = false;
  c.message = `${c.selected === "editor" ? "Editor text" : "Changed file"} saved locally. Conflict resolved.`;
}
export function automaticMerge(state: EditorState) {
  if (state.conflict && state.conflict.status !== "resolved") return;
  const file = state.files.find(
    (file) =>
      file.key === (state.conflict?.fileKey ?? "outline.md") && !file.deleted,
  );
  if (file)
    commit(file, file.draft + "\nA spare notebook is ready for each pair.\n");
}
export function conflictStatus(c: EditorConflict) {
  if (c.status === "resolved") return c.message;
  if (c.status === "applying")
    return "Saving your chosen version locally… Not saved yet.";
  if (c.status === "refreshing") return "Checking updated versions…";
  if (c.status === "stale")
    return "Selection cleared. Refresh before choosing again.";
  if (c.status === "failed")
    return "Not saved. Both versions and your selection are retained.";
  return c.selected
    ? `${c.selected === "editor" ? "Editor text" : "Changed file"} selected — not saved.`
    : "Local save paused for this file. Both versions are retained until you decide.";
}
