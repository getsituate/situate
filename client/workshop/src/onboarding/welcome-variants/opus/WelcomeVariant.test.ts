import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import WelcomeVariant from "./WelcomeVariant.vue";
import { welcomeCopy } from "./content";
import { durationMs, stillMs } from "./timeline";

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(
  props: { paused?: boolean; timeMs?: number } = {},
  reduced = false,
) {
  let now = 0;
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const preference = {
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => preference);
  let intersection: IntersectionObserverCallback = () => {};
  let observed: Element | undefined;
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
  let resize: ResizeObserverCallback = () => {};
  const resizeDisconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = resizeDisconnect;
    },
  );
  const wrapper = mount(WelcomeVariant, {
    props: { paused: false, ...props },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  const visible = (isIntersecting: boolean) =>
    intersection(
      [{ target: observed!, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  const advance = async (milliseconds: number, step = 50) => {
    let left = milliseconds;
    do {
      const delta = Math.min(step, left);
      now += delta;
      left -= delta;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    } while (left > 0);
    await wrapper.vm.$nextTick();
  };
  const resizeTo = async (width: number, height: number) => {
    resize(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    await wrapper.vm.$nextTick();
  };
  const motion = (matches: boolean) => {
    preference.matches = matches;
    (preference.addEventListener.mock.calls[0]![1] as () => void)();
  };
  const drawing = () => wrapper.get("svg").html();
  const button = (name: string) =>
    wrapper.findAll("button").find((item) => item.text() === name);
  return {
    wrapper,
    frames,
    visible,
    advance,
    resizeTo,
    motion,
    drawing,
    button,
    disconnect,
    resizeDisconnect,
    preference,
  };
}

describe("fullscreen welcome variant", () => {
  it("plays once while visible, then finishes exactly once and stops", async () => {
    const f = fixture();
    expect(f.frames.size).toBe(0);
    f.visible(true);
    await f.advance(0);
    const opening = f.drawing();
    await f.advance(3000);
    expect(f.drawing()).not.toBe(opening);
    expect(f.wrapper.emitted("finished")).toBeUndefined();
    await f.advance(durationMs);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    expect(f.frames.size).toBe(0);
    const ending = f.drawing();
    f.visible(false);
    f.visible(true);
    await f.advance(5000);
    expect(f.frames.size).toBe(0);
    expect(f.drawing()).toBe(ending);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
  });

  it("stops the clock while paused and resumes without a jump", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(2500);
    await f.wrapper.setProps({ paused: true });
    expect(f.frames.size).toBe(0);
    const held = f.drawing();
    await f.advance(60000);
    expect(f.drawing()).toBe(held);
    expect(f.button(welcomeCopy.resume)).toBeDefined();
    await f.button(welcomeCopy.resume)!.trigger("click");
    expect(f.wrapper.emitted("toggle")).toHaveLength(1);
    await f.wrapper.setProps({ paused: false });
    await f.advance(0);
    expect(f.drawing()).toBe(held);
    await f.advance(durationMs - 2500 - 200);
    expect(f.wrapper.emitted("finished")).toBeUndefined();
    await f.advance(400);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
  });

  it("suspends while offscreen, hidden or covered by a dialog", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(1500);
    const pose = f.drawing();
    f.visible(false);
    expect(f.frames.size).toBe(0);
    await f.advance(60000);
    f.visible(true);
    await f.advance(0);
    expect(f.drawing()).toBe(pose);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.frames.size).toBe(0);
    await f.advance(60000);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await f.advance(0);
    expect(f.drawing()).toBe(pose);
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    dialog.setAttribute("open", "");
    await Promise.resolve();
    expect(f.frames.size).toBe(0);
    dialog.remove();
    await Promise.resolve();
    expect(f.frames.size).toBe(1);
  });

  it("limits a stalled frame instead of skipping ahead", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(durationMs, durationMs);
    expect(f.wrapper.emitted("finished")).toBeUndefined();
  });

  it("goes straight on with reduced motion and shows the still lockup", async () => {
    const f = fixture({}, true);
    await f.wrapper.vm.$nextTick();
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    expect(f.frames.size).toBe(0);
    expect(f.button(welcomeCopy.pause)).toBeUndefined();
    const still = mount(WelcomeVariant, {
      props: { paused: false, timeMs: stillMs },
    });
    mounted.push(still);
    for (const part of [".wordmark", ".sheet", ".tagline"])
      expect(f.wrapper.get(part).html()).toBe(still.get(part).html());
    expect(f.wrapper.get(".tagline").isVisible()).toBe(true);
  });

  it("stops and finishes once when reduced motion is enabled during playback", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(2000);
    f.motion(true);
    await f.wrapper.vm.$nextTick();
    expect(f.frames.size).toBe(0);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    f.motion(false);
    await f.advance(1000);
    expect(f.frames.size).toBe(0);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
  });

  it("renders a requested frame without playback, and seeks without residue", async () => {
    const f = fixture({ timeMs: 9600 });
    f.visible(true);
    await f.advance(0);
    expect(f.frames.size).toBe(0);
    const late = f.drawing();
    await f.wrapper.setProps({ timeMs: 1200 });
    const early = f.drawing();
    expect(early).not.toBe(late);
    await f.wrapper.setProps({ timeMs: 9600 });
    expect(f.drawing()).toBe(late);
    await f.wrapper.setProps({ timeMs: durationMs });
    await f.advance(30000);
    expect(f.wrapper.emitted("finished")).toBeUndefined();
    await f.button(welcomeCopy.skip)!.trigger("click");
    await f.button(welcomeCopy.skip)!.trigger("click");
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
  });

  it("skips immediately and only once", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(400);
    await f.button(welcomeCopy.skip)!.trigger("click");
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    expect(f.frames.size).toBe(0);
    await f.advance(durationMs);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
  });

  it("recomposes on resize without restarting", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    await f.advance(8000);
    await f.resizeTo(390, 844);
    expect(f.wrapper.get("svg").attributes("viewBox")).toBe("0 0 390 844");
    await f.advance(durationMs - 8000 + 100);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
  });

  it("announces one static description instead of moving captions", () => {
    const f = fixture();
    expect(f.wrapper.attributes("aria-label")).toBe(welcomeCopy.region);
    expect(f.wrapper.get(".captions").attributes("aria-hidden")).toBe("true");
    expect(f.wrapper.get("svg").attributes("aria-hidden")).toBe("true");
    expect(f.wrapper.find(".visually-hidden").text()).toBe(
      welcomeCopy.description,
    );
    expect(f.wrapper.find("[aria-live]").exists()).toBe(false);
  });

  it("releases its clock, observers and listeners on unmount", async () => {
    const f = fixture();
    f.visible(true);
    await f.advance(0);
    const pending = [...f.frames.values()];
    const removed = vi.spyOn(document, "removeEventListener");
    f.wrapper.unmount();
    mounted.splice(mounted.indexOf(f.wrapper), 1);
    expect(f.frames.size).toBe(0);
    expect(() => pending.forEach((callback) => callback(99999))).not.toThrow();
    expect(f.frames.size).toBe(0);
    expect(f.disconnect).toHaveBeenCalled();
    expect(f.resizeDisconnect).toHaveBeenCalled();
    expect(f.preference.removeEventListener).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});
