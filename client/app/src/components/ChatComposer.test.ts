import { mount } from "@vue/test-utils";
import { afterEach, expect, test } from "vitest";
import ChatComposer from "./ChatComposer.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

test("the leading attachment button requests native file selection without sending", async () => {
  const wrapper = mount(ChatComposer, {
    props: { draft: "Keep this draft", connected: true, modelSelected: true },
  });
  const attach = wrapper.get<HTMLButtonElement>(".attach-action");
  expect(wrapper.get(".input-line").element.firstElementChild).toBe(
    attach.element,
  );
  expect(attach.attributes("aria-label")).toBe("⟦navigation.attachFile⟧");
  expect(attach.get("svg path").attributes("d")).toBe("M12 5v14M5 12h14");
  await attach.trigger("click");
  expect(wrapper.emitted("attach")).toEqual([[]]);
  expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe(
    "Keep this draft",
  );
  expect(wrapper.emitted("send")).toBeUndefined();
  wrapper.unmount();
});

test("attachment availability and upload state remain independent of provider access", async () => {
  const wrapper = mount(ChatComposer, { props: { draft: undefined } });
  const attach = wrapper.get<HTMLButtonElement>(".attach-action");
  expect(attach.element.disabled).toBe(true);
  await wrapper.setProps({ draft: "Draft", connected: false });
  expect(attach.element.disabled).toBe(false);
  await wrapper.setProps({ attaching: true });
  expect(attach.element.disabled).toBe(true);
  expect(attach.attributes("aria-busy")).toBe("true");
  await wrapper.setProps({ attaching: false });
  expect(attach.element.disabled).toBe(false);
  expect(attach.attributes("aria-busy")).toBe("false");
  wrapper.unmount();
});

test("question answers use the full composer without requiring a model", async () => {
  const wrapper = mount(ChatComposer, {
    props: {
      draft: "My own answer",
      question: true,
      connected: false,
      modelSelected: false,
      description: "question-text",
      dictationSupported: true,
      dictationReady: true,
    },
  });
  expect(wrapper.get("label").text()).toBe("⟦chatQuestion.answer⟧");
  expect(wrapper.get("textarea").attributes("aria-describedby")).toBe(
    "question-text",
  );
  expect(wrapper.find(".attach-action").exists()).toBe(true);
  expect(wrapper.find(".composer-selectors").exists()).toBe(true);
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toEqual([["steering"]]);
  await wrapper.setProps({ busy: true });
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toHaveLength(1);
});
