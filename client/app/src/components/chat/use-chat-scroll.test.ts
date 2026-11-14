import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { ref, shallowRef } from "vue";
import { useChatScroll } from "./use-chat-scroll";

enableAutoUnmount(afterEach);
const observers: {
  notify: () => void;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  observers.length = 0;
  frames.clear();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
      constructor(callback: () => void) {
        observers.push({ notify: callback, disconnect: this.disconnect });
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
function paint() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}
function resize() {
  for (const observer of observers) observer.notify();
  paint();
}
async function view(
  initialTop?: number,
  initialHeight = 1000,
  wholePixelScroll = false,
) {
  const viewport = shallowRef<HTMLElement | null>(null);
  const content = shallowRef<HTMLElement | null>(null);
  const visible = ref(true);
  const changed = vi.fn();
  let control!: ReturnType<typeof useChatScroll>;
  const wrapper = mount({
    setup() {
      control = useChatScroll(viewport, content, visible, initialTop, changed);
      return () => null;
    },
  });
  const element = document.createElement("div");
  const body = document.createElement("div");
  body.innerHTML =
    '<div class="messages"><article><details><summary>Read notes</summary></details></article></div>';
  element.append(body);
  const dimensions = {
    height: 200,
    width: 640,
    contentHeight: initialHeight,
    anchorTop: 100,
  };
  let top = 0;
  Object.defineProperties(element, {
    clientHeight: { get: () => dimensions.height },
    clientWidth: { get: () => dimensions.width },
    scrollHeight: { get: () => dimensions.contentHeight },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(
          0,
          Math.min(
            wholePixelScroll ? Math.trunc(value) : value,
            dimensions.contentHeight - dimensions.height,
          ),
        );
      },
    },
  });
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, dimensions.width, dimensions.height),
  );
  vi.spyOn(
    body.querySelector("article")!,
    "getBoundingClientRect",
  ).mockImplementation(
    () =>
      new DOMRect(
        0,
        dimensions.anchorTop - top,
        dimensions.width,
        dimensions.contentHeight,
      ),
  );
  element.addEventListener("click", control.inspect, true);
  viewport.value = element;
  content.value = body;
  await flushPromises();
  function move(position: number) {
    element.scrollTop = position;
    control.capture();
  }
  return {
    wrapper,
    control,
    element,
    dimensions,
    visible,
    changed,
    move,
    body,
  };
}

test("a new view starts at the end and follows growth beyond the old end range", async () => {
  const chat = await view();
  expect(chat.element.scrollTop).toBe(800);
  chat.dimensions.contentHeight = 1800;
  resize();
  expect(chat.element.scrollTop).toBe(1600);
  chat.control.capture();
  chat.dimensions.contentHeight = 2400;
  resize();
  expect(chat.element.scrollTop).toBe(2200);
});

test.each([47, 48, 49])(
  "the end range includes 48 pixels (gap=%s)",
  async (gap) => {
    const chat = await view();
    chat.move(800 - gap);
    expect(chat.control.awayFromEnd.value).toBe(gap > 48);
    chat.dimensions.contentHeight = 1400;
    resize();
    expect(chat.element.scrollTop).toBe(gap <= 48 ? 1200 : 751);
  },
);

test("views of the same content follow independently and restore their own positions", async () => {
  const reading = await view(100);
  const following = await view(800);
  reading.dimensions.contentHeight = following.dimensions.contentHeight = 1600;
  resize();
  expect(reading.element.scrollTop).toBe(100);
  expect(reading.control.awayFromEnd.value).toBe(true);
  expect(following.element.scrollTop).toBe(1400);
  expect(following.control.awayFromEnd.value).toBe(false);
  expect(reading.changed).toHaveBeenLastCalledWith(100);
  expect(following.changed).toHaveBeenLastCalledWith(1400);
  reading.move(1400);
  reading.dimensions.contentHeight = 2000;
  resize();
  expect(reading.element.scrollTop).toBe(1800);
});

test("saved positions wait for delayed content instead of becoming a new end position", async () => {
  const chat = await view(500, 100);
  expect(chat.element.scrollTop).toBe(0);
  expect(chat.changed).toHaveBeenLastCalledWith(500);
  chat.dimensions.contentHeight = 1000;
  resize();
  expect(chat.element.scrollTop).toBe(500);
  chat.dimensions.contentHeight = 1500;
  resize();
  expect(chat.element.scrollTop).toBe(500);
});

test("returning to the end clears the saved reading position and resumes following", async () => {
  const chat = await view(100);
  expect(chat.control.awayFromEnd.value).toBe(true);
  chat.control.follow();
  expect(chat.element.scrollTop).toBe(800);
  expect(chat.control.awayFromEnd.value).toBe(false);
  expect(chat.changed).toHaveBeenLastCalledWith(800);
  chat.dimensions.contentHeight = 1800;
  resize();
  expect(chat.element.scrollTop).toBe(1600);
  expect(chat.control.awayFromEnd.value).toBe(false);
  chat.dimensions.height = 2000;
  resize();
  expect(chat.control.awayFromEnd.value).toBe(false);
});

test("a short history follows when it first overflows and when the viewport shrinks", async () => {
  const chat = await view(undefined, 100);
  chat.dimensions.contentHeight = 1000;
  resize();
  expect(chat.element.scrollTop).toBe(800);
  chat.dimensions.height = 100;
  resize();
  expect(chat.element.scrollTop).toBe(900);
});

test("reflow preserves a reading anchor rather than an obsolete pixel offset", async () => {
  const chat = await view(100);
  chat.dimensions.width = 320;
  chat.dimensions.anchorTop = 240;
  chat.dimensions.contentHeight = 1800;
  resize();
  expect(chat.element.scrollTop).toBe(240);
  chat.dimensions.height = 100;
  resize();
  expect(chat.element.scrollTop).toBe(240);
});

test.each([
  [240.125, 240, 0.125],
  [240.875, 241, -0.125],
])(
  "reflow selects the nearest pixel when scroll positions truncate (anchor=%s)",
  async (anchorTop, scrollTop, offset) => {
    const chat = await view(100, 1000, true);
    chat.dimensions.width = 320;
    chat.dimensions.anchorTop = anchorTop;
    chat.dimensions.contentHeight = 1800;
    resize();
    expect(chat.element.scrollTop).toBe(scrollTop);
    expect(
      chat.body.querySelector("article")!.getBoundingClientRect().top,
    ).toBe(offset);
  },
);

test("anchors to visible messages inside work history rather than the whole work block", async () => {
  const chat = await view(100);
  const period = chat.body.querySelector("article")!;
  period.className = "work-history";
  period.innerHTML =
    '<div class="work-history-heading"></div><div class="history-segment" hidden></div><div class="history-segment">The proposed plan.</div>';
  vi.spyOn(
    period.firstElementChild!,
    "getBoundingClientRect",
  ).mockImplementation(() => new DOMRect(0, -chat.element.scrollTop, 640, 40));
  let messageTop = 200;
  vi.spyOn(
    period.lastElementChild!,
    "getBoundingClientRect",
  ).mockImplementation(
    () => new DOMRect(0, messageTop - chat.element.scrollTop, 640, 500),
  );
  chat.move(250);
  messageTop = 340;
  chat.dimensions.contentHeight = 1500;
  resize();
  expect(chat.element.scrollTop).toBe(390);
});

test("a reading position clamped by a larger viewport does not resume following", async () => {
  const chat = await view(100);
  chat.dimensions.height = 950;
  chat.element.scrollTop = 50;
  chat.control.capture();
  expect(chat.element.scrollTop).toBe(50);
  chat.dimensions.contentHeight = 2000;
  resize();
  expect(chat.element.scrollTop).toBe(50);
});

test("a layout-induced scroll event does not cancel following", async () => {
  const chat = await view();
  chat.dimensions.height = 100;
  chat.control.capture();
  expect(chat.element.scrollTop).toBe(900);
  chat.dimensions.contentHeight = 1500;
  resize();
  expect(chat.element.scrollTop).toBe(1400);
});

test.each(["summary", "work-history"] as const)(
  "inspecting %s suspends following even if the viewport is still at the end",
  async (target) => {
    const chat = await view();
    if (target === "work-history") {
      const button = document.createElement("button");
      button.dataset.chatDisclosure = "";
      chat.body.append(button);
      button.click();
    } else chat.body.querySelector("summary")!.click();
    chat.control.capture();
    chat.dimensions.contentHeight = 1600;
    resize();
    expect(chat.element.scrollTop).toBe(800);
    chat.move(1400);
    chat.dimensions.contentHeight = 2000;
    resize();
    expect(chat.element.scrollTop).toBe(1800);
  },
);

test("upward wheel input cancels a pending resize before the scroll event arrives", async () => {
  const chat = await view();
  chat.control.wheel(new WheelEvent("wheel", { deltaY: -120 }));
  chat.dimensions.contentHeight = 1500;
  resize();
  expect(chat.element.scrollTop).toBe(800);
  chat.move(680);
  chat.control.follow();
  expect(chat.element.scrollTop).toBe(1300);
});

test.each(["wheel", "touch"])(
  "%s scrolling before its scroll event is not undone by delayed content",
  async (input) => {
    const chat = await view();
    if (input === "wheel")
      chat.control.wheel(new WheelEvent("wheel", { deltaY: -400 }));
    chat.element.scrollTop = 400;
    chat.dimensions.contentHeight = 1800;
    resize();
    expect(chat.element.scrollTop).toBe(400);
    chat.control.capture();
    chat.dimensions.contentHeight = 2200;
    resize();
    expect(chat.element.scrollTop).toBe(400);
  },
);

test("queued resizes are coalesced and respect scrolling before paint", async () => {
  const chat = await view();
  chat.dimensions.contentHeight = 1800;
  observers[0]!.notify();
  observers[0]!.notify();
  expect(frames.size).toBe(1);
  chat.element.scrollTop = 400;
  chat.control.capture();
  paint();
  expect(chat.element.scrollTop).toBe(400);
});

test("hidden and disposed views release observers and ignore late callbacks", async () => {
  const chat = await view(100);
  chat.visible.value = false;
  await flushPromises();
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  chat.dimensions.contentHeight = 1800;
  resize();
  expect(chat.element.scrollTop).toBe(100);
  chat.visible.value = true;
  await flushPromises();
  expect(chat.element.scrollTop).toBe(100);
  observers[1]!.notify();
  expect(frames.size).toBe(1);
  chat.wrapper.unmount();
  expect(frames.size).toBe(0);
  expect(observers[1]!.disconnect).toHaveBeenCalledOnce();
  chat.dimensions.anchorTop = 500;
  resize();
  expect(chat.element.scrollTop).toBe(100);
});
