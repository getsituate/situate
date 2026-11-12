import { describe, expect, it } from "vitest";
import { documentFixtures } from "./fixtures";
import { createDocumentsState, results } from "./model";
import { documentSearchScore } from "./search";

const doc = {
  ...documentFixtures[0]!,
  title: "",
  filename: "",
  content: "bicycle repair VE-2048",
  concepts: [],
};

describe("document search fixtures", () => {
  it.each([
    "bicycle repair",
    "bicyle repair",
    "bicyccle repair",
    "bicycke repair",
    "bicycel repair",
    "BICYCLE   REPAIR",
  ])("finds the repair document with %s", (query) => {
    const s = createDocumentsState();
    s.query = query;
    expect(results(s).map((item) => item.id)).toEqual(["bike"]);
  });
  it.each(["VE-2049", "VE-204", "VE-2408", "VE-20488", "ZZ-9999"])(
    "does not typo-correct %s into another identifier",
    (query) => {
      // VE-204 is a literal prefix, not an approximate match.
      expect(documentSearchScore(query, doc)).toBe(query === "VE-204" ? 3 : 0);
    },
  );
  it("ranks literal phrases ahead of concept and typo matches", () => {
    const s = createDocumentsState();
    const base = doc;
    s.documents = [
      { ...base, id: "typo", content: "bicycel repair", date: "2025-12-03" },
      {
        ...base,
        id: "concept",
        content: "Cycle maintenance",
        concepts: ["bicycle repair"],
        date: "2025-12-02",
      },
      { ...base, id: "literal", date: "2025-12-01" },
    ];
    s.query = "bicycle repair";
    s.sort = "relevance";
    expect(results(s).map((item) => item.id)).toEqual([
      "literal",
      "concept",
      "typo",
    ]);
  });
  it("requires every query term and rejects unrelated or multiple-typo words", () => {
    expect(documentSearchScore("bicycel repair spaceship", doc)).toBe(0);
    expect(documentSearchScore("bycicle repair", doc)).toBe(0);
    expect(documentSearchScore("cat", { ...doc, content: "car" })).toBe(0);
  });
  it("normalizes composed and decomposed text", () => {
    expect(
      documentSearchScore("cafe\u0301", { ...doc, content: "Café receipt" }),
    ).toBe(3);
  });
  it("does not include unprepared or excluded content through typo matching", () => {
    const s = createDocumentsState();
    s.query = "bicycel repair";
    s.documents.find((item) => item.id === "bike")!.preparation = "pending";
    expect(results(s)).toEqual([]);
    s.documents.find((item) => item.id === "bike")!.preparation = "ready";
    s.sources = s.sources.filter((source) => source.id !== "paperless");
    expect(results(s)).toEqual([]);
  });
});
