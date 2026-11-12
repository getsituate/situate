"use strict";
const assert = require("node:assert/strict");
const { launchBrowser } = require("../../browser-launch.cjs");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output =
  process.env.INTRO_SCREENSHOTS ||
  fs.mkdtempSync(path.join(os.tmpdir(), "situate-first-hello-"));
fs.mkdirSync(output, { recursive: true });
const url = pathToFileURL(path.join(__dirname, "index.html")).href;

(async () => {
  const browser = await launchBrowser(chromium, {
    channel: process.env.BROWSER_CHANNEL,
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  });
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    reducedMotion: "no-preference",
  });
  await context.route(/^https?:/, (route) => {
    errors.push(`External request: ${route.request().url()}`);
    return route.abort();
  });
  await context.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window),
      cancel = window.cancelAnimationFrame.bind(window),
      pending = new Set();
    window.requestAnimationFrame = (callback) => {
      // Browser-test polling also uses animation frames; count the scene clocks only.
      if (callback.name !== "tick") return request(callback);
      const id = request((time) => {
        pending.delete(id);
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      cancel(id);
    };
    window.pendingSceneFrames = () => pending.size;
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) =>
    errors.push(`Missing resource: ${request.url()}`),
  );
  const time = () =>
    page.locator("#stage").getAttribute("data-time").then(Number);
  const frames = () => page.evaluate(() => window.pendingSceneFrames());
  const seek = (value) =>
    page.locator("#position").evaluate((node, seconds) => {
      node.value = String(seconds);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);

  async function resize(width, height) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  }
  async function checkBounds(label) {
    const bounds = await page.evaluate(() => {
      const stage = document.querySelector("#stage").getBoundingClientRect();
      const figure = document.querySelector('#actor [data-bend-part="figure"]');
      const box = figure.getBoundingClientRect(),
        matrix = figure.getScreenCTM();
      const stroke = 7 * Math.hypot(matrix.a, matrix.b);
      return {
        left: box.left - stroke - stage.left,
        right: stage.right - box.right - stroke,
        top: box.top - stroke - stage.top,
        bottom: stage.bottom - box.bottom - stroke,
      };
    });
    for (const [edge, clearance] of Object.entries(bounds))
      assert.ok(
        clearance >= 0,
        `${label}: ${edge} character clipping (${clearance})`,
      );
  }
  async function stable(message) {
    const before = {
      time: await time(),
      figure: await page
        .locator("#actor svg")
        .evaluate((node) => node.outerHTML),
    };
    await page.waitForTimeout(180);
    assert.deepEqual(
      {
        time: await time(),
        figure: await page
          .locator("#actor svg")
          .evaluate((node) => node.outerHTML),
      },
      before,
      message,
    );
    assert.equal(await frames(), 0, `${message}: no scheduled scene frame`);
  }
  try {
    await page.goto(url);
    await page.waitForFunction(
      () => Number(document.querySelector("#stage").dataset.time) > 80,
    );
    await page.locator("#toggle").click();
    await stable("Explicit pause freezes the entire score");
    assert.equal(
      await page.locator("#toggle").getAttribute("aria-pressed"),
      null,
      "Changing action label is not a pressed-state toggle",
    );
    await page.locator("#restart").click();
    assert.equal(await time(), 0);
    assert.equal(await page.locator("#toggle").textContent(), "Resume");
    await stable("Restart retains explicit pause");
    const bodyPaths = await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = SituateBend.render({
        idPrefix: "rigid-arrival-check",
        pose: "rest",
        expression: "welcome",
        decorative: true,
      });
      return ["depth", "front", "highlight", "inset"].map((part) =>
        host.querySelector(`[data-bend-part="${part}"]`).getAttribute("d"),
      );
    });
    const tilts = [];
    for (let sample = 0; sample <= 1.9; sample += 0.05) {
      await seek(sample);
      const pose = await page.evaluate(() => ({
        paths: ["depth", "front", "highlight", "inset"].map((part) =>
          document
            .querySelector(`#actor [data-bend-part="${part}"]`)
            .getAttribute("d"),
        ),
        tilt: new DOMMatrix(
          getComputedStyle(
            document.querySelector('#actor [data-bend-part="figure"]'),
          ).transform,
        ).b,
      }));
      assert.deepEqual(
        pose.paths,
        bodyPaths,
        "Arrival keeps every body contour rigid",
      );
      tilts.push(pose.tilt);
    }
    assert.ok(
      Math.min(...tilts) < -0.04 && Math.max(...tilts) > 0.04,
      "Whole figure rocks in both directions",
    );
    await seek(2.49);
    assert.equal(await time(), 2490);
    assert.match(
      await page.locator('#actor [data-bend-part="face"]').innerHTML(),
      /fill="#30203e"/,
    );
    await page.locator("#position").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await time(), 2500, "Native keyboard seeking");
    await stable("Seeking pauses playback");
    await page.locator("#finish").click();
    assert.equal(await time(), 10000);
    assert.equal(
      await page
        .locator("#title-end")
        .evaluate((node) => getComputedStyle(node).opacity),
      "1",
    );
    await stable("Skip completes immediately and leaves still artwork");

    await page.locator("#toggle").click();
    const started = Date.now();
    await page.waitForFunction(
      () =>
        document.querySelector("#playback-status").textContent ===
        "Introduction complete.",
      null,
      { timeout: 13000, polling: 20 },
    );
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed >= 9800 && elapsed < 12000,
      `Real-time duration: ${elapsed} ms`,
    );
    await stable("Playback ends without an idle loop");

    for (const width of [320, 375, 768, 1280]) {
      await resize(width, 1100);
      for (const sample of [0.5, 1.25, 2.16, 2.65, 3.42, 4.8, 5.8, 7.4, 10]) {
        await seek(sample);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${width}/${sample}: overflow`,
        );
        assert.ok(
          await page
            .locator("img")
            .evaluateAll((images) =>
              images.every((image) => image.complete && image.naturalWidth > 0),
            ),
          "Local artwork loads",
        );
        const duplicates = await page
          .locator("[id]")
          .evaluateAll((nodes) =>
            nodes
              .map((node) => node.id)
              .filter((id, i, ids) => ids.indexOf(id) !== i),
          );
        assert.deepEqual(duplicates, []);
        await checkBounds(`${width}/${sample}`);
        await page
          .locator("#stage")
          .screenshot({ path: path.join(output, `${width}-${sample}.png`) });
      }
      assert.ok(
        await page
          .locator("button")
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => !node.disabled)
              .every((node) => node.getBoundingClientRect().height >= 44),
          ),
        "Control targets",
      );
    }
    for (const [width, height] of [
      [320, 568],
      [375, 667],
      [390, 844],
      [701, 700],
      [1280, 720],
    ]) {
      await resize(width, height);
      await page.evaluate(() => scrollTo(0, 0));
      await seek(0.4);
      const controls = await page.evaluate(() => {
        const toggle = document.querySelector("#toggle");
        const bounds = () =>
          [...document.querySelectorAll("#toggle, #restart, #finish")].map(
            (node) => {
              const box = node.getBoundingClientRect();
              return {
                label: node.textContent.trim(),
                top: box.top,
                bottom: box.bottom,
                height: box.height,
              };
            },
          );
        const paused = bounds();
        toggle.click();
        const playing = bounds();
        toggle.click();
        return { paused, playing };
      });
      assert.equal(controls.paused[0].label, "Resume");
      assert.equal(controls.playing[0].label, "Pause");
      for (const [state, buttons] of Object.entries(controls)) {
        for (const button of buttons) {
          assert.ok(
            button.top >= 0 && button.bottom <= height && button.height >= 44,
            `${width}×${height}/${state}: ${button.label} is immediately accessible`,
          );
        }
      }
      for (const sample of [0.4, 1, 1.6, 2.16, 3.42, 5.8, 10]) {
        await seek(sample);
        await checkBounds(`${width}×${height}/${sample}`);
        if (sample < 10)
          assert.ok(
            await page.locator("#toggle, #finish").evaluateAll((nodes) =>
              nodes.every((node) => {
                const box = node.getBoundingClientRect();
                return box.top >= 0 && box.bottom <= innerHeight;
              }),
            ),
            `${width}×${height}: immediate pause and skip`,
          );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        if (sample === 10) {
          const layout = await page.evaluate(() => {
            const heading = document.querySelector("#title-end");
            const range = document.createRange();
            range.selectNodeContents(heading.querySelector("p"));
            const text = [...range.getClientRects()].filter(
              (box) => box.width > 0,
            );
            const logo = heading.querySelector("img");
            const art = [
              ...document.querySelectorAll(".object img, .object span"),
            ].map((node) => node.getBoundingClientRect());
            const overlaps = (a, b) =>
              a.left < b.right &&
              a.right > b.left &&
              a.top < b.bottom &&
              a.bottom > b.top;
            return {
              collision: text.some((box) =>
                art.some((object) => overlaps(box, object)),
              ),
              labelCollision: [
                ...document.querySelectorAll(".object span"),
              ].some((label) =>
                [...document.querySelectorAll(".object img")].some(
                  (image) =>
                    label.parentElement !== image.parentElement &&
                    overlaps(
                      label.getBoundingClientRect(),
                      image.getBoundingClientRect(),
                    ),
                ),
              ),
              clearSpace:
                parseFloat(getComputedStyle(logo).marginBottom) -
                logo.getBoundingClientRect().height / 2,
            };
          });
          assert.equal(
            layout.collision,
            false,
            `${width}×${height}: ending copy must not cross object artwork`,
          );
          assert.equal(
            layout.labelCollision,
            false,
            `${width}×${height}: object artwork must not hide another object label`,
          );
          assert.ok(
            layout.clearSpace >= -0.1,
            "Wordmark keeps its half-height clear space",
          );
        }
        const ratio = await page.locator("#ribbons img").evaluate((node) => {
          const style = getComputedStyle(node);
          return parseFloat(style.width) / parseFloat(style.height);
        });
        assert.ok(
          Math.abs(ratio - 1440 / 500) < 0.005,
          "Ribbon retains intrinsic framing without internal cover crop",
        );
        await page.locator("#stage").screenshot({
          path: path.join(output, `short-${width}-${height}-${sample}.png`),
        });
      }
    }
    await resize(1280, 700);
    await seek(2);
    await page.locator("#toggle").click();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await stable("Synthetic hidden document suspends the clock");
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(100);
    assert.ok((await time()) > 2000, "Visibility resumes elapsed time");
    await page
      .locator("#acting-stage")
      .evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(80);
    await stable("Offscreen introduction suspends the clock");
    await page.locator("#stage").scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    assert.ok((await frames()) > 0);
    await page.locator("#toggle").click();
    const pausedAt = await time();
    await page.locator("#acting-stage").scrollIntoViewIfNeeded();
    await page.locator("#stage").scrollIntoViewIfNeeded();
    await stable("Returning to view preserves user pause");
    assert.equal(await time(), pausedAt);

    for (const name of ["hello", "wink", "talk", "walk", "present"]) {
      await page.locator(`[data-gesture="${name}"]`).click();
      await page.waitForTimeout(160);
      assert.ok((await frames()) > 0, `${name}: finite preview starts`);
      await page.locator("#stop-gesture").click();
      assert.equal(await frames(), 0, `${name}: still cancels frame work`);
    }
    await page.evaluate(() => {
      const svg = document.querySelector("#lab-actor svg").cloneNode(true);
      const rig = SituateBendPerformance.create(svg);
      const paths = ["depth", "front", "highlight", "inset"].map((part) =>
        svg.querySelector(`[data-bend-part="${part}"]`),
      );
      const baseline = paths.map((node) => node.getAttribute("d"));
      for (
        let time = 0;
        time <= SituateHelloTimeline.durations.walk;
        time += 20
      ) {
        rig.set(SituateHelloTimeline.gesture("walk", time));
        if (paths.some((node, i) => node.getAttribute("d") !== baseline[i]))
          throw new Error("Isolated rocking deformed the arch.");
      }
      rig.destroy();
    });
    await page.locator('[data-gesture="wink"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector("#gesture-status").textContent ===
        "Still character.",
      null,
      { polling: 20 },
    );
    assert.equal(await frames(), 0, "Isolated gesture ends");

    await page.locator("#stage").scrollIntoViewIfNeeded();
    await page.locator("#toggle").click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => document.querySelector("#stage").dataset.time === "10000",
    );
    assert.equal(await frames(), 0);
    assert.ok(await page.locator("#toggle").isDisabled());
    assert.ok(await page.locator('[data-gesture="wink"]').isDisabled());
    assert.equal(
      await page.locator("#toggle").getAttribute("aria-describedby"),
      "playback-status",
    );
    await page.reload();
    assert.equal(await time(), 10000, "Reduced motion at startup shows ending");
    assert.equal(await frames(), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(
      () => !document.querySelector("#toggle").disabled,
    );
    assert.equal(await time(), 10000, "Clearing preference does not replay");
    assert.equal(
      await page.locator("#toggle").getAttribute("aria-describedby"),
      null,
    );
    const accessibility = await context.newCDPSession(page);
    const { root } = await accessibility.send("DOM.getDocument");
    const { nodeId } = await accessibility.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#toggle",
    });
    const { nodes } = await accessibility.send(
      "Accessibility.getPartialAXTree",
      { nodeId, fetchRelatives: false },
    );
    assert.equal(
      nodes[0].description?.value || "",
      "",
      "Enabled playback has no stale device restriction",
    );

    await seek(3.42);
    const restoredPose = await page
      .locator("#actor svg")
      .evaluate((node) => node.outerHTML);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.equal(await frames(), 0, "Teardown cancels frame callbacks");
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    assert.equal(await time(), 3420);
    assert.equal(
      await page.locator("#actor svg").evaluate((node) => node.outerHTML),
      restoredPose,
      "Cache-restored frame matches",
    );
    await stable("Cached user pause is retained");
    await page.locator("#toggle").click();
    await page.waitForTimeout(100);
    assert.ok((await time()) > 3420, "Restored controller is usable");
    await page.locator("#finish").click();
    await page.addStyleTag({
      content: "body,button,input,.title,h2 {font-family:system-ui !important}",
    });
    await resize(320, 1100);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "System font fallback",
    );
    await page.screenshot({
      path: path.join(output, "system-font.png"),
      fullPage: true,
    });
    await context.close();

    const staticContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 375, height: 1100 },
    });
    const still = await staticContext.newPage();
    await still.goto(url);
    assert.equal(
      await still
        .locator("#title-end")
        .evaluate((node) => getComputedStyle(node).opacity),
      "1",
    );
    assert.ok(
      await still
        .locator("#actor img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    );
    assert.ok(await still.locator("#toggle").isDisabled());
    await still.locator("summary").click();
    assert.ok(
      (await still.locator(".transcript").getAttribute("open")) !== null,
    );
    await still.screenshot({
      path: path.join(output, "no-javascript.png"),
      fullPage: true,
    });
    await staticContext.close();
    assert.deepEqual(
      errors,
      [],
      "No script errors, missing resources or network requests",
    );
    console.log(
      JSON.stringify(
        {
          browser: browser.version(),
          realTimeDurationMs: elapsed,
          sampledWidths: [320, 375, 768, 1280],
          frames: 71,
          shortViewports: [
            [320, 568],
            [375, 667],
            [390, 844],
            [701, 700],
            [1280, 720],
          ],
          errors: errors.length,
          screenshots: output,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
