import { describe, expect, it } from "vitest";
import {
  emptyLayout,
  reduceLayout,
  selectedTab,
  tabHasActivity,
  tabTitle,
  type LayoutIntent,
  type LayoutState,
  type Pane,
  type TopicTab,
} from "./model";
import { currentEntry, type ViewTarget } from "./navigation";
import { paneOrder } from "./tree";

const conversation: ViewTarget = {
  kind: "conversation",
  conversationId: "chat-1",
};
const file: ViewTarget = { kind: "view", viewId: "files", contentId: "file-1" };
const otherFile: ViewTarget = {
  kind: "view",
  viewId: "files",
  contentId: "file-2",
};

function pane(
  id: string,
  targets: readonly ViewTarget[],
  cursor = targets.length - 1,
): Pane {
  return {
    id,
    navigation: {
      entries: targets.map((target, index) => ({
        id: `${id}-entry-${index}`,
        target,
        presentation: null,
      })),
      cursor,
    },
  };
}

function tab(id: string, first: Pane, second?: Pane): TopicTab {
  return {
    id,
    name: "",
    layout: second
      ? {
          kind: "split",
          id: `${id}-split`,
          axis: "row",
          ratio: 0.6,
          first: { kind: "pane", id: first.id },
          second: { kind: "pane", id: second.id },
        }
      : { kind: "pane", id: first.id },
    panes: second ? [first, second] : [first],
    activePaneId: first.id,
    maximizedPaneId: null,
    conversationIds: [],
  };
}

function driver(tabs: readonly TopicTab[] = []) {
  let state: LayoutState = {
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    closedTabs: [],
  };
  let next = 0;
  return {
    get state() {
      return state;
    },
    get active() {
      return selectedTab(state)!;
    },
    send(intent: LayoutIntent) {
      state = reduceLayout(state, intent, () => `generated-${++next}`);
      return state;
    },
  };
}

describe("tab activity", () => {
  it("follows the current view through navigation and history", () => {
    const app = driver([tab("topic", pane("local", [{ kind: "empty" }]))]);
    const isRunning = (id: string) => id === "chat-1";
    const hasActivity = () => tabHasActivity(app.active, isRunning);

    expect(hasActivity()).toBe(false);
    app.send({ type: "open", target: conversation });
    expect(hasActivity()).toBe(true);
    app.send({ type: "open", target: file });
    expect(app.active.conversationIds).toEqual(["chat-1"]);
    expect(hasActivity()).toBe(false);
    app.send({ type: "history", tabId: "topic", paneId: "local", delta: -1 });
    expect(hasActivity()).toBe(true);
    app.send({ type: "history", tabId: "topic", paneId: "local", delta: 1 });
    expect(hasActivity()).toBe(false);
  });

  it("ignores running conversations removed from forward history", () => {
    const app = driver([tab("topic", pane("local", [file]))]);
    app.send({ type: "open", target: conversation });
    app.send({ type: "history", tabId: "topic", paneId: "local", delta: -1 });
    app.send({ type: "open", target: otherFile });

    expect(app.active.conversationIds).toEqual(["chat-1"]);
    expect(tabHasActivity(app.active, () => true)).toBe(false);
  });

  it("includes current conversations in other panes and inactive tabs", () => {
    const topic = tab(
      "topic",
      pane("files", [file]),
      pane("chat", [conversation]),
    );
    const app = driver([topic]);
    let running = true;
    const hasActivity = () => tabHasActivity(app.state.tabs[0]!, () => running);

    expect(hasActivity()).toBe(true);
    running = false;
    expect(hasActivity()).toBe(false);
    running = true;
    app.send({ type: "new-tab" });
    expect(hasActivity()).toBe(true);
    expect(tabHasActivity(app.active, () => true)).toBe(false);
    app.send({ type: "close-pane", tabId: "topic", paneId: "chat" });
    expect(hasActivity()).toBe(false);
  });
});

function expectValid(state: LayoutState) {
  const ids: string[] = [];
  for (const item of [
    ...state.tabs,
    ...state.closedTabs.map((closed) => closed.tab),
  ]) {
    ids.push(item.id);
    const leaves = paneOrder(item.layout);
    expect(new Set(leaves).size).toBe(leaves.length);
    expect(new Set(leaves)).toEqual(new Set(item.panes.map((p) => p.id)));
    expect(leaves).toContain(item.activePaneId);
    if (item.maximizedPaneId) {
      expect(leaves).toContain(item.maximizedPaneId);
      expect(item.maximizedPaneId).toBe(item.activePaneId);
    }
    for (const p of item.panes) {
      ids.push(p.id, ...p.navigation.entries.map((entry) => entry.id));
      expect(p.navigation.cursor).toBeGreaterThanOrEqual(0);
      expect(p.navigation.cursor).toBeLessThan(p.navigation.entries.length);
    }
  }
  expect(new Set(ids).size).toBe(ids.length);
  if (state.tabs.length)
    expect(state.tabs.map((item) => item.id)).toContain(state.activeTabId);
  else expect(state.activeTabId).toBeNull();
}

describe("conversation opening and pane history", () => {
  it("reveals an existing conversation in an inactive tab without changing either history", () => {
    const first = tab("first", pane("files", [file]));
    const second = tab("second", pane("chat", [conversation]));
    const app = driver([first, second]);
    app.send({ type: "open", target: conversation });
    expect(app.state.activeTabId).toBe("second");
    expect(app.active.activePaneId).toBe("chat");
    expect(app.state.tabs).toEqual([first, second]);
  });

  it("reveals a hidden pane during maximization without rewriting the split tree", () => {
    const split = {
      ...tab("topic", pane("files", [file]), pane("chat", [conversation])),
      maximizedPaneId: "files",
    };
    const app = driver([split]);
    app.send({ type: "open", target: conversation });
    expect(app.active.activePaneId).toBe("chat");
    expect(app.active.maximizedPaneId).toBe("chat");
    expect(app.active.layout).toBe(split.layout);
    expect(app.active.panes).toBe(split.panes);
  });

  it.each([0, 1])(
    "does not treat a conversation behind or ahead of cursor %s as open",
    (cursor) => {
      const targets =
        cursor === 0 ? [file, conversation] : [conversation, file];
      const app = driver([
        tab("current", pane("destination", [otherFile])),
        tab("historical", pane("old", targets, cursor)),
      ]);
      const previous = app.state.tabs[1];
      app.send({ type: "open", target: conversation });
      expect(app.state.activeTabId).toBe("current");
      expect(
        app.active.panes[0]?.navigation.entries.map((entry) => entry.target),
      ).toEqual([otherFile, conversation]);
      expect(app.state.tabs[1]).toBe(previous);
    },
  );

  it("back and forward restore locally even when the conversation is already open in another tab", () => {
    const first = tab("first", pane("local", [file, conversation, otherFile]));
    const second = tab("second", pane("existing", [conversation]));
    const app = driver([first, second]);
    const original = JSON.stringify(app.state);
    app.send({ type: "history", tabId: "first", paneId: "local", delta: -1 });
    expect(app.state.activeTabId).toBe("first");
    expect(currentEntry(app.active.panes[0]!.navigation).target).toEqual(
      conversation,
    );
    expect(app.state.tabs[1]).toBe(second);
    app.send({ type: "history", tabId: "first", paneId: "local", delta: -1 });
    expect(currentEntry(app.active.panes[0]!.navigation).target).toEqual(file);
    app.send({ type: "history", tabId: "first", paneId: "local", delta: 1 });
    expect(currentEntry(app.active.panes[0]!.navigation).target).toEqual(
      conversation,
    );
    expect(app.state.activeTabId).toBe("first");
    expect(
      JSON.stringify({
        tabs: [first, second],
        activeTabId: "first",
        closedTabs: [],
      }),
    ).toBe(original);
  });

  it("history changes only the addressed pane, without switching focused panes", () => {
    const split = tab(
      "topic",
      pane("left", [conversation]),
      pane("right", [file, conversation, otherFile]),
    );
    const app = driver([split]);
    app.send({ type: "history", tabId: "topic", paneId: "right", delta: -1 });
    expect(app.active.activePaneId).toBe("left");
    expect(app.active.panes[0]).toBe(split.panes[0]);
    expect(currentEntry(app.active.panes[1]!.navigation).target).toEqual(
      conversation,
    );
    app.send({ type: "open", target: conversation });
    expect(app.active.activePaneId).toBe("left");
  });

  it("prefers the focused instance, then visual pane order in the active tab, then tab order", () => {
    const prior = tab("prior", pane("prior-chat", [conversation]));
    const topic = tab(
      "topic",
      pane("left", [conversation]),
      pane("right", [conversation]),
    );
    const app = driver([prior, topic]);
    app.send({ type: "select-pane", tabId: "topic", paneId: "right" });
    app.send({ type: "open", target: conversation });
    expect(app.active.activePaneId).toBe("right");
    app.send({
      type: "split",
      tabId: "topic",
      paneId: "right",
      edge: "bottom",
    });
    app.send({ type: "open", target: conversation });
    expect(app.state.activeTabId).toBe("topic");
    expect(app.active.activePaneId).toBe("left");
    app.send({ type: "new-tab" });
    app.send({ type: "open", target: conversation });
    expect(app.state.activeTabId).toBe("prior");
  });

  it("ordinary plugin opening stays in the focused pane without splitting or changing maximization", () => {
    const split = {
      ...tab("topic", pane("first", [file]), pane("second", [otherFile])),
      maximizedPaneId: "first",
    };
    const app = driver([split]);
    const plugin: ViewTarget = {
      kind: "view",
      viewId: "plugin.calendar",
      contentId: "week-1",
    };
    app.send({ type: "open", target: plugin });
    expect(app.state.tabs).toHaveLength(1);
    expect(app.active.panes).toHaveLength(2);
    expect(app.active.layout).toBe(split.layout);
    expect(app.active.maximizedPaneId).toBe("first");
    expect(currentEntry(app.active.panes[0]!.navigation).target).toEqual(
      plugin,
    );
    expect(app.active.panes[1]).toBe(split.panes[1]);
  });

  it("discards only the destination's forward branch and keeps conversation activity association", () => {
    const app = driver([tab("topic", pane("local", [file]))]);
    app.send({ type: "open", target: conversation });
    app.send({ type: "history", tabId: "topic", paneId: "local", delta: -1 });
    app.send({ type: "open", target: otherFile });
    expect(
      app.active.panes[0]?.navigation.entries.map((entry) => entry.target),
    ).toEqual([file, otherFile]);
    expect(app.active.conversationIds).toEqual(["chat-1"]);
    app.send({ type: "new-tab" });
    expect(app.active.conversationIds).toEqual([]);
  });

  it("opens into a captured destination rather than the pane selected while a request was pending", () => {
    const app = driver([
      tab("first", pane("original", [file])),
      tab("second", pane("later", [otherFile])),
    ]);
    app.send({ type: "select-tab", tabId: "second" });
    const unchanged = app.active;
    app.send({
      type: "open",
      target: conversation,
      destination: { tabId: "first", paneId: "original" },
    });
    expect(app.state.activeTabId).toBe("first");
    expect(currentEntry(app.active.panes[0]!.navigation).target).toEqual(
      conversation,
    );
    expect(app.state.tabs[1]).toBe(unchanged);
  });

  it("does not redirect a late open after its captured destination closed", () => {
    const app = driver([
      tab("first", pane("original", [file])),
      tab("second", pane("other", [conversation])),
    ]);
    app.send({ type: "close-tab", tabId: "first" });
    const before = app.state;
    expect(
      app.send({
        type: "open",
        target: conversation,
        destination: { tabId: "first", paneId: "original" },
      }),
    ).toBe(before);
  });
});

describe("topic tabs and pane arrangements", () => {
  it("opens exactly one destination when there are no tabs", () => {
    const app = driver();
    expect(app.state).toEqual(emptyLayout());
    app.send({ type: "open", target: file });
    expect(app.state.tabs).toHaveLength(1);
    expect(app.active.panes).toHaveLength(1);
    expect(
      app.active.panes[0]?.navigation.entries.map((entry) => entry.target),
    ).toEqual([file]);
    expect(app.active.layout).toEqual({
      kind: "pane",
      id: app.active.activePaneId,
    });
    expectValid(app.state);
  });

  it("uses the first pane's current title until explicitly named, including after moving panes", () => {
    const app = driver([
      tab("topic", pane("left", [file]), pane("right", [conversation])),
    ]);
    const title = (target: ViewTarget) =>
      target.kind === "conversation" ? "Garden chat" : "Notes";
    expect(tabTitle(app.active, title)).toBe("Notes");
    app.send({
      type: "move",
      tabId: "topic",
      paneId: "right",
      targetPaneId: "left",
      edge: "left",
    });
    expect(tabTitle(app.active, title)).toBe("Garden chat");
    app.send({ type: "rename-tab", tabId: "topic", name: "  Weekend  " });
    expect(tabTitle(app.active, title)).toBe("Weekend");
    app.send({ type: "rename-tab", tabId: "topic", name: "  " });
    expect(tabTitle(app.active, title)).toBe("Garden chat");
    expect(app.active.id).toBe("topic");
  });

  it("retains layout, active pane, maximization and histories through tab switching", () => {
    const first = {
      ...tab(
        "first",
        pane("left", [file, conversation]),
        pane("right", [otherFile]),
      ),
      activePaneId: "right",
      maximizedPaneId: "right",
    };
    const app = driver([first, tab("second", pane("other", [file]))]);
    app.send({ type: "select-tab", tabId: "second" });
    app.send({ type: "select-tab", tabId: "first" });
    expect(app.active).toBe(first);
  });

  it("nests splits and moves existing panes while retaining their complete histories", () => {
    const source = pane("original", [file, conversation, otherFile], 1);
    const app = driver([tab("topic", source)]);
    app.send({
      type: "split",
      tabId: "topic",
      paneId: "original",
      edge: "right",
    });
    const right = app.active.activePaneId;
    app.send({
      type: "split",
      tabId: "topic",
      paneId: "original",
      edge: "bottom",
    });
    const bottom = app.active.activePaneId;
    expect(app.active.layout).toMatchObject({
      kind: "split",
      axis: "row",
      first: {
        kind: "split",
        axis: "column",
        first: { id: "original" },
        second: { id: bottom },
      },
      second: { id: right },
    });
    app.send({
      type: "move",
      tabId: "topic",
      paneId: "original",
      targetPaneId: right,
      edge: "top",
    });
    expect(app.active.layout).toMatchObject({
      kind: "split",
      axis: "row",
      first: { kind: "pane", id: bottom },
      second: {
        kind: "split",
        axis: "column",
        first: { id: "original" },
        second: { id: right },
      },
    });
    expect(app.active.panes.find((p) => p.id === "original")).toBe(source);
    expect(app.active.activePaneId).toBe("original");
    expectValid(app.state);
  });

  it.each(["left", "right", "top", "bottom"] as const)(
    "moves a pane to the %s of its neighbor without duplicate leaves",
    (edge) => {
      const original = tab(
        "topic",
        pane("a", [file]),
        pane("b", [conversation]),
      );
      const app = driver([original]);
      app.send({
        type: "move",
        tabId: "topic",
        paneId: "a",
        targetPaneId: "b",
        edge,
      });
      expect(paneOrder(app.active.layout)).toEqual(
        edge === "left" || edge === "top" ? ["a", "b"] : ["b", "a"],
      );
      expect(app.active.layout).toMatchObject({
        axis: edge === "left" || edge === "right" ? "row" : "column",
      });
      expect(app.active.panes).toBe(original.panes);
      expectValid(app.state);
    },
  );

  it("resizes and maximizes without adding history entries or destroying split geometry", () => {
    const original = tab(
      "topic",
      pane("left", [file, conversation]),
      pane("right", [otherFile]),
    );
    const app = driver([original]);
    app.send({
      type: "resize",
      tabId: "topic",
      splitId: "topic-split",
      ratio: 0.95,
    });
    const resized = app.active.layout;
    expect(resized).toMatchObject({ ratio: 0.95 });
    app.send({ type: "maximize", tabId: "topic", paneId: "left" });
    expect(app.active.layout).toBe(resized);
    app.send({ type: "select-pane", tabId: "topic", paneId: "right" });
    expect(app.active.maximizedPaneId).toBe("right");
    app.send({ type: "maximize", tabId: "topic", paneId: "right" });
    expect(app.active.maximizedPaneId).toBeNull();
    expect(app.active.layout).toBe(resized);
    expect(app.active.panes).toBe(original.panes);
    expectValid(app.state);
  });

  it("resizes a nested divider without changing its ancestor, sibling or pane histories", () => {
    const original: TopicTab = {
      ...tab(
        "topic",
        pane("top", [file, conversation]),
        pane("right", [otherFile]),
      ),
      panes: [
        pane("top", [file, conversation]),
        pane("bottom", [otherFile]),
        pane("right", [file]),
      ],
      layout: {
        kind: "split",
        id: "outer",
        axis: "row",
        ratio: 0.6,
        first: {
          kind: "split",
          id: "inner",
          axis: "column",
          ratio: 0.35,
          first: { kind: "pane", id: "top" },
          second: { kind: "pane", id: "bottom" },
        },
        second: { kind: "pane", id: "right" },
      },
    };
    const app = driver([original]);
    app.send({ type: "resize", tabId: "topic", splitId: "inner", ratio: 0.8 });
    expect(app.active.layout).toEqual({
      kind: "split",
      id: "outer",
      axis: "row",
      ratio: 0.6,
      first: {
        kind: "split",
        id: "inner",
        axis: "column",
        ratio: 0.8,
        first: { kind: "pane", id: "top" },
        second: { kind: "pane", id: "bottom" },
      },
      second: { kind: "pane", id: "right" },
    });
    expect(app.active.panes).toBe(original.panes);
    expect(original.layout).toMatchObject({ first: { ratio: 0.35 } });
    expectValid(app.state);
  });

  it.each(["top", "bottom"])(
    "closing nested pane %s collapses only its own branch",
    (paneId) => {
      const top = pane("top", [file, conversation]);
      const bottom = pane("bottom", [otherFile]);
      const right = pane("right", [file]);
      const original: TopicTab = {
        ...tab("topic", top),
        panes: [top, bottom, right],
        layout: {
          kind: "split",
          id: "outer",
          axis: "row",
          ratio: 0.7,
          first: {
            kind: "split",
            id: "inner",
            axis: "column",
            ratio: 0.4,
            first: { kind: "pane", id: "top" },
            second: { kind: "pane", id: "bottom" },
          },
          second: { kind: "pane", id: "right" },
        },
      };
      const remaining = paneId === "top" ? bottom : top;
      const app = driver([original]);
      app.send({ type: "close-pane", tabId: "topic", paneId });
      expect(app.active.layout).toEqual({
        kind: "split",
        id: "outer",
        axis: "row",
        ratio: 0.7,
        first: { kind: "pane", id: remaining.id },
        second: { kind: "pane", id: "right" },
      });
      expect(app.active.panes[0]).toBe(remaining);
      expect(app.active.panes[1]).toBe(right);
      expectValid(app.state);
    },
  );

  it("collapses the removed branch and leaves a chooser when the last pane closes", () => {
    const app = driver([
      tab("topic", pane("left", [conversation]), pane("right", [file])),
    ]);
    app.send({ type: "maximize", tabId: "topic", paneId: "left" });
    app.send({ type: "close-pane", tabId: "topic", paneId: "left" });
    expect(app.active.layout).toEqual({ kind: "pane", id: "right" });
    expect(app.active.activePaneId).toBe("right");
    expect(app.active.maximizedPaneId).toBeNull();
    app.send({ type: "close-pane", tabId: "topic", paneId: "right" });
    expect(app.active.panes).toHaveLength(1);
    expect(app.active.panes[0]?.navigation).toEqual({
      entries: [
        {
          id: expect.any(String),
          target: { kind: "empty" },
          presentation: null,
        },
      ],
      cursor: 0,
    });
    expectValid(app.state);
  });

  it("closing the last pane invalidates late operations addressed to its old identity", () => {
    const app = driver([tab("topic", pane("closed", [file]))]);
    app.send({ type: "close-pane", tabId: "topic", paneId: "closed" });
    const empty = app.state;
    expect(app.active.activePaneId).not.toBe("closed");
    expect(
      app.send({
        type: "open",
        target: conversation,
        destination: { tabId: "topic", paneId: "closed" },
      }),
    ).toBe(empty);
    expect(
      app.send({
        type: "retain-presentation",
        tabId: "topic",
        paneId: "closed",
        entryId: "closed-entry-0",
        presentation: { scrollTop: 70 },
      }),
    ).toBe(empty);
    expectValid(app.state);
  });

  it("reopens closed tabs at their prior position with identities and histories intact", () => {
    const first = tab("first", pane("a", [file]));
    const middle = tab(
      "middle",
      pane("b", [file, conversation]),
      pane("c", [otherFile]),
    );
    const last = tab("last", pane("d", [otherFile]));
    const app = driver([first, middle, last]);
    app.send({ type: "select-tab", tabId: "middle" });
    app.send({ type: "close-tab", tabId: "middle" });
    expect(app.state.activeTabId).toBe("last");
    app.send({ type: "reopen-tab" });
    expect(app.state.tabs).toEqual([first, middle, last]);
    expect(app.active).toBe(middle);
    expect(app.state.closedTabs).toEqual([]);
    expectValid(app.state);
  });

  it("closing an inactive tab preserves selection and closing the last opens a fresh empty tab", () => {
    const first = tab("first", pane("a", [conversation]));
    const second = tab("second", pane("b", [file]));
    const app = driver([first, second]);
    app.send({ type: "close-tab", tabId: "second" });
    expect(app.active).toBe(first);
    app.send({ type: "close-tab", tabId: "first" });
    expect(app.state.tabs).toHaveLength(1);
    const empty = app.active;
    expect(empty.id).not.toBe(first.id);
    expect(empty.panes[0]!.id).not.toBe(first.activePaneId);
    expect(currentEntry(empty.panes[0]!.navigation).target).toEqual({
      kind: "empty",
    });
    app.send({ type: "open", target: conversation });
    expect(app.active.id).toBe(empty.id);
    expect(app.state.tabs).toHaveLength(1);
    expect(app.active.id).not.toBe("first");
    expectValid(app.state);
  });

  it.each(["close-all-tabs", "close-other-tabs"] as const)(
    "%s preserves tab order, pane histories and presentation for reopening",
    (type) => {
      const first = tab("first", pane("a", [file, conversation]));
      const middle = tab(
        "middle",
        pane("b", [otherFile]),
        pane("c", [conversation]),
      );
      const last = tab("last", pane("d", [file]));
      const app = driver([first, middle, last]);
      app.send({ type: "select-tab", tabId: "middle" });
      app.send(
        type === "close-all-tabs" ? { type } : { type, tabId: "middle" },
      );
      expect(app.state.tabs).toHaveLength(1);
      const remaining = app.active;
      if (type === "close-all-tabs") {
        expect([first.id, middle.id, last.id]).not.toContain(remaining.id);
        expect(currentEntry(remaining.panes[0]!.navigation).target).toEqual({
          kind: "empty",
        });
      } else expect(remaining).toBe(middle);
      expectValid(app.state);
      while (app.state.closedTabs.length) app.send({ type: "reopen-tab" });
      expect(app.state.tabs).toEqual(
        type === "close-all-tabs"
          ? [first, middle, last, remaining]
          : [first, middle, last],
      );
      expectValid(app.state);
    },
  );

  it("restores multiple closed tabs in reverse closure order", () => {
    const app = driver([
      tab("first", pane("a", [file])),
      tab("second", pane("b", [otherFile])),
    ]);
    app.send({ type: "close-tab", tabId: "first" });
    app.send({ type: "close-tab", tabId: "second" });
    const empty = app.active;
    app.send({ type: "reopen-tab" });
    expect(app.state.tabs.map((item) => item.id)).toEqual(["second", empty.id]);
    app.send({ type: "reopen-tab" });
    expect(app.state.tabs.map((item) => item.id)).toEqual([
      "first",
      "second",
      empty.id,
    ]);
    expectValid(app.state);
  });

  it("retains entry-specific presentation without mutating other panes", () => {
    const original = tab(
      "topic",
      pane("left", [file, conversation]),
      pane("right", [otherFile]),
    );
    const app = driver([original]);
    app.send({
      type: "retain-presentation",
      tabId: "topic",
      paneId: "left",
      entryId: "left-entry-0",
      presentation: { mode: "source", scrollTop: 72 },
    });
    expect(app.active.panes[0]?.navigation.entries[0]?.presentation).toEqual({
      mode: "source",
      scrollTop: 72,
    });
    expect(app.active.panes[0]?.navigation.cursor).toBe(1);
    expect(app.active.panes[1]).toBe(original.panes[1]);
  });

  it("ignores missing addresses, invalid moves and invalid ratios without altering state", () => {
    const app = driver([
      tab("topic", pane("left", [file]), pane("right", [otherFile])),
    ]);
    const before = app.state;
    const intents: LayoutIntent[] = [
      { type: "select-tab", tabId: "missing" },
      { type: "close-tab", tabId: "missing" },
      { type: "close-other-tabs", tabId: "missing" },
      { type: "close-other-tabs", tabId: "topic" },
      { type: "rename-tab", tabId: "missing", name: "Changed" },
      { type: "reopen-tab" },
      { type: "select-pane", tabId: "topic", paneId: "missing" },
      { type: "history", tabId: "topic", paneId: "left", delta: -1 },
      { type: "history", tabId: "missing", paneId: "left", delta: 1 },
      { type: "split", tabId: "topic", paneId: "missing", edge: "right" },
      {
        type: "move",
        tabId: "topic",
        paneId: "left",
        targetPaneId: "left",
        edge: "right",
      },
      {
        type: "move",
        tabId: "topic",
        paneId: "left",
        targetPaneId: "missing",
        edge: "right",
      },
      { type: "maximize", tabId: "topic", paneId: "missing" },
      { type: "close-pane", tabId: "topic", paneId: "missing" },
      {
        type: "retain-presentation",
        tabId: "topic",
        paneId: "left",
        entryId: "missing",
        presentation: null,
      },
      { type: "resize", tabId: "topic", splitId: "missing", ratio: 0.5 },
      ...[0, 1, -0.1, Number.NaN, Number.POSITIVE_INFINITY].map(
        (ratio): LayoutIntent => ({
          type: "resize",
          tabId: "topic",
          splitId: "topic-split",
          ratio,
        }),
      ),
    ];
    for (const intent of intents)
      expect(app.send(intent), intent.type).toBe(before);
    expectValid(app.state);
  });

  it("keeps independently owned presentations isolated", () => {
    const a = driver([tab("topic", pane("pane", [file]))]);
    const b = driver([tab("topic", pane("pane", [otherFile]))]);
    const before = b.state;
    a.send({ type: "open", target: conversation });
    a.send({ type: "close-tab", tabId: "topic" });
    expect(b.state).toBe(before);
    expect(currentEntry(b.active.panes[0]!.navigation).target).toEqual(
      otherFile,
    );
  });
});
