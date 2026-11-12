"use strict";
const assert = require("node:assert/strict");
const { launchBrowser } = require("../../browser-launch.cjs");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = pathToFileURL(path.join(__dirname, "index.html")).href;
const output =
  process.env.LISTENING_SCREENSHOTS ||
  fs.mkdtempSync(path.join(os.tmpdir(), "listening-room-"));
fs.mkdirSync(output, { recursive: true });
for (const filename of ["index.html", "implementation.md"]) {
  const source = fs.readFileSync(path.join(__dirname, filename), "utf8");
  const links = filename.endsWith(".html")
    ? [...source.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    : [...source.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const link of links) {
    assert.ok(!/^[a-z]+:/i.test(link), `Nonlocal link: ${link}`);
    const target = link.split("#")[0];
    if (target)
      assert.ok(
        fs.existsSync(path.resolve(__dirname, target)),
        `Missing local link: ${link}`,
      );
    else
      assert.ok(
        source.includes(`id="${link.slice(1)}"`),
        `Missing anchor: ${link}`,
      );
  }
}

(async () => {
  const browser = await launchBrowser(chromium, {
    channel: process.env.BROWSER_CHANNEL,
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const failures = [];
  await context.route(/^https?:/, (route) => {
    failures.push(`Remote request: ${route.request().url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) =>
    failures.push(`Failed resource: ${request.url()}`),
  );
  const check = (condition, message) => assert.ok(condition, message);
  const animationCount = () =>
    page.evaluate(() => document.getAnimations().length);
  const accessibility = await context.newCDPSession(page);
  async function description(selector) {
    const { root } = await accessibility.send("DOM.getDocument");
    const { nodeId } = await accessibility.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    const { nodes } = await accessibility.send(
      "Accessibility.getPartialAXTree",
      { nodeId, fetchRelatives: false },
    );
    return nodes[0].description?.value || "";
  }
  const click = (selector) => page.locator(selector).click();
  const snapshot = async (name) => {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      fullPage: true,
    });
  };
  async function reflow(label) {
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${label}: horizontal overflow`,
    );
    check(
      await page
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
      `${label}: broken image`,
    );
    const duplicateIDs = await page
      .locator("[id]")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.id)
          .filter((id, index, ids) => ids.indexOf(id) !== index),
      );
    assert.deepEqual(duplicateIDs, [], `${label}: duplicate IDs`);
    check(
      await page.evaluate(() => {
        const stage = document.querySelector(".stage").getBoundingClientRect();
        return [
          '#bend [data-bend-part="figure"]',
          ".record-object",
          ".record-sleeve",
        ].every((selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return (
            box.left >= stage.left &&
            box.right <= stage.right &&
            box.top >= stage.top &&
            box.bottom <= stage.bottom
          );
        });
      }),
      `${label}: clipped character or record`,
    );
    check(
      await page
        .locator(
          "button:not(:disabled), .header a, .button, select, textarea, .task, .side-selector label",
        )
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getBoundingClientRect().height > 0)
            .every((node) => node.getBoundingClientRect().height >= 44),
        ),
      `${label}: short control target`,
    );
  }
  try {
    await page.goto(url);
    assert.equal(
      await description("#gesture"),
      "",
      "Enabled motion must not announce a device restriction",
    );
    assert.doesNotMatch(
      await description("#note-text"),
      /Write a detail before keeping/,
      "Valid note must not announce an error",
    );
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1050 });
      await reflow(`${width}px`);
      await snapshot(`width-${width}`);
    }
    const contrasts = await page.evaluate(() => {
      const luminance = (color) => {
        const channels = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            value /= 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const ratio = (a, b) =>
        (Math.max(luminance(a), luminance(b)) + 0.05) /
        (Math.min(luminance(a), luminance(b)) + 0.05);
      const background = (node) => {
        for (; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)") return color;
        }
        throw new Error("No opaque background");
      };
      const selectors = [
        ".intro",
        ".caption",
        ".selection",
        '.album[aria-pressed="true"] small',
        "#kept-text",
        "#kept-track",
        "#keep-note",
        "h1 em",
        "#note-text",
        "#track",
      ];
      const results = selectors.map((selector) => {
        const node = document.querySelector(selector);
        return {
          selector,
          ratio: ratio(getComputedStyle(node).color, background(node)),
          minimum: 4.5,
        };
      });
      for (const selector of [
        "#note-text",
        "#track",
        ".album",
        ".side-selector label",
      ]) {
        const node = document.querySelector(selector);
        results.push({
          selector: `${selector} boundary`,
          ratio: ratio(getComputedStyle(node).borderTopColor, background(node)),
          minimum: 3,
        });
      }
      return results;
    });
    contrasts.forEach((result) =>
      check(
        result.ratio >= result.minimum,
        `Contrast ${result.selector}: ${result.ratio}`,
      ),
    );
    console.log(
      "Computed contrast:",
      contrasts
        .map((result) => `${result.selector} ${result.ratio.toFixed(2)}:1`)
        .join("; "),
    );
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("class"), "skip");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(":focus").getAttribute("id"), "collection");
    await page.locator('[data-album="tide"]').focus();
    check(
      await page
        .locator(":focus")
        .evaluate((node) => getComputedStyle(node).outlineWidth === "3px"),
      "Keyboard focus ring visible",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator('[data-album="tide"]').getAttribute("aria-pressed"),
      "true",
    );
    check(await page.locator("#empty-note").isVisible(), "Empty note shown");
    await click("#keep-note");
    assert.equal(await page.locator(":focus").getAttribute("id"), "note-text");
    assert.equal(
      await page.locator("#note-text").getAttribute("aria-invalid"),
      "true",
    );
    check(
      await page.locator("#note-error").isVisible(),
      "Blank input explained",
    );
    assert.match(
      await description("#note-text"),
      /Write a detail before keeping/,
      "Invalid note has an error description",
    );
    const note =
      "The piano leaves a long pause. <Keep this as text, not markup.>";
    await page.locator("#note-text").fill(note);
    await click("#keep-note");
    assert.equal(await page.locator("#kept-text").textContent(), note);
    assert.equal(await page.locator("#kept-text > *").count(), 0);
    check(
      !(await page.locator("#note-error").isVisible()),
      "Error clears after recovery",
    );
    assert.doesNotMatch(
      await description("#note-text"),
      /Write a detail before keeping/,
      "Recovered note loses the error description",
    );
    await page.locator("#note-text").fill("An unkept change");
    await click("#restore-note");
    assert.equal(await page.locator("#note-text").inputValue(), note);
    await page.locator('input[name="side"][value="A"]').focus();
    await page.keyboard.press("ArrowRight");
    check(
      await page.locator('input[value="B"]').isChecked(),
      "Native side keyboard operation",
    );
    check(
      await page.locator("#empty-note").isVisible(),
      "Other side has separate notes",
    );
    await page.locator("#track").selectOption("2");
    await page.locator("#note-text").fill("One last low note.");
    await click("#keep-note");
    await click('[data-album="window"]');
    await page.locator("#track").selectOption("1");
    check(
      (await page.locator("#kept-text").textContent()).startsWith("The drums"),
      "Original album note retained",
    );
    await click('[data-album="tide"]');
    assert.equal(
      await page.locator("#kept-text").textContent(),
      note,
      "Album notes isolated and retained",
    );
    await page.locator("#task").focus();
    await page.keyboard.press("Space");
    assert.equal(
      await page.locator("#task-count").textContent(),
      "0 open tasks",
    );
    check(await page.locator("#task").isChecked(), "Task checked");
    await page.keyboard.press("Space");
    assert.equal(
      await page.locator("#task-count").textContent(),
      "1 open task",
    );
    assert.equal(await animationCount(), 0, "Work has no animation");
    await page.locator("#note-text").fill("detail ".repeat(85));
    await click("#keep-note");
    await page.locator('[data-album="tide"] strong').evaluate((node) => {
      node.textContent =
        "A very long fictional album title with a long unbroken word: " +
        "sound".repeat(30);
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await reflow("Long content at 320px");
    await snapshot("long-content");
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    await reflow("200% CSS zoom");
    await snapshot("zoom-200");
    await page.evaluate(() => {
      document.body.style.zoom = "";
    });
    await page.reload();
    check(!(await page.locator("#task").isChecked()), "Reload resets task");
    assert.equal(
      await page.locator("#note-text").inputValue(),
      "The drums fall away just before the last chorus. The room seems to get wider.",
    );

    await page.locator("#gesture").scrollIntoViewIfNeeded();
    await click("#gesture");
    await page.waitForTimeout(150);
    await click("#motion");
    check(
      await page.evaluate(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState === "paused"),
      ),
      "Pause freezes all tracks",
    );
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.ready)),
    );
    const times = await page.evaluate(() =>
      document.getAnimations().map((animation) => animation.currentTime),
    );
    await page.waitForTimeout(200);
    assert.deepEqual(
      await page.evaluate(() =>
        document.getAnimations().map((animation) => animation.currentTime),
      ),
      times,
    );
    await snapshot("paused-gesture");
    await click("#gesture");
    check(
      await page.evaluate(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState === "paused"),
      ),
      "Replay preserves pause",
    );
    await click("#motion");
    await page.waitForTimeout(1200);
    assert.equal(
      await animationCount(),
      0,
      "Finite gesture finishes and releases tracks",
    );
    await click("#gesture");
    await click("#gesture");
    check((await animationCount()) <= 2, "Rapid replay replaces gesture");
    await click("#still");
    assert.equal(await animationCount(), 0, "Still cancels gesture");
    await click("#gesture");
    await page.evaluate(() => {
      document.querySelector("#collection").scrollIntoView();
    });
    await page.waitForTimeout(150);
    check(
      await page.evaluate(
        () =>
          document.getAnimations().length > 0 &&
          document
            .getAnimations()
            .every((animation) => animation.playState === "paused"),
      ),
      "Offscreen suspends motion",
    );
    await page.locator("#gesture").scrollIntoViewIfNeeded();
    await click("#still");
    await click("#gesture");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    check(
      await page.evaluate(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState === "paused"),
      ),
      "Synthetic hidden event suspends motion",
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    assert.equal(
      await animationCount(),
      0,
      "Live reduced motion cancels tracks",
    );
    check(
      await page.locator("#gesture").isDisabled(),
      "Reduced motion has a still alternative",
    );
    await page.reload();
    assert.equal(
      await animationCount(),
      0,
      "Reduced motion at startup stays still",
    );
    check(
      await page.locator("#motion-help").isVisible(),
      "Reduced-motion explanation visible",
    );
    assert.match(
      await description("#gesture"),
      /Motion is off in your system settings/,
      "Device restriction is described only when active",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(
      () => !document.querySelector("#gesture").disabled,
    );
    assert.equal(
      await description("#gesture"),
      "",
      "Cleared device preference loses its restriction description",
    );
    await page.locator("#gesture").scrollIntoViewIfNeeded();
    await click("#gesture");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.equal(await animationCount(), 0, "Teardown releases animation");
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await click("#gesture");
    check(
      (await animationCount()) > 0,
      "Cached-page restoration recreates controller",
    );
    await click("#still");

    await page.addStyleTag({
      content:
        "body,button,textarea,select {font-family: system-ui !important} h1,h2,h3 {font-family: system-ui !important}",
    });
    await page.setViewportSize({ width: 375, height: 900 });
    await reflow("System font fallback");
    await snapshot("system-font");
    await context.close();
    const staticContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 375, height: 900 },
    });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(url);
    check(
      await staticPage
        .locator("#bend img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
      "Static Bend without JavaScript",
    );
    check(
      await staticPage.locator("noscript").isVisible(),
      "Static mode explanation visible",
    );
    await staticPage.screenshot({
      path: path.join(output, "no-javascript.png"),
      fullPage: true,
    });
    await staticContext.close();
    const unsupportedContext = await browser.newContext({
      viewport: { width: 375, height: 900 },
    });
    await unsupportedContext.addInitScript(() => {
      Element.prototype.animate = undefined;
    });
    const unsupportedPage = await unsupportedContext.newPage();
    unsupportedPage.on("pageerror", (error) => failures.push(error.message));
    await unsupportedPage.goto(url);
    check(
      await unsupportedPage.locator("#gesture").isDisabled(),
      "Unavailable animation API keeps artwork still",
    );
    check(
      await unsupportedPage.locator("#motion-help").isVisible(),
      "Unavailable motion is explained",
    );
    await unsupportedPage.locator("#task").check();
    assert.equal(
      await unsupportedPage.locator("#task-count").textContent(),
      "0 open tasks",
      "Work remains usable without animation API",
    );
    await unsupportedContext.close();
    assert.deepEqual(
      failures,
      [],
      "No browser errors, missing files, or remote requests",
    );
    console.log(
      `PASS: local interaction, keyboard, reflow, motion, and static fallback checks. Chrome ${browser.version()}. Screenshots: ${output}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
