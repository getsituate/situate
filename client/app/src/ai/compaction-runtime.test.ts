import { expect, test } from "vitest";
import {
  compactContext,
  contextNeedsCompaction,
  compactionChunks,
  planCompaction,
} from "./compaction-runtime";
import type { AgentMessage } from "./contracts";
test("checkpoint replaces only provider context while retaining the original completed history", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: "Original request", timestamp: 1 },
    {
      role: "toolResult",
      toolCallId: "write-1",
      toolName: "write",
      content: [{ type: "text", text: "written" }],
      isError: false,
      timestamp: 2,
    },
    { role: "user", content: "Continue", timestamp: 3 },
  ];
  const context = compactContext(messages, {
    sourceCount: 2,
    summary: "File was written. Do not write again.",
    runId: "run",
  });
  expect(context).toHaveLength(2);
  expect(context[0]?.content).toContain("File was written");
  expect(context[1]).toEqual(messages[2]);
  expect(messages).toHaveLength(3);
  expect(messages[1]?.role).toBe("toolResult");
});
test("compaction budget follows selected model and chunks do not include binary payload", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: "x".repeat(50000), timestamp: 1 },
  ];
  expect(contextNeedsCompaction(messages, 8192, 2048)).toBe(true);
  expect(contextNeedsCompaction(messages, 200000, 8192)).toBe(false);
  const chunks = compactionChunks(messages, 8192);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length <= 12288)).toBe(true);
});

test("compaction source retains native response identity and accounting", () => {
  const messages: AgentMessage[] = [
    {
      role: "assistant",
      responseId: "opaque-response",
      content: [{ type: "text", text: "The note was updated." }],
      timestamp: 1,
      durationMs: 50,
      stopReason: "stop",
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  ];
  const source = JSON.parse(compactionChunks(messages, 8192).join(""));
  for (const key of [
    "api",
    "provider",
    "model",
    "responseModel",
    "thinkingLevel",
    "providerThinkingLevel",
  ])
    expect(source[0]).not.toHaveProperty(key);
  expect(source[0]).toMatchObject({
    content: [{ type: "text", text: "The note was updated." }],
    responseId: "opaque-response",
    durationMs: 50,
  });
  expect(source[0].usage).toEqual(
    messages[0]!.role === "assistant" ? messages[0]!.usage : null,
  );
  expect(messages[0]).not.toHaveProperty("model");
});

function call(...ids: string[]): Extract<AgentMessage, { role: "assistant" }> {
  return {
    role: "assistant",
    content: ids.map((id) => ({
      type: "toolCall",
      id,
      name: "read",
      arguments: { path: "notes.md" },
    })),
    stopReason: "toolUse",
    timestamp: 1,
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
function observation(
  id: string,
  name: string,
  text: string,
  isError = false,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError,
    timestamp: 2,
  };
}
const largeBudget = { contextWindow: 200000, maxTokens: 8192 };

test("masking leaves receipts, failures and recent observations intact without changing stored messages", () => {
  const source: AgentMessage[] = [
    { role: "user", content: "Build the inbox.", timestamp: 0 },
    call("old"),
    observation("old", "read", "Earlier file contents. ".repeat(1000)),
    call("write"),
    observation(
      "write",
      "write",
      JSON.stringify({
        revision: "revision-42",
        outcome: "written",
        text: "Saved content. ".repeat(200),
      }),
    ),
    call("plugin"),
    observation(
      "plugin",
      "custom_lookup",
      "Returned source state. ".repeat(200),
    ),
    call("failed"),
    observation("failed", "read", "Access failed. ".repeat(200), true),
    call("current"),
    observation("current", "read", "Current working contents. ".repeat(2000)),
  ];
  const original = JSON.stringify(source);
  const plan = planCompaction(source, undefined, largeBudget);
  expect(plan.sourceCount).toBeUndefined();
  expect(plan.messages[2]).toMatchObject({
    role: "toolResult",
    toolCallId: "old",
    isError: false,
  });
  expect(JSON.stringify(plan.messages[2])).not.toContain(
    "Earlier file contents.",
  );
  for (const index of [4, 6, 8, 9, 10])
    expect(plan.messages[index]).toBe(source[index]);
  expect(JSON.stringify(source)).toBe(original);
});

test("offline development references can be reread without retaining oversized provider context", () => {
  const source = [
    call("reference"),
    observation(
      "reference",
      "read_plugin_development",
      "Offline reference. ".repeat(1000),
    ),
    call("recent"),
    observation("recent", "read", "Current source. ".repeat(2000)),
  ];
  const original = JSON.stringify(source);
  const plan = planCompaction(source, undefined, largeBudget);
  expect(JSON.stringify(plan.messages[1])).not.toContain("Offline reference.");
  expect(plan.messages[3]).toBe(source[3]);
  expect(JSON.stringify(source)).toBe(original);
});

test("old screenshots are removed from provider context without losing their check receipts", () => {
  const image = {
    type: "image" as const,
    mimeType: "image/png",
    data: "YWJj".repeat(1000),
  };
  const result: AgentMessage = {
    role: "toolResult",
    toolCallId: "check",
    toolName: "check_plugin_changes",
    isError: false,
    timestamp: 1,
    content: [
      { type: "text", text: '{"checkId":"receipt-42","passed":true}' },
      image,
    ],
  };
  const source = [
    call("check"),
    result,
    call("recent"),
    observation("recent", "read", "Current file contents. ".repeat(2000)),
  ];
  const plan = planCompaction(source, undefined, largeBudget);
  expect(plan.messages[1]).toMatchObject({
    role: "toolResult",
    content: [
      { type: "text", text: '{"checkId":"receipt-42","passed":true}' },
      { type: "text", text: expect.stringContaining("original result") },
    ],
  });
  expect(JSON.stringify(plan.messages)).not.toContain(image.data);
  expect(result.content).toContain(image);
  expect(plan.messages[3]).toBe(source[3]);
});

test("image allowance does not depend on base64 length or durable reference size", () => {
  const image = (data: string): AgentMessage => ({
    role: "user",
    content: [{ type: "image", mimeType: "image/png", data }],
    timestamp: 1,
  });
  for (const data of ["YWJj", "YWJj".repeat(100000), "attachment:image-42"]) {
    expect(contextNeedsCompaction([image(data)], 20000, 2048)).toBe(false);
    expect(contextNeedsCompaction([image(data)], 8192, 2048)).toBe(true);
  }
});

test("recent context boundaries never separate parallel calls from their results", () => {
  const source: AgentMessage[] = [
    { role: "user", content: "Earlier request. ".repeat(600), timestamp: 0 },
    call("old"),
    observation("old", "read", "Earlier file. ".repeat(500)),
    {
      role: "user",
      content: "Continue with the exact current file.",
      timestamp: 3,
    },
    call("a", "b"),
    observation("a", "read", "First result."),
    observation("b", "read", "Current details. ".repeat(800)),
  ];
  const plan = planCompaction(source, undefined, {
    contextWindow: 8192,
    maxTokens: 512,
  });
  expect(plan.sourceCount).toBe(4);
  expect(plan.messages.slice(4)).toEqual(source.slice(4));
  const compacted = compactContext(source, {
    sourceCount: 4,
    summary: "Earlier work is recorded.",
    runId: "run",
  });
  expect(compacted[1]).toBe(source[3]);
  expect(compacted.slice(2)).toEqual(source.slice(4));
});

test("the active user request stays verbatim when earlier work within its turn is summarized", () => {
  const request: AgentMessage = {
    role: "user",
    content: "Keep the folder selection and never send invitations.",
    timestamp: 0,
  };
  const source = [
    request,
    call("old"),
    observation("old", "read", "Recorded state."),
    call("recent"),
    observation("recent", "read", "Current state."),
  ];
  const checkpoint = {
    sourceCount: 3,
    summary: "A folder was selected.",
    runId: "run",
  };
  const context = compactContext(source, checkpoint);
  expect(context[1]).toBe(request);
  expect(context.slice(2)).toEqual(source.slice(3));
  const continued = compactContext(
    [...source, { role: "user", content: "Continue", timestamp: 3 }],
    checkpoint,
  );
  expect(continued).not.toContain(request);
  expect(continued.at(-1)).toEqual({
    role: "user",
    content: "Continue",
    timestamp: 3,
  });
});

test.each(["system", "tools"])(
  "the compaction decision includes %s overhead",
  (overhead) => {
    const source: AgentMessage[] = [
      { role: "user", content: "Earlier context. ".repeat(500), timestamp: 0 },
      { role: "user", content: "Continue", timestamp: 1 },
    ];
    const budget = { contextWindow: 10000, maxTokens: 1000 };
    expect(
      planCompaction(source, undefined, budget).sourceCount,
    ).toBeUndefined();
    const extra =
      overhead === "system"
        ? {
            instructions: "Workspace policy. ".repeat(800),
          }
        : {
            tools: [
              {
                name: "read",
                description: "Tool contract. ".repeat(1000),
                parameters: { type: "object", properties: {} },
              },
            ],
          };
    expect(
      planCompaction(source, undefined, { ...budget, ...extra }).sourceCount,
    ).toBe(1);
  },
);

test("an unchanged summarized prefix is not summarized again", () => {
  const source: AgentMessage[] = [
    { role: "user", content: "Earlier context. ".repeat(500), timestamp: 0 },
    { role: "user", content: "Continue", timestamp: 1 },
  ];
  const checkpoint = {
    sourceCount: 1,
    summary: "Earlier work is recorded.",
    runId: "run",
  };
  const plan = planCompaction(source, checkpoint, {
    contextWindow: 10000,
    maxTokens: 1000,
    instructions: "Workspace policy. ".repeat(2000),
  });
  expect(plan.sourceCount).toBeUndefined();
  expect(plan.messages).toEqual(compactContext(source, checkpoint));
});

test("the only current user request is not redundantly summarized while it stays pinned", () => {
  const source: AgentMessage[] = [
    {
      role: "user",
      content: "Current instructions. ".repeat(500),
      timestamp: 0,
    },
    call("current"),
    observation("current", "read", "Working state. ".repeat(500)),
  ];
  const plan = planCompaction(source, undefined, {
    contextWindow: 8192,
    maxTokens: 512,
  });
  expect(plan.sourceCount).toBeUndefined();
  expect(plan.messages).toEqual(source);
});

test("summary fragments retain Unicode and ordinary data fields while excluding image bytes", () => {
  const source: AgentMessage[] = [
    { role: "user", content: "Notizen 🌱 日本語 ".repeat(2000), timestamp: 0 },
    {
      ...call("write"),
      content: [
        {
          type: "toolCall",
          id: "write",
          name: "write",
          arguments: { path: "notes.md", data: "Keep this exact text." },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "image",
      toolName: "read",
      isError: false,
      timestamp: 2,
      content: [
        { type: "image", mimeType: "image/png", data: "YWJj" },
        { type: "image", mimeType: "image/png", data: "attachment:frame-42" },
      ],
    },
  ];
  const chunks = compactionChunks(source, 8192);
  expect(chunks.length).toBeGreaterThan(1);
  expect(
    chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 12288),
  ).toBe(true);
  const restored = JSON.parse(chunks.join(""));
  expect(restored[0].content).toBe(source[0]!.content);
  expect(restored[1].content[0].arguments.data).toBe("Keep this exact text.");
  expect(restored[2].content[0].data).toBe("[image attachment]");
  expect(restored[2].content[1].data).toBe("attachment:frame-42");
});
