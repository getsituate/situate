import assert from "node:assert/strict";
import {
  writeFileSync,
  readFileSync,
  symlinkSync,
  renameSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { qualificationFixture } from "./release-qualification-fixture.mjs";
import { createQualificationProcess } from "../client/scripts/final-artifact-process.mjs";
import {
  verifyQualificationReceipt,
  qualifyRelease,
  writeQualificationReceipt,
  verifySourceEvidence,
} from "./release-qualification.mjs";

test("failed telemetry cannot prevent owned cleanup or authorize a receipt", async (t) => {
  const { directory, manifest } = qualificationFixture(t);
  const primary = new Error("Synthetic preparation failure");
  const reporting = new Error("Synthetic progress failure");
  const commands = [];
  const execute = createQualificationProcess({
    getPhase: () => "cleanup",
    progress: () => {
      throw reporting;
    },
    execute: async (command) => {
      commands.push(command);
      return "";
    },
  });
  let cleanups = 0;
  const host = Object.fromEntries(
    ["prepare", "install", "journeys", "update", "inspect", "cleanup"].map(
      (name) => [name, async () => {}],
    ),
  );
  host.prepare = async () => {
    throw primary;
  };
  host.cleanup = async () => {
    cleanups++;
    await execute("ps", []);
    await execute("hdiutil", ["detach", "/synthetic/mount"]);
  };
  await assert.rejects(
    writeQualificationReceipt({
      directory,
      manifest,
      qualificationHost: host,
      execute,
      verifyPayloads: async () => {},
      progress: (phase) => {
        if (phase === "cleanup") throw reporting;
      },
    }),
    (error) => error.cause === primary && error.errors.includes(reporting),
  );
  assert.equal(cleanups, 1);
  assert.deepEqual(commands, ["ps", "hdiutil"]);
  assert.equal(
    existsSync(join(directory, "release-qualification.json")),
    false,
  );
});

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
  const progress = [];
  await assert.rejects(
    qualifyRelease({
      ...fixture,
      progress: (...event) => progress.push(event),
      execute: async () => {
        calls++;
      },
    }),
    /Blocked: provisioned isolated production-HTTPS routing/,
  );
  await assert.rejects(writeQualificationReceipt({ ...fixture }), /Blocked/);
  assert.equal(calls, 0);
  assert.deepEqual(progress, [
    ["candidate_payload", "started"],
    ["candidate_payload", "failed"],
  ]);
  assert.equal(
    existsSync(join(fixture.directory, "release-qualification.json")),
    false,
  );
});
