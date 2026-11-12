import type { Event } from "./model";

export const questionPreviewLimit = 6;

export interface QuestionOption {
  id: string;
  label: string;
}
export interface QuestionEvent {
  kind: "question";
  id: string;
  text: string;
  options: QuestionOption[];
  status: "pending" | "answered" | "superseded";
  answer?: { text: string; optionId?: string };
}
export type QuestionResponse = { questionId: string } & (
  { optionId: string; text?: never } | { text: string; optionId?: never }
);
export function activeQuestion(events: Event[]): QuestionEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.kind === "question" && event.status === "pending") return event;
  }
  return undefined;
}
export function closeQuestion(events: Event[]) {
  for (const event of events)
    if (event.kind === "question" && event.status === "pending")
      event.status = "superseded";
}
export function askQuestion(
  events: Event[],
  text: string,
  options: QuestionOption[] = [],
): QuestionEvent {
  closeQuestion(events);
  const question: QuestionEvent = {
    kind: "question",
    id: `question-${events.length + 1}`,
    text,
    options,
    status: "pending",
  };
  events.push(question);
  return question;
}
export function answerQuestion(
  events: Event[],
  response: QuestionResponse,
): QuestionEvent["answer"] | null {
  const question = activeQuestion(events);
  if (!question || question.id !== response.questionId) return null;
  const option =
    response.optionId === undefined
      ? undefined
      : question.options.find((option) => option.id === response.optionId);
  if (response.optionId !== undefined && !option) return null;
  const text = option?.label ?? response.text;
  if (!text?.trim()) return null;
  question.status = "answered";
  question.answer = { text, ...(option ? { optionId: option.id } : {}) };
  return question.answer;
}
