import "@situate/localization/onboarding";
import { t } from "@situate/localization";
import type { ConversationQuestion } from "../ai/question";
import { currentOnboarding } from "./session";
import type { OnboardingRecord } from "./types";

type Action = "method" | "import" | "idea" | "finish";
export interface SetupQuestionContext {
  kind: "onboarding";
  action: Action;
  conversation: string;
  record: OnboardingRecord;
  ideaId?: string;
}
export function onboardingRevision(scope: string, conversation: string) {
  const record = currentOnboarding(scope)?.state.record;
  if (!record || record.conversationId !== conversation) return "";
  return setupSnapshot(record);
}
export function setupQuestion(
  scope: string,
  conversation: string,
): ConversationQuestion | undefined {
  const record = currentOnboarding(scope)?.state.record;
  if (!record || record.conversationId !== conversation) return;
  let action: Action;
  let choices: (
    | "confirm"
    | "adjust"
    | "support"
    | "retry"
    | "develop"
    | "save"
    | "discard"
    | "finish"
  )[];
  let ideaId: string | undefined;
  let title = "";
  if (record.step === "proposal") {
    action = "method";
    choices = ["confirm", "adjust"];
  } else if (["sources", "review"].includes(record.step)) {
    action = "import";
    choices = ["support", "retry"];
  } else if (record.step === "support") {
    const idea = record.ideas.find((item) => item.choice === null);
    if (idea) {
      action = "idea";
      ideaId = idea.id;
      title = idea.title;
      choices = ["develop", "save", "discard"];
    } else {
      action = "finish";
      choices = ["finish", "adjust"];
    }
  } else return;
  return {
    id: crypto.randomUUID(),
    prompt: {
      method: record.fresh
        ? t("onboardingAgent.question.methodFresh")
        : t("onboardingAgent.question.method"),
      import: t("onboardingAgent.question.import"),
      idea: t("onboardingAgent.question.idea", { title }),
      finish: t("onboardingAgent.question.finish"),
    }[action],
    suggestions: choices.map((id) => ({
      id,
      label: {
        confirm: record.fresh
          ? t("onboardingAgent.choice.confirmFresh")
          : t("onboardingAgent.choice.confirm"),
        adjust: t("onboardingAgent.choice.adjust"),
        support: t("onboardingAgent.choice.support"),
        retry: t("onboardingAgent.choice.retry"),
        develop: t("onboardingAgent.choice.develop"),
        save: t("onboardingAgent.choice.save"),
        discard: t("onboardingAgent.choice.discard"),
        finish: t("onboardingAgent.choice.finish"),
      }[id]!,
    })),
    ...(action === "method" && record.instructionBase?.text === record.proposal
      ? {
          preview: {
            title: t("onboarding.proposal.file"),
            text: record.proposal,
            summary: [
              t("chat.proposedSource"),
              record.fresh ? t("chat.noImport") : record.sourceDescription,
              t("onboarding.conversation.intent"),
              {
                keep: t("onboarding.conversation.keep"),
                change: t("onboarding.conversation.change"),
                help: t("onboarding.conversation.help"),
              }[record.intent ?? "help"],
              t("chat.proposedPreferences"),
              record.description,
            ].join("\n\n"),
          },
        }
      : {}),
    context: {
      kind: "onboarding",
      action,
      conversation,
      record: structuredClone(record),
      ...(ideaId ? { ideaId } : {}),
    } satisfies SetupQuestionContext,
  };
}
export function isOnboardingQuestion(
  scope: string,
  conversation: string,
  question: ConversationQuestion,
): boolean {
  const record = currentOnboarding(scope)?.state.record;
  const context = question.context as SetupQuestionContext | undefined;
  return (
    !!record &&
    record.conversationId === conversation &&
    context?.kind === "onboarding" &&
    context.conversation === conversation &&
    !!context.record &&
    context.record.conversationId === conversation &&
    ((context.action === "method" && context.record.step === "proposal") ||
      (context.action === "import" &&
        ["sources", "review"].includes(context.record.step)) ||
      ((context.action === "idea" || context.action === "finish") &&
        context.record.step === "support"))
  );
}
export function isRetiredSetupQuestion(
  scope: string,
  conversation: string,
  question: ConversationQuestion,
): boolean {
  return (
    currentOnboarding(scope)?.state.record?.step === "complete" &&
    isOnboardingQuestion(scope, conversation, question)
  );
}
export function canAnswerOnboardingQuestion(
  scope: string,
  conversation: string,
  question: ConversationQuestion,
): boolean {
  return (
    isOnboardingQuestion(scope, conversation, question) &&
    sameSetup(
      (question.context as SetupQuestionContext).record,
      currentOnboarding(scope)!.state.record!,
    )
  );
}
export function canRetrySetupQuestion(
  scope: string,
  conversation: string,
  question: ConversationQuestion,
  choice?: string,
): boolean {
  if (!isOnboardingQuestion(scope, conversation, question)) return false;
  const {
    record: before,
    action,
    ideaId,
  } = question.context as SetupQuestionContext;
  const current = currentOnboarding(scope)!.state.record!;
  if (sameSetup(before, current)) return true;
  if (
    action === "method" &&
    choice === "confirm" &&
    current.instructionRevision
  ) {
    return sameSetup(
      {
        ...before,
        step: before.fresh ? "support" : "sources",
        instructionRevision: current.instructionRevision,
        instructionBase: current.instructionBase,
      },
      current,
    );
  }
  if (action === "import" && choice === "support")
    return sameSetup({ ...before, step: "support" }, current);
  if (
    action === "idea" &&
    ["develop", "save", "discard"].includes(choice ?? "")
  ) {
    return sameSetup(
      {
        ...before,
        ideas: before.ideas.map((idea) =>
          idea.id === ideaId
            ? { ...idea, choice: choice as "develop" | "save" | "discard" }
            : idea,
        ),
      },
      current,
    );
  }
  if (action === "finish" && choice === "finish") {
    const ideas = before.ideas.map((idea) =>
      idea.choice === "save"
        ? {
            ...idea,
            notePath: idea.notePath ?? `Plugin idea ${idea.developmentId}.md`,
          }
        : idea,
    );
    if (sameSetup({ ...before, step: "complete", ideas }, current)) return true;
    return (
      sameSetup(
        {
          ...current,
          ideas: current.ideas.map((idea, index) => ({
            ...idea,
            notePath: before.ideas[index]?.notePath ?? null,
          })),
        },
        before,
      ) &&
      current.ideas.every(
        (idea) =>
          idea.notePath ===
            before.ideas.find((item) => item.id === idea.id)?.notePath ||
          idea.notePath === `Plugin idea ${idea.developmentId}.md`,
      )
    );
  }
  return false;
}
function setupSnapshot(record: OnboardingRecord) {
  const { paused: _paused, entered: _entered, ...state } = record;
  return JSON.stringify(state, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}
export function sameSetup(a: OnboardingRecord, b: OnboardingRecord) {
  return setupSnapshot(a) === setupSnapshot(b);
}
