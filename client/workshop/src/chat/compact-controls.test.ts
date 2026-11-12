import "../ui/popover-test-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import ChatModelChoice from "./ChatModelChoice.vue";
import ChatDropdown from "./ChatDropdown.vue";
import { createChatState } from "./model";
import { currentWorkspace } from "../ai/model";

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function view(locale: "en" | "de" = "en") {
  const state = createChatState("chat-complete");
  currentWorkspace(state.ai).defaultModel = "example-reasoning-long";
  const wrapper = mount(ChatModelChoice, {
    props: { state: state.ai, thinking: state.thinking, locale },
  });
  return { state, wrapper };
}
describe("compact composer controls", () => {
  it("shows resolved values while keeping inherited sources in accessible names and menus", () => {
    const { wrapper } = view();
    const dropdowns = wrapper.findAllComponents(ChatDropdown);
    expect(dropdowns.map((item) => item.props("text"))).toEqual([
      "Example Reasoning",
      "Medium",
    ]);
    expect(dropdowns.map((item) => item.props("source"))).toEqual(["↳", "↳"]);
    expect(
      wrapper.get(".model-trigger > button").attributes("aria-label"),
    ).toContain("Workspace default");
    expect(dropdowns[0]!.props("options")[0]).toMatchObject({
      id: "",
      label: "Workspace default",
      detail: "OpenAI · Example Reasoning",
    });
    expect(dropdowns[0]!.props("description")).toBeUndefined();
    expect(dropdowns[1]!.props("options").map((item) => item.id)).toEqual([
      "",
      "recommended",
      "low",
      "medium",
      "high",
    ]);
  });
  it("keeps inherited Recommended distinct from an explicit Recommended preference", async () => {
    const { state, wrapper } = view();
    const thinking = wrapper.findAllComponents(ChatDropdown)[1]!;
    expect(thinking.props("options")[0]!.detail).toBe("Recommended · Medium");
    expect(thinking.props("value")).toBe("");
    await wrapper.setProps({
      thinking: {
        Personal: { "openai/example-reasoning-long": "recommended" },
        Studio: {},
      },
    });
    expect(thinking.props("text")).toBe("Medium");
    expect(thinking.props("source")).toBe("☆");
    await thinking.vm.$emit("select", "recommended");
    expect(wrapper.emitted("thinking")?.at(-1)).toEqual(["recommended"]);
    expect(currentWorkspace(state.ai).model.selected).toBeNull();
    await thinking.vm.$emit("select", "");
    expect(wrapper.emitted("thinking")?.at(-1)).toEqual([null]);
  });
  it("uses unmarked explicit levels and localized accessible source names", async () => {
    const { wrapper } = view("de");
    await wrapper.setProps({
      thinking: {
        Personal: { "openai/example-reasoning-long": "high" },
        Studio: {},
      },
    });
    const thinking = wrapper.findAllComponents(ChatDropdown)[1]!;
    expect(thinking.props("text")).toBe("Hoch");
    expect(thinking.props("source")).toBeUndefined();
    expect(
      wrapper.get(".thinking-trigger > button").attributes("aria-label"),
    ).toContain("Denkaufwand: Hoch. Auswahl für diese Unterhaltung");
    expect(thinking.props("options")[0]!.label).toBe("Arbeitsbereichsstandard");
  });
  it("omits unsupported thinking without clearing stored preferences", async () => {
    const { state, wrapper } = view();
    currentWorkspace(state.ai).defaultModel = "example-fast";
    const thinking = {
      Personal: { "openai/example-reasoning-long": "high" as const },
      Studio: {},
    };
    await wrapper.setProps({ state: structuredClone(state.ai), thinking });
    expect(wrapper.findAllComponents(ChatDropdown)).toHaveLength(1);
    expect(thinking.Personal["openai/example-reasoning-long"]).toBe("high");
  });
  it("keeps selections available during a response, but disables them while saving", async () => {
    const { state, wrapper } = view();
    currentWorkspace(state.ai).response = "streaming";
    await wrapper.setProps({ state: structuredClone(state.ai) });
    expect(
      wrapper
        .findAllComponents(ChatDropdown)
        .every((item) => !item.props("disabled")),
    ).toBe(true);
    currentWorkspace(state.ai).model.phase = "saving";
    await wrapper.setProps({ state: structuredClone(state.ai) });
    expect(
      wrapper
        .findAllComponents(ChatDropdown)
        .every((item) => item.props("disabled")),
    ).toBe(true);
    expect(wrapper.findAllComponents(ChatDropdown)[0]!.props("text")).toBe(
      "Saving…",
    );
  });
});
