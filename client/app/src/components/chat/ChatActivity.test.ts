import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ChatActivity from "./ChatActivity.vue";
vi.mock("@situate/localization", () => ({ t: (key: string) => key }));
let wrapper: VueWrapper | undefined;
let media: EventTarget & { matches: boolean };
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function render(props = {}) {
  wrapper = mount(ChatActivity, {
    props,
    global: {
      stubs: {
        MiniBendPlayful: defineComponent({
          name: "MiniBendPlayful",
          props: { paused: Boolean },
          template: "<span />",
        }),
      },
    },
  });
  return wrapper;
}
test("shows a fallback immediately and rotates without repetition until contextual text arrives", async () => {
  render();
  expect(wrapper!.get("[role=status]").text()).toBe("chat.activityWorking");
  expect(wrapper!.get(".comment-reveal").text()).toBe("chat.activityWorking");
  await vi.advanceTimersByTimeAsync(9000);
  expect(wrapper!.get("[role=status]").text()).toBe("chat.activityProcessing");
  await wrapper!.setProps({ comment: "Preparing the reading list" });
  expect(wrapper!.get("[role=status]").text()).toBe(
    "Preparing the reading list",
  );
  expect(wrapper!.get(".comment-reveal").text()).not.toBe(
    "Preparing the reading list",
  );
  expect(wrapper!.get(".comment-reserve").text()).toBe(
    "Preparing the reading list",
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(wrapper!.get(".comment-reveal").text()).toBe(
    "Preparing the reading list",
  );
  await vi.advanceTimersByTimeAsync(18000);
  expect(wrapper!.get("[role=status]").text()).toBe(
    "Preparing the reading list",
  );
});
test("live reduced motion reveals complete text directly and teardown clears timers", async () => {
  render();
  await wrapper!.setProps({ comment: "Preparing a response" });
  media.matches = true;
  media.dispatchEvent(new Event("change"));
  await nextTick();
  expect(wrapper!.get(".comment-reveal").text()).toBe("Preparing a response");
  await wrapper!.setProps({ comment: "Processing your request" });
  expect(wrapper!.get(".comment-reveal").text()).toBe(
    "Processing your request",
  );
  wrapper!.unmount();
  wrapper = undefined;
  expect(vi.getTimerCount()).toBe(0);
});
test("pausing motion completes the current reveal without hiding activity", async () => {
  render();
  await wrapper!.setProps({ comment: "Preparing a response" });
  await wrapper!.get("button").trigger("click");
  expect(wrapper!.get(".comment-reveal").text()).toBe("Preparing a response");
  expect(wrapper!.get("[role=status]").text()).toBe("Preparing a response");
  expect(vi.getTimerCount()).toBe(0);
});
test("modal coverage suspends the character and text timers until dismissal", async () => {
  render();
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  await nextTick();
  await nextTick();
  expect(vi.getTimerCount()).toBe(0);
  expect(
    wrapper!.getComponent({ name: "MiniBendPlayful" }).props("paused"),
  ).toBe(true);
  const phrase = wrapper!.get("[role=status]").text();
  await vi.advanceTimersByTimeAsync(18000);
  expect(wrapper!.get("[role=status]").text()).toBe(phrase);
  dialog.remove();
  await nextTick();
  await nextTick();
  expect(vi.getTimerCount()).toBe(1);
  expect(
    wrapper!.getComponent({ name: "MiniBendPlayful" }).props("paused"),
  ).toBe(false);
});
test("pausing the fallback stops text rotation until resumed", async () => {
  render();
  await wrapper!.get("button").trigger("click");
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(18000);
  expect(wrapper!.get("[role=status]").text()).toBe("chat.activityWorking");
  await wrapper!.get("button").trigger("click");
  expect(vi.getTimerCount()).toBe(1);
});
test("suspends text timers while hidden or covered without changing execution", async () => {
  render();
  await wrapper!.setProps({ suspended: true });
  expect(vi.getTimerCount()).toBe(0);
  await wrapper!.setProps({ suspended: false });
  expect(vi.getTimerCount()).toBe(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await nextTick();
  expect(vi.getTimerCount()).toBe(0);
});
