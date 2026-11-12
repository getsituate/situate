"use strict";
const assert = require("node:assert/strict");
const { launchBrowser } = require("../browser-launch.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync, spawnSync } = require("node:child_process");
const os = require("node:os");

const bundledChannel =
  process.platform === "linux" ? "chromium-headless-shell" : "chromium";
for (const [options, expectedChannel] of [
  [{}, bundledChannel],
  [{ headless: true, args: Object.freeze(["--lang=en-US"]) }, bundledChannel],
  [{ headless: false }, "chromium"],
]) {
  Object.freeze(options);
  const launched = launchBrowser({ launch: (value) => value }, options);
  assert.deepEqual(
    launched,
    { ...options, channel: expectedChannel },
    "Headless Linux uses bundled Chromium shell without changing other launch settings",
  );
}
for (const options of [
  { channel: "chromium", headless: true },
  { channel: "chrome", headless: true },
  { executablePath: "/test/chromium" },
  { channel: "chromium", executablePath: "/test/chromium" },
]) {
  Object.freeze(options);
  assert.equal(
    launchBrowser({ launch: (value) => value }, options),
    options,
    "Explicit browser channels and executable paths take precedence",
  );
}

const brand = path.resolve(__dirname, "..");
const tokens = JSON.parse(
  fs.readFileSync(path.join(brand, "tokens.json"), "utf8"),
);
execFileSync(process.execPath, [
  path.join(brand, "build-tokens.cjs"),
  "--check",
]);
execFileSync(process.execPath, [
  path.join(brand, "build-scenes.cjs"),
  "--check",
]);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "situate-token-check-"));
try {
  for (const filename of ["build-tokens.cjs", "tokens.json", "tokens.css"])
    fs.copyFileSync(path.join(brand, filename), path.join(scratch, filename));
  fs.appendFileSync(path.join(scratch, "tokens.css"), "\n/* drift */\n");
  assert.equal(
    spawnSync(process.execPath, [
      path.join(scratch, "build-tokens.cjs"),
      "--check",
    ]).status,
    1,
    "Token drift detection",
  );
  execFileSync(process.execPath, [path.join(scratch, "build-tokens.cjs")]);
  assert.equal(
    fs.readFileSync(path.join(scratch, "tokens.css"), "utf8"),
    fs.readFileSync(path.join(brand, "tokens.css"), "utf8"),
    "Deterministic token generation",
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
for (const filename of fs.readdirSync(path.join(brand, "assets"))) {
  if (path.extname(filename) !== ".svg") {
    assert.equal(filename, "wordmark-print-transparent.png");
    continue;
  }
  const content = fs.readFileSync(path.join(brand, "assets", filename), "utf8");
  assert.match(content, /<svg[^>]+viewBox=/, filename);
  assert.match(content, /<title[^>]*>[^<]+<\/title>/, filename);
  assert.doesNotMatch(content, /<(?:script|foreignObject|image)\b/i, filename);
  for (const match of content.matchAll(/(?:href|src)="([^"]+)"/g))
    assert.ok(
      match[1].startsWith("#"),
      `${filename}: external asset reference`,
    );
}
for (const [name, hex] of Object.entries(tokens.colors))
  assert.match(hex, /^#[a-f0-9]{6}$/, name);
assert.equal(tokens.colors["bend-front"], "#a77bff");
assert.equal(tokens.colors["bend-depth"], "#56329b");
assert.equal(tokens.radii["radius-card"], "28px");
assert.equal(tokens.radii["radius-note"], "15px");
assert.equal(tokens.type["leading-body"], "1.55");
for (const filename of ["index.html", "illustrations.html"]) {
  const html = fs.readFileSync(path.join(__dirname, filename), "utf8");
  assert.doesNotMatch(html, /(?:src|href)="https?:/i);
  assert.doesNotMatch(html, /mascot-studies|brand-motion|brand-explorations/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(
    new Set(ids).size,
    ids.length,
    `${filename}: duplicate HTML IDs`,
  );
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = match[1];
    if (target.startsWith("#"))
      assert.ok(ids.includes(target.slice(1)), `Missing anchor: ${target}`);
    else {
      const [relativePath, fragment] = target.split("#");
      const file = path.resolve(__dirname, relativePath);
      assert.ok(fs.existsSync(file), `Missing local file: ${target}`);
      if (fragment && relativePath.endsWith(".html"))
        assert.ok(
          fs.readFileSync(file, "utf8").includes(`id="${fragment}"`),
          `Missing linked HTML anchor: ${target}`,
        );
      if (fragment && relativePath.endsWith(".md")) {
        const headings = [
          ...fs.readFileSync(file, "utf8").matchAll(/^#{1,6} (.+)$/gm),
        ].map((match) =>
          match[1]
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .replace(/\s/g, "-"),
        );
        assert.ok(
          headings.includes(fragment),
          `Missing linked heading: ${target}`,
        );
      }
    }
  }
}
const objectGroups = {
  collect: [
    "collection-folder",
    "paper-tray",
    "tabbed-dividers",
    "archive-box",
    "note-bundle",
  ],
  find: [
    "search-lens",
    "bookmark-clip",
    "linked-notes",
    "folded-map",
    "tag-pair",
  ],
  plan: [
    "desk-calendar",
    "day-strip",
    "pencil-trail",
    "modular-pieces",
    "milestone-flag",
  ],
  personal: [
    "reading-lamp",
    "ribbon-cup",
    "landscape-print",
    "travel-wallet",
    "paper-mobile",
  ],
  companions: ["page", "book", "open-book", "card", "folded-leaf"],
};
const backgroundFiles = [
  "ribbon",
  "background-offset-discs",
  "background-scalloped-edge",
  "background-folded-corner",
  "background-stepped-planes",
  "background-wave-field",
  "background-cutout-window",
  "background-paper-fan",
  "background-pebble-cluster",
  "background-lens-pair",
  "background-dash-rhythm",
  "background-petal-rosette",
  "background-orbit-arcs",
];
const compositionFiles = [
  "quiet-ribbon",
  "panorama",
  "reading-garden",
  "gathering",
];
const illustrationFiles = [
  ...Object.values(objectGroups).flat(),
  ...backgroundFiles,
  ...compositionFiles,
];
const excludedAssets = {
  identity: ["app-icon", "wordmark", "wordmark-light"],
  generatedPanoramaLayers: [
    "panorama-back-ribbons",
    "panorama-back-objects",
    "panorama-front-ribbons",
    "panorama-front-objects",
  ],
};
const excludedRasterAssets = ["wordmark-print-transparent.png"];
const specialistResources = {
  characterConstructionAndExports: "../bend/index.html",
  compactMarks: "index.html#mini-bend",
  welcomeChoreography: "../examples/first-hello/index.html",
  embeddedRecordSleeveAndCoverIllustrations:
    "../examples/listening-room/index.html",
};
const library = fs.readFileSync(
  path.join(__dirname, "illustrations.html"),
  "utf8",
);
const overview = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const provenance = fs.readFileSync(
  path.join(brand, "docs/provenance.md"),
  "utf8",
);
const palette = new Set(Object.values(tokens.colors));
const catalogued = [...library.matchAll(/data-asset="([^"]+)"/g)].map(
  (match) => match[1],
);
assert.equal(
  new Set(catalogued).size,
  catalogued.length,
  "No duplicate catalogue entries",
);
assert.deepEqual(
  catalogued.toSorted(),
  illustrationFiles.toSorted(),
  "Complete illustration catalogue",
);
const classifiedAssets = [
  ...illustrationFiles,
  ...Object.values(excludedAssets).flat(),
];
assert.equal(
  new Set(classifiedAssets).size,
  classifiedAssets.length,
  "Asset classifications are disjoint",
);
assert.deepEqual(
  fs.readdirSync(path.join(brand, "assets"), { recursive: true }).toSorted(),
  [
    ...classifiedAssets.map((name) => `${name}.svg`),
    ...excludedRasterAssets,
  ].toSorted(),
  "Every asset must be catalogued or explicitly classified as identity/generated artwork",
);
assert.doesNotMatch(
  library,
  /<(?:script|svg|iframe)\b/i,
  "Static catalogue uses canonical external artwork",
);
for (const href of Object.values(specialistResources))
  assert.ok(library.includes(`href="${href}"`), `Specialist resource: ${href}`);
assert.ok(library.includes('href="index.html#identity"'), "Identity guidance");
assert.ok(
  library.includes('href="../docs/provenance.md#identity-marks"'),
  "Identity source files remain discoverable",
);
assert.ok(
  library.includes('href="../docs/illustration.md#panoramic-welcome"'),
  "Generated layer recipe",
);
const overviewIllustration = overview.slice(
  overview.indexOf('id="illustration"'),
  overview.indexOf('id="motion"'),
);
assert.doesNotMatch(
  overviewIllustration,
  /asset-grid|href="\.\.\/assets\//,
  "Asset selection belongs in the catalogue",
);
assert.equal(
  (overviewIllustration.match(/href="illustrations.html"/g) || []).length,
  1,
);
assert.ok(
  overviewIllustration.includes('src="../assets/quiet-ribbon.svg"'),
  "Composition grammar remains",
);
for (const name of illustrationFiles) {
  const filename = `${name}.svg`;
  const svg = fs.readFileSync(path.join(brand, "assets", filename), "utf8");
  assert.equal(
    [
      ...library.matchAll(
        new RegExp(`href="../assets/${filename.replace(".", "\\.")}"`, "g"),
      ),
    ].length,
    1,
    `${filename}: one source link`,
  );
  assert.ok(
    provenance.includes(`assets/${filename}`),
    `${filename}: provenance`,
  );
  assert.doesNotMatch(
    svg,
    /<(?:text|filter|linearGradient|radialGradient|animate\w*|set|style)\b|\son\w+\s*=|<!ENTITY/i,
    `${filename}: static flat vector artwork`,
  );
  for (const [, color] of svg.matchAll(/(?:fill|stroke)="([^"]+)"/gi))
    assert.ok(
      color === "none" || palette.has(color.toLowerCase()),
      `${filename}: palette color ${color}`,
    );
  if (
    Object.values(objectGroups).slice(0, 4).flat().includes(name) ||
    name.startsWith("background-")
  ) {
    assert.match(svg, /<desc[^>]*>[^<]+<\/desc>/, `${filename}: description`);
    assert.match(svg, /<svg[^>]*role="img"/, `${filename}: image role`);
    assert.match(
      svg,
      /<svg[^>]*aria-labelledby="[^"]+"/,
      `${filename}: accessible name`,
    );
  }
  if (name.startsWith("background-")) {
    assert.doesNotMatch(
      svg,
      /<(?:image|foreignObject|script)\b|data-bend|@import|url\(\s*["']?(?!#)/i,
      filename,
    );
    const viewBox = svg
      .match(/<svg[^>]*viewBox="([^"]+)"/)?.[1]
      .trim()
      .split(/\s+/)
      .map(Number);
    assert.ok(
      viewBox?.length === 4 &&
        viewBox.every(Number.isFinite) &&
        viewBox[2] > 0 &&
        viewBox[3] > 0,
      `${filename}: valid frame`,
    );
    assert.ok(
      Buffer.byteLength(svg) < 50000,
      `${filename}: lightweight background`,
    );
  }
}
console.log(
  "Token generation, complete artwork inventory, provenance, HTML IDs and local links passed.",
);

async function illustrationBrowserChecks(browser) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    offline: true,
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  const url = pathToFileURL(path.join(__dirname, "illustrations.html")).href;
  try {
    await page.goto(url);
    for (const [group, items] of Object.entries(objectGroups))
      assert.equal(
        await page.locator(`#${group} .illustration-card`).count(),
        items.length,
      );
    for (const [group, items] of [
      ["objects", Object.values(objectGroups).flat()],
      ["backgrounds", backgroundFiles],
      ["compositions", compositionFiles],
    ])
      assert.equal(
        await page.locator(`#${group} .illustration-card`).count(),
        items.length,
      );
    assert.equal(
      await page.locator(".illustration-card").count(),
      illustrationFiles.length,
    );
    for (const name of illustrationFiles) {
      const card = page.locator(`[data-asset="${name}"]`);
      assert.equal(
        await card.locator(".illustration-pair[aria-hidden=true]").count(),
        1,
      );
      assert.equal(
        await card.locator(".illustration-field.paper img[alt='']").count(),
        1,
      );
      assert.equal(
        await card.locator(".illustration-field.plum img[alt='']").count(),
        1,
      );
      assert.deepEqual(
        await card
          .locator("img")
          .evaluateAll((images) =>
            images.map((image) => image.getAttribute("src")),
          ),
        [`../assets/${name}.svg`, `../assets/${name}.svg`],
      );
      assert.match(
        await card.ariaSnapshot(),
        /link ".+Open SVG"/,
        `${name}: accessible source link`,
      );
    }
    assert.equal(await page.locator(".placement-art").count(), 3);
    for (const artwork of await page.locator(".placement-art").all()) {
      assert.equal(
        await artwork.innerText(),
        "",
        "No functional copy inside artwork",
      );
      assert.equal(
        await artwork.locator("img").count(),
        2,
        "One background and one object",
      );
      assert.ok(
        await artwork.getAttribute("aria-label"),
        "Composition sample description",
      );
    }
    assert.equal(
      await page.evaluate(() =>
        [
          ...document.querySelectorAll("[aria-labelledby], [aria-describedby]"),
        ].every((node) =>
          ["aria-labelledby", "aria-describedby"].every((attribute) =>
            (node.getAttribute(attribute) || "")
              .split(/\s+/)
              .filter(Boolean)
              .every((id) => document.getElementById(id)?.textContent.trim()),
          ),
        ),
      ),
      true,
      "ARIA references resolve to meaningful text",
    );
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      await page.locator("script, button, input, select").count(),
      0,
      "No script-dependent controls",
    );
    async function checkLayout(label) {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Catalogue overflow: ${label}`,
      );
      assert.equal(
        await page.evaluate(() =>
          [...document.images].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        ),
        true,
        "Loaded catalogue artwork",
      );
      assert.equal(
        await page
          .locator(".illustration-card, .resource-card, nav a")
          .evaluateAll((links) =>
            links.every((link) => link.getBoundingClientRect().height >= 44),
          ),
        true,
        `Link targets: ${label}`,
      );
      assert.equal(
        await page
          .locator(".illustration-card, .resource-card")
          .evaluateAll((cards) =>
            cards.every((card) => card.scrollWidth <= card.clientWidth + 1),
          ),
        true,
        `Card text reflows: ${label}`,
      );
      assert.equal(
        await page.locator(".placement-art").evaluateAll((samples) =>
          samples.every((sample) => {
            const frame = sample.getBoundingClientRect();
            const object = sample
              .querySelector(".placement-object")
              .getBoundingClientRect();
            const background = sample
              .querySelector(".placement-background")
              .getBoundingClientRect();
            return (
              object.left >= frame.left + frame.width * 0.35 &&
              object.right <= frame.right &&
              object.top >= frame.top &&
              object.bottom <= frame.bottom &&
              background.left >= frame.left + frame.width * 0.35 &&
              background.right > frame.right
            );
          }),
        ),
        true,
        `Samples keep whole objects, cropped backgrounds and quiet space: ${label}`,
      );
      assert.equal(
        await page
          .locator(".background-grid .illustration-field")
          .evaluateAll((fields) =>
            fields.every((field) => {
              const rect = field.getBoundingClientRect();
              return Math.abs(rect.width / rect.height - 4 / 3) < 0.02;
            }),
          ),
        true,
        `Consistent background preview frames: ${label}`,
      );
    }
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await checkLayout(`${width}px`);
    }
    for (const [width, zoom] of [
      [375, 2],
      [1440, 4],
    ]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = String(zoom);
      }, zoom);
      await checkLayout(`${width}px, ${zoom * 100}% CSS zoom`);
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.SCREENSHOT_DIR) {
      await page.goto(url);
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      for (const group of [
        "collect",
        "find",
        "plan",
        "personal",
        "companions",
        "backgrounds",
        "compositions",
        "character",
      ]) {
        const section = page.locator(`#${group}`);
        const height = await section.evaluate((node) =>
          Math.ceil(node.getBoundingClientRect().height),
        );
        // Beyond-viewport clips can include fixed elements positioned offscreen.
        await page.setViewportSize({
          width: 1440,
          height: Math.max(1000, height + 160),
        });
        await section.screenshot({
          path: path.join(
            process.env.SCREENSHOT_DIR,
            `illustrations-${group}.png`,
          ),
        });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.goto(url);
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator(".skip")
        .evaluate((link) => link === document.activeElement),
      true,
      "Skip link first",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page
        .locator("main")
        .evaluate((main) => main === document.activeElement),
      true,
      "Skip link targets main",
    );
    for (const id of [
      "objects",
      "backgrounds",
      "compositions",
      "character",
      ...Object.keys(objectGroups),
    ]) {
      await page.locator(`nav a[href="#${id}"]`).focus();
      await page.keyboard.press("Enter");
      assert.equal(
        new URL(page.url()).hash,
        `#${id}`,
        "Keyboard group navigation",
      );
      assert.ok(
        await page.locator(`#${id}`).evaluate((section) => {
          const top = section.getBoundingClientRect().top;
          return top >= 0 && top < innerHeight;
        }),
        `Group heading visible: ${id}`,
      );
    }
    const links = page.locator(".illustration-card, .resource-card");
    for (let index = 0; index < (await links.count()); index++) {
      if (index === 0) await links.nth(index).focus();
      else await page.keyboard.press("Tab");
      assert.equal(
        await links
          .nth(index)
          .evaluate(
            (link) =>
              link === document.activeElement &&
              getComputedStyle(link).outlineStyle !== "none",
          ),
        true,
        `Visible keyboard focus: catalogue link ${index + 1}`,
      );
      // Recipe links sit between the composition cards and specialist resources.
      if (index === illustrationFiles.length - 1)
        await page.keyboard.press("Tab");
    }
    await page.locator("#collect .illustration-card").nth(1).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/paper-tray.svg");
    for (const name of illustrationFiles) {
      await page.goto(
        pathToFileURL(path.join(brand, "assets", `${name}.svg`)).href,
      );
      assert.equal(
        await page.locator("parsererror").count(),
        0,
        `${name}: SVG parses`,
      );
      assert.equal(await page.locator("svg").count(), 1);
      assert.ok(
        await page.locator("svg > title").textContent(),
        `${name}: title`,
      );
      assert.equal(
        await page.evaluate(() => {
          const ids = [...document.querySelectorAll("[id]")].map(
            (node) => node.id,
          );
          return (
            new Set(ids).size === ids.length &&
            [
              ...document.querySelectorAll(
                "[aria-labelledby], [aria-describedby]",
              ),
            ].every((node) =>
              ["aria-labelledby", "aria-describedby"].every((attribute) =>
                (node.getAttribute(attribute) || "")
                  .split(/\s+/)
                  .filter(Boolean)
                  .every((id) =>
                    document.getElementById(id)?.textContent.trim(),
                  ),
              ),
            ) &&
            [...document.querySelectorAll("[href]")].every((node) => {
              const target = node.getAttribute("href");
              return (
                target.startsWith("#") &&
                document.getElementById(target.slice(1))
              );
            })
          );
        }),
        true,
        `${name}: unique IDs and valid local/ARIA references`,
      );
    }
    assert.deepEqual(errors, [], "Catalogue browser errors");
    assert.ok(
      requests.every((url) => url.startsWith("file:")),
      "No-JS offline catalogue",
    );
  } finally {
    await context.close();
  }
}

async function browserChecks() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await launchBrowser(chromium, {
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : { channel: process.env.BROWSER_CHANNEL }),
  });
  try {
    await illustrationBrowserChecks(browser);
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const accessibility = await page.context().newCDPSession(page);
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    await page.waitForFunction(
      () => document.querySelectorAll('[data-bend-part="figure"]').length > 20,
    );
    assert.deepEqual(errors, [], "Browser errors");
    assert.ok(
      requests.every((url) => url.startsWith("file:")),
      "Remote request",
    );
    assert.equal(await page.locator("#dependency-status").isVisible(), false);
    assert.equal(await page.locator("#palette .swatch").count(), 12);
    assert.equal(await page.locator("#expression-grid svg").count(), 5);
    assert.equal(await page.locator("#size-comparisons svg").count(), 8);
    assert.equal(
      await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map(
          (node) => node.id,
        );
        return new Set(ids).size === ids.length;
      }),
      true,
      "Unique generated IDs",
    );
    assert.equal(
      await page.evaluate(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      ),
      true,
      "Loaded artwork",
    );
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(50);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
      if (width <= 375) {
        await page.locator("#welcome-scene").scrollIntoViewIfNeeded();
        assert.equal(
          await page.locator("#welcome-scene").evaluate((scene) => {
            const svg = scene.querySelector(".hero-bend svg");
            return [
              [110, 265],
              [220, 260],
            ].every(([x, y]) => {
              const point = new DOMPoint(x, y).matrixTransform(
                svg.getScreenCTM(),
              );
              return svg.contains(document.elementFromPoint(point.x, point.y));
            });
          }),
          true,
          `Bend feet unobscured at ${width}px`,
        );
        await page.locator("#list-title").fill("Reading".repeat(8));
        await page.locator("#title-form button").click();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `Accepted long name reflows at ${width}px`,
        );
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      const rect = document
        .querySelector("#ambient-toggle")
        .getBoundingClientRect();
      scrollBy(0, rect.top + rect.height / 2 - (innerHeight - 30));
    });
    assert.equal(
      await page.locator("#ambient-toggle").evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          ),
        );
      }),
      true,
      "Global motion control must not obscure the scene controls",
    );
    await page.locator("#task-book").check();
    assert.equal(await page.locator("#task-count").textContent(), "1 open");
    await page.locator("#task-book").uncheck();
    assert.equal(await page.locator("#task-count").textContent(), "2 open");
    await page.locator('[data-density="compact"]').click();
    assert.match(
      await page.locator(".workspace").getAttribute("class"),
      /compact/,
    );
    await page.locator("#reset-workspace").click();
    assert.doesNotMatch(
      await page.locator(".workspace").getAttribute("class"),
      /compact/,
    );
    const noteOpener = page.locator(".note-button");
    await noteOpener.click();
    assert.equal(
      await page.locator("#note-dialog").evaluate((dialog) => dialog.open),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await noteOpener.evaluate((button) => button === document.activeElement),
      true,
      "Dialog focus return",
    );
    assert.doesNotMatch(
      await description("#list-title"),
      /Enter a name/,
      "Valid input does not announce an error",
    );
    await noteOpener.click();
    assert.equal(
      await page.evaluate(async () => {
        const dialog = document.querySelector("#note-dialog");
        const input = document.querySelector("#list-title");
        const closed = new Promise((resolve) => {
          dialog.addEventListener("close", resolve, { once: true });
        });
        dialog.close();
        input.focus();
        await closed;
        return document.activeElement === input;
      }),
      true,
      "A queued dialog close must not steal focus from the next field",
    );
    await page.locator("#list-title").fill("");
    await page.locator("#title-form button").click();
    assert.equal(
      await page.locator("#list-title").getAttribute("aria-invalid"),
      "true",
    );
    assert.match(
      await description("#list-title"),
      /Enter a name/,
      "Invalid input describes its error",
    );
    await page.locator("#list-title").fill("A place for books");
    await page.locator("#title-form button").click();
    assert.equal(
      await page.locator("#field-result").textContent(),
      "Current name: A place for books",
    );
    assert.doesNotMatch(
      await description("#list-title"),
      /Enter a name/,
      "Recovery removes the error description",
    );
    await page.locator("#pose-select").selectOption("read");
    await page.locator("#expression-select").selectOption("thinking");
    assert.equal(
      await page.locator("#pose-bend svg").getAttribute("data-bend-pose"),
      "read",
    );
    await page.locator("#make-list").click();
    assert.equal(await page.locator("#made-list").isVisible(), true);
    await page.locator("#made-list select").first().selectOption("Finished");
    await page.locator("#undo-list").click();
    assert.equal(await page.locator("#made-list").isVisible(), false);
    assert.equal(
      await page.locator("#made-list select").first().inputValue(),
      "Considering",
    );
    await page.locator('[data-choice="Reading ideas"]').click();
    assert.equal(
      await page
        .locator('[data-choice="Reading ideas"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#clear-choice").click();
    assert.equal(
      await page
        .locator('[data-choice="Reading ideas"]')
        .getAttribute("aria-pressed"),
      "false",
    );
    await page.locator("#retry-preview").click();
    assert.equal(
      await page.locator("#recovery-title").textContent(),
      "The preview is ready.",
    );
    await page.locator("#reset-recovery").click();
    assert.equal(
      await page.locator("#recovery-title").textContent(),
      "The preview didn’t open.",
    );
    await page.locator("#welcome-scene").scrollIntoViewIfNeeded();
    await page.locator("#ambient-toggle").click();
    assert.equal(
      await page.locator("#ambient-toggle").getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForTimeout(100);
    const ambientStates = () =>
      page
        .locator("#welcome-scene [data-ambient-layer]")
        .evaluateAll((images) =>
          images.flatMap((image) =>
            image.getAnimations().map((animation) => animation.playState),
          ),
        );
    assert.deepEqual(await ambientStates(), ["running", "running"]);
    assert.equal(
      await page
        .locator("#welcome-scene [data-still-layer]")
        .evaluateAll((images) =>
          images.reduce(
            (total, image) => total + image.getAnimations().length,
            0,
          ),
        ),
      0,
      "Objects remain still during ambient drift",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.deepEqual(
      await ambientStates(),
      ["paused", "paused"],
      "Visibility handler suspends ambient",
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.deepEqual(await ambientStates(), ["running", "running"]);
    await page.locator("#motion-toggle").click();
    assert.deepEqual(await ambientStates(), ["paused", "paused"]);
    await page.locator("#motion-toggle").click();
    await page.locator("#everyday").scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    assert.deepEqual(
      await ambientStates(),
      ["paused", "paused"],
      "Offscreen ambient suspended",
    );
    await page.locator("#welcome-scene").scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    assert.deepEqual(await ambientStates(), ["running", "running"]);
    await page.evaluate(() =>
      document.querySelector("#note-dialog").showModal(),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    assert.deepEqual(
      await ambientStates(),
      ["paused", "paused"],
      "Modal ambient suspended",
    );
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    assert.deepEqual(
      await ambientStates(),
      [],
      "Live reduced motion cancels ambient",
    );
    assert.equal(await page.locator("#motion-toggle").isDisabled(), true);
    await page.locator("#make-list").click();
    assert.equal(
      await page.locator("#made-list").isVisible(),
      true,
      "Result independent of motion",
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
    await page.locator("#welcome-scene").scrollIntoViewIfNeeded();
    await page.locator("#ambient-toggle").click();
    await page.locator('[data-replay="welcome-scene"]').click();
    await page.waitForTimeout(2400);
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
      0,
      "Replay is finite",
    );
    assert.deepEqual(errors, [], "Browser errors after interaction");
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.SCREENSHOT_DIR, "reference-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.screenshot({
        path: path.join(process.env.SCREENSHOT_DIR, "reference-mobile.png"),
        fullPage: true,
      });
    }
    console.log(
      "Offline Chromium checks passed: responsive layout, interactions, dialogs, SVG IDs, finite gestures, ambient suspension and live reduced motion.",
    );
  } finally {
    await browser.close();
  }
}
if (process.argv.includes("--browser"))
  browserChecks().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
