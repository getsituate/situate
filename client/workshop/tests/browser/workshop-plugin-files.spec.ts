import { expect, test, type Page } from "./test";
async function open(page: Page, scenario = "plugins-files") {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

test("file browsing fills the page without a second frame or metadata header", async ({
  page,
}) => {
  const preview = await open(page);
  const surface = preview.locator(".plugin-view");
  const browser = preview.locator(".plugin-code-browser");
  await expect(browser.locator(".code-navigation-header")).toBeHidden();
  await expect(browser).toHaveCSS("border-top-width", "0px");
  await expect(browser).toHaveCSS("border-radius", "0px");
  await browser.getByRole("button", { name: "Source", exact: true }).click();
  await browser.locator(".code-source").evaluate((source) => {
    source.textContent = source.textContent!.repeat(100);
  });
  for (const width of [1440, 768, 375, 320]) {
    await preview.setViewportSize({ width, height: 900 });
    const content = (await surface.boundingBox())!;
    const files = (await browser.boundingBox())!;
    expect(files.x).toBeCloseTo(content.x, 0);
    expect(files.width).toBeCloseTo(content.width, 0);
    expect(files.y + files.height).toBeCloseTo(content.y + content.height, 0);
    expect(
      await surface.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(false);
    expect(
      await browser
        .locator(".code-document-scroll")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
    await expect(
      browser.getByRole("button", { name: "Source", exact: true }),
    ).toBeVisible();
  }
});

test("browse the complete code folder with keyboard navigation and read-only previews", async ({
  page,
}) => {
  const preview = await open(page);
  const browser = preview.locator(".plugin-code-browser");
  await expect(
    preview
      .locator(".plugin-heading")
      .getByRole("heading", { name: "Weekly planning", exact: true }),
  ).toHaveCount(1);
  await expect(browser.getByText(/Installed version|Read only/)).toHaveCount(0);
  await expect(
    browser.getByRole("button", { name: ".gitignore", exact: true }),
  ).toBeVisible();
  const skills = browser.getByRole("button", { name: "skills", exact: true });
  await skills.focus();
  await skills.press("Enter");
  await expect(skills).toHaveAttribute("aria-expanded", "true");
  await browser
    .getByRole("button", { name: "prepare", exact: true })
    .press("Enter");
  await browser
    .getByRole("button", { name: "SKILL.md", exact: true })
    .press("Enter");
  await expect(
    browser.getByRole("heading", { name: "SKILL.md", exact: true }),
  ).toBeFocused();
  await expect(browser.locator(".code-location")).toContainText(
    "skills / prepare",
  );
  await browser.getByRole("button", { name: "Source", exact: true }).click();
  await expect(browser.locator(".code-source")).toContainText("name: prepare");
  await expect(browser.locator(".code-source")).toContainText(
    "Do not create external events without approval.",
  );
  await expect(browser.locator("textarea, [contenteditable=true]")).toHaveCount(
    0,
  );
  await browser.getByRole("button", { name: "src", exact: true }).click();
  await browser.getByRole("button", { name: "index.ts", exact: true }).click();
  await expect(browser.locator(".code-source")).toContainText(
    "export function prepare",
  );
  await browser.getByRole("button", { name: "assets", exact: true }).click();
  await browser.getByRole("button", { name: "icon.svg", exact: true }).click();
  await browser.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    browser.getByRole("img", { name: "assets/icon.svg", exact: true }),
  ).toBeVisible();
  await browser.getByRole("button", { name: "index.bin", exact: true }).click();
  await expect(
    browser.getByText("A preview is not available for this file type.", {
      exact: true,
    }),
  ).toBeVisible();
  await browser
    .getByRole("button", { name: /New file|History|Edit source|File actions/ })
    .count()
    .then((count) => expect(count).toBe(0));
});

test("filtering, narrow navigation, resizing and reset preserve the right scope", async ({
  page,
}) => {
  const preview = await open(page);
  const browser = preview.locator(".plugin-code-browser");
  const filter = browser.getByRole("searchbox");
  await filter.fill("skill");
  await browser.getByRole("button", { name: "SKILL.md", exact: true }).click();
  for (const width of [768, 375, 320]) {
    await preview.setViewportSize({ width, height: 900 });
    await expect(
      browser.getByRole("heading", { name: "SKILL.md", exact: true }),
    ).toBeVisible();
    if (width === 768) {
      await expect(filter).toBeVisible();
    } else {
      await browser
        .getByRole("button", { name: "Back to files", exact: true })
        .click();
      await expect(filter).toBeFocused();
    }
    await expect(filter).toHaveValue("skill");
    await browser
      .getByRole("button", { name: "SKILL.md", exact: true })
      .click();
    expect(
      await browser.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(false);
  }
  await preview.setViewportSize({ width: 1440, height: 1000 });
  await expect(filter).toHaveValue("skill");
  await filter.fill("nothing matches");
  await expect(
    browser.getByText("No matching files. Try another name.", { exact: true }),
  ).toBeVisible();
  await expect(
    browser.getByRole("heading", { name: "SKILL.md", exact: true }),
  ).toBeVisible();
  await preview.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(filter).toBeVisible();
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("nothing matches");
  expect(
    await browser.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    browser.getByRole("heading", { name: "AGENTS.md", exact: true }),
  ).toBeVisible();
  await browser
    .getByRole("button", { name: "Back to files", exact: true })
    .click();
  await expect(filter).toHaveValue("");
});

test("mobile code folders use the shared back control without workspace subtitles", async ({
  page,
}) => {
  const preview = await open(page);
  const browser = preview.locator(".plugin-code-browser");
  const header = browser.locator(".plugin-files-header");
  const filter = browser.getByRole("searchbox");
  const tree = browser.getByRole("navigation", {
    name: "Plugin files and folders",
  });
  const back = header.getByRole("button", {
    name: "Back to files",
    exact: true,
  });
  await filter.fill("skill");
  await browser.getByRole("button", { name: "SKILL.md", exact: true }).click();
  await browser.getByRole("button", { name: "Source", exact: true }).click();
  for (const width of [640, 375, 320]) {
    await preview.setViewportSize({ width, height: 844 });
    await expect(
      preview.locator(".plugin-heading .plugin-workspace"),
    ).toHaveCount(0);
    await expect(preview.locator(".plugin-heading")).not.toContainText(
      "Field notes",
    );
    await expect(header).toBeVisible();
    await expect(tree).toBeHidden();
    await expect(back).toBeInViewport();
    await expect(back.locator("svg")).toBeVisible();
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await back.focus();
    await back.press("Enter");
    await expect(filter).toBeFocused();
    await expect(filter).toHaveValue("skill");
    await expect(tree).toBeVisible();
    await expect(back).toHaveCount(0);
    await browser
      .getByRole("button", { name: "SKILL.md", exact: true })
      .press("Enter");
    await expect(
      browser.getByRole("heading", { name: "SKILL.md", exact: true }),
    ).toBeFocused();
    await expect(
      browser.getByRole("button", { name: "Source", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await preview.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.style.zoom = "2";
  });
  await preview.setViewportSize({ width: 750, height: 1000 });
  await expect(back).toBeInViewport();
  expect(await header.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    false,
  );
  await back.click();
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("skill");
  await preview.evaluate(() => {
    document.documentElement.dir = "ltr";
    document.documentElement.style.zoom = "1";
  });
  await preview.setViewportSize({ width: 1440, height: 1000 });
  await expect(header).toBeHidden();
  await expect(tree).toBeVisible();
  await expect(
    browser.getByRole("heading", { name: "SKILL.md", exact: true }),
  ).toBeVisible();
  await expect(filter).toHaveValue("skill");
});

test("folder error, retry, empty and loading states stay in the file screen", async ({
  page,
}) => {
  const preview = await open(page, "plugins-files-error");
  await expect(preview.getByRole("alert")).toHaveText(
    "The plugin files could not be loaded.",
  );
  await preview.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(preview.getByRole("status")).toHaveText("Loading plugin files…");
  await page.getByRole("button", { name: "Show files", exact: true }).click();
  await expect(preview.locator(".plugin-code-browser .markdown")).toContainText(
    "Weekly planning",
  );
  await page
    .getByRole("button", { name: "Show empty code folder", exact: true })
    .click();
  await expect(
    preview.getByText("This code folder has no files.", { exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: /Back to plugins/ }).click();
  await expect(
    page.getByRole("group", { name: "Code folder state", exact: true }),
  ).toHaveCount(0);
});

test("disabled plugin inspection does not activate it, and back restores its entry point", async ({
  page,
}) => {
  const preview = await open(page, "plugins-disabled");
  const calendar = preview.getByRole("article", {
    name: "Calendar connection",
    exact: true,
  });
  const files = calendar.getByRole("button", {
    name: "View files",
    exact: true,
  });
  await files.click();
  await expect(
    preview
      .locator(".plugin-heading")
      .getByRole("heading", { name: "Calendar connection", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".markdown")).toContainText(
    "Calendar connection",
  );
  await preview.getByRole("button", { name: /Back to plugins/ }).click();
  await expect(files).toBeFocused();
  await expect(
    calendar.getByRole("button", { name: "Enable", exact: true }),
  ).toBeEnabled();
  await expect(
    calendar.getByRole("button", { name: "Settings", exact: true }),
  ).toBeDisabled();
});

test("recorded diffs remain unchanged after activation", async ({ page }) => {
  const preview = await open(page, "plugins-development-changes");
  const panel = preview.locator(".assignment-files");
  await panel.locator('[data-change-id="notes"]').click();
  const before = (await panel.locator(".diff-lines").textContent())!;
  for (const name of [
    "Start checks",
    "Checks passed; actions still running",
    "Actions finished; adopt checked changes",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(panel.locator(".diff-lines")).toHaveText(before);
  await expect(panel.locator(".revision-range")).toContainText(
    "notes-r1 → notes-r2",
  );
  await expect(preview.locator(".plugin-code-browser")).toHaveCount(0);
});

test("additions, deletions, renames and Markdown use the same file diff surface", async ({
  page,
}) => {
  const preview = await open(page, "plugins-development-changes");
  const panel = preview.locator(".assignment-files");
  for (const [id, added, removed] of [
    ["view", 2, 0],
    ["legacy", 0, 1],
    ["manifest", 0, 0],
    ["review", 1, 1],
  ] as const) {
    await panel.locator(`[data-change-id="${id}"]`).click();
    await expect(panel.locator(".diff-line.added")).toHaveCount(added);
    await expect(panel.locator(".diff-line.removed")).toHaveCount(removed);
    if (id === "manifest") {
      await expect(panel.locator(".renamed-path")).toContainText("plugin.json");
      await expect(panel).toContainText("No content changes.");
    }
    if (id === "review") {
      await expect(panel.locator(".diff-lines")).toContainText(
        "# Weekly review",
      );
      await preview.screenshot({
        path: test.info().outputPath("changes-markdown-diff.png"),
      });
    }
    await panel
      .getByRole("button", { name: "All changes", exact: true })
      .click();
  }
});
