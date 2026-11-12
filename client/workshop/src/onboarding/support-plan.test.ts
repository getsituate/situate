import { describe, it, expect } from "vitest";
import { createOnboardingState, reduceOnboarding } from "./model";

describe("support analysis", () => {
  it("invalidates pending work when leaving the plan and refuses early confirmation", () => {
    let s = createOnboardingState("onboarding-plan-waiting");
    const attempt = s.support.attempt;
    s = reduceOnboarding(s, { type: "patch", patch: { step: "samples" } });
    expect(s.support.phase).toBe("error");
    expect(s.support.attempt).toBeGreaterThan(attempt);
    expect(reduceOnboarding(s, { type: "support-complete", attempt })).toEqual(
      s,
    );
    expect(reduceOnboarding(s, { type: "confirm" }).confirmed).toBe(false);
  });
  it("freezes the working method and imported destination paths per attempt", () => {
    let s = createOnboardingState("onboarding-plan-waiting");
    const inputs = structuredClone(s.support.inputs);
    s.methodDraft.limit = false;
    s.methodDraft.review = "none";
    s.organization = "Changed after request";
    s.imported = [];
    s = reduceOnboarding(s, {
      type: "support-complete",
      attempt: s.support.attempt,
    });
    expect(s.support.proposals).toHaveLength(3);
    expect(s.support.inputs).toEqual(inputs);
    s = reduceOnboarding(s, { type: "support-settings", outcome: "success" });
    s = reduceOnboarding(s, { type: "support-reload" });
    expect(s.support.proposals).toEqual([]);
    expect(s.support.inputs?.organization).toBe("Changed after request");
  });
  it.each([
    ["onboarding-plan", 3],
    ["onboarding-plan-fewer", 1],
    ["onboarding-plan-empty", 0],
  ] as const)("limits %s to relevant proposals", (scenario, count) => {
    const s = createOnboardingState(scenario);
    expect(s.support.phase).toBe("ready");
    expect(s.support.proposals).toHaveLength(count);
    expect(s.support.choices).toEqual({});
    expect(s.startedTools).toEqual([]);
    expect(reduceOnboarding(s, { type: "support-request" })).toEqual(s);
  });
  it("does not invent imported evidence for a clean workspace", () => {
    const s = createOnboardingState("onboarding-clean");
    expect(s.imported).toEqual([]);
    expect(s.support.proposals.map((p) => p.id)).not.toContain("documents");
  });
  it("retries explicitly and rejects stale completions and forged results", () => {
    let s = createOnboardingState("onboarding-plan-waiting");
    const attempt = s.support.attempt;
    s = reduceOnboarding(s, { type: "support-reload" });
    s = reduceOnboarding(s, { type: "support-request" });
    expect(reduceOnboarding(s, { type: "support-complete", attempt })).toEqual(
      s,
    );
    s = reduceOnboarding(s, {
      type: "support-complete",
      attempt: s.support.attempt,
    });
    expect(s.support.proposals).toHaveLength(3);
    expect(
      reduceOnboarding(s, {
        type: "patch",
        patch: { support: { ...s.support, choices: { board: "develop" } } },
      }).support.choices,
    ).toEqual({});
  });
  it("freezes a pending example until explicit reload and permits error retry", () => {
    let s = createOnboardingState("onboarding-plan-waiting");
    const attempt = s.support.attempt;
    s = reduceOnboarding(s, {
      type: "support-settings",
      outcome: "failure",
      example: "none",
    });
    expect(s.support.phase).toBe("working");
    expect(s.support.attempt).toBe(attempt);
    s = reduceOnboarding(s, { type: "support-complete", attempt });
    expect(s.support.proposals).toHaveLength(3);
    s = reduceOnboarding(s, { type: "support-reload" });
    expect(s.support.phase).toBe("error");
    s = reduceOnboarding(s, { type: "support-settings", outcome: "success" });
    s = reduceOnboarding(s, { type: "support-request" });
    expect(s.support.phase).toBe("ready");
    expect(s.support.proposals).toEqual([]);
  });
  it("replaces choices only for returned proposals and never starts on selection", () => {
    let s = createOnboardingState("onboarding-plan-fewer");
    s = reduceOnboarding(s, {
      type: "support-choice",
      id: "documents",
      choice: "develop",
    });
    expect(s.support.choices).toEqual({});
    s = reduceOnboarding(s, {
      type: "support-choice",
      id: "board",
      choice: "develop",
    });
    s = reduceOnboarding(s, {
      type: "support-choice",
      id: "board",
      choice: "save",
    });
    expect(s.support.choices).toEqual({ board: "save" });
    expect(s.startedTools).toEqual([]);
  });
  it.each([
    "onboarding-plan-waiting",
    "onboarding-plan-error",
    "onboarding-plan-empty",
  ])("finishes %s without waiting for analysis", (scenario) => {
    const start = createOnboardingState(scenario);
    let s = reduceOnboarding(start, { type: "confirm" });
    expect(s.confirmed).toBe(true);
    expect(s.startedTools).toEqual([]);
    expect(
      reduceOnboarding(s, {
        type: "support-complete",
        attempt: start.support.attempt,
      }),
    ).toEqual(s);
    s = reduceOnboarding(s, { type: "patch", patch: { step: "plan" } });
    expect(reduceOnboarding(s, { type: "support-request" })).toEqual(s);
  });
});
