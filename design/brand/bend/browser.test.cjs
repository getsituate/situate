"use strict";
const assert = require("node:assert/strict");
const { launchBrowser } = require("../browser-launch.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let chromium;
try {
  ({ chromium } = require(process.env.BEND_PLAYWRIGHT_MODULE || "playwright"));
} catch {
  console.error(
    "Use an existing Playwright installation via BEND_PLAYWRIGHT_MODULE. No packages are installed by this test.",
  );
  process.exit(2);
}

(async () => {
  const browser = await launchBrowser(chromium, {
    channel: process.env.BEND_BROWSER_CHANNEL,
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      reducedMotion: "no-preference",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!/^(file:|data:)/.test(request.url()))
        errors.push(`Unexpected request: ${request.url()}`);
    });
    await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    await page.waitForSelector("#preview svg");
    assert.equal(await page.locator("#gallery svg").count(), 30);
    const geometry = await page.evaluate(async () => {
      const results = [];
      const raster = async (svg) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(new XMLSerializer().serializeToString(svg));
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 320;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 320, 320).data;
      };
      for (const svg of document.querySelectorAll("#gallery svg")) {
        const label = svg.dataset.bendPose + "/" + svg.dataset.bendExpression;
        const body = [
          ...svg.querySelectorAll(
            '[data-bend-part="depth"], [data-bend-part="front"]',
          ),
        ];
        for (const [x, y] of [
          [103, 169],
          [225, 169],
        ]) {
          for (let degrees = 0; degrees < 360; degrees += 15) {
            const p = new DOMPoint(
              x + 6.5 * Math.cos((degrees * Math.PI) / 180),
              y + 6.5 * Math.sin((degrees * Math.PI) / 180),
            );
            if (!body.some((part) => part.isPointInFill(p)))
              throw Error(label + ": exposed root cap");
          }
        }
        for (const y of [155, 180, 220, 260, 275]) {
          if (body.some((part) => part.isPointInFill(new DOMPoint(160, y))))
            throw Error(label + ": lower connector");
        }
        const face = svg.querySelector('[data-bend-part="face"]').getBBox();
        if (
          face.x < 138 ||
          face.y < 79 ||
          face.x + face.width > 182 ||
          face.y + face.height > 120
        )
          throw Error(label + ": face outside crown box");
        for (const degrees of [0, -18, 12]) {
          const clone = svg.cloneNode(true);
          clone.querySelector('[data-bend-part="right-arm"]').style.transform =
            `rotate(${degrees}deg)`;
          const noArms = clone.cloneNode(true);
          noArms.querySelector('[data-bend-part="rear-arms"]').remove();
          const actual = await raster(clone),
            expected = await raster(noArms);
          for (const [left, right] of [
            [98, 105],
            [201, 209],
          ]) {
            for (let y = 146; y <= 183; y++)
              for (let x = left; x <= right; x++) {
                const index = (y * 320 + x) * 4;
                for (let channel = 0; channel < 4; channel++)
                  if (actual[index + channel] !== expected[index + channel])
                    throw Error(
                      `${label}: arm crossing contour at ${x},${y}, angle ${degrees}`,
                    );
              }
          }
        }
        results.push(label);
      }
      return results;
    });
    assert.equal(geometry.length, 30);

    await page.evaluate(() => {
      window.subject = SituateBendMotion.create(
        document.querySelector("#preview svg"),
      );
      subject.pause();
      window.result = subject.play("hello");
    });
    assert.deepEqual(
      await page.evaluate(() =>
        document
          .querySelector("#preview svg")
          .getAnimations({ subtree: true })
          .map((animation) => animation.playState),
      ),
      ["paused", "paused"],
    );
    await page.evaluate(() => {
      window.first = result;
      window.result = subject.play("consider");
    });
    assert.equal(
      await page.evaluate(async () => (await first).status),
      "replaced",
    );
    assert.ok(
      (
        await page.evaluate(() =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true })
            .map((animation) => animation.playState),
        )
      ).every((state) => state === "paused"),
    );
    await page.evaluate(() => subject.resume());
    assert.ok(
      (
        await page.evaluate(() =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true })
            .map((animation) => animation.playState),
        )
      ).every((state) => state === "running"),
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.ok(
      (
        await page.evaluate(() =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true })
            .map((animation) => animation.playState),
        )
      ).every((state) => state === "paused"),
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.ok(
      (
        await page.evaluate(() =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true })
            .map((animation) => animation.playState),
        )
      ).every((state) => state === "running"),
    );
    await page.evaluate(() => {
      document.querySelector("#preview").style.marginTop = "3000px";
      window.dispatchEvent(new Event("resize"));
    });
    assert.ok(
      (
        await page.evaluate(() =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true })
            .map((animation) => animation.playState),
        )
      ).every((state) => state === "paused"),
    );
    await page.evaluate(() => {
      document.querySelector("#preview").style.marginTop = "";
      window.dispatchEvent(new Event("resize"));
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page.evaluate(async () => (await result).status),
      "reduced-motion",
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true }).length,
      ),
      0,
    );
    assert.equal(
      await page.evaluate(async () => (await subject.play("gather")).status),
      "reduced-motion",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true }).length,
      ),
      0,
    );
    await page.evaluate(() => {
      window.result = subject.play("point");
      subject.stop();
    });
    assert.equal(
      await page.evaluate(async () => (await result).status),
      "stopped",
    );
    await page.evaluate(() => {
      subject.pause();
      window.result = subject.play("celebrate");
      subject.destroy();
    });
    assert.equal(
      await page.evaluate(async () => (await result).status),
      "destroyed",
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#preview svg")
            .getAnimations({ subtree: true }).length,
      ),
      0,
    );
    assert.equal(
      await page.evaluate(() => {
        try {
          subject.play("hello");
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );

    // Instrument only the controller's targets; unrelated demo listeners are outside its lifecycle.
    const lifecycle = await page.evaluate(async () => {
      const svg = document.querySelector("#preview svg");
      let adds = 0,
        removes = 0,
        observations = 0,
        disconnections = 0;
      const matchMedia = window.matchMedia;
      window.matchMedia = (query) => {
        const media = matchMedia(query);
        const add = media.addEventListener.bind(media),
          remove = media.removeEventListener.bind(media);
        media.addEventListener = (...args) => {
          adds++;
          add(...args);
        };
        media.removeEventListener = (...args) => {
          removes++;
          remove(...args);
        };
        return media;
      };
      const originals = [];
      for (const target of [window, document]) {
        const add = target.addEventListener,
          remove = target.removeEventListener;
        originals.push([target, add, remove]);
        target.addEventListener = function (...args) {
          adds++;
          return add.apply(this, args);
        };
        target.removeEventListener = function (...args) {
          removes++;
          return remove.apply(this, args);
        };
      }
      const Observer = window.IntersectionObserver;
      window.IntersectionObserver = class extends Observer {
        observe(target) {
          observations++;
          super.observe(target);
        }
        disconnect() {
          disconnections++;
          super.disconnect();
        }
      };
      const controller = SituateBendMotion.create(svg);
      const statuses = [];
      for (const name of SituateBendMotion.names) {
        const promise = controller.play(name);
        for (const animation of svg.getAnimations({ subtree: true }))
          animation.finish();
        statuses.push((await promise).status);
      }
      const stopped = controller.play("hello");
      controller.stop();
      await stopped;
      const destroyed = controller.play("hello");
      controller.destroy();
      await destroyed;
      window.matchMedia = matchMedia;
      window.IntersectionObserver = Observer;
      for (const [target, add, remove] of originals) {
        target.addEventListener = add;
        target.removeEventListener = remove;
      }
      return { adds, removes, observations, disconnections, statuses };
    });
    assert.equal(lifecycle.adds, lifecycle.removes);
    assert.equal(lifecycle.observations, lifecycle.disconnections);
    assert.deepEqual(lifecycle.statuses, Array(5).fill("finished"));

    const directory =
      process.env.BEND_SCREENSHOTS ||
      fs.mkdtempSync(path.join(os.tmpdir(), "bend-proof-"));
    fs.mkdirSync(directory, { recursive: true });
    const proofPage = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      reducedMotion: "no-preference",
    });
    proofPage.on("pageerror", (error) => errors.push(error.message));
    await proofPage.setContent(
      '<html lang="en"><title>Bend proofs</title><style>body{margin:0;background:#fff7e3;color:#30203e;font-family:system-ui,sans-serif}main{padding:32px}figure{margin:0;padding:12px}figcaption{font-size:14px}</style><main><h1>Bend</h1><p>Pose and expression reference</p><div id="proof"></div></main></html>',
    );
    await proofPage.addScriptTag({
      content: fs.readFileSync(path.join(__dirname, "bend.js"), "utf8"),
    });
    await proofPage.addScriptTag({
      content: fs.readFileSync(path.join(__dirname, "motion.js"), "utf8"),
    });
    await proofPage.evaluate(() => {
      const proof = document.querySelector("#proof");
      proof.style.cssText =
        "display:grid;grid-template-columns:repeat(5,1fr);gap:12px";
      proof.innerHTML = SituateBend.poseNames
        .map((pose) =>
          SituateBend.expressionNames
            .map(
              (expression) =>
                `<figure style="background:#fffefa;border-radius:16px;text-align:center">${SituateBend.render({ idPrefix: `proof-${pose}-${expression}`, pose, expression, decorative: true }).replace('width="320" height="320"', 'width="180" height="180"')}<figcaption>${pose} / ${expression}</figcaption></figure>`,
            )
            .join(""),
        )
        .join("");
    });
    await proofPage.screenshot({
      path: path.join(directory, "all-static.png"),
      fullPage: true,
    });
    await proofPage.evaluate(() => {
      for (const svg of document.querySelectorAll("#proof svg")) {
        const controller = SituateBendMotion.create(svg);
        controller.pause();
        controller.play("hello");
        for (const animation of svg.getAnimations({ subtree: true }))
          animation.currentTime = 700;
      }
    });
    await proofPage.screenshot({
      path: path.join(directory, "all-mid-hello.png"),
      fullPage: true,
    });
    await proofPage.evaluate(() => {
      for (const figure of document.querySelectorAll("#proof figure")) {
        figure.style.background = "#30203e";
        figure.style.color = "#fff7e3";
      }
    });
    await proofPage.screenshot({
      path: path.join(directory, "all-mid-hello-dark.png"),
      fullPage: true,
    });
    await proofPage.close();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(directory, "mobile.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      `Verified 30 combinations at three arm angles, root coverage, empty opening, face bounds, motion lifecycle, live reduced motion, simulated hidden state, offscreen suspension, narrow layout and no network requests. Screenshots: ${directory}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
