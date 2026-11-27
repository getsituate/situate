import { flushPromises, mount } from "@vue/test-utils";
import { expect, test, vi } from "vitest";
import { defineComponent, h, withDirectives } from "vue";
import { vChatCornerClearance } from "./corner-clearance";

const Chat = defineComponent({
  props: { active: Boolean, changesOnly: Boolean, history: Boolean },
  setup(props) {
    return () =>
      withDirectives(
        h("div", { "data-changes-only": props.changesOnly ? "" : undefined }, [
          h("button", { class: "chat-corner-actions" }),
          h(
            "section",
            { class: props.history ? "has-history" : "empty-chat" },
            [h("div", { class: props.history ? "messages" : "welcome" })],
          ),
        ]),
        [[vChatCornerClearance, props.active]],
      );
  },
});

test("reserves space only for overlapping corner controls or a full-width changes panel", async () => {
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const wrapper = mount(Chat, { props: { active: true } });
  const frame = wrapper.element as HTMLElement;
  const corner = wrapper.get("button").element;
  const column = wrapper.get("section div").element;
  Object.defineProperty(frame, "offsetWidth", { value: 400 });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 20, 400, 500),
  );
  const bounds = vi.spyOn(corner, "getBoundingClientRect");
  bounds.mockReturnValue(new DOMRect(350, 28, 44, 44));
  const columnBounds = vi.spyOn(column, "getBoundingClientRect");
  const clearance = () =>
    frame.style.getPropertyValue("--chat-corner-clearance");
  try {
    columnBounds.mockReturnValue(new DOMRect(20, 35, 300, 50));
    resize();
    expect(clearance()).toBe("");

    columnBounds.mockReturnValue(new DOMRect(20, 100, 365, 50));
    resize();
    expect(clearance()).toBe("");
    columnBounds.mockReturnValue(new DOMRect(20, 35, 365, 50));
    resize();
    expect(clearance()).toBe("60px");

    await wrapper.setProps({ history: true });
    await flushPromises();
    columnBounds.mockReturnValue(new DOMRect(20, 100, 365, 50));
    resize();
    expect(clearance()).toBe("60px");
    bounds.mockReturnValue(new DOMRect());
    resize();
    expect(clearance()).toBe("0px");

    bounds.mockReturnValue(new DOMRect(350, 28, 44, 44));
    columnBounds.mockReturnValue(new DOMRect(20, 35, 300, 50));
    await wrapper.setProps({ changesOnly: true });
    await flushPromises();
    expect(clearance()).toBe("60px");
    await wrapper.setProps({ active: false });
    expect(clearance()).toBe("");
    await wrapper.setProps({ active: true });
    expect(clearance()).toBe("60px");
  } finally {
    wrapper.unmount();
    vi.unstubAllGlobals();
  }
  expect(clearance()).toBe("");
});
