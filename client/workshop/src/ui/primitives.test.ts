import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import {
  SituateButton,
  SituateInput,
  SituateTextarea,
  SituateCheckbox,
  SituateRadio,
  SituateDialog,
  SituateField,
  SituateIconButton,
  SituateNotice,
  SituateBadge,
  SituatePanel,
  SituateEmptyState,
} from "./index";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  document.body.innerHTML = "";
});
function keep<T extends { unmount(): void }>(wrapper: T): T {
  cleanup.push(() => wrapper.unmount());
  return wrapper;
}

describe("native primitives", () => {
  it("keeps button defaults and native attributes, focus and disabled behavior", async () => {
    const click = vi.fn();
    const wrapper = keep(
      mount(SituateButton, {
        attachTo: document.body,
        attrs: { name: "action", onClick: click },
        slots: { default: "Save" },
      }),
    );
    expect(wrapper.attributes("type")).toBe("button");
    expect(wrapper.attributes("name")).toBe("action");
    wrapper.vm.focus();
    expect(document.activeElement).toBe(wrapper.vm.element);
    wrapper.vm.element!.click();
    expect(click).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ busy: true });
    expect(wrapper.attributes("aria-busy")).toBe("true");
    wrapper.vm.element!.click();
    expect(click).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ busy: false, variant: "plain" });
    expect(wrapper.classes()).toEqual([]);
  });

  for (const Component of [SituateInput, SituateTextarea]) {
    it(`${Component.__name} forwards input, focus and selection without wrapping`, async () => {
      const input = vi.fn();
      const wrapper = keep(
        mount(Component, {
          attachTo: document.body,
          props: { modelValue: "hello", appearance: "plain" },
          attrs: {
            id: "entry",
            required: true,
            onInput: input,
            "aria-label": "Entry",
          },
        }),
      );
      wrapper.vm.focus();
      expect(document.activeElement).toBe(wrapper.vm.element);
      wrapper.vm.select();
      expect(wrapper.vm.element!.selectionEnd).toBe(5);
      wrapper.vm.setSelectionRange(1, 3);
      expect(wrapper.vm.element!.selectionStart).toBe(1);
      expect(wrapper.vm.element!.selectionEnd).toBe(3);
      expect(wrapper.classes()).toEqual([]);
      expect(wrapper.attributes("required")).toBe("");
      await wrapper.find("input, textarea").setValue("updated");
      expect(wrapper.emitted("update:modelValue")).toEqual([["updated"]]);
      expect(input.mock.calls[0][0].target).toBe(wrapper.element);
      const disabled = keep(
        mount(Component, {
          attachTo: document.body,
          attrs: { disabled: true },
        }),
      );
      disabled.vm.focus();
      expect(disabled.vm.element!.disabled).toBe(true);
      expect(document.activeElement).not.toBe(disabled.element);
    });
  }

  for (const Component of [SituateInput, SituateTextarea]) {
    it(`${Component.__name} preserves composing text through validation attribute updates`, async () => {
      const wrapper = keep(
        mount(
          defineComponent({
            components: { Control: Component },
            setup: () => ({ value: ref("saved"), error: ref(true) }),
            template:
              '<Control v-model="value" :aria-invalid="error || undefined" />',
          }),
          { attachTo: document.body },
        ),
      );
      const control = wrapper.find("input,textarea");
      const element = control.element as HTMLInputElement | HTMLTextAreaElement;
      element.focus();
      await control.trigger("compositionstart");
      element.value = "編集";
      await control.trigger("input");
      wrapper.vm.error = false;
      await wrapper.vm.$nextTick();
      expect(element.value).toBe("編集");
      expect(wrapper.vm.value).toBe("saved");
      expect(control.attributes("aria-invalid")).toBeUndefined();
      await control.trigger("compositionend");
      expect(wrapper.vm.value).toBe("編集");
      expect(element.value).toBe("編集");
      wrapper.vm.value = "replacement";
      await wrapper.vm.$nextTick();
      expect(element.value).toBe("replacement");
    });

    it(`${Component.__name} retains a lazy draft and normalizes trim on native change`, async () => {
      const wrapper = keep(
        mount(
          defineComponent({
            components: { Control: Component },
            setup: () => ({ value: ref("saved"), description: ref("help") }),
            template:
              '<Control v-model.lazy.trim="value" :aria-describedby="description" />',
          }),
          { attachTo: document.body },
        ),
      );
      const control = wrapper.find("input,textarea");
      const element = control.element as HTMLInputElement | HTMLTextAreaElement;
      element.focus();
      element.value = "  draft  ";
      await control.trigger("input");
      wrapper.vm.description = "changed-help";
      await wrapper.vm.$nextTick();
      expect(element.value).toBe("  draft  ");
      expect(wrapper.vm.value).toBe("saved");
      await control.trigger("change");
      expect(wrapper.vm.value).toBe("draft");
      expect(element.value).toBe("draft");
      element.value = "pending";
      await control.trigger("input");
      wrapper.vm.value = "replacement";
      await wrapper.vm.$nextTick();
      expect(element.value).toBe("replacement");
    });
  }

  it("supports modifiers, number values and IME composition", async () => {
    const wrapper = keep(
      mount(SituateInput, {
        props: { modelValue: "", modelModifiers: { trim: true, lazy: true } },
      }),
    );
    const element = wrapper.vm.element!;
    element.value = "  name  ";
    await wrapper.trigger("input");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.trigger("change");
    expect(wrapper.emitted("update:modelValue")).toEqual([["name"]]);
    const number = keep(
      mount(SituateInput, {
        props: { modelValue: "", modelModifiers: { number: true } },
      }),
    );
    number.vm.element!.value = "42";
    await number.trigger("compositionstart");
    await number.trigger("input");
    expect(number.emitted("update:modelValue")).toBeUndefined();
    await number.trigger("compositionend");
    expect(number.emitted("update:modelValue")).toEqual([[42]]);
  });

  it("keeps numeric drafts until native change normalizes the displayed value", async () => {
    const wrapper = keep(
      mount(
        defineComponent({
          components: { SituateInput },
          setup: () => ({
            value: ref<string | number>(0),
            description: ref("help"),
          }),
          template:
            '<SituateInput v-model.number="value" :aria-describedby="description" />',
        }),
        { attachTo: document.body },
      ),
    );
    const input = wrapper.find("input");
    input.element.focus();
    input.element.value = "3.0";
    await input.trigger("input");
    wrapper.vm.description = "changed-help";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.value).toBe(3);
    expect(input.element.value).toBe("3.0");
    await input.trigger("change");
    expect(input.element.value).toBe("3");
  });

  it("emits numbers without coercing empty or nonnumeric text to zero", async () => {
    const wrapper = keep(
      mount(SituateInput, {
        props: { modelValue: "", modelModifiers: { number: true } },
      }),
    );
    await wrapper.find("input").setValue("12.5");
    await wrapper.find("input").setValue("");
    await wrapper.find("input").setValue("draft");
    expect(wrapper.emitted("update:modelValue")).toEqual([
      [12.5],
      [""],
      ["draft"],
    ]);
  });

  it("retains native form reset without inventing model updates", async () => {
    const wrapper = keep(
      mount(
        defineComponent({
          components: { SituateInput, SituateCheckbox },
          template:
            '<form><SituateInput value="initial" /><SituateCheckbox checked /></form>',
        }),
      ),
    );
    await wrapper.find("input[type=checkbox]").setValue(false);
    await wrapper.find("input:not([type=checkbox])").setValue("changed");
    (wrapper.element as HTMLFormElement).reset();
    expect(
      (wrapper.find("input:not([type=checkbox])").element as HTMLInputElement)
        .value,
    ).toBe("initial");
    expect(
      (wrapper.find("input[type=checkbox]").element as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      wrapper.findComponent(SituateInput).emitted("update:modelValue"),
    ).toEqual([["changed"]]);
  });

  it("keeps native value binding when no model is supplied", () => {
    const wrapper = keep(mount(SituateInput, { attrs: { value: "native" } }));
    expect(wrapper.vm.element!.value).toBe("native");
  });

  it("preserves checkbox label, native checked/change and boolean v-model", async () => {
    const change = vi.fn();
    const wrapper = keep(
      mount(
        defineComponent({
          components: { SituateCheckbox },
          setup: () => ({ change }),
          template:
            '<label>Remember<SituateCheckbox checked name="remember" @change="change" /></label>',
        }),
        { attachTo: document.body },
      ),
    );
    const checkbox = wrapper.findComponent(SituateCheckbox);
    expect(checkbox.vm.element!.checked).toBe(true);
    expect(checkbox.vm.element!.labels?.length).toBe(1);
    checkbox.vm.element!.click();
    expect(change.mock.calls[0][0].target).toBe(checkbox.element);
    expect(checkbox.emitted("update:modelValue")).toEqual([[false]]);
    checkbox.vm.element!.disabled = true;
    checkbox.vm.element!.click();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("updates radio model and native mutually exclusive state", async () => {
    const wrapper = keep(
      mount(
        defineComponent({
          components: { SituateRadio },
          setup: () => ({ choice: ref("a") }),
          template:
            '<div><SituateRadio v-model="choice" name="choice" value="a" /><SituateRadio v-model="choice" name="choice" value="b" /></div>',
        }),
        { attachTo: document.body },
      ),
    );
    const radios = wrapper.findAllComponents(SituateRadio);
    expect(radios[0].vm.element!.checked).toBe(true);
    await radios[1].find("input").setValue(true);
    expect(radios[0].vm.element!.checked).toBe(false);
    expect(radios[1].vm.element!.checked).toBe(true);
  });

  it("associates field label/help/error and removes recovered errors", async () => {
    const wrapper = keep(
      mount(
        defineComponent({
          components: { SituateField, SituateInput },
          setup: () => ({ error: ref("Required") }),
          template:
            '<SituateField label="Name" help="Use a short name" :error="error" v-slot="{ controlAttrs }"><SituateInput v-bind="controlAttrs" /></SituateField>',
        }),
      ),
    );
    const input = wrapper.find("input");
    const id = input.attributes("id");
    expect(wrapper.find("label").attributes("for")).toBe(id);
    expect(input.attributes("aria-describedby")).toBe(`${id}-help ${id}-error`);
    expect(input.attributes("aria-invalid")).toBe("true");
    wrapper.vm.error = "";
    await wrapper.vm.$nextTick();
    expect(input.attributes("id")).toBe(id);
    expect(input.attributes("aria-describedby")).toBe(`${id}-help`);
    expect(input.attributes("aria-invalid")).toBeUndefined();
  });

  it("leaves dialog lifecycle native and forwards cancel/close with their event objects", async () => {
    const cancel = vi.fn((event: Event) => event.preventDefault());
    const close = vi.fn();
    const wrapper = keep(
      mount(SituateDialog, {
        attrs: { "aria-label": "Confirm", onCancel: cancel, onClose: close },
      }),
    );
    const element = wrapper.vm.element!;
    expect(element.open).toBe(false);
    expect(wrapper.classes()).toContain("situate-dialog");
    await wrapper.setProps({ appearance: "plain" });
    expect(wrapper.classes()).toEqual([]);
    const showModal = vi.fn();
    const closeMethod = vi.fn();
    element.showModal = showModal;
    element.close = closeMethod;
    wrapper.vm.showModal();
    wrapper.vm.close("done");
    expect(showModal).toHaveBeenCalledOnce();
    expect(closeMethod).toHaveBeenCalledWith("done");
    const event = new Event("cancel", { cancelable: true });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(cancel).toHaveBeenCalledWith(event);
    await wrapper.trigger("close");
    expect(close.mock.calls[0][0].target).toBe(element);
  });

  it("renders caller-owned content without invented labels or announcement roles", () => {
    for (const Component of [
      SituateBadge,
      SituateNotice,
      SituatePanel,
      SituateEmptyState,
    ]) {
      const wrapper = keep(mount(Component, { slots: { default: "Content" } }));
      expect(wrapper.text()).toBe("Content");
      expect(wrapper.attributes("role")).toBeUndefined();
    }
    const icon = keep(
      mount(SituateIconButton, {
        props: { label: "Open", variant: "plain" },
        slots: { default: '<svg aria-hidden="true" />' },
      }),
    );
    expect(icon.get("button").classes()).toEqual([]);
    expect(icon.find("svg").exists()).toBe(true);
    expect(icon.get("button").attributes("aria-label")).toBe("Open");
  });
});
