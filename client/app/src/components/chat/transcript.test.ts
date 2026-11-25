import { expect, test } from "vitest";
import type { AssistantMessage, ToolResultMessage } from "../../ai/contracts";
import { documentLinks, transcriptBlocks, verifiedChange } from "./transcript";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    timestamp: 1,
    stopReason: "toolUse",
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
function result(
  id: string,
  name: string,
  details?: ToolResultMessage["details"],
  isError = false,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    timestamp: 2,
    content: [{ type: "text", text: "result" }],
    isError,
    details,
  };
}
test("offers preview links only for source-bound document references", () => {
  const source = { pluginId: "sample", instanceId: "archive" };
  const ref = { source, id: "42", identity: "stable", revision: "r1" };
  const structuredContent: ToolResultMessage["structuredContent"] = {
    version: 1,
    operation: "search",
    status: "ok",
    source,
    items: [
      { ref, title: "Receipt" },
      { ref: { ...ref, source: { ...source, instanceId: "different" } } },
      { ref: { source, id: "scan.pdf", identity: "path" } },
    ],
  };
  const call = {
    key: "one",
    id: "one",
    name: "find",
    state: "completed",
    result: { ...result("one", "find"), structuredContent },
  };
  expect(documentLinks(call)).toEqual([{ ref, title: "Receipt" }]);
  expect(
    documentLinks({ ...call, result: { ...call.result, isError: true } }),
  ).toEqual([]);
});

test("only presents valid live references from a successful import receipt", () => {
  const file = {
    kind: "live",
    workspaceId: "garden",
    path: "Reading.md",
    anchorRevision: "a".repeat(40),
  };
  const call = assistant([
    {
      type: "toolCall",
      id: "import",
      name: "show_imported_files",
      arguments: {},
    },
  ]);
  const details = {
    files: [file, file, { ...file, path: "../incorrect.md" }, "notes.md"],
    missing: ["Unavailable.md"],
  };
  const files = (error: boolean) =>
    transcriptBlocks(
      [call, result("import", "show_imported_files", details, error)],
      [],
      false,
    ).filter((block) => block.kind === "imported-files");
  expect(files(false)).toMatchObject([{ references: [file] }]);
  expect(files(true)).toEqual([]);
});
test("shows the conversational method explanation and groups its tool call in activity", () => {
  const blocks = transcriptBlocks(
    [
      assistant([
        {
          type: "text",
          text: "I will keep your project folders and review tasks each Friday.",
        },
        {
          type: "toolCall",
          id: "proposal",
          name: "propose_working_method",
          arguments: {},
        },
      ]),
      result("proposal", "propose_working_method", {
        proposedMarkdown: "# Working method",
        question: { id: "q", prompt: "Adopt this working method?" },
      }),
    ],
    [],
    false,
  );
  expect(blocks).toEqual([
    expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I will keep your project folders and review tasks each Friday.",
        },
      ],
    }),
    expect.objectContaining({
      kind: "tools",
      calls: [
        expect.objectContaining({
          name: "propose_working_method",
          state: "completed",
        }),
      ],
    }),
  ]);
});

test("empty text and reasoning do not split consecutive activity blocks", () => {
  const blocks = transcriptBlocks(
    [
      assistant([
        { type: "toolCall", id: "first", name: "read", arguments: {} },
        { type: "text", text: "" },
        { type: "thinking", thinking: " \n " },
        { type: "text", text: "  " },
        { type: "toolCall", id: "second", name: "read", arguments: {} },
      ]),
    ],
    [],
    true,
  );
  expect(blocks).toEqual([
    expect.objectContaining({
      kind: "tools",
      calls: [
        expect.objectContaining({ id: "first" }),
        expect.objectContaining({ id: "second" }),
      ],
    }),
  ]);
});

const change = {
  path: "notes/a.md",
  before: "old",
  after: "saved",
  beforeRevision: "before",
  afterRevision: "after",
};

test("groups consecutive tool calls but keeps each verified write separate and in order", () => {
  const blocks = transcriptBlocks(
    [
      { role: "user", content: "Update the note", timestamp: 0 },
      assistant([
        { type: "toolCall", id: "r1", name: "read", arguments: {} },
        { type: "toolCall", id: "r2", name: "read", arguments: {} },
      ]),
      result("r1", "read"),
      result("r2", "read"),
      assistant([
        { type: "text", text: "I found the note." },
        { type: "toolCall", id: "w1", name: "edit", arguments: {} },
      ]),
      result("w1", "edit", { change }),
      assistant([{ type: "toolCall", id: "w2", name: "edit", arguments: {} }]),
      result("w2", "edit", {
        change: {
          ...change,
          before: "saved",
          after: "second",
          beforeRevision: "after",
          afterRevision: "last",
        },
      }),
      assistant([{ type: "text", text: "Done." }]),
    ],
    [],
    false,
  );
  expect(blocks.map((block) => block.kind)).toEqual([
    "message",
    "tools",
    "message",
    "change",
    "change",
    "message",
  ]);
  expect(blocks[1]).toMatchObject({
    calls: [
      { id: "r1", state: "completed" },
      { id: "r2", state: "completed" },
    ],
  });
  expect(
    blocks[3]?.kind === "change" && verifiedChange(blocks[3].call),
  ).toEqual(change);
  expect(
    blocks[4]?.kind === "change" && verifiedChange(blocks[4].call)?.after,
  ).toBe("second");
});

test.each([
  "running",
  "completed",
  "failed",
  "error",
  "cancelled",
  "aborted",
  "interrupted",
])("groups shell and read calls with %s status under activity", (state) => {
  const blocks = transcriptBlocks(
    [
      assistant([
        { type: "toolCall", id: "shell", name: "shell", arguments: {} },
        { type: "toolCall", id: "read", name: "read", arguments: {} },
      ]),
    ],
    ["shell", "read"].map((name) => ({
      id: name,
      runId: "run",
      name,
      args: {},
      state,
    })),
    true,
  );
  expect(blocks).toMatchObject([
    {
      kind: "tools",
      calls: [
        { name: "shell", state },
        { name: "read", state },
      ],
    },
  ]);
});

test("failed tool results remain grouped with successful calls under activity", () => {
  const blocks = transcriptBlocks(
    [
      assistant([
        { type: "toolCall", id: "shell", name: "shell", arguments: {} },
        { type: "toolCall", id: "read", name: "read", arguments: {} },
      ]),
      result("shell", "shell", undefined, true),
      result("read", "read"),
    ],
    [],
    false,
  );
  expect(blocks).toMatchObject([
    {
      kind: "tools",
      calls: [
        { name: "shell", state: "failed", result: { isError: true } },
        { name: "read", state: "completed" },
      ],
    },
  ]);
});

test("requested content and failed writes without a committed revision never become a diff", () => {
  const blocks = transcriptBlocks(
    [
      assistant([
        {
          type: "toolCall",
          id: "edit",
          name: "edit",
          arguments: { before: "old", after: "requested" },
        },
      ]),
      result(
        "edit",
        "edit",
        { change: { ...change, afterRevision: null } },
        true,
      ),
    ],
    [],
    false,
  );
  expect(blocks).toMatchObject([{ kind: "call", call: { state: "failed" } }]);
});

test("a verified saved change remains visible when history recording reports an error", () => {
  const blocks = transcriptBlocks(
    [
      assistant([
        { type: "toolCall", id: "edit", name: "edit", arguments: {} },
      ]),
      result("edit", "edit", { change, warning: "history unavailable" }, true),
    ],
    [],
    false,
  );
  expect(blocks).toMatchObject([{ kind: "change", call: { state: "failed" } }]);
});

test("same tool-call IDs on later turns cannot overwrite earlier results", () => {
  const blocks = transcriptBlocks(
    [
      assistant([
        {
          type: "toolCall",
          id: "same",
          name: "read",
          arguments: { path: "first" },
        },
      ]),
      result("same", "read"),
      assistant([
        { type: "text", text: "Next" },
        {
          type: "toolCall",
          id: "same",
          name: "read",
          arguments: { path: "second" },
        },
      ]),
    ],
    [
      {
        id: "same",
        runId: "later",
        name: "read",
        args: {},
        state: "running",
        result: "partial",
      },
    ],
    true,
  );
  expect(blocks[0]).toMatchObject({
    calls: [{ state: "completed", result: { content: [{ text: "result" }] } }],
  });
  expect(blocks[2]).toMatchObject({
    calls: [{ state: "running", progress: "partial" }],
  });
});

test("unmatched repeated call IDs retain their own state and progress", () => {
  const old = assistant([
    {
      type: "toolCall",
      id: "same",
      name: "read",
      arguments: { path: "Old.md" },
    },
  ]);
  old.stopReason = "aborted";
  const next = assistant([
    {
      type: "toolCall",
      id: "same",
      name: "read",
      arguments: { path: "New.md" },
    },
  ]);
  const blocks = transcriptBlocks(
    [old, next],
    [
      {
        id: "same",
        runId: "old",
        name: "read",
        messageIndex: 0,
        args: {},
        state: "interrupted",
        result: "Old progress",
      },
      {
        id: "same",
        runId: "next",
        name: "read",
        messageIndex: 1,
        args: {},
        state: "running",
        result: "New progress",
      },
    ],
    true,
    [],
    [],
    [],
    { id: "work", startMessageCount: 1, startedAt: 0 },
  );
  const calls = blocks.flatMap((block) =>
    block.kind === "tools" ? block.calls : [],
  );
  expect(calls.map((call) => [call.state, call.progress])).toEqual([
    ["interrupted", "Old progress"],
    ["running", "New progress"],
  ]);
});

test("notices interleave across a topic change without detaching grouped tool results", () => {
  const blocks = transcriptBlocks(
    [
      { role: "user", content: "Build a reading list", timestamp: 0 },
      assistant([
        { type: "toolCall", id: "first", name: "read", arguments: {} },
        { type: "toolCall", id: "second", name: "read", arguments: {} },
      ]),
      result("first", "read"),
      result("second", "read"),
      { role: "user", content: "Plan Saturday instead", timestamp: 3 },
      {
        ...assistant([{ type: "text", text: "Leave the morning free." }]),
        timestamp: 5,
      },
    ],
    [],
    false,
    [
      { id: "later", pluginName: "Reading list", timestamp: 4 },
      { id: "during-tools", pluginName: "Notes", timestamp: 1.5 },
    ],
  );
  expect(blocks.map((block) => block.kind)).toEqual([
    "message",
    "tools",
    "notice",
    "message",
    "notice",
    "message",
  ]);
  expect(blocks[1]).toMatchObject({
    calls: [
      { id: "first", state: "completed", result: { toolCallId: "first" } },
      { id: "second", state: "completed", result: { toolCallId: "second" } },
    ],
  });
  expect(blocks[2]).toMatchObject({
    key: "notice:during-tools",
    notice: { pluginName: "Notes" },
  });
  expect(blocks[4]).toMatchObject({
    key: "notice:later",
    notice: { pluginName: "Reading list" },
  });
});

test("notices alone form history and equal-time notices retain delivery order", () => {
  const notices = [
    { id: "one", pluginName: "Reading list", timestamp: 3 },
    { id: "two", pluginName: "Reading list", timestamp: 3 },
  ];
  expect(transcriptBlocks([], [], false, notices)).toEqual(
    notices.map((notice) => ({
      key: `notice:${notice.id}`,
      kind: "notice",
      notice,
      messageIndex: 0,
    })),
  );
  expect(transcriptBlocks([], [], false)).toEqual([]);
});

test("a stop marker follows interrupted tools without hiding completed changes", () => {
  const stopped = assistant([]);
  stopped.timestamp = 4;
  stopped.stopReason = "aborted";
  const blocks = transcriptBlocks(
    [
      assistant([
        { type: "toolCall", id: "edit", name: "edit", arguments: {} },
        { type: "toolCall", id: "read", name: "read", arguments: {} },
      ]),
      result("edit", "edit", { change }),
      stopped,
    ],
    [],
    false,
  );
  expect(blocks).toMatchObject([
    { kind: "change", call: { id: "edit", state: "completed" } },
    { kind: "tools", calls: [{ id: "read", state: "interrupted" }] },
    { kind: "stopped" },
  ]);
});

test("unfinished calls after reopening are interrupted rather than still running", () => {
  const blocks = transcriptBlocks(
    [
      assistant([
        { type: "toolCall", id: "read", name: "read", arguments: {} },
      ]),
    ],
    [{ id: "read", runId: "old", name: "read", args: {}, state: "running" }],
    false,
  );
  expect(blocks).toMatchObject([
    { kind: "tools", calls: [{ state: "interrupted" }] },
  ]);
});
