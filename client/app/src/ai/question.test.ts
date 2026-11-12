import { expect, test } from "vitest";
import { readQuestion, retainedQuestions, validateAnswer } from "./question";

test("question input validation rejects blank prompts, duplicate choices and malformed labels", () => {
  for (const q of [
    { id: "q", prompt: " " },
    {
      id: "q",
      prompt: "Where?",
      suggestions: [
        { id: "x", label: "A" },
        { id: "x", label: "B" },
      ],
    },
    { id: "q", prompt: "Where?", suggestions: [{ id: "x", label: " " }] },
  ])
    expect(() => readQuestion(q)).toThrow("chatQuestion.invalid");
});
test("host previews survive durable question projection with exact UTF-8 bounds", () => {
  const preview = {
    title: "AGENTS.md",
    text: "📝".repeat(16384),
    summary: "Exact proposed instructions",
  };
  const question = {
    id: "host",
    prompt: "Adopt?",
    context: { revision: 2 },
    preview,
  };
  expect(readQuestion(question).preview).toEqual(preview);
  const restored = retainedQuestions(
    JSON.parse(
      JSON.stringify([
        {
          id: "event",
          runId: "questions",
          sequence: 1,
          type: "question_presented",
          data: question,
        },
      ]),
    ),
  );
  expect(restored[0]!.preview).toEqual(preview);
  for (const invalid of [
    null,
    [],
    { ...preview, text: preview.text + "a" },
    { ...preview, text: 7 },
    { ...preview, title: "é".repeat(129) },
    { ...preview, title: " " },
    { ...preview, summary: "é".repeat(98305) },
    { ...preview, summary: false },
  ]) {
    expect(() => readQuestion({ ...question, preview: invalid })).toThrow(
      "chatQuestion.invalid",
    );
  }
});

test("questions retain all suggestions and only the newest pending question accepts responses", () => {
  const questions = retainedQuestions([
    {
      id: "e1",
      runId: "r",
      sequence: 1,
      type: "question_presented",
      data: { id: "one", prompt: "Where?" },
    },
    {
      id: "e2",
      runId: "r",
      sequence: 2,
      type: "question_presented",
      data: {
        id: "two",
        prompt: "When?",
        suggestions: Array.from({ length: 10 }, (_, i) => ({
          id: String(i),
          label: String(i),
        })),
      },
    },
  ]);
  expect(questions[0]!.status).toBe("superseded");
  expect(questions[1]!.suggestions).toHaveLength(10);
  expect(() =>
    validateAnswer(questions[0], { questionId: "one", text: "No" }),
  ).toThrow("chatQuestion.stale");
  expect(
    validateAnswer(questions[1], {
      questionId: "two",
      text: "  Later\nplease  ",
    }),
  ).toEqual({ text: "  Later\nplease  " });
});
