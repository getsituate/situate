import { describe, expect, it } from "vitest";
import {
  currentEntry,
  normalizeNavigation,
  retainPresentation,
  traverse,
  visit,
  type NavigationEntry,
  type PaneNavigation,
} from "./navigation";

const file: NavigationEntry = {
  id: "entry-file",
  target: { kind: "view", viewId: "files", contentId: "file-1" },
  presentation: {
    mode: "source",
    selectionStart: 12,
    selectionEnd: 15,
    scrollTop: 80,
  },
};
const chat: NavigationEntry = {
  id: "entry-chat",
  target: { kind: "conversation", conversationId: "chat-1" },
  presentation: { scrollTop: 140 },
};
const history: PaneNavigation = { entries: [file, chat], cursor: 1 };

describe("pane navigation", () => {
  it.each([
    [0, 0, 49],
    [10, 0, 49],
    [49, 0, 49],
    [60, 11, 60],
    [69, 20, 69],
  ])(
    "bounds saved history at cursor %i while preferring nearby back entries",
    (cursor, first, last) => {
      const entries = Array.from({ length: 70 }, (_, index) => ({
        ...chat,
        id: `entry-${index}`,
      }));
      const bounded = normalizeNavigation({ entries, cursor });
      expect(bounded.entries).toHaveLength(50);
      expect(bounded.entries[0]?.id).toBe(`entry-${first}`);
      expect(bounded.entries.at(-1)?.id).toBe(`entry-${last}`);
      expect(currentEntry(bounded)).toBe(entries[cursor]);
    },
  );

  it("bounds direct visits, traversal and presentation updates", () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({
      ...chat,
      id: `entry-${index}`,
    }));
    const navigation = visit({ entries, cursor: 49 }, file);
    expect(navigation.entries).toHaveLength(50);
    expect(navigation.entries[0]?.id).toBe("entry-1");
    expect(currentEntry(navigation)).toBe(file);
    const oversized = { entries: [...entries, file], cursor: 50 };
    expect(traverse(oversized, -1).entries).toHaveLength(50);
    expect(
      retainPresentation(oversized, file.id, { folder: "notes" }).entries,
    ).toHaveLength(50);
  });
  it("restores the same entries and presentation state with local back and forward", () => {
    const back = traverse(history, -1);
    expect(back.cursor).toBe(0);
    expect(currentEntry(back)).toBe(file);
    expect(currentEntry(traverse(back, 1))).toBe(chat);
    expect(history.cursor).toBe(1);
    expect(traverse(back, -1)).toBe(back);
    expect(traverse(history, 1)).toBe(history);
  });

  it("truncates only the forward branch when opening a different target", () => {
    const revision: NavigationEntry = {
      id: "entry-revision",
      target: {
        kind: "view",
        viewId: "files",
        contentId: "file-1",
        revision: "revision-2",
      },
      presentation: null,
    };
    const next = visit(traverse(history, -1), revision);
    expect(next).toEqual({ entries: [file, revision], cursor: 1 });
    expect(history.entries).toEqual([file, chat]);
    expect(traverse(next, 1)).toBe(next);
  });

  it("does not replace presentation state or drop forward history when reopening the current target", () => {
    const back = traverse(history, -1);
    expect(
      visit(back, { ...file, id: "replacement", presentation: null }),
    ).toBe(back);
  });

  it("retains outgoing presentation by entry identity after the cursor has moved", () => {
    const updated = retainPresentation(history, file.id, {
      mode: "read",
      scrollTop: 300,
    });
    expect(updated.cursor).toBe(1);
    expect(updated.entries[0]?.presentation).toEqual({
      mode: "read",
      scrollTop: 300,
    });
    expect(updated.entries[1]).toBe(chat);
    expect(file.presentation).toEqual({
      mode: "source",
      selectionStart: 12,
      selectionEnd: 15,
      scrollTop: 80,
    });
  });

  it("ignores late capture for an entry removed by forward-branch truncation", () => {
    const replacement: NavigationEntry = {
      id: "entry-empty",
      target: { kind: "empty" },
      presentation: null,
    };
    const next = visit(traverse(history, -1), replacement);
    expect(retainPresentation(next, chat.id, { scrollTop: 500 })).toBe(next);
  });

  it("distinguishes view types, content identities and revisions", () => {
    let navigation: PaneNavigation = { entries: [file], cursor: 0 };
    for (const [id, target] of [
      [
        "other-view",
        { kind: "view", viewId: "plugin.notes", contentId: "file-1" },
      ],
      [
        "other-content",
        { kind: "view", viewId: "plugin.notes", contentId: "file-2" },
      ],
      [
        "other-revision",
        {
          kind: "view",
          viewId: "plugin.notes",
          contentId: "file-2",
          revision: "old",
        },
      ],
    ] as const)
      navigation = visit(navigation, { id, target, presentation: null });
    expect(navigation.entries.map((entry) => entry.id)).toEqual([
      "entry-file",
      "other-view",
      "other-content",
      "other-revision",
    ]);
    expect(navigation.cursor).toBe(3);
  });
});
