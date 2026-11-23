import type { ObjectDirective } from "vue";

const observers = new WeakMap<HTMLElement, ResizeObserver>();

export const vOverflowTabStop: ObjectDirective<HTMLElement> = {
  mounted(element) {
    if (typeof ResizeObserver === "undefined") {
      element.tabIndex = 0;
      return;
    }

    const measure = () => {
      if (
        element.scrollHeight > element.clientHeight ||
        element.scrollWidth > element.clientWidth
      ) {
        element.tabIndex = 0;
      } else {
        element.removeAttribute("tabindex");
      }
    };

    const observer = new ResizeObserver(measure);
    observers.set(element, observer);
    observer.observe(element);
    // Content can grow while the scroll container stays the same size.
    for (const child of element.children) observer.observe(child);
    measure();
  },
  beforeUnmount(element) {
    observers.get(element)?.disconnect();
    observers.delete(element);
  },
};
