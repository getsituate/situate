"use strict";
const assert = require("node:assert/strict");
const { launchBrowser } = require("../browser-launch.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = `${pathToFileURL(path.join(__dirname, "index.html")).href}#mini-bend`;
const output =
  process.env.MINI_SCREENSHOTS ||
  fs.mkdtempSync(path.join(os.tmpdir(), "mini-bend-reference-"));
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await launchBrowser(chromium, {
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : { channel: process.env.BROWSER_CHANNEL }),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "no-preference",
    });
    const errors = [];
    const external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith("file:")) external.push(request.url());
    });
    await page.goto(url);
    await page.waitForFunction(
      () =>
        document.querySelector("#mini-example").dataset.miniState === "idle",
    );
    const frame = () =>
      page
        .locator("#mini-mark [data-bend-mini]")
        .getAttribute("data-mini-frame");
    const state = () =>
      page.locator("#mini-example").getAttribute("data-mini-state");
    const activate = (id) => page.locator(`#mini-${id}`).click();
    const waitState = (value) =>
      page.waitForFunction(
        (value) =>
          document.querySelector("#mini-example").dataset.miniState === value,
        value,
        { timeout: 6500 },
      );
    const waitFrame = (value) =>
      page.waitForFunction(
        (value) =>
          document.querySelector("#mini-mark [data-bend-mini]").dataset
            .miniFrame === value,
        value,
        { timeout: 3000 },
      );
    assert.equal(await page.locator("#mini-fallback").isVisible(), false);
    assert.equal(await frame(), "rest");
    const ascii = fs
      .readFileSync(path.join(__dirname, "../bend/mini/mini.txt"), "utf8")
      .replace(/\n$/, "");
    for (const text of await page
      .locator(".mini-static-ascii")
      .allTextContents())
      assert.equal(text, ascii, "Static ASCII matches canonical export");

    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#mini-bend").scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Reflow at ${width}`,
      );
      await page
        .locator(".mini-specimens")
        .screenshot({ path: path.join(output, `marks-${width}.png`) });
      await page
        .locator("#mini-example")
        .screenshot({ path: path.join(output, `example-${width}.png`) });
      assert.equal(await frame(), "rest", "No idle animation");
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "200% CSS zoom reflow",
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });

    const staticMarks = await page.locator(".mini-specimens").innerHTML();
    await page.evaluate(() => {
      window.miniAnnouncements = [];
      new MutationObserver(() =>
        window.miniAnnouncements.push(
          document.querySelector("#mini-status").textContent,
        ),
      ).observe(document.querySelector("#mini-status"), {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    await activate("open");
    assert.equal(
      await page.locator("#mini-result").getAttribute("aria-busy"),
      "true",
    );
    await waitFrame("focus");
    const label = await page.locator("#mini-status").textContent();
    const glyphBox = await page
      .locator("#mini-mark [data-bend-mini]")
      .boundingBox();
    await page
      .locator("#mini-example")
      .screenshot({ path: path.join(output, "ascii-loading.png") });
    await waitFrame("rest");
    assert.deepEqual(
      await page.locator("#mini-mark [data-bend-mini]").boundingBox(),
      glyphBox,
      "No frame layout shift",
    );
    assert.equal(
      await page.locator("#mini-status").textContent(),
      label,
      "Frames do not change status",
    );
    const cdp = await page.context().newCDPSession(page);
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#mini-mark",
    });
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
      nodeId,
      fetchRelatives: false,
    });
    assert.equal(
      nodes[0].ignored,
      true,
      "ASCII punctuation is excluded from accessibility tree",
    );
    const specimens = await cdp.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: ".mini-static-ascii",
    });
    assert.equal(specimens.nodeIds.length, 2);
    for (const nodeId of specimens.nodeIds) {
      const outer = await cdp.send("Accessibility.getPartialAXTree", {
        nodeId,
        fetchRelatives: false,
      });
      assert.equal(outer.nodes[0].role.value, "image");
      assert.equal(outer.nodes[0].name.value, "ASCII Mini Bend");
      const child = await cdp.send("DOM.querySelector", {
        nodeId,
        selector: 'span[aria-hidden="true"]',
      });
      assert.ok(child.nodeId, "Each static specimen has a hidden glyph child");
      const inner = await cdp.send("Accessibility.getPartialAXTree", {
        nodeId: child.nodeId,
        fetchRelatives: false,
      });
      assert.equal(
        inner.nodes[0].ignored,
        true,
        "Static ASCII punctuation is also excluded",
      );
    }
    await cdp.detach();
    await page.locator("#mini-format").selectOption("svg");
    assert.equal(
      await state(),
      "loading",
      "Switching format preserves the operation",
    );
    assert.equal(
      await page.locator("#mini-result").getAttribute("aria-busy"),
      "true",
    );
    await waitState("complete");
    assert.equal(await frame(), "rest");
    assert.equal(
      await page.locator("#mini-result").getAttribute("aria-busy"),
      "false",
    );
    assert.equal(await page.locator("#mini-note").isVisible(), true);
    assert.deepEqual(await page.evaluate(() => window.miniAnnouncements), [
      "Opening the sample note…",
      "Sample note opened.",
    ]);
    assert.equal(
      await page.locator(".mini-specimens").innerHTML(),
      staticMarks,
      "Comparison marks remain static",
    );

    await page.locator("#mini-format").selectOption("svg");
    await activate("open");
    const arch = await page
      .locator("#mini-mark svg path")
      .first()
      .getAttribute("d");
    await waitFrame("focus");
    assert.equal(
      await page.locator("#mini-mark svg path").first().getAttribute("d"),
      arch,
      "Arch does not move",
    );
    await page
      .locator("#mini-example")
      .screenshot({ path: path.join(output, "svg-loading.png") });
    await page.locator("#motion-toggle").click();
    const held = await frame();
    await page.waitForTimeout(450);
    assert.equal(await frame(), held, "Global pause freezes the mark");
    assert.equal(
      await state(),
      "loading",
      "Pause does not cancel the operation",
    );
    await waitState("complete");
    assert.equal(
      await frame(),
      "rest",
      "Completion clears busy even while paused",
    );
    await activate("open");
    await page.waitForTimeout(1100);
    assert.equal(await frame(), "rest", "Pause persists into a new operation");
    await page.locator("#motion-toggle").click();
    await waitFrame("focus");
    await activate("error");
    assert.equal(await frame(), "rest");
    assert.equal(
      await page.locator("#mini-result").getAttribute("aria-busy"),
      "false",
    );
    assert.match(
      await page.locator("#mini-status").textContent(),
      /couldn’t open/,
    );
    await activate("open");
    await activate("cancel");
    await page.waitForTimeout(4200);
    assert.equal(
      await state(),
      "cancelled",
      "No stale completion after cancellation",
    );
    assert.equal(await frame(), "rest");
    assert.equal(await page.locator("#mini-note").isVisible(), false);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#mini-format").selectOption("ascii");
    await activate("open");
    await page.waitForTimeout(1200);
    assert.equal(
      await frame(),
      "rest",
      "Reduced motion preserves static loading",
    );
    await activate("complete");
    assert.equal(
      await state(),
      "complete",
      "Reduced motion does not gate results",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await activate("open");
    await waitFrame("focus");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        document.querySelector("#motion-toggle").disabled &&
        document.querySelector("#mini-mark [data-bend-mini]").dataset
          .miniFrame === "rest",
      null,
      { timeout: 400 },
    );
    assert.equal(
      await state(),
      "loading",
      "Live reduction does not cancel work",
    );
    assert.equal(await frame(), "rest", "Live reduction resets to rest");
    await activate("cancel");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await page.locator("#mini-open").focus();
    await page.keyboard.press("Enter");
    assert.equal(await state(), "loading");
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "mini-complete",
    );
    await page.keyboard.press("Enter");
    assert.equal(await state(), "complete");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "mini-complete",
      "Completion preserves focus",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await state(),
      "complete",
      "Unavailable outcome control is inert",
    );

    await activate("open");
    await waitFrame("focus");
    await page.evaluate(() =>
      document.querySelector("#note-dialog").showModal(),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    const modalFrame = await frame();
    await page.waitForTimeout(250);
    assert.equal(await frame(), modalFrame, "Modal suspends miniature");
    await page.evaluate(() => document.querySelector("#note-dialog").close());
    await activate("cancel");

    await activate("open");
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      ),
    );
    assert.equal(await state(), "cancelled");
    await page.waitForTimeout(4200);
    assert.equal(
      await state(),
      "cancelled",
      "Page teardown clears the simulation timer",
    );
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await activate("open");
    await waitFrame("focus");
    await activate("complete");
    assert.equal(
      await state(),
      "complete",
      "Restored page has a new working controller",
    );

    assert.equal(
      await page.evaluate(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth,
        ),
      ),
      true,
      "All local images load",
    );
    assert.deepEqual(errors, [], "No browser errors");
    assert.deepEqual(external, [], "No external requests");
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const still = await noJS.newPage();
    await still.goto(url);
    assert.equal(await still.locator("#mini-fallback").isVisible(), true);
    assert.equal(await still.locator("#mini-open").isDisabled(), true);
    assert.equal(
      await still.locator(".mini-static-ascii").first().textContent(),
      ascii,
    );
    assert.equal(
      await still.locator("#mini-mark").textContent(),
      ascii,
      "No-script mark matches the selected ASCII format",
    );
    await noJS.close();
    console.log(
      `Mini Bend reference checked in ${browser.version()}: SVG/ASCII, four widths, CSS zoom, status semantics, keyboard, pause, reduced motion, outcomes, teardown and static fallback. Captures: ${output}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
