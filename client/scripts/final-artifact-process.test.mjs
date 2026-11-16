import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, watch, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createQualificationProcess,
  qualificationCommandTimeouts,
} from "./final-artifact-process.mjs";
import { run } from "./ios-xcode.mjs";

test("fixed native policy reports categories, not arguments or stderr", async () => {
  const events = [];
  const budgets = [];
  const original = new Error("private stderr with account paths and UI text");
  const execute = createQualificationProcess({
    progress: (...event) => events.push(event),
    getPhase: () => "install",
    deadline: (ms) => {
      budgets.push(ms);
      return new AbortController().signal;
    },
    execute: async (_command, _args, options) => {
      assert.equal(options.capture, true);
      throw original;
    },
  });
  await assert.rejects(execute("osascript", ["private UI text"]), (error) => {
    assert.equal(error.cause, original);
    assert.equal(
      error.message,
      "Qualification native command accessibility: nonzero",
    );
    return true;
  });
  assert.deepEqual(budgets, [30_000]);
  assert.equal(events[1][2], "accessibility");
  assert.doesNotMatch(JSON.stringify(events), /private|account|stderr/);
  await assert.rejects(
    execute("unknown-secret-command", []),
    /Unsupported qualification native command/,
  );
  assert.equal(qualificationCommandTimeouts.route, 10_000);
  assert.equal(qualificationCommandTimeouts.mount, 120_000);
  assert.equal(qualificationCommandTimeouts.detach, 30_000);
});

test("timeouts drain a synthetic owned process before reporting its command", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-bounded-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pidFile = join(root, "pid");
  const events = [];
  const execute = createQualificationProcess({
    deadline: () => AbortSignal.timeout(500),
    getPhase: () => "install",
    progress: (...event) => events.push(event),
    execute: (_command, _args, options) =>
      run(
        process.execPath,
        [
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); console.error('private-native-error'); setInterval(()=>{},1000)`,
        ],
        options,
      ),
  });
  await assert.rejects(
    execute("hdiutil", ["attach", "private-path"]),
    (error) => {
      assert.equal(error.qualificationStatus, "timeout");
      assert.equal(error.qualificationCommand, "mount");
      assert.equal(error.uncertain, true);
      assert.doesNotMatch(error.message, /private/);
      return true;
    },
  );
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(events.at(-1)[1], "timeout");
});

test("cancellation drains a synthetic owned native call", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-cancel-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pidFile = join(root, "pid");
  const abort = new AbortController();
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const observer = watch(root, () => {
    if (existsSync(pidFile)) ready();
  });
  const deadline = setTimeout(() => {
    abort.abort();
    ready();
  }, 5000);
  t.after(() => {
    observer.close();
    clearTimeout(deadline);
  });
  const execute = createQualificationProcess({
    execute: (_command, _args, options) =>
      run(
        process.execPath,
        [
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(()=>{},1000)`,
        ],
        options,
      ),
  });
  const pending = assert.rejects(
    execute("osascript", ["private text"], { signal: abort.signal }),
    /accessibility: cancelled/,
  );
  await started;
  abort.abort(new Error("private cancellation"));
  await pending;
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("cleanup commands retain independent deadlines after global cancellation", async () => {
  const abort = new AbortController();
  abort.abort(new Error("private cancellation"));
  const statuses = [];
  let calls = 0;
  const execute = createQualificationProcess({
    progress: (_phase, status) => statuses.push(status),
    getPhase: () => "cleanup",
    execute: async (_command, _args, { signal }) => {
      calls++;
      signal.throwIfAborted();
      return "";
    },
  });
  await assert.rejects(
    execute("osascript", [], { signal: abort.signal }),
    /accessibility: cancelled/,
  );
  await execute("hdiutil", ["detach", "private-path"], { signal: undefined });
  assert.equal(calls, 2);
  assert.deepEqual(statuses, ["started", "cancelled", "started", "completed"]);
});
