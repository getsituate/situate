"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const bend = require("./bend.js");

test("classic script and CommonJS expose the same deterministic renderer", () => {
  const context = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "bend.js"), "utf8"),
    context,
  );
  assert.equal(
    context.window.SituateBend.render({ idPrefix: "same" }),
    bend.render({ idPrefix: "same" }),
  );
  assert.ok(Object.isFrozen(bend));
  assert.ok(Object.isFrozen(bend.poses.wave));
});

test("all thirty combinations are self-contained, namespaced and accessible", () => {
  assert.equal(bend.poseNames.length * bend.expressionNames.length, 30);
  for (const pose of bend.poseNames)
    for (const expression of bend.expressionNames) {
      const prefix = `${pose}-${expression}`;
      const svg = bend.render({ idPrefix: prefix, pose, expression });
      assert.match(svg, /viewBox="0 0 320 320"/);
      assert.match(svg, /role="img"/);
      assert.ok(svg.includes(`aria-labelledby="${prefix}-title"`));
      const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(ids.every((id) => id.startsWith(`${prefix}-`)));
      for (const match of svg.matchAll(/url\(#([^)]*)\)/g))
        assert.ok(ids.includes(match[1]));
      assert.doesNotMatch(
        svg,
        /<use\b|<image\b|href=|<script\b|<foreignObject\b|<animate\b/,
      );
      const ordered = [
        "rear-arms",
        "body",
        "depth",
        "front",
        "highlight",
        "inset",
        "face",
        "prop",
      ];
      let previous = -1;
      for (const part of ordered) {
        const position = svg.indexOf(`data-bend-part="${part}"`);
        assert.ok(
          position > previous,
          `${prefix}: ${part} has wrong paint order`,
        );
        previous = position;
      }
      assert.equal(svg, bend.render({ idPrefix: prefix, pose, expression }));
    }
});

test("body, crown geometry and tokens retain their dimensional construction", () => {
  assert.equal(
    bend.geometry.front,
    "M91 264V141c0-82 132-88 136-2l2 112c0 17-30 19-31 3l-3-111c-1-33-71-29-71 3v115c0 19-33 22-33 3Z",
  );
  assert.equal(
    bend.geometry.depth,
    "M105 270V148c0-82 131-89 136-3l2 113c0 15-13 21-23 15l-9-8-2-115c-1-33-84-30-85 2v110c0 15-9 24-19 8Z",
  );
  assert.equal(bend.geometry.highlight, "M101 257V142c0-35 22-61 54-64");
  assert.equal(bend.geometry.inset, "M204 143l2 106");
  assert.deepEqual(Object.values(bend.colors), [
    "#a77bff",
    "#56329b",
    "#d9c6ff",
    "#7045bd",
    "#30203e",
    "#fff7e3",
    "#fffefa",
    "#ff874d",
    "#f4f06d",
    "#48b7ff",
    "#ad9284",
    "#d7ad38",
    "#f6f3ee",
    "#6a5c70",
    "#8651ed",
    "#6232bc",
    "#305cf4",
    "#ffc3a3",
    "#d9d0df",
  ]);
  for (const pose of Object.values(bend.poses)) {
    assert.ok(pose.left.startsWith("M103 169"));
    assert.ok(pose.right.startsWith("M225 169"));
  }
});

test("titles are escaped, decoration hidden, invalid inputs rejected", () => {
  const svg = bend.render({
    idPrefix: "escape",
    title: "<tag attr=\"hello\"> & 'world'",
  });
  assert.ok(
    svg.includes("&lt;tag attr=&quot;hello&quot;&gt; &amp; &apos;world&apos;"),
  );
  const decorative = bend.render({ idPrefix: "decoration", decorative: true });
  assert.match(decorative, /aria-hidden="true"/);
  assert.doesNotMatch(decorative, /<title|role="img"|aria-labelledby/);
  for (const idPrefix of [
    undefined,
    "",
    "1bad",
    "a b",
    'x" onload="bad',
    "<svg>",
    "é",
  ])
    assert.throws(() => bend.render({ idPrefix }), TypeError);
  for (const pose of ["constructor", "__proto__", "bad", null])
    assert.throws(() => bend.render({ idPrefix: "bad", pose }), RangeError);
  for (const expression of ["constructor", "bad", null])
    assert.throws(
      () => bend.render({ idPrefix: "bad", expression }),
      RangeError,
    );
  for (const title of ["", " ", "\u0000", "\u000b", "\uffff", "\ud800", 2])
    assert.throws(() => bend.render({ idPrefix: "bad", title }), TypeError);
  assert.throws(
    () => bend.render({ idPrefix: "bad", decorative: "true" }),
    TypeError,
  );
});

test("generated SVGs and construction diagram have no drift", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "generate.cjs"), "--check"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
