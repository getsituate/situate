import { test, expect, type Page } from "./test";
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
  for (const name of [
    "Violet",
    "Cobalt",
    "Sky",
    "Tangerine",
    "Peach",
    "Lemon",
  ]) {
    await page.getByRole("radio", { name: new RegExp(`^${name}`) }).check();
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
      ];
      probe.remove();
      return values;
    });
    for (const ratio of ratios.slice(0, 4))
      expect(ratio, name).toBeGreaterThanOrEqual(4.5);
    expect(ratios[4], `${name} edge`).toBeGreaterThanOrEqual(3);
    await expect(page.getByAltText("Situate", { exact: true })).toHaveAttribute(
      "src",
      wordmark!,
    );
  }
  await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
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
  await page
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
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
  await page.reload();
  await openAppearance(page);
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
