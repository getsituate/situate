import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(controls: Page, scenario: string, startNarrow = false) {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  if (startNarrow)
    await controls.getByRole("button", { name: "Mobile", exact: true }).click();
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(preview.locator(".topic-window")).toBeVisible();
  return preview;
}

async function fits(page: Page) {
  expect(
    await page
      .locator(".topic-window")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
}

async function compactToolbar(page: Page) {
  const header = page.locator(".maximized-pane-header");
  const { box, targets } = await header.evaluate((element) => ({
    box: element.getBoundingClientRect().toJSON(),
    targets: [
      ...element.querySelectorAll(".maximized-pane-toolbar button"),
    ].map((button) => button.getBoundingClientRect().toJSON()),
  }));
  expect(box.height).toBeGreaterThanOrEqual(52);
  expect(box.height).toBeLessThanOrEqual(56);
  expect(targets).toHaveLength(5);
  for (const target of targets) {
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.y + target.height / 2).toBeCloseTo(
      box.y + (box.height - 1) / 2,
      0,
    );
    expect(target.x).toBeGreaterThanOrEqual(box.x);
    expect(target.x + target.width).toBeLessThanOrEqual(box.x + box.width);
  }
  await fits(page);
}

test("compact maximized pane toolbar keeps history, switching and restore; keyboard switch preserves draft", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-maximized");
  await preview.setViewportSize({ width: 1440, height: 920 });
  const header = preview.locator(".maximized-pane-header");
  await expect(
    header.getByRole("button", {
      name: "Switch pane: Garden chat",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.locator(".pane-toolbar, .layout-footer, .pane-grip"),
  ).toHaveCount(0);
  const restore = header.getByRole("button", {
    name: "Restore arrangement",
    exact: true,
  });
  await expect(restore).toHaveText("");
  await expect(restore).toHaveAttribute(
    "aria-description",
    "Restore arrangement",
  );
  const restoreIcon = await restore.locator("path").getAttribute("d");
  expect(restoreIcon).toBeTruthy();
  await header
    .getByRole("button", { name: "Pane layout: Garden chat", exact: true })
    .click();
  const options = preview.getByRole("dialog", {
    name: "Pane layout",
    exact: true,
  });
  const menuRestore = options.getByRole("button", {
    name: "Restore arrangement",
    exact: true,
  });
  await expect(menuRestore).toBeVisible();
  await expect(menuRestore).toHaveText("Restore arrangement");
  await expect(menuRestore.locator("path")).toHaveAttribute("d", restoreIcon!);
  const split = options.getByRole("button", {
    name: "Add pane to the right",
    exact: true,
  });
  expect(await split.locator("path").getAttribute("d")).not.toBe(restoreIcon);
  await preview.screenshot({ path: info.outputPath("restore-menu.png") });
  await preview.keyboard.press("Escape");
  const draft = preview.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Keep Saturday afternoon free.");
  await header
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(
    header.getByRole("button", {
      name: "Switch pane: Weekend plan",
      exact: true,
    }),
  ).toBeFocused();
  await header
    .getByRole("button", { name: "Forward in this pane", exact: true })
    .click();
  await expect(draft).toHaveValue("Keep Saturday afternoon free.");
  const switcher = header.locator(".switch-pane");
  await switcher.focus();
  await preview.keyboard.press("Enter");
  const dialog = preview.getByRole("dialog", {
    name: "Switch pane",
    exact: true,
  });
  await expect(dialog.locator('[aria-current="true"]')).toBeFocused();
  await preview.keyboard.press("Tab");
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await preview.keyboard.press("Escape");
  await expect(switcher).toBeFocused();
  await switcher.click();
  await dialog.getByRole("button", { name: "2 Tasks", exact: true }).click();
  await expect(
    header.getByRole("button", { name: "Switch pane: Tasks", exact: true }),
  ).toBeFocused();
  await expect(preview.locator(".pane-tile")).toHaveCount(1);
  await switcher.click();
  await dialog
    .getByRole("button", { name: "3 Garden chat", exact: true })
    .click();
  await expect(draft).toHaveValue("Keep Saturday afternoon free.");
  await compactToolbar(preview);
  await preview.screenshot({ path: info.outputPath("maximized-desktop.png") });
  await draft.focus();
  await preview.setViewportSize({ width: 320, height: 540 });
  await expect(preview.locator(".topic-window")).toHaveClass(/narrow-tabs/);
  await expect(draft).toHaveValue("Keep Saturday afternoon free.");
  await expect(draft).toBeFocused();
  await expect(
    header.getByRole("button", { name: "Restore arrangement", exact: true }),
  ).toBeVisible();
  await compactToolbar(preview);
  await preview.screenshot({ path: info.outputPath("maximized-phone.png") });
  await preview.setViewportSize({ width: 1440, height: 920 });
  await header
    .getByRole("button", { name: "Restore arrangement", exact: true })
    .click();
  await expect(preview.locator(".pane-tile")).toHaveCount(3);
  await expect(preview.locator(".pane-tile.active .pane-title")).toBeFocused();
  await expect(draft).toHaveValue("Keep Saturday afternoon free.");
  await preview.locator(".pane-tile.active .pane-title").click();
  const maximize = options.getByRole("button", {
    name: "Maximize pane",
    exact: true,
  });
  await expect(maximize).toBeVisible();
  expect(await maximize.locator("path").getAttribute("d")).not.toBe(
    restoreIcon,
  );
  await preview.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(header).toBeVisible();
  await expect(draft).toHaveValue("");
  await selectOption(
    page.getByLabel("Active pane · Garden chat", { exact: true }),
    "loading",
  );
  await expect(
    preview.getByText("Opening view…", { exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole("button", { name: "Restore arrangement", exact: true }),
  ).toBeVisible();
  await selectOption(
    page.getByLabel("Active pane · Garden chat", { exact: true }),
    "unavailable",
  );
  await expect(
    preview.getByText("This view isn’t available", { exact: true }),
  ).toBeVisible();
  await switcher.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(draft).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Tabs and panes · maximized pane",
      exact: true,
    }),
  ).toBeVisible();
});

test("long pane titles share one toolbar row at desktop widths", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-maximized-many");
  for (const width of [1024, 1440]) {
    await preview.setViewportSize({ width, height: 920 });
    await compactToolbar(preview);
    const title = preview.locator(".switch-pane");
    await expect(title).toHaveAccessibleName(
      /Switch pane: Community garden.*next spring · 9/,
    );
    await preview.screenshot({
      path: info.outputPath(`compact-long-title-${width}.png`),
    });
  }
});

test.describe("direct narrow Move pane entry", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const platform of ["mobile", "desktop"]) {
    test(`opens immediately and returns focus to pane options on ${platform}`, async ({
      page,
    }, info) => {
      const preview = await open(
        page,
        `tabs-move-pane&platform=${platform}`,
        true,
      );
      await expect(preview.locator(".topic-window")).toHaveClass(/narrow-tabs/);
      const dialog = preview.getByRole("dialog", {
        name: "Move pane",
        exact: true,
      });
      const options = preview
        .locator(".mobile-pane-header")
        .getByRole("button", {
          name: "Pane layout: Weekend plan",
          exact: true,
        });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Beside pane")).toBeFocused();
      await preview.screenshot({
        path: info.outputPath("move-initial-narrow.png"),
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      await expect(options).toBeFocused();
      await page
        .getByRole("button", { name: "Reset scenario", exact: true })
        .click();
      await expect(dialog).toBeVisible();
      await preview.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(options).toBeFocused();
    });
  }
});

test("pane state stays selected while controls follow settings and a dismissed starting dialog stays closed", async ({
  page,
}) => {
  const preview = await open(page, "tabs-move-pane");
  await preview.setViewportSize({ width: 1440, height: 900 });
  const dialog = preview.getByRole("dialog", {
    name: "Move pane",
    exact: true,
  });
  const states = page.getByRole("combobox", {
    name: "Starting state",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".tabs-controls")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".tabs-controls")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Apply system-formats fixture",
      exact: true,
    }),
  ).toBeVisible();
  await expect(states).toHaveAttribute("data-value", "tabs-move-pane");
  await preview
    .getByRole("button", { name: "Back to tabs", exact: true })
    .click();
  await expect(page.locator(".tabs-controls")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Apply system-formats fixture",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(dialog).not.toBeVisible();
  await expect(states).toHaveAttribute("data-value", "tabs-move-pane");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Beside pane")).toBeFocused();
});

test.describe("touch pane controls", () => {
  test.use({ hasTouch: true });
  for (const viewport of [
    { width: 1180, height: 820 },
    { width: 820, height: 1180 },
  ]) {
    test(`move pane standard dropdowns and dismissal at ${viewport.width}×${viewport.height}`, async ({
      page,
    }, info) => {
      const preview = await open(page, "tabs-move-pane");
      await preview.setViewportSize(viewport);
      expect(
        await preview.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      const dialog = preview.getByRole("dialog", {
        name: "Move pane",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".situate-select")).toHaveCount(2);
      const target = dialog.getByLabel("Beside pane");
      const position = dialog.getByLabel("Position", { exact: true });
      await expect(target).toBeFocused();
      for (const control of [
        target,
        position,
        dialog.getByRole("button", { name: "Move", exact: true }),
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ]) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await target.tap();
      await preview
        .getByRole("option", { name: "3 · Garden chat", exact: true })
        .tap();
      await selectOption(position, "top");
      await preview.screenshot({ path: info.outputPath("move-tablet.png") });
      await dialog.getByRole("button", { name: "Move", exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      await expect(preview.locator(".pane-tile.active")).toHaveAttribute(
        "data-pane",
        "pane-2",
      );
      await fits(preview);
      await page
        .getByRole("button", { name: "Reset scenario", exact: true })
        .click();
      await expect(dialog).toBeVisible();
      await expect(position).toHaveAttribute("data-value", "right");
      await preview.setViewportSize({ width: 320, height: 540 });
      await expect(preview.locator(".topic-window")).toHaveClass(/narrow-tabs/);
      await expect(target).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Move", exact: true }),
      ).toBeVisible();
      await preview.screenshot({ path: info.outputPath("move-phone.png") });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      const focused = preview.locator(":focus");
      await expect(focused).not.toHaveJSProperty("tagName", "BODY");
    });

    test(`many maximized panes stay readable at ${viewport.width}×${viewport.height}`, async ({
      page,
    }, info) => {
      const preview = await open(page, "tabs-maximized-many");
      await preview.setViewportSize(viewport);
      const header = preview.locator(".maximized-pane-header");
      await expect(header.locator(".switch-pane")).toContainText(
        "seasonal planting observations",
      );
      await compactToolbar(preview);
      await preview.screenshot({
        path: info.outputPath("compact-toolbar-tablet.png"),
      });
      await header.locator(".switch-pane").tap();
      const dialog = preview.getByRole("dialog", {
        name: "Switch pane",
        exact: true,
      });
      await expect(dialog.locator("li")).toHaveCount(12);
      await expect(dialog.locator('[aria-current="true"]')).toBeFocused();
      const current = dialog.locator('[aria-current="true"]');
      expect((await current.boundingBox())!.height).toBeGreaterThanOrEqual(56);
      expect(
        await current.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await preview.screenshot({
        path: info.outputPath("pane-list-tablet.png"),
      });
      await preview.keyboard.press("Escape");
      await expect(header.locator(".switch-pane")).toBeFocused();
      await preview.setViewportSize({ width: 320, height: 540 });
      await fits(preview);
      await preview.screenshot({
        path: info.outputPath("long-pane-phone.png"),
      });
      await header.locator(".switch-pane").tap();
      await dialog.getByRole("button", { name: /12 Community garden/ }).tap();
      await expect(header.locator(".switch-pane")).toContainText(
        "next spring · 1",
      );
      await header.getByRole("button", { name: /^Pane layout:/ }).tap();
      await preview
        .getByRole("button", { name: "Move pane", exact: true })
        .tap();
      const moveDialog = preview.getByRole("dialog", {
        name: "Move pane",
        exact: true,
      });
      await moveDialog.getByLabel("Beside pane").tap();
      await expect(preview.getByRole("option")).toHaveCount(11);
      await expect(
        preview.getByRole("option").filter({ hasText: "next spring · 9" }),
      ).toHaveCount(1);
      await preview.keyboard.press("Escape");
      await expect(moveDialog).toBeVisible();
      await expect(moveDialog.getByLabel("Beside pane")).toBeFocused();
      await preview.keyboard.press("Escape");
      await expect(
        header.getByRole("button", { name: /^Pane layout:/ }),
      ).toBeFocused();
      await header
        .getByRole("button", { name: "Restore arrangement", exact: true })
        .tap();
      await expect(header).toHaveCount(0);
      await expect(preview.locator(".pane-pager")).toBeVisible();
      await preview.setViewportSize(viewport);
      if (viewport.width === 1180)
        await expect(preview.locator(".pane-tile")).toHaveCount(12);
      await page
        .getByRole("button", { name: "Reset scenario", exact: true })
        .click();
      await expect(header).toBeVisible();
    });
  }
});
