(() => {
  const root = document.documentElement;
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = preference.matches;
  const replayButton = document.querySelector(".replay");
  const hero = document.querySelector(".hero-stage");
  const ribbon = document.querySelector(".ribbon");
  const ribbonTrack = ribbon?.querySelector(".ribbon-track");
  const ribbonGroup = ribbon?.querySelector(".ribbon-group");
  const stage = document.querySelector(".story-stage");
  const steps = [...document.querySelectorAll(".step")];
  const shots = [...document.querySelectorAll(".story-shot")];
  const scenes = [...document.querySelectorAll("[data-motion-scene]")];
  const visible = new Set();
  const played = new Set();
  const animations = new Set();
  const rigs = new Map();
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const smooth = (value) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  let frame = 0;
  let lastTime = 0;
  let dirty = true;
  let currentStep = -1;
  let viewerOpen = false;
  let heroElapsed = reduced ? 6800 : 0;
  let marquee = null;
  let marqueeWidth = 0;
  const canMove = () => !reduced && !document.hidden && !viewerOpen;

  root.classList.add("enhanced");
  if (replayButton) replayButton.hidden = false;

  for (const host of document.querySelectorAll("[data-bend-rig]")) {
    if (!window.SituateBend || !window.SituateBendPerformance) continue;
    const fallback = host.innerHTML;
    try {
      host.innerHTML = window.SituateBend.render({
        idPrefix: `website-${host.dataset.bendRig}`,
        pose: "rest",
        expression: "welcome",
        decorative: true,
      });
      rigs.set(host.dataset.bendRig, {
        rig: window.SituateBendPerformance.create(host.querySelector("svg")),
        scene: host.closest("[data-motion-scene]"),
        elapsed: reduced ? 2400 : 0,
        started: false,
      });
    } catch {
      host.innerHTML = fallback;
    }
  }

  function setHeroPose() {
    if (!hero) return;
    const t = heroElapsed / 1000;
    hero.style.setProperty("--opening", smooth(t / 2.4).toFixed(4));
    const greeting = smooth((t - 0.25) / 0.55) * (1 - smooth((t - 1.9) / 0.8));
    const presentation =
      smooth((t - 2.4) / 0.85) * (1 - 0.72 * smooth((t - 4.8) / 1.2));
    rigs.get("hero")?.rig.set({
      wave: greeting * 0.8,
      wavePhase: t * 6,
      present: presentation,
      gazeX: -0.8 * smooth((t - 1.9) / 0.6),
      gazeY: -0.25 * smooth((t - 1.9) / 0.6),
      blink: Math.max(0, 1 - Math.abs(t - 4.5) / 0.13),
      lean: -2 * presentation,
      bob: -2 * Math.sin(Math.PI * clamp(t / 2.4)),
    });
  }

  function syncRibbon(measure = false) {
    if (!ribbon) return;
    if (
      reduced ||
      !ribbonTrack.animate ||
      !("IntersectionObserver" in window)
    ) {
      marquee?.cancel();
      marquee = null;
      marqueeWidth = 0;
      ribbon.classList.remove("is-marquee");
      return;
    }
    ribbon.classList.add("is-marquee");
    const width =
      !marquee || measure
        ? ribbonGroup.getBoundingClientRect().width
        : marqueeWidth;
    if (!width) return;
    if (!marquee || Math.abs(width - marqueeWidth) > 0.5) {
      const phase = marquee
        ? ((marquee.currentTime || 0) / marquee.effect.getTiming().duration) % 1
        : 0;
      marquee?.cancel();
      marqueeWidth = width;
      const duration = (width / 60) * 1000;
      marquee = ribbonTrack.animate(
        [
          { transform: "translateX(0)" },
          { transform: `translateX(${-width}px)` },
        ],
        { duration, iterations: Infinity, easing: "linear" },
      );
      marquee.currentTime = phase * duration;
    }
    if (canMove() && visible.has(ribbon)) marquee.play();
    else marquee.pause();
  }

  function syncMotion() {
    root.classList.toggle("motion-still", !canMove());
    if (replayButton) replayButton.disabled = reduced;
    for (const animation of animations) {
      const scene = animation.effect.target.closest("[data-motion-scene]");
      if (canMove() && visible.has(scene)) animation.play();
      else animation.pause();
    }
    syncRibbon();
    lastTime = 0;
    requestFrame();
  }

  function requestFrame() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function animate(element, frames, options) {
    if (!element || !element.animate || !canMove()) return;
    const animation = element.animate(frames, options);
    animations.add(animation);
    animation.addEventListener("finish", () => animations.delete(animation), {
      once: true,
    });
    animation.addEventListener("cancel", () => animations.delete(animation), {
      once: true,
    });
  }

  function lift(element, distance = 24, turn = 0, delay = 0) {
    if (!element) return;
    const base = getComputedStyle(element).transform;
    const transform = base === "none" ? "" : base;
    animate(
      element,
      [
        {
          transform: `translateY(${distance}px) rotate(${turn}deg) ${transform}`,
        },
        { transform: `translateY(0) rotate(0deg) ${transform}` },
      ],
      { duration: 1100, delay, easing: "cubic-bezier(.22,.7,.25,1)" },
    );
  }

  function draw(element, duration = 1100) {
    if (!element) return;
    const length = element.getTotalLength();
    animate(
      element,
      [
        { strokeDasharray: `${length}`, strokeDashoffset: length },
        { strokeDasharray: `${length}`, strokeDashoffset: 0 },
      ],
      { duration, easing: "cubic-bezier(.22,.7,.25,1)" },
    );
  }

  function enter(scene) {
    if (played.has(scene) || !canMove()) return;
    played.add(scene);
    if (scene.classList.contains("story-stage")) {
      draw(scene.querySelector(".story-arrow path"));
    } else if (scene.classList.contains("plugins")) {
      lift(scene.querySelector(".plugin-screen"), 24, 3);
      draw(scene.querySelector(".plugin-orbit path"), 1600);
      const rig = rigs.get("plugins");
      if (rig) rig.started = true;
    } else if (scene.classList.contains("models")) {
      lift(scene.querySelector(".model-screen"), 25, -4);
    } else if (scene.classList.contains("free")) {
      lift(scene.querySelector(".free-price"), 24, -9);
      lift(scene.querySelector(".free-bend"), 18, 3, 150);
    } else if (scene.classList.contains("open-source")) {
      draw(scene.querySelector(".branch-line"), 1400);
    } else if (scene.classList.contains("ending")) {
      lift(scene.querySelector(".ending-fan"), 20, -12);
      const rig = rigs.get("ending");
      if (rig) rig.started = true;
    }
  }

  function updateStory() {
    if (!stage || !steps.length) return;
    const focusLine = innerHeight * 0.48;
    let index = 0;
    steps.forEach((step, candidate) => {
      if (step.getBoundingClientRect().top <= focusLine) index = candidate;
    });
    if (index !== currentStep) {
      currentStep = index;
      stage.dataset.step = String(index);
      shots.forEach((shot, candidate) => {
        const current = candidate === index;
        shot.classList.toggle("is-current", current);
        shot.inert = !current;
        shot.setAttribute("aria-hidden", String(!current));
      });
    }
    if (canMove()) {
      const rect = steps[index].getBoundingClientRect();
      const progress = clamp((focusLine - rect.top) / rect.height);
      stage.style.setProperty("--story-lift", `${(progress - 0.5) * -12}px`);
    }
  }

  function tick(time) {
    frame = 0;
    const delta = lastTime ? Math.min(80, time - lastTime) : 0;
    lastTime = time;
    let running = false;
    if (dirty) {
      dirty = false;
      updateStory();
      const travel = document.documentElement.scrollHeight - innerHeight;
      root.style.setProperty(
        "--page-progress",
        travel > 0 ? clamp(scrollY / travel).toFixed(5) : "0",
      );
    }
    if (canMove()) {
      for (const scene of visible) enter(scene);
      if (visible.has(hero) && heroElapsed < 6800) {
        heroElapsed = Math.min(6800, heroElapsed + delta);
        setHeroPose();
        running = heroElapsed < 6800;
      }
      for (const [name, actor] of rigs) {
        if (
          name === "hero" ||
          !actor.started ||
          actor.elapsed >= 2400 ||
          !visible.has(actor.scene)
        )
          continue;
        actor.elapsed = Math.min(2400, actor.elapsed + delta);
        const t = actor.elapsed / 2400;
        const gesture = smooth(t / 0.25) * (1 - smooth((t - 0.68) / 0.32));
        actor.rig.set(
          name === "ending"
            ? { wave: 0.8 * gesture, wavePhase: t * 12, lean: -1.5 * gesture }
            : {
                present: 0.75 * gesture,
                gazeX: 0.6,
                gazeY: -0.3,
                lean: 2 * gesture,
              },
        );
        running ||= actor.elapsed < 2400;
      }
    }
    if (running) requestFrame();
    else lastTime = 0;
  }

  replayButton?.addEventListener("click", () => {
    if (!canMove()) return;
    heroElapsed = 0;
    setHeroPose();
    requestFrame();
  });
  preference.addEventListener("change", (event) => {
    reduced = event.matches;
    if (reduced) {
      heroElapsed = 6800;
      for (const animation of animations) animation.cancel();
      animations.clear();
      for (const [name, actor] of rigs) {
        if (name === "hero") continue;
        actor.elapsed = 2400;
        actor.rig.reset();
      }
      for (const scene of visible) played.add(scene);
      setHeroPose();
    }
    syncMotion();
  });
  document.addEventListener("visibilitychange", syncMotion);
  for (const event of ["scroll", "resize", "pageshow"])
    addEventListener(
      event,
      () => {
        dirty = true;
        if (event === "resize") syncRibbon(true);
        requestFrame();
      },
      { passive: true },
    );

  if ("IntersectionObserver" in window) {
    const focalScenes = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const scene = focalScenes.get(entry.target);
          if (entry.isIntersecting) {
            visible.add(scene);
            if (reduced) played.add(scene);
          } else visible.delete(scene);
        }
        for (const animation of animations) {
          const scene = animation.effect.target.closest("[data-motion-scene]");
          if (canMove() && visible.has(scene)) animation.play();
          else animation.pause();
        }
        syncRibbon();
        requestFrame();
      },
      { threshold: 0.12 },
    );
    scenes.forEach((scene) => {
      const focal =
        scene.querySelector(
          ".product-shot, .plugin-stage, .model-stage, .free-art, .open-art, .ending-art",
        ) || scene;
      focalScenes.set(focal, scene);
      observer.observe(focal);
    });
  } else {
    heroElapsed = 6800;
    setHeroPose();
  }

  const tablist = document.querySelector(".screen-tabs");
  if (tablist) {
    const tabs = [...tablist.querySelectorAll("[data-tab]")];
    const panels = [...document.querySelectorAll("[data-panel]")];
    function selectTab(tab, focus = false) {
      for (const candidate of tabs) {
        const selected = candidate === tab;
        candidate.setAttribute("aria-selected", String(selected));
        candidate.tabIndex = selected ? 0 : -1;
      }
      for (const panel of panels) {
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", `tab-${panel.dataset.panel}`);
        panel.tabIndex = 0;
      }
      if (focus) tab.focus();
      dirty = true;
      requestFrame();
    }
    tablist.hidden = false;
    selectTab(tabs[0]);
    tablist.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-tab]");
      if (tab) selectTab(tab);
    });
    tablist.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(document.activeElement);
      if (index === -1) return;
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft")
        next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next], true);
    });
  }

  const viewer = document.querySelector(".screen-viewer");
  const canvas = viewer.querySelector(".viewer-canvas");
  const viewerImage = canvas.querySelector("img");
  const zoom = viewer.querySelector(".viewer-zoom");
  const close = viewer.querySelector(".viewer-close");
  let opener;
  let previousOverflow;
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-viewer]");
    if (
      !link ||
      !viewer.showModal ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    opener = link;
    const source =
      link.querySelector("img") ||
      document.querySelector(`img[src="${link.getAttribute("href")}"]`);
    viewerImage.src = source?.currentSrc || link.href;
    viewerImage.alt = source?.alt || link.dataset.title;
    viewer.querySelector("h2").textContent = link.dataset.title;
    canvas.classList.remove("is-zoomed");
    const imageWidth = viewerImage.src.endsWith("/mobile.webp") ? 390 : 1440;
    canvas.style.setProperty("--image-width", `${imageWidth}px`);
    canvas.scrollTo(0, 0);
    zoom.textContent = zoom.dataset.zoom;
    zoom.setAttribute("aria-pressed", "false");
    previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    viewerOpen = true;
    syncMotion();
    viewer.showModal();
    close.focus();
  });
  close.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (event) => {
    if (event.target !== viewer) return;
    const rect = viewer.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      viewer.close();
  });
  viewer.addEventListener("close", () => {
    root.style.overflow = previousOverflow || "";
    viewerOpen = false;
    opener?.focus({ preventScroll: true });
    syncMotion();
  });
  zoom.addEventListener("click", () => {
    const enlarged = canvas.classList.toggle("is-zoomed");
    zoom.textContent = enlarged ? zoom.dataset.fit : zoom.dataset.zoom;
    zoom.setAttribute("aria-pressed", String(enlarged));
    canvas.scrollTo(0, 0);
  });

  setHeroPose();
  syncMotion();
  if (ribbonGroup && "ResizeObserver" in window)
    new ResizeObserver(() => syncRibbon(true)).observe(ribbonGroup);
  document.fonts.ready.then(() => syncRibbon(true));
})();
