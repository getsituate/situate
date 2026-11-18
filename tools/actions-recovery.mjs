import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHostCheckpointStore } from "../infrastructure/releases/checkpoint.mjs";
import { withReleaseSSH } from "./release-environment.mjs";
import { checkpointRecoveryAdapters } from "./release-checkpoint-recovery.mjs";
import { inspectWorkflow, restoreWorkflow } from "./pipeline.mjs";
import { prepareRestoredQualificationRuntime } from "./release-runtime-recovery.mjs";
import { requalifyCheckpoint } from "./release-checkpoint-qualify.mjs";
import { validatePlan } from "./pipeline-state.mjs";

function requireController(env, workflow) {
  assert(
    ["recovery", "launch-trace"].includes(workflow),
    "Unknown recovery workflow",
  );
  assert(
    env.CI === "true" &&
      env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.RUNNER_OS === "macOS" &&
      env.GITHUB_REPOSITORY === "getsituate/situate" &&
      env.GITHUB_REPOSITORY_ID === "1455575895" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_REF_PROTECTED === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_WORKFLOW_REF ===
        `getsituate/situate/.github/workflows/release-${workflow}.yml@refs/heads/main`,
    "Checkpoint recovery requires the protected main macOS recovery workflow",
  );
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(env.RECOVERY_OPERATION ?? ""),
    "Select an exact existing operation",
  );
  assert(
    ["inspect", "qualify", "continue"].includes(env.RECOVERY_ACTION),
    "Unknown checkpoint recovery action",
  );
  if (workflow === "launch-trace")
    assert.equal(
      env.RECOVERY_ACTION,
      "qualify",
      "Launch tracing cannot publish",
    );
  if (env.RECOVERY_ACTION !== "inspect")
    assert(
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        env.RECOVERY_CHECKPOINT ?? "",
      ) && /^[a-f0-9]{64}$/.test(env.RECOVERY_CONFIRMATION ?? ""),
      "Select an exact checkpoint and inspected confirmation",
    );
}

export async function runCheckpointRecovery(
  root,
  environment,
  { adapters = {}, signal, workflow = "recovery" } = {},
) {
  try {
    requireController(environment, workflow);
    const temporary = lstatSync(environment.RUNNER_TEMP);
    assert(
      temporary.isDirectory() &&
        !temporary.isSymbolicLink() &&
        temporary.uid === process.getuid(),
      "Checkpoint recovery requires owned runner temporary storage",
    );
    const directory = mkdtempSync(
      join(environment.RUNNER_TEMP, "situate-checkpoint-recovery-"),
    );
    return await withReleaseSSH({ root, environment }, async (env) => {
      const store =
        adapters.store ??
        createHostCheckpointStore(
          {
            WEBSITE_DEPLOY_HOST: env.WEBSITE_DEPLOY_HOST,
            WEBSITE_SSH_IDENTITY: env.WEBSITE_SSH_IDENTITY,
            WEBSITE_SSH_KNOWN_HOSTS: env.WEBSITE_SSH_KNOWN_HOSTS,
          },
          { environment: env },
        );
      const metadata = join(directory, "original");
      await store.bootstrap({
        operationId: env.RECOVERY_OPERATION,
        destination: metadata,
      });
      const plan = JSON.parse(
        readFileSync(join(metadata, "plan.json"), "utf8"),
      );
      validatePlan(plan);
      assert(
        plan.repository === "getsituate/situate" &&
          plan.workflow === "create" &&
          plan.operation === env.RECOVERY_OPERATION &&
          plan.destination === env.WEBSITE_DEPLOY_HOST,
        "Checkpoint metadata differs from the selected operation or destination",
      );
      const inspectionAdapters =
        adapters.inspection ??
        (await checkpointRecoveryAdapters(root, plan, { environment: env }));
      const inspection = await (adapters.inspect ?? inspectWorkflow)(
        root,
        plan.operation,
        { plan, adapters: inspectionAdapters, environment: env },
      );
      if (env.RECOVERY_ACTION === "inspect")
        return {
          status: "inspected",
          operation: plan.operation,
          confirmation: inspection.reconciliationDigest,
          checkpoints: inspection.remote.checkpoints.checkpoints.map(
            (item) => ({ id: item.checkpointId, kind: item.kind }),
          ),
        };
      assert(
        inspection.reconciliationDigest === env.RECOVERY_CONFIRMATION,
        "External state changed; inspect and authorize again",
      );
      signal?.throwIfAborted();
      const destination = join(directory, "restored");
      if (env.RECOVERY_ACTION === "qualify") {
        const restored = await (adapters.restore ?? restoreWorkflow)(
          root,
          plan.operation,
          env.RECOVERY_CONFIRMATION,
          {
            plan,
            checkpointId: env.RECOVERY_CHECKPOINT,
            destination,
            adapters: inspectionAdapters,
            environment: env,
          },
        );
        const recoveryAuthorization = restored.recoveryAuthorization;
        const configuration = readFileSync(
          join(destination, "configuration.json"),
        );
        const record = {
          bytes: configuration,
          file: join(destination, "configuration.json"),
          sha256: plan.configurationDigest,
          configuration: JSON.parse(configuration),
        };
        const { runtimeAuthorization } = await (
          adapters.prepare ?? prepareRestoredQualificationRuntime
        )(root, {
          plan,
          record,
          directory: destination,
          inspection,
          recoveryAuthorization,
          environment: env,
          signal,
        });
        const result = await (adapters.qualify ?? requalifyCheckpoint)(root, {
          recoveryAuthorization,
          inspection,
          runtimeAuthorization,
          environment: env,
          signal,
        });
        return {
          status: result.status,
          operation: plan.operation,
          authorizationDigest: result.authorizationDigest,
          checkpointId: result.checkpointId,
        };
      }
      const restoreQualified =
        adapters.restoreQualified ??
        (await import("./release-checkpoint-restore-qualified.mjs"))
          .restoreQualifiedCheckpoint;
      const qualified = await restoreQualified(root, {
        plan,
        checkpointId: env.RECOVERY_CHECKPOINT,
        destination,
        inspection,
        confirmation: env.RECOVERY_CONFIRMATION,
        environment: env,
      });
      const continueQualified =
        adapters.continueQualified ??
        (await import("./release-checkpoint-continue.mjs"))
          .continueQualifiedCheckpoint;
      const result = await continueQualified(root, {
        recoveryAuthorization: qualified.recoveryAuthorization,
        runtimeAuthorization: qualified.runtimeAuthorization,
        qualificationInspection: qualified.qualificationInspection,
        publicationInspection: inspection,
        confirmation: env.RECOVERY_CONFIRMATION,
        restoredDirectory: destination,
        environment: env,
        signal,
      });
      const releaseId = result.identity?.releaseId;
      assert(
        Number.isSafeInteger(releaseId) && releaseId > 0,
        "GitHub continuation returned no exact release identity",
      );
      return { status: result.status, operation: plan.operation, releaseId };
    });
  } catch (cause) {
    const error = new Error(
      "Checkpoint recovery did not complete; inspect retained operation evidence before retrying",
      { cause },
    );
    error.uncertain = cause?.uncertain === true;
    throw error;
  }
}
