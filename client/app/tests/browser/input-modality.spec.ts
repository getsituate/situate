import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import { expectDialogTypography } from "./dialog-typography";

test.use({ localizationMode: "real" });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
});

test("pane layout retains automatic focus but shows outlines only during keyboard navigation @visual-desktop", async ({
  page,
  browserName,
  visual,
}) => {
  const tab =
    process.platform === "darwin" && browserName === "webkit"
      ? "Alt+Tab"
      : "Tab";
  const trigger = page.locator(".surface-pane-options");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Pane layout", exact: true });
  const first = dialog.locator(".pane-actions button").first();
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-style", "none");
  await expectDialogTypography(dialog);
  await visual.capture("focus.pane-layout.pointer");

  await page.keyboard.press(tab);
  const focused = dialog.locator(":focus");
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveCSS("outline-style", "solid");
  await page.keyboard.press(`Shift+${tab}`);
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-style", "solid");
  await visual.capture("focus.pane-layout.keyboard");

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS("outline-style", "solid");
  await trigger.click();
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-style", "none");
});

for (const width of [1440, 390]) {
  test(`pane actions retain alignment, contrast and dialog insets at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
    if (width < 600) {
      await page.locator(".tab-header .tab-actions-trigger").click();
      await page
        .getByRole("menuitem", { name: "Pane layout", exact: true })
        .click();
    } else {
      await page.locator(".surface-pane-options").click();
    }
    const dialog = page.getByRole("dialog", {
      name: "Pane layout",
      exact: true,
    });
    const actions = dialog.locator(".pane-actions button");
    const first = actions.first();
    const insets = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ];
    });
    expect(new Set(insets).size).toBe(1);
    const iconPositions: number[] = [];
    for (const action of await actions.all()) {
      await expect(action).toHaveCSS("justify-content", "flex-start");
      iconPositions.push((await action.locator("svg").boundingBox())!.x);
    }
    expect(new Set(iconPositions).size).toBe(1);
    await first.hover();
    const colors = await first.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        foreground: style.color,
        background: style.backgroundColor,
        ink: getComputedStyle(element.closest("dialog")!).color,
      };
    });
    await expect(first).toHaveCSS("color", colors.ink);
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      return channels.reduce((sum, value, index) => {
        const channel = value / 255;
        const linear =
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index];
      }, 0);
    };
    const light = luminance(colors.background);
    const dark = luminance(colors.foreground);
    expect(
      (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
    await expectDialogTypography(dialog);
    await dialog.screenshot({ path: testInfo.outputPath("pane-actions.png") });
  });
}

test("arrow navigation in a mouse-opened menu enables its keyboard highlight", async ({
  page,
}) => {
  await page.locator(".tab-header .tab-actions-trigger").click();
  const menu = page.getByRole("menu");
  const first = menu.locator(":focus");
  await expect(first).toHaveCount(1);
  await expect(first).toHaveCSS("outline-style", "none");
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator(":focus")).toHaveCSS("outline-style", "solid");
  await menu.dispatchEvent("pointerdown", { pointerType: "touch" });
  await expect(menu.locator(":focus")).toHaveCSS("outline-style", "none");
});

test("composer focus decoration follows input modality without clearing the draft", async ({
  page,
}) => {
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  const line = page.locator(".input-line");
  await input.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(line).toHaveCSS("outline-style", "none");
  await input.pressSequentially("Draft");
  await expect(line).toHaveCSS("outline-style", "solid");
  await input.click();
  await expect(input).toBeFocused();
  await expect(line).toHaveCSS("outline-style", "none");
  await expect(input).toHaveValue("Draft");
});
