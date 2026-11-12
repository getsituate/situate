import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatGreeting from "./ChatGreeting.vue";
import { chooseGreeting } from "./greetings";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chat greetings", () => {
  it("chooses randomly and keeps a saved selection", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(chooseGreeting(undefined)).toBe("navigation.goodToSeeYou");
    random.mockReturnValue(0.99);
    expect(chooseGreeting(undefined)).toBe("chat.greetingSpace");
    expect(chooseGreeting("chat.greetingBegin")).toBe("chat.greetingBegin");
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("types the greeting while waving once, then stops when covered", async () => {
    let intersect!: IntersectionObserverCallback;
    let frame!: FrameRequestCallback;
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, finished: new Promise(() => {}) }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const original = Element.prototype.animate;
    Element.prototype.animate = animate as unknown as typeof original;
    const wrapper = mount(ChatGreeting, {
      props: { text: "Hello there.", active: true, covered: false },
    });
    try {
      const enter = () =>
        intersect(
          [
            {
              isIntersecting: true,
              intersectionRatio: 1,
            } as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
      enter();
      await nextTick();
      expect(animate).toHaveBeenCalledTimes(2);
      expect(wrapper.findAll(".unrevealed")).toHaveLength(12);
      frame(250);
      await nextTick();
      expect(wrapper.findAll(".unrevealed")).toHaveLength(9);
      expect(wrapper.get(".sr-only").text()).toBe("Hello there.");
      await wrapper.setProps({ covered: true });
      expect(wrapper.attributes("data-state")).toBe("done");
      expect(wrapper.findAll(".unrevealed")).toHaveLength(0);
      expect(cancel).toHaveBeenCalledTimes(2);
      await wrapper.setProps({ covered: false });
      enter();
      expect(animate).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
      if (original) Element.prototype.animate = original;
      else Reflect.deleteProperty(Element.prototype, "animate");
    }
  });

  it.each([true, false])(
    "shows complete text when motion is reduced or unavailable (%s)",
    async (reduced) => {
      vi.stubGlobal("matchMedia", () => ({
        matches: reduced,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      const wrapper = mount(ChatGreeting, {
        props: { text: "Where shall we begin?", active: true, covered: false },
      });
      await nextTick();
      expect(wrapper.attributes("data-state")).toBe("done");
      expect(wrapper.findAll(".unrevealed")).toHaveLength(0);
      expect(wrapper.get(".sr-only").text()).toBe("Where shall we begin?");
      wrapper.unmount();
    },
  );
});
