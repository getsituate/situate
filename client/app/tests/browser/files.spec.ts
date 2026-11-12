import { expect, test, keyLabel, type Page } from "./test";
import { filesFixture } from "./files-fixture";
import { expectDialogTypography } from "./dialog-typography";

async function enterFiles(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".topic-window")).toBeVisible();
  const navigation = page.getByRole("button", {
    name: keyLabel("navigation.openNavigation"),
    exact: true,
  });
  if (await navigation.isVisible()) await navigation.click();
  await page
    .getByRole("button", { name: keyLabel("navigation.files"), exact: true })
    .click();
  const expand = page.getByRole("button", {
    name: keyLabel("files.expandFileBrowser"),
    exact: true,
  });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole("button", { name: "Garden.md", exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) >= 1184 && (await expand.isVisible()))
    await expand.click();
}
async function fileMode(
  page: Page,
  name: "Read" | "Edit source",
): Promise<void> {
  await page
    .getByRole("button", { name: keyLabel("files.fileActions"), exact: true })
    .click();
  await page
    .getByRole("menuitemradio", {
      name:
        name === "Edit source"
          ? /^⟦files\.(editSource|viewSource)⟧$/u
          : keyLabel("files.read"),
      exact: true,
    })
    .click();
}
async function source(page: Page) {
  await fileMode(page, "Edit source");
  return page.getByRole("textbox", {
    name: keyLabel("files.markdownSource"),
    exact: true,
  });
}
async function browse(page: Page): Promise<void> {
  if (
    !(await page
      .getByRole("searchbox", { name: keyLabel("files.findAFileDetail") })
      .isVisible())
  )
    await page
      .getByRole("button", {
        name: keyLabel("files.expandFileBrowser"),
        exact: true,
      })
      .click();
}
async function deletedFiles(page: Page): Promise<void> {
  await browse(page);
  await page
    .getByRole("button", {
      name: keyLabel("files.newFileOrFolder"),
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: keyLabel("files.deletedFiles"),
      exact: true,
    })
    .click();
}
async function noOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`opening an uncached file shows loading at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await filesFixture(page);
    await enterFiles(page);
    await browse(page);
    await page.evaluate(() => window.__filesTest.holdRead("Notes/Reading.md"));
    await page.getByRole("button", { name: "Reading.md", exact: true }).click();
    const document = page.locator(".document-pane");
    await expect(document.getByRole("status")).toHaveText(
      keyLabel("files.loadingDocument"),
    );
    await expect(document).toHaveAttribute("aria-busy", "true");
    await expect(document).not.toContainText(
      keyLabel("files.yourFilesInPlace"),
    );
    await page.evaluate(() => window.__filesTest.releaseRead());
    await expect(document.getByRole("status")).toHaveCount(0);
    await expect(document).not.toHaveAttribute("aria-busy", "true");
    await expect(
      document.getByRole("heading", { name: "Reading list", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
  });

  test(`new file names default to Markdown at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await filesFixture(page);
    await enterFiles(page);
    for (const [name, expected] of [
      ["Planting plan", "Planting plan.md"],
      ["Book list.markdown", "Book list.markdown"],
    ] as const) {
      await browse(page);
      await page
        .getByRole("button", { name: keyLabel("files.newFileOrFolder") })
        .click();
      await page
        .getByRole("menuitem", {
          name: keyLabel("files.newFileDetail"),
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog", {
        name: keyLabel("files.newFile"),
        exact: true,
      });
      await expectDialogTypography(dialog);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      await expectDialogTypography(dialog, 32);
      const filename = dialog.getByRole("textbox", {
        name: keyLabel("files.fileName"),
      });
      await filename.focus();
      await expect(filename).toBeFocused();
      await expect(filename).toBeInViewport();
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => {
        document.documentElement.style.removeProperty("font-size");
      });
      await filename.fill(name);
      await dialog
        .getByRole("button", {
          name: keyLabel("files.createFile"),
          exact: true,
        })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__filesTest.calls
                .filter((call) => call.operation === "create")
                .at(-1)?.path,
          ),
        )
        .toBe(expected);
      await expect(page.locator(".document-location h3")).toHaveText(
        expected.split("/").at(-1)!,
      );
      await expect(
        page.getByRole("textbox", { name: keyLabel("files.markdownSource") }),
      ).toBeEditable();
    }
    await expect(page.locator(".source-hint")).toHaveCount(0);
    await noOverflow(page);
  });

  test(`history inspection returns to an unselected current file at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await filesFixture(page);
    await enterFiles(page);
    const input = await source(page);
    const currentText = await input.inputValue();
    await expect(
      page.getByText("Markdown source · changes save automatically", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: keyLabel("files.versionHistory"),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("group", { name: keyLabel("files.fileHistory") }),
    ).not.toContainText("retained-revision");
    await page.getByRole("button", { name: /Add a reading corner/ }).click();
    await expect(input).toHaveValue("# Earlier garden\n\nA quiet corner.");
    await expect(input).toHaveAttribute("readonly");
    await expect(page.locator(".source-hint")).toHaveCount(0);
    await expect(page.locator(".files-pane")).not.toContainText(
      "retained-revision",
    );
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`files-history-source-${viewport.width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: keyLabel("files.versionHistory"),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: /Add a reading corner/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", {
        name: keyLabel("files.closeHistory"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: keyLabel("files.compareWithCurrent") })
      .click();
    await expect(page.locator(".revision-comparison")).toContainText(
      "# Earlier garden",
    );
    await expect(page.locator(".revision-comparison")).toContainText(
      "# A small garden",
    );
    await expect(page.locator(".files-pane")).not.toContainText(
      "retained-revision",
    );
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`files-history-comparison-${viewport.width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: keyLabel("files.returnToCurrentFile") })
      .click();
    await expect(input).toHaveValue(currentText);
    await expect(input).toBeEditable();
    await page
      .getByRole("button", {
        name: keyLabel("files.versionHistory"),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: /Add a reading corner/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.locator('.versions button[aria-pressed="true"]'),
    ).toHaveCount(0);
  });
}

test("rendered text opens source at its block without saving, while selection and links remain passive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  await page
    .getByRole("heading", { name: "A small garden", exact: true })
    .click();
  const input = page.getByRole("textbox", {
    name: keyLabel("files.markdownSource"),
    exact: true,
  });
  await expect(input).toBeEditable();
  await expect(input).toBeFocused();
  const text = await input.inputValue();
  expect(
    await input.evaluate(
      (element: HTMLTextAreaElement) => element.selectionStart,
    ),
  ).toBe(text.indexOf("# A small garden"));
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.some((call) =>
        ["save", "stage"].includes(call.operation),
      ),
    ),
  ).toBe(false);
  await fileMode(page, "Read");
  const paragraph = page.locator(".markdown p").first();
  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(input).toHaveCount(0);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByRole("link", { name: "Garden guide", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__filesTest.calls.some(
          (call) =>
            call.operation === "openExternal" &&
            call.href === "https://example.org/gardens",
        ),
      ),
    )
    .toBe(true);
  await expect(input).toHaveCount(0);
});

test("contextual creation and separate rename and duplicate actions preserve the open file", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  await page.getByRole("button", { name: "Reading.md", exact: true }).hover();
  await page
    .getByRole("button", {
      name: keyLabel("files.actionsFor", { name: "Notes/Reading.md" }),
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: keyLabel("files.renameDetail"),
      exact: true,
    })
    .click();
  const rename = page.getByRole("dialog", {
    name: keyLabel("files.rename"),
    exact: true,
  });
  await rename
    .getByRole("textbox", { name: keyLabel("files.newName"), exact: true })
    .fill("Book list.md");
  await rename
    .getByRole("button", { name: keyLabel("files.rename"), exact: true })
    .click();
  await expect(rename).toHaveCount(0);
  await expect(page.locator(".document-location h3")).toHaveText("Garden.md");
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.find((call) => call.operation === "rename"),
    ),
  ).toMatchObject({
    path: "Notes/Reading.md",
    destination: "Notes/Book list.md",
  });
  await page.getByRole("button", { name: "Book list.md", exact: true }).hover();
  await page
    .getByRole("button", {
      name: keyLabel("files.actionsFor", { name: "Notes/Book list.md" }),
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: keyLabel("files.duplicateDetail"),
      exact: true,
    })
    .click();
  const duplicate = page.getByRole("dialog", {
    name: keyLabel("files.duplicate"),
    exact: true,
  });
  await duplicate
    .getByRole("textbox", {
      name: keyLabel("files.destinationPath"),
      exact: true,
    })
    .fill("Notes/Weekend.md");
  await duplicate
    .getByRole("button", { name: keyLabel("files.duplicate"), exact: true })
    .click();
  await expect(duplicate).toHaveCount(0);
  await expect(page.locator(".document-location h3")).toHaveText("Garden.md");
  await page
    .getByRole("button", { name: "Book list.md", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", {
      name: keyLabel("files.newFileDetail"),
      exact: true,
    })
    .click();
  await expect(page.locator(".document-location h3")).toHaveText("Garden.md");
  const create = page.getByRole("dialog", {
    name: keyLabel("files.newFile"),
    exact: true,
  });
  await create
    .getByRole("textbox", { name: keyLabel("files.fileName"), exact: true })
    .fill("Companion");
  await create
    .getByRole("button", { name: keyLabel("files.createFile"), exact: true })
    .click();
  await expect(create).toHaveCount(0);
  await expect(page.locator(".document-location h3")).toHaveText(
    "Companion.md",
  );
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.find((call) => call.operation === "create"),
    ),
  ).toMatchObject({ path: "Notes/Companion.md" });
});

test("root folder creation and moving the open file update its location without changing its content", async ({
  page,
}) => {
  await filesFixture(page);
  await enterFiles(page);
  const original = await (await source(page)).inputValue();
  await page
    .getByRole("button", {
      name: keyLabel("files.newFileOrFolder"),
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: keyLabel("files.newFolderDetail"),
      exact: true,
    })
    .click();
  const folder = page.getByRole("dialog", {
    name: keyLabel("files.newFolder"),
    exact: true,
  });
  await folder
    .getByRole("textbox", { name: keyLabel("files.folderName"), exact: true })
    .fill("Projects");
  await folder
    .getByRole("button", { name: keyLabel("files.createFolder"), exact: true })
    .click();
  await expect(folder).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: keyLabel("files.fileActions"), exact: true })
    .click();
  await page
    .getByRole("menuitem", {
      name: keyLabel("files.moveToDetail"),
      exact: true,
    })
    .click();
  const move = page.getByRole("dialog", {
    name: keyLabel("files.moveTo"),
    exact: true,
  });
  await move
    .getByRole("textbox", {
      name: keyLabel("files.destinationFolder"),
      exact: true,
    })
    .fill("Projects");
  await move
    .getByRole("button", { name: keyLabel("files.move"), exact: true })
    .click();
  await expect(move).toHaveCount(0);
  await expect(page.locator(".document-location p")).toHaveText("Projects");
  await expect(
    page.getByRole("textbox", {
      name: keyLabel("files.markdownSource"),
      exact: true,
    }),
  ).toHaveValue(original);
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.filter((call) => call.operation === "mkdir"),
    ),
  ).toMatchObject([{ path: "Projects" }]);
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.filter((call) => call.operation === "rename"),
    ),
  ).toMatchObject([
    { path: "Notes/Garden.md", destination: "Projects/Garden.md" },
  ]);
});

for (const width of [1440, 390]) {
  test(`workspace navigation remains reachable from Files at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await filesFixture(page);
    await enterFiles(page);
    const input = await source(page);
    const original = await input.inputValue();
    if (width > 600)
      await page
        .getByRole("button", {
          name: keyLabel("navigation.collapseSidebar"),
          exact: true,
        })
        .click();
    await page
      .getByRole("button", {
        name: keyLabel("navigation.openNavigation"),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: keyLabel("navigation.files"),
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    if (width < 600)
      await page
        .getByRole("button", {
          name: keyLabel("navigation.closeNavigation"),
          exact: true,
        })
        .click();
    await expect(input).toHaveValue(original);
    expect(
      await page.evaluate(() =>
        window.__filesTest.calls.filter((call) => call.operation === "save"),
      ),
    ).toHaveLength(0);
  });
}

test("silent merged content preserves live caret and explicit historical inspection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  const input = await source(page);
  await page.evaluate(() =>
    window.__filesTest.setMerged("# Local\n\nAn external addition."),
  );
  await input.fill("# Local");
  await input.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(3, 3),
  );
  await expect(input).toHaveValue("# Local\n\nAn external addition.");
  await expect(input).toBeFocused();
  expect(
    await input.evaluate(
      (element: HTMLTextAreaElement) => element.selectionStart,
    ),
  ).toBe(3);
  await expect(page.locator('[role="alert"], [role="status"]')).toHaveCount(0);
  await page
    .getByRole("button", {
      name: keyLabel("files.versionHistory"),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /Add a reading corner/ }).click();
  await expect(input).toHaveValue("# Earlier garden\n\nA quiet corner.");
  await page.evaluate(() =>
    window.__filesTest.external("Notes/Garden.md", "# External current"),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__filesTest.calls.filter((call) => call.operation === "read")
            .length,
      ),
    )
    .toBeGreaterThan(1);
  await expect(input).toHaveValue("# Earlier garden\n\nA quiet corner.");
  await page
    .getByRole("button", { name: keyLabel("files.compareWithCurrent") })
    .click();
  await expect(page.locator(".revision-comparison")).toContainText(
    "# External current",
  );
  await expect(page.locator(".revision-comparison")).toContainText(
    "# Earlier garden",
  );
  await page
    .getByRole("button", { name: keyLabel("files.returnToCurrentFile") })
    .click();
  await expect(input).toHaveValue("# External current");
  await page
    .getByRole("button", {
      name: keyLabel("files.versionHistory"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: /Add a reading corner/ }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("a late revision reply cannot undo returning to the current file", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  const input = await source(page);
  const currentText = await input.inputValue();
  await page
    .getByRole("button", {
      name: keyLabel("files.versionHistory"),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /Add a reading corner/ }).click();
  await expect(input).toHaveAttribute("readonly");
  await page
    .getByRole("button", { name: keyLabel("files.returnToCurrentFile") })
    .click();
  await expect(input).toBeEditable();
  await page
    .getByRole("button", {
      name: keyLabel("files.versionHistory"),
      exact: true,
    })
    .click();
  await page.evaluate(() => window.__filesTest.holdRevision());
  await page.getByRole("button", { name: /Add a reading corner/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__filesTest.calls.filter(
            (call) => call.operation === "revision",
          ).length,
      ),
    )
    .toBe(2);
  await page.getByRole("button", { name: keyLabel("layoutUi.back") }).click();
  await page.evaluate(async () => {
    window.__filesTest.releaseRevision();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
  await expect(input).toHaveValue(currentText);
  await expect(input).toBeEditable();
  await expect(
    page.getByRole("button", { name: keyLabel("files.returnToCurrentFile") }),
  ).toHaveCount(0);
});

test("history hides generated commit references without changing hashes in document content", async ({
  page,
}) => {
  const revision = "0123456789abcdef0123456789abcdef01234567";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page, { historyMessage: `Reverse change ${revision}` });
  await enterFiles(page);
  const input = await source(page);
  const text = `${await input.inputValue()}\nRelease commit: ${revision}\n`;
  await input.fill(text);
  await expect(
    page.getByText(keyLabel("files.saved"), { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: keyLabel("files.versionHistory"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("group", { name: keyLabel("files.fileHistory") }),
  ).not.toContainText(revision);
  await page
    .getByRole("button", { name: keyLabel("files.closeHistory"), exact: true })
    .click();
  await expect(input).toHaveValue(text);
});

test("history action confirmations and recovery errors hide internal revision IDs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  await page
    .getByRole("button", {
      name: keyLabel("files.versionHistory"),
      exact: true,
    })
    .click();
  const version = page
    .locator(".version-entry")
    .filter({ hasText: "Add a reading corner" });
  await version
    .getByRole("button", { name: keyLabel("files.copyVersion"), exact: true })
    .click();
  const copy = page.getByRole("dialog", {
    name: keyLabel("files.copyHistoricalVersion"),
    exact: true,
  });
  await expect(copy).not.toContainText("retained-revision");
  await copy
    .getByRole("textbox", { name: keyLabel("files.destinationPath") })
    .fill("Notes/Reading corner.md");
  await copy
    .getByRole("button", {
      name: keyLabel("files.copyHistoricalVersion"),
      exact: true,
    })
    .click();
  await expect(copy.getByRole("alert")).toContainText(
    keyLabel("native.content.destination.occupied"),
  );
  await expect(copy).not.toContainText("retained-revision");
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.find(
        (call) => call.operation === "historicalCopy",
      ),
    ),
  ).toMatchObject({
    revision: "retained-revision",
    destination: "Notes/Reading corner.md",
  });
  await copy
    .getByRole("button", { name: keyLabel("navigation.cancel"), exact: true })
    .click();
  await version
    .getByRole("button", { name: keyLabel("files.reverseChange"), exact: true })
    .click();
  const reverse = page.getByRole("dialog", {
    name: keyLabel("files.reverseThisChange"),
    exact: true,
  });
  await expect(reverse).not.toContainText("retained-revision");
  await reverse
    .getByRole("button", {
      name: keyLabel("files.reverseThisChange"),
      exact: true,
    })
    .click();
  await expect(reverse.getByRole("alert")).toContainText(
    keyLabel("native.content.destination.occupied"),
  );
  await expect(reverse).not.toContainText("retained-revision");
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.find((call) => call.operation === "revert"),
    ),
  ).toMatchObject({ revision: "retained-revision" });
});

test("read-only providers allow source inspection and no mutation controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await filesFixture(page, { writable: false, mobile: true });
  await enterFiles(page);
  const input = await source(page);
  await expect(input).toHaveAttribute("readonly");
  await expect(
    page.getByText(keyLabel("native.files.provider.readOnly")),
  ).toBeVisible();
  await browse(page);
  await page
    .getByRole("button", { name: keyLabel("files.newFileOrFolder") })
    .click();
  await expect(
    page.getByRole("menuitem", {
      name: keyLabel("files.newFileDetail"),
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", {
      name: keyLabel("files.newFolderDetail"),
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", {
      name: keyLabel("files.actionsFor", { name: "Notes/Garden.md" }),
    })
    .click();
  const actions = page.getByRole("menu", {
    name: keyLabel("files.fileActions"),
  });
  for (const name of [
    keyLabel("files.renameDetail"),
    keyLabel("files.moveToDetail"),
    keyLabel("files.duplicateDetail"),
    keyLabel("files.deleteDetail"),
  ])
    await expect(
      actions.getByRole("menuitem", { name, exact: true }),
    ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.some((call) =>
        ["save", "stage", "create", "mkdir"].includes(call.operation),
      ),
    ),
  ).toBe(false);
});

test("deleted files and occupied restoration failures remain explicit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  await browse(page);
  await deletedFiles(page);
  const deleted = page.getByRole("dialog", {
    name: keyLabel("files.deletedFiles"),
    exact: true,
  });
  await expect(deleted).toContainText("Notes/Old garden.md");
  await deleted
    .getByRole("button", { name: keyLabel("files.restoreSameFile") })
    .click();
  const restore = page.getByRole("dialog", {
    name: keyLabel("files.restoreDeletedFile"),
    exact: true,
  });
  await expect(
    restore.getByRole("textbox", { name: keyLabel("files.destinationPath") }),
  ).toHaveValue("Notes/Old garden.md");
  await restore
    .getByRole("button", {
      name: keyLabel("files.restoreDeletedFile"),
      exact: true,
    })
    .click();
  await expect(restore.getByRole("alert")).toContainText(
    keyLabel("native.content.destination.occupied"),
  );
  await expect(restore).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.find((call) => call.operation === "restore"),
    ),
  ).toMatchObject({
    path: "Notes/Old garden.md",
    revision: "retained-revision",
    destination: "Notes/Old garden.md",
  });
});

test("system ID changes require explicit confirmation without altering unknown metadata", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  const input = await source(page);
  const original = await input.inputValue();
  const changed = original.replace(
    "90c830ce-e6b7-4e27-a6bf-754587491492",
    "changed-id",
  );
  await input.fill(changed);
  const dialog = page.getByRole("dialog", {
    name: keyLabel("files.changeSystemManagedIDs"),
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    keyLabel("files.changingOrRemovingAnIDCanBreakExistingReferences"),
  );
  await dialog
    .getByRole("button", { name: keyLabel("files.changeIDsAndSave") })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(input).toHaveValue(changed);
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls
        .filter((call) => call.operation === "save")
        .at(-1),
    ),
  ).toMatchObject({ confirmIdChange: true, text: changed });
});

test("deleted-draft copies identify their source and retain it on incomplete history recording", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  await page.evaluate(() => window.__filesTest.setDeleted(true));
  const input = await source(page);
  await input.fill("# Retained deleted draft");
  const dialog = page.getByRole("dialog", {
    name: keyLabel("files.thisFileWasDeleted"),
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: keyLabel("files.newFilePath") })
    .fill("Notes/New garden");
  await dialog
    .getByRole("button", { name: keyLabel("files.saveAsNewFile") })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    keyLabel("native.content.history.fileChanged"),
  );
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.find((call) => call.operation === "create"),
    ),
  ).toMatchObject({
    path: "Notes/Garden.md",
    destination: "Notes/New garden.md",
    text: "# Retained deleted draft",
  });
  expect(
    await page.evaluate(() =>
      window.__filesTest.calls.some((call) => call.operation === "discard"),
    ),
  ).toBe(false);
  await dialog
    .getByRole("button", { name: keyLabel("files.closeDialog"), exact: true })
    .click();
  await expect(input).toHaveValue("# Retained deleted draft");
});

test("deleted history uses a revision seed and exact historical paths, with explicit tombstones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filesFixture(page);
  await enterFiles(page);
  await browse(page);
  await deletedFiles(page);
  await page
    .getByRole("dialog", { name: keyLabel("files.deletedFiles"), exact: true })
    .getByRole("button", { name: keyLabel("files.history"), exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__filesTest.calls.find((call) => call.operation === "history"),
      ),
    )
    .toMatchObject({
      path: "Notes/Old garden.md",
      revision: "retained-revision",
      exactPath: true,
    });
  const tombstone = page
    .locator(".version-entry")
    .filter({ hasText: keyLabel("files.deleted") })
    .filter({ hasText: "Remove note" });
  await expect(
    tombstone.getByRole("button", { name: keyLabel("files.copyVersion") }),
  ).toBeDisabled();
  await expect(
    tombstone.getByRole("button", { name: keyLabel("files.reverseChange") }),
  ).toBeEnabled();
  await tombstone
    .getByRole("button", {
      name: new RegExp(`${keyLabel("files.deleted")}.*Remove note`, "u"),
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: keyLabel("files.fileDeletedInThisChange"),
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: keyLabel("files.versionHistory"),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /Add a reading corner/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__filesTest.calls.find((call) => call.operation === "revision"),
      ),
    )
    .toMatchObject({
      path: "Archive/Old garden.md",
      revision: "retained-revision",
      exactPath: true,
    });
  await source(page);
  await expect(
    page.getByRole("textbox", { name: keyLabel("files.markdownSource") }),
  ).toHaveValue("# Earlier garden\n\nA quiet corner.");
});
