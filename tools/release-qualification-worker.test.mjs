import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { qualifyFinalArtifacts } from "./release-qualification-worker.mjs";
import { restoredRuntimeFixture } from "./release-checkpoint-fixtures.mjs";
import { createQualificationRuntimeAuthorization } from "./release-runtime-authorization.mjs";
import { writeQualificationRuntimeEnvelope } from "./qualification-runtime-envelope.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-qualification-worker-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configuration = join(root, "configuration.json");
  const bytes = JSON.stringify({
    schemaVersion: 1,
    qualification: { profile: "synthetic" },
  });
  writeFileSync(configuration, bytes, { mode: 0o600 });
  return { directory: root, configuration, configurationSha256: hash(bytes) };
}

test("qualification worker checks authorized bytes and passes only desktop inputs to the host", async (t) => {
  const values = fixture(t);
  const host = { synthetic: true };
  const progress = [];
  let nativeExecute;
  const result = await qualifyFinalArtifacts({
    ...values,
    progress: (...event) => progress.push(event),
    environment: {
      PATH: "/bin",
      HOME: "/Users/runner",
      APPLE_API_PRIVATE_KEY: "not-forwarded",
      GH_TOKEN: "not-forwarded",
      WEBSITE_SSH_IDENTITY: "not-forwarded",
    },
    createHost: (configuration, options) => {
      assert.deepEqual(configuration, { profile: "synthetic" });
      assert.equal(typeof options.execute, "function");
      nativeExecute = options.execute;
      assert.deepEqual(options.environment, {
        PATH: "/bin",
        HOME: "/Users/runner",
      });
      return host;
    },
    writeReceipt: async (options) => {
      assert.equal(options.qualificationHost, host);
      assert.equal(options.directory, values.directory);
      assert.equal(options.execute, nativeExecute);
      assert.deepEqual(options.env, { PATH: "/bin", HOME: "/Users/runner" });
      options.progress("prepare", "started");
      options.progress("cleanup", "completed");
      return { receipt: "synthetic" };
    },
  });
  assert.deepEqual(result, { receipt: "synthetic" });
  assert.deepEqual(progress, [
    ["prepare", "started", "none", undefined],
    ["cleanup", "completed", "none", undefined],
  ]);
});

test("changed or linked configuration cannot launch qualification", async (t) => {
  const values = fixture(t);
  const createHost = () =>
    assert.fail("Unauthenticated configuration must not launch a host");
  await assert.rejects(
    qualifyFinalArtifacts({
      ...values,
      configurationSha256: "a".repeat(64),
      createHost,
    }),
    /authorized plan/,
  );
  const link = join(values.directory, "linked.json");
  symlinkSync(values.configuration, link);
  await assert.rejects(
    qualifyFinalArtifacts({ ...values, configuration: link, createHost }),
    /private regular file/,
  );
});

test("recovery worker authenticates original bytes before applying separately authorized runtime", async (t) => {
  const f = restoredRuntimeFixture(t);
  const runtimeAuthorization = createQualificationRuntimeAuthorization(f);
  const runtimeFile = join(f.directory, "runtime.json");
  const pin = writeQualificationRuntimeEnvelope(runtimeFile, {
    plan: f.plan,
    runtimeAuthorization,
    inspection: f.inspection,
    recoveryAuthorization: f.recoveryAuthorization,
  });
  const result = await qualifyFinalArtifacts({
    directory: f.directory,
    configuration: f.record.file,
    configurationSha256: f.record.sha256,
    runtimeAuthorization: runtimeFile,
    runtimeAuthorizationSha256: pin,
    createHost: (configuration) => {
      assert.deepEqual(configuration, f.runtime.qualification);
      assert.notEqual(
        configuration.routing.identitySha256,
        f.configuration.qualification.routing.identitySha256,
      );
      return { synthetic: true };
    },
    writeReceipt: async (options) => {
      assert.equal(
        options.runtimeAuthorizationDigest,
        runtimeAuthorization.authorizationDigest,
      );
      assert.equal(options.directory, f.directory);
      return {
        receipt: {
          runtimeAuthorizationDigest: options.runtimeAuthorizationDigest,
        },
      };
    },
  });
  assert.equal(
    result.receipt.runtimeAuthorizationDigest,
    runtimeAuthorization.authorizationDigest,
  );
  assert.equal(readFileSync(f.record.file, "utf8"), f.configurationBytes);
});

test("a pinned but altered recovery authorization cannot launch the native host", async (t) => {
  const f = restoredRuntimeFixture(t);
  const runtimeAuthorization = createQualificationRuntimeAuthorization(f);
  runtimeAuthorization.runtime.qualification.runnerImage =
    "synthetic-rejected-image";
  const runtimeFile = join(f.directory, "runtime.json");
  const pin = writeQualificationRuntimeEnvelope(runtimeFile, {
    plan: f.plan,
    runtimeAuthorization,
    inspection: f.inspection,
    recoveryAuthorization: f.recoveryAuthorization,
  });
  await assert.rejects(
    qualifyFinalArtifacts({
      directory: f.directory,
      configuration: f.record.file,
      configurationSha256: f.record.sha256,
      runtimeAuthorization: runtimeFile,
      runtimeAuthorizationSha256: pin,
      createHost: () => assert.fail("Altered authorization launched a host"),
    }),
    (error) =>
      error.message === "Qualification runtime authorization validation failed",
  );
});

test("malformed private JSON is reported without its contents", async (t) => {
  const values = fixture(t);
  const privateText = '{"private":"do-not-display"';
  writeFileSync(values.configuration, privateText);
  await assert.rejects(
    qualifyFinalArtifacts({
      ...values,
      configurationSha256: hash(privateText),
    }),
    (error) => {
      assert.equal(
        error.message,
        "Qualification configuration is not valid JSON",
      );
      return true;
    },
  );
});
