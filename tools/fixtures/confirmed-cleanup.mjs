import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mock } from "node:test";

const child = new EventEmitter();
Object.assign(child, {
  pid: 4242,
  stdout: new PassThrough(),
  stderr: new PassThrough(),
  exitCode: null,
  signalCode: null,
  kill(signal) {
    assert.equal(signal, "SIGTERM");
    return true;
  },
});
let present = true;
let snapshots = 0;
mock.module("node:child_process", {
  namedExports: {
    spawn: () => child,
    spawnSync: () => assert.fail("Unexpected subprocess"),
    execFileSync(command) {
      assert.equal(command, "ps");
      snapshots++;
      return present ? "4242 1 S Thu Nov 12 12:00:00 2026\n" : "";
    },
  },
});
mock.method(process, "kill", (pid, signal) => {
  assert.equal(pid, child.pid);
  assert.equal(signal, "SIGTERM");
});
mock.timers.enable({ apis: ["setTimeout"] });
try {
  const { executeSuite } = await import("../test.mjs");
  const controller = new AbortController();
  const pending = executeSuite(
    {
      id: "quick-source",
      kind: "check",
      cwd: ".",
      command: "fixture",
      args: [],
    },
    {
      signal: controller.signal,
      terminationGraceMs: 100,
      buildLease: false,
      detached: false,
    },
  );
  child.emit("spawn");
  controller.abort();
  present = false;
  child.signalCode = "SIGTERM";
  child.emit("exit", null, "SIGTERM");
  child.emit("close", null, "SIGTERM");
  child.stdout.end();
  child.stderr.end();
  mock.timers.tick(100);
  const report = await pending;
  assert.equal(report.status, "cancelled");
  assert.equal(report.cleanupIncomplete, undefined);
  assert.equal(snapshots, 3);
} finally {
  mock.timers.reset();
  mock.restoreAll();
}
