import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import EnvironmentControls from "./EnvironmentControls.vue";
import PreviewEnvironment from "./PreviewEnvironment.vue";
import { createPlatformState, type PlatformState } from "./model";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

describe("environment controls", () => {
  it("publishes profile size and mobile behavior without owning the app state", async () => {
    const wrapper = mount(EnvironmentControls, {
      props: {
        state: createPlatformState(),
        editing: true,
        "onUpdate:state": () => {},
      },
    });
    wrappers.push(wrapper);
    await wrapper.get("select").setValue("ios");
    expect(wrapper.emitted("update:state")).toEqual([
      [{ profile: "ios", keyboardOpen: false }],
    ]);
    expect(wrapper.emitted("resize")).toEqual([[{ width: 390, height: 844 }]]);
    expect(wrapper.emitted("platform")).toEqual([[true]]);
    await wrapper.get("select").setValue("windows");
    expect(wrapper.emitted("resize")?.[1]).toEqual([
      { width: 1040, height: 700 },
    ]);
    expect(wrapper.emitted("platform")?.[1]).toEqual([false]);
  });

  it("offers keyboard occlusion only in mobile editing screens and closes it on exit", async () => {
    const state = ref<PlatformState>({ profile: "ios", keyboardOpen: true });
    const editing = ref(true);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(EnvironmentControls, {
            state: state.value,
            editing: editing.value,
            "onUpdate:state": (value) => {
              state.value = value;
            },
          }),
      }),
    );
    wrappers.push(wrapper);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
    editing.value = false;
    await nextTick();
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(state.value.keyboardOpen).toBe(false);
    editing.value = true;
    state.value = createPlatformState("mac");
    await nextTick();
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
  });
});

describe("preview environment", () => {
  it("sizes its slot from the host, preserves live inputs and leaves root viewport styles alone", async () => {
    let resize!: (
      entries: { contentRect: { width: number; height: number } }[],
    ) => void;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: typeof resize) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    document.documentElement.style.setProperty(
      "--app-viewport-height",
      "568px",
    );
    document.documentElement.style.setProperty("--app-viewport-top", "24px");
    const rootStyle = document.documentElement.getAttribute("style");
    const Draft = defineComponent({
      setup() {
        const draft = ref("");
        return () =>
          h("input", {
            value: draft.value,
            onInput: (event: Event) => {
              draft.value = (event.target as HTMLInputElement).value;
            },
          });
      },
    });
    const wrapper = mount(PreviewEnvironment, {
      props: { state: createPlatformState("ios") },
      slots: { default: Draft },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    resize([{ contentRect: { width: 320, height: 568 } }]);
    await nextTick();
    const content = wrapper.get(".environment-content").element as HTMLElement;
    expect(content.style.top).toBe("59px");
    expect(content.style.bottom).toBe("34px");
    expect(content.style.getPropertyValue("--app-content-height")).toBe(
      "475px",
    );
    expect(content.style.getPropertyValue("--app-content-top")).toBe(
      "calc(var(--app-viewport-top, 0px) + 59px)",
    );
    const input = wrapper.get("input");
    await input.setValue("A retained draft");
    (input.element as HTMLInputElement).focus();
    (input.element as HTMLInputElement).setSelectionRange(2, 6);
    await wrapper.setProps({ state: { profile: "ios", keyboardOpen: true } });
    expect(content.style.bottom).toBe("294px");
    expect(content.style.getPropertyValue("--app-content-height")).toBe(
      "215px",
    );
    await wrapper.setProps({
      state: { profile: "windows", keyboardOpen: false },
    });
    expect(content.style.top).toBe("0px");
    expect(content.style.bottom).toBe("0px");
    expect(content.style.getPropertyValue("--app-content-height")).toBe(
      "568px",
    );
    expect(wrapper.get("input").element).toBe(input.element);
    expect((input.element as HTMLInputElement).value).toBe("A retained draft");
    expect(document.activeElement).toBe(input.element);
    expect((input.element as HTMLInputElement).selectionStart).toBe(2);
    expect((input.element as HTMLInputElement).selectionEnd).toBe(6);
    expect(wrapper.findAll("iframe, button, select, label")).toHaveLength(0);
    expect(wrapper.text()).toBe("");
    expect(document.documentElement.getAttribute("style")).toBe(rootStyle);
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(document.documentElement.getAttribute("style")).toBe(rootStyle);
  });
});
