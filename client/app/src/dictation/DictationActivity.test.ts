import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DictationActivity from "./DictationActivity.vue";

let wrapper: VueWrapper | undefined;
let intersection: IntersectionObserverCallback;
let media: EventTarget & { matches: boolean };
let frames: Map<number, FrameRequestCallback>;
let time: number;
let animate: ReturnType<typeof vi.fn>;
let cancels: ReturnType<typeof vi.fn>[];
let disconnect: ReturnType<typeof vi.fn>;
function visible(value = true) {
  intersection(
    [
      {
        target: wrapper!.element,
        isIntersecting: value,
        intersectionRect: { width: value ? 44 : 0, height: value ? 44 : 0 },
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}
function render(props = {}) {
  wrapper = mount(DictationActivity, {
    attachTo: document.body,
    props: { phase: "recording", level: 0.8, covered: false, ...props },
  });
  visible();
  return wrapper;
}
async function step(count = 1) {
  for (let index = 0; index < count; index++) {
    time += 16;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }
  await flushPromises();
}
function extent() {
  return Math.max(
    ...wrapper!
      .findAll(".wave-bar")
      .map(
        (bar) =>
          Number((bar.element as HTMLElement).style.transform.slice(7, -1)) -
          0.125,
      ),
  );
}
function reduced(value: boolean) {
  media.matches = value;
  media.dispatchEvent(new Event("change"));
}
beforeEach(() => {
  frames = new Map();
  time = 0;
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  cancels = [];
  disconnect = vi.fn();
  animate = vi.fn(() => {
    const cancel = vi.fn();
    cancels.push(cancel);
    return { cancel };
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dictation activity", () => {
  it("renders seven rounded bars driven by loudness and settles completely in silence", async () => {
    render({ level: 0 });
    await step();
    expect(wrapper!.attributes("aria-hidden")).toBe("true");
    expect(wrapper!.findAll(".wave-bar")).toHaveLength(7);
    expect(extent()).toBe(0);
    expect(frames.size).toBe(0);
    await wrapper!.setProps({ level: 1 });
    await step(30);
    const loud = extent();
    expect(loud).toBeGreaterThan(0.6);
    const shape = wrapper!.find(".wave-bar").attributes("style");
    await step(10);
    expect(wrapper!.find(".wave-bar").attributes("style")).not.toBe(shape);
    await wrapper!.setProps({ level: 0.15 });
    await step(60);
    expect(extent()).toBeLessThan(loud / 3);
    await wrapper!.setProps({ level: 0 });
    await step(60);
    expect(extent()).toBe(0);
    expect(frames.size).toBe(0);
  });

  it.each([undefined, NaN, Infinity, -1])(
    "keeps invalid or missing input %s still without inventing speech",
    async (level) => {
      render({ level });
      await step(20);
      expect(extent()).toBe(0);
      expect(frames.size).toBe(0);
    },
  );

  it("bounds loud input and retargets a single render loop", async () => {
    render({ level: 10 });
    await step(30);
    expect(extent()).toBeGreaterThan(0.6);
    expect(extent()).toBeLessThanOrEqual(0.8);
    expect(frames.size).toBe(1);
    for (const level of [0.1, 0.9, 0.2]) {
      await wrapper!.setProps({ level });
      expect(frames.size).toBe(1);
    }
    await wrapper!.setProps({ level: 0 });
    await step(80);
    expect(extent()).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("replaces bars with processing dots and cleans up both animation mechanisms", async () => {
    render();
    await step();
    await wrapper!.setProps({ phase: "transcribing" });
    expect(frames.size).toBe(0);
    expect(wrapper!.findAll(".wave-bar")).toHaveLength(0);
    expect(wrapper!.findAll(".processing-dot")).toHaveLength(3);
    expect(animate.mock.calls.map((call) => call[1].delay)).toEqual([
      0, 160, 320,
    ]);
    wrapper!.unmount();
    wrapper = undefined;
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each(["recording", "transcribing"] as const)(
    "keeps %s still with live reduced-motion changes",
    async (phase) => {
      reduced(true);
      render({ phase });
      await step();
      expect(frames.size).toBe(0);
      expect(animate).not.toHaveBeenCalled();
      reduced(false);
      if (phase === "recording") {
        await step(10);
        expect(extent()).toBeGreaterThan(0);
      } else expect(animate).toHaveBeenCalledTimes(3);
      reduced(true);
      await flushPromises();
      expect(frames.size).toBe(0);
      if (phase === "recording") expect(extent()).toBe(0);
      expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
        true,
      );
    },
  );

  it("suspends behind dialogs, while covered, offscreen and hidden", async () => {
    render();
    await step(10);
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    dialog.setAttribute("open", "");
    await flushPromises();
    expect(frames.size).toBe(0);
    expect(extent()).toBe(0);
    dialog.removeAttribute("open");
    await flushPromises();
    expect(frames.size).toBe(1);
    await wrapper!.setProps({ covered: true });
    expect(frames.size).toBe(0);
    await wrapper!.setProps({ covered: false });
    visible(false);
    expect(frames.size).toBe(0);
    visible();
    expect(frames.size).toBe(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);
    wrapper!.unmount();
    wrapper = undefined;
    expect(frames.size).toBe(0);
    document.dispatchEvent(new Event("visibilitychange"));
    reduced(false);
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("retains static feedback when animation APIs are unavailable", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    render();
    expect(wrapper!.findAll(".wave-bar")).toHaveLength(7);
    expect(extent()).toBe(0);
    expect(frames.size).toBe(0);
  });
});
