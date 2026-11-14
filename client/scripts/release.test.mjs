import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  selectPlatforms,
  buildSteps,
  buildRelease,
  collectArtifacts,
  assertLocalPath,
} from "./release.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "app/src-tauri"), { recursive: true });
  writeFileSync(
    join(root, "app/src-tauri/tauri.conf.json"),
    JSON.stringify({ version: "0.0.1" }),
  );
  return root;
}

const triple = "aarch64-apple-darwin";

test("local packages select only macOS on a macOS host", () => {
  assert.deepEqual(selectPlatforms("host", "darwin"), ["macos"]);
  assert.deepEqual(selectPlatforms("macos", "darwin"), ["macos"]);
  for (const host of ["linux", "win32", "freebsd"])
    assert.throws(() => selectPlatforms("host", host), /macOS build host/);
  for (const selection of [
    "all",
    "windows",
    "linux",
    "android",
    "ios",
    "web",
    "macos,android",
    "macos,",
  ])
    assert.throws(() => selectPlatforms(selection, "darwin"), /macos only/);
});

test("ad-hoc builds select native macOS packages without distribution signing", () => {
  const [step] = buildSteps("macos", "arm64", triple);
  assert.equal(step[step.indexOf("--bundles") + 1], "app,dmg");
  assert.equal(step[step.indexOf("--target") + 1], triple);
  assert.deepEqual(JSON.parse(step[step.indexOf("--config") + 1]), {
    bundle: { macOS: { signingIdentity: "-" } },
  });
  assert(step.includes("--locked"));
  assert(!step.includes("--debug"));
  for (const platform of ["linux", "windows", "ios", "android"])
    assert.throws(() => buildSteps(platform, "arm64", triple), /macOS only/);
  assert.throws(
    () => buildSteps("macos", "x64", "x86_64-unknown-linux-gnu"),
    /Rust host target/,
  );
});

test("unsupported platforms fail before running tools or creating output", (t) => {
  const root = fixture(t);
  for (const selected of [
    ["ios"],
    ["android"],
    ["linux"],
    ["windows"],
    ["macos", "ios"],
  ])
    assert.throws(
      () =>
        buildRelease({
          root,
          selected,
          host: "darwin",
          execute: () => assert.fail("No tool should run"),
        }),
      /macos only/,
    );
  assert(!existsSync(join(root, "target")));
  assert(!existsSync(join(root, "artifacts")));
});

test("CLI help advertises only macOS and removed cross-compilation flags fail", () => {
  const path = new URL("./release.mjs", import.meta.url);
  const help = spawnSync(process.execPath, [path.pathname, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /host\|macos/);
  assert.doesNotMatch(
    help.stdout,
    /windows|linux|android|ios|--windows-cross/i,
  );
  const result = spawnSync(
    process.execPath,
    [path.pathname, "--windows-cross"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option/);
});

test("artifact discovery preserves app directories as a single artifact", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "bundle/Situate.app/Contents"), { recursive: true });
  writeFileSync(join(root, "bundle/Situate.dmg"), "disk image");
  writeFileSync(join(root, "bundle/other.txt"), "not an artifact");
  assert.equal(
    collectArtifacts(join(root, "bundle"), [".app", ".dmg"]).length,
    2,
  );
  assert.deepEqual(collectArtifacts(join(root, "missing"), [".app"]), []);
});

test("collects a fresh macOS build and excludes signing credentials from child processes", (t) => {
  const root = fixture(t);
  const execute = (command, args, options) => {
    if (command === "rustc") return `host: ${triple}\n`;
    assert.equal(options.env.APPLE_ID, undefined);
    assert.equal(options.env.TAURI_SIGNING_PRIVATE_KEY, undefined);
    assert.equal(options.env.TAURI_CONFIG, undefined);
    assert.equal(
      options.env.CARGO_TARGET_DIR,
      join(root, "target/local-release"),
    );
    const bundle = join(options.env.CARGO_TARGET_DIR, triple, "release/bundle");
    mkdirSync(join(bundle, "macos/Situate.app/Contents"), { recursive: true });
    mkdirSync(join(bundle, "dmg"), { recursive: true });
    writeFileSync(join(bundle, "macos/Situate.app/Contents/test"), "fresh app");
    writeFileSync(join(bundle, "dmg/Situate.dmg"), "fresh image");
  };
  const output = buildRelease({
    root,
    selected: ["macos"],
    host: "darwin",
    environment: {
      APPLE_ID: "unused",
      TAURI_SIGNING_PRIVATE_KEY: "unused",
      TAURI_CONFIG: "unused",
    },
    execute,
  });
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json")));
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.architecture, "arm64");
  assert.equal(manifest.rustTarget, triple);
  assert.deepEqual(manifest.completed, ["macos"]);
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(
    readFileSync(join(output, "macos-arm64/Situate.app/Contents/test"), "utf8"),
    "fresh app",
  );
  assert(!existsSync(join(root, "target/local-release/build.lock")));
});

test("failed builds cannot collect stale packages and retain a failed manifest", (t) => {
  const root = fixture(t);
  const bundle = join(root, "target/local-release", triple, "release/bundle");
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, "old.dmg"), "stale");
  assert.throws(
    () =>
      buildRelease({
        root,
        selected: ["macos"],
        host: "darwin",
        execute: (command) => {
          if (command === "rustc") return `host: ${triple}\n`;
          assert(!existsSync(bundle));
          throw new Error("Build failed");
        },
      }),
    /Build failed/,
  );
  const directory = join(
    root,
    "artifacts",
    readdirSync(join(root, "artifacts"))[0],
  );
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json")));
  assert.equal(manifest.status, "failed");
  assert.deepEqual(manifest.artifacts, []);
  assert(!existsSync(join(root, "target/local-release/build.lock")));
});

test("missing packages fail even when the build process exits successfully", (t) => {
  const root = fixture(t);
  assert.throws(
    () =>
      buildRelease({
        root,
        selected: ["macos"],
        host: "darwin",
        execute: (command) => (command === "rustc" ? `host: ${triple}\n` : ""),
      }),
    /Missing macOS artifact/,
  );
});

test("refuses concurrent release runs without removing the existing lock", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "target/local-release"), { recursive: true });
  const lock = join(root, "target/local-release/build.lock");
  writeFileSync(lock, "");
  assert.throws(
    () =>
      buildRelease({
        root,
        selected: ["macos"],
        host: "darwin",
        execute: () => `host: ${triple}\n`,
      }),
    /release lock already exists/,
  );
  assert(existsSync(lock));
});

test("rejects wrong artifact types and symbolic links", (t) => {
  const root = fixture(t);
  const artifacts = join(root, "packages");
  mkdirSync(join(artifacts, "installer.exe"), { recursive: true });
  writeFileSync(join(artifacts, "Situate.app"), "not an app directory");
  if (process.platform !== "win32")
    symlinkSync(join(artifacts, "Situate.app"), join(artifacts, "linked.exe"));
  assert.deepEqual(collectArtifacts(artifacts, [".app", ".exe"]), []);
  assert.throws(
    () => assertLocalPath(root, join(root, "../escape")),
    /inside the client directory/,
  );
});

test("rejects output ancestors linked outside the checkout", (t) => {
  const root = fixture(t);
  const external = fixture(t);
  symlinkSync(external, join(root, "target"), "junction");
  assert.throws(
    () =>
      buildRelease({
        root,
        selected: ["macos"],
        host: "darwin",
        execute: () => `host: ${triple}\n`,
      }),
    /symbolic link/,
  );
  assert(!existsSync(join(external, "local-release")));
});
