import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, ref } from "vue";
import { SituateDisclosure } from "@situate/ui";

describe("SituateDisclosure", () => {
  it("keeps native details semantics, label content, focus and toggle events", async () => {
    const wrapper = mount(SituateDisclosure, {
      attachTo: document.body,
      props: { label: "More details" },
      attrs: { id: "details" },
      slots: { default: "Additional information" },
    });
    expect(wrapper.element.tagName).toBe("DETAILS");
    expect(wrapper.get("summary").text()).toBe("More details");
    expect(wrapper.vm.element?.open).toBe(false);
    wrapper.vm.focus();
    expect(document.activeElement).toBe(wrapper.get("summary").element);
    wrapper.vm.element!.open = true;
    await wrapper.trigger("toggle");
    expect(wrapper.emitted("update:open")).toEqual([[true]]);
    expect((wrapper.emitted("toggle")![0][0] as Event).target).toBe(
      wrapper.element,
    );
    expect(wrapper.text()).toContain("Additional information");
    wrapper.unmount();
  });

  it("synchronizes controlled open state and accepts a rich label", async () => {
    const host = mount(
      defineComponent({
        components: { SituateDisclosure },
        setup: () => ({ open: ref(true) }),
        template:
          '<SituateDisclosure v-model:open="open"><template #label>Advanced <span>Customized</span></template>Options</SituateDisclosure>',
      }),
    );
    const details = host.get("details");
    expect((details.element as HTMLDetailsElement).open).toBe(true);
    expect(host.get("summary span").text()).toBe("Customized");
    (details.element as HTMLDetailsElement).open = false;
    await details.trigger("toggle");
    expect(host.vm.open).toBe(false);
    host.vm.open = true;
    await host.vm.$nextTick();
    expect((details.element as HTMLDetailsElement).open).toBe(true);
    host.unmount();
  });
});
