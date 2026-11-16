import assert from "node:assert/strict";
import test from "node:test";
import { runtimeFixture } from "./release-checkpoint-fixtures.mjs";
import { digest } from "./pipeline-state.mjs";
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
