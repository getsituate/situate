import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import SituateProgress from "./SituateProgress.vue";
import SituateTooltip from "./SituateTooltip.vue";
import SituateIconButton from "./SituateIconButton.vue";
import SituateButton from "./SituateButton.vue";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
  document.body.innerHTML = "";
});
function keep<T extends { unmount(): void }>(wrapper: T): T {
  cleanup.push(() => wrapper.unmount());
  return wrapper;
}

describe("progress", () => {
  it("exposes only measured progress as a numeric value", async () => {
    const wrapper = keep(
      mount(SituateProgress, {
        props: { label: "Preparing notes", value: 3, max: 5 },
      }),
    );
    expect(wrapper.attributes()).toMatchObject({
      role: "progressbar",
      "aria-label": "Preparing notes",
      "aria-valuenow": "3",
      "aria-valuemax": "5",
    });
    expect(wrapper.find("span").attributes("style")).toContain("scaleX(0.6)");
    await wrapper.setProps({ value: null, estimate: 0.8 });
    expect(wrapper.attributes("aria-valuenow")).toBeUndefined();
    expect(wrapper.attributes("aria-valuemax")).toBeUndefined();
    expect(wrapper.find("span").attributes("style")).toContain("scaleX(0.8)");
    await wrapper.setProps({ estimate: 1 });
    expect(wrapper.find("span").attributes("style")).toContain("scaleX(0.95)");
  });
  it("bounds values and treats non-finite values as unknown", async () => {
    const wrapper = keep(
      mount(SituateProgress, { props: { label: "Notes", value: -2, max: 5 } }),
    );
    expect(wrapper.attributes("aria-valuenow")).toBe("0");
    await wrapper.setProps({ value: 8 });
    expect(wrapper.attributes("aria-valuenow")).toBe("5");
    await wrapper.setProps({ value: 50, max: 0 });
    expect(wrapper.attributes("aria-valuemax")).toBe("100");
    await wrapper.setProps({ value: NaN, estimate: Infinity });
    expect(wrapper.attributes("aria-valuenow")).toBeUndefined();
    expect(wrapper.find("span").attributes("style")).toContain("scaleX(0.25)");
  });
});

describe("tooltip", () => {
  beforeEach(() => vi.useFakeTimers());
  it("keeps caller-scoped styles on native button roots", async () => {
    for (const component of [SituateButton, SituateIconButton]) {
      const wrapper = keep(
        mount(
          defineComponent({
            __scopeId: "data-v-consumer",
            render: () =>
              h(
                component,
                {
                  label: "Details",
                  title: "More information",
                  class: "custom-action",
                },
                () => "Details",
              ),
          }),
          { attachTo: document.body },
        ),
      );
      const button = wrapper.get("button");
      expect(button.attributes()).toHaveProperty("data-v-consumer");
      expect(button.classes()).toContain("custom-action");
      await nextTick();
      button.element.focus();
      await vi.advanceTimersByTimeAsync(450);
      expect(button.attributes()).toHaveProperty("data-v-consumer");
      expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
      expect(button.element.querySelector('[role="tooltip"]')).toBeNull();
    }
  });
  function example() {
    return keep(
      mount(
        defineComponent({
          components: { SituateTooltip },
          template:
            '<SituateTooltip text="Choose notes to revisit" v-slot="{ triggerAttrs }"><button v-bind="triggerAttrs">Reminders</button></SituateTooltip>',
        }),
        { attachTo: document.body },
      ),
    );
  }
  it("describes a focused trigger and dismisses without stealing focus", async () => {
    const wrapper = example();
    const button = wrapper.get("button");
    button.element.focus();
    await vi.advanceTimersByTimeAsync(450);
    const tooltip = wrapper.get('[role="tooltip"]');
    expect(button.attributes("aria-describedby")).toBe(
      tooltip.attributes("id"),
    );
    expect(tooltip.text()).toBe("Choose notes to revisit");
    const enclosingOverlay = vi.fn();
    document.addEventListener("keydown", enclosingOverlay);
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    button.element.dispatchEvent(escape);
    document.removeEventListener("keydown", enclosingOverlay);
    expect(escape.defaultPrevented).toBe(true);
    expect(enclosingOverlay).not.toHaveBeenCalled();
    await nextTick();
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    expect(button.attributes("aria-describedby")).toBeUndefined();
    expect(document.activeElement).toBe(button.element);
  });
  it("waits for hover, remains hoverable and cancels pending work on unmount", async () => {
    vi.useFakeTimers();
    const wrapper = example();
    await wrapper
      .get("button")
      .trigger("pointerenter", { pointerType: "mouse" });
    await vi.advanceTimersByTimeAsync(449);
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);
    await wrapper.get("button").trigger("pointerleave");
    await wrapper.get('[role="tooltip"]').trigger("pointerenter");
    await wrapper.get('[role="tooltip"]').trigger("scroll");
    await vi.advanceTimersByTimeAsync(150);
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);
    await wrapper.get('[role="tooltip"]').trigger("pointerleave");
    await vi.advanceTimersByTimeAsync(150);
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    await wrapper
      .get("button")
      .trigger("pointerenter", { pointerType: "mouse" });
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
  it("keeps anchored help inside a dialog mounted before it opens", async () => {
    const wrapper = keep(
      mount(
        defineComponent({
          components: { SituateIconButton },
          template:
            '<dialog><SituateIconButton label="More" icon="plus" /></dialog>',
        }),
        { attachTo: document.body },
      ),
    );
    await nextTick();
    const dialog = wrapper.get("dialog");
    dialog.element.setAttribute("open", "");
    const button = wrapper.get("button");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    button.element.focus();
    await vi.advanceTimersByTimeAsync(450);
    expect(dialog.find('[role="tooltip"]').exists()).toBe(true);
    expect(button.element.querySelector('[role="tooltip"]')).toBeNull();
  });
  it("updates icon-button help when its title changes", async () => {
    const wrapper = keep(
      mount(SituateIconButton, {
        attachTo: document.body,
        props: { label: "More", title: "Collection actions", icon: "plus" },
      }),
    );
    await nextTick();
    const button = wrapper.get("button");
    await button.trigger("pointerenter", { pointerType: "mouse" });
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Collection actions",
    );
    await wrapper.setProps({ title: "Note actions" });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await button.trigger("pointerenter", { pointerType: "mouse" });
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Note actions",
    );
  });
  it("does not show hover feedback for touch", async () => {
    vi.useFakeTimers();
    const wrapper = example();
    await wrapper
      .get("button")
      .trigger("pointerenter", { pointerType: "touch" });
    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });
  it("keeps icon-button attributes, listeners and existing descriptions on the button", async () => {
    const focus = vi.fn();
    const click = vi.fn();
    const wrapper = keep(
      mount(SituateIconButton, {
        attachTo: document.body,
        props: { label: "More", icon: "plus" },
        attrs: {
          class: "toolbar-action",
          "aria-describedby": "help",
          onFocus: focus,
          onClick: click,
        },
      }),
    );
    const button = wrapper.get("button");
    expect(button.classes()).toContain("toolbar-action");
    expect(button.attributes("title")).toBeUndefined();
    await nextTick();
    await nextTick();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    wrapper.vm.focus();
    await vi.advanceTimersByTimeAsync(450);
    expect(focus).toHaveBeenCalledOnce();
    expect(button.attributes("aria-describedby")).toContain("help ");
    await button.trigger("click");
    expect(click).toHaveBeenCalledOnce();
    await button.trigger("blur");
    expect(button.attributes("aria-describedby")).toBe("help");
  });
});
