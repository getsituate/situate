import { describe, expect, it } from "vitest";
import {
  actionRequest,
  compareFileEntries,
  containedMenuPosition,
  creationFolder,
  duplicatePath,
  fileMenu,
  inFolder,
  markdownWordCount,
} from "./fileActions";
const options = {
  path: "Notes/Garden.md",
  directory: false,
  plus: false,
  writable: true,
  live: true,
  mode: "read" as const,
  selected: "Notes/Garden.md",
};

describe("file action menus", () => {
  it("groups reading, creation and item operations", () => {
    expect(fileMenu(options).map((item) => item?.label ?? "|")).toEqual([
      "⟦files.read⟧",
      "⟦files.editSource⟧",
      "⟦files.versionHistory⟧",
      "|",
      "⟦files.newFileDetail⟧",
      "⟦files.newFolderDetail⟧",
      "|",
      "⟦files.renameDetail⟧",
      "⟦files.moveToDetail⟧",
      "⟦files.duplicateDetail⟧",
      "|",
      "⟦files.deleteDetail⟧",
    ]);
    expect(
      fileMenu(options)
        .filter((item) => item?.checked)
        .map((item) => item?.action),
    ).toEqual(["read"]);
    expect(
      fileMenu({ ...options, mode: "source" })
        .filter((item) => item?.checked)
        .map((item) => item?.action),
    ).toEqual(["source"]);
  });
  it("does not claim another item or a historical version is the active reading mode", () => {
    expect(
      fileMenu({ ...options, selected: "Other.md" }).some(
        (item) => item?.checked,
      ),
    ).toBe(false);
    expect(
      fileMenu({ ...options, live: false }).some((item) => item?.checked),
    ).toBe(false);
    const historical = fileMenu({
      ...options,
      live: false,
      documentContext: true,
    });
    expect(historical.find((item) => item?.action === "source")?.label).toBe(
      "⟦files.viewSource⟧",
    );
    expect(
      historical.find((item) => item?.action === "source")?.disabled,
    ).toBeUndefined();
    expect(historical.find((item) => item?.action === "read")?.checked).toBe(
      true,
    );
  });
  it("keeps recovery available while mutations are unavailable", () => {
    const menu = fileMenu({ ...options, plus: true, writable: false });
    expect(menu.map((item) => item?.label ?? "|")).toEqual([
      "⟦files.newFileDetail⟧",
      "⟦files.newFolderDetail⟧",
      "|",
      "⟦files.deletedFiles⟧",
    ]);
    expect(
      menu.filter((item) => item?.disabled).map((item) => item?.action),
    ).toEqual(["create", "mkdir"]);
    expect(
      fileMenu({ ...options, writable: false })
        .filter((item) => item?.disabled)
        .map((item) => item?.action),
    ).toEqual(["create", "mkdir", "rename", "move", "copy", "delete"]);
  });
  it("does not show text modes for folders or unopened binary files", () => {
    expect(
      fileMenu({ ...options, directory: true }).some(
        (item) => item?.action === "read",
      ),
    ).toBe(false);
    expect(
      fileMenu({ ...options, path: "Map.pdf" }).map((item) => item?.action),
    ).toContain("history");
    expect(
      fileMenu({ ...options, path: "Map.pdf" }).some(
        (item) => item?.action === "source",
      ),
    ).toBe(false);
  });
});

describe("file tree order", () => {
  it("keeps folders before files at each level and parents before their children", () => {
    const entries = [
      "welcome.md",
      "Notes/z.md",
      "Notes",
      "Archive",
      "Notes/Ideas/a.md",
      "Notes/Ideas",
      "Notes/a.md",
    ].map((path) => ({ path, isDirectory: !path.endsWith(".md") }));
    expect(entries.sort(compareFileEntries).map((entry) => entry.path)).toEqual(
      [
        "Archive",
        "Notes",
        "Notes/Ideas",
        "Notes/Ideas/a.md",
        "Notes/a.md",
        "Notes/z.md",
        "welcome.md",
      ],
    );
  });
});

it("offers source modes for a confirmed non-Markdown text file", () => {
  const menu = fileMenu({
    ...options,
    path: "config.json",
    selected: "config.json",
    text: true,
  });
  expect(
    menu
      .filter((item) => item && ["read", "source"].includes(item.action))
      .map((item) => item?.action),
  ).toEqual(["read", "source"]);
});

describe("file action requests", () => {
  it("uses only fields accepted by the selected operation", () => {
    expect(
      actionRequest(
        { operation: "create", path: "Old.md" },
        "Notes/New.md",
        "Ignored.md",
      ),
    ).toEqual({ operation: "create", path: "Notes/New.md" });
    expect(
      actionRequest({ operation: "rename", path: "Old.md" }, "", "New.md"),
    ).toEqual({ operation: "rename", path: "Old.md", destination: "New.md" });
    expect(
      actionRequest(
        {
          operation: "restore",
          path: "Old.md",
          revision: "r1",
          exactPath: true,
        },
        "",
        "Restored.md",
      ),
    ).toEqual({
      operation: "restore",
      path: "Old.md",
      revision: "r1",
      destination: "Restored.md",
    });
    expect(
      actionRequest(
        {
          operation: "revert",
          path: "Old.md",
          revision: "r1",
          exactPath: true,
        },
        "",
        "Ignored.md",
      ),
    ).toEqual({ operation: "revert", path: "Old.md", revision: "r1" });
    expect(
      actionRequest(
        {
          operation: "historicalCopy",
          path: "Old.md",
          revision: "r1",
          exactPath: true,
        },
        "",
        "Copy.md",
      ),
    ).toEqual({
      operation: "historicalCopy",
      path: "Old.md",
      revision: "r1",
      exactPath: true,
      destination: "Copy.md",
    });
  });
  it("rejects missing revisions and operations unavailable in the action dialog", () => {
    expect(() =>
      actionRequest({ operation: "restore", path: "Old.md" }, "", "New.md"),
    ).toThrow("Choose a retained revision.");
    expect(() =>
      actionRequest({ operation: "save", path: "Old.md" }, "", ""),
    ).toThrow("This file action is unavailable.");
  });
});

describe("file action destinations", () => {
  it("creates inside folders, beside files, or at root", () => {
    expect(creationFolder("Notes/Ideas", true)).toBe("Notes/Ideas");
    expect(creationFolder("Notes/Ideas.md", false)).toBe("Notes");
    expect(creationFolder("", false)).toBe("");
    expect(inFolder("Notes", "Tea.md")).toBe("Notes/Tea.md");
    expect(inFolder("", "Tea.md")).toBe("Tea.md");
  });
  it("suggests a distinct copy name without losing explicit extensions", () => {
    expect(duplicatePath("Notes/Garden.md")).toBe("Notes/Garden copy.md");
    expect(duplicatePath("Notes/Garden")).toBe("Notes/Garden copy");
    expect(duplicatePath(".garden")).toBe(".garden copy");
  });
});

describe("menu viewport containment", () => {
  it("contains menus near the bottom and right edges", () => {
    expect(
      containedMenuPosition(
        { right: 390, bottom: 840 },
        { width: 264, height: 560 },
        { width: 390, height: 844 },
      ),
    ).toEqual({ left: 118, top: 276 });
  });
  it("respects context-menu points and visual viewport offsets", () => {
    expect(
      containedMenuPosition(
        { right: 100, bottom: 100 },
        { width: 264, height: 560 },
        { width: 390, height: 600, left: 20, top: 100 },
        { x: -2, y: 102 },
      ),
    ).toEqual({ left: 28, top: 108 });
  });
});

describe("document word count", () => {
  it("excludes frontmatter and task identity comments, including CRLF", () => {
    expect(
      markdownWordCount(
        "---\r\nsituate-id: hidden-id\r\n---\r\nTwo words <!-- situate-task-id: hidden-task -->",
      ),
    ).toBe(2);
    expect(markdownWordCount("")).toBe(0);
  });
});
