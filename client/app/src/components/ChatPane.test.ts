import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { shallowReactive } from "vue";
import type { ChatState } from "../ai/chat";
import type { ContentReference } from "../ai/content-references";
import ChatPane from "./ChatPane.vue";
import { onboardingSession, retainOnboarding } from "../onboarding/session";
import { newOnboardingRecord } from "../onboarding/types";
import { setupQuestion } from "../onboarding/questions";
import {
  dictation,
  dismissedPermission,
  noticePresentation,
} from "../dictation/runtime";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  settings: vi.fn(),
  files: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../files/api", () => ({ filesRequest: mocks.files }));
vi.mock("../ai/chat", () => ({ workspaceChat: mocks.chat }));
vi.mock("../ai/settings", () => ({ workspaceAiSettings: mocks.settings }));
enableAutoUnmount(afterEach);
afterEach(() => {
  vi.unstubAllGlobals();
  retainOnboarding([]);
});
const services = new Map<string, ReturnType<typeof service>>();
const live: ContentReference = {
  kind: "live",
  workspaceId: "one",
  path: "notes/current.md",
  anchorRevision: "a".repeat(40),
};
const historical: ContentReference = {
  kind: "historical",
  workspaceId: "one",
  path: "old.md",
  revision: "a".repeat(40),
};
const settings = {
  state: shallowReactive({
    settings: {
      version: 1,
      chat: { model: "workspace-default", thinking: "off" },
      comment: null,
      generatedComments: false,
      showInlineModel: true,
    },
    loading: false,
    saving: false,
    error: "",
  }),
  refresh: vi.fn(),
  save: vi.fn(),
};
function service() {
  const state = shallowReactive<ChatState>({
    questions: [],
    questionBusy: false,
    ephemeral: false,
    draft: "Shared draft",
    draftSelection: null,
    dictationNotice: null,
    dictationInserted: 0,
    draftAttachments: [],
    draftReferences: [],
    runReferences: [],
    pending: [],
    transcript: [{ role: "user", content: "Earlier message", timestamp: 1 }],
    workBlocks: [],
    toolActivity: [],
    compacting: false,
    activityComment: "",
    activityError: "",
    attachmentBusy: false,
    title: "Topic",
    messages: [],
    error: "",
    running: false,
    submitting: false,
    unsaved: false,
    selectingModel: false,
    selectionError: "",
    selectionUncertain: false,
    status: {
      config: { provider: "custom", endpoint: "http://localhost:8888/v1" },
      available: true,
      reason: null,
      selectedModel: "conversation-model",
      modelError: null,
    },
  });
  return {
    state,
    refresh: vi.fn().mockResolvedValue(undefined),
    selectThinking: vi.fn(async () => true),
    selectModel: vi.fn(async (model: string | null) => {
      state.status = {
        ...state.status!,
        selectedModel: model ?? "workspace-default",
        modelInherited: model === null,
      };
      return true;
    }),
    inheritModel: vi.fn(async () => {
      state.status = { ...state.status!, selectedModel: "workspace-default" };
      return true;
    }),
    removeReference: vi.fn(async (reference: ContentReference) => {
      state.draftReferences = state.draftReferences.filter(
        (item) => item !== reference,
      );
    }),
    send: vi.fn(),
    answerQuestion: vi.fn(),
    retryQuestionAction: vi.fn(),
    abort: vi.fn(),
    recallPending: vi.fn(),
    addAttachment: vi.fn(),
    retrySave: vi.fn(),
  };
}
beforeEach(() => {
  dictation.owner = null;
  dictation.busy = false;
  noticePresentation.value = null;
  dismissedPermission.value = null;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  mocks.files.mockReset().mockResolvedValue({
    status: "ok",
    reference: live,
    document: {
      path: "archive/current.md",
      version: { text: "Current", revision: "current" },
      html: "",
      issues: [],
    },
  });
  mocks.invoke.mockReset().mockResolvedValue({ files: [] });
  services.clear();
  mocks.chat.mockReset().mockImplementation((scope: string, id = "legacy") => {
    const key = `${scope}:${id}`;
    if (!services.has(key)) services.set(key, service());
    return services.get(key);
  });
  mocks.settings.mockReset().mockReturnValue(settings);
  settings.save.mockReset();
  settings.refresh.mockReset().mockResolvedValue(undefined);
  settings.state.loading = false;
  settings.state.saving = false;
  settings.state.error = "";
});
test("ending guidance retires its decision controls but preserves ordinary import questions", async () => {
  const session = onboardingSession("one");
  session.state.record = {
    ...newOnboardingRecord(),
    step: "sources",
    conversationId: "topic",
    instructionRevision: "a".repeat(40),
  };
  const chat = service();
  chat.state.questions = [
    { ...setupQuestion("one", "topic")!, status: "pending", timestamp: 1 },
  ];
  mocks.chat.mockReturnValue(chat);
  const wrapper = pane();
  await flushPromises();
  expect(wrapper.find(".question-dock").exists()).toBe(true);
  session.state.record = {
    ...session.state.record!,
    step: "complete",
    entered: true,
  };
  await flushPromises();
  expect(wrapper.find(".question-dock").exists()).toBe(false);
  expect(wrapper.get("textarea").element.value).toBe("Shared draft");
  expect(wrapper.findComponent({ name: "ChatComposer" }).props()).toMatchObject(
    { connected: true, modelSelected: true, busy: false },
  );
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(chat.send).toHaveBeenCalled();
  expect(chat.answerQuestion).not.toHaveBeenCalled();
  chat.state.questions = [
    {
      id: "clarification",
      prompt: "Which source folder?",
      status: "pending",
      timestamp: 2,
    },
  ];
  await flushPromises();
  expect(wrapper.get(".question-text").text()).toBe("Which source folder?");
});
test("enqueue acknowledgements disable sending but preserve editable follow-up text", async () => {
  const chat = service();
  chat.state.running = true;
  chat.state.submitting = true;
  mocks.chat.mockReturnValue(chat);
  const wrapper = pane();
  await flushPromises();
  const field = wrapper.get<HTMLTextAreaElement>("textarea");
  await field.setValue("Next follow-up");
  const queue = wrapper.get('button[aria-label="⟦chat.queueSteering⟧"]');
  expect(field.element.readOnly).toBe(false);
  expect(queue.attributes("disabled")).toBeDefined();
  await field.trigger("keydown", { key: "Enter", altKey: true });
  expect(chat.send).not.toHaveBeenCalled();
  chat.state.submitting = false;
  await flushPromises();
  expect(field.element.value).toBe("Next follow-up");
  expect(queue.attributes("disabled")).toBeUndefined();
  await field.trigger("keydown", { key: "Enter", altKey: true });
  expect(chat.send).toHaveBeenCalledExactlyOnceWith("followUp");
});

test("embedded question choices and written answers share the real draft and full composer", async () => {
  const chat = service();
  chat.state.questions = [
    {
      id: "q",
      prompt: "Where should we begin?",
      suggestions: [{ id: "tasks", label: "Tasks" }],
      status: "pending",
      timestamp: 1,
    },
  ];
  chat.state.status = null;
  mocks.chat.mockReturnValue(chat);
  const wrapper = pane({ embedded: true });
  await flushPromises();
  expect(wrapper.find(".pane-header").exists()).toBe(false);
  expect(wrapper.find(".question-dock .chat-composer").exists()).toBe(true);
  expect(wrapper.find(".question-dock .attach-action").exists()).toBe(true);
  await wrapper.get(".question-options button").trigger("click");
  expect(chat.answerQuestion).toHaveBeenCalledWith({
    questionId: "q",
    choiceId: "tasks",
  });
  expect(chat.state.draft).toBe("Shared draft");
  await wrapper.get("textarea").setValue("My own starting point");
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(chat.answerQuestion).toHaveBeenLastCalledWith({
    questionId: "q",
    text: "My own starting point",
  });
  expect(chat.send).not.toHaveBeenCalled();
  wrapper.unmount();
});

test("collapsing a question preserves the draft and attachments, and a new question opens expanded", async () => {
  const chat = service();
  chat.state.questions = [
    {
      id: "first",
      prompt: "Where should we begin?",
      status: "pending",
      timestamp: 1,
    },
  ];
  chat.state.draftAttachments = [
    { id: "note", name: "note.txt", mimeType: "text/plain", size: 4 },
  ];
  mocks.chat.mockReturnValue(chat);
  const wrapper = pane();
  await flushPromises();
  const toggle = wrapper.get(".question-disclosure");
  expect(wrapper.find(".question-summary").exists()).toBe(false);
  const panel = wrapper.get("#" + toggle.attributes("aria-controls"));
  await toggle.trigger("click");
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(panel.isVisible()).toBe(false);
  expect(chat.state.draft).toBe("Shared draft");
  expect(chat.state.draftAttachments).toHaveLength(1);
  expect(chat.answerQuestion).not.toHaveBeenCalled();
  await toggle.trigger("click");
  expect(panel.isVisible()).toBe(true);
  await toggle.trigger("click");
  chat.state.questions = [
    { id: "second", prompt: "What next?", status: "pending", timestamp: 2 },
  ];
  await flushPromises();
  expect(toggle.attributes("aria-expanded")).toBe("true");
  expect(panel.isVisible()).toBe(true);
  expect(wrapper.get(".question-text").text()).toBe("What next?");
  expect(chat.state.draft).toBe("Shared draft");
});

test.each([false, true])(
  "question preview opens read-only exact details without answering or changing draft (embedded %s)",
  async (embedded) => {
    const chat = service();
    chat.state.questions = [
      {
        id: "q",
        prompt: "Review?",
        status: "pending",
        timestamp: 1,
        preview: {
          title: "AGENTS.md",
          summary: "Current proposal",
          text: "# Exact recovered proposal\n\nKeep these instructions.",
        },
      },
    ];
    chat.state.draftAttachments = [
      { id: "note", name: "note.txt", mimeType: "text/plain", size: 4 },
    ];
    mocks.chat.mockReturnValue(chat);
    const wrapper = pane({ embedded });
    await flushPromises();
    const calls = mocks.invoke.mock.calls.length;
    await wrapper.get(".question-preview").trigger("click");
    await flushPromises();
    const dialog = wrapper.get<HTMLDialogElement>(".question-preview-dialog");
    expect(dialog.element.open).toBe(true);
    expect(dialog.get("h2").text()).toBe("AGENTS.md");
    expect(dialog.get(".question-preview-summary").text()).toBe(
      "Current proposal",
    );
    expect(dialog.get(".chat-markdown").text()).toContain(
      "Exact recovered proposal",
    );
    expect(dialog.find("textarea").exists()).toBe(false);
    expect(chat.state.draft).toBe("Shared draft");
    expect(chat.state.draftAttachments).toHaveLength(1);
    expect(chat.answerQuestion).not.toHaveBeenCalled();
    expect(chat.send).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls).toHaveLength(calls);
    await dialog.get("button").trigger("click");
    expect(wrapper.find(".question-preview-dialog").exists()).toBe(false);
    expect(chat.state.draft).toBe("Shared draft");
    wrapper.unmount();
  },
);

function pane(props: Record<string, unknown> = {}) {
  const wrapper = mount(ChatPane, {
    attachTo: document.body,
    props: {
      workspaceScope: "one",
      conversationId: "topic",
      embedded: true,
      ...props,
    },
    global: { stubs: { ChatTranscript: true, ChatActivity: true } },
  });
  const viewport = wrapper.find(".transcript-scroll");
  if (viewport.exists())
    Object.defineProperties(viewport.element, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true },
    });
  return wrapper;
}

test("two presentations of one draft show one recovery dialog and dismiss permission guidance once", async () => {
  const first = pane();
  const second = pane();
  await flushPromises();
  services.get("one:topic")!.state.dictationNotice = "noSpeech";
  await flushPromises();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  const shown = first.find("dialog").exists() ? first : second;
  await shown.get("button[autofocus]").trigger("click");
  await flushPromises();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);
  dictation.owner = {
    id: "permission",
    scope: "one",
    conversation: "topic",
    phase: "permission",
  };
  await flushPromises();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  const permission = first.find("dialog").exists() ? first : second;
  await permission.get("button[autofocus]").trigger("click");
  await flushPromises();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);
  expect(dictation.owner?.phase).toBe("permission");
});

test("permission guidance closes automatically when recording starts", async () => {
  const wrapper = pane();
  dictation.owner = {
    id: "permission",
    scope: "one",
    conversation: "topic",
    phase: "permission",
  };
  await flushPromises();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);

  dictation.owner = { ...dictation.owner, phase: "recording" };
  await flushPromises();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);
  expect(services.get("one:topic")!.state.dictationNotice).toBeNull();
  expect(
    wrapper.getComponent({ name: "ChatComposer" }).props("dictationPhase"),
  ).toBe("recording");
});

test("dismissing a save failure retains the response and draft until explicit recovery succeeds", async () => {
  const wrapper = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  chat.state.transcript = [
    {
      role: "assistant",
      content: [{ type: "text", text: "Retained response" }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1,
    },
  ];
  chat.state.error = "ai.theConversationCouldNotBeSavedKeepThisWorkspace";
  chat.state.unsaved = true;
  await flushPromises();
  const dialog = () =>
    wrapper.get<HTMLDialogElement>('dialog[aria-labelledby$="-save-title"]');
  expect(dialog().element.open).toBe(true);
  await dialog().get("button[autofocus]").trigger("click");
  await flushPromises();
  expect(dialog().element.open).toBe(false);
  expect(chat.state.unsaved).toBe(true);
  expect(chat.state.transcript[0]!.content).toEqual([
    { type: "text", text: "Retained response" },
  ]);
  await wrapper.get("textarea").setValue("Still editing the draft");
  expect(dialog().element.open).toBe(false);
  expect(chat.state.draft).toBe("Still editing the draft");
  expect(wrapper.get(".save-recovery button").classes()).toContain(
    "situate-button--secondary",
  );
  await wrapper.get(".save-recovery button").trigger("click");
  await flushPromises();
  expect(chat.retrySave).toHaveBeenCalledOnce();
  expect(chat.state.unsaved).toBe(true);
  expect(dialog().element.open).toBe(true);
  chat.retrySave.mockImplementationOnce(() => {
    chat.state.unsaved = false;
    chat.state.error = "";
  });
  await dialog().get("button:not([autofocus])").trigger("click");
  await flushPromises();
  expect(chat.state.unsaved).toBe(false);
  expect(wrapper.find(".save-recovery").exists()).toBe(false);
  expect(wrapper.find('dialog[aria-labelledby$="-save-title"]').exists()).toBe(
    false,
  );
  expect(chat.state.transcript[0]!.content).toEqual([
    { type: "text", text: "Retained response" },
  ]);
  expect(chat.state.draft).toBe("Still editing the draft");
});

test("late save recovery failures remain with their conversation after navigation", async () => {
  const wrapper = pane();
  await flushPromises();
  const first = services.get("one:topic")!;
  first.state.unsaved = true;
  await flushPromises();
  let reject!: (reason: unknown) => void;
  first.retrySave.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  await wrapper
    .get('dialog[aria-labelledby$="-save-title"] button:not([autofocus])')
    .trigger("click");
  await wrapper.setProps({ conversationId: "other" });
  await flushPromises();
  const other = services.get("one:other")!;
  other.state.unsaved = true;
  other.state.error = "ai.theConversationCouldNotBeSavedKeepThisWorkspace";
  reject("native.ai.model.savedUnavailable");
  await flushPromises();
  const dialog = wrapper.get('dialog[aria-labelledby$="-save-title"]');
  expect(dialog.get('[role="alert"]').text()).toBe(
    "⟦ai.theConversationCouldNotBeSavedKeepThisWorkspace⟧",
  );
  expect(
    dialog.get("button:not([autofocus])").attributes("disabled"),
  ).toBeUndefined();
  expect(other.retrySave).not.toHaveBeenCalled();
  expect(first.state.unsaved).toBe(true);
});

test.each([false, true])(
  "response failures use a dismissible dialog without losing work (development=%s)",
  async (development) => {
    const wrapper = pane();
    await flushPromises();
    const chat = services.get("one:topic")!;
    if (development) Object.assign(chat.state, { development: { version: 2 } });
    await vi.dynamicImportSettled();
    const error = "ai.theResponseFailedCheckAIAccessReconnectIfYour";
    chat.state.error = error;
    await flushPromises();
    const dialog = () =>
      wrapper.get<HTMLDialogElement>('dialog[aria-labelledby$="-error-title"]');
    expect(dialog().element.open).toBe(true);
    expect(dialog().get('[role="alert"]').text()).toBe(`⟦${error}⟧`);
    expect(wrapper.find(".chat-footer > p[role=alert]").exists()).toBe(false);
    await dialog().get("button").trigger("click");
    await flushPromises();
    expect(dialog().element.open).toBe(false);
    expect(chat.state.error).toBe(error);
    expect(chat.state.transcript).toHaveLength(1);
    expect(chat.state.draft).toBe("Shared draft");
    expect(chat.send).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(wrapper.get("textarea").element);
    await wrapper.get("textarea").setValue("Retained new input");
    expect(dialog().element.open).toBe(false);
    chat.state.error = "";
    await flushPromises();
    chat.state.error = error;
    await flushPromises();
    expect(dialog().element.open).toBe(true);
    await dialog().trigger("cancel");
    await flushPromises();
    expect(dialog().element.open).toBe(false);
    expect(chat.state.draft).toBe("Retained new input");
    await wrapper.setProps({ conversationId: "other" });
    await flushPromises();
    expect(
      wrapper.find('dialog[aria-labelledby$="-error-title"]').exists(),
    ).toBe(false);
  },
);

test("uncertain model readback stays with model-selection recovery", async () => {
  const wrapper = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  Object.assign(chat.state, {
    selectionUncertain: true,
    selectionError: "native.ai.model.savedUnavailable",
    error: "ai.aiAccessOrConversationHistoryCouldNotBeRead",
  });
  await flushPromises();
  expect(wrapper.find('dialog[aria-labelledby$="-error-title"]').exists()).toBe(
    false,
  );
  expect(chat.state.error).toBe(
    "ai.aiAccessOrConversationHistoryCouldNotBeRead",
  );
});

test("load failures do not open a dialog inside hidden conversation content", async () => {
  const wrapper = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  Object.assign(chat.state, {
    loadError: "references.unavailable",
    error: "ai.aiAccessOrConversationHistoryCouldNotBeRead",
  });
  await flushPromises();
  expect(wrapper.find(".chat-load-error").exists()).toBe(true);
  expect(wrapper.find('dialog[aria-labelledby$="-error-title"]').exists()).toBe(
    false,
  );
});

test("save recovery takes precedence over a response error dialog", async () => {
  const wrapper = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  chat.state.error = "ai.theResponseFailedCheckAIAccessReconnectIfYour";
  await flushPromises();
  expect(
    wrapper.get<HTMLDialogElement>('dialog[aria-labelledby$="-error-title"]')
      .element.open,
  ).toBe(true);
  chat.state.unsaved = true;
  chat.state.error = "ai.theConversationCouldNotBeSavedKeepThisWorkspace";
  await flushPromises();
  expect(wrapper.find('dialog[aria-labelledby$="-error-title"]').exists()).toBe(
    false,
  );
  expect(
    wrapper.get<HTMLDialogElement>('dialog[aria-labelledby$="-save-title"]')
      .element.open,
  ).toBe(true);
  expect(wrapper.findAll("dialog[open]")).toHaveLength(1);
});

test("development shares the live composer, model and transcript", async () => {
  const wrapper = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  Object.assign(chat.state, {
    development: {
      pluginId: "sample",
      draftId: "draft-one",
      originConversationId: "original",
    },
  });
  await vi.dynamicImportSettled();
  await flushPromises();
  expect(wrapper.find(".plugin-development .chat-pane-header").exists()).toBe(
    true,
  );
  expect(wrapper.get(".chat-context").text()).toContain(
    "⟦pluginDevelopment.context⟧",
  );
  expect(wrapper.text()).not.toContain("draft-one");
  expect(wrapper.get("textarea").element.value).toBe("Shared draft");
  expect(wrapper.find(".manual-trigger").exists()).toBe(true);
  await wrapper.get(".development-help-trigger").trigger("click");
  expect(wrapper.get(".development-help").text()).toContain(
    "⟦pluginDevelopment.helpScope⟧",
  );
  await wrapper.get(".development-help").trigger("cancel");
  expect(document.activeElement).toBe(
    wrapper.get(".development-help-trigger").element,
  );
  await wrapper.get("textarea").setValue("Keep the real draft");
  expect(chat.state.draft).toBe("Keep the real draft");
  chat.state.running = true;
  await flushPromises();
  await wrapper.get(".stop-action").trigger("click");
  expect(chat.abort).toHaveBeenCalledOnce();
});

test.each([false, true])(
  "load errors preserve visible conversation and draft with recovery actions (development=%s)",
  async (development) => {
    const wrapper = pane();
    await flushPromises();
    const chat = services.get("one:topic")!;
    if (development)
      Object.assign(chat.state, {
        development: {
          pluginId: "sample",
          draftId: "draft-one",
          originConversationId: "original",
        },
      });
    await vi.dynamicImportSettled();
    await flushPromises();
    const composer = wrapper.get("textarea").element;
    Object.assign(chat.state, { loadError: "references.unavailable" });
    await flushPromises();
    expect(wrapper.get(".chat-load-error > span").text()).toBe(
      "⟦references.unavailable⟧",
    );
    expect(wrapper.get(".chat-load-error").findAll("button")).toHaveLength(2);
    expect(wrapper.get(".empty-chat").isVisible()).toBe(true);
    if (development)
      expect(wrapper.get(".chat-pane-header").isVisible()).toBe(true);
    expect(chat.state.draft).toBe("Shared draft");
    expect(chat.state.transcript).toHaveLength(1);
    Object.assign(chat.state, { loadError: undefined });
    await flushPromises();
    expect(wrapper.get("textarea").element).toBe(composer);
    expect(chat.refresh).toHaveBeenCalledOnce();
    chat.state.error = "chat.modelUnavailable";
    await flushPromises();
    expect(wrapper.find(".chat-load-error").exists()).toBe(false);
    expect(wrapper.get(".empty-chat").isVisible()).toBe(true);
  },
);

test("active and interrupted work remains visible before any retained message", async () => {
  const wrapper = mount(ChatPane, {
    attachTo: document.body,
    props: { workspaceScope: "one", conversationId: "topic", embedded: true },
    global: { stubs: { ChatActivity: true } },
  });
  await flushPromises();
  const chat = services.get("one:topic")!;
  chat.state.transcript = [];
  chat.state.running = true;
  chat.state.activeWork = {
    id: "work",
    startMessageCount: 0,
    startedAt: performance.now(),
  };
  await flushPromises();
  expect(wrapper.get(".empty-chat").classes()).toContain("has-history");
  expect(wrapper.get('[role="timer"]').isVisible()).toBe(true);
  chat.state.running = false;
  chat.state.activeWork = undefined;
  chat.state.workBlocks = [
    {
      id: "work",
      startMessageCount: 0,
      messageCount: 0,
      outcome: "interrupted",
    },
  ];
  await flushPromises();
  expect(wrapper.find('[role="timer"]').exists()).toBe(false);
  expect(wrapper.get(".work-history-time").text()).toBe("⟦chat.interrupted⟧");
  expect(wrapper.get(".transcript-scroll").isVisible()).toBe(true);
});

test("interruptions stay visible in work history while save and access errors retain recovery", async () => {
  const wrapper = mount(ChatPane, {
    attachTo: document.body,
    props: { workspaceScope: "one", conversationId: "topic", embedded: true },
    global: { stubs: { ChatActivity: true } },
  });
  await flushPromises();
  const chat = services.get("one:topic")!;
  chat.state.workBlocks = [
    {
      id: "work",
      startMessageCount: 0,
      messageCount: 1,
      durationMs: 1200,
      outcome: "error",
    },
  ];
  chat.state.error = "native.ai.response.interrupted";
  await flushPromises();
  expect(wrapper.find(".chat-footer [role=alert]").exists()).toBe(false);
  expect(wrapper.get(".history-failure").text()).toBe(
    "⟦native.ai.response.interrupted⟧",
  );
  expect(
    wrapper.get(".history-failure").element.closest("[hidden]"),
  ).toBeNull();
  expect(wrapper.find(".work-history-toggle").exists()).toBe(false);
  chat.state.error = "native.ai.access.rejected";
  await flushPromises();
  expect(wrapper.get(".chat-footer [role=alert]").text()).toBe(
    "⟦native.ai.access.rejected⟧",
  );
  chat.state.questionActionPending = "question";
  chat.state.error = "native.ai.response.interrupted";
  await flushPromises();
  expect(wrapper.get(".chat-footer [role=alert]").text()).toBe(
    "⟦native.ai.response.interrupted⟧",
  );
  chat.state.unsaved = true;
  chat.state.error = "ai.theConversationCouldNotBeSavedKeepThisWorkspace";
  await flushPromises();
  expect(wrapper.get(".chat-footer [role=alert]").text()).toContain(
    "⟦ai.theConversationCouldNotBeSavedKeepThisWorkspace⟧",
  );
});

test("development welcome and navigation remain available around a load error", async () => {
  const wrapper = pane({ showNavigation: true });
  await flushPromises();
  const chat = services.get("one:topic")!;
  Object.assign(chat.state, {
    development: {
      pluginId: "sample",
      draftId: "draft-one",
      originConversationId: "original",
    },
  });
  chat.state.transcript = [];
  await vi.dynamicImportSettled();
  await flushPromises();
  expect(wrapper.text()).toContain("⟦pluginDevelopment.welcome⟧");
  Object.assign(chat.state, { loadError: "references.unavailable" });
  await flushPromises();
  const navigation = wrapper.get(
    '.chat-pane-header button[aria-label="⟦navigation.openNavigation⟧"]',
  );
  expect(navigation.isVisible()).toBe(true);
  await navigation.trigger("click");
  expect(wrapper.emitted("openNavigation")).toHaveLength(1);
});

test("new plugin notices appear in an empty chat without replacing or sending its composer", async () => {
  const wrapper = mount(ChatPane, {
    attachTo: document.body,
    props: { workspaceScope: "one", conversationId: "topic", embedded: true },
    global: { stubs: { ChatActivity: true } },
  });
  await flushPromises();
  const chat = services.get("one:topic")!;
  chat.state.transcript = [];
  await flushPromises();
  const composer = wrapper.get("textarea").element;
  composer.focus();
  composer.setSelectionRange(2, 5);
  const notice = { id: "notice-one", pluginName: "Reading list", timestamp: 3 };
  Object.assign(chat.state, {
    pluginNotices: [notice],
    pluginNoticeAnnouncement: notice,
  });
  await flushPromises();
  expect(wrapper.get("[role=note]").isVisible()).toBe(true);
  expect(wrapper.get("[aria-live=polite][role=status]").text()).toContain(
    "⟦chat.pluginAvailable",
  );
  expect(wrapper.get("textarea").element).toBe(composer);
  expect(document.activeElement).toBe(composer);
  expect(composer.selectionStart).toBe(2);
  expect(chat.send).not.toHaveBeenCalled();
  expect(chat.state.draft).toBe("Shared draft");
  await wrapper.setProps({ conversationId: "other" });
  await flushPromises();
  expect(wrapper.find("[role=note]").exists()).toBe(false);
  expect(wrapper.get("[aria-live=polite][role=status]").text()).toBe("");
});

test("embedded panes omit standalone landmarks and titles but select their explicit conversation", async () => {
  const embedded = pane();
  await flushPromises();
  expect(mocks.chat).toHaveBeenCalledWith("one", "topic");
  expect(embedded.find("main").exists()).toBe(false);
  expect(embedded.find(".pane-header").exists()).toBe(false);
  expect(embedded.find("h1").exists()).toBe(false);
  const standalone = pane({ embedded: false, conversationId: undefined });
  await flushPromises();
  expect(standalone.find("main").exists()).toBe(true);
  expect(standalone.get("h1").text()).toBe("Topic");
  expect(services.has("one:legacy")).toBe(true);
});
test("two views share draft and model but retain independent scroll and caret on remount", async () => {
  const first = pane({
    presentation: {
      scrollTop: 110,
      selectionStart: 1,
      selectionEnd: 4,
      selectionDirection: "backward",
    },
  });
  const second = pane({
    presentation: { scrollTop: 320, selectionStart: 6, selectionEnd: 6 },
  });
  await flushPromises();
  expect(first.get(".transcript-scroll").element.scrollTop).toBe(110);
  expect(second.get(".transcript-scroll").element.scrollTop).toBe(320);
  expect(first.get("textarea").element.selectionStart).toBe(1);
  await first.get("textarea").setValue("Changed shared draft");
  await flushPromises();
  expect(second.get("textarea").element.value).toBe("Changed shared draft");
  expect(second.get("textarea").element.selectionStart).toBe(6);
  await first.get(".manual-trigger").trigger("click");
  await first.get("dialog input").setValue("other-model");
  await first.get("dialog form").trigger("submit");
  await flushPromises();
  expect(
    second.get(".manual-trigger").attributes("aria-description"),
  ).toContain("other-model");
  expect(settings.save).not.toHaveBeenCalled();
  first.get(".transcript-scroll").element.scrollTop = 180;
  await first.get(".transcript-scroll").trigger("scroll");
  first.get("textarea").element.setSelectionRange(2, 5, "forward");
  await first.get("textarea").trigger("select");
  const presentation = first.emitted("presentation")!.at(-1)![0];
  expect(presentation).toMatchObject({
    scrollTop: 180,
    selectionStart: 2,
    selectionEnd: 5,
    selectionDirection: "forward",
  });
  expect(second.get(".transcript-scroll").element.scrollTop).toBe(320);
  first.unmount();
  const restored = pane({ presentation });
  await flushPromises();
  expect(restored.get(".transcript-scroll").element.scrollTop).toBe(180);
  expect(restored.get("textarea").element.selectionEnd).toBe(5);
});
test("navigating a moved Git reference preserves the original anchor in presentation", async () => {
  const wrapper = pane();
  await flushPromises();
  const reference: ContentReference = {
    kind: "live",
    workspaceId: "one",
    path: "notes/data.txt",
    anchorRevision: "a".repeat(40),
  };
  services.get("one:topic")!.state.draftReferences = [reference];
  mocks.files.mockResolvedValue({
    status: "ok",
    reference,
    document: {
      path: "archive/data.txt",
      version: { text: "Updated", revision: "new-content" },
      html: "",
      issues: [],
    },
  });
  await flushPromises();
  await wrapper.get(".draft-references .reference-open").trigger("click");
  await vi.waitFor(() =>
    expect(wrapper.emitted("navigate")).toEqual([
      [
        { kind: "view", viewId: "files", contentId: "archive/data.txt" },
        { reference },
      ],
    ]),
  );
  expect(mocks.files).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "one",
    operation: "resolveReference",
    reference,
  });
});

test.each(["messages", "notices"])(
  "new %s follow only a view already at the end",
  async (kind) => {
    const resized: (() => void)[] = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        constructor(callback: () => void) {
          resized.push(callback);
        }
      },
    );
    const first = pane({ presentation: { scrollTop: 100 } });
    const second = pane({ presentation: { scrollTop: 800 } });
    await flushPromises();
    for (const wrapper of [first, second])
      Object.defineProperties(wrapper.get(".transcript-scroll").element, {
        scrollHeight: { value: 1000, configurable: true },
        clientHeight: { value: 200, configurable: true },
      });
    for (const notify of resized) notify();
    for (const frame of frames.splice(0)) frame(0);
    const chat = services.get("one:topic")!;
    if (kind === "messages")
      chat.state.transcript = [
        ...chat.state.transcript,
        { role: "user", content: "More", timestamp: 2 },
      ];
    else
      Object.assign(chat.state, {
        pluginNotices: [
          { id: "new", pluginName: "Reading list", timestamp: 2 },
        ],
      });
    await flushPromises();
    for (const notify of resized) notify();
    for (const frame of frames.splice(0)) frame(0);
    expect(first.get(".transcript-scroll").element.scrollTop).toBe(100);
    expect(second.get(".transcript-scroll").element.scrollTop).toBe(1000);
  },
);
test("reference chips navigate live and historical targets, remove only drafts and never send", async () => {
  const wrapper = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  chat.state.draftReferences = [live, historical];
  Object.assign(chat.state, { runReferences: [historical] });
  chat.state.pending = [
    {
      id: "queued",
      kind: "followUp",
      state: "pending",
      text: "Next",
      attachments: [],
      references: [live],
      timestamp: 2,
    },
  ];
  await flushPromises();
  expect(wrapper.get(".submitted-references .reference-open").text()).toContain(
    "old.md",
  );
  expect(wrapper.find(".submitted-references .reference-remove").exists()).toBe(
    false,
  );
  const buttons = wrapper.findAll(".draft-references .reference-open");
  await buttons[0]!.trigger("click");
  await vi.waitFor(() => expect(wrapper.emitted("navigate")).toHaveLength(1));
  await buttons[1]!.trigger("click");
  expect(wrapper.emitted("navigate")).toEqual([
    [
      { kind: "view", viewId: "files", contentId: "archive/current.md" },
      { reference: live },
    ],
    [
      {
        kind: "view",
        viewId: "files",
        contentId: historical.path,
        revision: historical.revision,
      },
    ],
  ]);
  expect(wrapper.find(".pending-references .reference-remove").exists()).toBe(
    false,
  );
  await wrapper.get(".draft-references .reference-remove").trigger("click");
  await flushPromises();
  expect(chat.removeReference).toHaveBeenCalledWith(live);
  expect(wrapper.findAll(".draft-references .reference-chip")).toHaveLength(1);
  expect(chat.send).not.toHaveBeenCalled();
});
test("an unresolved reference cannot navigate to a replacement at its old path", async () => {
  const wrapper = pane();
  await flushPromises();
  services.get("one:topic")!.state.draftReferences = [live];
  mocks.files.mockResolvedValue({ status: "deleted" });
  await flushPromises();
  await wrapper.get(".reference-open").trigger("click");
  await vi.waitFor(() =>
    expect(wrapper.get("[role=alert]").text()).toBe("⟦references.unavailable⟧"),
  );
  expect(wrapper.emitted("navigate")).toBeUndefined();
  expect(wrapper.find(".reference-chip").exists()).toBe(true);
});

test("a reference lookup cannot navigate a pane after its conversation changes", async () => {
  let finish!: (reply: unknown) => void;
  mocks.files.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = pane();
  await flushPromises();
  services.get("one:topic")!.state.draftReferences = [live];
  await flushPromises();
  await wrapper.get(".reference-open").trigger("click");
  await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledOnce());
  await wrapper.setProps({ conversationId: "other" });
  finish({
    status: "ok",
    reference: live,
    document: {
      path: live.path,
      version: { text: "Current", revision: "current" },
      html: "",
      issues: [],
    },
  });
  await flushPromises();
  expect(wrapper.emitted("navigate")).toBeUndefined();
});

test("failed reference removal retains the chip and reports the localized failure", async () => {
  const wrapper = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  chat.state.draftReferences = [live];
  chat.removeReference.mockRejectedValueOnce(
    new Error("references.unavailable"),
  );
  await flushPromises();
  await wrapper.get(".reference-remove").trigger("click");
  await flushPromises();
  expect(wrapper.find(".reference-chip").exists()).toBe(true);
  expect(wrapper.get("[role=alert]").text()).toBe("⟦references.unavailable⟧");
});

test("workspace default action preserves loading guards and shared model identity", async () => {
  const first = pane();
  const second = pane();
  await flushPromises();
  const chat = services.get("one:topic")!;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  await first.get(".manual-trigger").trigger("click");
  await first.get("dialog form button").trigger("click");
  await flushPromises();
  expect(chat.selectModel).toHaveBeenCalledWith(null);
  expect(
    second.get(".manual-trigger").attributes("aria-description"),
  ).toContain("workspace-default");
  chat.state.selectingModel = true;
  await flushPromises();
  expect(first.get(".manual-trigger").attributes("disabled")).toBeDefined();
  chat.state.selectingModel = false;
  settings.state.loading = true;
  await flushPromises();
  expect(first.get(".manual-trigger").attributes("disabled")).toBeDefined();
  expect(settings.save).not.toHaveBeenCalled();
});
