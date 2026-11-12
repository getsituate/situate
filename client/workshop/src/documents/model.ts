import { documentFixtures, sourceFixtures, tagFixtures } from "./fixtures";
import { documentSearchScore } from "./search";

export interface Tag {
  id: string;
  name: string;
  parent: string | null;
}
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
  tags: string[];
  content: string;
  concepts: string[];
  excerpt: string;
  pages: string[];
  availability: "available" | "other-device" | "offline";
  preparation: "ready" | "pending" | "error";
  thumbnail: "available" | "pending" | "unavailable" | "error";
  metadata: string;
}
export interface TagFilter {
  operator: "all" | "any";
  tags: string[];
}
export interface Selection {
  query: string;
  filter: TagFilter;
  untagged: boolean;
}
export interface SavedView extends Selection {
  id: string;
  name: string;
  pinned: boolean;
}
export type DocumentDialog = "browse" | "save" | "tags" | null;
export interface TagCreation {
  name: string;
  parent: string | null;
  documentId: string | null;
  error: "name" | "duplicate" | "parent" | "document" | null;
}
export interface TagDeletion {
  id: string;
  descendants: boolean;
  error: "missing" | "collision" | null;
}
export interface DocumentsState extends Selection {
  layout: "library" | "focused";
  sidebarWidth: number;
  returnFocus: "actions" | "preview" | "query" | null;
  scroll: { collection: number; results: number };
  documents: DocumentItem[];
  sources: Source[];
  tags: Tag[];
  saved: SavedView[];
  activeSaved: string | null;
  draftQuery: string;
  thumbnailMode: "fixture" | "pending" | "unavailable" | "error";
  dialog: DocumentDialog;
  draftName: string;
  draftPinned: boolean;
  draftTags: string[];
  tagCreation: TagCreation | null;
  createdTagId: string | null;
  collectionMenu: { x: number; y: number } | null;
  tagMenu: { id: string; x: number; y: number } | null;
  tagDeletion: TagDeletion | null;
  deletedTags: Record<string, string>;
  selected: string | null;
  page: number;
  zoom: number;
  preview: "ready" | "loading" | "error";
  searchState: "ready" | "loading" | "error";
  sort: "newest" | "relevance";
  notice: "" | "saved" | "tags" | "tag-created" | "refreshed" | "external";
  nextOutcome: "success" | "error" | "wait";
  pending: { kind: "refresh"; id: string } | null;
  sourceAction: { id: string; revision: number } | null;
  opening: string | null;
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
    label: "Gather tax documents",
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
  { id: "documents-new-tag", label: "Create a tag", group: "Documents" },
  {
    id: "documents-new-document-tag",
    label: "Create a tag for a document",
    group: "Documents",
  },
  {
    id: "documents-tag-duplicate",
    label: "Tag name already exists",
    group: "Documents",
  },
  { id: "documents-no-tags", label: "Empty tag list", group: "Documents" },
  {
    id: "documents-delete-tag",
    label: "Delete a tag · keep subtags",
    group: "Documents",
  },
  {
    id: "documents-delete-branch",
    label: "Delete a tag branch",
    group: "Documents",
  },
  {
    id: "documents-tag-delete-conflict",
    label: "Subtag name conflict",
    group: "Documents",
  },
  {
    id: "documents-tag-removed",
    label: "Saved search · tag removed",
    group: "Documents",
  },
] as const;
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const emptyFilter = (): TagFilter => ({ operator: "any", tags: [] });
export const taxFilter = (): TagFilter => ({
  operator: "all",
  tags: ["tax", "2025"],
});
export function createDocumentsState(
  scenario = "documents-find",
): DocumentsState {
  const gather = scenario.includes("gather");
  const state: DocumentsState = {
    layout: scenario.endsWith("focused") ? "focused" : "library",
    sidebarWidth: 272,
    returnFocus: null,
    scroll: { collection: 0, results: 0 },
    documents: clone(documentFixtures),
    sources: clone(sourceFixtures),
    tags: clone(tagFixtures),
    query: "",
    draftQuery: "",
    filter: gather ? taxFilter() : emptyFilter(),
    untagged: false,
    saved: [],
    activeSaved: null,
    thumbnailMode:
      scenario === "documents-previews-loading"
        ? "pending"
        : scenario === "documents-previews-missing"
          ? "unavailable"
          : "fixture",
    dialog: null,
    draftName: "",
    draftPinned: true,
    draftTags: [],
    tagCreation: null,
    createdTagId: null,
    collectionMenu: null,
    tagMenu: null,
    tagDeletion: null,
    deletedTags: {},
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
    nextOutcome: "success",
    addOnRefresh: true,
  };
  state.saved = [
    {
      ...selection(state),
      id: "home",
      name: "Home & repairs",
      pinned: true,
      filter: { operator: "any", tags: ["home"] },
    },
  ];
  if (scenario === "documents-results")
    state.query = state.draftQuery = "bicycle repair";
  if (scenario === "documents-preview") state.selected = "bike";
  if (scenario === "documents-image") state.selected = "receipt";
  if (scenario === "documents-unavailable") state.selected = "insurance";
  if (scenario === "documents-empty") {
    state.sources = [];
    state.documents = [];
    state.saved = [];
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
  if (scenario === "documents-no-tags") {
    state.tags = [];
    state.documents.forEach((doc) => {
      doc.tags = [];
    });
    state.saved = [];
  }
  if (
    [
      "documents-new-tag",
      "documents-new-document-tag",
      "documents-tag-duplicate",
    ].includes(scenario)
  ) {
    const forDocument = scenario === "documents-new-document-tag";
    if (forDocument) {
      state.selected = "bike";
      state.dialog = "tags";
      state.draftTags = [
        ...state.documents.find((doc) => doc.id === "bike")!.tags,
      ];
    }
    state.tagCreation = {
      name: scenario === "documents-tag-duplicate" ? "Tax" : "",
      parent: null,
      documentId: forDocument ? "bike" : null,
      error: scenario === "documents-tag-duplicate" ? "duplicate" : null,
    };
  }
  if (
    [
      "documents-delete-tag",
      "documents-delete-branch",
      "documents-tag-delete-conflict",
    ].includes(scenario)
  ) {
    state.tagDeletion = {
      id: "home",
      descendants: scenario === "documents-delete-branch",
      error: null,
    };
    if (scenario === "documents-tag-delete-conflict") {
      state.tags.push({ id: "root-repairs", name: "Repairs", parent: null });
    }
  }
  if (
    [
      "documents-tag-removed",
      "documents-missing-tag",
      "documents-repair-view",
    ].includes(scenario)
  ) {
    state.deletedTags.home = "Home";
    state.tags = state.tags.filter((tag) => tag.id !== "home");
    state.tags.find((tag) => tag.id === "repairs")!.parent = null;
    state.documents.forEach((doc) => {
      doc.tags = doc.tags.filter((id) => id !== "home");
    });
    openSaved(state, "home");
  }
  return state;
}
export function purgeDeletedTagReferences(s: DocumentsState) {
  const keep = (id: string) => !Object.hasOwn(s.deletedTags, id);
  for (const filter of [s.filter, ...s.saved.map((view) => view.filter)]) {
    const tags = filter.tags.filter(keep);
    if (tags.length === filter.tags.length) continue;
    filter.tags = tags;
    if (!tags.length) filter.operator = "any";
  }
  for (const doc of s.documents) doc.tags = doc.tags.filter(keep);
  s.draftTags = s.draftTags.filter(keep);
  if (s.createdTagId && !keep(s.createdTagId)) s.createdTagId = null;
}
export function selection(s: Selection): Selection {
  return clone({
    query: s.query,
    filter: s.filter,
    untagged: s.untagged,
  });
}
export function tagPath(tags: Tag[], id: string): string {
  const tag = tags.find((t) => t.id === id);
  return tag
    ? (tag.parent ? `${tagPath(tags, tag.parent)} / ` : "") + tag.name
    : id;
}
export function missingFilterTags(
  s: DocumentsState,
  filter = s.filter,
): string[] {
  return filter.tags.filter((id) => !s.tags.some((tag) => tag.id === id));
}
export function filterTagName(s: DocumentsState, id: string): string {
  return s.tags.some((tag) => tag.id === id)
    ? tagPath(s.tags, id)
    : (s.deletedTags[id] ?? id);
}
export function hasTag(
  s: Pick<DocumentsState, "tags">,
  doc: DocumentItem,
  tag: string,
): boolean {
  return doc.tags.some((id) => {
    let current: string | null = id;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === tag) return true;
      visited.add(current);
      current = s.tags.find((t) => t.id === current)?.parent ?? null;
    }
    return false;
  });
}
export function matchesFilter(
  s: DocumentsState,
  doc: DocumentItem,
  filter: TagFilter,
): boolean {
  if (missingFilterTags(s, filter).length) return false;
  if (!filter.tags.length) return true;
  return filter.operator === "all"
    ? filter.tags.every((tag) => hasTag(s, doc, tag))
    : filter.tags.some((tag) => hasTag(s, doc, tag));
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
        (!s.untagged || doc.tags.length === 0) &&
        matchesFilter(s, doc, s.filter) &&
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
export function clearSelection(s: DocumentsState) {
  Object.assign(s, {
    query: "",
    draftQuery: "",
    filter: emptyFilter(),
    untagged: false,
    activeSaved: null,
    selected: null,
    opening: null,
    searchState: "ready",
    notice: "",
  });
}
export function saveView(s: DocumentsState) {
  purgeDeletedTagReferences(s);
  if (!s.draftName.trim() || missingFilterTags(s).length) return;
  s.query = s.draftQuery;
  s.searchState = "ready";
  const id = `view-${s.saved.length + 1}`;
  s.saved.push({
    ...selection(s),
    id,
    name: s.draftName.trim(),
    pinned: s.draftPinned,
  });
  s.activeSaved = id;
  s.dialog = null;
  s.notice = "saved";
}
export function openSaved(s: DocumentsState, id: string) {
  purgeDeletedTagReferences(s);
  const view = s.saved.find((v) => v.id === id);
  if (!view) return;
  Object.assign(s, selection(view));
  s.draftQuery = s.query;
  s.activeSaved = id;
  s.selected = null;
  s.opening = null;
  s.dialog = null;
  s.searchState = "ready";
  s.notice = "";
}
export function finishDocumentAction(
  s: DocumentsState,
  ok: boolean,
  operation: "opening" | "source" = s.opening ? "opening" : "source",
) {
  if (operation === "opening") {
    if (!s.opening) return;
    const doc = s.documents.find((d) => d.id === s.opening);
    s.opening = null;
    s.preview = ok ? "ready" : "error";
    if (ok && doc?.type === "Spreadsheet") s.notice = "external";
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
  kind: "open" | "refresh",
  id = "",
) {
  if (kind === "open") {
    const doc = s.documents.find((d) => d.id === id);
    if (!doc || doc.availability !== "available") return;
    if (s.sources.find((source) => source.id === doc.source)?.paused) {
      s.preview = "error";
      return;
    }
    s.preview = "loading";
    s.opening = id;
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
  if (s.opening) s.preview = "error";
  s.opening = null;
  s.pending = null;
}
export function selectDocument(s: DocumentsState, id: string) {
  s.opening = null;
  s.selected = id;
  s.page = 0;
  s.zoom = 100;
  s.preview = "ready";
  s.notice = "";
  const doc = s.documents.find((d) => d.id === id);
  if (doc?.availability === "available" && doc.type !== "Spreadsheet")
    startDocumentAction(s, "open", id);
}
export function documentScreenLabel(s: DocumentsState): string {
  if (s.tagDeletion) return "Documents · delete tag";
  if (s.tagMenu) return "Documents · tag actions";
  if (s.collectionMenu) return "Documents · actions";
  if (s.tagCreation) return "Documents · new tag";
  if (s.dialog) return `Documents · ${s.dialog}`;
  return s.selected ? "Documents · preview" : "Documents · collection";
}
