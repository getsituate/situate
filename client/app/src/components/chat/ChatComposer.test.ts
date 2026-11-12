import { afterEach, expect, test } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import ChatComposer from "../ChatComposer.vue";
import ChatPending from "./ChatPending.vue";

enableAutoUnmount(afterEach);

test.each(["permission", "recording", "transcribing"] as const)(
  "%s preserves editing and blocks keyboard submission without disabling agent stop",
  async (dictationPhase) => {
    const wrapper = mount(ChatComposer, {
      props: {
        draft: "Existing draft",
        connected: true,
        modelSelected: true,
        running: true,
        dictationPhase,
      },
    });
    await wrapper.get("textarea").setValue("Edited draft");
    expect(wrapper.emitted("update:draft")).toEqual([["Edited draft"]]);
    await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
    await wrapper
      .get("textarea")
      .trigger("keydown", { key: "Enter", altKey: true });
    expect(wrapper.emitted("send")).toBeUndefined();
    await wrapper
      .get('button[aria-label="⟦navigation.stopResponse⟧"]')
      .trigger("click");
    expect(wrapper.emitted("stop")).toEqual([[]]);
    if (dictationPhase === "recording") {
      await wrapper
        .get('button[aria-label="⟦dictation.stop⟧"]')
        .trigger("click");
      expect(wrapper.emitted("stopDictation")).toEqual([[]]);
      expect(wrapper.emitted("send")).toBeUndefined();
    }
  },
);

test("Enter steers, Alt+Enter follows up, and Shift+Enter remains a newline while running", async () => {
  const wrapper = mount(ChatComposer, {
    props: {
      draft: "Keep the note short",
      connected: true,
      modelSelected: true,
      running: true,
    },
  });
  const field = wrapper.get("textarea");
  await field.trigger("keydown", { key: "Enter" });
  await field.trigger("keydown", { key: "Enter", altKey: true });
  await field.trigger("keydown", { key: "Enter", shiftKey: true });
  await field.trigger("keydown", { key: "Enter", isComposing: true });
  expect(wrapper.emitted("send")).toEqual([["steering"], ["followUp"]]);
  expect(
    wrapper.find('button[aria-label="⟦navigation.stopResponse⟧"]').exists(),
  ).toBe(true);
  expect(wrapper.findAll("select")).toHaveLength(0);
});

test("Alt+ArrowUp recalls only a nonempty queue; normal arrows and modifier shortcuts are untouched", async () => {
  const wrapper = mount(ChatComposer, {
    props: { draft: "Existing", hasPending: true },
  });
  const field = wrapper.get("textarea");
  await field.trigger("keydown", { key: "ArrowUp" });
  await field.trigger("keydown", {
    key: "ArrowUp",
    altKey: true,
    shiftKey: true,
  });
  await field.trigger("keydown", {
    key: "ArrowUp",
    altKey: true,
    metaKey: true,
  });
  expect(wrapper.emitted("recall")).toBeUndefined();
  await field.trigger("keydown", { key: "ArrowUp", altKey: true });
  expect(wrapper.emitted("recall")).toEqual([[]]);
  await wrapper.setProps({ hasPending: false });
  await field.trigger("keydown", { key: "ArrowUp", altKey: true });
  expect(wrapper.emitted("recall")).toHaveLength(1);
});

test("an attachment-only draft can be submitted and each attachment can be removed", async () => {
  const wrapper = mount(ChatComposer, {
    props: {
      draft: "",
      connected: true,
      modelSelected: true,
      attachments: [{ id: "image", name: "Sketch.png" }],
    },
  });
  await wrapper
    .get('button[aria-label="⟦navigation.sendMessage⟧"]')
    .trigger("click");
  expect(wrapper.emitted("send")).toEqual([["steering"]]);
  await wrapper.get(".draft-attachment button").trigger("click");
  expect(wrapper.emitted("removeAttachment")).toEqual([["image"]]);
  await wrapper.setProps({ attaching: true });
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toHaveLength(1);
});

test("a reference-only draft sends through click and Enter while connection and busy guards remain enforced", async () => {
  const wrapper = mount(ChatComposer, {
    props: {
      draft: "",
      hasReferences: true,
      connected: true,
      modelSelected: true,
    },
  });
  await wrapper
    .get('button[aria-label="⟦navigation.sendMessage⟧"]')
    .trigger("click");
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toEqual([["steering"], ["steering"]]);
  for (const props of [
    { busy: true },
    { connected: false },
    { modelSelected: false },
    { hasReferences: false },
  ]) {
    await wrapper.setProps({
      busy: false,
      connected: true,
      modelSelected: true,
      hasReferences: true,
      ...props,
    });
    expect(
      wrapper
        .get('button[aria-label="⟦navigation.sendMessage⟧"]')
        .attributes("disabled"),
    ).toBeDefined();
    await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")).toHaveLength(2);
  }
});

test("the attachment picker accepts Markdown and JSON and emits the original files", async () => {
  const wrapper = mount(ChatComposer, { props: { draft: "" } });
  const picker = wrapper.get('input[type="file"]');
  expect(picker.attributes("accept")!.split(",")).toEqual([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "text/plain",
    "text/markdown",
    "application/json",
    ".txt",
    ".md",
    ".markdown",
    ".json",
  ]);
  const markdown = new File(["# Notes\n"], "Project.markdown", {
    type: "text/markdown",
  });
  const json = new File(['{"tasks":[]}'], "tasks.json", {
    type: "application/json",
  });
  Object.defineProperty(picker.element, "files", { value: [markdown, json] });
  await picker.trigger("change");
  const files = wrapper.emitted("attach")![0]![0] as File[];
  expect(files).toHaveLength(2);
  expect(files[0]).toBe(markdown);
  expect(files[1]).toBe(json);
  expect((picker.element as HTMLInputElement).value).toBe("");
});

test("pending input starts collapsed, expands by kind and exposes pointer recall without a mode selector", async () => {
  const wrapper = mount(ChatPending, {
    attachTo: document.body,
    props: {
      messages: [
        { id: "s", kind: "steering", text: "First\nSecond", attachments: [] },
        {
          id: "f",
          kind: "followUp",
          text: "Next",
          attachments: [{ id: "image", name: "Sketch.png" }],
        },
      ],
    },
  });
  expect(wrapper.get(".pending-toggle").attributes("aria-expanded")).toBe(
    "false",
  );
  expect(wrapper.get(".pending-list").isVisible()).toBe(false);
  await wrapper.get(".pending-toggle").trigger("click");
  expect(wrapper.get(".pending-list").isVisible()).toBe(true);
  expect(
    wrapper.findAll(".pending-group h3").map((node) => node.text()),
  ).toEqual(["⟦chat.steering⟧", "⟦chat.followUp⟧"]);
  expect(wrapper.findAll(".pending-body p").map((node) => node.text())).toEqual(
    ["First\nSecond", "Next"],
  );
  expect(wrapper.get(".attachment").text()).toBe("Sketch.png");
  await wrapper.get(".edit-pending").trigger("click");
  expect(wrapper.emitted("recall")).toEqual([[]]);
  await wrapper.setProps({ messages: [] });
  expect(wrapper.find(".pending").exists()).toBe(false);
});
