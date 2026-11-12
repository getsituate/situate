"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const mini = require("./mini.js");
const generator = require("./generate.cjs");
const { colors } = require("../../tokens.json");

test("browser bundles expose the same kit through CommonJS and the browser global", () => {
  const context = { module: { exports: {} }, document: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "mini.js"), "utf8"),
    context,
  );
  assert.equal(context.SituateBendMini, context.module.exports);
  assert.match(context.SituateBendMini.render(), /<svg /);
});

test("CommonJS outside the browser does not publish a global", () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "mini.js"), "utf8"),
    context,
  );
  assert.equal(Object.hasOwn(context, "SituateBendMini"), false);
  assert.equal(typeof context.module.exports.create, "function");
});

test("historical optical geometry and stepped score stay fixed", () => {
  assert.deepEqual(mini.geometry, {
    viewBox: "0 0 32 32",
    body: "M7 25V13a9 9 0 0 1 18 0v12",
    bodyWidth: 7,
    eyeWidth: 1.6,
  });
  assert.equal(mini.frames.rest.eyes, "M13 11v3m6-3v3");
  assert.equal(mini.frames.focus.eyes, "M13 12.5v3m6-3v3");
  assert.equal(mini.frames.blink.eyes, "M12 13h2m4 0h2");
  assert.deepEqual(mini.score, [
    { frame: "rest", duration: 900 },
    { frame: "focus", duration: 600 },
    { frame: "blink", duration: 120 },
    { frame: "rest", duration: 780 },
  ]);
  assert.equal(
    mini.score.reduce((sum, step) => sum + step.duration, 0),
    2400,
  );
  assert.throws(() => {
    mini.frames.rest.eyes = "changed";
  }, TypeError);
  assert.throws(() => {
    mini.score[0].duration = 1;
  }, TypeError);
});

test("geometry matches quiet-mark in the historical Git source when available", (t) => {
  let source;
  try {
    source = execFileSync(
      "git",
      ["show", "6a00ee9:design/brand-discovery/kinetic/index.html"],
      {
        cwd: __dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    t.skip("The historical commit is not available in this checkout.");
    return;
  }
  const symbol = source.match(
    /<symbol id="quiet-mark"[^>]*>[\s\S]*?<\/symbol>/,
  )[0];
  assert.ok(symbol.includes(`viewBox="${mini.geometry.viewBox}"`));
  assert.ok(symbol.includes(`d="${mini.geometry.body}"`));
  assert.ok(symbol.includes(`d="${mini.frames.rest.eyes}"`));
  assert.ok(symbol.includes(`stroke-width="${mini.geometry.bodyWidth}"`));
  assert.ok(symbol.includes(`stroke-width="${mini.geometry.eyeWidth}"`));
  assert.equal((symbol.match(/stroke-linecap="round"/g) || []).length, 2);
});

test("ASCII frames are exactly 7-bit, five columns by three rows", () => {
  assert.equal(mini.frames.rest.ascii, " .-. \n|' '|\n|   |");
  assert.equal(mini.frames.focus.ascii, " .-. \n|. .|\n|   |");
  assert.equal(mini.frames.blink.ascii, " .-. \n|- -|\n|   |");
  for (const { ascii } of Object.values(mini.frames)) {
    assert.match(ascii, /^[\x20-\x7e\n]+$/);
    assert.deepEqual(
      ascii.split("\n").map((row) => row.length),
      [5, 5, 5],
    );
    assert.equal(ascii.split("\n")[0], " .-. ");
    assert.equal(ascii.split("\n")[2], "|   |");
    assert.equal(ascii.split("\n")[1][0], "|");
    assert.equal(ascii.split("\n")[1][4], "|");
  }
});

test("rendering is static, self-contained, escaped and correctly named", () => {
  for (const format of ["svg", "ascii"]) {
    const hidden = mini.render({ format });
    assert.ok(hidden.includes('aria-hidden="true"'));
    assert.ok(!hidden.includes('role="img"'));
    assert.ok(hidden.includes(`data-bend-mini="${format}"`));
    assert.ok(hidden.includes(`class="bend-mini bend-mini--${format}"`));
    assert.ok(hidden.includes('data-mini-frame="rest"'));
    assert.doesNotMatch(hidden, /\bid=|aria-live|<script|<use/);
    const informative = mini.render({
      format,
      decorative: false,
      title: "Bend <&> \"quiet\" 'arch'",
    });
    assert.ok(
      informative.includes(
        'role="img" aria-label="Bend &lt;&amp;&gt; &quot;quiet&quot; &#39;arch&#39;"',
      ),
    );
    assert.ok(
      mini.render({ format, decorative: false }).includes('aria-label="Bend"'),
    );
  }
  const svg = mini.render();
  assert.match(svg, /width="24" height="24"/);
  assert.equal((svg.match(/stroke="currentColor"/g) || []).length, 2);
  assert.equal((svg.match(/fill="none"/g) || []).length, 2);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.ok(
    mini.render({ format: "ascii" }).includes('style="white-space:pre"'),
  );
});

test("invalid render options and controller roots fail explicitly", () => {
  for (const options of [
    null,
    [],
    false,
    "svg",
    { format: "html" },
    { decorative: 1 },
    { title: "" },
    { title: "  " },
    { title: null },
    { title: "Bend\narch" },
    { title: "Bend\x00" },
  ]) {
    assert.throws(() => mini.render(options), TypeError);
  }
  for (const root of [undefined, null, {}, "svg"])
    assert.throws(() => mini.create(root), TypeError);
});

test("exports use canonical colors and deterministic content; check detects drift and absence", () => {
  const files = generator.exportsForTokens();
  assert.equal(files.get("mini.txt"), mini.frames.rest.ascii);
  for (const [name, color] of [
    ["mini.svg", colors.ink],
    ["mini-light.svg", colors.surface],
  ]) {
    assert.equal(
      files.get(name),
      mini
        .render({ decorative: false })
        .replace("<svg ", `<svg color="${color}" `) + "\n",
    );
  }
  assert.deepEqual(generator.generate({ check: true }), []);
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bend-mini-exports-"),
  );
  try {
    assert.deepEqual(generator.generate({ directory, check: true }), [
      ...files.keys(),
    ]);
    generator.generate({ directory });
    assert.deepEqual(generator.generate({ directory, check: true }), []);
    generator.generate({ directory });
    for (const [name, content] of files)
      assert.equal(
        fs.readFileSync(path.join(directory, name), "utf8"),
        content,
      );
    fs.appendFileSync(path.join(directory, "mini.svg"), " ");
    assert.deepEqual(generator.generate({ directory, check: true }), [
      "mini.svg",
    ]);
    fs.unlinkSync(path.join(directory, "mini.txt"));
    assert.deepEqual(generator.generate({ directory, check: true }), [
      "mini.svg",
      "mini.txt",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
