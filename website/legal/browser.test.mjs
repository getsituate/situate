import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { createPreviewServer } from "../site.mjs";
import { renderLegalPage } from "./render.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.WEBSITE_PLAYWRIGHT_MODULE ||
    process.env.PLAYWRIGHT_MODULE ||
    "../../client/node_modules/playwright",
);
const content = resolve(process.argv[2] || "website/legal");
const pages = JSON.parse(await readFile(join(content, "pages.json"), "utf8"));
const messages = JSON.parse(
  await readFile(join(content, "messages.en.json"), "utf8"),
);
const shared = JSON.parse(
  await readFile(new URL("../messages.en.json", import.meta.url), "utf8"),
);
const sample = {
  id: "test",
  path: "/test.html",
  titleKey: "title",
  sections: [
    {
      id: "section",
      headingKey: "title",
      blocks: [{ type: "paragraph", key: "body" }],
    },
  ],
};
assert.ok(
  renderLegalPage(sample, {
    ...shared,
    title: "<Title>",
    body: '<script>"&',
  }).includes("&lt;script&gt;&quot;&amp;"),
);
assert.throws(
  () => renderLegalPage(sample, { ...shared, title: "Title" }),
  /Missing translation/,
);
const unsafe = structuredClone(sample);
unsafe.sections[0].blocks = [
  { type: "link", key: "title", href: "javascript:alert(1)" },
];
assert.throws(
  () => renderLegalPage(unsafe, { ...shared, title: "Title" }),
  /Unsupported link/,
);
const server = createPreviewServer({ legalDirectory: content });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const proofs = await mkdtemp(join(tmpdir(), "situate-legal-"));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.WEBSITE_BROWSER_CHANNEL || "chrome",
  });
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const externalRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) externalRequests.push(request.url());
  });
  for (const width of [1440, 960, 390, 320]) {
    await page.setViewportSize({ width, height: width > 960 ? 1000 : 844 });
    for (const document of pages) {
      await page.goto(origin + document.path);
      assert.equal(
        await page.locator("h1").innerText(),
        messages[document.titleKey],
      );
      assert.equal(
        await page.locator("article section").count(),
        document.sections.length,
      );
      assert.deepEqual(
        await page
          .locator("script")
          .evaluateAll((scripts) =>
            scripts.map((script) => script.getAttribute("src")),
          ),
        ["/navigation.js", "/analytics-config.js", "/analytics.js"],
      );
      assert.equal(await page.locator(".motion").count(), 0);
      assert.equal(
        await page.locator("footer [aria-current=page]").getAttribute("href"),
        document.path,
      );
      if (width <= 900) await page.locator(".mobile-menu summary").click();
      assert.ok(
        await page
          .locator('.header nav:visible a[href="/product.html"]')
          .isVisible(),
      );
      assert.equal(await page.locator(".header nav:visible a").count(), 2);
      assert.equal(
        await page.locator(".header [aria-current=page]").count(),
        0,
      );
      await page.locator('.header nav:visible a[href="/product.html"]').click();
      assert.equal(new URL(page.url()).pathname, "/product.html");
      await page.goto(origin + document.path);
      assert.equal(
        await page.locator(".nav-action").getAttribute("href"),
        "/#download",
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      for (const section of document.sections) {
        assert.equal(
          await page.locator(`#${section.id}`).innerText(),
          messages[section.headingKey],
        );
        for (const block of section.blocks) {
          for (const key of block.keys || [block.key])
            assert.ok(
              (await page.locator("article").innerText()).includes(
                messages[key],
              ),
            );
        }
      }
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").getAttribute("class"), "skip");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(":focus").getAttribute("id"), "main");
      await page.keyboard.press("Tab");
      assert.equal(
        await page.locator(":focus").getAttribute("href"),
        `#${document.sections[0].id}`,
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator(":focus").getAttribute("id"),
        document.sections[0].id,
      );
      await page.goto(origin + document.path);
      await page.screenshot({
        path: join(proofs, `${document.id}-${width}.png`),
        fullPage: true,
      });
      await page.screenshot({
        path: join(proofs, `${document.id}-${width}-viewport.png`),
      });
      for (const section of document.sections) {
        await page.locator(`.contents a[href="#${section.id}"]`).click();
        assert.ok(page.url().endsWith(`#${section.id}`));
        assert.ok(
          await page
            .locator(`#${section.id}`)
            .evaluate(
              (element) =>
                element.getBoundingClientRect().top >=
                document.querySelector(".header").getBoundingClientRect()
                  .bottom,
            ),
        );
      }
      await page.locator('footer a[href="#top"]').click();
      assert.equal(await page.evaluate(() => scrollY), 0);
      const other = pages.find((entry) => entry.id !== document.id);
      await page.locator(`footer a[href="${other.path}"]`).click();
      assert.equal(
        await page.locator("h1").innerText(),
        messages[other.titleKey],
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const document of pages) {
    await page.goto(origin + document.path);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".contents").isVisible(), false);
    assert.equal(await page.locator(".header").isVisible(), false);
    assert.equal(
      await page.locator("article section:visible").count(),
      document.sections.length,
    );
    await page.pdf({ path: join(proofs, `${document.id}.pdf`), format: "A4" });
    await page.screenshot({
      path: join(proofs, `${document.id}-print.png`),
      fullPage: true,
    });
    await page.emulateMedia({ media: "screen" });
  }
  await page.goto(origin + "/privacy.html");
  await page.locator(".header .wordmark").click();
  assert.equal(page.url(), origin + "/");
  await page.locator('footer a[href="/privacy.html"]').click();
  assert.equal(new URL(page.url()).pathname, "/privacy.html");
  await page.locator('.header nav:visible a[href="/product.html"]').click();
  assert.equal(new URL(page.url()).pathname, "/product.html");
  await page.locator(".nav-action").click();
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(new URL(page.url()).hash, "#download");
  assert.deepEqual(externalRequests, []);
  const enhanced = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobilePage = await enhanced.newPage();
  const errors = [];
  mobilePage.on("pageerror", (error) => errors.push(error.message));
  for (const document of pages) {
    await mobilePage.goto(origin + document.path);
    await mobilePage.locator(".mobile-menu summary").click();
    await mobilePage.keyboard.press("Escape");
    assert.ok(
      !(await mobilePage
        .locator(".mobile-menu")
        .evaluate((element) => element.open)),
    );
    await mobilePage.locator(".mobile-menu summary").click();
    await mobilePage.locator('.mobile-menu a[href="/product.html"]').click();
    assert.equal(new URL(mobilePage.url()).pathname, "/product.html");
    assert.ok(
      !(await mobilePage.locator(".mobile-menu").evaluate((menu) => menu.open)),
    );
  }
  assert.deepEqual(errors, []);
  await enhanced.close();
  console.log(
    `Passed: escaped content, link safety, exact catalog rendering, 1440/960/390/320px reflow, keyboard skip and anchors, contents links, footer links, no-JS, print CSS/PDF, local home return, no external requests.\nProofs: ${proofs}`,
  );
} finally {
  await browser?.close();
  server.close();
}
