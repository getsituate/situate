(function () {
  "use strict";
  if (document.body.dataset.status !== "received") return;

  const surface = document.querySelector(".callback-surface");
  const receipt = document.querySelector(".callback-receipt");
  const effects = document.querySelector(".callback-celebration");
  const rig = window.SituateBendPerformance.create(
    document.querySelector(".callback-actor svg"),
  );
  const score = window.SituateCallbackScore;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const namespace = "http://www.w3.org/2000/svg";
  const particles = new Map();
  let elapsed = preference.matches ? score.duration : 0;
  let previous;
  let frame;
  let width = 0;
  let height = 0;
  let visible = true;
  let active = true;
  let disposed = false;

  function draw() {
    const time = Math.round(elapsed);
    const pose = score.frame(time);
    rig.set(pose.actor);
    receipt.setAttribute(
      "transform",
      `translate(${pose.receipt.x} ${pose.receipt.y}) rotate(${pose.receipt.rotation} 163 287)`,
    );
    surface.dataset.animationTime = String(Math.round(pose.time));
    const current = score.particles(time, width, height);
    const ids = new Set(current.map((piece) => piece.id));
    for (const [id, node] of particles) {
      if (!ids.has(id)) {
        node.remove();
        particles.delete(id);
      }
    }
    for (const piece of current) {
      let node = particles.get(piece.id);
      if (!node) {
        node = document.createElementNS(namespace, "g");
        node.setAttribute("class", "celebration-piece");
        const shape = document.createElementNS(
          namespace,
          piece.shape === "paper" ? "rect" : "path",
        );
        if (piece.shape === "sparkle") {
          shape.setAttribute(
            "d",
            "M0-12C2-3 3-2 12 0C3 2 2 3 0 12C-2 3-3 2-12 0C-3-2-2-3 0-12Z",
          );
          shape.setAttribute("transform", `scale(${piece.width / 24})`);
        } else if (piece.shape === "ribbon") {
          shape.setAttribute(
            "d",
            `M${-piece.width / 2} ${-piece.height / 2}Q${piece.width * 1.4} 0 ${-piece.width / 2} ${piece.height / 2}H${piece.width / 2}Q${piece.width * 2.4} 0 ${piece.width / 2} ${-piece.height / 2}Z`,
          );
        } else {
          for (const [name, value] of Object.entries({
            x: -piece.width / 2,
            y: -piece.height / 2,
            width: piece.width,
            height: piece.height,
            rx: 1,
          }))
            shape.setAttribute(name, String(value));
        }
        node.setAttribute("fill", `var(--situate-${piece.color})`);
        node.append(shape);
        effects.append(node);
        particles.set(piece.id, node);
      }
      node.setAttribute(
        "transform",
        `translate(${piece.x} ${piece.y}) rotate(${piece.rotation}) scale(${piece.scaleX} ${piece.scaleY})`,
      );
      node.setAttribute("opacity", String(piece.opacity));
    }
  }
  function stop() {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    previous = undefined;
    surface.dataset.animation =
      elapsed >= score.duration ? "settled" : "paused";
  }
  function tick(now) {
    frame = undefined;
    if (disposed) return;
    if (previous !== undefined)
      elapsed = Math.min(score.duration, elapsed + now - previous);
    previous = now;
    draw();
    if (elapsed >= score.duration) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(tick);
  }
  function reconcile() {
    if (disposed) return;
    if (preference.matches) {
      stop();
      elapsed = score.duration;
      draw();
      surface.dataset.animation = "settled";
      return;
    }
    if (
      !active ||
      !visible ||
      document.visibilityState !== "visible" ||
      elapsed >= score.duration
    ) {
      stop();
    } else if (frame === undefined) {
      surface.dataset.animation = "playing";
      frame = window.requestAnimationFrame(tick);
    }
  }
  const resize = new ResizeObserver(([entry]) => {
    if (!entry || disposed) return;
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    effects.setAttribute("viewBox", `0 0 ${width || 1} ${height || 1}`);
    draw();
  });
  const intersection =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          visible = !!entry?.isIntersecting;
          reconcile();
        });
  function show() {
    active = true;
    reconcile();
  }
  function hide(event) {
    active = false;
    stop();
    if (event.persisted) return;
    disposed = true;
    resize.disconnect();
    intersection?.disconnect();
    preference.removeEventListener("change", reconcile);
    document.removeEventListener("visibilitychange", reconcile);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
    effects.replaceChildren();
    particles.clear();
    rig.destroy();
  }
  resize.observe(effects);
  intersection?.observe(surface);
  preference.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  draw();
  reconcile();
})();
