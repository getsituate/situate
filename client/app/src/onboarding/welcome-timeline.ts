import type { BendPose } from "./bend-performance";

export const durationMs = 10_600;
export const holdStartsMs = 9_000;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const progress = (t: number, start: number, end: number) =>
  clamp((t - start) / (end - start));
const smooth = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);
const ease = (t: number, start: number, end: number) =>
  smooth(progress(t, start, end));
const windowed = (
  t: number,
  start: number,
  inEnd: number,
  out: number,
  end: number,
) => ease(t, start, inEnd) * (1 - ease(t, out, end));

/** All channels are absolute; the held ending has no residual periodic motion. */
export function frameAt(timeMs: number) {
  const t = Number.isNaN(timeMs)
    ? 0
    : Math.max(0, Math.min(durationMs, timeMs));
  const open = ease(t, 150, 2100);
  const resolve = ease(t, 7400, holdStartsMs);
  const greet = windowed(t, 1000, 1750, 2900, 3550);
  const present = windowed(t, 3700, 4700, 7500, 8800);
  const blink = windowed(t, 5750, 5830, 5890, 6010);
  const actor: BendPose = {
    wave: greet,
    wavePhase: Math.sin(progress(t, 1500, 3100) * Math.PI * 3) * 1.4,
    present: present * 0.72,
    lean: -2.2 * windowed(t, 400, 1100, 1900, 3000),
    bob: -1.5 * greet,
    gazeX:
      windowed(t, 3300, 3850, 4350, 4900) * -0.8 +
      windowed(t, 4600, 5200, 5500, 6100) * 0.8,
    gazeY: 0,
    mouth: 0.24 * windowed(t, 1550, 1750, 2100, 2400),
    blink,
    wink: windowed(t, 7900, 8030, 8130, 8300) * 0.8,
  };
  return {
    time: t,
    open,
    resolve,
    camera: 1.26 - 0.26 * ease(t, 900, 3700),
    wingTravel: 430 * open + 800 * resolve,
    wingRotate: 12 * open + 18 * resolve,
    ribbon: ease(t, 2350, 5200),
    ribbonExit: ease(t, 7550, 8950),
    book: ease(t, 2750, 3900),
    bookOpen: ease(t, 3300, 4450),
    card: ease(t, 3900, 4900),
    document: ease(t, 4750, 5750),
    leaf: ease(t, 5450, 6350),
    foreground: windowed(t, 5350, 6650, 7450, 8900),
    title: ease(t, 1450, 2200) * (1 - ease(t, 6800, 7350)),
    titleY: 24 * (1 - ease(t, 1450, 2200)) - 20 * ease(t, 6800, 7350),
    finalTitle: ease(t, 7900, 8650),
    logo: ease(t, 7400, 8650),
    collectionY: 28 * resolve,
    actor,
  };
}
export type WelcomeFrame = ReturnType<typeof frameAt>;
