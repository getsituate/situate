import type { BendPose } from "../brand/bend/performance";

export const welcomeIntroDuration = 4200;
export const welcomeAmbientDuration = 14000;
export const welcomeStillTime = 5600;
const ease = (t: number, start: number, end: number) => {
  const p = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return p * p * (3 - 2 * p);
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
const fixed = (value: number) => Math.round(value * 10000) / 10000;

function plane(
  progress: number,
  depth: number,
  twist: number,
  x = 0,
  y = 0,
  rotation = 0,
) {
  return {
    transform: `translate(${fixed(300 + x)} ${fixed(250 + y + depth * 65 * (1 - progress))}) rotate(${fixed(twist * (1 - progress) + rotation)}) scale(${fixed(1 - depth * (1 - progress))}) translate(-300 -250)`,
    opacity: fixed(Math.min(1, progress * 3)),
  };
}

export function welcomeFrame(milliseconds: number) {
  const t = Math.max(0, milliseconds);
  const ambient = Math.max(0, t - welcomeIntroDuration);
  const phase =
    ((ambient % welcomeAmbientDuration) / welcomeAmbientDuration) * Math.PI * 2;
  const strength = ease(ambient, 0, 1400);
  const back = Math.sin(phase) * strength;
  const middle = Math.sin(phase + Math.PI * 0.65) * strength;
  const front = Math.sin(phase + Math.PI * 1.25) * strength;
  const wave = envelope(t, 1150, 1600, 2450, 3350);
  const present = 0.32 * ease(t, 3000, welcomeIntroDuration);
  const glance = envelope(t, 300, 750, 1100, 1550);
  const actor: BendPose = {
    wave,
    wavePhase: ((Math.min(t, 3350) - 1550) / 1000) * Math.PI * 3.3,
    present,
    gazeX: -0.8 * glance,
    gazeY: -0.4 * glance,
    blink: pulse(t, 730, 110),
    wink: pulse(t, 2790, 170),
    mouth: 0.28 * envelope(t, 1200, 1550, 2450, 3100),
    lean: -2 * pulse(t, 1000, 450) - 1.8 * wave + present,
    bob: -1.5 * pulse(t, 2790, 250),
  };
  return {
    actor,
    layers: {
      back: plane(ease(t, 0, 1300), 0.5, -12, back * 9, back * -5, back * 0.8),
      middle: plane(
        ease(t, 180, 1700),
        0.65,
        10,
        middle * -14,
        middle * 7,
        middle * -1.2,
      ),
      book: plane(ease(t, 450, 1550), 0.76, 12),
      page: plane(ease(t, 350, 1450), 0.78, -10),
      burst: plane(ease(t, 1000, 2200), 0.8, -30),
      bend: plane(ease(t, 100, 1550), 0.1, 0),
      front: plane(
        ease(t, 600, 2200),
        0.5,
        -9,
        front * 22,
        front * -12,
        front * 1.8,
      ),
      leaf: plane(ease(t, 900, 2200), 0.65, -15),
      card: plane(ease(t, 850, 1900), 0.6, 15),
    },
  };
}
export type WelcomeLayer = keyof ReturnType<typeof welcomeFrame>["layers"];
