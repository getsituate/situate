import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImportPagination from "./ImportPagination.vue";
import copy from "../localization/en.import-result.json";

const props = {
  label: "1–10 of 40",
  scope: "Projects/Collection 01/Notes",
  page: 0,
  last: 3,
  depth: 3,
};

describe("import pagination", () => {
  it("names the controls and keeps the file range in its folder group", () => {
    const wrapper = mount(ImportPagination, { props });
    expect(wrapper.attributes("aria-label")).toBe(props.scope);
    expect(wrapper.get('[role="status"]').text()).toBe(props.label);
    const buttons = wrapper.findAll("button");
    expect(buttons.map((button) => button.attributes("aria-label"))).toEqual([
      copy.previousPage,
      copy.nextPage,
    ]);
    expect(buttons.every((button) => button.text() === "")).toBe(true);
    expect(wrapper.attributes("style")).toContain("margin-inline-start: 44px");
    wrapper.unmount();
  });
  it("disables boundary actions and emits only the requested page", async () => {
    const wrapper = mount(ImportPagination, { props });
    const [previous, next] = wrapper.findAll("button");
    await previous!.trigger("click");
    expect(wrapper.emitted("change")).toBeUndefined();
    await next!.trigger("click");
    expect(wrapper.emitted("change")).toEqual([[1]]);
    await wrapper.setProps({ page: 3, label: "31–40 of 40" });
    expect(next!.element.disabled).toBe(true);
    await next!.trigger("click");
    expect(wrapper.emitted("change")).toEqual([[1]]);
    await previous!.trigger("click");
    expect(wrapper.emitted("change")).toEqual([[1], [2]]);
    wrapper.unmount();
  });
});
