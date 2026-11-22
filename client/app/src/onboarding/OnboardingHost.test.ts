import "@situate/localization/onboarding";
import { t, type MessageKey } from "@situate/localization";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive, shallowReactive } from "vue";
import type { Status } from "../ai/api";
import { newOnboardingRecord } from "./types";
import OnboardingHost from "./OnboardingHost.vue";
import OnboardingView from "./OnboardingView.vue";

const mock = vi.hoisted(() => ({
  check: vi.fn(),
  update: vi.fn(),
  retry: vi.fn(),
  restore: vi.fn(),
  start: vi.fn(),
  support: vi.fn(),
  enter: vi.fn(),
  abort: vi.fn(),
  chatState: {
    running: false,
    questions: [] as { id: string; status: string; context: unknown }[],
    unsaved: false,
    questionBusy: false,
    attachmentBusy: false,
    dictating: false,
    questionActionPending: undefined as string | undefined,
  },
  model: vi.fn(),
  getStatus: vi.fn<() => Promise<Status>>(),
  listen:
    vi.fn<
      (
        name: string,
        listener: (event: { payload: string }) => void,
      ) => Promise<() => void>
    >(),
  state: { record: null as unknown, loading: false },
}));
vi.mock("./session", () => ({
  currentOnboarding: () => ({ state: mock.state }),
  onboardingSession: () => ({
    state: mock.state,
    load: async () => {},
    flush: async () => {},
    update: mock.update,
    retry: mock.retry,
  }),
}));
vi.mock("./agent", () => ({
  checkSetupAccess: mock.check,
  restoreSetupConversation: mock.restore,
  startSetupConversation: mock.start,
  enterSetupApp: mock.enter,
  recoverSetupQuestion: vi.fn(),
  continueSetupSupport: mock.support,
}));
vi.mock("../layout/runtime", () => ({ workspaceUi: vi.fn() }));
vi.mock("../window-events", () => ({ listenInWindow: mock.listen }));
vi.mock("../ai/api", () => ({
  getStatus: mock.getStatus,
  selectChatModel: mock.model,
}));
const connectedStatus: Status = {
  available: true,
  config: { provider: "openai", endpoint: null },
  selectedModel: "test-model",
  modelError: null,
  reason: null,
};
vi.mock("../ai/chat", () => ({
  workspaceChat: () => ({ state: mock.chatState, abortAndWait: mock.abort }),
}));
vi.mock("../dictation/runtime", () => ({
  ownsDictation: () => mock.chatState.dictating,
}));
vi.mock("../ai/AiSetup.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../ai/ChatModelPicker.vue", () => ({
  default: {
    props: ["appearance", "saving", "selectModel"],
    template:
      '<div class="picker" :data-appearance="appearance" :aria-disabled="saving"><button v-if="selectModel" data-alternate-model @click="selectModel(\'alternate-model\')">Alternate model</button></div>',
  },
}));
vi.mock("../components/ChatPane.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("../files/RenderedFile.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("./OnboardingView.vue", () => ({
  default: {
    props: ["canContinueSupport", "busy", "error", "access", "connected"],
    emits: ["action"],
    template:
      '<div><slot v-if="access" name="access" /><slot v-else name="start-recovery" /><button data-support :disabled="busy || !canContinueSupport" @click="$emit(\'action\', \'support\')">Continue</button><button data-finish :disabled="busy" @click="$emit(\'action\', \'finish\')">Finish setup</button><slot name="notices" /></div>',
  },
}));
enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("__SITUATE_LOCALIZATION_KEYS__", true);
  vi.resetAllMocks();
  mock.getStatus.mockResolvedValue(connectedStatus);
  mock.listen.mockResolvedValue(() => {});
  mock.restore.mockResolvedValue(null);
  mock.retry.mockResolvedValue(undefined);
  mock.support.mockResolvedValue({ completion: Promise.resolve() });
  mock.chatState = reactive({
    running: false,
    questions: [],
    unsaved: false,
    questionBusy: false,
    attachmentBusy: false,
    dictating: false,
    questionActionPending: undefined,
  });
  mock.state = shallowReactive({
    record: { ...newOnboardingRecord(), step: "access" },
    loading: false,
  });
  mock.update.mockImplementation(async (patch) =>
    Object.assign(mock.state.record!, patch),
  );
});
async function host() {
  const wrapper = mount(OnboardingHost, {
    props: {
      scope: "test-workspace",
      workspaceName: "Test",
      workspacePath: "/synthetic",
    },
  });
  await flushPromises();
  return wrapper;
}
function button(wrapper: Awaited<ReturnType<typeof host>>, text: MessageKey) {
  return wrapper.findAll("button").find((item) => item.text() === t(text))!;
}
it("blocks onboarding input and its reader during recovery preparation", async () => {
  const wrapper = await host();
  await wrapper.setProps({ inert: true });
  expect(
    wrapper.findComponent(OnboardingView).attributes("inert"),
  ).toBeDefined();
  expect(wrapper.get("dialog").attributes("inert")).toBeDefined();
  await wrapper.setProps({ inert: false });
  expect(
    wrapper.findComponent(OnboardingView).attributes("inert"),
  ).toBeUndefined();
  expect(wrapper.get("dialog").attributes("inert")).toBeUndefined();
});
it("lets users change the model after a failed chat start without losing setup input", async () => {
  mock.state.record = {
    ...newOnboardingRecord(),
    step: "method",
    description: "Review open tasks on Friday",
  };
  mock.start
    .mockRejectedValueOnce(new Error("native.ai.model.chooseCatalog"))
    .mockResolvedValueOnce({ id: "setup" });
  mock.check.mockResolvedValue(undefined);
  mock.model.mockResolvedValue({
    available: true,
    config: { provider: "openai" },
    selectedModel: "alternate-model",
  });
  const wrapper = await host();
  const view = wrapper.getComponent(OnboardingView);
  view.vm.$emit("action", "start");
  await flushPromises();
  expect(view.props("access")).toBe(false);

  await button(wrapper, "onboarding.access.change").trigger("click");
  expect(view.props("access")).toBe(true);
  await wrapper.get("[data-alternate-model]").trigger("click");
  await flushPromises();
  expect(mock.model).toHaveBeenCalledWith("test-workspace", "alternate-model");
  await button(wrapper, "onboarding.access.check").trigger("click");
  await flushPromises();
  expect(view.props("access")).toBe(false);
  expect(mock.start).toHaveBeenCalledOnce();
  expect(mock.state.record).toMatchObject({
    step: "method",
    description: "Review open tasks on Friday",
  });

  view.vm.$emit("action", "start");
  await flushPromises();
  expect(mock.start).toHaveBeenCalledTimes(2);
  expect(view.props("error")).toBeUndefined();
});
it("refreshes model availability for this workspace and unsubscribes on unmount", async () => {
  const stop = vi.fn();
  mock.listen.mockResolvedValue(stop);
  const wrapper = await host();
  const view = wrapper.getComponent(OnboardingView);
  expect(view.props("connected")).toBe(true);
  expect(mock.listen).toHaveBeenCalledWith(
    "ai-models-changed",
    expect.any(Function),
  );
  const catalogChanged = mock.listen.mock.calls[0]![1];

  catalogChanged({ payload: "different-workspace" });
  await flushPromises();
  expect(mock.getStatus).toHaveBeenCalledOnce();

  mock.getStatus.mockResolvedValueOnce({
    ...connectedStatus,
    selectedModel: null,
  });
  catalogChanged({ payload: "test-workspace" });
  await flushPromises();
  expect(view.props("connected")).toBe(false);

  catalogChanged({ payload: "" });
  await flushPromises();
  expect(view.props("connected")).toBe(true);
  expect(mock.check).not.toHaveBeenCalled();
  wrapper.unmount();
  expect(stop).toHaveBeenCalledOnce();
});
it("keeps the last selection and reports a failed model refresh", async () => {
  const wrapper = await host();
  const failure = new Error("Catalog refresh failed");
  mock.getStatus.mockRejectedValueOnce(failure);
  mock.listen.mock.calls[0]![1]({ payload: "test-workspace" });
  await flushPromises();
  const view = wrapper.getComponent(OnboardingView);
  expect(view.props("error")).toBe(failure);
  expect(view.props("connected")).toBe(true);
});
it("does not let a slow model refresh replace a newer model selection", async () => {
  const wrapper = await host();
  let finishRefresh!: (status: Status) => void;
  mock.getStatus.mockReturnValueOnce(
    new Promise((resolve) => {
      finishRefresh = resolve;
    }),
  );
  mock.listen.mock.calls[0]![1]({ payload: "test-workspace" });
  mock.model.mockResolvedValueOnce({
    ...connectedStatus,
    selectedModel: "alternate-model",
  });
  await wrapper.get("[data-alternate-model]").trigger("click");
  await flushPromises();
  expect(mock.model).toHaveBeenCalledWith("test-workspace", "alternate-model");
  finishRefresh({ ...connectedStatus, selectedModel: null });
  await flushPromises();
  expect(wrapper.getComponent(OnboardingView).props("connected")).toBe(true);
});
it("refreshes native onboarding progress when a pending decision arrives before the run ends", async () => {
  mock.restore.mockResolvedValue({ id: "setup" });
  await host();
  mock.retry.mockClear();
  mock.chatState.running = true;
  mock.chatState.questions.push({
    id: "native-question",
    status: "pending",
    context: { kind: "onboarding" },
  });
  await flushPromises();
  expect(mock.retry).toHaveBeenCalledOnce();
});
it("routes explicit support continuation to the retained setup without approving free text", async () => {
  mock.restore.mockResolvedValue({ id: "setup" });
  mock.state.record = {
    ...newOnboardingRecord(),
    step: "sources",
    conversationId: "setup",
    instructionRevision: "a".repeat(40),
  };
  mock.chatState.questions = [
    {
      id: "answered-import",
      status: "answered",
      context: { kind: "onboarding" },
    },
  ];
  const wrapper = await host();
  expect(mock.support).not.toHaveBeenCalled();
  mock.chatState.running = true;
  await flushPromises();
  expect(wrapper.get("[data-support]").attributes("disabled")).toBeDefined();
  mock.chatState.running = false;
  await flushPromises();
  expect(wrapper.get("[data-support]").attributes("disabled")).toBeUndefined();
  await wrapper.get("[data-support]").trigger("click");
  await flushPromises();
  expect(mock.support).toHaveBeenCalledWith(
    "test-workspace",
    mock.state.record,
    expect.any(AbortSignal),
  );
  expect(mock.update).not.toHaveBeenCalled();
  mock.chatState.questions.push({
    id: "source-question",
    status: "pending",
    context: undefined,
  });
  await flushPromises();
  expect(wrapper.get("[data-support]").attributes("disabled")).toBeDefined();
});
it("can finish during a pending support answer and retains late failures without cancelling work", async () => {
  mock.restore.mockResolvedValue({ id: "setup" });
  mock.state.record = {
    ...newOnboardingRecord(),
    step: "sources",
    conversationId: "setup",
    instructionRevision: "a".repeat(40),
  };
  let reject!: (cause: Error) => void;
  const completion = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  mock.support.mockImplementationOnce(async () => {
    mock.chatState.running = true;
    return { completion };
  });
  const wrapper = await host();
  await wrapper.get("[data-support]").trigger("click");
  await flushPromises();
  expect(mock.chatState.running).toBe(true);
  expect(wrapper.get("[data-support]").attributes("disabled")).toBeDefined();
  expect(wrapper.get("[data-finish]").attributes("disabled")).toBeUndefined();
  await wrapper.get("[data-finish]").trigger("click");
  await flushPromises();
  expect(mock.enter).toHaveBeenCalledExactlyOnceWith(
    "test-workspace",
    expect.any(AbortSignal),
  );
  expect(wrapper.emitted("enter")).toHaveLength(1);
  expect(mock.support).toHaveBeenCalledOnce();
  expect(mock.abort).not.toHaveBeenCalled();
  const failure = new Error("onboarding.responseFailed");
  reject(failure);
  await flushPromises();
  expect(wrapper.getComponent(OnboardingView).props("error")).toBe(failure);
});
it.each(["attachmentBusy", "dictating"] as const)(
  "disables support during %s without blocking app entry",
  async (field) => {
    mock.restore.mockResolvedValue({ id: "setup" });
    mock.state.record = {
      ...newOnboardingRecord(),
      step: "sources",
      conversationId: "setup",
      instructionRevision: "a".repeat(40),
    };
    const wrapper = await host();
    mock.chatState[field] = true;
    await flushPromises();
    expect(wrapper.get("[data-support]").attributes("disabled")).toBeDefined();
    expect(wrapper.get("[data-finish]").attributes("disabled")).toBeUndefined();
    await wrapper.get("[data-support]").trigger("click");
    expect(mock.support).not.toHaveBeenCalled();
    mock.chatState[field] = false;
    await flushPromises();
    expect(
      wrapper.get("[data-support]").attributes("disabled"),
    ).toBeUndefined();
  },
);
it("keeps a stable inline status through checking, failure, retry and confirmed success", async () => {
  let reject!: (error: Error) => void;
  mock.check.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const wrapper = await host();
  expect(wrapper.get(".picker").attributes("data-appearance")).toBe("field");
  const region = wrapper.get(".setup-check-status").element;
  await button(wrapper, "onboarding.access.check").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe(
    t("onboarding.access.checking"),
  );
  expect(wrapper.get(".picker").attributes("aria-disabled")).toBe("true");
  reject(new Error("Raw provider internals"));
  await flushPromises();
  expect(wrapper.get(".setup-check-status").element).toBe(region);
  expect(wrapper.get('[role="status"]').text()).toBe(
    t("onboarding.access.failure"),
  );
  expect(wrapper.text()).not.toContain("Raw provider internals");
  expect(mock.update).not.toHaveBeenCalled();
  let saved!: () => void;
  mock.update.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        saved = resolve;
      }),
  );
  mock.check.mockResolvedValueOnce(undefined);
  await button(wrapper, "onboarding.access.retry").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe(
    t("onboarding.access.success"),
  );
  expect(wrapper.get(".setup-check-status").element).toBe(region);
  saved();
  await flushPromises();
  expect(mock.check).toHaveBeenCalledTimes(2);
});
it("stops the exact check and offers an explicit retry without reporting a failed or successful reply", async () => {
  mock.check.mockImplementation(
    (_scope, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const wrapper = await host();
  await button(wrapper, "onboarding.access.check").trigger("click");
  await flushPromises();
  await button(wrapper, "onboarding.access.cancel").trigger("click");
  await flushPromises();
  expect(mock.check.mock.calls[0][1].aborted).toBe(true);
  expect(wrapper.get('[role="status"]').text()).toBe(
    t("onboarding.access.cancelled"),
  );
  expect(button(wrapper, "onboarding.access.retry").exists()).toBe(true);
  expect(mock.update).not.toHaveBeenCalled();
});
