import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import OnboardingView from "./OnboardingView.vue";
import { createOnboardingState } from "./model";

let intersect: (entries: Partial<IntersectionObserverEntry>[]) => void;
const disconnect = vi.fn();
function observe() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("onboarding view", () => {
  it("keeps one heading and invitation within the shared setup frame", async () => {
    const state = createOnboardingState();
    const wrapper = mount(OnboardingView, {
      props: { state, developments: [] },
      global: { stubs: { WelcomeScene: true } },
    });
    expect(wrapper.findAll("h1")).toHaveLength(1);
    expect(wrapper.get("h1").text()).toBe("Make yourself\nat home.");
    expect(wrapper.findAll(".intro-copy").map((p) => p.text())).toEqual([
      "Let’s set up your notes and tasks around the way you work.",
    ]);
    expect(wrapper.findAll("nav li")).toHaveLength(5);
    expect(
      wrapper.findAll(".setup-panel button").map((button) => button.text()),
    ).toEqual(["Plan my setup"]);
    await wrapper.findAll("button")[0]!.trigger("click");
    expect(wrapper.emitted("action")).toContainEqual([
      { type: "patch", patch: { step: "method" } },
    ]);
    await wrapper.setProps({ state: { ...state, step: "method" } });
    expect(wrapper.find("nav").exists()).toBe(true);
    expect(wrapper.find("welcome-scene-stub").exists()).toBe(false);
    wrapper.unmount();
  });
  it("does not offer a manual bypass when access fails", () => {
    const wrapper = mount(OnboardingView, {
      props: {
        state: createOnboardingState("onboarding-provider"),
        developments: [],
      },
    });
    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text() === "Use without AI setup"),
    ).toBe(false);
    expect(wrapper.emitted("action")).toBeUndefined();
    wrapper.unmount();
  });
  it("keeps a free description when guidance has no selected method aid", async () => {
    const state = {
      ...createOnboardingState(),
      step: "method" as const,
      method: "guided" as const,
      context: "Keep my project lists",
    };
    const wrapper = mount(OnboardingView, {
      props: { state, developments: [] },
    });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Suggest a working method")!
      .trigger("click");
    expect(wrapper.emitted("action")).toContainEqual([
      { type: "generate-proposal" },
    ]);
    wrapper.unmount();
  });
  it("does not observe a result that is in an unopened conversation", () => {
    const observed = vi.fn<(element: Element) => void>();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observed;
        disconnect() {}
      },
    );
    const wrapper = mount(OnboardingView, {
      props: {
        state: createOnboardingState("onboarding-hint"),
        developments: [],
      },
    });
    expect(
      observed.mock.calls.some(([element]) => element.matches(".change-card")),
    ).toBe(false);
    expect(wrapper.emitted("action")).toBeUndefined();
    expect(wrapper.find(".change-card").exists()).toBe(true);
    expect(wrapper.find("dialog").attributes("open")).toBeUndefined();
    wrapper.unmount();
  });
  it("waits for visible content and a pause in scrolling before offering the hint", async () => {
    vi.useFakeTimers();
    observe();
    const state = {
      ...createOnboardingState("onboarding-hint"),
      step: "conversation" as const,
    };
    const wrapper = mount(OnboardingView, {
      props: { state, developments: [] },
    });
    await wrapper.vm.$nextTick();
    intersect([{ isIntersecting: false, intersectionRatio: 0 }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.emitted("action")).toBeUndefined();
    intersect([{ isIntersecting: true, intersectionRatio: 0.3 }]);
    await vi.advanceTimersByTimeAsync(100);
    await wrapper.find("main").trigger("scroll");
    await vi.advanceTimersByTimeAsync(100);
    expect(wrapper.emitted("action")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(wrapper.emitted("action")).toContainEqual([{ type: "visible" }]);
    wrapper.unmount();
  });
  it("cancels a visibility trigger when the scene unmounts", async () => {
    vi.useFakeTimers();
    observe();
    const state = {
      ...createOnboardingState("onboarding-hint"),
      step: "conversation" as const,
    };
    const wrapper = mount(OnboardingView, {
      props: { state, developments: [] },
    });
    await wrapper.vm.$nextTick();
    intersect([{ isIntersecting: true, intersectionRatio: 1 }]);
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.emitted("action")).toBeUndefined();
    expect(disconnect).toHaveBeenCalled();
  });
});
