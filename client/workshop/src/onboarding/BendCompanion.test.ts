import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import BendCompanion from "./BendCompanion.vue";
import { bendScore } from "./bend-motion";

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture() {
  const animations: {
    playState: string;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  let intersection: IntersectionObserverCallback;
  let observed: Element;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
      }
      observe(element: Element) {
        observed = element;
      }
      disconnect = disconnect;
    },
  );
  const preference = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => preference);
  const animate = vi.fn(() => {
    const animation = {
      playState: "running",
      play: vi.fn(),
      pause: vi.fn(),
      cancel: vi.fn(),
    };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  vi.stubGlobal("Animation", class {});
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "animate",
  );
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  const restore = () => {
    if (original) Object.defineProperty(Element.prototype, "animate", original);
    else Reflect.deleteProperty(Element.prototype, "animate");
  };
  const visible = (isIntersecting: boolean) =>
    intersection(
      [{ target: observed, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  const motionChange = (matches: boolean) => {
    preference.matches = matches;
    (preference.addEventListener.mock.calls[0]![1] as () => void)();
  };
  return {
    animations,
    animate,
    visible,
    motionChange,
    preference,
    disconnect,
    restore,
  };
}

describe("Bend companion", () => {
  it("plays one finite greeting without changing operation state, and pauses without replaying", async () => {
    const f = fixture();
    try {
      const wrapper = mount(BendCompanion, {
        props: { moment: "welcome", paused: false, seen: false },
      });
      mounted.push(wrapper);
      expect(f.animate).not.toHaveBeenCalled();
      f.visible(true);
      expect(f.animate).toHaveBeenCalledTimes(2);
      expect(wrapper.emitted("played")).toHaveLength(1);
      expect(f.animate.mock.calls[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            duration: 1400,
            iterations: 1,
            fill: "none",
          }),
        ]),
      );
      await wrapper.setProps({ paused: true });
      expect(f.animations.every((a) => a.pause.mock.calls.length > 0)).toBe(
        true,
      );
      await wrapper.setProps({ paused: false });
      expect(f.animate).toHaveBeenCalledTimes(2);
      f.visible(false);
      expect(f.animations.every((a) => a.pause.mock.calls.length > 1)).toBe(
        true,
      );
      f.visible(true);
      expect(f.animate).toHaveBeenCalledTimes(2);
      wrapper.unmount();
      expect(f.animations.every((a) => a.cancel.mock.calls.length > 0)).toBe(
        true,
      );
      expect(f.disconnect).toHaveBeenCalled();
    } finally {
      f.restore();
    }
  });
  it("respects reduced motion at startup and does not replay skipped gestures", () => {
    const f = fixture();
    try {
      f.preference.matches = true;
      const wrapper = mount(BendCompanion, {
        props: { moment: "welcome", paused: false, seen: false },
      });
      mounted.push(wrapper);
      f.visible(true);
      expect(f.animate).not.toHaveBeenCalled();
      expect(wrapper.emitted("played")).toHaveLength(1);
      f.motionChange(false);
      expect(f.animate).not.toHaveBeenCalled();
    } finally {
      f.restore();
    }
  });
  it("cancels active motion on a live reduced-motion change", () => {
    const f = fixture();
    try {
      const wrapper = mount(BendCompanion, {
        props: { moment: "welcome", paused: false, seen: false },
      });
      mounted.push(wrapper);
      f.visible(true);
      f.motionChange(true);
      expect(f.animations.every((a) => a.cancel.mock.calls.length > 0)).toBe(
        true,
      );
      f.motionChange(false);
      expect(f.animate).toHaveBeenCalledTimes(2);
    } finally {
      f.restore();
    }
  });
  it("keeps errors and plan review still, and replaces motion rather than queueing it", async () => {
    const f = fixture();
    try {
      const wrapper = mount(BendCompanion, {
        props: { moment: "welcome", paused: false, seen: false },
      });
      mounted.push(wrapper);
      f.visible(true);
      await wrapper.setProps({ moment: "blocked" });
      expect(f.animations.every((a) => a.cancel.mock.calls.length > 0)).toBe(
        true,
      );
      expect(f.animate).toHaveBeenCalledTimes(2);
      await wrapper.setProps({ moment: "ready" });
      expect(f.animate).toHaveBeenCalledTimes(2);
      expect(bendScore("ready").tracks).toEqual([]);
    } finally {
      f.restore();
    }
  });
  it("does not greet again when an already-seen scene is remounted", () => {
    const f = fixture();
    try {
      const wrapper = mount(BendCompanion, {
        props: { moment: "welcome", paused: false, seen: true },
      });
      mounted.push(wrapper);
      f.visible(true);
      expect(f.animate).not.toHaveBeenCalled();
      expect(wrapper.emitted("played")).toBeUndefined();
      expect(wrapper.find("svg").attributes("data-bend-pose")).toBe("wave");
    } finally {
      f.restore();
    }
  });
});
