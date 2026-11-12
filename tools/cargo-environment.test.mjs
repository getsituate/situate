import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { cargoEnvironment } from "./cargo-environment.mjs";

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "situate-cargo-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("shared Cargo home remains the default without filesystem access", () => {
  for (const flag of [undefined, "", "0", "true"]) {
    const environment = Object.freeze({
      SITUATE_ISOLATE_CARGO: flag,
      PATH: "/tools/bin",
      RUSTUP_AUTO_INSTALL: "1",
    });
    const result = cargoEnvironment("/nonexistent/worktree", environment);
    assert.deepEqual(result, environment);
    assert.notEqual(result, environment);
  }
});

test("explicit Cargo homes, including empty and relative values, take precedence", () => {
  for (const home of ["", "relative-cache", "/shared/cache"]) {
    const environment = Object.freeze({
      SITUATE_ISOLATE_CARGO: "1",
      CARGO_HOME: home,
      PATH: "/tools/bin",
    });
    assert.deepEqual(
      cargoEnvironment("/nonexistent/worktree", environment),
      environment,
    );
  }
});

test("isolation uses a canonical per-worktree path without copying or creating files", (t) => {
  const directory = fixture(t);
  const first = join(directory, "first");
  const second = join(directory, "second");
  const alias = join(directory, "alias");
  mkdirSync(first);
  mkdirSync(second);
  symlinkSync(first, alias);
  const home = join(directory, "home");
  mkdirSync(join(home, ".cargo"), { recursive: true });
  writeFileSync(join(home, ".cargo/credentials.toml"), "synthetic credential");
  writeFileSync(join(home, ".cargo/config.toml"), "synthetic config");
  const environment = Object.freeze({
    SITUATE_ISOLATE_CARGO: "1",
    HOME: home,
    PATH: "/tools/bin",
    RUSTUP_HOME: "/toolchains",
    RUSTUP_TOOLCHAIN: "existing-toolchain",
  });
  const result = cargoEnvironment(first, environment);
  assert.equal(result.CARGO_HOME, join(first, "client/target/cargo-home"));
  assert.equal(
    cargoEnvironment(alias, environment).CARGO_HOME,
    result.CARGO_HOME,
  );
  assert.equal(
    cargoEnvironment(second, environment).CARGO_HOME,
    join(second, "client/target/cargo-home"),
  );
  assert.equal(result.RUSTUP_HOME, "/toolchains");
  assert.equal(result.RUSTUP_TOOLCHAIN, "existing-toolchain");
  assert.equal(result.RUSTUP_AUTO_INSTALL, "0");
  assert.equal(
    result.PATH,
    ["/tools/bin", join(home, ".cargo/bin")].join(delimiter),
  );
  assert.ok(!existsSync(join(first, "client")));
  assert.ok(!Object.hasOwn(environment, "CARGO_HOME"));
  mkdirSync(result.CARGO_HOME, { recursive: true });
  assert.equal(
    cargoEnvironment(first, environment).CARGO_HOME,
    result.CARGO_HOME,
  );
  assert.deepEqual(readdirSync(result.CARGO_HOME), []);
});

for (const component of [
  "client",
  "client/target",
  "client/target/cargo-home",
]) {
  test(`implicit Cargo home rejects a symlinked ${component} without foreign mutation`, (t) => {
    const directory = fixture(t);
    const worktree = join(directory, "worktree");
    const foreign = join(directory, "foreign");
    const link = join(worktree, component);
    mkdirSync(dirname(link), { recursive: true });
    mkdirSync(foreign);
    writeFileSync(join(foreign, "credentials.toml"), "synthetic credential");
    writeFileSync(join(foreign, "config.toml"), "synthetic config");
    symlinkSync(foreign, link);
    const environment = Object.freeze({ SITUATE_ISOLATE_CARGO: "1" });

    assert.throws(
      () => cargoEnvironment(worktree, environment),
      /Cannot isolate Cargo home: .* is a symbolic link/,
    );
    assert.deepEqual(readdirSync(foreign).sort(), [
      "config.toml",
      "credentials.toml",
    ]);
    assert.equal(
      readFileSync(join(foreign, "credentials.toml"), "utf8"),
      "synthetic credential",
    );
    assert.equal(
      readFileSync(join(foreign, "config.toml"), "utf8"),
      "synthetic config",
    );
    assert.equal(readlinkSync(link), foreign);
    assert.ok(!Object.hasOwn(environment, "CARGO_HOME"));

    for (const home of ["", foreign]) {
      const explicit = { ...environment, CARGO_HOME: home };
      assert.deepEqual(cargoEnvironment(worktree, explicit), explicit);
    }
  });
}

test("implicit Cargo home rejects dangling symlinks without creating their destination", (t) => {
  const directory = fixture(t);
  const foreign = join(directory, "missing");
  mkdirSync(join(directory, "client/target"), { recursive: true });
  symlinkSync(foreign, join(directory, "client/target/cargo-home"));
  assert.throws(
    () => cargoEnvironment(directory, { SITUATE_ISOLATE_CARGO: "1" }),
    /cargo-home is a symbolic link/,
  );
  assert.ok(!existsSync(foreign));
});

test("existing proxy lookup order is retained without duplicate PATH entries", (t) => {
  const directory = fixture(t);
  const proxy = join(directory, ".cargo/bin");
  const path = ["/custom/bin", proxy, "/tools/bin"].join(delimiter);
  assert.equal(
    cargoEnvironment(directory, {
      SITUATE_ISOLATE_CARGO: "1",
      HOME: directory,
      PATH: path,
    }).PATH,
    path,
  );
  assert.equal(
    cargoEnvironment(directory, {
      SITUATE_ISOLATE_CARGO: "1",
      HOME: directory,
    }).PATH,
    proxy,
  );
});
