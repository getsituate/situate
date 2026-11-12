import { describe, expect, it } from "vitest";
import { createCallbackState, reduceCallback } from "./model";
import { celebrationFrame, handoffDuration, handoffFrame } from "./score";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { scenarioForState } from "../workshop/scenario-catalog";
import { screenControls } from "../workshop/screen-controls";

describe("browser sign-in return", () => {
  it("groups both connection results in one scenario", () => {
    const accepted = scenarioForState("auth-callback-received");
    expect(scenarioForState("auth-callback-rejected")).toBe(accepted);
    expect(accepted.states.map((state) => state.id)).toEqual([
      "auth-callback-received",
      "auth-callback-rejected",
    ]);
    for (const id of [
      "auth-callback-received",
      "auth-callback-rejected",
    ] as const) {
      const state = createSimulation(id);
      expect(state.feature).toBe("auth-callback");
      expect(screenControls(state).controls).toEqual(["auth-callback"]);
    }
  });
  it("preserves the selected result through playback, help or replay", () => {
    const state = createCallbackState();
    reduceCallback(state, { type: "help", open: true });
    reduceCallback(state, { type: "seek", timeMs: handoffDuration });
    reduceCallback(state, { type: "replay" });
    expect(state.status).toBe("received");
    expect(state.helpOpen).toBe(true);
    expect(state.timeMs).toBeNull();
    reduceCallback(state, { type: "status", status: "rejected" });
    expect(state.status).toBe("rejected");
    expect(state.helpOpen).toBe(false);
  });
  it("resets interaction and playback without discarding environment settings", () => {
    let state = createSimulation("auth-callback-received", true);
    state = reduceSimulation(state, {
      type: "auth-callback",
      action: { type: "help", open: true },
    });
    state = reduceSimulation(state, {
      type: "auth-callback",
      action: { type: "seek", timeMs: 900 },
    });
    state = reduceSimulation(state, { type: "reset" });
    expect(state.callback).toEqual(createCallbackState());
    expect(state.snapshot.mobile).toBe(true);
    expect(state.epoch).toBe(1);
  });
  it("has a deterministic bounded score and a complete held ending", () => {
    expect(handoffFrame(-10)).toEqual(handoffFrame(0));
    expect(handoffFrame(NaN)).toEqual(handoffFrame(handoffDuration));
    expect(handoffFrame(Infinity)).toEqual(handoffFrame(handoffDuration));
    expect(handoffFrame(900).actor.wave).toBeGreaterThan(0);
    const ending = handoffFrame(handoffDuration);
    expect(ending.receipt).toEqual({ x: -0, y: -0, rotation: -8 });
    expect(ending.actor.wave).toBe(0);
    expect(ending.actor.present).toBe(0.28);
    expect(handoffFrame(9000)).toEqual(ending);
    expect(handoffFrame(880).actor.bob).toBe(-8);
    expect(handoffFrame(900).actor.present).toBeGreaterThan(0.8);
    for (const t of [0, 450, 900, 1500, 2200, 3200, handoffDuration]) {
      const expected = handoffFrame(t);
      handoffFrame(handoffDuration - t);
      expect(handoffFrame(t)).toEqual(expected);
    }
  });
  it("bounds the confetti and glints to one deterministic viewport-sized burst", () => {
    for (const t of [0, 300, handoffDuration, 9000, NaN, Infinity])
      expect(celebrationFrame(t, 1280, 800)).toEqual([]);
    for (const [w, h] of [
      [0, 800],
      [1280, -1],
      [NaN, 800],
    ])
      expect(celebrationFrame(1500, w!, h!)).toEqual([]);
    const peak = celebrationFrame(1500, 1280, 800);
    expect(peak.length).toBeGreaterThan(144);
    expect(peak.length).toBeLessThanOrEqual(156);
    expect(peak.some((piece) => piece.shape === "sparkle")).toBe(true);
    expect(new Set(peak.map((piece) => piece.id)).size).toBe(peak.length);
    expect(
      Math.max(...peak.map((piece) => piece.x)) -
        Math.min(...peak.map((piece) => piece.x)),
    ).toBeGreaterThan(1280 * 0.65);
    expect(
      peak.every((piece) =>
        Object.values(piece).every(
          (value) => typeof value !== "number" || Number.isFinite(value),
        ),
      ),
    ).toBe(true);
    expect(
      peak.every((piece) => piece.opacity >= 0 && piece.opacity <= 1),
    ).toBe(true);
    const narrow = celebrationFrame(1500, 390, 844);
    expect(narrow.length).toBeLessThanOrEqual(92);
    expect(narrow.length).toBeGreaterThan(80);
    celebrationFrame(3200, 1280, 800);
    expect(celebrationFrame(1500, 1280, 800)).toEqual(peak);
  });
});
