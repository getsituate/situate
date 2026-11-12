"use strict";
const fs = require("node:fs");
const path = require("node:path");
const mini = require("./mini.js");
const { colors } = require("../../tokens.json");

function exportsForTokens() {
  const svg = (color) =>
    mini
      .render({ decorative: false })
      .replace("<svg ", `<svg color="${color}" `) + "\n";
  return new Map([
    ["mini.svg", svg(colors.ink)],
    ["mini-light.svg", svg(colors.surface)],
    ["mini.txt", mini.frames.rest.ascii],
  ]);
}

function generate({ check = false, directory = __dirname } = {}) {
  const files = exportsForTokens();
  const differences = [];
  for (const [name, content] of files) {
    const target = path.join(directory, name);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content)
        differences.push(name);
    } else fs.writeFileSync(target, content);
  }
  return differences;
}

if (require.main === module) {
  if (process.argv.slice(2).some((arg) => arg !== "--check")) {
    console.error("Usage: node generate.cjs [--check]");
    process.exitCode = 2;
  } else {
    const check = process.argv.includes("--check");
    const differences = generate({ check });
    if (differences.length) {
      console.error(`Exports differ or are missing: ${differences.join(", ")}`);
      process.exitCode = 1;
    } else
      console.log(`${check ? "Verified" : "Generated"} 3 Bend mini exports.`);
  }
}

module.exports = { exportsForTokens, generate };
