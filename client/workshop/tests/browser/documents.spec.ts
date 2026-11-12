import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";
import { selectOption, selectOptions } from "./select";

async function open(page: Page, scenario: string, mobile: boolean) {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}&profile=${mobile ? "ios" : "mac"}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({
    width: mobile ? 390 : 1440,
    height: mobile ? 844 : 900,
  });
  await expect(preview.locator(".documents-view, .plugin-view")).toBeVisible();
  return preview;
}
async function browse(preview: Page) {
  const button = preview.getByRole("button", { name: "Browse", exact: true });
  if (await button.isVisible()) {
    await button.click();
    return preview.getByRole("dialog");
  }
  return preview.locator(".doc-library-navigation");
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const rect = await page.locator(".documents-view").boundingBox();
  expect(rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}
async function layout(controls: Page, preview: Page, focused: boolean) {
  await selectOption(
    controls.getByLabel("Navigation approach", { exact: true }),
    focused ? "focused" : "library",
  );
  if (focused)
    await expect(preview.locator(".documents-view")).toHaveClass(
      /documents-focused/,
    );
  else
    await expect(preview.locator(".documents-view")).not.toHaveClass(
      /documents-focused/,
    );
}
for (const mobile of [false, true]) {
  for (const focused of [false, true]) {
    const suffix = `${mobile ? "mobile" : "desktop"} · ${focused ? "search" : "library"}`;
    test(`find a document by description, identifier and typo without choosing a mode · ${suffix}`, async ({
      page,
    }, info) => {
      const preview = await open(page, "documents-find", mobile);
      await layout(page, preview, focused);
      const errors: string[] = [];
      preview.on("pageerror", (e) => errors.push(e.message));
      const centers = await preview
        .locator(".doc-search-box")
        .evaluate((element) => {
          const input = element.querySelector("input")!.getBoundingClientRect();
          const button = element
            .querySelector("button")!
            .getBoundingClientRect();
          const icon = element
            .querySelector("button svg")!
            .getBoundingClientRect();
          return {
            inputY: input.y + input.height / 2,
            buttonX: button.x + button.width / 2,
            iconX: icon.x + icon.width / 2,
            iconY: icon.y + icon.height / 2,
          };
        });
      expect(centers.iconY).toBeCloseTo(centers.inputY, 1);
      expect(centers.iconX).toBeCloseTo(centers.buttonX, 1);
      await preview.getByRole("searchbox").fill("bicycle repair");
      await preview.getByRole("searchbox").press("Enter");
      await expect(preview.locator(".doc-result")).toHaveCount(1);
      await expect(preview.locator(".doc-excerpt")).toContainText("VE-2048");
      await preview.locator('[data-document="bike"]').click();
      await expect(preview.locator(".doc-paper")).toContainText("€86.00");
      await preview
        .getByRole("button", { name: "Next page", exact: true })
        .click();
      await expect(preview.locator(".doc-paper")).toContainText(
        "Service record",
      );
      await info.attach(`find-${suffix}`, {
        body: await preview.screenshot(),
        contentType: "image/png",
      });
      await fits(preview);
      const close = preview.getByRole("button", {
        name: mobile ? "Back to documents" : "Close document",
        exact: true,
      });
      await close.click();
      await expect(preview.locator('[data-document="bike"]')).toBeFocused();
      await expect(
        preview.getByRole("combobox", { name: "Search by", exact: true }),
      ).toHaveCount(0);
      for (const query of ["VE-2048", "bicycel repair", "bicyle repair"]) {
        await preview.getByRole("searchbox").fill(query);
        await preview.getByRole("searchbox").press("Enter");
        await expect(preview.locator(".doc-result")).toHaveCount(1);
        await expect(preview.locator('[data-document="bike"]')).toBeVisible();
      }
      await preview.getByRole("searchbox").fill("VE-2049");
      await preview.getByRole("searchbox").press("Enter");
      await expect(preview.locator(".doc-result")).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test(`gather, save and refresh a dynamic document selection · ${suffix}`, async ({
      page,
    }, info) => {
      const preview = await open(page, "documents-gather", mobile);
      await layout(page, preview, focused);
      await expect(preview.locator(".doc-result")).toHaveCount(5);
      await expect(preview.locator('[data-document="internet"]')).toHaveCount(
        0,
      );
      await expect(preview.locator('[data-document="personal"]')).toHaveCount(
        1,
      );
      await expect(
        preview.getByLabel("Documents with", { exact: true }),
      ).toHaveAttribute("data-value", "all");
      await expect(
        preview.getByRole("button", {
          name: "Remove tag filter: Tax",
          exact: true,
        }),
      ).toBeVisible();
      await expect(preview.getByRole("dialog")).toHaveCount(0);
      await info.attach(`filters-${suffix}`, {
        body: await preview.screenshot(),
        contentType: "image/png",
      });
      await preview
        .getByRole("button", { name: "Save search", exact: true })
        .click();
      await expect(
        preview.getByRole("dialog", { name: "Save this search", exact: true }),
      ).toBeVisible();
      await preview.getByLabel("Name", { exact: true }).fill("Tax 2025");
      await preview.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        preview.getByRole("heading", { name: "Tax 2025", exact: true }),
      ).toBeVisible();
      await expect(
        preview.getByText("Search saved.", { exact: true }),
      ).toBeVisible();
      await preview
        .getByRole("button", { name: "Document actions", exact: true })
        .click();
      await preview
        .getByRole("menuitem", { name: "Sources", exact: true })
        .click();
      const drive = preview.locator(".plugin-sources .plugin-row").filter({
        has: preview.getByRole("heading", {
          name: "Cloud drive",
          exact: true,
        }),
      });
      await drive.getByRole("button", { name: "Refresh", exact: true }).click();
      await preview
        .getByRole("button", { name: "Back to documents", exact: false })
        .click();
      await preview
        .getByRole("button", { name: "Clear search and filters", exact: true })
        .click();
      const navigation = await browse(preview);
      await navigation
        .getByRole("button", { name: "Tax 2025", exact: true })
        .click();
      await expect(preview.locator(".doc-result")).toHaveCount(6);
      await expect(
        preview.locator('[data-document="new-invoice"]'),
      ).toBeVisible();
      await info.attach(`gather-${suffix}`, {
        body: await preview.screenshot(),
        contentType: "image/png",
      });
      await fits(preview);
    });
  }

  test(`inline tags default to any, switch to all and clear without a dialog · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-find", mobile);
    const add = preview.getByLabel("Add tags", { exact: true });
    const initialCount = await preview.locator(".doc-result").count();
    await selectOption(add, "tax");
    const match = preview.getByLabel("Documents with", { exact: true });
    await expect(match).toHaveAttribute("data-value", "any");
    await selectOption(add, "2025");
    await expect(preview.locator('[data-document="internet"]')).toHaveCount(1);
    await expect(preview.locator('[data-document="bike"]')).toHaveCount(1);
    const anyCount = await preview.locator(".doc-result").count();
    await selectOption(match, "all");
    await expect(preview.locator(".doc-result")).toHaveCount(5);
    await expect(preview.locator('[data-document="internet"]')).toHaveCount(0);
    await expect(preview.locator('[data-document="personal"]')).toHaveCount(1);
    await expect(preview.getByRole("dialog")).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: "Edit as text" }),
    ).toHaveCount(0);
    await info.attach("inline-tags", {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await selectOption(match, "any");
    await expect(preview.locator(".doc-result")).toHaveCount(anyCount);
    await preview
      .getByRole("button", {
        name: "Remove tag filter: Years / 2025",
        exact: true,
      })
      .click();
    const removeTax = preview.getByRole("button", {
      name: "Remove tag filter: Tax",
      exact: true,
    });
    await expect(removeTax).toBeFocused();
    await removeTax.press("Enter");
    await expect(add).toBeFocused();
    await expect(preview.locator(".doc-result")).toHaveCount(initialCount);
    await fits(preview);
  });
}

for (const mobile of [false, true]) {
  test(`unified search preserves saved criteria and drafts through errors · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const preview = await open(page, "documents-find", mobile);
    const query = preview.getByRole("searchbox");
    await query.fill("bicycel repair");
    await query.press("Tab");
    const submit = preview.getByRole("button", {
      name: "Search documents",
      exact: true,
    });
    await expect(submit).toBeFocused();
    await submit.press("Enter");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await selectOption(preview.getByLabel("Add tags", { exact: true }), "home");
    await preview
      .getByRole("button", { name: "Save search", exact: true })
      .click();
    await preview.getByLabel("Name", { exact: true }).fill("Bike repair");
    await preview.getByRole("button", { name: "Save", exact: true }).click();
    await preview
      .getByRole("button", { name: "Clear search and filters", exact: true })
      .click();
    const navigation = await browse(preview);
    await navigation
      .getByRole("button", { name: "Bike repair", exact: true })
      .click();
    await expect(query).toHaveValue("bicycel repair");
    await expect(
      preview.getByRole("button", {
        name: "Remove tag filter: Home",
        exact: true,
      }),
    ).toBeVisible();
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await selectOption(
      page.getByLabel("Search result state", { exact: true }),
      "error",
    );
    await expect(
      preview.getByText(
        "Search could not be completed. Your search and filters have been kept.",
        { exact: true },
      ),
    ).toBeVisible();
    await query.fill("VE-2048");
    await selectOption(
      page.getByLabel("Search result state", { exact: true }),
      "ready",
    );
    await expect(query).toHaveValue("VE-2048");
    await query.press("Enter");
    await expect(preview.locator('[data-document="bike"]')).toBeVisible();
    await fits(preview);
  });
  test(`query, selection and result controls stay grouped through resizing · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-gather", mobile);
    const query = preview.getByRole("searchbox");
    await query.fill("Unsubmitted description");
    for (const width of mobile ? [390, 320] : [1920, 1040, 768]) {
      await preview.setViewportSize({ width, height: mobile ? 844 : 900 });
      const { field, submit, collection, controls } = await preview
        .locator(".doc-collection")
        .evaluate((element) => {
          const rect = (node: Element) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          };
          return {
            field: rect(element.querySelector('[role="search"]')!),
            submit: rect(element.querySelector(".doc-search-box button")!),
            collection: rect(element),
            controls: ["#doc-add-tag", "#doc-tag-match", ".doc-sort"].map(
              (selector) => rect(element.querySelector(selector)!),
            ),
          };
        });
      expect(submit.x).toBeGreaterThanOrEqual(field.x);
      expect(submit.y).toBeGreaterThanOrEqual(field.y);
      expect(submit.x + submit.width).toBeLessThanOrEqual(
        field.x + field.width,
      );
      expect(submit.y + submit.height).toBeLessThanOrEqual(
        field.y + field.height,
      );
      for (const rect of controls) {
        expect(rect.x).toBeGreaterThanOrEqual(collection.x);
        expect(rect.x + rect.width).toBeLessThanOrEqual(
          collection.x + collection.width,
        );
        expect(rect.height).toBeGreaterThanOrEqual(48);
      }
      if (width === 320) {
        expect(controls[0]!.y).toBeCloseTo(controls[1]!.y, 0);
        await selectOption(
          preview.getByRole("combobox", {
            name: "Documents with",
            exact: true,
          }),
          "any",
        );
        const [addY, matchY] = await preview
          .locator(".doc-inline-filters")
          .evaluate((element) =>
            ["#doc-add-tag", "#doc-tag-match"].map(
              (selector) =>
                element.querySelector(selector)!.getBoundingClientRect().y,
            ),
          );
        expect(addY).toBeCloseTo(matchY!, 0);
        await expect(preview.locator(".doc-result")).toHaveCount(8);
        await selectOption(
          preview.getByRole("combobox", {
            name: "Documents with",
            exact: true,
          }),
          "all",
        );
      }
      await expect(query).toHaveValue("Unsubmitted description");
      await expect(
        preview.getByRole("combobox", { name: "Documents with", exact: true }),
      ).toHaveAttribute("data-value", "all");
      await expect(preview.locator(".doc-result")).toHaveCount(5);
      await fits(preview);
      await info.attach(
        `document-header-${mobile ? "mobile" : "desktop"}-${width}`,
        { body: await preview.screenshot(), contentType: "image/png" },
      );
    }
    await preview
      .getByRole("button", {
        name: "Not fully up to date. Review sources.",
        exact: true,
      })
      .click();
    await expect(
      preview.getByRole("heading", { name: /^Sources/ }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Back to documents", exact: false })
      .click();
    await expect(query).toHaveValue("Unsubmitted description");
    await preview
      .getByRole("button", { name: "Clear search and filters", exact: true })
      .click();
    await expect(query).toBeFocused();
    await expect(query).toHaveValue("");
    await expect(
      preview.getByRole("combobox", { name: "Documents with", exact: true }),
    ).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: "Save search", exact: true }),
    ).toBeVisible();
  });
}

for (const mobile of [false, true]) {
  for (const focused of [false, true]) {
    test(`document navigation uses tags and saved searches while sources manage connections · ${mobile ? "mobile" : "desktop"} · ${focused ? "search" : "library"}`, async ({
      page,
    }, info) => {
      const preview = await open(page, "documents-gather", mobile);
      await layout(page, preview, focused);
      const query = preview.getByRole("searchbox");
      await expect(preview.locator(".doc-result")).toHaveCount(5);
      await query.fill("Unsubmitted description");
      const navigation = await browse(preview);
      await expect(
        navigation.getByRole("heading", { name: "Tags", exact: true }),
      ).toBeVisible();
      await expect(
        navigation.getByRole("button", { name: /^Home & repairs/ }),
      ).toBeVisible();
      await expect(
        navigation.getByRole("heading", { name: "Sources", exact: true }),
      ).toHaveCount(0);
      for (const name of [
        "Cloud drive",
        "Paperless",
        "Home computer",
        "Document sources",
        "Finance",
      ]) {
        await expect(
          navigation.getByRole("button", { name: new RegExp(name) }),
        ).toHaveCount(0);
      }
      if (await preview.getByRole("dialog").isVisible()) {
        await preview.keyboard.press("Escape");
        await expect(
          preview.getByRole("button", { name: "Browse", exact: true }),
        ).toBeFocused();
      }
      await expect(query).toHaveValue("Unsubmitted description");
      await preview
        .getByRole("button", { name: "Document actions", exact: true })
        .click();
      await preview
        .getByRole("menuitem", { name: "Sources", exact: true })
        .click();
      await expect(
        preview.getByRole("heading", { name: /^Sources/ }),
      ).toBeVisible();
      const sources = preview.locator(".plugin-sources .plugin-row");
      await expect(sources).toHaveCount(3);
      await expect(
        sources.getByRole("button", { name: "Refresh", exact: true }),
      ).toHaveCount(3);
      await expect(
        sources.getByRole("button", { name: /^Browse/ }),
      ).toHaveCount(0);
      const drive = sources.filter({
        has: preview.getByRole("heading", { name: "Cloud drive", exact: true }),
      });
      await drive
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      await expect(
        preview.getByText("Documents / Shared", { exact: true }),
      ).toBeVisible();
      await preview
        .getByRole("button", { name: "‹ Back to plugins", exact: true })
        .click();
      await preview
        .getByRole("button", { name: /Back to documents/ })
        .press("Enter");
      await expect(preview.locator(".doc-result")).toHaveCount(5);
      await expect(query).toHaveValue("Unsubmitted description");
      await expect(preview.locator("[data-remove-tag]")).toHaveCount(2);
      await expect(preview.locator(".doc-results-heading h2")).toHaveCount(0);
      for (const width of mobile ? [390, 320] : [1920, 1040, 768]) {
        await preview.setViewportSize({ width, height: mobile ? 844 : 900 });
        await fits(preview);
        await expect(query).toHaveValue("Unsubmitted description");
        await expect(preview.locator(".doc-result")).toHaveCount(5);
        await info.attach(`collection-${width}`, {
          body: await preview.screenshot(),
          contentType: "image/png",
        });
      }
      await preview.locator('[data-document="course"]').click();
      await expect(preview.locator(".doc-preview details")).toContainText(
        "Cloud drive",
      );
      await expect(preview.locator(".doc-preview details")).toContainText(
        "Finance / 2025",
      );
      await page
        .getByRole("button", { name: "Reset scenario", exact: true })
        .click();
      await expect(query).toHaveValue("");
      await expect(preview.locator(".doc-result")).toHaveCount(5);
      await preview.reload();
      await expect(preview.locator(".doc-result")).toHaveCount(5);
    });
  }
}

for (const scenario of ["documents-find", "documents-no-tags"]) {
  test(`clearing untagged browsing restores all documents and keyboard focus · ${scenario}`, async ({
    page,
  }) => {
    const preview = await open(page, scenario, true);
    const count = await preview.locator(".doc-result").count();
    const query = preview.getByRole("searchbox");
    await query.fill("Unsubmitted description");
    const navigation = await browse(preview);
    await navigation.getByRole("button", { name: /^Without tags/ }).click();
    await expect(preview.locator('[data-constraint="untagged"]')).toBeVisible();
    await preview
      .getByRole("button", { name: "Clear tag filter", exact: true })
      .press("Enter");
    await expect(
      scenario === "documents-no-tags"
        ? query
        : preview.getByLabel("Add tags", { exact: true }),
    ).toBeFocused();
    await expect(preview.locator(".doc-result")).toHaveCount(count);
    await expect(query).toHaveValue("Unsubmitted description");
    await expect(preview.locator('[data-constraint="untagged"]')).toHaveCount(
      0,
    );
  });
}

for (const mobile of [false, true]) {
  test(`document actions open sources without losing the selection or draft · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-gather", mobile);
    const query = preview.getByRole("searchbox");
    await query.fill("Unsubmitted description");
    const header = preview.locator(".doc-workspace-heading");
    await expect(header).not.toContainText("Sources");
    await expect(header).not.toContainText("3");
    const trigger = header.getByRole("button", {
      name: "Document actions",
      exact: true,
    });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.press("ArrowDown");
    const menu = preview.getByRole("menu", {
      name: "Document actions",
      exact: true,
    });
    const sources = menu.getByRole("menuitem", {
      name: "Sources",
      exact: true,
    });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(sources).toBeFocused();
    await expect(
      page.getByLabel("Navigation approach", { exact: true }),
    ).toHaveCount(0);
    await sources.press("End");
    await expect(sources).toBeFocused();
    await sources.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Space");
    await preview.mouse.click(2, 2);
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    for (const width of mobile ? [390, 320] : [1440, 768]) {
      await preview.setViewportSize({ width, height: mobile ? 844 : 900 });
      await expect(sources).toBeInViewport({ ratio: 1 });
      await fits(preview);
      await info.attach(`document-actions-${width}`, {
        body: await preview.screenshot(),
        contentType: "image/png",
      });
    }
    await sources.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(
      preview.getByRole("heading", { name: /^Sources/ }),
    ).toBeFocused();
    await preview
      .getByRole("button", { name: /Back to documents/ })
      .press("Enter");
    await expect(trigger).toBeFocused();
    await expect(query).toHaveValue("Unsubmitted description");
    await expect(preview.locator("[data-remove-tag]")).toHaveCount(2);
    await expect(preview.locator(".doc-result")).toHaveCount(5);
    await trigger.click();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(query).toHaveValue("");
    await preview
      .getByRole("button", {
        name: "Not fully up to date. Review sources.",
        exact: true,
      })
      .click();
    await expect(
      preview.getByRole("heading", { name: /^Sources/ }),
    ).toBeVisible();
  });

  test(`an empty document collection keeps connection setup reachable · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const preview = await open(page, "documents-empty", mobile);
    await expect(
      preview
        .locator(".doc-empty-collection")
        .getByRole("button", { name: /Create a source/ }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Document actions", exact: true })
      .click();
    await preview
      .getByRole("menuitem", { name: "Sources", exact: true })
      .click();
    await expect(preview.locator(".plugin-sources .plugin-row")).toHaveCount(0);
    await preview.getByRole("button", { name: /Create a source/ }).click();
    await expect(
      preview.getByRole("textbox", { name: "Your request", exact: true }),
    ).toBeVisible();
  });

  test(`document navigation highlights the selection without an underline · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-find", mobile);
    for (const name of [
      /^All documents/,
      /^Home & repairs/,
      /^Tax$/,
      /^Without tags/,
    ]) {
      let navigation = await browse(preview);
      const target = navigation.getByRole("button", { name });
      await target.click();
      navigation = await browse(preview);
      const selected = navigation.getByRole("button", { name });
      await expect(selected).toHaveAttribute("aria-current", "page");
      await expect(selected).toHaveCSS("font-weight", "600");
      await expect(selected).toHaveCSS("text-decoration-line", "none");
      await expect(selected).not.toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await selected.focus();
      await expect(selected).toBeFocused();
      await info.attach("document-selection", {
        body: await preview.screenshot(),
        contentType: "image/png",
      });
      if (mobile) await preview.keyboard.press("Escape");
    }
  });
}

test("tag navigation gives labels, counts and actions room without crowding the collection", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-find", false);
  const sidebar = preview.locator(".doc-library-navigation");
  await sidebar.getByRole("button", { name: "New tag", exact: true }).click();
  const create = preview.getByRole("dialog", { name: "New tag", exact: true });
  await create
    .getByRole("textbox", { name: "Tag name", exact: true })
    .fill("Annual maintenance and insurance records");
  await selectOption(
    create.getByRole("combobox", { name: "Parent tag", exact: true }),
    "training",
  );
  await create.getByRole("button", { name: "Create tag", exact: true }).click();
  await sidebar
    .getByRole("button", { name: "All documents 10", exact: true })
    .click();
  const query = preview.getByRole("searchbox");
  await query.fill("Unsubmitted description");
  for (const width of [1440, 1040, 900]) {
    await preview.setViewportSize({ width, height: 900 });
    await expect(sidebar).toBeVisible();
    await expect
      .poll(() =>
        sidebar.evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBe(272);
    expect(
      (await preview.locator(".doc-collection").boundingBox())!.width,
    ).toBeGreaterThanOrEqual(560);
    expect(
      await sidebar
        .locator(".doc-sidebar-scroll")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const spaced = await sidebar.locator(".doc-tag-row").evaluateAll((rows) =>
      rows.every((row) => {
        const label = row
          .querySelector(".doc-tag-name")!
          .getBoundingClientRect();
        const count = row
          .querySelector(".doc-tag-nav > span:last-child")!
          .getBoundingClientRect();
        const choice = row
          .querySelector(".doc-tag-nav")!
          .getBoundingClientRect();
        const action = row
          .querySelector("[data-tag-actions]")!
          .getBoundingClientRect();
        return (
          count.left >= label.right + 7 &&
          action.left >= choice.right + 7 &&
          action.width >= 44 &&
          action.height >= 44 &&
          action.right <= row.getBoundingClientRect().right + 1
        );
      }),
    );
    expect(spaced).toBe(true);
    await expect(query).toHaveValue("Unsubmitted description");
    await fits(preview);
    await info.attach(`tag-sidebar-${width}`, {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
  }
  await preview.setViewportSize({ width: 1440, height: 900 });
  await preview.locator('[data-document="bike"]').click();
  await expect(sidebar).toBeVisible();
  expect(
    (await preview.locator(".doc-preview").boundingBox())!.width,
  ).toBeGreaterThanOrEqual(400);
  await preview.setViewportSize({ width: 1080, height: 900 });
  await expect(sidebar).toBeHidden();
  await expect(preview.locator(".doc-preview")).toBeVisible();
  await preview
    .getByRole("button", { name: "Close document", exact: true })
    .click();
  for (const width of [800, 320]) {
    await preview.setViewportSize({ width, height: 700 });
    await expect(sidebar).toBeHidden();
    await expect(query).toHaveValue("Unsubmitted description");
    const navigation = await browse(preview);
    await expect(navigation).toBeVisible();
    expect(
      await navigation
        .locator(".doc-browse")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await preview.keyboard.press("Escape");
    await expect(
      preview.getByRole("button", { name: "Browse", exact: true }),
    ).toBeFocused();
    await fits(preview);
  }
});

test("document header reflows long labels and enlarged text without hiding actions", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-gather", true);
  await preview.setViewportSize({ width: 320, height: 568 });
  await preview.addStyleTag({
    content: `
    .doc-search-box input { font-size: 32px; }
    .doc-results-summary { font-size: 24px; }
    .doc-sort, .doc-inline-filters button { font-size: 28px; }
  `,
  });
  await preview.locator(".doc-save-view").evaluate((button) => {
    button.textContent = "Save this document selection for later";
  });
  for (const selector of [
    ".doc-collection",
    ".doc-search",
    ".doc-inline-filters",
    ".doc-results-heading",
  ]) {
    expect(
      await preview
        .locator(selector)
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  }
  for (const selector of [
    "#doc-query",
    "#doc-add-tag",
    "#doc-tag-match",
    ".doc-clear",
    ".doc-save-view",
    ".doc-sort",
    ".doc-freshness",
  ]) {
    const control = preview.locator(selector);
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    await expect(control).toBeFocused();
    const { inside, visible } = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const area = document
        .querySelector(".environment-content")!
        .getBoundingClientRect();
      return {
        inside: rect.left >= area.left && rect.right <= area.right,
        visible: rect.top >= area.top && rect.bottom <= area.bottom,
      };
    });
    expect(inside).toBe(true);
    expect(visible, selector).toBe(true);
  }
  await info.attach("document-header-enlarged-text", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
});

test("all tag choices remain removable in a narrow mobile view", async ({
  page,
}) => {
  const preview = await open(page, "documents-find", true);
  await preview.setViewportSize({ width: 320, height: 568 });
  const add = preview.getByLabel("Add tags", { exact: true });
  const ids = (await selectOptions(add))
    .map((option) => option.value)
    .filter(Boolean);
  await add.focus();
  for (const id of ids) await selectOption(add, id);
  await expect(add).toBeDisabled();
  const last = preview.locator("[data-remove-tag]").last();
  await expect(last).toBeFocused();
  await last.press("Enter");
  await expect(add).toBeEnabled();
  await expect(preview.locator("[data-remove-tag]")).toHaveCount(
    ids.length - 1,
  );
  await fits(preview);
});

test("preview tiles and touch-sized selects preserve document availability", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-find", true);
  const bike = preview.locator('[data-document="bike"]');
  await expect(bike.locator(".doc-thumbnail img")).toHaveJSProperty(
    "complete",
    true,
  );
  await expect(bike.locator(".doc-thumbnail img")).not.toHaveJSProperty(
    "naturalWidth",
    0,
  );
  await expect(
    preview.locator('[data-document="insurance"] .doc-thumbnail'),
  ).toHaveAttribute("data-preview-status", "unavailable");
  const sort = preview.getByRole("combobox", {
    name: "Sort documents",
    exact: true,
  });
  expect((await sort.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expect(sort.locator("..")).toHaveClass(/situate-select/);
  await info.attach("mobile-document-gallery", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  for (const [mode, text] of [
    ["pending", "Preparing preview"],
    ["unavailable", "No preview"],
    ["error", "Preview unavailable"],
  ] as const) {
    await selectOption(
      page.getByLabel("Document previews", { exact: true }),
      mode,
    );
    await expect(bike.locator(".doc-thumbnail")).toContainText(text);
    await expect(bike.locator(".doc-thumbnail img")).toHaveCount(0);
    await expect(preview.locator(".doc-result")).toHaveCount(10);
  }
  await bike.click();
  await expect(preview.locator(".doc-paper")).toContainText("€86.00");
  await expect(
    page.getByLabel("Document previews", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(bike.locator(".doc-thumbnail img")).toBeVisible();
});

test("failed thumbnail images keep their document readable", async ({
  page,
}) => {
  const preview = await open(page, "documents-find", true);
  const receipt = preview.locator('[data-document="receipt"]');
  await receipt.scrollIntoViewIfNeeded();
  await receipt.locator(".doc-thumbnail img").evaluate((image) => {
    image.setAttribute("src", "data:image/png;base64,AA==");
  });
  await expect(receipt.locator(".doc-thumbnail")).toHaveAttribute(
    "data-preview-status",
    "error",
  );
  await expect(receipt).toContainText("Preview unavailable");
  await expect(preview.locator(".doc-result")).toHaveCount(10);
  await receipt.click();
  await expect(preview.locator(".doc-page-stage img")).toHaveJSProperty(
    "complete",
    true,
  );
  await expect(preview.locator(".doc-page-stage img")).not.toHaveJSProperty(
    "naturalWidth",
    0,
  );
});

test("inline filters survive mobile keyboard changes and reset with the scenario", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-gather", true);
  const match = preview.getByLabel("Documents with", { exact: true });
  await selectOption(match, "any");
  await preview.getByRole("searchbox").fill("Unsent description");
  await page.getByLabel("Keyboard occlusion").check();
  await preview.setViewportSize({ width: 320, height: 568 });
  await expect(match).toHaveAttribute("data-value", "any");
  await expect(preview.getByRole("searchbox")).toHaveValue(
    "Unsent description",
  );
  await match.scrollIntoViewIfNeeded();
  await expect(match).toBeInViewport({ ratio: 1 });
  await selectOption(match, "all");
  await info.attach("compact-inline-filters", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await page.getByLabel("Keyboard occlusion").uncheck();
  await preview.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByRole("searchbox")).toHaveValue("");
  await expect(match).toHaveAttribute("data-value", "all");
  await expect(preview.locator(".doc-result")).toHaveCount(5);
});

test("tag navigation and inline choices share one selection and support empty recovery", async ({
  page,
}) => {
  const preview = await open(page, "documents-gather", false);
  const navigation = await browse(preview);
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    preview.getByRole("button", {
      name: "Remove tag filter: Home",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", {
      name: "Remove tag filter: Tax",
      exact: true,
    }),
  ).toHaveCount(0);
  await selectOption(
    preview.getByLabel("Add tags", { exact: true }),
    "training",
  );
  await selectOption(
    preview.getByLabel("Documents with", { exact: true }),
    "all",
  );
  await expect(
    preview.getByRole("heading", {
      name: "No matching documents",
      exact: true,
    }),
  ).toBeVisible();
  await preview
    .getByRole("button", {
      name: "Remove tag filter: Tax / Expenses / Training",
      exact: true,
    })
    .click();
  await expect(preview.locator('[data-document="bike"]')).toBeVisible();
  await navigation.getByRole("button", { name: /^Without tags/ }).click();
  await expect(preview.locator(".doc-result")).toHaveCount(1);
  await expect(preview.locator('[data-document="untagged"]')).toBeVisible();
  await selectOption(preview.getByLabel("Add tags", { exact: true }), "tax");
  await expect(preview.locator('[data-document="course"]')).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Clear tag filter", exact: true }),
  ).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(`search activity is subtle, respects reduced motion and ends with the search · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const preview = await open(page, "documents-loading", mobile);
    await preview.emulateMedia({ reducedMotion: "no-preference" });
    const spinner = preview.locator(".doc-search-spinner");
    const status = preview.locator(".doc-search-status");
    await expect(status).toHaveText("Searching documents…");
    await expect(preview.locator(".doc-results")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(spinner).toHaveAttribute("aria-hidden", "true");
    await expect(spinner).toHaveCSS("animation-name", "doc-search-spin");
    await expect(spinner).toHaveCSS("width", "12px");
    await expect(spinner).toHaveCSS("height", "12px");
    const angle = await spinner.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await expect
      .poll(() =>
        spinner.evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe(angle);

    await preview.emulateMedia({ reducedMotion: "reduce" });
    await expect(spinner).toHaveCSS("animation-name", "none");
    await expect(status).toHaveText("Searching documents…");
    await expect(preview.locator(".doc-results")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await preview.emulateMedia({ reducedMotion: "no-preference" });
    await expect(spinner).toHaveCSS("animation-name", "doc-search-spin");
    await preview
      .getByRole("button", { name: "Document actions", exact: true })
      .click();
    await expect(spinner).toHaveCSS("animation-play-state", "paused");
    await preview.keyboard.press("Escape");
    await expect(spinner).toHaveCSS("animation-play-state", "running");

    const outcome = page.getByLabel("Search result state", { exact: true });
    await selectOption(outcome, "error");
    await expect(spinner).toHaveCount(0);
    await expect(status).toHaveText("Search failed");
    await selectOption(outcome, "loading");
    await expect(spinner).toBeVisible();
    await selectOption(outcome, "ready");
    await expect(spinner).toHaveCount(0);
    await expect(preview.locator(".doc-results")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(spinner).toBeVisible();
    await preview
      .getByRole("button", { name: "Clear search and filters", exact: true })
      .click();
    await expect(spinner).toHaveCount(0);
    await expect(preview.locator(".doc-result")).toHaveCount(10);
    await selectOption(outcome, "loading");
    await expect(spinner).toBeVisible();
    await selectScenario(page, "documents-find");
    await expect(spinner).toHaveCount(0);
    await expect
      .poll(() =>
        preview.evaluate(() =>
          document
            .getAnimations()
            .some(
              (animation) =>
                (animation as CSSAnimation).animationName === "doc-search-spin",
            ),
        ),
      )
      .toBe(false);
    await fits(preview);
  });
}

test("no matches, inaccessible original, held opening and reset remain distinct", async ({
  page,
}) => {
  const preview = await open(page, "documents-no-results", true);
  await expect(
    preview.getByRole("heading", { name: "No matching documents" }),
  ).toBeVisible();
  await expect(
    preview.getByText("Search results may be incomplete.", { exact: false }),
  ).toBeVisible();
  await selectScenario(page, "documents-unavailable");
  await expect(
    preview.getByRole("heading", { name: "On another device" }),
  ).toBeVisible();
  await expect(preview.locator(".doc-paper")).toHaveCount(0);
  await selectScenario(page, "documents-find");
  await selectOption(page.getByLabel("Next source or opening action"), "wait");
  await preview.locator('[data-document="bike"]').click();
  await expect(
    preview.getByText("Opening document…", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fail document action" }).click();
  await expect(preview.getByRole("alert")).toContainText("could not be opened");
  await preview.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator(".doc-preview")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Complete document action" }),
  ).toHaveCount(0);
});

test("small mobile, keyboard occlusion and dialogs preserve drafts and focus", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-gather", true);
  await preview.setViewportSize({ width: 320, height: 568 });
  await preview.getByRole("searchbox").fill("Keep my search draft");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(preview.getByRole("searchbox")).toHaveValue(
    "Keep my search draft",
  );
  await preview
    .getByRole("button", { name: "Save search", exact: true })
    .click();
  await preview
    .getByLabel("Name", { exact: true })
    .fill("Tax documents for the coming appointment");
  await page.getByLabel("Keyboard occlusion").uncheck();
  await expect(preview.getByLabel("Name", { exact: true })).toHaveValue(
    "Tax documents for the coming appointment",
  );
  await preview.keyboard.press("Escape");
  await expect(
    preview.getByRole("button", { name: "Save search", exact: true }),
  ).toBeFocused();
  await info.attach("small-mobile", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await fits(preview);
});

test("image reading, local tags and pinned searches stay usable on mobile", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-image", true);
  await expect(preview.locator(".doc-page-stage img")).toBeVisible();
  await preview.getByRole("button", { name: "Edit tags", exact: true }).click();
  await preview.getByRole("checkbox", { name: "Home", exact: true }).check();
  await preview
    .getByRole("button", { name: "Apply tags", exact: true })
    .click();
  await expect(
    preview.locator(".doc-metadata .doc-chip").filter({ hasText: /^Home$/ }),
  ).toBeVisible();
  await info.attach("mobile-receipt", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await preview
    .getByRole("button", { name: "Back to documents", exact: true })
    .click();
  const navigation = await browse(preview);
  await expect(
    navigation.getByRole("heading", { name: "Pinned searches", exact: true }),
  ).toBeVisible();
  await navigation
    .getByRole("button", { name: "Unpin Home & repairs", exact: true })
    .click();
  await expect(navigation.locator(".doc-saved-views summary")).toHaveText(
    "Saved searches",
  );
  await expect(
    navigation.getByRole("button", { name: "Pin Home & repairs", exact: true }),
  ).toBeFocused();
  await navigation
    .getByRole("button", { name: "Pin Home & repairs", exact: true })
    .click();
  await expect(
    navigation.getByRole("button", {
      name: "Unpin Home & repairs",
      exact: true,
    }),
  ).toBeFocused();
});

test("a waiting refresh does not turn opening into a false success", async ({
  page,
}) => {
  const preview = await open(page, "documents-sources", false);
  await selectOption(page.getByLabel("Next source or opening action"), "wait");
  await preview
    .locator(".plugin-sources .plugin-row")
    .filter({
      has: preview.getByRole("heading", { name: "Cloud drive", exact: true }),
    })
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Back to documents", exact: false })
    .click();
  await preview.locator('[data-document="bike"]').click();
  await expect(
    preview.getByText("Opening document…", { exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".doc-paper")).toHaveCount(0);
  await expect(page.getByLabel("Search result state")).toBeVisible();
  await page
    .getByRole("button", { name: "Fail document action", exact: true })
    .click();
  await expect(preview.getByRole("alert")).toContainText("could not be opened");
  await page
    .getByRole("button", { name: "Complete document action", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete document action", exact: true }),
  ).toHaveCount(0);
});

test("source development can fail and recover through the plugin chat", async ({
  page,
}) => {
  const preview = await open(page, "documents-empty", true);
  await preview.getByRole("button", { name: /Create a source/ }).click();
  const request = preview.getByRole("textbox", {
    name: "Your request",
    exact: true,
  });
  await expect(request).toHaveValue(/document source/);
  await request.fill("Bring receipts from my archive into Documents.");
  await preview
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fail required checks", exact: true })
    .click();
  await expect(preview.locator(".chat-message.assistant")).toContainText(
    "has not been activated",
  );
  await request.fill("Keep the originals unchanged and try again.");
  await preview
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await page.getByRole("button", { name: "Start checks", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Checks passed; actions still running",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Actions finished; adopt checked changes",
      exact: true,
    })
    .click();
  await preview
    .getByRole("button", { name: "Set up Notes connection", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete connection", exact: true })
    .click();
  await preview.getByRole("button", { name: /Back to assignment/ }).click();
  await preview
    .getByRole("button", { name: "Close development view", exact: true })
    .click();
  await expect(preview.locator(".plugin-sources .plugin-row")).toHaveCount(1);
  await expect(
    preview.getByRole("heading", { name: "Archive documents", exact: true }),
  ).toBeVisible();
  await preview
    .locator(".plugin-sources")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await preview.getByRole("button", { name: /Back to documents/ }).click();
  await expect(preview.locator(".doc-result")).toHaveCount(1);
});
