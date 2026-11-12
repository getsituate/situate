import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { describe, expect, it } from "vitest";
import { SituateField, SituateInput, SituateTextarea } from "@situate/ui";

describe("field feedback", () => {
  it("keeps default fields compact with stable distinct generated IDs and legacy slot values", async () => {
    const wrapper = mount(
      defineComponent({
        components: { SituateField },
        template:
          '<SituateField label="First" v-slot="{ id, describedBy, invalid }"><input :id="id" :aria-describedby="describedBy" :aria-invalid="invalid" /></SituateField><SituateField label="Second" v-slot="{ controlAttrs }"><input v-bind="controlAttrs" /></SituateField>',
      }),
    );
    const inputs = wrapper.findAll("input");
    const ids = inputs.map((input) => input.attributes("id"));
    expect(new Set(ids).size).toBe(2);
    expect(
      wrapper.findAll("label").map((label) => label.attributes("for")),
    ).toEqual(ids);
    expect(wrapper.find(".situate-field-feedback").exists()).toBe(false);
    await wrapper.vm.$forceUpdate();
    expect(
      wrapper.findAll("input").map((input) => input.attributes("id")),
    ).toEqual(ids);
    wrapper.unmount();
  });
  it("associates nonblocking warnings with textareas and allows additional caller descriptions", async () => {
    const wrapper = mount(
      defineComponent({
        components: { SituateField, SituateTextarea },
        template:
          '<SituateField id="summary" help="Keep it brief" warning="Check this value." v-slot="{ controlAttrs }"><SituateTextarea v-bind="controlAttrs" :aria-describedby="[controlAttrs[\'aria-describedby\'], \'extra\'].join(\' \')" /><button>Save</button></SituateField>',
      }),
    );
    const control = wrapper.get("textarea");
    expect(control.attributes("aria-describedby")).toBe(
      "summary-help summary-warning extra",
    );
    expect(control.attributes("aria-invalid")).toBeUndefined();
    expect(control.attributes("data-field-tone")).toBe("warning");
    expect(wrapper.get("#summary-warning").text()).toBe(
      "⟦field.warning⟧ Check this value.",
    );
    expect(wrapper.get("svg path").attributes("d")).toBe("M12 3 22 21H2Z");
    expect(wrapper.get("button").element.disabled).toBe(false);
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("prioritizes errors, retains help and removes stale associations on correction", async () => {
    const wrapper = mount(
      defineComponent({
        components: { SituateField, SituateInput },
        setup: () => ({
          error: ref("Enter a workspace name."),
          warning: ref("Similar name."),
        }),
        template:
          '<SituateField id="name" label="Workspace name" help="Folder name" :error="error" :warning="warning" reserve-feedback announce v-slot="{ controlAttrs }"><SituateInput v-bind="controlAttrs" /></SituateField>',
      }),
    );
    const input = wrapper.get("input");
    expect(wrapper.get("label").attributes("for")).toBe("name");
    expect(input.attributes("aria-describedby")).toBe("name-help name-error");
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(input.attributes("data-field-tone")).toBe("error");
    expect(wrapper.get("#name-error").text()).toBe(
      "⟦field.error⟧ Enter a workspace name.",
    );
    expect(wrapper.find("#name-warning").exists()).toBe(false);
    expect(wrapper.get('[aria-live="polite"]').attributes("aria-atomic")).toBe(
      "true",
    );
    wrapper.vm.error = "";
    await wrapper.vm.$nextTick();
    expect(input.attributes("aria-invalid")).toBeUndefined();
    expect(input.attributes("aria-describedby")).toBe("name-help name-warning");
    expect(input.attributes("data-field-tone")).toBe("warning");
    expect(wrapper.find("#name-error").exists()).toBe(false);
    wrapper.vm.warning = "";
    await wrapper.vm.$nextTick();
    expect(input.attributes("aria-describedby")).toBe("name-help");
    expect(input.attributes("data-field-tone")).toBeUndefined();
    expect(wrapper.find("#name-warning").exists()).toBe(false);
    expect(wrapper.find(".situate-field-feedback--reserved").exists()).toBe(
      true,
    );
    wrapper.unmount();
  });
  it("does not announce static examples or create empty descriptions", () => {
    const wrapper = mount(
      defineComponent({
        components: { SituateField, SituateInput },
        template:
          '<SituateField label="Name" reserve-feedback v-slot="{ controlAttrs }"><SituateInput v-bind="controlAttrs" /></SituateField>',
      }),
    );
    expect(wrapper.get("input").attributes("aria-describedby")).toBeUndefined();
    expect(wrapper.find("[aria-live]").exists()).toBe(false);
    wrapper.unmount();
  });
});
