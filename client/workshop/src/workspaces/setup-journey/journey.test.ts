import { describe, expect, it } from "vitest";
import {
  journeyFrame,
  arrivalFrame,
  stage,
  stationSpacing,
  type JourneyInput,
} from "./journey";

const input = (
  fromStep: number,
  step: number,
  travel: number,
  reaction = 0,
): JourneyInput => ({ fromStep, step, travel, reaction });
const still = (step: number) => journeyFrame(input(step, step, 1));

describe("paper promenade score", () => {
  it("has exact source and destination stills for every pair of stations", () => {
    for (let from = 0; from < 5; from++)
      for (let to = 0; to < 5; to++) {
        expect(journeyFrame(input(from, to, 0))).toEqual(still(from));
        expect(journeyFrame(input(from, to, 1))).toEqual(still(to));
      }
  });

  it("joins consecutive segments without a placement or pose jump", () => {
    for (let step = 1; step < 4; step++) {
      expect(journeyFrame(input(step - 1, step, 1))).toEqual(
        journeyFrame(input(step, step + 1, 0)),
      );
    }
  });

  it("holds same-station geometry for every progress and reaction input", () => {
    for (let step = 0; step < 5; step++)
      for (const progress of [0, 0.2, 0.5, 0.9, 1]) {
        expect(journeyFrame(input(step, step, progress, 0.8))).toEqual(
          still(step),
        );
      }
  });

  it("is repeatable in either seeking order and returns independent data", () => {
    const samples = [0, 0.13, 0.27, 0.48, 0.79, 0.91, 1];
    for (let step = 1; step < 5; step++) {
      const forward = samples.map((p) =>
        journeyFrame(input(step - 1, step, p)),
      );
      expect(
        [...samples]
          .reverse()
          .map((p) => journeyFrame(input(step - 1, step, p)))
          .reverse(),
      ).toEqual(forward);
      const changed = journeyFrame(input(step - 1, step, 0.48));
      changed.actor.pose.lean = 100;
      changed.objects[0].x = 100;
      expect(journeyFrame(input(step - 1, step, 0.48))).toEqual(forward[3]);
    }
  });

  it("keeps the world still during the nod, and ignores reaction during travel", () => {
    const rest = journeyFrame(input(0, 1, 0));
    const nod = journeyFrame(input(0, 1, 0, 1));
    expect(nod.actor.pose.lean).toBeGreaterThan(rest.actor.pose.lean);
    expect(nod.actor.pose.bob).toBeLessThan(0);
    expect({ ...nod, actor: rest.actor }).toEqual(rest);
    expect(journeyFrame(input(0, 1, 0.5, 1))).toEqual(
      journeyFrame(input(0, 1, 0.5)),
    );
  });

  it("anticipates, rocks rigidly and settles without discontinuous travel", () => {
    expect(journeyFrame(input(0, 1, 0.07)).camera).toBe(0);
    expect(journeyFrame(input(0, 1, 0.07)).actor.pose.lean).toBeLessThan(0);
    for (let step = 1; step < 5; step++)
      for (let i = 0; i < 100; i++) {
        const a = journeyFrame(input(step - 1, step, i / 100));
        const b = journeyFrame(input(step - 1, step, (i + 1) / 100));
        expect(a.actor.pose.stride).toBe(0);
        expect(a.actor.pose.phase).toBe(0);
        expect(Math.abs(a.actor.pose.lean)).toBeLessThanOrEqual(6);
        expect(a.actor.pose.bob).toBeGreaterThanOrEqual(-8);
        expect(b.camera).toBeGreaterThanOrEqual(a.camera);
        expect(b.camera - a.camera).toBeLessThan(stationSpacing * 0.021);
        expect(Math.abs(b.actor.x - a.actor.x)).toBeLessThan(3.5);
      }
  });

  it("uses one shared landmark set and monotonic world displacement", () => {
    for (let step = 0; step < 5; step++) {
      expect(still(step).camera).toBe(step * stationSpacing);
      expect(still(step).objects.map((o) => o.id)).toEqual([
        "folder",
        "links",
        "map",
        "tray",
      ]);
    }
    const forward = journeyFrame(input(1, 2, 0.5));
    const reverse = journeyFrame(input(2, 1, 0.5));
    expect(forward.camera).toBeGreaterThan(still(1).camera);
    expect(reverse.camera).toBeLessThan(still(2).camera);
    expect(forward.rail).not.toBe(reverse.rail);
    expect(stationSpacing).toBe(340);
  });

  it("keeps the rigid actor within the stage and the passing page above its face", () => {
    for (let step = 1; step < 5; step++)
      for (let i = 0; i <= 100; i++) {
        const frame = journeyFrame(input(step - 1, step, i / 100));
        const faceY = frame.actor.y + 79 * stage.actorScale;
        const centerX = frame.actor.x + 160 * stage.actorScale;
        if (Math.abs(frame.leaf.x - centerX) < 70)
          expect(frame.leaf.y + 40).toBeLessThan(faceY);
        expect(frame.actor.scale).toBe(stage.actorScale);
        expect(frame.actor.x).toBeGreaterThan(0);
        expect(frame.actor.x + 320 * stage.actorScale).toBeLessThan(
          stage.width,
        );
      }
  });

  it("keeps resting feet clear of the garden plants", () => {
    for (let step = 0; step < 5; step++) {
      const frame = still(step);
      const center = frame.actor.x + 160 * stage.actorScale;
      for (const plant of frame.plants)
        expect(Math.abs(plant.x - center)).toBeGreaterThanOrEqual(100);
    }
  });

  it("has distinct held gestures and one finite distracted glance", () => {
    expect(
      new Set(
        Array.from({ length: 5 }, (_, step) =>
          JSON.stringify(still(step).actor.pose),
        ),
      ).size,
    ).toBe(5);
    expect(journeyFrame(input(1, 2, 0.54)).actor.pose.mouth).toBeGreaterThan(
      0.3,
    );
    expect(journeyFrame(input(1, 2, 0.54)).actor.pose.gazeX).toBeLessThan(-0.7);
    expect(still(2).actor.pose.mouth).toBe(0);
    expect(journeyFrame(input(0, 1, 0.54)).actor.pose.mouth).toBe(0);
  });

  it("reserves the actual arrival for an explicit separate progress input", () => {
    expect(arrivalFrame(0)).toEqual(still(4));
    const halfway = arrivalFrame(0.62);
    arrivalFrame(1);
    arrivalFrame(0.1);
    expect(arrivalFrame(0.62)).toEqual(halfway);
    const end = arrivalFrame(1);
    expect(end.desk.noteRotation).toBe(0);
    expect(end.leaf.y).toBeGreaterThan(still(4).leaf.y + 100);
    expect(end.actor.pose.gazeX).toBe(0);
    expect(end.actor.pose.blink).toBe(0);
    expect(end.actor.pose.wink).toBe(0);
    expect(arrivalFrame(2)).toEqual(end);
    expect(arrivalFrame(NaN)).toEqual(still(4));
    for (let i = 0; i <= 100; i++)
      expect(arrivalFrame(i / 100).actor.pose.stride).toBe(0);
  });

  it("clamps invalid inputs and suppresses a blocked journey", () => {
    expect(journeyFrame(input(-4, 7, 2))).toEqual(still(4));
    expect(journeyFrame(input(0, 1, Number.NaN))).toEqual(still(0));
    expect(journeyFrame({ ...input(2, 3, 0.5, 1), blocked: true })).toEqual(
      still(2),
    );
    expect(
      JSON.stringify(journeyFrame(input(Infinity, NaN, NaN, NaN))),
    ).not.toMatch(/NaN|Infinity/);
  });
});
