import { selectOption } from "./select";
import { selectScenario } from "./scenarios";
import { expect, test, type BrowserContext, type Page } from "./test";

const runtimeErrors = new WeakMap<BrowserContext, string[]>();
test.beforeEach(({ context }) => {
  const errors: string[] = [];
  runtimeErrors.set(context, errors);
  const observe = (page: Page) =>
    page.on("pageerror", (error) => errors.push(error.message));
  context.pages().forEach(observe);
  context.on("page", observe);
});
test.afterEach(({ context }) => {
  expect(runtimeErrors.get(context)).toEqual([]);
});

async function open(controls: Page, scenario: string, options = "") {
  await controls.goto(`/?workshop=controls&scenario=${scenario}${options}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(
    controls.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".app-shell")).toBeVisible();
  return preview;
}

async function scenario(controls: Page, value: string) {
  await selectScenario(controls, value);
}

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator("iframe").count()).toBe(0);
}

test("navigation supports tasks, conversations, responsive tabs and draft confirmation", async ({
  page,
}) => {
  const preview = await open(page, "navigation-dashboard");
  await preview.setViewportSize({ width: 1440, height: 900 });
  await expect(preview.locator(".navigation-view")).toHaveAttribute(
    "data-layout",
    "tiled",
  );
  await preview
    .getByLabel("Review the workshop outline", { exact: true })
    .check();
  await expect(preview.getByText("2 events · 2 planned tasks")).toBeVisible();
  await preview
    .getByRole("button", {
      name: "Options for Prepare the workshop",
      exact: true,
    })
    .click();
  await preview.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByLabel("Prepare the workshop", { exact: true }),
  ).toHaveCount(0);
  await preview
    .locator("summary")
    .filter({ hasText: /^\s*Archive\b/ })
    .click();
  await preview
    .getByRole("button", { name: "Restore Prepare the workshop", exact: true })
    .click();
  await selectOption(
    page.getByLabel("Prepare the workshop", { exact: true }),
    "approval",
  );
  await expect(
    preview
      .locator(".conversation-row")
      .filter({ hasText: "Prepare the workshop" }),
  ).toContainText("Needs approval");
  await preview
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep this thought");
  await expect(page.getByLabel("Draft message", { exact: true })).toHaveValue(
    "Keep this thought",
  );
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.locator(".navigation-view")).toHaveAttribute(
    "data-layout",
    "single",
  );
  await expect(
    preview.getByRole("tab", { name: "New chat", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await preview
    .getByRole("button", { name: "Close tab — New chat", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog", { name: "Discard this draft?" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Keep tab", exact: true }).click();
  await expect(
    preview.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep this thought");
  await preview.getByRole("tab", { name: "My day", exact: true }).click();
  await expect(
    preview.getByLabel("Review the workshop outline", { exact: true }),
  ).toBeChecked();
  await fits(preview);
});

test("new chat starts empty while chat draft contains text and requires discard confirmation", async ({
  page,
}) => {
  const preview = await open(page, "navigation-chat");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.locator(".navigation-view")).toHaveAttribute(
    "data-layout",
    "single",
  );
  const message = preview.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  const draftControl = page.getByLabel("Draft message", { exact: true });
  const discardDialog = preview.getByRole("dialog", {
    name: "Discard this draft?",
  });
  const closeTab = preview.getByRole("button", {
    name: "Close tab — New chat",
    exact: true,
  });

  await expect(message).toHaveValue("");
  await expect(draftControl).toHaveValue("");
  await closeTab.click();
  await expect(
    preview.getByText("No open tabs", { exact: true }),
  ).toBeVisible();
  await expect(discardDialog).not.toBeVisible();

  await scenario(page, "navigation-draft");
  await expect(message).toHaveValue("Help me prepare for the workshop.");
  await expect(draftControl).toHaveValue("Help me prepare for the workshop.");
  await closeTab.click();
  await expect(discardDialog).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Keep tab", exact: true }),
  ).toBeFocused();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let count = 0; count < 5; count++) {
      await preview.keyboard.press(key);
      await expect
        .poll(() =>
          discardDialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        )
        .toBe(true);
    }
  }
  await preview.getByRole("button", { name: "Keep tab", exact: true }).click();
  await expect(message).toHaveValue("Help me prepare for the workshop.");

  await scenario(page, "navigation-chat");
  await expect(message).toHaveValue("");
  await expect(draftControl).toHaveValue("");
});

test("environment changes preserve a focused composer and selection without adding chrome", async ({
  page,
}) => {
  const preview = await open(page, "navigation-chat");
  const message = preview.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await message.fill("A thought across screen sizes");
  await message.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(2, 9);
  });
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await preview.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  await expect(preview.locator(".environment-content")).toHaveCSS(
    "height",
    "491px",
  );
  await expect(message).toHaveValue("A thought across screen sizes");
  expect(
    await message.evaluate((element: HTMLTextAreaElement) => [
      document.activeElement === element,
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([true, 2, 9]);
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "windows",
  );
  await preview.setViewportSize({ width: 1040, height: 700 });
  await expect(preview.locator(".environment-content")).toHaveCSS(
    "height",
    "700px",
  );
  await expect(message).toHaveValue("A thought across screen sizes");
  await expect(
    preview.getByText("Keyboard occlusion", { exact: true }),
  ).toHaveCount(0);
  await fits(preview);
});

test("all proposal scenarios are selectable and reset without touching real services", async ({
  page,
}) => {
  const preview = await open(page, "navigation-chat");
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  for (const value of [
    "navigation-chat",
    "navigation-dashboard",
    "navigation-draft",
    "navigation-empty",
    "files-read",
    "files-source",
    "files-chat",
    "files-history",
    "files-save-error",
    "files-empty",
  ]) {
    await scenario(page, value);
    await expect(
      preview.locator(
        value.startsWith("files-") ? ".editor-workspace" : ".navigation-view",
      ),
    ).toBeVisible();
    await expect(
      page.getByLabel("Workspace examples", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Action result", { exact: true })).toHaveCount(
      0,
    );
    await fits(preview);
  }
  await scenario(page, "navigation-draft");
  await preview
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Changed draft");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Help me prepare for the workshop.");
  expect(errors).toEqual([]);
});

test("source edits autosave, protect IDs, survive reconnection and recover from save failure", async ({
  page,
}) => {
  const preview = await open(page, "files-source");
  const source = preview.getByRole("textbox", {
    name: "Markdown source",
    exact: true,
  });
  const initial = await source.inputValue();
  await source.fill(`${initial}\nA retained browser draft.\n`);
  await expect(preview.locator(".save-state")).toHaveText("Saved");
  await preview.reload();
  await expect(source).toHaveValue(`${initial}\nA retained browser draft.\n`);
  await source.fill(
    (await source.inputValue()).replace(/^id:.*$/m, "id: changed"),
  );
  await expect(preview.getByRole("dialog")).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(source).toHaveValue(`${initial}\nA retained browser draft.\n`);
  await scenario(page, "files-save-error");
  await expect(preview.locator(".save-state")).toContainText("Couldn’t save");
  await page
    .getByLabel("Simulate an automatic-save failure", { exact: true })
    .uncheck();
  await expect(preview.locator(".save-state")).toHaveText("Saved");
});

test("file history is read-only and file chat keeps an attachment and draft", async ({
  page,
}) => {
  const preview = await open(page, "files-history");
  await expect(
    preview.getByText("Earlier version", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByLabel("Version differences", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveCount(0);
  await scenario(page, "files-chat");
  await preview.setViewportSize({ width: 390, height: 844 });
  const message = preview.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await message.fill("Discuss this note");
  await expect(preview.locator(".attachment-chip")).toHaveCount(1);
  await preview.locator(".attachment-link").click();
  await expect(
    preview.getByRole("heading", { name: "outline.md", exact: true }),
  ).toBeVisible();
  await preview.getByRole("tab", { name: "New chat", exact: true }).click();
  await expect(message).toHaveValue("Discuss this note");
  await preview
    .getByRole("button", { name: "Close pane — New chat", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(message).toHaveValue("Discuss this note");
  await fits(preview);
});

test("file actions target the selected item without discarding another file’s draft", async ({
  page,
}) => {
  const preview = await open(page, "files-source");
  const source = preview.getByRole("textbox", {
    name: "Markdown source",
    exact: true,
  });
  const draft = `${await source.inputValue()}\nKeep working here.\n`;
  await source.fill(draft);
  await preview
    .getByRole("button", { name: "Actions for preparation.md", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await expect(
    page.getByText("Current screen: Rename file", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Simulate an automatic-save failure", { exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("agenda.md");
  await preview.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "Actions for agenda.md", exact: true }),
  ).toBeVisible();
  await expect(source).toHaveValue(draft);
  await preview
    .getByRole("button", { name: "Actions for agenda.md", exact: true })
    .click();
  await preview
    .getByRole("menuitem", { name: "Duplicate…", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Create copy", exact: true })
    .click();
  await expect(
    preview.getByRole("button", {
      name: "Actions for agenda-copy.md",
      exact: true,
    }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Actions for agenda-copy.md", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Delete…", exact: true }).click();
  await preview
    .getByRole("button", { name: "Delete file", exact: true })
    .click();
  await expect(
    preview.getByRole("button", {
      name: "Actions for agenda-copy.md",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(source).toHaveValue(draft);
});

test("editor dialogs are directly selectable and fit mobile keyboard space", async ({
  page,
}) => {
  const preview = await open(page, "files-read", "&profile=ios");
  await preview.setViewportSize({ width: 390, height: 844 });
  await selectOption(
    page.getByRole("combobox", { name: "Dialog", exact: true }),
    "name",
  );
  await expect(
    preview.getByRole("dialog", { name: "New file", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("mobile-note.md");
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  const box = await preview.getByRole("dialog").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(59);
  expect(box!.y + box!.height).toBeLessThanOrEqual(550);
  await expect(
    preview.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("mobile-note.md");
  await preview
    .getByRole("button", { name: "Create file", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "mobile-note.md", exact: true }),
  ).toBeVisible();
  await selectOption(
    page.getByRole("combobox", { name: "Dialog", exact: true }),
    "delete",
  );
  await expect(
    preview.getByRole("dialog", { name: "Delete this file?", exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Keep file", exact: true }).click();
  await fits(preview);
});

test("mobile workspace dialogs and app navigation stay inside simulated content bounds", async ({
  page,
}) => {
  const preview = await open(page, "navigation-chat", "&profile=ios");
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const drawer = preview.locator(".navigation-drawer");
  await expect(drawer).toBeVisible();
  const bounds = await drawer.boundingBox();
  expect(bounds?.y).toBe(59);
  expect(bounds?.height).toBe(751);
  await preview.keyboard.press("Escape");
  await scenario(page, "remove");
  const dialog = preview.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(59);
  expect(box!.y + box!.height).toBeLessThanOrEqual(810);
});
