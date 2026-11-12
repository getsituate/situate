import { journeyFrame, type JourneyFrame } from "./journey";

export const openingDuration = 1100;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const ramp = (time: number, from: number, to: number) => {
  const p = clamp((time - from) / (to - from));
  return p * p * (3 - 2 * p);
};
const pulse = (time: number, from: number, to: number) => {
  const p = clamp((time - from) / (to - from));
  return p === 0 || p === 1 ? 0 : Math.sin(Math.PI * p);
};

export function openingFrame(milliseconds: number) {
  const time = Number.isFinite(milliseconds)
    ? Math.max(0, Math.min(openingDuration, milliseconds))
    : openingDuration;
  const art: JourneyFrame = journeyFrame({
    step: 0,
    fromStep: 0,
    travel: 1,
    reaction: 0,
  });
  const reveal = ramp(time, 0, 460);
  const progressOpacity = ramp(time, 220, 550);
  if (time > 0 && time < openingDuration) {
    const prepare = pulse(time, 40, 210);
    const hop = pulse(time, 170, 570);
    const landing = pulse(time, 570, 750);
    const arms = ramp(time, 110, 290) * (1 - ramp(time, 580, 900));
    art.actor.y += 1.6 * prepare - 14 * hop + 1.2 * landing;
    art.actor.pose.lean = -2 * prepare + 1.4 * hop + 0.5 * landing;
    art.actor.pose.bob = -Math.abs(art.actor.pose.lean) * 1.15;
    art.actor.pose.wave = 0.66 + 0.32 * arms;
    art.actor.pose.wavePhase = pulse(time, 260, 650) * 0.8;
    art.actor.pose.present = 0.8 * arms;
    art.actor.pose.gazeY -= 0.65 * arms;
    art.actor.pose.mouth = 0.35 * pulse(time, 180, 620);
    art.actor.pose.blink = 0.8 * pulse(time, 610, 730);
    art.shadow.rx *= 1 - 0.14 * hop;
    art.shadow.ry *= 1 - 0.2 * hop;
    art.paperBits = Array.from({ length: 7 }, (_, i) => {
      const start = 250 + (i % 3) * 24;
      const flight = clamp((time - start) / 810);
      const right = i > 2;
      return {
        id: i,
        x:
          (right ? 277 : 85) +
          (right ? 1 : -1) * [42, 80, 58, 55, 105, 85, 130][i]! * flight,
        y:
          (right ? 219 : 248) -
          (66 + (i % 3) * 15) * 4 * flight * (1 - flight) +
          flight * 35,
        rotation: (i % 2 ? -1 : 1) * (18 + 135 * flight),
        opacity:
          ramp(time, start, start + 65) *
          (1 - ramp(time, start + 500, start + 780)),
        color: [
          "var(--situate-lemon)",
          "var(--situate-tangerine)",
          "var(--situate-sky)",
        ][i % 3],
      };
    }).filter((bit) => bit.opacity > 0);
  }
  return { time, reveal, progressOpacity, progressY: -8 * (1 - reveal), art };
}
export type OpeningFrame = ReturnType<typeof openingFrame>;
