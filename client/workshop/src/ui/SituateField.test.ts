import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { describe, expect, it } from "vitest";
import { SituateField, SituateInput } from "./index";

describe("field feedback", () => {
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
      "Error: Enter a workspace name.",
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
