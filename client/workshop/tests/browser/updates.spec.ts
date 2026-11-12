import { test, expect, type Page } from "./test";
import { selectOption } from "./select";
import { selectScenario } from "./scenarios";
import { expectDialogTitle, expectDialogBody } from "./dialog-typography";

async function open(page: Page, scenario = "updates-notice", profile = "mac") {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}&profile=${profile}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize(
    profile === "ios"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await expect(preview.locator(".app-shell")).toBeVisible();
  await expect(preview.locator(".update-app-header")).toHaveCount(0);
  return preview;
}

test("review update surfaces at desktop and compact sizes", async ({
  page,
}, info) => {
  const preview = await open(page);
  const capture = async (name: string) => {
    const path = info.outputPath(`${name}.png`);
    await preview.screenshot({ path, animations: "disabled" });
    await info.attach(name, { path, contentType: "image/png" });
  };
  await expect(
    preview.getByRole("button", { name: "Update available", exact: true }),
  ).toBeVisible();
  expect(await preview.locator(".notice-mark path").getAttribute("d")).not.toBe(
    await preview
      .getByRole("button", { name: "Send message", exact: true })
      .locator("path")
      .first()
      .getAttribute("d"),
  );
  await capture("updates.notice");
  await preview
    .getByRole("button", { name: "Update available", exact: true })
    .hover();
  await expect(preview.locator(".notice-label")).toHaveCSS("opacity", "1");
  await capture("updates.notice-expanded");
  await preview
    .getByRole("button", { name: "Update available", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Ready when you are", exact: true }),
  ).toBeVisible();
  await capture("updates.settings");
  await selectScenario(page, "updates-downloading");
  await expect(preview.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  await capture("updates.download");
  await selectScenario(page, "updates-restart");
  await expect(preview.getByRole("dialog")).toBeVisible();
  await capture("updates.restart");
  await selectScenario(page, "release-notes-store");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Browse version history", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveAccessibleName(
    "Version history",
  );
  await capture("updates.changelog");
  await preview.setViewportSize({ width: 390, height: 700 });
  const continueButton = preview.getByRole("button", {
    name: "Close history",
    exact: true,
  });
  await expect
    .poll(async () => {
      const bounds = await continueButton.boundingBox();
      return bounds!.y + bounds!.height;
    })
    .toBeLessThanOrEqual(700);
  await capture("updates.changelog-compact");
});

test("store history retains its close action within mobile safe areas", async ({
  page,
}) => {
  const preview = await open(page, "release-notes-store");
  await preview
    .getByRole("button", { name: "Browse version history", exact: true })
    .click();
  await selectOption(
    page.getByRole("combobox", { name: "Platform profile", exact: true }),
    "ios",
  );
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await preview.setViewportSize(size);
    await expect(preview.getByRole("dialog")).toHaveAccessibleName(
      "Version history",
    );
    const bounds = await preview
      .getByRole("button", { name: "Close history", exact: true })
      .boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    await expect
      .poll(async () => {
        const current = await preview
          .getByRole("button", { name: "Close history", exact: true })
          .boundingBox();
        return current!.y + current!.height;
      })
      .toBeLessThanOrEqual(size.height);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await preview
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
});

test("an older installed version hides newer releases from history, search and adjacent navigation", async ({
  page,
}) => {
  const preview = await open(page, "updates-current");
  await preview
    .getByRole("button", { name: "Browse version history", exact: true })
    .click();
  const dialog = preview.getByRole("dialog", {
    name: "Version history",
    exact: true,
  });
  await expect(dialog.locator("[data-version]")).toHaveCount(4);
  await expect(dialog.locator('[data-version="0.8.1"]')).toHaveCount(0);
  const search = dialog.getByRole("searchbox", { name: "Find a release" });
  await search.fill("0.8.1");
  await expect(dialog.getByRole("status")).toHaveText("No matching releases");
  await dialog
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await dialog.locator('[data-version="0.8.0"]').click();
  await expect(
    dialog.getByRole("button", { name: "Newer", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("heading", { name: "Version 0.8.0", exact: true }),
  ).toBeFocused();
});

test("About opens complete history with skipped releases and restores keyboard focus", async ({
  page,
}, info) => {
  const preview = await open(page, "release-notes-skipped");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  const entry = preview.getByRole("button", {
    name: "Browse version history",
    exact: true,
  });
  await entry.click();
  const dialog = preview.getByRole("dialog", {
    name: "Version history",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-version]")).toHaveCount(5);
  await expect(dialog.locator("[data-version='0.7.0']")).toBeVisible();
  await preview.screenshot({
    path: info.outputPath("history.desktop-index.png"),
  });
  const search = dialog.getByRole("searchbox", { name: "Find a release" });
  await search.fill("0.7");
  const selected = dialog.locator("[data-version='0.7.1']");
  await selected.focus();
  await preview.keyboard.press("Enter");
  const heading = dialog.getByRole("heading", {
    name: "Version 0.7.1",
    exact: true,
  });
  await expect(heading).toBeFocused();
  await expect(
    dialog.getByText(
      "Fixed pasted search text retaining leading spaces and hiding otherwise matching notes.",
    ),
  ).toBeVisible();
  await preview.screenshot({
    path: info.outputPath("history.desktop-release.png"),
  });
  await dialog.getByRole("button", { name: "All releases" }).click();
  await expect(search).toHaveValue("0.7");
  await expect(selected).toBeFocused();
  await search.fill("no such release");
  await expect(dialog.getByRole("status")).toHaveText("No matching releases");
  await dialog
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await expect(dialog.locator("[data-version]")).toHaveCount(5);
  await expect(search).toBeFocused();
  await search.fill("0.8.0");
  await dialog.locator("[data-version='0.8.0']").click();
  await expect(
    dialog.getByText(
      "Notes and conversations open one at a time; split-pane layouts are not available.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Newer", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Version 0.8.1", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Newer", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Older", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Version 0.8.0", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Newer", exact: true }).click();
  await dialog.getByRole("button", { name: "All releases" }).click();
  await expect(search).toHaveValue("0.8.0");
  await expect(dialog.locator("[data-version='0.8.0']")).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await entry.click();
  await expect(dialog.locator("[data-version]")).toHaveCount(5);
  await dialog
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(entry).toBeFocused();
});

test("iOS history reflows, scrolls and keeps navigation and exit accessible", async ({
  page,
}, info) => {
  const preview = await open(page, "release-notes-store", "ios");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Browse version history", exact: true })
    .click();
  const dialog = preview.getByRole("dialog");
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await preview.setViewportSize(size);
    const oldest = dialog.locator("[data-version='0.7.0']");
    await oldest.scrollIntoViewIfNeeded();
    const scrollTop = await dialog
      .locator(".history-list")
      .evaluate((el) => el.scrollTop);
    if (size.width === 320) expect(scrollTop).toBeGreaterThan(0);
    await oldest.click();
    await expect(
      dialog.getByRole("heading", { name: "Version 0.7.0", exact: true }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Older", exact: true }),
    ).toBeDisabled();
    const exit = dialog.getByRole("button", {
      name: "Close history",
      exact: true,
    });
    const box = await exit.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.screenshot({
      path: info.outputPath(`history.ios-${size.width}.png`),
    });
    const reading = dialog.locator(".history-detail");
    await reading.focus();
    await reading.press("End");
    await expect
      .poll(() => reading.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      dialog.getByText(
        "Refresh an existing document source once to include its tags. Tags are available only when the source supplies them.",
      ),
    ).toBeInViewport();
    await preview.screenshot({
      path: info.outputPath(`history.ios-${size.width}-scrolled.png`),
    });
    await dialog.getByRole("button", { name: "All releases" }).click();
    await expect(oldest).toBeFocused();
    expect(
      await dialog.locator(".history-list").evaluate((el) => el.scrollTop),
    ).toBe(scrollTop);
    await exit.focus();
    await preview
      .getByRole("button", { name: "Browse version history", exact: true })
      .evaluate((el) => (el as HTMLElement).focus());
    await expect(exit).toBeFocused();
  }
  await preview.keyboard.press("Escape");
  await expect(
    preview.getByRole("button", {
      name: "Browse version history",
      exact: true,
    }),
  ).toBeFocused();
});

test("a direct installation opens the same installed history from Updates and About", async ({
  page,
}) => {
  const preview = await open(page, "updates-settings");
  await preview
    .getByRole("button", { name: "Browse version history", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog").locator("[data-version]"),
  ).toHaveCount(4);
  await expect(preview.locator('[data-version="0.8.1"]')).toHaveCount(0);
  await preview.keyboard.press("Escape");
  await preview
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "About Situate", exact: true })
    .click();
  await expect(
    preview.getByText("Version 0.8.0", { exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Browse version history", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog").locator("[data-version]"),
  ).toHaveCount(4);
  await expect(preview.locator('[data-version="0.8.1"]')).toHaveCount(0);
});

test("restart revision keeps safe defaults, inline preparation and explicit loss consent", async ({
  page,
}, info) => {
  const preview = await open(page, "updates-restart");
  await selectOption(
    page.getByRole("combobox", { name: "Platform profile", exact: true }),
    "mac",
  );
  const capture = async (name: string, width: number) => {
    const directory = process.env.UPDATE_DIALOG_REVIEW_DIR;
    await preview.screenshot({
      path: directory
        ? `${directory}/${info.project.name}.${name}.${width}.png`
        : info.outputPath(`${name}.${width}.png`),
      animations: "disabled",
    });
  };
  for (const width of [1280, 600, 390]) {
    await selectScenario(page, "updates-restart");
    await preview.setViewportSize({ width, height: 800 });
    const dialog = preview.getByRole("dialog");
    const later = dialog.getByRole("button", {
      name: "Update later",
      exact: true,
    });
    await expect(later).toBeFocused();
    await expect(dialog.getByRole("button")).toHaveCount(2);
    await expect(
      dialog.getByRole("button", { name: "Force update…", exact: true }),
    ).toHaveCount(0);
    await expectDialogTitle(preview.locator("#update-dialog-title"));
    await expectDialogBody(preview.locator("#update-dialog-description"));
    await capture("running", width);
    await preview.bringToFront();
    await later.focus();
    await preview.keyboard.press(
      process.platform === "darwin" && info.project.name === "workshop-webkit"
        ? "Alt+Tab"
        : "Tab",
    );
    await expect(
      dialog.getByRole("button", {
        name: "Stop actions and restart",
        exact: true,
      }),
    ).toBeFocused();
    await preview.keyboard.press(
      process.platform === "darwin" && info.project.name === "workshop-webkit"
        ? "Alt+Shift+Tab"
        : "Shift+Tab",
    );
    await expect(later).toBeFocused();
    await preview.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "Actions running", exact: true }),
    ).toBeChecked();
    await preview
      .getByRole("button", { name: "Install and restart", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Stop actions and restart", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      preview.getByRole("heading", {
        name: "Preparing to restart…",
        exact: true,
      }),
    ).toBeVisible();
    await expect(preview.locator(".update-status .sr-only")).toHaveText(
      "Preparing to restart…",
    );
    await capture("preparing", width);
    await preview
      .getByRole("button", { name: "Browse version history", exact: true })
      .click();
    await preview.keyboard.press("Escape");
    await expect(
      preview.getByRole("heading", {
        name: "Preparing to restart…",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Fail preparation", exact: true })
      .click();
    await expect(
      preview.getByRole("heading", {
        name: "Couldn’t prepare to restart",
        exact: true,
      }),
    ).toBeFocused();
    await expect(preview.locator(".update-status .sr-only")).toHaveText(
      "Couldn’t prepare to restart",
    );
    await capture("preparation-failed", width);
    const force = preview.getByRole("button", {
      name: "Force update…",
      exact: true,
    });
    await force.click();
    await expect(dialog).toHaveAccessibleName("Update without saving?");
    await expect(later).toBeFocused();
    await expect(
      dialog.getByText(/Unsaved changes in any open window may be lost/),
    ).toBeVisible();
    await capture("force", width);
    await preview.keyboard.press("Escape");
    await expect(force).toBeFocused();
    await force.click();
    await dialog
      .getByRole("button", { name: "Force update and restart", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await selectOption(
      page.getByRole("combobox", {
        name: "Preparation failure reason",
        exact: true,
      }),
      "native",
    );
    await page
      .getByRole("button", { name: "Fail preparation", exact: true })
      .click();
    await expect(
      preview.getByText(/The update will not restart Situate automatically/),
    ).toBeVisible();
    await expect(force).toHaveCount(0);
    await expect(
      preview.getByRole("button", {
        name: "Waiting for actions to stop…",
        exact: true,
      }),
    ).toBeDisabled();
    await capture("stop-pending", width);
    await page
      .getByRole("button", {
        name: "Finish stopping actions without installing",
        exact: true,
      })
      .click();
    await expect(
      preview.getByRole("button", { name: "Install and restart", exact: true }),
    ).toBeEnabled();
    await expect(
      preview.getByRole("heading", {
        name: "Installing the update…",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview
      .getByRole("button", { name: "Install and restart", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Install and restart", exact: true })
      .click();
    await selectOption(
      page.getByRole("combobox", {
        name: "Preparation failure reason",
        exact: true,
      }),
      "stop-failed",
    );
    await page
      .getByRole("button", { name: "Fail preparation", exact: true })
      .click();
    await expect(
      preview.getByText(/A forced update cannot bypass this step/),
    ).toBeVisible();
    await expect(
      preview.getByText(
        /use a trusted installer of the same or a newer version/,
      ),
    ).toBeVisible();
    await expect(force).toHaveCount(0);
    await capture("stop-failed", width);
  }
});

test("idle restart and long confirmation text reflow without clipping", async ({
  page,
}, info) => {
  const preview = await open(page, "updates-settings");
  await preview
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  await expect(
    preview.getByText(
      "Situate will save your work in all open windows, then restart with the update.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Update later", exact: true }),
  ).toBeFocused();
  if (process.env.UPDATE_DIALOG_REVIEW_DIR)
    await preview.screenshot({
      path: `${process.env.UPDATE_DIALOG_REVIEW_DIR}/${info.project.name}.idle.1440.png`,
    });
  await preview.setViewportSize({ width: 390, height: 600 });
  await preview.getByRole("dialog").evaluate((element) => {
    element.querySelector("p")!.textContent +=
      " Save your work in every open window before restarting with the downloaded update.";
    for (const button of element.querySelectorAll("button"))
      button.textContent += " when you are ready to continue";
  });
  const dialog = preview.getByRole("dialog");
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  for (const button of await dialog.getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const bounds = await button.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  }
  if (process.env.UPDATE_DIALOG_REVIEW_DIR)
    await preview.screenshot({
      path: `${process.env.UPDATE_DIALOG_REVIEW_DIR}/${info.project.name}.long-text.390.png`,
    });
  await preview.keyboard.press("Escape");
  await expect(
    preview.getByRole("button", { name: "Install and restart", exact: true }),
  ).toBeFocused();
});

test("corner icon reveals its label without moving the workspace and is keyboard accessible", async ({
  page,
}) => {
  const preview = await open(page);
  const button = preview.getByRole("button", {
    name: "Update available",
    exact: true,
  });
  const label = preview.locator(".notice-label");
  await preview.mouse.move(0, 0);
  await expect(label).toBeHidden();
  const shell = await preview.locator(".app-shell").boundingBox();
  expect(shell!.y).toBe(0);
  expect(shell!.height).toBe(900);
  const icon = await button.boundingBox();
  expect(icon!.width).toBe(44);
  expect(icon!.height).toBe(44);
  expect(1440 - icon!.x - icon!.width).toBe(16);
  expect(900 - icon!.y - icon!.height).toBe(16);
  await button.hover();
  await expect(label).toHaveCSS("opacity", "1");
  expect(await preview.locator(".app-shell").boundingBox()).toEqual(shell);
  expect((await label.boundingBox())!.x).toBeLessThan(icon!.x);
  await label.click({ position: { x: 15, y: 22 } });
  await expect(
    preview.getByRole("heading", { name: "Updates", exact: true }),
  ).toBeFocused();
  await preview.mouse.move(0, 0);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await button.focus();
  await expect(button).toBeFocused();
  await expect(label).toBeVisible();
  await expect(label).toHaveCSS("transition-duration", "0s");
  await preview.keyboard.press("Enter");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
});

test("compact corner icon stays clear of the message composer", async ({
  page,
}) => {
  const preview = await open(page);
  for (const width of [768, 390, 320]) {
    await preview.setViewportSize({ width, height: 700 });
    const icon = await preview
      .getByRole("button", { name: "Update available", exact: true })
      .boundingBox();
    const input = await preview
      .getByRole("textbox", { name: "Message", exact: true })
      .boundingBox();
    expect(icon!.y + icon!.height).toBeLessThanOrEqual(input!.y);
  }
});

test("corner notice survives sidebar collapse and opens settings without installation", async ({
  page,
}) => {
  const preview = await open(page);
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    preview.getByRole("button", { name: "Update available", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Update available", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Updates", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Install and restart", exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveAccessibleName(
    "Restart to install the update?",
  );
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Install and restart", exact: true }),
  ).toBeFocused();
});
test("manual check downloads in the background, reports progress, then requires confirmation", async ({
  page,
}) => {
  const preview = await open(page, "updates-current");
  await preview
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Checking for updates…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete update check", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete update check", exact: true })
    .click();
  await expect(
    preview.getByRole("progressbar", { name: "Update download" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("slider", { name: /Download progress/ }).fill("65");
  await expect(preview.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "65",
  );
  await expect(
    preview.getByRole("button", { name: "Update available", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Complete download", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  await preview
    .getByRole("dialog")
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(
    preview.getByRole("heading", { name: "Preparing to restart…" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete safe preparation", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Installing the update…" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Complete installation and restart",
      exact: true,
    })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Browse version history", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveAccessibleName(
    "Version history",
  );
  await preview.keyboard.press("Escape");
  await expect(
    preview.getByRole("button", { name: "Update available", exact: true }),
  ).toHaveCount(0);
});
test("running actions can be postponed and synchronization can complete before restart", async ({
  page,
}) => {
  const preview = await open(page, "updates-restart");
  await expectDialogTitle(preview.locator("#update-dialog-title"));
  await expectDialogBody(preview.locator("#update-dialog-description"));
  await expect(
    preview
      .getByRole("dialog")
      .getByText(
        "Actions are still running. Restarting will stop them and save your work in all open windows.",
        {
          exact: true,
        },
      ),
  ).toBeVisible();
  await expect(preview.getByRole("dialog").getByRole("list")).toHaveCount(0);
  await expect(
    preview.getByText(
      "You can continue these chats with a new message after restarting.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    preview.getByText(/Stopping doesn’t undo external changes/),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Update later", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Actions running", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "Unsynchronized workspace changes",
      exact: true,
    })
    .check();
  await preview
    .getByRole("button", { name: "Install and restart", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Synchronize before restarting", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveAccessibleName(
    "Waiting for synchronization…",
  );
  await page
    .getByRole("button", { name: "Complete synchronization", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Installing the update…" }),
  ).toBeVisible();
});
for (const channel of ["homebrew", "store"]) {
  test(`${channel} omits update UI but retains voluntary history`, async ({
    page,
  }) => {
    const preview = await open(page, `release-notes-${channel}`);
    await expect(preview.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Apply external update and reopen",
        exact: true,
      })
      .click();
    await expect(preview.getByRole("dialog")).toHaveCount(0);
    await preview
      .getByRole("button", { name: "Browse version history", exact: true })
      .click();
    await expect(preview.getByRole("dialog")).toHaveAccessibleName(
      "Version history",
    );
    await preview.keyboard.press("Escape");
    await expect(
      preview.getByRole("button", { name: "Update available", exact: true }),
    ).toHaveCount(0);

    await expect(
      preview
        .getByRole("navigation", { name: "Settings categories" })
        .getByRole("button", { name: "Updates" }),
    ).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: "Check for updates", exact: true }),
    ).toHaveCount(0);
  });
}
test("check failure is inline, and scenario reset cancels pending state", async ({
  page,
}) => {
  const preview = await open(page, "updates-current");
  await preview
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await selectOption(
    page.getByRole("combobox", { name: "Download and check result" }),
    "offline",
  );
  await page
    .getByRole("button", { name: "Complete update check", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Couldn’t check for updates" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "You’re up to date" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete update check", exact: true }),
  ).toHaveCount(0);
});
test("settings and release notes fit a narrow window and support keyboard dismissal", async ({
  page,
}) => {
  const preview = await open(page, "updates-downloading");
  await preview.setViewportSize({ width: 390, height: 700 });
  await expect(preview.getByRole("progressbar")).toBeVisible();
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open version history", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toBeVisible();
  await preview.keyboard.press("Tab");
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(preview.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
});
