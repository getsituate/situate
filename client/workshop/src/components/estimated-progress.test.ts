import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimatedProgress,
  progressInspectionLimit,
  useEstimatedProgress,
} from "./estimated-progress";
import FormWorkingIndicator from "./FormWorkingIndicator.vue";
import ChatWorkingIndicator from "./ChatWorkingIndicator.vue";
import MiniBendPlayful from "../mini-bend-playful/MiniBendPlayful.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture() {
  let id = 0;
  let target: Element;
  let intersect: IntersectionObserverCallback;
  const scheduled = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    scheduled.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduled.delete(id));
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe(element: Element) {
        target = element;
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
  const paused = ref(false),
    time = ref<number | null>(null);
  let clock!: ReturnType<typeof useEstimatedProgress>;
  const wrapper = mount(
    defineComponent({
      setup() {
        const root = ref<HTMLElement>();
        clock = useEstimatedProgress(
          root,
          () => paused.value,
          () => time.value,
        );
        return () => h("div", { ref: root });
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  return {
    wrapper,
    clock,
    paused,
    time,
    preference,
    scheduled,
    disconnect,
    tick(time: number) {
      for (const [id, callback] of [...scheduled]) {
        scheduled.delete(id);
        callback(time);
      }
    },
    visible(value = true) {
      intersect(
        [
          {
            target,
            isIntersecting: value,
            intersectionRect: {
              width: value ? 100 : 0,
              height: value ? 50 : 0,
            },
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    },
    reduce(value = true) {
      preference.matches = value;
      (preference.addEventListener.mock.calls[0]![1] as () => void)();
    },
  };
}

describe("estimated operation progress", () => {
  it("advances more slowly over time without claiming completion", () => {
    const samples = [0, 1000, 10_000, 30_000, 60_000, 120_000].map(
      estimatedProgress,
    );
    expect(samples[0]).toBe(0.08);
    samples.forEach((value, index) => {
      expect(value).toBeLessThan(1);
      if (index > 0) expect(value).toBeGreaterThan(samples[index - 1]!);
    });
    expect(estimatedProgress(20_000) - estimatedProgress(10_000)).toBeLessThan(
      estimatedProgress(10_000) - estimatedProgress(0),
    );
    expect(estimatedProgress(Number.MAX_VALUE)).toBe(
      estimatedProgress(progressInspectionLimit),
    );
    for (const value of [-1, NaN, Infinity])
      expect(estimatedProgress(value)).toBe(0.08);
  });
  it("starts only when visible and settles below completion without looping", () => {
    const f = fixture();
    expect(f.scheduled.size).toBe(0);
    f.visible();
    f.tick(0);
    f.tick(3000);
    expect(f.clock.time.value).toBe(3000);
    expect(f.scheduled.size).toBe(1);
    f.tick(progressInspectionLimit * 2);
    expect(f.clock.time.value).toBe(progressInspectionLimit);
    expect(f.scheduled.size).toBe(0);
    expect(f.clock.suspended.value).toBe(false);
    expect(estimatedProgress(f.clock.time.value)).toBeLessThan(1);
  });
  it("freezes during inspection and can seek backward without invoking work", () => {
    const f = fixture();
    f.visible();
    f.tick(0);
    f.tick(3000);
    f.time.value = 60_000;
    expect(f.scheduled.size).toBe(0);
    expect(f.clock.time.value).toBe(60_000);
    f.time.value = 10_000;
    expect(f.clock.time.value).toBe(10_000);
    f.time.value = null;
    f.tick(100_000);
    f.tick(101_000);
    expect(f.clock.time.value).toBe(4000);
  });
  it("excludes paused, hidden and offscreen time on resumption", () => {
    const f = fixture();
    f.visible();
    f.tick(0);
    f.tick(1000);
    f.visible(false);
    expect(f.scheduled.size).toBe(0);
    f.visible();
    f.tick(10_000);
    f.tick(11_000);
    expect(f.clock.time.value).toBe(2000);
    f.paused.value = true;
    expect(f.scheduled.size).toBe(0);
    f.paused.value = false;
    f.tick(20_000);
    f.tick(21_000);
    expect(f.clock.time.value).toBe(3000);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.scheduled.size).toBe(0);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    f.tick(30_000);
    f.tick(31_000);
    expect(f.clock.time.value).toBe(4000);
  });
  it("holds the current estimate when reduced motion changes", () => {
    const f = fixture();
    f.visible();
    f.tick(0);
    f.tick(1000);
    f.reduce();
    expect(f.scheduled.size).toBe(0);
    expect(f.clock.time.value).toBe(1000);
    f.reduce(false);
    f.tick(10_000);
    f.tick(11_000);
    expect(f.clock.time.value).toBe(2000);
  });
  it("suspends behind a modal without counting its elapsed time", async () => {
    const f = fixture();
    f.visible();
    f.tick(0);
    f.tick(1000);
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    await nextTick();
    expect(f.scheduled.size).toBe(0);
    dialog.remove();
    await nextTick();
    f.tick(30_000);
    f.tick(31_000);
    expect(f.clock.time.value).toBe(2000);
  });
  it("cancels clocks, observers and listeners on teardown", () => {
    const f = fixture();
    f.visible();
    f.tick(0);
    f.tick(1000);
    const pending = [...f.scheduled.values()][0]!;
    f.wrapper.unmount();
    expect(f.scheduled.size).toBe(0);
    expect(f.disconnect).toHaveBeenCalled();
    expect(f.preference.removeEventListener).toHaveBeenCalled();
    pending(10_000);
    expect(f.scheduled.size).toBe(0);
    expect(f.clock.time.value).toBe(1000);
  });
  it("reuses the chat character, pauses both indicators and keeps completion indeterminate", async () => {
    const wrapper = mount(FormWorkingIndicator, {
      props: { label: "Preparing a proposal…", timeMs: 30_000 },
      global: { stubs: { MiniBendPlayful: true } },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    expect(wrapper.findComponent(ChatWorkingIndicator).exists()).toBe(true);
    expect(wrapper.getComponent(MiniBendPlayful).props("variant")).toBe(
      "mixed",
    );
    expect(wrapper.getComponent(MiniBendPlayful).props("paused")).toBe(true);
    expect(wrapper.get('[role="status"]').text()).toBe("Preparing a proposal…");
    const progress = wrapper.get('[role="progressbar"]');
    expect(progress.attributes("aria-label")).toBe("Preparing a proposal…");
    expect(progress.attributes("aria-valuenow")).toBeUndefined();
    expect(wrapper.get(".situate-progress-fill").attributes("style")).toContain(
      `scaleX(${estimatedProgress(30_000)})`,
    );
    await wrapper.get("button").trigger("click");
    expect(wrapper.get("button").attributes("aria-pressed")).toBe("true");
    expect(wrapper.getComponent(MiniBendPlayful).props("paused")).toBe(true);
    await wrapper.setProps({ timeMs: 1000 });
    expect(wrapper.get(".situate-progress-fill").attributes("style")).toContain(
      `scaleX(${estimatedProgress(1000)})`,
    );
    expect(wrapper.emitted()).not.toHaveProperty("complete");
  });
});
