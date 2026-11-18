import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { restoredRuntimeFixture } from "./release-checkpoint-fixtures.mjs";
import { traceFinalArtifactLaunch } from "./actions-launch-trace-worker.mjs";

test("the diagnostic worker cannot return product qualification", async () => {
  const record = {
    configuration: "/synthetic/unchanged.json",
    configurationSha256: "a".repeat(64),
    runtimeAuthorization: "/synthetic/runtime.json",
    runtimeAuthorizationSha256: "b".repeat(64),
  };
  await assert.rejects(
    traceFinalArtifactLaunch({
      ...record,
      traceFile: "/synthetic/private/launch-trace.json",
      qualify: async (input) => {
        for (const [key, value] of Object.entries(record))
          assert.equal(input[key], value);
        assert.equal(typeof input.createHost, "function");
        assert.equal(input.writeReceipt, undefined);
        return { receipt: "must-not-return" };
      },
    }),
    /cannot complete product qualification/,
  );
});

test("the original worker authenticates configuration before any diagnostic host access", async (t) => {
  const f = restoredRuntimeFixture(t),
    traceFile = join(f.directory, "launch-trace.json");
  await assert.rejects(
    traceFinalArtifactLaunch({
      directory: f.directory,
      configuration: f.record.file,
      configurationSha256: "0".repeat(64),
      traceFile,
    }),
    /authorized plan/,
  );
  assert.equal(existsSync(traceFile), false);
});
