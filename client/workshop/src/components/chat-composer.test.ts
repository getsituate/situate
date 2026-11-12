import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatComposer from "./ChatComposer.vue";
import NavigationComposer from "../navigation/NavigationComposer.vue";
import ChatPane from "./ChatPane.vue";
import ChatPaneHeader from "./ChatPaneHeader.vue";

describe("shared chat UI", () => {
  it("uses the same composer in the chat shell and navigation", () => {
    const shell = mount(ChatPane, {
      props: { navigationId: "nav", navigationOpen: false },
    });
    const navigation = mount(NavigationComposer, {
      props: { modelValue: "Keep this draft" },
    });
    expect(shell.findComponent(ChatComposer).exists()).toBe(true);
    expect(shell.findComponent(ChatPaneHeader).exists()).toBe(true);
    expect(navigation.findComponent(ChatComposer).exists()).toBe(true);
    expect(navigation.get("textarea").element.value).toBe("Keep this draft");
    shell.unmount();
    navigation.unmount();
  });
  it("preserves compact chat controls, stopping and focus through the navigation wrapper", async () => {
    const wrapper = mount(NavigationComposer, {
      props: { modelValue: "Keep this draft", compact: true, working: true },
      attachTo: document.body,
    });
    expect(wrapper.find(".composer-footer").exists()).toBe(false);
    expect(
      wrapper.find('.input-line [aria-label="Attach file"]').exists(),
    ).toBe(true);
    await wrapper.get('[aria-label="Stop"]').trigger("click");
    expect(wrapper.emitted("stop")).toHaveLength(1);
    wrapper.vm.focus();
    expect(document.activeElement).toBe(wrapper.get("textarea").element);
    await wrapper.setProps({ working: false });
    expect(wrapper.find('[aria-label="Stop"]').exists()).toBe(false);
    expect(wrapper.get("textarea").element.value).toBe("Keep this draft");
    wrapper.unmount();
  });
  it("emits drafts and sends by button or Enter, but not Shift+Enter or IME confirmation", async () => {
    const wrapper = mount(ChatComposer, {
      props: {
        readonly: false,
        enabled: true,
        modelValue: "Make a weekly plan",
      },
    });
    const field = wrapper.get("textarea");
    await field.setValue("Keep weekends free");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
      "Keep weekends free",
    ]);
    await field.trigger("keydown", { key: "Enter", shiftKey: true });
    await field.trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.emitted("send")).toBeUndefined();
    await field.trigger("keydown", { key: "Enter" });
    await wrapper.get('[aria-label="Send message"]').trigger("click");
    expect(wrapper.emitted("send")).toHaveLength(2);
    wrapper.unmount();
  });
  it("does not send empty, readonly or unavailable messages", async () => {
    const wrapper = mount(ChatComposer, {
      props: { readonly: false, enabled: true, modelValue: "   " },
    });
    const field = wrapper.get("textarea");
    await field.trigger("keydown", { key: "Enter" });
    expect(
      wrapper.get('[aria-label="Send message"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.setProps({
      modelValue: "Continue",
      enabled: false,
      unavailableReason: "Wait for the current request.",
    });
    await field.trigger("keydown", { key: "Enter" });
    expect(
      wrapper.get('[aria-label="Send message"]').attributes("aria-description"),
    ).toBe("Wait for the current request.");
    await wrapper.setProps({ enabled: true, readonly: true });
    await field.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")).toBeUndefined();
    wrapper.unmount();
  });
});
