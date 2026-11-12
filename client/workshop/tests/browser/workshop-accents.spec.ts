import { selectOption, selectOptions } from "./select";
import { expect, test, type Page } from "./test";
import { accents } from "../../src/settings/accents";
import copy from "../../src/localization/en.appearance.json" with { type: "json" };

async function open(controls: Page) {
  await controls.goto("/?workshop=controls&scenario=settings-appearance");
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1280, height: 800 });
  await expect(
    preview.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  return preview;
}

async function switchWorkspace(preview: Page, name: string) {
  await preview
    .getByRole("button", { name: "Workspace menu", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
}

test("all brand accents apply immediately with readable contrast and intact artwork", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  const root = preview.locator("[data-workspace-accent]");
  const wordmark = await preview
    .getByAltText("Situate", { exact: true })
    .getAttribute("src");
  await expect(preview.getByRole("radio")).toHaveCount(6);
  await expect(preview.getByLabel("Find an action")).toHaveCount(0);
  for (const accent of accents) {
    await preview
      .getByRole("radio", { name: new RegExp(`^${copy.colors[accent]}`) })
      .check();
    await expect(root).toHaveAttribute("data-workspace-accent", accent);
    await expect(
      page.getByLabel("Workspace accent", { exact: true }),
    ).toHaveAttribute("data-value", accent);
    const ratios = await root.evaluate((node) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const probe = document.createElement("span");
      node.append(probe);
      const luminance = (color: string) => {
        probe.style.color = color;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(probe).color;
        context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      };
      const contrast = (a: string, b: string) => {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const results = [
        contrast("var(--situate-accent-on)", "var(--situate-accent)"),
        contrast("var(--situate-accent-strong)", "var(--situate-surface)"),
        contrast("var(--situate-accent-strong)", "var(--situate-paper)"),
        contrast("var(--situate-accent-strong)", "var(--situate-accent-soft)"),
      ];
      probe.remove();
      return results;
    });
    for (const ratio of ratios)
      expect(ratio, `${accent} contrast`).toBeGreaterThanOrEqual(4.5);
    await expect(
      preview.getByAltText("Situate", { exact: true }),
    ).toHaveAttribute("src", wordmark!);
    await preview.screenshot({
      path: testInfo.outputPath(`appearance-${accent}.png`),
    });
  }
  await expect(preview.getByRole("button", { name: /^Save/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("workspace switching, navigation, keyboard selection and reset retain the right accent", async ({
  page,
}) => {
  const preview = await open(page);
  const violet = preview.getByRole("radio", { name: /^Violet/ });
  await violet.focus();
  await preview.keyboard.press("ArrowRight");
  await expect(
    preview.getByRole("radio", { name: "Cobalt", exact: true }),
  ).toBeChecked();
  await expect(
    preview.getByRole("radio", { name: "Cobalt", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press("ArrowRight");
  await expect(
    preview.getByRole("radio", { name: "Sky", exact: true }),
  ).toBeChecked();
  const selection = preview.locator(
    '.settings-categories [aria-current="page"]',
  );
  const skyBackground = await selection.evaluate(
    (n) => getComputedStyle(n).backgroundColor,
  );
  await preview.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    page.getByLabel("Workspace accent", { exact: true }),
  ).toHaveCount(0);
  await expect(preview.locator("[data-workspace-accent]")).toHaveAttribute(
    "data-workspace-accent",
    "sky",
  );
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    preview.getByRole("radio", { name: "Sky", exact: true }),
  ).toBeChecked();
  await switchWorkspace(preview, "Reading room");
  await preview.getByRole("button", { name: /Appearance/ }).click();
  await expect(violet).toBeChecked();
  expect(
    await selection.evaluate((n) => getComputedStyle(n).backgroundColor),
  ).not.toBe(skyBackground);
  await preview.getByRole("radio", { name: "Peach", exact: true }).check();
  await switchWorkspace(preview, "Field notes");
  await expect(
    preview.getByRole("radio", { name: "Sky", exact: true }),
  ).toBeChecked();
  await expect(preview.locator("#accent-help")).toContainText("Field notes");
  await preview.reload();
  await expect(
    preview.getByRole("radio", { name: "Sky", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Reset scenario" }).click();
  await expect(violet).toBeChecked();
});

test("accent tiles reflow on mobile, preserve focus on resize and fit safe areas", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  await preview.getByRole("radio", { name: "Lemon", exact: true }).check();
  for (const profile of ["ios", "android"]) {
    await selectOption(page.getByLabel("Platform profile"), profile);
    for (const width of [390, 320]) {
      await preview.setViewportSize({ width, height: 844 });
      const lemon = preview.getByRole("radio", { name: "Lemon", exact: true });
      await expect(lemon).toBeChecked();
      await lemon.focus();
      await expect(lemon).toBeFocused();
      await lemon.scrollIntoViewIfNeeded();
      expect(
        await preview
          .locator(".settings-content")
          .evaluate((n) => n.scrollWidth <= n.clientWidth),
      ).toBe(true);
      for (const tile of await preview.locator(".appearance-option").all()) {
        const box = await tile.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const box = await lemon.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(profile === "ios" ? 59 : 32);
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        844 - (profile === "ios" ? 34 : 24),
      );
      await preview.screenshot({
        path: testInfo.outputPath(`appearance-${profile}-${width}.png`),
      });
    }
  }
  await preview.getByRole("button", { name: /All settings/ }).click();
  await preview.getByRole("button", { name: /Appearance/ }).click();
  await expect(
    preview.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeFocused();
  await expect(
    preview.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
});

test("appearance starting states share one scenario and retain their direct links", async ({
  page,
}) => {
  const preview = await open(page);
  const scenario = page.getByRole("combobox", {
    name: "Scenario",
    exact: true,
  });
  const states = page.getByRole("combobox", {
    name: "Starting state",
    exact: true,
  });
  await expect(scenario).toHaveAttribute("data-value", "settings-appearance");
  await expect(
    (await selectOptions(scenario)).filter((option) =>
      option.value.startsWith("settings-appearance"),
    ),
  ).toHaveLength(1);
  await expect(await selectOptions(states)).toHaveLength(2);
  await expect(states).toHaveAttribute("data-value", "settings-appearance");
  await selectOption(states, "settings-appearance-light");
  await expect(page).toHaveURL(/scenario=settings-appearance-light/);
  await expect(scenario).toHaveAttribute("data-value", "settings-appearance");
  await expect(
    preview.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
  await preview.getByRole("radio", { name: "Sky", exact: true }).check();
  await expect(states).toHaveAttribute(
    "data-value",
    "settings-appearance-light",
  );
  await selectOption(page.getByLabel("Platform profile"), "ios");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(
    preview.getByRole("radio", { name: "Sky", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Platform profile")).toHaveAttribute(
    "data-value",
    "ios",
  );
  await page.reload();
  await expect(states).toHaveAttribute(
    "data-value",
    "settings-appearance-light",
  );
  await expect(
    preview.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
  await selectOption(states, "settings-appearance");
  await expect(preview.getByRole("radio", { name: /^Violet/ })).toBeChecked();
});

test("document highlights and shared select popovers inherit the workspace accent", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  await preview.getByRole("radio", { name: "Peach", exact: true }).check();
  const strong = await preview
    .locator('.footer-action[aria-current="page"]')
    .evaluate((n) => getComputedStyle(n).color);
  await preview.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(preview.locator(".documents-view")).toBeVisible();
  await expect(preview.locator(".doc-heading-icon")).toHaveCSS("color", strong);
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await preview.getByRole("button", { name: /Language & formats/ }).click();
  const time = preview.getByRole("combobox", {
    name: "Time format",
    exact: true,
  });
  const tint = await time
    .locator(".select-chevron")
    .evaluate((n) => getComputedStyle(n).backgroundColor);
  await time.click();
  const popup = preview.locator(".situate-select-popup");
  await expect(
    preview.locator("[data-workspace-accent] > .situate-select-popup"),
  ).toBeVisible();
  await expect(
    popup.locator('[role="option"][aria-selected="true"]'),
  ).toHaveCSS("background-color", tint);
  await preview.screenshot({
    path: testInfo.outputPath("appearance-select-desktop.png"),
  });
  await selectOption(page.getByLabel("Platform profile"), "ios");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(popup).toHaveClass(/select-sheet/);
  await expect(
    popup.locator('[role="option"][aria-selected="true"]'),
  ).toHaveCSS("background-color", tint);
  await preview.screenshot({
    path: testInfo.outputPath("appearance-select-mobile.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(time).toBeFocused();
  await time.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(popup).toHaveCount(0);
  await expect(preview.getByRole("radio", { name: /^Violet/ })).toBeChecked();
});
