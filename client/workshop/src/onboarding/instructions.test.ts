import { describe, expect, it } from "vitest";
import {
  createOnboardingState,
  instructionMarkdown,
  instructionPath,
  reduceOnboarding,
  type OnboardingAction,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import copy from "../localization/en.workspace-instructions.json";

describe("workspace instruction drafts", () => {
  it("uses the same short document for review and saving", () => {
    const state = createOnboardingState("onboarding-proposal-short");
    const document = instructionMarkdown(state);
    expect(document).toBe(
      "# " + copy.document.title + "\n\n" + copy.document.shortPractice + "\n",
    );
    const saved = reduceOnboarding(state, { type: "confirm-method" });
    expect(saved.savedInstructions).toBe(document);
    expect(saved.organization).toBe(copy.document.shortPractice);
    expect(saved.importApproved).toBe(false);
  });
  it("replacing an instruction example clears draft inputs and cancels a pending save", () => {
    const state = createOnboardingState("onboarding-proposal-saving");
    const changed = reduceOnboarding(state, {
      type: "instructions-example",
      example: "short",
    });
    expect(changed.instructionExample).toBe("short");
    expect(changed.feedback).toBe("");
    expect(changed.appliedFeedback).toBe("");
    expect(changed.context).toBe("");
    expect(changed.methodRequest).toBeNull();
    expect(changed.instructionSave).toBe("idle");
    expect(changed.savedInstructions).toBeNull();
    expect(
      reduceOnboarding(changed, { type: "complete-instructions" }),
    ).toEqual(changed);
    const revised = reduceOnboarding(
      { ...changed, feedback: "Add a review" },
      { type: "revise-proposal" },
    );
    expect(revised.instructionExample).toBe("standard");
    expect(instructionMarkdown(revised)).toContain("Add a review");
  });
  it("does not turn an open preference into an instruction on confirmation", () => {
    const state = createOnboardingState("onboarding-proposal");
    const markdown = instructionMarkdown(state);
    expect(markdown).toContain("Review frequency is undecided");
    expect(markdown).not.toContain("weekly review");
    expect(markdown).not.toContain(state.openPoints[0]);
    const confirmed = reduceOnboarding(state, { type: "confirm-method" });
    expect(confirmed.savedInstructions).toBe(markdown);
    expect(confirmed.openPoints).toEqual(state.openPoints);
  });
  it("renders the proposed practices and distinguishes the owner's words", () => {
    const state = createOnboardingState("onboarding-proposal");
    const markdown = instructionMarkdown(state);
    expect(markdown).toContain("# " + copy.document.title);
    expect(markdown).toContain("## " + copy.document.rules);
    expect(markdown).toContain("> " + state.context);
    expect(markdown).toContain(copy.document.scope);
    expect(state.savedInstructions).toBeNull();
  });
  it("opening and closing the reader do not save or authorize anything", () => {
    const state = createOnboardingState("onboarding-proposal");
    const opened = reduceOnboarding(state, {
      type: "instructions-view",
      open: true,
    });
    expect(opened).toEqual({ ...state, instructionsOpen: true });
    expect(
      reduceOnboarding(opened, { type: "instructions-view", open: false }),
    ).toEqual(state);
    expect(
      reduceOnboarding(createOnboardingState("onboarding-method"), {
        type: "instructions-view",
        open: true,
      }).instructionsOpen,
    ).toBe(false);
  });
  it("saves exactly the document that was available to read, once", () => {
    const state = createOnboardingState("onboarding-proposal");
    const saved = reduceOnboarding(state, { type: "confirm-method" });
    expect(saved.savedInstructions).toBe(instructionMarkdown(state));
    expect(saved.methodConfirmed).toBe(true);
    expect(saved.step).toBe("sources");
    expect(saved.importApproved).toBe(false);
    expect(saved.startedTools).toEqual([]);
    expect(saved.planApproved).toBe(false);
    expect(reduceOnboarding(saved, { type: "confirm-method" })).toEqual(saved);
  });
  it("revisions replace the draft without replacing a previously saved file", () => {
    const saved = reduceOnboarding(
      createOnboardingState("onboarding-proposal"),
      { type: "confirm-method" },
    );
    const revisited = reduceOnboarding(saved, { type: "revise-method" });
    const proposal = reduceOnboarding(revisited, { type: "generate-proposal" });
    const feedback = reduceOnboarding(proposal, {
      type: "patch",
      patch: { feedback: "No scheduled review" },
    });
    expect(reduceOnboarding(feedback, { type: "confirm-method" })).toEqual(
      feedback,
    );
    const revised = reduceOnboarding(feedback, { type: "revise-proposal" });
    expect(instructionMarkdown(revised)).not.toBe(saved.savedInstructions);
    expect(revised.savedInstructions).toBe(saved.savedInstructions);
    expect(instructionMarkdown(revised)).toContain("> No scheduled review");
    expect(
      reduceOnboarding(revised, { type: "confirm-method" }).savedInstructions,
    ).toBe(instructionMarkdown(revised));
  });
  it("holds saves, preserves the draft on failure and retries the same content", () => {
    const initial = {
      ...createOnboardingState("onboarding-proposal"),
      instructionSaveOutcome: "wait" as const,
    };
    const pending = reduceOnboarding(initial, { type: "confirm-method" });
    expect(pending.instructionSave).toBe("saving");
    expect(pending.savedInstructions).toBeNull();
    expect(pending.methodConfirmed).toBe(false);
    expect(reduceOnboarding(pending, { type: "confirm-method" })).toEqual(
      pending,
    );
    const failed = reduceOnboarding(pending, { type: "fail-instructions" });
    expect(failed.instructionSave).toBe("error");
    expect(instructionMarkdown(failed)).toBe(instructionMarkdown(initial));
    expect(failed.savedInstructions).toBeNull();
    const retried = reduceOnboarding(
      { ...failed, instructionSaveOutcome: "success" },
      { type: "confirm-method" },
    );
    expect(retried.savedInstructions).toBe(instructionMarkdown(initial));
  });
  it.each<OnboardingAction>([
    { type: "cancel-instructions" },
    { type: "interrupt" },
    { type: "patch", patch: { step: "method" } },
    { type: "patch", patch: { feedback: "Keep it simple" } },
  ])(
    "discards a pending save on $type and ignores stale completion",
    (action) => {
      const pending = createOnboardingState("onboarding-proposal-saving");
      const cancelled = reduceOnboarding(pending, action);
      expect(cancelled.instructionSave).toBe("idle");
      expect(cancelled.savedInstructions).toBeNull();
      expect(
        reduceOnboarding(cancelled, { type: "complete-instructions" }),
      ).toEqual(cancelled);
    },
  );
  it("does not accept forged save state or locations through a generic patch", () => {
    const state = createOnboardingState("onboarding-proposal");
    expect(
      reduceOnboarding(state, {
        type: "patch",
        patch: {
          savedInstructions: "Changed",
          instructionSave: "saving",
          instructionsOpen: true,
          workspacePath: "/Other",
        },
      }),
    ).toEqual(state);
  });
  it("shows the selected workspace's full path, including Windows separators", () => {
    const simulation = createSimulation("onboarding-proposal");
    expect(instructionPath(simulation.onboarding)).toBe(
      simulation.snapshot.current!.display + "/AGENTS.md",
    );
    simulation.snapshot.current!.display = "/Example/Workspaces/My research";
    const updated = reduceSimulation(simulation, {
      type: "onboarding",
      action: { type: "instructions-view", open: true },
    });
    expect(instructionPath(updated.onboarding)).toBe(
      "/Example/Workspaces/My research/AGENTS.md",
    );
    expect(
      instructionPath({
        ...simulation.onboarding,
        workspacePath: "C:\\Workspaces\\Research\\",
      }),
    ).toBe("C:\\Workspaces\\Research\\AGENTS.md");
  });
});
