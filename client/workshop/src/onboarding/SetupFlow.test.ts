import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import SetupFlow from "./SetupFlow.vue";
import {
  createOnboardingState,
  reduceOnboarding,
  type OnboardingAction,
} from "./model";
import { f } from "./flow-content";
import copy from "../localization/en.working-method.json";
import resultCopy from "../localization/en.import-result.json";
import supportCopy from "../localization/en.support-plan.json";
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
function flow(scenario: string) {
  const state = ref(createOnboardingState(scenario));
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(SetupFlow, {
          state: state.value,
          onAction: (action: OnboardingAction) => {
            state.value = reduceOnboarding(state.value, action);
          },
        }),
    }),
  );
  const click = (label: string) =>
    wrapper
      .findAll("button")
      .find((button) => button.text() === label)!
      .trigger("click");
  return { state, wrapper, click };
}
describe("setup conversations", () => {
  it("starts with a description, offers optional practices and reviews a separate adjustment", async () => {
    const { wrapper, state, click } = flow("onboarding-method");
    expect(wrapper.findAll(".method-name").map((card) => card.text())).toEqual(
      copy.methods.map((method) => method.name),
    );
    expect(wrapper.findAll(".method-info")).toHaveLength(8);
    expect(wrapper.find(".inspiration").exists()).toBe(false);
    expect(wrapper.find('input[type="radio"]').exists()).toBe(false);
    await wrapper.get("textarea").setValue(copy.example.description);
    await wrapper.findAll(".method-tile input")[0]!.setValue(true);
    await wrapper.findAll(".method-tile input")[1]!.setValue(true);
    await click(f.generate);
    expect(state.value.step).toBe("proposal");
    expect(state.value.methodDraft.limit).toBe(true);
    expect(wrapper.get(".proposal").text()).toContain("AGENTS.md");
    expect(wrapper.get("textarea").element.value).toBe("");
    await wrapper.get("textarea").setValue(copy.example.feedback);
    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text() === f.confirmMethod),
    ).toBe(false);
    await click(copy.update);
    expect(state.value.methodDraft.limit).toBe(false);
    expect(wrapper.get(".instruction-preview").text()).toContain(f.reviewNone);
    expect(wrapper.text()).toContain(copy.updated);
    expect(state.value.context).toBe(copy.example.description);
    expect(state.value.appliedFeedback).toBe(copy.example.feedback);
    await click(f.confirmMethod);
    expect(state.value.step).toBe("sources");
    expect(wrapper.findAll("textarea")).toHaveLength(1);
    expect(wrapper.find(".chat-screen").exists()).toBe(false);
    expect(state.value.methodConfirmed).toBe(true);
    wrapper.unmount();
  });
  it("shows imported contents and opens the same conversation for changes", async () => {
    const { wrapper, state, click } = flow("onboarding-samples");
    expect(wrapper.find(".file-tree").exists()).toBe(true);
    expect(wrapper.find('input[type="radio"]').exists()).toBe(false);
    expect(wrapper.find(".row-menu").exists()).toBe(false);
    expect(wrapper.find(".markdown").exists()).toBe(false);
    await click("Reading tasks.md");
    expect(wrapper.get(".markdown").text()).toContain(
      "Measure the space by the window",
    );
    expect(wrapper.get(".imported-file-path").text()).toContain(
      state.value.workspacePath,
    );
    expect(state.value.imported).toHaveLength(3);
    await click(resultCopy.closeFile);
    expect(state.value.importFile).toBeNull();
    await click(resultCopy.changes);
    expect(state.value.step).toBe("source-chat");
    expect(state.value.sourceIntent).toBe("changes");
    wrapper.unmount();
  });
  it("offers three ideas with no default choice or separate plan approval", async () => {
    const { wrapper, state, click } = flow("onboarding-plan");
    expect(wrapper.findAll(".suggestion")).toHaveLength(3);
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(9);
    expect(wrapper.find("input:checked").exists()).toBe(false);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Your working approach");
    expect(wrapper.text()).not.toContain(f.approvePlan);
    expect(wrapper.text()).toContain(supportCopy.inspiration);
    expect(wrapper.get(".support-plan footer").findAll("p")).toHaveLength(0);
    await click(supportCopy.finish);
    expect(state.value.confirmed).toBe(true);
    expect(state.value.startedTools).toEqual([]);
    wrapper.unmount();
  });
  it.each([
    "onboarding-plan",
    "onboarding-clean",
    "onboarding-plan-waiting",
    "onboarding-plan-error",
    "onboarding-plan-empty",
  ])("explains plugins without assuming prior knowledge in %s", (scenario) => {
    const { wrapper } = flow(scenario);
    const introduction = wrapper.get(".support-plan > .explanation");
    expect(introduction.findAll("p").map((p) => p.text())).toEqual([
      supportCopy.intro,
      supportCopy.capabilities,
    ]);
    if (scenario === "onboarding-plan" || scenario === "onboarding-clean") {
      expect(wrapper.get(".recommendations > .explanation").text()).toContain(
        supportCopy.choiceHelp,
      );
      expect(wrapper.text()).toContain(
        scenario === "onboarding-clean"
          ? supportCopy.suggestionsWithoutFiles
          : supportCopy.suggestionsWithFiles,
      );
      expect(wrapper.text()).not.toContain(
        scenario === "onboarding-clean"
          ? supportCopy.suggestionsWithFiles
          : supportCopy.suggestionsWithoutFiles,
      );
    }
    wrapper.unmount();
  });
  it("stages and replaces choices before a single explicit finish", async () => {
    const { wrapper, state, click } = flow("onboarding-plan");
    const idea = (id: string, choice: string) =>
      wrapper.get(`[data-suggestion="${id}"] input[value="${choice}"]`);
    await idea("board", "develop").setValue(true);
    await idea("review", "save").setValue(true);
    await idea("documents", "discard").setValue(true);
    expect(state.value.support.choices).toEqual({
      board: "develop",
      review: "save",
      documents: "discard",
    });
    expect(state.value.startedTools).toEqual([]);
    expect(state.value.support.savedNotes).toEqual([]);
    expect(wrapper.text()).toContain(supportCopy.finishOne);
    expect(wrapper.text()).toContain(supportCopy.capacity);
    await idea("board", "save").setValue(true);
    expect(wrapper.text()).not.toContain(supportCopy.finishOne);
    expect(wrapper.text()).not.toContain(supportCopy.capacity);
    expect(wrapper.text()).toContain(
      supportCopy.saveMany.replace("{count}", "2"),
    );
    await click(supportCopy.finish);
    expect(state.value).toMatchObject({ confirmed: true, step: "home" });
    wrapper.unmount();
  });
  it.each([
    "onboarding-plan-waiting",
    "onboarding-plan-error",
    "onboarding-plan-empty",
  ])("allows finishing without suggestions in %s", async (scenario) => {
    const { wrapper, state, click } = flow(scenario);
    expect(wrapper.findAll(".suggestion")).toHaveLength(0);
    await click(supportCopy.finish);
    expect(state.value.confirmed).toBe(true);
    expect(state.value.startedTools).toEqual([]);
    wrapper.unmount();
  });
  it("does not silently skip selected development when AI becomes unavailable", async () => {
    const { wrapper, state } = flow("onboarding-plan");
    await wrapper
      .get('[data-suggestion="board"] input[value="develop"]')
      .setValue(true);
    state.value.connected = false;
    await wrapper.vm.$nextTick();
    const finish = () =>
      wrapper
        .findAll("button")
        .find((b) => b.text() === supportCopy.finishOne)!;
    expect(finish().attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(supportCopy.offline);
    await wrapper
      .get('[data-suggestion="board"] input[value="save"]')
      .setValue(true);
    expect(
      wrapper
        .findAll("button")
        .find((b) => b.text() === supportCopy.finish)!
        .attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();
  });
});
