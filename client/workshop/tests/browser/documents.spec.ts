import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

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
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const rect = await page.locator(".documents-view").boundingBox();
  expect(rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}
for (const mobile of [false, true]) {
  const suffix = mobile ? "mobile" : "desktop";
  test(`find a document by description, identifier and typo without choosing a mode · ${suffix}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-find", mobile);
    const errors: string[] = [];
    preview.on("pageerror", (e) => errors.push(e.message));
    const centers = await preview
      .locator(".doc-search-box")
      .evaluate((element) => {
        const input = element.querySelector("input")!.getBoundingClientRect();
        const button = element.querySelector("button")!.getBoundingClientRect();
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
    await expect(preview.locator(".doc-paper")).toContainText("Service record");
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

  test(`refresh updates the current document search · ${suffix}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-gather", mobile);
    await expect(preview.getByRole("searchbox")).toHaveValue("course fee");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await expect(preview.locator('[data-document="course"]')).toBeVisible();
    await preview
      .getByRole("button", {
        name: "Not fully up to date. Review sources.",
        exact: true,
      })
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
    await expect(preview.getByRole("searchbox")).toHaveValue("course fee");
    await expect(preview.locator(".doc-result")).toHaveCount(2);
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

for (const mobile of [false, true]) {
  test(`search preserves the submitted query and drafts through errors · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const preview = await open(page, "documents-find", mobile);
    const query = preview.getByRole("searchbox");
    await query.fill("bicycel repair");
    await query.press("Tab");
    const clear = preview.getByRole("button", {
      name: "Clear search",
      exact: true,
    });
    await expect(clear).toBeFocused();
    await clear.press("Tab");
    const submit = preview.getByRole("button", {
      name: "Search documents",
      exact: true,
    });
    await expect(submit).toBeFocused();
    await submit.press("Enter");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await expect(query).toHaveValue("bicycel repair");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await selectOption(
      page.getByLabel("Search result state", { exact: true }),
      "error",
    );
    await expect(
      preview.getByText(
        "Search could not be completed. Your search has been kept.",
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
  test(`query and result controls stay grouped through resizing · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-gather", mobile);
    const query = preview.getByRole("searchbox");
    await query.fill("Unsubmitted description");
    for (const width of mobile ? [390, 320] : [1920, 1040, 768]) {
      await preview.setViewportSize({ width, height: mobile ? 844 : 900 });
      const { field, submit, collection, view, controls } = await preview
        .locator(".doc-collection")
        .evaluate((element) => {
          const rect = (node: Element) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          };
          return {
            field: rect(element.querySelector('[role="search"]')!),
            submit: rect(
              element.querySelector('.doc-search-box button[type="submit"]')!,
            ),
            collection: rect(element),
            view: rect(element.closest(".documents-view")!),
            controls: [".doc-clear", ".doc-sort"].map((selector) =>
              rect(element.querySelector(selector)!),
            ),
          };
        });
      expect(collection.width).toBeCloseTo(view.width, 0);
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
        expect(rect.height).toBeGreaterThanOrEqual(44);
      }
      await expect(query).toHaveValue("Unsubmitted description");
      await expect(preview.locator(".doc-result")).toHaveCount(1);
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
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await expect(query).toBeFocused();
    await expect(query).toHaveValue("");
    await expect(
      preview.getByRole("button", { name: "Clear search", exact: true }),
    ).toHaveCount(0);
    await expect(preview.locator(".doc-result")).toHaveCount(10);
  });
}

for (const mobile of [false, true]) {
  test(`source review preserves the document search · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-gather", mobile);
    const query = preview.getByRole("searchbox");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await query.fill("Unsubmitted description");
    await expect(query).toHaveValue("Unsubmitted description");
    await preview
      .getByRole("button", {
        name: "Not fully up to date. Review sources.",
        exact: true,
      })
      .click();
    await expect(
      preview.getByRole("heading", { name: /^Sources/ }),
    ).toBeVisible();
    const sources = preview.locator(".plugin-sources .plugin-row");
    await expect(sources).toHaveCount(3);
    await expect(
      sources.getByRole("button", { name: "Refresh", exact: true }),
    ).toHaveCount(3);
    await expect(sources.getByRole("button", { name: /^Browse/ })).toHaveCount(
      0,
    );
    const drive = sources.filter({
      has: preview.getByRole("heading", { name: "Cloud drive", exact: true }),
    });
    await drive.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      preview.getByText("Documents / Shared", { exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Back to plugins", exact: true })
      .click();
    await preview
      .getByRole("button", { name: /Back to documents/ })
      .press("Enter");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await expect(query).toHaveValue("Unsubmitted description");
    await expect(preview.locator(".doc-results-heading h2")).toHaveCount(0);
    for (const width of mobile ? [390, 320] : [1920, 1040, 768]) {
      await preview.setViewportSize({ width, height: mobile ? 844 : 900 });
      await fits(preview);
      await expect(query).toHaveValue("Unsubmitted description");
      await expect(preview.locator(".doc-result")).toHaveCount(1);
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
    await expect(query).toHaveValue("course fee");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
    await preview.reload();
    await expect(preview.locator(".doc-result")).toHaveCount(1);
  });
}

for (const mobile of [false, true]) {
  test(`the collection opens without a duplicate heading and source review preserves the draft · ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const preview = await open(page, "documents-gather", mobile);
    const library = preview.getByRole("main", { name: "Documents" });
    await expect(
      library.getByRole("heading", { name: "Documents", exact: true }),
    ).toHaveCount(0);
    await expect(
      library.getByRole("button", { name: "Document actions", exact: true }),
    ).toHaveCount(0);
    const query = library.getByRole("searchbox");
    await query.fill("Unsubmitted description");
    const reviewSources = library.getByRole("button", {
      name: "Not fully up to date. Review sources.",
      exact: true,
    });
    await reviewSources.press("Enter");
    await expect(
      preview.getByRole("heading", { name: /^Sources/ }),
    ).toBeFocused();
    await preview
      .getByRole("button", { name: /Back to documents/ })
      .press("Enter");
    await expect(reviewSources).toBeFocused();
    await expect(query).toHaveValue("Unsubmitted description");
    await expect(preview.locator(".doc-result")).toHaveCount(1);
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
    if (mobile) {
      const navigation = preview.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      await navigation.click();
      await expect(
        preview.getByRole("dialog", { name: "Workspace navigation" }),
      ).toBeVisible();
      await preview.keyboard.press("Escape");
      await expect(navigation).toBeFocused();
    }
    await preview.getByRole("button", { name: /Create a source/ }).click();
    await expect(
      preview.getByRole("textbox", { name: "Your request", exact: true }),
    ).toBeVisible();
  });
}

test("document header reflows long labels and enlarged text without hiding actions", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-gather", true);
  await preview.setViewportSize({ width: 320, height: 568 });
  await preview.addStyleTag({
    content: `
    .doc-search-box input { font-size: 32px; }
    .doc-results-summary { font-size: 24px; }
    .doc-sort, .doc-freshness { font-size: 28px; }
  `,
  });
  await preview.locator(".doc-freshness span").evaluate((label) => {
    label.textContent = "Some sources haven’t finished updating";
  });
  for (const selector of [
    ".doc-collection",
    ".doc-search",
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
    ".doc-clear",
    '.doc-search-box button[type="submit"]',
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
    await preview.getByLabel("Sort documents", { exact: true }).click();
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
      .getByRole("button", { name: "Clear search", exact: true })
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
  await preview
    .locator(".doc-empty")
    .getByRole("button", {
      name: "Clear search",
    })
    .click();
  await expect(preview.locator("#doc-query")).toBeFocused();
  await expect(preview.locator(".doc-result").first()).toBeVisible();
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

test("mobile keyboard occlusion keeps the search draft and clear action reachable", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-gather", true);
  await preview.setViewportSize({ width: 320, height: 568 });
  await preview.getByRole("searchbox").fill("Keep my search draft");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(preview.getByRole("searchbox")).toHaveValue(
    "Keep my search draft",
  );
  const query = preview.getByRole("searchbox");
  await preview
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await expect(query).toBeFocused();
  await expect(query).toHaveValue("");
  await page.getByLabel("Keyboard occlusion").uncheck();
  await expect(preview.locator(".doc-result")).toHaveCount(10);
  await info.attach("small-mobile", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await fits(preview);
});

test("image reading returns focus to the result on mobile", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-image", true);
  await expect(preview.locator(".doc-page-stage img")).toBeVisible();
  await expect(preview.locator(".doc-preview details")).toContainText(
    "Paperless",
  );
  await info.attach("mobile-receipt", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await preview
    .getByRole("button", { name: "Back to documents", exact: true })
    .click();
  await expect(preview.locator('[data-document="receipt"]')).toBeFocused();
  await expect(preview.getByRole("searchbox")).toBeVisible();
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
