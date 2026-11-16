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
function rememberedLayout(): LayoutDocument {
  const data = savedLayout();
  const tab = data.layout.tabs[0]!;
  return {
    ...data,
    layout: {
      ...data.layout,
      tabs: [
        {
          ...tab,
          panes: [
            {
              ...tab.panes[0]!,
              lastFiles: {
                target: {
                  kind: "view",
                  viewId: "files",
                  contentId: "notes/plan.md",
                  revision: "revision",
                },
                presentation: { mode: "source", selectionStart: 8 },
                entryId: "b",
              },
            },
          ],
        },
      ],
    },
  };
}

describe("layout document", () => {
  it("marks normalized legacy native records for persistence", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      revision: "legacy",
      data: savedLayout(),
    });
    const loaded = await nativeLayoutStorage.load("workspace");
    expect(loaded.needsSave).toBe(true);
    expect(loaded.data).toEqual(rememberedLayout());
    vi.mocked(invoke).mockResolvedValueOnce({
      revision: "current",
      data: rememberedLayout(),
    });
    expect(
      (await nativeLayoutStorage.load("workspace")).needsSave,
    ).toBeUndefined();
  });
  it("loads over-limit open tabs and panes while retaining only the newest closed tabs", () => {
    const data = JSON.parse(JSON.stringify(savedLayout()));
    const makeTab = (id: string, count = 1) => {
      const original = data.layout.tabs[0];
      const panes = Array.from({ length: count }, (_, index) => ({
        id: `${id}-pane-${index}`,
        navigation: {
          cursor: 0,
          entries: [
            {
              id: `${id}-entry-${index}`,
              target: { kind: "empty" },
              presentation: null,
            },
          ],
        },
      }));
      let layout: unknown = { kind: "pane", id: panes[0]!.id };
      for (let i = 1; i < count; i++)
        layout = {
          kind: "split",
          id: `${id}-split-${i}`,
          axis: "row",
          ratio: 0.5,
          first: layout,
          second: { kind: "pane", id: panes[i]!.id },
        };
      return { ...original, id, panes, layout, activePaneId: panes[0]!.id };
    };
    data.layout.tabs = Array.from({ length: 21 }, (_, index) =>
      makeTab(`tab-${index}`, index === 0 ? 7 : 1),
    );
    data.layout.activeTabId = "tab-20";
    data.layout.closedTabs = Array.from({ length: 25 }, (_, index) => ({
      tab: makeTab(`closed-${index}`),
      index,
    }));
    const restored = decodeLayoutDocument(data).layout;
    expect(restored.tabs).toHaveLength(21);
    expect(restored.tabs[0]?.panes).toHaveLength(7);
    expect(restored.activeTabId).toBe("tab-20");
    expect(restored.closedTabs).toHaveLength(20);
    expect(restored.closedTabs[0]?.tab.id).toBe("closed-5");
    expect(restored.closedTabs.at(-1)?.tab.id).toBe("closed-24");
  });

  it("derives a missing Files origin reference from visited history without replacing presentation", () => {
    const data = JSON.parse(JSON.stringify(rememberedLayout()));
    const pane = data.layout.tabs[0].panes[0];
    delete pane.lastFiles.entryId;
    pane.lastFiles.presentation = { folder: "remembered", future: true };
    expect(
      decodeLayoutDocument(data).layout.tabs[0]?.panes[0]?.lastFiles,
    ).toEqual({ ...pane.lastFiles, entryId: "b" });
  });
  it("derives legacy Files memory before trimming history and ignores unvisited forward Files entries", () => {
    const data = JSON.parse(JSON.stringify(savedLayout()));
    const pane = data.layout.tabs[0].panes[0];
    const visited = pane.navigation.entries[1];
    pane.navigation.entries = [
      visited,
      ...Array.from({ length: 60 }, (_, index) => ({
        id: `chat-${index}`,
        target: { kind: "conversation", conversationId: `chat-${index}` },
        presentation: null,
      })),
      {
        ...visited,
        id: "forward",
        target: { kind: "view", viewId: "files", contentId: "unvisited.md" },
      },
    ];
    pane.navigation.cursor = 60;
    const restored = decodeLayoutDocument(data).layout.tabs[0]!.panes[0]!;
    expect(restored.navigation.entries).toHaveLength(50);
    expect(
      restored.navigation.entries.some((entry) => entry.id === visited.id),
    ).toBe(false);
    expect(restored.lastFiles).toEqual({
      target: visited.target,
      presentation: visited.presentation,
      entryId: visited.id,
    });
    pane.navigation.cursor = 0;
    pane.navigation.entries = [
      pane.navigation.entries[1],
      pane.navigation.entries.at(-1),
    ];
    expect(
      decodeLayoutDocument(data).layout.tabs[0]?.panes[0]?.lastFiles,
    ).toBeUndefined();
  });

  it("preserves unknown remembered Files presentation fields and rejects non-Files memories", () => {
    const data = JSON.parse(JSON.stringify(rememberedLayout()));
    const pane = data.layout.tabs[0].panes[0];
    pane.lastFiles.presentation = {
      future: { nested: [1, true, null] },
      folder: "notes",
    };
    expect(
      decodeLayoutDocument(data).layout.tabs[0]?.panes[0]?.lastFiles,
    ).toEqual(pane.lastFiles);
    pane.lastFiles.target = { kind: "view", viewId: "plugin.calendar" };
    expect(() => decodeLayoutDocument(data)).toThrow(
      "layoutHost.invalidStoredLayout",
    );
    pane.lastFiles.target = {
      kind: "view",
      viewId: "files",
      contentId: "../outside.md",
    };
    expect(() => decodeLayoutDocument(data)).toThrow(
      "layoutHost.invalidStoredLayout",
    );
    pane.lastFiles.target = { kind: "view", viewId: "files" };
    pane.lastFiles.id = "unexpected";
    expect(() => decodeLayoutDocument(data)).toThrow(
      "layoutHost.invalidStoredLayout",
    );
  });
  it("passes ephemeral installation provenance through native load and save without adding it to the document", async () => {
    const data = rememberedLayout();
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
    const data = rememberedLayout();
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
