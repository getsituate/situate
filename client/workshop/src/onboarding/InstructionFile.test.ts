import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import InstructionFile from "./InstructionFile.vue";
import MarkdownContent from "../editor/MarkdownContent.vue";
import { createOnboardingState, instructionMarkdown } from "./model";
import copy from "../localization/en.workspace-instructions.json";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("instruction preview geometry", () => {
  it("renders the entire document and remeasures both content and viewport until unmount", async () => {
    let resize = () => {},
      height = 140;
    const observe = vi.fn(),
      disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("preview-content")
          ? new DOMRect(0, 0, 500, height)
          : original.call(this);
      },
    );
    const state = createOnboardingState("onboarding-proposal");
    const wrapper = mount(InstructionFile, { props: { state, busy: false } });
    const preview = wrapper.get<HTMLElement>(".instruction-preview").element;
    Object.defineProperty(preview, "clientHeight", {
      configurable: true,
      value: 200,
    });
    resize();
    await nextTick();
    expect(observe).toHaveBeenCalledWith(preview);
    expect(observe).toHaveBeenCalledWith(
      wrapper.get(".preview-content").element,
    );
    expect(wrapper.getComponent(MarkdownContent).props("content")).toBe(
      instructionMarkdown(state),
    );
    expect(wrapper.find(".open-file").exists()).toBe(false);
    expect(wrapper.find(".overflow-hint").exists()).toBe(false);
    height = 500;
    resize();
    await nextTick();
    expect(wrapper.get(".overflow-hint").text()).toBe(copy.more);
    expect(wrapper.get(".open-file").text()).toContain(copy.open);
    height = 160;
    await wrapper.setProps({
      state: { ...state, context: "Changed description" },
    });
    await flushPromises();
    expect(wrapper.find(".open-file").exists()).toBe(false);
    expect(wrapper.getComponent(MarkdownContent).props("content")).toContain(
      "Changed description",
    );
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(() => resize()).not.toThrow();
  });
});
