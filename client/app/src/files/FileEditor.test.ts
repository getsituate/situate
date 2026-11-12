import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
  DOMWrapper,
} from "@vue/test-utils";
import FileEditor from "./FileEditor.vue";
import RenderedFile from "./RenderedFile.vue";
import { defineComponent, h, ref, shallowRef } from "vue";
import { de, preferences, setPreferences } from "@situate/localization";
import { filesRequest } from "./api";
import {
  releaseWorkspace,
  retainedWorkspaces,
  workspaceSession,
  pollWorkspace,
  saveFile,
} from "./sessions";
import type { PresentationValue } from "../layout/navigation";
import type { FilePaneNavigation } from "./presentation";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  filesRequest: vi.fn(),
}));
const invoke = vi.mocked(filesRequest);
let serial = 0;
const calls = () => invoke.mock.calls.map(([request]) => request);
function button(wrapper: Pick<VueWrapper, "findAll">, label: string) {
  return wrapper
    .findAll("button")
    .find(
      (button) =>
        button.attributes("aria-label") === label || button.text() === label,
    )!;
}
function menu() {
  const opened = [
    ...document.querySelectorAll('.file-action-menu[role="menu"]'),
  ].filter((element) => element.matches(":popover-open"));
  expect(opened).toHaveLength(1);
  return new DOMWrapper(opened[0]!);
}
async function openMenu(wrapper: Pick<VueWrapper, "findAll">, label: string) {
  const trigger = button(wrapper, label);
  vi.spyOn(trigger.element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 44, 44),
  );
  await trigger.trigger("click");
  await flushPromises();
  return menu();
}
async function choose(
  wrapper: Pick<VueWrapper, "findAll">,
  trigger: string,
  label: string,
) {
  const opened = await openMenu(wrapper, trigger);
  const action = opened
    .findAll<HTMLButtonElement>('[role^="menuitem"]')
    .find((button) => button.text().replace("✓", "").trim() === label);
  expect(action, `Menu action: ${label}`).toBeDefined();
  action!.element.click();
  await flushPromises();
}
async function setup(writable = true) {
  const id = `editor-${++serial}`;
  const files: Record<string, string> = {
    "Notes/Garden.md":
      "---\nsituate-id: hidden\n---\n# Garden\n\nTea ☕ outside.",
    "Notes/Reading.md": "# Reading",
  };
  invoke.mockImplementation(async (request) => {
    const path = request.path ?? "";
    switch (request.operation) {
      case "snapshot":
        return {
          status: "ok",
          snapshot: {
            writable,
            canExport: true,
            reason: null,
            entries: [
              { path: "Notes", isDirectory: true },
              ...Object.keys(files).map((path) => ({
                path,
                isDirectory: false,
              })),
            ],
            drafts: [],
            deleted: [],
          },
        };
      case "read":
        return {
          status: "ok",
          document: {
            path,
            version: { text: files[path] ?? "", revision: "base" },
            html: "<h1>Garden</h1>",
            issues: [],
          },
        };
      case "create":
        files[path] = "";
        return {
          status: "saved",
          document: {
            path,
            version: { text: "", revision: "created" },
            html: "",
            issues: [],
          },
        };
      case "stage":
      case "mkdir":
      case "copy":
        return { status: "ok" };
      case "rename":
        for (const source of Object.keys(files)) {
          if (source === path || source.startsWith(`${path}/`)) {
            files[request.destination + source.slice(path.length)] =
              files[source]!;
            delete files[source];
          }
        }
        return { status: "ok" };
      case "delete":
        delete files[path];
        return { status: "ok" };
      case "save":
        files[path] = request.text;
        return {
          status: "saved",
          document: {
            path,
            version: { text: request.text, revision: "saved" },
            html: "",
            issues: [],
          },
        };
      case "history":
        return {
          status: "ok",
          history: [
            {
              revision: "earlier",
              message: "Earlier planting plan",
              timestamp: 1791100000,
              path,
            },
          ],
        };
      case "revision":
        return {
          status: "ok",
          document: {
            path,
            version: { text: "# Earlier garden", revision: "earlier" },
            html: "<h1>Earlier garden</h1>",
            issues: [],
          },
        };
      default:
        throw new Error(`Unexpected operation ${request.operation}`);
    }
  });
  const wrapper = mount(FileEditor, {
    attachTo: document.body,
    props: {
      workspaceId: id,
      workspaceName: "Garden notes",
      showNavigation: true,
    },
  });
  await flushPromises();
  await button(wrapper, "Garden.md").trigger("click");
  await flushPromises();
  return { wrapper, session: workspaceSession(id) };
}
enableAutoUnmount(afterEach);
beforeEach(() => {
  invoke.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.useRealTimers();
  retainedWorkspaces().forEach(releaseWorkspace);
  document.body.replaceChildren();
});

async function pane(
  workspaceId: string,
  path: string,
  presentation: PresentationValue = { mode: "source" },
  revision?: string,
) {
  const wrapper = mount(FileEditor, {
    attachTo: document.body,
    props: {
      workspaceId,
      workspaceName: "Notes",
      target: { contentId: path, revision },
      presentation,
      embedded: true,
    },
  });
  await flushPromises();
  return wrapper;
}
describe("file panes", () => {
  async function echoingPane(workspaceId: string, initial: PresentationValue) {
    const host = mount(
      defineComponent({
        setup() {
          const presentation = shallowRef(initial);
          return () =>
            h(FileEditor, {
              workspaceId,
              workspaceName: "Notes",
              embedded: true,
              target: { contentId: "Notes/Garden.md" },
              presentation: presentation.value,
              onPresentation: (value: PresentationValue) => {
                presentation.value = value;
              },
            });
        },
      }),
      { attachTo: document.body },
    );
    await flushPromises();
    return host.getComponent(FileEditor);
  }
  it("switches source to read while the host echoes every presentation update", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await echoingPane(session.id, { mode: "source" });
    editor.get<HTMLTextAreaElement>("textarea").element.setSelectionRange(4, 6);
    await choose(editor, "⟦files.fileActions⟧", "⟦files.read⟧");
    expect(editor.find("textarea").exists()).toBe(false);
    expect(editor.getComponent(RenderedFile).props("text")).toContain(
      "# Garden",
    );
  });
  it("keeps the clicked source offset when an older mode update is echoed", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await echoingPane(session.id, { mode: "read" });
    editor.getComponent(RenderedFile).vm.$emit("editSource", 31);
    await flushPromises();
    const source = editor.get<HTMLTextAreaElement>("textarea").element;
    expect(document.activeElement).toBe(source);
    expect(source.selectionStart).toBe(31);
    expect(source.selectionEnd).toBe(31);
  });
  async function navigatingPane(workspaceId: string) {
    const host = mount(
      defineComponent({
        setup() {
          const target = ref({
            contentId: "Notes/Garden.md",
            revision: undefined as string | undefined,
          });
          const presentation = shallowRef<PresentationValue>({
            mode: "source",
          });
          return () => {
            const active = target.value;
            return h(FileEditor, {
              key: `${active.contentId}:${active.revision}`,
              workspaceId,
              workspaceName: "Notes",
              embedded: true,
              target: { ...active },
              presentation: presentation.value,
              onPresentation: (value: PresentationValue) => {
                if (target.value === active) presentation.value = value;
              },
              onNavigate: (
                next: FilePaneNavigation,
                value?: PresentationValue,
              ) => {
                target.value = {
                  contentId: next.contentId ?? "",
                  revision: next.revision,
                };
                presentation.value = value ?? null;
              },
            });
          };
        },
      }),
      { attachTo: document.body },
    );
    await flushPromises();
    return host;
  }
  it("retains source mode and live selection across historical navigation and return", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const host = await navigatingPane(session.id);
    let editor = host.getComponent(FileEditor);
    await choose(
      editor,
      '⟦files.actionsFor:{"name":"Notes/Reading.md"}⟧',
      "⟦files.versionHistory⟧",
    );
    await editor.get(".version").trigger("click");
    await flushPromises();
    editor = host.getComponent(FileEditor);
    expect(editor.get<HTMLTextAreaElement>("textarea").element.value).toBe(
      "# Earlier garden",
    );
    expect(editor.get("textarea").attributes("readonly")).toBeDefined();
    expect(editor.find(".historical-date").exists()).toBe(true);
    await button(editor, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    expect(editor.get(".version").attributes("aria-pressed")).toBe("true");
    await button(editor, "⟦files.returnToCurrentFile⟧").trigger("click");
    await flushPromises();
    editor = host.getComponent(FileEditor);
    expect(editor.get(".document-location h3").text()).toBe("Garden.md");
    expect(editor.get<HTMLTextAreaElement>("textarea").element.value).toContain(
      "Tea ☕ outside.",
    );
    expect(editor.get("textarea").attributes("readonly")).toBeUndefined();
  });
  it("restores tombstones without reading nonexistent content and keeps the originating history context", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const implementation = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (request) =>
      request.operation === "history"
        ? {
            status: "ok",
            history: [
              {
                revision: "removed",
                timestamp: 1791100001,
                message: "Remove note",
                path: "Archive/Old.md",
                deleted: true,
              },
            ],
          }
        : implementation(request),
    );
    const host = await navigatingPane(session.id);
    let editor = host.getComponent(FileEditor);
    await button(editor, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    await editor.get(".version").trigger("click");
    await flushPromises();
    editor = host.getComponent(FileEditor);
    expect(editor.get(".empty-document h2").text()).toBe(
      "⟦files.fileDeletedInThisChange⟧",
    );
    expect(calls().some((request) => request.operation === "revision")).toBe(
      false,
    );
    await button(editor, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    expect(
      calls()
        .filter((request) => request.operation === "history")
        .at(-1),
    ).toEqual({
      workspaceId: session.id,
      operation: "history",
      path: "Notes/Garden.md",
    });
    expect(editor.get(".version").attributes("aria-pressed")).toBe("true");
  });
  it("ignores an older emitted caret snapshot but applies a new controlled restoration", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await pane(session.id, "Notes/Garden.md", { mode: "read" });
    editor.getComponent(RenderedFile).vm.$emit("editSource", 31);
    await flushPromises();
    const stale = editor.emitted("presentation")![0]![0] as PresentationValue;
    await editor.setProps({ presentation: stale });
    await flushPromises();
    expect(
      editor.get<HTMLTextAreaElement>("textarea").element.selectionStart,
    ).toBe(31);
    await editor.setProps({
      presentation: { mode: "source", selectionStart: 4, selectionEnd: 7 },
    });
    await flushPromises();
    expect(
      editor.get<HTMLTextAreaElement>("textarea").element.selectionStart,
    ).toBe(4);
    expect(
      editor.get<HTMLTextAreaElement>("textarea").element.selectionEnd,
    ).toBe(7);
  });
  it("retains the deleted-file history seed when a historical target is restored", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await pane(
      session.id,
      "Archive/Old.md",
      {
        mode: "source",
        history: {
          currentPath: "",
          path: "Notes/Old.md",
          exactPath: true,
          seed: "retained",
          version: {
            revision: "removed",
            message: "Remove note",
            timestamp: 1791100000,
            path: "Archive/Old.md",
            deleted: true,
          },
        },
      },
      "removed",
    );
    expect(editor.get(".empty-document h2").text()).toBe(
      "⟦files.fileDeletedInThisChange⟧",
    );
    expect(calls().some((request) => request.operation === "revision")).toBe(
      false,
    );
    await button(editor, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    expect(
      calls()
        .filter((request) => request.operation === "history")
        .at(-1),
    ).toEqual({
      workspaceId: session.id,
      operation: "history",
      path: "Notes/Old.md",
      exactPath: true,
      revision: "retained",
    });
  });
  it("keeps history open when the host echoes presentation with an equal target", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await pane(session.id, "Notes/Garden.md", {
      mode: "read",
      treeOpen: true,
    });
    await button(editor, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    expect(editor.find(".version-panel").exists()).toBe(true);
    const presentation = editor
      .emitted("presentation")!
      .at(-1)![0] as PresentationValue;
    invoke.mockClear();
    await editor.setProps({
      target: { contentId: "Notes/Garden.md" },
      presentation,
    });
    await flushPromises();
    expect(editor.find(".version-panel").exists()).toBe(true);
    expect(editor.get(".version").text()).toContain("Earlier planting plan");
    expect(
      calls().some(
        (call) => call.operation === "read" || call.operation === "history",
      ),
    ).toBe(false);
  });
  it("retains the focused editor, caret and scroll when the host echoes source presentation", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await pane(session.id, "Notes/Garden.md");
    const source = editor.get<HTMLTextAreaElement>("textarea");
    source.element.focus();
    source.element.setSelectionRange(5, 9);
    source.element.scrollTop = 44;
    await source.trigger("select");
    const presentation = editor
      .emitted("presentation")!
      .at(-1)![0] as PresentationValue;
    invoke.mockClear();
    await editor.setProps({
      target: { contentId: "Notes/Garden.md" },
      presentation,
    });
    await flushPromises();
    expect(editor.get("textarea").element).toBe(source.element);
    expect(document.activeElement).toBe(source.element);
    expect(source.element.selectionStart).toBe(5);
    expect(source.element.selectionEnd).toBe(9);
    expect(source.element.scrollTop).toBe(44);
    expect(calls().some((call) => call.operation === "read")).toBe(false);
  });
  it("distinguishes an explicit empty target from legacy workspace selection", async () => {
    const { wrapper } = await setup();
    expect(wrapper.get(".document-location h3").text()).toBe("Garden.md");
    await wrapper.setProps({ target: {} });
    await flushPromises();
    expect(wrapper.findComponent(RenderedFile).exists()).toBe(false);
    expect(wrapper.get(".file-browser").isVisible()).toBe(true);
    await wrapper.setProps({ target: undefined });
    await flushPromises();
    expect(wrapper.get(".document-location h3").text()).toBe("Garden.md");
    expect(wrapper.findComponent(RenderedFile).exists()).toBe(true);
  });
  it("preserves the open browser and its width when selecting Markdown files", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await pane(session.id, "", {
      treeOpen: true,
      treeWidth: 320,
    });
    await button(editor, "Garden.md").trigger("click");
    await flushPromises();
    const [target, presentation] = editor.emitted("navigate")!.at(-1)!;
    expect(presentation).toEqual({ treeOpen: true, treeWidth: 320 });
    await editor.setProps({
      target: target as FilePaneNavigation,
      presentation: presentation as PresentationValue,
    });
    await flushPromises();
    expect(editor.get(".file-browser").isVisible()).toBe(true);
    await button(editor, "Reading.md").trigger("click");
    expect(editor.emitted("navigate")!.at(-1)![1]).toEqual({
      treeOpen: true,
      treeWidth: 320,
    });
  });
  it("retains a resized browser across collapse and remount without changing other panes", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await pane(session.id, "Notes/Garden.md", {
      treeOpen: true,
    });
    const other = await pane(session.id, "Notes/Reading.md", {
      treeOpen: true,
    });
    const handle = editor.get('[role="separator"]');
    expect(handle.attributes("aria-controls")).toBe(
      editor.get(".file-browser").attributes("id"),
    );
    await handle.trigger("keydown", { key: "ArrowRight", shiftKey: true });
    expect(handle.attributes("aria-valuenow")).toBe("260");
    await button(editor, "⟦files.collapseFileBrowser⟧").trigger("click");
    expect(editor.get(".file-browser").isVisible()).toBe(false);
    await button(editor, "⟦files.expandFileBrowser⟧").trigger("click");
    expect(handle.attributes("aria-valuenow")).toBe("260");
    const presentation = editor
      .emitted("presentation")!
      .at(-1)![0] as PresentationValue;
    editor.unmount();
    const restored = await pane(session.id, "Notes/Garden.md", presentation);
    expect(restored.get('[role="separator"]').attributes("aria-valuenow")).toBe(
      "260",
    );
    expect(other.get('[role="separator"]').attributes("aria-valuenow")).toBe(
      "228",
    );
  });
  it("keeps the legacy browser collapsed when another Markdown file is selected", async () => {
    const { wrapper } = await setup();
    await button(wrapper, "⟦files.collapseFileBrowser⟧").trigger("click");
    await button(wrapper, "Reading.md").trigger("click");
    await flushPromises();
    expect(wrapper.get(".file-browser").isVisible()).toBe(false);
  });
  it("requests source presentation only when navigating to a newly created file", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const editor = await pane(session.id, "Notes/Garden.md", {
      mode: "read",
      treeOpen: true,
    });
    await choose(editor, "⟦files.newFileOrFolder⟧", "⟦files.newFileDetail⟧");
    await editor.get("input[autofocus]").setValue("Planting");
    await editor.get("form").trigger("submit");
    await flushPromises();
    expect(editor.emitted("navigate")?.at(-1)).toEqual([
      { kind: "view", viewId: "files", contentId: "Planting.md" },
      { mode: "source" },
    ]);
    expect(editor.findComponent(RenderedFile).exists()).toBe(true);
    expect(editor.get(".document-location h3").text()).toBe("Garden.md");
    await editor.setProps({
      target: { contentId: "Planting.md" },
      presentation: { mode: "source" },
    });
    await flushPromises();
    expect(editor.get<HTMLTextAreaElement>("textarea").element.value).toBe("");
    await button(editor, "⟦files.expandFileBrowser⟧").trigger("click");
    await button(editor, "Reading.md").trigger("click");
    await flushPromises();
    expect(editor.emitted("navigate")?.at(-1)).toEqual([
      { kind: "view", viewId: "files", contentId: "Notes/Reading.md" },
      { treeOpen: true, treeWidth: 228 },
    ]);
  });
  it("keeps different targets and modes local and routes file and rendered links through navigation", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const first = await pane(session.id, "Notes/Garden.md", {
      mode: "read",
      treeOpen: true,
    });
    const second = await pane(session.id, "Notes/Reading.md");
    expect(first.getComponent(RenderedFile).props("text")).toContain("Garden");
    expect(second.get<HTMLTextAreaElement>("textarea").element.value).toBe(
      "# Reading",
    );
    await button(first, "Reading.md").trigger("click");
    await flushPromises();
    expect(first.emitted("navigate")?.at(-1)).toEqual([
      { kind: "view", viewId: "files", contentId: "Notes/Reading.md" },
      { treeOpen: true, treeWidth: 228 },
    ]);
    first.getComponent(RenderedFile).vm.$emit("navigate", "Notes/Reading.md");
    await flushPromises();
    expect(first.emitted("navigate")).toHaveLength(2);
    expect(first.get(".document-location h3").text()).toBe("Garden.md");
    expect(second.get(".document-location h3").text()).toBe("Reading.md");
    expect(session.selected).toBe("Notes/Garden.md");
    invoke.mockClear();
    await Promise.all([pollWorkspace(session), pollWorkspace(session)]);
    expect(
      calls().filter((call) => call.operation === "snapshot"),
    ).toHaveLength(1);
    expect(
      calls()
        .filter((call) => call.operation === "read")
        .map((call) => call.path)
        .sort(),
    ).toEqual(["Notes/Garden.md", "Notes/Reading.md"]);
  });
  it("shares a draft while preserving each cursor and restores presentation after remount", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const first = await pane(session.id, "Notes/Garden.md", {
      mode: "source",
      selectionStart: 2,
      selectionEnd: 4,
      scrollTop: 12,
    });
    const second = await pane(session.id, "Notes/Garden.md", {
      mode: "source",
      selectionStart: 8,
      selectionEnd: 8,
      scrollTop: 30,
    });
    const a = first.get<HTMLTextAreaElement>("textarea");
    const b = second.get<HTMLTextAreaElement>("textarea");
    expect(a.element.selectionStart).toBe(2);
    expect(b.element.selectionStart).toBe(8);
    await a.setValue("# Shared garden text");
    await flushPromises();
    expect(b.element.value).toBe("# Shared garden text");
    expect(b.element.selectionStart).toBe(8);
    a.element.setSelectionRange(5, 7);
    a.element.scrollTop = 42;
    await a.trigger("select");
    const retained = first
      .emitted("presentation")!
      .at(-1)![0] as PresentationValue;
    first.unmount();
    const restored = await pane(session.id, "Notes/Garden.md", retained);
    expect(
      restored.get<HTMLTextAreaElement>("textarea").element.selectionStart,
    ).toBe(5);
    expect(
      restored.get<HTMLTextAreaElement>("textarea").element.selectionEnd,
    ).toBe(7);
    expect(
      restored.get<HTMLTextAreaElement>("textarea").element.scrollTop,
    ).toBe(42);
    expect(restored.get<HTMLTextAreaElement>("textarea").element.value).toBe(
      "# Shared garden text",
    );
    expect(b.element.selectionStart).toBe(8);
    await restored.setProps({
      presentation: { mode: "read", readScrollTop: 64 },
    });
    await flushPromises();
    expect(restored.find("textarea").exists()).toBe(false);
    expect(
      restored.get<HTMLElement>(".document-scroll").element.scrollTop,
    ).toBe(64);
    expect(second.find("textarea").exists()).toBe(true);
  });
  it("shows generic frontmatter warnings without blocking or rewriting source editing", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const source = "---\ncustom: [broken\n---\n# Body";
    const file = session.files["Notes/Garden.md"]!;
    file.text = source;
    const document = {
      ...file.document!,
      version: { text: source, revision: "saved" },
      issues: [{ line: 2, message: "native.metadata.invalidYaml" }],
    };
    const implementation = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (request) =>
      request.operation === "read" && request.path === "Notes/Garden.md"
        ? { status: "ok", document }
        : implementation(request),
    );
    const editor = await pane(session.id, "Notes/Garden.md");
    expect(editor.text()).toContain("native.metadata.invalidYaml");
    expect(button(editor, "⟦files.inspectSource⟧").exists()).toBe(true);
    expect(editor.get<HTMLTextAreaElement>("textarea").element.value).toBe(
      source,
    );
    await editor.get("textarea").setValue(source + "\nMore");
    expect(file.text).toBe(source + "\nMore");
    expect(file.text).toContain("custom: [broken");
  });
  it("keeps an outstanding save and newer shared edits when its pane unmounts", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const first = await pane(session.id, "Notes/Garden.md");
    const second = await pane(session.id, "Notes/Garden.md");
    await first.get("textarea").setValue("# Submitted");
    await flushPromises();
    const implementation = invoke.getMockImplementation()!;
    let complete!: () => void;
    invoke.mockImplementation(async (request) => {
      if (request.operation === "save") {
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
      }
      return implementation(request);
    });
    const file = session.files["Notes/Garden.md"]!;
    const saving = saveFile(session, file);
    await flushPromises();
    expect(file.saving).toBe(true);
    await second.get("textarea").setValue("# Newer");
    first.unmount();
    complete();
    await saving;
    await flushPromises();
    expect(file.dirty).toBe(true);
    expect(file.text).toBe("# Newer");
    expect(second.get<HTMLTextAreaElement>("textarea").element.value).toBe(
      "# Newer",
    );
    expect(file.base?.text).toBe("# Submitted");
  });
  it("updates both loaded identities after a rename and retains text after delete", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const first = await pane(session.id, "Notes/Garden.md");
    const second = await pane(session.id, "Notes/Garden.md");
    await first.get("textarea").setValue("# Saved before moving");
    await flushPromises();
    await choose(first, "⟦files.fileActions⟧", "⟦files.renameDetail⟧");
    await first.get("input[autofocus]").setValue("Plants.md");
    await first.get("form").trigger("submit");
    await flushPromises();
    expect(first.emitted("identity")?.at(-1)).toEqual([
      {
        workspaceId: session.id,
        kind: "rename",
        from: "Notes/Garden.md",
        to: "Notes/Plants.md",
      },
    ]);
    expect(second.get(".document-location h3").text()).toBe("Plants.md");
    expect(session.files["Notes/Garden.md"]).toBeUndefined();
    expect(session.files["Notes/Plants.md"]?.text).toBe(
      "# Saved before moving",
    );
    await choose(first, "⟦files.fileActions⟧", "⟦files.deleteDetail⟧");
    await first.get("form").trigger("submit");
    await flushPromises();
    expect(first.emitted("identity")?.at(-1)).toEqual([
      { workspaceId: session.id, kind: "delete", path: "Notes/Plants.md" },
    ]);
    expect(session.files["Notes/Plants.md"]?.text).toBe(
      "# Saved before moving",
    );
    expect(session.files["Notes/Plants.md"]?.outcome?.status).toBe("deleted");
    expect(second.text()).toContain(
      "⟦files.theFileWasDeletedYourTextIsRetained⟧",
    );
  });
  it("emits live and exact historical references without creating chats", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const live = await pane(session.id, "Notes/Garden.md");
    const past = await pane(
      session.id,
      "Notes/Garden.md",
      { mode: "source" },
      "earlier",
    );
    expect(past.get<HTMLTextAreaElement>("textarea").element.value).toBe(
      "# Earlier garden",
    );
    expect(past.get("textarea").attributes("readonly")).toBeDefined();
    await button(live, "⟦files.newChatWithThisFile⟧").trigger("click");
    await button(past, "⟦files.newChatWithThisFile⟧").trigger("click");
    expect(live.emitted("reference")).toEqual([
      [
        {
          kind: "live",
          workspaceId: session.id,
          path: "Notes/Garden.md",
          expectedRevision: "base",
        },
      ],
    ]);
    expect(past.emitted("reference")).toEqual([
      [
        {
          kind: "historical",
          workspaceId: session.id,
          path: "Notes/Garden.md",
          revision: "earlier",
        },
      ],
    ]);
    await button(past, "⟦files.returnToCurrentFile⟧").trigger("click");
    expect(past.emitted("navigate")).toEqual([
      [
        { kind: "view", viewId: "files", contentId: "Notes/Garden.md" },
        expect.objectContaining({ mode: "source", history: null }),
      ],
    ]);
    expect(live.get<HTMLTextAreaElement>("textarea").element.value).toContain(
      "Tea",
    );
  });
  it.each(["Markdown", "text"] as const)(
    "retains the %s anchor through editor loading and polling after path reuse",
    async (format) => {
      const { wrapper, session } = await setup();
      wrapper.unmount();
      const original = session.files["Notes/Garden.md"]!.document!;
      const reference = {
        kind: "live" as const,
        workspaceId: session.id,
        path: "Notes/Garden.md",
        anchorRevision: "a".repeat(40),
      };
      const implementation = invoke.getMockImplementation()!;
      let resolved = {
        ...original,
        path: format === "Markdown" ? "Notes/Moved.md" : "Notes/Moved.txt",
      };
      let available = true;
      invoke.mockImplementation(async (request) => {
        if (request.operation === "resolveReference") {
          if (!available) throw new Error("references.unavailable");
          return {
            status: "ok",
            reference,
            document: resolved,
          };
        }
        if (request.operation === "read" && request.path === reference.path)
          return {
            status: "ok",
            document: {
              ...original,
              version: {
                text: "Unrelated replacement",
                revision: "replacement",
              },
            },
          };
        return implementation(request);
      });
      invoke.mockClear();
      const reader = await pane(session.id, reference.path, {
        mode: "source",
        reference,
      });
      await vi.waitFor(() =>
        expect(
          reader.get<HTMLTextAreaElement>("textarea").element.value,
        ).toContain("Tea"),
      );
      expect(reader.get(".document-location h3").text()).toBe(
        format === "Markdown" ? "Moved.md" : "Moved.txt",
      );
      expect(calls()).toContainEqual({
        workspaceId: session.id,
        operation: "resolveReference",
        reference,
        render: true,
      });
      resolved = {
        ...resolved,
        version: { text: "Original, updated", revision: "updated" },
      };
      await pollWorkspace(session);
      await flushPromises();
      expect(reader.get<HTMLTextAreaElement>("textarea").element.value).toBe(
        "Original, updated",
      );
      available = false;
      await pollWorkspace(session);
      await flushPromises();
      expect(reader.get("[role=alert]").text()).toContain(
        "⟦references.unavailable⟧",
      );
      available = true;
      await button(reader, "⟦navigation.retry⟧").trigger("click");
      await vi.waitFor(() =>
        expect(reader.find("[role=alert]").exists()).toBe(false),
      );
      expect(
        calls().some((call) =>
          ["stage", "save", "captureReference"].includes(call.operation),
        ),
      ).toBe(false);
      expect(
        calls().some(
          (call) => call.operation === "read" && call.path === reference.path,
        ),
      ).toBe(false);
    },
  );

  it("retries a failed reference load without dropping its identity", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    const original = session.files["Notes/Garden.md"]!.document!;
    delete session.files["Notes/Garden.md"];
    const reference = {
      kind: "live" as const,
      workspaceId: session.id,
      path: "Notes/Garden.md",
      anchorRevision: "a".repeat(40),
    };
    const implementation = invoke.getMockImplementation()!;
    let available = false;
    invoke.mockImplementation(async (request) => {
      if (request.operation === "resolveReference") {
        if (!available) throw new Error("references.unavailable");
        return {
          status: "ok",
          reference,
          document: { ...original, path: "Notes/Moved.md" },
        };
      }
      return implementation(request);
    });
    const reader = await pane(session.id, reference.path, {
      mode: "source",
      reference,
    });
    await vi.waitFor(() =>
      expect(reader.get("[role=alert]").text()).toContain(
        "⟦references.unavailable⟧",
      ),
    );
    expect(reader.find("textarea").exists()).toBe(false);
    available = true;
    invoke.mockClear();
    await button(reader, "⟦navigation.retry⟧").trigger("click");
    await vi.waitFor(() =>
      expect(
        reader.get<HTMLTextAreaElement>("textarea").element.value,
      ).toContain("Tea"),
    );
    expect(reader.get(".document-location h3").text()).toBe("Moved.md");
    expect(reader.find("[role=alert]").exists()).toBe(false);
    expect(calls()).toContainEqual({
      workspaceId: session.id,
      operation: "resolveReference",
      reference,
      render: true,
    });
    expect(calls().some((call) => call.operation === "read")).toBe(false);
  });

  it.each([undefined, "11111111-1111-4111-8111-111111111111"])(
    "does not recapture or overwrite an unreadable stored selector: %s",
    async (fileId) => {
      const { wrapper, session } = await setup();
      wrapper.unmount();
      invoke.mockClear();
      const reader = await pane(session.id, "Notes/Garden.md", {
        reference: {
          kind: "live",
          workspaceId: session.id,
          path: "Notes/Garden.md",
          ...(fileId ? { fileId } : {}),
        },
      });
      expect(reader.find("textarea").exists()).toBe(false);
      expect(reader.text()).toContain("⟦native.content.reference.invalid⟧");
      await reader
        .get(".file-browser-resize")
        .trigger("keydown", { key: "ArrowRight" });
      await flushPromises();
      expect(reader.emitted("presentation")).toBeUndefined();
      expect(
        calls().some((call) =>
          ["read", "captureReference", "stage", "save"].includes(
            call.operation,
          ),
        ),
      ).toBe(false);
    },
  );

  it("rejects unsafe controlled targets before file reads", async () => {
    const { wrapper, session } = await setup();
    wrapper.unmount();
    invoke.mockClear();
    const invalid = await pane(session.id, "../private.md");
    expect(calls().some((call) => call.operation === "read")).toBe(false);
    expect(invalid.find("textarea").exists()).toBe(false);
  });
});
describe("file editor actions", () => {
  it("uses aligned headers, actual parent path and footers without permanent mode controls", async () => {
    const { wrapper } = await setup();
    expect(wrapper.find(".files-header").exists()).toBe(false);
    expect(wrapper.get(".document-location p").text()).toBe("Notes");
    expect(wrapper.get(".browser-header").text()).toBe("⟦navigation.files⟧");
    expect(wrapper.get(".browser-footer").text()).toContain(
      '⟦files.countMany:{"count":2}⟧',
    );
    expect(wrapper.get(".document-footer").text()).toContain(
      "⟦files.markdown⟧",
    );
    expect(wrapper.get(".document-footer").text()).toContain("⟦files.saved⟧");
    expect(
      wrapper
        .findAll("button")
        .some((button) =>
          ["⟦files.read⟧", "Source", "⟦files.editSource⟧"].includes(
            button.text(),
          ),
        ),
    ).toBe(false);
    expect(button(wrapper, "⟦navigation.openNavigation⟧")).toBeDefined();
    await button(wrapper, "⟦files.closeFiles⟧").trigger("click");
    expect(wrapper.emitted("leave")).toHaveLength(1);
  });
  it.each([
    ["⟦files.newFileOrFolder⟧", "Planting", "Planting.md"],
    [
      '⟦files.actionsFor:{"name":"Notes/Garden.md"}⟧',
      "Planting",
      "Notes/Planting.md",
    ],
    ['⟦files.actionsFor:{"name":"Notes"}⟧', "Planting", "Notes/Planting.md"],
  ])("creates in the context of %s", async (trigger, name, expected) => {
    const { wrapper } = await setup();
    await choose(wrapper, trigger, "⟦files.newFileDetail⟧");
    await wrapper.get("input[autofocus]").setValue(name);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(calls().find((call) => call.operation === "create")?.path).toBe(
      expected,
    );
    expect(wrapper.get(".document-location h3").text()).toBe("Planting.md");
  });
  it.each([
    ["⟦files.renameDetail⟧", "Books.md", "rename", "Notes/Books.md"],
    ["⟦files.moveToDetail⟧", "", "rename", "Reading.md"],
    ["⟦files.duplicateDetail⟧", "Notes/Books.md", "copy", "Notes/Books.md"],
  ])(
    "keeps the current document selected while applying %s to another item",
    async (label, value, operation, destination) => {
      const { wrapper, session } = await setup();
      await choose(
        wrapper,
        '⟦files.actionsFor:{"name":"Notes/Reading.md"}⟧',
        label,
      );
      await wrapper.get("input[autofocus]").setValue(value);
      await wrapper.get("form").trigger("submit");
      await flushPromises();
      expect(
        calls().find((call) => call.operation === operation),
      ).toMatchObject({ path: "Notes/Reading.md", destination });
      expect(session.selected).toBe("Notes/Garden.md");
    },
  );
  it("can inspect another item history without opening it as the current document", async () => {
    const { wrapper, session } = await setup();
    await choose(
      wrapper,
      '⟦files.actionsFor:{"name":"Notes/Reading.md"}⟧',
      "⟦files.versionHistory⟧",
    );
    expect(calls().find((call) => call.operation === "history")?.path).toBe(
      "Notes/Reading.md",
    );
    expect(session.selected).toBe("Notes/Garden.md");
    expect(
      calls()
        .filter((call) => call.operation === "read")
        .map((call) => call.path),
    ).toEqual(["Notes/Garden.md"]);
  });
  it("routes context-menu and long-press actions without selecting the targeted file", async () => {
    const { wrapper, session } = await setup();
    const row = button(wrapper, "Reading.md").element.closest(".tree-row")!;
    vi.spyOn(
      row.querySelector(".row-menu")!,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(20, 20, 44, 44));
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 50,
      }),
    );
    await flushPromises();
    expect(menu().get(".menu-context").text()).toBe("Reading.md");
    expect(session.selected).toBe("Notes/Garden.md");
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const press = new Event("pointerdown", { bubbles: true });
    Object.assign(press, {
      pointerType: "touch",
      button: 0,
      clientX: 30,
      clientY: 50,
    });
    row.dispatchEvent(press);
    await vi.advanceTimersByTimeAsync(550);
    await flushPromises();
    expect(menu().get(".menu-context").text()).toBe("Reading.md");
    await button(wrapper, "Reading.md").trigger("click");
    expect(session.selected).toBe("Notes/Garden.md");
  });
  it("hides the previous document while checking a pane selection and restores it after failure", async () => {
    const { session } = await setup();
    const editor = await pane(session.id, "Notes/Garden.md", {
      mode: "read",
      treeOpen: true,
    });
    const implementation = invoke.getMockImplementation()!;
    let reject!: (reason: Error) => void;
    invoke.mockImplementation((input) =>
      input.operation === "read" && input.path === "Notes/Reading.md"
        ? new Promise((_, fail) => {
            reject = fail;
          })
        : implementation(input),
    );
    await button(editor, "Reading.md").trigger("click");
    await flushPromises();
    expect(editor.get('[role="status"]').text()).toBe(
      "⟦files.loadingDocument⟧",
    );
    expect(editor.get(".document-pane").attributes("aria-busy")).toBe("true");
    expect(editor.findComponent(RenderedFile).exists()).toBe(false);
    reject(new Error("files.theFileCouldNotBeRead"));
    await flushPromises();
    expect(editor.find('[role="status"]').exists()).toBe(false);
    expect(editor.getComponent(RenderedFile).props("text")).toContain("Garden");
    expect(editor.emitted("navigate")).toBeUndefined();
  });

  it("shows document loading instead of an empty workspace and clears it on failure", async () => {
    const { wrapper } = await setup();
    const implementation = invoke.getMockImplementation()!;
    let reject!: (reason: Error) => void;
    invoke.mockImplementation((input) =>
      input.operation === "read" && input.path === "Notes/Reading.md"
        ? new Promise((_, fail) => {
            reject = fail;
          })
        : implementation(input),
    );
    await button(wrapper, "Reading.md").trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe(
      "⟦files.loadingDocument⟧",
    );
    expect(wrapper.get(".document-pane").attributes("aria-busy")).toBe("true");
    expect(wrapper.text()).not.toContain("⟦files.yourFilesInPlace⟧");
    reject(new Error("files.theFileCouldNotBeRead"));
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(
      wrapper.get(".document-pane").attributes("aria-busy"),
    ).toBeUndefined();
    expect(wrapper.text()).not.toContain("⟦files.yourFilesInPlace⟧");
    expect(wrapper.text()).toContain("⟦files.theFileCouldNotBeRead⟧");
  });

  it("loads deleted-file history only when recovery is opened", async () => {
    const { wrapper } = await setup();
    expect(
      calls().some(
        (call) => call.operation === "snapshot" && call.includeDeleted,
      ),
    ).toBe(false);
    await choose(wrapper, "⟦files.newFileOrFolder⟧", "⟦files.deletedFiles⟧");
    expect(calls()).toContainEqual({
      workspaceId: wrapper.props("workspaceId"),
      operation: "snapshot",
      includeDeleted: true,
    });
  });

  it("hides stale recovery actions while refreshing and after a failed refresh", async () => {
    const { wrapper, session } = await setup();
    const implementation = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (input) => {
      const reply = await implementation(input);
      if (
        input.operation === "snapshot" &&
        input.includeDeleted &&
        reply.snapshot
      )
        reply.snapshot.deleted = [
          { path: "Old.md", revision: "old", isDirectory: false },
        ];
      return reply;
    });
    await choose(wrapper, "⟦files.newFileOrFolder⟧", "⟦files.deletedFiles⟧");
    expect(wrapper.findAll(".deleted-entry")).toHaveLength(1);
    let fail!: (reason: Error) => void;
    invoke.mockImplementation((input) =>
      input.operation === "snapshot" && input.includeDeleted
        ? new Promise((_, reject) => {
            fail = reject;
          })
        : implementation(input),
    );
    session.snapshot = {
      ...session.snapshot!,
      entries: [
        ...session.snapshot!.entries,
        { path: "New.md", isDirectory: false },
      ],
    };
    await flushPromises();
    expect(wrapper.get("dialog [role='status']").text()).toBe(
      "⟦files.loadingHistory⟧",
    );
    expect(wrapper.find(".deleted-entry").exists()).toBe(false);
    fail(new Error("files.theFileCouldNotBeRead"));
    await flushPromises();
    expect(wrapper.get("dialog [role='alert']").text()).toBe(
      "⟦files.theFileCouldNotBeRead⟧",
    );
    expect(wrapper.find(".deleted-entry").exists()).toBe(false);
  });

  it("keeps recovery reachable from a read-only plus menu", async () => {
    const { wrapper } = await setup(false);
    expect(
      button(wrapper, "⟦files.newFileOrFolder⟧").attributes("disabled"),
    ).toBeUndefined();
    await choose(wrapper, "⟦files.newFileOrFolder⟧", "⟦files.deletedFiles⟧");
    expect(wrapper.get("dialog").attributes("aria-label")).toBe(
      "⟦files.deletedFiles⟧",
    );
  });
  it("switches historical representation without leaving its selected revision", async () => {
    const { wrapper } = await setup();
    await button(wrapper, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    await wrapper.get(".version").trigger("click");
    await flushPromises();
    expect(wrapper.get(".historical-notice").text()).toContain(
      "⟦files.readOnly⟧",
    );
    await choose(wrapper, "⟦files.fileActions⟧", "⟦files.viewSource⟧");
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe(
      "# Earlier garden",
    );
    expect(wrapper.get("textarea").attributes("readonly")).toBeDefined();
    await choose(wrapper, "⟦files.fileActions⟧", "⟦files.read⟧");
    expect(wrapper.get(".historical-notice").text()).toContain(
      "⟦files.readOnly⟧",
    );
    expect(wrapper.getComponent(RenderedFile).props("text")).toBe(
      "# Earlier garden",
    );
    await choose(wrapper, "⟦files.fileActions⟧", "⟦files.viewSource⟧");
    await button(wrapper, "⟦files.returnToCurrentFile⟧").trigger("click");
    await flushPromises();
    expect(wrapper.find(".historical-notice").exists()).toBe(false);
    expect(
      wrapper.get<HTMLTextAreaElement>("textarea").element.value,
    ).toContain("Tea ☕ outside.");
    expect(wrapper.get("textarea").attributes("readonly")).toBeUndefined();
  });
  it("allows source inspection in a read-only workspace", async () => {
    const { wrapper } = await setup(false);
    await choose(wrapper, "⟦files.fileActions⟧", "⟦files.viewSource⟧");
    expect(wrapper.get("textarea").attributes("readonly")).toBeDefined();
    expect(
      wrapper.get<HTMLTextAreaElement>("textarea").element.value,
    ).toContain("Tea ☕ outside.");
    await choose(wrapper, "⟦files.fileActions⟧", "⟦files.read⟧");
    expect(wrapper.find("textarea").exists()).toBe(false);
  });
  it("opens the live row explicitly even when a historical version shares its path", async () => {
    const { wrapper } = await setup();
    await button(wrapper, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    await wrapper.get(".version").trigger("click");
    await flushPromises();
    await button(wrapper, "⟦files.expandFileBrowser⟧").trigger("click");
    await flushPromises();
    await choose(
      wrapper,
      '⟦files.actionsFor:{"name":"Notes/Garden.md"}⟧',
      "⟦files.read⟧",
    );
    expect(wrapper.find(".historical-notice").exists()).toBe(false);
    expect(wrapper.getComponent(RenderedFile).props("text")).toContain(
      "Tea ☕ outside.",
    );
  });
  it("keeps user history titles separate from supplied summaries and hides legacy commit references", async () => {
    const { wrapper } = await setup();
    const revision = "0123456789abcdef0123456789abcdef01234567";
    invoke.mockResolvedValueOnce({
      status: "ok",
      history: [
        {
          revision: "user",
          message: "Add a reading corner",
          timestamp: 1791100000,
          deleted: true,
        },
        {
          revision: "supplied",
          message: "native.history.externalChanges\n\nInternal metadata",
          timestamp: 1791100000,
        },
        {
          revision: "legacy",
          message: `Reverse change ${revision}`,
          timestamp: 1791100000,
        },
      ],
    });
    await button(wrapper, "⟦files.versionHistory⟧").trigger("click");
    await flushPromises();
    const summaries = wrapper.findAll(".version strong");
    expect(summaries[0]!.get("[data-localization-content=user]").text()).toBe(
      "Add a reading corner",
    );
    expect(summaries[0]!.text()).toContain("⟦files.deleted⟧");
    expect(summaries[1]!.text()).toBe("⟦native.history.externalChanges⟧");
    expect(summaries[1]!.find("[data-localization-content]").exists()).toBe(
      false,
    );
    expect(summaries[2]!.text()).toBe("⟦files.reversedEarlierVersion⟧");
    expect(wrapper.get(".version-panel").text()).not.toContain(revision);
  });
  it("updates an open action menu without resetting file text or regional formats", async () => {
    const previous = preferences.value;
    const keyMode = Reflect.get(globalThis, "__SITUATE_LOCALIZATION_KEYS__");
    const { wrapper, session } = await setup();
    const retained = session.files["Notes/Garden.md"]!.text;
    await openMenu(wrapper, "⟦files.fileActions⟧");
    try {
      Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
      setPreferences({
        language: "de",
        formats: { date: "ymd", time: "24", number: "dot-comma" },
      });
      await flushPromises();
      expect(menu().text()).toContain(de["files.editSource"]);
      expect(wrapper.get(".save-state").text()).toBe(de["files.saved"]);
      expect(session.files["Notes/Garden.md"]!.text).toBe(retained);
      expect(preferences.value.formats).toEqual({
        date: "ymd",
        time: "24",
        number: "dot-comma",
      });
      setPreferences({ ...preferences.value, language: "en" });
      await flushPromises();
      expect(menu().text()).toContain("Edit source");
      expect(session.files["Notes/Garden.md"]!.text).toBe(retained);
    } finally {
      wrapper.unmount();
      Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", keyMode);
      setPreferences(previous);
    }
  });
  it("enters source at the emitted UTF-16 offset and ignores editing in a read-only workspace", async () => {
    const { wrapper } = await setup();
    wrapper.getComponent(RenderedFile).vm.$emit("editSource", 12);
    await flushPromises();
    const source = wrapper.get<HTMLTextAreaElement>("textarea");
    expect(source.element.selectionStart).toBe(12);
    expect(document.activeElement).toBe(source.element);
    wrapper.unmount();
    const readonly = await setup(false);
    readonly.wrapper.getComponent(RenderedFile).vm.$emit("editSource", 12);
    await flushPromises();
    expect(readonly.wrapper.find("textarea").exists()).toBe(false);
  });
});
