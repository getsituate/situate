import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import {
  workspaceChat,
  workspaceConversations,
  workspaceChatActivity,
  refreshWorkspaceChats,
  saveChatDrafts,
  abortWorkspaceChats,
  closeChats,
  discardUnsentChat,
} from "./chat";
import type {
  ConversationAction,
  ConversationSnapshot,
  ConversationInput,
} from "./native-conversation";
import type { ConversationRecord } from "./conversation-record";
import type { AssistantMessage } from "./contracts";
import { emptyRuntime } from "./queue-runtime";
import { workspaceAiSettings } from "./settings";
import { onboardingSession, retainOnboarding } from "../onboarding/session";
import { newOnboardingRecord } from "../onboarding/types";
import { setupQuestion } from "../onboarding/questions";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  dictation: vi.fn(),
  channels: [] as { onmessage: (value: unknown) => void }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  Channel: class {
    onmessage = (_value: unknown) => {};
    constructor() {
      mock.channels.push(this);
    }
  },
}));
vi.mock("../dictation/runtime", () => ({ ownsDictation: mock.dictation }));
const snapshots = new Map<string, ConversationSnapshot>();
const subscriptions = new Map<
  string,
  { onmessage: (value: unknown) => void }[]
>();
const actions = new Set<string>();
const selection = new Map<string, string | null>();
const status = {
  available: true,
  config: {
    provider: "custom",
    endpoint: "https://example.invalid",
    connectionId: "connection",
  },
  selectedModel: "chosen",
  modelError: null,
  reason: null,
};
const key = (scope: string, conversation: string) => `${scope}/${conversation}`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function ensure(scope = "scope", conversation = "chat") {
  const identity = key(scope, conversation);
  let value = snapshots.get(identity);
  if (!value) {
    value = {
      version: 1,
      generation: identity,
      position: 0,
      record: {
        version: 2,
        id: conversation,
        title: "Chat",
        revision: 0,
        messages: [],
        draft: "",
        runtime: emptyRuntime(),
      },
      phase: "idle",
      error: null,
      taskActive: false,
    };
    snapshots.set(identity, value);
  }
  return value;
}
function publish(value: ConversationSnapshot) {
  value.position++;
  value.record.revision++;
  for (const channel of subscriptions.get(value.generation) ?? [])
    channel.onmessage({
      version: 1,
      subscription: "fixture-subscription",
      generation: value.generation,
      position: value.position,
      type: "snapshot",
      snapshot: copy(value),
    });
}
function finish(scope = "scope", conversation = "chat", text = "Finished") {
  const snapshot = ensure(scope, conversation);
  const message: AssistantMessage = {
    role: "assistant",
    timestamp: 2,
    content: [{ type: "text", text }],
    usage: {
      input: null,
      output: 1,
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
    },
    stopReason: "stop",
  };
  snapshot.record.messages.push(message);
  snapshot.taskActive = false;
  snapshot.phase = "idle";
  const run = snapshot.record.runtime?.runs.at(-1);
  if (run) {
    run.state = "completed";
    run.endedAt = 2;
  }
  publish(snapshot);
}
function setDraft(record: ConversationRecord, input: ConversationInput) {
  record.draft = input.text;
  record.runtime ??= emptyRuntime();
  record.runtime.draftAttachments = input.attachments;
  record.runtime.draftReferences = input.references;
}
async function native(
  command: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const scope = args.scope as string,
    conversation = args.conversation as string;
  if (command === "ai_status" || command === "ai_preview_conversation_status")
    return {
      ...status,
      selectedModel:
        selection.get(key(scope, conversation)) ?? status.selectedModel,
    };
  if (
    command === "ai_select_conversation_model" ||
    command === "ai_select_conversation_thinking"
  ) {
    if (command.endsWith("model"))
      selection.set(key(scope, conversation), args.model as string | null);
    return { ...status, selectedModel: args.model ?? status.selectedModel };
  }
  if (command === "ai_conversations")
    return [...snapshots]
      .filter(([id]) => id.startsWith(`${scope}/`))
      .map(([, snapshot]) => ({
        id: snapshot.record.id,
        title: snapshot.record.title,
        revision: snapshot.record.revision,
      }));
  if (command === "ai_conversation_read") {
    if (
      Object.keys(args).some((key) => !["scope", "conversation"].includes(key))
    )
      throw new Error("Unexpected read argument");
    const existing = snapshots.get(key(scope, conversation));
    if (!existing) throw new Error("missing");
    return copy(existing.record);
  }
  if (command === "ai_create_conversation") {
    const value = ensure(scope, args.id as string);
    const initial = (args.initial ?? {}) as {
      draft?: string;
      attachments?: ConversationInput["attachments"];
      references?: ConversationInput["references"];
      development?: ConversationRecord["development"];
    };
    if (
      Object.keys(initial).some(
        (key) =>
          !["draft", "attachments", "references", "development"].includes(key),
      )
    )
      throw new Error("Unexpected initial conversation argument");
    Object.assign(value.record, {
      title: args.title,
      draft: initial.draft ?? "",
      ...(initial.development ? { development: initial.development } : {}),
      runtime: {
        ...emptyRuntime(),
        draftAttachments: initial.attachments ?? [],
        ...(initial.references?.length
          ? { draftReferences: initial.references }
          : {}),
      },
    });
    return copy(value.record);
  }
  if (command === "ai_attachment_put")
    return {
      id: "stored-attachment",
      name: args.name,
      size: (args.bytes as number[]).length,
      mimeType: args.mimeType,
    };
  if (command === "ai_conversation_ack") return;
  if (command === "ai_conversations_abort") {
    for (const [id, snapshot] of snapshots)
      if (id.startsWith(`${scope}/`)) {
        snapshot.taskActive = false;
        snapshot.questionBusy = false;
        snapshot.phase = "interrupted";
        for (const run of snapshot.record.runtime?.runs ?? [])
          if (run.state === "running") run.state = "interrupted";
        publish(snapshot);
      }
    return;
  }
  if (command === "ai_conversation_subscribe") {
    const value = ensure(scope, conversation);
    const channels = subscriptions.get(value.generation) ?? [];
    channels.push(args.channel as { onmessage: (value: unknown) => void });
    subscriptions.set(value.generation, channels);
    return copy(value);
  }
  if (command === "ai_conversation_action") {
    const value = ensure(scope, conversation),
      record = value.record,
      action = args.action as ConversationAction;
    if (actions.has(`${value.generation}/${args.actionId}`)) return copy(value);
    actions.add(`${value.generation}/${args.actionId}`);
    if (action.type === "draft") {
      expect(action.expected).toEqual({
        text: record.draft,
        attachments: record.runtime?.draftAttachments ?? [],
        references: record.runtime?.draftReferences ?? [],
      });
      setDraft(record, action.input);
    }
    if (action.type === "submit") {
      record.messages.push({
        role: "user",
        content: action.input.text,
        timestamp: action.timestamp,
      });
      record.runtime!.runs.push({
        id: args.actionId as string,
        state: "running",
        startedAt: action.timestamp,
        usage: [],
        references: action.input.references,
      });
      value.actionId = args.actionId as string;
      value.taskActive = true;
      value.phase = "running";
      if (
        JSON.stringify({
          text: record.draft,
          attachments: record.runtime?.draftAttachments ?? [],
          references: record.runtime?.draftReferences ?? [],
        }) === JSON.stringify(action.input)
      )
        setDraft(record, { text: "", attachments: [], references: [] });
    }
    if (action.type === "enqueue") {
      record.runtime!.pending.push({
        id: args.actionId as string,
        kind: action.kind,
        state: "pending",
        ...action.input,
        timestamp: action.timestamp,
      });
      setDraft(record, { text: "", attachments: [], references: [] });
    }
    if (action.type === "recall") {
      record.draft = record
        .runtime!.pending.map((input) => input.text)
        .concat(record.draft)
        .filter(Boolean)
        .join("\n\n");
      record.runtime!.pending = [];
    }
    if (action.type === "cancel") {
      value.taskActive = false;
      value.phase = "interrupted";
      for (const run of record.runtime!.runs)
        if (run.state === "running") run.state = "interrupted";
    }
    if (action.type === "renameTitle") record.title = action.title;
    if (action.type === "retryPersistence") {
      value.phase = "idle";
      value.error = null;
    }
    if (action.type === "presentQuestion")
      record.runtime!.events.push({
        id: action.question.id,
        runId: "questions",
        sequence: record.runtime!.events.length + 1,
        type: "question_presented",
        data: { ...action.question, timestamp: 1 },
      });
    if (action.type === "supersedeQuestion")
      record.runtime!.events.push({
        id: "superseded",
        runId: "questions",
        sequence: record.runtime!.events.length + 1,
        type: "question_superseded",
        data: { questionId: action.questionId },
      });
    publish(value);
    return copy(value);
  }
  throw new Error(`Unexpected command: ${command}`);
}
beforeEach(() => {
  closeChats([]);
  vi.clearAllMocks();
  snapshots.clear();
  subscriptions.clear();
  actions.clear();
  selection.clear();
  mock.channels.length = 0;
  mock.invoke.mockImplementation(native);
  mock.dictation.mockReturnValue(false);
  Object.assign(workspaceAiSettings("scope", "connection").state, {
    loading: false,
    saving: false,
    error: false,
  });
});
afterEach(() => {
  closeChats([]);
  retainOnboarding([]);
  vi.useRealTimers();
});
function actionCalls(type?: string) {
  return mock.invoke.mock.calls.filter(
    ([command, args]) =>
      command === "ai_conversation_action" &&
      (!type || args.action.type === type),
  );
}
async function ready(scope = "scope", conversation = "chat") {
  const chat = workspaceChat(scope, conversation);
  await chat.refresh();
  return chat;
}
async function started(task: Promise<void>) {
  await flushPromises();
  expect(actionCalls("submit").length).toBeGreaterThan(0);
  return { task };
}

test("send submits a captured action and renders native partial/final projections without frontend leases or saves", async () => {
  const chat = await ready();
  chat.state.draft = "Read my notes";
  const send = chat.send();
  expect(chat.state.running).toBe(true);
  await started(send);
  const snapshot = ensure();
  snapshot.partialMessage = {
    role: "assistant",
    timestamp: 2,
    content: [{ type: "text", text: "Reading" }],
    stopReason: "pending",
    usage: {
      input: null,
      output: null,
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
    },
  };
  publish(snapshot);
  expect(chat.state.messages.at(-1)?.text).toBe("Reading");
  expect(chat.state.draft).toBe("");
  snapshot.partialMessage = null;
  finish();
  await send;
  expect(chat.state.transcript).toHaveLength(2);
  expect(chat.state.messages.at(-1)?.text).toBe("Finished");
  expect(chat.state.running).toBe(false);
  expect(
    mock.invoke.mock.calls.some(([command]) =>
      ["ai_begin", "ai_end", "ai_request", "ai_save_history"].includes(command),
    ),
  ).toBe(false);
});
test("native partial text coexists with retained assistant text across tool activity and completion", async () => {
  const chat = await ready();
  chat.state.draft = "Prepare a reading plan";
  const send = chat.send();
  await started(send);
  const snapshot = ensure();
  const retained: AssistantMessage = {
    role: "assistant",
    timestamp: 2,
    content: [
      {
        type: "text",
        text: "I will check the notes.",
        textSignature: JSON.stringify({
          v: 1,
          id: "intro",
          phase: "commentary",
        }),
      },
      {
        type: "toolCall",
        id: "read",
        name: "read",
        arguments: { path: "Reading.md" },
      },
    ],
    stopReason: "toolUse",
    usage: {
      input: null,
      output: null,
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
    },
  };
  snapshot.record.messages.push(retained, {
    role: "toolResult",
    toolCallId: "read",
    toolName: "read",
    content: [],
    isError: false,
    timestamp: 3,
  });
  snapshot.partialMessage = {
    ...retained,
    content: [{ type: "text", text: "Two short sessions" }],
    stopReason: "pending",
    timestamp: 4,
  };
  publish(snapshot);
  expect(
    chat.state.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.text),
  ).toEqual(["I will check the notes.", "Two short sessions"]);
  expect(snapshot.record.messages[1]).toEqual(retained);
  snapshot.partialMessage = null;
  finish("scope", "chat", "Two short sessions would fit.");
  await send;
  expect(
    chat.state.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.text),
  ).toEqual(["I will check the notes.", "Two short sessions would fit."]);
  expect(actionCalls("submit")).toHaveLength(1);
  expect(
    mock.invoke.mock.calls.some(([command]) =>
      [
        "ai_request",
        "execute_ai_request",
        "ai_begin",
        "ai_save_history",
      ].includes(command),
    ),
  ).toBe(false);
});
test("reopening attaches to the actual running native owner without inferring interruption or resubmitting", async () => {
  const value = ensure();
  value.taskActive = true;
  value.phase = "running";
  value.record.runtime!.runs.push({
    id: "run",
    state: "running",
    startedAt: 1,
    usage: [],
  });
  const chat = await ready();
  expect(chat.state.running).toBe(true);
  expect(ensure().record.runtime!.runs[0].state).toBe("running");
  expect(actionCalls()).toEqual([]);
  closeChats([]);
  const reopened = await ready();
  expect(reopened.state.running).toBe(true);
  expect(actionCalls()).toEqual([]);
});
test("new typing during submission acknowledgement survives the accepted input's draft clearing", async () => {
  const chat = await ready();
  chat.state.draft = "Original";
  let accept!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" && args.action.type === "submit"
      ? new Promise((resolve) => {
          accept = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  const send = chat.send();
  await flushPromises();
  chat.state.draft = "New typing";
  accept();
  await flushPromises();
  expect(chat.state.draft).toBe("New typing");
  finish();
  await send;
  await chat.saveDraft();
  expect(ensure().record.draft).toBe("New typing");
});
test("a delayed initial attachment never replaces a locally entered draft", async () => {
  ensure().record.draft = "Stored";
  let attach!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_subscribe"
      ? new Promise((resolve) => {
          attach = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  const chat = workspaceChat("scope", "chat"),
    load = chat.refresh();
  chat.state.draft = "Entered now";
  attach();
  await load;
  expect(chat.state.draft).toBe("Entered now");
  await chat.saveDraft();
  expect(ensure().record.draft).toBe("Entered now");
});
test("typing during a draft action is saved against the newly acknowledged draft, not a stale record", async () => {
  const chat = await ready();
  chat.state.draft = "First";
  let accept!: () => void;
  let delayed = false;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" &&
    args.action.type === "draft" &&
    !delayed
      ? ((delayed = true),
        new Promise((resolve) => {
          accept = () => {
            void native(command, args).then(resolve);
          };
        }))
      : native(command, args),
  );
  const save = chat.saveDraft();
  await flushPromises();
  chat.state.draft = "Second";
  accept();
  await save;
  expect(actionCalls("draft")).toHaveLength(2);
  expect(ensure().record.draft).toBe("Second");
  expect(chat.state.draft).toBe("Second");
});
test("draft persistence belongs to the retained conversation rather than the mounting view", async () => {
  vi.useFakeTimers();
  const first = await ready();
  first.state.draft = "Retained";
  const second = workspaceChat("scope", "chat");
  expect(second.state).toBe(first.state);
  await vi.advanceTimersByTimeAsync(301);
  expect(ensure().record.draft).toBe("Retained");
});
test.each(["steering", "followUp"] as const)(
  "running input is accepted through native %s queue actions",
  async (kind) => {
    const chat = await ready();
    chat.state.draft = "First";
    const send = chat.send();
    await started(send);
    chat.state.draft = "Next";
    await chat.send(kind);
    expect(actionCalls("enqueue")[0][1].action).toMatchObject({
      version: 1,
      type: "enqueue",
      kind,
      input: { text: "Next", attachments: [], references: [] },
    });
    expect(chat.state.pending[0]?.text).toBe("Next");
    expect(chat.state.draft).toBe("");
    finish();
    await send;
    await chat.recallPending();
    expect(chat.state.draft).toBe("Next");
    expect(chat.state.pending).toEqual([]);
  },
);
test("stop is a native action and completion waits for native drain", async () => {
  const chat = await ready();
  chat.state.draft = "Run";
  const send = chat.send();
  await started(send);
  let finishCancel!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" && args.action.type === "cancel"
      ? new Promise((resolve) => {
          finishCancel = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  let closed = false;
  const closing = chat.abortAndWait().then(() => {
    closed = true;
  });
  await flushPromises();
  expect(closed).toBe(false);
  expect(chat.state.running).toBe(true);
  expect(actionCalls("cancel")[0][1].action.runId).toBe(
    actionCalls("submit")[0][1].actionId,
  );
  finishCancel();
  await closing;
  await send;
  expect(chat.state.running).toBe(false);
});
test("stop before the submission reply uses the known action identity", async () => {
  const chat = await ready();
  chat.state.draft = "Run";
  let accept!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" && args.action.type === "submit"
      ? new Promise((resolve) => {
          accept = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  const send = chat.send();
  await flushPromises();
  chat.abort();
  await flushPromises();
  expect(actionCalls("cancel")[0][1].action.runId).toBe(
    actionCalls("submit")[0][1].actionId,
  );
  accept();
  await flushPromises();
  finish();
  await send;
});
test("native plugin results complete a submitted turn without another frontend action", async () => {
  const chat = await ready();
  chat.state.draft = "Send the invitation";
  const send = chat.send();
  await started(send);
  const snapshot = ensure();
  snapshot.record.messages.push({
    role: "toolResult",
    toolCallId: "send-invitation",
    toolName: "plugin_demo_send",
    content: [{ type: "text", text: "Invitation sent" }],
    details: { status: 202 },
    isError: false,
    timestamp: 1,
  });
  publish(snapshot);
  expect(chat.state.transcript.at(-1)).toMatchObject({
    toolName: "plugin_demo_send",
    details: { status: 202 },
  });
  finish("scope", "chat", "Invitation sent");
  await send;
  expect(chat.state.running).toBe(false);
  expect(chat.state.messages.at(-1)?.text).toBe("Invitation sent");
  expect(actionCalls().map(([, args]) => args.action.type)).toEqual([
    "draft",
    "submit",
  ]);
});
test("native persistence failures retain observed results and retry only persistence", async () => {
  const chat = await ready();
  const snapshot = ensure();
  snapshot.phase = "persistenceFailed";
  snapshot.error = "native.ai.conversation.saveFailed";
  snapshot.record.messages.push({
    role: "toolResult",
    toolCallId: "write",
    toolName: "write",
    content: [{ type: "text", text: "Saved" }],
    details: { revision: "verified" },
    isError: false,
    timestamp: 1,
  });
  publish(snapshot);
  expect(chat.state.unsaved).toBe(true);
  expect(chat.state.transcript[0]).toMatchObject({
    details: { revision: "verified" },
  });
  chat.state.draft = "Next";
  await chat.send();
  expect(actionCalls("submit")).toEqual([]);
  await chat.retrySave();
  expect(actionCalls("retryPersistence")).toHaveLength(1);
  expect(chat.state.unsaved).toBe(false);
  expect(ensure().record.draft).toBe("Next");
});
test("an uncertain action is never automatically resent and explicit retry uses its original identity", async () => {
  const chat = await ready();
  chat.state.draft = "Run";
  let lost = false;
  mock.invoke.mockImplementation(async (command, args) => {
    const result = await native(command, args);
    if (
      command === "ai_conversation_action" &&
      args.action.type === "submit" &&
      !lost
    ) {
      lost = true;
      throw new Error("lost acknowledgement");
    }
    return result;
  });
  await chat.send();
  await flushPromises();
  expect(chat.state.unsaved).toBe(true);
  expect(actionCalls("submit")).toHaveLength(1);
  finish();
  await chat.retrySave();
  const submits = actionCalls("submit");
  expect(submits).toHaveLength(2);
  expect(submits[1][1].actionId).toBe(submits[0][1].actionId);
  expect(
    ensure().record.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
});
test("independent conversations retain drafts and stopping one cannot stop another", async () => {
  const first = await ready(),
    second = await ready("scope", "other");
  first.state.draft = "First";
  second.state.draft = "Second";
  const a = first.send(),
    b = second.send();
  await flushPromises();
  first.abort();
  await a;
  expect(second.state.running).toBe(true);
  expect(actionCalls("cancel")[0][1].conversation).toBe("chat");
  finish("scope", "other");
  await b;
});
test.each(["loading", "saving", "error"] as const)(
  "%s model settings gate submission without consuming the draft",
  async (field) => {
    const chat = await ready();
    workspaceAiSettings("scope", "connection").state[field] = true;
    chat.state.draft = "Keep";
    await chat.send();
    expect(chat.state.draft).toBe("Keep");
    expect(actionCalls("submit")).toEqual([]);
  },
);
test("model changes are device-local commands independent of conversation content", async () => {
  const chat = workspaceChat("scope", "chat");
  await chat.selectModel("another");
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith(
    "ai_select_conversation_model",
    { scope: "scope", conversation: "chat", model: "another" },
  );
  expect(actionCalls()).toEqual([]);
});
test("stale status refresh cannot overwrite a newer chosen model", async () => {
  let statusReply!: (value: unknown) => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_status"
      ? new Promise((resolve) => {
          statusReply = resolve;
        })
      : native(command, args),
  );
  const chat = workspaceChat("scope", "chat"),
    refresh = chat.refresh();
  await chat.selectModel("new-choice");
  statusReply({ ...status, selectedModel: "old" });
  await refresh;
  expect(chat.state.status?.selectedModel).toBe("new-choice");
});
test("dictation blocks direct and queued sends only for the owning conversation", async () => {
  const chat = await ready();
  chat.state.draft = "Keep";
  mock.dictation.mockImplementation((_scope, id) => id === "chat");
  await chat.send();
  expect(actionCalls("submit")).toEqual([]);
  expect(chat.state.draft).toBe("Keep");
});
test("new chats remain temporary until the first submission", async () => {
  const id = await workspaceConversations("scope").create();
  const chat = workspaceChat("scope", id);
  chat.state.draft = "Temporary";
  await chat.saveDraft();
  expect(mock.invoke).not.toHaveBeenCalled();
  expect(discardUnsentChat("scope", id!)).toBe(true);
});
test.each([undefined, "sample"])(
  "temporary development chats preserve their starting context (%s)",
  async (pluginId) => {
    const id =
      await workspaceConversations("scope").createDevelopment(pluginId);
    const chat = workspaceChat("scope", id);
    chat.state.draft = "Build notes";
    const send = chat.send();
    await flushPromises();
    expect(ensure("scope", id).record.development).toEqual({
      version: 2,
      ...(pluginId ? { pluginId } : {}),
    });
    expect(actionCalls("submit")).toHaveLength(1);
    finish("scope", id);
    await send;
  },
);
test("temporary attachments stage locally and import once at first submission", async () => {
  const id = await workspaceConversations("scope").create();
  const chat = workspaceChat("scope", id);
  const file = new File(["note"], "note.txt", { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode("note").buffer,
  });
  await chat.addAttachment(file);
  expect(mock.invoke).not.toHaveBeenCalled();
  chat.state.draft = "Read";
  const send = chat.send();
  await flushPromises();
  expect(
    mock.invoke.mock.calls.filter(
      ([command]) => command === "ai_attachment_put",
    ),
  ).toHaveLength(1);
  expect(actionCalls("submit")[0][1].action.input.attachments[0].id).toBe(
    "stored-attachment",
  );
  const creation = mock.invoke.mock.calls.find(
    ([command]) => command === "ai_create_conversation",
  )![1];
  expect(Object.keys(creation.initial).sort()).toEqual([
    "attachments",
    "draft",
    "references",
  ]);
  expect(creation.initial).toMatchObject({
    draft: "Read",
    attachments: [{ id: "stored-attachment" }],
    references: [],
  });
  finish("scope", id);
  await send;
});
test.each([false, true])(
  "first submission accepts an omitted empty runtime (lost creation receipt: %s)",
  async (lostReceipt) => {
    const id = await workspaceConversations("scope").create();
    const chat = workspaceChat("scope", id);
    chat.state.draft = "Keep the original input";
    mock.invoke.mockImplementation(async (command, args) => {
      const value = await native(command, args);
      if (
        command === "ai_create_conversation" ||
        command === "ai_conversation_read"
      )
        delete (value as ConversationRecord).runtime;
      if (command === "ai_create_conversation" && lostReceipt)
        throw new Error("Creation acknowledgement lost");
      return value;
    });
    const send = chat.send();
    await flushPromises();
    expect(actionCalls("submit")).toHaveLength(1);
    expect(actionCalls("submit")[0][1].action.input.text).toBe(
      "Keep the original input",
    );
    expect(chat.state.unsaved).toBe(false);
    expect(
      mock.invoke.mock.calls.filter(
        ([command]) => command === "ai_create_conversation",
      ),
    ).toHaveLength(1);
    if (lostReceipt)
      expect(mock.invoke).toHaveBeenCalledWith("ai_conversation_read", {
        scope: "scope",
        conversation: id,
      });
    finish("scope", id);
    await send;
  },
);

test("first submission rejects a creation receipt containing existing execution history", async () => {
  const id = await workspaceConversations("scope").create();
  const chat = workspaceChat("scope", id);
  chat.state.draft = "New request";
  mock.invoke.mockImplementation(async (command, args) => {
    const value = await native(command, args);
    if (command === "ai_create_conversation") {
      (value as ConversationRecord).runtime!.runs.push({
        id: "existing",
        state: "completed",
        startedAt: 1,
      });
    }
    return value;
  });
  await chat.send();
  expect(actionCalls("submit")).toHaveLength(0);
  expect(chat.state.unsaved).toBe(true);
});

test("uncertain conversation creation reads the canonical record without submitting runtime authority", async () => {
  const id = await workspaceConversations("scope").create();
  const chat = workspaceChat("scope", id);
  chat.state.draft = "Keep the original input";
  mock.invoke.mockImplementation(async (command, args) => {
    const value = await native(command, args);
    if (command === "ai_create_conversation")
      throw new Error("Creation acknowledgement lost");
    return value;
  });
  const send = chat.send();
  await flushPromises();
  expect(
    mock.invoke.mock.calls.filter(
      ([command]) => command === "ai_create_conversation",
    ),
  ).toHaveLength(1);
  expect(mock.invoke).toHaveBeenCalledWith("ai_conversation_read", {
    scope: "scope",
    conversation: id,
  });
  expect(actionCalls("submit")).toHaveLength(1);
  finish("scope", id);
  await send;
});
test("a cancelled temporary attachment import never creates or submits afterward", async () => {
  const id = await workspaceConversations("scope").create();
  const chat = workspaceChat("scope", id);
  let importReply!: () => void;
  const file = new File(["note"], "note.txt", { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode("note").buffer,
  });
  await chat.addAttachment(file);
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_attachment_put"
      ? new Promise((resolve) => {
          importReply = () =>
            resolve({
              id: "stored",
              name: "note.txt",
              mimeType: "text/plain",
              size: 4,
            });
        })
      : native(command, args),
  );
  const send = chat.send();
  await flushPromises();
  chat.abort();
  importReply();
  await send;
  expect(
    mock.invoke.mock.calls.some(
      ([command]) => command === "ai_create_conversation",
    ),
  ).toBe(false);
  expect(actionCalls()).toEqual([]);
  expect(chat.state.ephemeral).toBe(true);
});
test("native tool provenance and measured work periods render without recomputation or execution", async () => {
  const value = ensure();
  value.record.runtime!.events = [
    {
      id: "start",
      runId: "run",
      sequence: 1,
      type: "work_block_start",
      data: { workId: "work", startedAt: 1, startMessageCount: 0 },
    },
    {
      id: "call",
      runId: "run",
      sequence: 2,
      type: "tool_intent",
      data: {
        name: "write",
        args: { path: "note.md" },
        pluginId: "notes",
        pluginName: "Notes",
        messageIndex: 0,
      },
    },
    {
      id: "end",
      runId: "run",
      sequence: 3,
      type: "tool_execution_end",
      data: {
        toolCallId: "call",
        result: {
          content: [{ type: "text", text: "Saved" }],
          details: { change: { path: "note.md" } },
        },
        isError: false,
        durationMs: 15,
      },
    },
    {
      id: "work-end",
      runId: "run",
      sequence: 4,
      type: "work_block_end",
      data: {
        workId: "work",
        startMessageCount: 0,
        messageCount: 0,
        durationMs: 20,
        outcome: "complete",
      },
    },
  ];
  const chat = await ready();
  expect(chat.state.toolActivity[0]).toMatchObject({
    id: "call",
    pluginId: "notes",
    pluginName: "Notes",
    messageIndex: 0,
    state: "completed",
    durationMs: 15,
  });
  expect(chat.state.workBlocks).toEqual([
    {
      id: "work",
      startMessageCount: 0,
      messageCount: 0,
      durationMs: 20,
      outcome: "complete",
    },
  ]);
  expect(actionCalls()).toEqual([]);
});
test.each(["pending", "answered"] as const)(
  "ordinary native input remains usable after guidance ends with a retained %s setup decision",
  async (questionStatus) => {
    const session = onboardingSession("scope");
    session.state.record = {
      ...newOnboardingRecord(),
      step: "sources",
      conversationId: "chat",
      instructionRevision: "a".repeat(40),
    };
    const question = setupQuestion("scope", "chat")!;
    const chat = await ready();
    await chat.presentQuestion(question);
    if (questionStatus === "answered") {
      const snapshot = ensure();
      snapshot.record.runtime!.events.push({
        id: "answered",
        runId: "questions",
        sequence: 2,
        type: "question_answered",
        data: {
          questionId: question.id,
          answer: { text: "Continue", choiceId: "support" },
        },
      });
      publish(snapshot);
      expect(chat.state.questionActionPending).toBe(question.id);
    }
    session.state.record = {
      ...session.state.record!,
      step: "complete",
      entered: true,
    };
    chat.state.draft = "Continue with the remaining source files.";
    const send = chat.send();
    await started(send);
    expect(chat.state.draft).toBe("");
    expect(ensure().record.messages.at(-1)).toMatchObject({
      role: "user",
      content: "Continue with the remaining source files.",
    });
    expect(actionCalls("answerQuestion")).toHaveLength(0);
    expect(actionCalls("retryQuestionAction")).toHaveLength(0);
    finish();
    await send;
  },
);
test("retained questions remain answerable offline through native actions", async () => {
  const chat = await ready();
  await chat.presentQuestion({
    id: "question",
    prompt: "Choose",
    suggestions: [{ id: "yes", label: "Yes" }],
  });
  chat.state.status = { ...status, available: false };
  expect(chat.state.questions[0].status).toBe("pending");
  await chat.answerQuestion({ questionId: "question", choiceId: "yes" });
  expect(actionCalls("answerQuestion")[0][1].action).toMatchObject({
    response: { questionId: "question", choiceId: "yes" },
    input: { text: "", attachments: [], references: [] },
  });
  expect(actionCalls("submit")).toEqual([]);
});
test("invalid and duplicate question answers cannot invoke native actions", async () => {
  const chat = await ready();
  await chat.presentQuestion({ id: "question", prompt: "Choose" });
  expect(() =>
    chat.answerQuestion({ questionId: "question", text: " " }),
  ).toThrow();
  chat.state.questionBusy = true;
  await expect(
    chat.answerQuestion({ questionId: "question", text: "Answer" }),
  ).rejects.toThrow("busy");
  expect(actionCalls("answerQuestion")).toEqual([]);
});
test("superseding and explicit question retries use distinct native actions", async () => {
  const chat = await ready();
  await chat.presentQuestion({ id: "question", prompt: "Choose" });
  await chat.supersedeQuestion("question");
  expect(chat.state.questions[0].status).toBe("superseded");
  await chat.retryQuestionAction("question");
  expect(actionCalls("retryQuestionAction")[0][1].action.questionId).toBe(
    "question",
  );
});
test("renames and plugin notices are field-specific owner actions", async () => {
  const chat = await ready();
  await chat.renameTitle("New title");
  await chat.notifyPluginAvailable(
    { pluginId: "notes", pluginName: "Notes" },
    "run",
  );
  expect(chat.state.title).toBe("New title");
  expect(actionCalls("renameTitle")[0][1].action).toEqual({
    version: 1,
    type: "renameTitle",
    expected: "Chat",
    title: "New title",
  });
  expect(actionCalls("notifyPluginAvailable")[0][1].action).toEqual({
    version: 1,
    type: "notifyPluginAvailable",
    pluginId: "notes",
  });
});
test("workspace close refuses running work and abort waits for all conversations", async () => {
  const a = await ready(),
    b = await ready("scope", "other");
  a.state.draft = "A";
  b.state.draft = "B";
  const first = a.send(),
    second = b.send();
  await flushPromises();
  expect(workspaceChatActivity("scope").running).toBe(true);
  await expect(saveChatDrafts("scope")).rejects.toThrow(
    "saveTheConversationBeforeClosing",
  );
  await abortWorkspaceChats("scope");
  await first;
  await second;
  expect(workspaceChatActivity("scope").running).toBe(false);
});
test("refreshing connection status reaches retained conversations without replacing local drafts", async () => {
  const first = await ready(),
    second = await ready("scope", "other");
  first.state.draft = "First";
  second.state.draft = "Second";
  await refreshWorkspaceChats("scope");
  expect(first.state.draft).toBe("First");
  expect(second.state.draft).toBe("Second");
});
test("unreadable native history protects local input and never falls back to prototype commands", async () => {
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_subscribe"
      ? Promise.resolve({
          ...ensure(),
          record: { ...ensure().record, version: 1 },
        })
      : native(command, args),
  );
  const chat = workspaceChat("scope", "chat");
  chat.state.draft = "Keep";
  await chat.refresh();
  expect(chat.state.loadError).toBeTruthy();
  await chat.send();
  expect(chat.state.draft).toBe("Keep");
  expect(actionCalls()).toEqual([]);
});
test("identity-bound references stay in draft, queue and run actions without frontend resolution or path rebinding", async () => {
  const chat = await ready();
  const reference = {
    kind: "live" as const,
    workspaceId: "scope",
    path: "Notes.md",
    anchorRevision: "a".repeat(40),
  };
  await chat.addReference(reference);
  expect(ensure().record.runtime?.draftReferences).toEqual([reference]);
  const send = chat.send();
  await flushPromises();
  expect(actionCalls("submit")[0][1].action.input).toMatchObject({
    text: "",
    references: [reference],
  });
  expect(chat.state.runReferences).toEqual([reference]);
  expect(
    mock.invoke.mock.calls.some(
      ([command]) =>
        command === "files_request" || command === "ai_attachment_read",
    ),
  ).toBe(false);
  finish();
  await send;
});
test("cross-workspace and unanchored references cannot be staged or submitted", async () => {
  const chat = await ready();
  await expect(
    chat.addReference({
      kind: "live",
      workspaceId: "other",
      path: "Notes.md",
      anchorRevision: "a".repeat(40),
    }),
  ).rejects.toThrow("invalid");
  await expect(
    chat.addReference({
      kind: "live",
      workspaceId: "scope",
      path: "Notes.md",
      anchorRevision: "",
    }),
  ).rejects.toThrow("invalid");
  expect(chat.state.draftReferences).toEqual([]);
  expect(actionCalls()).toEqual([]);
});
test("a title explicitly chosen before first send reaches the owner before automatic generation can start", async () => {
  const id = await workspaceConversations("scope").create();
  const chat = workspaceChat("scope", id);
  await chat.renameTitle("My title");
  chat.state.draft = "Build a reading inbox";
  const send = chat.send();
  await flushPromises();
  expect(ensure("scope", id).record.title).toBe("My title");
  const calls = mock.invoke.mock.calls.filter(
    ([command]) => command === "ai_conversation_action",
  );
  expect(
    calls.findIndex(([, args]) => args.action.type === "renameTitle"),
  ).toBeLessThan(calls.findIndex(([, args]) => args.action.type === "submit"));
  finish("scope", id);
  await send;
});
test("a deterministic admission rejection remains visible without dropping the captured draft or replaying", async () => {
  const chat = await ready();
  chat.state.draft = "Keep my input";
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" && args.action.type === "submit"
      ? Promise.reject("native.ai.conversation.conflict")
      : native(command, args),
  );
  await chat.send();
  await flushPromises();
  expect(chat.state.draft).toBe("Keep my input");
  expect(chat.state.error).toBe("native.ai.conversation.conflict");
  expect(chat.state.unsaved).toBe(false);
  expect(actionCalls("submit")).toHaveLength(1);
});
test("prepared assignments keep the composer busy until native acceptance", async () => {
  const chat = await ready();
  chat.state.draft = "Prepared assignment";
  let accept!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" && args.action.type === "submit"
      ? new Promise((resolve) => {
          accept = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  const submitted = chat.submitPreparedAssignment(() => true);
  await flushPromises();
  expect(chat.state.submitting).toBe(true);
  await chat.send();
  expect(actionCalls("submit")).toHaveLength(1);
  accept();
  await expect(submitted).resolves.toBe(true);
  expect(chat.state.submitting).toBe(false);
});

test("completion of an earlier run cannot clear a newer queued submission's preparation", async () => {
  const chat = await ready();
  chat.state.draft = "First";
  const main = chat.send();
  await started(main);
  let accept!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" && args.action.type === "enqueue"
      ? new Promise((resolve) => {
          accept = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  chat.state.draft = "Second";
  const queued = chat.send();
  await flushPromises();
  expect(chat.state.submitting).toBe(true);
  finish();
  await main;
  expect(chat.state.running).toBe(true);
  expect(chat.state.submitting).toBe(true);
  chat.state.draft = "Third";
  await chat.send();
  expect(actionCalls("submit")).toHaveLength(1);
  accept();
  await queued;
  expect(chat.state.submitting).toBe(false);
  expect(chat.state.draft).toBe("Third");
  expect(chat.state.pending[0]?.text).toBe("Second");
});
test("stop during question preparation prevents a later answer action while preserving the written draft", async () => {
  const chat = await ready();
  await chat.presentQuestion({ id: "question", prompt: "Choose" });
  chat.state.draft = "Answer";
  let save!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" && args.action.type === "draft"
      ? new Promise((resolve) => {
          save = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  const answer = chat.answerQuestion({
    questionId: "question",
    text: "Answer",
  });
  await flushPromises();
  chat.abort();
  save();
  await answer;
  expect(actionCalls("answerQuestion")).toEqual([]);
  expect(chat.state.questions[0].status).toBe("pending");
  expect(chat.state.draft).toBe("Answer");
  expect(chat.state.questionBusy).toBe(false);
});
test("an acknowledged answer can continue natively without blocking steering behind local question preparation", async () => {
  const chat = await ready();
  await chat.presentQuestion({ id: "question", prompt: "Choose" });
  chat.state.draft = "Answer";
  mock.invoke.mockImplementation(async (command, args) => {
    const result = await native(command, args);
    if (
      command === "ai_conversation_action" &&
      args.action.type === "answerQuestion"
    ) {
      const snapshot = ensure();
      snapshot.taskActive = true;
      snapshot.phase = "running";
      snapshot.actionId = args.actionId;
      snapshot.record.runtime!.events.push({
        id: "answered",
        runId: "questions",
        sequence: snapshot.record.runtime!.events.length + 1,
        type: "question_answered",
        data: { questionId: "question", answer: { text: "Answer" } },
      });
      snapshot.record.runtime!.runs.push({
        id: args.actionId,
        state: "running",
        startedAt: 1,
        usage: [],
      });
      setDraft(snapshot.record, { text: "", attachments: [], references: [] });
      publish(snapshot);
      return copy(snapshot);
    }
    return result;
  });
  const answer = chat.answerQuestion({
    questionId: "question",
    text: "Answer",
  });
  await flushPromises();
  expect(chat.state.running).toBe(true);
  expect(chat.state.questionBusy).toBe(false);
  expect(chat.state.draft).toBe("");
  chat.state.draft = "Next";
  await chat.send();
  expect(actionCalls("enqueue")).toHaveLength(1);
  finish();
  await answer;
});
test("final workspace flush rechecks earlier conversations for newly entered input", async () => {
  const first = await ready(),
    second = await ready("scope", "other");
  first.state.draft = "First";
  second.state.draft = "Second";
  let save!: () => void;
  mock.invoke.mockImplementation((command, args) =>
    command === "ai_conversation_action" &&
    args.conversation === "other" &&
    args.action.type === "draft"
      ? new Promise((resolve) => {
          save = () => {
            void native(command, args).then(resolve);
          };
        })
      : native(command, args),
  );
  const flush = saveChatDrafts("scope"),
    rejected = expect(flush).rejects.toThrow(
      "saveTheConversationBeforeClosing",
    );
  await flushPromises();
  first.state.draft = "New typing";
  save();
  await rejected;
  expect(first.state.draft).toBe("New typing");
  expect(ensure().record.draft).toBe("First");
});
test("workspace abort delegates every owner including unobserved conversations to the native scope service", async () => {
  const hidden = ensure("scope", "hidden");
  hidden.taskActive = true;
  hidden.phase = "running";
  hidden.record.runtime!.runs.push({
    id: "hidden-run",
    state: "running",
    startedAt: 1,
    usage: [],
  });
  await abortWorkspaceChats("scope");
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith(
    "ai_conversations_abort",
    { scope: "scope" },
  );
  expect(hidden.taskActive).toBe(false);
  expect(actionCalls("cancel")).toEqual([]);
});
test.each([
  [
    "persistenceFailed",
    "native.ai.conversation.saveFailed",
    "ai.theConversationCouldNotBeSavedKeepThisWorkspace",
  ],
  [
    "interrupted",
    "native.ai.request.failed",
    "ai.theResponseFailedCheckAIAccessReconnectIfYour",
  ],
  [
    "interrupted",
    "native.ai.response.idleTimeout",
    "native.ai.response.idleTimeout",
  ],
] as const)(
  "native %s failure %s keeps canonical codes and presents actionable feedback",
  async (phase, error, expected) => {
    const chat = await ready(),
      snapshot = ensure();
    snapshot.phase = phase;
    snapshot.error = error;
    publish(snapshot);
    expect(chat.state.error).toBe(expected);
    expect(snapshot.error).toBe(error);
  },
);
test.each([
  ["native.ai.protocol.invalidData", "native.ai.protocol.invalidData"],
  [
    "native.ai.protocol.providerRejected",
    "native.ai.protocol.providerRejected",
  ],
  [
    "native.ai.protocol.incompleteStream",
    "native.ai.protocol.incompleteStream",
  ],
  ["native.ai.protocol.unsupported", "native.ai.protocol.unsupported"],
  ["PRIVATE_PROVIDER_BODY", "ai.theResponseFailedCheckAIAccessReconnectIfYour"],
])(
  "native model failure %s never exposes provider response bodies",
  async (error, expected) => {
    const chat = await ready(),
      snapshot = ensure();
    snapshot.phase = "interrupted";
    snapshot.error = error;
    snapshot.record.runtime!.events.push(
      {
        id: "start",
        runId: "run",
        sequence: 1,
        type: "work_block_start",
        data: { workId: "work", startMessageCount: 0, startedAt: 1 },
      },
      {
        id: "end",
        runId: "run",
        sequence: 2,
        type: "work_block_end",
        data: {
          workId: "work",
          startMessageCount: 0,
          messageCount: 0,
          durationMs: 1,
          outcome: "error",
        },
      },
    );
    publish(snapshot);
    expect(chat.state.error).toBe(expected);
    expect(chat.state.workBlocks.at(-1)?.outcome).toBe("error");
    expect(snapshot.error).toBe(error);
  },
);
test("native wall-clock work starts retain their live monotonic age across reattachment", async () => {
  vi.useFakeTimers({ now: 100000 });
  const snapshot = ensure();
  snapshot.taskActive = true;
  snapshot.phase = "running";
  snapshot.actionId = "run";
  snapshot.record.runtime!.events.push({
    id: "start",
    runId: "run",
    sequence: 1,
    type: "work_block_start",
    data: { workId: "run", startedAt: 99000, startMessageCount: 0 },
  });
  const chat = await ready();
  const anchor = chat.state.activeWork!.startedAt;
  expect(performance.now() - anchor).toBeCloseTo(1000);
  await vi.advanceTimersByTimeAsync(3000);
  await chat.refresh();
  expect(chat.state.activeWork!.startedAt).toBeCloseTo(anchor);
  expect(performance.now() - chat.state.activeWork!.startedAt).toBeCloseTo(
    4000,
  );
});
test("older pages retain originals across descendant updates and are cleared on a branch change", async () => {
  const snapshot = ensure();
  snapshot.messageOffset = 1;
  snapshot.messageEntryIds = ["recent"];
  snapshot.selectedEntryId = "recent";
  snapshot.historyBefore = "recent";
  snapshot.record.messages = [
    { role: "user", content: "Recent", timestamp: 2 },
  ];
  let descendant = true;
  mock.invoke.mockImplementation((command, args) => {
    if (command === "ai_conversation_ancestor")
      return Promise.resolve(descendant);
    if (command === "ai_conversation_history" && args.before === "newer")
      return Promise.resolve({
        metadata: { id: "chat", revision: 1, selectedEntryId: "newer" },
        entries: [
          {
            version: 1,
            id: "recent",
            parentId: "earlier",
            type: "message",
            data: {
              message: { role: "user", content: "Recent", timestamp: 2 },
            },
          },
        ],
        nextBefore: "recent",
        messageOffset: 1,
        eventOffset: 0,
      });
    if (command === "ai_conversation_history")
      return Promise.resolve({
        metadata: { id: "chat", revision: 0, selectedEntryId: "recent" },
        entries: [
          {
            version: 1,
            id: "earlier",
            parentId: null,
            type: "message",
            data: {
              message: { role: "user", content: "Earlier", timestamp: 1 },
            },
          },
        ],
        nextBefore: null,
        messageOffset: 0,
        eventOffset: 0,
      });
    return native(command, args);
  });
  const chat = await ready();
  expect(chat.state.transcript.map((message) => message.content)).toEqual([
    "Recent",
  ]);
  await chat.loadOlder();
  expect(chat.state.transcript.map((message) => message.content)).toEqual([
    "Earlier",
    "Recent",
  ]);
  expect(chat.state.historyBefore).toBeNull();
  snapshot.selectedEntryId = "newer";
  snapshot.messageEntryIds = ["recent", "newer"];
  snapshot.record.messages.push({
    role: "user",
    content: "Newer",
    timestamp: 3,
  });
  publish(snapshot);
  await flushPromises();
  expect(chat.state.transcript.map((message) => message.content)).toEqual([
    "Earlier",
    "Recent",
    "Newer",
  ]);
  descendant = false;
  snapshot.selectedEntryId = "branch";
  snapshot.messageEntryIds = ["branch"];
  snapshot.messageOffset = 1;
  snapshot.record.messages = [
    { role: "user", content: "Other branch", timestamp: 4 },
  ];
  publish(snapshot);
  await flushPromises();
  expect(chat.state.transcript.map((message) => message.content)).toEqual([
    "Other branch",
  ]);
});

test("workspace abort works without any frontend workspace cache", async () => {
  await abortWorkspaceChats("unobserved");
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith(
    "ai_conversations_abort",
    { scope: "unobserved" },
  );
});
