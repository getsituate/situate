import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(page: Page, scenario: string, mobile = false) {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}&profile=${mobile ? "ios" : "mac"}`,
  );
  const ready = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await ready;
  await preview.setViewportSize({
    width: mobile ? 390 : 1440,
    height: mobile ? 844 : 900,
  });
  await expect(preview.locator(".documents-view")).toBeVisible();
  return preview;
}
async function browse(preview: Page) {
  const trigger = preview.getByRole("button", { name: "Browse", exact: true });
  if (await trigger.isVisible()) {
    await trigger.click();
    return preview.getByRole("dialog", {
      name: "Browse documents",
      exact: true,
    });
  }
  return preview.locator(".doc-library-navigation");
}

for (const mobile of [false, true]) {
  test(`create a child tag from navigation without changing the document selection · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-gather", mobile);
    await preview.getByRole("searchbox").fill("Unsubmitted search");
    const nav = await browse(preview);
    const trigger = nav.getByRole("button", { name: "New tag", exact: true });
    await trigger.click();
    const dialog = preview.getByRole("dialog", {
      name: "New tag",
      exact: true,
    });
    const name = dialog.getByRole("textbox", { name: "Tag name", exact: true });
    await expect(name).toBeFocused();
    await expect(
      page.getByLabel("Document previews", { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Create tag", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a tag name.");
    await expect(name).toBeFocused();
    await name.fill(" tAX ");
    await dialog
      .getByRole("button", { name: "Create tag", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("already exists");
    await expect(name).toHaveValue(" tAX ");
    await info.attach("duplicate-tag-name", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await name.fill("Energy");
    await selectOption(
      dialog.getByRole("combobox", { name: "Parent tag", exact: true }),
      "repairs",
    );
    await dialog
      .getByRole("button", { name: "Create tag", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(
      nav.getByRole("button", { name: "Home / Repairs / Energy", exact: true }),
    ).toContainText("0");
    await expect(nav.getByRole("status")).toHaveText(
      "Tag created: Home / Repairs / Energy.",
    );
    if (mobile)
      await nav
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(preview.getByRole("searchbox")).toHaveValue(
      "Unsubmitted search",
    );
    await expect(
      preview.getByRole("combobox", { name: "Documents with", exact: true }),
    ).toHaveAttribute("data-value", "all");
    await expect(preview.locator(".doc-result")).toHaveCount(5);
  });

  test(`create and assign a document tag while preserving edits and cancellation · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-preview", mobile);
    await preview
      .getByRole("button", { name: "Edit tags", exact: true })
      .click();
    const tags = preview.getByRole("dialog", {
      name: "Document tags",
      exact: true,
    });
    await tags.getByRole("checkbox", { name: "Tax", exact: true }).check();
    const trigger = tags.getByRole("button", { name: "New tag", exact: true });
    await trigger.click();
    const create = preview.getByRole("dialog", {
      name: "New tag",
      exact: true,
    });
    await create
      .getByRole("textbox", { name: "Tag name", exact: true })
      .fill("Cancelled tag");
    await preview.keyboard.press("Escape");
    await expect(create).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(
      tags.getByRole("checkbox", { name: "Tax", exact: true }),
    ).toBeChecked();
    await expect(
      tags.getByRole("checkbox", { name: "Cancelled tag", exact: true }),
    ).toHaveCount(0);
    await trigger.click();
    await expect(
      create.getByRole("textbox", { name: "Tag name", exact: true }),
    ).toHaveValue("");
    await create
      .getByRole("textbox", { name: "Tag name", exact: true })
      .fill("Receipts");
    await selectOption(
      create.getByRole("combobox", { name: "Parent tag", exact: true }),
      "expenses",
    );
    await info.attach("create-document-tag", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await create
      .getByRole("button", { name: "Create tag", exact: true })
      .click();
    await expect(
      tags.getByRole("checkbox", {
        name: "Tax / Expenses / Receipts",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      tags.getByRole("checkbox", { name: "Tax", exact: true }),
    ).toBeChecked();
    await tags.getByRole("button", { name: "Apply tags", exact: true }).click();
    await preview
      .getByRole("button", { name: "Edit tags", exact: true })
      .click();
    await expect(
      tags.getByRole("checkbox", {
        name: "Tax / Expenses / Receipts",
        exact: true,
      }),
    ).toBeChecked();
  });
}

test("new tag drafts survive keyboard geometry, parent-picker cancellation and preview reload", async ({
  page,
}) => {
  const preview = await open(page, "documents-new-document-tag", true);
  let dialog = preview.getByRole("dialog", { name: "New tag", exact: true });
  await dialog
    .getByRole("textbox", { name: "Tag name", exact: true })
    .fill("Annual records");
  await selectOption(
    dialog.getByRole("combobox", { name: "Parent tag", exact: true }),
    "tax",
  );
  await dialog.getByRole("textbox", { name: "Tag name", exact: true }).focus();
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  await preview.setViewportSize({ width: 320, height: 568 });
  await expect(
    dialog.getByRole("textbox", { name: "Tag name", exact: true }),
  ).toHaveValue("Annual records");
  await expect
    .poll(() =>
      dialog
        .getByRole("textbox", { name: "Tag name", exact: true })
        .evaluate((input) => {
          const box = input.getBoundingClientRect();
          const dialogBox = input.closest("dialog")!.getBoundingClientRect();
          const x = box.x + box.width / 2;
          return (
            box.top >= dialogBox.top &&
            box.bottom <= dialogBox.bottom &&
            document.elementFromPoint(x, box.top + 2) === input &&
            document.elementFromPoint(x, box.bottom - 2) === input
          );
        }),
    )
    .toBe(true);
  await dialog
    .getByRole("combobox", { name: "Parent tag", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog", { name: "Parent tag", exact: true }),
  ).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Parent tag", exact: true }),
  ).toHaveAttribute("data-value", "tax");
  const inside = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const area = document
      .querySelector(".environment-content")!
      .getBoundingClientRect();
    return (
      rect.top >= area.top &&
      rect.bottom <= area.bottom &&
      rect.left >= area.left &&
      rect.right <= area.right
    );
  });
  expect(inside).toBe(true);
  await preview.reload();
  dialog = preview.getByRole("dialog", { name: "New tag", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "Tag name", exact: true }),
  ).toHaveValue("Annual records");
  await expect(
    dialog.getByRole("combobox", { name: "Parent tag", exact: true }),
  ).toHaveAttribute("data-value", "tax");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Tag name", exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByRole("combobox", { name: "Parent tag", exact: true }),
  ).toHaveAttribute("data-value", "");
});

test("empty tag lists allow a root tag and cancelling document assignment retains only the new tag", async ({
  page,
}) => {
  const preview = await open(page, "documents-no-tags");
  const nav = await browse(preview);
  await expect(nav.getByText("No tags yet.", { exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "New tag", exact: true }).click();
  const create = preview.getByRole("dialog", { name: "New tag", exact: true });
  await create
    .getByRole("textbox", { name: "Tag name", exact: true })
    .fill("Travel");
  await create.getByRole("button", { name: "Create tag", exact: true }).click();
  await expect(
    nav.getByRole("button", { name: "Travel", exact: true }),
  ).toContainText("0");
  await preview.locator('[data-document="bike"]').click();
  await preview.getByRole("button", { name: "Edit tags", exact: true }).click();
  const tags = preview.getByRole("dialog", {
    name: "Document tags",
    exact: true,
  });
  await tags.getByRole("button", { name: "New tag", exact: true }).click();
  await create
    .getByRole("textbox", { name: "Tag name", exact: true })
    .fill("Weekend");
  await create.getByRole("button", { name: "Create tag", exact: true }).click();
  await tags.getByRole("button", { name: "Cancel", exact: true }).click();
  await preview.getByRole("button", { name: "Edit tags", exact: true }).click();
  await expect(
    tags.getByRole("checkbox", { name: "Weekend", exact: true }),
  ).not.toBeChecked();
});
