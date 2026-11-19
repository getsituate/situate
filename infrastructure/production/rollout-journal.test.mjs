import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  beginRollout,
  pendingRollout,
  readRollout,
} from "./rollout-journal.mjs";

const state = (serial) => ({
  workspaceId: "ws-Test",
  stateVersion: { id: `sv-${serial}`, serial },
});
const proposal = {
  sourceRevision: "a".repeat(40),
  previous: "current",
  candidate: "next",
  previousId: "10",
  volumeId: "20",
  imageId: "30",
};
const sha256 = "b".repeat(64);

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-rollout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const operation = beginRollout(root, state(1), proposal);
  return {
    root,
    evidence: { operationId: operation.id, candidateId: "11" },
    operation,
  };
}

function apply(root, phase, serial, evidence) {
  const action = readRollout(root, state(serial), phase, evidence);
  action.beginApply(sha256);
  action.complete(state(serial + 1));
}

test("a failed stage leaves a pending record; no second run or detach can proceed", (t) => {
  const { root, evidence } = setup(t);
  const action = readRollout(root, state(1), "stage");
  action.beginApply(sha256);
  assert.throws(() => beginRollout(root, state(1), proposal), /EEXIST/);
  assert.throws(
    () => readRollout(root, state(1), "detach", evidence),
    /out of order/,
  );
  assert.throws(
    () => readRollout(root, state(1), "stage").beginApply(sha256),
    /EEXIST/,
  );
  assert.throws(() => readRollout(root, state(2), "stage"), /Reconcile/);
  assert.equal(
    JSON.parse(readFileSync(join(root, "active/stage.pending.json"), "utf8"))
      .planSha256,
    sha256,
  );
});

test("a confirmed lost response can be acknowledged only at the next state version", (t) => {
  const { root } = setup(t);
  readRollout(root, state(1), "stage").beginApply(sha256);
  assert.throws(
    () => pendingRollout(root, state(1), "stage"),
    /single state version/,
  );
  assert.throws(
    () => pendingRollout(root, state(3), "stage"),
    /single state version/,
  );
  const pending = pendingRollout(root, state(2), "stage");
  const recovery = readRollout(root, pending.before, "stage");
  assert.throws(
    () => recovery.acknowledge("c".repeat(64), state(2)),
    /pending plan/,
  );
  recovery.acknowledge(sha256, state(2));
  assert.throws(() => readRollout(root, state(2), "stage"), /out of order/);
});

test("a host cannot lose delete protection until the recorded replacement passed public checks", (t) => {
  const { root, evidence, operation } = setup(t);
  apply(root, "stage", 1);
  assert.throws(
    () =>
      readRollout(root, state(2), "detach", {
        ...evidence,
        publishersSettled: true,
        oldHostFenced: true,
      }),
    /matching rollout observations/,
  );
  apply(root, "detach", 2, {
    ...evidence,
    replacementReady: true,
    publishersSettled: true,
    oldHostFenced: true,
  });
  assert.throws(
    () =>
      readRollout(root, state(3), "attach", {
        ...evidence,
        candidateId: "12",
        volumeDetached: true,
      }),
    /matching rollout observations/,
  );
  apply(root, "attach", 3, { ...evidence, volumeDetached: true });
  apply(root, "traffic", 4, {
    ...evidence,
    volumeVerified: true,
    candidateHttpsVerified: true,
  });
  assert.throws(
    () => readRollout(root, state(5), "retire", evidence),
    /out of order/,
  );
  assert.throws(
    () =>
      readRollout(root, state(5), "unprotect", {
        ...evidence,
        publisherTargetVerified: true,
      }),
    /matching rollout observations/,
  );
  const acceptance = {
    ...evidence,
    publicEndpointsVerified: true,
    publisherTargetVerified: true,
  };
  apply(root, "unprotect", 5, acceptance);
  apply(root, "retire", 6, acceptance);
  assert.equal(
    JSON.parse(
      readFileSync(join(root, operation.id, "operation.json"), "utf8"),
    ).completed.at(-1),
    "retire",
  );
  assert.doesNotThrow(() =>
    beginRollout(root, state(7), {
      ...proposal,
      previous: "next",
      previousId: "11",
      candidate: "later",
    }),
  );
});
