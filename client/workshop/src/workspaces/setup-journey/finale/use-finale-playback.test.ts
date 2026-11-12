import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finaleDuration, newFinale } from "./score";
import { useFinalePlayback } from "./use-finale-playback";
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(duration = finaleDuration) {
  let id = 0,
    target: Element,
    intersect: IntersectionObserverCallback;
  const scheduled = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    scheduled.set(++id, fn);
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
  const state = ref(newFinale()),
    disabled = ref(false),
    finished = vi.fn();
  let clock!: ReturnType<typeof useFinalePlayback>;
  const wrapper = mount(
    defineComponent({
      setup() {
        const root = ref<HTMLElement>();
        clock = useFinalePlayback(
          root,
          () => state.value,
          () => disabled.value,
          finished,
          duration,
        );
        return () => h("div", { ref: root });
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  return {
    state,
    disabled,
    finished,
    clock,
    wrapper,
    preference,
    scheduled,
    disconnect,
    tick(time: number) {
      for (const [id, callback] of [...scheduled]) {
        scheduled.delete(id);
        callback(time);
      }
    },
    async start() {
      state.value.status = "playing";
      await nextTick();
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
describe("celebration playback", () => {
  it("supports a shorter handoff without changing the default finale duration", async () => {
    const f = fixture(1600);
    await f.start();
    f.tick(0);
    f.tick(1599);
    expect(f.finished).not.toHaveBeenCalled();
    f.tick(1600);
    expect(f.finished).toHaveBeenCalledTimes(1);
    expect(f.scheduled.size).toBe(0);
  });
  it("runs one finite clock and finishes only once", async () => {
    const f = fixture();
    expect(f.scheduled.size).toBe(0);
    await f.start();
    f.tick(100);
    f.tick(500);
    expect(f.clock.time.value).toBe(400);
    expect(f.scheduled.size).toBe(1);
    f.tick(100 + finaleDuration);
    expect(f.finished).toHaveBeenCalledTimes(1);
    expect(f.clock.time.value).toBe(finaleDuration);
    expect(f.scheduled.size).toBe(0);
    f.clock.finish();
    expect(f.finished).toHaveBeenCalledTimes(1);
  });
  it("keeps inspection stationary, seeks backward and resets replay", async () => {
    const f = fixture();
    await f.start();
    f.tick(0);
    f.tick(100);
    f.state.value.timeMs = 5800;
    await nextTick();
    expect(f.clock.time.value).toBe(5800);
    expect(f.finished).not.toHaveBeenCalled();
    f.state.value.timeMs = 1750;
    await nextTick();
    expect(f.clock.time.value).toBe(1750);
    expect(f.scheduled.size).toBe(0);
    f.state.value = { ...f.state.value, timeMs: null, run: 1 };
    await nextTick();
    expect(f.clock.time.value).toBe(0);
    expect(f.scheduled.size).toBe(1);
    f.tick(9000);
    f.tick(9100);
    expect(f.clock.time.value).toBe(100);
  });
  it("pauses without counting hidden or offscreen time", async () => {
    const f = fixture();
    await f.start();
    f.tick(0);
    f.tick(100);
    f.visible(false);
    expect(f.scheduled.size).toBe(0);
    f.visible(true);
    f.tick(10000);
    f.tick(10100);
    expect(f.clock.time.value).toBe(200);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.scheduled.size).toBe(0);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    f.tick(20000);
    f.tick(20100);
    expect(f.clock.time.value).toBe(300);
    f.state.value.paused = true;
    await nextTick();
    expect(f.scheduled.size).toBe(0);
    f.state.value.paused = false;
    await nextTick();
    f.tick(30000);
    f.tick(30100);
    expect(f.clock.time.value).toBe(400);
    expect(f.finished).not.toHaveBeenCalled();
  });
  it("suspends behind dialogs and resumes from the same frame", async () => {
    const f = fixture();
    await f.start();
    f.tick(0);
    f.tick(100);
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    await nextTick();
    expect(f.scheduled.size).toBe(0);
    dialog.remove();
    await nextTick();
    f.tick(30000);
    f.tick(30100);
    expect(f.clock.time.value).toBe(200);
  });
  it.each(["preference", "disabled"])(
    "settles immediately with %s motion reduction",
    async (mode) => {
      const f = fixture();
      await f.start();
      f.tick(0);
      f.tick(100);
      if (mode === "preference") f.reduce();
      else {
        f.disabled.value = true;
        await nextTick();
      }
      expect(f.clock.time.value).toBe(finaleDuration);
      expect(f.finished).toHaveBeenCalledTimes(1);
      expect(f.scheduled.size).toBe(0);
    },
  );
  it("allows skipping while inspecting and cleans up without completing on unmount", async () => {
    const f = fixture();
    await f.start();
    f.state.value.timeMs = 1200;
    await nextTick();
    f.clock.finish();
    expect(f.finished).toHaveBeenCalledTimes(1);
    const other = fixture();
    await other.start();
    other.tick(0);
    other.tick(100);
    other.wrapper.unmount();
    expect(other.finished).not.toHaveBeenCalled();
    expect(other.scheduled.size).toBe(0);
    expect(other.disconnect).toHaveBeenCalled();
    expect(other.preference.removeEventListener).toHaveBeenCalled();
  });
});
