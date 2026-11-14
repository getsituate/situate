import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  aggregateReceipts,
  digest,
  openOperation,
  readOperation,
  requireReconciliation,
  sealPlan,
  validatePlan,
  withOperationLock,
} from "./pipeline-state.mjs";

const plan = () =>
  sealPlan({
    schemaVersion: 1,
    workflow: "create",
    source: "a".repeat(40),
    base: "b".repeat(40),
    operation: "candidate-1",
    appImpact: true,
    lanes: [
      { id: "policy", host: "linux", suites: ["root-secrets", "root-format"] },
    ],
  });
const receipt = (input) => ({
  schemaVersion: 1,
  planDigest: input.authorizationDigest,
  source: input.source,
  lane: "policy",
  host: "linux",
  status: "passed",
  results: [
    { id: "root-secrets", status: "passed", exitCode: 0 },
    { id: "root-format", status: "passed", exitCode: 0 },
  ],
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("authorization binds values independently of object key order", () => {
  assert.equal(
    digest({ source: "a", suites: ["b", "c"] }),
    digest({ suites: ["b", "c"], source: "a" }),
  );
  const input = plan();
  assert.equal(validatePlan(input), input);
  assert.throws(
    () => validatePlan({ ...input, source: "c".repeat(40) }),
    /changed/,
  );
});

test("aggregation requires every selected suite and exact host/input binding", () => {
  const input = plan();
  assert.equal(aggregateReceipts(input, [receipt(input)]).status, "passed");
  assert.throws(() => aggregateReceipts(input, []), /Missing/);
  for (const patch of [
    { status: "cancelled" },
    { host: "macos" },
    { source: "d".repeat(40) },
    { planDigest: "e".repeat(64) },
    { results: [{ id: "root-secrets", status: "passed", exitCode: 0 }] },
    {
      results: [
        { id: "root-secrets", status: "passed", exitCode: 0 },
        { id: "root-format", status: "not-run", exitCode: null },
      ],
    },
  ])
    assert.throws(() =>
      aggregateReceipts(input, [{ ...receipt(input), ...patch }]),
    );
  assert.throws(
    () => aggregateReceipts(input, [receipt(input), receipt(input)]),
    /unexpected/,
  );
});

test("empty deliberate selection differs from an incomplete selected lane", () => {
  const input = sealPlan({ ...plan(), lanes: [] });
  assert.equal(aggregateReceipts(input, []).status, "passed");
  assert.throws(
    () =>
      validatePlan(
        sealPlan({
          ...input,
          lanes: [{ id: "policy", host: "linux", suites: [] }],
        }),
      ),
    /Empty lane/,
  );
  assert.throws(
    () =>
      validatePlan(
        sealPlan({
          ...input,
          lanes: [
            { id: "a", host: "linux", suites: ["same"] },
            { id: "b", host: "macos", suites: ["same"] },
          ],
        }),
      ),
    /Duplicate/,
  );
});

test("operations survive reopening and cannot restart blindly", (t) => {
  const root = fixture(t);
  const input = plan();
  const operation = openOperation(root, input);
  assert.deepEqual(readOperation(root, input.operation), operation);
  assert.throws(() => openOperation(root, input), /inspect/);
  assert.throws(
    () =>
      openOperation(root, sealPlan({ ...input, destination: "other.example" })),
    /different workflow/,
  );
});

test("reconciliation binds the exact observation and current state", (t) => {
  const operation = openOperation(fixture(t), plan());
  const observation = {
    operationId: operation.operationId,
    planDigest: operation.plan.authorizationDigest,
    stateDigest: digest(operation),
    remote: { state: "unknown" },
  };
  requireReconciliation(operation, observation, digest(observation));
  assert.throws(
    () => requireReconciliation(operation, observation, "yes"),
    /Confirm/,
  );
  assert.throws(
    () =>
      requireReconciliation(
        { ...operation, status: "completed" },
        observation,
        digest(observation),
      ),
    /changed after/,
  );
});

test("operation storage refuses linked ancestors without changing their targets", (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  symlinkSync(outside, join(root, ".release-operations"));
  assert.throws(() => openOperation(root, plan()), /linked or non-directory/);
  assert.deepEqual(readdirSync(outside), []);
});

test("concurrent executors cannot own the same operation", async (t) => {
  const root = fixture(t);
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = withOperationLock(root, "candidate-1", async () => {
    entered();
    await blocked;
  });
  await started;
  await assert.rejects(
    withOperationLock(root, "candidate-1", () =>
      assert.fail("second executor ran"),
    ),
    /owned or was interrupted/,
  );
  release();
  await first;
  await withOperationLock(root, "candidate-1", () => {});
});
