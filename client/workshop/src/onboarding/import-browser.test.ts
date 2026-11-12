import { describe, expect, it } from "vitest";
import { createOnboardingState, reduceOnboarding } from "./model";
import {
  fileCount,
  importIndex,
  importPage,
  importPageSize,
  importRows,
  searchImports,
} from "./import-browser";

describe("large import collections", () => {
  it.each(["onboarding-samples-large", "onboarding-samples-flat"])(
    "keeps all 1,200 files available in %s",
    (scenario) => {
      const state = createOnboardingState(scenario);
      expect(state.imported).toHaveLength(1200);
      expect(new Set(state.imported.map((file) => file.key)).size).toBe(1200);
      expect(
        new Set(state.imported.map((file) => `${file.folder}/${file.name}`))
          .size,
      ).toBe(1200);
      const index = importIndex(state.imported);
      const rows = importRows(index, new Set(), new Map());
      expect(
        rows.filter((row) => row.kind === "entry").length,
      ).toBeLessThanOrEqual(importPageSize);
      expect(
        rows.every(
          (row) => row.kind !== "entry" || row.entry.kind === "folder",
        ),
      ).toBe(true);
    },
  );
  it("counts descendants once and retains deeply nested paths and duplicate names", () => {
    const state = createOnboardingState("onboarding-samples-large");
    const index = importIndex(state.imported);
    expect(index.folders.get("Projects")?.count).toBe(202);
    expect(searchImports(index, "overview.md")).toHaveLength(30);
    expect(
      searchImports(
        index,
        "  ARCHIVE/COLLECTION 05/ARCHIVE/2024/FIELD NOTES/Note 1200.md ",
      ),
    ).toHaveLength(1);
    expect(
      index.folders.get("Archive/Collection 05/Archive/2024/Field notes")
        ?.count,
    ).toBe(37);
    expect(searchImports(index, "not a file")).toEqual([]);
  });
  it("pages every file exactly once including root-level files", () => {
    const state = createOnboardingState("onboarding-samples-flat");
    for (const folder of ["Notes", ""]) {
      const index = importIndex(
        state.imported.map((file) => ({ ...file, folder })),
      );
      const all: string[] = [];
      for (let page = 0; page < Math.ceil(1200 / importPageSize); page++) {
        const rows = importRows(
          index,
          new Set([folder]),
          new Map([[folder, page]]),
        );
        const files = rows.filter(
          (row) => row.kind === "entry" && row.entry.kind === "file",
        );
        expect(files).toHaveLength(importPageSize);
        all.push(
          ...files.map((row) => (row.kind === "entry" ? row.entry.key : "")),
        );
      }
      expect(new Set(all).size).toBe(1200);
    }
  });
  it("clamps stale and invalid page numbers without hiding the remaining files", () => {
    const files = Array.from({ length: 11 }, (_, i) => i);
    expect(importPage(files, 9).entries).toEqual([10]);
    expect(importPage(files, -1).page).toBe(0);
    expect(importPage(files, Infinity).page).toBe(0);
    expect(importPage(files, NaN).page).toBe(0);
    expect(importPage([], 9)).toMatchObject({
      entries: [],
      page: 0,
      last: 0,
      label: "0–0 of 0",
    });
    expect(importPage(files, 1).label).toBe("11–11 of 11");
  });
  it("omits deleted files from both folder counts and search", () => {
    const files = createOnboardingState("onboarding-samples-flat").imported;
    files[0]!.deleted = true;
    const index = importIndex(files);
    expect(index.live).toHaveLength(1199);
    expect(index.folders.get("Notes")?.count).toBe(1199);
    expect(searchImports(index, files[0]!.name)).toEqual([]);
    expect(fileCount(0)).toBe("0 files");
    expect(fileCount(1)).toBe("1 file");
    expect(fileCount(1200)).toBe("1,200 files");
  });
  it("preserves the existing revision and additional-source examples with a large collection", () => {
    let state = createOnboardingState("onboarding-samples-flat");
    state = reduceOnboarding(state, {
      type: "open-source-chat",
      intent: "changes",
    });
    state = reduceOnboarding(state, {
      type: "source-chat",
      action: { type: "draft", value: "Keep the lamp in the study." },
    });
    state = reduceOnboarding(state, {
      type: "source-chat",
      action: { type: "send" },
    });
    expect(state.imported).toHaveLength(1200);
    expect(
      state.imported.find((file) => file.key === "import-reading-note")
        ?.content,
    ).toContain("Keep the lamp in the study");
    state = reduceOnboarding(state, {
      type: "open-source-chat",
      intent: "additional",
    });
    state = reduceOnboarding(state, {
      type: "source-chat",
      action: { type: "draft", value: "Add my travel note." },
    });
    state = reduceOnboarding(state, {
      type: "source-chat",
      action: { type: "send" },
    });
    expect(state.imported).toHaveLength(1201);
  });
});
