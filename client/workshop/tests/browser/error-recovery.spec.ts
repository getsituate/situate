import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(page: Page, preset = "unexpected", mobile = false) {
  await page.goto(
    `/?workshop=controls&scenario=recovery-${preset}${mobile ? "&profile=ios&platform=mobile" : ""}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
  );
  await expect(preview.locator(".recovery-workflow")).toBeVisible();
  return preview;
}

test("local failure leaves notes usable and contextual repair retains its assignment", async ({
  page,
}, info) => {
  const preview = await open(page, "pane");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview
    .getByLabel("Note draft", { exact: true })
    .fill("Keep this thought");
  await preview.getByRole("button", { name: "Notes", exact: true }).click();
  await preview
    .getByRole("button", { name: "Garden observations", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Garden observations", exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Notes", exact: true }).click();
  await preview
    .getByRole("button", { name: "Weekend reading", exact: true })
    .click();
  await expect(preview.getByLabel("Note draft", { exact: true })).toHaveValue(
    "Keep this thought",
  );
  await preview
    .getByRole("button", { name: "Open repair", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Development · Reading list repair" }),
  ).toBeFocused();
  await expect(
    preview.getByText("No diagnosis has started.", { exact: false }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Retry repair", exact: true })
    .click();
  await expect(preview.getByRole("status")).toContainText(
    "assignment remains unsaved",
  );
  await preview.screenshot({ path: info.outputPath("repair-unavailable.png") });
  await preview
    .getByRole("button", { name: "Return to notes", exact: true })
    .click();
  await expect(preview.getByLabel("Note draft", { exact: true })).toHaveValue(
    "Keep this thought",
  );
  await expect(preview.getByLabel("Note draft", { exact: true })).toBeFocused();
  await selectOption(
    page.getByLabel("Reload result", { exact: true }),
    "false",
  );
  await preview
    .getByRole("button", { name: "Reload view", exact: true })
    .click();
  await expect(preview.getByRole("status")).toContainText(
    "still couldn’t load",
  );
  await preview.screenshot({ path: info.outputPath("pane-failed.png") });
  await selectOption(page.getByLabel("Reload result", { exact: true }), "true");
  await preview
    .getByRole("button", { name: "Reload view", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Reading list", exact: true }),
  ).toBeVisible();
  await expect(preview.getByLabel("Note draft", { exact: true })).toHaveValue(
    "Keep this thought",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByLabel("Note draft", { exact: true })).toHaveValue(
    "Look for an essay about urban gardens.",
  );
});

test("unexpected error contains keyboard focus and dismisses once without erasing uncertainty", async ({
  page,
}, info) => {
  const preview = await open(page);
  const dialog = preview.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Reload workspace", exact: true }),
  ).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await preview.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await preview.waitForTimeout(1100);
  expect(
    await preview
      .locator(".recovery-bend")
      .evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
  ).toBe(0);
  const reportAction = dialog.getByRole("button", {
    name: "Report a problem",
    exact: true,
  });
  const reloadAction = dialog.getByRole("button", {
    name: "Reload workspace",
    exact: true,
  });
  const reportBounds = (await reportAction.boundingBox())!;
  const reloadBounds = (await reloadAction.boundingBox())!;
  expect(Math.abs(reportBounds.y - reloadBounds.y)).toBeLessThan(1);
  expect(Math.abs(reportBounds.width - reloadBounds.width)).toBeLessThan(1);
  await reloadAction.focus();
  await preview.screenshot({ path: info.outputPath("unexpected-desktop.png") });
  const more = dialog.getByText("More options", { exact: true });
  await more.click();
  await expect(dialog.locator("details details")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Open repair", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Restart Situate", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Technical details", { exact: true }),
  ).toHaveCount(0);
  await preview.screenshot({
    path: info.outputPath("unexpected-more-options-desktop.png"),
  });
  await more.click();
  await preview.keyboard.press("Escape");
  const entry = preview.getByRole("button", {
    name: "Review error",
    exact: true,
  });
  await expect(entry).toBeFocused();
  await preview.getByLabel("Note draft", { exact: true }).fill("Still here");
  for (let i = 0; i < 3; i++)
    await page
      .getByRole("button", { name: "Repeat background failure", exact: true })
      .click();
  await expect(dialog).not.toBeVisible();
  await expect(entry).toHaveCount(1);
  await entry.click();
  await expect(preview.locator(".recovery-bend")).not.toHaveClass(/gesture/);
  await dialog
    .getByRole("button", { name: "Reload workspace", exact: true })
    .click();
  await expect(preview.getByRole("status")).toHaveText("Workspace reloaded");
  await preview
    .getByRole("button", { name: "Weekend reading", exact: true })
    .click();
  await expect(
    preview.getByText("Book request: outcome unknown.", { exact: false }),
  ).toBeVisible();
  await expect(preview.getByLabel("Note draft", { exact: true })).toHaveValue(
    "Still here",
  );
});

test("report always includes bounded technical data and mail failures offer selectable text", async ({
  page,
}, info) => {
  const preview = await open(page, "report");
  const description = preview.getByLabel("What were you doing? (optional)", {
    exact: true,
  });
  await expect(description).toBeFocused();
  await description.fill("Opening the reading list");
  await expect(preview.getByRole("dialog").getByRole("checkbox")).toHaveCount(
    0,
  );
  await preview
    .getByRole("dialog")
    .getByText("Technical details", { exact: true })
    .click();
  await preview.screenshot({ path: info.outputPath("report-preview.png") });
  await preview
    .getByRole("button", { name: "Open email draft", exact: true })
    .click();
  const report = preview.getByLabel("Report text", { exact: true });
  expect(await report.inputValue()).toContain("bugs@getsituate.com");
  expect(await report.inputValue()).toContain("Opening the reading list");
  expect(await report.inputValue()).toContain("Trace: example-event-0042");
  expect(await report.inputValue()).not.toContain("Look for an essay");
  await expect(
    preview.getByText("No email has been sent.", { exact: false }),
  ).toBeVisible();
  await selectOption(
    page.getByLabel("Email availability", { exact: true }),
    "missing",
  );
  await expect(
    preview.getByText("No email app is available.", { exact: false }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Select report text", exact: true })
    .click();
  expect(
    await report.evaluate(
      (el) =>
        (el as HTMLTextAreaElement).selectionEnd -
        (el as HTMLTextAreaElement).selectionStart,
    ),
  ).toBe((await report.inputValue()).length);
  await expect(
    preview
      .getByRole("dialog")
      .getByRole("button", { name: "Save report", exact: true }),
  ).toHaveCount(0);
  await preview.screenshot({ path: info.outputPath("mail-unavailable.png") });
  await selectOption(
    page.getByLabel("Email availability", { exact: true }),
    "offline",
  );
  await expect(
    preview.getByText("You’re offline.", { exact: false }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Back", exact: true }).click();
  await expect(description).toHaveValue("Opening the reading list");
  await expect(preview.getByRole("dialog").getByRole("checkbox")).toHaveCount(
    0,
  );
  await preview
    .getByRole("button", { name: "Open email draft", exact: true })
    .click();
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await expect(preview.getByRole("dialog")).not.toBeVisible();
  await preview
    .getByRole("button", { name: "Review error", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  await expect(description).toHaveValue("Opening the reading list");
  await expect(preview.getByRole("dialog").getByRole("checkbox")).toHaveCount(
    0,
  );
});

test("restart runs directly without a second confirmation and keeps work when saving fails", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.keyboard.press("Escape");
  const draft = preview.getByLabel("Note draft", { exact: true });
  await draft.fill("Keep the latest thought");
  await selectOption(
    page.getByLabel("Draft save result", { exact: true }),
    "false",
  );
  await preview
    .getByRole("button", { name: "Restart Situate", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).not.toBeVisible();
  await expect(preview.getByRole("status")).toContainText(
    "draft couldn’t be saved",
  );
  await expect(preview.getByRole("status")).toBeInViewport();
  await expect(draft).toHaveValue("Keep the latest thought");
  await preview.screenshot({
    path: info.outputPath("restart-save-failed.png"),
  });
  await selectOption(
    page.getByLabel("Draft save result", { exact: true }),
    "true",
  );
  await preview
    .getByRole("button", { name: "Review error", exact: true })
    .click();
  await preview
    .getByRole("dialog")
    .getByText("More options", { exact: true })
    .click();
  await preview
    .getByRole("dialog")
    .getByRole("button", { name: "Restart Situate", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).not.toBeVisible();
  await expect(preview.getByRole("status")).toHaveText("Ready");
  await expect(
    preview.getByRole("heading", { name: "Notes", exact: true }),
  ).toBeFocused();
  await preview.screenshot({ path: info.outputPath("after-restart.png") });
  await preview
    .getByRole("button", { name: "Weekend reading", exact: true })
    .click();
  await expect(preview.getByLabel("Note draft", { exact: true })).toHaveValue(
    "Keep the latest thought",
  );
  await expect(
    preview.getByText("Book request: outcome unknown.", { exact: false }),
  ).toBeVisible();
  await expect(
    preview.getByText("Draft saved in this session", { exact: true }),
  ).toBeVisible();
});

test("iOS width and reduced motion preserve recovery without offering automatic restart", async ({
  page,
}, info) => {
  const preview = await open(page, "unexpected", true);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await preview
      .locator(".recovery-bend")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await preview.screenshot({
    path: info.outputPath("unexpected-ios-reduced.png"),
  });
  const more = preview
    .getByRole("dialog")
    .getByText("More options", { exact: true });
  await more.click();
  await expect(
    preview.getByRole("dialog").locator("details details"),
  ).toHaveCount(0);
  await expect(
    preview
      .getByRole("dialog")
      .getByRole("button", { name: "Open repair", exact: true }),
  ).toBeVisible();
  await expect(
    preview
      .getByRole("dialog")
      .getByRole("button", { name: "Reopen guidance", exact: true }),
  ).toBeVisible();
  await preview.screenshot({
    path: info.outputPath("unexpected-more-options-ios.png"),
  });
  await more.click();
  await preview.setViewportSize({ width: 320, height: 568 });
  expect(
    await preview
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await preview.screenshot({ path: info.outputPath("unexpected-ios-320.png") });
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview.keyboard.press("Escape");
  await preview
    .getByRole("button", { name: "Reopen guidance", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toContainText("app switcher");
  await expect(
    preview.getByRole("button", { name: "Save and restart", exact: true }),
  ).toHaveCount(0);
  await preview.screenshot({ path: info.outputPath("ios-reopen.png") });
  await preview.keyboard.press("Escape");
  await preview
    .getByRole("button", { name: "Review error", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  for (const width of [390, 320]) {
    await preview.setViewportSize({ width, height: 568 });
    expect(
      await preview
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await preview
      .getByRole("button", { name: "Open email draft", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      preview.getByRole("button", { name: "Open email draft", exact: true }),
    ).toBeInViewport();
    await preview.screenshot({
      path: info.outputPath(`report-ios-${width}.png`),
    });
  }
});

test("startup uses the same general dialog without workspace or plugin attribution", async ({
  page,
}, info) => {
  const preview = await open(page, "startup");
  const dialog = preview.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Oops. Something went wrong.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toHaveClass(/incident-dialog/);
  await expect(preview.locator(".startup-fallback")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Reload Situate", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "still couldn’t initialize",
  );
  await preview.screenshot({
    path: info.outputPath("startup-shared-dialog.png"),
  });
  await preview
    .getByRole("button", { name: "Report a problem", exact: true })
    .click();
  await dialog.getByText("Technical details", { exact: true }).click();
  await expect(dialog).toContainText("Workspace: not opened");
  await expect(dialog).not.toContainText("reading-list 0.4.2");
  await preview.keyboard.press("Escape");
  await preview
    .getByRole("button", { name: "Review error", exact: true })
    .click();
  await dialog.getByText("More options", { exact: true }).click();
  await preview
    .getByRole("button", { name: "Open repair", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", {
      name: "Development · Startup repair",
      exact: true,
    }),
  ).toBeVisible();
  await expect(preview.locator(".recovery-workflow")).not.toContainText(
    "Field notes",
  );
  await expect(preview.locator(".recovery-workflow")).not.toContainText(
    "Reading list",
  );
  await expect(
    preview.getByText("No plugin has been identified.", { exact: false }),
  ).toBeVisible();
});
