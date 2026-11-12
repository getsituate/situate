import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import FileEditor from "./FileEditor.vue";
import { filesRequest } from "./api";
import {
  releaseWorkspace,
  retainedWorkspaces,
  workspaceSession,
} from "./sessions";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  filesRequest: vi.fn(),
}));
const invoke = vi.mocked(filesRequest);
const texts: Record<string, string> = {
  "README.md": "# Instructions",
  "src/entry.js": "throw new Error('never execute')",
  "plugin.json": '{"name":"sample"}',
  LICENSE: "Plain text without an extension",
  "text.png": "Text despite the extension",
};
const entries = [
  { path: "src", isDirectory: true },
  ...[...Object.keys(texts), "binary.md"].map((path) => ({
    path,
    isDirectory: false,
  })),
];
let sequence = 0;
enableAutoUnmount(afterEach);
beforeEach(() => {
  invoke.mockReset().mockImplementation(async (request) => {
    if (request.operation === "snapshot")
      return {
        status: "ok",
        snapshot: {
          writable: !request.pluginId,
          reason: null,
          entries,
          drafts: [],
        },
      };
    if (request.operation === "read") {
      if (request.path === "binary.md") return { status: "binary" };
      return {
        status: "ok",
        document: {
          path: request.path,
          version: {
            text: texts[request.path] ?? "",
            revision: "source-revision",
          },
          html: request.path === "README.md" ? "<h1>Instructions</h1>" : "",
          issues: [],
        },
      };
    }
    if (request.operation === "openExternal") return { status: "ok" };
    throw new Error(`Unexpected operation: ${request.operation}`);
  });
});
afterEach(() => retainedWorkspaces().forEach(releaseWorkspace));
function browser(pluginId?: string, controlled = false) {
  return mount(FileEditor, {
    attachTo: document.body,
    props: {
      workspaceId: `inspection-${++sequence}`,
      workspaceName: "Sample",
      pluginId,
      ...(controlled ? { target: {} } : {}),
    },
  });
}
async function select(wrapper: ReturnType<typeof browser>, name: string) {
  const button = wrapper
    .findAll(".file-entry")
    .find((item) => item.text() === name)!;
  expect(button).toBeDefined();
  await button.trigger("click");
  await flushPromises();
}

for (const pluginId of [undefined, "sample"]) {
  const scope = pluginId ? "plugin" : "workspace";
  test(`${scope} uses the shared tree, rendered Markdown and internal text display`, async () => {
    const wrapper = browser(pluginId);
    await flushPromises();
    await select(wrapper, "README.md");
    expect(wrapper.get(".markdown h1").text()).toBe("Instructions");
    for (const name of ["entry.js", "plugin.json", "LICENSE", "text.png"]) {
      await select(wrapper, name);
      const path = name === "entry.js" ? `src/${name}` : name;
      expect(wrapper.get(".text-document").text()).toBe(texts[path]);
      expect(document.activeElement).toBe(
        wrapper.get(".document-location h3").element,
      );
    }
    expect(
      invoke.mock.calls.some(
        ([request]) => request.operation === "openExternal",
      ),
    ).toBe(false);
    expect(wrapper.find("script, iframe").exists()).toBe(false);
    expect(wrapper.find(".syntax-string").exists()).toBe(false);
    await select(wrapper, "entry.js");
    expect(
      wrapper.findAll(".syntax-keyword").map((token) => token.text()),
    ).toEqual(["throw", "new"]);
    expect(wrapper.find("textarea, [contenteditable]").exists()).toBe(false);
    await wrapper.vm.showTree();
    expect(document.activeElement).toBe(wrapper.get("input").element);
    await wrapper.get("input").setValue("missing");
    expect(wrapper.findAll(".tree-row")).toHaveLength(0);
    expect(wrapper.text()).toContain("⟦files.noMatchingFiles⟧");
    if (pluginId) {
      expect(wrapper.find(".history-toggle, .document-chat").exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[aria-label="⟦files.newFileOrFolder⟧"]').exists(),
      ).toBe(false);
      expect(
        invoke.mock.calls.every(([request]) => request.pluginId === pluginId),
      ).toBe(true);
    }
  });
  test(`${scope} opens only a confirmed binary file externally`, async () => {
    const wrapper = browser(pluginId);
    await flushPromises();
    await select(wrapper, "README.md");
    await select(wrapper, "binary.md");
    expect(wrapper.get(".markdown h1").text()).toBe("Instructions");
    expect(
      invoke.mock.calls
        .filter(([request]) => request.operation === "openExternal")
        .map(([request]) => request),
    ).toEqual([
      {
        workspaceId: wrapper.props("workspaceId"),
        ...(pluginId ? { pluginId } : {}),
        operation: "openExternal",
        path: "binary.md",
      },
    ]);
  });
  test(`${scope} keeps the latest text selection when an earlier binary read finishes`, async () => {
    const wrapper = browser(pluginId);
    await flushPromises();
    await select(wrapper, "README.md");
    let finish!: (reply: { status: "binary" }) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper
      .findAll(".file-entry")
      .find((item) => item.text() === "binary.md")!
      .trigger("click");
    await flushPromises();
    await wrapper
      .findAll(".file-entry")
      .find((item) => item.text() === "README.md")!
      .trigger("click");
    finish({ status: "binary" });
    await flushPromises();
    expect(wrapper.get(".document-location h3").text()).toBe("README.md");
    expect(wrapper.get(".markdown h1").text()).toBe("Instructions");
    expect(
      invoke.mock.calls.some(
        ([request]) => request.operation === "openExternal",
      ),
    ).toBe(false);
  });
  test(`${scope} does not open a binary file after leaving the view`, async () => {
    const wrapper = browser(pluginId);
    await flushPromises();
    let finish!: (reply: { status: "binary" }) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper
      .findAll(".file-entry")
      .find((item) => item.text() === "binary.md")!
      .trigger("click");
    await flushPromises();
    wrapper.unmount();
    finish({ status: "binary" });
    await flushPromises();
    expect(
      invoke.mock.calls.some(
        ([request]) => request.operation === "openExternal",
      ),
    ).toBe(false);
  });
  test(`${scope} does not launch an external application after a read failure`, async () => {
    const wrapper = browser(pluginId);
    await flushPromises();
    invoke.mockRejectedValueOnce("native.plugins.readFailed");
    await select(wrapper, "entry.js");
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "⟦native.plugins.readFailed⟧",
    );
    expect(
      invoke.mock.calls.some(
        ([request]) => request.operation === "openExternal",
      ),
    ).toBe(false);
  });
}

test("a late binary result cannot launch after leaving a hosted Files pane", async () => {
  const wrapper = browser(undefined, true);
  await flushPromises();
  let finish!: (reply: { status: "binary" }) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await wrapper
    .findAll(".file-entry")
    .find((item) => item.text() === "binary.md")!
    .trigger("click");
  await flushPromises();
  wrapper.unmount();
  finish({ status: "binary" });
  await flushPromises();
  expect(
    invoke.mock.calls.some(([request]) => request.operation === "openExternal"),
  ).toBe(false);
});

test("restoring a binary target never launches an external application", async () => {
  const wrapper = browser(undefined, true);
  await flushPromises();
  await wrapper.setProps({ target: { contentId: "binary.md" } });
  await flushPromises();
  expect(
    invoke.mock.calls.some(([request]) => request.operation === "openExternal"),
  ).toBe(false);
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦files.fileIsBinary⟧",
  );
});

test("plugin source mode is read-only and does not send write requests", async () => {
  const wrapper = browser("sample");
  await flushPromises();
  await select(wrapper, "README.md");
  const trigger = wrapper.get('[aria-label="⟦files.fileActions⟧"]');
  vi.spyOn(trigger.element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 44, 44),
  );
  await trigger.trigger("click");
  await flushPromises();
  const source = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ].find((button) => button.textContent?.includes("⟦files.viewSource⟧"));
  expect(source).toBeDefined();
  source!.click();
  await flushPromises();
  const input = wrapper.get<HTMLTextAreaElement>("textarea");
  expect(input.element.value).toBe("# Instructions");
  expect(input.attributes("readonly")).toBeDefined();
  expect(
    invoke.mock.calls.every(([request]) =>
      ["snapshot", "read"].includes(request.operation),
    ),
  ).toBe(true);
});

test("plugin selection is isolated from the workspace and other plugins", async () => {
  const id = `isolated-${++sequence}`;
  const workspace = workspaceSession(id);
  const one = workspaceSession(id, "one");
  const two = workspaceSession(id, "two");
  one.selected = "plugin.json";
  expect(workspace.selected).toBe("");
  expect(two.selected).toBe("");
  expect(workspaceSession(id, "one")).toBe(one);
});

test("plugin writes are rejected before IPC", async () => {
  const { request } = await import("./sessions");
  const session = workspaceSession(`readonly-${++sequence}`, "sample");
  await expect(
    request(session, { operation: "delete", path: "plugin.json" }),
  ).rejects.toThrow("native.files.provider.readOnly");
  expect(invoke).not.toHaveBeenCalled();
});
