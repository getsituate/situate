import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { SituateResizeHandle } from "@situate/ui";
import { preferences, setPreferences } from "@situate/localization";
const wrappers: VueWrapper[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function create(orientation: "vertical" | "horizontal" = "vertical") {
  const wrapper = mount(SituateResizeHandle, {
    attachTo: document.body,
    props: {
      modelValue: 272,
      min: 224,
      max: 480,
      resetValue: 272,
      label: "Resize sidebar",
      controls: "sidebar",
      orientation,
      "onUpdate:modelValue": (value: number): void => {
        void wrapper.setProps({ modelValue: value });
      },
    },
  });
  Object.assign(wrapper.element, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function sendPointer(
  wrapper: VueWrapper,
  type: string,
  options: PointerEventInit,
) {
  wrapper.element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, ...options }),
  );
  await nextTick();
}
const pointer = {
  pointerId: 1,
  button: 0,
  isPrimary: true,
  clientX: 100,
  clientY: 100,
};
describe("SituateResizeHandle", () => {
  it("exposes separator identity, bounds, size and keyboard help", () => {
    const wrapper = create();
    expect(wrapper.attributes()).toMatchObject({
      role: "separator",
      tabindex: "0",
      "aria-label": "Resize sidebar",
      "aria-controls": "sidebar",
      "aria-orientation": "vertical",
      "aria-valuenow": "272",
      "aria-valuemin": "224",
      "aria-valuemax": "480",
      "aria-valuetext": '⟦ui.resize.pixels:{"value":272}⟧',
    });
    expect(wrapper.attributes("aria-description")).toBe("⟦ui.resize.help⟧");
  });
  it("renders localized help and pixel values in both supported languages", async () => {
    vi.stubGlobal("__SITUATE_LOCALIZATION_KEYS__", false);
    const previous = preferences.value;
    try {
      setPreferences({ ...previous, language: "en" });
      const wrapper = create();
      expect(wrapper.attributes("aria-valuetext")).toBe("272 pixels");
      expect(wrapper.attributes("aria-description")).toBe(
        "Drag or use the arrow keys to resize. Home and End set the limits. Enter or a double-click resets the size. Escape cancels a drag.",
      );
      setPreferences({ ...previous, language: "de" });
      await nextTick();
      expect(wrapper.attributes("aria-valuetext")).toBe("272 Pixel");
      expect(wrapper.attributes("aria-description")).toBe(
        "Ziehe oder verwende die Pfeiltasten, um die Größe zu ändern. Pos1 und Ende setzen die Grenzen. Eingabe oder Doppelklicken setzt die Größe zurück. Escape bricht das Ziehen ab.",
      );
    } finally {
      setPreferences(previous);
    }
  });
  it("isolates Escape during a drag but leaves ordinary Escape available to the host", async () => {
    const wrapper = create();
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    try {
      await sendPointer(wrapper, "pointerdown", pointer);
      await wrapper.trigger("keydown", { key: "Escape" });
      expect(outer).not.toHaveBeenCalled();
      await wrapper.trigger("keydown", { key: "Escape" });
      expect(outer).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener("keydown", outer);
    }
  });
  it("supports arrows, larger steps, bounds and keyboard reset", async () => {
    const wrapper = create();
    await wrapper.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.attributes("aria-valuenow")).toBe("280");
    await wrapper.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(wrapper.attributes("aria-valuenow")).toBe("248");
    await wrapper.trigger("keydown", { key: "Home" });
    await wrapper.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.attributes("aria-valuenow")).toBe("224");
    await wrapper.trigger("keydown", { key: "End" });
    await wrapper.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.attributes("aria-valuenow")).toBe("480");
    await wrapper.trigger("keydown", { key: "Enter" });
    expect(wrapper.attributes("aria-valuenow")).toBe("272");
  });
  it("does not commit a stationary click or an arrow at a size limit", async () => {
    const wrapper = create();
    await wrapper.setProps({ modelValue: 320, max: 320 });
    await sendPointer(wrapper, "pointerdown", pointer);
    await sendPointer(wrapper, "pointerup", pointer);
    await wrapper.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("change")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
  it("preserves unrelated keys and browser shortcuts", async () => {
    const wrapper = create();
    for (const key of ["Tab", "ArrowDown", "Escape"])
      await wrapper.trigger("keydown", { key });
    await wrapper.trigger("keydown", { key: "ArrowLeft", altKey: true });
    expect(wrapper.emitted("change")).toBeUndefined();
  });
  it("previews drag updates once per frame and commits the final position on release", async () => {
    const wrapper = create();
    await sendPointer(wrapper, "pointerdown", pointer);
    expect(document.activeElement).toBe(wrapper.element);
    await sendPointer(wrapper, "pointermove", { ...pointer, clientX: 150 });
    await sendPointer(wrapper, "pointermove", { ...pointer, clientX: 180 });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    vi.advanceTimersByTime(20);
    await nextTick();
    expect(wrapper.attributes("aria-valuenow")).toBe("352");
    expect(wrapper.emitted("change")).toBeUndefined();
    await sendPointer(wrapper, "pointerup", { ...pointer, clientX: 200 });
    expect(wrapper.attributes("aria-valuenow")).toBe("372");
    expect(wrapper.emitted("change")).toEqual([[372]]);
    expect(wrapper.emitted("dragging")).toEqual([[true], [false]]);
    expect(wrapper.element.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it.each(["pointercancel", "lostpointercapture", "Escape", "blur"])(
    "cancels without committing on %s",
    async (event) => {
      const wrapper = create();
      await sendPointer(wrapper, "pointerdown", pointer);
      await sendPointer(wrapper, "pointermove", { ...pointer, clientX: 180 });
      vi.advanceTimersByTime(20);
      await nextTick();
      expect(wrapper.attributes("aria-valuenow")).toBe("352");
      if (event === "Escape")
        await wrapper.trigger("keydown", { key: "Escape" });
      else if (event === "blur") window.dispatchEvent(new Event("blur"));
      else await sendPointer(wrapper, event, pointer);
      await nextTick();
      expect(wrapper.attributes("aria-valuenow")).toBe("272");
      expect(wrapper.emitted("change")).toBeUndefined();
      expect(wrapper.attributes("data-dragging")).toBeUndefined();
      vi.advanceTimersByTime(20);
      expect(wrapper.attributes("aria-valuenow")).toBe("272");
    },
  );
  it("ignores secondary input and clamps drag commits to current bounds", async () => {
    const wrapper = create();
    await sendPointer(wrapper, "pointerdown", { ...pointer, button: 2 });
    await sendPointer(wrapper, "pointerdown", { ...pointer, isPrimary: false });
    expect(wrapper.emitted("dragging")).toBeUndefined();
    await sendPointer(wrapper, "pointerdown", pointer);
    await sendPointer(wrapper, "pointermove", {
      ...pointer,
      pointerId: 2,
      clientX: 500,
    });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.setProps({ max: 320 });
    await sendPointer(wrapper, "pointerup", { ...pointer, clientX: 500 });
    expect(wrapper.emitted("change")).toEqual([[320]]);
    await wrapper.trigger("dblclick");
    expect(wrapper.attributes("aria-valuenow")).toBe("272");
  });
  it("uses the vertical pointer coordinate and up/down keys for horizontal separators", async () => {
    const wrapper = create("horizontal");
    await wrapper.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.attributes("aria-valuenow")).toBe("280");
    await sendPointer(wrapper, "pointerdown", pointer);
    await sendPointer(wrapper, "pointerup", {
      ...pointer,
      clientY: 160,
      clientX: 500,
    });
    expect(wrapper.attributes("aria-valuenow")).toBe("340");
  });
  it("reverses horizontal movement in right-to-left layouts", async () => {
    const wrapper = create();
    (wrapper.element as HTMLElement).style.direction = "rtl";
    await wrapper.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.attributes("aria-valuenow")).toBe("280");
    await sendPointer(wrapper, "pointerdown", pointer);
    await sendPointer(wrapper, "pointerup", { ...pointer, clientX: 60 });
    expect(wrapper.attributes("aria-valuenow")).toBe("320");
  });
  it("discards scheduled work on unmount", async () => {
    const wrapper = create();
    await sendPointer(wrapper, "pointerdown", pointer);
    await sendPointer(wrapper, "pointermove", { ...pointer, clientX: 180 });
    wrapper.unmount();
    vi.advanceTimersByTime(20);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.emitted("change")).toBeUndefined();
  });
});
