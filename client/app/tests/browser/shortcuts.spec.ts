import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test.use({
  localizationMode: "real",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
});
test("keyboard shortcut settings detect conflicts and change the effective key @visual-desktop", async ({
  page,
  visual,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Panes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change shortcut for Split above" }),
  ).toHaveAccessibleDescription("Ctrl + Alt + Shift + Up arrow");
  await expect(
    page.getByRole("button", { name: "Change shortcut for Split below" }),
  ).toHaveAccessibleDescription("Ctrl + Alt + Shift + Down arrow");
  await expect(
    page.getByRole("button", { name: "Change shortcut for Close tab" }),
  ).toHaveAccessibleDescription("Ctrl + W");
  await expect(
    page.getByRole("button", { name: "Change shortcut for Close pane" }),
  ).toHaveAccessibleDescription("Ctrl + Shift + W");
  await expect(
    page.getByRole("button", { name: "Change shortcut for New chat" }),
  ).toHaveAccessibleDescription("Ctrl + N");
  await visual.capture("settings.shortcuts.list");
  const info = page.getByRole("button", { name: "About keyboard shortcuts" });
  await info.press("Enter");
  await expect(
    page.getByText(
      "Changes to keyboard shortcuts apply only to this workspace and operating system.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(info).toBeFocused();
  const search = page.getByRole("searchbox");
  await search.fill("split right");
  await expect(
    page.getByRole("region", { name: "Tabs", exact: true }),
  ).toHaveCount(0);
  const row = page.getByRole("button", {
    name: "Change shortcut for Split right",
  });
  await row.press("Enter");
  const recorder = page.getByLabel("Press a key combination", { exact: true });
  await expect(recorder).toBeFocused();
  await recorder.press("Control+t");
  await page
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("New tab");
  await expect(recorder).toBeFocused();
  await visual.capture("settings.shortcuts.conflict");
  await recorder.press("Control+j");
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await expect(row).not.toContainText("Modified");
  await row.press("Enter");
  await recorder.press("Control+j");
  await page
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await expect(row).toBeFocused();
  await expect(row).toHaveAccessibleDescription("Ctrl + J. Modified");
  await page.keyboard.press("Control+Alt+Shift+ArrowRight");
  await expect(page.locator(".pane-tile")).toHaveCount(1);
  await page.keyboard.press("Control+j");
  await expect(
    page
      .locator(".pane-tile.active .view-chooser")
      .getByRole("button", { name: "New chat", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(row).toBeVisible();
  await row.press("Enter");
  await page
    .getByRole("button", { name: "Remove shortcut", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await expect(row).toHaveAccessibleDescription("Not assigned. Modified");
  await row.press("Enter");
  await page.getByRole("button", { name: "Use default", exact: true }).click();
  await page
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await expect(row).not.toContainText("Modified");
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(row).toBeVisible();
  await expect(search).toHaveValue("split right");
  expect(
    await page
      .locator(".settings-content")
      .evaluate((content) => content.scrollWidth <= content.clientWidth),
  ).toBe(true);
});
