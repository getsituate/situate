"use strict";
(() => {
  function create(root) {
    if (!root || !window.SituateBendMini) return null;
    const find = (selector) => root.querySelector(selector);
    const format = find("#mini-format");
    const mark = find("#mini-mark");
    const status = find("#mini-status");
    const result = find("#mini-result");
    const note = find("#mini-note");
    const buttons = ["open", "complete", "error", "cancel"].map((name) =>
      find(`#mini-${name}`),
    );
    const messages = {
      idle: "No note open.",
      loading: "Opening the sample note…",
      complete: "Sample note opened.",
      error: "The sample note couldn’t open. Try again.",
      cancelled: "Opening cancelled. No note opened.",
    };
    let state = "idle";
    let timer = null;
    let controller = null;
    let paused = false;
    let destroyed = false;

    function renderMark() {
      controller?.destroy();
      mark.innerHTML = window.SituateBendMini.render({ format: format.value });
      controller = window.SituateBendMini.create(mark.firstElementChild);
      if (paused) controller.pause();
      controller.setBusy(state === "loading");
    }

    function show(next) {
      state = next;
      const busy = state === "loading";
      root.dataset.miniState = state;
      controller?.setBusy(busy);
      result.setAttribute("aria-busy", String(busy));
      status.textContent = messages[state];
      note.hidden = state !== "complete";
      buttons.forEach((button, index) => {
        button.disabled = false;
        button.setAttribute(
          "aria-disabled",
          String(index === 0 ? busy : !busy),
        );
      });
    }

    function finish(next) {
      clearTimeout(timer);
      timer = null;
      show(next);
    }

    function act(event) {
      const index = buttons.indexOf(event.target.closest("button"));
      if (index < 0 || buttons[index].getAttribute("aria-disabled") === "true")
        return;
      if (index === 0) {
        show("loading");
        timer = setTimeout(() => finish("complete"), 4000);
      } else {
        finish(["", "complete", "error", "cancelled"][index]);
      }
    }

    function hide() {
      if (state === "loading") finish("cancelled");
      controller?.destroy();
      controller = null;
    }
    function restore(event) {
      if (event.persisted && !destroyed) renderMark();
    }

    renderMark();
    show("idle");
    format.disabled = false;
    find("#mini-fallback").hidden = true;
    format.addEventListener("change", renderMark);
    root.addEventListener("click", act);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);

    return Object.freeze({
      setMotionPaused(value) {
        if (destroyed) return;
        paused = value;
        if (paused) controller?.pause();
        else controller?.resume();
      },
      destroy() {
        if (destroyed) return;
        hide();
        destroyed = true;
        format.removeEventListener("change", renderMark);
        root.removeEventListener("click", act);
        window.removeEventListener("pagehide", hide);
        window.removeEventListener("pageshow", restore);
        format.disabled = true;
        buttons.forEach((button) => {
          button.disabled = true;
        });
      },
    });
  }
  window.SituateMiniExample = Object.freeze({ create });
})();
