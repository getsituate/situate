import { nextTick } from "vue";
import { recoveryState } from "../../src/errors/runtime";

function describeFocus(element: Element | null) {
  return element
    ? {
        tag: element.tagName,
        classes: [...element.classList]
          .slice(0, 6)
          .map((value) => value.slice(0, 40)),
        inert: !!element.closest("[inert]"),
        preview: !!element.closest("[data-plugin-preview]"),
        dialog: !!element.closest('dialog[open], [role="dialog"]'),
        workspace: !!element.closest(".topic-window"),
      }
    : null;
}

export async function withPluginCheckFocus<T>(
  execute: () => Promise<T>,
): Promise<T> {
  await nextTick();
  const previous = document.activeElement;
  const target = document.createElement("button");
  target.tabIndex = -1;
  target.setAttribute("aria-hidden", "true");
  target.style.cssText = "position:fixed;left:-10000px;top:0";
  document.body.append(target);
  target.focus({ preventScroll: true });
  const changes: ReturnType<typeof describeFocus>[] = [];
  const changed = (event: FocusEvent) => {
    if (event.target instanceof Element && changes.length < 8)
      changes.push(describeFocus(event.target));
  };
  document.addEventListener("focusin", changed, true);
  let previewMounted = document.querySelector("[data-plugin-preview]") !== null;
  const observePreviews = (records: MutationRecord[]) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (
          node instanceof Element &&
          (node.matches("[data-plugin-preview]") ||
            node.querySelector("[data-plugin-preview]"))
        )
          previewMounted = true;
  };
  const observer = new MutationObserver(observePreviews);
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    if (document.activeElement !== target)
      throw new Error(
        "Plugin check focus target unavailable " +
          JSON.stringify({
            target: describeFocus(target),
            current: describeFocus(document.activeElement),
            incidents: recoveryState.incidents.map(({ boundary, code }) => ({
              boundary,
              code,
            })),
            dialogs: [...document.querySelectorAll("dialog[open]")]
              .slice(0, 4)
              .map(describeFocus),
          }),
      );
    const result = await execute();
    // Window activation belongs to the OS; the retained DOM target detects
    // focus taken by a preview without depending on Vue's current view lifetime.
    if (document.activeElement !== target)
      throw new Error(
        "Plugin checks changed workspace focus " +
          JSON.stringify({
            previous: describeFocus(previous),
            current: describeFocus(document.activeElement),
            changes,
          }),
      );
    observePreviews(observer.takeRecords());
    if (previewMounted)
      throw new Error(
        "Plugin checks mounted a preview in the workspace window",
      );
    return result;
  } finally {
    observer.disconnect();
    document.removeEventListener("focusin", changed, true);
    const retained = document.activeElement === target;
    target.remove();
    if (retained && previous instanceof HTMLElement && previous.isConnected)
      previous.focus({ preventScroll: true });
  }
}
