import { describe, expect, test } from "vitest";
import { generatedTitle, provisionalTitle } from "./title-runtime";

describe("conversation title text", () => {
  test("keeps a compact local fallback without whitespace or broken Unicode", () => {
    expect(
      provisionalTitle(
        "  Plan\n the garden   with a reading corner and herbs ",
      ),
    ).toBe("Plan the garden with a reading corner");
    expect(provisionalTitle("😀".repeat(80))).toBe("😀".repeat(60));
    expect(provisionalTitle(" \n ")).toBe("");
  });
  test("accepts short meaningful titles and removes surrounding quotes", () => {
    expect(generatedTitle("  “Gartenplan mit Leseecke”  ")).toBe(
      "Gartenplan mit Leseecke",
    );
    expect(generatedTitle("Reading list for spring")).toBe(
      "Reading list for spring",
    );
  });
  test.each([
    "",
    "   ",
    "…",
    "😀",
    "First title\nAnother title",
    "x".repeat(61),
    "one two three four five six seven eight nine ten",
    "A\u0000B",
  ])("rejects unusable output: %j", (value) => {
    expect(generatedTitle(value)).toBeNull();
  });
});
