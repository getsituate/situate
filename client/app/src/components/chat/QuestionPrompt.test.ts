import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import QuestionPrompt from "./QuestionPrompt.vue";

const question = {
  id: "one",
  prompt: "How would you like to travel?",
  status: "pending" as const,
  timestamp: 1,
  suggestions: Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    label: `Route ${i + 1}`,
  })),
};
test("six direct answers are initially shown, with all suggestions reachable", async () => {
  const wrapper = mount(QuestionPrompt, { props: { question } });
  expect(wrapper.findAll(".question-options button")).toHaveLength(6);
  await wrapper.get(".question-more").trigger("click");
  expect(wrapper.findAll(".question-options button")).toHaveLength(10);
  await wrapper.findAll(".question-options button")[9]!.trigger("click");
  expect(wrapper.emitted("answer")).toEqual([
    [{ questionId: "one", choiceId: "9" }],
  ]);
  await wrapper.setProps({ question: { ...question, id: "two" } });
  expect(wrapper.findAll(".question-options button")).toHaveLength(6);
});
test("free-text questions and retained questions have no suggestion controls", async () => {
  const wrapper = mount(QuestionPrompt, {
    props: { question: { ...question, suggestions: [] } },
  });
  expect(wrapper.text()).toContain(question.prompt);
  expect(wrapper.findAll("button")).toHaveLength(0);
  await wrapper.setProps({ question: { ...question, status: "answered" } });
  expect(wrapper.findAll("button")).toHaveLength(0);
});
test("preview remains available for retained questions without enabling answer controls", async () => {
  const preview = { title: "Instructions", text: "# Proposal" };
  const wrapper = mount(QuestionPrompt, {
    props: {
      question: { ...question, status: "answered", preview },
      enabled: false,
    },
  });
  await wrapper.get(".question-preview").trigger("click");
  expect(wrapper.emitted("preview")).toEqual([[preview]]);
  expect(wrapper.emitted("answer")).toBeUndefined();
  expect(wrapper.find(".question-options").exists()).toBe(false);
});

test("pending suggestion buttons respect host availability and long labels stack", () => {
  const wrapper = mount(QuestionPrompt, {
    props: {
      question: {
        ...question,
        suggestions: [
          {
            id: "long",
            label:
              "A longer explanation of how I would like to get there today",
          },
        ],
      },
      enabled: false,
    },
  });
  expect(wrapper.find(".question-options--list").exists()).toBe(true);
  expect(
    wrapper.get<HTMLButtonElement>(".question-options button").element.disabled,
  ).toBe(true);
});
