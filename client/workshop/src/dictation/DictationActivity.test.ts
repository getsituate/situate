import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DictationActivity from "./DictationActivity.vue";

let wrapper: VueWrapper | undefined;
let intersection: IntersectionObserverCallback;
let media: EventTarget & { matches: boolean };
let animate: ReturnType<typeof vi.fn>;
let cancels: ReturnType<typeof vi.fn>[];
let disconnect: ReturnType<typeof vi.fn>;
function visible(value = true) {
  intersection(
    [
      {
        target: wrapper!.element,
        isIntersecting: value,
        intersectionRect: { width: value ? 256 : 0, height: value ? 32 : 0 },
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}
function render(props = {}) {
  wrapper = mount(DictationActivity, {
    attachTo: document.body,
    props: { phase: "recording", speech: "speaking", covered: false, ...props },
  });
  visible();
  return wrapper;
}
function reduced(value: boolean) {
  media.matches = value;
  media.dispatchEvent(new Event("change"));
}
beforeEach(() => {
  cancels = [];
  disconnect = vi.fn();
  animate = vi.fn(() => {
    const cancel = vi.fn();
    cancels.push(cancel);
    return { cancel };
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dictation activity", () => {
  it("resumes the phrase after a pause and starts transcription independently", async () => {
    render();
    animate.mock.results[0]!.value.currentTime = 900;
    await wrapper!.setProps({ paused: true });
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    await wrapper!.setProps({ paused: false });
    expect(
      animate.mock.results.slice(7).map(({ value }) => value.currentTime),
    ).toEqual(Array(7).fill(900));
    await wrapper!.setProps({ phase: "transcribing" });
    expect(
      cancels.slice(0, 14).every((cancel) => cancel.mock.calls.length === 1),
    ).toBe(true);
    expect(wrapper!.findAll(".wave-bar")).toHaveLength(0);
    expect(wrapper!.findAll(".processing-dot")).toHaveLength(3);
    expect(
      animate.mock.results.slice(14).map(({ value }) => value.currentTime),
    ).toEqual([0, 0, 0]);
    await wrapper!.setProps({ paused: true });
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("suspends beneath native dialogs even without a covered prop change", async () => {
    render();
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    dialog.setAttribute("open", "");
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    dialog.removeAttribute("open");
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(animate).toHaveBeenCalledTimes(14);
  });

  it("varies bars with synthetic syllables and pauses, with a lower amplitude for quiet speech", async () => {
    render();
    expect(wrapper!.attributes("aria-hidden")).toBe("true");
    expect(animate).toHaveBeenCalledTimes(7);
    const speaking = animate.mock.calls[0][0] as Keyframe[];
    expect(
      new Set(speaking.map((frame) => frame.transform)).size,
    ).toBeGreaterThan(4);
    expect(speaking[0]).toEqual(speaking.at(-1));
    const original = [...cancels];
    await wrapper!.setProps({ speech: "quiet" });
    expect(original.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    const quiet = animate.mock.calls[7][0] as Keyframe[];
    const scale = (frame: Keyframe) =>
      Number(String(frame.transform).slice(7, -1));
    expect(Math.max(...quiet.map(scale))).toBeLessThan(
      Math.max(...speaking.map(scale)),
    );
    await wrapper!.setProps({ speech: "silence" });
    expect(animate).toHaveBeenCalledTimes(14);
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    expect(wrapper!.find(".wave-bar").attributes("style")).toContain(
      "scaleY(0.125)",
    );
  });

  it("replaces the waveform with processing dots and cancels previous animations", async () => {
    render();
    const recording = [...cancels];
    await wrapper!.setProps({ phase: "transcribing" });
    expect(recording.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    expect(wrapper!.findAll(".wave-bar")).toHaveLength(0);
    expect(wrapper!.findAll(".processing-dot")).toHaveLength(3);
    expect(animate.mock.calls.slice(7).map((call) => call[1].delay)).toEqual([
      0, 160, 320,
    ]);
    wrapper!.unmount();
    wrapper = undefined;
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each(["recording", "transcribing"] as const)(
    "keeps %s static with live reduced-motion changes",
    (phase) => {
      reduced(true);
      render({ phase });
      expect(animate).not.toHaveBeenCalled();
      reduced(false);
      expect(animate).toHaveBeenCalledTimes(phase === "recording" ? 7 : 3);
      reduced(true);
      expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
        true,
      );
    },
  );

  it("suspends when covered, offscreen or hidden and detaches observers on removal", async () => {
    render({ covered: true });
    expect(animate).not.toHaveBeenCalled();
    await wrapper!.setProps({ covered: false });
    expect(animate).toHaveBeenCalledTimes(7);
    visible(false);
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    visible();
    expect(animate).toHaveBeenCalledTimes(14);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(animate).toHaveBeenCalledTimes(21);
    await wrapper!.setProps({ covered: true });
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(
      true,
    );
    wrapper!.unmount();
    wrapper = undefined;
    document.dispatchEvent(new Event("visibilitychange"));
    reduced(false);
    expect(animate).toHaveBeenCalledTimes(21);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("retains static feedback when animation APIs are unavailable", () => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    render();
    expect(wrapper!.findAll(".wave-bar")).toHaveLength(7);
    expect(animate).not.toHaveBeenCalled();
  });
});
