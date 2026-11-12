window.withSmokeReadMenuTrace = async (run) => {
  const events = [];
  const started = performance.now();
  const types = [
    "click",
    "focus",
    "blur",
    "focusin",
    "focusout",
    "resize",
    "scroll",
  ];
  const state = () => ({
    expanded:
      document
        .querySelector('button[aria-label="File actions"]')
        ?.getAttribute("aria-expanded") ?? null,
    menuExists: !!document.querySelector(".file-action-menu"),
    focused: document.hasFocus(),
  });
  const describe = (target) => {
    const menu = document.querySelector(".file-action-menu");
    if (target === window) return { kind: "window", insideMenu: false };
    if (target === document) return { kind: "document", insideMenu: false };
    if (!(target instanceof Element))
      return { kind: target == null ? "none" : "other", insideMenu: false };
    return {
      kind: "element",
      tag: target.tagName,
      role: target.getAttribute("role"),
      insideMenu: !!menu?.contains(target),
    };
  };
  const record = (event) => {
    events.push({
      elapsedMs: Math.round(performance.now() - started),
      type: event.type,
      target: describe(event.target),
      relatedTarget: describe(event.relatedTarget),
      ...state(),
    });
    if (events.length > 32) events.shift();
  };
  for (const type of types) window.addEventListener(type, record, true);
  try {
    return await run(() => ({ events: [...events], ...state() }));
  } finally {
    for (const type of types) window.removeEventListener(type, record, true);
  }
};
