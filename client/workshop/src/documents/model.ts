import { documentFixtures, sourceFixtures } from "./fixtures";
import { documentSearchScore } from "./search";

export interface Source {
  id: string;
  name: string;
  detail: string;
  included: string;
  excluded: string;
  rules: string;
  checked: string;
  status: "ready" | "pending" | "error";
  pending: number;
  paused?: boolean;
}
export interface DocumentItem {
  id: string;
  title: string;
  filename: string;
  source: string;
  folder: string;
  date: string;
  type: "PDF" | "Image" | "Spreadsheet";
  content: string;
  concepts: string[];
  excerpt: string;
  pages: string[];
  availability: "available" | "other-device" | "offline";
  preparation: "ready" | "pending" | "error";
  thumbnail: "available" | "pending" | "unavailable" | "error";
  metadata: string;
}
export interface DocumentsState {
  query: string;
  returnFocus: "freshness" | "preview" | "query" | null;
  scroll: { collection: number; results: number };
  documents: DocumentItem[];
  sources: Source[];
  draftQuery: string;
  thumbnailMode: "fixture" | "pending" | "unavailable" | "error";
  selected: string | null;
  page: number;
  zoom: number;
  preview: "ready" | "loading" | "error";
  searchState: "ready" | "loading" | "error";
  sort: "newest" | "relevance";
  notice: "" | "refreshed" | "external";
  nextOutcome: "success" | "error" | "wait";
  pending: { kind: "refresh"; id: string } | null;
  sourceAction: { id: string; revision: number } | null;
  opening: { kind: "open" | "open-external"; id: string } | null;
  externalError: boolean;
  addOnRefresh: boolean;
}

export const documentScenarios = [
  {
    id: "documents-find",
    label: "Find a document",
    group: "Documents",
  },
  {
    id: "documents-gather",
    label: "Gather course receipts",
    group: "Documents",
  },
  {
    id: "documents-results",
    label: "Content search results",
    group: "Documents",
  },
  {
    id: "documents-previews-loading",
    label: "Document previews preparing",
    group: "Documents",
  },
  {
    id: "documents-previews-missing",
    label: "Document previews unavailable",
    group: "Documents",
  },
  { id: "documents-preview", label: "Read a PDF", group: "Documents" },
  { id: "documents-image", label: "Read an image", group: "Documents" },
  {
    id: "documents-unavailable",
    label: "Original on another device",
    group: "Documents",
  },
  { id: "documents-empty", label: "No connected sources", group: "Documents" },
  {
    id: "documents-no-results",
    label: "No matches · incomplete collection",
    group: "Documents",
  },
  { id: "documents-loading", label: "Search in progress", group: "Documents" },
  { id: "documents-error", label: "Search failed", group: "Documents" },
  {
    id: "documents-sources",
    label: "Sources in Plugins · refresh and availability",
    group: "Documents",
  },
  {
    id: "documents-connect",
    label: "Create a source · development chat",
    group: "Documents",
  },
] as const;
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function createDocumentsState(
  scenario = "documents-find",
): DocumentsState {
  const state: DocumentsState = {
    returnFocus: null,
    scroll: { collection: 0, results: 0 },
    documents: clone(documentFixtures),
    sources: clone(sourceFixtures),
    query: "",
    draftQuery: "",
    thumbnailMode:
      scenario === "documents-previews-loading"
        ? "pending"
        : scenario === "documents-previews-missing"
          ? "unavailable"
          : "fixture",
    selected: null,
    page: 0,
    zoom: 100,
    preview: "ready",
    searchState: "ready",
    sort: "newest",
    notice: "",
    pending: null,
    sourceAction: null,
    opening: null,
    externalError: false,
    nextOutcome: "success",
    addOnRefresh: true,
  };
  if (scenario === "documents-gather")
    state.query = state.draftQuery = "course fee";
  if (scenario === "documents-results")
    state.query = state.draftQuery = "bicycle repair";
  if (scenario === "documents-preview") state.selected = "bike";
  if (scenario === "documents-image") state.selected = "receipt";
  if (scenario === "documents-unavailable") state.selected = "insurance";
  if (scenario === "documents-empty") {
    state.sources = [];
    state.documents = [];
  }
  if (scenario === "documents-no-results")
    state.query = state.draftQuery = "ZZ-9999";
  if (scenario === "documents-loading") {
    state.searchState = "loading";
    state.query = state.draftQuery = "bicycle repair";
  }
  if (scenario === "documents-error") {
    state.searchState = "error";
    state.query = state.draftQuery = "bicycle repair";
  }
  return state;
}
function score(s: DocumentsState, doc: DocumentItem): number {
  if (!s.query.trim()) return 1;
  if (doc.preparation !== "ready") return 0;
  return documentSearchScore(s.query, doc);
}
export function results(s: DocumentsState): DocumentItem[] {
  return s.documents
    .filter(
      (doc) =>
        s.sources.some((source) => source.id === doc.source) &&
        score(s, doc) > 0,
    )
    .sort((a, b) =>
      s.sort === "relevance" && s.query
        ? score(s, b) - score(s, a) || b.date.localeCompare(a.date)
        : b.date.localeCompare(a.date),
    );
}
export function incomplete(s: DocumentsState): boolean {
  return s.sources.some(
    (source) =>
      source.paused || source.status !== "ready" || source.pending > 0,
  );
}
export function closeDocument(s: DocumentsState) {
  s.selected = null;
  s.opening = null;
  s.externalError = false;
  s.notice = "";
}
export function clearSelection(s: DocumentsState) {
  closeDocument(s);
  Object.assign(s, {
    query: "",
    draftQuery: "",
    searchState: "ready",
    sort: "newest",
  });
}
export function finishDocumentAction(
  s: DocumentsState,
  ok: boolean,
  operation: "opening" | "source" = s.opening ? "opening" : "source",
) {
  if (operation === "opening") {
    const opening = s.opening;
    if (!opening) return;
    s.opening = null;
    if (opening.kind === "open-external") {
      s.externalError = !ok;
      if (ok) s.notice = "external";
    } else {
      s.preview = ok ? "ready" : "error";
    }
    return;
  }
  const pending = s.pending;
  if (!pending) return;
  s.pending = null;
  const source = s.sources.find((source) => source.id === pending.id);
  if (!source) return;
  source.status = ok ? "ready" : "error";
  if (!ok) return;
  source.checked = "Just now";
  source.pending = 0;
  s.notice = "refreshed";
  s.documents
    .filter((doc) => doc.source === source.id)
    .forEach((doc) => {
      doc.preparation = "ready";
    });
  if (
    s.addOnRefresh &&
    source.id === "drive" &&
    !s.documents.some((d) => d.id === "new-invoice")
  ) {
    const original = s.documents.find((d) => d.id === "course");
    if (original)
      s.documents.push({
        ...clone(original),
        id: "new-invoice",
        title: "Professional course · December",
        filename: "course-december.pdf",
        date: "2025-12-18",
        excerpt: "Registration and course fee for December.",
        content:
          "Professional course registration and course fee for December 2025.",
        pages: [
          "Cedar Learning\nProfessional course · December\n\n18 December 2025\nRegistration and course fee\n\nPayment received.",
        ],
      });
  }
}
export function startDocumentAction(
  s: DocumentsState,
  kind: "open" | "open-external" | "refresh",
  id = "",
) {
  if (kind !== "refresh") {
    if (s.opening || s.selected !== id) return;
    const doc = s.documents.find((d) => d.id === id);
    const source = s.sources.find((source) => source.id === doc?.source);
    if (!doc || doc.availability !== "available") return;
    if (!source || source.paused) {
      if (kind === "open") s.preview = "error";
      return;
    }
    if (kind === "open") s.preview = "loading";
    s.externalError = false;
    s.opening = { kind, id };
    s.notice = "";
    if (s.nextOutcome !== "wait")
      finishDocumentAction(s, s.nextOutcome === "success", "opening");
    return;
  }
  if (
    s.pending ||
    !s.sources.some((source) => source.id === id && !source.paused)
  )
    return;
  s.notice = "";
  s.sourceAction = { id, revision: (s.sourceAction?.revision ?? 0) + 1 };
  s.pending = { kind, id };
  if (s.nextOutcome !== "wait")
    finishDocumentAction(s, s.nextOutcome === "success", "source");
}
export function interruptDocumentWork(s: DocumentsState) {
  if (s.opening) finishDocumentAction(s, false, "opening");
  s.pending = null;
}
export function selectDocument(s: DocumentsState, id: string) {
  closeDocument(s);
  s.selected = id;
  s.page = 0;
  s.zoom = 100;
  s.preview = "ready";
  const doc = s.documents.find((d) => d.id === id);
  if (doc?.availability === "available" && doc.type !== "Spreadsheet")
    startDocumentAction(s, "open", id);
}
export function documentScreenLabel(s: DocumentsState): string {
  return s.selected ? "Documents · preview" : "Documents · collection";
}
