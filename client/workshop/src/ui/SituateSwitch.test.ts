import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import SituateSwitch from "./SituateSwitch.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SituateSwitch", () => {
  it("updates a boolean model while preserving native input and change events", async () => {
    const input = vi.fn();
    const change = vi.fn();
    const host = mount(
      defineComponent({
        components: { SituateSwitch },
        setup: () => ({ enabled: ref(false), input, change }),
        template:
          '<SituateSwitch v-model="enabled" aria-label="Progress updates" name="updates" @input="input" @change="change" />',
      }),
    );
    const control = host.get("input");
    expect(control.attributes("role")).toBe("switch");
    expect(control.attributes("type")).toBe("checkbox");
    expect(control.attributes("name")).toBe("updates");
    await control.setValue(true);
    expect(host.vm.enabled).toBe(true);
    expect(input.mock.calls[0][0].target).toBe(control.element);
    expect(change.mock.calls[0][0].target).toBe(control.element);
    host.vm.enabled = false;
    await host.vm.$nextTick();
    expect((control.element as HTMLInputElement).checked).toBe(false);
    host.unmount();
  });

  it("supports checked attributes, focus, and native disabled behavior", async () => {
    const change = vi.fn();
    const host = mount(
      defineComponent({
        components: { SituateSwitch },
        setup: () => ({ disabled: ref(true), change }),
        template:
          '<SituateSwitch checked :disabled="disabled" aria-label="Model picker" @change="change" />',
      }),
      { attachTo: document.body },
    );
    const wrapper = host.getComponent(SituateSwitch);
    expect(wrapper.vm.element?.checked).toBe(true);
    wrapper.vm.element?.click();
    expect(change).not.toHaveBeenCalled();
    host.vm.disabled = false;
    await host.vm.$nextTick();
    wrapper.vm.focus();
    expect(document.activeElement).toBe(wrapper.vm.element);
    wrapper.vm.element?.click();
    expect(change).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
    host.unmount();
  });
});
