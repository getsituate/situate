import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { expect, it, vi } from "vitest";
import CallbackCelebration from "./CallbackCelebration.vue";
import { handoffDuration } from "./score";

it("recomposes at the current time on resize and has no independent clock", async () => {
  let resize: ResizeObserverCallback;
  const disconnect = vi.fn();
  const animationFrame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", animationFrame);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const wrapper = mount(CallbackCelebration, { props: { timeMs: 1500 } });
  const viewport = async (width: number, height: number) => {
    resize(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    await nextTick();
  };
  try {
    await viewport(1280, 800);
    expect(wrapper.findAll(".celebration-piece").length).toBeGreaterThan(144);
    const frame = wrapper.html();
    await wrapper.setProps({ timeMs: handoffDuration });
    expect(wrapper.findAll(".celebration-piece")).toHaveLength(0);
    await wrapper.setProps({ timeMs: 1500 });
    expect(wrapper.html()).toBe(frame);
    await viewport(390, 844);
    expect(wrapper.attributes("viewBox")).toBe("0 0 390 844");
    expect(wrapper.attributes("data-time")).toBe("1500");
    expect(wrapper.findAll(".celebration-piece").length).toBeLessThanOrEqual(
      92,
    );
    expect(animationFrame).not.toHaveBeenCalled();
  } finally {
    wrapper.unmount();
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalledOnce();
});
