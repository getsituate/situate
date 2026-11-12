import type { BendPose } from "../brand/bend/performance";

export const handoffDuration = 4400;
const ease = (t: number, start: number, end: number) => {
  const p = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return 1 - (1 - p) ** 3;
};
const envelope = (
  t: number,
  start: number,
  up: number,
  down: number,
  end: number,
) => ease(t, start, up) * (1 - ease(t, down, end));
const pulse = (t: number, center: number, radius: number) => {
  const p = Math.abs(t - center) / radius;
  return p >= 1 ? 0 : (1 + Math.cos(p * Math.PI)) / 2;
};
const time = (milliseconds: number) =>
  Number.isFinite(milliseconds)
    ? Math.max(0, Math.min(handoffDuration, milliseconds))
    : handoffDuration;

export function handoffFrame(milliseconds: number) {
  const t = time(milliseconds);
  const arrival = ease(t, 0, 550);
  const notice = envelope(t, 100, 300, 450, 700);
  const celebrate = envelope(t, 350, 750, 1400, 2450);
  const actor: BendPose = {
    gazeX: -0.85 * notice + 0.4 * celebrate,
    gazeY: 0.5 * notice - 0.35 * celebrate,
    lean: -2 * notice + 2 * celebrate,
    bob: 2 * pulse(t, 300, 180) - 8 * pulse(t, 880, 430),
    wave: 0.95 * celebrate,
    wavePhase: ((t - 700) / 1000) * Math.PI * 2.4,
    present: 0.9 * celebrate + 0.28 * ease(t, 2450, 3100),
    mouth: 0.3 * celebrate,
    blink: pulse(t, 310, 70),
    wink: pulse(t, 1590, 130),
  };
  return {
    time: t,
    actor,
    receipt: {
      x: -32 * (1 - arrival),
      y: -20 * (1 - arrival),
      rotation: -8 - 8 * (1 - arrival),
    },
  };
}

const colors = [
  "violet",
  "tangerine",
  "sky",
  "lemon",
  "cobalt",
  "peach",
] as const;
const seed = (index: number, channel: number) => {
  const value = Math.sin((index + 1) * 127.1 + channel * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
export interface CelebrationPiece {
  id: number;
  shape: "paper" | "ribbon" | "sparkle";
  color: (typeof colors)[number];
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  opacity: number;
}

export function celebrationFrame(
  milliseconds: number,
  width: number,
  height: number,
): CelebrationPiece[] {
  const t = time(milliseconds);
  if (
    t <= 300 ||
    t >= handoffDuration ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return [];
  const pieces: CelebrationPiece[] = [];
  const count = width < 600 ? 80 : 144;
  for (let i = 0; i < count; i++) {
    const right = i % 2 === 1;
    const birth = 300 + (right ? 150 : 0) + seed(i, 0) * 170;
    const age = (t - birth) / 1000;
    const life = 3.1 + seed(i, 1) * 0.65;
    if (age <= 0 || age >= life) continue;
    const launch = 1 - Math.exp(-1.3 * age);
    const direction = right ? -1 : 1;
    const ribbon = i % 5 === 0;
    pieces.push({
      id: i,
      shape: ribbon ? "ribbon" : "paper",
      color: colors[i % colors.length]!,
      x:
        width *
          ((right ? 0.97 : 0.03) +
            direction * (0.09 + seed(i, 2) * 0.85) * launch) +
        Math.sin(age * 3 + seed(i, 3) * Math.PI * 2) * 12 * Math.min(1, age),
      y:
        height *
        (0.8 -
          (0.72 + seed(i, 4) * 0.46) * age +
          (0.24 + seed(i, 5) * 0.08) * age * age),
      rotation: seed(i, 6) * 360 + direction * age * (170 + seed(i, 7) * 170),
      scaleX:
        0.22 +
        0.78 *
          Math.abs(Math.cos(age * (3 + seed(i, 8) * 3) + seed(i, 9) * Math.PI)),
      scaleY: 1,
      width: ribbon ? 4 : 6 + seed(i, 10) * 4,
      height: ribbon ? 19 + seed(i, 11) * 8 : 8 + seed(i, 12) * 6,
      opacity: 0.95 * ease(age, 0, 0.12) * (1 - ease(age, life - 0.55, life)),
    });
  }
  for (let i = 0; i < 12; i++) {
    const birth = 650 + seed(i, 13) * 1700;
    const progress = (t - birth) / 850;
    if (progress <= 0 || progress >= 1) continue;
    const swell = Math.sin(progress * Math.PI);
    pieces.push({
      id: 200 + i,
      shape: "sparkle",
      color: colors[(i * 2) % colors.length]!,
      x: width * (0.05 + seed(i, 14) * 0.9),
      y: height * (0.06 + seed(i, 15) * 0.86),
      rotation: -12 + progress * 24,
      scaleX: swell,
      scaleY: swell,
      width: 16 + seed(i, 16) * 10,
      height: 16 + seed(i, 16) * 10,
      opacity: 0.85 * swell,
    });
  }
  return pieces;
}
