import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import PluginDevelopment from "./PluginDevelopment.vue";
import type { PresentationValue } from "../layout/navigation";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
enableAutoUnmount(afterEach);
let resize: (entries: { contentRect: { width: number } }[]) => void;
const before = "1".repeat(40),
  after = "2".repeat(40);
const activity = [
  {
    id: "edit",
    runId: "run",
    name: "edit_plugin_sources",
    args: {},
    state: "completed",
    result: {
      details: {
        change: {
          store: "plugin",
          pluginId: "mail",
          operation: "modified",
          before: { path: "entry.js", revision: before },
          after: { path: "entry.js", revision: after },
          attribution: "uncertain",
        },
      },
    },
  },
];
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resize) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  invoke.mockReset().mockImplementation((_command, { revision }) =>
    Promise.resolve({
      status: "available",
      text:
        revision === before
          ? "export const limit=10;\n"
          : "export const limit=20;\n",
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function development(presentation?: PresentationValue) {
  return mount(PluginDevelopment, {
    attachTo: document.body,
    props: { title: "Example", scope: "workspace", activity, presentation },
    slots: {
      default: '<textarea aria-label="Message">Retained draft</textarea>',
    },
  });
}
test("help traps keyboard focus and restores its invoker on dismissal", async () => {
  const wrapper = development();
  await wrapper.get(".development-help-trigger").trigger("click");
  await flushPromises();
  const close = wrapper.get("dialog button");
  expect(document.activeElement).toBe(close.element);
  await close.trigger("keydown", { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(
    wrapper.get(".development-help-body").element,
  );
  await wrapper
    .get(".development-help-body")
    .trigger("keydown", { key: "Tab" });
  expect(document.activeElement).toBe(close.element);
  await wrapper.get("dialog").trigger("cancel");
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(document.activeElement).toBe(
    wrapper.get(".development-help-trigger").element,
  );
});
test("Changes retains filter, revision selection, focus and draft through collapse and narrow switching", async () => {
  const wrapper = development();
  const composer = wrapper.get("textarea").element;
  expect(invoke).not.toHaveBeenCalled();
  await wrapper.get(".development-changes-toggle").trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(
    wrapper.get(".inspection-header h3").element,
  );
  await wrapper.get("input").setValue("entry");
  await wrapper.get(".file-row").trigger("click");
  await flushPromises();
  expect(wrapper.get("h4").text()).toBe(".situate/plugins/mail/code/entry.js");
  expect(wrapper.get(".diff-lines").text()).toContain("export const limit=10;");
  expect(wrapper.get(".diff-lines").text()).toContain("export const limit=20;");
  expect(invoke.mock.calls).toEqual([
    [
      "change_revision",
      {
        scope: "workspace",
        pluginId: "mail",
        path: "entry.js",
        revision: before,
      },
    ],
    [
      "change_revision",
      {
        scope: "workspace",
        pluginId: "mail",
        path: "entry.js",
        revision: after,
      },
    ],
  ]);
  await wrapper.get("aside").trigger("keydown", { key: "Escape" });
  expect(
    wrapper.get(".development-changes-toggle").attributes("aria-expanded"),
  ).toBe("false");
  expect(document.activeElement).toBe(
    wrapper.get(".development-changes-toggle").element,
  );
  await wrapper.get(".development-changes-toggle").trigger("click");
  await flushPromises();
  expect(wrapper.get(".diff-lines").text()).toContain("export const limit=20;");
  expect(invoke).toHaveBeenCalledTimes(2);
  resize([{ contentRect: { width: 390 } }]);
  await flushPromises();
  expect(wrapper.get(".development-layout").classes()).toContain(
    "show-changes",
  );
  await wrapper.get(".detail-pane .back").trigger("click");
  expect(document.activeElement).toBe(wrapper.get(".file-row").element);
  expect((wrapper.get("input").element as HTMLInputElement).value).toBe(
    "entry",
  );
  await wrapper.get("aside").trigger("keydown", { key: "Escape" });
  resize([{ contentRect: { width: 1200 } }]);
  await flushPromises();
  expect(wrapper.get(".development-layout").classes()).not.toContain(
    "show-changes",
  );
  expect(wrapper.get("textarea").element).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe("Retained draft");
  expect(wrapper.find('[role="tablist"],.code-browser').exists()).toBe(false);
});
test("shell history loads lazily and restores a selected deleted file without touching current content", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  invoke.mockImplementation((command) =>
    command === "change_list"
      ? pending
      : Promise.resolve({ status: "available", text: "# Prior note\\n" }),
  );
  const wrapper = mount(PluginDevelopment, {
    attachTo: document.body,
    props: {
      title: "Assignment",
      scope: "workspace",
      activity: [
        {
          id: "shell",
          runId: "run",
          name: "shell",
          args: { command: "rm old.md" },
          state: "completed",
          result: {
            details: {
              beforeHistoryRevision: before,
              afterHistoryRevision: after,
            },
          },
        },
      ],
      presentation: {
        open: true,
        navigation: { selected: "run:shell:0", pane: "file" },
      },
    },
  });
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe(
    "⟦assignmentChanges.loading⟧",
  );
  finish({
    status: "ready",
    changes: [
      {
        store: "workspace",
        operation: "deleted",
        before: { path: "old.md", revision: before },
        after: null,
        attribution: "uncertain",
      },
    ],
  });
  await flushPromises();
  expect(wrapper.get("h4").text()).toBe("old.md");
  expect(wrapper.get(".diff-lines").text()).toContain("# Prior note");
  expect(invoke.mock.calls).toEqual([
    ["change_list", { scope: "workspace", before, after }],
    [
      "change_revision",
      { scope: "workspace", path: "old.md", revision: before },
    ],
  ]);
});

test("source comparison loss is unavailable rather than an empty recorded change list", async () => {
  const wrapper = mount(PluginDevelopment, {
    props: {
      title: "Assignment",
      scope: "workspace",
      activity: [
        {
          id: "source",
          runId: "run",
          name: "edit_plugin_sources",
          args: {},
          state: "completed",
          result: { details: { changes: [], comparisonUnavailable: true } },
        },
      ],
      presentation: { open: true },
    },
  });
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe(
    "⟦assignmentChanges.unavailable⟧",
  );
  expect(wrapper.text()).not.toContain("⟦assignmentChanges.empty⟧");
  expect(invoke).not.toHaveBeenCalled();
});

test("restored inspection presentation loads only its selected historical pair", async () => {
  const wrapper = development({
    open: true,
    panel: "changes",
    expanded: true,
    navigation: {
      selected: "run:edit:0",
      query: "entry",
      pane: "file",
      page: 0,
      listScroll: 12,
      fileScroll: 24,
      revealed: {},
      lineLimit: 800,
    },
  });
  await flushPromises();
  expect(wrapper.get(".development-layout").classes()).toContain(
    "changes-expanded",
  );
  expect((wrapper.get("input").element as HTMLInputElement).value).toBe(
    "entry",
  );
  expect(wrapper.get("h4").text()).toContain("entry.js");
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(wrapper.get(".diff-lines").text()).toContain("export const limit=20;");
});
