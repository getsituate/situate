import { mount, enableAutoUnmount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import SetupFinale from "./SetupFinale.vue";
import SetupFrame from "./SetupFrame.vue";

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function playback(ready = true, reduced = false) {
  let serial = 0;
  let now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const preference = {
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => preference);
  const wrapper = mount(SetupFinale, {
    props: { workspaceName: "Garden", ready },
    attachTo: document.body,
  });
  const advance = async (ms: number) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
    await nextTick();
  };
  return { wrapper, frames, preference, advance };
}

test("finale never renders outgoing slots or step chrome, even at the first frame", async () => {
  const wrapper = mount(SetupFrame, {
    props: { step: 4, finaleTime: 0 },
    slots: {
      default: "<button>Old content</button>",
      actions: "<button>Old action</button>",
      aside: "<button>Old aside</button>",
    },
  });
  for (const finaleTime of [0, 200, 1750, 3800, 4420, 5000, 5800]) {
    await wrapper.setProps({ finaleTime });
    expect(
      wrapper.findAll(".frame-header, .setup-steps, .setup-panel, button"),
    ).toHaveLength(0);
    expect(wrapper.find(".finale-announcement").exists()).toBe(true);
  }
});

test("preparation suspends playback; pause and skip remain user controlled and finish only once", async () => {
  const f = playback(false);
  await nextTick();
  expect(f.frames.size).toBe(0);
  await f.wrapper.setProps({ ready: true });
  await f.advance(0);
  await f.advance(1750);
  await f.wrapper.get("button[aria-pressed]").trigger("click");
  expect(f.frames.size).toBe(0);
  await f.advance(10000);
  expect(f.wrapper.emitted("finished")).toBeUndefined();
  await f.wrapper.get(".finale-skip").trigger("click");
  await f.wrapper.get(".finale-skip").trigger("click");
  expect(f.wrapper.emitted("finished")).toHaveLength(1);
  expect(f.frames.size).toBe(0);
});

test("Skip requests entry even before preparation finishes, without replaying playback", async () => {
  const f = playback(false);
  await nextTick();
  await f.wrapper.get(".finale-skip").trigger("click");
  expect(f.wrapper.emitted("finished")).toHaveLength(1);
  await f.wrapper.setProps({ ready: true });
  await f.advance(10000);
  expect(f.wrapper.emitted("finished")).toHaveLength(1);
  expect(f.frames.size).toBe(0);
});

test("a ready finale finishes without further handoff signals", async () => {
  const f = playback();
  await nextTick();
  await f.advance(0);
  await f.advance(10000);
  expect(f.wrapper.emitted("finished")).toHaveLength(1);
  expect(f.frames.size).toBe(0);
});

test.each([false, true])(
  "reduced motion=%s and unmount cannot leave playback or delayed focus behind",
  async (reduced) => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const f = playback(true, reduced);
    f.wrapper.unmount();
    await nextTick();
    await f.advance(20000);
    expect(f.frames.size).toBe(0);
    expect(focus).not.toHaveBeenCalled();
    expect(f.preference.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(f.wrapper.emitted("finished")).toBeUndefined();
  },
);
