import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  releaseBuildCachePlan,
  releaseCompilerCacheEnvironment,
  downloadReleaseTool,
  prepareReleaseCacheTool,
  releaseCacheMeasurement,
  sccacheRelease,
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

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "release-cache-tool-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function preparation(t, overrides = {}) {
  const directory = temporary(t);
  const bytes = Buffer.from("synthetic archive, never executed");
  return {
    env: {
      ...env,
      RUNNER_TEMP: directory,
      GH_TOKEN: "synthetic-private",
      APPLE_API_PRIVATE_KEY: "synthetic-private",
    },
    platform: "darwin",
    arch: "arm64",
    checksums: { ARM64: createHash("sha256").update(bytes).digest("hex") },
    download: async (url) => {
      assert.equal(
        url,
        "https://github.com/mozilla/sccache/releases/download/v0.19.0/sccache-v0.19.0-aarch64-apple-darwin.tar.gz",
      );
      return bytes;
    },
    extract: (command, args, options) => {
      assert.equal(command, "/usr/bin/tar");
      assert.deepEqual(args.slice(0, 1), ["-xzf"]);
      assert.deepEqual(args.slice(4), [
        "--strip-components",
        "1",
        "sccache-v0.19.0-aarch64-apple-darwin/sccache",
      ]);
      assert.deepEqual(options.env, { PATH: "/usr/bin:/bin" });
      assert.equal(options.timeout, 10000);
      assert.deepEqual(readFileSync(args[1]), bytes);
      writeFileSync(
        join(args[3], "sccache"),
        "synthetic executable, never run",
      );
    },
    ...overrides,
  };
}

test("preparation verifies a pinned public asset before extracting only its compiler-cache executable", async (t) => {
  assert.equal(sccacheRelease.version, "0.19.0");
  assert.deepEqual(sccacheRelease.checksums, {
    ARM64: "a35a0b7d622618774bc1bb8102d72562dfb21e619f88b153b370d7f89bc286af",
    X64: "2db7344bb96de350df79cd9f0124dd4e9baa47b3de2fac1e63e1346b66b20684",
  });
  const options = preparation(t);
  const result = await prepareReleaseCacheTool(options);
  assert.ok(
    result.bin.startsWith(`${options.env.RUNNER_TEMP}/situate-release-tool-`),
  );
  assert.equal(result.version, "0.19.0");
  assert.equal(result.sha256, options.checksums.ARM64);
  assert.equal(lstatSync(join(result.bin, "sccache")).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(result.bin, "..")).mode & 0o777, 0o700);
  assert.equal(existsSync(join(result.bin, "../sccache.tar.gz")), false);
});

test("Intel preparation selects the separately pinned Intel asset", async (t) => {
  const base = preparation(t);
  const options = {
    ...base,
    arch: "x64",
    env: { ...base.env, RUNNER_ARCH: "X64" },
    checksums: { X64: base.checksums.ARM64 },
    download: async (url) => {
      assert.equal(
        url,
        "https://github.com/mozilla/sccache/releases/download/v0.19.0/sccache-v0.19.0-x86_64-apple-darwin.tar.gz",
      );
      return Buffer.from("synthetic archive, never executed");
    },
    extract: (_command, args) => {
      assert.equal(args.at(-1), "sccache-v0.19.0-x86_64-apple-darwin/sccache");
      writeFileSync(join(args[3], "sccache"), "synthetic");
    },
  };
  assert.equal(
    (await prepareReleaseCacheTool(options)).sha256,
    options.checksums.X64,
  );
});

test("untrusted or unknown platforms cannot download or extract a release tool", async (t) => {
  const base = preparation(t);
  for (const change of [
    { platform: "linux" },
    { arch: "unknown" },
    { arch: "x64" },
    { env: { ...base.env, RUNNER_ENVIRONMENT: "self-hosted" } },
    { env: { ...base.env, RUNNER_TEMP: "relative" } },
  ]) {
    await assert.rejects(
      prepareReleaseCacheTool({
        ...base,
        ...change,
        download: () => assert.fail("must not download"),
      }),
    );
  }
  assert.deepEqual(readdirSync(base.env.RUNNER_TEMP), []);
});

test("checksum mismatch, incomplete downloads and invalid extraction fail closed and remove owned temporaries", async (t) => {
  for (const change of [
    {
      checksums: sccacheRelease.checksums,
      extract: () => assert.fail("unverified bytes must not be extracted"),
    },
    {
      download: async () => Buffer.alloc(0),
      extract: () => assert.fail("empty archive"),
    },
    {
      download: async () => {
        throw new Error("synthetic unavailable");
      },
    },
    {
      extract: () => {
        throw new Error("synthetic extraction failure");
      },
    },
    {
      extract: (_command, args) =>
        symlinkSync("/foreign/tool", join(args[3], "sccache")),
    },
  ]) {
    const options = preparation(t, change);
    await assert.rejects(prepareReleaseCacheTool(options));
    assert.deepEqual(readdirSync(options.env.RUNNER_TEMP), []);
  }
});

test("public tool downloads omit credentials and follow only bounded HTTPS release redirects", async () => {
  const calls = [];
  const bytes = await downloadReleaseTool(
    "https://github.com/mozilla/sccache/releases/download/v0.19.0/tool",
    async (url, options) => {
      calls.push(String(url));
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      assert.equal(options.referrerPolicy, "no-referrer");
      assert.deepEqual(options.headers, { Accept: "application/octet-stream" });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                "https://release-assets.githubusercontent.com/synthetic",
            },
          })
        : new Response("synthetic bytes");
    },
  );
  assert.equal(bytes.toString(), "synthetic bytes");
  assert.equal(calls.length, 2);
  for (const url of [
    "http://github.com/tool",
    "https://foreign.invalid/tool",
    "https://token@github.com/tool",
  ]) {
    await assert.rejects(
      downloadReleaseTool(url, () => assert.fail("must not fetch")),
    );
  }
  let redirects = 0;
  await assert.rejects(
    downloadReleaseTool("https://github.com/tool", async () => {
      redirects++;
      return new Response(null, {
        status: 302,
        headers: { location: "/again" },
      });
    }),
    /Too many/,
  );
  assert.equal(redirects, 4);
  await assert.rejects(
    downloadReleaseTool(
      "https://github.com/tool",
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://foreign.invalid/tool" },
        }),
    ),
    /Unsupported/,
  );
});

test("download bounds reject both declared and streamed oversized responses", async () => {
  await assert.rejects(
    downloadReleaseTool(
      "https://github.com/tool",
      async () =>
        new Response("small", {
          headers: { "content-length": String(64 * 1024 * 1024 + 1) },
        }),
    ),
    /too large/,
  );
  await assert.rejects(
    downloadReleaseTool(
      "https://github.com/tool",
      async () => new Response(new Uint8Array(64 * 1024 * 1024 + 1)),
    ),
    /too large/,
  );
  await assert.rejects(
    downloadReleaseTool(
      "https://github.com/tool",
      async () => new Response("missing", { status: 404 }),
    ),
    /unavailable/,
  );
});

function measurement(t, counters) {
  let milliseconds = 100000;
  const environment = {
    ...env,
    RUNNER_TEMP: temporary(t),
    GITHUB_RUN_ID: "21",
    GITHUB_RUN_ATTEMPT: "1",
    SITUATE_RELEASE_BUILD_CACHE: "1",
    GH_TOKEN: "synthetic-private",
    SCCACHE_BUCKET: "private",
  };
  let index = 0;
  const commands = [];
  const options = {
    env: environment,
    compilerOptions,
    now: () => milliseconds,
    execute: (command, args, settings) => {
      assert.equal(command, "/tools/sccache");
      assert.equal(settings.env.GH_TOKEN, undefined);
      assert.equal(settings.env.SCCACHE_BUCKET, undefined);
      assert.equal(settings.env.SCCACHE_CONF, "/dev/null");
      assert.equal(settings.env.SCCACHE_SERVER_PORT, "4228");
      assert.equal(settings.env.SCCACHE_CACHE_SIZE, "2G");
      commands.push(args);
      if (args[0] === "--stop-server") return "stopped";
      assert.deepEqual(args, ["--show-stats", "--stats-format=json"]);
      const sample = counters[index++];
      if (sample instanceof Error) throw sample;
      return typeof sample === "string"
        ? sample
        : JSON.stringify({
            stats: sample,
            cache_location: "/private/path",
            other: "synthetic-private",
          });
    },
  };
  return {
    options,
    commands,
    advance: (value) => {
      milliseconds += value;
    },
  };
}
const stats = (requests, hits, misses) => ({
  compile_requests: requests,
  cache_hits: {
    counts: { Rust: hits, "C/C++": 1 },
    adv_counts: { Rust: hits },
  },
  cache_misses: { counts: { Rust: misses }, adv_counts: { Rust: misses } },
});

test("reports observed elapsed interval and counter deltas without paths or raw diagnostics", (t) => {
  const sample = measurement(t, [stats(10, 3, 6), stats(30, 18, 11)]);
  assert.deepEqual(releaseCacheMeasurement("start", sample.options), {
    enabled: true,
    statisticsAvailable: true,
  });
  sample.advance(12500);
  assert.deepEqual(releaseCacheMeasurement("report", sample.options), {
    enabled: true,
    elapsedSeconds: 12.5,
    statisticsAvailable: true,
    compileRequests: 20,
    hits: 15,
    misses: 5,
    flushed: true,
  });
  assert.deepEqual(sample.commands.at(-1), ["--stop-server"]);
  const path = join(
    sample.options.env.RUNNER_TEMP,
    "situate-release-cache-21-1.json",
  );
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(path, "utf8"), /private/);
  assert.throws(
    () => releaseCacheMeasurement("start", sample.options),
    /EEXIST/,
  );
});

test("unavailable, malformed or reset statistics never become invented hits or misses", (t) => {
  for (const snapshots of [
    [new Error("private diagnostic"), stats(3, 2, 1)],
    [stats(3, 2, 1), "malformed private diagnostic"],
    [stats(3, 2, 1), stats(0, 0, 0)],
    [stats(0, 0, 0), stats(3, -1, 1)],
    [
      stats(0, 0, 0),
      {
        compile_requests: 3,
        cache_hits: { counts: [] },
        cache_misses: { counts: {} },
      },
    ],
  ]) {
    const sample = measurement(t, snapshots);
    releaseCacheMeasurement("start", sample.options);
    sample.advance(1000);
    assert.deepEqual(releaseCacheMeasurement("report", sample.options), {
      enabled: true,
      elapsedSeconds: 1,
      statisticsAvailable: false,
      flushed: true,
    });
  }
});

test("flush failures retain measured counters without exposing command errors", (t) => {
  const sample = measurement(t, [stats(0, 0, 0), stats(2, 1, 1)]);
  releaseCacheMeasurement("start", sample.options);
  sample.advance(500);
  const execute = sample.options.execute;
  const result = releaseCacheMeasurement("report", {
    ...sample.options,
    execute: (command, args, settings) => {
      if (args[0] === "--stop-server")
        throw new Error("synthetic private diagnostic");
      return execute(command, args, settings);
    },
  });
  assert.deepEqual(result, {
    enabled: true,
    elapsedSeconds: 0.5,
    statisticsAvailable: true,
    compileRequests: 2,
    hits: 1,
    misses: 1,
    flushed: false,
  });
});

test("reporting requires an owned private start record and never enables cache configuration", (t) => {
  assert.deepEqual(releaseCacheMeasurement("report", { env }), {
    enabled: false,
  });
  const sample = measurement(t, [stats(0, 0, 0)]);
  assert.throws(
    () => releaseCacheMeasurement("report", sample.options),
    /ENOENT/,
  );
  releaseCacheMeasurement("start", sample.options);
  const path = join(
    sample.options.env.RUNNER_TEMP,
    "situate-release-cache-21-1.json",
  );
  chmodSync(path, 0o644);
  assert.throws(
    () => releaseCacheMeasurement("report", sample.options),
    /Invalid/,
  );
  chmodSync(path, 0o600);
  sample.advance(-1000);
  assert.throws(
    () => releaseCacheMeasurement("report", sample.options),
    /interval/,
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
