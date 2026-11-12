import "./popover-test-environment";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import SituateMenu from "./SituateMenu.vue";
import SituatePopover from "./SituatePopover.vue";

enableAutoUnmount(afterEach);
afterEach(() => {
  document.body.replaceChildren();
});
async function menu(extra: Record<string, unknown> = {}) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 44, 44),
  );
  anchor.focus();
  const wrapper = mount(SituateMenu, {
    attachTo: document.body,
    props: { open: true, label: "Actions", anchor, ...extra },
    slots: {
      default:
        '<button role="menuitem" tabindex="-1">Archive</button><button role="menuitem" disabled tabindex="-1">Delete</button><button role="menuitemradio" aria-checked="true" tabindex="-1">Reading</button><button role="menuitemcheckbox" aria-checked="false" tabindex="-1">Pinned</button>',
    },
  });
  await nextTick();
  await nextTick();
  return { wrapper, anchor };
}
describe("SituateMenu", () => {
  it("focuses selected radio items and navigates enabled actions with wraparound and typeahead", async () => {
    const { wrapper } = await menu({ initialFocus: "checked" });
    const popup = wrapper.get('[role="menu"]');
    expect(document.activeElement?.textContent).toBe("Reading");
    await popup.trigger("keydown", { key: "Home" });
    expect(document.activeElement?.textContent).toBe("Archive");
    await popup.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Reading");
    await popup.trigger("keydown", { key: "End" });
    expect(document.activeElement?.textContent).toBe("Pinned");
    await popup.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Archive");
    await popup.trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Pinned");
    await popup.trigger("keydown", { key: "r" });
    expect(document.activeElement?.textContent).toBe("Reading");
  });
  it.each(["Escape", "Tab"])(
    "dismisses with %s and restores the invoker",
    async (key) => {
      const { wrapper, anchor } = await menu();
      await wrapper.get('[role="menu"]').trigger("keydown", { key });
      expect(wrapper.emitted("close")).toHaveLength(1);
      expect(document.activeElement).toBe(anchor);
    },
  );
  it("closes on enabled selection without mutating checked state", async () => {
    const { wrapper, anchor } = await menu();
    await wrapper.get('[role="menuitemcheckbox"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(
      wrapper.get('[role="menuitemcheckbox"]').attributes("aria-checked"),
    ).toBe("false");
    expect(document.activeElement).toBe(anchor);
  });
  it("preserves focus moved by an action handler", async () => {
    const draft = document.createElement("textarea");
    document.body.append(draft);
    const wrapper = mount(SituateMenu, {
      attachTo: document.body,
      props: { open: true, label: "Actions" },
      slots: {
        default: () =>
          h(
            "button",
            { role: "menuitem", tabindex: -1, onClick: () => draft.focus() },
            "Write",
          ),
      },
    });
    await nextTick();
    await nextTick();
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(document.activeElement).toBe(draft);
  });
  it("lets domain actions own transitions when automatic dismissal is disabled", async () => {
    const { wrapper } = await menu({ closeOnSelect: false });
    await wrapper.get('[role="menuitemcheckbox"]').trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
  });
});
describe("SituatePopover", () => {
  it("does not impose menu semantics or intercept navigation within arbitrary content", async () => {
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: true, label: "Find" },
      slots: { default: '<input aria-label="Query"><button>Search</button>' },
    });
    await nextTick();
    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe(
      "Find",
    );
    expect(
      wrapper.get('[role="dialog"]').attributes("aria-modal"),
    ).toBeUndefined();
    expect(document.activeElement).toBe(wrapper.get("input").element);
    await wrapper.get("input").trigger("keydown", { key: "ArrowDown" });
    await wrapper.get("input").trigger("keydown", { key: "Tab" });
    expect(wrapper.emitted("close")).toBeUndefined();
    await wrapper.get("button").trigger("focus");
    wrapper.get("button").element.focus();
    await wrapper.get("button").trigger("keydown", { key: "Tab" });
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
  it("reports native light dismissal once without re-entering hidePopover", async () => {
    const wrapper = mount(SituatePopover, {
      props: { open: true, label: "Details" },
    });
    await nextTick();
    vi.mocked(HTMLElement.prototype.hidePopover).mockClear();
    const event = new Event("beforetoggle");
    Object.defineProperty(event, "newState", { value: "closed" });
    wrapper.get('[role="dialog"]').element.dispatchEvent(event);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(HTMLElement.prototype.hidePopover).not.toHaveBeenCalled();
  });
});
