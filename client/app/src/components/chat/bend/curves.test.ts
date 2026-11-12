import { describe, expect, it } from "vitest";
import { bendAt, limbPath } from "./curves";

describe("continuous limb curvature", () => {
  it("keeps each root fixed and its first tangent vertical at every bend", () => {
    for (const root of [7, 25])
      for (const angle of [-125, -90, -20, 0, 20, 90, 125]) {
        expect(limbPath(root, angle).startsWith(`M${root} 15 C${root} `)).toBe(
          true,
        );
        expect(limbPath(root, angle)).not.toMatch(/NaN|Infinity/);
      }
  });
  it("returns the straight resting silhouette and symmetric curved endpoints", () => {
    expect(limbPath(7, 0)).toBe("M7 15 C7 18.333 7 21.667 7 25");
    const end = (angle: number) =>
      limbPath(7, angle).split(" ").slice(-2).map(Number);
    expect(end(90)[0] + end(-90)[0]).toBeCloseTo(14);
    expect(end(90)[1]).toBe(end(-90)[1]);
  });
  it("eases reversals without sudden angular velocity and clamps progress", () => {
    const frames = [
      { offset: 0, angle: 0 },
      { offset: 0.5, angle: 90 },
      { offset: 1, angle: 0 },
    ];
    expect(bendAt(frames, -0.1)).toBe(0);
    expect(bendAt(frames, 2)).toBe(0);
    expect(bendAt(frames, 0.5)).toBe(90);
    expect(90 - bendAt(frames, 0.499)).toBeLessThan(0.001);
    expect(bendAt(frames, 0.499)).toBeCloseTo(bendAt(frames, 0.501));
  });
});
