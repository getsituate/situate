import "../../ui/popover-test-environment";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import TabActions from "./TabActions.vue";
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

it("opens the last action with ArrowUp and passes the trigger to rename", async () => {
  const wrapper = mount(TabActions, {
    attachTo: document.body,
    props: { label: "Tab actions" },
  });
  const trigger = wrapper.get(".tab-actions-trigger");
  await trigger.trigger("keydown", { key: "ArrowUp" });
  await flushPromises();
  expect(document.activeElement?.textContent).toBe("⟦layoutUi.closeTab⟧");
  await wrapper.get('[role="menuitem"]').trigger("click");
  expect(wrapper.emitted("rename")).toEqual([[trigger.element]]);
  expect(trigger.attributes("aria-expanded")).toBe("false");
});
it("consumes back only while open and restores the trigger", async () => {
  const wrapper = mount(TabActions, {
    attachTo: document.body,
    props: { label: "Tab actions" },
  });
  expect(wrapper.vm.back()).toBe(false);
  await wrapper.get(".tab-actions-trigger").trigger("click");
  await flushPromises();
  expect(wrapper.vm.back()).toBe(true);
  expect(document.activeElement).toBe(
    wrapper.get(".tab-actions-trigger").element,
  );
  expect(wrapper.vm.back()).toBe(false);
});
