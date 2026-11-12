(function (root, factory) {
  "use strict";
  const kit = factory();
  const commonJs = typeof module === "object" && module.exports;
  if (commonJs) module.exports = kit;
  if (!commonJs || typeof root.document === "object")
    root.SituateBendMini = kit;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const geometry = Object.freeze({
    viewBox: "0 0 32 32",
    body: "M7 25V13a9 9 0 0 1 18 0v12",
    bodyWidth: 7,
    eyeWidth: 1.6,
  });
  const frames = Object.freeze({
    rest: Object.freeze({
      ascii: " .-. \n|' '|\n|   |",
      eyes: "M13 11v3m6-3v3",
    }),
    focus: Object.freeze({
      ascii: " .-. \n|. .|\n|   |",
      eyes: "M13 12.5v3m6-3v3",
    }),
    blink: Object.freeze({
      ascii: " .-. \n|- -|\n|   |",
      eyes: "M12 13h2m4 0h2",
    }),
  });
  const score = Object.freeze([
    Object.freeze({ frame: "rest", duration: 900 }),
    Object.freeze({ frame: "focus", duration: 600 }),
    Object.freeze({ frame: "blink", duration: 120 }),
    Object.freeze({ frame: "rest", duration: 780 }),
  ]);
  const owners = new WeakMap();

  function escape(value) {
    return value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }

  function render(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Bend mini options must be an object.");
    }
    const { format = "svg", decorative = true, title = "Bend" } = options;
    if (format !== "svg" && format !== "ascii")
      throw new TypeError("Unknown Bend mini format.");
    if (typeof decorative !== "boolean")
      throw new TypeError("decorative must be a boolean.");
    if (
      typeof title !== "string" ||
      !title.trim() ||
      // eslint-disable-next-line no-control-regex -- Accessible labels must reject control characters.
      /[\x00-\x1f\x7f]/.test(title)
    ) {
      throw new TypeError(
        "title must be nonempty text without control characters.",
      );
    }
    const name = decorative
      ? 'aria-hidden="true"'
      : `role="img" aria-label="${escape(title)}"`;
    const common = `data-bend-mini="${format}" data-mini-frame="rest" class="bend-mini bend-mini--${format}" ${name}`;
    if (format === "ascii") {
      return `<span ${common} style="white-space:pre"><span data-mini-glyph="" aria-hidden="true">${frames.rest.ascii}</span></span>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${geometry.viewBox}" ${common} focusable="false"><path data-mini-body="" d="${geometry.body}" fill="none" stroke="currentColor" stroke-width="${geometry.bodyWidth}" stroke-linecap="round"/><path data-mini-eyes="" d="${frames.rest.eyes}" fill="none" stroke="currentColor" stroke-width="${geometry.eyeWidth}" stroke-linecap="round"/></svg>`;
  }

  function create(element) {
    const format =
      element && element.getAttribute && element.getAttribute("data-bend-mini");
    const doc = element && element.ownerDocument;
    const win = doc && doc.defaultView;
    const svg = format === "svg";
    const target =
      element &&
      element.querySelector &&
      element.querySelector(svg ? "[data-mini-eyes]" : "[data-mini-glyph]");
    if (
      !win ||
      !["svg", "ascii"].includes(format) ||
      !target ||
      (svg
        ? element.localName !== "svg" ||
          !element.querySelector("[data-mini-body]")
        : element.localName !== "span")
    ) {
      throw new TypeError("create requires a rendered Bend mini root.");
    }
    const previous = owners.get(element);
    if (previous) previous.destroy();

    let busy = false;
    let paused = false;
    let destroyed = false;
    let timer = null;
    let index = 0;
    let frame = null;
    let intersecting = true;
    const preference =
      typeof win.matchMedia === "function"
        ? win.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

    function paint(next) {
      if (frame === next) return;
      frame = next;
      element.setAttribute("data-mini-frame", next);
      if (svg) target.setAttribute("d", frames[next].eyes);
      else target.textContent = frames[next].ascii;
    }

    function inBounds() {
      if (!element.isConnected) return false;
      const box = element.getBoundingClientRect();
      const style = win.getComputedStyle(element);
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.right > 0 &&
        box.top < win.innerHeight &&
        box.left < win.innerWidth &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse"
      );
    }

    function canRun() {
      return (
        !destroyed &&
        busy &&
        !paused &&
        !(preference && preference.matches) &&
        !doc.hidden &&
        intersecting &&
        inBounds()
      );
    }

    function rest() {
      if (timer !== null) win.clearTimeout(timer);
      timer = null;
      index = 0;
      paint("rest");
    }

    function schedule() {
      timer = win.setTimeout(() => {
        timer = null;
        if (!canRun()) {
          rest();
          return;
        }
        index = (index + 1) % score.length;
        paint(score[index].frame);
        schedule();
      }, score[index].duration);
    }

    function reconcile() {
      if (destroyed) return;
      if (!canRun()) {
        rest();
        return;
      }
      // Every suspension restarts the score; hidden time never advances it.
      if (timer === null) {
        index = 0;
        paint("rest");
        schedule();
      }
    }

    const intersection =
      typeof win.IntersectionObserver === "function"
        ? new win.IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (entry.target === element)
                intersecting =
                  entry.isIntersecting &&
                  entry.intersectionRect.width > 0 &&
                  entry.intersectionRect.height > 0;
            }
            reconcile();
          })
        : null;
    // Removal can happen between frames. Observe it without keeping a polling timer alive.
    const mutations =
      typeof win.MutationObserver === "function"
        ? new win.MutationObserver(reconcile)
        : null;
    const controller = {
      setBusy(value) {
        if (destroyed) return;
        if (typeof value !== "boolean")
          throw new TypeError("busy must be a boolean.");
        busy = value;
        reconcile();
      },
      pause() {
        if (!destroyed) {
          paused = true;
          reconcile();
        }
      },
      resume() {
        if (!destroyed) {
          paused = false;
          reconcile();
        }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        busy = false;
        rest();
        doc.removeEventListener("visibilitychange", reconcile);
        win.removeEventListener("resize", reconcile);
        win.removeEventListener("scroll", reconcile, true);
        if (preference) {
          if (preference.removeEventListener)
            preference.removeEventListener("change", reconcile);
          else preference.removeListener(reconcile);
        }
        if (intersection) intersection.disconnect();
        if (mutations) mutations.disconnect();
        if (owners.get(element) === controller) owners.delete(element);
      },
      get state() {
        return Object.freeze({
          busy,
          paused,
          running: timer !== null,
          destroyed,
          frame,
        });
      },
    };
    owners.set(element, controller);
    paint("rest");
    doc.addEventListener("visibilitychange", reconcile);
    win.addEventListener("resize", reconcile);
    win.addEventListener("scroll", reconcile, true);
    if (preference) {
      if (preference.addEventListener)
        preference.addEventListener("change", reconcile);
      else preference.addListener(reconcile);
    }
    if (intersection) intersection.observe(element);
    if (mutations)
      mutations.observe(doc.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["hidden", "style", "class"],
      });
    reconcile();
    return controller;
  }

  return Object.freeze({ render, create, geometry, frames, score });
});
