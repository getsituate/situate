import "@situate/localization/onboarding";
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { newOnboardingRecord, type OnboardingRecord } from "./types";
import { emptyRuntime } from "../ai/queue-runtime";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  session: {
    state: { record: null as OnboardingRecord | null },
    load: vi.fn(),
    flush: vi.fn(),
    retry: vi.fn(),
    update: vi.fn(),
  },
  chat: {
    state: {
      running: false,
      unsaved: false,
      loadError: undefined as unknown,
      error: undefined as unknown,
      draft: "",
      transcript: [] as unknown[],
      questions: [] as import("../ai/question").RetainedQuestion[],
      questionBusy: false,
      attachmentBusy: false,
      questionActionPending: undefined as string | undefined,
    },
    refresh: vi.fn(),
    saveDraft: vi.fn(),
    send: vi.fn(),
    presentQuestion: vi.fn(),
    answerQuestion: vi.fn(),
  },
  refresh: vi.fn(),
  check: vi.fn(),
  dictating: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../dictation/runtime", () => ({
  ownsDictation: () => mock.dictating,
}));
vi.mock("./session", () => ({
  onboardingSession: () => mock.session,
  currentOnboarding: () => mock.session,
}));
vi.mock("./model-check", () => ({ checkModelAccess: mock.check }));
vi.mock("../ai/chat", () => ({
  workspaceChat: () => mock.chat,
  workspaceConversations: () => ({ refresh: mock.refresh }),
}));
import {
  checkSetupAccess,
  continueSetupSupport,
  confirmInstructions,
  enterSetupApp,
  finishOnboarding,
  pendingSetupDevelopments,
  recoverSetupQuestion,
  restoreSetupConversation,
  startSetupConversation,
  startSetupDevelopments,
} from "./agent";
import { setupQuestion } from "./questions";
const childId = "11111111-1111-4111-8111-111111111111";
function conversation(id = "setup") {
  return {
    version: 2,
    id,
    title: "Workspace setup",
    revision: 0,
    draft: "",
    messages: [],
  };
}
function child() {
  return {
    ...conversation(childId),
    draft: "Build a reading view",
    development: { version: 2, pluginId: "reading-view" },
  };
}
function selectedIdea() {
  return {
    id: "reading-view",
    title: "Reading view",
    detail: "Browse notes",
    reason: "Review",
    assignment: "Build a reading view",
    choice: "develop" as const,
    developmentId: childId,
    pluginId: "reading-view",
    notePath: null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.dictating = false;
  mock.chat.answerQuestion.mockResolvedValue(undefined);
  mock.session.state.record = {
    ...newOnboardingRecord(),
    conversationId: "setup",
    step: "method",
  };
  Object.assign(mock.chat.state, {
    running: false,
    unsaved: false,
    loadError: undefined,
    error: undefined,
    draft: "",
    transcript: [],
    questions: [],
    questionBusy: false,
    attachmentBusy: false,
    questionActionPending: undefined,
  });
  mock.session.update.mockImplementation(async (patch) => {
    Object.assign(mock.session.state.record!, patch);
  });
  mock.chat.presentQuestion.mockImplementation(async (question) => {
    mock.chat.state.questions = [
      ...mock.chat.state.questions.map((item) => ({
        ...item,
        status:
          item.status === "pending" ? ("superseded" as const) : item.status,
      })),
      { ...question, status: "pending", timestamp: 1 },
    ];
  });
  mock.chat.send.mockImplementation(async () => {
    mock.chat.state.running = true;
  });
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "ai_conversation_read") {
      expect(Object.keys(args).sort()).toEqual(["conversation", "scope"]);
      return conversation(args.conversation);
    }
    if (command === "ai_status")
      return { available: true, selectedModel: "fixture", modelError: null };
    if (command === "files_request")
      return {
        status: "ok",
        snapshot: { writable: true, reason: null, drafts: [], entries: [] },
      };
    if (command === "onboarding_action")
      return {
        record: mock.session.state.record,
        revision: "saved",
        writable: true,
      };
    throw new Error(`Unexpected command: ${command}`);
  });
});
it("reattaches to retained native setup without submitting or replacing a draft", async () => {
  mock.chat.state.draft = "An unsent correction";
  const result = await restoreSetupConversation("scope");
  expect(result?.id).toBe("setup");
  expect(mock.chat.refresh).toHaveBeenCalledOnce();
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("ai_conversation_read", {
    scope: "scope",
    conversation: "setup",
  });
  expect(mock.chat.send).not.toHaveBeenCalled();
  expect(mock.chat.saveDraft).not.toHaveBeenCalled();
  expect(mock.chat.state.draft).toBe("An unsent correction");
});
it("does not select prototype phase conversation identifiers", async () => {
  Object.assign(mock.session.state.record!, {
    conversationId: null,
    methodConversationId: "old-method",
    sourceConversationId: "old-import",
    supportConversationId: "old-support",
  });
  expect(await restoreSetupConversation("scope")).toBeNull();
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("starts a new conversation with the known setup brief only once", async () => {
  Object.assign(mock.session.state.record!, {
    description: "Weekly reviews",
    sourceDescription: "A notes export",
    fresh: false,
  });
  const [first, second] = await Promise.all([
    startSetupConversation("scope"),
    startSetupConversation("scope"),
  ]);
  expect(first.id).toBe(second.id);
  expect(mock.chat.send).toHaveBeenCalledOnce();
  expect(mock.chat.saveDraft).toHaveBeenCalledOnce();
  expect(mock.chat.state.draft).toContain("Weekly reviews");
  expect(mock.chat.state.draft).toContain("A notes export");
});
it("does not replay a retained assistant turn on restart", async () => {
  mock.invoke.mockResolvedValue({
    ...conversation(),
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "The proposal is ready." }],
        stopReason: "stop",
        timestamp: 1,
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
      },
    ],
  });
  await startSetupConversation("scope");
  expect(mock.chat.send).not.toHaveBeenCalled();
  expect(mock.chat.saveDraft).not.toHaveBeenCalled();
});
it("retains interrupted native runs without replaying setup or child development", async () => {
  const runtime = {
    ...emptyRuntime(),
    runs: [
      { id: "interrupted-run", state: "interrupted", startedAt: 1, endedAt: 2 },
    ],
  };
  mock.invoke.mockResolvedValue({ ...conversation(), runtime });
  await startSetupConversation("scope");
  expect(mock.chat.send).not.toHaveBeenCalled();
  Object.assign(mock.session.state.record!, {
    step: "complete",
    ideas: [selectedIdea()],
  });
  mock.invoke.mockResolvedValue({ ...child(), runtime });
  expect(await pendingSetupDevelopments("scope")).toBe(false);
  mock.invoke.mockResolvedValue({
    conversation: { ...child(), runtime },
    ready: true,
  });
  expect(
    await startSetupDevelopments("scope", mock.session.state.record!),
  ).toEqual([]);
  expect(mock.chat.send).not.toHaveBeenCalled();
});
it("keeps a damaged native conversation protected instead of replacing it", async () => {
  mock.invoke.mockImplementation(async (command) => {
    if (command === "ai_conversation_read") throw new Error("read failed");
    if (command === "ai_conversations")
      return [
        {
          id: "setup",
          title: "Workspace setup",
          revision: 0,
        },
      ];
    throw new Error("must not create");
  });
  await expect(restoreSetupConversation("scope")).rejects.toThrow();
  expect(
    mock.invoke.mock.calls.some(
      ([command]) => command === "ai_create_conversation",
    ),
  ).toBe(false);
});
it("confirms reviewed state with one native action, not browser file writes", async () => {
  Object.assign(mock.session.state.record!, {
    step: "proposal",
    proposal: "Review each Friday",
  });
  const expected = structuredClone(mock.session.state.record!);
  await confirmInstructions("scope", undefined, expected);
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("onboarding_action", {
    scope: "scope",
    action: "confirm",
    expected,
  });
  expect(mock.session.retry).toHaveBeenCalledOnce();
});
it("rejects a changed proposal before requesting confirmation", async () => {
  const before = structuredClone(mock.session.state.record!);
  mock.session.state.record!.description = "Different preferences";
  await expect(confirmInstructions("scope", undefined, before)).rejects.toThrow(
    "conflict",
  );
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("does not turn failed confirmation readback into a successful save", async () => {
  mock.invoke.mockRejectedValue(
    new Error("native.onboarding.storage.durability"),
  );
  await expect(confirmInstructions("scope")).rejects.toThrow("durability");
  expect(mock.session.retry).not.toHaveBeenCalled();
  expect(mock.session.state.record?.step).toBe("method");
});
it("finishes through native storage without entering the app or dispatching children", async () => {
  Object.assign(mock.session.state.record!, {
    step: "support",
    instructionRevision: "a".repeat(40),
    ideas: [selectedIdea()],
  });
  const expected = structuredClone(mock.session.state.record!);
  await finishOnboarding("scope");
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("onboarding_action", {
    scope: "scope",
    action: "finish",
    expected,
  });
  expect(mock.session.update).not.toHaveBeenCalled();
  expect(mock.chat.send).not.toHaveBeenCalled();
});
it("honors cancellation before native action admission", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(finishOnboarding("scope", controller.signal)).rejects.toThrow();
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("refreshes changed working instructions through native recovery before presenting", async () => {
  Object.assign(mock.session.state.record!, {
    step: "proposal",
    proposal: "Review weekly",
  });
  await recoverSetupQuestion("scope");
  expect(mock.invoke).toHaveBeenCalledWith("onboarding_action", {
    scope: "scope",
    action: "recover",
    expected: null,
  });
  expect(mock.chat.presentQuestion).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.objectContaining({ action: "method" }),
    }),
  );
  expect(mock.session.update).not.toHaveBeenCalled();
});
it("retains the prior proposal before native recovery replaces its reviewed bytes", async () => {
  Object.assign(mock.session.state.record!, {
    step: "proposal",
    proposal: "Original rules",
  });
  const original = mock.invoke.getMockImplementation()!;
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "onboarding_action" && args.action === "recover")
      mock.session.state.record!.proposal = "Externally changed rules";
    return original(command, args);
  });
  await recoverSetupQuestion("scope");
  expect(
    mock.chat.presentQuestion.mock.calls.map(
      ([question]) => question.context.record.proposal,
    ),
  ).toEqual(["Original rules", "Externally changed rules"]);
});
it("keeps accepted questions for native retry instead of redispatching effects", async () => {
  Object.assign(mock.session.state.record!, {
    step: "proposal",
    proposal: "Review weekly",
  });
  const question = setupQuestion("scope", "setup")!;
  mock.chat.state.questionActionPending = question.id;
  await expect(recoverSetupQuestion("scope")).rejects.toThrow("conflict");
  expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
});
it("does not add a mandatory optional-plugin question", async () => {
  mock.session.state.record!.step = "support";
  await recoverSetupQuestion("scope");
  expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
});
it.each(["sources", "review"] as const)(
  "continues %s through an explicit native support choice after informational replies",
  async (step) => {
    Object.assign(mock.session.state.record!, {
      step,
      instructionRevision: "a".repeat(40),
      feedback: "Three attachments remain unavailable.",
      imported: [
        {
          kind: "live",
          workspaceId: "scope",
          path: "Reading notes.md",
          anchorRevision: "b".repeat(40),
        },
      ],
    });
    const before = structuredClone(mock.session.state.record!);
    const original = setupQuestion("scope", "setup")!;
    mock.chat.state.questions = [
      {
        ...original,
        status: "answered",
        timestamp: 1,
        answer: { text: "Which files are missing?" },
      },
      {
        ...original,
        id: "follow-up",
        status: "answered",
        timestamp: 2,
        answer: { text: "Continue when ready" },
      },
    ];
    mock.chat.state.draft = "Keep this unsent question";
    await continueSetupSupport("scope", before);
    const presented = mock.chat.presentQuestion.mock.calls[0][0];
    expect(presented.context).toMatchObject({
      action: "import",
      record: before,
    });
    expect(mock.chat.answerQuestion).toHaveBeenCalledExactlyOnceWith({
      questionId: presented.id,
      choiceId: "support",
    });
    expect(
      mock.chat.state.questions.slice(0, 2).map((item) => item.status),
    ).toEqual(["answered", "answered"]);
    expect(mock.session.state.record).toEqual(before);
    expect(mock.session.update).not.toHaveBeenCalled();
    expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual([
      "ai_conversation_read",
    ]);
    expect(mock.chat.send).not.toHaveBeenCalled();
    expect(mock.chat.saveDraft).not.toHaveBeenCalled();
    expect(mock.chat.state.draft).toBe("Keep this unsent question");
  },
);
it("releases support admission while the native answer's model turn remains pending", async () => {
  Object.assign(mock.session.state.record!, {
    step: "sources",
    instructionRevision: "a".repeat(40),
  });
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  mock.chat.answerQuestion.mockReturnValueOnce(completion);
  const admitted = vi.fn();
  const operation = continueSetupSupport(
    "scope",
    structuredClone(mock.session.state.record!),
  ).then(admitted);
  await flushPromises();
  try {
    expect(mock.chat.answerQuestion).toHaveBeenCalledOnce();
    expect(admitted).toHaveBeenCalledWith({ completion });
  } finally {
    finish();
    await operation;
  }
});
it("uses a still-pending import question without replacing its persisted context", async () => {
  Object.assign(mock.session.state.record!, {
    step: "sources",
    instructionRevision: "a".repeat(40),
  });
  delete mock.session.state.record!.fresh;
  delete mock.session.state.record!.intent;
  const question = setupQuestion("scope", "setup")!;
  mock.chat.state.questions = [
    { ...question, status: "pending", timestamp: 1 },
  ];
  await continueSetupSupport(
    "scope",
    structuredClone(mock.session.state.record!),
  );
  expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
  expect(mock.chat.answerQuestion).toHaveBeenCalledWith({
    questionId: question.id,
    choiceId: "support",
  });
});
it.each([
  "running",
  "unsaved",
  "questionBusy",
  "questionActionPending",
  "attachmentBusy",
] as const)(
  "does not continue support while %s protects active or uncertain work",
  async (field) => {
    Object.assign(mock.session.state.record!, {
      step: "sources",
      instructionRevision: "a".repeat(40),
    });
    Object.assign(mock.chat.state, {
      [field]: field === "questionActionPending" ? "accepted" : true,
    });
    await expect(
      continueSetupSupport(
        "scope",
        structuredClone(mock.session.state.record!),
      ),
    ).rejects.toThrow("conflict");
    expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
    expect(mock.chat.answerQuestion).not.toHaveBeenCalled();
  },
);
it("does not present or answer support while dictation owns the setup composer", async () => {
  Object.assign(mock.session.state.record!, {
    step: "sources",
    instructionRevision: "a".repeat(40),
  });
  mock.dictating = true;
  await expect(
    continueSetupSupport("scope", structuredClone(mock.session.state.record!)),
  ).rejects.toThrow("conflict");
  expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
  expect(mock.chat.answerQuestion).not.toHaveBeenCalled();
});
it.each(["substantive", "stale"])(
  "does not replace a %s pending question to continue support",
  async (kind) => {
    Object.assign(mock.session.state.record!, {
      step: "sources",
      instructionRevision: "a".repeat(40),
    });
    const question = setupQuestion("scope", "setup")!;
    if (kind === "substantive") delete question.context;
    else mock.session.state.record!.feedback = "Changed import scope";
    mock.chat.state.questions = [
      { ...question, status: "pending", timestamp: 1 },
    ];
    await expect(
      continueSetupSupport(
        "scope",
        structuredClone(mock.session.state.record!),
      ),
    ).rejects.toThrow("conflict");
    expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
    expect(mock.chat.answerQuestion).not.toHaveBeenCalled();
  },
);
it("rejects stale progress and unconfirmed methods instead of treating chat as confirmation", async () => {
  const before = structuredClone(mock.session.state.record!);
  await expect(continueSetupSupport("scope", before)).rejects.toThrow(
    "conflict",
  );
  Object.assign(mock.session.state.record!, {
    step: "sources",
    instructionRevision: "a".repeat(40),
  });
  const reviewed = structuredClone(mock.session.state.record!);
  mock.session.state.record!.feedback = "New missing content";
  await expect(continueSetupSupport("scope", reviewed)).rejects.toThrow(
    "conflict",
  );
  expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
  expect(mock.chat.answerQuestion).not.toHaveBeenCalled();
});
it.each([
  { step: "proposal" as const },
  { step: "support" as const },
  { step: "complete" as const },
  { entered: true },
  { paused: true },
])(
  "does not reopen or advance guidance outside the import decision: %j",
  async (patch) => {
    Object.assign(mock.session.state.record!, {
      step: "sources",
      instructionRevision: "a".repeat(40),
      ...patch,
    });
    await expect(
      continueSetupSupport(
        "scope",
        structuredClone(mock.session.state.record!),
      ),
    ).rejects.toThrow("conflict");
    expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
    expect(mock.chat.answerQuestion).not.toHaveBeenCalled();
  },
);
it("does not submit support after cancellation or failed question persistence", async () => {
  Object.assign(mock.session.state.record!, {
    step: "sources",
    instructionRevision: "a".repeat(40),
  });
  const expected = structuredClone(mock.session.state.record!);
  const controller = new AbortController();
  controller.abort();
  await expect(
    continueSetupSupport("scope", expected, controller.signal),
  ).rejects.toThrow();
  expect(mock.chat.presentQuestion).not.toHaveBeenCalled();
  mock.chat.presentQuestion.mockRejectedValueOnce(
    new Error("question save failed"),
  );
  await expect(continueSetupSupport("scope", expected)).rejects.toThrow(
    "question save failed",
  );
  expect(mock.chat.answerQuestion).not.toHaveBeenCalled();
  expect(mock.session.state.record).toEqual(expected);
});
it("requires confirmed instructions and model access to enter the app", async () => {
  await expect(enterSetupApp("scope")).rejects.toThrow("incomplete");
  Object.assign(mock.session.state.record!, {
    step: "sources",
    instructionRevision: "a".repeat(40),
  });
  const expected = structuredClone(mock.session.state.record!);
  await enterSetupApp("scope");
  expect(mock.invoke).toHaveBeenCalledWith("onboarding_action", {
    scope: "scope",
    action: "enter",
    expected,
  });
  expect(mock.session.update).not.toHaveBeenCalled();
  expect(mock.session.retry).toHaveBeenCalledOnce();
  expect(mock.chat.send).not.toHaveBeenCalled();
});
it.each(["sources", "review", "support", "complete"] as const)(
  "ends %s guidance through the native host without interrupting retained work",
  async (step) => {
    Object.assign(mock.session.state.record!, {
      step,
      instructionRevision: "a".repeat(40),
      ideas: [selectedIdea()],
    });
    mock.chat.state.running = true;
    mock.chat.state.draft = "Keep this import clarification";
    const expected = structuredClone(mock.session.state.record!);
    await enterSetupApp("scope");
    expect(mock.invoke.mock.calls).toEqual([
      ["ai_status", { scope: "scope" }],
      ["onboarding_action", { scope: "scope", action: "enter", expected }],
    ]);
    expect(mock.session.update).not.toHaveBeenCalled();
    expect(mock.session.retry).toHaveBeenCalledOnce();
    expect(mock.chat.state.running).toBe(true);
    expect(mock.chat.state.draft).toBe("Keep this import clarification");
    expect(mock.chat.send).not.toHaveBeenCalled();
  },
);
it("returns to completed guidance without model access or redispatch", async () => {
  Object.assign(mock.session.state.record!, {
    step: "complete",
    entered: true,
    instructionRevision: "a".repeat(40),
  });
  mock.invoke.mockRejectedValue(new Error("offline"));
  await enterSetupApp("scope");
  expect(mock.invoke).not.toHaveBeenCalled();
  expect(mock.session.update).not.toHaveBeenCalled();
});
it("migrates entered unfinished guidance through native completion without checking model access", async () => {
  Object.assign(mock.session.state.record!, {
    step: "sources",
    entered: true,
    instructionRevision: "a".repeat(40),
  });
  const expected = structuredClone(mock.session.state.record!);
  await enterSetupApp("scope");
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("onboarding_action", {
    scope: "scope",
    action: "enter",
    expected,
  });
  expect(mock.session.update).not.toHaveBeenCalled();
});
it("does not replay an uncertain native entry or claim completion", async () => {
  Object.assign(mock.session.state.record!, {
    step: "sources",
    entered: true,
    instructionRevision: "a".repeat(40),
  });
  mock.invoke.mockRejectedValue(
    new Error("native.onboarding.storage.durability"),
  );
  await expect(enterSetupApp("scope")).rejects.toThrow("durability");
  expect(mock.invoke).toHaveBeenCalledOnce();
  expect(mock.session.retry).not.toHaveBeenCalled();
  expect(mock.session.update).not.toHaveBeenCalled();
  expect(mock.session.state.record).toMatchObject({ step: "sources" });
});
it("delegates connection checks without building a frontend agent", async () => {
  const signal = new AbortController().signal;
  await checkSetupAccess("scope", signal);
  expect(mock.check).toHaveBeenCalledWith("scope", signal);
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("dispatches only explicitly selected retained development children", async () => {
  const record = {
    ...mock.session.state.record!,
    step: "complete" as const,
    ideas: [selectedIdea()],
  };
  mock.chat.state.draft = "Build a reading view";
  mock.invoke.mockResolvedValue({ conversation: child(), ready: true });
  expect(await startSetupDevelopments("scope", record)).toEqual([]);
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith(
    "onboarding_development_prepare",
    { scope: "scope", developmentId: childId },
  );
  expect(mock.chat.send).toHaveBeenCalledOnce();
});
it("does not replay a retained development conversation", async () => {
  const record = {
    ...mock.session.state.record!,
    step: "complete" as const,
    ideas: [selectedIdea()],
  };
  mock.invoke.mockResolvedValue({
    conversation: {
      ...child(),
      messages: [
        { role: "user", content: "Build a reading view", timestamp: 1 },
      ],
    },
    ready: true,
  });
  expect(await startSetupDevelopments("scope", record)).toEqual([]);
  expect(mock.chat.send).not.toHaveBeenCalled();
});
it("preserves draft preparation failures without inventing a development start", async () => {
  const record = {
    ...mock.session.state.record!,
    step: "complete" as const,
    ideas: [selectedIdea()],
  };
  mock.invoke.mockResolvedValue({
    conversation: child(),
    ready: false,
    error: "draft unavailable",
  });
  expect(await startSetupDevelopments("scope", record)).toEqual([
    "draft unavailable",
  ]);
  expect(mock.chat.send).not.toHaveBeenCalled();
});
it("reports unstarted retained children and leaves started children alone", async () => {
  Object.assign(mock.session.state.record!, {
    step: "complete",
    ideas: [selectedIdea()],
  });
  mock.invoke.mockResolvedValue(child());
  expect(await pendingSetupDevelopments("scope")).toBe(true);
  mock.invoke.mockResolvedValue({
    ...child(),
    messages: [{ role: "user", content: "Build a reading view", timestamp: 1 }],
  });
  expect(await pendingSetupDevelopments("scope")).toBe(false);
});
