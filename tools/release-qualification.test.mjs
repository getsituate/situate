import assert from "node:assert/strict";
import { writeFileSync, readFileSync, symlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { qualificationFixture } from "./release-qualification-fixture.mjs";
import {
  verifyQualificationReceipt,
  qualifyRelease,
  writeQualificationReceipt,
  verifySourceEvidence,
} from "./release-qualification.mjs";

test("final receipt binds exact source, generated inputs, package signatures and manifest bytes", (t) => {
  const { directory, manifest, receipt } = qualificationFixture(t);
  assert.equal(
    verifyQualificationReceipt(directory, manifest, receipt),
    receipt,
  );
  for (const field of [
    "sourceRevision",
    "version",
    "releaseInputsSha256",
    "manifestSha256",
  ]) {
    const changed = structuredClone(receipt);
    changed[field] = "different";
    assert.throws(
      () => verifyQualificationReceipt(directory, manifest, changed),
      /does not bind/,
    );
  }
  for (const name of Object.keys(receipt.checks)) {
    const changed = structuredClone(receipt);
    changed.checks[name] = false;
    assert.throws(
      () => verifyQualificationReceipt(directory, manifest, changed),
      /Missing qualification check/,
    );
  }
  writeFileSync(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  assert.throws(
    () => verifyQualificationReceipt(directory, manifest, receipt),
    /does not bind/,
  );
});

test("source and public compatibility evidence must match successful signed inputs", (t) => {
  const { manifest } = qualificationFixture(t);
  for (const mutate of [
    (item) => {
      delete item.sourceVerification;
    },
    (item) => {
      item.sourceVerification.results[0].status = "failed";
    },
    (item) => {
      item.sourceVerification.results = [];
    },
    (item) => {
      item.sourceVerification.releaseInputsSha256 = "0".repeat(64);
    },
    (item) => {
      item.publicCompatibility.source = "b".repeat(40);
    },
    (item) => {
      delete item.artifacts[0].buildConfiguration.publicCompatibility;
    },
    (item) => {
      item.publicCompatibility.qualification.migrations = -1;
    },
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(
      () => verifySourceEvidence(changed),
      /verification|compatibility|configuration/,
    );
  }
});

test("receipt rejects package, input or signature mutation and asset links", (t) => {
  for (const file of [
    "release-inputs.json",
    "situate-release-history.json",
    "Situate-direct.dmg",
    "Situate-direct.app.tar.gz",
    "Situate-direct.app.tar.gz.sig",
  ]) {
    const { directory, manifest, receipt } = qualificationFixture(t);
    const path = join(directory, file);
    const original = readFileSync(path);
    writeFileSync(path, "different bytes");
    assert.throws(
      () => verifyQualificationReceipt(directory, manifest, receipt),
      /hash mismatch/,
    );
    writeFileSync(path, original);
    renameSync(path, `${path}.target`);
    symlinkSync(`${path}.target`, path);
    assert.throws(
      () => verifyQualificationReceipt(directory, manifest, receipt),
      /regular file/,
    );
  }
});

test("qualification blocks missing infrastructure before commands or receipt creation", async (t) => {
  const fixture = qualificationFixture(t);
  let calls = 0;
  await assert.rejects(
    qualifyRelease({
      ...fixture,
      execute: async () => {
        calls++;
      },
    }),
    /Blocked: provisioned isolated production-HTTPS routing/,
  );
  await assert.rejects(writeQualificationReceipt({ ...fixture }), /Blocked/);
  assert.equal(calls, 0);
});
