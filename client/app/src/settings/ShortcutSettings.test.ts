import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { invoke } from "@tauri-apps/api/core";
import type { ShortcutPlatform } from "../layout/shortcut-keys";
import { createWorkspaceShortcuts } from "../layout/workspace-shortcuts";
import SettingsView from "./SettingsView.vue";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
enableAutoUnmount(afterEach);
const ipc = vi.mocked(invoke);
const snapshot = { revision: "initial", bindings: {} };
beforeEach(() => {
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  ipc.mockReset().mockResolvedValue(snapshot);
});

function mountSettings(
  platform: ShortcutPlatform,
  { mobile = false, restored = false } = {},
) {
  const shortcuts = createWorkspaceShortcuts("garden", platform);
  const wrapper = mount(SettingsView, {
    attachTo: document.body,
    props: {
      snapshot: null,
      loading: false,
      saving: false,
      error: "",
      shortcuts,
      mobile,
      presentation: restored
        ? { page: "shortcuts", detail: true, shortcutSearch: "new tab" }
        : undefined,
    },
  });
  return { wrapper, shortcuts };
}

function button(wrapper: VueWrapper, label: string) {
  const result = wrapper
    .findAll("button")
    .find((item) => item.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
const newTab = '[aria-label="Change shortcut for New tab"]';
const recorder = "dialog[open] input[readonly]";

it("restores desktop search, keeps it when returning to categories, and ignores the page on mobile", async () => {
  const mobile = mountSettings("windows", { mobile: true, restored: true });
  expect(mobile.wrapper.get("h2").text()).not.toBe("Keyboard shortcuts");
  expect(mobile.wrapper.find('input[type="search"]').exists()).toBe(false);

  const { wrapper, shortcuts } = mountSettings("macos", { restored: true });
  await shortcuts.load();
  const search = wrapper.get<HTMLInputElement>('input[type="search"]');
  expect(search.element.value).toBe("new tab");
  expect(wrapper.get(newTab).attributes("aria-description")).toBe(
    "Command + T",
  );
  await search.setValue("absent action");
  expect(wrapper.emitted("presentation")?.at(-1)).toEqual([
    { page: "shortcuts", detail: true, shortcutSearch: "absent action" },
  ]);
  expect(wrapper.find(newTab).exists()).toBe(false);
  await button(wrapper, "Clear search").trigger("click");
  expect(document.activeElement).toBe(search.element);
  expect(
    wrapper
      .get('[aria-label="Change shortcut for Focus pane to the left"]')
      .attributes("aria-description"),
  ).toBe("Option + Command + Left arrow");
  await wrapper.get(".settings-back").trigger("click");
  const category = wrapper.get(
    '.settings-categories button[aria-current="page"]',
  );
  expect(category.text()).toContain("Keyboard shortcuts");
  expect(document.activeElement).toBe(category.element);
});

it("rejects invalid and occupied keys and cancels a recording without writing", async () => {
  const { wrapper, shortcuts } = mountSettings("windows", { restored: true });
  await shortcuts.load();
  const row = wrapper.get(newTab);
  await row.trigger("click");
  const input = wrapper.get<HTMLInputElement>(recorder);
  expect(document.activeElement).toBe(input.element);
  const tab = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  input.element.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);
  await input.trigger("keydown", { key: "a" });
  expect(input.attributes("aria-invalid")).toBe("true");
  await input.trigger("keydown", { key: "w", ctrlKey: true });
  await button(wrapper, "Save shortcut").trigger("click");
  expect(wrapper.get('dialog [role="alert"]').text()).toContain("Close tab");
  expect(document.activeElement).toBe(input.element);
  await wrapper.get("dialog[open]").trigger("cancel");
  expect(wrapper.find(recorder).exists()).toBe(false);
  expect(document.activeElement).toBe(row.element);
  expect(ipc.mock.calls.map(([command]) => command)).toEqual([
    "keyboard_shortcuts_snapshot",
  ]);
});

it("recovers from a load failure and retries a stale save without losing the draft", async () => {
  const { wrapper, shortcuts } = mountSettings("windows", { restored: true });
  let revision = "initial";
  let keys: string | null | undefined;
  ipc
    .mockRejectedValueOnce("native.shortcuts.storage")
    .mockImplementation(async (command, args) => {
      if (command === "keyboard_shortcuts_update") {
        const request = (
          args as {
            request: {
              expectedRevision: string;
              change: { kind: string; keys?: string };
            };
          }
        ).request;
        if (request.expectedRevision !== revision)
          throw "native.shortcuts.changed";
        keys = request.change.kind === "remove" ? null : request.change.keys;
        revision += "-saved";
      }
      return {
        revision,
        bindings: {
          windows: keys === undefined ? {} : { "layout.new-tab": keys },
        },
      };
    });
  const loading = shortcuts.load();
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("Loading keyboard shortcuts");
  await loading;
  expect(wrapper.get('[role="alert"]').text()).toContain("Could not load");
  await button(wrapper, "Reload shortcuts").trigger("click");
  await flushPromises();
  const row = wrapper.get(newTab);
  await row.trigger("click");
  const input = wrapper.get<HTMLInputElement>(recorder);
  await input.trigger("keydown", { key: "j", ctrlKey: true });
  revision = "external";
  await shortcuts.load();
  await button(wrapper, "Save shortcut").trigger("click");
  await flushPromises();
  const failure = wrapper.get(".error-dialog");
  expect(failure.text()).toContain("changed elsewhere");
  await failure.get("button").trigger("click");
  expect(document.activeElement).toBe(input.element);
  expect(input.element.value).toBe("Ctrl + J");
  await button(wrapper, "Reload shortcuts").trigger("click");
  await flushPromises();
  await button(wrapper, "Save shortcut").trigger("click");
  await flushPromises();
  expect(row.attributes("aria-description")).toBe("Ctrl + J. Modified");
  expect(document.activeElement).toBe(row.element);
  await row.trigger("click");
  await button(wrapper, "Remove shortcut").trigger("click");
  await button(wrapper, "Save shortcut").trigger("click");
  await flushPromises();
  expect(row.attributes("aria-description")).toBe("Not assigned. Modified");
  await row.trigger("click");
  await button(wrapper, "Use default").trigger("click");
  await button(wrapper, "Save shortcut").trigger("click");
  await flushPromises();
  expect(row.attributes("aria-description")).toBe("Ctrl + T");
});
