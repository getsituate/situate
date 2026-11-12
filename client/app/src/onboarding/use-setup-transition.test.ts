import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { useSetupTransition } from "./use-setup-transition";
import { transitionDuration } from "./setup-transition";
import { openingDuration } from "./setup-journey/opening";
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture() {
  let id = 0;
  const scheduled = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    scheduled.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduled.delete(id));
  let intersect: IntersectionObserverCallback;
  let target: Element;
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
    inspected = ref<number | null>(null),
    inspectedOpening = ref<number | null>(null);
  let clock!: ReturnType<typeof useSetupTransition>;
  const wrapper = mount(
    defineComponent({
      setup() {
        const root = ref<HTMLElement>();
        clock = useSetupTransition(
          root,
          () => paused.value,
          () => inspected.value,
          () => inspectedOpening.value,
        );
        return () => h("div", { ref: root });
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  return {
    clock,
    paused,
    inspected,
    inspectedOpening,
    scheduled,
    wrapper,
    preference,
    disconnect,
    tick(time: number) {
      for (const [id, fn] of [...scheduled]) {
        scheduled.delete(id);
        fn(time);
      }
    },
    visible(value: boolean) {
      intersect(
        [{ target, isIntersecting: value } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    },
    reduce() {
      preference.matches = true;
      (preference.addEventListener.mock.calls[0]![1] as () => void)();
    },
  };
}
describe("setup transition playback", () => {
  it("distinguishes completion, suppression and cancellation and ignores stale frames", async () => {
    const f = fixture();
    const { finished: replaced } = f.clock.start(1, 2);
    const stale = [...f.scheduled.values()][0]!;
    const { finished: completed } = f.clock.start(2, 3);
    await expect(replaced).resolves.toBe("cancelled");
    stale(8000);
    expect(f.clock.frame.value.time).toBe(0);
    f.tick(0);
    f.tick(2700);
    await expect(completed).resolves.toBe("completed");
    const { finished: skipped } = f.clock.start(3, 4);
    f.reduce();
    await expect(skipped).resolves.toBe("skipped");
    f.preference.matches = false;
    const { finished: removed } = f.clock.start(1, 2);
    f.wrapper.unmount();
    await expect(removed).resolves.toBe("cancelled");
    expect(f.scheduled.size).toBe(0);
  });
  it("renders panel boundaries even when frames arrive after both handoffs", async () => {
    const f = fixture();
    const { finished } = f.clock.start(0, 1, "step", [250, 2350]);
    f.tick(0);
    f.tick(9000);
    expect(f.clock.frame.value.panelOpacity).toBe(0);
    expect(f.clock.frame.value.incoming).toBe(false);
    f.tick(18000);
    expect(f.clock.frame.value.panelOpacity).toBe(0);
    expect(f.clock.frame.value.incoming).toBe(true);
    f.tick(27000);
    await expect(finished).resolves.toBe("completed");
    f.clock.start(1, 2);
    f.tick(30000);
    f.tick(40000);
    expect(f.clock.active.value).toBe(false);
  });
  it("uses the same finite clock for the opening and the next setup step", () => {
    const f = fixture();
    f.clock.startOpening();
    expect(f.clock.opening.value?.time).toBe(0);
    expect(f.scheduled.size).toBe(1);
    f.tick(0);
    f.tick(370);
    expect(f.clock.opening.value?.art.paperBits).toHaveLength(7);
    f.tick(openingDuration);
    expect(f.clock.active.value).toBe(false);
    expect(f.clock.opening.value?.time).toBe(openingDuration);
    expect(f.scheduled.size).toBe(0);
    f.clock.start(0, 1);
    expect(f.clock.opening.value).toBeUndefined();
    expect(f.scheduled.size).toBe(1);
    f.tick(3000);
    f.tick(3000 + transitionDuration);
    expect(f.clock.frame.value.time).toBe(transitionDuration);
    expect(f.scheduled.size).toBe(0);
  });
  it("seeks the opening independently, cancels playback on removal and honors reduced motion", async () => {
    const f = fixture();
    f.clock.startOpening();
    f.inspectedOpening.value = 370;
    await nextTick();
    expect(f.scheduled.size).toBe(0);
    const frame = f.clock.opening.value;
    f.inspectedOpening.value = 80;
    await nextTick();
    expect(f.clock.opening.value?.time).toBe(80);
    f.inspectedOpening.value = 370;
    await nextTick();
    expect(f.clock.opening.value).toEqual(frame);
    f.reduce();
    expect(f.clock.opening.value?.time).toBe(openingDuration);
    expect(f.clock.opening.value?.art.paperBits).toEqual([]);
    f.wrapper.unmount();
    expect(f.scheduled.size).toBe(0);
  });
  it("suspends an opening offscreen and behind dialogs without catching up", async () => {
    const f = fixture();
    f.clock.startOpening();
    f.tick(0);
    f.tick(100);
    f.visible(false);
    expect(f.scheduled.size).toBe(0);
    f.visible(true);
    f.tick(9000);
    f.tick(9100);
    expect(f.clock.opening.value?.time).toBe(200);
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    await nextTick();
    expect(f.scheduled.size).toBe(0);
    dialog.remove();
    await nextTick();
    f.tick(15000);
    f.tick(15100);
    expect(f.clock.opening.value?.time).toBe(300);
    f.paused.value = true;
    await nextTick();
    expect(f.clock.opening.value?.time).toBe(openingDuration);
    expect(f.scheduled.size).toBe(0);
    f.clock.startOpening();
    expect(f.clock.active.value).toBe(false);
  });
  it("advances one shared clock, holds its final pose and disposes its observers", () => {
    const f = fixture();
    f.clock.start(0, 1);
    f.tick(100);
    f.tick(220);
    expect(f.clock.frame.value.time).toBe(120);
    f.tick(100 + transitionDuration);
    expect(f.clock.frame.value.time).toBe(transitionDuration);
    expect(f.scheduled.size).toBe(0);
    f.wrapper.unmount();
    expect(f.disconnect).toHaveBeenCalled();
    expect(f.preference.removeEventListener).toHaveBeenCalled();
  });
  it("suspends offscreen and hidden time rather than catching up on return", () => {
    const f = fixture();
    f.clock.start(0, 1);
    f.tick(0);
    f.tick(100);
    f.visible(false);
    expect(f.scheduled.size).toBe(0);
    f.visible(true);
    f.tick(9000);
    f.tick(9100);
    expect(f.clock.frame.value.time).toBe(200);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.scheduled.size).toBe(0);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    f.tick(20000);
    f.tick(20100);
    expect(f.clock.frame.value.time).toBe(300);
  });
  it("suspends behind a dialog and keeps inspection independent of playback", async () => {
    const f = fixture();
    f.clock.start(0, 1);
    f.tick(0);
    f.tick(100);
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    await nextTick();
    expect(f.scheduled.size).toBe(0);
    dialog.remove();
    await nextTick();
    f.tick(10000);
    f.tick(10100);
    expect(f.clock.frame.value.time).toBe(200);
    f.inspected.value = 800;
    await nextTick();
    expect(f.scheduled.size).toBe(0);
    expect(f.clock.frame.value.time).toBe(800);
    f.inspected.value = 40;
    await nextTick();
    expect(f.clock.frame.value.time).toBe(40);
  });
  it("settles immediately with reduced motion or a user motion pause", async () => {
    const f = fixture();
    f.clock.start(0, 1);
    f.tick(0);
    f.tick(100);
    f.reduce();
    expect(f.clock.active.value).toBe(false);
    expect(f.scheduled.size).toBe(0);
    f.clock.start(1, 2);
    expect(f.clock.frame.value.time).toBe(transitionDuration);
    f.paused.value = true;
    await nextTick();
    expect(f.clock.active.value).toBe(false);
  });
});
