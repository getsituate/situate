import { expect, test } from "vitest";
import fixtures from "../../../contracts/files.json";
import {
  readConversationList,
  readConversationRecord,
  conversationSummary,
  compareConversations,
} from "./conversation-record";

const record = {
  version: 2,
  id: "legacy",
  title: "",
  revision: 0,
  messages: [],
  draft: "Unsent",
};

test("conversation records keep the requested identity and recoverable draft", () => {
  expect(readConversationRecord(record, "legacy")).toEqual(record);
  expect(() => readConversationRecord(record, "another")).toThrow();
});

test.each([
  null,
  { ...record, version: 1 },
  { ...record, id: "../outside" },
  { ...record, id: "A" },
  { ...record, revision: -1 },
  { ...record, revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...record, revision: 1.5 },
  { ...record, draft: null },
  { ...record, messages: [{ role: "user", content: null, timestamp: 1 }] },
  { ...record, extra: "unknown" },
])("malformed records cannot enter a conversation session (%j)", (value) => {
  expect(() => readConversationRecord(value, "legacy")).toThrow();
});

test("native title input is bounded and retained for ordinary and development records", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  const development = { version: 2 };
  for (const titleInput of ["", "Build a reading inbox"]) {
    const stored = { ...record, id, development, titleInput };
    expect(readConversationRecord(stored, id)).toEqual(stored);
  }
  for (const titleInput of [null, 12, "x".repeat(16385)]) {
    expect(() =>
      readConversationRecord({ ...record, id, development, titleInput }, id),
    ).toThrow();
  }
  expect(
    readConversationRecord(
      { ...record, titleInput: "Build a reading inbox" },
      record.id,
    ).titleInput,
  ).toBe("Build a reading inbox");
});

test("development metadata is strict and survives record and summary parsing", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const development = {
    version: 2,
    pluginId: "sample",
    originConversationId: "legacy",
  };
  const direct = { version: 2, pluginId: "sample" };
  expect(
    readConversationRecord({ ...record, id, development: direct }, id)
      .development,
  ).toEqual(direct);
  expect(
    readConversationList([
      { id, title: "", revision: 0, development: direct },
    ])[0]!.development,
  ).toEqual(direct);
  const stored = { ...record, id, development };
  expect(readConversationRecord(stored, id).development).toEqual(development);
  expect(
    readConversationList([{ id, title: "", revision: 0, development }])[0]!
      .development,
  ).toEqual(development);
  for (const invalid of [
    null,
    undefined,
    {},
    { ...development, extra: true },
    { ...development, pluginId: "con" },
    { ...development, pluginId: "Sample" },
    { ...development, draftId: "not-a-uuid" },
    { ...development, draftId: "12345678-1234-1234-1234-123456789abd" },
    { ...development, originConversationId: "../outside" },
    { ...development, originConversationId: null },
    { ...development, originConversationId: undefined },
    { ...development, originConversationId: id },
  ]) {
    expect(() =>
      readConversationRecord({ ...stored, development: invalid }, id),
    ).toThrow();
    expect(() =>
      readConversationList([
        { id, title: "", revision: 0, development: invalid },
      ]),
    ).toThrow();
  }
});

test("workspace assignments retain optional starting context without a draft container", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  for (const development of [
    { version: 2 },
    { version: 2, pluginId: "mail", originConversationId: "legacy" },
  ]) {
    expect(
      readConversationRecord({ ...record, id, development }, id).development,
    ).toEqual(development);
    expect(
      readConversationList([
        { id, title: "Assignment", revision: 0, development },
      ])[0]!.development,
    ).toEqual(development);
  }
  for (const development of [
    { version: 2, draftId: id },
    { version: 2, draftId: "" },
    { version: 2, pluginId: "" },
    { version: 3 },
    { version: 2, targets: [] },
  ])
    expect(() =>
      readConversationRecord({ ...record, id, development }, id),
    ).toThrow("native.ai.conversation.versionInvalid");
});

test("portable conversation records reject local model preferences", () => {
  for (const modelOverride of [
    null,
    {},
    {
      model: "local-model",
      connection: {
        provider: "custom",
        endpoint: "http://localhost:8888/v1",
        auth: "api_key",
      },
    },
  ])
    expect(() =>
      readConversationRecord({ ...record, modelOverride }, "legacy"),
    ).toThrow();
});

test.each(["draft", "pending", "run"])(
  "stored %s references enforce the shared wire contract",
  (location) => {
    function stored(reference: unknown) {
      return {
        ...record,
        runtime: {
          draftAttachments: [],
          draftReferences: location === "draft" ? [reference] : [],
          pending:
            location === "pending"
              ? [
                  {
                    id: "queued",
                    kind: "followUp",
                    state: "pending",
                    text: "Next",
                    timestamp: 1,
                    attachments: [],
                    references: [reference],
                  },
                ]
              : [],
          events: [],
          runs:
            location === "run"
              ? [
                  {
                    id: "run",
                    state: "completed",
                    startedAt: 1,
                    usage: [],
                    references: [reference],
                  },
                ]
              : [],
        },
      };
    }
    for (const { reply } of fixtures.valid) {
      if (!("reference" in reply)) continue;
      const value = stored(reply.reference);
      expect(
        readConversationRecord(JSON.parse(JSON.stringify(value)), record.id),
      ).toEqual(value);
    }
    for (const reference of [
      { kind: "live", workspaceId: "notes", path: "Notes.md" },
      {
        kind: "live",
        workspaceId: "notes",
        path: "Notes.md",
        fileId: "11111111-1111-4111-8111-111111111111",
      },
    ]) {
      expect(() =>
        readConversationRecord(stored(reference), record.id),
      ).toThrow("native.ai.conversation.versionInvalid");
    }
    for (const { reply } of fixtures.invalidReplies) {
      if (!("reference" in reply)) continue;
      expect(() =>
        readConversationRecord(stored(reply.reference), record.id),
      ).toThrow("native.ai.conversation.versionInvalid");
    }
  },
);

test("conversation summaries order only by the newest user message with stable ties", () => {
  const summaries = [
    conversationSummary({
      ...record,
      version: 2,
      id: "older",
      revision: 99,
      messages: [
        { role: "user", content: "Old", timestamp: 100 },
        {
          role: "toolResult",
          toolCallId: "call",
          toolName: "example",
          content: [],
          isError: false,
          timestamp: 900,
        },
      ],
    }),
    conversationSummary({ ...record, version: 2, id: "empty", messages: [] }),
    conversationSummary({
      ...record,
      version: 2,
      id: "newer",
      messages: [
        { role: "user", content: "New", timestamp: 200.5 },
        { role: "user", content: "Earlier", timestamp: 50 },
      ],
    }),
    { id: "tied", title: "Tied", revision: 0, lastUserMessageAt: 200.5 },
    { id: "empty-a", title: "Empty", revision: 0 },
  ];
  expect(summaries[0]?.lastUserMessageAt).toBe(100);
  expect(
    readConversationList(summaries)
      .sort(compareConversations)
      .map((item) => item.id),
  ).toEqual(["newer", "tied", "older", "empty", "empty-a"]);
});

test("conversation lists reject duplicate identities and unknown fields", () => {
  const summary = { id: "one", title: "One", revision: 2 };
  expect(readConversationList([summary])).toEqual([summary]);
  for (const value of [
    null,
    [summary, summary],
    [{ ...summary, extra: true }],
    [{ ...summary, id: "" }],
    [{ ...summary, lastUserMessageAt: null }],
    [{ ...summary, lastUserMessageAt: "100" }],
    [{ ...summary, lastUserMessageAt: Infinity }],
    [{ ...summary, lastUserMessageAt: NaN }],
  ])
    expect(() => readConversationList(value)).toThrow();
});
test("native event sequences are ordered per run while projection positions remain separate", () => {
  const runtime = {
    draftAttachments: [],
    pending: [],
    runs: [{ id: "a", state: "running", startedAt: 1 }],
    events: [
      {
        id: "event",
        runId: "a",
        sequence: 1,
        type: "input_accepted",
        data: {},
      },
      {
        id: "event",
        runId: "b",
        sequence: 1,
        type: "action_accepted",
        data: {},
      },
      { id: "second", runId: "a", sequence: 2, type: "model_intent", data: {} },
    ],
  };
  expect(
    readConversationRecord({ ...record, runtime }, record.id).runtime,
  ).toEqual(runtime);
  expect(() =>
    readConversationRecord(
      {
        ...record,
        runtime: {
          ...runtime,
          events: [
            ...runtime.events,
            { ...runtime.events[0], id: "out-of-order" },
          ],
        },
      },
      record.id,
    ),
  ).toThrow("versionInvalid");
  expect(() =>
    readConversationRecord(
      {
        ...record,
        runtime: {
          ...runtime,
          events: [...runtime.events, { ...runtime.events[2], sequence: 3 }],
        },
      },
      record.id,
    ),
  ).toThrow("versionInvalid");
});
