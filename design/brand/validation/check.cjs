"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const bend = require("../bend/bend.js");

for (const script of [
  "build-tokens.cjs",
  "build-scenes.cjs",
  "bend/generate.cjs",
  "bend/mini/generate.cjs",
]) {
  execFileSync(process.execPath, [path.join(root, script), "--check"], {
    stdio: "inherit",
  });
}

const expressions = ["welcome", "curious", "thinking", "pleased", "unsure"];
const poses = ["rest", "wave", "read", "carry", "celebrate", "point"];
let instances = 0;
for (const pose of poses) {
  const drawings = new Set();
  for (const expression of expressions) {
    const idPrefix = `check-${pose}-${expression}`;
    const options = { idPrefix, pose, expression, title: 'Bend <&> "example"' };
    const svg = bend.render(options);
    assert.equal(svg, bend.render(options), "Rendering must be deterministic");
    assert.match(svg, /viewBox="0 0 320 320"/);
    assert.match(svg, /role="img"/);
    assert.ok(
      svg.includes("Bend &lt;&amp;&gt;"),
      "Accessible titles must escape XML",
    );
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(
      ids.length,
      new Set(ids).size,
      "An SVG may not contain duplicate IDs",
    );
    assert.ok(
      ids.every((id) => id.startsWith(idPrefix)),
      "Every generated ID must be namespaced",
    );
    for (const match of svg.matchAll(
      /url\(#([^)]+)\)|(?:href|aria-labelledby)="#?([^"]+)"/g,
    )) {
      for (const id of (match[1] || match[2]).split(/\s+/)) {
        assert.ok(ids.includes(id), `Unresolved SVG reference: ${id}`);
      }
    }
    assert.ok(
      fs.existsSync(
        path.join(root, "bend", "svg", `${pose}-${expression}.svg`),
      ),
    );
    drawings.add(
      bend
        .render({ idPrefix: "comparison", pose, expression, title: "Bend" })
        .replace(/data-bend-expression="[^"]+"/, ""),
    );
    const decorative = bend.render({
      idPrefix: `decorative-${instances}`,
      pose,
      expression,
      decorative: true,
    });
    assert.match(decorative, /aria-hidden="true"/);
    instances += 1;
  }
  assert.equal(
    drawings.size,
    5,
    `${pose} needs five distinct expression drawings`,
  );
}
assert.throws(() =>
  bend.render({ idPrefix: "invalid-expression", expression: "angry" }),
);
assert.throws(() =>
  bend.render({ idPrefix: "invalid-pose", pose: "hovercraft" }),
);
assert.throws(() => bend.render({ idPrefix: 'unsafe"prefix' }));
assert.throws(() => bend.render({ idPrefix: "empty-label", title: "" }));

const colors = JSON.parse(
  fs.readFileSync(path.join(root, "tokens.json"), "utf8"),
).colors;
for (const [characterRole, tokenRole] of Object.entries({
  body: "bend-front",
  depth: "bend-depth",
  highlight: "bend-highlight",
  inset: "bend-seam",
  ink: "ink",
})) {
  assert.equal(
    bend.colors[characterRole],
    colors[tokenRole],
    `Character and token colors differ: ${characterRole}`,
  );
}
function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((pair) => parseInt(pair, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const [light, dark] = [luminance(colors[a]), luminance(colors[b])].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}
for (const [foreground, background] of [
  ["ink", "paper"],
  ["ink", "surface"],
  ["muted", "paper"],
  ["muted", "surface"],
  ["violet-deep", "paper"],
  ["surface", "violet-deep"],
  ["surface", "violet"],
  ["surface", "cobalt"],
  ["ink", "sky"],
  ["ink", "tangerine"],
  ["ink", "peach"],
  ["ink", "lemon"],
]) {
  assert.ok(
    contrast(foreground, background) >= 4.5,
    `Text contrast below 4.5:1: ${foreground}/${background}`,
  );
}
for (const foreground of ["cobalt", "control-line"])
  for (const background of ["paper", "surface"]) {
    assert.ok(
      contrast(foreground, background) >= 3,
      `Control contrast below 3:1: ${foreground}/${background}`,
    );
  }

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

let links = 0;
const broken = [];
for (const file of walk(root)) {
  const extension = path.extname(file);
  if (![".html", ".svg", ".md", ".css"].includes(extension)) continue;
  const source = fs.readFileSync(file, "utf8");
  const candidates =
    extension === ".md"
      ? [...source.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map(
          (match) => match[1],
        )
      : [...source.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(
          (match) => match[1],
        );
  if (extension === ".css")
    candidates.push(
      ...[...source.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(
        (match) => match[1],
      ),
    );
  for (const candidate of candidates) {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(candidate)) continue;
    const relative = decodeURIComponent(candidate.split(/[?#]/)[0]);
    if (!relative) continue;
    links += 1;
    const target = path.resolve(path.dirname(file), relative);
    if (!fs.existsSync(target))
      broken.push(`${path.relative(root, file)} → ${candidate}`);
  }
  if ([".html", ".svg", ".css"].includes(extension)) {
    assert.doesNotMatch(
      source,
      /(?:src|href)=["']https?:\/\/[^"']+["'](?=[^>]*>\s*<\/script>)/i,
      "Runtime scripts must be local",
    );
    assert.doesNotMatch(
      source,
      /@import\s+(?:url\()?['"]?https?:/i,
      "Styles must be local",
    );
  }
}
assert.deepEqual(broken, [], `Broken local links:\n${broken.join("\n")}`);
console.log(
  `Checked ${instances} Bend combinations, deterministic exports, accessible SVG labels and ${links} local links.`,
);
