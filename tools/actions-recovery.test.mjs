import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runtimeFixture } from "./release-checkpoint-fixtures.mjs";
import { runCheckpointRecovery } from "./actions-recovery.mjs";

function fixture(t, action = "inspect") {
  const f = runtimeFixture(t);
  const temporary = mkdtempSync(join(tmpdir(), "situate-actions-recovery-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const environment = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "macOS",
    GITHUB_REPOSITORY: "getsituate/situate",
    GITHUB_REPOSITORY_ID: "1455575895",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF:
      "getsituate/situate/.github/workflows/release-recovery.yml@refs/heads/main",
    RUNNER_TEMP: temporary,
    RECOVERY_OPERATION: f.plan.operation,
    RECOVERY_ACTION: action,
    RECOVERY_CHECKPOINT: f.recoveryAuthorization.checkpointId,
    RECOVERY_CONFIRMATION: f.inspection.reconciliationDigest,
    WEBSITE_DEPLOY_HOST: f.plan.destination,
    WEBSITE_SSH_IDENTITY: "/synthetic/identity",
    WEBSITE_SSH_KNOWN_HOSTS: "/synthetic/known-hosts",
  };
  const calls = [];
  const adapters = {
    store: {
      bootstrap: async ({ operationId, destination }) => {
        calls.push("bootstrap");
        assert.equal(operationId, f.plan.operation);
        mkdirSync(destination, { mode: 0o700 });
        writeFileSync(join(destination, "plan.json"), JSON.stringify(f.plan), {
          mode: 0o600,
        });
      },
    },
    inspection: {},
    inspect: async () => {
      calls.push("inspect");
      return f.inspection;
    },
    restore: async (_root, _operation, confirmation, { destination }) => {
      calls.push("restore");
      assert.equal(confirmation, f.inspection.reconciliationDigest);
      mkdirSync(destination, { mode: 0o700 });
      writeFileSync(
        join(destination, "configuration.json"),
        f.configurationBytes,
        { mode: 0o600 },
      );
      return {
        recoveryAuthorization: {
          ...f.recoveryAuthorization,
          directory: destination,
        },
      };
    },
    prepare: async (_root, input) => {
      calls.push("prepare");
      assert.equal(input.record.sha256, f.plan.configurationDigest);
      assert.equal(input.record.bytes.toString(), f.configurationBytes);
      return { runtimeAuthorization: { authorizationDigest: "a".repeat(64) } };
    },
    qualify: async () => {
      calls.push("qualify");
      return {
        status: "qualified",
        authorizationDigest: "a".repeat(64),
        checkpointId: f.recoveryAuthorization.checkpointId,
      };
    },
    restoreQualified: async (_root, input) => {
      calls.push("restore-qualified");
      assert.equal(input.checkpointId, environment.RECOVERY_CHECKPOINT);
      return {
        recoveryAuthorization: {
          ...f.recoveryAuthorization,
          directory: "/synthetic/original-runner",
        },
        runtimeAuthorization: { retained: true },
        qualificationInspection: f.inspection,
      };
    },
    continueQualified: async (_root, input) => {
      calls.push("continue");
      assert.equal(
        input.recoveryAuthorization.directory,
        "/synthetic/original-runner",
      );
      assert.notEqual(
        input.restoredDirectory,
        input.recoveryAuthorization.directory,
      );
      assert.deepEqual(input.publicationInspection, f.inspection);
      return { status: "created", identity: { releaseId: 42 } };
    },
  };
  return { f, environment, calls, adapters };
}

test("protected inspection reports opaque checkpoint identities without private metadata", async (t) => {
  const f = fixture(t);
  const result = await runCheckpointRecovery(f.f.root, f.environment, {
    adapters: f.adapters,
  });
  assert.deepEqual(f.calls, ["bootstrap", "inspect"]);
  assert.equal(result.confirmation, f.f.inspection.reconciliationDigest);
  assert.equal(result.checkpoints[0].id, f.environment.RECOVERY_CHECKPOINT);
  assert.doesNotMatch(JSON.stringify(result), /Users|synthetic@|configuration/);
});

test("qualification restores original inputs before preparing a separately authorized attempt", async (t) => {
  const f = fixture(t, "qualify");
  const result = await runCheckpointRecovery(f.f.root, f.environment, {
    adapters: f.adapters,
  });
  assert.deepEqual(f.calls, [
    "bootstrap",
    "inspect",
    "restore",
    "prepare",
    "qualify",
  ]);
  assert.equal(result.status, "qualified");
  assert.equal(result.checkpointId, f.environment.RECOVERY_CHECKPOINT);
});

test("publication uses a restored qualified checkpoint without preparing or qualifying again", async (t) => {
  const f = fixture(t, "continue");
  const result = await runCheckpointRecovery(f.f.root, f.environment, {
    adapters: f.adapters,
  });
  assert.deepEqual(f.calls, [
    "bootstrap",
    "inspect",
    "restore-qualified",
    "continue",
  ]);
  assert.equal(result.releaseId, 42);
});

test("untrusted context and stale confirmation cannot restore or publish", async (t) => {
  const f = fixture(t, "continue");
  await assert.rejects(
    runCheckpointRecovery(
      f.f.root,
      { ...f.environment, GITHUB_REF_PROTECTED: "false" },
      { adapters: f.adapters },
    ),
  );
  assert.deepEqual(f.calls, []);
  await assert.rejects(
    runCheckpointRecovery(
      f.f.root,
      { ...f.environment, RECOVERY_CONFIRMATION: "f".repeat(64) },
      { adapters: f.adapters },
    ),
  );
  assert.deepEqual(f.calls, ["bootstrap", "inspect"]);
});
