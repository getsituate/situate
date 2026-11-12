import { describe, expect, it } from "vitest";
import {
  transitionFrame,
  transitionDuration,
  panelHandoff,
} from "./setup-transition";
import { journeyFrame, arrivalFrame } from "./setup-journey/journey";

const artwork = (time: number, from: number, to: number) => {
  const frame = transitionFrame(time, from, to);
  return journeyFrame({
    fromStep: from,
    step: to,
    travel: frame.journeyProgress,
    reaction: frame.reaction,
  });
};
describe("setup transition score", () => {
  it("fades the form before drawing the check, traveling, and revealing the next task", () => {
    expect(transitionFrame(0, 0, 1)).toMatchObject({
      panelOpacity: 1,
      incoming: false,
      check: 0,
      activeStep: 0,
    });
    expect(transitionFrame(250, 0, 1)).toMatchObject({
      panelOpacity: 0,
      incoming: false,
      check: 0,
      sparkle: 0,
    });
    expect(transitionFrame(500, 0, 1)).toMatchObject({
      panelOpacity: 0,
      check: 0.5,
      sparkle: 0,
      journeyProgress: 0,
      activeStep: 0,
    });
    expect(transitionFrame(panelHandoff, 0, 1)).toMatchObject({
      panelOpacity: 0,
      incoming: true,
      activeStep: 1,
      journeyProgress: 1,
    });
    expect(transitionFrame(transitionDuration, 0, 1)).toMatchObject({
      panelOpacity: 1,
      panelY: 0,
      activation: 1,
      check: 1,
      journeyProgress: 1,
      sparkle: 0,
    });
  });
  it("holds still for the check, nods, and gives the journey its full travel interval", () => {
    for (const time of [0, 125, 250, 500, 750, 1150])
      expect(artwork(time, 0, 1)).toEqual(artwork(0, 0, 1));
    const held = transitionFrame(900, 0, 1);
    expect(held).toMatchObject({
      check: 1,
      journeyProgress: 0,
      panelOpacity: 0,
      activeStep: 0,
    });
    expect(held.sparkle).toBeGreaterThan(0);
    expect(held.reaction).toBeGreaterThan(0);
    for (const time of [1400, 1800, panelHandoff - 1]) {
      const frame = transitionFrame(time, 0, 1);
      expect(frame).toMatchObject({
        check: 1,
        sparkle: 0,
        panelOpacity: 0,
        activeStep: 0,
        incoming: false,
      });
      expect(frame.journeyProgress).toBeGreaterThan(0);
      expect(frame.journeyProgress).toBeLessThan(1);
    }
  });
  it("joins every station exactly and holds its destination during form entry", () => {
    for (let to = 1; to < 5; to++) {
      for (const time of [panelHandoff, 2500, transitionDuration])
        expect(artwork(time, to - 1, to)).toEqual(artwork(0, to, to));
      expect(artwork(transitionDuration, to - 1, to)).toEqual(
        artwork(0, to, Math.min(4, to + 1)),
      );
    }
    expect(artwork(transitionDuration, 3, 4)).toEqual(arrivalFrame(0));
  });
  it("produces identical frames in either seek order and clamps invalid time", () => {
    const frame = transitionFrame(1400, 0, 1);
    transitionFrame(transitionDuration, 0, 1);
    transitionFrame(20, 0, 1);
    expect(transitionFrame(1400, 0, 1)).toEqual(frame);
    expect(transitionFrame(-50, 0, 1)).toEqual(transitionFrame(0, 0, 1));
    expect(transitionFrame(NaN, 0, 1)).toEqual(
      transitionFrame(transitionDuration, 0, 1),
    );
  });
  it("does not paint completion or sparkles when going back", () => {
    for (const time of [0, 250, 500, 900, 1400, 1800, transitionDuration])
      expect(transitionFrame(time, 3, 2)).toMatchObject({
        check: 0,
        sparkle: 0,
      });
  });
});
