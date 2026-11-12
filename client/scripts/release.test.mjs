import assert from "node:assert/strict";
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

test("defaults to the native desktop and defines all as host-buildable platforms", () => {
  assert.deepEqual(selectPlatforms("host", "darwin"), ["macos"]);
  assert.deepEqual(selectPlatforms("all", "darwin"), [
    "macos",
    "android",
    "ios",
  ]);
  assert.deepEqual(selectPlatforms("all", "win32"), ["windows", "android"]);
  assert.deepEqual(selectPlatforms("all", "linux"), ["linux", "android"]);
  assert.deepEqual(selectPlatforms("android,linux,android", "linux"), [
    "android",
    "linux",
  ]);
});

test("rejects unknown targets and incompatible hosts before building", () => {
  assert.throws(
    () => selectPlatforms("windows", "darwin"),
    /native build host/,
  );
  assert.throws(() => selectPlatforms("ios", "linux"), /native build host/);
  assert.throws(() => selectPlatforms("web", "linux"), /Unknown platform/);
  assert.throws(() => selectPlatforms("linux,", "linux"), /Unknown platform/);
  assert.throws(
    () => selectPlatforms("host", "freebsd"),
    /Unsupported build host/,
  );
});

test("desktop builds select native packages without distribution signing", () => {
  for (const [platform, bundles] of [
    ["macos", "app,dmg"],
    ["windows", "nsis"],
    ["linux", "deb,appimage"],
  ]) {
    const [step] = buildSteps(platform, "x64", "host-triple");
    assert.equal(step[step.indexOf("--bundles") + 1], bundles);
    assert.equal(step[step.indexOf("--target") + 1], "host-triple");
    if (platform === "macos") {
      assert.deepEqual(JSON.parse(step[step.indexOf("--config") + 1]), {
        bundle: { macOS: { signingIdentity: "-" } },
      });
    } else assert.ok(step.includes("--no-sign"));
    assert.ok(step.includes("--locked"));
    assert.ok(!step.includes("--debug"));
  }
});

test("mobile builds use release mode and explicit emulator architectures", () => {
  const android = buildSteps("android", "arm64", "host-triple");
  assert.ok(android[0].includes("--skip-targets-install"));
  assert.ok(android[1].includes("aarch64"));
  assert.ok(android[1].includes("x86_64"));
  assert.ok(!android[1].includes("--debug"));
  assert.ok(
    buildSteps("ios", "arm64", "host-triple")[1].includes("aarch64-sim"),
  );
  assert.ok(buildSteps("ios", "x64", "host-triple")[1].includes("x86_64"));
  assert.throws(() => buildSteps("ios", "ia32", "host-triple"), /architecture/);
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

test("collects a fresh desktop build and excludes signing credentials from child processes", (t) => {
  const root = fixture(t);
  const triple = "aarch64-apple-darwin";
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
    arch: "x64",
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
  assert.ok(!existsSync(join(root, "target/local-release/build.lock")));
});

test("failed builds cannot collect stale packages and retain a failed manifest", (t) => {
  const root = fixture(t);
  const triple = "aarch64-apple-darwin";
  const bundle = join(root, "target/local-release", triple, "release/bundle");
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, "old.dmg"), "stale");
  assert.throws(
    () =>
      buildRelease({
        root,
        selected: ["macos"],
        host: "darwin",
        arch: "arm64",
        execute: (command) => {
          if (command === "rustc") return `host: ${triple}\n`;
          assert.ok(!existsSync(bundle));
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
  assert.ok(!existsSync(join(root, "target/local-release/build.lock")));
});

test("missing packages fail even when the build process exits successfully", (t) => {
  const root = fixture(t);
  assert.throws(
    () =>
      buildRelease({
        root,
        selected: ["linux"],
        host: "linux",
        arch: "x64",
        execute: (command) =>
          command === "rustc" ? "host: x86_64-unknown-linux-gnu\n" : "",
      }),
    /Missing linux artifact/,
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
        selected: ["linux"],
        host: "linux",
        arch: "x64",
        execute: () => "host: x86_64-unknown-linux-gnu\n",
      }),
    /release lock already exists/,
  );
  assert.ok(existsSync(lock));
});

test("rejects wrong artifact types and symbolic links", (t) => {
  const root = fixture(t);
  const artifacts = join(root, "packages");
  mkdirSync(join(artifacts, "installer.exe"), { recursive: true });
  writeFileSync(join(artifacts, "Situate.app"), "not an app directory");
  if (process.platform !== "win32")
    symlinkSync(join(artifacts, "Situate.app"), join(artifacts, "linked.exe"));
  assert.deepEqual(collectArtifacts(artifacts, [".app", ".exe"]), []);
});

test("rejects output ancestors linked outside the checkout", (t) => {
  const root = fixture(t);
  const external = fixture(t);
  symlinkSync(external, join(root, "target"), "junction");
  assert.throws(
    () =>
      buildRelease({
        root,
        selected: ["linux"],
        host: "linux",
        execute: () => "host: x86_64-unknown-linux-gnu\n",
      }),
    /symbolic link/,
  );
  assert.ok(!existsSync(join(external, "local-release")));
});

test("collects the iOS Simulator release bundle without overriding Cargo profiles", (t) => {
  const root = fixture(t);
  const output = buildRelease({
    root,
    selected: ["ios"],
    host: "darwin",
    arch: "x64",
    environment: {},
    execute: (command, args, options) => {
      if (command === "rustc") return "host: aarch64-apple-darwin\n";
      assert.equal(options.env.CARGO_PROFILE_RELEASE_DEBUG, undefined);
      if (args[2] === "build") {
        assert.ok(args.includes("aarch64-sim"));
        assert.ok(!args.includes("--debug"));
        mkdirSync(
          join(root, "app/src-tauri/gen/apple/build/arm64-sim/Situate.app"),
          { recursive: true },
        );
      }
    },
  });
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json")));
  assert.equal(manifest.status, "complete");
  assert.deepEqual(manifest.artifacts, ["ios-simulator-arm64/Situate.app"]);
  assert.equal(manifest.iosSwiftBridge, undefined);
});

test("Android packaging aligns, signs and verifies; reuses its key and fails on invalid signatures", (t) => {
  const root = fixture(t);
  let keyCreations = 0;
  let failVerify = false;
  const execute = (command, args) => {
    if (command === "rustc") return "host: x86_64-pc-windows-msvc\n";
    if (args[1] === "android" && args[2] === "build") {
      const directory = join(
        root,
        "app/src-tauri/gen/android/app/build/outputs/apk/universal/release",
      );
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "app-universal-release-unsigned.apk"),
        "unsigned",
      );
    } else if (command.endsWith("keytool.exe")) {
      keyCreations++;
      writeFileSync(args[args.indexOf("-keystore") + 1], "test key");
    } else if (command.endsWith("zipalign.exe")) {
      assert.deepEqual(args.slice(0, 4), ["-f", "-P", "16", "4"]);
      writeFileSync(args.at(-1), "aligned");
    } else if (command.endsWith("java.exe")) {
      if (args[2] === "sign")
        writeFileSync(args[args.indexOf("--out") + 1], "signed");
      if (args[2] === "verify" && failVerify)
        throw new Error("Signature verification failed");
    }
  };
  const options = {
    root,
    selected: ["android"],
    host: "win32",
    arch: "x64",
    execute,
    environment: {
      JAVA_HOME: join(root, "jdk"),
      ANDROID_HOME: join(root, "sdk"),
    },
  };
  for (let i = 0; i < 2; i++) {
    const output = buildRelease(options);
    const manifest = JSON.parse(readFileSync(join(output, "manifest.json")));
    assert.equal(manifest.status, "complete");
    assert.deepEqual(manifest.artifacts, [
      "android-arm64-x86_64/app-universal-release-local-test.apk",
    ]);
    assert.equal(
      readFileSync(join(output, manifest.artifacts[0]), "utf8"),
      "signed",
    );
    assert.ok(!existsSync(join(output, "android-test.keystore")));
  }
  assert.equal(keyCreations, 1);
  failVerify = true;
  assert.throws(() => buildRelease(options), /Signature verification failed/);
  assert.ok(!existsSync(join(root, "target/local-release/build.lock")));
});

test("Windows cross-compilation is explicit and never changes host/all selection", () => {
  assert.deepEqual(selectPlatforms("windows", "linux", true), ["windows"]);
  assert.deepEqual(selectPlatforms("all", "linux"), ["linux", "android"]);
  assert.throws(
    () => selectPlatforms("all", "linux", true),
    /cross-compilation requires/,
  );
  assert.throws(
    () => selectPlatforms("windows", "darwin", true),
    /cross-compilation requires/,
  );
});

test("Windows cross-builds require licence acknowledgement before running any tools", (t) => {
  assert.throws(
    () =>
      buildRelease({
        root: fixture(t),
        selected: ["windows"],
        host: "linux",
        windowsCross: true,
        execute: () =>
          assert.fail("No tools may run without licence acknowledgement"),
      }),
    /license acceptance/,
  );
});

test("Windows cross-builds retain host identity but use the target for packaging and manifests", (t) => {
  const root = fixture(t);
  const output = buildRelease({
    root,
    selected: ["windows"],
    host: "linux",
    windowsCross: true,
    acceptWindowsSdkLicense: true,
    execute: (command, args, options) => {
      if (command === "rustc") return "host: aarch64-unknown-linux-gnu\n";
      assert.equal(
        args[args.indexOf("--target") + 1],
        "x86_64-pc-windows-msvc",
      );
      assert.equal(args[args.indexOf("--runner") + 1], "cargo-xwin");
      assert.equal(args[args.indexOf("--bundles") + 1], "nsis");
      const bundle = join(
        options.env.CARGO_TARGET_DIR,
        "x86_64-pc-windows-msvc/release/bundle/nsis",
      );
      mkdirSync(bundle, { recursive: true });
      writeFileSync(join(bundle, "Situate-setup.exe"), "installer");
    },
  });
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json")));
  assert.equal(manifest.host, "linux");
  assert.equal(manifest.hostRustTarget, "aarch64-unknown-linux-gnu");
  assert.equal(manifest.rustTarget, "x86_64-pc-windows-msvc");
  assert.equal(manifest.architecture, "x64");
  assert.deepEqual(manifest.artifacts, ["windows-x64/Situate-setup.exe"]);
});
