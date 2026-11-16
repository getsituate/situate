import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readQualificationRuntimeEnvelope,
  writeQualificationRuntimeEnvelope,
} from "./qualification-runtime-envelope.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-runtime-envelope-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "authorization.json");
  const authorization = { authorizationDigest: "a".repeat(64) };
  const input = {
    plan: { source: "b".repeat(40) },
    runtimeAuthorization: authorization,
    inspection: { public: true },
    recoveryAuthorization: { directory },
  };
  const sha256 = writeQualificationRuntimeEnvelope(file, input);
  return { file, sha256, input };
}

test("worker envelope retains original bindings and exposes only the validated runtime", async (t) => {
  const { file, sha256, input } = fixture(t);
  const configurationBytes = Buffer.from('{"qualification":{"original":true}}');
  const manifestBytes = Buffer.from('{"original":"manifest"}');
  const qualificationRuntime = {
    qualification: { fresh: true },
    qualificationResources: { operation: "fresh-nonce" },
  };
  const result = await readQualificationRuntimeEnvelope(file, sha256, {
    configuration: JSON.parse(configurationBytes),
    configurationBytes,
    manifestBytes,
    validate: (authorization, bindings) => {
      assert.deepEqual(authorization, input.runtimeAuthorization);
      assert.deepEqual(bindings, {
        plan: input.plan,
        configuration: JSON.parse(configurationBytes),
        configurationBytes,
        manifestBytes,
        inspection: input.inspection,
        recoveryAuthorization: input.recoveryAuthorization,
      });
      return qualificationRuntime;
    },
  });
  assert.deepEqual(result, {
    qualificationRuntime,
    runtimeAuthorizationDigest: input.runtimeAuthorization.authorizationDigest,
  });
  assert.equal(
    configurationBytes.toString(),
    '{"qualification":{"original":true}}',
  );
  assert.throws(() => writeQualificationRuntimeEnvelope(file, input), {
    code: "EEXIST",
  });
});

test("changed, linked and public authorization cannot reach validation", async (t) => {
  const { file, sha256 } = fixture(t);
  const options = {
    validate: () => assert.fail("Unsafe authorization reached validation"),
  };
  await assert.rejects(
    readQualificationRuntimeEnvelope(file, "b".repeat(64), options),
    /bytes differ/,
  );
  const symbolic = file + ".symlink";
  symlinkSync(file, symbolic);
  await assert.rejects(
    readQualificationRuntimeEnvelope(symbolic, sha256, options),
    { code: "ELOOP" },
  );
  const hard = file + ".hardlink";
  linkSync(file, hard);
  await assert.rejects(
    readQualificationRuntimeEnvelope(file, sha256, options),
    /private regular file/,
  );
  rmSync(hard);
  chmodSync(file, 0o644);
  await assert.rejects(
    readQualificationRuntimeEnvelope(file, sha256, options),
    /private regular file/,
  );
});

test("invalid private values never appear in envelope errors", async (t) => {
  const { file, sha256 } = fixture(t);
  await assert.rejects(
    readQualificationRuntimeEnvelope(file, sha256, {
      validate: () => {
        throw new Error("private-account-path");
      },
    }),
    (error) => {
      assert.equal(
        error.message,
        "Qualification runtime authorization validation failed",
      );
      assert.equal(error.cause.message, "private-account-path");
      return true;
    },
  );
  writeFileSync(file, '{"private-account-path":');
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  await assert.rejects(
    readQualificationRuntimeEnvelope(file, digest),
    (error) => {
      assert.equal(
        error.message,
        "Qualification runtime authorization is not valid JSON",
      );
      return true;
    },
  );
});
