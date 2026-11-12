#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cargoEnvironment } from "./cargo-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function warmCargoCache({
  directory = root,
  environment = process.env,
  run = spawnSync,
} = {}) {
  const canonical = realpathSync(directory);
  const env = {
    ...cargoEnvironment(canonical, environment),
    // Fetch may download dependencies, but must not install a missing toolchain.
    RUSTUP_AUTO_INSTALL: "0",
  };
  for (const workspace of ["client", "tools/dev-tui"]) {
    const result = run("cargo", ["fetch", "--locked"], {
      cwd: join(canonical, workspace),
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Cargo fetch failed for ${workspace} (${result.signal ?? result.status}).`,
      );
  }
}

export function main(args = process.argv.slice(2), options = {}) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: node tools/cargo-cache.mjs warm");
    return 0;
  }
  if (args.length !== 1 || args[0] !== "warm") {
    console.error("Usage: node tools/cargo-cache.mjs warm");
    return 2;
  }
  try {
    warmCargoCache(options);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = main();
