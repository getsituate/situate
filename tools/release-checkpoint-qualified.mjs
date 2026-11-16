import assert from "node:assert/strict";
import { join } from "node:path";
import { digest } from "./pipeline-state.mjs";
import {
  checkpointFile,
  checkpointFileHash,
  checkpointIdentity,
  validateRestoredCheckpoint,
} from "./release-checkpoint.mjs";
import { validateQualificationRuntimeAuthorization } from "./release-runtime-authorization.mjs";

export function validateQualifiedRestore(descriptor, directory, plan) {
  assert.equal(descriptor.kind, "qualified-restore");
  assert.deepEqual(descriptor.identity, checkpointIdentity(plan));
  const build = descriptor.buildDescriptor;
  const qualified = descriptor.qualificationDescriptor;
  assert.equal(qualified.kind, "runtime-authorization");
  assert.equal(qualified.checkpointId, descriptor.checkpointId);
  assert.deepEqual(qualified.identity, descriptor.identity);
  const retained = validateRestoredCheckpoint(build, directory, plan);
  const metadata = [
    "original-recovery-authorization.json",
    "original-qualification-inspection.json",
    "runtime-authorization.json",
    "release-qualification.json",
  ];
  const expected = [
    ...build.files,
    {
      ...qualified.files.find((item) => item.name === "operation.json"),
      name: "qualification-operation.json",
    },
    ...metadata.map((name) =>
      qualified.files.find((item) => item.name === name),
    ),
  ];
  assert(
    expected.every((item) => item?.sha256),
    "Original qualified checkpoint inputs are incomplete",
  );
  assert.deepEqual(
    descriptor.files,
    expected,
    "Qualified restore inventory differs",
  );
  assert(
    !descriptor.files.some((item) =>
      ["qualified-restore.json", "qualified-mapping.json"].includes(item.name),
    ),
    "Qualified restore metadata name collision",
  );
  for (const item of descriptor.files)
    assert.deepEqual(checkpointFileHash(join(directory, item.name)), {
      size: item.size,
      sha256: item.sha256,
    });
  for (const name of ["plan.json", "configuration.json"])
    assert.deepEqual(
      qualified.files.find((item) => item.name === name),
      build.files.find((item) => item.name === name),
    );
  const read = (name) => JSON.parse(checkpointFile(join(directory, name)));
  const recoveryAuthorization = read("original-recovery-authorization.json");
  const qualificationInspection = read(
    "original-qualification-inspection.json",
  );
  const runtimeAuthorization = read("runtime-authorization.json");
  assert.deepEqual(
    recoveryAuthorization.descriptor,
    build,
    "Original build selection differs",
  );
  validateQualificationRuntimeAuthorization(runtimeAuthorization, {
    plan,
    configuration: JSON.parse(retained.configurationBytes),
    configurationBytes: retained.configurationBytes,
    manifestBytes: retained.manifestBytes,
    inspection: qualificationInspection,
    recoveryAuthorization,
  });
  const qualificationOperation = read("qualification-operation.json");
  const { qualificationAttempt, ...original } = qualificationOperation;
  assert.deepEqual(
    original,
    retained.operation,
    "Qualified operation changed original history",
  );
  assert.equal(
    qualificationAttempt?.status,
    "passed",
    "Only an actual passed attempt is restorable",
  );
  assert.equal(
    qualificationAttempt.authorizationDigest,
    runtimeAuthorization.authorizationDigest,
  );
  assert.equal(
    qualificationAttempt.receipt?.path,
    join(recoveryAuthorization.directory, "release-qualification.json"),
    "Original receipt location differs from recovery authorization",
  );
  const receiptBytes = checkpointFile(
    join(directory, "release-qualification.json"),
  );
  const receipt = JSON.parse(receiptBytes);
  assert.deepEqual(
    receipt,
    qualificationAttempt.receipt?.receipt,
    "Original receipt differs from passed attempt",
  );
  assert.equal(receipt.sourceRevision, plan.source);
  assert.equal(receipt.manifestSha256, digest(retained.manifestBytes));
  assert.equal(
    receipt.runtimeAuthorizationDigest,
    runtimeAuthorization.authorizationDigest,
  );
  return {
    descriptor,
    directory,
    recoveryAuthorization,
    runtimeAuthorization,
    qualificationInspection,
    qualificationOperation,
    mapping: {
      directory,
      buildCheckpointId: build.checkpointId,
      qualificationCheckpointId: qualified.checkpointId,
      manifestSha256: digest(retained.manifestBytes),
      receiptSha256: digest(receiptBytes),
    },
  };
}
