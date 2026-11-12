export const SCROLLBAR_IDLE_MS = 900;
const installed = new WeakMap<
  Document,
  { users: number; dispose: () => void }
>();

export function installScrollbars(doc: Document): () => void {
  let instance = installed.get(doc);
  if (!instance) {
    const active = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    const held = new Map<number, HTMLElement>();
    const hide = (element: HTMLElement) => {
      const timer = active.get(element);
      if (timer) clearTimeout(timer);
      active.delete(element);
      element.removeAttribute("data-situate-scrolling");
    };
    const schedule = (element: HTMLElement) => {
      const timer = active.get(element);
      if (timer) clearTimeout(timer);
      active.set(
        element,
        setTimeout(() => {
          if ([...held.values()].includes(element) && element.isConnected)
            schedule(element);
          else hide(element);
        }, SCROLLBAR_IDLE_MS),
      );
    };
    const scroll = (event: Event) => {
      const element =
        event.target === doc ? doc.scrollingElement : event.target;
      if (!(element instanceof HTMLElement)) return;
      if (
        element.scrollHeight <= element.clientHeight &&
        element.scrollWidth <= element.clientWidth
      )
        return;
      element.setAttribute("data-situate-scrolling", "");
      schedule(element);
    };
    const down = (event: PointerEvent) => {
      const element = event.target;
      if (
        element instanceof HTMLElement &&
        (element.scrollHeight > element.clientHeight ||
          element.scrollWidth > element.clientWidth)
      )
        held.set(event.pointerId, element);
    };
    const up = (event: PointerEvent) => {
      const element = held.get(event.pointerId);
      held.delete(event.pointerId);
      if (element && active.has(element)) schedule(element);
    };
    const blur = () => {
      const elements = new Set(held.values());
      held.clear();
      elements.forEach((element) => {
        if (active.has(element)) schedule(element);
      });
    };
    doc.documentElement.classList.add("situate-scrollbars");
    doc.addEventListener("scroll", scroll, { capture: true, passive: true });
    doc.addEventListener("pointerdown", down, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", up, true);
    doc.defaultView?.addEventListener("blur", blur);
    instance = {
      users: 0,
      dispose() {
        doc.removeEventListener("scroll", scroll, true);
        doc.removeEventListener("pointerdown", down, true);
        doc.removeEventListener("pointerup", up, true);
        doc.removeEventListener("pointercancel", up, true);
        doc.defaultView?.removeEventListener("blur", blur);
        active.forEach((_timer, element) => hide(element));
        doc.documentElement.classList.remove("situate-scrollbars");
        installed.delete(doc);
      },
    };
    installed.set(doc, instance);
  }
  instance.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--instance.users === 0) instance.dispose();
  };
}
