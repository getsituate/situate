import { afterEach, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { workspaceUi, retainWorkspaceUi } from "./runtime";
import { currentEntry } from "./navigation";

const chats = vi.hoisted(() => ({
  sessions: new Map<
    string,
    { ephemeral: boolean; running: boolean; unsaved: boolean }
  >(),
  summaries: { conversations: [] as { id: string; title: string }[] },
  discard: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => ({ revision: null, data: null })),
}));
vi.mock("../ai/chat", () => ({
  workspaceConversations: () => ({ state: chats.summaries }),
  workspaceChat: (_scope: string, id: string) => ({
    state: chats.sessions.get(id)!,
  }),
  discardUnsentChat: chats.discard,
}));

afterEach(() => {
  retainWorkspaceUi([]);
  chats.sessions.clear();
  chats.summaries = { conversations: [] };
  vi.clearAllMocks();
});

async function setup() {
  chats.summaries = reactive({ conversations: [] });
  chats.discard.mockImplementation((_scope: string, id: string) => {
    const state = chats.sessions.get(id)!;
    if (!state.ephemeral || state.running || state.unsaved) return false;
    chats.sessions.delete(id);
    return true;
  });
  const ui = workspaceUi("workspace");
  await ui.session.load();
  return ui;
}
function temporary(id: string) {
  chats.sessions.set(
    id,
    reactive({ ephemeral: true, running: false, unsaved: false }),
  );
  return { kind: "new-conversation", conversationId: id } as const;
}

it("retains temporary chats across hidden panes and inactive tabs, then clears abandoned histories and closed tabs", async () => {
  const ui = await setup();
  const target = temporary("temporary");
  temporary("not-opened-yet");
  await nextTick();
  expect(chats.discard).not.toHaveBeenCalled();
  await ui.coordinator.open(target);
  const first = ui.session.capture().address!;
  expect(ui.titleFor(target)).toBe("⟦navigation.newChat⟧");
  expect(
    ui.session.state.document!.layout.tabs[0]!.conversationIds,
  ).not.toContain("temporary");
  ui.session.dispatch({ type: "split", ...first, edge: "right" });
  const second = ui.session.capture().address!;
  await ui.coordinator.open(target);
  ui.session.dispatch({ type: "maximize", ...first });
  ui.session.dispatch({ type: "new-tab" });
  await nextTick();
  expect(chats.discard).not.toHaveBeenCalled();
  ui.session.open({ kind: "empty" }, ui.session.capture(first));
  await nextTick();
  expect(chats.discard).not.toHaveBeenCalled();
  ui.session.dispatch({ type: "close-tab", tabId: second.tabId });
  await nextTick();
  expect(chats.discard).toHaveBeenCalledExactlyOnceWith(
    "workspace",
    "temporary",
  );
  const closed = ui.session.state.document!.layout.closedTabs[0]!.tab;
  expect(
    closed.panes
      .flatMap((pane) => pane.navigation.entries)
      .some((entry) => entry.target.kind === "new-conversation"),
  ).toBe(false);
  expect(chats.sessions.has("not-opened-yet")).toBe(true);
});

it.each(["running", "unsaved"] as const)(
  "keeps an abandoned %s session until it can be discarded",
  async (flag) => {
    const ui = await setup();
    const target = temporary("retained");
    const state = chats.sessions.get("retained")!;
    state[flag] = true;
    await ui.coordinator.open(target);
    await nextTick();
    await ui.coordinator.open({ kind: "empty" });
    await nextTick();
    expect(chats.discard).not.toHaveBeenCalled();
    expect(
      ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.some(
        (entry) => entry.target.kind === "new-conversation",
      ),
    ).toBe(true);
    state[flag] = false;
    await nextTick();
    expect(chats.discard).toHaveBeenCalledExactlyOnceWith(
      "workspace",
      "retained",
    );
  },
);

it("promotes a closed first-send session after retaining its failed initial save", async () => {
  const ui = await setup();
  await ui.coordinator.open(temporary("sending"));
  const state = chats.sessions.get("sending")!;
  state.running = true;
  await nextTick();
  ui.session.dispatch({
    type: "close-tab",
    tabId: ui.session.capture().address!.tabId,
  });
  await nextTick();
  state.unsaved = true;
  state.running = false;
  await nextTick();
  expect(chats.discard).not.toHaveBeenCalled();
  const closedEntry = () =>
    ui.session.state.document!.layout.closedTabs[0]!.tab.panes[0]!.navigation.entries.at(
      -1,
    )!;
  expect(closedEntry().target.kind).toBe("new-conversation");
  state.ephemeral = false;
  state.unsaved = false;
  chats.summaries.conversations.push({ id: "sending", title: "Recovered" });
  await nextTick();
  expect(closedEntry().target).toEqual({
    kind: "conversation",
    conversationId: "sending",
  });
  expect(chats.discard).not.toHaveBeenCalled();
});

it("preserves abandoned targets when the chat owner declines discard", async () => {
  const ui = await setup();
  await ui.coordinator.open(temporary("retained"));
  await nextTick();
  chats.discard.mockReturnValue(false);
  await ui.coordinator.open({ kind: "empty" });
  await nextTick();
  expect(chats.discard).toHaveBeenCalled();
  expect(
    ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.some(
      (entry) => entry.target.kind === "new-conversation",
    ),
  ).toBe(true);
});

it("promotes current, historical and closed targets without changing entry identity or presentation", async () => {
  const ui = await setup();
  const target = temporary("sent");
  await ui.coordinator.open(target, undefined, undefined, { scrollTop: 24 });
  const address = ui.session.capture().address!;
  const original = currentEntry(
    ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation,
  );
  ui.session.dispatch({ type: "new-tab" });
  await ui.coordinator.open(target);
  ui.session.dispatch({ type: "new-tab" });
  await ui.coordinator.open(target);
  ui.session.dispatch({
    type: "close-tab",
    tabId: ui.session.capture().address!.tabId,
  });
  ui.session.open({ kind: "empty" }, ui.session.capture(address));
  await nextTick();
  chats.summaries.conversations.push({ id: "sent", title: "Saved chat" });
  await nextTick();
  const layout = ui.session.state.document!.layout;
  for (const tab of [
    ...layout.tabs,
    ...layout.closedTabs.map((closed) => closed.tab),
  ]) {
    expect(tab.conversationIds).toContain("sent");
    expect(
      tab.panes
        .flatMap((pane) => pane.navigation.entries)
        .some((entry) => entry.target.kind === "new-conversation"),
    ).toBe(false);
  }
  const promoted = layout.tabs[0]!.panes[0]!.navigation.entries.find(
    (entry) => entry.id === original.id,
  )!;
  expect(promoted).toEqual({
    ...original,
    target: { kind: "conversation", conversationId: "sent" },
  });
  expect(chats.discard).not.toHaveBeenCalled();
  expect(ui.titleFor(promoted.target)).toBe("Saved chat");
});
