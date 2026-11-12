import { describe, expect, it } from "vitest";
import {
  createOnboardingState,
  reduceOnboarding,
  canConfirm,
  methodLines,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
describe("guided setup", () => {
  it("offers methods before sources and refines practices without adopting entire systems", () => {
    let s = createOnboardingState("onboarding-method");
    s = reduceOnboarding(s, {
      type: "patch",
      patch: {
        approaches: ["gtd", "kanban", "journal"],
        context: "Keep my project names",
      },
    });
    s = reduceOnboarding(s, { type: "generate-proposal" });
    expect(s).toMatchObject({
      step: "proposal",
      methodConfirmed: false,
      source: "",
      importState: "none",
      methodDraft: {
        capture: "inbox",
        review: "weekly",
        limit: true,
        journal: true,
      },
    });
    s = reduceOnboarding(s, { type: "answer-method", answer: "reflect" });
    expect(s.methodDraft.review).toBe("daily");
    expect(methodLines(s).join(" ")).toContain("rather than copied checkboxes");
    s = reduceOnboarding(s, { type: "confirm-method" });
    expect(s).toMatchObject({
      step: "sources",
      methodConfirmed: true,
      mapping: "inbox",
    });
    expect(s.organization).toContain("Keep my project names");
    expect(
      reduceOnboarding(s, {
        type: "patch",
        patch: { organization: "Different method", approaches: ["para"] },
      }).organization,
    ).toBe(s.organization);
  });
  it.each(["keep", "custom", "guided"] as const)(
    "does not require an essay for %s",
    (method) => {
      let s = createOnboardingState("onboarding-method");
      s.method = method;
      s = reduceOnboarding(s, { type: "generate-proposal" });
      expect(s.step).toBe("proposal");
      expect(
        reduceOnboarding(s, { type: "confirm-method" }).methodConfirmed,
      ).toBe(true);
    },
  );
  it("changes the proposal, not just the response text", () => {
    const s = createOnboardingState("onboarding-proposal");
    const lighter = reduceOnboarding(s, {
      type: "answer-method",
      answer: "lighter",
    });
    expect(lighter.methodDraft).toMatchObject({
      review: "none",
      limit: false,
      journal: false,
    });
    expect(methodLines(lighter)).not.toEqual(methodLines(s));
    expect(
      reduceOnboarding(lighter, { type: "answer-method", answer: "focus" })
        .methodDraft.limit,
    ).toBe(true);
  });
  it("reviews completed files without an additional import approval or mapping form", () => {
    const s = createOnboardingState("onboarding-samples");
    expect(s.importState).toBe("ready");
    expect(s.imported).toHaveLength(3);
    const revised = reduceOnboarding(s, {
      type: "patch",
      patch: { mapping: "inbox" },
    });
    expect(revised.mapping).toBe(s.mapping);
    expect(revised.imported).toEqual(s.imported);
    const next = reduceOnboarding(s, { type: "continue-import-review" });
    expect(next.step).toBe("plan");
    expect(next.imported).toEqual(s.imported);
    expect(next.importState).toBe("ready");
  });
  it("allows app entry while import is pending or interrupted", () => {
    for (const scenario of ["onboarding-import", "onboarding-import-failed"]) {
      const start = createOnboardingState(scenario);
      expect(canConfirm(start)).toBe(false);
      const s = reduceOnboarding(start, {
        type: "patch",
        patch: { step: "plan" },
      });
      expect(canConfirm(s)).toBe(true);
      expect(reduceOnboarding(s, { type: "confirm" })).toMatchObject({
        step: "home",
        confirmed: true,
        importState: s.importState,
      });
    }
  });
  it("rejects initial manual entry while provider access is blocked", () => {
    const start = createOnboardingState("onboarding-provider");
    const local = reduceOnboarding(start, { type: "manual" });
    expect(local).toMatchObject({
      step: "access",
      connected: false,
      manual: false,
      organization: start.organization,
    });
    expect(reduceOnboarding(local, { type: "suggestion" }).editAvailable).toBe(
      false,
    );
  });
  it("requires actual result visibility and retains hint dismissal across conversations", () => {
    let s = createOnboardingState("onboarding-hint");
    expect(reduceOnboarding(s, { type: "visible" }).hintOpen).toBe(false);
    s = reduceOnboarding(s, { type: "patch", patch: { step: "conversation" } });
    s = reduceOnboarding(s, { type: "visible" });
    expect(s.hintOpen).toBe(true);
    s = reduceOnboarding(s, { type: "dismiss-hint" });
    expect(reduceOnboarding(s, { type: "visible" })).toMatchObject({
      hintOpen: false,
      hintDone: true,
    });
  });
  it("removes fictional content without losing an existing note or completed tasks", () => {
    const original = {
      ...createOnboardingState("onboarding-arrival"),
      note: "My draft",
      tasks: [true, false],
    };
    const s = reduceOnboarding(
      reduceOnboarding(original, { type: "suggestion" }),
      { type: "remove-example" },
    );
    expect(s).toMatchObject({
      note: original.note,
      tasks: original.tasks,
      exampleActive: false,
    });
  });
  it("retains drafts, approved mappings and plan choices when geometry changes", () => {
    let s = createSimulation("onboarding-plan");
    const before = s.onboarding;
    s = reduceSimulation(s, {
      type: "environment",
      state: { ...s.environment, keyboardOpen: true },
    });
    expect(s.onboarding).toEqual(before);
  });
});
