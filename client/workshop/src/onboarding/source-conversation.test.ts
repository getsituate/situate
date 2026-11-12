import { describe, expect, it } from "vitest";
import {
  createOnboardingState,
  reduceOnboarding,
  type OnboardingAction,
} from "./model";
import {
  newSourceConversation,
  reduceSourceConversation,
} from "./source-conversation";
import copy from "../localization/en.import-preparation.json";

const begin = (
  text = "  Apple Notes\nA task list.  ",
  outcome: "success" | "failure" | "wait" = "success",
) => {
  const state = createOnboardingState("onboarding-sources");
  state.source = text;
  state.sourceConversation.outcome = outcome;
  return reduceOnboarding(state, { type: "start-source-chat" });
};
const act = (
  type: "complete" | "retry" | "stop" | "fail" | "send",
  attempt = 1,
): OnboardingAction => ({
  type: "source-chat",
  action: type === "complete" || type === "fail" ? { type, attempt } : { type },
});

describe("source conversation", () => {
  it("offers a concrete Apple Notes next step without asking for the source again", () => {
    const s = createOnboardingState("onboarding-sources-apple-notes");
    expect(s.source).toBe("in Apple Notes");
    expect(s.sourceConversation.messages[0]?.text).toContain(
      "\nin Apple Notes\n",
    );
    expect(s.sourceConversation.messages[1]?.text).toContain(
      "Paste a note here",
    );
    expect(s.sourceConversation.messages[1]?.text).not.toContain("?");
    expect(s.imported).toEqual([]);
    expect(s.importState).toBe("none");
  });
  it("makes the import request visible and includes the exact source description without importing unavailable content", () => {
    const text = "  Apple Notes\n<draft> & tasks — keep my words.  ";
    const s = begin(text);
    expect(s.step).toBe("source-chat");
    expect(s.sourceConversation.messages[0]).toMatchObject({
      speaker: "user",
    });
    expect(s.sourceConversation.messages[0]?.text).toContain(text);
    expect(s.sourceConversation.messages[0]?.text).toMatch(
      /^Import my notes and tasks into this workspace\./,
    );
    expect(s.sourceConversation.messages[0]?.text).toContain(
      "Follow the working method I just confirmed",
    );
    expect(s.source).toBe(text);
    expect(s.sourceConversation.messages[1]).toMatchObject({
      speaker: "assistant",
      text: copy.responses.access,
    });
    expect(s.sourceConversation.draft).toBe("");
    expect(s).toMatchObject({
      importApproved: false,
      importState: "none",
      imported: [],
      samples: [],
      startedTools: [],
    });
    expect(s.savedInstructions).toBe(
      createOnboardingState("onboarding-sources").savedInstructions,
    );
  });
  it("rejects whitespace and does not mutate the input state", () => {
    const s = createOnboardingState("onboarding-sources");
    s.source = " \n ";
    expect(reduceOnboarding(s, { type: "start-source-chat" })).toEqual(s);
    const before = structuredClone(s);
    s.source = "Notes";
    reduceOnboarding(s, { type: "start-source-chat" });
    expect(s.sourceConversation).toEqual(before.sourceConversation);
  });
  it("keeps the same conversation and draft through back and resume without resending", () => {
    let s = begin();
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "draft", value: "An unfinished answer" },
    });
    const messages = structuredClone(s.sourceConversation.messages);
    s = reduceOnboarding(s, { type: "close-source-chat" });
    expect(s.step).toBe("sources");
    s = reduceOnboarding(s, { type: "start-source-chat" });
    expect(s.sourceConversation.messages).toEqual(messages);
    expect(s.sourceConversation.draft).toBe("An unfinished answer");
    s = reduceOnboarding(s, {
      type: "patch",
      patch: {
        source: "replacement",
        sourceConversation: newSourceConversation(),
      },
    });
    expect(s.source).toBe("  Apple Notes\nA task list.  ");
    expect(s.sourceConversation.messages).toEqual(messages);
  });
  it("keeps pending work alive on Back and accepts its completion while hidden", () => {
    let s = begin("Notes", "wait");
    s = reduceOnboarding(s, { type: "close-source-chat" });
    expect(s.sourceConversation.phase).toBe("working");
    expect(s.step).toBe("sources");
    s = reduceOnboarding(s, act("complete"));
    expect(s.sourceConversation.phase).toBe("complete");
    expect(s.sourceConversation.messages).toHaveLength(2);
    s = reduceOnboarding(s, { type: "open-source-chat" });
    expect(s.sourceConversation.messages).toHaveLength(2);
  });
  it("explicit Stop ignores late completion and retries without duplicate user messages", () => {
    let s = begin("Notes", "wait");
    s = reduceOnboarding(s, act("stop"));
    expect(reduceOnboarding(s, act("complete"))).toEqual(s);
    s = reduceOnboarding(s, act("retry"));
    expect(reduceOnboarding(s, act("complete", 1))).toEqual(s);
    s = reduceOnboarding(s, act("complete", 2));
    expect(s.sourceConversation.messages).toHaveLength(2);
  });
  it("freezes the reply example at submission and preserves drafts through failures", () => {
    let s = begin("Notes", "wait");
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "reply", value: "scope" },
    });
    s = reduceOnboarding(s, act("complete"));
    expect(s.sourceConversation.messages.at(-1)?.text).toBe(
      copy.responses.access,
    );
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "draft", value: "  Keep only active projects.\n" },
    });
    s = reduceOnboarding(s, act("send"));
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "draft", value: "Still typing" },
    });
    s = reduceOnboarding(s, act("fail", 2));
    expect(s.sourceConversation.draft).toBe("Still typing");
    expect(s.sourceConversation.messages.at(-1)?.text).toBe(
      "  Keep only active projects.\n",
    );
    s = reduceOnboarding(s, act("retry"));
    s = reduceOnboarding(s, act("complete", 3));
    expect(s.sourceConversation.messages).toHaveLength(4);
    expect(s.sourceConversation.messages.at(-1)?.text).toBe(
      copy.responses.scope,
    );
  });
  it("keeps the conversation through provider interruption, setup completion and reopening", () => {
    let s = begin("Notes", "wait");
    s = reduceOnboarding(s, { type: "interrupt" });
    expect(s).toMatchObject({
      step: "access",
      resumeStep: "source-chat",
      connected: false,
    });
    expect(s.sourceConversation.phase).toBe("cancelled");
    expect(reduceOnboarding(s, act("complete"))).toEqual(s);
    s = reduceOnboarding(s, {
      type: "patch",
      patch: { connectionOutcome: "success" },
    });
    s = reduceOnboarding(s, { type: "retry" });
    s = reduceOnboarding(s, { type: "open-source-chat" });
    s = reduceOnboarding(s, { type: "defer" });
    s = reduceOnboarding(s, { type: "confirm" });
    s = reduceOnboarding(s, { type: "finale-finish" });
    s = reduceOnboarding(s, { type: "open-source-chat" });
    expect(s.sourceConversation.messages[0]?.text).toContain("\nNotes\n");
    s = reduceOnboarding(s, { type: "close-source-chat" });
    expect(s.step).toBe("home");
  });
  it("reviews completed example files after the conversation and retains them during further questions", () => {
    let s = begin();
    expect(reduceOnboarding(s, { type: "review-source" }).step).toBe(
      "source-chat",
    );
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "reply", value: "review" },
    });
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "draft", value: "Show the proposed result." },
    });
    s = reduceOnboarding(s, act("send"));
    s = reduceOnboarding(s, { type: "review-source" });
    expect(s.step).toBe("samples");
    expect(s.samples.length).toBeGreaterThan(0);
    expect(s.importApproved).toBe(true);
    expect(s.importState).toBe("ready");
    expect(s.imported).toEqual(s.samples);
    const files = structuredClone(s.imported);
    s = reduceOnboarding(s, { type: "open-source-chat" });
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "draft", value: "I want to change something." },
    });
    s = reduceOnboarding(s, {
      type: "source-chat",
      action: { type: "reply", value: "scope" },
    });
    s = reduceOnboarding(s, act("send"));
    expect(s.sourceConversation.ready).toBe(false);
    expect(s.imported).toEqual(files);
    expect(reduceOnboarding(s, { type: "review-source" }).step).toBe(
      "source-chat",
    );
  });
  it("has deterministic waiting and failure starting states and a fresh reset", () => {
    expect(
      createOnboardingState("onboarding-sources-waiting").sourceConversation
        .phase,
    ).toBe("working");
    expect(
      createOnboardingState("onboarding-sources-failed").sourceConversation
        .phase,
    ).toBe("error");
    expect(
      createOnboardingState("onboarding-sources").sourceConversation.messages,
    ).toEqual([]);
    const s = newSourceConversation();
    expect(reduceSourceConversation(s, { type: "retry" })).toEqual(s);
    expect(
      reduceSourceConversation(s, { type: "complete", attempt: 0 }),
    ).toEqual(s);
  });
});
