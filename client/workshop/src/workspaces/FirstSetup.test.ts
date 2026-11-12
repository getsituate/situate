import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import FirstSetup from "./FirstSetup.vue";
import { createSimulation } from "../workshop/simulation";
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.unstubAllGlobals();
});
function setup() {
  const state = createSimulation("first-entry-model");
  const wrapper = mount(FirstSetup, {
    props: {
      state: state.firstEntry,
      ai: state.ai,
      onboarding: state.onboarding,
      workspace: "Reading room",
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return { wrapper, state };
}
describe("guided workspace setup", () => {
  it("shows a noninteractive step sequence and requires a model", async () => {
    const { wrapper } = setup();
    expect(wrapper.findAll("nav li")).toHaveLength(5);
    expect(wrapper.findAll("nav button")).toHaveLength(0);
    expect(wrapper.get('[aria-current="step"]').text()).toContain("Connect AI");
    expect(wrapper.get("button.primary").attributes("disabled")).toBeDefined();
    await wrapper.get("select").setValue("example-chat");
    expect(wrapper.emitted("action")?.at(-1)).toEqual([
      { type: "model", id: "example-chat" },
    ]);
  });
  it("keeps focus during model editing and exposes recoverable failures", async () => {
    const { wrapper, state } = setup();
    await nextTick();
    const select = wrapper.get("select");
    (select.element as HTMLElement).focus();
    await wrapper.setProps({
      state: { ...state.firstEntry, modelId: "example-chat" },
    });
    expect(document.activeElement).toBe(select.element);
    await wrapper.setProps({
      state: { ...state.firstEntry, modelId: "example-chat", check: "failed" },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "could not be verified",
    );
    expect(
      wrapper.get("button.primary").attributes("disabled"),
    ).toBeUndefined();
  });
  it("keeps later stages locked and offers resumption while paused", async () => {
    const { wrapper, state } = setup();
    await wrapper.setProps({ state: { ...state.firstEntry, step: "paused" } });
    expect(wrapper.find("select").exists()).toBe(false);
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("action")?.at(-1)).toEqual([
      { type: "resume-setup" },
    ]);
    expect(wrapper.get('[aria-current="step"]').text()).toContain("Connect AI");
  });
});
