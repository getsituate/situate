import { chooseSelect } from "../ui/select-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import {
  initialFormats,
  setPreferences,
  type LocalizationSnapshot,
} from "@situate/localization";
import SettingsView from "./SettingsView.vue";
import { defaultAiSettings } from "../ai/settings";
import { getStatus } from "../ai/api";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => defaultAiSettings()),
}));
vi.mock("../ai/api", async (original) => ({
  ...(await original<typeof import("../ai/api")>()),
  getStatus: vi.fn(async () => ({
    config: null,
    available: false,
    reason: null,
    selectedModel: null,
    modelError: null,
  })),
  listConnections: vi.fn(async () => []),
}));

const snapshot: LocalizationSnapshot = {
  language: "en",
  formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
  writable: true,
};
const props = {
  snapshot,
  loading: false,
  saving: false,
  error: "" as const,
  showNavigation: false,
  navigationId: "navigation",
  navigationOpen: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  setPreferences({ language: "en", formats: initialFormats("en") });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows only the settings heading and navigation control in the top bar", async () => {
  const wrapper = mount(SettingsView, {
    props: { ...props, showNavigation: true },
  });
  const header = wrapper.get(".settings-topbar");
  expect(header.text()).toBe("Workspace settings");
  expect(header.findAll("button")).toHaveLength(1);
  expect(header.get("button").attributes("aria-label")).toBe("Open navigation");
  await header.get("button").trigger("click");
  expect(wrapper.emitted("navigation")).toHaveLength(1);
  wrapper.unmount();
});

it("keeps saving and background refresh silent while retaining initial loading and errors", async () => {
  const wrapper = mount(SettingsView, { props: { ...props, saving: true } });
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  await wrapper.setProps({ saving: false, loading: true });
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  await wrapper.setProps({ loading: false, error: "localization.saveFailed" });
  expect(wrapper.get('[role="alert"] p').text()).toBe(
    "Your settings could not be saved. Check workspace access and try again.",
  );
  await wrapper.setProps({ snapshot: null, error: "", loading: true });
  expect(wrapper.get('[role="status"]').text()).toBe(
    "Loading workspace settings…",
  );
  wrapper.unmount();
});

it("opens AI settings from its decorated category and manages connections inline", async () => {
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const wrapper = mount(SettingsView, {
    props: { ...props, workspaceScope: "garden" },
  });
  const symbols = wrapper.findAll(".settings-categories .category-symbol");
  expect(symbols.slice(0, 3).map((symbol) => symbol.text())).toEqual([
    "Aa",
    "◐",
    "✦",
  ]);
  expect(symbols).toHaveLength(5);
  expect(
    wrapper.get(".settings-categories button:last-child").text(),
  ).toContain("About Situate");
  expect(
    symbols.every((symbol) => symbol.attributes("aria-hidden") === "true"),
  ).toBe(true);
  await wrapper
    .get(".settings-categories button:nth-of-type(3)")
    .trigger("click");
  expect(wrapper.get(".settings-page-heading").text()).toBe("AI & models");
  await vi.waitFor(() =>
    expect(wrapper.find("#settings-inline").exists()).toBe(true),
  );
  await vi.waitFor(() =>
    expect(wrapper.find(".connections-heading button").exists()).toBe(true),
  );
  await flushPromises();
  await wrapper.get(".connections-heading button").trigger("click");
  await flushPromises();
  expect(wrapper.get(".ai-embedded h1").text()).toBe("Choose a provider");
  expect(wrapper.get(".settings-categories").isVisible()).toBe(true);
  expect(wrapper.emitted("connect")).toBeUndefined();
  wrapper.unmount();
});

it.each(["formats", "ai"] as const)(
  "retains connection drafts across categories and discards them when the workspace changes from %s",
  async (category) => {
    const wrapper = mount(SettingsView, {
      props: { ...props, workspaceScope: `draft-garden-${category}` },
    });
    expect(wrapper.find(".ai-settings").exists()).toBe(false);
    expect(getStatus).not.toHaveBeenCalled();
    const ai = () => wrapper.get(".settings-categories button:nth-of-type(3)");
    const formats = () =>
      wrapper.get(".settings-categories button:first-of-type");
    async function addEndpoint() {
      await vi.waitFor(() =>
        expect(wrapper.find(".connections-heading button").exists()).toBe(true),
      );
      await flushPromises();
      await wrapper.get(".connections-heading button").trigger("click");
      await vi.waitFor(() =>
        expect(wrapper.find(".ai-provider-grid").exists()).toBe(true),
      );
      await wrapper
        .findAll(".ai-provider-grid button")
        .find(
          (button) =>
            button.get("strong").text() === "OpenAI-compatible server",
        )!
        .trigger("click");
    }
    await ai().trigger("click");
    await addEndpoint();
    await wrapper.get("#ai-connection-label").setValue("Studio server");
    await wrapper
      .get("#ai-endpoint")
      .setValue("https://studio.example.invalid/v1");
    const reads = vi.mocked(getStatus).mock.calls.length;
    await formats().trigger("click");
    expect(wrapper.get(".ai-settings").isVisible()).toBe(false);
    await ai().trigger("click");
    expect(
      wrapper.get<HTMLInputElement>("#ai-connection-label").element.value,
    ).toBe("Studio server");
    expect(wrapper.get<HTMLInputElement>("#ai-endpoint").element.value).toBe(
      "https://studio.example.invalid/v1",
    );
    expect(getStatus).toHaveBeenCalledTimes(reads);
    if (category === "formats") await formats().trigger("click");
    await wrapper.setProps({ workspaceScope: `draft-reading-${category}` });
    await flushPromises();
    if (category === "formats") {
      expect(wrapper.find(".ai-settings").exists()).toBe(false);
      expect(getStatus).toHaveBeenCalledTimes(reads);
      await ai().trigger("click");
    }
    await addEndpoint();
    expect(
      wrapper.get<HTMLInputElement>("#ai-connection-label").element.value,
    ).toBe("");
    expect(wrapper.get<HTMLInputElement>("#ai-endpoint").element.value).toBe(
      "",
    );
    expect(wrapper.emitted("ai-settings-saved")).toBeUndefined();
    wrapper.unmount();
  },
);

it("opens workspace plugin management without replacing ordinary settings", async () => {
  const wrapper = mount(SettingsView, {
    props: { ...props, workspaceScope: "garden" },
  });
  await wrapper.get('[data-action="manage-plugins"]').trigger("click");
  expect(wrapper.emitted("plugins")).toEqual([[]]);
  expect(wrapper.find("#settings-language").exists()).toBe(true);
  expect(wrapper.find("#settings-date").exists()).toBe(true);
  await wrapper.setProps({ workspaceScope: undefined });
  expect(wrapper.find('[data-action="manage-plugins"]').exists()).toBe(false);
  wrapper.unmount();
});

it("changes each preference without changing the other three", async () => {
  const wrapper = mount(SettingsView, { props });
  await chooseSelect(wrapper, "#settings-language", "de");
  expect(wrapper.emitted("change")?.[0]).toEqual([
    { language: "de", formats: snapshot.formats },
  ]);
  await chooseSelect(wrapper, "#settings-time", "12");
  expect(wrapper.emitted("change")?.[1]).toEqual([
    { language: "en", formats: { ...snapshot.formats, time: "12" } },
  ]);
  await chooseSelect(wrapper, "#settings-date", "ymd");
  expect(wrapper.emitted("change")?.[2]).toEqual([
    { language: "en", formats: { ...snapshot.formats, date: "ymd" } },
  ]);
  await chooseSelect(wrapper, "#settings-number", "dot-apostrophe");
  expect(wrapper.emitted("change")?.[3]).toEqual([
    {
      language: "en",
      formats: { ...snapshot.formats, number: "dot-apostrophe" },
    },
  ]);
  wrapper.unmount();
});

it("shows format examples only in the selectors and updates its language in place", async () => {
  const wrapper = mount(SettingsView, { props });
  expect(wrapper.get("#settings-date + select option:checked").text()).toBe(
    "31.12.2026",
  );
  expect(wrapper.get("#settings-time + select option:checked").text()).toBe(
    "24-hour · 14:30",
  );
  expect(wrapper.get("#settings-number + select option:checked").text()).toBe(
    "1.234,56",
  );
  expect(
    wrapper
      .get('[aria-labelledby="formats-heading"]')
      .findAll("p, .format-preview"),
  ).toHaveLength(0);
  setPreferences({ language: "de", formats: snapshot.formats });
  await wrapper.vm.$nextTick();
  expect(wrapper.get('label[for="settings-language"]').text()).toBe(
    "Sprache der Oberfläche",
  );
  expect(wrapper.get("#settings-number + select option:checked").text()).toBe(
    "1.234,56",
  );
  wrapper.unmount();
});

it("keeps controls unavailable while saving or in a read-only workspace", async () => {
  const wrapper = mount(SettingsView, { props: { ...props, saving: true } });
  expect(
    wrapper
      .findAll("select")
      .every((select) => select.attributes("disabled") !== undefined),
  ).toBe(true);
  await wrapper.setProps({
    saving: false,
    snapshot: { ...snapshot, writable: false },
  });
  expect(
    wrapper
      .findAll("select")
      .every((select) => select.attributes("disabled") !== undefined),
  ).toBe(true);
  expect(wrapper.text()).toContain("This workspace is read-only.");
  wrapper.unmount();
});

it("offers retry without claiming settings were saved", async () => {
  const wrapper = mount(SettingsView, {
    props: { ...props, snapshot: null, error: "localization.loadFailed" },
  });
  expect(wrapper.findAll("select")).toHaveLength(0);
  await wrapper.get(".settings-error button").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  expect(wrapper.text()).not.toContain("Settings saved.");
  wrapper.unmount();
});
