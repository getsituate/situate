import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventInput, Context } from "./contract";
import type { ConversationRecord } from "../ai/conversation-record";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as { onmessage: (frame: unknown) => void }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class {
    onmessage = (_frame: unknown) => {};
    constructor() {
      native.channels.push(this);
    }
  },
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let events: EventInput[];
let feature: (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  events = [];
  native.channels.length = 0;
  native.invoke.mockReset();
  feature = async () => ({ status: "ok" });
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "diagnostics_register") return { producer_id: id };
    if (command === "diagnostics_emit") {
      expect(ArrayBuffer.isView(args)).toBe(true);
      expect(Object.prototype.toString.call(args)).toBe("[object Uint8Array]");
      const batch = JSON.parse(new TextDecoder().decode(args)) as {
        events: EventInput[];
      };
      events.push(...batch.events);
      return { accepted: batch.events.length, dropped: 0 };
    }
    if (command === "diagnostics_release" || command === "ai_conversation_ack")
      return;
    return feature(command, args);
  });
});
afterEach(() => {
  vi.useRealTimers();
});
async function activated() {
  const diagnostics = await import("./index");
  diagnostics.startDiagnostics();
  diagnostics.retainDiagnostics(["PRIVATE_WORKSPACE_HANDLE"]);
  return diagnostics;
}

it("correlates OpenAI sign-in with its action without recording connection details", async () => {
  const diagnostics = await activated();
  const { startOpenAiLogin } = await import("../ai/api");
  let context: Context | undefined;
  feature = async (command, args) => {
    expect(command).toBe("ai_openai_start");
    expect(args.connectionId).toBe("PRIVATE_CONNECTION");
    expect(args.label).toBe("PRIVATE_LABEL");
    context = args.diagnostic as Context;
    return "PRIVATE_LOGIN_ID";
  };
  await expect(
    startOpenAiLogin(
      "PRIVATE_WORKSPACE_HANDLE",
      "PRIVATE_CONNECTION",
      "PRIVATE_LABEL",
    ),
  ).resolves.toBe("PRIVATE_LOGIN_ID");
  await vi.advanceTimersByTimeAsync(1500);
  const action = events.find(
    (event) =>
      event.event === "ui.action" && event.attributes.action === "connect",
  );
  expect(action).toBeDefined();
  expect(context?.trace_id).toBe(action?.context?.trace_id);
  expect(context?.span_id).toBe(action?.context?.span_id);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_");
  diagnostics.stopDiagnostics();
});

it("retains starts while registering and passes separate immutable file context without payload leakage", async () => {
  const diagnostics = await activated();
  const { filesRequest } = await import("../files/api");
  const parent = diagnostics
    .diagnosticsFor("PRIVATE_WORKSPACE_HANDLE")
    .action("save", "button", "editor")!;
  const calls: Context[] = [];
  feature = async (command, args) => {
    expect(command).toBe("files_request");
    expect(args.request).not.toHaveProperty("diagnostic");
    calls.push(args.diagnostic as Context);
    return { status: "cancelled" };
  };
  await Promise.all([
    filesRequest(
      {
        workspaceId: "PRIVATE_WORKSPACE_HANDLE",
        operation: "export",
        path: "PRIVATE_PATH",
        text: "PRIVATE_CONTENT",
      },
      parent,
    ),
    filesRequest({
      workspaceId: "PRIVATE_WORKSPACE_HANDLE",
      operation: "export",
      path: "PRIVATE_PATH",
      text: "PRIVATE_CONTENT",
    }),
  ]);
  expect(calls[0]?.parent_span_id).toBe(parent.span_id);
  expect(calls[0]?.trace_id).not.toBe(calls[1]?.trace_id);
  expect(Object.isFrozen(calls[0])).toBe(true);
  await vi.advanceTimersByTimeAsync(1500);
  const outcomes = events.filter(
    (event) => event.event === "operation.finished",
  );
  expect(outcomes).toHaveLength(2);
  expect(
    outcomes.every((event) => event.attributes.outcome === "cancelled"),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_");
  diagnostics.stopDiagnostics();
});

it("allows file work and shutdown to finish with a permanently pending diagnostics registration", async () => {
  const diagnostics = await activated();
  native.invoke.mockImplementation(async (command) => {
    if (command === "diagnostics_register") return new Promise(() => {});
    return { status: "ok" };
  });
  await vi.advanceTimersByTimeAsync(250);
  const { filesRequest } = await import("../files/api");
  await expect(
    filesRequest({
      workspaceId: "PRIVATE_WORKSPACE_HANDLE",
      operation: "mkdir",
      path: "PRIVATE_PATH",
    }),
  ).resolves.toEqual({ status: "ok" });
  expect(() => diagnostics.stopDiagnostics()).not.toThrow();
  await vi.advanceTimersByTimeAsync(10000);
  expect(
    native.invoke.mock.calls.filter(([command]) =>
      command.startsWith("diagnostics_"),
    ),
  ).toHaveLength(1);
});

it("native cancellation waits for owner cleanup without creating frontend model spans or leaking projected content", async () => {
  const diagnostics = await activated();
  const { NativeConversation } = await import("../ai/native-conversation");
  const snapshot = {
    version: 1,
    generation: "PRIVATE_SESSION",
    position: 0,
    record: {
      version: 2,
      id: "private-conversation",
      title: "",
      revision: 0,
      messages: [],
      draft: "PRIVATE_PROMPT",
    },
    phase: "running",
    error: null,
    taskActive: true,
  };
  let finishNative!: () => void;
  feature = async (command) => {
    if (command === "ai_conversation_subscribe") return snapshot;
    if (command === "ai_conversation_action")
      return new Promise((resolve) => {
        finishNative = () =>
          resolve({
            ...snapshot,
            position: 2,
            phase: "interrupted",
            taskActive: false,
          });
      });
    throw new Error("Unexpected native command");
  };
  const published: unknown[] = [];
  const owner = new NativeConversation(
    "PRIVATE_WORKSPACE_HANDLE",
    "private-conversation",
    (snapshot) => published.push(snapshot),
    () => {},
  );
  await owner.refresh();
  let settled = false;
  const cancellation = owner
    .action(
      { version: 1, type: "cancel", runId: "private-run" },
      "private-cancel",
    )
    .then(() => {
      settled = true;
    });
  native.channels[0].onmessage({
    version: 1,
    subscription: "fixture-subscription",
    generation: "PRIVATE_SESSION",
    position: 1,
    type: "progress",
    activityComment: "PRIVATE_ACTIVITY",
  });
  await vi.advanceTimersByTimeAsync(1500);
  expect(settled).toBe(false);
  expect(owner.snapshot?.taskActive).toBe(true);
  expect(events.filter((event) => event.category === "model")).toEqual([]);
  finishNative();
  await cancellation;
  expect(owner.snapshot?.taskActive).toBe(false);
  expect(published).toHaveLength(3);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_");
  expect(
    native.invoke.mock.calls.filter(
      ([command]) =>
        command === "ai_request" ||
        command === "ai_begin" ||
        command === "ai_end",
    ),
  ).toEqual([]);
  owner.dispose();
  diagnostics.stopDiagnostics();
});

it("a late cancellation rejection cannot reclassify a native timeout or put private errors into frontend diagnostics", async () => {
  const diagnostics = await activated();
  const { NativeConversation } = await import("../ai/native-conversation");
  const snapshot = {
    version: 1,
    generation: "PRIVATE_SESSION",
    position: 1,
    record: {
      version: 2,
      id: "private-conversation",
      title: "",
      revision: 1,
      messages: [],
      draft: "PRIVATE_PROMPT",
    },
    phase: "interrupted",
    error: "native.ai.response.idleTimeout",
    taskActive: false,
  };
  feature = async (command) => {
    if (command === "ai_conversation_subscribe") return snapshot;
    if (command === "ai_conversation_action") throw "native.ai.turn.inactive";
    throw new Error("Unexpected native command");
  };
  const rejected = vi.fn();
  const owner = new NativeConversation(
    "PRIVATE_WORKSPACE_HANDLE",
    "private-conversation",
    () => {},
    rejected,
  );
  await owner.refresh();
  await expect(
    owner.action({ version: 1, type: "cancel", runId: "private-run" }),
  ).rejects.toBe("native.ai.turn.inactive");
  await owner.refresh();
  expect(owner.snapshot?.error).toBe("native.ai.response.idleTimeout");
  expect(rejected).toHaveBeenCalledWith("native.ai.turn.inactive");
  await vi.advanceTimersByTimeAsync(1500);
  expect(events.filter((event) => event.category === "model")).toEqual([]);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_");
  owner.dispose();
  diagnostics.stopDiagnostics();
});

it("native tool projections preserve invocation identities and successful writes across cancellation without duplicate frontend tool spans", async () => {
  const diagnostics = await activated();
  const { workspaceChat, closeChats } = await import("../ai/chat");
  const record: ConversationRecord = {
    version: 2,
    id: "private-conversation",
    title: "",
    revision: 0,
    draft: "",
    messages: [
      {
        role: "assistant",
        timestamp: 1,
        usage: null,
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: "PRIVATE_CALL_A",
            name: "write",
            arguments: { path: "PRIVATE_PATH", text: "PRIVATE_TEXT" },
          },
          {
            type: "toolCall",
            id: "PRIVATE_CALL_B",
            name: "write",
            arguments: { path: "PRIVATE_PATH_B", text: "PRIVATE_TEXT_B" },
          },
        ],
      },
    ],
    runtime: {
      draftAttachments: [],
      pending: [],
      runs: [{ id: "run", state: "running", startedAt: 1, usage: [] }],
      events: [
        {
          id: "intent-a",
          runId: "run",
          sequence: 1,
          type: "tool_intent",
          data: {
            toolCallId: "PRIVATE_CALL_A",
            name: "write",
            args: { path: "PRIVATE_PATH" },
            messageIndex: 0,
          },
        },
        {
          id: "intent-b",
          runId: "run",
          sequence: 2,
          type: "tool_intent",
          data: {
            toolCallId: "PRIVATE_CALL_B",
            name: "write",
            args: { path: "PRIVATE_PATH_B" },
            messageIndex: 0,
          },
        },
      ],
    },
  };
  let finishCancel!: (value: unknown) => void;
  feature = async (command) => {
    if (command === "ai_status")
      return {
        available: true,
        config: { provider: "custom", endpoint: "https://example.invalid" },
        selectedModel: "fixture",
        modelError: null,
        reason: null,
      };
    if (command === "ai_conversation_subscribe")
      return {
        version: 1,
        generation: "PRIVATE_SESSION",
        position: 0,
        record,
        phase: "running",
        error: null,
        taskActive: true,
        actionId: "run",
      };
    if (command === "ai_conversation_action")
      return new Promise((resolve) => {
        finishCancel = resolve;
      });
    throw new Error("Unexpected native command");
  };
  const chat = workspaceChat(
    "PRIVATE_WORKSPACE_HANDLE",
    "private-conversation",
  );
  await chat.refresh();
  chat.abort();
  await vi.advanceTimersByTimeAsync(0);
  const observed = structuredClone(record);
  observed.messages.push(
    {
      role: "toolResult",
      toolCallId: "PRIVATE_CALL_A",
      toolName: "write",
      content: [{ type: "text", text: "Saved" }],
      details: { path: "PRIVATE_PATH" },
      isError: false,
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "PRIVATE_CALL_B",
      toolName: "write",
      content: [{ type: "text", text: "Failed" }],
      details: { error: "PRIVATE_ERROR" },
      isError: true,
      timestamp: 2,
    },
  );
  observed.runtime!.runs[0].state = "interrupted";
  observed.runtime!.events.push(
    {
      id: "cancel",
      runId: "run",
      sequence: 3,
      type: "cancellation_requested",
      data: {},
    },
    {
      id: "end-b",
      runId: "run",
      sequence: 4,
      type: "tool_execution_end",
      data: {
        toolCallId: "PRIVATE_CALL_B",
        isError: true,
        result: { content: [], details: { error: "PRIVATE_ERROR" } },
      },
    },
    {
      id: "end-a",
      runId: "run",
      sequence: 5,
      type: "tool_execution_end",
      data: {
        toolCallId: "PRIVATE_CALL_A",
        isError: false,
        result: { content: [], details: { path: "PRIVATE_PATH" } },
      },
    },
  );
  const terminal = {
    version: 1,
    generation: "PRIVATE_SESSION",
    position: 1,
    record: observed,
    phase: "interrupted",
    error: null,
    taskActive: false,
    actionId: "run",
  };
  native.channels[0].onmessage({
    version: 1,
    generation: "PRIVATE_SESSION",
    position: 1,
    subscription: "fixture-subscription",
    type: "snapshot",
    snapshot: terminal,
  });
  finishCancel(terminal);
  await vi.advanceTimersByTimeAsync(1500);
  expect(
    chat.state.toolActivity.map(({ id, state }) => ({ id, state })),
  ).toEqual([
    { id: "PRIVATE_CALL_A", state: "completed" },
    { id: "PRIVATE_CALL_B", state: "error" },
  ]);
  expect(events.filter((event) => event.category === "tool")).toEqual([]);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_");
  closeChats([]);
  diagnostics.stopDiagnostics();
});
