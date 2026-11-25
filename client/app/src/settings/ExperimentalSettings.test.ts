import { invoke } from "@tauri-apps/api/core";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExperimentalSettings from "./ExperimentalSettings.vue";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const native = vi.mocked(invoke);
const scope = "garden";
const setup = (
  props: { workspaceScope?: string } = { workspaceScope: scope },
) => {
  const view = mount(ExperimentalSettings, {
    props,
    attachTo: document.body,
  });
  return {
    toggle: () => view.get<HTMLInputElement>('[role="switch"]'),
    button: (label: string) =>
      view.findAll("button").find((button) => button.text() === label),
    dialog: () => view.find("dialog"),
    status: () => view.find('[role="status"]'),
  };
};
const installLabel = "Install Gmail in this workspace";
const updateLabel = "Update Gmail settings";

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  native.mockReset();
  vi.stubGlobal("__SITUATE_LOCALIZATION_KEYS__", false);
});
enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());

it("enables Gmail with consent, then installs it only in the open workspace", async () => {
  const saving = deferred();
  const installing = deferred();
  native
    .mockResolvedValueOnce(false)
    .mockReturnValueOnce(saving.promise)
    .mockResolvedValueOnce(false)
    .mockReturnValueOnce(installing.promise);
  const view = setup();
  await flushPromises();
  expect(view.button(installLabel)).toBeUndefined();
  await view.toggle().setValue(true);
  expect(view.toggle().element.checked).toBe(false);
  expect(native).toHaveBeenCalledExactlyOnceWith("gmail_experiment");
  await view.button("Enable Gmail")!.trigger("click");
  expect(native).toHaveBeenLastCalledWith("gmail_experiment", {
    enabled: true,
  });
  expect(view.toggle().element.disabled).toBe(true);
  expect(view.dialog().exists()).toBe(false);

  saving.resolve(true);
  await flushPromises();
  expect(native).toHaveBeenLastCalledWith("gmail_install", {
    scope,
    install: false,
  });
  expect(view.toggle().element.checked).toBe(true);
  expect(document.activeElement).toBe(view.toggle().element);
  const install = view.button(installLabel)!;
  await install.trigger("click");
  expect(install.attributes("disabled")).toBeDefined();
  expect(native).toHaveBeenLastCalledWith("gmail_install", {
    scope,
    install: true,
    update: false,
  });
  installing.resolve(true);
  await flushPromises();
  expect(view.status().text()).toContain("Open Plugins → Connections");
  expect(view.button(installLabel)).toBeUndefined();
  expect(view.button(updateLabel)).toBeUndefined();
});

it("keeps the installed connection visible if its settings update fails, then allows another attempt", async () => {
  native
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error("native.gmail.packageExists"))
    .mockResolvedValueOnce(true);
  const view = setup();
  await flushPromises();
  expect(native.mock.calls).toEqual([
    ["gmail_experiment"],
    ["gmail_install", { scope, install: false }],
    ["gmail_install", { scope, install: false, update: true }],
  ]);
  expect(view.button(installLabel)).toBeUndefined();
  await view.button(updateLabel)!.trigger("click");
  await flushPromises();
  expect(view.dialog().get('[role="alert"]').text()).toContain(
    "No files were replaced.",
  );
  expect(view.status().exists()).toBe(true);
  expect(native).toHaveBeenLastCalledWith("gmail_install", {
    scope,
    install: true,
    update: true,
  });
  await view.dialog().get("button").trigger("click");
  await view.button(updateLabel)!.trigger("click");
  await flushPromises();
  expect(view.dialog().exists()).toBe(false);
  expect(view.status().exists()).toBe(true);
  expect(view.button(updateLabel)).toBeUndefined();
});

it("offers to retry when the device preference cannot be loaded", async () => {
  native
    .mockRejectedValueOnce(new Error("native.gmail.storage"))
    .mockResolvedValueOnce(false);
  const view = setup();
  await flushPromises();
  expect(view.toggle().element.disabled).toBe(true);
  expect(view.dialog().get('[role="alert"]').text()).toContain(
    "Gmail accounts could not be read or saved",
  );
  const retry = view.button("Try again");
  expect(retry).toBeDefined();
  await retry!.trigger("click");
  await flushPromises();
  expect(view.dialog().exists()).toBe(false);
  expect(view.toggle().element.disabled).toBe(false);
  expect(native.mock.calls).toEqual([
    ["gmail_experiment"],
    ["gmail_experiment"],
  ]);
});

it("keeps Gmail enabled if pausing fails and pauses it without changing the installation", async () => {
  native
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("native.gmail.storage"))
    .mockResolvedValueOnce(false);
  const view = setup();
  await flushPromises();
  expect(view.status().exists()).toBe(true);
  expect(view.button(updateLabel)).toBeUndefined();
  await view.toggle().setValue(false);
  await flushPromises();
  expect(view.toggle().element.checked).toBe(true);
  expect(view.dialog().exists()).toBe(true);
  await view.dialog().get("button").trigger("click");
  await view.toggle().setValue(false);
  await flushPromises();
  expect(view.toggle().element.checked).toBe(false);
  expect(view.status().exists()).toBe(false);
  expect(native.mock.calls.slice(3)).toEqual([
    ["gmail_experiment", { enabled: false }],
    ["gmail_experiment", { enabled: false }],
  ]);
});

it("does not look up or offer installation without a workspace", async () => {
  native.mockResolvedValueOnce(true);
  const view = setup({});
  await flushPromises();
  expect(view.toggle().element.checked).toBe(true);
  expect(view.status().exists()).toBe(false);
  expect(view.button(installLabel)).toBeUndefined();
  expect(native).toHaveBeenCalledExactlyOnceWith("gmail_experiment");
});
