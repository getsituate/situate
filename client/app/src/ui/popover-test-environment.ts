import { beforeEach, afterEach, vi } from "vitest";

let restore: (() => void) | undefined;
beforeEach(() => {
  const open = new Set<HTMLElement>();
  const originalMatches = Element.prototype.matches;
  const descriptors = ["showPopover", "hidePopover"].map((name) =>
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
  );
  function toggle(element: HTMLElement, showing: boolean) {
    if (open.has(element) === showing) return;
    const event = new Event("beforetoggle", { cancelable: showing });
    Object.defineProperties(event, {
      oldState: { value: showing ? "closed" : "open" },
      newState: { value: showing ? "open" : "closed" },
    });
    if (!element.dispatchEvent(event)) return;
    if (showing) open.add(element);
    else open.delete(element);
  }
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: {
      configurable: true,
      writable: true,
      value: vi.fn(function (this: HTMLElement) {
        if (this.getAttribute("popover") === "auto") {
          for (const previous of open) {
            if (
              previous.getAttribute("popover") === "auto" &&
              !previous.contains(this)
            )
              toggle(previous, false);
          }
        }
        toggle(this, true);
      }),
    },
    hidePopover: {
      configurable: true,
      writable: true,
      value: vi.fn(function (this: HTMLElement) {
        toggle(this, false);
      }),
    },
  });
  const matches = vi
    .spyOn(Element.prototype, "matches")
    .mockImplementation(function (this: Element, selector: string) {
      return selector === ":popover-open"
        ? open.has(this as HTMLElement)
        : originalMatches.call(this, selector);
    });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const scrollDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );
  Element.prototype.scrollIntoView = vi.fn();
  restore = () => {
    matches.mockRestore();
    for (const [index, name] of ["showPopover", "hidePopover"].entries()) {
      const descriptor = descriptors[index];
      if (descriptor)
        Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    if (scrollDescriptor)
      Object.defineProperty(
        Element.prototype,
        "scrollIntoView",
        scrollDescriptor,
      );
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    open.clear();
  };
});
afterEach(() => {
  restore?.();
  vi.unstubAllGlobals();
});
