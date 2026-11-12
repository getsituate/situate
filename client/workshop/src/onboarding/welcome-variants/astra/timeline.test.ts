import { describe, expect, it } from "vitest";
import { durationMs, frameAt, holdStartsMs } from "./timeline";

const drawing = (time: number) => {
  const { time: _, ...frame } = frameAt(time);
  return frame;
};
describe("unfolding place score", () => {
  it("clamps seeks and supplies complete finite channels", () => {
    expect(frameAt(-1)).toEqual(frameAt(0));
    expect(frameAt(Number.NaN)).toEqual(frameAt(0));
    expect(frameAt(Infinity)).toEqual(frameAt(durationMs));
    expect(frameAt(-Infinity)).toEqual(frameAt(0));
    for (let t = 0; t <= durationMs; t += 16) {
      const frame = frameAt(t);
      const values = [
        ...Object.values(frame).filter((v) => typeof v === "number"),
        ...Object.values(frame.actor),
      ];
      expect(values.every(Number.isFinite)).toBe(true);
      expect(frame.actor.wave).toBeGreaterThanOrEqual(0);
      expect(frame.actor.wave).toBeLessThanOrEqual(1);
      expect(frame.camera).toBeGreaterThanOrEqual(1);
    }
  });
  it("opens, greets, connects, resolves and holds a complete ending", () => {
    expect(frameAt(0).open).toBe(0);
    expect(frameAt(0).title).toBe(0);
    expect(frameAt(2000).actor.wave).toBe(1);
    expect(frameAt(3700).open).toBe(1);
    expect(frameAt(4450).bookOpen).toBe(1);
    expect(frameAt(6350).document).toBe(1);
    expect(frameAt(6350).leaf).toBe(1);
    expect(frameAt(holdStartsMs).ribbonExit).toBe(1);
    expect(frameAt(holdStartsMs).finalTitle).toBe(1);
    expect(frameAt(holdStartsMs).actor.wave).toBe(0);
    expect(drawing(holdStartsMs)).toEqual(drawing(durationMs));
    expect(drawing(durationMs + 50_000)).toEqual(drawing(durationMs));
    expect(durationMs - holdStartsMs).toBeGreaterThanOrEqual(1500);
  });
  it("has continuous act boundaries and is independent of seek order", () => {
    for (const time of [
      0,
      150,
      1000,
      1450,
      1750,
      2100,
      2200,
      2750,
      3550,
      3900,
      4450,
      5200,
      5750,
      6350,
      6800,
      7350,
      7400,
      7900,
      8300,
      8650,
      9000,
      durationMs,
    ]) {
      const before = frameAt(time - 0.001);
      const after = frameAt(time + 0.001);
      for (const key of Object.keys(before) as (keyof typeof before)[]) {
        if (key === "actor") continue;
        expect(Math.abs(after[key] - before[key])).toBeLessThan(0.01);
      }
    }
    const first = frameAt(4500);
    frameAt(durationMs);
    frameAt(0);
    expect(frameAt(4500)).toEqual(first);
  });
});
