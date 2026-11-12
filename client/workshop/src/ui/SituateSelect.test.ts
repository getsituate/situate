import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SituateSelect from "./SituateSelect.vue";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
    expect(wrapper.get('[role="alert"]').text()).toContain("Choose an option");
    await wrapper.get("select").setValue("a");
    await wrapper.setProps({ value: "a" });
    expect(new FormData(form).get("choice")).toBe("a");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
