import assert from "node:assert/strict";
import test from "node:test";
import { runtimeFixture } from "./release-checkpoint-fixtures.mjs";
import { digest, sealPlan } from "./pipeline-state.mjs";
import { createCheckpoint, checkpointIdentity } from "./release-checkpoint.mjs";
import { validateFinalArtifactConfiguration } from "../client/scripts/final-artifact-qualification.mjs";
import {
  createQualificationRuntimeAuthorization,
  validateQualificationRuntimeAuthorization,
} from "./release-runtime-authorization.mjs";

test("fresh route authorization allows the same disposable VM account tuple without changing originals", (t) => {
  const input = runtimeFixture(t);
  const before = JSON.stringify(input.configuration);
  const auth = createQualificationRuntimeAuthorization(input);
  assert.deepEqual(
    validateQualificationRuntimeAuthorization(auth, input),
    input.runtime,
  );
  assert.equal(auth.manifestSha256, digest(input.manifestBytes));
  assert.equal(JSON.stringify(input.configuration), before);
  assert.equal(auth.runtime.qualification.account.uid, 501);
});
test("a retained legacy package can qualify through the baked listener", (t) => {
  const input = runtimeFixture(t);
  const facts = input.runtime.qualificationResources.facts;
  delete facts.imageId;
  delete facts.certificateVolume;
  facts.listenerProfile = "immutable-loopback-v1";
  const auth = createQualificationRuntimeAuthorization(input);
  assert.deepEqual(
    validateQualificationRuntimeAuthorization(auth, input),
    input.runtime,
  );
  facts.certificateVolume = "unexpected";
  assert.throws(
    () => createQualificationRuntimeAuthorization(input),
    /Controller facts fields differ/,
  );
});

test("unchanged custom qualification behavior remains valid but runtime overlays cannot alter it", (t) => {
  const input = runtimeFixture(t);
  const assertion = {
    assert: { role: "AXStaticText", name: "Synthetic workspace" },
  };
  const extras = {
    journeys: Object.fromEntries(
      ["workspace", "onboarding", "plugins"].map((name) => [
        name,
        {
          actions: [assertion],
          reopen: [assertion],
          files: [{ path: "synthetic.md", sha256: "a".repeat(64) }],
        },
      ]),
    ),
    lifecycle: Object.fromEntries(
      [
        "multiwindow",
        "unsavedCancellation",
        "replacement",
        "relaunch",
        "recovery",
      ].map((name) => [
        name,
        { before: [assertion], actions: [assertion], after: [assertion] },
      ]),
    ),
    updateActions: [
      { click: { role: "AXButton", name: "Install and restart" } },
    ],
    fixtureFiles: [{ path: "synthetic.md", contents: "Synthetic answer" }],
  };
  Object.assign(input.configuration.qualification, structuredClone(extras));
  Object.assign(input.runtime.qualification, structuredClone(extras));
  input.configurationBytes = JSON.stringify(input.configuration);
  input.plan = sealPlan({
    ...input.plan,
    configurationDigest: digest(input.configurationBytes),
  });
  input.operation = { ...input.operation, plan: input.plan };
  const descriptor = createCheckpoint({ ...input, kind: "build" }).descriptor;
  const { reconciliationDigest: _oldDigest, ...observation } = input.inspection;
  observation.planDigest = input.plan.authorizationDigest;
  observation.remote.checkpoints.coordination.active = checkpointIdentity(
    input.plan,
  );
  observation.remote.checkpoints.checkpoints = [descriptor];
  input.inspection = {
    ...observation,
    reconciliationDigest: digest(observation),
  };
  input.recoveryAuthorization = {
    ...input.recoveryAuthorization,
    planDigest: input.plan.authorizationDigest,
    descriptor,
    checkpointId: descriptor.checkpointId,
    inspectionDigest: input.inspection.reconciliationDigest,
  };
  validateFinalArtifactConfiguration(input.configuration.qualification);
  const authorized = createQualificationRuntimeAuthorization(input);
  assert.deepEqual(
    validateQualificationRuntimeAuthorization(authorized, input),
    input.runtime,
  );
  for (const key of Object.keys(extras)) {
    const runtime = structuredClone(input.runtime);
    runtime.qualification[key] = { altered: true };
    assert.throws(
      () => createQualificationRuntimeAuthorization({ ...input, runtime }),
      new RegExp(`Qualification field changed: ${key}`),
    );
  }
});

test("runtime overlays reject changed product, packages, baseline, inspection and reused nonce", (t) => {
  const input = runtimeFixture(t);
  for (const mutate of [
    (value) => {
      value.runtime.productVersion = "2026.12.1";
    },
    (value) => {
      value.runtime.qualification.routing.endpoint = "https://other.invalid/";
    },
    (value) => {
      value.runtime.qualification.predecessor.manifest.version = "2026.10.1";
    },
    (value) => {
      value.runtime.qualificationResources.operation = value.plan.operation;
      value.runtime.qualificationResources.facts.operationNonce =
        value.plan.operation;
    },
    (value) => {
      value.runtime.qualificationResources.tls.hostname = "other.invalid";
    },
    (value) => {
      value.runtime.qualificationResources.facts.credential =
        "synthetic-disallowed";
    },
    (value) => {
      value.runtime.qualification.account.mode = "personal";
    },
    (value) => {
      value.runtime.qualification.account.uid = 500;
    },
    (value) => {
      value.runtime.qualification.routing.operationId = "another-operation";
    },
    (value) => {
      value.inspection.remote = { changed: true };
    },
    (value) => {
      value.configurationBytes += " ";
    },
    (value) => {
      value.manifestBytes = Buffer.from("{}");
    },
  ]) {
    const { write: _write, ...cloneable } = input;
    const value = {
      ...structuredClone(cloneable),
      manifestBytes: Buffer.from(input.manifestBytes),
    };
    mutate(value);
    assert.throws(() => createQualificationRuntimeAuthorization(value));
  }
  const auth = createQualificationRuntimeAuthorization(input);
  auth.runtime.qualification.runnerImage = "tampered";
  assert.throws(() => validateQualificationRuntimeAuthorization(auth, input));
});
