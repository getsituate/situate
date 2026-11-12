import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SituateScrollbars from "./SituateScrollbars.vue";
import { SCROLLBAR_IDLE_MS } from "./scrollbars";
const wrappers: VueWrapper[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});
function install() {
  const wrapper = mount(SituateScrollbars, {
    attachTo: document.body,
    slots: { default: '<div id="content"><div id="nested"></div></div>' },
  });
  wrappers.push(wrapper);
  return wrapper;
}
function area(id = "content", horizontal = false) {
  const element = document.getElementById(id)!;
  Object.defineProperties(element, {
    scrollHeight: { value: horizontal ? 100 : 800, configurable: true },
    clientHeight: { value: 100, configurable: true },
    scrollWidth: { value: horizontal ? 800 : 100, configurable: true },
    clientWidth: { value: 100, configurable: true },
  });
  return element;
}
function scroll(element: HTMLElement) {
  element.dispatchEvent(new Event("scroll"));
}
function visible(element: HTMLElement) {
  return element.hasAttribute("data-situate-scrolling");
}
describe("SituateScrollbars", () => {
  it("activates only a scrolling element, never its parent or hovered siblings", () => {
    install();
    const parent = area();
    const nested = area("nested");
    expect(
      document.documentElement.classList.contains("situate-scrollbars"),
    ).toBe(true);
    nested.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(visible(nested)).toBe(false);
    scroll(nested);
    expect(visible(nested)).toBe(true);
    expect(visible(parent)).toBe(false);
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS);
    expect(visible(nested)).toBe(false);
  });
  it("keeps independent horizontal and vertical timers and restarts on continued scrolling", () => {
    install();
    const parent = area("content", true);
    const nested = area("nested");
    scroll(parent);
    scroll(nested);
    vi.advanceTimersByTime(600);
    scroll(parent);
    vi.advanceTimersByTime(300);
    expect(visible(parent)).toBe(true);
    expect(visible(nested)).toBe(false);
    vi.advanceTimersByTime(600);
    expect(visible(parent)).toBe(false);
  });
  it("includes late-mounted and teleported scroll areas without requiring layout wrappers", () => {
    install();
    const popup = document.createElement("div");
    popup.id = "popup";
    document.body.append(popup);
    const target = area("popup");
    scroll(target);
    expect(visible(target)).toBe(true);
    expect(target.closest("#content")).toBeNull();
  });
  it("ignores nonoverflowing elements", () => {
    install();
    const element = document.getElementById("content")!;
    scroll(element);
    expect(visible(element)).toBe(false);
  });
  it("does not hide an active scrollbar during a held pointer and releases on blur", () => {
    install();
    const target = area();
    scroll(target);
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS * 2);
    expect(visible(target)).toBe(true);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS);
    expect(visible(target)).toBe(false);
  });
  it.each(["pointerup", "pointercancel"])(
    "resumes hiding after %s",
    (event) => {
      install();
      const target = area();
      scroll(target);
      target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(SCROLLBAR_IDLE_MS);
      target.dispatchEvent(new Event(event, { bubbles: true }));
      vi.advanceTimersByTime(SCROLLBAR_IDLE_MS);
      expect(visible(target)).toBe(false);
    },
  );
  it("does not hold or restart a scrollbar for pointer activity elsewhere", () => {
    install();
    const target = area();
    const other = area("nested");
    scroll(target);
    other.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
    );
    vi.advanceTimersByTime(600);
    other.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
    );
    vi.advanceTimersByTime(300);
    expect(visible(target)).toBe(false);
    scroll(target);
    other.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 2 }),
    );
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS);
    expect(visible(target)).toBe(false);
  });
  it("releases detached areas even during a held pointer", () => {
    install();
    const target = area();
    scroll(target);
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    target.remove();
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS);
    expect(visible(target)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shares one installation and cleans timers, listeners and styles after the last owner unmounts", () => {
    const first = install();
    const second = install();
    const target = area();
    scroll(target);
    first.unmount();
    expect(
      document.documentElement.classList.contains("situate-scrollbars"),
    ).toBe(true);
    second.unmount();
    expect(
      document.documentElement.classList.contains("situate-scrollbars"),
    ).toBe(false);
    expect(visible(target)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    document.body.append(target);
    scroll(target);
    expect(visible(target)).toBe(false);
  });
});
