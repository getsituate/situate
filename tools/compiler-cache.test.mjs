import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  compilerCacheEnvironment,
  nativeSmokeBuildEnvironment,
} from "./compiler-cache.mjs";
import { childEnvironment } from "../client/scripts/agent-e2e-runtime.mjs";
import { suiteEnvironment } from "./test.mjs";
import { tauriDevCommand } from "../client/scripts/tauri-dev.mjs";
import { buildEnvironment } from "../client/scripts/ios-xcode.mjs";

const enabled = Object.freeze({
  HOME: "/synthetic/home",
  PATH: "/synthetic/bin",
});
const available = {
  find: () => "/synthetic/bin/sccache",
  version: () => "sccache 0.19.0",
  platform: "darwin",
};

test("explicit opt-out and wrapper choices take precedence", () => {
  const forbidden = () => assert.fail("unexpected executable lookup");
  for (const environment of [
    { ...enabled, SITUATE_SCCACHE: "0" },
    { ...enabled, RUSTC_WRAPPER: "" },
    { ...enabled, RUSTC_WRAPPER: "/custom/wrapper" },
    { ...enabled, RUSTC_WORKSPACE_WRAPPER: "/custom/wrapper" },
  ]) {
    const result = compilerCacheEnvironment(environment, { find: forbidden });
    assert.deepEqual(result, environment);
    assert.notEqual(result, environment);
  }
  assert.deepEqual(
    compilerCacheEnvironment(enabled, { find: () => undefined }),
    enabled,
  );
});

test("automatic local caching preserves Cargo profiles and targets", () => {
  const environment = Object.freeze({
    ...enabled,
    CARGO_HOME: "/isolated/cargo",
    CARGO_TARGET_DIR: "/worktree/target",
    CARGO_INCREMENTAL: "1",
    TMPDIR: "/isolated/tmp",
    SCCACHE_CLIENT_SIDE: "0",
    SCCACHE_ERROR_LOG: "/personal/log",
    SCCACHE_BUCKET: "not-local",
    SCCACHE_CONF: "/personal/config",
    SCCACHE_SERVER_PORT: "9000",
  });
  const result = compilerCacheEnvironment(environment, available);
  assert.equal(result.RUSTC_WRAPPER, "/synthetic/bin/sccache");
  assert.equal(
    result.SCCACHE_DIR,
    "/synthetic/home/Library/Caches/situate/sccache",
  );
  assert.equal(result.SCCACHE_CACHE_SIZE, "50G");
  assert.equal(result.SCCACHE_CONF, "/dev/null");
  assert.equal(result.SCCACHE_SERVER_PORT, "4227");
  assert.equal(result.SCCACHE_IGNORE_SERVER_IO_ERROR, "1");
  assert.equal(result.SCCACHE_CLIENT_SIDE, "1");
  assert.equal(result.SCCACHE_ERROR_LOG, undefined);
  assert.equal(result.TMPDIR, "/isolated/tmp");
  assert.equal(result.SCCACHE_BUCKET, undefined);
  assert.equal(result.CARGO_HOME, environment.CARGO_HOME);
  assert.equal(result.CARGO_TARGET_DIR, environment.CARGO_TARGET_DIR);
  assert.equal(result.CARGO_INCREMENTAL, "1");
  assert.equal(result.CARGO_PROFILE_DEV_DEBUG, undefined);
  assert.equal(environment.SCCACHE_BUCKET, "not-local");
});

test("automatic caching requires a stable release with client-side support", () => {
  for (const release of [
    "sccache 0.18.1",
    "sccache 0.9.0",
    "",
    "unknown",
    "sccache 0.19.0-pre.1",
  ]) {
    assert.deepEqual(
      compilerCacheEnvironment(enabled, {
        ...available,
        version: () => release,
      }),
      enabled,
    );
  }
  for (const release of ["sccache 0.19.0", "sccache 0.20.0", "sccache 1.0.0"]) {
    assert.equal(
      compilerCacheEnvironment(enabled, {
        ...available,
        version: () => release,
      }).SCCACHE_CLIENT_SIDE,
      "1",
    );
  }
});

test("version probing excludes inherited secrets and personal configuration", (t) => {
  const { executable, bin } = executableFixture(t);
  writeFileSync(
    executable,
    `#!/bin/sh
[ "$1" = "--version" ] || exit 1
[ "$SCCACHE_CONF" = "/dev/null" ] || exit 1
[ -z "$HOME$AWS_SECRET_ACCESS_KEY$SCCACHE_BUCKET$NODE_OPTIONS" ] || exit 1
printf 'sccache 0.19.0\\n'
`,
  );
  assert.equal(
    compilerCacheEnvironment({ ...enabled, PATH: bin }).SCCACHE_CLIENT_SIDE,
    "1",
  );
  writeFileSync(executable, "#!/bin/sh\nexit 1\n");
  assert.equal(
    compilerCacheEnvironment({ ...enabled, PATH: bin }).RUSTC_WRAPPER,
    undefined,
  );
});

test("cache settings accept overrides and reject invalid inputs", () => {
  const result = compilerCacheEnvironment(
    { ...enabled, SCCACHE_DIR: "/cache", SCCACHE_CACHE_SIZE: "75G" },
    available,
  );
  assert.equal(result.SCCACHE_DIR, "/cache");
  assert.equal(result.SCCACHE_CACHE_SIZE, "75G");
  assert.equal(
    compilerCacheEnvironment(enabled, { ...available, platform: "linux" })
      .SCCACHE_DIR,
    "/synthetic/home/.cache/situate/sccache",
  );
  for (const SCCACHE_DIR of ["", "relative"])
    assert.throws(
      () => compilerCacheEnvironment({ ...enabled, SCCACHE_DIR }, available),
      /absolute path/,
    );
  for (const SCCACHE_CACHE_SIZE of ["", "0", "-1G", "unlimited"])
    assert.throws(
      () =>
        compilerCacheEnvironment({ ...enabled, SCCACHE_CACHE_SIZE }, available),
      /positive size/,
    );
});

test("smoke debug defaults preserve explicit profile settings", () => {
  assert.equal(
    nativeSmokeBuildEnvironment({}).CARGO_PROFILE_DEV_DEBUG,
    "line-tables-only",
  );
  const result = nativeSmokeBuildEnvironment({
    CARGO_PROFILE_DEV_DEBUG: "full",
    CARGO_INCREMENTAL: "1",
    CARGO_PROFILE_RELEASE_DEBUG: "full",
  });
  assert.equal(result.CARGO_PROFILE_DEV_DEBUG, "full");
  assert.equal(result.CARGO_INCREMENTAL, "1");
  assert.equal(result.CARGO_PROFILE_RELEASE_DEBUG, "full");
});

function executableFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-compiler-cache-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const executable = join(bin, "sccache");
  writeFileSync(executable, "#!/bin/sh\nprintf 'sccache 0.19.0\\n'\n");
  chmodSync(executable, 0o700);
  return { root, bin, executable };
}

test("PATH lookup requires an absolute executable file", (t) => {
  const { root, bin, executable } = executableFixture(t);
  const directory = join(root, "directory");
  mkdirSync(join(directory, "sccache"), { recursive: true });
  const file = join(root, "file");
  mkdirSync(file);
  writeFileSync(join(file, "sccache"), "not executable", { mode: 0o600 });
  const result = compilerCacheEnvironment({
    ...enabled,
    PATH: [".", directory, file, bin].join(delimiter),
  });
  assert.equal(result.RUSTC_WRAPPER, executable);
});

test("E2E builds share cache settings without exposing them to apps", (t) => {
  const { bin, executable } = executableFixture(t);
  const configuration = {
    ...enabled,
    PATH: bin,
    SCCACHE_CACHE_SIZE: "75G",
    SCCACHE_DIR: "/synthetic/cache",
    SCCACHE_BUCKET: "private-remote",
    AWS_SECRET_ACCESS_KEY: "synthetic-secret",
    RUSTC_WRAPPER: "/personal/wrapper",
    CARGO_HOME: "/personal/cargo",
  };
  const isolated = { root: "/synthetic/run", owner: "owner" };
  const build = childEnvironment(isolated, configuration, { build: true });
  assert.equal(build.RUSTC_WRAPPER, executable);
  assert.equal(build.SCCACHE_DIR, "/synthetic/cache");
  assert.equal(build.SCCACHE_CACHE_SIZE, "75G");
  assert.equal(build.SCCACHE_CONF, "/dev/null");
  assert.equal(build.SCCACHE_SERVER_PORT, "4227");
  assert.equal(build.SCCACHE_BUCKET, undefined);
  assert.equal(build.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(build.CARGO_HOME, "/synthetic/run/cargo");
  assert.equal(build.HOME, "/synthetic/run/home");
  assert.equal(build.TMPDIR, "/synthetic/run/tmp");
  assert.equal(build.SCCACHE_CLIENT_SIDE, "1");
  assert.equal(build.CARGO_INCREMENTAL, "0");
  assert.equal(build.CARGO_PROFILE_DEV_DEBUG, "line-tables-only");
  const app = childEnvironment(isolated, configuration);
  assert.equal(app.RUSTC_WRAPPER, undefined);
  assert.equal(app.SCCACHE_DIR, undefined);
});

test("development and runner caching excludes coverage", (t) => {
  const { bin, executable } = executableFixture(t);
  const environment = { ...enabled, PATH: bin };
  const normal = suiteEnvironment(
    { kind: "unit", command: "cargo" },
    "/synthetic",
    environment,
  );
  assert.equal(normal.RUSTC_WRAPPER, executable);
  assert.equal(normal.CARGO_INCREMENTAL, undefined);
  assert.equal(normal.CARGO_PROFILE_DEV_DEBUG, undefined);
  const quality = suiteEnvironment(
    { id: "root-rust", kind: "check", command: "npm" },
    "/synthetic",
    environment,
  );
  assert.equal(quality.RUSTC_WRAPPER, executable);
  const frontend = suiteEnvironment(
    { id: "client-types", kind: "check", command: process.execPath },
    "/synthetic",
    environment,
  );
  assert.equal(frontend.RUSTC_WRAPPER, undefined);
  assert.equal(frontend.SCCACHE_DIR, undefined);
  const coverage = suiteEnvironment(
    { kind: "coverage", command: "cargo" },
    "/synthetic",
    environment,
  );
  assert.equal(coverage.RUSTC_WRAPPER, undefined);
  assert.equal(coverage.SCCACHE_DIR, undefined);
  const desktop = tauriDevCommand(
    "/synthetic/app",
    "http://localhost",
    [],
    environment,
  );
  assert.equal(
    desktop.env.RUSTC_WRAPPER,
    Object.hasOwn(process.env, "RUSTC_WRAPPER") ||
      Object.hasOwn(process.env, "RUSTC_WORKSPACE_WRAPPER")
      ? process.env.RUSTC_WRAPPER
      : executable,
  );
  const ios = buildEnvironment(
    environment,
    { output: "/synthetic/ios" },
    "/rust/bin",
  );
  assert.equal(ios.RUSTC_WRAPPER, executable);
  assert.equal(ios.CARGO_TARGET_DIR, "/synthetic/ios/cargo");
});
