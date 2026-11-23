import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
  renameSync,
  symlinkSync,
  linkSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createQualificationProgressFile,
  qualificationProgressWriter,
  observeQualificationProgress,
  validateQualificationProgress,
  qualificationPhase,
  qualificationProgressReporter,
} from "./qualification-progress.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-qualification-progress-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "progress.jsonl");
  createQualificationProgressFile(path);
  return path;
}

test("progress failures do not skip cleanup or replace its primary failure", async () => {
  const reporting = new Error("Synthetic reporting failure");
  const primary = new Error("Synthetic native failure");
  let cleanup = 0;
  await assert.rejects(
    qualificationPhase(
      () => {
        throw reporting;
      },
      "cleanup",
      async () => {
        cleanup++;
        throw primary;
      },
    ),
    (error) => error.cause === primary && error.errors.includes(reporting),
  );
  assert.equal(cleanup, 1);
  const reporter = qualificationProgressReporter(() => {
    throw reporting;
  });
  reporter.emit("cleanup", "started");
  reporter.emit("cleanup", "completed");
  assert.throws(
    () => reporter.check(primary),
    (error) => error.cause === primary && error.errors.length === 2,
  );
});

test("private live progress distinguishes waiting, acquisition, native timeout and cleanup", async (t) => {
  const path = fixture(t);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => createQualificationProgressFile(path));
  const emit = qualificationProgressWriter(path);
  const lines = [];
  let observed;
  const live = new Promise((resolve) => {
    observed = resolve;
  });
  const observer = observeQualificationProgress(path, {
    intervalMs: 1,
    output: {
      write(line) {
        lines.push(line);
        observed();
      },
    },
  });
  const keepAlive = setTimeout(() => observed(), 1000);
  t.after(() => clearTimeout(keepAlive));
  emit("desktop", "queued");
  await live;
  assert.match(lines[0], /queued/);
  assert.doesNotMatch(lines.join(""), /acquired/);
  emit("desktop", "acquired");
  emit("install", "started");
  emit("install", "timeout", "mount", 120_000);
  emit("install", "failed");
  emit("cleanup", "started");
  emit("cleanup", "completed");
  emit("desktop", "released");
  const summary = observer.summary("cancelled");
  assert.equal(summary.failure.command, "mount");
  assert.equal(summary.failure.status, "timeout");
  assert.equal(summary.phase.phase, "cleanup");
  assert.equal(summary.last.status, "released");
  observer.close();
});

test("launch observations are restricted and cannot replace a native timeout", (t) => {
  const path = fixture(t);
  const emit = qualificationProgressWriter(path);
  const observer = observeQualificationProgress(path, {
    output: { write() {} },
  });
  for (const status of [
    "exited_zero",
    "exited_nonzero",
    "dialog_observed",
    "associated_dialog_observed",
    "dialog_not_observed",
    "query_unavailable",
    "query_process_unavailable",
    "query_window_collection_unavailable",
    "query_window_attributes_unavailable",
    "query_element_collection_unavailable",
    "query_element_attributes_unavailable",
    "query_limit_unavailable",
    "query_serialization_unavailable",
    "query_execution_unavailable",
    "observation_unavailable",
  ]) {
    emit("install", status, "launch", 1);
    assert.throws(() => emit("install", status, "process", 1));
  }
  emit("install", "timeout", "launch", 10000);
  assert.equal(observer.summary("failed").failure.status, "timeout");
  observer.close();
});

test("updater codes are accepted only for the update phase and never include raw data", (t) => {
  const emit = qualificationProgressWriter(fixture(t));
  emit("update", "bundle_predecessor", "updater");
  emit("update", "prepare_window:files_pending", "updater");
  assert.throws(() =>
    emit("update", "prepare_window:/private/path", "updater"),
  );
  assert.throws(() =>
    emit("install", "prepare_window:files_pending", "updater"),
  );
  assert.throws(() =>
    emit("update", "prepare_window:files_pending", "process"),
  );
});

test("upgrade step failures replace earlier transient polling errors without exposing private data", (t) => {
  const path = fixture(t);
  const emit = qualificationProgressWriter(path);
  const lines = [];
  const observer = observeQualificationProgress(path, {
    output: { write: (line) => lines.push(line) },
  });
  emit("journeys", "nonzero", "accessibility");
  emit("update", "find_cancel:started", "upgrade_step");
  emit("update", "ax_target_ambiguous", "accessibility");
  emit("update", "find_cancel:failed", "upgrade_step");
  emit("update", "prepare_window:files_pending", "updater");
  emit("cleanup", "completed");
  assert.throws(() =>
    emit("update", "private document:failed", "upgrade_step"),
  );
  assert.throws(() => emit("journeys", "find_cancel:failed", "upgrade_step"));
  assert.throws(() => emit("update", "ax_target_ambiguous", "launch"));
  const { failure } = observer.summary("failed");
  assert.equal(failure.command, "upgrade_step");
  assert.equal(failure.status, "find_cancel:failed");
  assert.match(lines.join(""), /prepare_window:files_pending/);
  assert.match(lines.join(""), /ax_target_ambiguous/);
  assert.doesNotMatch(lines.join(""), /private document/);
  observer.close();
});

test("unknown fields, codes, linked files, permissions and excessive records fail closed without echoing input", (t) => {
  const path = fixture(t);
  const emit = qualificationProgressWriter(path);
  assert.throws(() => emit("secret-account-path", "started"));
  assert.throws(() =>
    validateQualificationProgress({
      phase: "install",
      command: "none",
      status: "completed",
      elapsedMs: 1,
      stderr: "private",
    }),
  );
  assert.throws(() => emit("desktop", "completed"));
  chmodSync(path, 0o644);
  assert.throws(() => emit("install", "started"), /Unsafe qualification/);
  chmodSync(path, 0o600);
  const bounded = qualificationProgressWriter(path);
  for (let index = 0; index < 4096; index++) bounded("install", "started");
  assert.throws(() => bounded("install", "started"), /event limit/);
  const link = `${path}.link`;
  renameSync(path, link);
  symlinkSync(link, path);
  assert.throws(() => emit("install", "started"), { code: "ELOOP" });
  rmSync(path);
  renameSync(link, path);
  linkSync(path, `${path}.hard`);
  assert.throws(() => emit("install", "started"));
});

test("the worker only writes progress in its private progress directory", (t) => {
  const root = mkdtempSync(join(tmpdir(), "unrelated-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const otherFile = join(root, "progress.jsonl");
  writeFileSync(otherFile, "independent test data", { mode: 0o600 });
  assert.throws(
    () => qualificationProgressWriter(otherFile),
    /Invalid qualification progress path/,
  );
  assert.equal(readFileSync(otherFile, "utf8"), "independent test data");

  const path = fixture(t);
  chmodSync(dirname(path), 0o755);
  assert.throws(
    () => qualificationProgressWriter(path),
    /Unsafe qualification progress directory/,
  );
  assert.equal(statSync(path).size, 0);
});

test("malformed or truncated progress never becomes a valid completion", (t) => {
  const path = fixture(t);
  const lines = [];
  const observer = observeQualificationProgress(path, {
    output: { write: (line) => lines.push(line) },
  });
  writeFileSync(path, '{"secret":"private-error"}\n');
  observer.poll();
  assert.throws(() => observer.close(), /Invalid qualification/);
  assert.doesNotMatch(lines.join(""), /private-error/);
  const partial = fixture(t);
  const other = observeQualificationProgress(partial, {
    output: { write() {} },
  });
  writeFileSync(partial, "{");
  assert.throws(() => other.close(), /Invalid qualification/);
});

test("cancellation cannot finish a qualification phase but cleanup remains observable", async () => {
  const abort = new AbortController();
  const reason = new Error("private cancellation");
  const events = [];
  const progress = (...event) => events.push(event);
  await assert.rejects(
    qualificationPhase(
      progress,
      "journeys",
      async () => {
        abort.abort(reason);
        return "not a receipt";
      },
      abort.signal,
    ),
    (error) => error === reason,
  );
  await qualificationPhase(progress, "cleanup", async () => {});
  assert.deepEqual(events, [
    ["journeys", "started"],
    ["journeys", "cancelled"],
    ["cleanup", "started"],
    ["cleanup", "completed"],
  ]);
});

test("progress file has a fixed byte budget", (t) => {
  const path = fixture(t);
  writeFileSync(path, Buffer.alloc(1024 * 1024));
  assert.throws(
    () => qualificationProgressWriter(path)("install", "started"),
    /byte limit/,
  );
  assert.equal(readFileSync(path).length, 1024 * 1024);
});
