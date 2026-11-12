import "@situate/localization/onboarding";
import { t, type MessageKey } from "@situate/localization";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive, shallowReactive } from "vue";
import { newOnboardingRecord } from "./types";
import OnboardingHost from "./OnboardingHost.vue";
import OnboardingView from "./OnboardingView.vue";

const mock = vi.hoisted(() => ({
  check: vi.fn(),
  update: vi.fn(),
  retry: vi.fn(),
  restore: vi.fn(),
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
  startSetupConversation: vi.fn(),
  enterSetupApp: mock.enter,
  recoverSetupQuestion: vi.fn(),
  finishOnboarding: vi.fn(),
  continueSetupSupport: mock.support,
}));
vi.mock("../layout/runtime", () => ({ workspaceUi: vi.fn() }));
vi.mock("../ai/api", () => ({
  getStatus: async () => ({
    available: true,
    config: { provider: "openai" },
    selectedModel: "test-model",
  }),
  selectChatModel: mock.model,
}));
vi.mock("../ai/chat", () => ({
  workspaceChat: () => ({ state: mock.chatState, abortAndWait: mock.abort }),
}));
vi.mock("../dictation/runtime", () => ({
  ownsDictation: () => mock.chatState.dictating,
}));
vi.mock("../ai/AiSetup.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../ai/ChatModelPicker.vue", () => ({
  default: {
    props: ["appearance", "saving"],
    template:
      '<div class="picker" :data-appearance="appearance" :aria-disabled="saving" />',
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
    props: ["canContinueSupport", "busy", "error"],
    emits: ["action"],
    template:
      '<div><slot name="access" /><button data-support :disabled="busy || !canContinueSupport" @click="$emit(\'action\', \'support\')">Continue</button><button data-enter :disabled="busy" @click="$emit(\'action\', \'enter\')">Open app</button><slot name="notices" /></div>',
  },
}));
enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("__SITUATE_LOCALIZATION_KEYS__", true);
  vi.resetAllMocks();
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
it("permits app entry during a pending support answer and retains late failures without cancelling work", async () => {
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
  expect(wrapper.get("[data-enter]").attributes("disabled")).toBeUndefined();
  await wrapper.get("[data-enter]").trigger("click");
  await flushPromises();
  expect(mock.enter).toHaveBeenCalledExactlyOnceWith("test-workspace");
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
    expect(wrapper.get("[data-enter]").attributes("disabled")).toBeUndefined();
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
