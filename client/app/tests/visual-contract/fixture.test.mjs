import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { visualPixelComparison } from "../browser/visual-checkpoints.mjs";

const cli = fileURLToPath(
  new URL("../../../node_modules/@playwright/test/cli.js", import.meta.url),
);
const fixture = fileURLToPath(new URL("../browser/test.ts", import.meta.url));

function run({
  visualEnabled = true,
  mode = "real",
  tag = "@visual-desktop",
  update = "none",
  body,
}) {
  const directory = mkdtempSync(join(tmpdir(), "situate-visual-fixture-"));
  try {
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(directory, "playwright.config.mjs"),
      `export default ${JSON.stringify({
        testDir: directory,
        testMatch: "capture.spec.ts",
        outputDir: join(directory, "results"),
        snapshotPathTemplate: join(
          directory,
          "baselines/{projectName}/{arg}{ext}",
        ),
        updateSnapshots: update,
        expect: { toHaveScreenshot: visualPixelComparison },
        reporter: "json",
        workers: 1,
        retries: 0,
        timeout: 15000,
        projects: [{ name: "desktop" }],
        use: {
          browserName: "chromium",
          locale: "en-US",
          viewport: { width: 200, height: 150 },
          visualEnabled,
        },
      })};`,
    );
    writeFileSync(
      join(directory, "capture.spec.ts"),
      `
import { test } from ${JSON.stringify(fixture)};
test.use({ localizationMode: ${JSON.stringify(mode)} });
test("capture", { tag: ${JSON.stringify(tag)} }, async ({ page, visual }) => {
${typeof body === "function" ? body(directory) : body}
});
`,
    );
    const env = {
      ...process.env,
      CI: "true",
      SITUATE_BROWSER_URL: "http://127.0.0.1:1",
    };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [cli, "test", "--config", join(directory, "playwright.config.mjs")],
      {
        cwd: directory,
        env,
        encoding: "utf8",
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assert.ifError(result.error);
    let files = [];
    try {
      files = readdirSync(join(directory, "baselines/desktop")).sort();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      files,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("ordinary browser runs leave captures inactive, even after closing the page", () => {
  const result = run({
    visualEnabled: false,
    body: 'await page.close(); await visual.capture("unused");',
  });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.files, []);
});

for (const [name, options, error] of [
  ["key-only text", { mode: "keys" }, /require localizationMode/],
  ["missing profile tag", { tag: "@ordinary" }, /matching @visual-desktop/],
  ["missing checkpoint", {}, /must reach at least one checkpoint/],
]) {
  test(`visual runs reject ${name}`, () => {
    const result = run({ ...options, body: "" });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, error);
    assert.deepEqual(result.files, []);
  });
}

test("checking a missing reference fails without creating it", () => {
  const result = run({ body: 'await visual.capture("missing.state");' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /snapshot doesn't exist/);
  assert.deepEqual(result.files, []);
});

test("updates preserve distinct dotted names through Playwright path resolution", () => {
  const result = run({
    update: "changed",
    body: 'await visual.capture("panel.menu-open"); await visual.capture("panel-menu.open");',
  });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.files, [
    "panel-menu.open-200x150-en-US.png",
    "panel.menu-open-200x150-en-US.png",
  ]);
});

for (const [name, content, status, options, differingPixels] of [
  [
    "one-level color rounding",
    "<style>html { background: #fefefe; }</style>",
    0,
  ],
  [
    "a one-pixel layout change",
    '<div style="position:fixed;left:0;top:0;width:1px;height:1px;background:black"></div>',
    1,
    undefined,
    1,
  ],
  [
    "three-level rounding without an override",
    "<style>html { background: #fcfcfc; }</style>",
    1,
    undefined,
    30000,
  ],
  [
    "three-level rounding with a color threshold override",
    "<style>html { background: #fcfcfc; }</style>",
    0,
    { threshold: 0.02 },
  ],
  [
    "a one-pixel layout change with a color threshold override",
    '<div style="position:fixed;left:0;top:0;width:1px;height:1px;background:black"></div>',
    1,
    { threshold: 0.02 },
    1,
  ],
  [
    "six-level rounding beyond the color threshold override",
    "<style>html { background: #f9f9f9; }</style>",
    1,
    { threshold: 0.02 },
    30000,
  ],
]) {
  test(`visual comparisons distinguish ${name}`, () => {
    const result = run({
      body: (directory) => `
await page.screenshot({ path: ${JSON.stringify(join(directory, "baselines/desktop/pixel.state-200x150-en-US.png"))} });
await page.setContent(${JSON.stringify(content)});
await visual.capture("pixel.state", ${JSON.stringify(options)});
`,
    });
    assert.equal(result.status, status, result.output);
    if (status === 1)
      assert.match(result.output, new RegExp(`${differingPixels} pixels`));
    assert.deepEqual(result.files, ["pixel.state-200x150-en-US.png"]);
  });
}

test("updating the same checkpoint twice fails instead of overwriting the first reference", () => {
  const result = run({
    update: "changed",
    body: 'await visual.capture("same.state"); await visual.capture("same.state");',
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /multiple writers/);
  assert.deepEqual(result.files, ["same.state-200x150-en-US.png"]);
});
