"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check")) {
  console.error("Usage: node design/brand/build-scenes.cjs [--check]");
  process.exit(2);
}
const source = fs.readFileSync(
  path.join(__dirname, "assets/panorama.svg"),
  "utf8",
);
const definitions = source.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
assert.ok(
  definitions,
  "The panorama must contain its local symbol definitions.",
);
const layers = {
  "back-ribbons": "Blue and violet background ribbons",
  "back-objects": "Books, notes and a paper burst",
  "front-ribbons": "Tangerine foreground ribbon",
  "front-objects": "A card and two folded leaves",
};

function group(name) {
  const openings = [
    ...source.matchAll(
      new RegExp(
        `<g\\b(?=[^>]*\\bdata-scene-layer=["']${name}["'])[^>]*>`,
        "g",
      ),
    ),
  ];
  assert.equal(openings.length, 1, `Expected one named layer: ${name}`);
  const start = openings[0].index;
  // Count nested groups so transforms and held object symbols retain their paint order.
  const tags = /<\/?g\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match; (match = tags.exec(source));) {
    if (match[0].startsWith("</")) depth -= 1;
    else if (!match[0].endsWith("/>")) depth += 1;
    if (depth === 0) return source.slice(start, tags.lastIndex);
  }
  throw new Error(`Unclosed panorama layer: ${name}`);
}

let drift = false;
for (const [name, title] of Object.entries(layers)) {
  const output = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 500" role="img" aria-labelledby="title"><title id="title">${title}</title>${definitions}${group(name)}</svg>\n`;
  const file = path.join(__dirname, "assets", `panorama-${name}.svg`);
  if (args.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== output) {
      console.error(
        `Scene layer differs from panorama.svg: ${path.basename(file)}`,
      );
      drift = true;
    }
  } else fs.writeFileSync(file, output);
}
if (drift) process.exitCode = 1;
else
  console.log(
    args.includes("--check")
      ? "Four scene layers match panorama.svg."
      : "Generated four panorama layers.",
  );
