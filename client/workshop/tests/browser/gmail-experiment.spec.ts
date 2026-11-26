import { expect, test } from "./test";
import type { Page } from "@playwright/test";

async function openGmailExample(controls: Page, start = "off") {
  await controls.goto(
    `/?workshop=controls&scenario=settings-gmail-${start}&profile=mac`,
  );
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await preview.setViewportSize({ width: 980, height: 700 });
  if (start === "accounts") await openGmailConnection(preview);
  return preview;
}

async function openGmailConnection(preview: Page) {
  await preview.getByRole("button", { name: "Plugins", exact: true }).click();
  const gmail = preview
    .getByRole("region", { name: "Connections", exact: true })
    .getByRole("article", { name: "Gmail", exact: true });
  await expect(
    gmail.getByRole("heading", { name: "Gmail Experimental" }),
  ).toBeVisible();
  await gmail.getByRole("button", { name: "Settings", exact: true }).click();
}

const name = "alex@example.com";

test("the Gmail card puts the experiment note in its title and keeps secondary actions in its menu", async ({
  page,
}) => {
  const preview = await openGmailExample(page, "accounts");
  await preview
    .getByRole("button", { name: "Back to plugins", exact: true })
    .click();
  const card = preview.getByRole("article", { name: "Gmail", exact: true });
  await expect(
    card.getByRole("heading", { name: "Gmail Experimental" }),
  ).toBeVisible();
  await expect(card).toContainText("2 accounts connected");
  await expect(
    card.getByRole("button", { name: "Inbox", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Adapt plugin", exact: true }),
  ).toHaveCount(0);
  const more = card.getByRole("button", { name: /More.*Gmail/ });
  await more.click();
  const menu = preview.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "Adapt plugin" }),
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: "View files" }).click();
  await expect(
    preview.getByRole("button", { name: /Back to plugins/ }),
  ).toBeVisible();
  await preview.getByRole("button", { name: /Back to plugins/ }).click();
  await expect(more).toBeFocused();
});

test("enables Gmail separately from connecting an account and retains permissions after Google refuses it", async ({
  page,
}) => {
  const preview = await openGmailExample(page);
  const toggle = preview.getByRole("switch", { name: "Gmail", exact: true });
  await expect(toggle).not.toBeChecked();
  await preview.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(
    preview.getByRole("article", { name: "Gmail", exact: true }),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: /All settings/ }).click();
  await toggle.focus();
  await preview.keyboard.press("Space");
  await expect(
    preview.getByRole("dialog", { name: "Enable Gmail?" }),
  ).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await preview
    .getByRole("button", { name: "Enable Gmail", exact: true })
    .click();
  await expect(toggle).toBeChecked();
  await expect(
    preview.getByRole("button", { name: "Set up Gmail" }),
  ).toHaveCount(0);
  await openGmailConnection(preview);
  await expect(preview.getByText("No Gmail accounts connected.")).toBeVisible();
  await preview.setViewportSize({ width: 760, height: 560 });
  await preview
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Connect account", exact: true }),
  ).toBeFocused();
  const deletion = preview.getByRole("checkbox", {
    name: /Permanently delete email/,
  });
  await expect(deletion).not.toBeChecked();
  await deletion.scrollIntoViewIfNeeded();
  await expect(deletion).toBeInViewport();
  await preview
    .getByRole("checkbox", { name: /Read and search email/ })
    .check();
  await preview.getByRole("button", { name: "Continue to Google" }).click();
  await expect(
    preview.getByRole("heading", { name: "Waiting for Google" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Account not on test list" }).click();
  const error = preview.getByRole("dialog", {
    name: "Couldn’t connect to Gmail",
  });
  await expect(error).toContainText("isn’t on the Gmail test list");
  await error.getByRole("button", { name: "Close" }).click();
  await expect(
    preview.getByRole("checkbox", { name: /Read and search email/ }),
  ).toBeChecked();
  await expect(
    preview.getByRole("button", { name: "Continue to Google" }),
  ).toBeFocused();
  await preview.getByRole("button", { name: "Continue to Google" }).click();
  await page
    .getByRole("button", { name: "Grant selected permissions" })
    .click();
  await expect(
    preview.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Inbox", exact: true }).click();
  const account = preview.getByRole("checkbox", { name: /alex@example.com/ });
  await expect(account).not.toBeChecked();
  await account.check();
  await expect(account).toBeChecked();
});

test("keeps the current account on a mismatched return and displays only the permissions Google grants", async ({
  page,
}) => {
  const preview = await openGmailExample(page, "accounts");
  await preview
    .getByRole("button", { name: `Edit permissions: ${name}` })
    .click();
  await preview
    .getByRole("checkbox", { name: "Send email", exact: true })
    .check();
  await preview.getByRole("button", { name: "Continue to Google" }).click();
  await page
    .getByRole("button", { name: "Return with another account" })
    .click();
  await expect(preview.getByRole("dialog")).toContainText(
    "existing permissions haven’t changed",
  );
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await preview.getByRole("button", { name: "Continue to Google" }).click();
  await page
    .getByRole("button", { name: "Grant only some permissions" })
    .click();
  const account = preview
    .getByRole("article")
    .filter({ has: preview.getByRole("heading", { name, exact: true }) });
  await expect(account).toContainText("Read and search email");
  await expect(account).not.toContainText("Send email");
  await expect(account.getByRole("status")).toContainText(
    "did not grant every permission",
  );
  await page.getByRole("button", { name: `Expire ${name}` }).click();
  await expect(
    account.getByRole("button", { name: `Reconnect: ${name}` }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Inbox", exact: true }).click();
  await preview
    .getByRole("button", { name: `Open Gmail account · ${name}` })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Edit permissions", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("checkbox", { name: "Send email", exact: true })
    .check();
  await preview.getByRole("button", { name: "Continue to Google" }).click();
  await preview.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(
    preview.getByRole("button", { name: "Continue to Google" }),
  ).toBeFocused();
  await expect(
    preview.getByRole("checkbox", { name: "Send email", exact: true }),
  ).toBeChecked();
  await preview.getByRole("button", { name: "Continue to Google" }).click();
  await page
    .getByRole("button", { name: "Grant selected permissions" })
    .click();
  await expect(account).toContainText("Read and search email · Send email");
  await expect(
    account.getByRole("button", { name: `Reconnect: ${name}` }),
  ).toHaveCount(0);
});

test("permission groups reflow without losing the selected choices", async ({
  page,
}, info) => {
  const preview = await openGmailExample(page, "accounts");
  await preview.setViewportSize({ width: 1180, height: 920 });
  const edit = preview.getByRole("button", {
    name: `Edit permissions: ${name}`,
  });
  await expect(edit).toBeVisible();
  await preview.screenshot({ path: info.outputPath("gmail-accounts.png") });
  await edit.press("Enter");
  const reading = preview.getByRole("group", { name: "Reading" });
  const writing = preview.getByRole("group", { name: "Drafts and sending" });
  expect((await writing.boundingBox())!.x).toBeGreaterThan(
    (await reading.boundingBox())!.x,
  );
  await preview.screenshot({
    path: info.outputPath("gmail-permissions-wide.png"),
  });
  const send = preview.getByRole("checkbox", {
    name: "Send email",
    exact: true,
  });
  await send.check();
  await preview.setViewportSize({ width: 540, height: 760 });
  expect((await writing.boundingBox())!.x).toBe(
    (await reading.boundingBox())!.x,
  );
  expect((await writing.boundingBox())!.y).toBeGreaterThan(
    (await reading.boundingBox())!.y,
  );
  await expect(send).toBeChecked();
  await preview.screenshot({
    path: info.outputPath("gmail-permissions-narrow.png"),
  });
  await preview.getByRole("button", { name: "Back to Gmail accounts" }).click();
  await expect(edit).toBeFocused();
});

test("account settings keep a shared leading edge and reflow in a narrow desktop window", async ({
  page,
}) => {
  const preview = await openGmailExample(page, "accounts");
  await preview.setViewportSize({ width: 620, height: 580 });
  await preview.evaluate(() => {
    document.documentElement.style.zoom = "1.35";
  });
  const panel = preview.locator(".plugin-settings-view");
  const plugin = await panel
    .getByRole("heading", { name: "Gmail", exact: true })
    .boundingBox();
  const accounts = await panel
    .getByRole("heading", { name: "Connected accounts" })
    .boundingBox();
  expect(plugin?.x).toBe(accounts?.x);
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await panel
    .getByRole("button", { name: `Edit permissions: ${name}` })
    .click();
  const next = panel.getByRole("button", { name: "Continue to Google" });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeInViewport();
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
});

test("pausing preserves account selection while disconnecting removes it", async ({
  page,
}) => {
  const preview = await openGmailExample(page, "accounts");
  await preview.getByRole("button", { name: /Back to plugins/i }).click();
  await preview.getByRole("button", { name: /All settings/ }).click();
  const toggle = preview.getByRole("switch", { name: "Gmail", exact: true });
  await toggle.click();
  await preview.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(
    preview.getByRole("article", { name: "Gmail", exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("article", { name: "Inbox", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    preview.getByRole("checkbox", { name: /alex@example.com/ }),
  ).toBeChecked();
  await preview
    .getByRole("button", { name: "Settings · Gmail", exact: true })
    .click();
  await expect(preview.getByText("Paused", { exact: true })).toHaveCount(2);
  await preview
    .getByRole("button", { name: `Disconnect ${name}`, exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Disconnect account", exact: true })
    .click();
  await preview.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(
    preview.getByRole("checkbox", { name: /alex@example.com/ }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("checkbox", { name: /alex.work@example.com/ }),
  ).not.toBeChecked();
});
