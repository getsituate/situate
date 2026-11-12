import "./popover-test-environment";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { SituatePopover } from "@situate/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { popupBounds } from "../../../packages/ui/src/popup-bounds";

enableAutoUnmount(afterEach);
afterEach(() => document.body.replaceChildren());
function viewport() {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 20,
    offsetTop: 100,
    width: 340,
    height: 300,
  });
  vi.stubGlobal("visualViewport", viewport);
  return viewport;
}
function anchor(host: HTMLElement = document.body) {
  const button = document.createElement("button");
  host.append(button);
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 120, 44, 44),
  );
  button.focus();
  return button;
}
describe("popover placement and lifecycle", () => {
  it("tracks native open state through controlled closure, reopening and light dismissal", async () => {
    const button = anchor();
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: false, label: "Details", anchor: button },
    });
    const element = wrapper.vm.element!;
    expect(element.matches(":popover-open")).toBe(false);
    await wrapper.setProps({ open: true });
    await nextTick();
    expect(element.matches(":popover-open")).toBe(true);
    expect(document.activeElement).toBe(element);
    await wrapper.setProps({ open: false });
    await nextTick();
    expect(element.matches(":popover-open")).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(wrapper.emitted("close")).toBeUndefined();
    await wrapper.setProps({ open: true });
    await nextTick();
    element.hidePopover();
    expect(element.matches(":popover-open")).toBe(false);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(document.activeElement).toBe(button);
  });
  it.each(["pointerdown", "blur"])(
    "keeps context menus through pointer release and dismisses on %s",
    async (event) => {
      const button = anchor();
      const wrapper = mount(SituatePopover, {
        attachTo: document.body,
        props: {
          open: true,
          label: "Actions",
          anchor: button,
          point: { x: 60, y: 140 },
        },
      });
      await nextTick();
      const element = wrapper.vm.element!;
      expect(element.getAttribute("popover")).toBe("manual");
      document.body.dispatchEvent(new Event("pointerup", { bubbles: true }));
      element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(element.matches(":popover-open")).toBe(true);
      expect(wrapper.emitted("close")).toBeUndefined();
      (event === "blur" ? window : document.body).dispatchEvent(
        new Event(event, { bubbles: true }),
      );
      expect(element.matches(":popover-open")).toBe(false);
      expect(wrapper.emitted("close")).toHaveLength(1);
    },
  );
  it("tracks late anchors and container resizing only while open", async () => {
    const observed = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) {
          observed.set(element, this.callback);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
    const pane = document.createElement("div");
    document.body.append(pane);
    const button = anchor(pane);
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: false, label: "Details" },
    });
    await nextTick();
    expect(observed.size).toBe(0);
    await wrapper.setProps({ open: true });
    await nextTick();
    await wrapper.setProps({ anchor: button });
    await nextTick();
    expect(observed.has(pane)).toBe(true);
    expect(observed.has(button)).toBe(true);
    vi.mocked(button.getBoundingClientRect).mockReturnValue(
      new DOMRect(200, 120, 44, 44),
    );
    observed.get(pane)!([], {} as ResizeObserver);
    expect(wrapper.vm.element!.style.left).toBe("244px");
    const replacement = anchor(pane);
    await wrapper.setProps({ anchor: replacement });
    await nextTick();
    expect(observed.has(button)).toBe(false);
    expect(observed.has(replacement)).toBe(true);
    expect(wrapper.vm.element!.style.left).toBe("84px");
    await wrapper.setProps({ open: false });
    await nextTick();
    expect(observed.size).toBe(0);
    expect(document.activeElement).toBe(replacement);
  });
  it("does not start tracking after unmounting during opening", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: true, label: "Details" },
    });
    wrapper.unmount();
    await nextTick();
    expect(
      added.mock.calls.filter(([name]) => name === "resize" || name === "blur"),
    ).toHaveLength(0);
  });
  it.each([false, true])(
    "clears a removed anchor with point placement %s",
    async (pointOnly) => {
      const button = anchor();
      const wrapper = mount(SituatePopover, {
        attachTo: document.body,
        props: {
          open: true,
          label: "Details",
          anchor: button,
          point: pointOnly ? { x: 60, y: 140 } : undefined,
        },
      });
      await nextTick();
      const element = wrapper.vm.element!;
      await wrapper.setProps({ anchor: null });
      await nextTick();
      expect(element.matches(":popover-open")).toBe(pointOnly);
      if (pointOnly) expect(wrapper.emitted("close")).toBeUndefined();
      else expect(wrapper.emitted("close")).toHaveLength(1);
    },
  );
  it("keeps optional size limits within the viewport and updates alignment", async () => {
    const button = anchor();
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: {
        open: true,
        label: "Details",
        anchor: button,
        align: "start",
        maxHeight: 280,
      },
    });
    await nextTick();
    const popup = wrapper.vm.element!;
    expect(popup.style.left).toBe("40px");
    expect(popup.style.maxHeight).toBe("280px");
    await wrapper.setProps({ align: "end", maxHeight: 5000 });
    expect(popup.style.left).toBe("84px");
    expect(popup.style.maxHeight).toBe(`${window.innerHeight - 16}px`);
  });
  it("clamps pointer placement to the visual viewport and follows keyboard viewport changes", async () => {
    const view = viewport();
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: true, label: "Actions", point: { x: 900, y: 900 } },
    });
    await nextTick();
    const element = wrapper.vm.element!;
    Object.defineProperties(element, {
      offsetWidth: { value: 200 },
      offsetHeight: { value: 100 },
    });
    view.dispatchEvent(new Event("resize"));
    expect(element.style.left).toBe("152px");
    expect(element.style.top).toBe("292px");
    expect(element.style.maxHeight).toBe("284px");
    view.height = 180;
    view.dispatchEvent(new Event("resize"));
    expect(element.style.top).toBe("172px");
    expect(element.style.maxHeight).toBe("164px");
    await wrapper.setProps({ point: { x: -10, y: -10 } });
    expect(element.style.left).toBe("28px");
    expect(element.style.top).toBe("108px");
  });
  it("intersects safe layout edges with the visual viewport without reapplying insets above the keyboard", () => {
    const view = viewport();
    const element = document.createElement("div");
    document.body.append(element);
    vi.stubGlobal("innerWidth", 400);
    vi.stubGlobal("innerHeight", 800);
    element.style.setProperty("--situate-popup-safe-top", "44px");
    element.style.setProperty("--situate-popup-safe-left", "30px");
    element.style.setProperty("--situate-popup-safe-right", "50px");
    element.style.setProperty("--situate-popup-safe-bottom", "34px");
    expect(popupBounds(element)).toEqual({
      left: 38,
      top: 108,
      right: 342,
      bottom: 392,
    });
    Object.assign(view, { offsetTop: 0, height: 800 });
    expect(popupBounds(element)).toEqual({
      left: 38,
      top: 52,
      right: 342,
      bottom: 758,
    });
  });
  it("dismisses when the anchor moves outside visible bounds and removes viewport listeners", async () => {
    const view = viewport();
    const button = anchor();
    const remove = vi.spyOn(view, "removeEventListener");
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: true, label: "Actions", anchor: button },
    });
    await nextTick();
    Object.assign(view, { offsetTop: 300 });
    view.dispatchEvent(new Event("scroll"));
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
  it("hosts inside the invoking modal, isolates Escape, preserves root attributes and restores focus", async () => {
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    const button = anchor(dialog);
    const outer = vi.fn();
    dialog.addEventListener("keydown", outer);
    const wrapper = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: true, label: "Actions", anchor: button },
      attrs: { class: "custom-popup", "aria-describedby": "help" },
      slots: { default: '<input aria-label="Find">' },
    });
    await nextTick();
    await nextTick();
    const element = wrapper.vm.element!;
    expect(element.parentElement).toBe(dialog);
    expect(element.classList.contains("custom-popup")).toBe(true);
    expect(element.getAttribute("aria-describedby")).toBe("help");
    expect(document.activeElement).toBe(element.querySelector("input"));
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
  it("restores a connected invoker on unmount and leaves removed invokers alone", async () => {
    const button = anchor();
    const focus = vi.spyOn(button, "focus");
    const visible = ref(true);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          visible.value
            ? h(SituatePopover, {
                open: true,
                label: "Details",
                anchor: button,
              })
            : null,
      }),
      { attachTo: document.body },
    );
    await nextTick();
    expect(document.activeElement).toBe(
      wrapper.getComponent(SituatePopover).vm.element,
    );
    visible.value = false;
    await nextTick();
    expect(focus).toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    const other = mount(SituatePopover, {
      attachTo: document.body,
      props: { open: true, label: "Details", anchor: button },
    });
    await nextTick();
    button.remove();
    focus.mockClear();
    other.unmount();
    expect(focus).not.toHaveBeenCalled();
  });
});
