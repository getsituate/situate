(() => {
  "use strict";
  const albums = {
    window: {
      title: "Windows after rain",
      artist: "The Paper Hours",
      A: ["An open window", "The room between", "Rain on the sill"],
      B: ["Small hours", "A chair in the sun", "Leave the light on"],
    },
    tide: {
      title: "The slower tide",
      artist: "Low Lantern",
      A: ["Shoreline pencil", "The slower tide", "Salt on the keys"],
      B: ["A boat made of paper", "Low water", "The long way home"],
    },
    orchard: {
      title: "Orchard at midnight",
      artist: "Violet Assembly",
      A: ["Under the branches", "Night fruit", "The second guitar"],
      B: ["Brass in the leaves", "Orchard at midnight", "Daybreak quietly"],
    },
  };
  const query = (selector) => document.querySelector(selector);
  const notes = new Map([
    [
      "window:A:1",
      "The drums fall away just before the last chorus. The room seems to get wider.",
    ],
  ]);
  let album = "window";
  let side = "A";
  let track = 1;
  const key = () => `${album}:${side}:${track}`;
  const text = query("#note-text");
  const status = query("#note-status");
  const error = query("#note-error");
  const trackSelect = query("#track");

  function clearError() {
    error.hidden = true;
    text.removeAttribute("aria-invalid");
    text.setAttribute("aria-describedby", "note-help");
  }
  function showNote() {
    const kept = notes.get(key()) || "";
    query(".kept-note").hidden = !kept;
    query("#empty-note").hidden = Boolean(kept);
    query("#kept-text").textContent = kept;
    query("#kept-track").textContent = albums[album][side][track];
    query("#note-position").textContent =
      `Side ${side} · ${String(track + 1).padStart(2, "0")}`;
    query("#restore-note").textContent = kept
      ? "Restore kept note"
      : "Clear draft";
  }
  function loadNote() {
    text.value = notes.get(key()) || "";
    clearError();
    showNote();
  }
  function loadTracks() {
    trackSelect.replaceChildren(
      ...albums[album][side].map((title, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `${String(index + 1).padStart(2, "0")} · ${title}`;
        return option;
      }),
    );
    trackSelect.value = String(track);
    loadNote();
  }
  function announceSelection() {
    status.textContent = `${albums[album].title}, side ${side}, ${albums[album][side][track]}. ${notes.has(key()) ? "Kept note shown." : "No note yet."}`;
  }
  document.querySelectorAll(".album").forEach((button) => {
    button.disabled = false;
    button.addEventListener("click", () => {
      if (album === button.dataset.album) return;
      album = button.dataset.album;
      side = "A";
      track = 0;
      document.querySelectorAll(".album").forEach((item) => {
        const selected = item === button;
        item.setAttribute("aria-pressed", String(selected));
        item.querySelector(".selection").hidden = !selected;
      });
      query("#note-album").textContent = albums[album].title;
      query("#note-artist").textContent = albums[album].artist;
      query('input[name="side"][value="A"]').checked = true;
      loadTracks();
      announceSelection();
    });
  });
  query(".side-selector").disabled = false;
  document.querySelectorAll('input[name="side"]').forEach((input) =>
    input.addEventListener("change", () => {
      side = input.value;
      track = 0;
      loadTracks();
      announceSelection();
    }),
  );
  trackSelect.disabled = false;
  trackSelect.addEventListener("change", () => {
    track = Number(trackSelect.value);
    loadNote();
    announceSelection();
  });
  text.disabled = false;
  text.addEventListener("input", () => {
    clearError();
    status.textContent = "";
  });
  query("#keep-note").disabled = false;
  query("#restore-note").disabled = false;
  query("#note-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = text.value.trim();
    if (!value) {
      error.hidden = false;
      text.setAttribute("aria-invalid", "true");
      text.setAttribute("aria-describedby", "note-help note-error");
      status.textContent = "Note not kept. Write a detail and try again.";
      text.focus();
      return;
    }
    notes.set(key(), value);
    text.value = value;
    clearError();
    showNote();
    status.textContent = `Note kept for ${albums[album][side][track]}.`;
  });
  query("#restore-note").addEventListener("click", () => {
    loadNote();
    status.textContent = notes.has(key())
      ? "Kept note restored in the field."
      : "Draft cleared. Write a detail to start again.";
    text.focus();
  });
  query("#task").disabled = false;
  query("#task").addEventListener("change", (event) => {
    const done = event.target.checked;
    query("#task-count").textContent = done ? "0 open tasks" : "1 open task";
    query("#task-status").textContent = done
      ? "Listening task completed. Uncheck to reopen."
      : "Listening task reopened.";
  });

  if (!window.SituateBend || !window.SituateBendMotion) return;
  const host = query("#bend");
  host.innerHTML = window.SituateBend.render({
    idPrefix: "listening-bend",
    pose: "point",
    expression: "curious",
    decorative: true,
  });
  const svg = host.querySelector("svg");
  let motion = window.SituateBendMotion.create(svg);
  let paused = false;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const gesture = query("#gesture");
  const toggle = query("#motion");
  const help = query("#motion-help");
  const supported = typeof svg.animate === "function";
  function syncControls() {
    gesture.disabled = preference.matches || !supported;
    help.hidden = !preference.matches && supported;
    help.textContent = supported
      ? "Motion is off in your system settings. The illustration stays still."
      : "This browser shows the still illustration. Motion is unavailable.";
    if (help.hidden) gesture.removeAttribute("aria-describedby");
    else gesture.setAttribute("aria-describedby", "motion-help");
    toggle.textContent = paused ? "Resume motion" : "Pause motion";
    toggle.setAttribute("aria-pressed", String(paused));
  }
  query("#scene-controls").hidden = false;
  syncControls();
  preference.addEventListener("change", syncControls);
  gesture.addEventListener("click", () => {
    motion.play("point");
  });
  toggle.addEventListener("click", () => {
    paused = !paused;
    if (paused) motion.pause();
    else motion.resume();
    syncControls();
  });
  query("#still").addEventListener("click", () => {
    motion.stop();
  });
  window.addEventListener("pagehide", () => {
    motion.destroy();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    motion = window.SituateBendMotion.create(svg);
    if (paused) motion.pause();
    syncControls();
  });
})();
