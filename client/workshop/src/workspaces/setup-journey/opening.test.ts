import { describe, expect, it } from "vitest";
import { journeyFrame } from "./journey";
import { openingDuration, openingFrame } from "./opening";

const origin = journeyFrame({ step: 0, fromStep: 0, travel: 1, reaction: 0 });
describe("workspace opening", () => {
  it("keeps the same garden and actor at both boundaries", () => {
    expect(openingFrame(0).art).toEqual(origin);
    expect(openingFrame(openingDuration).art).toEqual(origin);
    expect(openingFrame(0).reveal).toBe(0);
    expect(openingFrame(openingDuration)).toMatchObject({
      reveal: 1,
      progressOpacity: 1,
      progressY: -0,
    });
    expect(openingFrame(-100)).toEqual(openingFrame(0));
    expect(openingFrame(Infinity)).toEqual(openingFrame(openingDuration));
    expect(openingFrame(NaN)).toEqual(openingFrame(openingDuration));
    expect(openingFrame(90000)).toEqual(openingFrame(openingDuration));
  });
  it("allocates progress space smoothly without moving the scenery locally", () => {
    let reveal = 0;
    for (let t = 0; t <= openingDuration; t += 10) {
      const frame = openingFrame(t);
      expect(frame.reveal).toBeGreaterThanOrEqual(reveal);
      expect(frame.reveal - reveal).toBeLessThan(0.034);
      reveal = frame.reveal;
      for (const key of [
        "rail",
        "road",
        "objects",
        "plants",
        "desk",
        "leaf",
        "camera",
      ] as const)
        expect(frame.art[key]).toEqual(origin[key]);
    }
    expect(openingFrame(100).reveal).toBeGreaterThan(0);
    expect(openingFrame(350).reveal).toBeLessThan(1);
    expect(openingFrame(460).reveal).toBe(1);
  });
  it("makes a small rigid hop with seven finite, upward-thrown paper pieces", () => {
    const apex = openingFrame(370).art;
    expect(origin.actor.y - apex.actor.y).toBeCloseTo(14, 1);
    expect(apex.paperBits).toHaveLength(7);
    expect(apex.shadow.rx).toBeLessThan(origin.shadow.rx);
    for (let t = 0; t <= openingDuration; t += 10) {
      const art = openingFrame(t).art;
      expect(art.actor.pose.stride).toBe(0);
      expect(art.actor.pose.phase).toBe(0);
      expect(art.actor.scale).toBe(origin.actor.scale);
      expect(art.paperBits.length).toBeLessThanOrEqual(7);
      for (const bit of art.paperBits) {
        expect(bit.x).toBeGreaterThan(0);
        expect(bit.x).toBeLessThan(500);
        expect(bit.y).toBeGreaterThan(0);
        expect(bit.y).toBeLessThan(470);
        expect(bit.opacity).toBeGreaterThan(0);
        expect(bit.opacity).toBeLessThanOrEqual(1);
      }
    }
    expect(openingFrame(450).art.paperBits[0].y).toBeLessThan(
      openingFrame(320).art.paperBits[0].y,
    );
    expect(openingFrame(1090).art.paperBits).toEqual([]);
  });
  it("seeks backwards exactly and settles without an endpoint jump", () => {
    const samples = [0, 80, 170, 350, 570, 650, 900, 1100].map(openingFrame);
    for (const frame of [...samples].reverse())
      expect(openingFrame(frame.time)).toEqual(frame);
    for (const time of [0.001, 1099.999]) {
      const { actor, shadow, paperBits } = openingFrame(time).art;
      expect(actor).toEqual(origin.actor);
      expect(shadow).toEqual(origin.shadow);
      expect(paperBits).toEqual([]);
    }
  });
});
