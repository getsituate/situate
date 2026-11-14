import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRecoveryReady, retentionDecision } from "./recovery.mjs";

const now = Date.parse("2026-11-13T12:00:00Z");
const daysAgo = (days) => new Date(now - days * 86400000).toISOString();

test("retention expires only resolved logs and explicitly unpublished candidates", () => {
  const record = { kind: "log", resolved: true, resolvedAt: daysAgo(7) };
  assert.equal(retentionDecision(record, { now }).remove, true);
  assert.equal(
    retentionDecision({ ...record, resolvedAt: daysAgo(6.99) }, { now }).remove,
    false,
  );
  const candidate = {
    ...record,
    kind: "candidate",
    published: false,
    githubReleaseComplete: false,
  };
  assert.equal(retentionDecision(candidate, { now }).remove, false);
  assert.equal(
    retentionDecision({ ...candidate, resolvedAt: daysAgo(30) }, { now })
      .remove,
    true,
  );
  for (const patch of [
    { resolved: false },
    { resolved: undefined },
    { published: true },
    { githubReleaseComplete: true },
    { kind: "reservation" },
    { kind: "identity" },
    { kind: "recovery" },
    { kind: "release" },
    { resolvedAt: "invalid" },
    { resolvedAt: daysAgo(-1) },
    { kind: "unknown" },
  ])
    assert.equal(
      retentionDecision({ ...record, ...patch }, { now }).remove,
      false,
    );
  assert.equal(
    retentionDecision(
      { kind: "candidate", resolved: true, resolvedAt: daysAgo(300) },
      { now },
    ).remove,
    false,
  );
});

test("historical recovery evidence validation rejects incomplete or mismatched destination records", () => {
  const evidence = {
    schemaVersion: 1,
    host: "release@example.invalid",
    backup: {
      encrypted: true,
      independent: true,
      destinationId: "offsite-store",
      restoreVerifiedAt: daysAgo(1),
    },
    signingRecoveryVerifiedAt: daysAgo(1),
    accessRecoveryVerifiedAt: daysAgo(1),
  };
  const options = { host: evidence.host, now };
  assert.equal(assertRecoveryReady(evidence, options), evidence);
  for (const value of [
    undefined,
    {},
    { ...evidence, host: "other.invalid" },
    { ...evidence, backup: { ...evidence.backup, independent: false } },
    { ...evidence, backup: { ...evidence.backup, encrypted: false } },
    { ...evidence, backup: { ...evidence.backup, destinationId: "" } },
    {
      ...evidence,
      backup: { ...evidence.backup, restoreVerifiedAt: "invalid" },
    },
    { ...evidence, signingRecoveryVerifiedAt: undefined },
    { ...evidence, accessRecoveryVerifiedAt: daysAgo(-1) },
  ])
    assert.throws(
      () => assertRecoveryReady(value, options),
      /independent encrypted backup/,
    );
});
