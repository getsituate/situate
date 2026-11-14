import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { monitor, monitoringCommands } from "./dependency-monitoring.mjs";

test("monitoring covers npm locks and supported Darwin Rust graphs without fixing dependencies", () => {
  const commands = monitoringCommands();
  assert.deepEqual(
    commands.map(({ id }) => id),
    [
      "npm-root",
      "npm-client",
      "npm-requirements",
      "cargo-client",
      "cargo-dev-tui",
    ],
  );
  for (const command of commands) {
    assert.ok(
      command.args.includes(command.command === "npm" ? "audit" : "advisories"),
    );
    assert.ok(!command.args.some((arg) => /fix|update|install/.test(arg)));
    assert.ok(!command.args.some((arg) => /ios|windows|linux/.test(arg)));
    if (command.command === "cargo-deny") {
      assert.ok(command.args.includes("aarch64-apple-darwin"));
      assert.ok(command.args.includes("x86_64-apple-darwin"));
    }
  }
});

test("all findings and unavailable services remain observable without suppressing remaining scans", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-monitor-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const report = monitor({
    directory,
    reportDirectory: directory,
    execute(command, args, options) {
      calls.push({ command, args, options });
      if (calls.length === 1)
        return {
          status: 1,
          stdout: '{"advisories":["synthetic"]}',
          stderr: "",
        };
      if (calls.length === 2)
        return {
          status: null,
          error: { code: "ETIMEDOUT" },
          stderr: "Service unavailable",
        };
      return { status: 0, stdout: "No findings" };
    },
  });
  assert.equal(report.status, "failed");
  assert.equal(calls.length, 5);
  assert.deepEqual(
    report.results.map(({ status }) => status),
    ["failed", "failed", "passed", "passed", "passed"],
  );
  assert.equal(report.results[1].error, "ETIMEDOUT");
  assert.match(
    readFileSync(join(directory, "npm-root.txt"), "utf8"),
    /synthetic/,
  );
  assert.match(
    readFileSync(join(directory, "npm-client.txt"), "utf8"),
    /Service unavailable/,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, "report.json"), "utf8")),
    report,
  );
});

test("a complete clean monitoring run passes", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-monitor-clean-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(
    monitor({
      directory,
      reportDirectory: directory,
      execute: () => ({ status: 0 }),
    }).status,
    "passed",
  );
});
