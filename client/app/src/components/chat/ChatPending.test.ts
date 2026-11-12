import { afterEach, expect, test } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import ChatPending from "./ChatPending.vue";

enableAutoUnmount(afterEach);

test("pending disclosures retain message content and recall remains a separate action", async () => {
  const message = {
    id: "queued",
    kind: "steering" as const,
    text: "Check the garden notes",
    attachments: [{ id: "attachment", name: "garden.md" }],
  };
  const wrapper = mount(ChatPending, { props: { messages: [message] } });
  const toggle = wrapper.get(".pending-toggle");
  expect(toggle.attributes("aria-expanded")).toBe("false");
  await toggle.trigger("click");
  expect(toggle.attributes("aria-expanded")).toBe("true");
  const disclosure = wrapper.get<HTMLDetailsElement>("details.pending-message");
  expect(disclosure.classes()).toContain("situate-disclosure");
  expect(disclosure.get("summary").text()).toContain(message.text);
  disclosure.element.open = true;
  await disclosure.trigger("toggle");
  await wrapper.setProps({
    messages: [{ ...message, text: "Check both garden notes" }],
  });
  expect(disclosure.element.open).toBe(true);
  expect(disclosure.get(".pending-body p").text()).toBe(
    "Check both garden notes",
  );
  expect(disclosure.get(".attachment").text()).toBe("garden.md");
  expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  await wrapper.get(".edit-pending").trigger("click");
  expect(wrapper.emitted("recall")).toEqual([[]]);
  expect(toggle.attributes("aria-expanded")).toBe("true");
  await wrapper.setProps({ messages: [] });
  expect(wrapper.find(".pending").exists()).toBe(false);
  await wrapper.setProps({ messages: [message] });
  expect(wrapper.get(".pending-toggle").attributes("aria-expanded")).toBe(
    "false",
  );
});
