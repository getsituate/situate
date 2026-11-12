import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  QUICK_BUDGET_MS,
  QUICK_EXECUTION_MS,
  BUILD_SLOTS,
  workerBudget,
  needsBuildLease,
} from "./test-budget.mjs";
import { createPlan, isQuickSuite, runPlan, root } from "./test.mjs";

test("quick checks have a fixed total deadline and a dependency-free allowlist", () => {
  assert.equal(QUICK_BUDGET_MS, 5000);
  assert.ok(QUICK_EXECUTION_MS < QUICK_BUDGET_MS);
  const plan = createPlan({ quick: true });
  assert.deepEqual(
    plan.suites.map(({ id }) => id),
    ["runner-fast", "quick-source"],
  );
  assert.ok(plan.suites.every((suite) => isQuickSuite(suite) && !suite.npm));
  for (const platform of ["darwin", "linux"]) {
    const feedback = createPlan({ feedback: true, platform });
    for (const suite of feedback.suites)
      assert.equal(isQuickSuite(suite), false);
    assert.equal(
      feedback.suites.some(({ id }) => id === "client-core"),
      platform === "darwin",
    );
  }
});

test("the quick CLI stays within budget while the worktree queue is occupied", () => {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    ["tools/test.mjs", "--quick", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: QUICK_BUDGET_MS,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.budgetMs, QUICK_BUDGET_MS);
  assert.ok(performance.now() - started < QUICK_BUDGET_MS);
});

test("longer suites cannot enter quick checks through the unit category", async () => {
  await assert.rejects(
    runPlan({
      profile: "quick",
      suites: [{ id: "client-core", kind: "unit" }],
    }),
    /explicitly registered/,
  );
});

test("worker allocations leave capacity for other worktrees", () => {
  assert.equal(BUILD_SLOTS, 2);
  assert.match(
    readFileSync(new URL("./worktree-supervisor.py", import.meta.url), "utf8"),
    new RegExp(`^BUILD_SLOTS = ${BUILD_SLOTS}$`, "m"),
  );
  assert.deepEqual([1, 2, 8, 18, 64].map(workerBudget), [1, 1, 2, 4, 4]);
  assert.equal(needsBuildLease({ command: "cargo" }), true);
  assert.equal(needsBuildLease({ kind: "browser" }), true);
  assert.equal(needsBuildLease({ kind: "native" }), false);
  assert.equal(needsBuildLease({ id: "client-types" }), true);
  assert.equal(
    needsBuildLease({ id: "client-executor-integration", kind: "integration" }),
    true,
  );
  assert.equal(
    needsBuildLease({ id: "client-scripts-integration", kind: "integration" }),
    true,
  );
  assert.equal(needsBuildLease({ id: "quick-source" }), false);
});

test("deadline cleanup reuses confirmed process absence after escalation", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "tools/fixtures/confirmed-cleanup.mjs",
    ],
    { cwd: root, encoding: "utf8", timeout: QUICK_BUDGET_MS },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("quick execution deadlines terminate a slow command without reporting a pass", async () => {
  const started = performance.now();
  const report = await runPlan(
    {
      profile: "quick",
      suites: [
        {
          id: "quick-source",
          kind: "check",
          cwd: ".",
          command: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
        },
      ],
    },
    { output: { write() {}, on() {}, once() {}, emit() {} } },
  );
  assert.equal(report.status, "failed");
  assert.equal(report.results[0].status, "cancelled");
  assert.equal(report.results[0].cleanupIncomplete, undefined);
  assert.match(report.error, /feedback/);
  assert.ok(
    performance.now() - started < QUICK_BUDGET_MS,
    "deadline cleanup exceeded the total quick budget",
  );
});
