#!/usr/bin/env node
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../website/site.mjs";
import { run } from "../website/deploy.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const usage =
  "Usage: node infrastructure/production/deploy.mjs check. In-place deployment is disabled; see infrastructure/production/immutable/README.md.";

function publicTree(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
    throw new Error(
      "Public website staging must contain only regular files and directories.",
    );
  chmodSync(path, stat.isDirectory() ? 0o755 : 0o644);
  if (stat.isDirectory())
    for (const name of readdirSync(path)) publicTree(join(path, name));
}

export async function stage(destination) {
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  await build(join(destination, "site"));
  for (const file of [
    "compose.yaml",
    "edge-compose.yaml",
    "nginx.conf",
    "Caddyfile",
  ])
    cpSync(join(directory, "docker", file), join(destination, file));
  for (const file of [
    "activate.sh",
    "configure-proxy.sh",
    "relocate-edge.sh",
    "edge-snippets.sh",
    "retire-prototype.py",
  ])
    cpSync(join(directory, file), join(destination, file));
  publicTree(destination);
}

export async function main(args, { execute = run } = {}) {
  if (args.length !== 1 || args[0] !== "check") throw new Error(usage);
  execute("docker", [
    "compose",
    "-f",
    join(directory, "immutable", "compose.yaml"),
    "config",
    "--quiet",
  ]);
  const temporary = mkdtempSync(join(tmpdir(), "situate-production-"));
  try {
    await build(join(temporary, "site"));
    console.log(
      "Production website and immutable Compose configuration are valid.",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
