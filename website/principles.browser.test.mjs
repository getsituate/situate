import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

export function checkPrinciples(browser, origin, inspect) {
  return test("Principles page and example note", async () => {
    for (const width of [1280, 768, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 850 },
        javaScriptEnabled: width !== 320,
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        if (width === 1280) {
          await page.goto(`${origin}/product.html`);
          await page
            .locator("#choices")
            .getByRole("link", { name: "Read our principles" })
            .click();
          await page.waitForURL(`${origin}/principles.html`);
        } else {
          await page.goto(`${origin}/principles.html`);
        }
        await inspect(page, `principles/${width}`);
        assert.equal(
          await page.getByRole("heading", { level: 1 }).innerText(),
          "Your work stays yours.",
        );
        assert.equal(
          await page.locator(".site-footer [aria-current=page]").innerText(),
          "Principles",
        );
        assert.equal(
          await page.locator(".page-progress, [data-motion-scene]").count(),
          0,
        );
        const layout = await page.evaluate(() => {
          const rect = (selector) =>
            document.querySelector(selector).getBoundingClientRect();
          const art = rect(".principles-art");
          const heading = rect(".principles-heading");
          const contents = rect(".principles-nav");
          return {
            artAlongside:
              art.left > heading.right && art.bottom <= contents.top,
            artAfter: art.top > contents.bottom,
            claimsAboveFold: contents.bottom <= innerHeight,
          };
        });
        assert.ok(layout.claimsAboveFold);
        assert.ok(width > 768 ? layout.artAlongside : layout.artAfter);
        const chapterLinks = page.locator(".principles-nav a");
        assert.deepEqual(
          await chapterLinks.evaluateAll((links) =>
            links.map((link) => link.hash),
          ),
          [
            "#your-files",
            "#data-access",
            "#make-it-yours",
            "#open-development",
          ],
        );

        const note = page.getByRole("link", { name: "Download Markdown" });
        await page.keyboard.press("Tab");
        assert.equal(
          await page.locator(":focus").getAttribute("href"),
          "#main",
        );
        await page.keyboard.press("Enter");
        assert.equal(await page.locator(":focus").getAttribute("id"), "main");
        await page.keyboard.press("Tab");
        assert.equal(
          await page.locator(":focus").getAttribute("href"),
          "#your-files",
        );
        await page.keyboard.press("Enter");
        await page.waitForURL(`${origin}/principles.html#your-files`);
        assert.equal(
          await page.locator(":focus").getAttribute("id"),
          "your-files",
        );
        assert.ok(
          await page
            .locator("#your-files h2")
            .evaluate(
              (heading) =>
                heading.getBoundingClientRect().top >=
                document.querySelector(".header").getBoundingClientRect()
                  .bottom,
            ),
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.locator(":focus").getAttribute("download"),
          "weekend-plans.md",
        );

        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.keyboard.press("Enter"),
        ]);
        assert.ok(await note.isVisible());
        assert.equal(
          download.suggestedFilename(),
          await page.locator(".principles-note figcaption code").innerText(),
        );
        assert.equal(
          await readFile(await download.path(), "utf8"),
          (await page.locator(".principles-note pre").textContent()) + "\n",
        );
      } finally {
        await context.close();
      }
    }
  });
}
