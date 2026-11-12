import { describe, expect, it } from "vitest";
import {
  addFilterTag,
  browseFilterTag,
  clearUntaggedFilter,
  removeFilterTag,
  setFilterOperator,
} from "./filters";
import {
  clearSelection,
  clone,
  createDocumentsState,
  openSaved,
  results,
  saveView,
  startDocumentAction,
} from "./model";
const ids = (s: ReturnType<typeof createDocumentsState>) =>
  results(s).map((d) => d.id);

describe("flat document tag filters", () => {
  it("starts with any matching and no tag restriction", () => {
    const s = createDocumentsState();
    expect(s.filter).toEqual({ operator: "any", tags: [] });
    expect(results(s)).toHaveLength(s.documents.length);
    setFilterOperator(s, "all");
    expect(results(s)).toHaveLength(s.documents.length);
  });
  it("unions selected tags by default, without mutating documents or sources", () => {
    const s = createDocumentsState();
    const original = clone(s);
    addFilterTag(s, "tax");
    const tax = ids(s);
    browseFilterTag(s, "home");
    const home = ids(s);
    addFilterTag(s, "tax");
    expect(new Set(ids(s))).toEqual(new Set([...tax, ...home]));
    expect(s.documents).toEqual(original.documents);
    expect(s.sources).toEqual(original.sources);
  });
  it("switches between any and all without losing selected tags", () => {
    const s = createDocumentsState();
    addFilterTag(s, "tax");
    addFilterTag(s, "2025");
    const any = ids(s);
    setFilterOperator(s, "all");
    expect(ids(s)).toContain("course");
    expect(ids(s)).not.toContain("internet");
    expect(ids(s)).not.toContain("bike");
    expect(ids(s)).toContain("personal");
    expect(s.filter.tags).toEqual(["tax", "2025"]);
    setFilterOperator(s, "any");
    expect(ids(s)).toEqual(any);
  });
  it.each(["any", "all"] as const)(
    "includes descendants under %s matching, not unrelated siblings",
    (operator) => {
      const s = createDocumentsState();
      setFilterOperator(s, operator);
      addFilterTag(s, "tax");
      expect(ids(s)).toContain("course");
      browseFilterTag(s, "2024");
      expect(ids(s)).toEqual(["old-course"]);
    },
  );
  it("does not add duplicate or unknown tags", () => {
    const s = createDocumentsState();
    addFilterTag(s, "tax");
    addFilterTag(s, "tax");
    addFilterTag(s, "missing");
    expect(s.filter.tags).toEqual(["tax"]);
  });
  it("removes tags immediately and removing the last tag releases the restriction", () => {
    const s = createDocumentsState();
    addFilterTag(s, "tax");
    addFilterTag(s, "home");
    removeFilterTag(s, "home");
    expect(s.filter.tags).toEqual(["tax"]);
    setFilterOperator(s, "all");
    removeFilterTag(s, "tax");
    expect(s.filter).toEqual({ operator: "any", tags: [] });
    expect(results(s)).toHaveLength(s.documents.length);
  });
  it("combines tags with the current search, preserving an unsent query", () => {
    const s = createDocumentsState();
    s.query = "VE-2048";
    s.draftQuery = "Unsent query";
    addFilterTag(s, "home");
    addFilterTag(s, "2025");
    expect(ids(s)).toEqual(["bike"]);
    setFilterOperator(s, "all");
    expect(ids(s)).toEqual(["bike"]);
    expect(s.draftQuery).toBe("Unsent query");
    addFilterTag(s, "tax");
    expect(ids(s)).toEqual([]);
  });
  it("clears the untagged filter without discarding search criteria or saved searches", () => {
    const s = createDocumentsState();
    browseFilterTag(s, "untagged");
    s.query = s.draftQuery = "invoice";
    s.draftName = "Unsorted invoices";
    saveView(s);
    s.draftQuery = "Unsubmitted description";
    s.selected = s.opening = "course";
    const before = clone(s);
    clearUntaggedFilter(s);
    expect(s.untagged).toBe(false);
    expect(s.query).toBe(before.query);
    expect(s.draftQuery).toBe(before.draftQuery);
    expect(s.filter).toEqual(before.filter);
    expect(s.saved).toEqual(before.saved);
    expect(s.documents).toEqual(before.documents);
    expect(s.sources).toEqual(before.sources);
    expect(s.activeSaved).toBeNull();
    expect(s.selected).toBeNull();
    expect(s.opening).toBeNull();
  });
  it("uses one tag selection for navigation and inline controls", () => {
    const s = createDocumentsState("documents-gather");
    browseFilterTag(s, "home");
    expect(s.filter).toEqual({ operator: "any", tags: ["home"] });
    browseFilterTag(s, "untagged");
    expect(ids(s)).toEqual(["untagged"]);
    expect(s.filter.tags).toEqual([]);
    addFilterTag(s, "tax");
    expect(s.untagged).toBe(false);
    expect(ids(s)).toContain("course");
  });
  it.each(["any", "all"] as const)(
    "saves and restores %s matching dynamically",
    (operator) => {
      const s = createDocumentsState();
      addFilterTag(s, "tax");
      addFilterTag(s, "2025");
      setFilterOperator(s, operator);
      s.draftName = "Tax documents";
      saveView(s);
      const saved = clone(s.saved.at(-1)!);
      const before = results(s).length;
      clearSelection(s);
      startDocumentAction(s, "refresh", "drive");
      openSaved(s, saved.id);
      expect(s.filter).toEqual(saved.filter);
      expect(results(s)).toHaveLength(before + 1);
      removeFilterTag(s, "tax");
      expect(s.activeSaved).toBeNull();
      expect(s.saved.at(-1)).toEqual(saved);
    },
  );
  it("resets to any matching and interrupts pending preview work when filters change", () => {
    const s = createDocumentsState("documents-gather");
    s.selected = "course";
    s.opening = "course";
    addFilterTag(s, "home");
    expect(s.selected).toBeNull();
    expect(s.opening).toBeNull();
    clearSelection(s);
    expect(s.filter).toEqual({ operator: "any", tags: [] });
  });
});
