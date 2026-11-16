import assert from "node:assert/strict";
import { test } from "node:test";
import {
  releaseBuildCachePlan,
  releaseCompilerCacheEnvironment,
} from "./release-build-cache.mjs";

const env = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  RUNNER_OS: "macOS",
  RUNNER_ARCH: "ARM64",
  GITHUB_REPOSITORY: "getsituate/situate",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REF_PROTECTED: "true",
  GITHUB_EVENT_NAME: "push",
  GITHUB_WORKFLOW_REF:
    "getsituate/situate/.github/workflows/release-macos.yml@refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  ImageOS: "macos26",
  ImageVersion: "20261113.1",
  HOME: "/Users/runner",
  PATH: "/tools:/usr/bin",
};
const compilerOptions = {
  find: () => "/tools/sccache",
  version: () => "sccache 0.19.0",
};
function execute(command, args) {
  const outputs = {
    "rustup which rustc": "/toolchain/bin/rustc",
    "rustup which cargo": "/toolchain/bin/cargo",
    "/toolchain/bin/rustc -vV": `rustc 1.98.1 (synthetic)\ncommit-hash: ${"a".repeat(40)}\nhost: aarch64-apple-darwin`,
    "/toolchain/bin/cargo --version": "cargo 1.98.1 (synthetic)",
    "xcodebuild -version": "Xcode 26.1\nBuild version 17B55",
    "xcrun --sdk macosx --show-sdk-version": "26.1",
    "xcrun --sdk macosx --show-sdk-build-version": "25B55",
    "xcrun --sdk macosx clang --version":
      "Apple clang version 17.0.0 (synthetic)",
    "sw_vers -productVersion": "26.1",
    "sw_vers -buildVersion": "25B55",
    "/tools/sccache --version": "sccache 0.19.0",
  };
  return outputs[`${command} ${args.join(" ")}`];
}
const fixture = (overrides = {}) => ({
  env,
  root: "/source",
  platform: "darwin",
  execute,
  read: (path) => `synthetic ${path}`,
  compilerOptions,
  ...overrides,
});

test("cache plan contains only bounded compiler and public Cargo download paths", () => {
  const plan = releaseBuildCachePlan(fixture());
  assert.equal(plan.enabled, true);
  assert.match(
    plan.key,
    /^release-build-v1-main-macos-ARM64-universal-release-[a-f0-9]{64}-a{40}$/,
  );
  assert.equal(plan.restoreKey, plan.key.slice(0, -40));
  assert.deepEqual(plan.paths, [
    "/Users/runner/Library/Caches/situate/release-build-v1/sccache",
    "/Users/runner/Library/Caches/situate/release-build-v1/cargo/registry/cache/index.crates.io-1949cf8c6b5b557f",
    "/Users/runner/Library/Caches/situate/release-build-v1/cargo/registry/index/index.crates.io-1949cf8c6b5b557f",
  ]);
  assert.deepEqual(plan.environment, {
    SITUATE_RELEASE_BUILD_CACHE: "1",
    CARGO_HOME: "/Users/runner/Library/Caches/situate/release-build-v1/cargo",
  });
  assert.deepEqual(releaseBuildCachePlan(fixture()), plan);
  const nextSource = releaseBuildCachePlan(
    fixture({ env: { ...env, GITHUB_SHA: "b".repeat(40) } }),
  );
  assert.equal(nextSource.restoreKey, plan.restoreKey);
  assert.notEqual(nextSource.key, plan.key);
});

test("runtime, architecture, image, toolchain, manifest and lock changes invalidate restore scope", () => {
  const baseline = releaseBuildCachePlan(fixture()).restoreKey;
  for (const field of ["RUNNER_ARCH", "ImageOS", "ImageVersion"]) {
    const value = field === "RUNNER_ARCH" ? "X64" : "different";
    assert.notEqual(
      releaseBuildCachePlan(fixture({ env: { ...env, [field]: value } }))
        .restoreKey,
      baseline,
    );
  }
  const calls = [];
  releaseBuildCachePlan(
    fixture({
      execute: (command, args) => {
        calls.push([command, args]);
        return execute(command, args);
      },
    }),
  );
  for (const [changedCommand, changedArgs] of calls) {
    if (changedCommand === "rustup") continue;
    const changed = releaseBuildCachePlan(
      fixture({
        execute: (command, args) =>
          `${command} ${args.join(" ")}` ===
          `${changedCommand} ${changedArgs.join(" ")}`
            ? execute(command, args).replace(/\d/, (digit) =>
                String((Number(digit) + 1) % 10),
              )
            : execute(command, args),
      }),
    );
    assert.equal(changed.enabled, true);
    assert.notEqual(changed.restoreKey, baseline);
  }
  for (const file of ["rust-toolchain.toml", "Cargo.lock", "Cargo.toml"]) {
    const changed = releaseBuildCachePlan(
      fixture({
        read: (path) =>
          path.endsWith(file) ? "changed input" : `synthetic ${path}`,
      }),
    );
    assert.notEqual(changed.restoreKey, baseline);
  }
});

test("untrusted hosts and unknown runtimes miss without probing private inputs", () => {
  for (const change of [
    { CI: "false" },
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { RUNNER_OS: "Linux" },
    { RUNNER_ARCH: "unknown" },
    { GITHUB_REPOSITORY: "fork/situate" },
    { GITHUB_REF: "refs/pull/1/merge" },
    { GITHUB_REF_PROTECTED: "false" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_WORKFLOW_REF: "other" },
    { GITHUB_SHA: "unknown" },
    { HOME: "relative" },
    { HOME: "/tmp/unsafe\nvalue" },
  ]) {
    assert.deepEqual(
      releaseBuildCachePlan(
        fixture({
          env: { ...env, ...change },
          execute: () => assert.fail("must not probe"),
        }),
      ),
      { enabled: false },
    );
  }
  for (const change of [
    { platform: "linux" },
    { env: { ...env, ImageVersion: undefined } },
    { execute: () => "" },
    { execute: () => "unknown runtime" },
    {
      execute: () => {
        throw new Error("unavailable");
      },
    },
    {
      read: () => {
        throw new Error("unavailable");
      },
    },
    { compilerOptions: { ...compilerOptions, find: () => undefined } },
    {
      compilerOptions: { ...compilerOptions, version: () => "sccache 0.18.0" },
    },
  ])
    assert.deepEqual(releaseBuildCachePlan(fixture(change)), {
      enabled: false,
    });
});

test("compiler configuration ignores ambient wrappers, remote secrets and unbounded sizes", () => {
  const configuration = releaseCompilerCacheEnvironment(
    {
      ...env,
      SITUATE_RELEASE_BUILD_CACHE: "1",
      RUSTC_WRAPPER: "/untrusted/wrapper",
      RUSTC_WORKSPACE_WRAPPER: "/untrusted/wrapper",
      SCCACHE_DIR: "/untrusted/cache",
      SCCACHE_CONF: "/untrusted/config",
      SCCACHE_CACHE_SIZE: "50G",
      SCCACHE_BUCKET: "private",
      SCCACHE_S3_KEY_PREFIX: "private",
      AWS_SECRET_ACCESS_KEY: "synthetic-secret",
      APPLE_API_PRIVATE_KEY: "synthetic-secret",
    },
    compilerOptions,
  );
  assert.deepEqual(configuration, {
    RUSTC_WRAPPER: "/tools/sccache",
    SCCACHE_DIR:
      "/Users/runner/Library/Caches/situate/release-build-v1/sccache",
    SCCACHE_CACHE_SIZE: "2G",
    SCCACHE_CONF: "/dev/null",
    SCCACHE_CLIENT_SIDE: "1",
    SCCACHE_SERVER_PORT: "4228",
    SCCACHE_IGNORE_SERVER_IO_ERROR: "1",
  });
  assert.deepEqual(releaseCompilerCacheEnvironment(env, compilerOptions), {});
  assert.deepEqual(
    releaseCompilerCacheEnvironment(
      {
        ...env,
        SITUATE_RELEASE_BUILD_CACHE: "1",
        RUNNER_ENVIRONMENT: "self-hosted",
      },
      compilerOptions,
    ),
    {},
  );
});

test("runtime probes receive no signing, remote cache or GitHub credentials", () => {
  releaseBuildCachePlan(
    fixture({
      env: {
        ...env,
        APPLE_API_PRIVATE_KEY: "synthetic",
        GH_TOKEN: "synthetic",
        SCCACHE_BUCKET: "private",
      },
      execute: (command, args, options) => {
        assert.deepEqual(options.env, { PATH: env.PATH, HOME: env.HOME });
        assert.equal(options.cwd, "/source/client");
        return execute(command, args);
      },
    }),
  );
});
