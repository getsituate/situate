import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export function digest(value) {
  const canonical = (entry) =>
    Array.isArray(entry)
      ? entry.map(canonical)
      : entry !== null && typeof entry === "object"
        ? Object.fromEntries(
            Object.keys(entry)
              .sort()
              .map((key) => [key, canonical(entry[key])]),
          )
        : entry;
  return createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(canonical(value)),
    )
    .digest("hex");
}

export function atomicJson(file, value) {
  const directory = dirname(resolve(file));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert(
    !lstatSync(directory).isSymbolicLink(),
    "State directory must not be a symlink",
  );
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
  const parent = openSync(directory, "r");
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

export function sealPlan(plan) {
  const { authorizationDigest: _previous, ...inputs } = plan;
  return { ...inputs, authorizationDigest: digest(inputs) };
}

export function validatePlan(plan) {
  assert(plan?.schemaVersion === 1, "Unsupported workflow plan");
  assert(
    ["verify", "create", "publish"].includes(plan.workflow),
    "Unknown workflow",
  );
  assert.equal(
    plan.authorizationDigest,
    sealPlan(plan).authorizationDigest,
    "Workflow plan changed; plan and authorize it again",
  );
  if (plan.workflow !== "publish") {
    assert(
      /^[a-f0-9]{40}$/.test(plan.source ?? ""),
      "Plan requires an exact source commit",
    );
    assert(
      /^[a-f0-9]{40}$/.test(plan.base ?? ""),
      "Plan requires an exact base commit",
    );
  }
  assert(Array.isArray(plan.lanes), "Missing workflow lanes");
  const lanes = new Set();
  const suites = new Set();
  for (const lane of plan.lanes) {
    assert(
      typeof lane.id === "string" && !lanes.has(lane.id),
      "Duplicate or invalid lane",
    );
    lanes.add(lane.id);
    assert(["linux", "macos"].includes(lane.host), "Unknown lane host");
    assert(Array.isArray(lane.suites) && lane.suites.length > 0, "Empty lane");
    for (const suite of lane.suites) {
      assert(
        typeof suite === "string" && !suites.has(suite),
        "Duplicate or invalid selected suite",
      );
      suites.add(suite);
    }
  }
  return plan;
}

export function aggregateReceipts(plan, receipts) {
  validatePlan(plan);
  assert(Array.isArray(receipts), "Lane receipts are required");
  assert.equal(
    receipts.length,
    plan.lanes.length,
    "Missing or unexpected lane receipts",
  );
  const received = new Set();
  for (const receipt of receipts) {
    const lane = plan.lanes.find((entry) => entry.id === receipt.lane);
    assert(
      lane && !received.has(lane.id),
      "Unexpected or duplicate lane receipt",
    );
    received.add(lane.id);
    assert.equal(receipt.schemaVersion, 1, "Unsupported lane receipt");
    assert.equal(
      receipt.planDigest,
      plan.authorizationDigest,
      "Lane tested different workflow inputs",
    );
    assert.equal(
      receipt.source,
      plan.source,
      "Lane tested a different source commit",
    );
    assert.equal(receipt.host, lane.host, "Lane ran on the wrong host");
    assert.equal(receipt.status, "passed", `Lane ${lane.id} did not pass`);
    assert(Array.isArray(receipt.results), "Missing suite results");
    assert.deepEqual(
      receipt.results.map((result) => result.id).sort(),
      [...lane.suites].sort(),
      "Missing or unexpected suite results",
    );
    assert(
      receipt.results.every(
        (result) => result.status === "passed" && result.exitCode === 0,
      ),
      "A selected suite did not pass",
    );
  }
  return {
    schemaVersion: 1,
    status: "passed",
    source: plan.source,
    planDigest: plan.authorizationDigest,
    lanes: [...received].sort(),
  };
}

export function operationDirectory(root, operationId) {
  assert(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(operationId ?? ""),
    "An explicit operation ID is required",
  );
  const parent = join(root, ".release-operations");
  const directory = join(parent, operationId);
  for (const entry of [parent, directory]) {
    const stat = lstatSync(entry, { throwIfNoEntry: false });
    assert(
      !stat || (stat.isDirectory() && !stat.isSymbolicLink()),
      "Operation state must not traverse linked or non-directory storage",
    );
  }
  return directory;
}

export function readOperation(root, operationId) {
  const file = join(operationDirectory(root, operationId), "operation.json");
  const value = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    value.schemaVersion,
    1,
    "Unsupported operation journal; preserve it for inspection",
  );
  assert.equal(
    value.operationId,
    operationId,
    "Operation journal identity differs",
  );
  validatePlan(value.plan);
  assert(Array.isArray(value.stages), "Malformed operation journal");
  return value;
}

export function openOperation(root, plan) {
  validatePlan(plan);
  const directory = operationDirectory(root, plan.operation);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "operation.json");
  if (existsSync(file)) {
    const current = readOperation(root, plan.operation);
    assert.equal(
      current.plan.authorizationDigest,
      plan.authorizationDigest,
      "Operation ID belongs to different workflow inputs",
    );
    throw new Error(
      "Operation already exists; inspect it before explicit reconciliation",
    );
  }
  const operation = {
    schemaVersion: 1,
    operationId: plan.operation,
    plan,
    status: "running",
    stages: [],
  };
  atomicJson(file, operation);
  return operation;
}

export async function withOperationLock(root, operationId, action) {
  const directory = operationDirectory(root, operationId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "execution.lock");
  let fd;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      "Operation is owned or was interrupted; inspect the recorded executor before removing its lock",
      { cause: error },
    );
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, operationId }));
    fsyncSync(fd);
    return await action();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

export function saveOperation(root, operation) {
  atomicJson(
    join(operationDirectory(root, operation.operationId), "operation.json"),
    operation,
  );
}

export function requireReconciliation(operation, observation, confirmation) {
  assert.equal(
    observation?.planDigest,
    operation.plan.authorizationDigest,
    "Inspection belongs to different workflow inputs",
  );
  assert.equal(
    observation?.operationId,
    operation.operationId,
    "Inspection belongs to another operation",
  );
  assert.equal(
    confirmation,
    digest(observation),
    "Confirm the exact inspection before reconciliation",
  );
  assert.equal(
    observation.stateDigest,
    digest(operation),
    "Operation changed after inspection",
  );
}
