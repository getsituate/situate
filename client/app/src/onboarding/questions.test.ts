import "@situate/localization/onboarding";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newOnboardingRecord, type OnboardingRecord } from "./types";
const mock = vi.hoisted(() => ({ record: null as OnboardingRecord | null }));
vi.mock("./session", () => ({
  currentOnboarding: () => ({ state: { record: mock.record } }),
}));
import {
  canAnswerOnboardingQuestion,
  canRetrySetupQuestion,
  isOnboardingQuestion,
  isRetiredSetupQuestion,
  onboardingRevision,
  setupQuestion,
} from "./questions";
import { readQuestion } from "../ai/question";
const scope = "notes",
  conversation = "setup",
  revision = "a".repeat(40);
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("__SITUATE_LOCALIZATION_KEYS__", false);
  mock.record = {
    ...newOnboardingRecord(),
    conversationId: conversation,
    step: "proposal",
    proposal: "Review each Friday",
  };
});
it("retires setup answers after completion without treating ordinary questions as setup", () => {
  const question = setupQuestion(scope, conversation)!;
  expect(canAnswerOnboardingQuestion(scope, conversation, question)).toBe(true);
  expect(isRetiredSetupQuestion(scope, conversation, question)).toBe(false);
  mock.record!.step = "complete";
  expect(isRetiredSetupQuestion(scope, conversation, question)).toBe(true);
  expect(isRetiredSetupQuestion(scope, "other", question)).toBe(false);
  expect(canAnswerOnboardingQuestion(scope, conversation, question)).toBe(
    false,
  );
  expect(setupQuestion(scope, conversation)).toBeUndefined();
  expect(
    isOnboardingQuestion(scope, conversation, {
      id: "clarification",
      prompt: "Which source folder?",
      suggestions: [],
    }),
  ).toBe(false);
});
it("retains the complete discussed proposal and source scope as question data", () => {
  Object.assign(mock.record!, {
    sourceDescription: "Notes export",
    description: "Keep separate reading lists",
  });
  const question = readQuestion(setupQuestion(scope, conversation));
  expect(question.preview).toBeUndefined();
  expect(question.context).toMatchObject({
    record: {
      proposal: "Review each Friday",
      sourceDescription: "Notes export",
      description: "Keep separate reading lists",
    },
  });
  mock.record!.proposal = "Different proposal";
  expect(question.context).toMatchObject({
    record: { proposal: "Review each Friday" },
  });
});
it("makes externally changed instructions inspectable before a new decision", () => {
  Object.assign(mock.record!, {
    proposal: "Changed working method",
    instructionBase: { text: "Changed working method", revision },
  });
  expect(setupQuestion(scope, conversation)?.preview?.text).toBe(
    "Changed working method",
  );
});
it("recognizes only questions bound to the current native conversation", () => {
  const question = setupQuestion(scope, conversation)!;
  expect(isOnboardingQuestion(scope, conversation, question)).toBe(true);
  expect(isOnboardingQuestion(scope, "other", question)).toBe(false);
  expect(
    isOnboardingQuestion(scope, conversation, {
      ...question,
      context: undefined,
    }),
  ).toBe(false);
  expect(
    isOnboardingQuestion(scope, conversation, {
      ...question,
      context: { kind: "onboarding", action: "invented" },
    }),
  ).toBe(false);
});
it("does not invalidate the proposal because entry or pause changed", () => {
  const question = setupQuestion(scope, conversation)!;
  Object.assign(mock.record!, { entered: true, paused: true });
  expect(canAnswerOnboardingQuestion(scope, conversation, question)).toBe(true);
  mock.record!.proposal = "A new proposal";
  expect(canAnswerOnboardingQuestion(scope, conversation, question)).toBe(
    false,
  );
});
it("changes its revision when the source scope changes", () => {
  const previous = onboardingRevision(scope, conversation);
  mock.record!.sourceDescription = "A different source";
  expect(onboardingRevision(scope, conversation)).not.toBe(previous);
});
it("recognizes the exact adopted-state retry without claiming a file save", () => {
  const question = setupQuestion(scope, conversation)!;
  Object.assign(mock.record!, {
    step: "sources",
    instructionRevision: revision,
    instructionBase: { text: mock.record!.proposal, revision },
  });
  expect(canRetrySetupQuestion(scope, conversation, question, "confirm")).toBe(
    true,
  );
  mock.record!.sourceDescription = "A different source";
  expect(canRetrySetupQuestion(scope, conversation, question, "confirm")).toBe(
    false,
  );
});
it("uses fresh-start wording without suggesting an import", () => {
  mock.record!.fresh = true;
  const question = setupQuestion(scope, conversation)!;
  expect(question.prompt).toContain("save this working method");
  expect(question.prompt).not.toContain("import");
  expect(question.suggestions?.[0]).toMatchObject({
    id: "confirm",
    label: "Adopt working method",
  });
});
it("does not fabricate questions outside a decision phase", () => {
  mock.record!.step = "method";
  expect(setupQuestion(scope, conversation)).toBeUndefined();
  mock.record!.step = "complete";
  expect(setupQuestion(scope, conversation)).toBeUndefined();
  expect(setupQuestion(scope, "unrelated")).toBeUndefined();
});
