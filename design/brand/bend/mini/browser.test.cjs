"use strict";
const assert = require("node:assert/strict");
const { launchBrowser } = require("../../browser-launch.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const mini = require("./mini.js");
const { colors } = require("../../tokens.json");

async function load(page) {
  await page.setContent(
    '<!doctype html><html lang="en"><title>Bend mini checks</title><body><main></main></body></html>',
  );
  await page.addStyleTag({ path: path.join(__dirname, "../../tokens.css") });
  await page.addStyleTag({ path: path.join(__dirname, "mini.css") });
  await page.addScriptTag({ path: path.join(__dirname, "mini.js") });
}

async function instrument(page) {
  await page.evaluate(() => {
    const timers = new Set();
    const listeners = [];
    const intersections = new Set();
    const mutations = new Set();
    let callbacks = 0;
    const timeout = window.setTimeout;
    const clear = window.clearTimeout;
    window.setTimeout = (callback, delay, ...args) => {
      const id = timeout(() => {
        timers.delete(id);
        callbacks++;
        callback(...args);
      }, delay);
      timers.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      timers.delete(id);
      clear(id);
    };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const capture = (options) =>
      typeof options === "boolean" ? options : !!(options && options.capture);
    EventTarget.prototype.addEventListener = function (
      type,
      callback,
      options,
    ) {
      listeners.push({
        target: this,
        type,
        callback,
        capture: capture(options),
      });
      return add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type,
      callback,
      options,
    ) {
      const index = listeners.findIndex(
        (item) =>
          item.target === this &&
          item.type === type &&
          item.callback === callback &&
          item.capture === capture(options),
      );
      if (index !== -1) listeners.splice(index, 1);
      return remove.call(this, type, callback, options);
    };
    if (window.IntersectionObserver) {
      const Observer = window.IntersectionObserver;
      window.IntersectionObserver = class extends Observer {
        observe(target) {
          intersections.add(this);
          super.observe(target);
        }
        disconnect() {
          intersections.delete(this);
          super.disconnect();
        }
      };
    }
    const Observer = window.MutationObserver;
    window.MutationObserver = class extends Observer {
      observe(target, options) {
        mutations.add(this);
        super.observe(target, options);
      }
      disconnect() {
        mutations.delete(this);
        super.disconnect();
      }
    };
    window.audit = () => ({
      timers: timers.size,
      listeners: listeners.length,
      intersections: intersections.size,
      mutations: mutations.size,
      callbacks,
    });
  });
}

async function axNode(page, selector) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    const { node } = await session.send("DOM.describeNode", { nodeId });
    const { nodes } = await session.send("Accessibility.getPartialAXTree", {
      backendNodeId: node.backendNodeId,
      fetchRelatives: false,
    });
    return nodes[0];
  } finally {
    await session.detach();
  }
}

async function exercise(browser, format, fallback, errors) {
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    reducedMotion: "no-preference",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const epoch = new Date("2030-01-01T00:00:00Z");
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(epoch);
  await load(page);
  if (fallback)
    await page.evaluate(() => {
      window.IntersectionObserver = undefined;
    });
  await instrument(page);
  const state = () => page.evaluate(() => window.controller.state);
  const audit = () => page.evaluate(() => window.audit());
  const settle = () => page.waitForTimeout(60);
  const frame = async (name, running = true) => {
    const result = await page.evaluate(() => ({
      state: controller.state,
      frame: icon.getAttribute("data-mini-frame"),
      body: icon.querySelector("[data-mini-body]")?.outerHTML,
      glyph: icon.querySelector("[data-mini-glyph]")?.textContent,
      eyes: icon.querySelector("[data-mini-eyes]")?.getAttribute("d"),
      width: icon.getBoundingClientRect().width,
      height: icon.getBoundingClientRect().height,
      name: icon.getAttribute("aria-label"),
      live: icon.querySelector("[aria-live]") || icon.hasAttribute("aria-live"),
      status: document.querySelector("#status").textContent,
      busy: document.querySelector("main").getAttribute("aria-busy"),
    }));
    assert.equal(result.frame, name);
    assert.equal(result.state.frame, name);
    assert.equal(result.state.running, running);
    assert.equal(result.name, "Bend <quiet>");
    assert.equal(result.live, false);
    assert.equal(result.status, "Loading documents");
    assert.equal(result.busy, "true");
    if (format === "svg") {
      assert.equal(result.eyes, mini.frames[name].eyes);
      assert.equal(result.body, baseline.body);
    } else assert.equal(result.glyph, mini.frames[name].ascii);
    assert.equal(result.width, baseline.width);
    assert.equal(result.height, baseline.height);
    assert.equal((await audit()).timers, running ? 1 : 0);
  };

  await page.evaluate((format) => {
    document.querySelector("main").innerHTML =
      SituateBendMini.render({
        format,
        decorative: false,
        title: "Bend <quiet>",
      }) +
      '<span id="status">Loading documents</span>' +
      SituateBendMini.render({ format });
    document.querySelector("main").setAttribute("aria-busy", "true");
    window.icon = document.querySelector("[data-bend-mini]");
    icon.id = "icon";
    document.querySelectorAll("[data-bend-mini]")[1].id = "decorative";
    window.controller = SituateBendMini.create(icon);
  }, format);
  const baseline = await page.evaluate(() => ({
    body: icon.querySelector("[data-mini-body]")?.outerHTML,
    width: icon.getBoundingClientRect().width,
    height: icon.getBoundingClientRect().height,
  }));
  await settle();
  await frame("rest", false);
  assert.equal((await state()).busy, false);
  const named = await axNode(page, "#icon");
  assert.equal(named.role.value, "image");
  assert.equal(named.name.value, "Bend <quiet>");
  assert.equal((await axNode(page, "#decorative")).ignored, true);
  await page.evaluate(() => {
    for (const value of ["true", 1, null]) {
      let rejected = false;
      try {
        controller.setBusy(value);
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      if (!rejected) throw new Error("Nonboolean busy state was accepted.");
    }
    icon.setAttribute("data-busy", "true");
    icon.setAttribute("aria-busy", "true");
  });
  await page.clock.runFor(3000);
  await frame("rest", false);
  await page.evaluate(() => controller.resume());
  await frame("rest", false);

  await page.evaluate(() => controller.setBusy(true));
  await frame("rest");
  await page.clock.runFor(899);
  await frame("rest");
  await page.evaluate(() => controller.setBusy(true));
  await page.clock.runFor(1);
  await frame("focus");
  await page.clock.runFor(599);
  await frame("focus");
  await page.clock.runFor(1);
  await frame("blink");
  const blinking = await axNode(page, "#icon");
  assert.equal(blinking.role.value, "image");
  assert.equal(blinking.name.value, named.name.value);
  await page.clock.runFor(119);
  await frame("blink");
  await page.clock.runFor(1);
  await frame("rest");
  await page.clock.runFor(780);
  await frame("rest");
  await page.clock.runFor(900);
  await frame("focus");
  await page.evaluate(() => controller.setBusy(false));
  await frame("rest", false);

  await page.evaluate(() => {
    controller.pause();
    controller.setBusy(true);
  });
  await frame("rest", false);
  assert.equal((await state()).paused, true);
  await page.evaluate(() => controller.setBusy(false));
  await page.evaluate(() => controller.setBusy(true));
  await frame("rest", false);
  await page.evaluate(() => controller.resume());
  await page.clock.runFor(900);
  await frame("focus");
  await page.evaluate(() => controller.pause());
  await frame("rest", false);
  await page.clock.runFor(5000);
  await page.evaluate(() => controller.resume());
  await frame("rest");
  await page.clock.runFor(899);
  await frame("rest");
  await page.clock.runFor(1);
  await frame("focus");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await settle();
  await frame("rest", false);
  await page.evaluate(() => controller.resume());
  await frame("rest", false);
  await page.clock.runFor(5000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settle();
  await frame("rest");
  await page.clock.runFor(900);
  await frame("focus");

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await frame("rest", false);
  const suspendedCallbacks = (await audit()).callbacks;
  await page.clock.runFor(10000);
  assert.equal((await audit()).callbacks, suspendedCallbacks);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await frame("rest");
  await page.clock.runFor(900);
  await frame("focus");

  await page.evaluate(() => {
    icon.style.transform = "translateY(2000px)";
    window.dispatchEvent(new Event("scroll"));
  });
  await settle();
  await frame("rest", false);
  await page.clock.runFor(10000);
  await page.evaluate(() => {
    icon.style.transform = "";
    window.dispatchEvent(new Event("resize"));
  });
  await settle();
  await frame("rest");
  await page.clock.runFor(900);
  await frame("focus");
  await page.evaluate(() => {
    document.querySelector("main").style.display = "none";
  });
  await settle();
  assert.equal((await state()).running, false);
  assert.equal((await audit()).timers, 0);
  await page.evaluate(() => {
    document.querySelector("main").style.display = "";
  });
  await settle();
  await frame("rest");

  // IntersectionObserver also handles clipping that viewport bounds alone cannot detect.
  if (!fallback) {
    await page.evaluate(() => {
      const main = document.querySelector("main");
      main.style.cssText = "width:1px;height:1px;overflow:hidden";
      icon.style.transform = "translateX(20px)";
    });
    await settle();
    await frame("rest", false);
    await page.evaluate(() => {
      document.querySelector("main").style.cssText = "";
      icon.style.transform = "";
    });
    await settle();
    await frame("rest");
  }

  await page.evaluate(() => icon.remove());
  await settle();
  assert.equal((await state()).running, false);
  assert.equal((await audit()).timers, 0);
  await page.clock.runFor(10000);
  await page.evaluate(() => {
    controller.pause();
    document.querySelector("main").prepend(icon);
  });
  await settle();
  await frame("rest", false);
  await page.evaluate(() => controller.resume());
  await settle();
  await frame("rest");

  await page.evaluate(() => {
    window.oldController = controller;
    window.controller = SituateBendMini.create(icon);
    oldController.setBusy(true);
    oldController.resume();
    oldController.pause();
    oldController.destroy();
  });
  await frame("rest", false);
  assert.equal(await page.evaluate(() => oldController.state.destroyed), true);
  await page.evaluate(() => controller.setBusy(true));
  await settle();
  await frame("rest");
  await page.evaluate(() => {
    controller.destroy();
    controller.destroy();
    controller.setBusy(true);
    controller.setBusy("ignored after destruction");
    controller.pause();
    controller.resume();
  });
  await frame("rest", false);
  const final = await audit();
  assert.deepEqual(
    { ...final, callbacks: 0 },
    { timers: 0, listeners: 0, intersections: 0, mutations: 0, callbacks: 0 },
  );
  await page.clock.runFor(10000);
  assert.equal((await audit()).callbacks, final.callbacks);

  // Creation outside the viewport, detached, and under reduced motion is still.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    controller = SituateBendMini.create(icon);
    controller.setBusy(true);
  });
  await settle();
  await frame("rest", false);
  await page.evaluate(() => {
    controller.destroy();
    icon.remove();
    controller = SituateBendMini.create(icon);
    controller.setBusy(true);
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settle();
  assert.equal((await audit()).timers, 0);
  await page.evaluate(() => {
    controller.destroy();
    icon.style.transform = "translateX(-2000px)";
    document.querySelector("main").prepend(icon);
    controller = SituateBendMini.create(icon);
    controller.setBusy(true);
  });
  await settle();
  await frame("rest", false);
  await page.evaluate(() => controller.destroy());
  assert.equal((await audit()).listeners, 0);
  assert.equal((await audit()).mutations, 0);
  await page.close();
  console.log(
    `Verified ${format}: stepped score, stable geometry and box, accessible names, lifecycle, reduced motion, hidden state (simulated), bounds, teardown${fallback ? " without IntersectionObserver" : " with IntersectionObserver"}.`,
  );
}

async function proofs(browser, directory, errors) {
  const page = await browser.newPage({
    viewport: { width: 800, height: 500 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await load(page);
  await page.addStyleTag({
    content: `body{margin:0;font:14px system-ui;background:${colors.paper};color:${colors.ink}} main{padding:24px}section{padding:20px;margin:8px 0;background:${colors.surface}}section.dark{background:${colors.plum};color:${colors.surface}}.row{display:flex;align-items:center;gap:16px;margin:20px 0}.sample{display:flex;align-items:center}h1{font-size:20px}`,
  });
  for (const name of ["mini.svg", "mini-light.svg"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    const result = await page.evaluate(async (source) => {
      const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
      const url = URL.createObjectURL(
        new Blob([source], { type: "image/svg+xml" }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return {
          errors: parsed.querySelectorAll("parsererror").length,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, source);
    assert.deepEqual(result, { errors: 0, width: 24, height: 24 });
  }
  await page.evaluate(() => {
    const frameRow = (format) =>
      '<div class="row">' +
      Object.keys(SituateBendMini.frames)
        .map(
          (frame) =>
            `<span class="sample" data-proof="${frame}">${SituateBendMini.render({ format })}${frame}</span>`,
        )
        .join("") +
      "</div>";
    document.querySelector("main").innerHTML =
      "<h1>Bend mini</h1>" +
      ["", "dark"]
        .map(
          (theme) =>
            `<section class="${theme}"><div class="row">` +
            [16, 24, 32]
              .map(
                (size) =>
                  `<span class="sample" style="--bend-mini-size:${size}px">${SituateBendMini.render()}${size} px</span>`,
              )
              .join("") +
            "</div>" +
            frameRow("svg") +
            frameRow("ascii") +
            "</section>",
        )
        .join("");
    for (const sample of document.querySelectorAll("[data-proof]")) {
      const frame = SituateBendMini.frames[sample.dataset.proof];
      const glyph = sample.querySelector("[data-mini-glyph]");
      if (glyph) glyph.textContent = frame.ascii;
      else
        sample.querySelector("[data-mini-eyes]").setAttribute("d", frame.eyes);
    }
  });
  const measurements = await page.evaluate(() =>
    [...document.querySelectorAll("[data-bend-mini]")].map((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        format: element.dataset.bendMini,
        width: bounds.width,
        height: bounds.height,
        font: style.fontFamily,
        size: style.fontSize,
        lineHeight: style.lineHeight,
        gap: style.marginInlineEnd,
        ligatures: style.fontVariantLigatures,
      };
    }),
  );
  for (const item of measurements) {
    assert.equal(item.gap, "8px");
    if (item.format === "ascii") {
      assert.equal(item.size, "10px");
      assert.equal(item.lineHeight, "10px");
      assert.equal(item.height, 30);
      assert.ok(item.width >= 25 && item.width <= 35);
      assert.equal(item.ligatures, "none");
    }
  }
  assert.deepEqual(
    measurements
      .filter((item) => item.format === "svg")
      .map((item) => item.width),
    [16, 24, 32, 24, 24, 24, 16, 24, 32, 24, 24, 24],
  );
  await page.screenshot({
    path: path.join(directory, "mini-sizes-and-frames.png"),
    fullPage: true,
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "[data-mini-glyph]",
  });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  console.log(
    `ASCII font and box: ${JSON.stringify({ fonts, measurement: measurements.find((item) => item.format === "ascii") })}`,
  );
  await cdp.detach();
  await page.evaluate(() => {
    document
      .querySelector(".bend-mini--svg")
      .style.setProperty("--bend-mini-size", "8px");
  });
  assert.equal(
    await page
      .locator(".bend-mini--svg")
      .first()
      .evaluate((element) => element.getBoundingClientRect().width),
    16,
  );
  await page.close();
}

(async () => {
  const browser = await launchBrowser(chromium, {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  });
  const errors = [];
  const directory =
    process.env.MINI_SCREENSHOTS ||
    fs.mkdtempSync(path.join(os.tmpdir(), "bend-mini-proof-"));
  fs.mkdirSync(directory, { recursive: true });
  try {
    console.log(`Browser: ${browser.version()}`);
    for (const format of ["svg", "ascii"]) {
      await exercise(browser, format, false, errors);
      await exercise(browser, format, true, errors);
    }
    await proofs(browser, directory, errors);
    assert.deepEqual(errors, []);
    console.log(`Screenshots: ${directory}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
