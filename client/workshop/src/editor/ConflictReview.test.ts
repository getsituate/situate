import "../ui/popover-test-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import FileEditorView from "./FileEditorView.vue";
import EditorControls from "./EditorControls.vue";
import {
  cloneEditorState,
  createEditorState,
  type EditorScene,
  type EditorState,
} from "./model";
import { automaticMerge } from "./conflicts";
enableAutoUnmount(afterEach);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function pair(scene: EditorScene) {
  let state = createEditorState(scene);
  const receive = (next: EditorState) => {
    state = next;
    void view.setProps({ state });
    void controls.setProps({ state });
  };
  const view = mount(FileEditorView, {
    attachTo: document.body,
    props: { state, "onUpdate:state": receive },
  });
  const controls = mount(EditorControls, {
    attachTo: document.body,
    props: { state, "onUpdate:state": receive },
  });
  return { view, controls, state: () => state, receive };
}
async function click(wrapper: VueWrapper, label: string) {
  const button = wrapper
    .findAll("button")
    .find(
      (button) =>
        button.text() === label || button.attributes("aria-label") === label,
    );
  expect(button, label).toBeDefined();
  await button!.trigger("click");
  await nextTick();
}
describe("conflict review and separate controls", () => {
  it("keeps review selection synchronous and controlled without mutating props", async () => {
    const original = createEditorState("conflict");
    const view = mount(FileEditorView, {
      attachTo: document.body,
      props: { state: original },
    });
    await view.get('input[value="file"]').setValue();
    const updated = view.emitted("update:state")!.at(-1)![0] as EditorState;
    expect(updated.conflict!.selected).toBe("file");
    expect(original.conflict!.selected).toBeNull();
    expect(JSON.parse(JSON.stringify(updated))).toEqual(updated);
    await click(view, "Apply selected version");
    expect(
      (view.emitted("update:state")!.at(-1)![0] as EditorState).conflict!
        .status,
    ).toBe("applying");
    expect(view.text()).not.toContain("Complete application");
  });
  it("dismisses and reopens with selection and independent inspection positions intact", async () => {
    const { view, state } = pair("conflict");
    expect(document.activeElement).toBe(
      view.get(".conflict-review h2").element,
    );
    await view.get('input[value="editor"]').setValue();
    const source = view.get<HTMLElement>('[data-source="editor"]');
    source.element.scrollTop = 120;
    await source.trigger("scroll");
    await click(view, "Inspect changed file");
    expect(state().conflict!.selected).toBe("editor");
    const changed = view.get<HTMLElement>('[data-source="file"]');
    changed.element.scrollTop = 220;
    await changed.trigger("scroll");
    await view.get("dialog").trigger("cancel");
    await nextTick();
    expect(state().conflict!.open).toBe(false);
    expect(document.activeElement).toBe(
      view
        .findAll("button")
        .find((button) => button.text() === "Review versions")!.element,
    );
    await click(view, "Review versions");
    expect(state().conflict!.scroll).toEqual({ editor: 120, file: 220 });
    expect(state().conflict!.selected).toBe("editor");
    expect(document.activeElement).toBe(
      view.get(".conflict-review h2").element,
    );
  });
  it("waits for explicit completion, focuses retry on failure and does not steal focus after hidden success", async () => {
    const { view, controls, state } = pair("conflict-failure");
    await view.get('input[value="file"]').setValue();
    await click(view, "Apply selected version");
    expect(state().conflict!.status).toBe("applying");
    expect(view.get("fieldset").attributes("disabled")).toBeDefined();
    await click(controls, "Complete application");
    expect(state().conflict!.status).toBe("failed");
    expect((document.activeElement as HTMLElement).textContent).toBe(
      "Retry selected version",
    );
    await click(view, "Retry selected version");
    await click(view, "Hide for now");
    const filter = view.get<HTMLInputElement>(".file-filter");
    filter.element.focus();
    await click(controls, "Complete application");
    expect(state().conflict!.status).toBe("resolved");
    expect(document.activeElement).toBe(filter.element);
    expect(state().files[0].content).toContain("Tea, introductions");
  });
  it("refreshes manually, clears selection, resets only changed-source scroll and focuses the heading", async () => {
    const { view, controls, state } = pair("conflict-race");
    await view.get('input[value="editor"]').setValue();
    await click(view, "Apply selected version");
    await click(controls, "Complete application");
    expect(state().conflict!.selected).toBeNull();
    expect(view.text()).toContain("copies below are out of date");
    await click(view, "Refresh versions");
    expect(state().conflict!.status).toBe("refreshing");
    await click(controls, "Complete refresh");
    expect(view.get('[data-source="file"]').text()).toContain(
      "Latest file update 2",
    );
    expect(document.activeElement).toBe(
      view.get(".conflict-review h2").element,
    );
    expect(view.get('input[value="editor"]').element).not.toHaveProperty(
      "checked",
      true,
    );
  });
  it("preserves source focus, selection and scroll on committed merges", async () => {
    const { view, controls, state, receive } = pair("merged");
    await click(controls, "Edit source");
    const source = view.get<HTMLTextAreaElement>(".source-text");
    source.element.focus();
    source.element.setSelectionRange(22, 30, "backward");
    source.element.scrollTop = 80;
    const next = cloneEditorState(state());
    automaticMerge(next);
    receive(next);
    await nextTick();
    await nextTick();
    expect(source.element.value).toContain(
      "A spare notebook is ready for each pair.",
    );
    expect([
      source.element.selectionStart,
      source.element.selectionEnd,
      source.element.selectionDirection,
      source.element.scrollTop,
    ]).toEqual([22, 30, "backward", 80]);
    expect(document.activeElement).toBe(source.element);
    expect(view.find(".conflict-retained").exists()).toBe(false);
  });
  it("leaves historical comparisons unchanged while the committed model advances", async () => {
    const { view, controls, state } = pair("merged");
    await click(controls, "Version history");
    await view.findAll(".version")[1].trigger("click");
    const content = view.get(".diff-view").text();
    await click(controls, "Simulate automatic merge");
    expect(view.get(".diff-view").text()).toBe(content);
    expect(state().files[0].content).toContain("A spare notebook");
    await click(view, "Back to current");
    expect(view.get(".markdown").text()).toContain("A spare notebook");
  });
});
