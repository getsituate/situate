import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { warmCargoCache } from "./cargo-cache.mjs";

function fixture(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-cargo-warm-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("warm-up fetches both locked workspaces sequentially with the same isolated environment", (t) => {
  const directory = fixture(t);
  const environment = Object.freeze({
    SITUATE_ISOLATE_CARGO: "1",
    HOME: directory,
    RUSTUP_TOOLCHAIN: "existing-toolchain",
    RUSTUP_AUTO_INSTALL: "1",
  });
  const calls = [];
  warmCargoCache({
    directory,
    environment,
    run: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 2);
  for (const [index, [command, args, options]] of calls.entries()) {
    assert.equal(command, "cargo");
    assert.deepEqual(args, ["fetch", "--locked"]);
    assert.equal(
      options.cwd,
      join(directory, ["client", "tools/dev-tui"][index]),
    );
    assert.equal(
      options.env.CARGO_HOME,
      join(directory, "client/target/cargo-home"),
    );
    assert.equal(options.env.RUSTUP_AUTO_INSTALL, "0");
    assert.equal(options.env.RUSTUP_TOOLCHAIN, "existing-toolchain");
    assert.equal(options.stdio, "inherit");
    assert.equal(options.shell, undefined);
  }
  assert.equal(calls[0][2].env, calls[1][2].env);
  assert.ok(!Object.hasOwn(environment, "CARGO_HOME"));
});

test("warm-up preserves shared defaults and explicit Cargo homes", (t) => {
  const directory = fixture(t);
  for (const environment of [
    {},
    { SITUATE_ISOLATE_CARGO: "1", CARGO_HOME: "" },
    { SITUATE_ISOLATE_CARGO: "1", CARGO_HOME: "/explicit/cache" },
  ]) {
    warmCargoCache({
      directory,
      environment,
      run: (_command, _args, { env }) => {
        assert.equal(env.CARGO_HOME, environment.CARGO_HOME);
        assert.equal(
          Object.hasOwn(env, "CARGO_HOME"),
          Object.hasOwn(environment, "CARGO_HOME"),
        );
        assert.equal(env.RUSTUP_AUTO_INSTALL, "0");
        return { status: 0 };
      },
    });
  }
});

for (const result of [
  { status: 7 },
  { status: null, signal: "SIGTERM" },
  { error: new Error("fake cargo unavailable") },
]) {
  test(`warm-up stops after a command failure: ${result.error?.message ?? result.signal ?? result.status}`, (t) => {
    const directory = fixture(t);
    let calls = 0;
    assert.throws(
      () =>
        warmCargoCache({
          directory,
          environment: {},
          run: () => {
            calls++;
            return result;
          },
        }),
      result.error ? /fake cargo unavailable/ : /Cargo fetch failed for client/,
    );
    assert.equal(calls, 1);
  });
}

test("CLI uses a fake Cargo executable without a network or toolchain installation", (t) => {
  const directory = fixture(t);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "cargo"),
    '#!/bin/sh\nprintf "%s\\n" "$PWD" "$*" "$CARGO_HOME" "$RUSTUP_AUTO_INSTALL" >> "$FAKE_CARGO_LOG"\nexit "${FAKE_CARGO_STATUS:-0}"\n',
    { mode: 0o700 },
  );
  const cli = fileURLToPath(new URL("./cargo-cache.mjs", import.meta.url));
  const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
  const log = join(directory, "calls");
  const env = {
    PATH: bin,
    HOME: directory,
    SITUATE_ISOLATE_CARGO: "1",
    FAKE_CARGO_LOG: log,
  };
  const result = spawnSync(process.execPath, [cli, "warm"], {
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(log, "utf8").trimEnd().split("\n"), [
    join(root, "client"),
    "fetch --locked",
    join(root, "client/target/cargo-home"),
    "0",
    join(root, "tools/dev-tui"),
    "fetch --locked",
    join(root, "client/target/cargo-home"),
    "0",
  ]);

  for (const [args, expected] of [
    [[], 2],
    [["unknown"], 2],
    [["--help"], 0],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, expected);
    assert.match(result.stdout + result.stderr, /Usage:/);
  }
  assert.equal(readFileSync(log, "utf8").trimEnd().split("\n").length, 8);

  const failed = spawnSync(process.execPath, [cli, "warm"], {
    env: { ...env, FAKE_CARGO_STATUS: "9" },
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Cargo fetch failed for client \(9\)/);
  assert.equal(readFileSync(log, "utf8").trimEnd().split("\n").length, 12);
});
