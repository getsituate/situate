import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilerCacheEnvironment } from "./compiler-cache.mjs";
import {
  childEnvironment,
  createIsolation,
} from "../client/scripts/agent-e2e-runtime.mjs";

const execute = promisify(execFile);

test(
  "shared cache survives run cleanup without sharing compiler temporaries",
  { timeout: 60000 },
  async (t) => {
    const configuration = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      RUSTUP_HOME: process.env.RUSTUP_HOME,
      VOLTA_HOME: process.env.VOLTA_HOME,
    };
    const available = compilerCacheEnvironment(configuration);
    if (!available.RUSTC_WRAPPER) {
      t.skip("Requires sccache 0.19.0 or newer on PATH");
      return;
    }
    // macOS startup notification sockets also live beneath each run's TMPDIR.
    const root = await mkdtemp(
      join(process.platform === "darwin" ? "/tmp" : tmpdir(), "situate-cc-"),
    );
    const socket = join(root, "s");
    const cache = join(root, "cache");
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const runs = new Set();
    let control;
    let started = false;
    t.after(async () => {
      // The unique UDS belongs to this test; never contact the default TCP server.
      if (started)
        await execute(available.RUSTC_WRAPPER, ["--stop-server"], {
          env: control,
          timeout: 10000,
        });
      for (const run of runs) await run.cleanup();
      await rm(root, { recursive: true, force: true });
    });
    async function isolate() {
      const run = await createIsolation(root);
      runs.add(run);
      const env = childEnvironment(
        run,
        { ...configuration, SCCACHE_DIR: cache },
        { build: true },
      );
      assert.equal(env.SCCACHE_CLIENT_SIDE, "1");
      assert.equal(env.TMPDIR, join(run.root, "tmp"));
      assert.equal(env.HOME, join(run.root, "home"));
      assert.equal(env.CARGO_HOME, join(run.root, "cargo"));
      delete env.SCCACHE_SERVER_PORT;
      delete env.SCCACHE_IGNORE_SERVER_IO_ERROR;
      env.SCCACHE_SERVER_UDS = socket;
      env.SCCACHE_IDLE_TIMEOUT = "0";
      return { run, env };
    }
    async function cleanup(run) {
      await run.cleanup();
      runs.delete(run);
      await assert.rejects(access(run.root), { code: "ENOENT" });
    }
    const a = await isolate();
    const b = await isolate();
    control = { ...a.env, TMPDIR: root, HOME: root };
    await execute(available.RUSTC_WRAPPER, ["--start-server"], {
      env: a.env,
      timeout: 10000,
    });
    started = true;
    const identity = await lstat(socket);
    async function stats() {
      const { stdout } = await execute(
        available.RUSTC_WRAPPER,
        ["--show-stats", "--stats-format=json"],
        { env: control, timeout: 10000 },
      );
      return JSON.parse(stdout).stats;
    }
    const source = join(workspace, "lib.rs");
    await writeFile(source, "pub fn value() -> u32 { 1 }\n");
    const args = [
      "rustc",
      "--crate-name",
      "fixture",
      "--crate-type",
      "rlib",
      "--emit=link",
      source,
      "--out-dir",
      workspace,
    ];
    async function compile(env, output = join(env.HOME, "..", "target")) {
      await mkdir(output, { recursive: true });
      // Bare rustc needs no Cargo home; differing CARGO_* values change cache keys.
      const compilerEnvironment = { ...env };
      delete compilerEnvironment.CARGO_HOME;
      await execute(env.RUSTC_WRAPPER, [...args.slice(0, -1), output], {
        cwd: workspace,
        env: compilerEnvironment,
        timeout: 20000,
        maxBuffer: 65536,
      });
      await access(join(output, "libfixture.rlib"));
    }
    await compile(a.env);
    const first = await stats();
    assert.ok(first.cache_misses.counts.Rust >= 1);
    await cleanup(a.run);

    // Negative control: the old server-side pipeline still uses A's deleted TMPDIR.
    await assert.rejects(
      compile({ ...b.env, SCCACHE_CLIENT_SIDE: "0" }),
      (error) => {
        assert.match(error.stderr, /Failed to create temp dir/);
        return true;
      },
    );
    await compile(b.env);
    const reused = await stats();
    assert.ok(
      reused.cache_hits.counts.Rust >= 1,
      "B did not reuse the shared cache entry",
    );
    await writeFile(source, "pub fn value() -> u32 { 2 }\n");
    await compile(b.env);
    const missed = await stats();
    assert.ok(missed.cache_misses.counts.Rust > first.cache_misses.counts.Rust);
    assert.equal((await lstat(socket)).ino, identity.ino);
    assert.equal((await lstat(socket)).birthtimeMs, identity.birthtimeMs);

    const c = await isolate();
    const d = await isolate();
    const outcomes = await Promise.allSettled([
      compile(c.env, join(c.run.root, "target")).then(() => cleanup(c.run)),
      compile(d.env, join(d.run.root, "target")),
    ]);
    for (const outcome of outcomes)
      assert.equal(outcome.status, "fulfilled", outcome.reason?.message);
    await compile(d.env, join(d.run.root, "target"));
    assert.equal((await lstat(socket)).ino, identity.ino);
  },
);
