import { expect, test } from "vitest";
import {
  projectHistory,
  readHistoryPage,
  rebaseHistoryEvent,
  type HistoryEntry,
} from "./conversation-history";

const entry = (
  id: string,
  parentId: string | null,
  type: string,
  data: unknown,
): HistoryEntry => ({ version: 1, id, parentId, type, data });

test("history projects originals, retaining tool details without exposing compaction summaries", () => {
  const original = {
    role: "toolResult",
    toolCallId: "call",
    toolName: "read",
    content: [{ type: "text", text: "Original result" }],
    isError: false,
    timestamp: 4,
    details: { opaque: [7] },
  };
  const projected = projectHistory([
    entry("a", null, "message", {
      message: { role: "user", content: "Request", timestamp: 1 },
      input: { state: "waiting" },
    }),
    entry("b", "a", "compaction", {
      summary: "Not original history",
      firstKeptEntryId: "a",
    }),
    entry("c", "b", "message", { message: original }),
    entry("d", "c", "event", {
      id: "work",
      runId: "run",
      sequence: 1,
      type: "work_block_end",
      data: { messageCount: 42 },
    }),
  ]);
  expect(projected.messages).toEqual([
    { role: "user", content: "Request", timestamp: 1 },
    original,
  ]);
  expect(projected.events[0].data).toEqual({ messageCount: 42 });
});

test("message positions are rebased without changing retained events", () => {
  const event = {
    id: "e",
    runId: "run",
    sequence: 1,
    type: "work_block_end",
    data: {
      messageIndex: 53,
      startMessageCount: 48,
      messageCount: 54,
      durationMs: 5,
    },
  };
  expect(rebaseHistoryEvent(event, 50).data).toEqual({
    messageIndex: 3,
    startMessageCount: 0,
    messageCount: 4,
    durationMs: 5,
  });
  expect(event.data.messageCount).toBe(54);
});

test("pages reject broken ancestry, duplicate IDs and invalid offsets", () => {
  const page = {
    metadata: { id: "chat", revision: 2, selectedEntryId: "b" },
    entries: [entry("a", null, "legacy", {}), entry("b", "a", "legacy", {})],
    nextBefore: null,
    messageOffset: 0,
    eventOffset: 0,
  };
  expect(readHistoryPage(page)).toEqual(page);
  expect(() => readHistoryPage({ ...page, messageOffset: -1 })).toThrow();
  expect(() =>
    readHistoryPage({
      ...page,
      entries: [page.entries[0], entry("b", "elsewhere", "legacy", {})],
    }),
  ).toThrow();
  expect(() =>
    readHistoryPage({ ...page, entries: [page.entries[0], page.entries[0]] }),
  ).toThrow();
});
