import { describe, expect, it } from "vitest";
import {
  createDocumentsState,
  matchesFilter,
  selection,
  tagPath,
} from "./model";
import { beginTagCreation, createTag, orderedTags } from "./tags";

describe("manual tag creation", () => {
  it("creates a trimmed root tag without changing selection, documents or sources", () => {
    const s = createDocumentsState("documents-gather");
    s.draftQuery = "Unsubmitted description";
    const before = JSON.stringify({
      selection: selection(s),
      documents: s.documents,
      sources: s.sources,
      saved: s.saved,
    });
    beginTagCreation(s);
    s.tagCreation!.name = "  Household  ";
    const id = createTag(s);
    expect(s.tags.find((t) => t.id === id)).toEqual({
      id,
      name: "Household",
      parent: null,
    });
    expect(
      JSON.stringify({
        selection: selection(s),
        documents: s.documents,
        sources: s.sources,
        saved: s.saved,
      }),
    ).toBe(before);
    expect(s.draftQuery).toBe("Unsubmitted description");
    expect(s.tagCreation).toBeNull();
    expect(s.createdTagId).toBe(id);
  });
  it("rejects blank and duplicate sibling names without losing the draft", () => {
    const s = createDocumentsState();
    const count = s.tags.length;
    beginTagCreation(s);
    s.tagCreation!.name = "  ";
    expect(createTag(s)).toBeNull();
    expect(s.tagCreation?.error).toBe("name");
    s.tagCreation!.name = " tAX ";
    expect(createTag(s)).toBeNull();
    expect(s.tagCreation).toMatchObject({
      name: " tAX ",
      error: "duplicate",
      parent: null,
    });
    expect(s.tags).toHaveLength(count);
    s.tagCreation!.parent = "home";
    expect(createTag(s)).not.toBeNull();
  });
  it("groups descendants beneath their parent and keeps genuine hierarchy", () => {
    const s = createDocumentsState();
    beginTagCreation(s);
    s.tagCreation!.name = "Receipts / scanned";
    s.tagCreation!.parent = "tax";
    const id = createTag(s)!;
    expect(tagPath(s.tags, id)).toBe("Tax / Receipts / scanned");
    expect(s.tags.find((t) => t.id === id)?.parent).toBe("tax");
    expect(s.tags.findIndex((t) => t.id === id)).toBeLessThan(
      s.tags.findIndex((t) => t.id === "home"),
    );
    const doc = { ...s.documents[0]!, tags: [id] };
    expect(matchesFilter(s, doc, { operator: "all", tags: ["tax", id] })).toBe(
      true,
    );
    expect(matchesFilter(s, doc, { operator: "any", tags: ["home"] })).toBe(
      false,
    );
  });
  it("selects a newly created tag in the document draft without applying it", () => {
    const s = createDocumentsState("documents-new-document-tag");
    const doc = s.documents.find((d) => d.id === s.selected)!;
    const original = [...doc.tags];
    s.draftTags = [];
    s.tagCreation!.name = "Receipts";
    const id = createTag(s)!;
    expect(s.draftTags).toEqual([id]);
    expect(doc.tags).toEqual(original);
    expect(s.dialog).toBe("tags");
    s.dialog = null;
    expect(s.tags.some((t) => t.id === id)).toBe(true);
    expect(doc.tags).toEqual(original);
  });
  it("rejects a missing parent or changed document without partial creation", () => {
    const s = createDocumentsState("documents-new-document-tag");
    const original = [...s.tags];
    s.tagCreation!.name = "Receipts";
    s.tagCreation!.parent = "missing";
    expect(createTag(s)).toBeNull();
    expect(s.tagCreation?.error).toBe("parent");
    s.tagCreation!.parent = null;
    s.selected = "receipt";
    expect(createTag(s)).toBeNull();
    expect(s.tagCreation?.error).toBe("document");
    expect(s.tags).toEqual(original);
  });
  it("normalizes names, avoids ID collisions and ignores repeated submission", () => {
    const s = createDocumentsState("documents-no-tags");
    s.tags.push({ id: "tag-1", name: "Café", parent: null });
    beginTagCreation(s);
    s.tagCreation!.name = "Cafe\u0301";
    expect(createTag(s)).toBeNull();
    s.tagCreation!.name = "Travel";
    expect(createTag(s)).toBe("tag-2");
    expect(createTag(s)).toBeNull();
    expect(s.tags).toHaveLength(2);
  });
  it("keeps drafts and created tags local to one simulation and resets fixtures", () => {
    const a = createDocumentsState("documents-new-tag");
    const b = createDocumentsState("documents-new-tag");
    a.tagCreation!.name = "Travel";
    const id = createTag(a);
    expect(b.tags.some((t) => t.id === id)).toBe(false);
    expect(b.tagCreation?.name).toBe("");
    expect(createDocumentsState("documents-new-tag")).toEqual(b);
  });
  it("orders a valid tree without depending on input adjacency", () => {
    const tags = [
      { id: "child", name: "Child", parent: "root" },
      { id: "other", name: "Other", parent: null },
      { id: "root", name: "Root", parent: null },
    ];
    expect(orderedTags(tags).map((t) => t.id)).toEqual([
      "other",
      "root",
      "child",
    ]);
  });
});
