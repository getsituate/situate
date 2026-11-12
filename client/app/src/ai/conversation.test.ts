import { expect, test } from "vitest";
import { loadConversation, readPartialMessage } from "./conversation";
const usage = {
  input: null,
  output: 2,
  cacheRead: null,
  cacheWrite: null,
  totalTokens: null,
  cost: {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    total: null,
  },
};
const assistant = {
  role: "assistant",
  timestamp: 1,
  content: [
    {
      type: "thinking",
      thinking: "",
      redacted: true,
      thinkingSignature: "opaque",
    },
    { type: "text", text: "Ready", textSignature: "signature" },
    {
      type: "toolCall",
      id: "call",
      name: "read",
      arguments: { path: "note.md" },
      thoughtSignature: "opaque",
      namespace: "notes",
    },
  ],
  usage,
  stopReason: "toolUse",
  responseId: "response",
  durationMs: 10,
};
test("native content and continuation metadata survive JSON without model provenance", () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "image", mimeType: "image/png", data: "attachment:image" },
      ],
      timestamp: 0,
    },
    assistant,
    {
      role: "toolResult",
      toolCallId: "call",
      toolName: "read",
      content: [{ type: "text", text: "Read" }],
      details: { revision: "verified" },
      isError: false,
      timestamp: 2,
    },
  ];
  expect(loadConversation(JSON.parse(JSON.stringify(messages)))).toEqual(
    messages,
  );
});
test.each(["api", "provider", "model", "thinkingLevel", "errorMessage"])(
  "native history rejects execution-local %s",
  (field) => {
    expect(() =>
      loadConversation([{ ...assistant, [field]: "private" }]),
    ).toThrow("versionInvalid");
  },
);
test.each([NaN, -1, Infinity, "2", undefined])(
  "invalid supplied accounting is not treated as unknown (%s)",
  (input) => {
    expect(() =>
      loadConversation([{ ...assistant, usage: { ...usage, input } }]),
    ).toThrow();
  },
);
test.each([
  { ...assistant, stopReason: "unknown" },
  { ...assistant, stopReason: "pending" },
  { ...assistant, timestamp: -1 },
  { ...assistant, usage: {} },
  { role: "user", timestamp: 1, content: null },
  { role: "system", timestamp: 1, content: "Not portable" },
])("damaged native records fail closed", (message) => {
  expect(() => loadConversation([message])).toThrow("versionInvalid");
});
test.each([
  null,
  { ...usage, cost: null },
  { ...usage, input: 3, cost: { ...usage.cost, input: null } },
])(
  "whole and component accounting can be unknown without fabricated values",
  (accounting) => {
    const message = { ...assistant, usage: accounting };
    expect(loadConversation([message])).toEqual([message]);
  },
);
test("continuation and nested tool provenance survive native record validation", () => {
  const message = {
    ...assistant,
    continuation: {
      format: "openai-responses",
      data: { items: [{ id: "opaque", encrypted_content: "continuation" }] },
    },
  };
  const result = {
    role: "toolResult",
    toolCallId: "call",
    toolName: "check",
    content: [],
    details: { checked: true },
    structuredContent: { tests: ["passed"] },
    nestedCalls: {
      calls: [
        {
          id: "nested",
          name: "read",
          arguments: { path: "note.md" },
          status: "ok",
          durationMs: 1,
        },
      ],
      complete: true,
    },
    usage: null,
    isError: false,
    timestamp: 2,
  };
  const withBlocks = {
    ...message,
    content: message.content.map((block) => ({
      ...block,
      continuation: message.continuation,
    })),
  };
  expect(loadConversation([withBlocks, result])).toEqual([withBlocks, result]);
  expect(() =>
    loadConversation([{ ...withBlocks, continuationAllowed: true }]),
  ).toThrow();
  expect(() =>
    loadConversation([
      {
        ...message,
        content: [
          {
            type: "text",
            text: "Test",
            continuation: { format: "unknown", data: {} },
          },
        ],
      },
    ]),
  ).toThrow();
  expect(() =>
    loadConversation([
      {
        role: "user",
        timestamp: 1,
        content: [
          {
            type: "image",
            data: "",
            mimeType: "image/png",
            continuation: message.continuation,
          },
        ],
      },
    ]),
  ).toThrow();
  for (const continuation of [
    { format: "unknown", data: {} },
    { format: "openai-responses", data: "opaque" },
    { format: "openai-responses", data: {}, model: "private" },
  ])
    expect(() => loadConversation([{ ...assistant, continuation }])).toThrow();
  expect(() =>
    loadConversation([
      {
        ...result,
        nestedCalls: {
          ...result.nestedCalls,
          calls: [{ id: "nested", name: "read", status: "unknown" }],
        },
      },
    ]),
  ).toThrow();
});
test("pending content is accepted only as an assistant progress projection", () => {
  const pending = { ...assistant, usage: null, stopReason: "pending" };
  expect(readPartialMessage(pending)).toEqual(pending);
  expect(() => loadConversation([pending])).toThrow();
  expect(() =>
    readPartialMessage({
      role: "user",
      content: "Not assistant progress",
      timestamp: 1,
    }),
  ).toThrow();
});
