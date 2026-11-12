import { describe, expect, it } from "vitest";
import {
  createOnboardingState,
  reduceOnboarding,
  methodLines,
  methodCombinationNotes,
} from "./model";
import copy from "../localization/en.working-method.json";

describe("working method description and review", () => {
  it.each(copy.methods)(
    "explains $name without changing choices or authorizing work",
    ({ id }) => {
      const initial = createOnboardingState("onboarding-method");
      const opened = reduceOnboarding(initial, { type: "method-info", id });
      expect(opened).toEqual({ ...initial, methodInfo: id });
      expect(
        reduceOnboarding(opened, { type: "method-info", id: null }),
      ).toEqual(initial);
      expect(
        reduceOnboarding(opened, { type: "generate-proposal" }).methodInfo,
      ).toBeNull();
      expect(
        reduceOnboarding(opened, { type: "interrupt" }).methodInfo,
      ).toBeNull();
    },
  );
  it("keeps explanations within the method screen and validates their identity", () => {
    const initial = createOnboardingState("onboarding-method");
    expect(
      reduceOnboarding(initial, { type: "method-info", id: "unknown" }),
    ).toEqual(initial);
    expect(
      reduceOnboarding(initial, {
        type: "patch",
        patch: { methodInfo: "gtd" },
      }),
    ).toEqual(initial);
    const proposal = createOnboardingState("onboarding-proposal");
    expect(
      reduceOnboarding(proposal, { type: "method-info", id: "gtd" }),
    ).toEqual(proposal);
    const waiting = reduceOnboarding(
      { ...initial, methodOutcome: "wait" },
      { type: "generate-proposal" },
    );
    expect(
      reduceOnboarding(waiting, { type: "method-info", id: "gtd" }),
    ).toEqual(waiting);
  });
  it.each([
    ["time-blocking", "timeBlocking", copy.timeBlockingProposal],
    ["pomodoro", "pomodoro", copy.pomodoroProposal],
    ["eisenhower", "eisenhower", copy.eisenhowerProposal],
    ["zettelkasten", "zettelkasten", copy.zettelkastenProposal],
  ] as const)(
    "includes %s in the proposal without starting supporting tools",
    (id, field, text) => {
      const initial = {
        ...createOnboardingState("onboarding-method"),
        approaches: [id],
      };
      const proposal = reduceOnboarding(initial, { type: "generate-proposal" });
      expect(proposal.methodDraft[field]).toBe(true);
      expect(methodLines(proposal)).toContain(text);
      expect(methodCombinationNotes(proposal)).toEqual([]);
      expect(proposal.importApproved).toBe(false);
      expect(proposal.startedTools).toEqual([]);
      const confirmed = reduceOnboarding(proposal, { type: "confirm-method" });
      expect(confirmed.organization).toContain(text);
      expect(confirmed.startedTools).toEqual([]);
      const unselected = reduceOnboarding(
        { ...initial, approaches: [] },
        { type: "generate-proposal" },
      );
      expect(methodLines(unselected)).not.toContain(text);
    },
  );
  it("coordinates overlapping practices and retains them through a scripted revision", () => {
    const proposal = reduceOnboarding(
      {
        ...createOnboardingState("onboarding-method"),
        approaches: copy.methods.map((method) => method.id),
      },
      { type: "generate-proposal" },
    );
    expect(methodCombinationNotes(proposal)).toEqual([
      copy.combinedTasks,
      copy.combinedSchedule,
      copy.combinedTime,
      copy.combinedKnowledge,
    ]);
    const updated = reduceOnboarding(
      { ...proposal, feedback: "Lighter reviews" },
      { type: "revise-proposal" },
    );
    expect(updated.methodDraft.limit).toBe(false);
    expect(methodCombinationNotes(updated)).not.toContain(
      copy.combinedSchedule,
    );
    expect(methodLines(updated)).toContain(copy.zettelkastenProposal);
    const confirmed = reduceOnboarding(updated, { type: "confirm-method" });
    expect(confirmed.organization).toContain(copy.combinedTime);
    expect(confirmed.organization).toContain(copy.combinedKnowledge);
  });

  it("accepts an empty or brief description without requiring practice selection", () => {
    for (const context of ["", "Apple Notes"]) {
      const initial = {
        ...createOnboardingState("onboarding-method"),
        context,
      };
      const proposal = reduceOnboarding(initial, { type: "generate-proposal" });
      expect(proposal).toMatchObject({
        step: "proposal",
        context,
        feedback: "",
        methodConfirmed: false,
        approaches: [],
      });
      expect(reduceOnboarding(proposal, { type: "confirm-method" }).step).toBe(
        "sources",
      );
    }
  });
  it("keeps the description and proposal unchanged until the requested revision succeeds", () => {
    const initial = {
      ...createOnboardingState("onboarding-proposal"),
      feedback: copy.example.feedback,
      methodOutcome: "wait" as const,
    };
    const waiting = reduceOnboarding(initial, { type: "revise-proposal" });
    expect(waiting.methodRequest).toBe("revision");
    expect(methodLines(waiting)).toEqual(methodLines(initial));
    expect(reduceOnboarding(waiting, { type: "confirm-method" })).toEqual(
      waiting,
    );
    const revised = reduceOnboarding(waiting, { type: "complete-method" });
    expect(revised.context).toBe(initial.context);
    expect(revised.feedback).toBe(copy.example.feedback);
    expect(revised.appliedFeedback).toBe(copy.example.feedback);
    expect(revised.methodDraft.review).toBe("none");
    const confirmed = reduceOnboarding(revised, { type: "confirm-method" });
    expect(confirmed.organization).toContain(initial.context);
    expect(confirmed.organization).toContain(copy.example.feedback);
    expect(confirmed.methodConfirmed).toBe(true);
    expect(confirmed.importApproved).toBe(false);
    expect(confirmed.startedTools).toEqual([]);
  });
  it("keeps open preferences neutral and optional until a relevant revision succeeds", () => {
    expect(createOnboardingState("onboarding-method").openPoints).toEqual([]);
    const initial = createOnboardingState("onboarding-proposal");
    expect(initial.openPoints).toEqual([copy.example.openPoint]);
    expect(methodLines(initial)).toContain(copy.reviewUndecided);
    expect(
      reduceOnboarding(initial, { type: "confirm-method" }).methodConfirmed,
    ).toBe(true);
    expect(
      reduceOnboarding(initial, { type: "patch", patch: { openPoints: [] } }),
    ).toEqual(initial);
    const waiting = reduceOnboarding(
      { ...initial, feedback: copy.example.feedback, methodOutcome: "wait" },
      { type: "revise-proposal" },
    );
    for (const type of ["cancel-method", "fail-method", "interrupt"] as const) {
      const retained = reduceOnboarding(waiting, { type });
      expect(retained.openPoints).toEqual(initial.openPoints);
      expect(retained.methodDraft).toEqual(initial.methodDraft);
      expect(retained.feedback).toBe(copy.example.feedback);
    }
    const updated = reduceOnboarding(waiting, { type: "complete-method" });
    expect(updated.openPoints).toEqual([]);
    expect(updated.methodDraft.review).toBe("none");
    const unrelated = reduceOnboarding(
      { ...waiting, revisionExample: "focus" },
      { type: "complete-method" },
    );
    expect(unrelated.openPoints).toEqual(initial.openPoints);
    expect(methodLines(unrelated)).toContain(copy.reviewUndecided);
    expect(
      createOnboardingState("onboarding-proposal-short").openPoints,
    ).toEqual([]);
  });

  it("does not accept feedback that has not been reviewed in the proposal", () => {
    const state = {
      ...createOnboardingState("onboarding-proposal"),
      feedback: "No weekly review",
    };
    expect(reduceOnboarding(state, { type: "confirm-method" })).toEqual(state);
  });
  it("preserves both inputs and the previous proposal on failure, then retries", () => {
    const initial = {
      ...createOnboardingState("onboarding-proposal"),
      feedback: copy.example.feedback,
      methodOutcome: "failure" as const,
    };
    const failed = reduceOnboarding(initial, { type: "revise-proposal" });
    expect(failed).toMatchObject({
      context: initial.context,
      feedback: initial.feedback,
      methodRequest: null,
      methodError: true,
      methodDraft: initial.methodDraft,
    });
    expect(reduceOnboarding(failed, { type: "confirm-method" })).toEqual(
      failed,
    );
    const retried = reduceOnboarding(
      { ...failed, methodOutcome: "success" },
      { type: "revise-proposal" },
    );
    expect(retried).toMatchObject({
      methodError: false,
      appliedFeedback: initial.feedback,
    });
  });
  it("cancels pending responses on input changes, navigation and provider interruption", () => {
    const waiting = createOnboardingState("onboarding-proposal-waiting");
    for (const action of [
      { type: "cancel-method" },
      { type: "patch", patch: { context: "A different starting point" } },
      { type: "patch", patch: { feedback: "A different adjustment" } },
      { type: "patch", patch: { step: "method" } },
      { type: "interrupt" },
    ] as const) {
      const cancelled = reduceOnboarding(waiting, action);
      expect(cancelled.methodRequest).toBeNull();
      expect(reduceOnboarding(cancelled, { type: "complete-method" })).toEqual(
        cancelled,
      );
    }
  });
  it("cannot approve through a patch or overwrite agreed inputs", () => {
    const initial = createOnboardingState("onboarding-proposal-waiting");
    const patched = reduceOnboarding(initial, {
      type: "patch",
      patch: {
        appliedFeedback: initial.feedback,
        methodRequest: null,
        methodError: false,
      },
    });
    expect(patched).toEqual(initial);
    const revised = reduceOnboarding(initial, { type: "complete-method" });
    const confirmed = reduceOnboarding(revised, { type: "confirm-method" });
    expect(
      reduceOnboarding(confirmed, {
        type: "patch",
        patch: { context: "Changed", feedback: "Changed" },
      }),
    ).toEqual(confirmed);
  });
});
