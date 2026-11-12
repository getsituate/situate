import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const swift = readFileSync(
  new URL("../.github/actions/swift-tools/action.yml", import.meta.url),
  "utf8",
);
const rust = readFileSync(
  new URL("../.github/actions/rust-build-cache/action.yml", import.meta.url),
  "utf8",
);
const cachePin = "0057852bfaa89a56745cba8c7296529d2fc39830";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "ci-caches-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function identity(action, cwd, env) {
  const script = action.match(/<<'NODE'\n([\s\S]*?)\n {8}NODE/)[1];
  const output = join(cwd, "output");
  writeFileSync(output, "");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env, GITHUB_OUTPUT: output },
    },
  );
  return {
    ...result,
    outputs: Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=")),
    ),
  };
}

const rustEnv = {
  CACHE_PHASE: "restore",
  CACHE_GROUP: "native-debug",
  CACHE_TOOLCHAIN: "rustc 1.90.0 (1159e78c4 2025-09-14)",
  CACHE_IMAGE: `sha256:${"1".repeat(64)}`,
  CACHE_REVISION: "2".repeat(64),
  CACHE_PLATFORM: "linux",
  CACHE_ARCH: "amd64",
  CACHE_RUNNER_OS: "Linux",
  CACHE_RUNNER_ARCH: "X64",
  CACHE_JOB: "linux",
  CACHE_SOURCE: "a".repeat(40),
  CACHE_WORKSHOP: "false",
  CACHE_KEY: "",
};

function successfulIdentity(action, cwd, env) {
  const result = identity(action, cwd, env);
  assert.equal(result.status, 0, result.stderr);
  return result.outputs;
}

test("Rust reuses only compatible outputs across source commits", (t) => {
  const cwd = fixture(t);
  const first = successfulIdentity(rust, cwd, rustEnv);
  const second = successfulIdentity(rust, cwd, {
    ...rustEnv,
    CACHE_SOURCE: "b".repeat(40),
  });
  assert.match(first.key, /^rust-build-v1-[a-f0-9]{64}-a{40}$/);
  assert.equal(first.prefix, second.prefix);
  assert.notEqual(first.key, second.key);
  assert.equal(first.key, `${first.prefix}${rustEnv.CACHE_SOURCE}`);
  for (const field of [
    "CACHE_GROUP",
    "CACHE_TOOLCHAIN",
    "CACHE_IMAGE",
    "CACHE_REVISION",
    "CACHE_PLATFORM",
    "CACHE_ARCH",
    "CACHE_RUNNER_OS",
    "CACHE_RUNNER_ARCH",
    "CACHE_JOB",
    "CACHE_WORKSHOP",
  ]) {
    const value =
      field === "CACHE_WORKSHOP"
        ? "true"
        : field === "CACHE_REVISION"
          ? "3".repeat(64)
          : `${rustEnv[field]}-other`;
    const changed = successfulIdentity(rust, cwd, {
      ...rustEnv,
      [field]: value,
    });
    assert.notEqual(changed.prefix, first.prefix, field);
  }
});

test("Rust fingerprints build flags and runner images, not credentials", (t) => {
  const cwd = fixture(t);
  const original = successfulIdentity(rust, cwd, rustEnv);
  for (const field of [
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_INCREMENTAL",
    "CARGO_PROFILE_DEV_DEBUG",
    "CARGO_PROFILE_TEST_DEBUG",
    "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER",
    "CARGO_BUILD_RUSTFLAGS",
    "DEVELOPER_DIR",
    "ImageOS",
    "ImageVersion",
  ]) {
    const changed = successfulIdentity(rust, cwd, {
      ...rustEnv,
      [field]: "changed",
    });
    assert.notEqual(changed.prefix, original.prefix, field);
  }
  const secret = successfulIdentity(rust, cwd, {
    ...rustEnv,
    CARGO_REGISTRY_TOKEN: "synthetic-test-token",
    GITHUB_TOKEN: "synthetic-test-token",
  });
  assert.equal(secret.key, original.key);
});

test("Rust save preserves the key captured before builds change inputs", (t) => {
  const cwd = fixture(t);
  const restored = successfulIdentity(rust, cwd, rustEnv);
  const saved = successfulIdentity(rust, cwd, {
    ...rustEnv,
    CACHE_PHASE: "save",
    CACHE_KEY: restored.key,
    CACHE_REVISION: "4".repeat(64),
    CACHE_TOOLCHAIN: "",
    CACHE_IMAGE: "",
  });
  assert.equal(saved.key, restored.key);
});

test("Rust rejects missing or malformed identities and save keys", (t) => {
  const cwd = fixture(t);
  for (const overrides of [
    { CACHE_PHASE: "delete" },
    { CACHE_WORKSHOP: "yes" },
    { CACHE_TOOLCHAIN: "" },
    { CACHE_IMAGE: "" },
    { CACHE_GROUP: "" },
    { CACHE_JOB: "" },
    { CACHE_REVISION: "" },
    { CACHE_REVISION: "lockfile" },
    { CACHE_SOURCE: "abc123" },
    { CACHE_PHASE: "save", CACHE_KEY: "" },
    { CACHE_PHASE: "save", CACHE_KEY: "other-cache" },
    {
      CACHE_PHASE: "save",
      CACHE_KEY: `rust-build-v1-${"a".repeat(64)}-${"b".repeat(41)}`,
    },
    { CACHE_PHASE: "save", CACHE_KEY: "bad\ninjected=output" },
  ]) {
    const result = identity(rust, cwd, { ...rustEnv, ...overrides });
    assert.notEqual(result.status, 0, JSON.stringify(overrides));
    assert.deepEqual(result.outputs, {});
  }
});

test("Swift exact identity includes both pins, OS, arch, Swift and Xcode", (t) => {
  const cwd = fixture(t);
  mkdirSync(join(cwd, "tools"));
  const pins = {
    "swift-format": { version: "600.0.0", revision: "a".repeat(40) },
    swiftlint: { version: "0.65.1", sha256: "b".repeat(64) },
  };
  const pinFile = join(cwd, "tools/toolchain.quality.json");
  writeFileSync(pinFile, JSON.stringify(pins));
  const env = {
    CACHE_OS: "macOS",
    CACHE_ARCH: "ARM64",
    SWIFT_IDENTITY: "Apple Swift version 6.0",
    XCODE_IDENTITY: "Xcode 16.0\nBuild version 16A242d",
  };
  const original = successfulIdentity(swift, cwd, env).key;
  assert.match(original, /^swift-tools-v1-[a-f0-9]{64}$/);
  assert.equal(successfulIdentity(swift, cwd, env).key, original);
  for (const field of Object.keys(env)) {
    assert.notEqual(
      successfulIdentity(swift, cwd, { ...env, [field]: `${env[field]}-other` })
        .key,
      original,
      field,
    );
  }
  for (const [tool, field] of [
    ["swift-format", "version"],
    ["swift-format", "revision"],
    ["swiftlint", "version"],
    ["swiftlint", "sha256"],
  ]) {
    const changed = structuredClone(pins);
    changed[tool][field] += "-other";
    writeFileSync(pinFile, JSON.stringify(changed));
    assert.notEqual(
      successfulIdentity(swift, cwd, env).key,
      original,
      `${tool}.${field}`,
    );
  }
});

test("only successful default-main push, schedule and manual runs save", () => {
  for (const action of [swift, rust]) {
    const condition = action.match(
      / {6}if: >-\n([\s\S]*?)\n {6}uses: actions\/cache\/save@/,
    )[1];
    const allowed = new Function(
      "success",
      "github",
      "inputs",
      "steps",
      `return (${condition.replaceAll("outputs.cache-hit", 'outputs["cache-hit"]')});`,
    );
    for (const event of [
      "push",
      "schedule",
      "workflow_dispatch",
      "pull_request",
      "pull_request_target",
      "workflow_run",
      "release",
    ]) {
      for (const ref of [
        "refs/heads/main",
        "refs/heads/topic",
        "refs/pull/1/merge",
        "refs/tags/main",
      ]) {
        for (const defaultBranch of ["main", "develop"]) {
          for (const success of [true, false]) {
            for (const hit of ["true", "false"]) {
              const actual = allowed(
                () => success,
                {
                  event_name: event,
                  ref,
                  event: { repository: { default_branch: defaultBranch } },
                },
                { phase: "save", hit },
                { restore: { outputs: { "cache-hit": hit } } },
              );
              assert.equal(
                actual,
                success &&
                  hit === "false" &&
                  ref === "refs/heads/main" &&
                  defaultBranch === "main" &&
                  ["push", "schedule", "workflow_dispatch"].includes(event),
              );
            }
          }
        }
      }
    }
  }
});

test("cache contracts keep paths narrow and never use broad binary fallbacks", () => {
  for (const action of [swift, rust]) {
    const uses = [...action.matchAll(/uses: (.+)/g)].map((match) => match[1]);
    assert.deepEqual(uses, [
      `actions/cache/restore@${cachePin}`,
      `actions/cache/save@${cachePin}`,
    ]);
    assert.doesNotMatch(action, /CARGO_HOME|\.git\/|credentials|token:/);
  }
  assert.doesNotMatch(swift, /restore-keys:/);
  assert.match(swift, /if: steps\.restore\.outputs\.cache-hit != 'true'/);
  assert.match(
    swift,
    /test "\$\(git -C "\$build_dir\/swift-format" rev-parse HEAD\)" = "\$revision"[\s\S]*swift build --package-path/,
  );
  assert.match(
    swift,
    /shasum -a 256 --check\n {8}unzip "\$build_dir\/swiftlint.zip"/,
  );
  assert.match(
    swift,
    /echo "\$RUNNER_TEMP\/situate-swift-tools" >> "\$GITHUB_PATH"/,
  );
  assert.equal((rust.match(/restore-keys:/g) ?? []).length, 1);
  assert.match(
    rust,
    /restore-keys: \$\{\{ steps\.identity\.outputs\.prefix \}\}/,
  );
  const expectedPaths = [
    "client/target/debug",
    "client/target/release",
    "client/target/*-*/debug",
    "client/target/*-*/release",
    "client/workshop/src-tauri/target/debug",
    "client/workshop/src-tauri/target/release",
    "${{ inputs.workshop == 'true' && 'client/workshop/dist' || '' }}",
    "!client/**/target/**/incremental",
    "!client/**/target/**/bundle",
    "!client/**/target/**/.cargo-lock",
    "!client/target/agent-e2e-*",
  ];
  const pathBlocks = [...rust.matchAll(/ {8}path: \|\n((?: {10}.*\n)+)/g)];
  assert.equal(pathBlocks.length, 2);
  for (const block of pathBlocks) {
    assert.deepEqual(
      block[1]
        .trim()
        .split("\n")
        .map((line) => line.trim()),
      expectedPaths,
    );
  }
  assert.equal(
    (swift.match(/path: \$\{\{ runner.temp \}\}\/situate-swift-tools/g) ?? [])
      .length,
    2,
  );
  assert.match(rust, /if: inputs\.phase == 'restore'/);
});

test("Rust restore defaults cover image, toolchain, lockfiles and container build flags", () => {
  for (const path of [
    "tools/ci-image.lock.json",
    "client/rust-toolchain.toml",
    "client/**/Cargo.toml",
    "client/**/Cargo.lock",
    "client/**/package.json",
    "client/package-lock.json",
    "client/.node-version",
    "client/**/.cargo/config*",
    ".cargo/config*",
    "client/docker/Dockerfile",
    "tools/ci-container.mjs",
    "!client/**/node_modules/**",
    "!client/**/target/**",
  ]) {
    assert.ok(rust.includes(`'${path}'`), path);
  }
  assert.match(rust, /source-sha:[\s\S]*?default: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(rust, /required: true/);
});
