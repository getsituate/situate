import "../ui/popover-test-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import FileEditorView from "./FileEditorView.vue";
import EditorControls from "./EditorControls.vue";
import MarkdownContent from "./MarkdownContent.vue";
import FileTree from "./FileTree.vue";
import { createEditorState, type EditorState, type EditorScene } from "./model";

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function view(scene: EditorScene = "read") {
  let current = createEditorState(scene);
  const wrapper = mount(FileEditorView, {
    attachTo: document.body,
    props: {
      state: current,
      "onUpdate:state": (state: EditorState) => {
        current = state;
        void wrapper.setProps({ state });
      },
    },
  });
  return { wrapper, state: () => current };
}
async function button(wrapper: VueWrapper, text: string) {
  const node = wrapper
    .findAll("button")
    .find(
      (node) => node.text() === text || node.attributes("aria-label") === text,
    );
  expect(node, `button: ${text}`).toBeDefined();
  await node!.trigger("click");
  await nextTick();
}
async function action(wrapper: VueWrapper, label: string) {
  await button(wrapper, "File actions");
  await button(wrapper, label);
}

describe("file editor view", () => {
  it("renders content only and forwards shell navigation with its actual event", async () => {
    const { wrapper } = view();
    expect(wrapper.get("h1").text()).toBe("Autumn workshop");
    expect(wrapper.find(".app-nav").exists()).toBe(false);
    expect(wrapper.find(".window-titlebar").exists()).toBe(false);
    await wrapper.setProps({
      navigationId: "shell-navigation",
      navigationOpen: true,
    });
    const navigation = wrapper.get('[aria-label="Open navigation"]');
    expect(navigation.attributes("aria-controls")).toBe("shell-navigation");
    expect(navigation.attributes("aria-expanded")).toBe("true");
    await navigation.trigger("click");
    expect(wrapper.emitted("openNavigation")![0][0]).toBeInstanceOf(MouseEvent);
    await wrapper.setProps({ showNavigation: false });
    expect(wrapper.find('[aria-label="Open navigation"]').exists()).toBe(false);
  });
  it("emits edits synchronously without mutating controlled props", async () => {
    const original = createEditorState("source");
    const wrapper = mount(FileEditorView, { props: { state: original } });
    const input = wrapper.get<HTMLTextAreaElement>(
      '[aria-label="Markdown source"]',
    );
    input.element.value += "\nFirst";
    input.element.dispatchEvent(new Event("input", { bubbles: true }));
    const first = wrapper.emitted("update:state")!.at(-1)![0] as EditorState;
    expect(first.files[0].draft).toContain("First");
    expect(original.files[0].draft).not.toContain("First");
    input.element.value += "\nSecond";
    input.element.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      (wrapper.emitted("update:state")!.at(-1)![0] as EditorState).files[0]
        .draft,
    ).toContain("First\nSecond");
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
  it("navigates to the clicked block and does not enter source for double click or selection", async () => {
    const { wrapper, state } = view();
    const paragraph = wrapper.get(".markdown p");
    paragraph.element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail: 2, button: 0 }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(state().mode).toBe("read");
    const offset = Number(paragraph.attributes("data-source-offset"));
    paragraph.element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail: 1, button: 0 }),
    );
    await vi.advanceTimersByTimeAsync(300);
    await nextTick();
    expect(state().mode).toBe("source");
    const source = wrapper.get<HTMLTextAreaElement>(
      '[aria-label="Markdown source"]',
    );
    expect(source.element.selectionStart).toBe(offset);
    expect(document.activeElement).toBe(source.element);
  });
  it("automatically saves and retains typing focus; failures keep drafts out of history", async () => {
    const { wrapper, state } = view("source");
    const source = wrapper.get<HTMLTextAreaElement>(
      '[aria-label="Markdown source"]',
    );
    source.element.focus();
    await source.setValue(source.element.value + "\nFirst automatic edit.");
    expect(wrapper.get(".save-state").text()).toBe("Saving…");
    await vi.advanceTimersByTimeAsync(350);
    expect(wrapper.get(".save-state").text()).toBe("Saved");
    expect(state().files[0].versions).toHaveLength(4);
    expect(document.activeElement).toBe(source.element);
    await wrapper.setProps({ state: { ...state(), saveOutcome: "failure" } });
    await source.setValue(source.element.value + "\nRetain after failure.");
    await vi.advanceTimersByTimeAsync(350);
    expect(wrapper.get(".save-state").text()).toContain("Couldn’t save");
    expect(state().files[0].versions).toHaveLength(4);
    expect(source.element.value).toContain("Retain after failure.");
    await wrapper.setProps({ state: { ...state(), saveOutcome: "success" } });
    expect(state().files[0].content).toContain("Retain after failure.");
    expect(state().files[0].versions).toHaveLength(5);
  });
  it("confirms ID replacement, treats Escape as cancellation, and never saves an unconfirmed ID", async () => {
    const { wrapper, state } = view("source");
    const source = wrapper.get<HTMLTextAreaElement>(
      '[aria-label="Markdown source"]',
    );
    const original = source.element.value;
    await source.setValue("Replacing the whole document.");
    expect(wrapper.get("dialog").text()).toContain("Change a system ID?");
    await vi.advanceTimersByTimeAsync(500);
    expect(state().files[0].versions).toHaveLength(3);
    expect(source.element.value).toBe(original);
    await wrapper.get("dialog").trigger("cancel");
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(document.activeElement).toBe(source.element);
    await source.setValue("Replacing the whole document.");
    await button(wrapper, "Apply this change");
    await vi.advanceTimersByTimeAsync(350);
    expect(state().files[0].versions[0].content).toBe(
      "Replacing the whole document.",
    );
  });
  it("right-clicks and keyboard menus target other items, leaving the open draft intact", async () => {
    const { wrapper, state } = view("save-error"),
      original = state().files[0].draft;
    const target = wrapper
      .findAll(".tree-row")
      .find((row) => row.text().includes("preparation.md"))!;
    await target.trigger("contextmenu", { clientX: 100, clientY: 100 });
    expect(
      wrapper.findAll('[role="menuitem"]').map((node) => node.text()),
    ).toEqual([
      "New file…",
      "New folder…",
      "Rename…",
      "Move to…",
      "Duplicate…",
      "Delete…",
    ]);
    expect(wrapper.get(".menu-context").text()).toBe("preparation.md");
    await wrapper.get('[role="menu"]').trigger("keydown", { key: "End" });
    expect((document.activeElement as HTMLElement).textContent).toBe("Delete…");
    await wrapper.get('[role="menu"]').trigger("keydown", { key: "Home" });
    expect((document.activeElement as HTMLElement).textContent).toBe(
      "New file…",
    );
    await button(wrapper, "Rename…");
    await wrapper.get(".name-form input").setValue("agenda.md");
    await wrapper.get("form").trigger("submit");
    expect(state().files[1].name).toBe("agenda.md");
    expect(state().files[0].draft).toBe(original);
    expect(state().currentKey).toBe("outline.md");
    await target.trigger("keydown", { key: "F10", shiftKey: true });
    expect(wrapper.get('[role="menu"]').text()).toContain("agenda.md");
    await wrapper.get('[role="menu"]').trigger("keydown", { key: "Escape" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Actions for agenda.md",
    );
  });
  it("keeps history read-only and includes metadata differences", async () => {
    const { wrapper, state } = view("history");
    const original = state().files[0].content;
    expect(wrapper.findAll(".diff-line.added").length).toBeGreaterThan(0);
    await wrapper.get(".history-controls input").setValue(false);
    wrapper
      .get(".markdown h1")
      .element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      );
    await vi.advanceTimersByTimeAsync(400);
    expect(wrapper.find('[aria-label="Markdown source"]').exists()).toBe(false);
    expect(state().files[0].content).toBe(original);
    await button(wrapper, "Back to current");
    expect(state().historical).toBeNull();
  });
  it("supports independent chats, attachments, missing references and close confirmation", async () => {
    const { wrapper, state } = view("chat");
    await wrapper.get('[aria-label="Message"]').setValue("Keep my draft");
    await button(wrapper, "New chat with this file");
    expect(state().chats).toHaveLength(2);
    expect(state().chats[0].draft).toBe("Keep my draft");
    expect(state().chats[1].draft).toBe("");
    const second = wrapper.get('[data-chat="chat-2"]');
    await second
      .get('[aria-label="Remove reference to outline.md"]')
      .trigger("click");
    expect(state().chats[1].references).toEqual([]);
    await second.get(".attach-file").trigger("click");
    await button(wrapper, "preparation.md · Projects/Autumn workshop");
    expect(state().chats[1].references[0].fileKey).toBe("preparation.md");
    await second.get(".attachment-link").trigger("click");
    expect(state().currentKey).toBe("preparation.md");
    await action(wrapper, "Delete…");
    await button(wrapper, "Delete file");
    expect(second.get(".attachment-chip").attributes("data-state")).toBe(
      "missing",
    );
    expect(second.get(".attachment-link").attributes("disabled")).toBeDefined();
    await button(wrapper, "Close pane — New chat");
    expect(wrapper.get("dialog").text()).toContain(
      "discard its unsent message",
    );
    await wrapper.get("dialog").trigger("cancel");
    expect(state().chats[0].draft).toBe("Keep my draft");
    await button(wrapper, "Close pane — New chat");
    await button(wrapper, "Discard message");
    expect(state().chats.map((chat) => chat.key)).toEqual(["chat-2"]);
    expect(
      wrapper.get('[aria-label="Send message"]').attributes("disabled"),
    ).toBeDefined();
  });
  it("keeps dialog fields in controlled JSON state and reflects external modal changes", async () => {
    const { wrapper, state } = view();
    await button(wrapper, "New file or folder");
    expect(
      wrapper.findAll('[role="menuitem"]').map((item) => item.text()),
    ).toEqual(["New file…", "New folder…"]);
    await button(wrapper, "New file…");
    await wrapper.get(".name-form input").setValue("shared-name.md");
    expect(state().dialog).toMatchObject({
      kind: "name",
      name: "shared-name.md",
      folder: "Projects/Autumn workshop",
    });
    expect(JSON.parse(JSON.stringify(state()))).toEqual(state());
    await wrapper.setProps({
      state: { ...state(), dialog: { kind: "attach", key: "chat-1" } },
    });
    expect(wrapper.get("dialog h2").text()).toBe("Attach a file");
    await wrapper.setProps({ state: { ...state(), dialog: null } });
    expect(wrapper.find("dialog").exists()).toBe(false);
  });
  it("creates from the empty view and switches existing files back to reading", async () => {
    const { wrapper, state } = view("empty");
    await button(wrapper, "New file");
    await wrapper.get(".name-form input").setValue("first.md");
    await wrapper.get("form").trigger("submit");
    expect(state().mode).toBe("source");
    expect(state().files[0].name).toBe("first.md");
    await wrapper.get(".file-entry").trigger("click");
    expect(state().mode).toBe("read");
    await wrapper.get(".markdown").trigger("keydown", { key: "Enter" });
    expect(state().mode).toBe("source");
  });
});

describe("Markdown safety", () => {
  it("renders HTML and JavaScript-looking text as text, never executable markup", () => {
    const content =
      '# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[run](javascript:alert(1))\n\n**Strong** and `code`\n\n```\n<iframe src="https://example.com">\n```';
    const wrapper = mount(MarkdownContent, { props: { content } });
    expect(wrapper.find("img, script, iframe, a").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>alert(1)</script>");
    expect(wrapper.get("strong").text()).toBe("Strong");
    expect(wrapper.get("code").text()).toBe("code");
  });
});

describe("touch context menus", () => {
  function pointer(
    element: Element,
    name: string,
    values: Record<string, unknown>,
  ) {
    const event = new Event(name, { bubbles: true });
    Object.assign(event, values);
    element.dispatchEvent(event);
  }
  it("opens after a hold, suppresses the release click, and cancels for movement or another touch", async () => {
    const wrapper = mount(FileTree, { props: { state: createEditorState() } });
    await vi.advanceTimersByTimeAsync(1);
    const row = wrapper.get(".tree-row"),
      target = {
        pointerType: "touch",
        isPrimary: true,
        pointerId: 1,
        button: 0,
        clientX: 40,
        clientY: 80,
      };
    pointer(row.element, "pointerdown", target);
    await vi.advanceTimersByTimeAsync(550);
    expect(wrapper.emitted("actions")).toHaveLength(1);
    pointer(row.element, "pointerup", target);
    await row.get(".entry").trigger("click");
    expect(wrapper.emitted("toggle")).toBeUndefined();
    pointer(row.element, "pointerdown", target);
    pointer(row.element, "pointermove", { ...target, clientY: 120 });
    await vi.advanceTimersByTimeAsync(550);
    expect(wrapper.emitted("actions")).toHaveLength(1);
    pointer(row.element, "pointerdown", target);
    pointer(wrapper.element, "pointerdown", {
      ...target,
      pointerId: 2,
      isPrimary: false,
    });
    await vi.advanceTimersByTimeAsync(550);
    expect(wrapper.emitted("actions")).toHaveLength(1);
  });
});

describe("separate editor controls", () => {
  it("selects a serializable modal preset without replacing file content", async () => {
    const original = createEditorState("source");
    const wrapper = mount(EditorControls, { props: { state: original } });
    await wrapper.get("select").setValue("id");
    const state = wrapper.emitted("update:state")![0][0] as EditorState;
    expect(state.dialog).toMatchObject({ kind: "id", key: "outline.md" });
    expect(state.files).toEqual(original.files);
    expect(original.dialog).toBeNull();
  });
  it("retries failed saves without resetting drafts or unrelated state", async () => {
    const original = createEditorState("save-error");
    const wrapper = mount(EditorControls, { props: { state: original } });
    await wrapper.get("input").setValue(false);
    const state = wrapper.emitted("update:state")![0][0] as EditorState;
    expect(state.files[0].content).toContain("A thought to keep working on.");
    expect(state.files[0].saveError).toBe(false);
    expect(original.files[0].saveError).toBe(true);
    expect(state.files[1]).toEqual(original.files[1]);
  });
});
