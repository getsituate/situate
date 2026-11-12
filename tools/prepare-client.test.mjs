import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { prepareClientDependencies } from "./prepare-client.mjs";
import { dependencyLockPath } from "./test.mjs";

const clientEntries = JSON.parse(
  readFileSync(new URL("./dev-tui/client-dependencies.json", import.meta.url)),
);
const testEntries = [
  "vitest/vitest.mjs",
  "vue-tsc/bin/vue-tsc.js",
  "vite/bin/vite.js",
  "@playwright/test/cli.js",
  "playwright/package.json",
  "typescript/package.json",
];
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-client-setup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "client"));
  writeFileSync(join(directory, "client/package-lock.json"), "{}");
  const put = (entries) => {
    for (const entry of entries) {
      const path = join(directory, "client/node_modules", entry);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "fixture");
    }
  };
  return {
    directory,
    put,
    output: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  };
}

test("fresh client preparation installs locked development dependencies and releases the lock", async (t) => {
  const { directory, put, output } = fixture(t);
  let calls = 0;
  await prepareClientDependencies({
    directory,
    output,
    install: async (suite) => {
      calls++;
      assert.equal(suite.cwd, "client");
      assert.deepEqual(suite.args, [
        "ci",
        "--include=dev",
        "--no-audit",
        "--no-fund",
      ]);
      assert.ok(existsSync(dependencyLockPath(directory, "client")));
      put([...testEntries, ...clientEntries]);
      return { status: "passed", exitCode: 0 };
    },
  });
  assert.equal(calls, 1);
  assert.ok(!existsSync(dependencyLockPath(directory, "client")));
  await prepareClientDependencies({
    directory,
    output,
    install: () => assert.fail("must reuse ready dependencies"),
  });
});

test("explicit reinstallation runs even when local dependencies are ready", async (t) => {
  const { directory, put, output } = fixture(t);
  put([...testEntries, ...clientEntries]);
  let calls = 0;
  await prepareClientDependencies({
    directory,
    output,
    force: true,
    install: async () => {
      calls++;
      put([...testEntries, ...clientEntries]);
      return { status: "passed", exitCode: 0 };
    },
  });
  assert.equal(calls, 1);
});

for (const dangling of [false, true]) {
  test(`shared node_modules links are rejected before installation (${dangling ? "dangling" : "existing"})`, async (t) => {
    const { directory, output } = fixture(t);
    const foreign = join(directory, "other-checkout");
    if (!dangling) {
      mkdirSync(foreign);
      writeFileSync(join(foreign, "sentinel"), "keep");
    }
    symlinkSync(foreign, join(directory, "client/node_modules"), "dir");
    await assert.rejects(
      prepareClientDependencies({
        directory,
        output,
        install: () => assert.fail("must not install through a shared link"),
      }),
      /worktree-local directory/,
    );
    if (!dangling)
      assert.equal(readFileSync(join(foreign, "sentinel"), "utf8"), "keep");
    assert.equal(existsSync(dependencyLockPath(directory, "client")), false);
  });
}

for (const missing of [
  ".bin/tauri",
  "markstream-vue/dist/index.js",
  "markstream-vue/dist/index.css",
]) {
  test(`missing client entrypoint ${missing} is repaired even if all test dependencies exist`, async (t) => {
    const { directory, put, output } = fixture(t);
    put([
      ...testEntries,
      ...clientEntries.filter((entry) => entry !== missing),
    ]);
    let calls = 0;
    await prepareClientDependencies({
      directory,
      output,
      install: async () => {
        calls++;
        put(clientEntries);
        return { status: "passed", exitCode: 0 };
      },
    });
    assert.equal(calls, 1);
  });
}

for (const status of ["failed", "cancelled"]) {
  test(`${status} installation releases its lock and cannot become success`, async (t) => {
    const { directory, output } = fixture(t);
    await assert.rejects(
      prepareClientDependencies({
        directory,
        output,
        install: async () => ({ status, exitCode: 1 }),
      }),
      new RegExp(status),
    );
    assert.ok(!existsSync(dependencyLockPath(directory, "client")));
  });
}

test("a nominally successful but incomplete installation fails", async (t) => {
  const { directory, put, output } = fixture(t);
  await assert.rejects(
    prepareClientDependencies({
      directory,
      output,
      install: async () => {
        put([...testEntries, ".package-lock.json"]);
        return { status: "passed", exitCode: 0 };
      },
    }),
    /incomplete/,
  );
  assert.ok(!existsSync(dependencyLockPath(directory, "client")));
});

test("cancelled setup never removes another runner's dependency lock", async (t) => {
  const { directory, output } = fixture(t);
  const lock = dependencyLockPath(directory, "client");
  mkdirSync(lock);
  t.after(() => rmSync(lock, { recursive: true, force: true }));
  const controller = new AbortController();
  const pending = prepareClientDependencies({
    directory,
    output,
    signal: controller.signal,
    install: () => assert.fail("must wait for the lock"),
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(existsSync(lock));
});
