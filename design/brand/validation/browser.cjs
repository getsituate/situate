"use strict";

const assert = require("node:assert/strict");
const { launchBrowser } = require("../browser-launch.cjs");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const output =
  process.env.BRAND_SCREENSHOT_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "situate-brand-"));
fs.mkdirSync(output, { recursive: true });
const poses = ["rest", "wave", "read", "carry", "celebrate", "point"];
const expressions = ["welcome", "curious", "thinking", "pleased", "unsure"];

async function main() {
  const browser = await launchBrowser(chromium, {
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : { channel: process.env.BROWSER_CHANNEL }),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });
  try {
    await page.setContent(
      '<!doctype html><html lang="en"><title>Bend renderer checks</title><body style="margin:0;background:#f6f3ee"><main id="stage" style="width:640px;height:640px;margin:40px"></main></body></html>',
    );
    await page.addScriptTag({ path: path.join(root, "bend/bend.js") });
    await page.addScriptTag({ path: path.join(root, "bend/motion.js") });
    const protectedLines = await page.evaluate(
      async ({ poses, expressions }) => {
        const draw = async (markup) => {
          const image = new Image();
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 320;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, 320, 320);
          return context;
        };
        let samples = 0;
        for (const pose of poses)
          for (const expression of expressions) {
            const markup = SituateBend.render({
              idPrefix: "anatomy",
              pose,
              expression,
            });
            const svg = new DOMParser().parseFromString(
              markup,
              "image/svg+xml",
            );
            if (svg.querySelector("parsererror"))
              throw Error("Invalid SVG XML");
            for (const angle of pose === "wave" ? [-18, -12, 0, 12] : [0]) {
              svg.querySelector(
                '[data-bend-part="right-arm"]',
              ).style.transform = `rotate(${angle}deg)`;
              const arms = svg.querySelector('[data-bend-part="rear-arms"]');
              arms.style.opacity = "1";
              const visible = await draw(
                new XMLSerializer().serializeToString(svg),
              );
              arms.style.opacity = "0";
              const absent = await draw(
                new XMLSerializer().serializeToString(svg),
              );
              for (const y of [145, 155, 165, 175, 185, 195])
                for (const x of [101, 204 + ((y - 143) * 2) / 106]) {
                  const a = visible.getImageData(
                    Math.round(x) - 2,
                    y - 2,
                    5,
                    5,
                  ).data;
                  const b = absent.getImageData(
                    Math.round(x) - 2,
                    y - 2,
                    5,
                    5,
                  ).data;
                  if (!a.every((value, index) => value === b[index]))
                    throw Error(
                      `Arm covers body detail: ${pose}/${expression}/${angle} at ${x},${y}`,
                    );
                  samples += 1;
                }
            }
          }
        return samples;
      },
      { poses, expressions },
    );

    for (const surface of ["light", "dark"]) {
      const images = new Set();
      await page.evaluate((surface) => {
        document.body.style.background =
          surface === "light" ? "#f6f3ee" : "#30203e";
      }, surface);
      for (const expression of expressions) {
        await page.evaluate((expression) => {
          const stage = document.getElementById("stage");
          stage.innerHTML = SituateBend.render({
            idPrefix: "expression",
            expression,
          });
          stage.firstElementChild.style.width =
            stage.firstElementChild.style.height = "640px";
        }, expression);
        const png = await page.locator("#stage").screenshot({
          path: path.join(output, `bend-${expression}-${surface}.png`),
        });
        images.add(crypto.createHash("sha256").update(png).digest("hex"));
      }
      assert.equal(
        images.size,
        5,
        "Five expressions must render differently on each surface",
      );
    }
    await page.evaluate(() => {
      document.getElementById("stage").innerHTML = SituateBend.render({
        idPrefix: "motion-check",
      });
      window.controller = SituateBendMotion.create(
        document.querySelector("#stage svg"),
      );
      window.motionResult = controller.play("hello");
    });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(() =>
        document
          .getAnimations()
          .some((animation) => animation.playState === "running"),
      ),
    );
    await page.evaluate(() => controller.pause());
    await page.waitForTimeout(50);
    const pausedTimes = await page.evaluate(() =>
      document.getAnimations().map((animation) => animation.currentTime),
    );
    await page.waitForTimeout(80);
    assert.deepEqual(
      await page.evaluate(() =>
        document.getAnimations().map((animation) => animation.currentTime),
      ),
      pausedTimes,
    );
    await page.evaluate(() => {
      window.replacementResult = controller.play("consider");
    });
    assert.equal((await page.evaluate(() => motionResult)).status, "replaced");
    assert.ok(
      await page.evaluate(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState === "paused"),
      ),
    );
    await page.evaluate(() => controller.resume());
    await page.waitForTimeout(40);
    assert.ok(
      await page.evaluate(() =>
        document
          .getAnimations()
          .some((animation) => animation.playState === "running"),
      ),
    );
    await page.evaluate(() => controller.stop());
    assert.equal(
      (await page.evaluate(() => replacementResult)).status,
      "stopped",
    );
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);

    await page.evaluate(() => {
      window.motionResult = controller.play("hello");
      document.getElementById("stage").style.marginTop = "1600px";
    });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(
        () =>
          document.getAnimations().length > 0 &&
          document
            .getAnimations()
            .every((animation) => animation.playState === "paused"),
      ),
    );
    await page.evaluate(() => {
      document.getElementById("stage").style.marginTop = "40px";
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(50);
    assert.ok(
      await page.evaluate(() =>
        document
          .getAnimations()
          .some((animation) => animation.playState === "running"),
      ),
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.ok(
      await page.evaluate(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState === "paused"),
      ),
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(40);
    assert.ok(
      await page.evaluate(() =>
        document
          .getAnimations()
          .some((animation) => animation.playState === "running"),
      ),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(60);
    assert.equal(
      (await page.evaluate(() => motionResult)).status,
      "reduced-motion",
    );
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    assert.equal(
      (await page.evaluate(() => controller.play("celebrate"))).status,
      "reduced-motion",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const gesture of [
      "hello",
      "consider",
      "gather",
      "celebrate",
      "point",
    ]) {
      assert.equal(
        (await page.evaluate((gesture) => controller.play(gesture), gesture))
          .status,
        "finished",
      );
      assert.equal(
        await page.evaluate(() => document.getAnimations().length),
        0,
      );
    }
    await page.evaluate(() => {
      window.motionResult = controller.play("hello");
      controller.destroy();
    });
    assert.equal((await page.evaluate(() => motionResult)).status, "destroyed");
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);

    const pages = [
      "reference/index.html",
      "bend/index.html",
      "examples/listening-room/index.html",
    ].filter((relative) => fs.existsSync(path.join(root, relative)));
    for (const relative of pages) {
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(pathToFileURL(path.join(root, relative)).href);
        await page.waitForTimeout(120);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${relative} overflows at ${width}px`,
        );
        const brokenImages = await page
          .locator("img")
          .evaluateAll((images) =>
            images
              .filter((image) => !image.complete || image.naturalWidth === 0)
              .map((image) => image.getAttribute("src")),
          );
        assert.deepEqual(brokenImages, [], `${relative} has missing images`);
        const ids = await page
          .locator("[id]")
          .evaluateAll((nodes) => nodes.map((node) => node.id));
        assert.equal(
          ids.length,
          new Set(ids).size,
          `${relative} has duplicate IDs`,
        );
        await page.screenshot({
          path: path.join(output, `${relative.split("/")[0]}-${width}.png`),
          fullPage: true,
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.waitForTimeout(80);
        assert.equal(
          await page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((animation) => animation.playState === "running")
                .length,
          ),
          0,
          `${relative} animates under reduced motion`,
        );
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      pathToFileURL(path.join(root, "reference/index.html")).href,
    );
    await page.locator("#task-book").check();
    assert.match(await page.locator("#task-count").innerText(), /1 open/);
    await page.locator("#task-book").uncheck();
    assert.match(await page.locator("#task-count").innerText(), /2 open/);
    for (const name of ["compact", "comfortable"]) {
      await page.locator(`[data-density="${name}"]`).click();
      assert.equal(
        await page
          .locator(`[data-density="${name}"]`)
          .getAttribute("aria-pressed"),
        "true",
      );
    }
    for (const id of ["note-dialog", "document-dialog"]) {
      const trigger = page.locator(`[data-dialog="${id}"]`).first();
      await trigger.click();
      assert.equal(
        await page.locator(`#${id}`).evaluate((dialog) => dialog.open),
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(`#${id}`).evaluate((dialog) => dialog.open),
        false,
      );
      assert.equal(
        await trigger.evaluate((element) => document.activeElement === element),
        true,
      );
    }
    await page.locator("#list-title").fill("");
    await page.locator('#title-form button[type="submit"]').click();
    assert.equal(await page.locator("#title-error").isVisible(), true);
    assert.equal(
      await page.locator("#list-title").getAttribute("aria-invalid"),
      "true",
    );
    await page.locator("#list-title").fill("Weekend reading");
    await page.locator('#title-form button[type="submit"]').click();
    assert.equal(await page.locator("#title-error").isVisible(), false);
    assert.match(
      await page.locator("#field-result").innerText(),
      /Weekend reading/,
    );
    await page.locator("#motion-toggle").click();
    assert.equal(
      await page.locator("#motion-toggle").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#pose-select").selectOption("read");
    await page.locator("#expression-select").selectOption("thinking");
    assert.equal(await page.locator("#replay-pose").isDisabled(), true);
    assert.ok(
      await page.evaluate(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState !== "running"),
      ),
    );
    await page.locator("#make-list").click();
    assert.equal(
      await page.locator("#made-list").isVisible(),
      true,
      "Result must not wait for a paused gesture",
    );
    await page
      .locator("#made-list select")
      .first()
      .selectOption({ label: "Reading" });
    await page.locator("#undo-list").click();
    assert.equal(await page.locator("#made-list").isVisible(), false);
    await page.locator("#make-list").click();
    assert.equal(
      await page.locator("#made-list select").first().inputValue(),
      "Considering",
    );
    await page.locator("#undo-list").click();
    await page.locator("[data-choice]").first().click();
    assert.equal(
      await page.locator("[data-choice]").first().getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#clear-choice").click();
    assert.equal(
      await page.locator('[data-choice][aria-pressed="true"]').count(),
      0,
    );
    await page.locator("#retry-preview").click();
    await page.locator("#reset-recovery").waitFor({ state: "visible" });
    await page.locator("#reset-recovery").click();
    assert.equal(await page.locator("#retry-preview").isEnabled(), true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(60);
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
      0,
    );
    await page.locator("#make-list").click();
    assert.equal(await page.locator("#made-list").isVisible(), true);
    await page.locator("#undo-list").click();
    await page.locator("#task-passage").check();
    await page.locator("#reset-workspace").click();
    assert.equal(await page.locator("#task-passage").isChecked(), false);
    assert.deepEqual(errors, [], "Browser script errors");
    assert.deepEqual(external, [], "Unexpected network requests");
    console.log(
      JSON.stringify(
        {
          browser: browser.version(),
          protectedDetailSamples: protectedLines,
          expressionImages: 10,
          pages,
          widths: [320, 390, 1440],
          screenshots: output,
          scriptErrors: errors.length,
          externalRequests: external.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
