import { expect, test, type Page, type Locator } from "./test";
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
async function request(preview: Page, nav: Locator, name: string) {
  await nav
    .getByRole("button", { name: `Actions for tag: ${name}`, exact: true })
    .click();
  await preview
    .getByRole("menuitem", { name: "Delete tag", exact: true })
    .click();
  return preview.getByRole("dialog", { name: "Delete tag?", exact: true });
}

for (const mobile of [false, true]) {
  test(`delete a parent, retain its subtag and automatically update the saved search · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-find", mobile);
    let nav = await browse(preview);
    await nav
      .getByRole("button", { name: "Home & repairs", exact: true })
      .click();
    await preview.getByRole("searchbox").fill("Unsubmitted search");
    nav = await browse(preview);
    const actions = nav.getByRole("button", {
      name: "Actions for tag: Home",
      exact: true,
    });
    await actions.focus();
    await preview.keyboard.press("Enter");
    await expect(
      preview.getByRole("menuitem", { name: "Delete tag", exact: true }),
    ).toBeFocused();
    await preview.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    const dialog = await request(preview, nav, "Home");
    await expect(
      dialog.getByRole("checkbox", {
        name: "Also delete 1 subtag",
        exact: true,
      }),
    ).not.toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toHaveCount(0);
    for (const row of await dialog.locator(".doc-delete-impact > div").all()) {
      await expect(row).toHaveCSS("border-bottom-width", "0px");
    }
    await expect(dialog.locator(".doc-dialog-actions")).toHaveCSS(
      "border-top-width",
      "1px",
    );
    await expect(dialog.locator(".doc-delete-impact")).toContainText(
      "Documents losing tag assignments1",
    );
    await expect(dialog.locator(".doc-delete-impact dt")).toHaveText([
      "Tags to delete",
      "Documents losing tag assignments",
    ]);
    await expect(
      dialog.getByText("Home & repairs", { exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByText(/saved searches/i)).toHaveCount(0);
    await info.attach("delete-parent", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(actions).toBeFocused();
    await expect(
      nav.getByRole("button", { name: "Home / Repairs", exact: true }),
    ).toBeVisible();
    await expect(preview.locator(".doc-result")).toHaveCount(2);
    await request(preview, nav, "Home");
    await preview.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(actions).toBeFocused();
    await request(preview, nav, "Home");
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(actions).toBeFocused();
    await expect(preview.locator(".doc-result")).toHaveCount(2);
    await request(preview, nav, "Home");
    await dialog
      .getByRole("button", { name: "Delete tag", exact: true })
      .click();
    await expect(nav.getByRole("status")).toHaveCount(0);
    await expect(
      nav.getByRole("button", { name: "Home", exact: true }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("button", { name: "Repairs", exact: true }),
    ).toBeVisible();
    await expect(
      nav.getByRole("button", {
        name: "Actions for tag: Repairs",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      nav.getByRole("button", { name: "Home & repairs", exact: true }),
    ).toBeVisible();
    if (mobile)
      await nav
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(preview.getByRole("searchbox")).toHaveValue(
      "Unsubmitted search",
    );
    await expect(preview.getByRole("alert")).toHaveCount(0);
    await expect(preview.locator(".doc-result")).toHaveCount(10);
    await expect(preview.locator("[data-remove-tag]")).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: "Save search", exact: true }),
    ).toBeEnabled();
    await expect(preview.getByRole("dialog")).toHaveCount(0);
    await info.attach("saved-search-after-tag-deletion", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    nav = await browse(preview);
    await nav
      .getByRole("button", { name: "Home & repairs", exact: true })
      .click();
    await expect(preview.locator(".doc-result")).toHaveCount(10);
    await expect(
      preview.getByRole("heading", { name: "Home & repairs", exact: true }),
    ).toBeVisible();
  });

  test(`branch deletion is explicit and reset restores all tags · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const preview = await open(page, "documents-find", mobile);
    let nav = await browse(preview);
    const dialog = await request(preview, nav, "Tax");
    const checkbox = dialog.getByRole("checkbox", {
      name: "Also delete 2 subtags",
      exact: true,
    });
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(dialog.locator(".doc-delete-impact")).toContainText(
      "Tags to delete3",
    );
    await preview.reload();
    await expect(checkbox).toBeChecked();
    await dialog
      .getByRole("button", { name: "Delete tag and subtags", exact: true })
      .click();
    await expect(
      nav.getByRole("button", { name: "Tax", exact: true }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("button", { name: "Tax / Expenses", exact: true }),
    ).toHaveCount(0);
    if (mobile)
      await nav
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(preview.locator(".doc-result")).toHaveCount(10);
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    nav = await browse(preview);
    await expect(
      nav.getByRole("button", {
        name: "Tax / Expenses / Training",
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("a name collision prevents silent merging and cancellation leaves tags unchanged", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-tag-delete-conflict");
  const dialog = preview.getByRole("dialog", {
    name: "Delete tag?",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "duplicate names: Repairs",
  );
  await expect(
    dialog.getByRole("button", { name: "Delete tag", exact: true }),
  ).toBeDisabled();
  await info.attach("subtag-name-conflict", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await preview.setViewportSize({ width: 320, height: 568 });
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator(".doc-delete-subject")).toBeInViewport({
    ratio: 1,
  });
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Browse", exact: true }),
  ).toBeFocused();
  const nav = await browse(preview);
  await expect(
    nav.getByRole("button", { name: "Home / Repairs", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("button", { name: "Repairs", exact: true }),
  ).toBeVisible();
});

test("tag deletion stays usable with a keyboard-constrained viewport", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-delete-tag", true);
  const dialog = preview.getByRole("dialog", {
    name: "Delete tag?",
    exact: true,
  });
  const branch = dialog.getByRole("checkbox", {
    name: "Also delete 1 subtag",
    exact: true,
  });
  await branch.check();
  await preview.setViewportSize({ width: 320, height: 568 });
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  await expect(branch).toBeChecked();
  const confirm = dialog.getByRole("button", {
    name: "Delete tag and subtags",
    exact: true,
  });
  await confirm.scrollIntoViewIfNeeded();
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await preview.reload();
  await expect(branch).toBeChecked();
  await info.attach("delete-tag-keyboard", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await dialog
    .getByRole("button", { name: "Delete tag and subtags", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(preview.getByRole("dialog", { name: /repair/i })).toHaveCount(0);
  await expect(preview.locator(".doc-result")).toHaveCount(10);
});

for (const id of ["documents-repair-view", "documents-missing-tag"]) {
  test(`old ${id} links open the updated saved search without a repair workflow`, async ({
    page,
  }) => {
    const preview = await open(page, id);
    await expect(
      page.getByLabel("Starting state", { exact: true }),
    ).toHaveAttribute("data-value", "documents-tag-removed");
    await expect(preview.getByRole("dialog")).toHaveCount(0);
    await expect(preview.getByRole("alert")).toHaveCount(0);
    await expect(preview.locator(".doc-result")).toHaveCount(10);
    await expect(preview.locator("[data-remove-tag]")).toHaveCount(0);
    await preview.reload();
    await expect(preview.locator(".doc-result")).toHaveCount(10);
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(preview.getByRole("dialog")).toHaveCount(0);
    await expect(preview.locator(".doc-result")).toHaveCount(10);
  });
}

test("changing live filters does not restore deleted conditions when reopening a saved search", async ({
  page,
}) => {
  const preview = await open(page, "documents-tag-removed");
  await selectOption(
    preview.getByLabel("Add tags", { exact: true }),
    "repairs",
  );
  await expect(preview.locator(".doc-result")).toHaveCount(1);
  const nav = await browse(preview);
  await nav
    .getByRole("button", { name: "Home & repairs", exact: true })
    .click();
  await expect(preview.locator(".doc-result")).toHaveCount(10);
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect(preview.locator("[data-remove-tag]")).toHaveCount(0);
});

test("deleting the final tag restores focus to creation and supports an empty list", async ({
  page,
}) => {
  const preview = await open(page, "documents-no-tags");
  const nav = await browse(preview);
  await nav.getByRole("button", { name: "New tag", exact: true }).click();
  const create = preview.getByRole("dialog", { name: "New tag", exact: true });
  await create
    .getByRole("textbox", { name: "Tag name", exact: true })
    .fill("Travel");
  await create.getByRole("button", { name: "Create tag", exact: true }).click();
  const dialog = await request(preview, nav, "Travel");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Delete tag", exact: true }).click();
  await expect(
    nav.getByRole("button", { name: "New tag", exact: true }),
  ).toBeFocused();
  await expect(nav.getByText("No tags yet.", { exact: true })).toBeVisible();
  await expect(nav.getByRole("status")).toHaveCount(0);
});
