import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  atomicJson,
  digest,
  operationDirectory,
  withOperationLock,
} from "./pipeline-state.mjs";
import {
  checkpointFile,
  checkpointIdentity,
  checkpointGitHubWrites,
  completeCheckpointedPublication,
  createCheckpoint,
  validateRestoredCheckpoint,
} from "./release-checkpoint.mjs";
import { validateQualificationRuntimeAuthorization } from "./release-runtime-authorization.mjs";
import { checkpointRecoveryAdapters } from "./release-checkpoint-recovery.mjs";
import { createHostCheckpointStore } from "../infrastructure/releases/checkpoint.mjs";
import {
  createHostAllocatorLock,
  createHostReleaseCoordinator,
} from "../infrastructure/releases/allocator.mjs";
import { githubAdapter } from "../infrastructure/releases/github.mjs";
import {
  createEvidenceFromDirectory,
  createGitHubRelease,
} from "./github-release.mjs";
import { notesForCatalog } from "./pipeline-operations.mjs";
import { withReleaseSSH } from "./release-environment.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

export async function continueQualifiedCheckpoint(
  root,
  {
    recoveryAuthorization,
    runtimeAuthorization,
    qualificationInspection,
    publicationInspection,
    confirmation,
    environment = process.env,
    adapters,
  } = {},
) {
  const directory = recoveryAuthorization.directory;
  const planBytes = checkpointFile(join(directory, "plan.json"));
  const plan = JSON.parse(planBytes);
  assert.equal(
    plan.repository,
    "getsituate/situate",
    "Unexpected release repository",
  );
  const retained = validateRestoredCheckpoint(
    recoveryAuthorization.descriptor,
    directory,
    plan,
  );
  validateQualificationRuntimeAuthorization(runtimeAuthorization, {
    plan,
    configuration: JSON.parse(retained.configurationBytes),
    configurationBytes: retained.configurationBytes,
    manifestBytes: retained.manifestBytes,
    inspection: qualificationInspection,
    recoveryAuthorization,
  });
  const { reconciliationDigest, ...observation } = publicationInspection;
  assert.equal(
    reconciliationDigest,
    digest(observation),
    "Publication inspection digest differs",
  );
  assert.equal(
    confirmation,
    reconciliationDigest,
    "Confirm the exact fresh publication inspection",
  );
  assert.equal(publicationInspection.operationId, plan.operation);
  assert.equal(publicationInspection.planDigest, plan.authorizationDigest);
  const attemptFile = join(
    operationDirectory(root, plan.operation),
    `qualification-${runtimeAuthorization.routeNonce}.json`,
  );
  const attempt = JSON.parse(checkpointFile(attemptFile));
  assert(
    attempt.status === "passed" &&
      attempt.authorizationDigest === runtimeAuthorization.authorizationDigest,
    "A distinct passed qualification attempt is required",
  );
  const result = attempt.receipt;
  assert.equal(result?.path, join(directory, "release-qualification.json"));
  const receipt = JSON.parse(checkpointFile(result.path));
  assert.deepEqual(receipt, result.receipt);
  assert.equal(receipt.manifestSha256, digest(retained.manifestBytes));
  assert.equal(
    receipt.runtimeAuthorizationDigest,
    runtimeAuthorization.authorizationDigest,
  );
  const state = publicationInspection.remote?.checkpoints;
  assert.deepEqual(
    state?.coordination?.active,
    checkpointIdentity(plan),
    "Publication requires the exact active claim",
  );
  assert(
    state.terminalNotary === true &&
      state.publication === null &&
      state.unresolvedPublication === false,
    "Publication inspection has unresolved work",
  );
  assert.deepEqual(
    publicationInspection.remote.reservation?.reservation,
    retained.operation.reservation,
    "Publication reservation differs",
  );
  assert.equal(publicationInspection.remote.reservation.status, "reserved");
  const snapshot = Buffer.from(
    `${JSON.stringify({ ...retained.operation, qualificationAttempt: attempt })}\n`,
  );
  const authorizationBytes = Buffer.from(
    `${JSON.stringify(runtimeAuthorization)}\n`,
  );
  assert(
    state.checkpoints.some(
      (checkpoint) =>
        checkpoint.kind === "runtime-authorization" &&
        checkpoint.files.some(
          (item) =>
            item.name === "operation.json" && item.sha256 === digest(snapshot),
        ) &&
        checkpoint.files.some(
          (item) =>
            item.name === "runtime-authorization.json" &&
            item.sha256 === digest(authorizationBytes),
        ),
    ),
    "Passed attempt has no matching durable checkpoint",
  );
  const execute = async (environment, adapters) =>
    withOperationLock(root, plan.operation, async () => {
      const inspectionAdapter =
        adapters?.inspection ??
        (await checkpointRecoveryAdapters(root, plan, { environment }));
      const current = await inspectionAdapter.inspect();
      assert.equal(
        digest(current),
        digest(publicationInspection.remote),
        "External state changed; inspect publication again",
      );
      const reservation = retained.operation.reservation;
      const identity = {
        repository: plan.repository,
        tag: reservation.tag,
        sourceRevision: plan.source,
        version: reservation.version,
        operationId: plan.operation,
        inputSha256: reservation.generatedInputDigest,
      };
      const notes = notesForCatalog(
        JSON.parse(
          checkpointFile(join(directory, "situate-release-history.json")),
        ),
      );
      const evidence = await (
        adapters?.evidence ?? createEvidenceFromDirectory
      )({ identity, directory, notes });
      const host = {
        WEBSITE_DEPLOY_HOST: plan.destination,
        WEBSITE_SSH_IDENTITY: environment.WEBSITE_SSH_IDENTITY,
        WEBSITE_SSH_KNOWN_HOSTS: environment.WEBSITE_SSH_KNOWN_HOSTS,
      };
      const store =
        adapters?.store ?? createHostCheckpointStore(host, { environment });
      const coordinator =
        adapters?.coordinator ??
        createHostReleaseCoordinator(host, {
          ...checkpointIdentity(plan),
          withAllocatorLock: createHostAllocatorLock(host, { environment }),
        });
      const journalPath = join(
        operationDirectory(root, plan.operation),
        "github-journal.json",
      );
      assert(
        !existsSync(
          join(
            operationDirectory(root, plan.operation),
            `publication-${runtimeAuthorization.routeNonce}.json`,
          ),
        ),
        "Publication attempt already completed; inspect instead of replaying",
      );
      assert(
        !existsSync(journalPath),
        "Existing GitHub intent requires separate inspection and reconciliation",
      );
      const operation = {
        ...retained.operation,
        qualificationAttempt: attempt,
        stages: [
          ...retained.operation.stages,
          {
            name: "github",
            status: "running",
            qualificationAuthorizationDigest:
              runtimeAuthorization.authorizationDigest,
          },
        ],
      };
      const checkpoint = createCheckpoint({
        kind: "intent",
        operation,
        planBytes,
        configurationBytes: retained.configurationBytes,
      });
      const acknowledgement = await store.commit({
        ...checkpoint,
        inspectionDigest: state.inspectionDigest,
      });
      assert(
        acknowledgement?.durable === true &&
          acknowledgement.checkpointId === checkpoint.descriptor.checkpointId,
        "Publication intent has no durable acknowledgement",
      );
      const publish = adapters?.createRelease ?? createGitHubRelease;
      const result = await publish(
        { ...evidence, identity, notes, journalPath },
        {
          github: checkpointGitHubWrites(
            adapters?.github ?? githubAdapter({ environment }),
            async () => {
              operation.publicationJournal = JSON.parse(
                checkpointFile(journalPath),
              );
              const transition = createCheckpoint({
                kind: "intent",
                operation,
                planBytes,
                configurationBytes: retained.configurationBytes,
              });
              const durable = await store.commit(transition);
              assert(
                durable?.durable === true &&
                  durable.checkpointId === transition.descriptor.checkpointId,
                "Publication journal has no durable acknowledgement",
              );
            },
          ),
          authorize: async (expected) => {
            assert.deepEqual(expected.identity, identity);
            const current = await coordinator.inspect();
            assert.deepEqual(
              current.active,
              checkpointIdentity(plan),
              "Release claim changed before publication",
            );
          },
        },
      );
      await completeCheckpointedPublication({
        operation,
        result,
        journalPath,
        coordinator,
        persist: async (snapshot) => {
          const outcome = createCheckpoint({
            kind: "intent",
            operation: snapshot,
            planBytes,
            configurationBytes: retained.configurationBytes,
          });
          const durable = await store.commit(outcome);
          assert(
            durable?.durable === true &&
              durable.checkpointId === outcome.descriptor.checkpointId,
            "Publication outcome has no durable acknowledgement",
          );
        },
      });
      const completion = {
        status: "created",
        identity: result.identity,
        evidenceSha256: result.evidenceSha256,
        qualificationAuthorizationDigest:
          runtimeAuthorization.authorizationDigest,
      };
      atomicJson(
        join(
          operationDirectory(root, plan.operation),
          `publication-${runtimeAuthorization.routeNonce}.json`,
        ),
        completion,
      );
      return completion;
    });
  return adapters
    ? execute(environment, adapters)
    : withReleaseSSH({ root, environment }, (prepared) => execute(prepared));
}
const inspected = (value) =>
  value.reconciliationDigest
    ? value
    : { ...value, reconciliationDigest: digest(value) };
export async function main(
  argv = process.argv.slice(2),
  { root = resolve(import.meta.dirname, ".."), ...options } = {},
) {
  const { values } = parseArgs({
    args: argv,
    options: Object.fromEntries(
      [
        "restore-authorization",
        "runtime-authorization",
        "qualification-inspection",
        "publication-inspection",
        "confirm",
      ].map((name) => [name, { type: "string" }]),
    ),
  });
  const read = (name) => {
    assert(values[name], `Select --${name} FILE`);
    return JSON.parse(readFileSync(values[name], "utf8"));
  };
  const recoveryAuthorization = read("restore-authorization");
  const qualificationInspection = values["qualification-inspection"]
    ? read("qualification-inspection")
    : recoveryAuthorization.inspection;
  assert(qualificationInspection, "Select --qualification-inspection FILE");
  return continueQualifiedCheckpoint(root, {
    recoveryAuthorization,
    runtimeAuthorization: read("runtime-authorization"),
    qualificationInspection: inspected(qualificationInspection),
    publicationInspection: inspected(read("publication-inspection")),
    confirmation: values.confirm,
    ...options,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(import.meta.dirname, "..");
  try {
    if (!coordinated(root))
      process.exitCode = await runCoordinated({
        directory: root,
        command: process.execPath,
        args: process.argv.slice(1),
        cleanupGraceMs: 90_000,
      });
    else process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch {
    process.stderr.write(
      "Release continuation blocked; inspect the retained publication intent\n",
    );
    process.exitCode = 1;
  }
}
