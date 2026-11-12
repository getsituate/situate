import { DOMWrapper, enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { SituateSelect } from "@situate/ui";
import { t } from "@situate/localization";

enableAutoUnmount(afterEach);
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function create(
  attrs: Record<string, unknown> = {},
  options = '<option value="24">24-hour</option><option value="12">12-hour</option>',
) {
  return mount(SituateSelect, {
    attachTo: document.body,
    attrs: {
      id: "time",
      name: "time",
      value: "24",
      "aria-label": "Time format",
      ...attrs,
    },
    slots: { default: options },
  });
}
describe("SituateSelect", () => {
  it("navigates enabled choices, cancels without changes, and restores focus", async () => {
    const wrapper = create(
      { value: undefined },
      '<option value="a">Alpha</option><optgroup label="Unavailable" disabled><option value="b">Beta</option></optgroup><option value="c">Charlie</option>',
    );
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    const list = new DOMWrapper(document.querySelector('[role="listbox"]')!);
    expect(document.activeElement).toBe(list.element);
    await list.trigger("keydown", { key: "ArrowDown" });
    expect(list.attributes("aria-activedescendant")).toMatch(/option-2$/);
    await list.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("change")).toBeUndefined();
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await nextTick();
    const reopened = new DOMWrapper(
      document.querySelector('[role="listbox"]')!,
    );
    await reopened.trigger("keydown", { key: "End" });
    await reopened.trigger("keydown", { key: "Home" });
    expect(reopened.attributes("aria-activedescendant")).toMatch(/option-0$/);
    await reopened.trigger("keydown", { key: "c" });
    await reopened.trigger("keydown", { key: "Enter" });
    expect(trigger.attributes("data-value")).toBe("c");
    expect(wrapper.emitted("input")).toHaveLength(1);
    expect(wrapper.emitted("change")).toHaveLength(1);
    expect(document.activeElement).toBe(trigger.element);
  });
  it("updates an open list as choices change and closes when disabled", async () => {
    const choices = ref(["Alpha", "Beta"]);
    const disabled = ref(false);
    const wrapper = mount(
      defineComponent(
        () => () =>
          h(SituateSelect, { disabled: disabled.value }, () =>
            choices.value.map((label) => h("option", { value: label }, label)),
          ),
      ),
      { attachTo: document.body },
    );
    await wrapper.get('[role="combobox"]').trigger("click");
    await nextTick();
    choices.value = ["Charlie"];
    await nextTick();
    await nextTick();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Charlie",
    );
    disabled.value = true;
    await nextTick();
    await nextTick();
    expect(document.querySelector("dialog")).toBeNull();
    expect(wrapper.get("button").element.disabled).toBe(true);
    expect(wrapper.get("select").element.disabled).toBe(true);
  });
  it("positions a phone sheet inside the host visual viewport", async () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 4,
      offsetTop: 40,
      width: 360,
      height: 420,
    });
    vi.stubGlobal("visualViewport", viewport);
    const wrapper = create();
    await wrapper.get("button").trigger("click");
    await nextTick();
    await nextTick();
    const popup = document.querySelector<HTMLDialogElement>("dialog")!;
    expect(popup.classList.contains("select-sheet")).toBe(true);
    expect(popup.style.width).toBe("360px");
    expect(popup.style.left).toBe("4px");
    expect(popup.style.maxHeight).toBe("404px");
    expect(Number.parseFloat(popup.style.top)).toBeLessThanOrEqual(460);
  });
  it("bridges numeric models and restores uncontrolled form defaults on reset", async () => {
    const form = document.createElement("form");
    document.body.append(form);
    const wrapper = mount(SituateSelect, {
      attachTo: form,
      props: { name: "time", modelModifiers: { number: true } },
      slots: {
        default:
          '<option value="24">24-hour</option><option value="12">12-hour</option>',
      },
    });
    await wrapper.get("button").trigger("click");
    await nextTick();
    await new DOMWrapper(
      document.querySelector('[data-option-value="12"]')!,
    ).trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[12]]);
    expect(new FormData(form).get("time")).toBe("12");
    form.reset();
    await nextTick();
    await nextTick();
    expect(wrapper.get("button").attributes("data-value")).toBe("24");
    expect(new FormData(form).get("time")).toBe("24");
  });

  it("labels the visible control and bridges form values and change events", async () => {
    const onChange = vi.fn();
    const wrapper = create({
      value: undefined,
      "aria-describedby": "time-help",
      onChange,
    });
    await nextTick();
    expect(wrapper.get('[role="combobox"]').attributes()).toMatchObject({
      id: "time",
      "aria-describedby": "time-help",
      "aria-expanded": "false",
    });
    expect(wrapper.get('[role="combobox"]').text()).toContain("24-hour");
    expect(wrapper.get("select").attributes()).toMatchObject({
      hidden: "",
      "aria-hidden": "true",
      name: "time",
    });
    await wrapper.get("select").setValue("12");
    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0]![0].target as HTMLSelectElement).value).toBe(
      "12",
    );
    expect(wrapper.get('[role="combobox"]').text()).toContain("12-hour");
    wrapper.unmount();
  });
  it("reflects external values and changing option labels", async () => {
    const wrapper = create();
    await wrapper.setProps({ value: "12" });
    await nextTick();
    expect(wrapper.get('[role="combobox"]').attributes("data-value")).toBe(
      "12",
    );
    await wrapper.setProps({ value: "24" });
    await nextTick();
    expect(wrapper.get('[role="combobox"]').text()).toContain("24-hour");
    wrapper.unmount();
  });
  it("offers a toolbar appearance without changing the field contract", async () => {
    const wrapper = create();
    expect(wrapper.classes()).not.toContain("situate-select-toolbar");
    await wrapper.setProps({ appearance: "toolbar", value: "12" });
    await nextTick();
    expect(wrapper.classes()).toContain("situate-select-toolbar");
    expect(
      wrapper.get('[role="combobox"]').attributes("appearance"),
    ).toBeUndefined();
    expect(wrapper.get('[role="combobox"]').attributes("data-value")).toBe(
      "12",
    );
    expect(wrapper.get("select").element.value).toBe("12");
    wrapper.unmount();
  });
  it("disables both the visible control and form field", async () => {
    const wrapper = create({ disabled: true });
    expect(wrapper.get("button").element.disabled).toBe(true);
    expect(wrapper.get("select").element.disabled).toBe(true);
    await wrapper.get("button").trigger("click");
    expect(document.querySelector("dialog")).toBeNull();
    wrapper.unmount();
  });
  it("uses the first option when the value is uncontrolled", async () => {
    const wrapper = create({ value: undefined });
    await nextTick();
    expect(wrapper.get('[role="combobox"]').text()).toContain("24-hour");
    wrapper.unmount();
  });
  it("keeps labels on the visible trigger for wrapping labels", async () => {
    const label = document.createElement("label");
    label.textContent = "Time format";
    document.body.append(label);
    const wrapper = mount(SituateSelect, {
      attachTo: label,
      slots: { default: '<option value="24">24-hour</option>' },
    });
    await nextTick();
    expect(label.control).toBe(wrapper.get('[role="combobox"]').element);
    expect(wrapper.get("select").element.labels?.length).toBe(0);
    wrapper.unmount();
  });
  it("submits through the form and exposes required-field errors on the trigger", async () => {
    const form = document.createElement("form");
    document.body.append(form);
    const wrapper = mount(SituateSelect, {
      attachTo: form,
      props: { name: "choice", value: "", required: true },
      slots: {
        default:
          '<option value="" disabled>Choose</option><option value="a">Alpha</option>',
      },
    });
    await wrapper.get("select").trigger("invalid");
    expect(wrapper.get('[role="combobox"]').attributes("aria-invalid")).toBe(
      "true",
    );
    expect(wrapper.get('[role="alert"]').text()).toBe(t("ui.select.required"));
    await wrapper.get("select").setValue("a");
    await wrapper.setProps({ value: "a" });
    expect(new FormData(form).get("choice")).toBe("a");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
