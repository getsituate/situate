import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function* styles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* styles(path);
    else if (/\.(css|vue)$/.test(entry.name)) yield path;
  }
}

test("product and workshop focus tokens keep the whole outline inside controls", () => {
  const tokens = JSON.parse(
    readFileSync(resolve(root, "design/brand/tokens.json"), "utf8"),
  );
  assert.equal(tokens.strokes["stroke-focus"], "3px");
  assert.equal(
    tokens.strokes["focus-offset"],
    "calc(-1 * var(--situate-stroke-focus))",
  );
  for (const file of [
    "design/brand/tokens.css",
    "client/workshop/src/brand/tokens.css",
  ]) {
    const css = readFileSync(resolve(root, file), "utf8");
    for (const token of ["stroke-focus", "focus-offset"])
      assert.ok(
        css.includes(`--situate-${token}: ${tokens.strokes[token]};`),
        `${file}: ${token}`,
      );
  }
});

test("client and workshop styles do not introduce outward outline offsets", () => {
  for (const directory of [
    "client/app/src",
    "client/packages/ui/src",
    "client/workshop/src",
  ]) {
    for (const file of styles(resolve(root, directory))) {
      const source = readFileSync(file, "utf8");
      const css = file.endsWith(".vue")
        ? [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
            .map((match) => match[1])
            .join("\n")
        : source;
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!rule[1].includes(":focus")) continue;
        for (const shadow of rule[2].matchAll(/\bbox-shadow\s*:\s*([^;{}]+)/g))
          assert.match(
            shadow[1].trim(),
            /^(?:inset\b|none$)/,
            `${file}: ${shadow[0]}`,
          );
        for (const offset of rule[2].matchAll(
          /\boutline-offset\s*:\s*(-?\d+)px/g,
        ))
          assert.ok(Number(offset[1]) <= -3, `${file}: ${offset[0]}`);
      }
      for (const match of css.matchAll(/\boutline-offset\s*:\s*([^;{}]+)/g)) {
        assert.match(
          match[1].trim(),
          /^(?:var\(--situate-focus-offset\)|-\d+(?:\.\d+)?px)$/,
          `${file}: ${match[0]}`,
        );
      }
    }
  }
});
