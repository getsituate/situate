(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SituateHelloTimeline = api;
})(typeof window === "undefined" ? null : window, function () {
  "use strict";
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const progress = (time, start, end) => clamp((time - start) / (end - start));
  const smooth = (value) => value * value * (3 - 2 * value);
  const ease = (time, start, end) => smooth(progress(time, start, end));
  const envelope = (time, start, up, down, end) =>
    ease(time, start, up) * (1 - ease(time, down, end));
  const pulse = (time, center, radius) => {
    const p = Math.abs(time - center) / radius;
    return p >= 1 ? 0 : (1 + Math.cos(p * Math.PI)) / 2;
  };
  function rocking(p) {
    const lean =
      4.6 *
      Math.sin(p * Math.PI * 3) *
      envelope(p, 0, 0.16, 0.62, 1) *
      (1 - 0.3 * p);
    return { lean, bob: -0.95 * (Math.sqrt(lean * lean + 0.16) - 0.4) };
  }
  const mouth = (time) =>
    0.8 * pulse(time, 2.16, 0.15) +
    0.6 * pulse(time, 2.49, 0.18) +
    0.9 * pulse(time, 2.89, 0.17);
  function sample(milliseconds) {
    if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds))
      throw new TypeError("Time must be a finite number of milliseconds.");
    const t = Math.max(0, Math.min(10, milliseconds / 1000));
    const arrival = rocking(progress(t, 0.08, 1.9));
    const wave = envelope(t, 1.76, 2.12, 3.24, 3.88);
    const present = ease(t, 4.03, 4.85) * (1 - 0.48 * ease(t, 6.1, 7.25));
    const reveal = ease(t, 3.82, 4.6);
    return {
      time: t * 1000,
      beat:
        t < 1.9
          ? "Arrival"
          : t < 3.85
            ? "Hello"
            : t < 6.7
              ? "Together"
              : "Welcome to Situate",
      actor: {
        stride: 0,
        phase: 0,
        wave,
        wavePhase: (Math.min(t, 3.88) - 2.1) * Math.PI * 3.7,
        present,
        mouth: mouth(t),
        blink: Math.max(
          pulse(t, 1.27, 0.105),
          pulse(t, 4.02, 0.105),
          pulse(t, 8.18, 0.12),
        ),
        wink: pulse(t, 3.42, 0.23),
        gazeX: 0.8 * envelope(t, 3.72, 4.17, 5.25, 6.05),
        gazeY: -0.7 * envelope(t, 3.72, 4.17, 5.25, 6.05),
        lean:
          arrival.lean - 2.2 * pulse(t, 1.9, 0.35) - 2 * wave + 1.4 * present,
        bob: arrival.bob - 2.5 * pulse(t, 3.42, 0.3),
      },
      travel: -(1 - ease(t, 0.08, 1.9)),
      closeup: 1 - ease(t, 3.78, 5.65),
      actorOpacity: ease(t, 0.02, 0.28),
      hello: envelope(t, 0.12, 0.48, 3.55, 3.83),
      together: envelope(t, 4.58, 4.95, 6.48, 6.8),
      ending: ease(t, 6.85, 7.35),
      world: reveal,
      ribbons: ease(t, 4.2, 5.72),
      objects: [ease(t, 4.5, 5.3), ease(t, 4.84, 5.64), ease(t, 5.18, 5.98)],
      shadow: 1,
    };
  }
  const durations = Object.freeze({
    hello: 2500,
    wink: 1400,
    talk: 2400,
    walk: 2600,
    present: 2200,
  });
  function gesture(name, milliseconds) {
    if (!Object.hasOwn(durations, name))
      throw new RangeError("Unknown character gesture.");
    if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds))
      throw new TypeError("Time must be finite.");
    const p = clamp(milliseconds / durations[name]);
    const weight = envelope(p, 0.02, 0.2, 0.78, 1);
    if (name === "hello")
      return {
        wave: weight,
        wavePhase: p * Math.PI * 7,
        lean: -2 * weight,
        mouth: 0.7 * pulse(p, 0.37, 0.07) + 0.55 * pulse(p, 0.53, 0.07),
        blink: pulse(p, 0.66, 0.045),
      };
    if (name === "wink")
      return {
        wink: pulse(p, 0.5, 0.22),
        lean: -2.2 * pulse(p, 0.49, 0.3),
        mouth: 0.2 * pulse(p, 0.45, 0.25),
      };
    if (name === "talk")
      return {
        mouth:
          0.85 * pulse(p, 0.24, 0.08) +
          0.55 * pulse(p, 0.43, 0.1) +
          0.9 * pulse(p, 0.64, 0.1),
        blink: pulse(p, 0.8, 0.045),
        gazeX: 0.4 * weight,
        lean: -0.8 * weight,
      };
    if (name === "walk") return rocking(p);
    return {
      present: weight,
      gazeX: 0.75 * weight,
      gazeY: -0.55 * weight,
      lean: 1.5 * weight,
      blink: pulse(p, 0.62, 0.04),
    };
  }
  return Object.freeze({ sample, gesture, durations, duration: 10000 });
});
