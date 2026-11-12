import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import OnboardingJourney from "./OnboardingJourney.vue";
import { createOnboardingState, reduceOnboarding } from "./model";

describe("onboarding journey", () => {
  it("distinguishes setup decisions from completion of an import", () => {
    const wrapper = mount(OnboardingJourney, {
      props: {
        state: createOnboardingState("onboarding-import"),
        active: true,
      },
      global: { stubs: { BendCompanion: true } },
    });
    expect(wrapper.get('[aria-current="step"]').text()).toContain(
      "Bring your content",
    );
    expect(wrapper.findAll(".done")).toHaveLength(3);
    expect(
      wrapper
        .findAll(".done")
        .every((step) => step.text().includes("Complete")),
    ).toBe(true);
    expect(wrapper.text()).not.toMatch(/100%|Import complete/);
    wrapper.unmount();
  });
  it("carries the person's own words without interpreting them as markup", () => {
    const state = {
      ...createOnboardingState("onboarding-sources"),
      context: "<b>My own project list</b>",
    };
    const wrapper = mount(OnboardingJourney, {
      props: { state, active: true },
      global: { stubs: { BendCompanion: true } },
    });
    expect(wrapper.get(".keepsake blockquote").text()).toBe(state.context);
    expect(wrapper.find(".keepsake b").exists()).toBe(false);
    wrapper.unmount();
  });
  it("retains an explicit pause and prior gestures through setup navigation", () => {
    const state = {
      ...createOnboardingState(),
      motionPaused: true,
      motionSeen: ["access"],
    };
    const next = reduceOnboarding(state, {
      type: "patch",
      patch: { step: "method" },
    });
    expect(next).toMatchObject({ motionPaused: true, motionSeen: ["access"] });
  });
  it("keeps the plain surface selectable without discarding answers", () => {
    const state = {
      ...createOnboardingState("onboarding-sources"),
      source: "Notes export",
    };
    const next = reduceOnboarding(state, {
      type: "patch",
      patch: { presentation: "plain" },
    });
    expect(next).toMatchObject({
      source: state.source,
      context: state.context,
      step: "sources",
    });
    const wrapper = mount(OnboardingJourney, {
      props: { state: next, active: false },
      slots: { default: "<p>Content</p>" },
    });
    expect(wrapper.find("aside").exists()).toBe(false);
    expect(wrapper.text()).toBe("Content");
    wrapper.unmount();
  });
});
