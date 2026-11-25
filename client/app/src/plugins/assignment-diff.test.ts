import { describe, expect, it } from "vitest";
import { fileDiff, diffParts } from "./assignment-diff";

describe("file diffs", () => {
  it("compares exact lines with old/new numbers and deletion before insertion", () => {
    expect(fileDiff("same\nold\nend\n", "same\nnew\nend\n")).toMatchObject({
      added: 1,
      removed: 1,
      simplified: false,
      rows: [
        { kind: "same", text: "same", before: 1, after: 1 },
        { kind: "removed", text: "old", before: 2, after: null },
        { kind: "added", text: "new", before: null, after: 2 },
        { kind: "same", text: "end", before: 3, after: 3 },
      ],
    });
  });
  it("does not invent blank lines in added, deleted or empty files", () => {
    expect(fileDiff("", "one\n")).toMatchObject({
      added: 1,
      removed: 0,
      rows: [{ text: "one", noNewline: false }],
    });
    expect(fileDiff("one\n", "")).toMatchObject({ added: 0, removed: 1 });
    expect(fileDiff("", "")).toMatchObject({ added: 0, removed: 0, rows: [] });
    expect(fileDiff("", "\n").rows).toHaveLength(1);
  });
  it("handles large additions directly without treating them as imprecise comparisons", () => {
    const source = "new line\n".repeat(5000);
    expect(fileDiff("", source)).toMatchObject({
      added: 5000,
      removed: 0,
      simplified: false,
    });
    expect(fileDiff(source, "")).toMatchObject({
      added: 0,
      removed: 5000,
      simplified: false,
    });
  });
  it("preserves missing final newlines, blank lines and whitespace edits", () => {
    expect(fileDiff("one\n", "one")).toMatchObject({
      added: 1,
      removed: 1,
      rows: [{ noNewline: false }, { noNewline: true }],
    });
    expect(fileDiff("a\n\nb\n", "a\n b\n").removed).toBe(2);
    expect(fileDiff("a\r\n", "a\n").rows[0].text).toBe("a\r");
  });
  it("bounds comparison work while retaining every removed and added line", () => {
    const before = Array.from({ length: 600 }, (_, i) => `old ${i}\n`).join("");
    const after = before.replaceAll("old", "new");
    const diff = fileDiff(before, after);
    expect(diff.simplified).toBe(true);
    expect(diff.added).toBe(600);
    expect(diff.removed).toBe(600);
    expect(
      diff.rows
        .filter((row) => row.kind !== "added")
        .map((row) => row.text + "\n")
        .join(""),
    ).toBe(before);
    expect(
      diff.rows
        .filter((row) => row.kind !== "removed")
        .map((row) => row.text + "\n")
        .join(""),
    ).toBe(after);
  });
  it("trims large identical prefixes and suffixes before comparing", () => {
    const before = Array.from({ length: 2000 }, (_, i) => `line ${i}\n`).join(
      "",
    );
    const diff = fileDiff(before, before.replace("line 1000\n", "changed\n"));
    expect(diff.simplified).toBe(false);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    const parts = diffParts(diff.rows);
    expect(parts.filter((part) => part.kind === "line")).toHaveLength(8);
    const gap = parts.find((part) => part.kind === "gap")!;
    expect(
      diffParts(diff.rows, { [gap.index]: 20 }).filter(
        (part) => part.kind === "line",
      ),
    ).toHaveLength(28);
  });
  it("reconstructs both inputs across repeated lines and mixed changes", () => {
    for (const before of ["a\nb\na\n", "a\nb\n", "", "a"]) {
      for (const after of ["a\na\nb\n", "b\n", "", "a\n"]) {
        const diff = fileDiff(before, after);
        const text = (side: "added" | "removed") =>
          diff.rows
            .filter((row) => row.kind !== side)
            .map((row) => row.text + (row.noNewline ? "" : "\n"))
            .join("");
        expect(text("added")).toBe(before);
        expect(text("removed")).toBe(after);
      }
    }
  });
});
