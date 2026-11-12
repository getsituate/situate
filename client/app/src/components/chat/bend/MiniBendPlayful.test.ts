import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MiniBendPlayful from "./MiniBendPlayful.vue";
import { limbPath } from "./curves";
import {
  gestures,
  gestureScore,
  idleEyes,
  INITIAL_REST_MS,
  nextGesture,
  restAfter,
} from "./gestures";
let wrapper: VueWrapper | undefined;
let intersection: IntersectionObserverCallback;
let media: EventTarget & { matches: boolean };
let animate: ReturnType<typeof vi.fn>;
let cancels: ReturnType<typeof vi.fn>[];
let disconnect: ReturnType<typeof vi.fn>;
function visible(value = true) {
  intersection(
    [
      {
        target: wrapper!.element,
        isIntersecting: value,
        intersectionRect: { width: value ? 32 : 0, height: value ? 32 : 0 },
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}
function render(props = {}) {
  wrapper = mount(MiniBendPlayful, {
    attachTo: document.body,
    props: { busy: true, ...props },
  });
  visible();
  return wrapper;
}
function reduced(value: boolean) {
  media.matches = value;
  media.dispatchEvent(new Event("change"));
}
beforeEach(() => {
  vi.useFakeTimers();
  cancels = [];
  disconnect = vi.fn();
  animate = vi.fn(() => {
    const cancel = vi.fn();
    cancels.push(cancel);
    return { cancel, currentTime: 1400 };
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
  Object.defineProperty(SVGElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
  delete (SVGElement.prototype as Partial<SVGElement>).animate;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("playful waiting mark", () => {
  it("has a joined arch with two independently articulated ends and decorative eyes", () => {
    render({ busy: false });
    expect(wrapper!.attributes("aria-hidden")).toBe("true");
    expect(wrapper!.attributes("focusable")).toBe("false");
    expect(
      wrapper!.findAll("path").map((path) => path.attributes("d")),
    ).toEqual([
      "M7 15V13a9 9 0 0 1 18 0v2",
      limbPath(7, 0),
      limbPath(25, 0),
      "M13 11v3m6-3v3",
    ]);
    expect(vi.getTimerCount()).toBe(0);
    expect(animate).not.toHaveBeenCalled();
  });
  it("keeps the eyes moving throughout the between-gesture score without motionless holds", () => {
    for (const index of [0, 1, 2]) {
      const frames = idleEyes(index);
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i].transform).not.toBe(frames[i - 1].transform);
        expect(frames[i].offset).toBeGreaterThan(frames[i - 1].offset!);
      }
      expect(frames[0].transform).toBe(frames.at(-1)!.transform);
    }
  });
  it("alternates eye-only rests with four-channel scenes without stacking animations", () => {
    render();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toEqual(idleEyes(0));
    vi.advanceTimersByTime(INITIAL_REST_MS);
    expect(cancels[0]).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledTimes(3);
    expect(animate.mock.calls[1][1].duration).toBe(3400);
    vi.advanceTimersByTime(3400);
    expect(
      cancels.slice(0, 3).every((cancel) => cancel.mock.calls.length === 1),
    ).toBe(true);
    expect(animate).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(restAfter(0));
    expect(animate).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(2);
  });
  it.each(gestures)("renders the $id scene with moving limbs", ({ id }) => {
    render({ variant: id });
    vi.advanceTimersByTime(INITIAL_REST_MS);
    const score = gestureScore(id);
    expect(animate.mock.calls[1][1].duration).toBe(score.duration);
    vi.advanceTimersByTime(20);
    expect(wrapper!.find(".mini-bend-playful__left").attributes("d")).not.toBe(
      limbPath(7, 0),
    );
    expect(wrapper!.find(".mini-bend-playful__right").attributes("d")).not.toBe(
      limbPath(25, 0),
    );
  });
  it.each([0, INITIAL_REST_MS + 400])(
    "stops every channel when busy ends at %i ms",
    async (time) => {
      render();
      vi.advanceTimersByTime(time);
      await wrapper!.setProps({ busy: false });
      expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
        true,
      );
      expect(vi.getTimerCount()).toBe(0);
      expect(wrapper!.emitted()).toEqual({});
    },
  );
  it("keeps pause across busy changes and restarts with eye-only rest", async () => {
    render();
    await wrapper!.setProps({ paused: true });
    await wrapper!.setProps({ busy: false });
    await wrapper!.setProps({ busy: true });
    expect(vi.getTimerCount()).toBe(0);
    await wrapper!.setProps({ paused: false });
    expect(animate.mock.calls.at(-1)![0]).toEqual(idleEyes(0));
    expect(vi.getTimerCount()).toBe(1);
  });
  it("is completely static under initial and live reduced motion", async () => {
    media.matches = true;
    render();
    expect(animate).not.toHaveBeenCalled();
    reduced(false);
    vi.advanceTimersByTime(INITIAL_REST_MS);
    reduced(true);
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    await wrapper!.setProps({ paused: true });
    await wrapper!.setProps({ paused: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("suspends both idle eyes and body offscreen and in hidden documents", () => {
    render();
    visible(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60000);
    visible();
    expect(vi.getTimerCount()).toBe(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(animate.mock.calls.at(-1)![0]).toEqual(idleEyes(0));
  });
  it("releases observers and all animation channels on unmount", () => {
    render();
    vi.advanceTimersByTime(INITIAL_REST_MS);
    wrapper!.unmount();
    wrapper = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    reduced(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stays static without animation or observation APIs", () => {
    delete (SVGElement.prototype as Partial<SVGElement>).animate;
    render();
    expect(vi.getTimerCount()).toBe(0);
    wrapper!.unmount();
    vi.stubGlobal("IntersectionObserver", undefined);
    wrapper = mount(MiniBendPlayful, { props: { busy: true } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("replaces a selected scene without queuing the old one", async () => {
    render();
    vi.advanceTimersByTime(INITIAL_REST_MS);
    await wrapper!.setProps({ variant: "dance" });
    vi.advanceTimersByTime(INITIAL_REST_MS);
    expect(animate.mock.calls.at(-1)![1].duration).toBe(3800);
    expect(vi.getTimerCount()).toBe(2);
  });
  it("covers ten distinct scenes without adjacent repeats and provides mirrored expressive variants", () => {
    for (let i = 0; i < 90; i++)
      expect(nextGesture("mixed", i)).not.toBe(nextGesture("mixed", i + 1));
    for (let batch = 0; batch < 3; batch++)
      expect(
        new Set(
          Array.from({ length: 10 }, (_, i) =>
            nextGesture("mixed", batch * 10 + i),
          ),
        ).size,
      ).toBe(10);
    for (const { id } of gestures) {
      const score = gestureScore(id);
      for (const frames of [score.body, score.eyes]) {
        expect(frames[0].offset).toBe(0);
        expect(frames.at(-1)!.offset).toBe(1);
        expect(frames[0].transform).toBe(frames.at(-1)!.transform);
      }
      for (const frames of [score.left, score.right]) {
        expect(frames[0].angle).toBeCloseTo(0);
        expect(frames.at(-1)!.angle).toBeCloseTo(0);
      }
      expect(gestureScore(id, -1, 1).left).not.toEqual(score.left);
      expect(restAfter(0)).toBeGreaterThan(5000);
    }
    expect(
      idleEyes(0).some((frame) =>
        String(frame.transform).includes("scaleY(.12)"),
      ),
    ).toBe(true);
  });
});
