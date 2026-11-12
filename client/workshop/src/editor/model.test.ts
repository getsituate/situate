import { describe, expect, it } from "vitest";
import {
  applyItemAction,
  cloneEditorState,
  closePane,
  copyWithNewIdentities,
  createEditorState,
  currentFile,
  deleteItem,
  destinationFolders,
  editDraft,
  editorIsEditing,
  editorScreenLabel,
  flushSaves,
  openChat,
  openReference,
  referenceForCurrent,
  resolveReference,
  saveFile,
  selectFile,
  setHistory,
  setMode,
  type EditorScene,
  type ItemTarget,
} from "./model";
import { diffLines, markdownBlocks } from "./markdown";

const outline: ItemTarget = { kind: "file", key: "outline.md" };
const workshop: ItemTarget = {
  kind: "folder",
  path: "Projects/Autumn workshop",
};

describe("editor state", () => {
  it.each<EditorScene>([
    "read",
    "source",
    "chat",
    "history",
    "save-error",
    "empty",
  ])("creates a JSON round-trippable %s scene", (scene) => {
    const state = createEditorState(scene);
    expect(cloneEditorState(state)).toEqual(state);
    expect(editorScreenLabel(state)).not.toBe("");
    expect(editorIsEditing(state)).toBe(
      scene === "source" || scene === "save-error" || scene === "chat",
    );
    expect(createEditorState(scene)).toEqual(state);
  });
  it("does not share mutable fixture content between instances", () => {
    const a = createEditorState(),
      b = createEditorState();
    a.files[0].versions[0].content = "changed";
    expect(b.files[0].versions[0].content).toContain("# Autumn workshop");
  });
  it("keeps failed drafts and history separate, then saves once on retry", () => {
    const state = createEditorState("source"),
      file = currentFile(state)!;
    const previous = file.content;
    state.saveOutcome = "failure";
    expect(editDraft(state, previous + "\nRetain this.")).toBe(true);
    saveFile(state);
    expect(file).toMatchObject({
      content: previous,
      draft: previous + "\nRetain this.",
      saveError: true,
    });
    expect(file.versions).toHaveLength(3);
    selectFile(state, "preparation.md");
    selectFile(state, "outline.md");
    expect(currentFile(state)!.draft).toContain("Retain this.");
    state.saveOutcome = "success";
    flushSaves(state);
    flushSaves(state);
    expect(file.content).toBe(previous + "\nRetain this.");
    expect(file.versions).toHaveLength(4);
    expect(file.versions[1].content).toBe(previous);
  });
  it("blocks replacing a document or its task IDs until explicitly allowed", () => {
    const state = createEditorState("source");
    selectFile(state, "preparation.md");
    const file = currentFile(state)!,
      previous = file.draft;
    expect(editDraft(state, "Whole replacement")).toBe(false);
    expect(
      editDraft(
        state,
        previous.replace("93e12765-92d1-4ed8-b889-49b34e8d2397", "changed"),
      ),
    ).toBe(false);
    saveFile(state);
    expect(file.versions).toHaveLength(1);
    state.idEditingAllowed = true;
    expect(editDraft(state, "Whole replacement")).toBe(true);
    saveFile(state);
    expect(file.versions[0].content).toBe("Whole replacement");
    setMode(state, "read");
    expect(state.idEditingAllowed).toBe(false);
  });
  it("keeps earlier snapshots immutable across later saves and blocks editing them", () => {
    const state = createEditorState("history"),
      before = currentFile(state)!.content;
    const snapshot = state.historical!.content;
    expect(editDraft(state, "changed")).toBe(false);
    expect(currentFile(state)!.content).toBe(before);
    const reference = referenceForCurrent(state)!;
    state.historical = null;
    editDraft(state, before + "\nLater");
    saveFile(state);
    openReference(state, reference);
    expect(state.historical!.content).toBe(snapshot);
    expect(currentFile(state)!.draft).toContain("Later");
    setHistory(state, false);
    expect(state.historical).toBeNull();
  });
});

describe("file and folder actions", () => {
  it("targets another file without changing the open draft or its history", () => {
    const state = createEditorState("save-error"),
      draft = state.files[0].draft;
    const target: ItemTarget = { kind: "file", key: "preparation.md" };
    expect(
      applyItemAction(
        state,
        "rename",
        target,
        "agenda.md",
        "Projects/Autumn workshop",
      ),
    ).toBeNull();
    expect(
      applyItemAction(state, "move", target, "agenda.md", "Resources"),
    ).toBeNull();
    expect(state.currentKey).toBe("outline.md");
    expect(state.files[0].draft).toBe(draft);
    expect(state.files[1].folder).toBe("Resources");
    expect(state.files[1].versions).toHaveLength(1);
  });
  it("copies unsaved text and regenerates only file and task IDs, including quoted IDs", () => {
    const original =
      '---\nid: "209bef27-dd0a-48bf-8413-d605ab13b3d3"\nkind: note\nliteral: "$& $$ $\' $`"\n---\n- [ ] Prepare <!-- situate-task-id: \'93e12765-92d1-4ed8-b889-49b34e8d2397\' -->\nReference: ca59c2dc-d877-40da-83cf-5c4b98368d9b';
    const copied = copyWithNewIdentities(original)!;
    expect(copied).not.toContain("209bef27-dd0a-48bf-8413-d605ab13b3d3");
    expect(copied).not.toContain("93e12765-92d1-4ed8-b889-49b34e8d2397");
    expect(copied).toContain('literal: "$& $$ $\' $`"');
    expect(copied).toContain("ca59c2dc-d877-40da-83cf-5c4b98368d9b");
    const state = createEditorState("save-error");
    const draft = state.files[0].draft;
    expect(
      applyItemAction(
        state,
        "duplicate",
        workshop,
        "Autumn workshop copy",
        "Projects",
      ),
    ).toBeNull();
    expect(state.currentKey).toBe("outline.md");
    const copy = state.files.find(
      (file) =>
        file.folder === "Projects/Autumn workshop copy" &&
        file.name === "outline.md",
    )!;
    expect(copy.draft).toContain("A thought to keep working on.");
    expect(state.files[0].draft).toBe(draft);
    expect(copy.versions).toHaveLength(1);
  });
  it("rejects unsafe copies atomically", () => {
    const state = createEditorState();
    state.files[1].draft += "\n<!-- situate-task-id: malformed -->";
    const before = cloneEditorState(state);
    expect(applyItemAction(state, "duplicate", workshop, "Copy", "")).toContain(
      "cannot be copied safely",
    );
    expect(state).toEqual(before);
  });
  it("moves a folder subtree without changing identities or versions", () => {
    const state = createEditorState();
    const before = state.files[0].versions.map((version) => ({ ...version }));
    const target: ItemTarget = { kind: "folder", path: "Projects" };
    expect(destinationFolders(state, target, "move")).toEqual([
      "",
      "Archive",
      "Resources",
    ]);
    expect(
      applyItemAction(state, "move", target, "Projects", "Resources"),
    ).toBeNull();
    expect(state.folders).toContain("Resources/Projects/Autumn workshop");
    expect(state.files[0].folder).toBe("Resources/Projects/Autumn workshop");
    expect(state.files[0].versions).toEqual(before);
    expect(state.expanded).toContain("Resources/Projects/Autumn workshop");
  });
  it.each(["..", ".", "bad/name.md", "bad\\name.md", ""])(
    "rejects invalid names: %s",
    (name) => {
      expect(
        applyItemAction(
          createEditorState(),
          "create",
          { kind: "folder", path: "" },
          name,
          "",
        ),
      ).toContain("Use a name");
    },
  );
  it("rejects collisions and moving folders into descendants", () => {
    const state = createEditorState();
    expect(
      applyItemAction(
        state,
        "create",
        outline,
        "outline.md",
        "Projects/Autumn workshop",
      ),
    ).toContain("already exists");
    expect(
      applyItemAction(
        state,
        "move",
        { kind: "folder", path: "Projects" },
        "Projects",
        "Projects/Autumn workshop",
      ),
    ).toContain("outside");
  });
  it("creates Markdown at the root and opens source, preserving other drafts", () => {
    const state = createEditorState("save-error"),
      draft = state.files[0].draft;
    expect(
      applyItemAction(
        state,
        "create",
        { kind: "folder", path: "" },
        "root-note.md",
        "",
      ),
    ).toBeNull();
    expect(currentFile(state)).toMatchObject({
      name: "root-note.md",
      folder: "",
    });
    expect(currentFile(state)!.content).toMatch(
      /^---\nid: [\da-f-]{36}\n---\n# root note/,
    );
    expect(state.mode).toBe("source");
    expect(state.files[0].draft).toBe(draft);
  });
  it("removes a subtree from the live collection but retains its file history", () => {
    const state = createEditorState(),
      before = state.files[0].versions.map((version) => ({ ...version }));
    deleteItem(state, workshop);
    expect(state.folders).not.toContain("Projects/Autumn workshop");
    expect(state.files[0].deleted).toBe(true);
    expect(state.files[0].versions).toEqual(before);
    expect(currentFile(state)!.name).toBe("reading-list.md");
  });
});

describe("independent chats and references", () => {
  it("does not retarget a live reference while browsing; rename and move follow its identity", () => {
    const state = createEditorState("chat"),
      first = state.chats[0];
    first.draft = "Which part could be shorter?";
    selectFile(state, "preparation.md");
    openChat(state, referenceForCurrent(state));
    expect(first.references[0].fileKey).toBe("outline.md");
    expect(state.chats[1].references[0].fileKey).toBe("preparation.md");
    expect(state.chats[1].draft).toBe("");
    applyItemAction(
      state,
      "rename",
      outline,
      "workshop-plan.md",
      "Projects/Autumn workshop",
    );
    applyItemAction(state, "move", outline, "workshop-plan.md", "Resources");
    expect(resolveReference(state, first.references[0])).toEqual({
      name: "workshop-plan.md",
      detail: "Resources",
      state: "ready",
    });
    expect(first.draft).toBe("Which part could be shorter?");
  });
  it("shows pending, failed and missing states and opens the latest live draft", () => {
    const state = createEditorState("chat"),
      reference = state.chats[0].references[0];
    state.files[0].draft += "\nLater";
    expect(resolveReference(state, reference).state).toBe("saving");
    state.saveOutcome = "failure";
    flushSaves(state);
    expect(resolveReference(state, reference).state).toBe("error");
    openReference(state, reference);
    expect(currentFile(state)!.draft).toContain("Later");
    deleteItem(state, outline);
    expect(resolveReference(state, reference).state).toBe("missing");
    const current = state.currentKey;
    openReference(state, reference);
    expect(state.currentKey).toBe(current);
  });
  it("blank chats have no inherited references and closing panes retains other drafts", () => {
    const state = createEditorState("chat");
    state.chats[0].draft = "Keep this";
    openChat(state);
    expect(state.chats[1].references).toEqual([]);
    closePane(state, state.chats[1].key);
    expect(state.chats[0].draft).toBe("Keep this");
    closePane(state, "files");
    expect(state.filesOpen).toBe(false);
    closePane(state, state.chats[0].key);
    expect(state.activePane).toBeNull();
  });
});

describe("Markdown and differences", () => {
  it("maps rendered blocks to original offsets while hiding metadata and comments", () => {
    const text =
      "---\r\nid: test\r\n---\r\n# Title\n\n<!-- hidden -->\nParagraph\n\n- [x] Task\n\n```\n<unsafe>\n```";
    const blocks = markdownBlocks(text);
    expect(blocks[0]).toEqual({
      tag: "h1",
      text: "Title",
      offset: text.indexOf("Title"),
    });
    expect(blocks[1]).toEqual({
      tag: "p",
      text: "Paragraph",
      offset: text.indexOf("Paragraph"),
    });
    expect(blocks[2].children![0]).toMatchObject({
      text: "Task",
      checked: true,
      offset: text.indexOf("[x]"),
    });
    expect(blocks[3]).toEqual({
      tag: "pre",
      text: "<unsafe>",
      offset: text.indexOf("<unsafe>"),
    });
  });
  it("includes metadata differences and preserves unchanged lines", () => {
    expect(diffLines("id: old\nSame\nRemoved", "id: new\nSame\nAdded")).toEqual(
      [
        { kind: "added", text: "id: new" },
        { kind: "removed", text: "id: old" },
        { kind: "same", text: "Same" },
        { kind: "added", text: "Added" },
        { kind: "removed", text: "Removed" },
      ],
    );
  });
  it("bounds comparison work without losing large documents", () => {
    const rows = diffLines(
      Array(501).fill("old").join("\n"),
      Array(501).fill("new").join("\n"),
    );
    expect(rows).toHaveLength(1002);
    expect(rows.filter((row) => row.kind === "removed")).toHaveLength(501);
    expect(rows.filter((row) => row.kind === "added")).toHaveLength(501);
  });
});
