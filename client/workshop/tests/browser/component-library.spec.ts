import { expect, test, type Page } from "./test";
import { chooseSelect } from "./select";
import {
  expectDialogTitle,
  expectDialogBody,
  expectDialogSection,
} from "./dialog-typography";
import { catalogComponents } from "../../src/component-library/model";

async function open(page: Page, state = "ready") {
  await page.goto(`/?workshop=controls&scenario=components-${state}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", { name: "Component library", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

test("renders every library component and follows example actions, recovery and reset", async ({
  page,
}, info) => {
  const preview = await open(page);
  await expect(page.locator("select:not([hidden])")).toHaveCount(0);
  await expect(preview.locator("select:not([hidden])")).toHaveCount(0);
  expect(
    await preview
      .locator("[data-component]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-component")).sort(),
      ),
  ).toEqual([...catalogComponents].sort());
  for (const label of ["Save", "Remove"]) {
    const contrast = await preview
      .getByRole("button", { name: label, exact: true })
      .evaluate((button) => {
        const style = getComputedStyle(button);
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map((value) => {
              const channel = Number(value) / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return (
            channels[0]! * 0.2126 +
            channels[1]! * 0.7152 +
            channels[2]! * 0.0722
          );
        };
        const values = [
          luminance(style.color),
          luminance(style.backgroundColor),
        ].sort((a, b) => a - b);
        return (values[1]! + 0.05) / (values[0]! + 0.05);
      });
    expect(contrast, `${label} text contrast`).toBeGreaterThanOrEqual(4.5);
  }
  await expect(
    page.getByLabel("Workspace examples", { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByLabel("Example state", { exact: true }),
  ).toHaveCount(0);
  for (const group of ["actions", "fields", "feedback", "layout"]) {
    await preview
      .locator(`#library-${group}`)
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await preview.screenshot({
      path: info.outputPath(`components-${group}.png`),
    });
  }
  await preview.getByLabel("Name", { exact: true }).fill("");
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await expect(preview.getByLabel("Name", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByLabel("Example state", { exact: true }),
  ).toHaveAttribute("data-value", "error");
  await preview.getByLabel("Name", { exact: true }).fill("A note to keep");
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(preview.getByLabel("Name", { exact: true })).not.toHaveAttribute(
    "aria-describedby",
    /error/,
  );
  await page
    .getByRole("button", { name: "Fail example action", exact: true })
    .click();
  await preview.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete example action", exact: true })
    .click();
  await expect(
    preview
      .getByRole("status")
      .filter({ hasText: "Your changes have been saved." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByLabel("Name", { exact: true })).toHaveValue(
    "Community garden",
  );
  await expect(
    page.getByLabel("Example state", { exact: true }),
  ).toHaveAttribute("data-value", "ready");
  await chooseSelect(
    page.getByLabel("Starting state", { exact: true }),
    "components-disabled",
  );
  await expect(
    preview.getByLabel("Search notes", { exact: true }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await chooseSelect(
    page.getByLabel("Starting state", { exact: true }),
    "components-empty",
  );
  await expect(
    preview
      .getByRole("region", { name: "Example note collection" })
      .getByText("No notes yet"),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Create a note", exact: true })
    .click();
  await expect(
    preview
      .getByRole("region", { name: "Example note collection" })
      .locator("li"),
  ).toHaveCount(12);
});

test("controls use a keyboard-accessible sheet in a narrow window", async ({
  page,
}, info) => {
  const preview = await open(page);
  await page.setViewportSize({ width: 320, height: 568 });
  const state = page.getByRole("combobox", {
    name: "Example state",
    exact: true,
  });
  await state.click();
  const dialog = page.getByRole("dialog", {
    name: "Example state",
    exact: true,
  });
  await expect(dialog).toHaveClass(/select-sheet/);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  expect(box!.y + box!.height).toBeLessThanOrEqual(569);
  await page.screenshot({ path: info.outputPath("controls-choice-sheet.png") });
  const list = dialog.getByRole("listbox", {
    name: "Example state",
    exact: true,
  });
  await list.press("End");
  await list.press("Enter");
  await expect(state).toHaveAttribute("data-value", "success");
  await expect(state).toBeFocused();
  await expect(
    preview
      .getByRole("status")
      .filter({ hasText: "Your changes have been saved." }),
  ).toBeVisible();
});

test("choices, select, dialog focus and resize remain keyboard accessible", async ({
  page,
  browserName,
}) => {
  const preview = await open(page);
  await preview.getByLabel("Include archived notes", { exact: true }).check();
  await expect(
    preview.getByLabel("Include archived notes", { exact: true }),
  ).toBeChecked();
  await preview.getByLabel("Oldest first", { exact: true }).check();
  await expect(
    preview.getByLabel("Newest first", { exact: true }),
  ).not.toBeChecked();
  const select = preview.getByRole("combobox", {
    name: "Collection",
    exact: true,
  });
  await select.focus();
  await select.press("Enter");
  await expect(
    preview.getByRole("dialog", { name: "Collection", exact: true }),
  ).not.toHaveClass(/select-sheet/);
  await expect(
    preview.getByRole("option", { name: "Archive (unavailable)", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await preview
    .getByRole("listbox", { name: "Collection", exact: true })
    .getByRole("option", { name: "Reading room", exact: true })
    .click();
  await expect(select).toContainText("Reading room");
  const trigger = preview.getByRole("button", {
    name: "Open dialog",
    exact: true,
  });
  await trigger.click();
  const dialog = preview.getByRole("dialog", {
    name: "Keep these notes?",
    exact: true,
  });
  await expectDialogTitle(
    dialog.getByRole("heading", { name: "Keep these notes?", exact: true }),
  );
  await expectDialogBody(dialog.locator("#example-dialog-description"));
  await expectDialogSection(
    dialog.getByRole("heading", { name: "Notes to keep", exact: true }),
  );
  await expect(dialog.locator("[data-dialog-help]")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(dialog.locator("[data-dialog-help]")).toHaveCSS(
    "line-height",
    "21px",
  );
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press(
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(
    dialog.getByRole("button", { name: "Keep notes", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Keep notes", exact: true }).click();
  await expect(preview.getByText("Notes kept.", { exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
  const divider = preview.getByRole("separator", {
    name: "Resize note collection",
    exact: true,
  });
  await divider.focus();
  await divider.press("ArrowDown");
  await expect(divider).toHaveCSS("outline-width", "3px");
  await expect(divider).toHaveCSS("outline-offset", "-3px");
  await expect(divider).toHaveAttribute("aria-valuenow", "168");
  await divider.press("Enter");
  await expect(divider).toHaveAttribute("aria-valuenow", "160");
});

test("extended controls retain selection, focus, dismissal and reset", async ({
  page,
}, info) => {
  const preview = await open(page);
  const reminders = preview.getByRole("switch", {
    name: "Show reminders",
    exact: true,
  });
  await expect(reminders).toBeChecked();
  await reminders.focus();
  await reminders.press("Space");
  await expect(reminders).not.toBeChecked();
  const filter = preview.getByRole("button", {
    name: "Remove Garden filter",
    exact: true,
  });
  await filter.focus();
  await filter.press("Enter");
  await expect(filter).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Add Garden filter", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Add Garden filter", exact: true })
    .click();
  const disclosure = preview.locator(
    '[data-component="SituateDisclosure"] summary',
  );
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(
    preview.locator('[data-component="SituateDisclosure"] details'),
  ).toHaveAttribute("open", "");
  const menuTrigger = preview.getByRole("button", {
    name: "Note actions",
    exact: true,
  });
  await menuTrigger.click();
  const menu = preview.getByRole("menu", { name: "Note actions", exact: true });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Add to reading list", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemcheckbox")).toBeFocused();
  await preview.keyboard.press("Space");
  await expect(menu).not.toBeVisible();
  await expect(menuTrigger).toBeFocused();
  await menuTrigger.click();
  await expect(menu.getByRole("menuitemcheckbox")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await preview.screenshot({ path: info.outputPath("components-menu.png") });
  await preview.keyboard.press("Escape");
  await expect(menuTrigger).toBeFocused();
  const popoverTrigger = preview.getByRole("button", {
    name: "About this collection",
    exact: true,
  });
  await popoverTrigger.click();
  await expect(preview.locator("#example-popover")).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(popoverTrigger).toBeFocused();
  const tooltipTrigger = preview.getByRole("button", {
    name: "About reminders",
    exact: true,
  });
  await tooltipTrigger.focus();
  await expect(preview.getByRole("tooltip")).toHaveText(
    "Reminders appear beside the notes you choose to revisit.",
  );
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("tooltip")).toHaveCount(0);
  await expect(tooltipTrigger).toBeFocused();
  await expect(
    preview.getByRole("progressbar", { name: "Notes prepared" }),
  ).toHaveAttribute("aria-valuenow", "3");
  await chooseSelect(
    page.getByLabel("Example state", { exact: true }),
    "loading",
  );
  await expect(
    preview.getByRole("progressbar", { name: "Notes prepared" }),
  ).not.toHaveAttribute("aria-valuenow");
  await page
    .getByRole("button", { name: "Complete example action", exact: true })
    .click();
  await expect(
    preview.getByRole("progressbar", { name: "Notes prepared" }),
  ).toHaveAttribute("aria-valuenow", "5");
  await menuTrigger.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(menu).not.toBeVisible();
  await expect(reminders).toBeChecked();
  await expect(
    preview.locator('[data-component="SituateDisclosure"] details'),
  ).not.toHaveAttribute("open");
  await expect(filter).toBeVisible();
  await chooseSelect(
    page.getByLabel("Example state", { exact: true }),
    "disabled",
  );
  await expect(reminders).toBeDisabled();
  await expect(filter).toBeDisabled();
  await expect(menuTrigger).toBeDisabled();
});

for (const width of [1280, 320]) {
  test(`fits ${width}px with long content, constrained containers and preserved drafts`, async ({
    page,
  }, info) => {
    const preview = await open(page);
    await preview.setViewportSize({ width, height: width === 320 ? 568 : 800 });
    await preview
      .getByLabel("Notes", { exact: true })
      .fill("Keep this draft during resizing");
    await page.getByLabel("Long labels and content", { exact: true }).check();
    await chooseSelect(
      page.getByLabel("Example width", { exact: true }),
      "compact",
    );
    await chooseSelect(
      page.getByLabel("Platform profile", { exact: true }),
      "ios",
    );
    await page.getByLabel("Keyboard occlusion", { exact: true }).check();
    await expect(preview.getByLabel("Notes", { exact: true })).toHaveValue(
      "Keep this draft during resizing",
    );
    const picker = preview.getByRole("combobox", {
      name: "Collection",
      exact: true,
    });
    await picker.click();
    const choices = preview.getByRole("dialog", {
      name: "Collection",
      exact: true,
    });
    await expect(choices).toHaveClass(/select-sheet/);
    const sheet = await choices.boundingBox();
    const area = await preview.locator(".environment-content").boundingBox();
    expect(sheet).not.toBeNull();
    expect(area).not.toBeNull();
    expect(sheet!.x).toBeGreaterThanOrEqual(area!.x - 1);
    expect(sheet!.y).toBeGreaterThanOrEqual(area!.y - 1);
    expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(
      area!.x + area!.width + 1,
    );
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(
      area!.y + area!.height + 1,
    );
    await preview.screenshot({
      path: info.outputPath(`collection-sheet-${width}.png`),
    });
    await preview.keyboard.press("Escape");
    await expect(choices).not.toBeVisible();
    await expect(picker).toBeFocused();
    await expect(picker).toHaveAttribute("data-value", "garden");
    const menuTrigger = preview.getByRole("button", {
      name: "Note actions",
      exact: true,
    });
    await menuTrigger.click();
    const menu = preview.getByRole("menu", {
      name: "Note actions",
      exact: true,
    });
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(area!.x - 1);
    expect(menuBox.y).toBeGreaterThanOrEqual(area!.y - 1);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
      area!.x + area!.width + 1,
    );
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(
      area!.y + area!.height + 1,
    );
    await preview.screenshot({
      path: info.outputPath(`components-menu-${width}.png`),
    });
    await preview.keyboard.press("Escape");
    await expect(menuTrigger).toBeFocused();
    await page.getByLabel("Keyboard occlusion", { exact: true }).uncheck();
    await expect(preview.locator(".component-library")).toHaveClass(/compact/);
    await expect
      .poll(() =>
        preview
          .locator(".component-library")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await expect
      .poll(() =>
        preview
          .locator(".library-example")
          .evaluateAll((nodes) =>
            nodes.every((node) => node.scrollWidth <= node.clientWidth),
          ),
      )
      .toBe(true);
    await preview.locator(".component-library").evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.screenshot({
      path: info.outputPath(`components-${width}.png`),
    });
    await preview
      .getByRole("button", { name: "Open dialog", exact: true })
      .click();
    const dialog = preview.getByRole("dialog", { name: /Community garden/ });
    await expect(dialog).toBeVisible();
    await expectDialogTitle(dialog.getByRole("heading", { level: 2 }));
    await expectDialogSection(dialog.getByRole("heading", { level: 3 }));
    await dialog.evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.screenshot({
      path: info.outputPath(`dialog-hierarchy-${width}.png`),
    });
    await preview.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Keep notes", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Keep notes", exact: true }),
    ).toBeVisible();
    await preview.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(preview.getByLabel("Notes", { exact: true })).toHaveValue(
      "Check which herbs grow well near the east fence.",
    );
  });
}
