import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runtimeFixture } from "./release-checkpoint-fixtures.mjs";
import {
  createCheckpoint,
  createRestoreDirectory,
  writeRestoredFile,
} from "./release-checkpoint.mjs";
import { createQualificationRuntimeAuthorization } from "./release-runtime-authorization.mjs";
import { requalifyCheckpoint } from "./release-checkpoint-qualify.mjs";
import { continueQualifiedCheckpoint } from "./release-checkpoint-continue.mjs";
import { digest, operationDirectory } from "./pipeline-state.mjs";

test("restored qualification executes only a distinct authorized attempt without rewriting original stage evidence", async (t) => {
  const f = runtimeFixture(t);
  const checkpoint = createCheckpoint({ kind: "build", ...f });
  checkpoint.descriptor = f.recoveryAuthorization.descriptor;
  const destination = join(f.root, "restored");
  createRestoreDirectory(destination);
  for (let index = 0; index < checkpoint.files.length; index++) {
    const file = checkpoint.files[index];
    writeRestoredFile(
      destination,
      checkpoint.descriptor.files[index],
      file.bytes ?? readFileSync(file.file),
    );
  }
  f.recoveryAuthorization.directory = destination;
  f.recoveryAuthorization.descriptor = checkpoint.descriptor;
  const runtimeAuthorization = createQualificationRuntimeAuthorization(f);
  const snapshots = [];
  const committed = [];
  let qualifications = 0;
  const adapters = {
    inspection: { inspect: async () => f.inspection.remote },
    store: {
      commit: async (checkpoint) => {
        committed.push(checkpoint.descriptor);
        snapshots.push(
          JSON.parse(
            checkpoint.files.find((item) => item.name === "operation.json")
              .bytes,
          ),
        );
        return {
          durable: true,
          checkpointId: checkpoint.descriptor.checkpointId,
        };
      },
    },
    qualify: async (_root, input) => {
      qualifications++;
      assert.equal(snapshots.at(-1).qualificationAttempt.status, "intent");
      assert.equal(input.directory, destination);
      assert.equal(input.record.bytes, f.configurationBytes);
      assert.deepEqual(input.configuration, f.configuration);
      assert.deepEqual(input.qualificationRuntime, f.runtime);
      assert.deepEqual(input.inspection, f.inspection);
      const receipt = {
        sourceRevision: f.plan.source,
        manifestSha256: runtimeAuthorization.manifestSha256,
        runtimeAuthorizationDigest: runtimeAuthorization.authorizationDigest,
      };
      const path = join(destination, "release-qualification.json");
      writeFileSync(path, JSON.stringify(receipt), { mode: 0o600 });
      return { path, receipt };
    },
  };
  const before = readFileSync(join(destination, "operation.json"));
  const input = {
    recoveryAuthorization: f.recoveryAuthorization,
    inspection: f.inspection,
    runtimeAuthorization,
    adapters,
  };
  const result = await requalifyCheckpoint(f.root, input);
  assert.equal(result.status, "qualified");
  assert.equal(qualifications, 1);
  assert.deepEqual(
    snapshots.map((entry) => entry.qualificationAttempt.status),
    ["intent", "passed"],
  );
  assert.deepEqual(readFileSync(join(destination, "operation.json")), before);
  assert.deepEqual(snapshots[0].stages, f.operation.stages);
  await assert.rejects(requalifyCheckpoint(f.root, input), /attempt exists/);
  assert.equal(qualifications, 1);
  const modified = structuredClone(runtimeAuthorization);
  modified.runtime.qualification.routing.publicFeedSha256 = "f".repeat(64);
  await assert.rejects(
    requalifyCheckpoint(f.root, { ...input, runtimeAuthorization: modified }),
    /digest differs/,
  );
  assert.equal(qualifications, 1);
  const remote = {
    ...f.inspection.remote,
    reservation: { status: "reserved", reservation: f.operation.reservation },
    checkpoints: {
      ...f.inspection.remote.checkpoints,
      checkpoints: [checkpoint.descriptor, ...committed],
      inspectionDigest: "e".repeat(64),
    },
  };
  const observation = {
    operationId: f.plan.operation,
    planDigest: f.plan.authorizationDigest,
    remote,
  };
  const publicationInspection = {
    ...observation,
    reconciliationDigest: digest(observation),
  };
  const calls = [];
  const publicationAdapters = {
    inspection: { inspect: async () => remote },
    evidence: async ({ directory, identity }) => {
      assert.equal(directory, destination);
      assert.equal(identity.sourceRevision, f.plan.source);
      return { files: {}, evidence: {} };
    },
    store: {
      commit: async (value) => {
        calls.push(value.inspectionDigest ? "intent" : "outcome");
        return { durable: true, checkpointId: value.descriptor.checkpointId };
      },
    },
    coordinator: {
      inspect: async () => ({ active: remote.checkpoints.coordination.active }),
      complete: async () => {
        calls.push("complete");
      },
    },
    createRelease: async (request, { authorize }) => {
      assert.equal(calls.at(-1), "intent");
      await authorize({ identity: request.identity });
      calls.push("create");
      writeFileSync(
        request.journalPath,
        JSON.stringify({
          schemaVersion: 1,
          state: "complete",
          identity: request.identity,
          releaseId: 1,
          evidenceSha256: "a".repeat(64),
        }),
        { mode: 0o600 },
      );
      return {
        identity: { ...request.identity, releaseId: 1 },
        evidenceSha256: "a".repeat(64),
      };
    },
  };
  const continuation = {
    recoveryAuthorization: f.recoveryAuthorization,
    runtimeAuthorization,
    qualificationInspection: f.inspection,
    publicationInspection,
    confirmation: publicationInspection.reconciliationDigest,
    adapters: publicationAdapters,
  };
  await assert.rejects(
    continueQualifiedCheckpoint(f.root, {
      ...continuation,
      confirmation: "wrong",
    }),
    /Confirm/,
  );
  for (const failure of ["before-commit", "lost-ack"]) {
    const trialRoot = join(f.root, failure);
    const operationDir = operationDirectory(trialRoot, f.plan.operation);
    mkdirSync(operationDir, { recursive: true, mode: 0o700 });
    const attemptName = `qualification-${runtimeAuthorization.routeNonce}.json`;
    writeFileSync(
      join(operationDir, attemptName),
      readFileSync(
        join(operationDirectory(f.root, f.plan.operation), attemptName),
      ),
      { mode: 0o600 },
    );
    let completed = false;
    const committed = [];
    const trialAdapters = {
      ...publicationAdapters,
      coordinator: {
        ...publicationAdapters.coordinator,
        complete: async () => {
          completed = true;
        },
      },
      store: {
        commit: async (value) => {
          const snapshot = JSON.parse(
            value.files.find((item) => item.name === "operation.json").bytes,
          );
          if (snapshot.publicationJournal?.state === "complete") {
            if (failure === "lost-ack") committed.push(snapshot);
            throw new Error("terminal checkpoint acknowledgement lost");
          }
          return { durable: true, checkpointId: value.descriptor.checkpointId };
        },
      },
      createRelease: async (request) => {
        writeFileSync(
          request.journalPath,
          JSON.stringify({
            schemaVersion: 1,
            state: "complete",
            identity: request.identity,
            releaseId: 1,
            evidenceSha256: "a".repeat(64),
          }),
          { mode: 0o600 },
        );
        return {
          identity: { ...request.identity, releaseId: 1 },
          evidenceSha256: "a".repeat(64),
        };
      },
    };
    await assert.rejects(
      continueQualifiedCheckpoint(trialRoot, {
        ...continuation,
        adapters: trialAdapters,
      }),
      /terminal checkpoint/,
    );
    assert.equal(completed, false);
    assert.equal(committed.length, failure === "lost-ack" ? 1 : 0);
  }
  const publication = await continueQualifiedCheckpoint(f.root, continuation);
  assert.equal(publication.status, "created");
  assert.deepEqual(calls, ["intent", "create", "outcome", "complete"]);
  assert.equal(qualifications, 1);
  assert.deepEqual(readFileSync(join(destination, "operation.json")), before);
  await assert.rejects(
    continueQualifiedCheckpoint(f.root, continuation),
    /already completed/,
  );
});
