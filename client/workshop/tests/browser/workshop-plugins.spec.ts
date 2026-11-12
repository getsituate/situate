import {
  expectDialogTitle,
  expectDialogBody,
  expectDialogSection,
} from "./dialog-typography";
import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";
import { selectOption } from "./select";
import type { Locator } from "@playwright/test";

async function expectDisableTypography(dialog: Locator) {
  const title = dialog.getByRole("heading", { level: 2 });
  await expect(title).toHaveCSS("font-size", "20px");
  await expect(title).toHaveCSS("line-height", "26px");
  await expect(title).toHaveCSS("font-weight", "650");
  await expect(title).toHaveCSS("letter-spacing", "normal");
  const body = dialog.locator(".plugin-dialog > p").first();
  await expect(body).toHaveCSS("font-size", "16px");
  expect(
    await body.evaluate((node) =>
      parseFloat(getComputedStyle(node).lineHeight),
    ),
  ).toBeCloseTo(24.8, 3);
  await expect(body).toHaveCSS("font-weight", "400");
  await expect(body).toHaveCSS("letter-spacing", "normal");
  for (const button of await dialog
    .locator(".plugin-dialog .situate-button")
    .all()) {
    await expect(button).toHaveCSS("font-size", "14px");
    await expect(button).toHaveCSS("font-weight", "600");
    const geometry = await button.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        lineHeight: parseFloat(style.lineHeight),
        minHeight: parseFloat(style.minHeight),
      };
    });
    expect(geometry.lineHeight).toBeCloseTo(21.7, 3);
    expect(geometry.minHeight).toBeGreaterThanOrEqual(44);
  }
}

async function open(controls: Page, scenario: string) {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1360, height: 900 });
  await expect(
    controls.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

async function choose(controls: Page, scenario: string) {
  await selectScenario(controls, scenario);
}

test("general errors show only a message and reset restores development", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development");
  await page
    .getByRole("button", { name: "Show general error", exact: true })
    .click();
  const error = preview.locator(".situate-error-screen");
  await expect(error.getByRole("alert")).toHaveText(
    "Something went wrong. This view could not be loaded.",
  );
  await expect(error.locator("button, a, input")).toHaveCount(0);
  await expect(preview.locator(".plugin-development")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start checks", exact: true }),
  ).toHaveCount(0);
  await preview.screenshot({
    path: test.info().outputPath("general-error.png"),
  });
  await preview.setViewportSize({ width: 390, height: 700 });
  await expect(error).toBeVisible();
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(error).toHaveCount(0);
  await expect(
    preview.getByLabel("Your request", { exact: true }),
  ).toBeVisible();
  await preview.setViewportSize({ width: 1360, height: 900 });
  await preview.screenshot({
    path: test.info().outputPath("plugin-development.png"),
  });
  await choose(page, "plugins-general-error");
  await expect(error.getByRole("alert")).toBeVisible();
});

test("plugin settings preserve configuration through dependency disabling", async ({
  page,
}) => {
  const preview = await open(page, "plugins-list");
  const weekly = preview.locator(".plugin-row").filter({
    has: preview.getByRole("heading", {
      name: "Weekly planning",
      exact: true,
    }),
  });
  await weekly.getByRole("button", { name: "Settings", exact: true }).click();
  await selectOption(preview.getByLabel("Prepare my weekly plan"), "friday");
  await preview.getByRole("button", { name: "Back to plugins" }).click();
  const calendar = preview.locator(".plugin-row").filter({
    has: preview.getByRole("heading", { name: "Calendar connection" }),
  });
  await calendar.getByRole("button", { name: "Disable", exact: true }).click();
  const dialog = preview.getByRole("dialog");
  await expectDialogTitle(dialog.getByRole("heading", { level: 2 }));
  await expectDialogBody(dialog.locator("p").first());
  await expectDialogSection(dialog.getByRole("heading", { level: 3 }));
  await expect(dialog).toContainText("Weekly planning");
  await expect(dialog).toContainText("Morning brief");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    calendar.getByRole("button", { name: "Disable", exact: true }),
  ).toBeFocused();
  await calendar.getByRole("button", { name: "Disable", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Disable plugin", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Waiting for 2 running actions",
  );
  await page
    .getByRole("button", { name: "Finish affected actions", exact: true })
    .click();
  await calendar.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(
    weekly.getByRole("button", { name: "Settings", exact: true }),
  ).toBeDisabled();
  await weekly.getByRole("button", { name: "Enable", exact: true }).click();
  await weekly.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(preview.getByLabel("Prepare my weekly plan")).toHaveAttribute(
    "data-value",
    "friday",
  );
});

test("disable feedback stays in the existing dialog and cancellation restores its trigger", async ({
  page,
}) => {
  const preview = await open(page, "plugins-list");
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  const calendar = preview.locator('[data-plugin-id="calendar"]');
  const trigger = calendar.getByRole("button", {
    name: "Disable",
    exact: true,
  });
  await trigger.click();
  const dialog = preview.getByRole("dialog", {
    name: "Disable Calendar connection?",
    exact: true,
  });
  await expectDisableTypography(dialog);
  const section = dialog.getByRole("heading", { level: 3 });
  await expect(section).toHaveCSS("font-size", "16px");
  expect(
    await section.evaluate((node) =>
      parseFloat(getComputedStyle(node).lineHeight),
    ),
  ).toBeCloseTo(22.4, 3);
  await expect(section).toHaveCSS("font-weight", "600");
  await dialog
    .getByRole("button", { name: "Disable plugin", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Waiting for 2 running actions to finish.",
  );
  await expect(dialog.getByRole("status")).toBeFocused();
  await expectDisableTypography(dialog);
  await expect(dialog).toContainText("Calendar connection (1)");
  await expect(dialog).toContainText("Weekly planning (1)");
  await expect(preview.locator(".plugin-disable-progress")).toHaveCount(0);
  await preview.screenshot({
    path: test.info().outputPath("plugin-disable-dialog-desktop.png"),
  });
  await preview.setViewportSize({ width: 390, height: 760 });
  await expectDisableTypography(dialog);
  await expect(
    dialog.getByRole("button", { name: "Cancel disabling", exact: true }),
  ).toBeInViewport();
  expect(
    await dialog.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(false);
  await preview.screenshot({
    path: test.info().outputPath("plugin-disable-dialog-narrow.png"),
  });
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(calendar.locator(".plugin-availability")).toHaveText("Enabled");
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Disable plugin", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Cancel disabling", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Finish affected actions", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("disable dialog distinguishes stopping, failure and uncertain outcomes without adding page UI", async ({
  page,
}) => {
  const preview = await open(page, "plugins-disable-waiting");
  const dialog = preview.getByRole("dialog");
  const trigger = preview
    .locator('[data-plugin-id="calendar"]')
    .getByRole("button", { name: "Disable", exact: true });
  await dialog.getByRole("button", { name: "Abort now", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Stop requested. Waiting for running actions to end.",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect(dialog.getByRole("status")).toContainText("Stop requested.");
  await page
    .getByRole("button", { name: "Finish affected actions", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(preview.locator(".plugin-notice")).toContainText(
    "Earlier external effects are not undone.",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fail before saving", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "The plugin was not disabled. Try again or cancel.",
  );
  await dialog
    .getByRole("button", { name: "Try disabling again", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lose save confirmation", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "The change may have been saved.",
  );
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect(
    dialog.getByRole("button", { name: "Cancel disabling", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Check status", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Checking whether the plugin was disabled…",
  );
  await page
    .getByRole("button", { name: "Confirm change was not saved", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Cancel disabling", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Waiting for 2 running actions",
  );
  await page
    .getByRole("button", { name: "Lose save confirmation", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Check status", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm plugins are disabled", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    preview
      .locator('[data-plugin-id="calendar"]')
      .getByRole("button", { name: "Enable", exact: true }),
  ).toBeEnabled();
});

test("development survives closing its view and adoption cleans its draft", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development");
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  await expect(
    preview
      .locator(".chat-message.assistant")
      .getByText(/Your request is in progress/),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Close development view" }).click();
  await expect(
    preview.getByRole("heading", { name: "Plugins", exact: true }),
  ).toBeVisible();
  await expect(
    preview
      .locator(".plugin-sidebar")
      .getByRole("img", { name: "Working", exact: true }),
  ).toBeVisible();
  await preview.locator(".plugin-sidebar").getByRole("button").first().click();
  await page.getByRole("button", { name: "Start checks", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Checks passed; actions still running",
      exact: true,
    })
    .click();
  await expect(
    preview
      .locator(".chat-message.assistant")
      .getByText(/The existing version remains in use/),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Actions finished; adopt checked changes",
      exact: true,
    })
    .click();
  await expect(
    preview
      .locator(".chat-message.assistant")
      .getByText(/The checked code is active/),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Close development view" }).click();
  await preview.getByRole("button", { name: /Pending code/ }).click();
  await expect(
    preview.getByRole("heading", { name: "No pending code to remove" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("interrupted development waits, phone file inspection and reset preserve boundaries", async ({
  page,
}) => {
  const preview = await open(page, "plugins-interrupted");
  await expect(
    preview.locator(".chat-message.assistant").getByText(/Nothing has resumed/),
  ).toBeVisible();
  const request = preview.getByLabel("Your request", { exact: true });
  await request.fill("Continue with the weekly plan.");
  await preview.setViewportSize({ width: 390, height: 700 });
  await expect(request).toHaveValue("Continue with the weekly plan.");
  await preview.getByRole("button", { name: "Changes", exact: true }).click();
  const files = preview.locator(".assignment-files");
  await expect(files).toBeVisible();
  await files.locator('[data-change-id="notes"]').click();
  await expect(files.locator(".diff-lines")).toContainText("limit = 20");
  await expect(files.locator("textarea")).toHaveCount(0);
  await preview.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(request).toHaveValue("Continue with the weekly plan.");
  await preview.getByRole("button", { name: "Continue development" }).click();
  await expect(
    preview
      .locator(".chat-message.assistant")
      .getByText(/Your request is in progress/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset scenario" }).click();
  await expect(
    preview.locator(".chat-message.assistant").getByText(/Nothing has resumed/),
  ).toBeVisible();
  await expect(request).toHaveValue("");
  const overflow = await preview.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
});

test("retained development is discarded only by an explicit confirmation", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development");
  await preview.getByRole("button", { name: "Close development view" }).click();
  await preview.getByRole("button", { name: /Pending code/ }).click();
  await preview
    .getByRole("button", { name: "Remove pending code", exact: true })
    .click();
  await preview.getByRole("dialog").press("Escape");
  await expect(
    preview.getByRole("button", { name: "Remove pending code", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Remove pending code", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Stop and remove", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "No pending code to remove" }),
  ).toBeVisible();
  await choose(page, "plugins-empty");
  await expect(
    preview.getByRole("button", { name: "Create a plugin", exact: true }),
  ).toBeVisible();
});

test("grouped activation distinguishes failed, uncertain and notified outcomes from saved workspace edits", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-activation");
  await expect(preview.locator(".change-card").first()).toContainText(
    "Review tasks and notes.",
  );
  await page
    .getByRole("button", { name: "Fail publication", exact: true })
    .click();
  await expect(preview.locator(".chat-message.assistant").last()).toContainText(
    "was not activated",
  );
  await expect(preview.locator(".change-card").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Interrupt publication", exact: true })
    .click();
  await expect(preview.locator(".chat-message.assistant").last()).toContainText(
    "Do not repeat activation yet",
  );
  await expect(
    page.getByRole("button", { name: "Activate checked code", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Inspect outcome: not activated",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Activate; fail origin notice", exact: true })
    .click();
  await expect(preview.locator(".chat-message.assistant").last()).toContainText(
    "already active",
  );
  await expect(
    page.getByRole("button", { name: "Activate checked code", exact: true }),
  ).toHaveCount(0);
  await expect(preview.locator(".change-card").first()).toBeVisible();
});

test("pending access can be cancelled without losing active code or conversation drafts", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-access-needed");
  await preview
    .getByLabel("Your request", { exact: true })
    .fill("Keep the selected accounts.");
  await preview
    .getByRole("button", { name: "Set up Notes connection", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(
    preview.getByText("Waiting for account connection…", { exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await preview.getByRole("button", { name: /Back to assignment/ }).click();
  await expect(preview.locator(".chat-message.assistant").last()).toContainText(
    "checked code is active",
  );
  await expect(
    preview.getByRole("button", {
      name: "Set up Notes connection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(preview.getByLabel("Your request", { exact: true })).toHaveValue(
    "Keep the selected accounts.",
  );
  await preview
    .getByRole("button", { name: "Set up Notes connection", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete connection", exact: true })
    .click();
  await preview.getByRole("button", { name: /Back to assignment/ }).click();
  await expect(
    preview.getByRole("button", {
      name: "Set up Notes connection",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("connection availability separates platform support, implementation, permission and operation failure", async ({
  page,
}) => {
  const preview = await open(page, "plugins-connection-platform");
  const readiness = preview.locator(".connection-readiness");
  const group = page.getByRole("group", {
    name: "Connection availability",
    exact: true,
  });
  for (const reason of [
    "Permission needed",
    "Access not implemented",
    "Required access is not supported on this platform",
    "Connection operation failed",
  ]) {
    await group.getByRole("button", { name: reason, exact: true }).click();
    await expect(readiness).toContainText(reason);
  }
  await group
    .getByRole("button", { name: "Available on macOS", exact: true })
    .click();
  await selectOption(page.getByLabel("Availability comparison"), "ios");
  await expect(readiness).toContainText("not supported on this platform");
  await expect(
    preview.getByRole("button", { name: "Connect account", exact: true }),
  ).toBeDisabled();
});

test("reused connections stay unchanged and parallel assignments keep their own drafts", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-reuse");
  const files = preview.locator(".assignment-files");
  await expect(
    files.getByRole("region", { name: "Connections", exact: true }),
  ).toHaveCount(0);
  await expect(files.locator('[data-change-id="notes"]')).toHaveCount(0);
  await choose(page, "plugins-development-parallel");
  await preview
    .getByLabel("Your request", { exact: true })
    .fill("First assignment draft");
  await expect(files.locator(".uncertain-mark")).toBeVisible();
  const conversations = preview.locator(".plugin-sidebar");
  await conversations
    .getByRole("button", { name: /^Refine note preparation/ })
    .click();
  await expect(preview.getByLabel("Your request", { exact: true })).toHaveValue(
    "",
  );
  await preview
    .getByLabel("Your request", { exact: true })
    .fill("Second assignment draft");
  await conversations
    .getByRole("button", { name: /^Bring notes into a reading view/ })
    .click();
  await expect(preview.getByLabel("Your request", { exact: true })).toHaveValue(
    "First assignment draft",
  );
});
