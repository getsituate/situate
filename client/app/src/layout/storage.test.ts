import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import {
  decodeLayoutDocument,
  nativeLayoutStorage,
  sameDocument,
  type LayoutDocument,
} from "./storage";

export function savedLayout(): LayoutDocument {
  return {
    version: 1,
    pinnedViews: ["files", "plugin:calendar"],
    layout: {
      activeTabId: "tab",
      closedTabs: [],
      tabs: [
        {
          id: "tab",
          name: "Garden",
          layout: { kind: "pane", id: "pane" },
          activePaneId: "pane",
          maximizedPaneId: null,
          conversationIds: ["chat"],
          panes: [
            {
              id: "pane",
              navigation: {
                cursor: 1,
                entries: [
                  {
                    id: "a",
                    target: { kind: "conversation", conversationId: "chat" },
                    presentation: { scrollTop: 48 },
                  },
                  {
                    id: "b",
                    target: {
                      kind: "view",
                      viewId: "files",
                      contentId: "notes/plan.md",
                      revision: "revision",
                    },
                    presentation: { mode: "source", selectionStart: 8 },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}
describe("portable layout document", () => {
  it("passes ephemeral installation provenance through native load and save without adding it to the document", async () => {
    const data = savedLayout();
    const pluginIncarnations = {
      plugin: "00000000-0000-4000-8000-000000000001",
    };
    const record = { revision: "saved", data, pluginIncarnations };
    vi.mocked(invoke).mockResolvedValue(record);
    expect(await nativeLayoutStorage.load("workspace")).toEqual(record);
    expect(
      await nativeLayoutStorage.save(
        "workspace",
        "previous",
        data,
        pluginIncarnations,
      ),
    ).toEqual(record);
    expect(invoke).toHaveBeenLastCalledWith("layout_save", {
      workspaceId: "workspace",
      expectedRevision: "previous",
      data,
      pluginIncarnations,
    });
    expect(data).not.toHaveProperty("pluginIncarnations");
  });
  it("round-trips identities, history, unknown view targets and restorable state without domain records", () => {
    const data = savedLayout();
    const restored = decodeLayoutDocument(JSON.parse(JSON.stringify(data)));
    expect(restored).toEqual(data);
    expect(restored).not.toBe(data);
  });
  it("preserves unavailable plugin targets instead of substituting a registered view", () => {
    const data = structuredClone(savedLayout());
    const value = JSON.parse(JSON.stringify(data));
    value.layout.tabs[0].panes[0].navigation.entries[1].target = {
      kind: "view",
      viewId: "disabled:calendar",
      contentId: "week",
    };
    expect(
      decodeLayoutDocument(value).layout.tabs[0]?.panes[0]?.navigation
        .entries[1]?.target,
    ).toEqual({ kind: "view", viewId: "disabled:calendar", contentId: "week" });
  });
  const invalidFields: [readonly (string | number)[], unknown][] = [
    [["version"], 2],
    [
      ["layout", "tabs", 0, "panes", 0, "navigation", "entries", 0, "target"],
      { kind: "new-conversation", conversationId: "temporary" },
    ],
    [["layout", "activeTabId"], "missing"],
    [["layout", "tabs", 0, "activePaneId"], "missing"],
    [["layout", "tabs", 0, "maximizedPaneId"], "missing"],
    [["layout", "tabs", 0, "layout", "id"], "missing"],
    [["layout", "tabs", 0, "panes", 0, "navigation", "cursor"], -1],
    [["layout", "tabs", 0, "panes", 0, "navigation", "cursor"], 2],
    [["layout", "tabs", 0, "panes", 0, "navigation", "entries", 1, "id"], "a"],
    [["layout", "tabs", 0, "panes", 1], savedLayout().layout.tabs[0]!.panes[0]],
    [["pinnedViews", 2], "files"],
    [
      ["layout", "closedTabs", 0],
      { tab: savedLayout().layout.tabs[0], index: 0 },
    ],
    [["layout", "tabs", 0, "futurePolicy"], true],
  ];
  it.each(invalidFields)(
    "rejects malformed or unsupported state at %j",
    (path, value) => {
      const data: unknown = JSON.parse(JSON.stringify(savedLayout()));
      let field = data as Record<string | number, unknown>;
      for (const key of path.slice(0, -1))
        field = field[key] as Record<string | number, unknown>;
      field[path.at(-1)!] = value;
      expect(() => decodeLayoutDocument(data)).toThrow();
    },
  );
  it.each([
    "/private/notes.md",
    "../notes.md",
    "C:\\notes.md",
    "notes/../../outside.md",
  ])("rejects device-specific/escaping file targets %s", (path) => {
    const data = JSON.parse(JSON.stringify(savedLayout()));
    data.layout.tabs[0].panes[0].navigation.entries[1].target.contentId = path;
    expect(() => decodeLayoutDocument(data)).toThrow(
      "layoutHost.invalidStoredLayout",
    );
  });
  it("rejects a tree that displays the same pane twice", () => {
    const data = JSON.parse(JSON.stringify(savedLayout()));
    data.layout.tabs[0].layout = {
      kind: "split",
      id: "split",
      axis: "row",
      ratio: 0.5,
      first: { kind: "pane", id: "pane" },
      second: { kind: "pane", id: "pane" },
    };
    expect(() => decodeLayoutDocument(data)).toThrow();
  });
  it("compares presentation maps independently of native JSON object ordering", () => {
    const a = JSON.parse(JSON.stringify(savedLayout()));
    const b = JSON.parse(JSON.stringify(savedLayout()));
    a.layout.tabs[0].panes[0].navigation.entries[0].presentation = {
      z: 1,
      a: 2,
    };
    b.layout.tabs[0].panes[0].navigation.entries[0].presentation = {
      a: 2,
      z: 1,
    };
    expect(sameDocument(a, b)).toBe(true);
    b.layout.tabs[0].panes[0].navigation.entries[0].presentation.z = 3;
    expect(sameDocument(a, b)).toBe(false);
  });
});
