import "../ui/popover-test-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import FileActionMenu from "./FileActionMenu.vue";
import { fileMenu } from "./fileActions";
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 44, 44),
  );
});
enableAutoUnmount(afterEach);
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(writable = true) {
  const anchor = document.createElement("button");
  anchor.textContent = "⟦files.fileActions⟧";
  document.body.append(anchor);
  anchor.focus();
  const wrapper = mount(FileActionMenu, {
    attachTo: document.body,
    props: {
      anchor,
      title: "⟦files.fileActions⟧",
      context: "Garden.md",
      items: fileMenu({
        path: "Garden.md",
        directory: false,
        plus: false,
        writable,
        live: true,
        mode: "read",
        selected: "Garden.md",
      }),
    },
  });
  await flushPromises();
  return {
    wrapper,
    anchor,
    menu: document.querySelector<HTMLElement>('[role="menu"]')!,
  };
}
function key(value: string) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("anchored file actions", () => {
  it("focuses the first item, exposes radio selection, and supports arrows and endpoints", async () => {
    const { menu } = await render();
    expect(menu.getAttribute("aria-label")).toBe("⟦files.fileActions⟧");
    expect(document.activeElement?.textContent).toBe("⟦files.read⟧✓");
    expect(
      menu
        .querySelector('[role="menuitemradio"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("⟦files.editSource⟧");
    key("End");
    expect(document.activeElement?.textContent).toBe("⟦files.deleteDetail⟧");
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("⟦files.read⟧✓");
    key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("⟦files.deleteDetail⟧");
    key("Home");
    expect(document.activeElement?.textContent).toBe("⟦files.read⟧✓");
  });
  it("skips disabled items and returns focus on Escape", async () => {
    const { anchor, wrapper } = await render(false);
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("⟦files.viewSource⟧");
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("⟦files.versionHistory⟧");
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("⟦files.read⟧✓");
    key("Escape");
    expect(document.activeElement).toBe(anchor);
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });
  it("emits the command before dismissal so its target remains available", async () => {
    const { menu, wrapper, anchor } = await render();
    const order: string[] = [];
    await wrapper.setProps({
      onChoose: () => order.push("choose"),
      onDismiss: () => order.push("dismiss"),
    });
    menu.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!.click();
    expect(wrapper.emitted("choose")).toEqual([["read"]]);
    expect(order).toEqual(["choose", "dismiss"]);
    await flushPromises();
    expect(document.activeElement).toBe(anchor);
  });
  it("removes environment listeners and does not move focus after an immediate unmount", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    anchor.focus();
    const listen = vi.spyOn(document, "addEventListener");
    const unlisten = vi.spyOn(document, "removeEventListener");
    const windowListen = vi.spyOn(window, "addEventListener");
    const windowUnlisten = vi.spyOn(window, "removeEventListener");
    const wrapper = mount(FileActionMenu, {
      attachTo: document.body,
      props: { anchor, title: "⟦files.create⟧", context: "Garden", items: [] },
    });
    wrapper.unmount();
    await flushPromises();
    for (const [name, listener, options] of listen.mock.calls.filter(
      ([name]) => name === "scroll",
    )) {
      expect(unlisten).toHaveBeenCalledWith(name, listener, options);
    }
    for (const [name, listener] of windowListen.mock.calls.filter(
      ([name]) => name === "resize",
    )) {
      expect(windowUnlisten).toHaveBeenCalledWith(name, listener);
    }
    expect(document.activeElement).toBe(anchor);
  });
  it("reflects native light dismissal without stealing focus", async () => {
    const { wrapper, menu } = await render();
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    const event = new Event("beforetoggle");
    Object.defineProperty(event, "newState", { value: "closed" });
    menu.dispatchEvent(event);
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
    expect(document.activeElement).toBe(other);
  });
});
