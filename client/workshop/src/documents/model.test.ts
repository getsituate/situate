import { describe, expect, it } from "vitest";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import {
  clearSelection,
  clone,
  createDocumentsState,
  finishDocumentAction,
  results,
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
    expect(s.opening).toEqual({ kind: "open", id: "bike" });
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
    startDocumentAction(s, "open-external", "sheet");
    expect(s.notice).toBe("");
    finishDocumentAction(s, true, "opening");
    expect(s.notice).toBe("external");
    expect(s.pending?.kind).toBe("refresh");
  });
  it("keeps the current page and zoom when opening in another app fails", () => {
    const s = createDocumentsState("documents-preview");
    s.page = 1;
    s.zoom = 120;
    s.nextOutcome = "error";
    startDocumentAction(s, "open-external", "bike");
    expect(s).toMatchObject({
      selected: "bike",
      preview: "ready",
      externalError: true,
      opening: null,
      page: 1,
      zoom: 120,
    });
    selectDocument(s, "receipt");
    expect(s.externalError).toBe(false);
  });
  it("does not open originals on another device or from a paused source", () => {
    const s = createDocumentsState("documents-unavailable");
    s.nextOutcome = "wait";
    startDocumentAction(s, "open-external", "insurance");
    expect(s.opening).toBeNull();
    selectDocument(s, "sheet");
    const sourceId = s.documents.find((d) => d.id === "sheet")!.source;
    s.sources.find((source) => source.id === sourceId)!.paused = true;
    startDocumentAction(s, "open-external", "sheet");
    expect(s.opening).toBeNull();
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
  it("clears both the submitted query and the draft to restore the collection", () => {
    const s = createDocumentsState("documents-gather");
    s.draftQuery = "unsent";
    s.sort = "relevance";
    clearSelection(s);
    expect(s.query).toBe("");
    expect(s.draftQuery).toBe("");
    expect(s.sort).toBe("newest");
    expect(results(s)).toHaveLength(s.documents.length);
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
  it("includes newly matching content in the current results after refresh", () => {
    const s = createDocumentsState("documents-gather");
    expect(results(s).map((d) => d.id)).toEqual(["course"]);
    startDocumentAction(s, "refresh", "drive");
    expect(s.query).toBe("course fee");
    expect(results(s).map((d) => d.id)).toEqual(["new-invoice", "course"]);
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
  it("preserves the query and draft across platform and keyboard changes", () => {
    const initial = createSimulation("documents-gather");
    initial.documents.draftQuery = "My unsent search";
    const changed = reduceSimulation(
      reduceSimulation(initial, { type: "platform", mobile: true }),
      { type: "environment", state: { profile: "ios", keyboardOpen: true } },
    );
    expect(changed.documents).toEqual(initial.documents);
    expect(changed.epoch).toBe(initial.epoch);
  });
  it("resets pending work and search edits while preserving the environment", () => {
    const initial = createSimulation("documents-gather");
    initial.documents.nextOutcome = "wait";
    startDocumentAction(initial.documents, "refresh", "drive");
    initial.documents.draftQuery = "Another search";
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
    expect(screenControls(s).label).toBe("Documents · collection");
    s = reduceSimulation(s, { type: "feature", feature: "editor" });
    expect(screenControls(s).controls).toEqual(["editor"]);
  });
  it("keeps submitted searches and drafts local to their workspace", () => {
    let s = createSimulation("documents-gather");
    s.documents.query = "VE-2048";
    s.documents.draftQuery = "Something else";
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "other", action: "open", id: "sample-2" },
    });
    expect(s.documents.query).toBe("");
    expect(s.documents.draftQuery).toBe("");
    s = reduceSimulation(s, {
      type: "action",
      operation: { request: "return", action: "open", id: "sample-1" },
    });
    expect(s.documents.query).toBe("VE-2048");
    expect(s.documents.draftQuery).toBe("Something else");
  });
});
