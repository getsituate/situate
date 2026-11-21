import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { windowsCommands, windowsTarget } from "./test-windows.mjs";
import { prepareDependencies } from "./test.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const client = join(root, "client");
const [destination, ...extra] = process.argv.slice(2);
assert(process.platform === "win32", "Build on a Windows MSVC build host");
assert(
  destination && !extra.length,
  "Usage: node tools/build-windows-smoke.mjs NEW_ARTIFACT_DIRECTORY",
);
const output = resolve(destination);
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
assert.equal(
  git("status", "--porcelain", "--", "client"),
  "",
  "Build from a clean client checkout",
);
const source = git("rev-parse", "HEAD");
const rust = readFileSync(join(client, "rust-toolchain.toml"), "utf8").match(
  /^channel\s*=\s*"(\d+\.\d+\.\d+)"/m,
)?.[1];
assert(rust, "Missing exact Rust pin");
assert.equal(
  process.env.TAURI_CONFIG,
  undefined,
  "Unexpected inherited Tauri config",
);
assert.equal(
  process.env.SITUATE_DISTRIBUTION,
  undefined,
  "Do not use release configuration for a smoke build",
);
const target = join(client, "target", "windows-smoke");
const lock = join(client, "target", "windows-smoke.lock");
mkdirSync(join(client, "target"), { recursive: true });
mkdirSync(lock);
let dependencies;
try {
  mkdirSync(output);
  dependencies = await prepareDependencies("client", { force: true });
  if (dependencies.failure) throw new Error(dependencies.failure.error);
  const [frontend, build] = windowsCommands(
    "client-windows-build",
    rust,
    target,
  );
  build[1][build[1].indexOf("--config") + 1] = JSON.stringify({
    build: { beforeBuildCommand: "" },
    app: { appDirectoriesOverride: "profile" },
    identifier: "com.getsituate.smoke",
  });
  const env = {
    ...process.env,
    RUSTUP_TOOLCHAIN: rust,
    CARGO_TARGET_DIR: target,
  };
  const [installRust] = windowsCommands("setup", rust, target);
  for (const [program, args, cwd] of [installRust, frontend, build])
    execFileSync(program, args, { cwd, env, stdio: "inherit" });
  assert.equal(git("rev-parse", "HEAD"), source);
  assert.equal(
    git("status", "--porcelain", "--", "client"),
    "",
    "Client inputs changed during the build",
  );
  const executable = join(output, "situate-client.exe");
  copyFileSync(
    join(target, windowsTarget, "release", "situate-client.exe"),
    executable,
  );
  const sha256 = createHash("sha256")
    .update(readFileSync(executable))
    .digest("hex");
  writeFileSync(
    join(output, "manifest.json"),
    `${JSON.stringify({ kind: "situate-windows-smoke", source, target: windowsTarget, profile: "profile", sha256 }, null, 2)}\n`,
    { flag: "wx" },
  );
} finally {
  dependencies?.release();
  rmdirSync(lock);
}
