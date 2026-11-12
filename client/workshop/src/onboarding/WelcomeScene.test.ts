import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import WelcomeScene from "./WelcomeScene.vue";
import {
  welcomeAmbientDuration,
  welcomeIntroDuration,
  welcomeFrame,
  welcomeStillTime,
} from "./welcome-motion";

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(reduced = false, paused = false, finite = false) {
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
  const wrapper = mount(WelcomeScene, {
    props: { paused, finite },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  const visible = (isIntersecting: boolean) =>
    intersection(
      [{ target: observed, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  const advance = (milliseconds: number) => {
    now += milliseconds;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  };
  const motion = (matches: boolean) => {
    preference.matches = matches;
    (preference.addEventListener.mock.calls[0]![1] as () => void)();
  };
  const drawing = () => wrapper.get("svg").html();
  return {
    wrapper,
    visible,
    advance,
    motion,
    drawing,
    frames,
    disconnect,
    preference,
  };
}

describe("welcome scene", () => {
  it("finishes a finite welcome once and stops its clock", () => {
    const f = fixture(false, false, true);
    f.visible(true);
    f.advance(0);
    f.advance(welcomeStillTime);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    expect(f.frames.size).toBe(0);
    f.visible(false);
    f.visible(true);
    expect(f.frames.size).toBe(0);
  });
  it("offers the entry immediately with reduced motion", () => {
    const f = fixture(true, false, true);
    expect(f.wrapper.emitted("finished")).toHaveLength(1);
    expect(f.frames.size).toBe(0);
  });
  it("stages depth once, then loops only the three ribbon planes", () => {
    expect(welcomeFrame(700).layers.book.opacity).toBeGreaterThan(0);
    expect(welcomeFrame(700).layers.leaf.opacity).toBe(0);
    expect(welcomeFrame(2000).actor.wave).toBe(1);
    const settled = welcomeFrame(welcomeStillTime);
    const later = welcomeFrame(welcomeStillTime + 3500);
    expect(settled.actor.wave).toBe(0);
    expect(later.actor).toEqual(settled.actor);
    expect(
      Object.values(settled.layers).every((layer) => layer.opacity === 1),
    ).toBe(true);
    for (const name of [
      "bend",
      "book",
      "page",
      "leaf",
      "card",
      "burst",
    ] as const) {
      expect(later.layers[name]).toEqual(settled.layers[name]);
    }
    for (const name of ["back", "middle", "front"] as const) {
      expect(later.layers[name].transform).not.toBe(
        settled.layers[name].transform,
      );
    }
    expect(welcomeFrame(welcomeStillTime + welcomeAmbientDuration)).toEqual(
      settled,
    );
    expect(welcomeFrame(welcomeIntroDuration).actor).toEqual(settled.actor);
  });
  it("shows the complete composition when remounted with an explicit pause", () => {
    const f = fixture(false, true);
    f.visible(true);
    expect(f.frames.size).toBe(0);
    expect(
      f.wrapper
        .findAll("[data-welcome-layer]")
        .every((layer) => layer.attributes("opacity") === "1"),
    ).toBe(true);
    expect(f.wrapper.findAll("image")).toHaveLength(4);
  });
  it("loops visible artwork and exposes the character as the only playback control", async () => {
    const f = fixture();
    expect(f.frames.size).toBe(0);
    f.visible(true);
    f.advance(0);
    const initial = f.drawing();
    f.advance(3000);
    expect(f.drawing()).not.toBe(initial);
    f.advance(welcomeStillTime - 3000);
    const settled = f.drawing();
    f.advance(welcomeAmbientDuration);
    expect(f.drawing()).toBe(settled);
    expect(f.wrapper.findAll("button")).toHaveLength(1);
    expect(f.wrapper.attributes("aria-label")).toBe("Pause Bend’s welcome");
    await f.wrapper.trigger("click");
    expect(f.wrapper.emitted("toggle")).toHaveLength(1);
    await f.wrapper.setProps({ paused: true });
    expect(f.wrapper.attributes("aria-label")).toBe("Resume Bend’s welcome");
    expect(f.frames.size).toBe(0);
    f.advance(90000);
    expect(f.drawing()).toBe(settled);
    await f.wrapper.setProps({ paused: false });
    f.advance(0);
    expect(f.drawing()).toBe(settled);
    f.advance(300);
    expect(f.drawing()).not.toBe(settled);
  });
  it("freezes elapsed time while offscreen or hidden and releases its observers", () => {
    const f = fixture();
    f.visible(true);
    f.advance(0);
    f.advance(2500);
    const pose = f.drawing();
    f.visible(false);
    expect(f.frames.size).toBe(0);
    f.advance(60000);
    f.visible(true);
    f.advance(0);
    expect(f.drawing()).toBe(pose);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.frames.size).toBe(0);
    f.advance(60000);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    f.advance(0);
    expect(f.drawing()).toBe(pose);
    const pending = [...f.frames.values()];
    f.wrapper.unmount();
    expect(() => pending.forEach((callback) => callback(120000))).not.toThrow();
    expect(f.frames.size).toBe(0);
    expect(f.disconnect).toHaveBeenCalled();
    expect(f.preference.removeEventListener).toHaveBeenCalled();
  });
  it("shows a static invitation with reduced motion and keeps explicit pause choices", async () => {
    const f = fixture(true);
    f.visible(true);
    await f.wrapper.vm.$nextTick();
    expect(f.frames.size).toBe(0);
    expect(f.wrapper.get("button").element.disabled).toBe(true);
    const still = f.drawing();
    f.advance(50000);
    expect(f.drawing()).toBe(still);
    f.motion(false);
    await f.wrapper.vm.$nextTick();
    expect(f.wrapper.get("button").element.disabled).toBe(false);
    f.advance(0);
    f.advance(6000);
    expect(f.drawing()).not.toBe(still);
    f.motion(true);
    expect(f.frames.size).toBe(0);
    expect(f.drawing()).toBe(still);
    await f.wrapper.setProps({ paused: true });
    f.motion(false);
    expect(f.frames.size).toBe(0);
  });
  it("suspends for a covering dialog without overriding an explicit pause", async () => {
    const f = fixture();
    f.visible(true);
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    dialog.setAttribute("open", "");
    await Promise.resolve();
    expect(f.frames.size).toBe(0);
    dialog.removeAttribute("open");
    await Promise.resolve();
    expect(f.frames.size).toBe(1);
    await f.wrapper.setProps({ paused: true });
    dialog.setAttribute("open", "");
    await Promise.resolve();
    dialog.remove();
    await Promise.resolve();
    expect(f.frames.size).toBe(0);
  });
});
