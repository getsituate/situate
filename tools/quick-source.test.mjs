import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSources } from "./quick-source.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "quick-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function syntaxProcesses(t) {
  const children = [];
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.equal(args[0], "--check");
    assert.equal(options.killSignal, "SIGKILL");
    const child = new EventEmitter();
    child.path = args[1];
    child.closed = false;
    child.finish = (code = 0) => {
      child.closed = true;
      child.emit("close", code);
    };
    options.signal.addEventListener(
      "abort",
      () => {
        child.emit("error", new Error("Aborted"));
        setImmediate(() => child.finish(null));
      },
      { once: true },
    );
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return children;
}

function scripts(root, count) {
  return Array.from({ length: count }, (_, index) => {
    const file = `input-${index}.mjs`;
    writeFileSync(join(root, file), "export const value = 1;\n");
    return file;
  });
}

test("source checks detect conflict markers, invalid JSON and JavaScript syntax", async (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "valid.json"), '{"name":"fixture"}');
  writeFileSync(join(root, "invalid.json"), "{");
  writeFileSync(join(root, "input.mjs"), "export const = 1;");
  writeFileSync(
    join(root, "guide.md"),
    "<<<<<<< branch\nexample\n=======\nother\n>>>>>>> main\n",
  );
  assert.deepEqual(
    await checkSources(root, ["valid.json", "deleted.json"]),
    [],
  );
  assert.equal(
    (await checkSources(root, ["invalid.json", "input.mjs", "guide.md"]))
      .length,
    3,
  );
});

test("quick source checks reject expired budgets and external paths", async (t) => {
  const root = fixture(t);
  await assert.rejects(
    () => checkSources(root, ["file.js"], { deadline: 0 }),
    /budget/,
  );
  await assert.rejects(
    () => checkSources(root, ["../file.js"]),
    /worktree-local/,
  );
  symlinkSync(join(root, "../outside.js"), join(root, "link.js"));
  assert.deepEqual(await checkSources(root, ["link.js"]), []);
});

test("large source selections check every script and report syntax errors at the end", async (t) => {
  const root = fixture(t);
  const files = scripts(root, 163);
  writeFileSync(join(root, files.at(-1)), "export const = 1;\n");
  assert.deepEqual(await checkSources(root, files), [
    "input-162.mjs: JavaScript syntax check failed",
  ]);
});

test("syntax checks run at most four processes and retain mutation checks", async (t) => {
  const root = fixture(t);
  const files = scripts(root, 9);
  const children = syntaxProcesses(t);
  const checking = checkSources(root, files);
  assert.equal(children.length, 4);
  writeFileSync(join(root, files[0]), "export const changed = true;\n");
  let finished = 0;
  while (finished < files.length) {
    assert.ok(children.filter((child) => !child.closed).length <= 4);
    const batch = children.filter((child) => !child.closed);
    for (const child of batch) {
      child.finish();
      finished++;
    }
    await new Promise(setImmediate);
  }
  assert.deepEqual(await checking, [
    "input-0.mjs: changed during source checks",
  ]);
  assert.deepEqual(
    children.map((child) => child.path),
    files.map((file) => join(root, file)),
  );
});

test("source deadlines stop scheduling and await every aborted process", async (t) => {
  const root = fixture(t);
  const files = scripts(root, 9);
  const children = syntaxProcesses(t);
  await assert.rejects(
    checkSources(root, files, { deadline: performance.now() + 100 }),
    (error) => {
      assert.match(error.message, /budget/);
      assert.ok(error.cause instanceof Error);
      return true;
    },
  );
  assert.equal(children.length, 4);
  assert.ok(children.every((child) => child.closed));
});

test("cancellation stops scheduling and awaits every aborted process", async (t) => {
  const root = fixture(t);
  const files = scripts(root, 9);
  const children = syntaxProcesses(t);
  const controller = new AbortController();
  const checking = checkSources(root, files, { signal: controller.signal });
  controller.abort();
  await assert.rejects(checking);
  assert.equal(children.length, 4);
  assert.ok(children.every((child) => child.closed));
});

test("a source validation failure also closes in-flight syntax processes", async (t) => {
  const root = fixture(t);
  const files = scripts(root, 2);
  const children = syntaxProcesses(t);
  await assert.rejects(
    checkSources(root, [...files, "../outside.js"]),
    /worktree-local/,
  );
  assert.equal(children.length, 2);
  assert.ok(children.every((child) => child.closed));
});
