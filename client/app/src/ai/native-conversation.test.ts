import { beforeEach, expect, test, vi } from "vitest";
import {
  NativeConversation,
  readSnapshot,
  type ConversationSnapshot,
  type ConversationUpdate,
} from "./native-conversation";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  ack: vi.fn().mockResolvedValue(undefined),
  channels: [] as { onmessage: (event: unknown) => void }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) =>
    command === "ai_conversation_ack"
      ? mock.ack(command, args)
      : mock.invoke(command, args),
  Channel: class {
    onmessage = (_event: unknown) => {};
    constructor() {
      mock.channels.push(this);
    }
  },
}));
function snapshot(position = 0, generation = "owner"): ConversationSnapshot {
  return {
    version: 1,
    generation,
    position,
    record: {
      version: 2,
      id: "chat",
      title: "Chat",
      revision: position,
      messages: [],
      draft: "Draft",
    },
    phase: "idle",
    error: null,
    taskActive: false,
  };
}
function update(value: ConversationSnapshot): ConversationUpdate {
  return {
    version: 1,
    subscription: "fixture-subscription",
    generation: value.generation,
    position: value.position,
    type: "snapshot",
    snapshot: value,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.channels.length = 0;
  mock.invoke.mockResolvedValue(snapshot());
});
function client() {
  const publish = vi.fn(),
    failed = vi.fn();
  return {
    client: new NativeConversation("scope", "chat", publish, failed),
    publish,
    failed,
  };
}
test.each([
  { messageOffset: -1 },
  { eventOffset: 0.5 },
  { selectedEntryId: 7 },
  { historyBefore: "" },
  { messageEntryIds: ["missing-message"] },
  { hasHistory: "yes" },
])("snapshot rejects invalid paged transcript coordinates %j", (fields) => {
  expect(() => readSnapshot({ ...snapshot(), ...fields }, "chat")).toThrow(
    "native.ai.conversation.versionInvalid",
  );
});

test("failed persistence replies and subscription updates retain outcomes without incomplete durable IDs", async () => {
  const retained = snapshot();
  retained.phase = "persistenceFailed";
  retained.error = "native.ai.conversation.saveFailed";
  retained.record.messages = [
    { role: "user", content: "Request", timestamp: 1 },
    {
      role: "toolResult",
      toolCallId: "unsaved",
      toolName: "read",
      content: [{ type: "text", text: "Retained outcome" }],
      isError: false,
      timestamp: 2,
    },
  ];
  expect(readSnapshot(retained, "chat").record.messages).toEqual(
    retained.record.messages,
  );
  expect(() =>
    readSnapshot({ ...retained, messageEntryIds: ["input"] }, "chat"),
  ).toThrow("native.ai.conversation.versionInvalid");
  mock.invoke.mockResolvedValueOnce(retained);
  const { client: owner } = client();
  await owner.refresh();
  expect(owner.snapshot?.record.messages).toEqual(retained.record.messages);
  const deferred = {
    ...retained,
    position: 1,
    record: { ...retained.record, messages: [...retained.record.messages] },
  };
  deferred.record.messages.push({
    role: "toolResult",
    toolCallId: "later",
    toolName: "read",
    content: [{ type: "text", text: "Later observed outcome" }],
    isError: false,
    timestamp: 3,
  });
  mock.channels[0].onmessage(update(deferred));
  expect(owner.snapshot?.record.messages).toEqual(deferred.record.messages);
  const reply = { ...deferred, position: 2 };
  mock.invoke.mockResolvedValueOnce(reply);
  await owner.action({ version: 1, type: "retryPersistence" });
  expect(owner.snapshot?.record.messages).toEqual(deferred.record.messages);
  expect(owner.snapshot?.phase).toBe("persistenceFailed");
  expect(owner.snapshot?.messageEntryIds).toBeUndefined();
});

test("attachment applies the atomic snapshot before buffered updates without a read/subscribe gap", async () => {
  const attach = deferred<ConversationSnapshot>();
  mock.invoke.mockReturnValueOnce(attach.promise);
  const { client: owner, publish } = client();
  const ready = owner.refresh();
  mock.channels[0].onmessage(update(snapshot(1)));
  attach.resolve(snapshot(0));
  await ready;
  expect(publish.mock.calls.map(([snapshot]) => snapshot.position)).toEqual([
    0, 1,
  ]);
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith(
    "ai_conversation_subscribe",
    { scope: "scope", conversation: "chat", channel: mock.channels[0] },
  );
});
test.each(["gap", "overflow", "generation"])(
  "%s obtains a fresh atomic attachment without submitting or cancelling",
  async (kind) => {
    const { client: owner } = client();
    await owner.refresh();
    mock.invoke.mockResolvedValueOnce(snapshot(9, "replacement"));
    mock.channels[0].onmessage(
      kind === "overflow"
        ? {
            version: 1,
            subscription: "fixture-subscription",
            generation: "owner",
            position: 1,
            type: "overflow",
          }
        : update(
            snapshot(
              kind === "gap" ? 3 : 1,
              kind === "generation" ? "replacement" : "owner",
            ),
          ),
    );
    await vi.waitFor(() =>
      expect(owner.snapshot?.generation).toBe("replacement"),
    );
    expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual([
      "ai_conversation_subscribe",
      "ai_conversation_subscribe",
    ]);
    mock.channels[0].onmessage(update(snapshot(20)));
    expect(owner.snapshot?.generation).toBe("replacement");
  },
);
test("duplicate and older updates cannot regress a newer full action acknowledgement", async () => {
  const { client: owner, publish } = client();
  await owner.refresh();
  mock.invoke.mockResolvedValueOnce(snapshot(4));
  await owner.action(
    { version: 1, type: "renameTitle", expected: "Chat", title: "Renamed" },
    "rename",
  );
  mock.channels[0].onmessage(update(snapshot(1)));
  mock.channels[0].onmessage(update(snapshot(4)));
  expect(publish).toHaveBeenCalledTimes(2);
  expect(owner.snapshot?.position).toBe(4);
  expect(mock.invoke).toHaveBeenLastCalledWith("ai_conversation_action", {
    scope: "scope",
    conversation: "chat",
    generation: "owner",
    actionId: "rename",
    action: {
      version: 1,
      type: "renameTitle",
      expected: "Chat",
      title: "Renamed",
    },
  });
});
test("lost action acknowledgements retain the same identity for explicit retry, never on refresh", async () => {
  const { client: owner } = client();
  await owner.refresh();
  mock.invoke
    .mockRejectedValueOnce(new Error("lost acknowledgement"))
    .mockResolvedValue(snapshot(2));
  await expect(
    owner.action({ version: 1, type: "recall" }, "recall-once"),
  ).rejects.toThrow("lost acknowledgement");
  await owner.refresh();
  expect(owner.hasUncertainAction).toBe(true);
  expect(
    mock.invoke.mock.calls.filter(
      ([command]) => command === "ai_conversation_action",
    ),
  ).toHaveLength(1);
  await owner.retry();
  const actions = mock.invoke.mock.calls.filter(
    ([command]) => command === "ai_conversation_action",
  );
  expect(actions[1][1]).toEqual(actions[0][1]);
  expect(owner.hasUncertainAction).toBe(false);
});
test("progress projects partial text and comments without changing durable messages", async () => {
  const { client: owner } = client();
  await owner.refresh();
  mock.channels[0].onmessage({
    version: 1,
    subscription: "fixture-subscription",
    generation: "owner",
    position: 1,
    type: "progress",
    activityComment: "Reading notes",
  });
  expect(owner.snapshot).toMatchObject({
    activityComment: "Reading notes",
  });
  expect(owner.snapshot?.record.messages).toEqual([]);
  mock.channels[0].onmessage({
    version: 1,
    subscription: "fixture-subscription",
    generation: "owner",
    position: 2,
    type: "progress",
    activityComment: "",
    partialMessage: null,
  });
  expect(owner.snapshot).toMatchObject({
    activityComment: "",
    partialMessage: null,
  });
});
test("completion waits for native task and question cleanup, not a local response", async () => {
  const running = {
    ...snapshot(),
    taskActive: true,
    phase: "running" as const,
  };
  mock.invoke.mockResolvedValueOnce(running);
  const { client: owner } = client();
  await owner.refresh();
  let settled = false;
  const completion = owner.settled().then(() => {
    settled = true;
  });
  mock.channels[0].onmessage(
    update({ ...snapshot(1), taskActive: false, questionBusy: true }),
  );
  await Promise.resolve();
  expect(settled).toBe(false);
  mock.channels[0].onmessage(update(snapshot(2)));
  await completion;
  expect(settled).toBe(true);
});
test("detaching ignores late callbacks and does not cancel native work", async () => {
  const { client: owner, publish } = client();
  await owner.refresh();
  owner.dispose();
  mock.channels[0].onmessage(update(snapshot(1)));
  expect(publish).toHaveBeenCalledOnce();
  expect(mock.invoke).toHaveBeenCalledOnce();
  await expect(owner.settled()).rejects.toThrow("workspaceUnavailable");
});
test.each([
  { ...snapshot(), version: 2 },
  { ...snapshot(), position: -1 },
  { ...snapshot(), record: { ...snapshot().record, version: 1 } },
  { ...snapshot(), record: { ...snapshot().record, id: "other" } },
])("invalid native envelopes fail closed", (value) => {
  expect(() => readSnapshot(value, "chat")).toThrow("versionInvalid");
});
test("a delayed reattachment cannot regress a newer action acknowledgement or settle running work early", async () => {
  const { client: owner, publish } = client();
  await owner.refresh();
  const attachment = deferred<ConversationSnapshot>();
  mock.invoke.mockReturnValueOnce(attachment.promise);
  const refresh = owner.refresh();
  mock.invoke.mockResolvedValueOnce({
    ...snapshot(2),
    phase: "running",
    taskActive: true,
  });
  await owner.action({
    version: 1,
    type: "submit",
    input: { text: "Run", attachments: [], references: [] },
    timestamp: 1,
  });
  let settled = false;
  const completion = owner.settled().then(() => {
    settled = true;
  });
  attachment.resolve(snapshot(1));
  await refresh;
  expect(owner.snapshot?.position).toBe(2);
  expect(settled).toBe(false);
  expect(publish.mock.calls.map(([value]) => value.position)).toEqual([0, 2]);
  mock.channels[1].onmessage(update(snapshot(3)));
  await completion;
});
test("explicit uncertain-action retries remain bound to the original generation after reattachment", async () => {
  const { client: owner } = client();
  await owner.refresh();
  mock.invoke
    .mockRejectedValueOnce(new Error("lost acknowledgement"))
    .mockResolvedValue(snapshot(4, "replacement"));
  await expect(
    owner.action({ version: 1, type: "recall" }, "identity"),
  ).rejects.toThrow();
  await owner.refresh();
  await owner.retry();
  const calls = mock.invoke.mock.calls.filter(
    ([command]) => command === "ai_conversation_action",
  );
  expect(calls[1][1]).toMatchObject({
    generation: "owner",
    actionId: "identity",
  });
});
test("explicit domain rejection is reported but never retained as an uncertain effect", async () => {
  const { client: owner, failed } = client();
  await owner.refresh();
  mock.invoke
    .mockRejectedValueOnce("chatQuestion.stale")
    .mockResolvedValue(snapshot(1));
  await expect(
    owner.action({ version: 1, type: "supersedeQuestion", questionId: "old" }),
  ).rejects.toBe("chatQuestion.stale");
  expect(owner.hasUncertainAction).toBe(false);
  expect(failed).toHaveBeenCalledWith("chatQuestion.stale");
});
test("progress fields cannot replace a durable record", async () => {
  const { client: owner } = client();
  await owner.refresh();
  mock.channels[0].onmessage({
    version: 1,
    subscription: "fixture-subscription",
    generation: "owner",
    position: 1,
    type: "progress",
    activityComment: "Working",
    record: { ...snapshot().record, draft: "Unexpected replacement" },
  });
  expect(owner.snapshot?.record.draft).toBe("Draft");
  expect(owner.snapshot?.activityComment).toBe("Working");
});
test("an uncertain action retains the actual captured payload when the caller edits its input afterward", async () => {
  const { client: owner } = client();
  await owner.refresh();
  const input = { text: "Original", attachments: [], references: [] };
  mock.invoke
    .mockRejectedValueOnce(new Error("lost acknowledgement"))
    .mockResolvedValue(snapshot(2));
  await expect(
    owner.action(
      { version: 1, type: "submit", input, timestamp: 1 },
      "submission",
    ),
  ).rejects.toThrow();
  input.text = "Changed";
  await owner.refresh();
  await owner.retry();
  const calls = mock.invoke.mock.calls.filter(
    ([command]) => command === "ai_conversation_action",
  );
  expect(calls[0][1].action.input.text).toBe("Original");
  expect(calls[1][1].action.input.text).toBe("Original");
  expect(calls[1][1].actionId).toBe("submission");
});
test("an unavailable plugin fact is a rejected notification, not an uncertain write", async () => {
  const { client: owner } = client();
  await owner.refresh();
  mock.invoke
    .mockRejectedValueOnce("native.ai.tool.unavailable")
    .mockResolvedValue(snapshot(1));
  await expect(
    owner.action({
      version: 1,
      type: "notifyPluginAvailable",
      pluginId: "removed",
    }),
  ).rejects.toBe("native.ai.tool.unavailable");
  expect(owner.hasUncertainAction).toBe(false);
});
test("actions attach before mutation and always bind a native generation", async () => {
  const { client: owner } = client();
  await owner.action({ version: 1, type: "recall" }, "recall");
  expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual([
    "ai_conversation_subscribe",
    "ai_conversation_action",
  ]);
  expect(mock.invoke.mock.calls[1][1].generation).toBe("owner");
});
test("checkpoint persistence is retried before acknowledging an uncertain accepted action", async () => {
  const { client: owner } = client();
  let lost = false;
  const failed = {
    ...snapshot(1),
    phase: "persistenceFailed" as const,
    error: "native.ai.conversation.saveFailed",
  };
  const recovered = snapshot(2);
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "ai_conversation_subscribe")
      return lost ? failed : snapshot();
    if (args.action.type === "submit" && !lost) {
      lost = true;
      throw new Error("lost acknowledgement");
    }
    return recovered;
  });
  await owner.refresh();
  await expect(
    owner.action(
      {
        version: 1,
        type: "submit",
        input: { text: "Original", attachments: [], references: [] },
        timestamp: 1,
      },
      "accepted",
    ),
  ).rejects.toThrow();
  await vi.waitFor(() =>
    expect(owner.snapshot?.phase).toBe("persistenceFailed"),
  );
  await owner.retry();
  const calls = mock.invoke.mock.calls.filter(
    ([command]) => command === "ai_conversation_action",
  );
  expect(calls.map(([, args]) => args.action.type)).toEqual([
    "submit",
    "retryPersistence",
    "submit",
  ]);
  expect(calls[0][1].actionId).toBe("accepted");
  expect(calls[2][1].actionId).toBe("accepted");
  expect(owner.hasUncertainAction).toBe(false);
});
test("delivery acknowledgements cover buffered and overflow events, never actions or execution retries", async () => {
  const attachment = deferred<ConversationSnapshot>();
  mock.invoke.mockReturnValueOnce(attachment.promise);
  const { client: owner, publish, failed } = client();
  const ready = owner.refresh();
  mock.channels[0].onmessage(update(snapshot(1)));
  expect(publish).not.toHaveBeenCalled();
  expect(mock.ack).toHaveBeenCalledExactlyOnceWith("ai_conversation_ack", {
    scope: "scope",
    conversation: "chat",
    subscription: "fixture-subscription",
    position: 1,
  });
  attachment.resolve(snapshot());
  await ready;
  mock.invoke.mockResolvedValueOnce(snapshot(2));
  await owner.action({
    version: 1,
    type: "renameTitle",
    expected: "Chat",
    title: "Renamed",
  });
  expect(mock.ack).toHaveBeenCalledOnce();
  mock.ack.mockRejectedValueOnce(new Error("acknowledgement lost"));
  mock.channels[0].onmessage({
    version: 1,
    generation: "owner",
    subscription: "fixture-subscription",
    position: 3,
    type: "overflow",
  });
  await vi.waitFor(() =>
    expect(
      mock.invoke.mock.calls.filter(
        ([command]) => command === "ai_conversation_subscribe",
      ),
    ).toHaveLength(2),
  );
  expect(mock.ack).toHaveBeenLastCalledWith("ai_conversation_ack", {
    scope: "scope",
    conversation: "chat",
    subscription: "fixture-subscription",
    position: 3,
  });
  expect(failed).not.toHaveBeenCalled();
  expect(
    mock.invoke.mock.calls.filter(
      ([command]) => command === "ai_conversation_action",
    ),
  ).toHaveLength(1);
});
