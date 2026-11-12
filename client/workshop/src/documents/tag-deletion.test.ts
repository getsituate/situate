import { describe, expect, it } from "vitest";
import {
  clone,
  createDocumentsState,
  emptyFilter,
  openSaved,
  results,
  selection,
  type DocumentsState,
} from "./model";
import { deleteTag, tagDeletionImpact } from "./tag-deletion";
import { beginTagCreation, createTag } from "./tags";
import { reconcileSourceDocuments } from "../workshop/document-sources";

function request(s: DocumentsState, id: string, descendants = false) {
  s.tagDeletion = { id, descendants, error: null };
}

describe("tag deletion", () => {
  it("counts direct assignments, keeps subtags and leaves document files and sources unchanged", () => {
    const s = createDocumentsState();
    const before = clone(s);
    request(s, "home");
    const impact = tagDeletionImpact(s);
    expect(impact.documents.map((doc) => doc.id)).toEqual(["insurance"]);
    expect(impact.descendants.size).toBe(1);
    expect(deleteTag(s)).toBe(true);
    expect(s.tags.find((tag) => tag.id === "repairs")).toEqual({
      id: "repairs",
      name: "Repairs",
      parent: null,
    });
    expect(s.documents.find((doc) => doc.id === "bike")?.tags).toContain(
      "repairs",
    );
    expect(s.documents.find((doc) => doc.id === "insurance")?.tags).toEqual([
      "recurring",
    ]);
    expect(s.sources).toEqual(before.sources);
    expect(s.documents.map((doc) => ({ ...doc, tags: [] }))).toEqual(
      before.documents.map((doc) => ({ ...doc, tags: [] })),
    );
    expect(s.saved).toEqual(
      before.saved.map((view) => ({ ...view, filter: emptyFilter() })),
    );
    expect(s.deletedTags).toEqual({ home: "Home" });
    expect(s.notice).toBe("");
  });
  it("promotes direct children only, preserving deeper parent links and assignments", () => {
    const s = createDocumentsState();
    s.tags.push({
      id: "certificates",
      name: "Certificates",
      parent: "training",
    });
    request(s, "expenses");
    expect(deleteTag(s)).toBe(true);
    expect(s.tags.find((tag) => tag.id === "training")?.parent).toBe("tax");
    expect(s.tags.find((tag) => tag.id === "certificates")?.parent).toBe(
      "training",
    );
    expect(s.documents.some((doc) => doc.tags.includes("training"))).toBe(true);
  });
  it("deletes the full branch only when explicitly selected", () => {
    const s = createDocumentsState();
    request(s, "tax", true);
    const count = tagDeletionImpact(s).documents.length;
    expect(count).toBe(
      s.documents.filter((doc) =>
        doc.tags.some((id) => ["tax", "expenses", "training"].includes(id)),
      ).length,
    );
    expect(deleteTag(s)).toBe(true);
    expect(
      s.tags.some((tag) => ["tax", "expenses", "training"].includes(tag.id)),
    ).toBe(false);
    expect(
      s.documents.every((doc) =>
        doc.tags.every((id) => !["tax", "expenses", "training"].includes(id)),
      ),
    ).toBe(true);
    expect(s.deletedTags.training).toBe("Tax / Expenses / Training");
    expect(Object.keys(s.deletedTags)).toHaveLength(3);
  });
  it.each(["any", "all"] as const)(
    "removes deleted conditions from active and inactive %s searches without losing other criteria",
    (operator) => {
      const s = createDocumentsState();
      s.saved[0]!.query = "invoice";
      s.saved[0]!.filter = { operator, tags: ["home", "2025"] };
      s.saved.push({
        ...clone(s.saved[0]!),
        id: "repairs",
        name: "Repairs",
        pinned: false,
        filter: { operator, tags: ["repairs"] },
      });
      const before = clone(s.saved);
      openSaved(s, "home");
      s.draftQuery = "Unsubmitted search";
      request(s, "home");
      expect(deleteTag(s)).toBe(true);
      expect(s.saved).toEqual([
        { ...before[0], filter: { operator, tags: ["2025"] } },
        before[1],
      ]);
      expect(s.filter).toEqual({ operator, tags: ["2025"] });
      expect(selection(s)).toEqual(selection(s.saved[0]!));
      expect(s.activeSaved).toBe("home");
      expect(s.draftQuery).toBe("Unsubmitted search");
      expect(results(s).length).toBeGreaterThan(0);
    },
  );
  it.each(["", "VE-2048"])(
    "keeps the remaining query %j when the last tag condition is removed",
    (query) => {
      const s = createDocumentsState();
      s.saved[0]!.query = query;
      s.saved[0]!.pinned = false;
      s.saved[0]!.filter.operator = "all";
      openSaved(s, "home");
      request(s, "home");
      deleteTag(s);
      expect(s.saved[0]).toMatchObject({
        id: "home",
        name: "Home & repairs",
        query,
        pinned: false,
        filter: emptyFilter(),
      });
      expect(s.filter).toEqual(emptyFilter());
      expect(results(s)).toHaveLength(query ? 1 : s.documents.length);
      expect(s).not.toHaveProperty("viewRepair");
    },
  );
  it("removes every deleted branch member from all saved searches but retains unrelated tags", () => {
    const s = createDocumentsState();
    s.saved[0]!.filter = { operator: "all", tags: ["tax", "training", "2025"] };
    s.saved.push({
      ...clone(s.saved[0]!),
      id: "training",
      filter: { operator: "any", tags: ["training"] },
    });
    request(s, "tax", true);
    deleteTag(s);
    expect(s.saved.map((view) => view.filter)).toEqual([
      { operator: "all", tags: ["2025"] },
      emptyFilter(),
    ]);
    openSaved(s, "home");
    expect(results(s)).toHaveLength(6);
  });
  it("does not revive deleted conditions through late edits from another window", () => {
    const base = createDocumentsState();
    const current = clone(base);
    request(current, "home");
    deleteTag(current);
    const before = clone(current);
    const next = clone(base);
    next.filter = { operator: "all", tags: ["home", "2025"] };
    next.draftTags = ["home", "2025"];
    next.draftQuery = "Keep this draft";
    next.saved[0]!.name = "Repair invoices";
    next.saved[0]!.query = "VE-2048";
    const merged = reconcileSourceDocuments(current, next, base);
    expect(merged.filter).toEqual({ operator: "all", tags: ["2025"] });
    expect(merged.draftTags).toEqual(["2025"]);
    expect(merged.draftQuery).toBe("Keep this draft");
    expect(merged.saved[0]).toMatchObject({
      name: "Repair invoices",
      query: "VE-2048",
      filter: emptyFilter(),
    });
    expect(current).toEqual(before);
  });
  it("blocks duplicate sibling names without merging or partially deleting", () => {
    const s = createDocumentsState("documents-tag-delete-conflict");
    const before = clone(s);
    expect(deleteTag(s)).toBe(false);
    expect(s.tagDeletion?.error).toBe("collision");
    expect(s.tags).toEqual(before.tags);
    expect(s.documents).toEqual(before.documents);
    expect(s.saved).toEqual(before.saved);
    expect(s.deletedTags).toEqual({});
    s.tagDeletion!.descendants = true;
    expect(deleteTag(s)).toBe(true);
    expect(s.tags.some((tag) => tag.id === "root-repairs")).toBe(true);
  });
  it("rejects stale targets and safely ignores duplicate confirmation", () => {
    const s = createDocumentsState();
    request(s, "absent");
    expect(deleteTag(s)).toBe(false);
    expect(s.tagDeletion?.error).toBe("missing");
    request(s, "home");
    expect(deleteTag(s)).toBe(true);
    const after = clone(s);
    expect(deleteTag(s)).toBe(false);
    expect(s).toEqual(after);
  });
  it("does not reuse deleted identities or reconnect saved filters by tag name", () => {
    const s = createDocumentsState();
    beginTagCreation(s);
    s.tagCreation!.name = "Travel";
    const id = createTag(s)!;
    s.saved[0]!.filter.tags = [id];
    request(s, id);
    deleteTag(s);
    beginTagCreation(s);
    s.tagCreation!.name = "Travel";
    const replacement = createTag(s);
    expect(replacement).not.toBe(id);
    expect(s.saved[0]!.filter).toEqual(emptyFilter());
  });
  it("cleans assignment drafts without touching unrelated tags or search text", () => {
    const s = createDocumentsState();
    s.draftTags = ["home", "repairs", "2025"];
    s.draftQuery = "Keep my draft";
    request(s, "home", true);
    deleteTag(s);
    expect(s.draftTags).toEqual(["2025"]);
    expect(s.draftQuery).toBe("Keep my draft");
  });
});

describe("saved searches after tag deletion", () => {
  it.each([
    "documents-tag-removed",
    "documents-repair-view",
    "documents-missing-tag",
  ])("opens %s without a repair dialog or missing condition", (scenario) => {
    const s = createDocumentsState(scenario);
    expect(s.activeSaved).toBe("home");
    expect(s.tags.some((tag) => tag.id === "home")).toBe(false);
    expect(s.saved[0]!.filter).toEqual(emptyFilter());
    expect(s.filter).toEqual(emptyFilter());
    expect(results(s)).toHaveLength(10);
    expect(s).not.toHaveProperty("viewRepair");
  });
});
