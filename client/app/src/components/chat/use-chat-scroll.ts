import { nextTick, ref, watch, type Ref } from "vue";

export function useChatScroll(
  viewport: Readonly<Ref<HTMLElement | null>>,
  content: Readonly<Ref<HTMLElement | null>>,
  visible: Readonly<Ref<boolean>>,
  initialTop: number | undefined,
  changed: (top: number) => void,
) {
  const awayFromEnd = ref(false);
  let initialized = false;
  let following = initialTop === undefined;
  let top = initialTop ?? 0;
  let restoreTop = initialTop;
  let height = 0;
  let width = 0;
  let contentHeight = 0;
  let anchor: { element: HTMLElement; offset: number } | undefined;

  function remember() {
    const element = viewport.value;
    if (!element) return;
    top = element.scrollTop;
    height = element.clientHeight;
    width = element.clientWidth;
    contentHeight = element.scrollHeight;
    awayFromEnd.value = height > 0 && contentHeight - height - top > 48;
    const edge = element.getBoundingClientRect().top;
    const item = Array.from(
      content.value?.querySelectorAll<HTMLElement>(
        ".messages > :not(.work-history), .work-history > .work-history-heading, .work-history > .history-segment:not([hidden])",
      ) ?? [],
    ).find((item) => item.getBoundingClientRect().bottom > edge);
    anchor = item
      ? { element: item, offset: item.getBoundingClientRect().top - edge }
      : undefined;
    changed(restoreTop ?? top);
  }
  function resize() {
    const element = viewport.value;
    if (!element || !initialized || !visible.value || !element.clientHeight)
      return;
    const clampedTop = Math.min(
      top,
      Math.max(0, element.scrollHeight - element.clientHeight),
    );
    if (element.scrollTop !== clampedTop) {
      restoreTop = undefined;
      following =
        element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    }
    if (restoreTop !== undefined) {
      element.scrollTop = restoreTop;
      if (element.scrollTop === restoreTop) {
        restoreTop = undefined;
        following =
          element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
      }
    } else if (following) element.scrollTop = element.scrollHeight;
    else if (anchor && content.value?.contains(anchor.element)) {
      // A resize can arrive before the scroll event for the reader's movement.
      const pendingScrollDelta = element.scrollTop - top;
      element.scrollTop +=
        anchor.element.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        anchor.offset +
        pendingScrollDelta;
    }
    remember();
  }
  function capture() {
    const element = viewport.value;
    if (!element || !initialized || !visible.value || !element.clientHeight)
      return;
    if (
      height !== element.clientHeight ||
      width !== element.clientWidth ||
      contentHeight !== element.scrollHeight
    ) {
      resize();
      return;
    }
    if (element.scrollTop !== top) {
      restoreTop = undefined;
      following =
        element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    }
    remember();
  }
  function follow() {
    restoreTop = undefined;
    following = true;
    resize();
  }
  function inspect(event: MouseEvent) {
    const summary = (event.target as Element).closest(
      "summary, [data-chat-disclosure]",
    );
    if (!summary || !content.value?.contains(summary)) return;
    restoreTop = undefined;
    following = false;
    remember();
  }
  function wheel(event: WheelEvent) {
    if (event.deltaY < 0) {
      restoreTop = undefined;
      following = false;
    }
  }

  watch(
    [viewport, content, visible],
    async ([element, body, shown], _previous, cleanup) => {
      let active = true;
      let observer: ResizeObserver | undefined;
      let frame: number | undefined;
      cleanup(() => {
        active = false;
        observer?.disconnect();
        if (frame !== undefined) cancelAnimationFrame(frame);
      });
      if (!element || !body || !shown) return;
      await nextTick();
      if (!active) return;
      element.scrollTop = following
        ? element.scrollHeight
        : (restoreTop ?? top);
      initialized = true;
      if (element.clientHeight) resize();
      else remember();
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          if (!active || frame !== undefined) return;
          frame = requestAnimationFrame(() => {
            frame = undefined;
            if (active) resize();
          });
        });
        observer.observe(element);
        observer.observe(body);
      }
    },
    { flush: "post" },
  );

  return { awayFromEnd, capture, follow, inspect, wheel };
}
