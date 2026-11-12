import type { RuntimeEvent } from "./queue-runtime";

export interface ConversationQuestion {
  id: string;
  prompt: string;
  suggestions?: { id: string; label: string }[];
  context?: unknown;
  preview?: { title: string; text: string; summary?: string };
}
export type QuestionResponse = { questionId: string } & (
  { choiceId: string; text?: never } | { text: string; choiceId?: never }
);
export interface RetainedQuestion extends ConversationQuestion {
  timestamp: number;
  status: "pending" | "answered" | "superseded";
  answer?: { text: string; choiceId?: string };
}
export function readQuestion(value: unknown): ConversationQuestion {
  if (!value || typeof value !== "object")
    throw new Error("chatQuestion.invalid");
  const q = value as ConversationQuestion;
  const identifier = (v: unknown): v is string =>
    typeof v === "string" && !!v.trim() && v.length <= 256;
  const boundedText = (v: unknown, bytes: number) =>
    typeof v === "string" && new TextEncoder().encode(v).length <= bytes;
  if (
    (q.preview !== undefined &&
      (!q.preview ||
        typeof q.preview !== "object" ||
        Array.isArray(q.preview) ||
        !boundedText(q.preview.title, 256) ||
        !q.preview.title.trim() ||
        !boundedText(q.preview.text, 65536) ||
        (q.preview.summary !== undefined &&
          !boundedText(q.preview.summary, 196608)) ||
        Object.keys(q.preview).some(
          (key) => !["title", "text", "summary"].includes(key),
        ))) ||
    !identifier(q.id) ||
    typeof q.prompt !== "string" ||
    !q.prompt.trim() ||
    q.prompt.length > 16000 ||
    (q.suggestions !== undefined &&
      (!Array.isArray(q.suggestions) ||
        q.suggestions.some(
          (s) =>
            !s ||
            !identifier(s.id) ||
            typeof s.label !== "string" ||
            !s.label.trim() ||
            s.label.length > 4000,
        ) ||
        new Set(q.suggestions.map((s) => s.id)).size !== q.suggestions.length))
  )
    throw new Error("chatQuestion.invalid");
  return JSON.parse(JSON.stringify(q));
}
export function retainedQuestions(
  events: readonly RuntimeEvent[],
): RetainedQuestion[] {
  const questions: RetainedQuestion[] = [];
  for (const event of events) {
    if (event.type === "question_presented") {
      const question = readQuestion(event.data);
      for (const previous of questions)
        if (previous.status === "pending") previous.status = "superseded";
      questions.push({
        ...question,
        timestamp: (event.data as { timestamp?: number }).timestamp ?? 0,
        status: "pending",
      });
    } else if (event.type === "question_superseded") {
      const { questionId } = event.data as { questionId: string };
      const question = questions.find(
        (q) => q.id === questionId && q.status === "pending",
      );
      if (question) question.status = "superseded";
    } else if (event.type === "question_answered") {
      const data = event.data as {
        questionId: string;
        answer: RetainedQuestion["answer"];
      };
      const question = questions.find(
        (q) => q.id === data.questionId && q.status === "pending",
      );
      if (question) {
        question.status = "answered";
        question.answer = data.answer;
      }
    }
  }
  return questions;
}
export function validateAnswer(
  question: RetainedQuestion | undefined,
  response: QuestionResponse,
  hasContent = false,
): NonNullable<RetainedQuestion["answer"]> {
  if (
    !question ||
    question.status !== "pending" ||
    question.id !== response.questionId
  )
    throw new Error("chatQuestion.stale");
  if (response.choiceId !== undefined) {
    const choice = question.suggestions?.find(
      (s) => s.id === response.choiceId,
    );
    if (!choice || response.text !== undefined)
      throw new Error("chatQuestion.invalid");
    return { text: choice.label, choiceId: choice.id };
  }
  if (
    typeof response.text !== "string" ||
    (!response.text.trim() && !hasContent) ||
    response.text.length > 1048576
  )
    throw new Error("chatQuestion.empty");
  return { text: response.text };
}
