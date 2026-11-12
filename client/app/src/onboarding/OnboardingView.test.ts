import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { t } from "@situate/localization";
import OnboardingView from "./OnboardingView.vue";
import SetupFrame from "./SetupFrame.vue";
import { newOnboardingRecord, type OnboardingRecord } from "./types";

enableAutoUnmount(afterEach);
beforeEach(() =>
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false),
);
function render(patch: Partial<OnboardingRecord> = {}, extra = {}) {
  return mount(OnboardingView, {
    props: {
      state: { ...newOnboardingRecord(), step: "method", ...patch },
      workspacePath: "/Example/Workspace",
      busy: false,
      connected: true,
      access: false,
      accessConfigured: true,
      started: false,
      ...extra,
    },
    slots: {
      conversation: "<div data-conversation>Conversation</div>",
      access: "<div data-access>Access</div>",
    },
    global: {
      stubs: {
        SetupFrame: {
          props: ["workspace", "step", "finaleTime", "initialFrom"],
          template:
            '<div><slot name="actions"><span data-default-actions>Setup heading</span></slot><slot/><slot name="finale-actions"/></div>',
        },
      },
    },
  });
}
function button(view: ReturnType<typeof render>, text: string) {
  const found = view
    .findAll("button")
    .find((button) => button.text().includes(text));
  expect(found).toBeDefined();
  return found!;
}
describe("conversational setup presentation", () => {
  it("retains the frame heading until setup actions become available", async () => {
    const view = render();
    expect(view.find("[data-default-actions]").exists()).toBe(true);
    expect(view.find(".conversation-actions").exists()).toBe(false);
    await view.setProps({
      state: { ...view.props("state"), instructionRevision: "a".repeat(40) },
    });
    expect(view.find("[data-default-actions]").exists()).toBe(false);
    expect(view.find(".conversation-actions").exists()).toBe(true);
  });
  it("introduces the method, chat context and later choices beside the initial fields", () => {
    const view = render();
    expect(view.get("h1").text()).toBe(t("onboarding.conversation.briefTitle"));
    const explanation = view.get(".conversation-explanation");
    expect(explanation.get("h2").text()).toBe(
      t("onboarding.conversation.chatTitle"),
    );
    expect(explanation.text()).toContain(t("onboarding.conversation.chatHelp"));
    expect(view.get(".source-details").text()).toContain(
      t("onboarding.conversation.sourceHelp"),
    );
    const sourceHelp = view.get("textarea").attributes("aria-describedby");
    expect(view.get(`[id="${sourceHelp}"]`).text()).toBe(
      t("onboarding.conversation.sourceHelp"),
    );
    expect(view.get(".setup-next").text()).toContain(
      t("onboarding.conversation.laterHelp"),
    );
    expect(view.get('.setup-next button[type="submit"]').text()).toBe(
      t("onboarding.conversation.start"),
    );
    expect(view.emitted("action")).toBeUndefined();
  });
  it("preserves preferences, source drafts and disabled behavior when busy", async () => {
    const view = render({
      sourceDescription: "Existing notes",
      description: "Keep my folders",
      intent: "change",
    });
    await view.get("textarea").setValue("Updated source draft");
    await view.findAll("textarea")[1].setValue("Updated preferences");
    expect(view.emitted("patch")).toEqual([
      [{ sourceDescription: "Updated source draft" }],
      [{ description: "Updated preferences" }],
    ]);
    await view.setProps({ busy: true });
    expect(view.get("fieldset").attributes("disabled")).toBeDefined();
    expect(
      view
        .findAll("textarea")
        .every((field) => field.attributes("disabled") !== undefined),
    ).toBe(true);
    expect(
      button(view, t("onboarding.conversation.start")).attributes("disabled"),
    ).toBeDefined();
    expect(view.props("state")).toMatchObject({
      sourceDescription: "Existing notes",
      description: "Keep my folders",
      intent: "change",
    });
  });
  it("collects source details and method intent in one initial form", async () => {
    const view = render({
      sourceDescription: "My notes and tasks.",
      intent: "keep",
    });
    expect(view.findAll("form")).toHaveLength(1);
    expect(
      view.get<HTMLInputElement>('input[value="keep"]').element.checked,
    ).toBe(true);
    const sources = view.get("textarea");
    await sources.setValue("A folder of Markdown and a task list.");
    expect(view.emitted("patch")?.at(-1)).toEqual([
      { sourceDescription: "A folder of Markdown and a task list." },
    ]);
    await view.get("form").trigger("submit");
    expect(view.emitted("action")?.at(-1)).toEqual(["start"]);
  });
  it("keeps starting fresh independent from preserving a method", async () => {
    const view = render({
      intent: "keep",
      sourceDescription: "Keep this source description.",
    });
    await view.get('input[type="checkbox"]').setValue(true);
    expect(view.emitted("patch")?.at(-1)).toEqual([{ fresh: true }]);
    await view.setProps({ state: { ...view.props("state"), fresh: true } });
    expect(view.findAll("textarea")).toHaveLength(1);
    expect(
      view.get<HTMLInputElement>('input[value="keep"]').element.checked,
    ).toBe(true);
    expect(view.props("state").sourceDescription).toBe(
      "Keep this source description.",
    );
    expect(
      button(view, t("onboarding.conversation.start")).attributes("disabled"),
    ).toBeUndefined();
  });
  it("does not start without a source unless fresh start is selected", () => {
    const view = render();
    expect(
      button(view, t("onboarding.conversation.start")).attributes("disabled"),
    ).toBeDefined();
  });
  it("opens the app after method confirmation without requiring completion", async () => {
    const view = render(
      { step: "sources", instructionRevision: "a".repeat(40) },
      { started: true },
    );
    await button(view, t("onboarding.conversation.openApp")).trigger("click");
    expect(view.emitted("action")).toEqual([["enter"]]);
    expect(view.find("[data-conversation]").exists()).toBe(true);
  });
  it("offers explicit optional support after import without consuming chat feedback", async () => {
    const view = render(
      { step: "sources", instructionRevision: "a".repeat(40) },
      { started: true, canContinueSupport: true },
    );
    await button(view, t("onboardingAgent.choice.support")).trigger("click");
    expect(view.emitted("action")).toEqual([["support"]]);
    expect(view.emitted("patch")).toBeUndefined();
    expect(view.find("[data-conversation]").exists()).toBe(true);
    expect(view.getComponent(SetupFrame).props("step")).toBe(3);
    await view.setProps({ canContinueSupport: false });
    expect(
      button(view, t("onboardingAgent.choice.support")).attributes("disabled"),
    ).toBeDefined();
    await view.setProps({ state: { ...view.props("state"), step: "support" } });
    expect(view.text()).not.toContain(t("onboardingAgent.choice.support"));
  });
  it("finishes setup independently of plugin selection and keeps chat visible", async () => {
    const view = render(
      { step: "support", instructionRevision: "a".repeat(40), ideas: [] },
      { started: true, canFinish: true },
    );
    await button(view, t("onboardingAgent.choice.finish")).trigger("click");
    expect(view.emitted("action")).toEqual([["finish"]]);
    expect(view.find("[data-conversation]").exists()).toBe(true);
    await view.setProps({ canFinish: false });
    expect(
      button(view, t("onboardingAgent.choice.finish")).attributes("disabled"),
    ).toBeDefined();
  });
  it("does not allow initial app entry before a method is confirmed", () => {
    const view = render({ step: "proposal" }, { started: true });
    expect(view.text()).not.toContain(t("onboarding.conversation.openApp"));
  });
  it("keeps the same frame and conversation surface through import and support", async () => {
    const view = render(
      { step: "sources", conversationId: "setup" },
      { started: true },
    );
    const frame = view.getComponent(SetupFrame).vm;
    expect(view.find("form").exists()).toBe(false);
    expect(view.getComponent(SetupFrame).props("step")).toBe(3);
    await view.setProps({ state: { ...view.props("state"), step: "support" } });
    expect(view.getComponent(SetupFrame).vm).toBe(frame);
    expect(view.getComponent(SetupFrame).props("step")).toBe(4);
    expect(view.find("[data-conversation]").exists()).toBe(true);
  });
  it("shows device access setup without exposing the initial form or chat", () => {
    const view = render(
      { step: "access" },
      { access: true, connected: false, accessConfigured: false },
    );
    expect(view.find("[data-access]").exists()).toBe(true);
    expect(view.find("form").exists()).toBe(false);
    expect(view.find("[data-conversation]").exists()).toBe(false);
    expect(view.getComponent(SetupFrame).props("step")).toBe(1);
    expect(view.text()).not.toContain(t("onboarding.pause"));
    expect(view.text()).not.toContain(t("onboarding.conversation.openApp"));
  });
  it("blocks disconnected first entry but permits offline return after entry", async () => {
    const view = render(
      { step: "sources", instructionRevision: "a".repeat(40) },
      { access: true, connected: false },
    );
    expect(
      button(view, t("onboarding.conversation.openApp")).attributes("disabled"),
    ).toBeDefined();
    await view.setProps({ state: { ...view.props("state"), entered: true } });
    expect(
      button(view, t("onboarding.conversation.openApp")).attributes("disabled"),
    ).toBeUndefined();
  });
  it("retains paused progress until explicit resume", async () => {
    const view = render({ paused: true }, { started: true });
    expect(view.text()).toContain(t("onboarding.paused.detail"));
    await button(view, t("onboarding.resume")).trigger("click");
    expect(view.emitted("action")).toEqual([["resume"]]);
  });
});
