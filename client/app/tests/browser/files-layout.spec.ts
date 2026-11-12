import { expect, test, type Page } from "./test";
import { filesFixture } from "./files-fixture";
import { expectDialogText, expectDialogTypography } from "./dialog-typography";

test.use({ localizationMode: "real" });

async function enterFiles(page: Page, holdRead = false): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".topic-window")).toBeVisible();
  const navigation = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const expand = page.getByRole("button", {
    name: "Expand file browser",
    exact: true,
  });
  if (await expand.isVisible()) await expand.click();
  if (holdRead)
    await page.evaluate(() => window.__filesTest.holdRead("Notes/Garden.md"));
  await page.getByRole("button", { name: "Garden.md", exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) >= 1184)
    await expect(expand).toBeHidden();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
}
async function fileMode(
  page: Page,
  name: "Read" | "Edit source",
): Promise<void> {
  await page.getByRole("button", { name: "File actions", exact: true }).click();
  await page
    .getByRole("menuitemradio", {
      name: name === "Edit source" ? /^(Edit|View) source$/ : name,
      exact: true,
    })
    .click();
}
async function source(page: Page) {
  await fileMode(page, "Edit source");
  return page.getByRole("textbox", { name: "Markdown source", exact: true });
}
async function browse(page: Page): Promise<void> {
  if (!(await page.getByRole("searchbox", { name: "Find a file" }).isVisible()))
    await page
      .getByRole("button", { name: "Expand file browser", exact: true })
      .click();
}
async function noOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(
    `text files open internally and binary files use the default application at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      const json = '{"name":"garden","enabled":true}\n';
      await filesFixture(page, {
        mobile: viewport.width < 600,
        extraFiles: {
          "Notes/config.json": json,
          LICENSE: "A plain-text license",
        },
      });
      await enterFiles(page);
      await browse(page);
      await page
        .getByRole("button", { name: "config.json", exact: true })
        .click();
      await expect(page.locator(".text-document")).toHaveText(json.trim());
      await expect(page.locator(".markdown")).toHaveCount(0);
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("files.text.read");
      await fileMode(page, "Edit source");
      const input = page.getByRole("textbox", {
        name: "File source",
        exact: true,
      });
      await expect(input).toHaveValue(json);
      await input.fill('{"name":"garden","enabled":false}\n');
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__filesTest.calls
                .filter((call) => call.operation === "save")
                .at(-1)?.text,
          ),
        )
        .toBe('{"name":"garden","enabled":false}\n');
      await expect(page.locator(".save-state")).toHaveText("Saved");
      await visual.capture("files.text.source");
      await browse(page);
      await page.getByRole("button", { name: "LICENSE", exact: true }).click();
      await expect(page.locator(".text-document")).toHaveText(
        "A plain-text license",
      );
      await browse(page);
      await page.getByRole("button", { name: "Map.pdf", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__filesTest.calls
              .filter((call) => call.operation === "openExternal")
              .map((call) => call.path),
          ),
        )
        .toEqual(["Map.pdf"]);
      await expect(page.locator(".document-location h3")).toHaveText("LICENSE");
      await expect(page.locator(".text-document")).toHaveText(
        "A plain-text license",
      );
      await noOverflow(page);
    },
  );
}

test(
  "file browser keeps its width and visibility while opening Markdown",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await filesFixture(page);
    await enterFiles(page);
    const browser = page.locator(".file-browser");
    const handle = browser.getByRole("separator", {
      name: "Resize file browser",
      exact: true,
    });
    await expect(browser).toBeVisible();
    await expect(handle).toBeVisible();
    const bounds = (await handle.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 120,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "348");
    await expect
      .poll(async () => (await browser.boundingBox())?.width)
      .toBe(348);
    await page.getByRole("button", { name: "Reading.md", exact: true }).click();
    await expect(page.locator(".document-location h3")).toHaveText(
      "Reading.md",
    );
    await expect(browser).toBeVisible();
    await expect(handle).toHaveAttribute("aria-valuenow", "348");
    await page.getByRole("button", { name: "Garden.md", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "A small garden", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await browser.boundingBox())?.width)
      .toBe(348);
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await visual.capture("files.browser.resized");
    await page
      .getByRole("button", { name: "Collapse file browser", exact: true })
      .click();
    await expect(browser).toBeHidden();
    await page
      .getByRole("button", { name: "Expand file browser", exact: true })
      .click();
    await expect(handle).toHaveAttribute("aria-valuenow", "348");
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "356");
    await handle.dblclick();
    await expect(handle).toHaveAttribute("aria-valuenow", "228");
    await page.setViewportSize({ width: 800, height: 1000 });
    await handle.focus();
    await page.keyboard.press("End");
    await expect
      .poll(
        async () => (await page.locator(".document-pane").boundingBox())?.width,
      )
      .toBeGreaterThanOrEqual(280);
    await noOverflow(page);
  },
);

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(
    `real Vue editor geometry and source/read controls at ${viewport.width}px`,
    {
      tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop",
    },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await filesFixture(page, { mobile: viewport.width < 600 });
      await enterFiles(page, true);
      const document = page.locator(".document-pane");
      await expect(document.getByRole("status")).toHaveText("Loading file…");
      await expect(document).toHaveAttribute("aria-busy", "true");
      await visual.capture("files.document.loading");
      await page.evaluate(() => window.__filesTest.releaseRead());
      await expect(document).not.toHaveAttribute("aria-busy", "true");
      await expect(
        page.getByRole("heading", { name: "A small garden", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "New chat with this file" }),
      ).toBeEnabled();
      await expect(page.locator("iframe")).toHaveCount(0);
      await noOverflow(page);
      await visual.capture("files.document.read");
      if (viewport.width === 1440) {
        await page.keyboard.press("Tab");
        const tab = page.locator(".topic-tab-select").first();
        await tab.focus();
        await expect(tab).toBeFocused();
        await expect(tab).toHaveCSS("outline-offset", "-3px");
        await expect(tab).toHaveCSS("outline-width", "3px");
        await expect(page.getByRole("tooltip")).toHaveText("Garden.md");
        await expect(page.getByRole("tooltip")).toBeVisible();
        await visual.capture("files.document.tab-focus");
        const firstFile = page.locator(".file-entry, .folder-entry").first();
        await firstFile.focus();
        await expect(firstFile).toBeFocused();
        await expect(firstFile).toHaveCSS("outline-offset", "-3px");
        await expect(firstFile).toHaveCSS("outline-width", "3px");
        await expect(page.getByRole("tooltip")).toHaveText("Notes");
        await expect(page.getByRole("tooltip")).toBeVisible();
        await visual.capture("files.document.tree-focus");
        const search = page.getByRole("searchbox", { name: "Find a file" });
        await search.focus();
        await expect(search).toBeFocused();
        await expect(page.locator(".file-filter")).toHaveCSS(
          "outline-offset",
          "-3px",
        );
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await visual.capture("files.document.search-focus");
        await page.emulateMedia({ forcedColors: "active" });
        await firstFile.focus();
        await expect(firstFile).toHaveCSS("outline-style", "solid");
        await expect(firstFile).toHaveCSS("outline-offset", "-3px");
        await page.emulateMedia({ forcedColors: "none" });
      }
      const input = await source(page);
      await expect(input).toHaveValue(/# A small garden/);
      await visual.capture("files.document.source");
      await input.fill("# A new garden\n\nRoom for lavender.");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__filesTest.calls
                .filter((call) => call.operation === "save")
                .at(-1)?.text,
          ),
        )
        .toBe("# A new garden\n\nRoom for lavender.");
      await fileMode(page, "Read");
      await expect(
        page.getByRole("heading", { name: "A new garden", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Increase text size" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Decrease text size" }),
      ).toHaveCount(0);
      await expect(page.locator(".document-footer")).toContainText("Markdown");
      await expect(page.locator(".document-footer")).toContainText(/\d+ words/);
      await browse(page);
      await page.getByRole("searchbox", { name: "Find a file" }).fill("Map");
      await page.getByRole("button", { name: "Map.pdf", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__filesTest.calls.some(
              (call) =>
                call.operation === "openExternal" && call.path === "Map.pdf",
            ),
          ),
        )
        .toBe(true);
    },
  );
  test(
    `reference layout and complete anchored file menu at ${viewport.width}px`,
    {
      tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop",
    },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await filesFixture(page, { mobile: viewport.width < 600 });
      await enterFiles(page);
      await expect(page.locator(".files-header")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Read", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Source", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Back to workspace", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Deleted files", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".document-location p")).toHaveText("Notes");
      await expect(page.locator(".document-location h3")).toHaveText(
        "Garden.md",
      );
      if (viewport.width > 1184) {
        await expect(
          page.getByRole("button", { name: "Files", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        expect(
          (await page.locator(".desktop-sidebar").boundingBox())?.width,
        ).toBe(300);
        expect((await page.locator(".file-browser").boundingBox())?.width).toBe(
          228,
        );
        expect((await page.locator(".browser-header").boundingBox())?.y).toBe(
          (await page.locator(".document-bar").boundingBox())?.y,
        );
        await expect(page.locator(".browser-header")).toContainText("Files");
        await expect(page.locator(".browser-footer")).toContainText("3 files");
        await expect(page.locator(".browser-footer")).toContainText(
          "On this device",
        );
      }
      const trigger = page.getByRole("button", {
        name: "File actions",
        exact: true,
      });
      await trigger.click();
      const menu = page.getByRole("menu", {
        name: "File actions",
        exact: true,
      });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("menuitemradio", { name: "Read", exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        menu.getByRole("menuitemradio", { name: "Edit source", exact: true }),
      ).toHaveAttribute("aria-checked", "false");
      for (const name of [
        "Version history",
        "New file…",
        "New folder…",
        "Rename…",
        "Move to…",
        "Duplicate…",
        "Delete…",
      ])
        await expect(
          menu.getByRole("menuitem", { name, exact: true }),
        ).toBeVisible();
      expect(
        await page.evaluate(() => !!document.querySelector("dialog:modal")),
      ).toBe(false);
      await noOverflow(page);
      await visual.capture("files.document.actions");
      await page.keyboard.press("End");
      await expect(
        menu.getByRole("menuitem", { name: "Delete…", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Home");
      await expect(
        menu.getByRole("menuitemradio", { name: "Read", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(
        menu.getByRole("menuitemradio", { name: "Edit source", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.mouse.move(0, 0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("files.document.actions-closed");
    },
  );
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(
    `whole-version conflict and changed candidates at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await filesFixture(page, { mobile: viewport.width < 600 });
      await enterFiles(page);
      await page.evaluate(() => window.__filesTest.setConflict(true));
      const input = await source(page);
      await input.fill("# My garden\n\nMore lavender.");
      const dialog = page.getByRole("dialog", {
        name: "Choose a version to keep",
      });
      await expect(dialog).toBeVisible();
      await expectDialogTypography(dialog);
      await expect(dialog.locator(".notice")).toHaveCSS(
        "border-inline-start-width",
        "0px",
      );
      await expectDialogText(
        dialog.locator(".candidate h3").first(),
        "section",
      );
      await expectDialogText(
        dialog.locator("[data-dialog-help]").first(),
        "help",
      );
      expect(
        await dialog
          .locator("[data-dialog-help]")
          .first()
          .evaluate((element) => getComputedStyle(element).color),
      ).not.toBe(
        await dialog.evaluate((element) => getComputedStyle(element).color),
      );
      await expect
        .poll(() =>
          dialog
            .locator("pre")
            .first()
            .evaluate((element) =>
              parseFloat(getComputedStyle(element).lineHeight),
            ),
        )
        .toBeCloseTo(26.4, 3);
      if (viewport.width < 650) {
        await expect
          .poll(async () => Math.round((await dialog.boundingBox())!.width))
          .toBe(viewport.width);
        await expect(
          dialog.getByRole("button", { name: "Apply selected version" }),
        ).toBeInViewport({ ratio: 1 });
      }
      await expect(
        dialog.getByRole("button", {
          name: "Apply selected version",
        }),
      ).toBeDisabled();
      await visual.capture("files.conflict.choose");
      if (viewport.width < 650) {
        await dialog
          .getByRole("button", {
            name: "Changed file",
            exact: true,
          })
          .click();
        await expect(
          dialog.locator('[data-candidate="external"] pre'),
        ).toBeVisible();
        await visual.capture("files.conflict.changed-file");
      }
      await dialog.getByRole("radio", { name: "Keep editor text" }).check();
      await page.evaluate(() => window.__filesTest.setChanged(true));
      await dialog
        .getByRole("button", { name: "Apply selected version" })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        "The file changed again. Review both updated versions before choosing.",
      );
      await expect(
        dialog.getByRole("radio", { name: "Keep editor text" }),
      ).not.toBeChecked();
      await visual.capture("files.conflict.changed-again");
      await dialog.getByRole("button", { name: "Decide later" }).click();
      await expect(input).toHaveValue("# My garden\n\nMore lavender.");
      await expect(page.getByText("Not saved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await dialog.getByRole("radio", { name: "Keep changed file" }).check();
      await dialog
        .getByRole("button", { name: "Apply selected version" })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(input).toHaveValue(
        "# Changed garden\n\nKeep the existing trees.",
      );
      await noOverflow(page);
    },
  );
  test(
    `unreadable workspace can be explicitly closed at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await filesFixture(page, { mobile: viewport.width < 600 });
      await enterFiles(page);
      await page.evaluate(() => {
        window.__filesTest.setSnapshotFailure(true);
        window.__filesTest.emit("files-close-requested", "garden");
      });
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "Close this workspace?" }),
      ).toBeVisible();
      await expect(dialog).toContainText("This file reference is invalid.");
      await expect(dialog).not.toContainText(
        "Some text has not reached its file.",
      );
      await visual.capture("files.close.unavailable");
      const closeAnyway = dialog.getByRole("button", { name: "Close anyway…" });
      await closeAnyway.focus();
      await page.keyboard.press("Enter");
      await expect(
        dialog.getByRole("heading", { name: "Close without saving?" }),
      ).toBeVisible();
      await expect(dialog).toContainText("Unsaved changes may be lost.");
      await expect(
        dialog.getByRole("button", { name: "Close workspace", exact: true }),
      ).toBeFocused();
      expect(
        await page.evaluate(() =>
          window.__filesTest.calls.some((call) => call.operation === "detach"),
        ),
      ).toBe(false);
      await noOverflow(page);
      await visual.capture("files.close.confirm-anyway");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(
        await page.evaluate(() =>
          window.__filesTest.calls.some((call) => call.operation === "detach"),
        ),
      ).toBe(false);
      await page.evaluate(() =>
        window.__filesTest.emit("files-close-requested", "garden"),
      );
      await expect(
        dialog.getByRole("button", { name: "Close anyway…" }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Close anyway…" }).click();
      await dialog
        .getByRole("button", { name: "Close workspace", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator(".workspace-entry")).toBeVisible();
      expect(
        await page.evaluate(() =>
          window.__filesTest.calls.filter(
            (call) => call.operation === "detach",
          ),
        ),
      ).toEqual([{ workspaceId: "garden", operation: "detach", force: true }]);
      expect(
        await page.evaluate(() =>
          window.__filesTest.calls.some((call) => call.operation === "discard"),
        ),
      ).toBe(false);
    },
  );
  test(
    `failed writes survive leaving Files and cancelled closure at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await filesFixture(page, {
        failSave: true,
        mobile: viewport.width < 600,
      });
      await enterFiles(page);
      let input = await source(page);
      await input.fill("# Keep my draft");
      await expect(page.getByRole("alert")).toContainText(
        "This action could not be completed. Try again.",
      );
      await visual.capture("files.save.failed");
      await page
        .getByRole("button", { name: "Close Files", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Open a view", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Back in this pane", exact: true })
        .click();
      input = await source(page);
      await expect(input).toHaveValue("# Keep my draft");
      await page.evaluate(() =>
        window.__filesTest.emit("files-close-requested", "garden"),
      );
      const dialog = page.getByRole("dialog", {
        name: "Keep your unsaved changes",
      });
      await expect(dialog).toBeVisible();
      await visual.capture("files.close.unsaved");
      if (viewport.width >= 600) {
        await dialog.getByRole("button", { name: "Export copies…" }).click();
        await expect(dialog).not.toBeVisible();
        await expect(input).toHaveValue("# Keep my draft");
        expect(
          await page.evaluate(() =>
            window.__filesTest.calls.some(
              (call) => call.operation === "detach",
            ),
          ),
        ).toBe(false);
        await page.evaluate(() =>
          window.__filesTest.emit("files-close-requested", "garden"),
        );
        await expect(dialog).toBeVisible();
      } else {
        await expect(
          dialog.getByRole("button", { name: "Export copies…" }),
        ).toBeDisabled();
      }
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(input).not.toHaveAttribute("readonly");
    },
  );
}
