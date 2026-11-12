import { describe, expect, it } from "vitest";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import {
  clone,
  createDocumentsState,
  emptyFilter,
  finishDocumentAction,
  hasTag,
  openSaved,
  results,
  saveView,
  selectDocument,
  startDocumentAction,
} from "./model";

describe("document collection", () => {
  it("opens documents independently of a waiting source refresh", () => {
    const s = createDocumentsState();
    s.nextOutcome = "wait";
    startDocumentAction(s, "refresh", "drive");
    selectDocument(s, "bike");
    expect(s.preview).toBe("loading");
    expect(s.opening).toBe("bike");
    expect(s.pending).toEqual({ kind: "refresh", id: "drive" });
    finishDocumentAction(s, false, "opening");
    expect(s.preview).toBe("error");
    expect(s.pending).not.toBeNull();
    finishDocumentAction(s, true, "source");
    expect(s.pending).toBeNull();
    expect(s.preview).toBe("error");
  });
  it("reports external opening only after its own action completes", () => {
    const s = createDocumentsState();
    s.nextOutcome = "wait";
    startDocumentAction(s, "refresh", "drive");
    selectDocument(s, "sheet");
    startDocumentAction(s, "open", "sheet");
    expect(s.notice).toBe("");
    finishDocumentAction(s, true, "opening");
    expect(s.notice).toBe("external");
    expect(s.pending?.kind).toBe("refresh");
  });
  it("saves the visible search draft rather than a previous query", () => {
    const s = createDocumentsState();
    s.query = "old";
    s.draftQuery = "VE-2048";
    s.draftName = "Repair";
    saveView(s);
    expect(s.saved.at(-1)?.query).toBe("VE-2048");
  });
  it("finds identifiers in content rather than relying on filenames", () => {
    const s = createDocumentsState();
    s.query = "VE-2048";
    expect(results(s).map((d) => d.id)).toEqual(["bike"]);
    expect(results(s)[0]?.filename).not.toContain("VE-2048");
  });
  it("uses bounded concept fixtures for the meaning-based search example", () => {
    const s = createDocumentsState();
    s.query = "bicycle repair";
    expect(results(s).map((d) => d.id)).toEqual(["bike"]);
    expect(results(s)[0]?.content).not.toContain("bicycle repair");
  });
  it("restores a fuzzy query and its tag criteria without a saved search mode", () => {
    const s = createDocumentsState();
    s.draftQuery = "bicycel repair";
    s.filter.tags = ["home"];
    s.draftName = "Bike repair";
    saveView(s);
    const saved = clone(s.saved.at(-1)!);
    expect(saved).not.toHaveProperty("mode");
    expect(s).not.toHaveProperty("mode");
    s.query = "VE-2049";
    s.filter = emptyFilter();
    openSaved(s, saved.id);
    expect(s.query).toBe("bicycel repair");
    expect(s.draftQuery).toBe(s.query);
    expect(s.filter.tags).toEqual(["home"]);
    expect(results(s).map((doc) => doc.id)).toEqual(["bike"]);
  });
  it("includes all descendants, but not sibling-only tags", () => {
    const s = createDocumentsState();
    const course = s.documents.find((d) => d.id === "course")!;
    expect(hasTag(s, course, "tax")).toBe(true);
    expect(hasTag(s, course, "expenses")).toBe(true);
    expect(hasTag(s, course, "training")).toBe(true);
    s.filter.tags = ["2024"];
    expect(results(s).map((d) => d.id)).toEqual(["old-course"]);
    s.filter = emptyFilter();
    s.untagged = true;
    expect(results(s).map((d) => d.id)).toEqual(["untagged"]);
  });
  it("keeps unknown content out of search without hiding it from browsing", () => {
    const s = createDocumentsState();
    s.query = "travel";
    expect(results(s)).toHaveLength(0);
    s.query = "";
    expect(results(s).some((d) => d.id === "pending")).toBe(true);
    startDocumentAction(s, "refresh", "drive");
    s.query = "travel";
    expect(results(s).map((d) => d.id)).toEqual(["pending"]);
  });
  it("does not equate refreshed metadata with a reachable original", () => {
    const s = createDocumentsState();
    startDocumentAction(s, "refresh", "computer");
    selectDocument(s, "insurance");
    expect(s.documents.find((d) => d.id === "insurance")?.availability).toBe(
      "other-device",
    );
    expect(s.pending).toBeNull();
  });
  it("saves a dynamic selection with its tags and matching mode intact", () => {
    const s = createDocumentsState("documents-gather");
    s.draftName = "Tax 2025";
    saveView(s);
    const saved = clone(s.saved.at(-1)!);
    const before = results(s).length;
    s.filter = emptyFilter();
    startDocumentAction(s, "refresh", "drive");
    openSaved(s, saved.id);
    expect(s.filter).toEqual(saved.filter);
    expect(results(s)).toHaveLength(before + 1);
    expect(results(s).some((d) => d.id === "new-invoice")).toBe(true);
    expect(s.saved.at(-1)).toEqual(saved);
  });
  it("browses the agreed collection across sources and retains origin metadata", () => {
    const s = createDocumentsState();
    expect(results(s)).toHaveLength(s.documents.length);
    expect(new Set(results(s).map((doc) => doc.source))).toEqual(
      new Set(["paperless", "drive", "computer"]),
    );
    expect(results(s).find((doc) => doc.id === "course")?.folder).toBe(
      "Finance/2025",
    );
    expect(s).not.toHaveProperty("source");
    expect(s).not.toHaveProperty("folder");
    s.draftName = "All documents";
    saveView(s);
    expect(s.saved.at(-1)).not.toHaveProperty("source");
    expect(s.saved.at(-1)).not.toHaveProperty("folder");
    s.sources = s.sources.filter((source) => source.id !== "drive");
    expect(results(s).some((doc) => doc.source === "drive")).toBe(false);
  });
  it("exposes held and failed opening and refresh outcomes", () => {
    const s = createDocumentsState();
    s.nextOutcome = "wait";
    selectDocument(s, "bike");
    expect(s.preview).toBe("loading");
    finishDocumentAction(s, false);
    expect(s.preview).toBe("error");
    startDocumentAction(s, "refresh", "drive");
    finishDocumentAction(s, false);
    expect(s.sources.find((source) => source.id === "drive")?.status).toBe(
      "error",
    );
    startDocumentAction(s, "refresh", "drive");
    finishDocumentAction(s, true);
    expect(s.sources.find((source) => source.id === "drive")?.status).toBe(
      "ready",
    );
  });
});

describe("document workshop transitions", () => {
  it("rejects a late document command from a different workspace", () => {
    const initial = createSimulation("documents-find");
    const edited = clone(initial.documents);
    edited.draftQuery = "Other workspace draft";
    const switched = reduceSimulation(initial, {
      type: "action",
      operation: { request: "switch", action: "open", id: "sample-2" },
    });
    const late = reduceSimulation(switched, {
      type: "documents",
      state: edited,
      base: initial.documents,
      workspaceId: "sample-1",
    });
    expect(late.documents).toEqual(switched.documents);
  });
  it("makes interrupted previews retryable after close or quit", () => {
    const initial = createSimulation("documents-find");
    initial.documents.nextOutcome = "wait";
    selectDocument(initial.documents, "bike");
    const closed = reduceSimulation(initial, {
      type: "action",
      operation: { request: "close", action: "close", id: "sample-1" },
    });
    const reopened = reduceSimulation(closed, {
      type: "action",
      operation: { request: "open", action: "open", id: "sample-1" },
    });
    expect(reopened.documents.preview).toBe("error");
    expect(reopened.documents.opening).toBeNull();
    const quit = reduceSimulation(initial, {
      type: "action",
      operation: { request: "quit", action: "quit" },
    });
    expect(quit.documents.preview).toBe("error");
    expect(quit.documents.opening).toBeNull();
  });
  it("preserves drafts and filter edits across platform and keyboard changes", () => {
    const initial = createSimulation("documents-gather");
    initial.documents.draftQuery = "My unsent search";
    initial.documents.filter.operator = "any";
    const changed = reduceSimulation(
      reduceSimulation(initial, { type: "platform", mobile: true }),
      { type: "environment", state: { profile: "ios", keyboardOpen: true } },
    );
    expect(changed.documents).toEqual(initial.documents);
    expect(changed.epoch).toBe(initial.epoch);
  });
  it("resets pending work, new views and edits while preserving the environment", () => {
    const initial = createSimulation("documents-gather");
    initial.documents.nextOutcome = "wait";
    initial.documents.sidebarWidth = 400;
    startDocumentAction(initial.documents, "refresh", "drive");
    initial.documents.draftName = "Tax";
    saveView(initial.documents);
    const reset = reduceSimulation(initial, { type: "reset" });
    finishDocumentAction(reset.documents, true);
    expect(reset.documents).toEqual(createDocumentsState("documents-gather"));
    expect(reset.epoch).toBe(initial.epoch + 1);
  });
  it("offers only screen-relevant controls when navigating into and out of documents", () => {
    let s = createSimulation("documents-find");
    expect(screenControls(s)).toMatchObject({
      controls: ["documents"],
      canSetOutcome: false,
      label: "Documents · collection",
    });
    s = reduceSimulation(s, {
      type: "document-sources",
      action: "list",
      workspaceId: s.snapshot.current!.id,
    });
    expect(screenControls(s)).toMatchObject({
      label: "Plugins",
      sourceManagement: true,
    });
    s = reduceSimulation(s, { type: "feature", feature: "documents" });
    s.documents.dialog = "save";
    expect(screenControls(s).label).toBe("Documents · save");
    s = reduceSimulation(s, { type: "feature", feature: "editor" });
    expect(screenControls(s).controls).toEqual(["editor"]);
  });
  it("keeps changed selections and saved searches local to their workspace", () => {
    let s = createSimulation("documents-gather");
    s.documents.draftName = "Tax 2025";
    s.documents.sidebarWidth = 400;
    saveView(s.documents);
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "other", action: "open", id: "sample-2" },
    });
    expect(s.documents.saved.some((view) => view.name === "Tax 2025")).toBe(
      false,
    );
    expect(s.documents.sidebarWidth).toBe(272);
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "return", action: "open", id: "sample-1" },
    });
    expect(s.documents.saved.some((view) => view.name === "Tax 2025")).toBe(
      true,
    );
    expect(s.documents.sidebarWidth).toBe(400);
  });
});
