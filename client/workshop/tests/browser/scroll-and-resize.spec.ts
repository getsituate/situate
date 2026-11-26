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

test("wheel and keyboard scrolling reveal document result scrollbars", async ({
  page,
}, info) => {
  const preview = await open(page, "documents-find");
  await preview.setViewportSize({ width: 1040, height: 560 });
  const results = preview.locator(".doc-collection");
  await results.hover();
  await expect(results).not.toHaveAttribute("data-situate-scrolling", "");
  await preview.mouse.wheel(0, 140);
  await expect(results).toHaveAttribute("data-situate-scrolling", "");
  expect(await paintedThumb(preview, results)).toBeGreaterThan(0);
  await info.attach("scrolling-documents", {
    body: await preview.screenshot(),
    contentType: "image/png",
  });
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
  const scroll = preview.locator(".doc-results");
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
