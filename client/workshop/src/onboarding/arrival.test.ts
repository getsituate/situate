import { describe, expect, it } from "vitest";
import { createOnboardingState, reduceOnboarding } from "./model";
import { finaleDuration } from "../workspaces/setup-journey/finale/score";

describe("confirmed setup arrival", () => {
  it("starts only on successful confirmation, once per setup", () => {
    const initial = createOnboardingState("onboarding-method");
    expect(reduceOnboarding(initial, { type: "confirm" })).toEqual(initial);
    expect(reduceOnboarding(initial, { type: "finale-replay" })).toEqual(
      initial,
    );
    expect(
      reduceOnboarding(initial, { type: "finale-time", timeMs: 1100 }),
    ).toEqual(initial);
    const plan = createOnboardingState("onboarding-plan");
    const confirmed = reduceOnboarding(plan, { type: "confirm" });
    expect(confirmed).toMatchObject({
      confirmed: true,
      step: "home",
      finale: { status: "playing", timeMs: null },
    });
    expect(reduceOnboarding(confirmed, { type: "confirm" })).toEqual(confirmed);
    const finished = reduceOnboarding(confirmed, { type: "finale-finish" });
    expect(reduceOnboarding(finished, { type: "confirm" })).toEqual(finished);
  });
  it("keeps import and development decisions unchanged during inspection and replay", () => {
    const confirmed = reduceOnboarding(
      {
        ...createOnboardingState("onboarding-arrival"),
        confirmed: false,
        step: "plan",
      },
      { type: "confirm" },
    );
    const inspected = reduceOnboarding(confirmed, {
      type: "finale-time",
      timeMs: 9999,
    });
    expect(inspected).toEqual({
      ...confirmed,
      finale: { ...confirmed.finale, timeMs: finaleDuration },
    });
    const replay = reduceOnboarding(inspected, { type: "finale-replay" });
    expect(replay).toEqual({
      ...confirmed,
      finale: { ...confirmed.finale, timeMs: null, run: 1 },
    });
    expect(
      reduceOnboarding(confirmed, { type: "finale-time", timeMs: NaN }),
    ).toEqual(confirmed);
    expect(
      reduceOnboarding(confirmed, {
        type: "patch",
        patch: { finale: { ...confirmed.finale, timeMs: 100 } },
      }),
    ).toEqual(confirmed);
  });
});
