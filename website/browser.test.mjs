import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createPreviewServer } from "./site.mjs";
import { checkWaitlist } from "./waitlist.browser.test.mjs";
import { checkProduct } from "./product.browser.test.mjs";
import { checkDownload } from "./download.browser.test.mjs";
import { checkAnalytics } from "./analytics.browser.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.WEBSITE_PLAYWRIGHT_MODULE ||
    process.env.PLAYWRIGHT_MODULE ||
    "../client/node_modules/playwright",
);
const server = createPreviewServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const proofs = process.env.WEBSITE_SCREENSHOTS
  ? resolve(process.env.WEBSITE_SCREENSHOTS)
  : await mkdtemp(join(tmpdir(), "situate-website-"));
await mkdir(proofs, { recursive: true });
let browser;
let checks = 0;

async function inspect(page, route) {
  await page.evaluate(async () => {
    const images = [...document.images].filter((image) =>
      image.getAttribute("src"),
    );
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
  });
  assert.equal(await page.locator("h1").count(), 1, route);
  assert.ok(!(await page.locator("body").innerText()).includes("{{"), route);
  const result = await page.evaluate(() => ({
    width: innerWidth,
    content: document.documentElement.scrollWidth,
    brokenImages: [...document.images]
      .filter(
        (image) =>
          image.getAttribute("src") &&
          (!image.complete || image.naturalWidth === 0),
      )
      .map((image) => image.src),
    missingTargets: [...document.querySelectorAll('a[href^="#"]')]
      .filter((link) => !document.getElementById(link.hash.slice(1)))
      .map((link) => link.hash),
  }));
  assert.ok(
    result.content <= result.width + 1,
    `${route}: overflow ${result.content}/${result.width}`,
  );
  assert.deepEqual(result.brokenImages, [], route);
  assert.deepEqual(result.missingTargets, [], route);
  const clipped = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "main h1, main h2, main h3, main p, main blockquote, main li",
      ),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          (rect.left < -1 ||
            rect.right > innerWidth + 1 ||
            element.scrollWidth > element.clientWidth + 1)
        );
      })
      .map((element) => element.textContent.trim()),
  );
  assert.deepEqual(clipped, [], `${route}: clipped copy`);
  checks += 1;
}

async function inspectHero(page) {
  assert.equal(await page.locator(".hero-copy > p").count(), 1);
  assert.equal(await page.locator(".hero .eyebrow, .hero-lead").count(), 0);
  assert.deepEqual(await page.locator(".hero-facts li").allTextContents(), [
    "Free app. No limits.",
    "Bring your own AI.",
    "Your files stay yours.",
  ]);
  assert.equal(
    await page.locator(".hero-facts").getAttribute("href"),
    "/product.html",
  );
  assert.match(
    await page.locator(".hero-product").innerText(),
    /notes, tasks and documents/,
  );
  assert.equal(
    await page.locator(".hero-actions .button").getAttribute("href"),
    "#story",
  );
  assert.equal(
    await page.locator(".hero-actions .subtle-link").getAttribute("href"),
    "#download",
  );
  const layout = await page.evaluate(() => {
    const rect = (selector) =>
      document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      width: innerWidth,
      copy: rect(".hero-copy"),
      stage: rect(".hero-stage"),
      ribbon: rect(".ribbon"),
      facts: rect(".hero-facts"),
      overview: rect(".overview"),
      story: rect("#story"),
      height: innerHeight,
    };
  });
  assert.ok(layout.copy.bottom < layout.ribbon.top);
  assert.ok(layout.stage.bottom < layout.ribbon.top);
  assert.ok(layout.facts.height >= 44);
  assert.ok(layout.facts.left >= 0 && layout.facts.right <= layout.width);
  assert.ok(layout.facts.bottom <= layout.height);
  assert.ok(layout.ribbon.bottom <= layout.overview.top);
  assert.ok(layout.overview.bottom <= layout.story.top);
  if (layout.width <= 900) assert.ok(layout.stage.top > layout.copy.bottom);
  const overview = page.locator(".overview");
  assert.deepEqual(
    (await overview.getByRole("heading").allTextContents()).map((text) =>
      text.replace(/\s+/g, " "),
    ),
    [
      "Your files. On your device.",
      "Tools that work your way.",
      "Open formats. No lock-in.",
    ],
  );
  assert.match(await overview.innerText(), /without internet or AI/);
  assert.match(await overview.innerText(), /Ask Situate to adapt/);
  assert.match(await overview.innerText(), /not tied to Situate/);
  assert.match(
    await overview.innerText(),
    /take your files to another app whenever you want/,
  );
  assert.equal(
    await overview.getByRole("link").getAttribute("href"),
    "/product.html",
  );
  checks += 1;
}

async function inspectMotion(page) {
  assert.equal(await page.locator(".motion, .motion-dock").count(), 0);
}

async function inspectHeader(page) {
  const layout = await page.evaluate(() => {
    const header = document.querySelector(".header").getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll(
        ".header .wordmark, .desktop-nav a, .nav-action, .mobile-menu summary",
      ),
    ]
      .map((element) => ({
        label: element.textContent.trim() || "Situate",
        rect: element.getBoundingClientRect().toJSON(),
        clipped: element.scrollWidth > element.clientWidth,
      }))
      .filter(({ rect }) => rect.width > 0);
    return { header: header.toJSON(), controls, width: innerWidth };
  });
  assert.equal(layout.header.x, 0);
  assert.equal(layout.header.width, layout.width);
  for (const [index, control] of layout.controls.entries()) {
    const { rect, label } = control;
    assert.ok(rect.width >= 44 && rect.height >= 44, label);
    assert.ok(rect.x >= 0 && rect.right <= layout.width, label);
    assert.ok(
      rect.y >= layout.header.y && rect.bottom <= layout.header.bottom,
      label,
    );
    assert.ok(!control.clipped, label);
    if (index > 0)
      assert.ok(layout.controls[index - 1].rect.right <= rect.left, label);
  }
}

async function resizeAcrossNavigationBreakpoint(page, size) {
  await page.evaluate(() => {
    window.__navigationBreakpointChanged = false;
    matchMedia("(max-width: 900px)").addEventListener(
      "change",
      () => {
        window.__navigationBreakpointChanged = true;
      },
      { once: true },
    );
  });
  await page.setViewportSize(size);
  await page.waitForFunction(() => window.__navigationBreakpointChanged);
}

async function inspectNavigation(page, size, delayMobileChange = false) {
  if (delayMobileChange) {
    await page.addInitScript(() => {
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const media = nativeMatchMedia(query);
        if (query !== "(max-width: 900px)") return media;
        const addEventListener = media.addEventListener.bind(media);
        media.addEventListener = (type, listener, options) =>
          addEventListener(
            type,
            (event) => {
              if (event.matches)
                window.deliverMobileChange = () => listener.call(media, event);
              else listener.call(media, event);
            },
            options,
          );
        return media;
      };
    });
  }
  await page.goto(origin + "/");
  await inspectHeader(page);
  const menu = page.locator(".mobile-menu");
  const toggle = menu.locator("summary");
  const links = menu.locator("nav");
  assert.deepEqual(await page.locator(".desktop-nav a").allTextContents(), [
    "Home",
    "Product",
  ]);
  assert.deepEqual(await links.locator("a").allTextContents(), [
    "Home",
    "Product",
  ]);
  assert.equal(
    await page.locator('.desktop-nav a[href="/"]').getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    (await page.locator(".nav-action").innerText()).replace(/\s+/g, " "),
    size.width > 900 ? "Download ↓" : "Download",
  );
  if (size.width > 900) {
    assert.ok(await menu.isHidden());
    assert.ok(await page.locator(".desktop-nav").isVisible());
    await page.locator('.desktop-nav a[href="/product.html"]').click();
    await page.waitForURL(origin + "/product.html");
    assert.equal(
      await page
        .locator('.desktop-nav a[href="/product.html"]')
        .getAttribute("aria-current"),
      "page",
    );
    checks += 1;
    return;
  }
  assert.ok(await links.isHidden());
  assert.equal(await toggle.innerText(), "Menu");
  const hero = await page.locator(".hero").boundingBox();
  await toggle.focus();
  await page.keyboard.press("Enter");
  assert.ok(await links.isVisible());
  assert.equal(await toggle.innerText(), "Close");
  assert.deepEqual(await page.locator(".hero").boundingBox(), hero);
  const panel = await links.boundingBox();
  assert.equal(panel.x, 0);
  assert.equal(panel.width, size.width);
  assert.ok(panel.height >= 96 && panel.height <= 128);
  assert.ok(panel.y + panel.height <= size.height);
  const typography = await links.locator("a").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      height: anchor.getBoundingClientRect().height,
      fontSize: getComputedStyle(anchor).fontSize,
      fontFamily: getComputedStyle(anchor).fontFamily,
      headerFontFamily: getComputedStyle(anchor.closest(".header")).fontFamily,
    })),
  );
  for (const link of typography) {
    assert.ok(link.height >= 44);
    assert.equal(link.fontSize, "18px");
    assert.equal(link.fontFamily, link.headerFontFamily);
  }
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").getAttribute("href"), "/");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator(":focus").getAttribute("href"),
    "/product.html",
  );
  await page.screenshot({
    path: join(proofs, `landing-menu-open-${size.width}.png`),
  });
  await page.keyboard.press("Escape");
  assert.ok(await links.isHidden());
  assert.ok(
    await toggle.evaluate((element) => element === document.activeElement),
  );
  await toggle.click();
  await page.mouse.click(size.width / 2, panel.y + panel.height + 20);
  assert.ok(await links.isHidden());
  await toggle.click();
  for (let index = 0; index <= (await links.locator("a").count()); index++)
    await page.keyboard.press("Tab");
  assert.ok(await links.isHidden());
  await toggle.click();
  await page.locator(".nav-action").click();
  assert.ok(await links.isHidden());
  assert.equal(new URL(page.url()).hash, "#download");
  assert.ok(
    await page
      .locator("#download")
      .evaluate(
        (element) =>
          element === document.activeElement &&
          element.getBoundingClientRect().top >=
            document.querySelector(".header").getBoundingClientRect().bottom,
      ),
  );
  await toggle.click();
  await menu.locator('a[href="/product.html"]').focus();
  await resizeAcrossNavigationBreakpoint(page, { width: 1280, height: 800 });
  await page.waitForFunction(() =>
    document.activeElement.closest(".desktop-nav"),
  );
  assert.ok(await menu.isHidden());
  assert.ok(!(await menu.evaluate((element) => element.open)));
  if (delayMobileChange) await page.setViewportSize(size);
  else await resizeAcrossNavigationBreakpoint(page, size);
  await page.waitForFunction(
    () =>
      document.activeElement === document.querySelector(".mobile-menu summary"),
  );
  assert.ok(await links.isHidden());
  await page.keyboard.press("Space");
  assert.ok(await links.isVisible());
  await page.keyboard.press("Tab");
  if (delayMobileChange) {
    await page.waitForFunction(() => window.deliverMobileChange);
    await page.evaluate(() => window.deliverMobileChange());
    assert.ok(await links.isVisible());
  }
  assert.equal(await page.locator(":focus").getAttribute("href"), "/");
  await page.keyboard.press("Tab");
  assert.ok(
    await menu
      .locator('a[href="/product.html"]')
      .evaluate((element) => element === document.activeElement),
  );
  await page.keyboard.press("Enter");
  await page.waitForURL(origin + "/product.html");
  assert.ok(!(await menu.evaluate((element) => element.open)));
  checks += 1;
}

async function inspectNavigationGrowth() {
  const labels = ["Home", "Product", "Guides", "Blog", "About"];
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 960, height: 768 },
    { width: 901, height: 768 },
    { width: 900, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
    { width: 844, height: 390 },
    { width: 568, height: 320 },
    { width: 720, height: 450, deviceScaleFactor: 2 },
    { width: 320, height: 740, javaScriptEnabled: false },
  ]) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      reducedMotion: "reduce",
      deviceScaleFactor: size.deviceScaleFactor || 1,
      javaScriptEnabled: size.javaScriptEnabled !== false,
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/product.html");
      await page.evaluate((labels) => {
        for (const list of document.querySelectorAll(".site-links")) {
          for (const label of labels.slice(2)) {
            const item = list.firstElementChild.cloneNode(true);
            const link = item.querySelector("a");
            link.textContent = label;
            link.href = `/${label.toLowerCase()}.html`;
            link.removeAttribute("aria-current");
            list.append(item);
          }
        }
      }, labels);
      await inspectHeader(page);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const mobile = size.width <= 900;
      const nav = page.locator(mobile ? ".mobile-menu nav" : ".desktop-nav");
      if (mobile) {
        await page.locator(".mobile-menu summary").focus();
        await page.keyboard.press("Enter");
        const box = await nav.boundingBox();
        assert.equal(box.x, 0);
        assert.equal(box.width, size.width);
        assert.ok(box.y + box.height <= size.height);
      } else {
        await page.locator(".header .wordmark").focus();
      }
      for (const label of labels) {
        await page.keyboard.press("Tab");
        assert.equal(await page.locator(":focus").innerText(), label);
        assert.ok(
          await page.locator(":focus").evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const panel = element.closest("nav").getBoundingClientRect();
            return (
              rect.top >= panel.top &&
              rect.bottom <= panel.bottom &&
              rect.left >= panel.left &&
              rect.right <= panel.right &&
              element.scrollWidth <= element.clientWidth &&
              getComputedStyle(element).outlineStyle !== "none"
            );
          }),
          label,
        );
      }
      assert.equal(await page.evaluate(() => scrollY), 0);
      const name = `navigation-five-links-${size.width}x${size.height}${
        size.javaScriptEnabled === false ? "-no-js" : ""
      }`;
      await page.screenshot({ path: join(proofs, `${name}.png`) });
      if (mobile && size.javaScriptEnabled !== false) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() =>
          document.activeElement.closest(".desktop-nav"),
        );
        assert.equal(await page.locator(":focus").innerText(), "About");
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.waitForFunction(
          () =>
            document.activeElement ===
            document.querySelector(".mobile-menu summary"),
        );
        assert.ok(await nav.isHidden());
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
        assert.ok(await nav.isHidden());
      } else if (mobile) {
        await page.locator(".mobile-menu summary").click();
        assert.ok(await nav.isHidden());
      } else {
        await page.keyboard.press("Tab");
        assert.ok(
          await page
            .locator(".nav-action")
            .evaluate((element) => element === document.activeElement),
        );
      }
      assert.deepEqual(errors, []);
      checks += 1;
    } finally {
      await context.close();
    }
  }
}

try {
  browser = await chromium.launch({
    channel: process.env.WEBSITE_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 960, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    const context = await browser.newContext({
      viewport: size,
      reducedMotion: "reduce",
    });
    const route = "/";
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        !(
          response.status() === 404 &&
          response.url() === `${origin}/releases/current/download.json`
        )
      )
        failures.push(`${response.status()} ${response.url()}`);
    });
    page.on("request", (request) =>
      assert.ok(request.url().startsWith(origin), request.url()),
    );
    await page.goto(origin + route);
    await inspect(page, route);
    await inspectHero(page);
    await inspectMotion(page);
    await page.locator(".hero").screenshot({
      path: join(proofs, `landing-hero-${size.width}.png`),
    });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: join(proofs, `landing-${size.width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Tab");
    assert.ok(
      await page
        .locator(".skip")
        .evaluate((element) => element === document.activeElement),
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    await inspect(page, route);
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
      0,
    );
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await inspect(page, route);
    const downloadLink = page.locator(".nav-action");
    await downloadLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash === "#download");
    assert.ok(
      await page
        .getByRole("heading", { name: "Download Situate." })
        .isVisible(),
    );
    assert.equal(
      await page
        .locator('#download .download-button[aria-disabled="true"]')
        .count(),
      1,
    );
    const location = page.url();
    await page
      .locator('.download-button[data-platform="macos"]')
      .evaluate((element) => element.click());
    assert.equal(page.url(), location);
    assert.ok(await page.locator(".screen-viewer").isHidden());
    await page.screenshot({
      path: join(proofs, `landing-downloads-${size.width}.png`),
    });
    checks += 1;
    assert.equal(await page.locator("#questions + #download").count(), 1);
    assert.equal(await page.locator(".ending").count(), 0);
    assert.equal(await page.locator("[data-download-platform]").count(), 5);
    assert.equal(
      await page
        .locator(".download-options img, .download-options svg")
        .count(),
      0,
    );
    assert.equal(await page.locator(".platform-credits").count(), 0);
    await inspectNavigation(page, size);
    assert.deepEqual(failures, [], route);
    await page.close();
    await context.close();
  }
  {
    const size = { width: 390, height: 844 };
    const context = await browser.newContext({
      viewport: size,
      reducedMotion: "reduce",
    });
    try {
      await inspectNavigation(await context.newPage(), size, true);
    } finally {
      await context.close();
    }
  }
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/`);
    await inspectMotion(page);
    await page.screenshot({ path: join(proofs, `landing-opening.png`) });
    await page.waitForTimeout(7100);
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
      (await page
        .locator(".ribbon-track")
        .evaluate((element) =>
          element
            .getAnimations()
            .some((animation) => animation.playState === "running"),
        ))
        ? 1
        : 0,
    );
    await page.screenshot({ path: join(proofs, `landing-settled.png`) });
    await page.locator(".replay").click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => document.querySelector(".replay").disabled,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
      0,
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(
      () => !document.querySelector(".replay").disabled,
    );

    for (const index of [0, 1, 2, 1, 0]) {
      await page
        .locator(".step")
        .nth(index)
        .evaluate((element) => {
          scrollTo({
            top:
              element.getBoundingClientRect().top + scrollY - innerHeight * 0.2,
            behavior: "instant",
          });
        });
      await page.waitForFunction(
        (index) =>
          document.querySelector(".story-stage").dataset.step === String(index),
        index,
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".story-shot.is-current"))
            .opacity === "1" &&
          document
            .querySelector(".story-stage")
            .getAnimations({ subtree: true })
            .every((animation) => animation.playState !== "running"),
      );
      await inspect(page, `landing/chapter-${index}`);
      await page.screenshot({
        path: join(proofs, `landing-chapter-${index}.png`),
      });
    }
    await page.locator(".faq").scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector(".story-bend").getBoundingClientRect()
            .bottom <=
          document.querySelector(".faq").getBoundingClientRect().top,
      ),
    );
    await page.screenshot({ path: join(proofs, "landing-story-end.png") });
    assert.deepEqual(errors, [], "landing");
    await context.close();
    checks += 1;
  }
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(
        () => document.querySelector(".replay").disabled,
      );
      assert.equal(
        await page
          .locator(".hero-stage")
          .evaluate((element) => element.style.getPropertyValue("--opening")),
        "1.0000",
      );
      assert.ok(await page.locator("html.motion-still").count());
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(
        () => !document.querySelector(".replay").disabled,
      );
      assert.equal(await page.locator("html.motion-still").count(), 0);
    }
    await context.close();
    checks += 1;
  }
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await inspectHero(page);
    await page.locator(".hero-facts").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`${origin}/product.html`);
    await page.goBack();
    await page.waitForURL(`${origin}/`);
    await page.locator(".overview").screenshot({
      path: join(proofs, `landing-benefits-${width}.png`),
    });
    await page.locator(".overview-link").focus();
    assert.ok(
      await page
        .locator(".overview-link")
        .evaluate(
          (element) => getComputedStyle(element).outlineStyle !== "none",
        ),
    );
    await page.keyboard.press("Enter");
    await page.waitForURL(`${origin}/product.html`);
    await page.goBack();
    await page.waitForURL(`${origin}/`);
    await page.locator(".hero-actions .button").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash === "#story");
    assert.equal(await page.locator(".step").count(), 3);
    assert.ok(await page.locator("#story").isVisible());
    const opener = page
      .locator(width > 900 ? ".story-shot.is-current a" : ".story-static a")
      .first();
    await opener.click();
    const dialog = page.getByRole("dialog");
    assert.ok(await dialog.isVisible());
    const closeAlignment = await page
      .locator(".viewer-close")
      .evaluate((button) => {
        const centerY = (element) => {
          const rect = element.getBoundingClientRect();
          return rect.y + rect.height / 2;
        };
        return ["span", "svg"].map((selector) =>
          Math.abs(centerY(button.querySelector(selector)) - centerY(button)),
        );
      });
    assert.ok(
      closeAlignment.every((offset) => offset < 1),
      `close alignment at ${width}px`,
    );
    assert.ok(
      await page
        .locator(".viewer-close")
        .evaluate((element) => element === document.activeElement),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.style.overflow),
      "hidden",
    );
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(
          () =>
            !document.hasFocus() || !!document.activeElement.closest("dialog"),
        ),
      );
    }
    await page.locator(".viewer-zoom").click();
    assert.equal(
      await page.locator(".viewer-zoom").getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(
      await page
        .locator(".viewer-canvas")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    );
    assert.ok(
      await dialog.evaluate(
        (element) =>
          element.querySelector(".viewer-canvas").getBoundingClientRect()
            .bottom <= element.getBoundingClientRect().bottom,
      ),
    );
    await page.locator(".viewer-zoom").click();
    assert.equal(
      await page.locator(".viewer-zoom").getAttribute("aria-pressed"),
      "false",
    );
    await page.screenshot({
      path: join(proofs, `landing-viewer-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.documentElement.style.overflow === "",
    );
    assert.ok(await dialog.isHidden());
    assert.ok(
      await opener.evaluate((element) => element === document.activeElement),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.style.overflow),
      "",
    );
    await page.locator(".hero-screen a").click();
    assert.ok(
      (await page.locator(".viewer-canvas img").getAttribute("src")).endsWith(
        width <= 650 ? "/mobile.webp" : "/workspace.webp",
      ),
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.documentElement.style.overflow === "",
    );
    for (const detail of await page.locator(".faq details").all()) {
      await detail.locator("summary").focus();
      await page.keyboard.press("Enter");
      assert.ok(await detail.evaluate((element) => element.open));
      assert.ok(await detail.locator("p").isVisible());
      await inspect(page, `landing/questions-${width}`);
      await page.keyboard.press("Enter");
      assert.ok(!(await detail.evaluate((element) => element.open)));
    }
    await context.close();
    checks += 1;
  }
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const ribbon = page.locator(".ribbon");
    const track = page.locator(".ribbon-track");
    const state = () =>
      track.evaluate((element) => {
        const animation = element.getAnimations()[0];
        return {
          time: animation?.currentTime,
          state: animation?.playState,
          x: new DOMMatrixReadOnly(getComputedStyle(element).transform).m41,
        };
      });
    const running = () =>
      page.waitForFunction(
        () =>
          document.querySelector(".ribbon-track").getAnimations()[0]
            ?.playState === "running",
      );
    const center = () =>
      ribbon.evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
    await center();
    await running();
    const start = await state();
    await page.waitForTimeout(500);
    const moving = await state();
    assert.ok(moving.x < start.x - 18, "ribbon moves without scrolling");
    const seam = await track.evaluate((element) => {
      const animation = element.getAnimations()[0];
      const duration = animation.effect.getTiming().duration;
      const saved = animation.currentTime;
      animation.currentTime = duration - 1;
      const end = element.children[1].getBoundingClientRect().left;
      animation.currentTime = duration + 1;
      const start = element.children[0].getBoundingClientRect().left;
      animation.currentTime = saved;
      return Math.abs(end - start);
    });
    assert.ok(seam < 1, `continuous ribbon seam: ${seam}`);
    await page.locator(".hero-screen a").evaluate((element) => element.click());
    assert.ok(await page.getByRole("dialog").isVisible());
    await page.waitForTimeout(100);
    assert.equal((await state()).state, "paused");
    const paused = await state();
    await page.waitForTimeout(250);
    assert.deepEqual(await state(), paused);
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.documentElement.style.overflow === "",
    );
    await center();
    await running();
    await page.setViewportSize({
      width: width === 1440 ? 880 : 320,
      height: 900,
    });
    await center();
    await running();
    await page.waitForFunction(() => {
      const element = document.querySelector(".ribbon-track");
      const animation = element.getAnimations()[0];
      const distance = element.firstElementChild.getBoundingClientRect().width;
      return (
        element.getAnimations().length === 1 &&
        Math.abs(
          animation.effect.getTiming().duration - (distance / 60) * 1000,
        ) < 1
      );
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => !document.querySelector(".ribbon").classList.contains("is-marquee"),
    );
    assert.equal(
      await track.evaluate((element) => element.getAnimations().length),
      0,
    );
    assert.ok(await page.locator(".ribbon-group").last().isHidden());
    assert.ok(
      await page
        .locator(".ribbon-group")
        .first()
        .evaluate((element) =>
          [...element.querySelectorAll("span")].every((span) => {
            const rect = span.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              span.scrollWidth <= span.clientWidth
            );
          }),
        ),
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await center();
    await running();
    await page.evaluate(() =>
      scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
    );
    await page.waitForFunction(
      () =>
        document.querySelector(".ribbon-track").getAnimations()[0]
          ?.playState === "paused",
    );
    await page.waitForTimeout(100);
    const offscreen = await state();
    await page.waitForTimeout(200);
    assert.deepEqual(await state(), offscreen);
    await context.close();
    checks += 1;
  }
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
    });
    await context.addInitScript(() => {
      sessionStorage.setItem("situate.motion-paused", "true");
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await inspectMotion(page);
    assert.equal(await page.locator("html.motion-still").count(), 0);
    const headerBoxes = () =>
      page.evaluate(() =>
        [".wordmark", "nav", ".nav-action"].map((selector) =>
          document
            .querySelector(`.header ${selector}`)
            .getBoundingClientRect()
            .toJSON(),
        ),
      );
    const homeHeader = await headerBoxes();
    await page.screenshot({
      path: join(proofs, `landing-viewport-${width}.png`),
    });
    await page.locator('.site-footer a[href="/privacy.html"]').click();
    await inspectMotion(page);
    assert.deepEqual(await headerBoxes(), homeHeader);
    await page.locator(".header .wordmark").click();
    await inspectMotion(page);
    assert.equal(await page.locator("html.motion-still").count(), 0);
    assert.deepEqual(await headerBoxes(), homeHeader);
    assert.deepEqual(errors, []);
    await context.close();
    checks += 1;
  }
  {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await inspect(page, `no-js/landing`);
    await inspectMotion(page);
    await inspectHero(page);
    await page.locator(".hero-facts").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(origin + "/product.html");
    await page.goBack();
    await page.waitForURL(origin + "/");
    await page.locator(".mobile-menu summary").focus();
    await page.keyboard.press("Space");
    assert.equal(
      await page.locator(".mobile-menu summary").innerText(),
      "Close",
    );
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("href"), "/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForURL(origin + "/product.html");
    await page.locator(".header .wordmark").click();
    await page.waitForURL(origin + "/");
    assert.equal(await page.locator(".platform-credits").count(), 0);
    assert.equal(await page.locator(".steps .example blockquote").count(), 2);
    assert.equal(await page.locator(".steps .example li").count(), 3);
    for (const example of await page.locator(".steps .example").all())
      assert.ok(await example.isVisible());
    assert.equal(await page.locator(".story-static").count(), 3);
    for (const image of await page.locator(".story-static").all())
      assert.ok(await image.isVisible());
    assert.ok(await page.locator(".ribbon-group").last().isHidden());
    assert.ok(
      await page
        .locator(".ribbon-group")
        .first()
        .evaluate((element) =>
          [...element.querySelectorAll("span")].every((span) => {
            const rect = span.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              span.scrollWidth <= span.clientWidth
            );
          }),
        ),
    );
    await page.locator(".nav-action").click();
    assert.equal(new URL(page.url()).hash, "#download");
    assert.equal(
      await page
        .locator('#download .download-button[aria-disabled="true"]')
        .count(),
      1,
    );
    assert.ok(await page.locator("#load-platform-waitlist").isHidden());
    assert.ok(
      await page.locator("#platform-waitlist a[href^='mailto:']").isVisible(),
    );
    await page.locator("main summary").first().click();
    assert.ok(
      await page
        .locator("main details")
        .first()
        .evaluate((element) => element.open),
    );
    await context.close();
  }
  await inspectNavigationGrowth();
  await checkProduct(browser, origin, proofs, inspect);
  await checkWaitlist(browser, origin, proofs);
  await checkDownload(browser, origin, proofs);
  await checkAnalytics(browser, origin, proofs);
  console.log(`${checks} browser checks passed. Screenshots: ${proofs}`);
} finally {
  await browser?.close();
  await new Promise((done) => {
    server.close(done);
  });
}

await import("./legal/browser.test.mjs");
