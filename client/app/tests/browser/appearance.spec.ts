import type { LayoutDocument } from "../../src/layout/storage";
import { test, expect, type Page } from "./test";
import type { PluginSource } from "../../src/plugins/types";
import type { ThemeDefinition } from "../../src/settings/theme-tokens";
import {
  workspaceFixture,
  shellState,
  garden,
  reading,
} from "./workspace-fixture";

test.use({ localizationMode: "real" });
async function openAppearance(page: Page) {
  const settings = page.getByRole("button", {
    name: /^(Settings|Einstellungen)$/,
  });
  const navigation = page.getByRole("button", {
    name: /^(Open navigation|Navigation öffnen)$/,
  });
  await expect
    .poll(
      async () =>
        (await settings.isVisible()) || (await navigation.isVisible()),
    )
    .toBe(true);
  if (!(await settings.isVisible())) await navigation.click();
  await settings.click();
  await page
    .getByRole("button", { name: /^(Appearance|Erscheinungsbild)/ })
    .click();
  await expect(
    page.getByRole("heading", { name: /^(Appearance|Erscheinungsbild)$/ }),
  ).toBeVisible();
}
async function switchWorkspace(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Workspace menu", exact: true })
    .click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
}

test("all six accents have readable controls and leave the wordmark unchanged", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await openAppearance(page);
  const wordmark = await page
    .getByAltText("Situate", { exact: true })
    .getAttribute("src");
  for (const [name, companion] of [
    ["Violet", "Peach"],
    ["Cobalt", "Peach"],
    ["Sky", "Peach"],
    ["Tangerine", "Sky"],
    ["Peach", "Sky"],
    ["Lemon", "Sky"],
  ] as const) {
    const radio = page.getByRole("radio", { name: new RegExp(`^${name}`) });
    await expect(radio).toHaveAccessibleDescription(`Paired with ${companion}`);
    await radio.check();
    const option = page.locator(".appearance-option").filter({ has: radio });
    await expect(option.locator(".appearance-selected")).toBeVisible();
    const swatch = await option.locator(".appearance-swatch").evaluate(
      (node, names) => {
        const probe = document.createElement("span");
        node.append(probe);
        const colors = names.map((color) => {
          probe.style.color = `var(--situate-${color.toLowerCase()})`;
          return getComputedStyle(probe).color;
        });
        probe.remove();
        return { colors, gradient: getComputedStyle(node).backgroundImage };
      },
      [name, companion],
    );
    for (const color of swatch.colors) expect(swatch.gradient).toContain(color);
    expect(swatch.colors[0]).not.toBe(swatch.colors[1]);
    await expect(page.locator("html")).toHaveAttribute(
      "data-workspace-accent",
      name.toLowerCase(),
    );
    const ratios = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      function luminance(color: string) {
        probe.style.color = color;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(probe).color;
        context.fillRect(0, 0, 1, 1);
        const values = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
      }
      function contrast(a: string, b: string) {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      }
      const values = [
        contrast("var(--situate-accent-on)", "var(--situate-accent)"),
        contrast("var(--situate-accent-strong)", "var(--situate-surface)"),
        contrast("var(--situate-accent-strong)", "var(--situate-paper)"),
        contrast("var(--situate-accent-strong)", "var(--situate-accent-soft)"),
        contrast("var(--situate-accent-edge)", "var(--situate-surface)"),
        contrast("var(--situate-muted)", "var(--situate-content-tint)"),
        contrast("var(--situate-muted)", "var(--situate-content-wash)"),
      ];
      probe.remove();
      return values;
    });
    for (const ratio of ratios.slice(0, 4))
      expect(ratio, name).toBeGreaterThanOrEqual(4.5);
    expect(ratios[4], `${name} edge`).toBeGreaterThanOrEqual(3);
    for (const ratio of ratios.slice(5))
      expect(ratio, `${name} companion`).toBeGreaterThanOrEqual(4.5);
    await expect(page.getByAltText("Situate", { exact: true })).toHaveAttribute(
      "src",
      wordmark!,
    );
  }
  await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
});

async function themeFixture(
  page: Page,
  title: string,
  variables: Record<string, string>,
  metadata: Pick<ThemeDefinition, "preview" | "brandAssets"> = {},
  options: Parameters<typeof workspaceFixture>[2] = {},
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const source: PluginSource = {
    manifest: {
      schemaVersion: 3,
      id: "aurora",
      name: "Theme Lab",
      description: "",
      uiEntry: "ui.js",
      skills: [],
    },
    serviceEntry: null,
    uiEntry: `export default (host) => host.themeApi === 1 ? (${JSON.stringify({ themes: [{ id: "paper", title, variables, ...metadata }] })}) : ({})`,
    skills: [],
    modules: {},
  };
  await workspaceFixture(page, shellState, {
    ...options,
    installedPlugins: [
      {
        id: "aurora",
        incarnation: "first-installation",
        enabled: true,
        error: null,
        manifest: source.manifest,
      },
    ],
    pluginSources: { aurora: source },
  });
  await page.goto("/");
  await openAppearance(page);
}

test("applies a low-contrast plugin theme and keeps the built-in theme choice usable", async ({
  page,
}) => {
  await themeFixture(page, "Mist", {
    "--situate-ink": "#e0e0e0",
    "--situate-surface": "#f0f6ff",
  });
  const custom = page.getByRole("radio", { name: /Mist.*Theme Lab/ });
  await expect(custom).toBeVisible();
  await custom.click();
  await expect(custom).toBeChecked();
  await expect(page.locator(".app-shell")).toHaveCSS(
    "color",
    "rgb(224, 224, 224)",
  );
  await expect(page.locator(".settings-view")).toHaveCSS(
    "color",
    "rgb(224, 224, 224)",
  );
  await expect(
    page.locator(".appearance-plugin-option .appearance-option-content"),
  ).toHaveCSS("border-top-color", "rgb(224, 224, 224)");
  const themedSurface = "rgb(240, 246, 255)";
  await expect(page.locator(".settings-view")).toHaveCSS(
    "background-color",
    themedSurface,
  );
  await page.locator(".desktop-sidebar .plugins-action").click();
  await expect(page.locator(".plugin-view")).toHaveCSS(
    "background-color",
    themedSurface,
  );
  await openAppearance(page);
  await page.getByRole("radio", { name: /^Violet/ }).click();
  await expect(page.locator(".app-shell")).toHaveCSS(
    "color",
    "rgb(48, 32, 62)",
  );
});

test("plugin themes appear under Theme and can be replaced by a built-in theme @visual-desktop", async ({
  page,
  visual,
}) => {
  const iconPath = "M5 4H19V20H5ZM8 8H16M8 12H16M8 16H13";
  await themeFixture(
    page,
    "Cool Paper",
    {
      "--situate-paper": "#edf4ff",
      "--situate-text-body": "18px",
      "--situate-space-3": "14px",
      "--situate-radius-control": "8px",
    },
    { preview: { color: "#337658", icon: { path: iconPath } } },
  );
  const choices = page.getByRole("group", { name: "Theme", exact: true });
  const custom = choices.getByRole("radio", { name: /Cool Paper.*Theme Lab/ });
  const builtin = choices.getByRole("radio", { name: "Cobalt", exact: true });
  await expect(choices.getByRole("radio")).toHaveCount(7);
  await expect(custom).not.toBeChecked();
  await expect(page.locator(".app-shell")).not.toHaveAttribute(
    "data-theme-surface",
    "",
  );
  const swatch = choices.locator(".appearance-theme-swatch");
  await expect(swatch.locator("path")).toHaveAttribute("d", iconPath);
  await expect(swatch).toHaveCSS("color", "rgb(51, 118, 88)");
  await expect(choices.getByText(/Choose a theme for/)).toHaveCount(0);
  const info = choices.getByRole("button", { name: "About plugin themes" });
  const deviceNote = page.getByText("Plugin themes apply only on this device.");
  await expect(deviceNote).not.toBeVisible();
  await visual.capture("appearance.plugin-theme-available");
  await info.click();
  await expect(deviceNote).toBeVisible();
  await visual.capture("appearance.plugin-theme-info");
  await page.keyboard.press("Escape");
  await expect(deviceNote).not.toBeVisible();
  await custom.click();
  await expect(custom).toBeChecked();
  await expect(page.locator(".app-shell")).toHaveCSS("font-size", "18px");
  const settings = page.locator(".settings-view");
  await expect(settings).toHaveCSS("font-size", "18px");
  await expect(
    choices.locator(".appearance-plugin-option .appearance-option-content"),
  ).toHaveCSS("border-top-color", "rgb(51, 118, 88)");
  await visual.capture("appearance.plugin-theme-selected");
  await expect(page.locator(".desktop-sidebar")).toHaveCSS(
    "--situate-paper",
    "#edf4ff",
  );
  await page
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(page.locator(".chat-pane")).toHaveCSS("font-size", "18px");
  await visual.capture("appearance.plugin-theme-chat");
  await page
    .getByRole("button", { name: "Workspace menu", exact: true })
    .click();
  const workspaceMenu = page.getByRole("menu", {
    name: "Workspace",
    exact: true,
  });
  await expect(workspaceMenu).toBeVisible();
  await expect(workspaceMenu).toHaveCSS("--situate-paper", "#edf4ff");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.locator(".files-pane")).toHaveCSS(
    "--situate-space-3",
    "14px",
  );
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveCSS("font-size", "18px");
  await openAppearance(page);
  await expect(custom).toBeChecked();
  await builtin.click();
  await expect(builtin).toBeChecked();
  await expect(page.locator(".app-shell")).toHaveCSS("font-size", "16px");
  await expect(page.locator("html")).toHaveAttribute(
    "data-workspace-accent",
    "cobalt",
  );
  await custom.click();
  await expect(custom).toBeChecked();
  await page.locator(".desktop-sidebar .plugins-action").click();
  const plugins = page.locator(".plugin-view");
  await expect(plugins).toHaveCSS("font-size", "18px");
  const plugin = plugins.getByRole("article", {
    name: "Theme Lab",
    exact: true,
  });
  await expect(plugin).toBeVisible();
  await visual.capture("appearance.plugin-theme-management");
  await plugin.getByRole("button", { name: "Disable", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Disable", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toHaveCSS("font-size", "16px");
  await openAppearance(page);
  await expect(custom).toHaveCount(0);
  await expect(builtin).toBeChecked();
});

test("dark theme selects legible brand artwork and restores the default artwork @visual-desktop", async ({
  page,
  visual,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await themeFixture(
    page,
    "Green terminal",
    {
      "--situate-paper": "#0e1a13",
      "--situate-surface": "#14241b",
      "--situate-ink": "#c6f5d4",
      "--situate-muted": "#9dbba6",
      "--situate-line": "#435d4c",
      "--situate-control-line": "#698777",
      "--situate-accent-soft": "#254435",
      "--situate-accent-strong": "#a7eab8",
    },
    { brandAssets: "on-dark" },
    {
      aiConnection: {
        provider: "openai",
        endpoint: null,
        connectionId: "personal",
        label: "Personal",
      },
      aiModel: "gpt-5.4",
      aiHoldPartialResponse: true,
    },
  );
  const wordmark = page.getByAltText("Situate", { exact: true });
  await expect(wordmark).toBeVisible();
  const standardWordmark = (await wordmark.getAttribute("src"))!;
  const back = page.getByRole("button", {
    name: "Back in this pane",
    exact: true,
  });
  await page.getByRole("radio", { name: /Green terminal.*Theme Lab/ }).click();
  await expect(wordmark).not.toHaveAttribute("src", standardWordmark);
  await expect(wordmark).toHaveAttribute("src", /%23fffefa|wordmark-light/);
  await back.click();
  const depth = page.locator('.welcome-bend [data-bend-part="depth"]');
  await expect(depth).toBeVisible();
  await expect(depth).toHaveCSS("fill", "rgb(134, 81, 237)");
  await visual.capture("appearance.brand-on-dark");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const mini = page.locator(".bend-toggle .mini-bend-playful path").first();
  await expect(mini).toBeVisible();
  await expect(mini).toHaveCSS("stroke", "rgb(217, 198, 255)");
  await page
    .getByRole("button", { name: "Pause animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume animation", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await visual.capture("appearance.brand-on-dark-working");
  await openAppearance(page);
  await page.getByRole("radio", { name: /^Violet/ }).click();
  await expect(wordmark).toHaveAttribute("src", standardWordmark);
  await back.click();
  await expect(mini).toHaveCSS("stroke", "rgb(98, 50, 188)");
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .click();
  await page.evaluate(() => Reflect.get(window, "__finishResponse")());
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(depth).toHaveCSS("fill", "rgb(86, 50, 155)");
});

test("selection survives navigation, reload and workspace switches without discarding the chat draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, {
    ...shellState,
    known: [garden, reading],
    open: [garden, reading],
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("An unsent question");
  await openAppearance(page);
  await page.getByRole("radio", { name: /^Violet/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Cobalt", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("radio", { name: "Cobalt", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-workspace-accent",
    "cobalt",
  );
  const back = page.getByRole("button", {
    name: "Back in this pane",
    exact: true,
  });
  await back.click();
  await expect(
    page.getByRole("radio", { name: "Cobalt", exact: true }),
  ).toBeChecked();
  await back.click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("An unsent question");
  await switchWorkspace(page, "Reading room");
  await openAppearance(page);
  await expect(page.getByRole("radio", { name: /^Violet/ })).toBeChecked();
  await page.getByRole("radio", { name: "Peach", exact: true }).check();
  await switchWorkspace(page, "Garden notes");
  await openAppearance(page);
  await expect(
    page.getByRole("radio", { name: "Cobalt", exact: true }),
  ).toBeChecked();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { data } = await window.__layoutTest.stored("garden");
        const layout = (data as LayoutDocument | null)?.layout;
        const tab = layout?.tabs.find(({ id }) => id === layout.activeTabId);
        const pane = tab?.panes.find(({ id }) => id === tab.activePaneId);
        return pane?.navigation.entries[pane.navigation.cursor];
      }),
    )
    .toMatchObject({
      target: { kind: "view", viewId: "settings" },
      presentation: { page: "appearance", detail: true },
    });
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Cobalt", exact: true }),
  ).toBeChecked();
  await page.getByRole("radio", { name: /^Violet/ }).check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-workspace-accent",
    "violet",
  );
});

test.describe("German appearance", () => {
  test.use({ locale: "de-DE" });
  for (const width of [320, 1440]) {
    test(
      `appearance fits ${width}px and restores category focus`,
      {
        tag: width === 320 ? "@visual-mobile" : "@visual-desktop",
      },
      async ({ page, visual }) => {
        await page.setViewportSize({ width, height: 900 });
        await workspaceFixture(page, shellState, {
          localization: {
            language: "de",
            formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
            writable: true,
          },
        });
        await page.goto("/");
        await openAppearance(page);
        const settingsBounds = await page
          .locator(".settings-view")
          .boundingBox();
        expect(settingsBounds!.x + settingsBounds!.width).toBe(width);
        await expect(
          page.getByRole("radio", { name: /^Violett/ }),
        ).toBeChecked();
        await visual.capture("settings.appearance-violet");
        await page.getByRole("radio", { name: "Zitrone", exact: true }).check();
        await expect(page.locator("html")).toHaveAttribute(
          "data-workspace-accent",
          "lemon",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await visual.capture("settings.appearance-lemon");
        if (width === 320) {
          await page
            .getByRole("button", { name: "Alle Einstellungen", exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: /^Erscheinungsbild/ }),
          ).toBeFocused();
          await visual.capture("settings.appearance-categories");
        }
      },
    );
  }
});

test("read-only appearance never issues writes", async ({ page }) => {
  await workspaceFixture(page, shellState, {
    appearance: { accent: "sky", writable: false, revision: "saved" },
  });
  await page.goto("/");
  await openAppearance(page);
  await expect(
    page.getByRole("radio", { name: "Sky", exact: true }),
  ).toBeChecked();
  for (const radio of await page.getByRole("radio").all())
    await expect(radio).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, "__ipcCalls") as { command: string }[]).filter(
        (call) => call.command === "appearance_update",
      ),
    ),
  ).toEqual([]);
});

test(
  "load errors offer reload without presenting an editable default",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspaceFixture(page, shellState, { appearanceLoadError: true });
    await page.goto("/");
    await openAppearance(page);
    await expect(page.getByRole("alert")).toContainText("could not be loaded");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reload", exact: true }),
    ).toBeEnabled();
    await visual.capture("settings.appearance-load-error");
  },
);

test(
  "save failure restores the persisted choice",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspaceFixture(page, shellState, { appearanceSaveError: true });
    await page.goto("/");
    await openAppearance(page);
    await page.getByRole("radio", { name: "Lemon", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Violet/ })).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute(
      "data-workspace-accent",
      "violet",
    );
    const recovery = page.getByRole("dialog", {
      name: "Review appearance",
      exact: true,
    });
    await expect(recovery).toBeVisible();
    await expect(
      recovery.getByRole("button", { name: "Reload", exact: true }),
    ).toHaveClass(/situate-button--primary/);
    await visual.capture("settings.appearance-save-error");
    await page.keyboard.press("Escape");
    await expect(recovery).toBeHidden();
    await expect(page.getByRole("radio", { name: /^Violet/ })).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Lemon", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Reload", exact: true }),
    ).toHaveClass(/situate-button--secondary/);
    await visual.capture("settings.appearance-save-error-dismissed");
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /^Violet/ })).toBeChecked();
  },
);

test("an uncertain write reloads the actual saved color", async ({ page }) => {
  await workspaceFixture(page, shellState, { appearanceSaveThenFail: true });
  await page.goto("/");
  await openAppearance(page);
  await page.getByRole("radio", { name: "Lemon", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute(
    "data-workspace-accent",
    "lemon",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
});

test("keyboard focus survives delayed appearance events without stealing focus after navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await openAppearance(page);
  await page.getByRole("radio", { name: /^Violet/ }).focus();
  await page.keyboard.press("ArrowRight");
  const cobalt = page.getByRole("radio", { name: "Cobalt", exact: true });
  await expect(cobalt).toBeChecked();
  await expect(cobalt).toBeEnabled();
  await expect(cobalt).toBeFocused();
  await page.evaluate(() => {
    const ipc = Reflect.get(window, "__TAURI_INTERNALS__") as {
      invoke: (command: string, args?: unknown) => Promise<unknown>;
    };
    const original = ipc.invoke;
    ipc.invoke = async (command, args) => {
      if (command === "appearance_snapshot")
        await new Promise<void>((resolve) => {
          Reflect.set(window, "__finishAppearanceReload", resolve);
        });
      return original(command, args);
    };
    (Reflect.get(window, "__appearanceChanged") as (scope: string) => void)(
      "garden",
    );
  });
  await expect(cobalt).toBeDisabled();
  await page.evaluate(() =>
    (Reflect.get(window, "__finishAppearanceReload") as () => void)(),
  );
  await expect(cobalt).toBeEnabled();
  await expect(cobalt).toBeFocused();
  await page.evaluate(() =>
    (Reflect.get(window, "__appearanceChanged") as (scope: string) => void)(
      "garden",
    ),
  );
  await expect(cobalt).toBeDisabled();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.evaluate(() =>
    (Reflect.get(window, "__finishAppearanceReload") as () => void)(),
  );
  await expect(page.locator(".settings-view")).toHaveCount(0);
  await expect(page.locator(".topic-window")).toBeVisible();
});

test("keyboard focus returns after failed-save reconciliation", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    appearanceSaveError: true,
    appearanceDeferSave: true,
  });
  await page.goto("/");
  await openAppearance(page);
  await page.getByRole("radio", { name: /^Violet/ }).focus();
  await page.keyboard.press("ArrowRight");
  const cobalt = page.getByRole("radio", { name: "Cobalt", exact: true });
  await expect(cobalt).toBeChecked();
  await page.evaluate(() =>
    (Reflect.get(window, "__finishAppearanceSave") as () => void)(),
  );
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Violet/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(cobalt).toBeFocused();
});

test("workspace switching waits for the color to finish saving", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(
    page,
    { ...shellState, known: [garden, reading], open: [garden, reading] },
    { appearanceDeferSave: true },
  );
  await page.goto("/");
  await openAppearance(page);
  await page.getByRole("radio", { name: "Lemon", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-workspace-accent",
    "lemon",
  );
  await switchWorkspace(page, "Reading room");
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
  await page.evaluate(() =>
    (Reflect.get(window, "__finishAppearanceSave") as () => void)(),
  );
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  await expect(page.locator("html")).toHaveAttribute(
    "data-workspace-accent",
    "violet",
  );
  await switchWorkspace(page, "Garden notes");
  await openAppearance(page);
  await expect(
    page.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
});
