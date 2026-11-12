"use strict";
const fs = require("node:fs");
const path = require("node:path");

const source = JSON.parse(
  fs.readFileSync(path.join(__dirname, "tokens.json"), "utf8"),
);
const names = new Set();
const declarations = [];
for (const [group, values] of Object.entries(source)) {
  if (group.startsWith("$")) continue;
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error(`Invalid token group: ${group}`);
  for (const [name, value] of Object.entries(values)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || names.has(name))
      throw new Error(`Invalid or duplicate token: ${name}`);
    if (typeof value !== "string" || /[;{}\n\r]/.test(value))
      throw new Error(`Invalid token value: ${name}`);
    if (group === "colors" && !/^#[0-9a-f]{6}$/.test(value))
      throw new Error(`Invalid color: ${name}`);
    names.add(name);
    declarations.push(`  --situate-${name}: ${value};`);
  }
}
const css = `/* Generated from tokens.json by build-tokens.cjs. */\n:root {\n${declarations.join("\n")}\n}\n`;
const target = path.join(__dirname, "tokens.css");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check")) {
  console.error("Usage: node build-tokens.cjs [--check]");
  process.exitCode = 2;
} else if (args.includes("--check")) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== css) {
    console.error(
      "tokens.css differs from tokens.json. Run node build-tokens.cjs.",
    );
    process.exitCode = 1;
  } else console.log("tokens.css matches tokens.json.");
} else {
  fs.writeFileSync(target, css);
  console.log("Generated tokens.css.");
}
