import assert from "node:assert/strict";
import test from "node:test";
import { aggregateReceipts } from "./pipeline-state.mjs";
import {
  buildSourceVerification,
  validateSourceVerification,
} from "./source-verification.mjs";
import { sourceVerificationFixture } from "./source-verification-fixtures.mjs";
import { qualificationFixture } from "./release-qualification-fixture.mjs";
import { verifySourceEvidence } from "./release-qualification.mjs";

test("mixed source verification records equivalence separately from executed tests", () => {
  const f = sourceVerificationFixture();
  const summary = buildSourceVerification(f.plan, f.receipts);
  assert.equal(summary.schemaVersion, 2);
  assert.deepEqual(summary.results, [
    {
      id: "policy",
      status: "passed",
      exitCode: 0,
      coverage: "executed",
      testedSHA: f.source,
    },
    {
      id: "macos-native",
      status: "passed",
      exitCode: 0,
      coverage: "reused",
      testedSHA: f.tested,
    },
  ]);
  assert.deepEqual(summary.reuse[0].reuse.evidence, f.evidence);
  assert.equal(summary.reuse[0].reuse.binding.originalReceipt.source, f.tested);
  assert.equal(summary.source, f.source);
  assert.deepEqual(
    validateSourceVerification(summary, { source: f.source }),
    summary,
  );
});

test("all executed receipts retain the original verification schema", () => {
  const f = sourceVerificationFixture();
  const summary = buildSourceVerification(f.plan, f.fresh);
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.plan, undefined);
  assert.equal(summary.reuse, undefined);
  assert.deepEqual(summary.results, [
    { id: "policy", status: "passed", exitCode: 0 },
    { id: "macos-native", status: "passed", exitCode: 0 },
  ]);
  validateSourceVerification(summary, { source: f.source });
});

test("aggregation rejects altered reuse and reused results disguised as fresh receipts", () => {
  const f = sourceVerificationFixture();
  for (const mutate of [
    (r) => {
      r.reuse.binding.testedSHA = f.source;
    },
    (r) => {
      r.results[0].coverage = "executed";
    },
    (r) => {
      delete r.reuse;
    },
    (r) => {
      delete r.kind;
    },
  ]) {
    const receipt = structuredClone(f.reused);
    mutate(receipt);
    assert.throws(() => aggregateReceipts(f.plan, [f.receipts[0], receipt]));
  }
  const summary = buildSourceVerification(f.plan, f.receipts);
  for (const mutate of [
    (s) => {
      s.results[1].testedSHA = f.source;
    },
    (s) => {
      s.results[1].coverage = "executed";
    },
    (s) => {
      s.reuse = [];
    },
    (s) => {
      s.reuse.push(s.reuse[0]);
    },
    (s) => {
      s.plan.source = f.tested;
    },
  ]) {
    const changed = structuredClone(summary);
    mutate(changed);
    assert.throws(
      () => validateSourceVerification(changed, { source: f.source }),
      /does not cover/,
    );
  }
});

test("package qualification verifies mixed source provenance against signed configuration", (t) => {
  const f = sourceVerificationFixture();
  const { manifest } = qualificationFixture(t);
  const summary = {
    ...buildSourceVerification(f.plan, f.receipts),
    releaseInputsSha256: manifest.releaseInputs.sha256,
  };
  manifest.sourceVerification = summary;
  manifest.artifacts[0].buildConfiguration.sourceVerification =
    structuredClone(summary);
  assert.equal(verifySourceEvidence(manifest), summary);
  manifest.sourceVerification.reuse[0].reuse.binding.testedSHA = f.source;
  assert.throws(() => verifySourceEvidence(manifest));
});
