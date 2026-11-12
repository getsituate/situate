import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { activeQuestion, askQuestion, answerQuestion } from "./question";
import type { Event } from "./model";
import QuestionPrompt from "./QuestionPrompt.vue";
import ChatTranscript from "./ChatTranscript.vue";
import { createSimulation, reduceSimulation } from "../workshop/simulation";

describe("chat questions", () => {
  it("accepts one suggested answer and rejects repeats and unknown choices", () => {
    const events: Event[] = [];
    const question = askQuestion(events, "Where first?", [
      { id: "garden", label: "The garden" },
    ]);
    expect(
      answerQuestion(events, { questionId: question.id, optionId: "missing" }),
    ).toBeNull();
    expect(question.status).toBe("pending");
    expect(
      answerQuestion(events, { questionId: question.id, optionId: "garden" }),
    ).toEqual({ text: "The garden", optionId: "garden" });
    expect(
      answerQuestion(events, { questionId: question.id, optionId: "garden" }),
    ).toBeNull();
    expect(activeQuestion(events)).toBeUndefined();
  });
  it("allows a written answer with or without suggestions and rejects empty text", () => {
    for (const options of [[], [{ id: "garden", label: "The garden" }]]) {
      const events: Event[] = [];
      const question = askQuestion(events, "Where first?", options);
      expect(
        answerQuestion(events, { questionId: question.id, text: "  " }),
      ).toBeNull();
      expect(
        answerQuestion(events, {
          questionId: question.id,
          text: " Somewhere else.\n",
        }),
      ).toEqual({ text: " Somewhere else.\n" });
    }
  });
  it("does not accept a response to an older question", () => {
    const events: Event[] = [];
    const first = askQuestion(events, "Where first?", [
      { id: "garden", label: "The garden" },
    ]);
    const second = askQuestion(events, "When?", []);
    expect(first.status).toBe("superseded");
    expect(
      answerQuestion(events, { questionId: first.id, optionId: "garden" }),
    ).toBeNull();
    expect(activeQuestion(events)?.id).toBe(second.id);
  });
  it("sends a suggestion directly and leaves answered history read-only", async () => {
    const events: Event[] = [];
    const question = askQuestion(events, "Where first?", [
      { id: "garden", label: "The garden" },
    ]);
    const view = mount(QuestionPrompt, { props: { question } });
    expect(view.findAll(".question-options button")).toHaveLength(1);
    await view.get(".question-options button").trigger("click");
    expect(view.emitted("answer")).toEqual([
      [{ questionId: question.id, optionId: "garden" }],
    ]);
    answerQuestion(events, { questionId: question.id, optionId: "garden" });
    const history = mount(ChatTranscript, { props: { events } });
    expect(history.text()).toContain("Where first?");
    expect(history.findAll("button")).toHaveLength(0);
    history.unmount();
    view.unmount();
  });
  it("exposes all overflow choices and derives layout from their labels", async () => {
    const events: Event[] = [];
    const question = askQuestion(
      events,
      "Where first?",
      Array.from({ length: 10 }, (_, index) => ({
        id: String(index),
        label: `Choice ${index + 1}`,
      })),
    );
    const view = mount(QuestionPrompt, { props: { question } });
    expect(view.findAll(".question-options button")).toHaveLength(6);
    expect(view.find(".question-options--list").exists()).toBe(false);
    await view.get(".question-more").trigger("click");
    expect(view.findAll(".question-options button")).toHaveLength(10);
    expect(view.get(".question-more").attributes("aria-expanded")).toBe("true");
    await view.setProps({
      question: {
        ...question,
        options: question.options.map((option) => ({
          ...option,
          label:
            option.label +
            " with a longer explanation of what this answer includes.",
        })),
      },
    });
    expect(view.find(".question-options--list").exists()).toBe(true);
    expect(view.findAll(".question-options button")).toHaveLength(10);
    await view.setProps({ question: { ...question, id: "next-question" } });
    expect(view.findAll(".question-options button")).toHaveLength(6);
    await view.setProps({
      question: { ...question, id: "open-question", options: [] },
    });
    expect(view.findAll("button")).toHaveLength(0);
    view.unmount();
  });
  it("keeps suggestions inactive while the host disables answering", async () => {
    const question = askQuestion([], "Where first?", [
      { id: "garden", label: "The garden" },
    ]);
    const view = mount(QuestionPrompt, { props: { question, enabled: false } });
    expect(
      view.get(".question-options button").attributes("disabled"),
    ).toBeDefined();
    await view.get(".question-options button").trigger("click");
    expect(view.emitted("answer")).toBeUndefined();
    view.unmount();
  });
  it("records a written answer verbatim and clears the shared draft only once", () => {
    let state = createSimulation("chat-question");
    state.chat.draft = " A quiet trip.\n";
    const id = activeQuestion(state.chat.transcript!)!.id;
    const command = {
      type: "chat-answer",
      response: { questionId: id, text: state.chat.draft },
    } as const;
    state = reduceSimulation(state, command);
    expect(state.chat.draft).toBe("");
    expect(state.chat.transcript).toContainEqual(
      expect.objectContaining({ speaker: "user", text: " A quiet trip.\n" }),
    );
    const before = structuredClone(state.chat);
    state = reduceSimulation(state, command);
    expect(state.chat).toEqual(before);
  });
  it("retains independent chat drafts when a choice is sent and resets answered examples", () => {
    let state = createSimulation("chat-question");
    state.chat.draft = "An unsent detail";
    const question = activeQuestion(state.chat.transcript!)!;
    const command = {
      type: "chat-answer",
      response: { questionId: question.id, optionId: "travel" },
    } as const;
    state = reduceSimulation(state, command);
    expect(state.chat.draft).toBe("An unsent detail");
    expect(
      state.chat.transcript?.filter(
        (event) => event.kind === "message" && event.speaker === "user",
      ),
    ).toHaveLength(1);
    const before = structuredClone(state.chat.transcript);
    state = reduceSimulation(state, command);
    expect(state.chat.transcript).toEqual(before);
    state = reduceSimulation(state, { type: "reset" });
    expect(state.chat.draft).toBe("");
    expect(activeQuestion(state.chat.transcript!)).toBeDefined();
  });
});
