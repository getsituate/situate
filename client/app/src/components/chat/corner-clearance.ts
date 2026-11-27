import type { ObjectDirective } from "vue";

const watchers = new WeakMap<HTMLElement, () => void>();

function watchCorners(element: HTMLElement) {
  const observer =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measure)
      : undefined;
  const mutations = new MutationObserver(bind);
  let corners: HTMLElement[] = [];
  let column: HTMLElement | null = null;
  let transcript = false;
  let reserved = 0;
  function measure() {
    const frame = element.getBoundingClientRect();
    const scale = element.offsetWidth ? frame.width / element.offsetWidth : 0;
    if (!scale) return;
    const rect = column?.getBoundingClientRect();
    const next = corners.reduce((result, corner) => {
      const bounds = corner.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return result;
      const overlaps =
        rect &&
        bounds.left < rect.right + 8 * scale &&
        bounds.right > rect.left - 8 * scale;
      const obstructs =
        overlaps &&
        (transcript || rect.top - reserved * scale < bounds.bottom + 8 * scale);
      return obstructs || element.hasAttribute("data-changes-only")
        ? Math.max(result, Math.ceil((bounds.bottom - frame.top) / scale) + 8)
        : result;
    }, 0);
    if (next !== reserved) {
      reserved = next;
      element.style.setProperty("--chat-corner-clearance", `${next}px`);
    }
  }
  function bind() {
    const nextCorners = [
      ...element.querySelectorAll<HTMLElement>(
        ".chat-corner-start, .chat-corner-actions",
      ),
    ];
    const messages = element.querySelector<HTMLElement>(
      ".has-history .messages",
    );
    const error = element.querySelector<HTMLElement>(".chat-load-error");
    transcript = !!(messages || error);
    const nextColumn =
      error ??
      messages ??
      element.querySelector<HTMLElement>(
        ".empty-chat:not(.has-history) .welcome",
      );
    if (
      nextColumn !== column ||
      nextCorners.length !== corners.length ||
      nextCorners.some((corner, index) => corner !== corners[index])
    ) {
      observer?.disconnect();
      corners = nextCorners;
      column = nextColumn;
      for (const target of [element, column, ...corners])
        if (target) observer?.observe(target);
    }
    measure();
  }
  mutations.observe(element, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-changes-only"],
  });
  bind();
  return () => {
    observer?.disconnect();
    mutations.disconnect();
    element.style.removeProperty("--chat-corner-clearance");
  };
}

export const vChatCornerClearance: ObjectDirective<HTMLElement, boolean> = {
  mounted(element, { value }) {
    if (value) watchers.set(element, watchCorners(element));
  },
  updated(element, { value, oldValue }) {
    if (value === oldValue) return;
    watchers.get(element)?.();
    watchers.delete(element);
    if (value) watchers.set(element, watchCorners(element));
  },
  beforeUnmount(element) {
    watchers.get(element)?.();
    watchers.delete(element);
  },
};
