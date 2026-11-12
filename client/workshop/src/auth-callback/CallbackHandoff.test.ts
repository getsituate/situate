import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import CallbackHandoff from "./CallbackHandoff.vue";
import { handoffDuration } from "./score";

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(reduced = false) {
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
  let notify: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        notify = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const wrapper = mount(CallbackHandoff, {
    props: { replay: 0, paused: false, timeMs: null, still: false },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  const visible = (value: boolean) =>
    notify(
      [{ isIntersecting: value } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  const advance = (ms: number) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(now));
  };
  const motion = (value: boolean) => {
    preference.matches = value;
    (preference.addEventListener.mock.calls[0]![1] as () => void)();
  };
  return { wrapper, frames, visible, advance, motion, preference, disconnect };
}
it("settles once, does not restart on visibility changes, and replays explicitly", async () => {
  const f = fixture();
  f.visible(true);
  f.advance(0);
  f.advance(handoffDuration);
  expect(f.wrapper.attributes("data-time")).toBe(String(handoffDuration));
  expect(f.wrapper.emitted("frame")?.at(-1)).toEqual([handoffDuration]);
  expect(f.frames.size).toBe(0);
  const end = f.wrapper.html();
  f.visible(false);
  f.visible(true);
  f.advance(90000);
  expect(f.wrapper.html()).toBe(end);
  await f.wrapper.setProps({ replay: 1 });
  f.advance(0);
  f.advance(400);
  expect(f.wrapper.attributes("data-time")).toBe("400");
});
it("suspends hidden and offscreen time and disposes all playback resources", () => {
  const f = fixture();
  f.visible(true);
  f.advance(0);
  f.advance(450);
  f.visible(false);
  f.advance(90000);
  f.visible(true);
  f.advance(0);
  expect(f.wrapper.attributes("data-time")).toBe("450");
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(f.frames.size).toBe(0);
  f.advance(90000);
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  f.advance(0);
  expect(f.wrapper.attributes("data-time")).toBe("450");
  f.wrapper.unmount();
  mounted.pop();
  expect(f.frames.size).toBe(0);
  expect(f.disconnect).toHaveBeenCalled();
  expect(f.preference.removeEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
});
it("uses the complete still for startup and live reduced motion, including replay", async () => {
  const f = fixture(true);
  f.visible(true);
  expect(f.frames.size).toBe(0);
  expect(f.wrapper.attributes("data-time")).toBe(String(handoffDuration));
  await f.wrapper.setProps({ replay: 1 });
  expect(f.wrapper.attributes("data-time")).toBe(String(handoffDuration));
  f.motion(false);
  expect(f.frames.size).toBe(0);
  await f.wrapper.setProps({ replay: 2 });
  f.advance(0);
  f.advance(450);
  f.motion(true);
  expect(f.frames.size).toBe(0);
  expect(f.wrapper.attributes("data-time")).toBe(String(handoffDuration));
});
it("seeks in either direction, pauses, and resumes without accumulating transforms", async () => {
  const f = fixture();
  f.visible(true);
  await f.wrapper.setProps({ timeMs: 900, paused: true });
  const pose = f.wrapper.html();
  await f.wrapper.setProps({ timeMs: 2200 });
  await f.wrapper.setProps({ timeMs: 900 });
  expect(f.wrapper.html()).toBe(pose);
  expect(f.frames.size).toBe(0);
  await f.wrapper.setProps({ paused: false });
  f.advance(0);
  f.advance(100);
  expect(f.wrapper.attributes("data-time")).toBe("1000");
});
