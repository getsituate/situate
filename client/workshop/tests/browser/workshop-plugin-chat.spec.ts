import { selectOption } from "./select";
import { toggleChanges } from "./chat-actions";
import { expect, test, type Page } from "./test";

async function open(page: Page, scenario = "plugins-create") {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1440, height: 1000 });
  await expect(preview.locator(".plugin-development")).toBeVisible();
  return preview;
}

test("normal and development transcripts share message and change styling", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-changes");
  const ordinaryControls = await page.context().newPage();
  await ordinaryControls.goto("/?workshop=controls&scenario=chat-complete");
  const popup = ordinaryControls.waitForEvent("popup");
  await ordinaryControls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const ordinary = await popup;
  await ordinary.setViewportSize({ width: 1440, height: 1000 });
  for (const selector of [
    ".chat-message.user",
    ".change-card",
    ".edit-content",
  ]) {
    const styles = (surface: Page) =>
      surface
        .locator(selector)
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return [
            style.fontSize,
            style.lineHeight,
            style.padding,
            style.borderRadius,
            style.color,
          ];
        });
    await expect(ordinary.locator(selector).first()).toBeVisible();
    await expect(preview.locator(selector).first()).toBeVisible();
    expect(await styles(preview)).toEqual(await styles(ordinary));
  }
  const activity = preview.locator(".activity").first();
  await activity.locator(":scope > summary").focus();
  await preview.keyboard.press("Enter");
  await activity.locator(".call-detail > summary").first().click();
  await expect(activity.locator(".call-data").first()).toContainText(
    "limit = 20",
  );
  await expect(activity.locator(".tool-name").first()).toHaveText("edit");
  await preview.screenshot({
    path: test.info().outputPath("development-activity.png"),
  });
  await ordinaryControls.close();
  await ordinary.close();
});

test("development actions stay in the corner without a separate header", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development");
  const request = preview.getByLabel("Your request", { exact: true });
  await request.fill("Keep my draft while the layout changes.");
  const surface = preview.locator(".plugin-development");
  const info = surface.getByRole("button", {
    name: "About plugin development",
  });
  const more = surface.getByRole("button", { name: "Chat actions" });
  for (const width of [320, 375, 390, 412, 600, 768, 1440]) {
    await preview.setViewportSize({ width, height: 844 });
    await expect(surface.locator(".chat-pane-header")).toHaveCount(0);
    await expect(more).toBeVisible();
    const help = (await info.boundingBox())!;
    const options = (await more.boundingBox())!;
    expect(help.width).toBeGreaterThanOrEqual(44);
    expect(options.height).toBeGreaterThanOrEqual(44);
    expect(help.y).toBeCloseTo(options.y, 0);
    expect(help.x + help.width).toBeLessThanOrEqual(options.x);
    await expect(request).toHaveValue(
      "Keep my draft while the layout changes.",
    );
  }
  await preview.setViewportSize({ width: 320, height: 844 });
  await preview.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  const help = (await info.boundingBox())!;
  const options = (await more.boundingBox())!;
  expect(options.x + options.width).toBeLessThanOrEqual(help.x);
  await more.press("ArrowDown");
  const menu = preview.getByRole("menu", { name: "Chat actions" });
  await expect(
    menu.getByRole("menuitem", { name: "Switch to chat" }),
  ).toBeDisabled();
  await menu.press("Escape");
  await expect(more).toBeFocused();
});

test("help next to the development label preserves the draft", async ({
  page,
}) => {
  const preview = await open(page);
  const request = preview.getByLabel("Your request", { exact: true });
  await request.fill("Connect my reading list.");
  const help = preview.getByRole("button", {
    name: "About plugin development",
    exact: true,
  });
  const label = preview.locator(".development-mode-label");
  await expect(label).toHaveText("Plugin development");
  await expect(preview.locator(".chat-composer details")).toHaveCount(0);
  for (const width of [1440, 375, 320]) {
    await preview.setViewportSize({ width, height: 844 });
    const text = (await label.boundingBox())!;
    const icon = (await help.boundingBox())!;
    expect(text.x + text.width).toBeLessThanOrEqual(icon.x);
    expect(icon.width).toBeGreaterThanOrEqual(44);
    await help.focus();
    await help.press("Enter");
    const dialog = preview.getByRole("dialog", {
      name: "About plugin development",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "separate chat for a development assignment",
    );
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    await expect(dialog).toContainText("ask for adjustments in the chat");
    await expect(dialog).toContainText(
      "activates it after required checks pass",
    );
    await expect(dialog).toContainText(
      "same workspace access as ordinary chat",
    );
    await expect(dialog).toContainText("not an access boundary");
    await expect(
      dialog.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeFocused();
    await preview.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await preview.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeFocused();
    await preview.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("region", {
        name: "About plugin development",
        exact: true,
      }),
    ).toBeFocused();
    await dialog.press("Escape");
    await expect(help).toBeFocused();
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await expect(request).toHaveValue("Connect my reading list.");
    expect(
      await preview
        .locator(".plugin-development")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(false);
  }
  for (const zoom of [1, 2]) {
    await preview.setViewportSize({ width: 1440, height: 1000 });
    await preview.evaluate((value) => {
      document.documentElement.style.zoom = String(value);
    }, zoom);
    await help.click();
    const dialog = preview.getByRole("dialog");
    const box = (await dialog.boundingBox())!;
    const surface = (await preview
      .locator(".plugin-development")
      .boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(surface.x);
    expect(box.y).toBeGreaterThanOrEqual(surface.y);
    expect(box.x + box.width).toBeLessThanOrEqual(surface.x + surface.width);
    expect(box.y + box.height).toBeLessThanOrEqual(surface.y + surface.height);
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await preview.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await selectOption(page.getByLabel("Platform profile"), "ios");
  await preview.setViewportSize({ width: 390, height: 610 });
  await page.getByLabel("Keyboard occlusion").check();
  await help.click();
  const dialog = preview.getByRole("dialog");
  await preview.keyboard.press("Tab");
  await expect(
    dialog.getByRole("region", { name: "About plugin development" }),
  ).toBeFocused();
  await preview.keyboard.press("PageDown");
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const box = (await dialog.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(610 - 294);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(help).toBeFocused();
  await expect(request).toHaveValue("Connect my reading list.");
  await help.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
});

test("an assignment uses shared Activity and note-change presentation through follow-up and activation", async ({
  page,
}) => {
  const preview = await open(page);
  const request = preview.getByLabel("Your request", { exact: true });
  const panel = preview.locator(".assignment-files");
  await expect(panel).toContainText("No changes to show yet");
  await expect(page.getByLabel("Example development result")).toHaveCount(0);
  await request.fill("Bring my notes into a view.");
  await request.press("Enter");
  await expect(request).toHaveValue("");
  await expect(request).toBeFocused();
  await expect(preview.locator(".activity")).toHaveCount(1);
  await expect(preview.locator(".activity")).not.toHaveAttribute("open");
  await expect(preview.locator(".change-card")).toHaveCount(1);
  await expect(panel.locator('[data-change-id="notes"]')).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Discover another affected plugin",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("button", { name: /\.situate\/plugins\/weekly\/code\// }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Fail a consumer check", exact: true })
    .click();
  await expect(preview.locator(".chat-message.assistant").last()).toContainText(
    "has not been activated",
  );
  await request.fill("Fix the failed consumer.");
  await request.press("Enter");
  await expect(preview.locator(".chat-message.user")).toHaveCount(2);
  await expect(
    preview.locator(".chat-message.assistant").first(),
  ).toContainText("has not been activated");
  for (const name of [
    "Start checks",
    "Checks passed; actions still running",
    "Actions finished; adopt checked changes",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(preview.locator(".chat-message.assistant").last()).toContainText(
    "checked code is active",
  );
  await expect(preview.locator(".bend-status")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator(".chat-message.user")).toHaveCount(0);
  await expect(panel).toContainText("No changes to show yet");
});

test("file paths open unified diffs and preserve search, focus and drafts at every width", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-changes");
  const panel = preview.locator(".assignment-files");
  const request = preview.getByLabel("Your request", { exact: true });
  const toggle = preview.getByRole("button", {
    name: "Chat actions",
    exact: true,
  });
  const file = ".situate/plugins/notes/code/src/index.ts";
  await request.fill("Keep this draft while I inspect.");
  await expect(
    panel.getByRole("button", { name: "Files", exact: true }),
  ).toHaveCount(0);
  await expect(panel.locator(".change-group")).toHaveCount(0);
  await expect(panel.locator(".file-row").first()).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await preview.screenshot({
    path: test.info().outputPath("changes-file-list.png"),
  });
  await panel.getByRole("searchbox").fill("index.ts");
  await panel.locator('[data-change-id="notes"]').click();
  await expect(
    panel.getByRole("heading", { name: file, exact: true }),
  ).toBeFocused();
  await expect(panel.locator(".diff-line.removed")).toContainText(
    "export const listNotes = () => [];",
  );
  await expect(panel.locator(".diff-line.added")).toContainText("limit = 20");
  await expect(
    panel.locator(".change-summary, .technical-details"),
  ).toHaveCount(0);
  await preview.screenshot({
    path: test.info().outputPath("changes-unified-diff.png"),
  });
  await panel
    .getByRole("button", { name: "Expand changes", exact: true })
    .click();
  await expect(panel.getByRole("searchbox")).toBeVisible();
  await expect(panel.locator(".diff-lines")).toBeVisible();
  await expect(preview.locator(".plugin-conversation")).toBeHidden();
  await preview.screenshot({
    path: test.info().outputPath("changes-expanded.png"),
  });
  await panel
    .getByRole("button", { name: "Restore sidebar", exact: true })
    .click();
  await preview.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  for (const width of [1440, 1000, 840, 768, 390, 320]) {
    await preview.setViewportSize({ width, height: 900 });
    await toggleChanges(preview);
    await expect(
      panel.getByRole("heading", { name: file, exact: true }),
    ).toBeFocused();
    await expect
      .poll(async () =>
        panel
          .locator(".inspection-body")
          .evaluate(
            (el) =>
              el.classList.contains("split") ===
              el.parentElement!.getBoundingClientRect().width >= 720,
          ),
      )
      .toBe(true);
    const back = panel.getByRole("button", {
      name: "All changes",
      exact: true,
    });
    if (await back.isVisible()) await back.click();
    await expect(panel.getByRole("searchbox")).toHaveValue("index.ts");
    await panel.locator('[data-change-id="notes"]').click();
    expect(await panel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      false,
    );
    if (width === 390) {
      await expect
        .poll(() =>
          panel
            .locator(".diff-scroll")
            .evaluate((el) => el.scrollWidth > el.clientWidth),
        )
        .toBe(true);
      await preview.screenshot({
        path: test.info().outputPath("changes-narrow-diff.png"),
      });
    }
    await preview.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(request).toHaveValue("Keep this draft while I inspect.");
  }
});

test("hundreds of files support paging, path search and keyboard selection in an expanded diff view", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-changes");
  const panel = preview.locator(".assignment-files");
  await panel.getByRole("searchbox").focus();
  await page
    .getByRole("button", { name: "Show a large change list", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Expand changes", exact: true })
    .click();
  await expect(panel.locator(".file-row")).toHaveCount(100);
  await panel.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(panel.locator(".list-pagination")).toContainText("101–200");
  await panel.locator(".file-row").first().focus();
  await preview.keyboard.press("End");
  await expect(panel.locator('[data-change-id="review-500"]')).toBeFocused();
  await preview.keyboard.press("Home");
  await expect(panel.locator(".file-row").first()).toBeFocused();
  await panel.getByRole("searchbox").fill("Review 450.md");
  await expect(panel.locator(".file-row")).toHaveCount(1);
  await panel.locator(".file-row").click();
  await expect(panel.locator(".diff-heading")).toContainText(
    "Notes/Weekly reviews/Review 450.md",
  );
  await expect(panel.locator(".diff-line.added")).toContainText(
    "Review tasks and notes.",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(panel.locator(".file-row")).toHaveCount(6);
  await expect(preview.locator(".plugin-conversation")).toBeVisible();
});

test("long files show exact hunks with expandable context rather than whole-file replacements", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-changes");
  const panel = preview.locator(".assignment-files");
  await panel.getByRole("searchbox").focus();
  await page
    .getByRole("button", { name: "Show a long diff", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Expand changes", exact: true })
    .click();
  await expect(panel.locator(".diff-line.added")).toHaveCount(2);
  await expect(panel.locator(".diff-line.removed")).toHaveCount(2);
  await expect(panel.locator(".diff-gap")).toHaveCount(3);
  await expect(panel.locator(".added-count")).toHaveText("+2");
  await preview.screenshot({
    path: test.info().outputPath("changes-long-diff.png"),
  });
  await panel.locator(".diff-gap button").nth(1).click();
  expect(await panel.locator(".diff-line").count()).toBeGreaterThan(200);
  expect(await panel.locator(".diff-line").count()).toBeLessThan(400);
});

test("retrieval errors and unavailable history never substitute current contents", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-changes");
  const panel = preview.locator(".assignment-files");
  await panel.locator('[data-change-id="notes"]').click();
  const controls = page.getByRole("group", {
    name: "Changes panel",
    exact: true,
  });
  await controls
    .getByRole("button", {
      name: "Make selected historical revision unavailable",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "current file is not shown in their place",
  );
  await controls
    .getByRole("button", { name: "Fail retrieval", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Changes could not be loaded",
  );
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Loading changes…");
  await controls
    .getByRole("button", { name: "Show recorded changes", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "current file is not shown in their place",
  );
  await controls
    .getByRole("button", { name: "Show no recorded changes", exact: true })
    .click();
  await expect(panel).toContainText("No changes to show yet");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(panel.getByRole("searchbox")).toHaveValue("");
});

test("long names, large lists and an iOS layout study preserve the draft", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-changes");
  const panel = preview.locator(".assignment-files");
  const request = preview.getByLabel("Your request", { exact: true });
  await request.fill("Keep the recorded revisions.");
  await panel.getByRole("searchbox").focus();
  await page
    .getByRole("button", {
      name: "Use long assignment and package names",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Show a large change list", exact: true })
    .click();
  expect(await panel.locator(".file-row").count()).toBeGreaterThanOrEqual(80);
  const scroll = panel.locator(".inspection-scroll");
  await scroll.evaluate((el) => {
    el.scrollTop = 500;
  });
  await toggleChanges(preview);
  await toggleChanges(preview);
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(400);
  await preview.screenshot({
    path: test.info().outputPath("assignment-wide.png"),
  });
  await selectOption(page.getByLabel("Platform profile"), "ios");
  await preview.setViewportSize({ width: 390, height: 844 });
  await toggleChanges(preview);
  await page.getByLabel("Keyboard occlusion").check();
  await expect(request).toHaveValue("Keep the recorded revisions.");
  await expect(
    preview.getByRole("button", { name: "Send request", exact: true }),
  ).toBeInViewport();
  expect(
    await preview
      .locator(".plugin-development")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(false);
  await preview.screenshot({
    path: test.info().outputPath("assignment-narrow.png"),
  });
});
