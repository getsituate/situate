import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import SituateErrorScreen from "./SituateErrorScreen.vue";

it("renders the caller's message as text without actions", () => {
  const message = "This view could not be loaded. <details>";
  const wrapper = mount(SituateErrorScreen, { props: { message } });
  expect(wrapper.get('[role="alert"]').text()).toBe(message);
  expect(wrapper.findAll("button, a, input, details")).toHaveLength(0);
  wrapper.unmount();
});
