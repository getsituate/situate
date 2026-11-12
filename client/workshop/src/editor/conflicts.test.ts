import { describe, expect, it } from "vitest";
import {
  automaticMerge,
  beginConflictOperation,
  changeConflictSource,
  chooseConflict,
  completeConflictOperation,
} from "./conflicts";
import {
  cloneEditorState,
  createEditorState,
  editDraft,
  editorIsEditing,
  editorScreenLabel,
  flushSaves,
  selectFile,
  setMode,
  type EditorState,
} from "./model";

function complete(state: EditorState) {
  completeConflictOperation(
    state,
    state.conflict!.epoch,
    state.conflict!.pending!,
  );
}
describe("local file conflicts", () => {
  it("starts with complete independent candidates and no implicit choice", () => {
    const state = createEditorState("conflict"),
      c = state.conflict!;
    expect(c.selected).toBeNull();
    expect(c.editor).toContain("kind: note");
    expect(c.file).toContain("Tea, introductions");
    expect(c.editor).toContain("without having the answer ready.");
    expect(c.file).toContain("without having the answer ready.");
    beginConflictOperation(state, "apply");
    expect(c.pending).toBeNull();
    expect(cloneEditorState(state)).toEqual(state);
    expect(editorScreenLabel(state)).toBe("Review versions");
    state.mode = "source";
    expect(editorIsEditing(state)).toBe(false);
  });
  it.each(["editor", "file"] as const)(
    "commits the entire %s candidate only on explicit completion",
    (choice) => {
      const state = createEditorState("conflict"),
        c = state.conflict!,
        before = state.files[0].content;
      chooseConflict(state, choice);
      beginConflictOperation(state, "apply");
      expect(c.status).toBe("applying");
      expect(state.files[0].content).toBe(before);
      const ticket = c.pending;
      chooseConflict(state, choice === "file" ? "editor" : "file");
      beginConflictOperation(state, "apply");
      expect(c.pending).toBe(ticket);
      expect(c.selected).toBe(choice);
      const expected = c[choice];
      complete(state);
      expect(state.files[0].content).toBe(expected);
      expect(state.files[0].draft).toBe(expected);
      expect(state.files[0].versions[0].content).toBe(expected);
      expect(state.files[0].versions).toHaveLength(4);
      expect(c.open).toBe(false);
      expect(c.status).toBe("resolved");
      completeConflictOperation(state, c.epoch, ticket!);
      expect(state.files[0].versions).toHaveLength(4);
    },
  );
  it("retains both candidates and the selection on failure, then retries successfully", () => {
    const state = createEditorState("conflict-failure"),
      c = state.conflict!,
      candidates = [c.editor, c.file];
    chooseConflict(state, "file");
    beginConflictOperation(state, "apply");
    complete(state);
    expect(c.status).toBe("failed");
    expect(c.selected).toBe("file");
    expect([c.editor, c.file]).toEqual(candidates);
    expect(state.files[0].versions).toHaveLength(3);
    expect(editorScreenLabel(state)).toBe("Conflict save failure");
    beginConflictOperation(state, "apply");
    c.open = false;
    complete(state);
    expect(c.status).toBe("resolved");
    expect(state.files[0].content).toBe(c.file);
  });
  it("invalidates pending outcomes and retains stale readable copies until refresh completes", () => {
    const state = createEditorState("conflict"),
      c = state.conflict!,
      original = c.file;
    chooseConflict(state, "file");
    beginConflictOperation(state, "apply");
    const ticket = c.pending!;
    changeConflictSource(state);
    completeConflictOperation(state, c.epoch, ticket);
    expect(c.status).toBe("stale");
    expect(c.selected).toBeNull();
    expect(c.file).toBe(original);
    chooseConflict(state, "editor");
    beginConflictOperation(state, "apply");
    expect(c.pending).toBeNull();
    c.scroll = { editor: 99, file: 150 };
    beginConflictOperation(state, "refresh");
    expect(c.file).toBe(original);
    complete(state);
    expect(c.visibleRevision).toBe(2);
    expect(c.file).toContain("Latest file update 2");
    expect(c.scroll).toEqual({ editor: 99, file: 0 });
    expect(c.selected).toBeNull();
  });
  it("rejects stale refreshes and completions from a reset scenario", () => {
    const state = createEditorState("conflict-race");
    chooseConflict(state, "editor");
    beginConflictOperation(state, "apply");
    complete(state);
    expect(state.conflict!.status).toBe("stale");
    beginConflictOperation(state, "refresh");
    const { epoch, pending } = state.conflict!;
    changeConflictSource(state);
    completeConflictOperation(state, epoch, pending!);
    expect(state.conflict!.visibleRevision).toBe(1);
    expect(state.conflict!.revision).toBe(3);
    const reset = createEditorState("conflict");
    chooseConflict(reset, "file");
    beginConflictOperation(reset, "apply");
    completeConflictOperation(reset, epoch, reset.conflict!.pending!);
    expect(reset.conflict!.status).toBe("applying");
  });
  it("pauses saves and edits only for the conflicting file", () => {
    const state = createEditorState("conflict");
    state.conflict!.open = false;
    const original = state.files[0].content;
    expect(editDraft(state, original + "\nNot accepted")).toBe(false);
    state.files[0].draft += "\nUnsaved";
    flushSaves(state);
    expect(state.files[0].content).toBe(original);
    automaticMerge(state);
    expect(state.files[0].content).toBe(original);
    selectFile(state, "preparation.md");
    setMode(state, "source");
    expect(editDraft(state, state.files[1].draft + "\nAccepted")).toBe(true);
    flushSaves(state);
    expect(state.files[1].content).toContain("Accepted");
    expect(editorIsEditing(state)).toBe(true);
  });
  it("silently commits repeated merges without changing navigation, history or unrelated drafts", () => {
    const state = createEditorState("merged");
    selectFile(state, "preparation.md");
    setMode(state, "source");
    state.historical = { ...state.files[1].versions[0] };
    const history = { ...state.historical };
    const previous = state.files[0].content,
      unrelated = { ...state.files[1] };
    automaticMerge(state);
    automaticMerge(state);
    expect(state.files[0].content).toBe(
      previous + "\nA spare notebook is ready for each pair.\n".repeat(2),
    );
    expect(state.files[0].content).toBe(state.files[0].draft);
    expect(state.files[0].versions).toHaveLength(5);
    expect(state.files[1]).toEqual(unrelated);
    expect(state.currentKey).toBe("preparation.md");
    expect(state.mode).toBe("source");
    expect(state.historical).toEqual(history);
    expect(state.conflict!.message).toBe("");
    expect(state.conflict!.open).toBe(false);
  });
});
