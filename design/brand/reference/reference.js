"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const tokens = getComputedStyle(document.documentElement);
  const token = (name) => tokens.getPropertyValue(`--situate-${name}`).trim();
  const announce = (message) => {
    $("#announcement").textContent = message;
  };
  const label = (value) =>
    value
      .replaceAll("-", " ")
      .replace(/^./, (character) => character.toUpperCase());
  const luminance = (hex) => {
    const rgb = hex
      .match(/[a-f0-9]{2}/gi)
      .map((value) => parseInt(value, 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a, b) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) /
    (Math.min(luminance(a), luminance(b)) + 0.05);

  [
    "paper",
    "surface",
    "ink",
    "muted",
    "violet",
    "violet-deep",
    "sky",
    "cobalt",
    "tangerine",
    "peach",
    "lemon",
    "line",
  ].forEach((name) => {
    const hex = token(name);
    const foreground =
      contrast(hex, token("ink")) >= 4.5 ? token("ink") : token("surface");
    const article = document.createElement("div");
    article.className = "swatch";
    article.innerHTML = `<div class="swatch-color" style="background:${hex};color:${foreground}" aria-hidden="true">Aa</div><div class="swatch-info"><strong>${label(name)}</strong><code>${hex}</code></div>`;
    $("#palette").append(article);
  });
  [
    ["ink", "paper"],
    ["muted", "surface"],
    ["violet-deep", "paper"],
    ["surface", "violet-deep"],
    ["ink", "sky"],
    ["ink", "tangerine"],
    ["ink", "lemon"],
    ["surface", "plum"],
  ].forEach(([foreground, background]) => {
    const ratio = contrast(token(foreground), token(background));
    const article = document.createElement("div");
    article.className = "contrast-sample";
    article.style.color = token(foreground);
    article.style.background = token(background);
    article.innerHTML = `<strong>A clear thought.</strong><span>${label(foreground)} / ${background}</span><small>${ratio.toFixed(2)}:1 · ${ratio >= 4.5 ? "Normal text" : "Large text only"}</small>`;
    $("#contrast-grid").append(article);
  });
  ["bend-front", "bend-depth", "bend-highlight", "bend-seam"].forEach(
    (name) => {
      const element = document.createElement("span");
      element.className = "material-chip";
      element.innerHTML = `<i style="background:${token(name)}" aria-hidden="true"></i>${label(name.replace("bend-", ""))}`;
      $("#material-swatches").append(element);
    },
  );
  [4, 8, 12, 16, 24, 32, 48, 64, 80, 100].forEach((value) => {
    const element = document.createElement("div");
    element.className = "space-sample";
    element.innerHTML = `<i style="height:${value}px" aria-hidden="true"></i><span>${value}</span>`;
    $("#spacing-ruler").append(element);
  });

  const expressionCopy = {
    welcome: "A first hello. No repeated wave.",
    curious: "A possibility worth a closer look.",
    thinking: "Considering, not claiming certainty.",
    pleased: "A useful result, quietly acknowledged.",
    unsure: "A choice that needs the person.",
  };
  Object.entries(expressionCopy).forEach(([expression, copy]) => {
    const article = document.createElement("article");
    article.className = "expression-card";
    article.innerHTML = `<div class="bend-slot" data-bend="rest" data-expression="${expression}" data-name="Bend, ${expression}"></div><h3>${label(expression)}</h3><p>${copy}</p>`;
    $("#expression-grid").append(article);
  });
  ["light", "plum"].forEach((surface) => {
    const stage = document.createElement("div");
    stage.className = `size-stage ${surface === "plum" ? "plum" : ""}`;
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-label", `Static Bend on ${surface}`);
    [32, 48, 64, 96].forEach((size) => {
      const figure = document.createElement("figure");
      figure.innerHTML = `<div class="bend-slot" style="width:${size}px;height:${size}px" data-bend="rest" data-expression="welcome" data-name="Bend at ${size} pixels on ${surface}"></div><figcaption>${size} px</figcaption>`;
      stage.append(figure);
    });
    $("#size-comparisons").append(stage);
  });

  const controllers = new Map();
  const accents = new Set();
  let id = 0;
  let paused = false;
  let ambientEnabled = false;
  let ambient = [];
  const scenes = $$(".scene");
  const visible = (scene) => {
    const bounds = scene.getBoundingClientRect();
    return (
      bounds.bottom > 0 &&
      bounds.top < innerHeight &&
      bounds.right > 0 &&
      bounds.left < innerWidth
    );
  };
  const blocked = (scene) =>
    paused ||
    reduced.matches ||
    document.hidden ||
    Boolean($("dialog[open]")) ||
    (scene && !visible(scene));
  const miniExample = window.SituateMiniExample?.create($("#mini-example"));
  const canRender = Boolean(window.SituateBend);
  const canAnimate =
    canRender &&
    Boolean(window.SituateBendMotion) &&
    typeof Element.prototype.animate === "function";

  function render(
    slot,
    pose = slot.dataset.bend,
    expression = slot.dataset.expression,
  ) {
    controllers.get(slot)?.destroy();
    controllers.delete(slot);
    if (!canRender) return;
    slot.innerHTML = window.SituateBend.render({
      idPrefix: `reference-bend-${++id}`,
      pose,
      expression,
      title: slot.dataset.name || "Bend",
      decorative: false,
    });
    slot.dataset.bend = pose;
    slot.dataset.expression = expression;
    if (canAnimate && slot.closest(".scene"))
      controllers.set(
        slot,
        window.SituateBendMotion.create(slot.querySelector("svg")),
      );
  }
  $$(".bend-slot").forEach((slot) => render(slot));
  if (!canRender || !canAnimate) {
    $("#dependency-status").hidden = false;
    $("#dependency-status").textContent = !canRender
      ? "The Bend artwork library is unavailable. Color, type, assets and interactive content remain available."
      : "Motion is unavailable in this browser. All examples remain usable without animation.";
    $$("[data-replay], #replay-pose, #ambient-toggle, #motion-toggle").forEach(
      (button) => {
        button.disabled = true;
      },
    );
  }

  function cancelAccents(scene) {
    for (const entry of [...accents]) {
      if (!scene || entry.scene === scene) {
        entry.animation.cancel();
        accents.delete(entry);
      }
    }
  }
  function sceneAccent(scene, name) {
    const image = scene.querySelector(".scene-background");
    if (
      !image ||
      blocked(scene) ||
      !canAnimate ||
      (scene.id === "welcome-scene" && ambientEnabled)
    )
      return;
    cancelAccents(scene);
    const frames = {
      hello: [
        "translateY(0) rotate(0)",
        "translateY(-5px) rotate(-.5deg)",
        "translateY(0) rotate(0)",
      ],
      consider: ["translateX(0)", "translateX(3px)", "translateX(0)"],
      gather: [
        "translateY(0) rotate(0)",
        "translateY(6px) rotate(-.7deg)",
        "translateY(0) rotate(0)",
      ],
      celebrate: ["scale(1)", "scale(1.025)", "scale(1)"],
      point: ["translateX(0)", "translateX(4px)", "translateX(0)"],
    };
    const animation = image.animate(
      frames[name].map((transform) => ({ transform })),
      {
        duration: name === "hello" ? 2200 : 1400,
        easing: token("ease-settle"),
        iterations: 1,
      },
    );
    const entry = { animation, scene };
    accents.add(entry);
    animation.finished.then(
      () => accents.delete(entry),
      () => accents.delete(entry),
    );
  }
  function playScene(scene, name) {
    if (!canAnimate || blocked(scene)) return;
    scene
      .querySelectorAll(".bend-slot")
      .forEach((slot) => controllers.get(slot)?.play(name));
    sceneAccent(scene, name);
  }
  function syncMotion() {
    miniExample?.setMotionPaused(
      paused || !canAnimate || Boolean($("dialog[open]")),
    );
    for (const [slot, controller] of controllers) {
      if (reduced.matches) controller.stop();
      else if (blocked(slot.closest(".scene"))) controller.pause();
      else controller.resume();
    }
    if (reduced.matches) cancelAccents();
    else
      accents.forEach(({ animation, scene }) => {
        if (blocked(scene)) animation.pause();
        else if (animation.playState === "paused") animation.play();
      });
    if (reduced.matches && ambient.length) {
      ambient.forEach((animation) => animation.cancel());
      ambient = [];
    }
    if (ambientEnabled && !reduced.matches && canAnimate && !ambient.length) {
      ambient = $$("#welcome-scene [data-ambient-layer]").map((layer, index) =>
        layer.animate(
          [
            { transform: "scale(1.025) translate(-3px, 0) rotate(-.3deg)" },
            { transform: "scale(1.025) translate(3px, -5px) rotate(.3deg)" },
            { transform: "scale(1.025) translate(-3px, 0) rotate(-.3deg)" },
          ],
          {
            duration: parseFloat(token("duration-ambient")) + index * 1000,
            delay: -index * 4000,
            iterations: Infinity,
            easing: "ease-in-out",
          },
        ),
      );
    }
    ambient.forEach((animation) => {
      if (blocked($("#welcome-art"))) animation.pause();
      else if (animation.playState === "paused") animation.play();
    });
    const toggle = $("#motion-toggle");
    toggle.disabled = reduced.matches || !canAnimate;
    toggle.setAttribute("aria-pressed", String(paused || reduced.matches));
    toggle.textContent = !canAnimate
      ? "Motion unavailable"
      : reduced.matches
        ? "Motion off · device setting"
        : paused
          ? "Resume motion"
          : "Pause motion";
    $$("[data-replay], #replay-pose").forEach((button) => {
      button.disabled = paused || reduced.matches || !canAnimate;
    });
    $("#ambient-toggle").disabled = reduced.matches || !canAnimate;
    $("#ambient-toggle").setAttribute("aria-pressed", String(ambientEnabled));
    $("#ambient-toggle").textContent = reduced.matches
      ? "Ambient drift off"
      : ambientEnabled
        ? "Ambient drift on"
        : "Ambient drift off";
  }
  $("#motion-toggle").addEventListener("click", () => {
    paused = !paused;
    syncMotion();
    announce(
      paused ? "Motion paused. All examples still work." : "Motion resumed.",
    );
  });
  $("#ambient-toggle").addEventListener("click", () => {
    ambientEnabled = !ambientEnabled;
    cancelAccents($("#welcome-scene"));
    if (!ambientEnabled && ambient.length) {
      ambient.forEach((animation) => animation.cancel());
      ambient = [];
    }
    syncMotion();
  });
  $$("[data-replay]").forEach((button) =>
    button.addEventListener("click", () =>
      playScene(
        document.getElementById(button.dataset.replay),
        button.dataset.gesture,
      ),
    ),
  );
  reduced.addEventListener("change", syncMotion);
  document.addEventListener("visibilitychange", syncMotion);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(syncMotion, {
      threshold: [0, 0.05],
    });
    scenes.forEach((scene) => observer.observe(scene));
  }
  window.addEventListener("scroll", syncMotion, { passive: true });
  window.addEventListener("resize", syncMotion, { passive: true });
  syncMotion();

  const poseGestures = {
    rest: "consider",
    wave: "hello",
    read: "consider",
    carry: "gather",
    celebrate: "celebrate",
    point: "point",
  };
  ["#pose-select", "#expression-select"].forEach((selector) =>
    $(selector).addEventListener("change", () => {
      render(
        $("#pose-bend"),
        $("#pose-select").value,
        $("#expression-select").value,
      );
      syncMotion();
    }),
  );
  $("#replay-pose").addEventListener("click", () =>
    playScene($("#pose-scene"), poseGestures[$("#pose-select").value]),
  );

  function updateCount() {
    const count = $$(".task input:not(:checked)").length;
    $("#task-count").textContent = `${count} open`;
    return count;
  }
  $$(".task input").forEach((input) =>
    input.addEventListener("change", () => {
      announce(
        `${input.nextElementSibling.textContent} ${input.checked ? "completed" : "reopened"}. ${updateCount()} tasks open.`,
      );
    }),
  );
  $$("[data-density]").forEach((button) =>
    button.addEventListener("click", () => {
      $(".workspace").classList.toggle(
        "compact",
        button.dataset.density === "compact",
      );
      $$("[data-density]").forEach((option) =>
        option.setAttribute("aria-pressed", String(option === button)),
      );
    }),
  );
  $("#reset-workspace").addEventListener("click", () => {
    $$(".task input").forEach((input) => {
      input.checked = false;
    });
    updateCount();
    $(".workspace").classList.remove("compact");
    $$("[data-density]").forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.density === "comfortable"),
      ),
    );
    announce("Reading circle reset. Two tasks open.");
  });

  $$("[data-dialog]").forEach((button) =>
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.dataset.dialog);
      dialog.showModal();
      syncMotion();
    }),
  );
  $$("[data-close]").forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
  $$("dialog").forEach((dialog) =>
    dialog.addEventListener("close", syncMotion),
  );

  $$("[data-state-demo]").forEach((button) =>
    button.addEventListener("click", () => {
      $("#component-status").textContent =
        `${button.dataset.stateDemo}. No note is changed.`;
    }),
  );
  $("#title-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#list-title");
    const value = input.value.trim();
    $("#title-error").hidden = Boolean(value);
    input.setAttribute("aria-invalid", String(!value));
    input.setAttribute(
      "aria-describedby",
      value ? "title-help" : "title-help title-error",
    );
    if (!value) {
      input.focus();
      return;
    }
    $("#field-result").textContent = `Current name: ${value}`;
  });
  $("#list-title").addEventListener("input", () => {
    if ($("#list-title").value.trim()) {
      $("#title-error").hidden = true;
      $("#list-title").removeAttribute("aria-invalid");
      $("#list-title").setAttribute("aria-describedby", "title-help");
    }
  });

  $("#make-list").addEventListener("click", () => {
    $("#made-list").hidden = false;
    $("#make-list").disabled = true;
    $("#make-list").textContent = "Reading list made";
    $("#tool-status").textContent =
      "Reading list is ready. Three books to consider. Undo creation below to start again.";
    render($("#tool-bend"), "celebrate", "pleased");
    syncMotion();
    playScene($("#tool-scene"), "celebrate");
    $("#undo-list").focus({ preventScroll: true });
  });
  $("#undo-list").addEventListener("click", () => {
    cancelAccents($("#tool-scene"));
    $("#made-list").hidden = true;
    $$("#made-list select").forEach((select) => {
      select.selectedIndex = 0;
    });
    $("#make-list").disabled = false;
    $("#make-list").textContent = "Make reading list";
    $("#tool-status").textContent = "Creation undone. Nothing made yet.";
    render($("#tool-bend"), "carry", "curious");
    syncMotion();
    $("#make-list").focus({ preventScroll: true });
  });
  $$("#made-list select").forEach((select) =>
    select.addEventListener("change", () =>
      announce(
        `${select.closest(".book-status-row").querySelector("span").textContent}: ${select.value}.`,
      ),
    ),
  );
  $$("[data-choice]").forEach((button) =>
    button.addEventListener("click", () => {
      $$("[data-choice]").forEach((option) =>
        option.setAttribute("aria-pressed", String(option === button)),
      );
      $("#choice-status").textContent =
        `${button.dataset.choice} is kept beside the shortlist in this example.`;
      $("#clear-choice").disabled = false;
    }),
  );
  $("#clear-choice").addEventListener("click", () => {
    $$("[data-choice]").forEach((button) =>
      button.setAttribute("aria-pressed", "false"),
    );
    $("#choice-status").textContent =
      "Two notes mention the next book. Choose one to keep beside the shortlist.";
    $("#clear-choice").disabled = true;
    $("[data-choice]").focus({ preventScroll: true });
  });
  $("#retry-preview").addEventListener("click", () => {
    $("#recovery-title").textContent = "The preview is ready.";
    $("#recovery-copy").textContent =
      "Bookshop shortlist: The Quiet Street, A Map of Small Things, Almost Sunday.";
    $("#retry-preview").disabled = true;
    $("#reset-recovery").hidden = false;
    $("#reset-recovery").focus({ preventScroll: true });
  });
  $("#reset-recovery").addEventListener("click", () => {
    $("#recovery-title").textContent = "The preview didn’t open.";
    $("#recovery-copy").textContent =
      "Try opening the example again, or read the text instead.";
    $("#retry-preview").disabled = false;
    $("#reset-recovery").hidden = true;
    $("#retry-preview").focus({ preventScroll: true });
  });
})();
