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

const topPressShadow = /0px 3px 2px -1px inset/;

test("buttons acknowledge a press without moving the target or committing early", async ({
  page,
}, info) => {
  const preview = await open(page);
  const actions = preview.locator("#library-actions");
  const count = actions.locator("[data-component='SituateIconButton'] output");
  const button = actions.getByRole("button", { name: "Cancel", exact: true });
  const iconButton = actions
    .getByRole("button", { name: "Add to collection", exact: true })
    .first();
  const icon = iconButton.locator("svg");

  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await button.hover();
  const buttonBounds = await button.boundingBox();
  const hoverFill = await button.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await preview.mouse.down();
  await expect(button).toHaveCSS("background-color", hoverFill);
  await expect(button).toHaveCSS("box-shadow", topPressShadow);
  expect(await button.boundingBox()).toEqual(buttonBounds);
  await expect(count).toHaveText("Actions taken: 0");
  await preview.screenshot({ path: info.outputPath("button-pressed.png") });
  await preview.mouse.up();
  await expect(count).toHaveText("Actions taken: 1");
  await expect(button).toHaveCSS("box-shadow", "none");

  await button.hover();
  await preview.mouse.down();
  await preview.mouse.move(0, 0);
  await preview.mouse.up();
  await expect(count).toHaveText("Actions taken: 1");

  const filter = preview.getByRole("button", { name: "Remove Garden filter" });
  await filter.hover();
  await preview.mouse.down();
  await expect(filter.getByText("×")).toHaveCSS("translate", "0px 1px");
  await expect(filter).toHaveCSS("box-shadow", topPressShadow);
  await preview.mouse.up();
  await expect(filter).toHaveCount(0);

  await iconButton.hover();
  const iconButtonBounds = await iconButton.boundingBox();
  await preview.mouse.down();
  await expect(icon).toHaveCSS("translate", "0px 1px");
  expect(await iconButton.boundingBox()).toEqual(iconButtonBounds);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(icon).toHaveCSS("translate", "none");
  await expect(iconButton).toHaveCSS("box-shadow", topPressShadow);
  await expect(iconButton).toHaveCSS("transition-duration", "0s");
  await preview.mouse.up();
  await expect(count).toHaveText("Actions taken: 2");

  await button.focus();
  await preview.keyboard.down("Space");
  await expect(button).toBeFocused();
  await expect(count).toHaveText("Actions taken: 2");
  await expect(button).toHaveCSS("box-shadow", /inset/);
  await preview.keyboard.up("Space");
  await expect(count).toHaveText("Actions taken: 3");
});

test("styled buttons share a pressed edge without replacing their colors", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  const actions = preview.locator("#library-actions");
  const readAppearance = (element: Element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      text: style.color,
      shadow: style.boxShadow,
    };
  };
  let edge: string | undefined;
  for (const label of [
    "Cancel",
    "Save",
    "More",
    "Remove",
    "Add tag",
    "Note actions",
  ]) {
    const button = actions.getByRole("button", { name: label, exact: true });
    await button.hover();
    const hovered = await button.evaluate(readAppearance);
    await preview.mouse.down();
    const appearance = await button.evaluate(readAppearance);
    expect(appearance, label).toEqual({
      ...hovered,
      shadow: expect.stringMatching(topPressShadow),
    });
    edge ??= appearance.shadow;
    expect(appearance.shadow, label).toBe(edge);
    await expect(button).toHaveCSS("transition-duration", "0s");
    await preview.mouse.move(0, 0);
    await preview.mouse.up();
  }

  const plain = actions.getByRole("button", {
    name: "Read details",
    exact: true,
  });
  await plain.hover();
  const hovered = await plain.evaluate(readAppearance);
  await preview.mouse.down();
  expect(await plain.evaluate(readAppearance)).toEqual(hovered);
  await preview.mouse.move(0, 0);
  await preview.mouse.up();
});

test("the button edge builds during a hold and quick clicks execute immediately", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  const cancel = preview.getByRole("button", { name: "Cancel", exact: true });
  await cancel.hover();
  await expect(cancel).toHaveCSS("transition-duration", "0.08s");
  await preview.mouse.down();
  await expect(cancel).toHaveCSS("transition-duration", "0.1s");
  await preview.mouse.move(0, 0);
  await preview.mouse.up();

  const slowMotion = await preview.addStyleTag({
    content:
      "#library-actions .situate-button:active { transition-duration: 10s !important; }",
  });
  await cancel.hover();
  const idle = await cancel.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  await preview.mouse.down();
  const [early, held] = await cancel.evaluate((element) => {
    const style = getComputedStyle(element);
    void style.boxShadow;
    const edge = element
      .getAnimations()
      .find(
        (animation) =>
          animation instanceof CSSTransition &&
          animation.transitionProperty === "box-shadow",
      )!;
    edge.pause();
    return [3000, 10000].map((time) => {
      edge.currentTime = time;
      return style.boxShadow;
    });
  });
  expect(early).not.toBe(idle);
  expect(early).not.toBe(held);
  expect(held).toMatch(topPressShadow);
  await preview.mouse.move(0, 0);
  await preview.mouse.up();
  await slowMotion.evaluate((element) =>
    element.parentNode?.removeChild(element),
  );
  await expect(cancel).toHaveCSS("box-shadow", "none");

  await cancel.click();
  await expect(
    preview.locator('[data-component="SituateIconButton"] output'),
  ).toHaveText("Actions taken: 1");
});

test("state changes are immediate while indicators settle, with or without motion", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  const reminders = preview.getByRole("switch", { name: "Show reminders" });
  const thumb = () =>
    reminders.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return { left: style.left, duration: style.transitionDuration };
    });
  await expect.poll(thumb).toEqual({ left: "20px", duration: "0.16s" });
  await reminders.press("Space");
  await expect(reminders).not.toBeChecked();
  await expect.poll(thumb).toEqual({ left: "4px", duration: "0.16s" });

  const disclosure = preview.locator('[data-component="SituateDisclosure"]');
  const chevron = disclosure.locator("svg");
  await disclosure.locator("summary").press("Enter");
  await expect(disclosure.locator("p")).toBeVisible();
  await expect(chevron).toHaveCSS("rotate", "0deg");
  await expect(chevron).toHaveCSS("transition-duration", "0.16s");
  await preview.screenshot({ path: info.outputPath("open-disclosure.png") });

  const select = preview.locator(
    '[data-component="SituateSelect"] .situate-select-trigger',
  );
  const selectChevron = select.locator("svg");
  await select.click();
  await expect(preview.getByRole("listbox")).toBeVisible();
  await expect(selectChevron).toHaveCSS("rotate", "180deg");
  await preview.keyboard.press("ArrowDown");
  await expect(
    preview.getByRole("option", { name: "Garden journal" }),
  ).toHaveAttribute("aria-selected", "true");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(selectChevron).toHaveCSS("transition-duration", "0s");
  await expect(chevron).toHaveCSS("transition-duration", "0s");
  await expect.poll(thumb).toEqual({ left: "4px", duration: "0s" });
  await preview.keyboard.press("Escape");
  await expect(select).toBeFocused();

  await preview.emulateMedia({ reducedMotion: "no-preference" });
  const progress = preview.getByRole("progressbar", { name: "Notes prepared" });
  const fill = progress.locator("span");
  await expect(fill).toHaveCSS("transition-duration", "0.16s");
  await chooseSelect(
    page.getByLabel("Example state", { exact: true }),
    "success",
  );
  await expect(progress).toHaveAttribute("aria-valuenow", "5");
  await expect(fill).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(fill).toHaveCSS("transition-duration", "0s");
});

test("anchored help settles from the trigger while menus and dialog content remain still", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  const trigger = preview.getByRole("button", {
    name: "About this collection",
  });
  const popup = preview.getByRole("dialog", { name: "About this collection" });
  for (const [block, direction] of [
    ["start", "-3px"],
    ["end", "3px"],
  ] as const) {
    await trigger.evaluate(
      (element, block) => element.scrollIntoView({ block }),
      block,
    );
    await trigger.click();
    await expect(popup.getByRole("button")).toBeFocused();
    await expect(popup).toHaveCSS("animation-duration", "0.16s");
    expect(
      await popup.evaluate((element) =>
        element.style.getPropertyValue("--popover-approach"),
      ),
    ).toBe(direction);
    await popup.screenshot({ path: info.outputPath(`popover-${block}.png`) });
    await preview.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }

  const menuTrigger = preview.getByRole("button", { name: "Note actions" });
  await menuTrigger.hover();
  const triggerHover = await menuTrigger.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await preview.mouse.down();
  await expect(menuTrigger).toHaveCSS("background-color", triggerHover);
  await expect(menuTrigger).toHaveCSS("box-shadow", topPressShadow);
  await preview.mouse.up();
  const menu = preview.getByRole("menu", { name: "Note actions" });
  const item = menu.getByRole("menuitem", { name: "Add to reading list" });
  await expect(item).toBeFocused();
  await expect(menu).toHaveCSS("animation-name", "none");
  await item.hover();
  const itemHover = await item.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await preview.mouse.down();
  await expect(item).toHaveCSS("background-color", itemHover);
  await expect(item).toHaveCSS("box-shadow", topPressShadow);
  await preview.screenshot({ path: info.outputPath("menu-item-pressed.png") });
  await preview.mouse.up();
  await expect(menu).not.toBeVisible();

  const dialogTrigger = preview.getByRole("button", { name: "Open dialog" });
  const dialog = preview.getByRole("dialog", { name: "Keep these notes?" });
  await dialogTrigger.click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(dialog).toHaveCSS("animation-name", "none");
  const backdropMotion = () =>
    dialog.evaluate(
      (element) => getComputedStyle(element, "::backdrop").animationDuration,
    );
  await expect.poll(backdropMotion).toBe("0.16s");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(backdropMotion).toBe("0s");
  await preview.keyboard.press("Escape");
  await expect(dialogTrigger).toBeFocused();
  await trigger.click();
  await expect(popup).toHaveCSS("animation-name", "none");
});

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
  const failure = preview.getByRole("dialog", {
    name: "Couldn’t save changes",
  });
  await expect(failure.getByRole("button", { name: "Cancel" })).toBeFocused();
  expect(
    await failure.evaluate(
      (element) => getComputedStyle(element, "::backdrop").animationName,
    ),
  ).toBe("none");
  await failure.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(failure).not.toBeVisible();
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
  for (const name of ["Name", "Notes"]) {
    await expect(
      preview.getByRole("textbox", { name, exact: true }),
    ).toBeVisible();
  }
  const archived = preview.getByRole("checkbox", {
    name: "Include archived notes",
    exact: true,
  });
  await archived.check();
  await expect(archived).toBeChecked();
  await preview
    .getByRole("radio", { name: "Oldest first", exact: true })
    .check();
  await expect(
    preview.getByRole("radio", { name: "Newest first", exact: true }),
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
  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toHaveCSS("max-width", "100%");
  await expect(cancel).toBeFocused();
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
  await expect(
    preview.locator(
      '[data-component="SituateIconButton"] button[aria-pressed]',
    ),
  ).toHaveAttribute("aria-pressed", "true");
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
  const indeterminate = preview.getByRole("progressbar", {
    name: "Notes prepared",
  });
  await expect(indeterminate).not.toHaveAttribute("aria-valuenow");
  await expect(indeterminate.locator("span")).toHaveCSS(
    "transition-duration",
    "0s",
  );
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
