(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const timeline = window.SituateHelloTimeline;
  let dispose = () => {};
  let saved = null;

  function clock(view, duration, render, update) {
    let time = 0,
      paused = true,
      frame = null,
      previous = null,
      destroyed = false,
      visible = true;
    const inView = () => {
      const box = view.getBoundingClientRect();
      return (
        view.isConnected &&
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.top < innerHeight
      );
    };
    const allowed = () =>
      !destroyed &&
      !paused &&
      !reduced.matches &&
      !document.hidden &&
      visible &&
      time < duration;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previous = null;
    };
    function tick(now) {
      frame = null;
      if (!allowed()) {
        previous = null;
        update();
        return;
      }
      if (previous !== null) time = Math.min(duration, time + now - previous);
      previous = now;
      render(time);
      if (allowed()) frame = requestAnimationFrame(tick);
      else {
        previous = null;
        update();
      }
    }
    function sync() {
      if (destroyed) return;
      visible = inView();
      if (!allowed()) cancel();
      else if (frame === null) {
        previous = null;
        frame = requestAnimationFrame(tick);
      }
      update();
    }
    const observer = window.IntersectionObserver
      ? new IntersectionObserver(sync)
      : null;
    observer?.observe(view);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return {
      get state() {
        return {
          time,
          paused,
          duration,
          running: frame !== null,
          visible,
          destroyed,
        };
      },
      play() {
        if (destroyed || reduced.matches) return;
        if (time >= duration) time = 0;
        paused = false;
        render(time);
        sync();
      },
      pause() {
        paused = true;
        sync();
      },
      restart() {
        if (destroyed || reduced.matches) return;
        time = 0;
        render(time);
        sync();
      },
      seek(value) {
        if (destroyed) return;
        time = Math.max(0, Math.min(duration, value));
        paused = true;
        render(time);
        sync();
      },
      finish() {
        if (destroyed) return;
        time = duration;
        render(time);
        sync();
      },
      start(total) {
        if (destroyed || reduced.matches) return;
        duration = total;
        time = 0;
        paused = false;
        render(time);
        sync();
      },
      restore(value, wasPaused) {
        time = Math.max(0, Math.min(duration, value));
        paused = wasPaused;
        render(time);
        sync();
      },
      sync,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancel();
        observer?.disconnect();
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("scroll", sync, true);
        window.removeEventListener("resize", sync);
      },
    };
  }

  function mount() {
    dispose();
    if (!window.SituateBend || !window.SituateBendPerformance || !timeline) {
      $("#playback-status").textContent =
        "Motion could not load. The still introduction and its text are available.";
      return;
    }
    const events = new AbortController();
    const on = (target, name, listener) =>
      target.addEventListener(name, listener, { signal: events.signal });
    const stage = $("#stage");
    const actor = $("#actor");
    const labActor = $("#lab-actor");
    actor.innerHTML = SituateBend.render({
      idPrefix: "first-hello-bend",
      pose: "rest",
      expression: "welcome",
      decorative: true,
    });
    labActor.innerHTML = SituateBend.render({
      idPrefix: "first-hello-lab",
      pose: "rest",
      expression: "welcome",
      decorative: true,
    });
    const rig = SituateBendPerformance.create(actor.querySelector("svg"));
    const labRig = SituateBendPerformance.create(labActor.querySelector("svg"));
    const titleHello = $("#title-hello"),
      titleTogether = $("#title-together"),
      titleEnd = $("#title-end");
    const world = $("#world"),
      ribbons = $("#ribbons"),
      position = $("#actor-position"),
      shadow = $("#actor-shadow");
    const objects = ["#object-task", "#object-note", "#object-document"].map($);
    const rotations = [-10, 11, -7];
    const toggle = $("#toggle"),
      restart = $("#restart"),
      finish = $("#finish"),
      range = $("#position"),
      status = $("#playback-status");
    let narrow = innerWidth <= 700;
    let stageHeight = stage.clientHeight;
    let gesture = saved?.gesture || "hello";
    const say = (element, message) => {
      if (element.textContent !== message) element.textContent = message;
    };
    const stamp = (ms) =>
      `0:${Math.floor(ms / 1000)
        .toString()
        .padStart(2, "0")}`;
    function draw(time) {
      const frame = timeline.sample(time);
      rig.set(frame.actor);
      stage.dataset.time = String(Math.round(time));
      titleHello.style.opacity = frame.hello;
      titleTogether.style.opacity = frame.together;
      titleEnd.style.opacity = frame.ending;
      titleHello.style.transform = `translateY(${(1 - frame.hello) * 12}px)`;
      titleTogether.style.transform = `translateY(${(1 - frame.together) * 12}px)`;
      titleEnd.style.transform = `translateY(${(1 - frame.ending) * 16}px)`;
      world.style.transform = `translateY(${(1 - frame.world) * 100}%)`;
      ribbons.style.opacity = frame.ribbons * 0.8;
      ribbons.style.transform = `translateY(${(1 - frame.ribbons) * 100}px) rotate(${(1 - frame.ribbons) * -7}deg)`;
      const scale =
        1 + frame.closeup * (narrow ? (innerWidth < 360 ? 0.2 : 0.29) : 0.43);
      const lift = narrow ? 40 + Math.max(0, stageHeight - 430) * 0.35 : 0;
      position.style.transform = `translate(${frame.travel * (narrow ? 32 : 60)}px, ${-lift * frame.closeup}px) scale(${scale})`;
      position.style.opacity = frame.actorOpacity;
      shadow.style.transform = `scaleX(${frame.shadow})`;
      objects.forEach((object, index) => {
        const entry = frame.objects[index];
        object.style.opacity = entry;
        object.style.transform = `translateY(${(1 - entry) * 74}px) rotate(${rotations[index] + (1 - entry) * (index === 1 ? 18 : -18)}deg) scale(${0.8 + 0.2 * entry})`;
      });
      range.value = String(time / 1000);
      range.setAttribute(
        "aria-valuetext",
        `${(time / 1000).toFixed(1)} seconds of 10`,
      );
      say($("#time"), `${stamp(time)} / 0:10`);
    }
    function controls() {
      const state = main.state;
      const ended = state.time >= timeline.duration;
      const suppressed = reduced.matches;
      toggle.disabled = restart.disabled = range.disabled = suppressed;
      finish.disabled = ended;
      toggle.textContent = suppressed
        ? "Motion off"
        : ended
          ? "Replay introduction"
          : state.paused
            ? "Resume"
            : "Pause";
      if (suppressed)
        toggle.setAttribute("aria-describedby", "playback-status");
      else toggle.removeAttribute("aria-describedby");
      toggle.removeAttribute("aria-pressed");
      say(
        status,
        suppressed
          ? "Motion is off in your device settings. The complete ending is shown."
          : ended
            ? "Introduction complete."
            : state.paused
              ? "Paused."
              : !state.visible || document.hidden
                ? "Playback waits while the scene is out of view."
                : "Playing.",
      );
    }
    function labControls() {
      document.querySelectorAll("[data-gesture]").forEach((button) => {
        button.disabled = reduced.matches;
      });
      $("#stop-gesture").disabled =
        reduced.matches || lab.state.time >= lab.state.duration;
      say(
        $("#gesture-status"),
        reduced.matches
          ? "Motion is off in your device settings."
          : lab.state.time >= lab.state.duration
            ? "Still character."
            : !lab.state.visible || document.hidden
              ? "Gesture waits while the character is out of view."
              : "Playing once.",
      );
    }
    const main = clock(stage, timeline.duration, draw, controls);
    const lab = clock(
      $("#acting-stage"),
      timeline.durations[gesture],
      (time) => {
        labRig.set(timeline.gesture(gesture, time));
        $("#acting-stage").dataset.time = String(Math.round(time));
      },
      labControls,
    );
    on(toggle, "click", () => {
      if (main.state.paused || main.state.time >= timeline.duration)
        main.play();
      else main.pause();
    });
    on(restart, "click", () => main.restart());
    on(finish, "click", () => main.finish());
    on(range, "input", () => {
      if (!reduced.matches) main.seek(Number(range.value) * 1000);
    });
    document.querySelectorAll("[data-gesture]").forEach((button) =>
      on(button, "click", () => {
        if (reduced.matches) return;
        main.pause();
        gesture = button.dataset.gesture;
        lab.start(timeline.durations[gesture]);
      }),
    );
    on($("#stop-gesture"), "click", () => lab.finish());
    on(window, "resize", () => {
      narrow = innerWidth <= 700;
      stageHeight = stage.clientHeight;
      draw(main.state.time);
    });
    on(reduced, "change", () => {
      if (reduced.matches) {
        main.pause();
        main.finish();
        lab.finish();
      }
      main.sync();
      lab.sync();
    });
    if (reduced.matches) {
      main.finish();
      lab.finish();
    } else if (saved) {
      main.restore(saved.main.time, saved.main.paused);
      lab.finish();
    } else {
      main.play();
      lab.finish();
    }
    dispose = () => {
      saved = { main: main.state, gesture };
      events.abort();
      main.destroy();
      lab.destroy();
      rig.destroy();
      labRig.destroy();
      dispose = () => {};
    };
    on(window, "pagehide", () => dispose());
  }
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) mount();
  });
  mount();
})();
