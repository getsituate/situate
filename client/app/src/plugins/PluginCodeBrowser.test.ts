import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import PluginCodeBrowser from "./PluginCodeBrowser.vue";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
enableAutoUnmount(afterEach);
const entries = [
  { path: "src", isDirectory: true },
  { path: "src/entry.js", isDirectory: false },
  { path: "plugin.json", isDirectory: false },
];
beforeEach(() => {
  invoke
    .mockReset()
    .mockImplementation((_command, { request }) =>
      Promise.resolve(
        request.operation === "files"
          ? { files: entries }
          : { text: "throw new Error('never execute')" },
      ),
    );
});
function browser() {
  return mount(PluginCodeBrowser, {
    attachTo: document.body,
    props: { scope: "workspace", pluginId: "plugin-one" },
  });
}
test("lists folders, filters files and reads source without executing it", async () => {
  const wrapper = browser();
  await flushPromises();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("plugins_source", {
    scope: "workspace",
    request: { operation: "files", pluginId: "plugin-one" },
  });
  await wrapper.get('[aria-description="src"]').trigger("click");
  await wrapper.get('[aria-description="src/entry.js"]').trigger("click");
  await flushPromises();
  expect(invoke).toHaveBeenLastCalledWith("plugins_source", {
    scope: "workspace",
    request: {
      operation: "read",
      pluginId: "plugin-one",
      path: "src/entry.js",
    },
  });
  expect(wrapper.get(".code-source").text()).toBe(
    "throw new Error('never execute')",
  );
  expect(
    wrapper.findAll(".syntax-keyword").map((token) => token.text()),
  ).toEqual(["throw", "new"]);
  expect(wrapper.find(".syntax-string").text()).toBe("'never execute'");
  expect(document.activeElement).toBe(wrapper.get("h3").element);
  expect(
    wrapper.find("textarea, iframe, script, [contenteditable]").exists(),
  ).toBe(false);
  await wrapper.vm.showTree();
  expect(document.activeElement).toBe(wrapper.get("input").element);
  await wrapper.get("input").setValue("missing");
  expect(wrapper.findAll(".code-entry")).toHaveLength(0);
  await wrapper.get(".code-empty button").trigger("click");
  expect(wrapper.findAll(".code-entry").length).toBeGreaterThan(0);
});
test("known binary assets show an unsupported preview without reading or executing them", async () => {
  invoke.mockResolvedValueOnce({
    files: [{ path: "logo.png", isDirectory: false }],
  });
  const wrapper = browser();
  await flushPromises();
  await wrapper.get(".code-entry").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("⟦pluginDevelopment.noFilePreview⟧");
  expect(invoke).toHaveBeenCalledOnce();
  expect(wrapper.find("img, iframe, script").exists()).toBe(false);
});

test("ignores stale file reads and listing results after plugin changes", async () => {
  let finish!: (value: unknown) => void;
  const wrapper = browser();
  await flushPromises();
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await wrapper.get('[aria-description="plugin.json"]').trigger("click");
  await flushPromises();
  await wrapper.setProps({ pluginId: "plugin-two" });
  await flushPromises();
  finish({ text: "stale" });
  await flushPromises();
  expect(wrapper.text()).not.toContain("stale");
  expect(invoke).toHaveBeenLastCalledWith("plugins_source", {
    scope: "workspace",
    request: { operation: "files", pluginId: "plugin-two" },
  });
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await wrapper.setProps({ pluginId: "plugin-three" });
  await wrapper.setProps({ pluginId: "plugin-four" });
  await flushPromises();
  finish({ files: [{ path: "obsolete.txt", isDirectory: false }] });
  await flushPromises();
  expect(wrapper.text()).not.toContain("obsolete.txt");
});
test("ignores reads completed after disposal", async () => {
  let reject!: (error: unknown) => void;
  const wrapper = browser();
  await flushPromises();
  invoke.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await wrapper.get('[aria-description="plugin.json"]').trigger("click");
  await flushPromises();
  wrapper.unmount();
  reject("native.plugins.readFailed");
  await flushPromises();
  expect(invoke).toHaveBeenCalledTimes(2);
});
test("offers retry for read failures and recovery actions for unexpected failures", async () => {
  invoke.mockRejectedValueOnce("native.plugins.readFailed");
  const wrapper = browser();
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "⟦native.plugins.readFailed⟧",
  );
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.findAll(".code-entry").length).toBeGreaterThan(0);
  invoke.mockRejectedValueOnce("native.plugins.invalidPath");
  await wrapper.get('[aria-description="plugin.json"]').trigger("click");
  await flushPromises();
  expect(wrapper.get(".situate-error-screen").findAll("button")).toHaveLength(
    2,
  );
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "⟦native.plugins.invalidPath⟧",
  );
});
