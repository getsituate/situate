import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import WorkingIndicator from "./WorkingIndicator.vue";

enableAutoUnmount(afterEach);
let preference: EventTarget & { matches: boolean };
beforeEach(() => {
  vi.useFakeTimers();
  preference = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => preference);
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 16, 16),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("keeps its accessible label and fixed arch while stepping only the eyes, then stops on removal", async () => {
  const wrapper = mount(WorkingIndicator, {
    attachTo: document.body,
    props: { label: "⟦layoutUi.working⟧" },
  });
  const svg = wrapper.get("svg");
  const body = wrapper.get("[data-mini-body]").attributes("d");
  expect(svg.attributes("aria-hidden")).toBe("true");
  expect(wrapper.attributes("aria-label")).toBe("⟦layoutUi.working⟧");
  expect(svg.attributes("data-mini-frame")).toBe("rest");
  await vi.advanceTimersByTimeAsync(900);
  expect(svg.attributes("data-mini-frame")).toBe("focus");
  await vi.advanceTimersByTimeAsync(600);
  expect(svg.attributes("data-mini-frame")).toBe("blink");
  expect(wrapper.get("[data-mini-body]").attributes("d")).toBe(body);
  expect(wrapper.attributes("aria-label")).toBe("⟦layoutUi.working⟧");
  wrapper.unmount();
  expect(svg.attributes("data-mini-frame")).toBe("rest");
  expect(vi.getTimerCount()).toBe(0);
});

it("shows static rest for initial and live reduced motion without losing busy meaning", async () => {
  preference.matches = true;
  const wrapper = mount(WorkingIndicator, {
    attachTo: document.body,
    props: { label: "⟦navigation.responding⟧" },
  });
  const svg = wrapper.get("svg");
  await vi.advanceTimersByTimeAsync(2400);
  expect(svg.attributes("data-mini-frame")).toBe("rest");
  expect(vi.getTimerCount()).toBe(0);
  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  await vi.advanceTimersByTimeAsync(900);
  expect(svg.attributes("data-mini-frame")).toBe("focus");
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  expect(svg.attributes("data-mini-frame")).toBe("rest");
  expect(wrapper.attributes("aria-label")).toBe("⟦navigation.responding⟧");
  expect(vi.getTimerCount()).toBe(0);
});

it("suspends under a modal and resumes from rest when it closes", async () => {
  const wrapper = mount(WorkingIndicator, {
    attachTo: document.body,
    props: { label: "⟦layoutUi.working⟧" },
  });
  await vi.advanceTimersByTimeAsync(900);
  expect(wrapper.get("svg").attributes("data-mini-frame")).toBe("focus");
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  await vi.advanceTimersByTimeAsync(0);
  expect(wrapper.get("svg").attributes("data-mini-frame")).toBe("rest");
  expect(vi.getTimerCount()).toBe(0);
  dialog.remove();
  await vi.advanceTimersByTimeAsync(900);
  expect(wrapper.get("svg").attributes("data-mini-frame")).toBe("focus");
});

it("animates inside the visible navigation dialog rather than treating it as covered", async () => {
  const dialog = document.createElement("dialog");
  dialog.open = true;
  document.body.append(dialog);
  const wrapper = mount(WorkingIndicator, {
    attachTo: dialog,
    props: { label: "⟦navigation.responding⟧" },
  });
  await vi.advanceTimersByTimeAsync(900);
  expect(wrapper.get("svg").attributes("data-mini-frame")).toBe("focus");
});
