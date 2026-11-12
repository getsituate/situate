"use strict";
(function () {
  const $ = (selector) => document.querySelector(selector);
  const bend = window.SituateBend;
  const motion = window.SituateBendMotion;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const notes = {
    welcome:
      "An open smile and relaxed brows. A greeting, not a request for attention.",
    curious:
      "One lifted brow and a small round mouth. An invitation to look closer.",
    thinking:
      "A sideways glance and a level mouth. Quiet consideration, not a progress meter.",
    pleased:
      "Soft crescent eyes and a broad smile. Acknowledgment without applause for every click.",
    unsure:
      "Uneven brows and a small wavy mouth. A question needs an answer; nobody is being scolded.",
  };
  const gestures = {
    rest: "consider",
    wave: "hello",
    read: "consider",
    carry: "gather",
    celebrate: "celebrate",
    point: "point",
  };
  let controller;
  let paused = false;
  let generation = 0;
  function status(message) {
    $("#motion-status").textContent = message;
  }
  function draw() {
    generation++;
    if (controller) controller.destroy();
    const pose = $("#pose").value;
    const expression = $("#expression").value;
    $("#preview").innerHTML = bend.render({
      idPrefix: "preview-bend",
      pose,
      expression,
      title: `Bend — ${pose}, ${expression}`,
    });
    controller = motion.create($("#preview svg"));
    if (paused) controller.pause();
    $("#expression-note").textContent = notes[expression];
    status(
      reduced.matches
        ? "Motion is off in your device settings."
        : paused
          ? "Motion paused."
          : "Still until you choose a gesture.",
    );
  }
  $("#pose").addEventListener("change", () => {
    $("#gesture").value = gestures[$("#pose").value];
    draw();
  });
  $("#expression").addEventListener("change", draw);
  $("#play").addEventListener("click", () => {
    const version = ++generation;
    status(
      reduced.matches
        ? "Motion is off in your device settings."
        : paused
          ? "Gesture ready. Resume motion to play."
          : "Playing once.",
    );
    controller.play($("#gesture").value).then((result) => {
      if (version !== generation) return;
      if (result.status === "finished") status("Gesture finished.");
      if (result.status === "reduced-motion")
        status("Motion is off in your device settings.");
      if (result.status === "unsupported")
        status(
          "Animation is unavailable in this browser. The illustration stays still.",
        );
    });
  });
  $("#pause").addEventListener("click", () => {
    paused = !paused;
    $("#pause").setAttribute("aria-pressed", String(paused));
    $("#pause").textContent = paused ? "Resume motion" : "Pause motion";
    if (paused) controller.pause();
    else controller.resume();
    status(
      reduced.matches
        ? "Motion is off in your device settings."
        : paused
          ? "Motion paused."
          : "Motion resumed.",
    );
  });
  $("#stop").addEventListener("click", () => {
    generation++;
    controller.stop();
    status("Motion stopped.");
  });
  $("#background").addEventListener("click", () => {
    const dark = $("#background").getAttribute("aria-pressed") !== "true";
    $("#background").setAttribute("aria-pressed", String(dark));
    $("#surface").dataset.dark = String(dark);
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches) status("Motion is off in your device settings.");
    else
      status(paused ? "Motion paused." : "Still until you choose a gesture.");
  });
  $("#gallery").innerHTML = bend.poseNames
    .map(
      (pose) =>
        `<h3 class="pose-title">${pose}</h3>` +
        bend.expressionNames
          .map(
            (expression) =>
              `<figure>${bend.render({ idPrefix: `gallery-${pose}-${expression}`, pose, expression, decorative: true })}<figcaption>${expression}</figcaption></figure>`,
          )
          .join(""),
    )
    .join("");
  $("#samples").innerHTML = [64, 96, 160]
    .map(
      (size) =>
        `<figure>${bend.render({ idPrefix: `size-${size}`, decorative: true }).replace('width="320" height="320"', `width="${size}" height="${size}"`)}<figcaption>${size} px</figcaption></figure>`,
    )
    .join("");
  draw();
  window.addEventListener("pagehide", () => controller.destroy());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) draw();
  });
})();
