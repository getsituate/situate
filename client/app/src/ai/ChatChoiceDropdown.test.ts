import "../ui/popover-test-environment";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import ChatChoiceDropdown from "./ChatChoiceDropdown.vue";
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 44, 44),
  );
});
enableAutoUnmount(afterEach);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("focuses the checked choice, selects it, and returns focus", async () => {
  const wrapper = mount(ChatChoiceDropdown, {
    attachTo: document.body,
    props: {
      label: "Model",
      text: "Beta",
      value: "b",
      options: [
        { id: "a", label: "Alpha", source: "↳", detail: "Resolved Alpha" },
        { id: "b", label: "Beta" },
      ],
    },
  });
  await wrapper.get(".choice-trigger").trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get('[data-choice="b"]').element);
  await wrapper.get('[data-choice="b"]').trigger("keydown", { key: "a" });
  const alpha = wrapper.get('[data-choice="a"]');
  expect(document.activeElement).toBe(alpha.element);
  expect(alpha.attributes("aria-label")).toBe("Alpha");
  expect(
    document.getElementById(alpha.attributes("aria-describedby")!)?.textContent,
  ).toBe("Resolved Alpha");
  await alpha.trigger("click");
  await flushPromises();
  expect(wrapper.emitted("select")).toEqual([["a"]]);
  expect(wrapper.get(".choice-trigger").attributes("aria-expanded")).toBe(
    "false",
  );
  expect(document.activeElement).toBe(wrapper.get(".choice-trigger").element);
});
it("closes when disabled and does not select a retained option", async () => {
  const wrapper = mount(ChatChoiceDropdown, {
    props: {
      label: "Model",
      text: "Alpha",
      value: "a",
      options: [{ id: "a", label: "Alpha" }],
    },
  });
  await wrapper.get(".choice-trigger").trigger("click");
  await wrapper.setProps({ disabled: true });
  await wrapper.get('[data-choice="a"]').trigger("click");
  expect(wrapper.get(".choice-trigger").attributes("aria-expanded")).toBe(
    "false",
  );
  expect(wrapper.emitted("select")).toBeUndefined();
});
