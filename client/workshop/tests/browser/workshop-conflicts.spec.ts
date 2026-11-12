import { expect, test, type BrowserContext, type Page } from "./test";
import {
  expectDialogTitle,
  expectDialogBody,
  expectDialogSection,
} from "./dialog-typography";

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

async function open(controls: Page, scene = "files-conflict", profile = "mac") {
  await controls.goto(
    `/?workshop=controls&scenario=${scene}&profile=${profile}`,
  );
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(
    controls.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".editor-workspace")).toBeVisible();
  return preview;
}
const review = (page: Page) =>
  page.getByRole("dialog", { name: "Review versions", exact: true });
const source = (page: Page, choice: "editor" | "file") =>
  page.locator(`[data-source="${choice}"]`);
const choose = (page: Page, choice: "editor" | "file") =>
  page
    .getByRole("radio", {
      name: choice === "editor" ? "Use editor text" : "Use changed file",
      exact: true,
    })
    .check();
const apply = (page: Page) =>
  page.getByRole("button", { name: "Apply selected version", exact: true });
const complete = (controls: Page) =>
  controls
    .getByRole("button", { name: "Complete application", exact: true })
    .click();

test("complete sources, explicit whole-file choice, dismissal, focus trapping and local application", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 1200, height: 900 });
  await expect(review(preview)).toBeVisible();
  await expectDialogTitle(review(preview).getByRole("heading", { level: 2 }));
  await expectDialogBody(
    review(preview).locator(".conflict-layout > header > p").last(),
  );
  await expectDialogSection(
    review(preview).getByRole("heading", { level: 3 }).first(),
  );
  await expect(
    review(preview).getByRole("heading", { level: 2 }),
  ).toBeFocused();
  await expect(apply(preview)).toBeDisabled();
  for (const choice of ["editor", "file"] as const) {
    await expect(source(preview, choice)).toContainText("kind: note");
    await expect(source(preview, choice)).toContainText(
      "without having the answer ready.",
    );
    expect(
      await source(preview, choice).evaluate(
        (el) => el.scrollHeight > el.clientHeight,
      ),
    ).toBe(true);
  }
  await expect(source(preview, "file")).toHaveCSS("font-size", "14px");
  expect(
    await source(preview, "file").evaluate(
      (node) => getComputedStyle(node).fontFamily,
    ),
  ).not.toBe(
    await review(preview).evaluate((node) => getComputedStyle(node).fontFamily),
  );
  await expect(review(preview).locator("[data-dialog-help]").first()).toHaveCSS(
    "font-size",
    "14px",
  );
  const expected = await source(preview, "file").textContent();
  await choose(preview, "file");
  await expect(review(preview)).toContainText(
    "Changes only in the editor text will not be included.",
  );
  await apply(preview).focus();
  await preview.keyboard.press("Tab");
  await expect(
    preview.getByRole("button", { name: "Close version review" }),
  ).toBeFocused();
  await preview.keyboard.press("Shift+Tab");
  await expect(apply(preview)).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(review(preview)).not.toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Review versions", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Review versions", exact: true })
    .click();
  await expect(
    preview.getByRole("radio", { name: "Use changed file", exact: true }),
  ).toBeChecked();
  await apply(preview).click();
  await expect(apply(preview)).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("radio", { name: "Use changed file", exact: true }),
  ).toBeDisabled();
  await expect(review(preview)).toContainText("Not saved yet");
  await complete(page);
  await expect(review(preview)).not.toBeVisible();
  await expect(preview.locator(".document-heading h3")).toBeFocused();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await expect(
    preview.getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveValue(expected!);
  await expect(preview.locator(".conflict-retained")).toContainText(
    "Changed file saved locally. Conflict resolved.",
  );
  await expect(preview.locator("iframe")).toHaveCount(0);
});

test("failure retains choice; retry can be hidden, reopened and completed without duplicate application", async ({
  page,
}) => {
  const preview = await open(page, "files-conflict-failure");
  await choose(preview, "editor");
  await apply(preview).click();
  await complete(page);
  const retry = preview.getByRole("button", {
    name: "Retry selected version",
    exact: true,
  });
  await expect(retry).toBeFocused();
  await expect(review(preview)).toContainText("could not be written");
  await expect(
    preview.getByRole("radio", { name: "Use editor text", exact: true }),
  ).toBeChecked();
  await retry.click();
  await preview
    .getByRole("button", { name: "Hide for now", exact: true })
    .click();
  await expect(preview.locator(".conflict-retained")).toContainText(
    "Not saved yet",
  );
  await preview
    .getByRole("button", { name: "Review versions", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await preview
    .getByRole("button", { name: "Hide for now", exact: true })
    .click();
  const filter = preview.getByRole("searchbox", {
    name: "Filter files by name",
  });
  await filter.focus();
  await complete(page);
  await expect(filter).toBeFocused();
  await expect(preview.locator(".conflict-retained")).toContainText(
    "Editor text saved locally. Conflict resolved.",
  );
});

test("stale revisions clear choices and manual refresh replaces only the changed candidate", async ({
  page,
}) => {
  const preview = await open(page, "files-conflict-race");
  const previous = await source(preview, "file").textContent();
  await choose(preview, "editor");
  await apply(preview).click();
  await complete(page);
  await expect(review(preview)).toContainText("copies below are out of date");
  await expect(review(preview).locator("input:checked")).toHaveCount(0);
  await expect(apply(preview)).toBeDisabled();
  await expect(source(preview, "file")).toHaveText(previous!);
  await preview
    .getByRole("button", { name: "Refresh versions", exact: true })
    .click();
  await expect(review(preview)).toContainText("Checking updated versions");
  await page
    .getByRole("button", { name: "Change file again", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete refresh", exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Refresh versions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete refresh", exact: true })
    .click();
  await expect(source(preview, "file")).toContainText("Latest file update 3");
  await expect(
    review(preview).getByRole("heading", { level: 2 }),
  ).toBeFocused();
  await expect(review(preview).locator("input:checked")).toHaveCount(0);
  await choose(preview, "file");
  await preview
    .getByRole("button", { name: "Decide later", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Change file again", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Review versions", exact: true })
    .click();
  await expect(review(preview).locator("input:checked")).toHaveCount(0);
});

for (const profile of ["ios", "android"]) {
  test(`${profile}: inspection is not selection and each source retains its own scroll`, async ({
    page,
  }) => {
    const preview = await open(page, "files-conflict", profile);
    await preview.setViewportSize({ width: 390, height: 844 });
    await expect(source(preview, "editor")).toBeVisible();
    await expect(source(preview, "file")).not.toBeVisible();
    await source(preview, "editor").evaluate((el) => {
      el.scrollTop = 70;
    });
    await expect
      .poll(() => source(preview, "editor").evaluate((el) => el.scrollTop))
      .toBe(70);
    await preview
      .getByRole("button", { name: "Inspect changed file", exact: true })
      .click();
    await source(preview, "file").evaluate((el) => {
      el.scrollTop = 140;
    });
    await expect
      .poll(() => source(preview, "file").evaluate((el) => el.scrollTop))
      .toBe(140);
    await preview
      .getByRole("button", { name: "Inspect editor text", exact: true })
      .click();
    await expect
      .poll(() => source(preview, "editor").evaluate((el) => el.scrollTop))
      .toBe(70);
    await preview
      .getByRole("button", { name: "Inspect changed file", exact: true })
      .click();
    await expect
      .poll(() => source(preview, "file").evaluate((el) => el.scrollTop))
      .toBe(140);
    await expect(review(preview).locator("input:checked")).toHaveCount(0);
    await expect(apply(preview)).toBeDisabled();
    await preview.reload();
    await expect(source(preview, "file")).toBeVisible();
    await expect
      .poll(() => source(preview, "file").evaluate((el) => el.scrollTop))
      .toBe(140);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await choose(preview, "file");
    await apply(preview).click();
    await complete(page);
    await expect(review(preview)).not.toBeVisible();
  });
}

test("automatic merges are silent and preserve reading/source focus, selection, scroll and committed history", async ({
  page,
}) => {
  const preview = await open(page, "files-merged");
  await preview.setViewportSize({ width: 1200, height: 700 });
  const merge = page.getByRole("button", {
    name: "Simulate automatic merge",
    exact: true,
  });
  const markdown = preview.locator(".markdown");
  await markdown.focus();
  await preview.locator(".document-scroll").evaluate((el) => {
    el.scrollTop = 120;
  });
  const readScroll = await preview
    .locator(".document-scroll")
    .evaluate((el) => el.scrollTop);
  await merge.click();
  await expect(markdown).toContainText(
    "A spare notebook is ready for each pair.",
  );
  await expect(markdown).toBeFocused();
  expect(
    await preview.locator(".document-scroll").evaluate((el) => el.scrollTop),
  ).toBe(readScroll);
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  const input = preview.getByRole("textbox", {
    name: "Markdown source",
    exact: true,
  });
  const before = await input.inputValue();
  await input.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(22, 30, "backward");
    el.scrollTop = 80;
  });
  const position = await input.evaluate((el: HTMLTextAreaElement) => [
    el.selectionStart,
    el.selectionEnd,
    el.selectionDirection,
    el.scrollTop,
  ]);
  await merge.click();
  await expect(input).toHaveValue(
    before + "\nA spare notebook is ready for each pair.\n",
  );
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.selectionEnd,
      el.selectionDirection,
      el.scrollTop,
    ]),
  ).toEqual(position);
  await expect(preview.locator(".conflict-retained")).toHaveCount(0);
  await expect(review(preview)).not.toBeVisible();
  await page
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  await expect(preview.locator(".version")).toHaveCount(5);
  await preview.locator(".version").nth(1).click();
  const historical = await preview.locator(".diff-view").textContent();
  await merge.click();
  await expect(preview.locator(".diff-view")).toHaveText(historical!);
  await preview.reload();
  await expect(preview.locator(".diff-view")).toHaveText(historical!);
  await preview
    .getByRole("button", { name: "Back to current", exact: true })
    .click();
  await expect(input).toHaveValue(
    before + "\nA spare notebook is ready for each pair.\n".repeat(2),
  );
  await preview
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "preparation.md", exact: true })
    .click();
  const unrelated = await markdown.textContent();
  await merge.click();
  await expect(markdown).toHaveText(unrelated!);
  await expect(preview.locator(".document-heading h3")).toHaveText(
    "preparation.md",
  );
});

for (const profile of ["mac", "windows", "kde"]) {
  test(`${profile}: review stays inside the app and remains usable with enlarged text`, async ({
    page,
  }) => {
    const preview = await open(page, "files-conflict", profile);
    await preview.setViewportSize({ width: 1200, height: 800 });
    await expect(async () => {
      const app = await preview.locator(".editor-workspace").boundingBox();
      const dialog = await review(preview).boundingBox();
      expect(app!.width).toBeGreaterThan(0);
      expect(dialog!.x).toBeGreaterThanOrEqual(app!.x);
      expect(dialog!.y).toBeGreaterThanOrEqual(app!.y);
      expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(
        app!.x + app!.width,
      );
      expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(
        app!.y + app!.height,
      );
    }).toPass();
    await preview.setViewportSize({ width: 640, height: 480 });
    await preview.locator("html").evaluate((el) => {
      el.style.fontSize = "200%";
    });
    await choose(preview, "editor");
    await apply(preview).click();
    await complete(page);
    await expect(review(preview)).not.toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("mobile automatic merge preserves source focus through keyboard occlusion", async ({
  page,
}) => {
  const preview = await open(page, "files-merged", "ios");
  await preview.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  const input = preview.getByRole("textbox", {
    name: "Markdown source",
    exact: true,
  });
  await input.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(22, 30);
  });
  const before = await input.inputValue();
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  await page
    .getByRole("button", { name: "Simulate automatic merge", exact: true })
    .click();
  await expect(input).toHaveValue(
    before + "\nA spare notebook is ready for each pair.\n",
  );
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]),
  ).toEqual([22, 30]);
  await expect(preview.locator(".conflict-retained")).toHaveCount(0);
});

test("reset cancels a pending application and restores unselected review", async ({
  page,
}) => {
  const preview = await open(page);
  await choose(preview, "file");
  await apply(preview).click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(review(preview).locator("input:checked")).toHaveCount(0);
  await expect(apply(preview)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Complete application", exact: true }),
  ).toHaveCount(0);
  await expect(source(preview, "file")).not.toContainText("Latest file update");
});
