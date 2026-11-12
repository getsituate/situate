"use strict";
const assert = require("node:assert/strict");
const { launchBrowser } = require("../browser-launch.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"));
} catch {
  console.error(
    "Set PLAYWRIGHT_MODULE to an existing Playwright installation. This test installs nothing.",
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
      viewport: { width: 1280, height: 960 },
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.setContent(
      '<html lang="en"><title>Bend performance</title><style>body{margin:0;background:#fff7e3;color:#30203e;font:14px system-ui}main{display:grid;grid-template-columns:repeat(4,320px)}figure{margin:0;text-align:center}svg{display:block}figcaption{padding:8px}</style><main></main></html>',
    );
    for (const file of ["bend.js", "performance.js"])
      await page.addScriptTag({
        content: fs.readFileSync(path.join(__dirname, file), "utf8"),
      });
    const result = await page.evaluate(async () => {
      const check = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const main = document.querySelector("main");
      main.innerHTML = SituateBend.render({
        idPrefix: "subject",
        pose: "rest",
        expression: "welcome",
      });
      const svg = main.querySelector("svg");
      const hook = (name) => svg.querySelector(`[data-bend-part="${name}"]`);
      const baseline = svg.outerHTML,
        faceNodes = [...hook("face").childNodes];
      let rig = SituateBendPerformance.create(svg);
      const sample = {
        stride: 1,
        phase: 5,
        wave: 0.8,
        wavePhase: 2,
        present: 0.2,
        wink: 1,
        mouth: 1,
        gazeX: 1,
        gazeY: -1,
        lean: 5,
        bob: -4,
      };
      rig.set(sample);
      const posed = svg.outerHTML;
      rig.set({ present: 1 });
      rig.set(sample);
      check(svg.outerHTML === posed, "History-dependent output");
      rig.set({});
      check(svg.outerHTML === baseline, "Zero state differs from baseline");
      rig.set(sample);
      rig.reset();
      check(svg.outerHTML === baseline, "Reset differs from baseline");
      check(
        faceNodes.every((node, i) => node === hook("face").childNodes[i]),
        "Reset replaced original face nodes",
      );
      rig.set(sample);
      const previous = rig;
      rig = SituateBendPerformance.create(svg);
      check(svg.outerHTML === baseline, "Replacement captured posed geometry");
      let rejected = false;
      try {
        previous.set({});
      } catch {
        rejected = true;
      }
      check(rejected, "Old owner still accepts updates");
      previous.destroy();
      rig.set(sample);
      for (const state of [
        null,
        [],
        { phase: Infinity },
        { wave: NaN },
        { mouth: "1" },
        { unknown: 0 },
      ]) {
        rejected = false;
        try {
          rig.set(state);
        } catch {
          rejected = true;
        }
        check(
          rejected && svg.outerHTML === posed,
          "Invalid state was accepted or changed the image",
        );
      }
      const raster = async (element) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(new XMLSerializer().serializeToString(element));
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 320;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 320, 320).data;
      };
      const body = [hook("depth"), hook("front")];
      function geometry(label) {
        for (const [x, y] of [
          [103, 169],
          [225, 169],
        ])
          for (let angle = 0; angle < 360; angle += 10) {
            const point = new DOMPoint(
              x + 6.5 * Math.cos((angle * Math.PI) / 180),
              y + 6.5 * Math.sin((angle * Math.PI) / 180),
            );
            check(
              body.some((part) => part.isPointInFill(point)),
              `${label}: uncovered shoulder root`,
            );
          }
        for (let y = 155; y <= 290; y += 5)
          for (const x of [150, 160, 170]) {
            check(
              !body.some((part) => part.isPointInFill(new DOMPoint(x, y))),
              `${label}: closed arch`,
            );
          }
        for (const element of hook("face").querySelectorAll("path")) {
          const box = element.getBBox(),
            radius = Number(element.getAttribute("stroke-width")) / 2;
          check(
            box.x - radius >= 138 &&
              box.x + box.width + radius <= 182 &&
              box.y - radius >= 79 &&
              box.y + box.height + radius <= 120,
            `${label}: face outside crown box`,
          );
          const length = element.getTotalLength();
          for (let i = 0; i <= 20; i++) {
            const center = element.getPointAtLength((length * i) / 20);
            for (const [dx, dy] of [
              [0, 0],
              [radius, 0],
              [-radius, 0],
              [0, radius],
              [0, -radius],
            ]) {
              check(
                body.some((part) =>
                  part.isPointInFill(
                    new DOMPoint(center.x + dx, center.y + dy),
                  ),
                ),
                `${label}: face detached from crown`,
              );
            }
          }
        }
        const toSVG = svg.getScreenCTM().inverse();
        for (const element of hook("figure").querySelectorAll("path")) {
          const box = element.getBBox();
          const radius = Number(element.getAttribute("stroke-width") || 0) / 2;
          const matrix = toSVG.multiply(element.getScreenCTM());
          for (const x of [box.x - radius, box.x + box.width + radius])
            for (const y of [box.y - radius, box.y + box.height + radius]) {
              const p = new DOMPoint(x, y).matrixTransform(matrix);
              check(
                p.x >= 0 && p.x <= 320 && p.y >= 0 && p.y <= 320,
                `${label}: path outside canvas at ${p.x},${p.y}`,
              );
            }
        }
      }
      let geometryCount = 0,
        rasterCount = 0;
      for (let phase = 0; phase < 12; phase++)
        for (const [wave, present] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
          [0.5, 0.5],
        ]) {
          for (const sign of [-1, 1])
            for (const bobSign of [-1, 1])
              for (const gazeSign of [-1, 1])
                for (const blink of [0, 1])
                  for (const wink of [0, 1]) {
                    const state = {
                      stride: 1,
                      phase: (phase * Math.PI) / 6,
                      wave,
                      present,
                      wavePhase: (phase * Math.PI) / 6,
                      blink,
                      wink,
                      mouth: phase % 2,
                      gazeX: sign,
                      gazeY: gazeSign,
                      lean: sign * 6,
                      bob: bobSign * 8,
                    };
                    rig.set(state);
                    geometry(JSON.stringify(state));
                    geometryCount++;
                  }
        }
      for (let phase = 0; phase < 12; phase++) {
        rig.set({
          stride: 1,
          phase: (phase * Math.PI) / 6,
          wave: (phase % 3) / 2,
          present: phase % 2,
          wavePhase: (phase * Math.PI) / 3,
          blink: 0.5,
          wink: 0.5,
          mouth: 0.5,
        });
        geometry("Intermediate expression");
        geometryCount++;
        const noArms = svg.cloneNode(true);
        noArms.querySelector('[data-bend-part="rear-arms"]').remove();
        const actual = await raster(svg),
          expected = await raster(noArms);
        for (let y = 140; y < 278; y++)
          for (let x = 70; x < 250; x++) {
            const i = (y * 320 + x) * 4;
            const highlight =
              expected[i] === 217 &&
              expected[i + 1] === 198 &&
              expected[i + 2] === 255;
            const inset =
              expected[i] === 112 &&
              expected[i + 1] === 69 &&
              expected[i + 2] === 189;
            if (expected[i + 3] === 255 && (highlight || inset)) {
              check(
                actual
                  .slice(i, i + 4)
                  .every((value, c) => value === expected[i + c]),
                "Arm painted over a body detail",
              );
            }
          }
        // Upper shoulders do not move; include antialiased detail edges in this comparison.
        for (const [left, right] of [
          [98, 105],
          [201, 209],
        ])
          for (let y = 146; y <= 176; y++)
            for (let x = left; x <= right; x++) {
              const i = (y * 320 + x) * 4;
              check(
                actual
                  .slice(i, i + 4)
                  .every((value, c) => value === expected[i + c]),
                "Arm crossed the protected shoulder contour",
              );
            }
        rasterCount++;
      }
      rig.reset();
      const crown = svg.cloneNode(true);
      crown.querySelector('[data-bend-part="rear-arms"]').remove();
      const crownPixels = await raster(crown);
      for (const phase of [0.3, 0.8]) {
        rig.set({ stride: 1, phase: phase * Math.PI * 2 });
        geometry("Peak flight");
        geometryCount++;
        const walked = svg.cloneNode(true);
        walked.querySelector('[data-bend-part="rear-arms"]').remove();
        const pixels = await raster(walked);
        for (let y = 70; y < 140; y++)
          for (let x = 85; x < 250; x++)
            for (let c = 0; c < 4; c++) {
              const i = (y * 320 + x) * 4 + c;
              check(
                Math.abs(pixels[i] - crownPixels[i]) <= 1,
                `Gait distorted the crown at ${x},${y}, channel ${c}: ${pixels[i]} / ${crownPixels[i]}`,
              );
            }
        const left = hook("front").getPointAtLength(0);
        const inset = hook("inset"),
          right = inset.getPointAtLength(inset.getTotalLength());
        if (phase === 0.8)
          check(
            left.y < 245 && right.y === 249,
            "Left flight/right support missing",
          );
        else
          check(
            left.y === 264 && right.y < 231,
            "Right flight/left support missing",
          );
        check(
          Math.abs(left.x - 91) <= 20.01 && Math.abs(right.x - 206) <= 20.01,
          "Step advance too large",
        );
      }
      rig.set({ stride: 1, phase: 0 });
      const contactStart = hook("front").getPointAtLength(0);
      rig.set({ stride: 1, phase: 1.2 * Math.PI });
      const contactEnd = hook("front").getPointAtLength(0);
      check(
        contactStart.y === 264 &&
          contactEnd.y === 264 &&
          Math.abs(contactStart.x - contactEnd.x - 40) < 0.01,
        "Supported end does not advance and retreat",
      );
      rig.reset();
      const faceBaseline = await raster(svg);
      const leftEyeAppearance = () => {
        const eye = hook("face").children[1];
        const matrix = eye.getScreenCTM();
        const styles = [];
        for (
          let node = eye;
          node !== svg.parentElement;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          styles.push(
            [
              "display",
              "visibility",
              "opacity",
              "filter",
              "clip-path",
              "mask",
              "fill",
              "fill-opacity",
              "stroke",
              "stroke-opacity",
              "stroke-width",
              "stroke-linecap",
              "stroke-linejoin",
              "stroke-dasharray",
              "stroke-dashoffset",
              "vector-effect",
              "mix-blend-mode",
            ].map((property) => style.getPropertyValue(property)),
          );
        }
        return JSON.stringify({
          matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
          styles,
        });
      };
      const baselineAppearance = leftEyeAppearance();
      let halfWinkPixels;
      for (const state of [
        { mouth: 1 },
        { blink: 1 },
        { wink: 0.5 },
        { wink: 1 },
      ]) {
        rig.set(state);
        const pixels = await raster(svg);
        let difference = 0;
        for (let y = 90; y < 120; y++)
          for (let x = 138; x < 182; x++) {
            const i = (y * 320 + x) * 4;
            if (pixels[i] !== faceBaseline[i]) difference++;
          }
        check(difference > 20, "Expression has no visible change");
        if (state.wink) {
          // Compare geometry to reset; pixel comparisons require the same split-eye topology.
          const eye = hook("face").children[1];
          const box = eye.getBBox();
          const stroke = getComputedStyle(eye);
          check(
            box.x === 147 &&
              box.y === 97 &&
              box.width === 0 &&
              box.height === 6 &&
              eye.getTotalLength() === 6 &&
              stroke.strokeWidth === "5.5px" &&
              stroke.strokeLinecap === "round" &&
              stroke.stroke === "rgb(48, 32, 62)",
            "Wink changed the left eye",
          );
          check(
            leftEyeAppearance() === baselineAppearance,
            "Wink changed the left eye's transform or effective styling",
          );
          if (state.wink === 0.5) halfWinkPixels = pixels;
          else {
            for (let y = 94; y <= 106; y++)
              for (let x = 143; x <= 151; x++) {
                const i = (y * 320 + x) * 4;
                check(
                  pixels
                    .slice(i, i + 4)
                    .every(
                      (value, channel) => value === halfWinkPixels[i + channel],
                    ),
                  "Wink progress changed the rendered left eye",
                );
              }
          }
        }
      }
      rig.set(sample);
      rig.destroy();
      rig.destroy();
      check(svg.outerHTML === baseline, "Destroy did not restore original DOM");
      check(
        svg.getAnimations({ subtree: true }).length === 0,
        "Rig created an autonomous animation",
      );
      const samples = [
        ["Rest", {}],
        ["Left step", { stride: 1, phase: 0.8 * Math.PI * 2 }],
        ["Right step", { stride: 1, phase: 0.3 * Math.PI * 2 }],
        ["Half-raised wave", { wave: 0.5, mouth: 0.3 }],
        ["Hello", { wave: 1, wavePhase: Math.PI / 2, mouth: 1, gazeX: 1 }],
        ["Wink", { wave: 1, wavePhase: Math.PI * 1.5, wink: 1, mouth: 0.4 }],
        ["Blink", { blink: 1, present: 0.4 }],
        ["Presentation", { present: 1, mouth: 0.7, lean: -2 }],
      ];
      main.innerHTML = samples
        .map(
          ([title], i) =>
            `<figure>${SituateBend.render({ idPrefix: `sample-${i}`, pose: "rest", expression: "welcome", decorative: true })}<figcaption>${title}</figcaption></figure>`,
        )
        .join("");
      [...main.querySelectorAll("svg")].forEach((element, i) =>
        SituateBendPerformance.create(element).set(samples[i][1]),
      );
      return { geometryCount, rasterCount };
    });
    const directory =
      process.env.BEND_PERFORMANCE_SCREENSHOTS ||
      fs.mkdtempSync(path.join(os.tmpdir(), "bend-performance-"));
    fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({
      path: path.join(directory, "samples-light.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.body.style.background = "#30203e";
      document.body.style.color = "#fff7e3";
    });
    await page.screenshot({
      path: path.join(directory, "samples-dark.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      `Checked ${result.geometryCount} sampled states, ${result.rasterCount} body-detail raster comparisons, crown stability, alternating gait, expression changes and lifecycle. Screenshots: ${directory}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
