import { describe, expect, it } from "vitest";
import { newMarkdownPath } from "./paths";

describe("new Markdown file paths", () => {
  it.each([
    ["Garden", "Garden.md"],
    ["Notes/Garden plan", "Notes/Garden plan.md"],
    ["Notes.v2/Garden", "Notes.v2/Garden.md"],
    ["Notes/.garden", "Notes/.garden.md"],
    ["Notes/Tea ☕", "Notes/Tea ☕.md"],
  ])("adds the extension to %s", (path, expected) => {
    expect(newMarkdownPath(path)).toBe(expected);
  });

  it.each([
    "Garden.md",
    "Garden.MD",
    "Notes/Garden.markdown",
    "Notes/Garden.txt",
    "Notes/Garden.",
  ])("preserves the explicit extension in %s", (path) => {
    expect(newMarkdownPath(path)).toBe(path);
  });

  it.each(["", ".", "..", "Notes/", "Notes/.", "Notes/.."])(
    "leaves incomplete or directory input %s for path validation",
    (path) => {
      expect(newMarkdownPath(path)).toBe(path);
    },
  );
});
