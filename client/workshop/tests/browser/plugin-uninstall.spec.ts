import { expect, test, type Page } from "./test";
import {
  expectDialogTitle,
  expectDialogBody,
  expectDialogSection,
} from "./dialog-typography";
import { selectScenario } from "./scenarios";

async function open(controls: Page, scenario = "plugins-list") {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1040, height: 800 });
  await expect(
    controls.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}
async function uninstall(preview: Page, name: string) {
  const card = preview.getByRole("article", { name, exact: true });
  const more = card.getByRole("button", {
    name: `More actions for ${name}`,
    exact: true,
  });
  await more.focus();
  await more.press("ArrowDown");
  const entry = preview.getByRole("menuitem", {
    name: "Uninstall…",
    exact: true,
  });
  await expect(entry).toBeFocused();
  await entry.press("Enter");
  return more;
}

test("keyboard removal cancels safely, retries failure and resets pending state", async ({
  page,
}) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  const more = await uninstall(preview, "Morning brief");
  const dialog = preview.getByRole("dialog", {
    name: "Uninstall Morning brief?",
    exact: true,
  });
  await expectDialogTitle(dialog.getByRole("heading", { level: 2 }));
  await expectDialogBody(dialog.locator("p").first());
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  await uninstall(preview, "Morning brief");
  await expect(
    page.getByRole("heading", {
      name: "Uninstall Morning brief?",
      exact: true,
    }),
  ).toBeVisible();
  await preview.screenshot({
    path: test.info().outputPath("uninstall-confirmation.png"),
  });
  await dialog
    .getByRole("button", { name: "Uninstall plugin", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Uninstalling plugin…",
  );
  await expect(
    dialog.getByRole("button", { name: "Uninstall plugin", exact: true }),
  ).toBeDisabled();
  await dialog.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete uninstall", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Card appearance", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Fail uninstall", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Couldn’t uninstall. Try again.",
  );
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete uninstall", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    preview.getByRole("article", { name: "Morning brief", exact: true }),
  ).toHaveCount(0);
  await expect(preview.locator(".plugin-notice[role=status]")).toHaveText(
    "Morning brief uninstalled.",
  );
  await expect(
    preview.getByRole("heading", { name: "Plugins", exact: true }),
  ).toBeFocused();
  await selectScenario(page, "plugins-uninstall-pending");
  await expect(preview.getByRole("dialog").getByRole("status")).toBeVisible();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByRole("dialog").getByRole("status")).toBeVisible();
  await selectScenario(page, "plugins-list");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Complete uninstall", exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("article", { name: "Morning brief", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("dependent and running plugins cannot be uninstalled, but disabling stays available", async ({
  page,
}) => {
  const preview = await open(page);
  await uninstall(preview, "Calendar connection");
  const dialog = preview.getByRole("dialog");
  await expect(dialog).toContainText("Weekly planning");
  await expect(dialog).toContainText("Morning brief");
  await expect(dialog).toContainText("Other plugins still need it");
  const sectionHeading = dialog.getByRole("heading", { level: 3 });
  await expectDialogSection(sectionHeading);
  await expect(dialog.locator(".plugin-uninstall-blocker")).toHaveCSS(
    "border-inline-start-width",
    "0px",
  );
  await expect(dialog.locator(".plugin-uninstall-blocker")).toHaveCSS(
    "padding-inline-start",
    "0px",
  );
  for (const width of [1040, 390]) {
    await preview.setViewportSize({ width, height: 800 });
    const title = await dialog.getByRole("heading", { level: 2 }).boundingBox();
    const section = await sectionHeading.boundingBox();
    expect(Math.abs(title!.x - section!.x)).toBeLessThanOrEqual(1);
  }
  await preview.screenshot({
    path: test.info().outputPath("uninstall-dependencies-narrow.png"),
  });
  await preview.setViewportSize({ width: 1040, height: 800 });
  await expect(
    dialog.getByRole("button", { name: "Uninstall plugin", exact: true }),
  ).toHaveCount(0);
  await preview.screenshot({
    path: test.info().outputPath("uninstall-dependencies.png"),
  });
  await dialog
    .getByRole("button", { name: "Disable instead", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Disable Calendar connection?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    preview.getByRole("button", {
      name: "More actions for Calendar connection",
      exact: true,
    }),
  ).toBeFocused();
  await selectScenario(page, "plugins-uninstall-running");
  await expect(dialog).toContainText(
    "Wait for this plugin to finish its work.",
  );
  await expect(
    dialog.getByRole("button", { name: "Uninstall plugin", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Finish running plugin actions", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Uninstall plugin", exact: true }),
  ).toBeVisible();
});

test("disabled and source cards expose uninstall without opening their settings", async ({
  page,
}) => {
  const preview = await open(page, "plugins-disabled");
  await uninstall(preview, "Morning brief");
  const dialog = preview.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Disable instead", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Uninstall plugin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete uninstall", exact: true })
    .click();
  await expect(
    preview.getByRole("article", { name: "Morning brief", exact: true }),
  ).toHaveCount(0);
  await uninstall(preview, "Home computer");
  await expect(dialog).toContainText(
    "Your notes, tasks, documents and chats stay.",
  );
  await dialog
    .getByRole("button", { name: "Uninstall plugin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete uninstall", exact: true })
    .click();
  await expect(
    preview.getByRole("article", { name: "Home computer", exact: true }),
  ).toHaveCount(0);
});

test("menu and error confirmation fit narrow content and restore focus after dismissal", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 320, height: 640 });
  const more = preview.getByRole("button", {
    name: "More actions for Morning brief",
    exact: true,
  });
  await more.click();
  const menu = preview.getByRole("menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await preview.screenshot({
    path: test.info().outputPath("uninstall-menu-narrow.png"),
  });
  await menu.press("Escape");
  await expect(more).toBeFocused();
  await uninstall(preview, "Morning brief");
  await preview.setViewportSize({ width: 390, height: 700 });
  await expect(preview.getByRole("dialog")).toBeVisible();
  await preview
    .getByRole("button", { name: "Uninstall plugin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fail uninstall", exact: true })
    .click();
  await preview.screenshot({
    path: test.info().outputPath("uninstall-error-narrow.png"),
  });
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(more).toBeFocused();
});
