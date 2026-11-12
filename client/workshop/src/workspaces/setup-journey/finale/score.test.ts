import { describe, expect, it } from "vitest";
import { finaleDuration, finaleFrame, finaleTiming } from "./score";
import { journeyFrame } from "../journey";
import {
  createOnboardingState,
  reduceOnboarding,
} from "../../../onboarding/model";
import {
  createSimulation,
  reduceSimulation,
} from "../../../workshop/simulation";
import { screenControls } from "../../../workshop/screen-controls";

const size = { width: 1280, height: 900 };
const origin = { x: 51, y: 186, width: 473, height: 444.62 };
describe("workspace celebration score", () => {
  it("starts at the actual garden geometry and retains rigid anatomy", () => {
    const before = journeyFrame({
      step: 4,
      fromStep: 4,
      travel: 1,
      reaction: 0,
    });
    const start = finaleFrame(0, size, origin);
    expect(start.art.actor).toEqual(before.actor);
    expect(start.art.leaf).toEqual(before.leaf);
    expect(start.camera).toEqual({
      x: origin.x,
      y: origin.y,
      scale: origin.width / 500,
    });
    expect(start.clip).toEqual(origin);
    for (let time = 0; time <= finaleDuration; time += 50) {
      const { art } = finaleFrame(time, size, origin);
      expect(art.actor.pose.stride).toBe(0);
      expect(art.actor.pose.phase).toBe(0);
      expect(art.actor.scale).toBe(before.actor.scale);
      expect(Math.abs(art.actor.pose.lean)).toBeLessThan(6);
    }
    expect(before.actor.y - finaleFrame(1425, size).art.actor.y).toBeCloseTo(
      18,
    );
  });
  it.each([
    { width: 1440, height: 900 },
    size,
    { width: 850, height: 620 },
    { width: 390, height: 844 },
    { width: 320, height: 350 },
  ])(
    "covers the viewport with the paper before revealing the workspace at $width × $height",
    (viewport) => {
      const f = finaleFrame(4420, viewport);
      const points = f.paperCorners.map((p) => ({
        x:
          f.camera.x + (f.art.desk.x + f.art.desk.noteX + p.x) * f.camera.scale,
        y:
          f.camera.y + (f.art.desk.y + f.art.desk.noteY + p.y) * f.camera.scale,
      }));
      expect(Math.min(...points.map((p) => p.x))).toBeLessThan(0);
      expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(
        viewport.width,
      );
      expect(Math.min(...points.map((p) => p.y))).toBeLessThan(0);
      expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(
        viewport.height,
      );
      expect(f.art.desk.noteRotation).toBe(0);
      expect(f.sheet.paperMix).toBe(1);
      expect(f.sheet.linesOpacity).toBe(0);
    },
  );
  it("seeks exactly, keeps celebration finite and holds the handoff", () => {
    const times = [
      0, 380, 1000, 1400, 1750, 2200, 2650, 3350, 4000, 4420, 4800, 5650, 5800,
    ];
    const forward = times.map((t) => finaleFrame(t, size, origin));
    for (const frame of forward.reverse())
      expect(finaleFrame(frame.time, size, origin)).toEqual(frame);
    expect(finaleFrame(2200, size).confetti).toHaveLength(48);
    expect(finaleFrame(3350, size).confetti).toEqual([]);
    expect(finaleTiming(finaleDuration)).toMatchObject({
      overlayOpacity: 0,
      reveal: 1,
      workspaceScale: 1,
      titleOpacity: 0,
    });
    expect(finaleFrame(Infinity, size)).toEqual(
      finaleFrame(finaleDuration, size),
    );
    expect(finaleFrame(NaN, size)).toEqual(finaleFrame(finaleDuration, size));
    expect(finaleFrame(-1, size)).toEqual(finaleFrame(0, size));
    expect(finaleFrame(6000, size)).toEqual(finaleFrame(finaleDuration, size));
    expect(finaleFrame(5650, size).art).toEqual(
      finaleFrame(finaleDuration, size).art,
    );
  });
  it("keeps camera boundaries continuous and brings offscreen artwork in gently", () => {
    for (const t of [120, 1000, 2650, 3050, 3350, 4420]) {
      const a = finaleFrame(t - 0.001, size, origin),
        b = finaleFrame(t + 0.001, size, origin);
      expect(Math.abs(a.camera.x - b.camera.x)).toBeLessThan(0.1);
      expect(Math.abs(a.camera.y - b.camera.y)).toBeLessThan(0.1);
      expect(Math.abs(a.camera.scale - b.camera.scale)).toBeLessThan(0.001);
    }
    expect(finaleFrame(0, size, { ...origin, y: -1000 }).artOpacity).toBe(0);
    expect(finaleFrame(1000, size, { ...origin, y: -1000 }).artOpacity).toBe(1);
  });
});

describe("celebration state", () => {
  it("starts only after confirmed guided setup, without claiming pending work is complete", () => {
    const unfinished = createOnboardingState("onboarding-method");
    expect(
      reduceOnboarding(unfinished, { type: "confirm" }).finale.status,
    ).toBe("idle");
    const plan = createOnboardingState("onboarding-plan");
    plan.importState = "running";
    plan.startedTools = ["board"];
    plan.developmentLinks = { board: "example-development" };
    const completed = reduceOnboarding(plan, { type: "confirm" });
    expect(completed).toMatchObject({
      confirmed: true,
      step: "home",
      importState: "running",
      startedTools: ["board"],
      developmentLinks: plan.developmentLinks,
    });
    expect(completed.finale.status).toBe("playing");
    const done = reduceOnboarding(completed, { type: "finale-finish" });
    expect(done.finale.status).toBe("done");
    expect(reduceOnboarding(done, { type: "confirm" }).finale.status).toBe(
      "done",
    );
    expect(reduceOnboarding(done, { type: "finale-replay" })).toEqual(done);
    expect(reduceOnboarding(plan, { type: "manual" }).finale.status).toBe(
      "idle",
    );
    expect(
      reduceOnboarding({ ...plan, presentation: "plain" }, { type: "confirm" })
        .finale.status,
    ).toBe("idle");
  });
  it("keeps inspection and replay separate from confirmation, and scopes controls to the visible screen", () => {
    let s = createSimulation("setup-conversation-finale");
    expect(screenControls(s)).toMatchObject({
      controls: ["setup-conversation"],
      editing: true,
      canSetOutcome: false,
    });
    s = reduceSimulation(s, {
      type: "setup-conversation",
      action: { type: "finale-time", timeMs: 5800 },
    });
    expect(s.setupConversation.finale.status).toBe("playing");
    const original = structuredClone(s.setupConversation.imported);
    s = reduceSimulation(s, {
      type: "setup-conversation",
      action: { type: "finale-replay" },
    });
    expect(s.setupConversation.finale).toMatchObject({
      timeMs: null,
      run: 2,
      paused: false,
    });
    s = reduceSimulation(s, {
      type: "setup-conversation",
      action: { type: "finale-finish" },
    });
    expect(s.setupConversation.imported).toEqual(original);
    expect(screenControls(s).controls).not.toContain("setup-finale");
    expect(
      createSimulation("onboarding-arrival").onboarding.finale.status,
    ).toBe("idle");
  });
});
