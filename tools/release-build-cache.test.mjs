import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  cargoCacheSampler,
  releaseBuildCachePlan,
  releaseSwiftCachePlan,
  releaseCacheEndpoint,
  compatibilityCacheEnvironment,
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
  RUNNER_TEMP: "/runner-temp",
  GITHUB_RUN_ID: "21",
  GITHUB_RUN_ATTEMPT: "1",
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
    "swift --version": "Apple Swift version 6.2 (synthetic)",
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

test("Swift cache reuses only compatible release scratch state across commits", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const plan = releaseSwiftCachePlan(fixture({ root }));
  assert.equal(plan.enabled, true);
  assert.match(plan.key, /^release-swift-v1-[a-f0-9]{64}-a{40}$/);
  assert.deepEqual(plan.paths, [
    "client/app/src-tauri/dictation/.build/arm64/*",
    "!client/app/src-tauri/dictation/.build/arm64/repositories",
    "client/app/src-tauri/dictation/.build/x86_64/*",
    "!client/app/src-tauri/dictation/.build/x86_64/repositories",
  ]);
  const next = releaseSwiftCachePlan(
    fixture({ root, env: { ...env, GITHUB_SHA: "b".repeat(40) } }),
  );
  assert.equal(next.restoreKey, plan.restoreKey);
  assert.notEqual(next.key, plan.key);
  for (const options of [
    { root: tmpdir() },
    { read: (path) => `${path}: changed` },
    { execute: (...args) => `new ${execute(...args)}` },
  ]) {
    const changed = releaseSwiftCachePlan(fixture({ root, ...options }));
    assert.equal(changed.enabled, true);
    assert.notEqual(changed.restoreKey, plan.restoreKey);
  }
  for (const overrides of [
    { GITHUB_REF: "refs/pull/138/merge" },
    { GITHUB_REF_PROTECTED: "false" },
    { RUNNER_ARCH: "X64", SITUATE_RELEASE_CACHE_SCOPE: "intel-compatibility" },
    {
      GITHUB_WORKFLOW_REF:
        "getsituate/situate/.github/workflows/verify.yml@refs/heads/main",
    },
  ]) {
    assert.deepEqual(
      releaseSwiftCachePlan(fixture({ root, env: { ...env, ...overrides } })),
      { enabled: false },
    );
  }
});

test("cache plan contains only bounded compiler and public Cargo download paths", () => {
  const plan = releaseBuildCachePlan(fixture());
  assert.equal(plan.enabled, true);
  assert.match(
    plan.key,
    /^release-build-v2-main-macos-ARM64-universal-release-[a-f0-9]{64}-a{40}$/,
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
    SITUATE_RELEASE_CACHE_SOCKET: "/runner-temp/situate-rc-21-1/s",
  });
  assert.deepEqual(releaseBuildCachePlan(fixture()), plan);
  const nextSource = releaseBuildCachePlan(
    fixture({ env: { ...env, GITHUB_SHA: "b".repeat(40) } }),
  );
  assert.equal(nextSource.restoreKey, plan.restoreKey);
  assert.notEqual(nextSource.key, plan.key);
  const nextRun = releaseBuildCachePlan(
    fixture({ env: { ...env, GITHUB_RUN_ATTEMPT: "2" } }),
  );
  assert.equal(nextRun.key, plan.key);
  assert.deepEqual(nextRun.paths, plan.paths);
  assert.notEqual(
    nextRun.environment.SITUATE_RELEASE_CACHE_SOCKET,
    plan.environment.SITUATE_RELEASE_CACHE_SOCKET,
  );
  const compiler = releaseCompilerCacheEnvironment(
    {
      ...env,
      ...plan.environment,
      SCCACHE_SERVER_PORT: "4227",
      SCCACHE_SERVER_UDS: "/foreign/socket",
    },
    compilerOptions,
  );
  assert.equal(
    compiler.SCCACHE_SERVER_UDS,
    plan.environment.SITUATE_RELEASE_CACHE_SOCKET,
  );
  assert.equal(compiler.SCCACHE_SERVER_PORT, undefined);
});

test("Intel compatibility persists only compiler objects under a separate trusted scope", () => {
  const intel = {
    ...env,
    RUNNER_ARCH: "X64",
    SITUATE_RELEASE_CACHE_SCOPE: "intel-compatibility",
  };
  const options = fixture({
    env: intel,
    execute: (...args) =>
      execute(...args)?.replace("host: aarch64-", "host: x86_64-"),
  });
  const plan = releaseBuildCachePlan(options);
  assert.deepEqual(releaseBuildCachePlan(fixture({ env: intel })), {
    enabled: false,
  });
  assert.equal(
    plan.restoreKey,
    "release-build-v1-main-macos-X64-intel-compatibility-1ba24541319924d822d406d5ad6cf8caffbceacc0a0b4ac64baf5816b817e85b-",
  );
  assert.deepEqual(plan.paths, [
    "/Users/runner/Library/Caches/situate/intel-compatibility-v1/sccache",
  ]);
  assert.equal(plan.environment.CARGO_HOME, undefined);
  assert.notEqual(
    releaseBuildCachePlan({
      ...options,
      env: { ...intel, ImageVersion: "next" },
    }).restoreKey,
    plan.restoreKey,
  );
  const prepared = { ...intel, ...plan.environment };
  const forLane = compatibilityCacheEnvironment(prepared);
  const forDaemon = releaseCompilerCacheEnvironment(prepared, compilerOptions);
  assert.deepEqual(forLane, {
    SITUATE_COMPILER_CACHE_SOCKET: forDaemon.SCCACHE_SERVER_UDS,
    SCCACHE_DIR: forDaemon.SCCACHE_DIR,
    SCCACHE_CACHE_SIZE: forDaemon.SCCACHE_CACHE_SIZE,
    CARGO_INCREMENTAL: "0",
  });
  assert.deepEqual(
    compatibilityCacheEnvironment({
      ...prepared,
      SITUATE_RELEASE_CACHE_SOCKET: "/tmp/foreign",
    }),
    {},
  );
  for (const change of [
    { RUNNER_ARCH: "ARM64" },
    { SITUATE_RELEASE_CACHE_SCOPE: "unknown" },
    { GITHUB_EVENT_NAME: "pull_request" },
  ]) {
    assert.deepEqual(
      releaseBuildCachePlan({ ...options, env: { ...intel, ...change } }),
      { enabled: false },
    );
    assert.deepEqual(
      compatibilityCacheEnvironment({ ...prepared, ...change }),
      {},
    );
  }
});

test("universal cache survives image revisions, not platform or probed runtime changes", () => {
  const baseline = releaseBuildCachePlan(fixture()).restoreKey;
  assert.equal(
    releaseBuildCachePlan(fixture({ env: { ...env, ImageVersion: "next" } }))
      .restoreKey,
    baseline,
  );
  for (const field of ["RUNNER_ARCH", "ImageOS"]) {
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

function temporary(t, root = tmpdir(), prefix = "release-cache-tool-test-") {
  const directory = mkdtempSync(join(root, prefix));
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
    RUNNER_TEMP: temporary(t, "/tmp", "rc-"),
    GITHUB_RUN_ID: "21",
    GITHUB_RUN_ATTEMPT: "1",
    SITUATE_RELEASE_BUILD_CACHE: "1",
    GH_TOKEN: "synthetic-private",
    SCCACHE_BUCKET: "private",
  };
  const endpoint = releaseCacheEndpoint(environment);
  environment.SITUATE_RELEASE_CACHE_SOCKET = endpoint;
  const sockets = new Map();
  const generation = { dev: "1", ino: "123", born: "1000000" };
  let index = 0;
  const commands = [];
  const options = {
    env: environment,
    compilerOptions,
    now: () => milliseconds,
    identify: (path) => sockets.get(path) ?? null,
    move: (from, to) => {
      assert.ok(
        existsSync(
          join(
            environment.RUNNER_TEMP,
            "situate-release-cache-21-1.json.reported",
          ),
        ),
      );
      assert.equal(
        existsSync(
          join(environment.RUNNER_TEMP, "situate-release-cache-21-1.json"),
        ),
        false,
      );
      sockets.set(to, sockets.get(from));
      sockets.delete(from);
    },
    execute: (command, args, settings) => {
      assert.equal(command, "/tools/sccache");
      assert.equal(settings.env.GH_TOKEN, undefined);
      assert.equal(settings.env.SCCACHE_BUCKET, undefined);
      assert.equal(settings.env.SCCACHE_CONF, "/dev/null");
      assert.equal(settings.env.SCCACHE_SERVER_PORT, undefined);
      assert.equal(settings.env.SCCACHE_CACHE_SIZE, "2G");
      commands.push(args);
      if (args[0] === "--stop-server") {
        assert.notEqual(settings.env.SCCACHE_SERVER_UDS, endpoint);
        assert.deepEqual(
          sockets.get(settings.env.SCCACHE_SERVER_UDS),
          generation,
        );
        return "stopped";
      }
      assert.equal(settings.env.SCCACHE_SERVER_UDS, endpoint);
      if (args[0] === "--start-server") {
        sockets.set(endpoint, generation);
        return "started";
      }
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
    sockets,
    endpoint,
    replace: () =>
      sockets.set(endpoint, { dev: "1", ino: "124", born: "2000000" }),
    advance: (value) => {
      milliseconds += value;
    },
  };
}
const stats = (compilations, hits, misses) => ({
  compile_requests: 0,
  compilations,
  compiler_write_duration: { secs: compilations, nanos: 500000000 },
  cache_writes: misses,
  cache_read_errors: 0,
  cache_write_errors: 0,
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
    compilations: 20,
    compilerMilliseconds: 20000,
    hits: 15,
    misses: 5,
    cacheWrites: 5,
    cacheReadErrors: 0,
    cacheWriteErrors: 0,
    flushed: true,
  });
  assert.deepEqual(sample.commands.at(-1), ["--stop-server"]);
  const path = join(
    sample.options.env.RUNNER_TEMP,
    "situate-release-cache-21-1.json.reported",
  );
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(path, "utf8"), /private/);
  assert.throws(
    () => releaseCacheMeasurement("start", sample.options),
    /already been reported/,
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
        ...stats(3, 2, 1),
        cache_hits: { counts: [] },
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
      flushed: false,
    });
    assert.ok(
      !sample.commands.some(([command]) => command === "--stop-server"),
    );
  }
});

test("a retired report cannot contact or stop a replacement daemon or restart the claim", (t) => {
  const sample = measurement(t, [stats(0, 0, 0), stats(2, 1, 1)]);
  releaseCacheMeasurement("start", sample.options);
  releaseCacheMeasurement("report", sample.options);
  sample.replace();
  const count = sample.commands.length;
  assert.throws(
    () => releaseCacheMeasurement("report", sample.options),
    /ENOENT/,
  );
  assert.throws(
    () => releaseCacheMeasurement("start", sample.options),
    /already been reported/,
  );
  assert.equal(sample.commands.length, count);
  assert.deepEqual(sample.sockets.get(sample.endpoint), {
    dev: "1",
    ino: "124",
    born: "2000000",
  });
});

test("changed socket generations and unresolved ownership cannot authorize a flush", (t) => {
  for (const replace of [
    (sample) => sample.replace(),
    (sample) => sample.sockets.delete(sample.endpoint),
    (sample) =>
      sample.sockets.set(sample.endpoint, {
        dev: "1",
        ino: "123",
        born: "2000000",
      }),
  ]) {
    const sample = measurement(t, [stats(0, 0, 0), stats(2, 1, 1)]);
    releaseCacheMeasurement("start", sample.options);
    replace(sample);
    const count = sample.commands.length;
    assert.deepEqual(releaseCacheMeasurement("report", sample.options), {
      enabled: true,
      elapsedSeconds: 0,
      statisticsAvailable: false,
      flushed: false,
    });
    assert.equal(sample.commands.length, count);
    assert.throws(
      () => releaseCacheMeasurement("report", sample.options),
      /ENOENT/,
    );
  }
});

test("the persisted endpoint and compiler endpoint must match the owned run", (t) => {
  const sample = measurement(t, [stats(0, 0, 0), stats(2, 1, 1)]);
  releaseCacheMeasurement("start", sample.options);
  const count = sample.commands.length;
  assert.throws(
    () =>
      releaseCacheMeasurement("report", {
        ...sample.options,
        env: {
          ...sample.options.env,
          SITUATE_RELEASE_CACHE_SOCKET: "/foreign/socket",
        },
      }),
    /Invalid release-cache endpoint/,
  );
  const path = join(
    sample.options.env.RUNNER_TEMP,
    "situate-release-cache-21-1.json",
  );
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  baseline.endpoint = "/foreign/socket";
  writeFileSync(path, JSON.stringify(baseline));
  assert.equal(
    releaseCacheMeasurement("report", sample.options).flushed,
    false,
  );
  assert.equal(sample.commands.length, count);
});

test("replacement during sampling or socket relocation is never stopped", (t) => {
  for (const during of ["sample", "relocation"]) {
    const sample = measurement(t, [stats(0, 0, 0), stats(2, 1, 1)]);
    releaseCacheMeasurement("start", sample.options);
    const execute = sample.options.execute;
    const move = sample.options.move;
    const result = releaseCacheMeasurement("report", {
      ...sample.options,
      execute: (command, args, settings) => {
        const value = execute(command, args, settings);
        if (during === "sample" && args[0] === "--show-stats") sample.replace();
        return value;
      },
      move: (from, to) => {
        if (during === "relocation") sample.replace();
        move(from, to);
      },
    });
    assert.equal(result.flushed, false);
    assert.ok(
      !sample.commands.some(([command]) => command === "--stop-server"),
    );
  }
});

test("the relocated shutdown endpoint cannot stop a new daemon at the build endpoint", (t) => {
  const sample = measurement(t, [stats(0, 0, 0), stats(2, 1, 1)]);
  releaseCacheMeasurement("start", sample.options);
  const move = sample.options.move;
  const result = releaseCacheMeasurement("report", {
    ...sample.options,
    move: (from, to) => {
      move(from, to);
      sample.replace();
    },
  });
  assert.equal(result.flushed, true);
  assert.deepEqual(sample.sockets.get(sample.endpoint), {
    dev: "1",
    ino: "124",
    born: "2000000",
  });
});

test("failed startup or a non-socket endpoint never grants daemon ownership", (t) => {
  for (const kind of ["failed", "regular-file"]) {
    const sample = measurement(t, [stats(0, 0, 0)]);
    const options = {
      ...sample.options,
      identify: undefined,
      execute: (_command, args) => {
        assert.deepEqual(args, ["--start-server"]);
        if (kind === "failed")
          throw new Error("synthetic private startup diagnostic");
        writeFileSync(sample.endpoint, "not a socket");
        return "started";
      },
    };
    assert.deepEqual(releaseCacheMeasurement("start", options), {
      enabled: true,
      statisticsAvailable: false,
    });
    assert.equal(releaseCacheMeasurement("report", options).flushed, false);
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
    compilations: 2,
    compilerMilliseconds: 2000,
    hits: 1,
    misses: 1,
    cacheWrites: 1,
    cacheReadErrors: 0,
    cacheWriteErrors: 0,
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

test("the Tauri Cargo runner forwards arguments and preserves a failed Cargo exit", (t) => {
  const bin = temporary(t, tmpdir(), "release-cargo-");
  writeFileSync(
    join(bin, "cargo"),
    '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 19\n',
    { mode: 0o700 },
  );
  const runner = fileURLToPath(
    new URL("./release-build-cache-cargo.mjs", import.meta.url),
  );
  const args = [
    "build",
    "--locked",
    "--features",
    "one,two",
    "--release",
    "--target",
    "x86_64-apple-darwin",
  ];
  for (const cargo of [undefined, "cargo", join(bin, "wrong")]) {
    const invalid = spawnSync(process.execPath, [runner, ...args], {
      env: { PATH: bin, ...(cargo ? { SITUATE_RELEASE_CARGO: cargo } : {}) },
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /absolute path to the release Cargo/);
  }
  const result = spawnSync(process.execPath, [runner, ...args], {
    env: { PATH: "/usr/bin:/bin", SITUATE_RELEASE_CARGO: join(bin, "cargo") },
    encoding: "utf8",
  });
  assert.equal(result.status, 19);
  const lines = result.stdout.trimEnd().split("\n");
  const metric = JSON.parse(lines.pop());
  assert.deepEqual(lines, args);
  assert.equal(metric.target, "x86_64-apple-darwin");
  assert.equal(metric.exitCode, 19);
  assert.equal(metric.cache, null);
  assert.ok(metric.elapsedSeconds >= 0);
  assert.ok(metric.availableCpus > 0);
  assert.ok(metric.memoryBytes > 0);
});

test("the Cargo sampler reports phase deltas only for the same daemon", () => {
  const generation = { dev: "1", ino: "2", born: "3" };
  for (const replaced of [false, true]) {
    let active = generation;
    const samples = [stats(5, 2, 3), stats(6, 9, 4)];
    const finish = cargoCacheSampler(
      {
        RUSTC_WRAPPER: "/tools/sccache",
        SCCACHE_SERVER_UDS: "/tmp/cache/s",
        GH_TOKEN: "synthetic",
      },
      (command, args, options) => {
        assert.equal(command, "/tools/sccache");
        assert.deepEqual(args, ["--show-stats", "--stats-format=json"]);
        assert.equal(options.env.GH_TOKEN, undefined);
        return JSON.stringify({ stats: samples.shift() });
      },
      () => active,
    );
    if (replaced) active = { ...generation, ino: "9" };
    assert.deepEqual(
      finish(),
      replaced
        ? null
        : {
            compilations: 1,
            compilerMilliseconds: 1000,
            hits: 7,
            misses: 1,
            cacheWrites: 1,
            cacheReadErrors: 0,
            cacheWriteErrors: 0,
          },
    );
    assert.equal(samples.length, replaced ? 1 : 0);
  }
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
