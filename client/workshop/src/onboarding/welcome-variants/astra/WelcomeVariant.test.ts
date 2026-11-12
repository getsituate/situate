import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import WelcomeVariant from "./WelcomeVariant.vue";
import { durationMs } from "./timeline";

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(
  props: { paused: boolean; timeMs?: number } = { paused: false },
  reduced = false,
) {
  let now = 0;
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const preference = {
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => preference);
  let intersection: IntersectionObserverCallback;
  let observed: Element;
  const disconnected = vi.fn();
  const resizeDisconnected = vi.fn();
  let measure: () => void;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        intersection = cb;
      }
      observe(element: Element) {
        observed = element;
      }
      disconnect = disconnected;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        measure = cb;
      }
      observe() {}
      disconnect = resizeDisconnected;
    },
  );
  const wrapper = mount(WelcomeVariant, { props, attachTo: document.body });
  mounted.push(wrapper);
  const visible = (isIntersecting: boolean) =>
    intersection(
      [{ target: observed, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  const advance = async (ms: number) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(now));
    await nextTick();
  };
  const motion = async (matches: boolean) => {
    preference.matches = matches;
    (preference.addEventListener.mock.calls[0]![1] as () => void)();
    await nextTick();
  };
  return {
    wrapper,
    frames,
    visible,
    advance,
    motion,
    preference,
    disconnected,
    resizeDisconnected,
    drawing: () => wrapper.get("svg.world").html(),
    resize: async () => {
      measure();
      await nextTick();
    },
  };
}

describe("unfolding place lifecycle", () => {
  it("finishes once after the full hold, without scheduling an ambient loop", async () => {
    const f = fixture();
    expect(f.frames.size).toBe(0);
    f.visible(true);
    await f.advance(0);
    await f.advance(9000);
    expect(f.wrapper.emitted("finished")).toBeUndefined();
    const held = f.drawing();
    await f.advance(durationMs - 9000);
    expect(f.drawing()).toBe(held);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    expect(f.frames.size).toBe(0);
    f.visible(false);
    f.visible(true);
    await f.wrapper.setProps({ paused: true });
    await f.wrapper.setProps({ paused: false });
    await f.wrapper.get(".skip").trigger("click");
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    expect(f.frames.size).toBe(0);
  });
  it("seeks backwards with no stale artwork, autonomous clock or completion", async () => {
    const f = fixture({ paused: false, timeMs: 6000 });
    f.visible(true);
    const six = f.drawing();
    await f.wrapper.setProps({ timeMs: 2000 });
    expect(f.drawing()).not.toBe(six);
    await f.wrapper.setProps({ timeMs: 6000 });
    expect(f.drawing()).toBe(six);
    await f.wrapper.setProps({ timeMs: durationMs });
    await f.advance(40_000);
    await f.motion(true);
    expect(f.frames.size).toBe(0);
    expect(f.wrapper.emitted("finished")).toBeUndefined();
    await f.wrapper.get(".skip").trigger("click");
    await f.wrapper.get(".skip").trigger("click");
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
  });
  it("lets the parent pause all channels and resumes without a time jump", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(3600);
    await f.wrapper.get(".playback button").trigger("click");
    expect(f.wrapper.emitted("toggle")).toHaveLength(1);
    await f.wrapper.setProps({ paused: true });
    expect(f.wrapper.get(".playback button").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(f.wrapper.text()).toContain("Resume motion");
    const paused = f.drawing();
    await f.advance(80_000);
    expect(f.drawing()).toBe(paused);
    expect(f.frames.size).toBe(0);
    await f.wrapper.setProps({ paused: false });
    await f.advance(0);
    expect(f.drawing()).toBe(paused);
    await f.advance(500);
    expect(f.drawing()).not.toBe(paused);
  });
  it("suspends hidden and offscreen time, preserving an explicit pause", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(1800);
    const before = f.drawing();
    f.visible(false);
    await f.advance(50_000);
    f.visible(true);
    await f.advance(0);
    expect(f.drawing()).toBe(before);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.frames.size).toBe(0);
    await f.advance(50_000);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await f.advance(0);
    expect(f.drawing()).toBe(before);
    await f.wrapper.setProps({ paused: true });
    f.visible(false);
    f.visible(true);
    expect(f.frames.size).toBe(0);
  });
  it("bypasses motion immediately on load and on live preference changes", async () => {
    const still = fixture({ paused: true }, true);
    await nextTick();
    expect(still.wrapper.attributes("data-time")).toBe(String(durationMs));
    expect(still.wrapper.emitted("finished")).toHaveLength(1);
    expect(still.frames.size).toBe(0);
    const live = fixture();
    live.visible(true);
    await live.advance(0);
    await live.advance(2000);
    await live.motion(true);
    expect(live.wrapper.emitted("finished")).toHaveLength(1);
    expect(live.frames.size).toBe(0);
    await live.motion(false);
    expect(live.frames.size).toBe(0);
  });
  it("skips immediately while paused and keeps resize separate from reset", async () => {
    const f = fixture({ paused: true });
    await f.wrapper.setProps({ timeMs: 5200 });
    vi.spyOn(f.wrapper.element, "getBoundingClientRect").mockReturnValue({
      width: 390,
      height: 844,
    } as DOMRect);
    await f.resize();
    expect(f.wrapper.attributes("data-time")).toBe("5200");
    expect(f.wrapper.get("svg.world").attributes("viewBox")).toBe(
      "0 0 390 844",
    );
    await f.wrapper.get(".skip").trigger("click");
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    const reset = fixture({ paused: true });
    expect(reset.wrapper.attributes("data-time")).toBe("0");
    expect(reset.wrapper.emitted("finished")).toBeUndefined();
  });
  it("cancels scheduled work and releases all listeners and observers on unmount", async () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    expect(f.frames.size).toBe(1);
    f.wrapper.unmount();
    mounted.splice(mounted.indexOf(f.wrapper), 1);
    expect(f.frames.size).toBe(0);
    expect(f.disconnected).toHaveBeenCalledOnce();
    expect(f.resizeDisconnected).toHaveBeenCalledOnce();
    expect(f.preference.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(remove).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    f.visible(true);
    expect(f.frames.size).toBe(0);
  });
});
