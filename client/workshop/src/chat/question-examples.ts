import type { ChatState, Event } from "./model";
import { cloneAiState, currentWorkspace } from "../ai/model";
import { historyCopy } from "./work-history";
import { askQuestion, answerQuestion, type QuestionResponse } from "./question";
import copy from "../localization/en.chat-question.json" with { type: "json" };

export const questionExamples = [
  { id: "chat-question", label: copy.ready, group: "Chat" },
  { id: "chat-question-six", label: copy.six, group: "Chat" },
  { id: "chat-question-ten", label: copy.ten, group: "Chat" },
  { id: "chat-question-six-long", label: copy.sixLong, group: "Chat" },
  {
    id: "chat-question-prompt-long",
    label: copy.longPromptState,
    group: "Chat",
  },
  { id: "chat-question-ten-long", label: copy.tenLong, group: "Chat" },
  { id: "chat-question-open", label: copy.open, group: "Chat" },
  { id: "chat-question-answered", label: copy.answered, group: "Chat" },
] as const;
export type QuestionExample = (typeof questionExamples)[number]["id"];
export function setQuestionExample(
  state: ChatState,
  example: QuestionExample,
): ChatState {
  const ai = cloneAiState(state.ai);
  currentWorkspace(ai).response = "idle";
  return {
    ...state,
    ai,
    phase: "complete",
    workClockStartedAt: undefined,
    run: null,
    questionVariant: example,
    transcript: questionExample(example),
    draft: "",
    title: questionTitle,
  };
}
export function exampleOptions(scenario: string) {
  const count = scenario.includes("-six")
    ? 6
    : scenario.includes("-ten")
      ? 10
      : 3;
  const options = [
    { id: "travel", label: copy.travel, long: copy.longTravel },
    { id: "stay", label: copy.stay, long: copy.longStay },
    { id: "activities", label: copy.activities, long: copy.longActivities },
    { id: "food", label: copy.food, long: copy.longFood },
    { id: "budget", label: copy.budget, long: copy.longBudget },
    { id: "pace", label: copy.pace, long: copy.longPace },
    { id: "weather", label: copy.weather, long: copy.longWeather },
    { id: "access", label: copy.access, long: copy.longAccess },
    { id: "packing", label: copy.packing, long: copy.longPacking },
    { id: "booking", label: copy.booking, long: copy.longBooking },
  ];
  return options.slice(0, count).map((option) => ({
    id: option.id,
    label: scenario.endsWith("-long") ? option.long : option.label,
  }));
}
export function questionExample(scenario: string): Event[] | null {
  if (!scenario.startsWith("chat-question")) return null;
  const events: Event[] = [
    {
      kind: "message",
      id: "trip-intro",
      speaker: "assistant",
      text: copy.introduction,
    },
  ];
  const question = askQuestion(
    events,
    scenario === "chat-question-prompt-long"
      ? copy.longPrompt
      : scenario.endsWith("-open")
        ? copy.openQuestion
        : copy.question,
    scenario.endsWith("-open") ? [] : exampleOptions(scenario),
  );
  if (scenario.endsWith("-answered")) {
    answerQuestion(events, { questionId: question.id, optionId: "travel" });
    events.push({
      kind: "message",
      id: "trip-answer",
      speaker: "user",
      text: copy.travel,
    });
    events.push({
      kind: "message",
      id: "trip-response",
      speaker: "assistant",
      text: copy.response,
    });
  }
  return events;
}
export function replyToQuestion(state: ChatState, response: QuestionResponse) {
  if (!state.transcript || state.phase === "working") return;
  if (
    !state.transcript.some(
      (event) =>
        event.kind === "question" &&
        event.id === response.questionId &&
        event.status === "pending",
    )
  )
    return;
  if (
    state.workHistory &&
    response.questionId === "history-approval" &&
    response.optionId === undefined
  ) {
    if (!response.text.trim()) return;
    state.transcript.push(
      {
        kind: "message",
        id: `history-feedback-${state.transcript.length}`,
        speaker: "user",
        text: response.text,
      },
      {
        kind: "message",
        id: `history-feedback-reply-${state.transcript.length}`,
        speaker: "assistant",
        answer: true,
        text: historyCopy[state.composerLocale ?? "en"].approvalFeedback,
      },
    );
    state.draft = "";
    return;
  }
  const answer = answerQuestion(state.transcript, response);
  if (!answer) return;
  if (response.optionId === undefined) state.draft = "";
  state.transcript.push(
    {
      kind: "message",
      id: `trip-user-${state.transcript.length}`,
      speaker: "user",
      text: answer.text,
    },
    {
      kind: "message",
      id: `trip-assistant-${state.transcript.length + 1}`,
      speaker: "assistant",
      ...(state.workHistory ? { answer: true } : {}),
      text: state.workHistory
        ? response.questionId === "history-approval"
          ? response.optionId === "draft"
            ? historyCopy[state.composerLocale ?? "en"].keptDraft
            : historyCopy[state.composerLocale ?? "en"].sendUnavailable
          : historyCopy[state.composerLocale ?? "en"].questionReply
        : copy.response,
    },
  );
}
export const questionTitle = copy.title;
