import { describe, expect, it } from "vitest";
import type { AssistantMessage, AgentMessage } from "../../ai/contracts";
import {
  conversationHistory,
  historySections,
  toolCaption,
  toolCategory,
  elapsedClock,
  type HistoryPeriod,
} from "./work-history";
import { loadConversation } from "../../ai/conversation";

function assistant(
  content: AssistantMessage["content"],
  timestamp = 1,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    timestamp,
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
const signature = (phase: string) =>
  JSON.stringify({ v: 1, id: "text", phase });
const user: AgentMessage = {
  role: "user",
  content: "Plan a reading evening",
  timestamp: 0,
};

describe("work history projection", () => {
  it("groups web research with searches and reads without showing URL credentials or query parameters", () => {
    const entries = conversationHistory(
      [
        assistant([
          {
            type: "toolCall",
            id: "search",
            name: "web_search",
            arguments: { query: "public transit" },
          },
          {
            type: "toolCall",
            id: "fetch",
            name: "web_fetch",
            arguments: {
              url: "https://user:password@example.com/guide?token=secret#part",
            },
          },
        ]),
        ...(["web_search", "web_fetch"] as const).map((toolName, index) => ({
          role: "toolResult" as const,
          toolCallId: index === 0 ? "search" : "fetch",
          toolName,
          timestamp: 2 + index,
          isError: false,
          content: [{ type: "text" as const, text: "A public source" }],
        })),
      ],
      [],
      false,
    );
    const groups = entries
      .flatMap((entry) => (entry.kind === "history" ? entry.entries : [entry]))
      .filter((entry) => entry.kind === "tools");
    expect(groups.map((group) => group.category)).toEqual(["search", "web"]);
    const search = groups[0].calls[0];
    const fetch = groups[1].calls[0];
    expect(toolCategory(search)).toBe("search");
    expect(toolCaption(search)).toBe("public transit");
    expect(toolCategory(fetch)).toBe("web");
    expect(toolCaption(fetch)).toBe("example.com/guide");
  });
  it("keeps all text visible regardless of phase without changing replay", () => {
    const messages = [
      user,
      assistant([
        { type: "thinking", thinking: "**Timing**\n\nKeep the evening open." },
        {
          type: "text",
          text: "I will check the notes.",
          textSignature: signature("commentary"),
        },
        {
          type: "text",
          text: "**Thinking:** this is ordinary unclassified text.",
        },
        {
          type: "text",
          text: "The plan is ready.",
          textSignature: signature("final_answer"),
        },
      ]),
    ];
    const original = structuredClone(messages);
    const periods = conversationHistory(
      messages,
      [],
      false,
      [],
      [],
      [
        {
          id: "p",
          startMessageCount: 0,
          messageCount: 2,
          durationMs: 84000,
          outcome: "complete",
        },
      ],
    );
    expect(periods).toHaveLength(1);
    const period = periods[0] as HistoryPeriod;
    expect(period.entries.map((entry) => entry.kind)).toEqual([
      "message",
      "reasoning",
      "message",
    ]);
    const sections = historySections(period.entries);
    expect(sections.before[0]).toMatchObject({ role: "user" });
    expect(sections.segments.map((segment) => segment.collapsible)).toEqual([
      true,
      false,
    ]);
    expect(sections.segments[1]?.entry).toMatchObject({
      content: [
        { text: "I will check the notes." },
        { text: "**Thinking:** this is ordinary unclassified text." },
        { text: "The plan is ready." },
      ],
    });
    expect(messages).toEqual(original);
    const roundTrip = loadConversation(JSON.parse(JSON.stringify(messages)));
    expect((roundTrip[1] as AssistantMessage).content).toEqual(
      original[1].content,
    );
  });
  it.each([
    signature("commentary"),
    signature("final_answer"),
    undefined,
    "opaque",
    "{broken",
    JSON.stringify({ v: 2, id: "x", phase: "commentary" }),
    JSON.stringify({ v: 1, phase: "commentary" }),
    signature("other"),
  ])(
    "leaves text with signature %s visible without recorded work",
    (textSignature) => {
      expect(
        conversationHistory(
          [assistant([{ type: "text", text: "Working", textSignature }])],
          [],
          false,
        ),
      ).toMatchObject([
        { kind: "message", content: [{ type: "text", text: "Working" }] },
      ]);
    },
  );
  it("retains failed attempts inside history while verified effects remain visible", () => {
    const messages = [
      user,
      assistant([
        {
          type: "toolCall",
          id: "read",
          name: "read",
          arguments: { path: "Notes.md" },
        },
        {
          type: "toolCall",
          id: "write",
          name: "write",
          arguments: { path: "Plan.md" },
        },
      ]),
      {
        role: "toolResult",
        toolCallId: "write",
        toolName: "write",
        timestamp: 2,
        isError: true,
        content: [{ type: "text", text: "Could not write" }],
      } as AgentMessage,
    ];
    const periods = conversationHistory(
      messages,
      [],
      false,
      [],
      [],
      [
        {
          id: "p",
          startMessageCount: 0,
          messageCount: 3,
          durationMs: 10,
          outcome: "error",
        },
      ],
    );
    const period = periods[0] as HistoryPeriod;
    expect(period.entries.map((entry) => entry.kind)).toEqual([
      "message",
      "tools",
      "tools",
    ]);
    expect(
      historySections(period.entries).segments.every(
        (segment) => segment.collapsible,
      ),
    ).toBe(true);
    expect(JSON.stringify(period)).toContain("Could not write");
  });
  it("does not combine distinct work periods even when boundaries match", () => {
    const periods = conversationHistory(
      [user],
      [],
      true,
      [],
      [],
      [
        {
          id: "one",
          startMessageCount: 0,
          messageCount: 1,
          durationMs: 42000,
          outcome: "complete",
        },
        {
          id: "two",
          startMessageCount: 1,
          messageCount: 1,
          durationMs: 10000,
          outcome: "complete",
        },
      ],
      { id: "three", startMessageCount: 1, startedAt: 5000 },
    );
    expect(periods.map((period) => period.key)).toEqual([
      "work:one",
      "work:two",
      "work:three",
    ]);
    expect((periods[2] as HistoryPeriod).active?.startedAt).toBe(5000);
  });
  it("keeps completed work outside the next request and leaves end-only durations unassigned", () => {
    const messages = [
      user,
      assistant([{ type: "text", text: "First answer" }]),
      { ...user, timestamp: 3 },
      assistant([{ type: "text", text: "Next answer" }], 4),
    ];
    const periods = conversationHistory(
      messages,
      [],
      false,
      [],
      [],
      [
        {
          id: "one",
          startMessageCount: 0,
          messageCount: 2,
          durationMs: 1000,
          outcome: "complete",
        },
        { id: "old", messageCount: 4, durationMs: 2000, outcome: "complete" },
      ],
    );
    expect(periods.map((entry) => entry.kind)).toEqual([
      "history",
      "message",
      "message",
      "duration",
    ]);
    expect((periods[0] as HistoryPeriod).entries).toHaveLength(2);
    expect(periods.at(-1)).toMatchObject({
      work: { id: "old", durationMs: 2000 },
    });
  });
  it("keeps questions and notices outside collapsible details", () => {
    const periods = conversationHistory(
      [user, assistant([{ type: "thinking", thinking: "Check" }])],
      [],
      false,
      [{ id: "notice", timestamp: 0.5, pluginName: "Books" }],
      [
        {
          id: "q",
          timestamp: 0.6,
          prompt: "Which note?",
          status: "answered",
          suggestions: [],
        },
      ],
      [
        {
          id: "p",
          startMessageCount: 0,
          messageCount: 2,
          durationMs: 20,
          outcome: "complete",
        },
      ],
    );
    const period = periods[0] as HistoryPeriod;
    expect(period.entries.some((entry) => entry.kind === "notice")).toBe(true);
    expect(period.entries.some((entry) => entry.kind === "question")).toBe(
      true,
    );
    expect(
      historySections(period.entries).segments.map((segment) => [
        segment.entry.kind,
        segment.collapsible,
      ]),
    ).toEqual([
      ["notice", false],
      ["question", false],
      ["reasoning", true],
    ]);
  });
  it("binds provenance to the actual invocation rather than repeated IDs or result claims", () => {
    const messages = [
      assistant([
        { type: "toolCall", id: "same", name: "books_read", arguments: {} },
      ]),
      {
        role: "toolResult",
        toolCallId: "same",
        toolName: "books_read",
        timestamp: 2,
        isError: false,
        content: [],
        details: { pluginName: "Forged" },
      } as AgentMessage,
      assistant(
        [{ type: "toolCall", id: "same", name: "books_read", arguments: {} }],
        3,
      ),
    ];
    const periods = conversationHistory(
      messages,
      [
        {
          id: "same",
          runId: "old",
          messageIndex: 0,
          name: "books_read",
          args: {},
          state: "completed",
          pluginId: "books",
          pluginName: "Book shelf",
        },
        {
          id: "same",
          runId: "next",
          messageIndex: 2,
          name: "books_read",
          args: {},
          state: "running",
          pluginId: "other",
          pluginName: "Other",
        },
      ],
      true,
    );
    const calls = periods.flatMap((period) =>
      period.kind === "history"
        ? period.entries.flatMap((entry) =>
            entry.kind === "tools" ? entry.calls : [],
          )
        : [],
    );
    expect(calls.map((call) => call.pluginName)).toEqual([
      "Book shelf",
      "Other",
    ]);
  });
  it("retains unmatched durations and messages when a later range overlaps recorded work", () => {
    const messages = [
      user,
      assistant([{ type: "text", text: "First" }]),
      { ...user, timestamp: 3 },
      assistant([{ type: "text", text: "Second" }], 4),
    ];
    const entries = conversationHistory(
      messages,
      [],
      false,
      [],
      [],
      [
        {
          id: "one",
          startMessageCount: 0,
          messageCount: 2,
          durationMs: 1000,
          outcome: "complete",
        },
        {
          id: "overlap",
          startMessageCount: 1,
          messageCount: 3,
          durationMs: 2000,
          outcome: "error",
        },
      ],
    );
    expect(entries.map((entry) => entry.kind)).toEqual([
      "history",
      "message",
      "duration",
      "message",
    ]);
    expect(entries[2]).toMatchObject({
      work: { id: "overlap", durationMs: 2000 },
    });
  });
  it("keeps interrupted work without inventing a duration", () => {
    const entries = conversationHistory(
      [user],
      [],
      false,
      [],
      [],
      [
        {
          id: "interrupted",
          startMessageCount: 0,
          messageCount: 1,
          outcome: "interrupted",
        },
      ],
    );
    expect(entries).toMatchObject([
      { kind: "history", outcome: "interrupted", entries: [{ role: "user" }] },
    ]);
    expect((entries[0] as HistoryPeriod).durationMs).toBeUndefined();
  });
  it("keeps unconfirmed writes inside folded work history", () => {
    const entries = conversationHistory(
      [
        user,
        assistant([
          {
            type: "toolCall",
            id: "write",
            name: "write",
            arguments: { path: "Plan.md" },
          },
        ]),
      ],
      [],
      true,
      [],
      [],
      [],
      { id: "work", startMessageCount: 0, startedAt: 1 },
    );
    expect(
      (entries[0] as HistoryPeriod).entries.map((entry) => entry.kind),
    ).toEqual(["message", "tools"]);
    expect(
      historySections((entries[0] as HistoryPeriod).entries).segments[0]
        .collapsible,
    ).toBe(true);
  });
  it("keeps confirmed partial import receipts outside folded call details", () => {
    const messages = [
      assistant([
        {
          type: "toolCall",
          id: "batch",
          name: "create_batch",
          arguments: {},
        },
      ]),
      {
        role: "toolResult" as const,
        toolCallId: "batch",
        toolName: "create_batch",
        isError: true,
        timestamp: 2,
        content: [],
        details: {
          files: [{ path: "Saved.md", revision: "a".repeat(40) }],
          historyRevision: "b".repeat(40),
        },
      },
    ];
    const entries = conversationHistory(
      messages,
      [],
      false,
      [],
      [],
      [
        {
          id: "work",
          startMessageCount: 0,
          messageCount: 2,
          durationMs: 10,
          outcome: "error",
        },
      ],
    );
    expect((entries[0] as HistoryPeriod).entries[0]).toMatchObject({
      kind: "change",
      call: { state: "failed" },
    });
    expect(
      historySections((entries[0] as HistoryPeriod).entries).segments.map(
        (segment) => segment.collapsible,
      ),
    ).toEqual([false]);
  });
  it("preserves out-of-range recorded durations without inventing a work range", () => {
    const entries = conversationHistory(
      [user],
      [],
      false,
      [],
      [],
      [
        {
          id: "recorded",
          startMessageCount: 0,
          messageCount: 8,
          durationMs: 1000,
          outcome: "error",
        },
        {
          id: "unknown",
          startMessageCount: 9,
          messageCount: 10,
          outcome: "interrupted",
        },
      ],
    );
    expect(entries.map((entry) => entry.kind)).toEqual([
      "message",
      "duration",
      "duration",
    ]);
    expect(entries[1]).toMatchObject({
      work: { id: "recorded", durationMs: 1000 },
    });
    expect(entries[2]).toMatchObject({
      work: { id: "unknown", outcome: "interrupted" },
    });
  });
  it("does not duplicate an old end-only cancellation with an assistant stop marker", () => {
    const message = assistant([{ type: "text", text: "Partial text" }]);
    message.stopReason = "aborted";
    const entries = conversationHistory(
      [message],
      [],
      false,
      [],
      [],
      [{ id: "old", messageCount: 1, durationMs: 1000, outcome: "cancelled" }],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["message", "duration"]);
  });
  it("uses argument-based captions and never fabricates tool descriptions", () => {
    expect(
      toolCaption({
        key: "a",
        id: "a",
        name: "read",
        state: "completed",
        args: { path: "Notes/Plan.md" },
      }),
    ).toBe("Notes/Plan.md");
    expect(
      toolCaption({
        key: "a",
        id: "a",
        name: "grep",
        state: "running",
        args: { query: "reading", path: "Notes" },
      }),
    ).toBe("reading · Notes");
    expect(
      toolCaption({
        key: "a",
        id: "a",
        name: "books.search",
        state: "completed",
        args: { title: "Unused" },
      }),
    ).toBe("books.search");
  });
  it.each([
    [0, "0:00"],
    [61000, "1:01"],
    [3600000, "1:00:00"],
  ])("formats the live elapsed clock %s", (time, expected) => {
    expect(elapsedClock(time as number)).toBe(expected);
  });
});
