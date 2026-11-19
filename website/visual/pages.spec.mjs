import assert from "node:assert/strict";
import { once } from "node:events";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createBuildServer } from "../site.mjs";

const { test, expect } = createRequire(
  new URL("../../client/package.json", import.meta.url),
)("@playwright/test");
const build = process.env.WEBSITE_BUILD;
const routes = readdirSync(build, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
  .map((entry) => join(entry.parentPath.slice(build.length), entry.name))
  .map((path) => "/" + path.replace(/^\//, ""))
  .sort();
const references = routes.map((path) =>
  path
    .slice(1)
    .split("/")
    .map((part) =>
      part.replace(/[^a-zA-Z0-9-]/g, (char) =>
        char === "." ? "-" : "-u" + char.codePointAt(0).toString(16) + "-",
      ),
    ),
);
assert.equal(
  new Set(references.map((parts) => parts.join("/"))).size,
  routes.length,
  "Website routes collide in the snapshot names",
);
assert(routes.includes("/index.html"), "Missing built home page");
let server;
let origin;
test.beforeAll(async () => {
  server = createBuildServer(build);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(
  () =>
    new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    }),
);

for (const [index, file] of routes.entries()) {
  const path = file === "/index.html" ? "/" : file;
  test(`full page: ${path}`, async ({ page, context }) => {
    const broken = new Set();
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        broken.add(url.href);
        return route.abort();
      }
      if (url.pathname === "/releases/current/download.json")
        return route.fulfill({
          json: {
            version: "2.4.6",
            url: "https://getsituate.com/releases/2.4.6/Situate.dmg",
            sha256: "12".repeat(32),
            size: 12345678,
            minimumSystemVersion: "12.0",
            architecture: "universal",
            distribution: "direct",
          },
        });
      return route.continue();
    });
    page.on("response", (response) => {
      if (!response.ok()) broken.add(response.url());
    });
    expect((await page.goto(origin + path)).ok()).toBe(true);
    await expect(page.locator("h1")).toBeVisible();
    if (path === "/")
      await expect(
        page.locator('#download a[href$="/Situate.dmg"]'),
      ).toBeAttached();
    const links = await page.evaluate(async () => {
      await document.fonts.ready;
      const images = [...document.images].filter((img) =>
        img.hasAttribute("src"),
      );
      for (const img of images) img.loading = "eager";
      await Promise.all(images.map((img) => img.decode()));
      return [...document.querySelectorAll("a[href]")].map((link) => link.href);
    });
    for (const link of new Set(links)) {
      const url = new URL(link);
      if (url.origin !== origin) continue;
      if (url.hash && url.pathname === path) {
        const id = decodeURIComponent(url.hash.slice(1));
        expect(
          await page.evaluate(
            (target) =>
              !!(
                document.getElementById(target) ||
                document.getElementsByName(target).length
              ),
            id,
          ),
          link,
        ).toBe(true);
        continue;
      }
      const response = await context.request.get(url.href);
      expect(response.ok(), link).toBe(true);
      if (
        url.hash &&
        response.headers()["content-type"]?.startsWith("text/html")
      ) {
        const html = await response.text();
        expect(
          await page.evaluate(
            ({ html, id }) => {
              const doc = new DOMParser().parseFromString(html, "text/html");
              return !!(
                doc.getElementById(id) || doc.getElementsByName(id).length
              );
            },
            { html, id: decodeURIComponent(url.hash.slice(1)) },
          ),
          link,
        ).toBe(true);
      }
      await response.dispose();
    }
    expect([...broken]).toEqual([]);
    await expect(page).toHaveScreenshot(
      [...references[index].slice(0, -1), references[index].at(-1) + ".png"],
      {
        fullPage: true,
      },
    );
  });
}
