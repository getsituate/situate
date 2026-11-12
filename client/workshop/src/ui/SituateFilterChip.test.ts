import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SituateFilterChip from "./SituateFilterChip.vue";

describe("SituateFilterChip", () => {
  it("names the remove action without hiding the visible filter text", async () => {
    const wrapper = mount(SituateFilterChip, {
      attachTo: document.body,
      props: { removeLabel: "Remove tag filter: Reading" },
      attrs: { "data-remove-tag": "reading" },
      slots: { default: "Reading" },
    });
    expect(wrapper.attributes("type")).toBe("button");
    expect(wrapper.attributes("aria-label")).toBe("Remove tag filter: Reading");
    expect(wrapper.text()).toContain("Reading");
    expect(wrapper.get("span").attributes("aria-hidden")).toBe("true");
    wrapper.vm.focus();
    expect(document.activeElement).toBe(wrapper.vm.element);
    wrapper.vm.element?.click();
    expect(wrapper.emitted("remove")?.[0][0]).toBeInstanceOf(MouseEvent);
    await wrapper.setProps({ disabled: true });
    wrapper.vm.element?.click();
    expect(wrapper.emitted("remove")).toHaveLength(1);
    wrapper.unmount();
  });
});
