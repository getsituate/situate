import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(page: Page, scenario: string, profile = "mac") {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}&profile=${profile}`,
  );
  const ready = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await ready;
  await preview.setViewportSize({
    width: profile === "mac" ? 1040 : 390,
    height: profile === "mac" ? 700 : 844,
  });
  await expect(preview.locator(".environment-content")).toBeVisible();
  return preview;
}
async function fits(preview: Page) {
  await expect(async () => {
    const area = (await preview.locator(".environment-content").boundingBox())!;
    const popup = (await preview
      .locator(".situate-select-popup")
      .boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(area.x);
    expect(popup.y).toBeGreaterThanOrEqual(area.y);
    expect(popup.x + popup.width).toBeLessThanOrEqual(area.x + area.width + 1);
    expect(popup.y + popup.height).toBeLessThanOrEqual(
      area.y + area.height + 1,
    );
  }).toPass({ timeout: 5000 });
}

test("desktop choices support arrows, typeahead, cancellation and focus return", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-find");
  const trigger = preview.getByRole("combobox", {
    name: "Sort documents",
    exact: true,
  });
  await trigger.press("ArrowDown");
  const popup = preview.getByRole("dialog", {
    name: "Sort documents",
    exact: true,
  });
  await expect(popup).toBeVisible();
  await expect(popup).not.toHaveClass(/select-sheet/);
  const list = popup.getByRole("listbox");
  await expect(list).toBeFocused();
  await expect(
    popup.getByRole("option", { name: "Newest first", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await list.press("End");
  await list.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("data-value", "newest");
  await trigger.press("Enter");
  await list.press("b");
  await expect(list).toHaveAttribute(
    "aria-activedescendant",
    (await popup
      .getByRole("option", { name: "Best matches", exact: true })
      .getAttribute("id"))!,
  );
  await fits(preview);
  await info.attach("desktop-options", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await list.press("Enter");
  await expect(trigger).toHaveAttribute("data-value", "relevance");
  await expect(trigger).toBeFocused();
});

for (const profile of ["ios", "android"]) {
  test(`mobile choices use a bounded sheet with immediate selection · ${profile}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-gather", profile);
    const trigger = preview.getByRole("combobox", {
      name: "Documents with",
      exact: true,
    });
    await trigger.click();
    const popup = preview.getByRole("dialog", {
      name: "Documents with",
      exact: true,
    });
    await expect(popup).toHaveClass(/select-sheet/);
    expect((await popup.boundingBox())!.width).toBeCloseTo(
      (await preview.locator(".environment-content").boundingBox())!.width,
      0,
    );
    await expect(
      popup.getByRole("option", { name: "All selected tags", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    for (const option of await popup.getByRole("option").all())
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await fits(preview);
    await info.attach(`mobile-options-${profile}`, {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await popup
      .getByRole("option", { name: "Any selected tag", exact: true })
      .click();
    await expect(trigger).toHaveAttribute("data-value", "any");
    await expect(trigger).toBeFocused();
    await expect(preview.locator(".doc-result")).toHaveCount(8);
    await trigger.click();
    await popup
      .getByRole("button", { name: "Close choices", exact: true })
      .click();
    await expect(trigger).toHaveAttribute("data-value", "any");
  });
}

test("long option lists scroll within safe areas and react to keyboard and rotation", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-find", "ios");
  const trigger = preview.getByRole("combobox", {
    name: "Add tags",
    exact: true,
  });
  await trigger.click();
  const popup = preview.getByRole("dialog", { name: "Add tags", exact: true });
  await expect(
    popup.getByRole("option", {
      name: "Tax / Expenses / Training",
      exact: true,
    }),
  ).toBeVisible();
  await preview.setViewportSize({ width: 320, height: 568 });
  await page.getByLabel("Keyboard occlusion").check();
  await expect
    .poll(async () => (await popup.boundingBox())!.height)
    .toBeLessThan(220);
  await fits(preview);
  await popup.getByRole("listbox").press("End");
  await expect(
    popup.getByRole("option", { name: "Personal only", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await info.attach("short-options", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await page.getByLabel("Keyboard occlusion").uncheck();
  await preview.setViewportSize({ width: 844, height: 390 });
  await expect(popup).toHaveClass(/select-sheet/);
  await expect
    .poll(async () => (await popup.boundingBox())!.y)
    .toBeGreaterThanOrEqual(59);
  await fits(preview);
  await popup
    .getByRole("option", { name: "Personal only", exact: true })
    .click();
  await expect(
    preview.getByRole("button", {
      name: "Remove tag filter: Personal only",
      exact: true,
    }),
  ).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("settings share the sheet, trap focus, dismiss outside, and reset removes it", async ({
  page,
}) => {
  const preview = await open(page, "settings-formats", "ios");
  await preview.getByRole("button", { name: /Language & formats/ }).click();
  const trigger = preview.getByRole("combobox", {
    name: "Time format",
    exact: true,
  });
  await trigger.click();
  const popup = preview.getByRole("dialog", {
    name: "Time format",
    exact: true,
  });
  await expect(popup).toHaveClass(/select-sheet/);
  for (let i = 0; i < 4; i++) {
    await preview.keyboard.press("Tab");
    expect(
      await popup.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await preview.mouse.click(4, 65);
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(popup).toHaveCount(0);
  await preview.getByRole("button", { name: /Language & formats/ }).click();
  await expect(trigger).toHaveAttribute("data-value", "24");
});

test("folder choices work inside another dialog without losing its draft", async ({
  page,
}) => {
  const preview = await open(page, "files-read", "ios");
  await selectOption(
    page.getByRole("combobox", { name: "Dialog", exact: true }),
    "name",
  );
  const outer = preview.getByRole("dialog");
  await expect(outer).toBeVisible();
  const field = outer.getByRole("textbox").first();
  await field.fill("untitled-draft.md");
  const folder = outer.getByRole("combobox", { name: "Folder", exact: true });
  await folder.click();
  await expect(preview.getByRole("dialog")).toHaveCount(2);
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("dialog")).toHaveCount(1);
  await expect(folder).toBeFocused();
  await expect(field).toHaveValue("untitled-draft.md");
  await selectOption(folder, "");
  await expect(field).toHaveValue("untitled-draft.md");
});
