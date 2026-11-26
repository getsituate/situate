import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { initialFormats, setPreferences } from "@situate/localization";
import AppearanceSettings from "./AppearanceSettings.vue";
import type { WorkspaceTheme } from "./theme-tokens";

enableAutoUnmount(afterEach);
const props = {
  accent: "violet" as const,
  workspaceName: "Garden notes",
  loading: false,
  saving: false,
  available: true,
  writable: true,
  error: "" as const,
};
beforeEach(() => {
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  setPreferences({ language: "en", formats: initialFormats("en") });
});
it("offers six named choices and emits immediate changes without a save control", async () => {
  const wrapper = mount(AppearanceSettings, { props });
  expect(wrapper.findAll('input[type="radio"]')).toHaveLength(6);
  expect(wrapper.findAll("label").map((label) => label.text())).toEqual([
    "Violet Default",
    "Cobalt",
    "Sky",
    "Tangerine",
    "Peach",
    "Lemon",
  ]);
  const description = wrapper.get("fieldset").attributes("aria-describedby");
  expect(wrapper.get(`#${description}`).text()).toContain("Garden notes");
  expect(
    wrapper.get<HTMLInputElement>('[value="violet"]').element.checked,
  ).toBe(true);
  await wrapper.get('[value="lemon"]').setValue();
  expect(wrapper.emitted("select")).toEqual([["lemon"]]);
  expect(wrapper.find("button").exists()).toBe(false);
  await wrapper.setProps({ saving: true, accent: "lemon" });
  expect(wrapper.get("fieldset").attributes("disabled")).toBeUndefined();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
});
it("does not show a false editable default when loading fails and offers reload", async () => {
  const wrapper = mount(AppearanceSettings, {
    props: { ...props, available: false, loading: true },
  });
  await vi.waitFor(() =>
    expect(wrapper.get('[role="status"]').text()).toBe("Loading appearance…"),
  );
  expect(wrapper.find("fieldset").exists()).toBe(false);
  await wrapper.setProps({
    loading: false,
    error: "settings.appearance.loadFailed",
  });
  expect(wrapper.get('[role="alert"]').text()).toContain("could not be loaded");
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
});
it("dismisses save errors without changing the reconciled choice and reopens only for recovery", async () => {
  const wrapper = mount(AppearanceSettings, { props, attachTo: document.body });
  await wrapper.setProps({ accent: "lemon", saving: true });
  await wrapper.setProps({
    accent: "violet",
    saving: false,
    error: "settings.appearance.saveFailed",
  });
  await flushPromises();
  const dialog = () => wrapper.get<HTMLDialogElement>("dialog");
  expect(dialog().element.open).toBe(true);
  await dialog().get("button[autofocus]").trigger("click");
  await wrapper.setProps({ workspaceName: "Renamed workspace" });
  expect(dialog().element.open).toBe(false);
  expect(
    wrapper.get<HTMLInputElement>('[value="violet"]').element.checked,
  ).toBe(true);
  expect(wrapper.emitted("select")).toBeUndefined();
  expect(wrapper.emitted("retry")).toBeUndefined();
  await wrapper.get("button.situate-button--small").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  await wrapper.setProps({ loading: true });
  expect(dialog().element.open).toBe(true);
  await wrapper.setProps({ loading: false, error: "" });
  expect(wrapper.find("dialog").exists()).toBe(false);
});

it("keeps the saved selection visible in read-only workspaces and translates in place", async () => {
  const wrapper = mount(AppearanceSettings, {
    props: { ...props, accent: "peach", writable: false },
  });
  expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
  expect(wrapper.get<HTMLInputElement>('[value="peach"]').element.checked).toBe(
    true,
  );
  expect(wrapper.text()).toContain("read-only");
  setPreferences({ language: "de", formats: initialFormats("de") });
  await wrapper.vm.$nextTick();
  expect(wrapper.get("legend").text()).toBe("Akzentfarbe");
  expect(wrapper.text()).toContain("Pfirsich");
  expect(wrapper.text()).toContain("schreibgeschützt");
  expect(wrapper.get('[value="peach"]').attributes("aria-description")).toBe(
    "Kombiniert mit Himmelblau",
  );
  expect(wrapper.get("label:has(input[value=peach])").attributes("title")).toBe(
    "Pfirsich mit Himmelblau",
  );
});

const mist: WorkspaceTheme = {
  id: "mist",
  title: "Mist",
  key: "paper:mist",
  provider: "Paper",
  variables: { "--situate-ink": "#284860" },
};

it("shows plugin previews without selecting their theme before the saved choice changes", async () => {
  const path = "M5 4H19V20H5Z";
  const dusk: WorkspaceTheme = {
    ...mist,
    id: "dusk",
    title: "Dusk",
    key: "paper:dusk",
    preview: { color: "#477299", icon: { path } },
  };
  const wrapper = mount(AppearanceSettings, {
    props: { ...props, workspaceThemes: true, themes: [mist, dusk] },
    attachTo: document.body,
  });
  const title = wrapper.get("fieldset").attributes("aria-labelledby");
  expect(wrapper.get(`#${title}`).text()).toBe("Theme");
  expect(wrapper.find(".settings-section-help").exists()).toBe(false);
  expect(
    wrapper
      .get('button[aria-label="About plugin themes"]')
      .attributes("aria-haspopup"),
  ).toBe("dialog");
  const cards = wrapper.findAll<HTMLElement>(".appearance-plugin-option");
  expect(cards[0]!.text()).toContain("Mist");
  expect(cards[0]!.text()).toContain("Paper");
  expect(
    cards[0]!.element.style.getPropertyValue("--appearance-preview-color"),
  ).toBe("#284860");
  expect(
    cards[1]!.element.style.getPropertyValue("--appearance-preview-color"),
  ).toBe("#477299");
  expect(cards[1]!.get(".appearance-theme-icon path").attributes("d")).toBe(
    path,
  );

  const radio = cards[1]!.get<HTMLInputElement>("input");
  await radio.setValue();
  expect(wrapper.emitted("theme")).toEqual([[dusk.key]]);
  expect(radio.element.checked).toBe(false);
  expect(
    wrapper.get<HTMLInputElement>('[value="violet"]').element.checked,
  ).toBe(true);
  await wrapper.setProps({ selectedTheme: dusk.key, themeBusy: true });
  expect(wrapper.get("fieldset").attributes("aria-busy")).toBe("true");
  expect(radio.element.checked).toBe(true);
  expect(
    wrapper.get<HTMLInputElement>('[value="violet"]').element.checked,
  ).toBe(false);
});

it("lets users clear the active plugin theme without writing a new accent in a read-only workspace", async () => {
  const wrapper = mount(AppearanceSettings, {
    props: {
      ...props,
      workspaceThemes: true,
      accent: "peach",
      writable: false,
      themes: [mist],
      selectedTheme: mist.key,
    },
    attachTo: document.body,
  });
  const builtin = wrapper.get<HTMLInputElement>('[value="peach"]');
  expect(builtin.element.disabled).toBe(false);
  expect(
    wrapper.get<HTMLInputElement>('[value="violet"]').element.disabled,
  ).toBe(true);
  await builtin.setValue();
  expect(wrapper.emitted("select")).toEqual([["peach"]]);
  expect(builtin.element.checked).toBe(false);
  await wrapper.setProps({ selectedTheme: undefined });
  expect(builtin.element.checked).toBe(true);
  expect(builtin.element.disabled).toBe(true);
});

it("keeps independent color groups and descriptions when used twice", async () => {
  const wrapper = mount(
    {
      components: { AppearanceSettings },
      setup: () => ({ props }),
      template:
        '<div><AppearanceSettings v-bind="props" /><AppearanceSettings v-bind="props" compact /></div>',
    },
    { attachTo: document.body },
  );
  const first = wrapper.findAllComponents(AppearanceSettings)[0]!;
  const second = wrapper.findAllComponents(AppearanceSettings)[1]!;
  expect(first.get("input").attributes("name")).not.toBe(
    second.get("input").attributes("name"),
  );
  expect(first.get("fieldset").attributes("aria-describedby")).not.toBe(
    second.get("fieldset").attributes("aria-describedby"),
  );
  await second.get('[value="lemon"]').setValue();
  expect(first.get<HTMLInputElement>('[value="violet"]').element.checked).toBe(
    true,
  );
  expect(second.emitted("select")).toEqual([["lemon"]]);
});
