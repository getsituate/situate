import { selectOption } from "./select";
import { expect, test, type Locator, type Page } from "./test";

// Chromium's headless default suppresses even CSS-styled scrollbars.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function thumbColor(area: Locator) {
  return area.evaluate((element) =>
    getComputedStyle(element)
      .getPropertyValue("--situate-scrollbar-thumb")
      .trim(),
  );
}

async function paintedThumb(preview: Page, area: Locator) {
  const bounds = (await area.boundingBox())!;
  const png = (await preview.screenshot()).toString("base64");
  return preview.evaluate(
    async ({ bounds, png }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const scale = image.width / innerWidth;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        Math.round((bounds.x + bounds.width - 8) * scale),
        Math.round(bounds.y * scale),
        Math.round(8 * scale),
        Math.floor(Math.min(bounds.height, innerHeight - bounds.y) * scale),
      ).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === 106 && pixels[i + 1] === 92 && pixels[i + 2] === 112)
          count++;
      }
      return count;
    },
    { bounds, png },
  );
}

async function open(page: Page, scenario: string, profile = "mac") {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}&profile=${profile}`,
  );
  const ready = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await ready;
  await preview.setViewportSize({
    width: profile === "mac" ? 1440 : 390,
    height: profile === "mac" ? 900 : 568,
  });
  await expect(preview.locator(".environment-content")).toBeVisible();
  return preview;
}
async function width(sidebar: Locator, expected: number) {
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0))
    .toBe(expected);
}
async function drag(preview: Page, delta: number, release = true) {
  const handle = preview.getByRole("separator", { name: "Resize tag sidebar" });
  const rect = (await handle.boundingBox())!;
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await preview.mouse.move(x, y);
  await preview.mouse.down();
  await preview.mouse.move(x + delta, y + 16, { steps: 8 });
  if (release) await preview.mouse.up();
}

test("tag sidebar resizing preserves filters and drafts, commits on release and supports keyboard bounds", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-gather");
  const sidebar = preview.locator(".doc-library-navigation");
  const separator = preview.getByRole("separator", {
    name: "Resize tag sidebar",
  });
  const query = preview.getByRole("searchbox");
  await query.fill("Unsubmitted description");
  await drag(preview, 120);
  await width(sidebar, 392);
  await expect(separator).toBeFocused();
  await expect(separator).toHaveAttribute("aria-controls", "doc-tag-sidebar");
  await expect(separator).toHaveAttribute("aria-valuenow", "392");
  await expect(query).toHaveValue("Unsubmitted description");
  await expect(preview.locator(".doc-removable-chip")).toHaveCount(2);
  await preview.reload();
  await width(sidebar, 392);
  await expect(query).toHaveValue("Unsubmitted description");
  await separator.press("Home");
  await width(sidebar, 224);
  await separator.press("ArrowRight");
  await width(sidebar, 232);
  await separator.press("Shift+ArrowRight");
  await width(sidebar, 264);
  await separator.press("End");
  await width(sidebar, 480);
  await drag(preview, 200);
  await width(sidebar, 480);
  await drag(preview, -400);
  await width(sidebar, 224);
  await separator.press("Enter");
  await width(sidebar, 272);
  await drag(preview, 80, false);
  await width(sidebar, 352);
  await preview.keyboard.press("Escape");
  await preview.mouse.up();
  await width(sidebar, 272);
  await drag(preview, 120);
  await separator.dblclick();
  await width(sidebar, 272);
  await separator.press("End");
  await info.attach("resized-sidebar", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await width(sidebar, 272);
  await expect(query).toHaveValue("");
});

test("sidebar preference survives responsive clamping, reading, hidden navigation and layout changes", async ({
  page,
}) => {
  const preview = await open(page, "documents-find");
  const sidebar = preview.locator(".doc-library-navigation");
  const separator = preview.getByRole("separator", {
    name: "Resize tag sidebar",
  });
  await separator.press("End");
  await width(sidebar, 480);
  await preview.setViewportSize({ width: 900, height: 900 });
  await expect(preview.locator(".desktop-sidebar")).toBeHidden();
  const available = (await preview.locator(".documents-view").boundingBox())!
    .width;
  await width(sidebar, Math.floor(available) - 568);
  expect(
    (await preview.locator(".doc-collection").boundingBox())!.width,
  ).toBeGreaterThanOrEqual(568);
  await separator.click();
  await separator.press("ArrowRight");
  await preview.setViewportSize({ width: 1440, height: 900 });
  await width(sidebar, 480);
  await preview.locator('[data-document="bike"]').click();
  await width(sidebar, 348);
  await expect(sidebar).toBeVisible();
  expect(
    (await preview.locator(".doc-preview").boundingBox())!.width,
  ).toBeGreaterThanOrEqual(410);
  expect(
    (await preview.locator(".doc-collection").boundingBox())!.width,
  ).toBeGreaterThanOrEqual(390);
  await separator.focus();
  await preview.setViewportSize({ width: 1080, height: 900 });
  await expect(sidebar).toBeHidden();
  await expect(
    preview.getByRole("button", { name: "Browse", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Close document", exact: true })
    .click();
  await preview.setViewportSize({ width: 1440, height: 900 });
  await width(sidebar, 480);
  await separator.focus();
  await preview.setViewportSize({ width: 800, height: 700 });
  await expect(sidebar).toBeHidden();
  await expect(
    preview.getByRole("button", { name: "Browse", exact: true }),
  ).toBeFocused();
  await preview.setViewportSize({ width: 1440, height: 900 });
  await width(sidebar, 480);
  await selectOption(
    page.getByLabel("Navigation approach", { exact: true }),
    "focused",
  );
  await expect(sidebar).toBeHidden();
  await selectOption(
    page.getByLabel("Navigation approach", { exact: true }),
    "library",
  );
  await width(sidebar, 480);
});

for (const profile of ["mac", "ios"]) {
  for (const scenario of [
    "documents-find",
    "documents-preview",
    "settings-formats",
    "ai-providers",
    "files-source",
    "workspaces",
  ]) {
    test(`scrollbars appear only in moving areas without changing layout · ${scenario} · ${profile}`, async ({
      page,
    }) => {
      const preview = await open(page, scenario, profile);
      await preview.setViewportSize({
        width: profile === "mac" ? 1040 : 390,
        height: 420,
      });
      await expect(preview.locator(".desktop-sidebar")).toBeHidden();
      await expect(preview.locator("html")).toHaveClass(/situate-scrollbars/);
      await expect(preview.locator("[data-situate-scrolling]")).toHaveCount(0);
      const count = await preview.evaluate(() => {
        const areas = [
          ...document.querySelectorAll<HTMLElement>("body *"),
        ].filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.getClientRects().length &&
            style.visibility !== "hidden" &&
            ((/auto|scroll/.test(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1) ||
              (/auto|scroll/.test(style.overflowX) &&
                element.scrollWidth > element.clientWidth + 1))
          );
        });
        areas.forEach((element, index) =>
          element.setAttribute("data-test-scroll-area", String(index)),
        );
        return areas.length;
      });
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index++) {
        const area = preview.locator(`[data-test-scroll-area="${index}"]`);
        await expect.poll(() => thumbColor(area)).toBe("transparent");
        const before = await area.evaluate((element) => [
          element.clientWidth,
          element.clientHeight,
        ]);
        await area.evaluate((element) => {
          if (element.scrollHeight > element.clientHeight)
            element.scrollTop = element.scrollTop ? 0 : 100;
          else element.scrollLeft = element.scrollLeft ? 0 : 100;
        });
        await expect(area).toHaveAttribute("data-situate-scrolling", "");
        await expect.poll(() => thumbColor(area)).toBe("#6a5c70");
        expect(
          await area.evaluate((element) => [
            element.clientWidth,
            element.clientHeight,
          ]),
        ).toEqual(before);
        await expect(area).not.toHaveAttribute("data-situate-scrolling", "");
      }
    });
  }
}

for (const profile of ["mac", "ios"]) {
  test(`dynamic dialogs and teleported choices share scrollbar behavior · ${profile}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "documents-new-tag", profile);
    await preview.setViewportSize({
      width: profile === "mac" ? 1040 : 390,
      height: 568,
    });
    const create = preview.getByRole("dialog", {
      name: "New tag",
      exact: true,
    });
    await create
      .getByRole("textbox", { name: "Tag name", exact: true })
      .fill("Planning");
    await create
      .getByRole("combobox", { name: "Parent tag", exact: true })
      .click();
    const popup = preview.getByRole("dialog", {
      name: "Parent tag",
      exact: true,
    });
    const list = popup.getByRole("listbox");
    const area = popup.locator(".select-options");
    await expect(area).not.toHaveAttribute("data-situate-scrolling", "");
    await list.press("End");
    await expect(area).toHaveAttribute("data-situate-scrolling", "");
    await info.attach(`scrolling-options-${profile}`, {
      body: await preview.screenshot(),
      contentType: "image/png",
    });
    await expect(area).not.toHaveAttribute("data-situate-scrolling", "");
    await list.press("Escape");
    await expect(
      create.getByRole("combobox", { name: "Parent tag", exact: true }),
    ).toBeFocused();
    await expect(
      create.getByRole("textbox", { name: "Tag name", exact: true }),
    ).toHaveValue("Planning");
    await preview.setViewportSize({
      width: profile === "mac" ? 1040 : 390,
      height: 360,
    });
    await create
      .getByRole("button", { name: "Create tag", exact: true })
      .focus();
    await expect(
      create.getByRole("button", { name: "Create tag", exact: true }),
    ).toBeFocused();
    await expect(
      create.getByRole("button", { name: "Create tag", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await create.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await create.evaluate((element) => {
      element.scrollTop = element.scrollTop ? 0 : element.scrollHeight;
    });
    await expect(create).toHaveAttribute("data-situate-scrolling", "");
    await expect(create).not.toHaveAttribute("data-situate-scrolling", "");
  });
}

test("wheel and keyboard scrolling reveal native thumbs without hover activation or splitter overlap", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-find");
  await preview.setViewportSize({ width: 1040, height: 560 });
  const scroll = preview.locator(".doc-sidebar-scroll");
  const separator = preview.getByRole("separator", {
    name: "Resize tag sidebar",
  });
  await expect(scroll).not.toHaveAttribute("data-situate-scrolling", "");
  await scroll.hover();
  await expect(scroll).not.toHaveAttribute("data-situate-scrolling", "");
  expect(await paintedThumb(preview, scroll)).toBe(0);
  await preview.mouse.wheel(0, 140);
  await expect(scroll).toHaveAttribute("data-situate-scrolling", "");
  expect(await paintedThumb(preview, scroll)).toBeGreaterThan(100);
  expect((await separator.boundingBox())!.x).toBeGreaterThanOrEqual(
    (await scroll.boundingBox())!.x + (await scroll.boundingBox())!.width,
  );
  await info.attach("scrolling-sidebar", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
  await drag(preview, 40, false);
  await expect(scroll).not.toHaveAttribute("data-situate-scrolling", "");
  await preview.mouse.up();
  await expect(scroll).not.toHaveAttribute("data-situate-scrolling", "");
  expect(await paintedThumb(preview, scroll)).toBe(0);
  const results = preview.locator(".doc-collection");
  await results.locator(".doc-results button").first().focus();
  await expect(results).not.toHaveAttribute("data-situate-scrolling", "");
  await preview.keyboard.press("End");
  await expect(results).toHaveAttribute("data-situate-scrolling", "");
  await expect(results).not.toHaveAttribute("data-situate-scrolling", "");
});

test("horizontal document scrolling uses the same temporary thumb without scrolling its parent", async ({
  page,
}) => {
  const preview = await open(page, "documents-image", "ios");
  await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
  const stage = preview.locator(".doc-page-stage");
  const parent = preview.locator(".doc-preview-scroll");
  await expect(stage).not.toHaveAttribute("data-situate-scrolling", "");
  await expect(parent).not.toHaveAttribute("data-situate-scrolling", "");
  expect(
    await stage.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await stage.evaluate((element) => {
    element.scrollLeft = 50;
  });
  await expect(stage).toHaveAttribute("data-situate-scrolling", "");
  await expect(parent).not.toHaveAttribute("data-situate-scrolling", "");
  await expect(stage).not.toHaveAttribute("data-situate-scrolling", "");
});

test("forced colors retains native scrollbars and reduced motion requires no animated scrolling", async ({
  page,
}) => {
  const preview = await open(page, "documents-find");
  await preview.emulateMedia({
    forcedColors: "active",
    reducedMotion: "reduce",
  });
  const scroll = preview.locator(".doc-sidebar-scroll");
  await expect
    .poll(() =>
      scroll.evaluate((element) => getComputedStyle(element).scrollbarColor),
    )
    .toBe("auto");
  await expect
    .poll(() =>
      scroll.evaluate((element) => getComputedStyle(element).scrollBehavior),
    )
    .toBe("auto");
});
