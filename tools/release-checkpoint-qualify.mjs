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
  createCheckpoint,
  validateRestoredCheckpoint,
} from "./release-checkpoint.mjs";
import { validateQualificationRuntimeAuthorization } from "./release-runtime-authorization.mjs";
import { checkpointRecoveryAdapters } from "./release-checkpoint-recovery.mjs";
import { createHostCheckpointStore } from "../infrastructure/releases/checkpoint.mjs";
import { withReleaseSSH } from "./release-environment.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

export async function requalifyCheckpoint(
  root,
  {
    recoveryAuthorization,
    inspection,
    runtimeAuthorization,
    environment = process.env,
    signal,
    adapters,
  } = {},
) {
  const directory = recoveryAuthorization.directory;
  const plan = JSON.parse(checkpointFile(join(directory, "plan.json")));
  const retained = validateRestoredCheckpoint(
    recoveryAuthorization.descriptor,
    directory,
    plan,
  );
  const configuration = JSON.parse(retained.configurationBytes);
  const input = {
    plan,
    configuration,
    configurationBytes: retained.configurationBytes,
    manifestBytes: retained.manifestBytes,
    inspection,
    recoveryAuthorization,
  };
  const qualificationRuntime = validateQualificationRuntimeAuthorization(
    runtimeAuthorization,
    input,
  );
  const execute = async (environment, adapters) =>
    withOperationLock(root, plan.operation, async () => {
      const inspectionAdapters =
        adapters?.inspection ??
        (await checkpointRecoveryAdapters(root, plan, { environment }));
      const observed = await inspectionAdapters.inspect();
      assert.equal(
        digest(observed),
        digest(inspection.remote),
        "External state changed; inspect and authorize again",
      );
      const host = {
        WEBSITE_DEPLOY_HOST: plan.destination,
        WEBSITE_SSH_IDENTITY: environment.WEBSITE_SSH_IDENTITY,
        WEBSITE_SSH_KNOWN_HOSTS: environment.WEBSITE_SSH_KNOWN_HOSTS,
      };
      const store =
        adapters?.store ?? createHostCheckpointStore(host, { environment });
      const attemptFile = join(
        operationDirectory(root, plan.operation),
        `qualification-${runtimeAuthorization.routeNonce}.json`,
      );
      assert(
        !existsSync(attemptFile),
        "Qualification attempt exists; inspect instead of replaying",
      );
      const attempt = {
        schemaVersion: 1,
        operationId: plan.operation,
        authorizationDigest: runtimeAuthorization.authorizationDigest,
        status: "intent",
      };
      atomicJson(attemptFile, attempt);
      const persist = async () => {
        const operation = {
          ...retained.operation,
          qualificationAttempt: attempt,
        };
        const checkpoint = createCheckpoint({
          kind: "runtime-authorization",
          operation,
          planBytes: checkpointFile(join(directory, "plan.json")),
          configurationBytes: retained.configurationBytes,
          authorization: runtimeAuthorization,
          recoveryAuthorization,
          inspection,
          ...(attempt.status === "passed"
            ? { receiptBytes: checkpointFile(attempt.receipt.path) }
            : {}),
        });
        const acknowledgement = await store.commit(checkpoint);
        assert(
          acknowledgement?.durable === true &&
            acknowledgement.checkpointId === checkpoint.descriptor.checkpointId,
          "Qualification checkpoint has no durable acknowledgement",
        );
        return acknowledgement;
      };
      await persist();
      let qualify = adapters?.qualify;
      if (!qualify) {
        const runtime = await import("./release-runtime.mjs");
        assert.equal(
          runtime.qualificationRuntimeAuthorizationVersion,
          1,
          "Runtime does not support explicit recovery authorization",
        );
        qualify = runtime.runPreparedQualification;
      }
      try {
        const result = await qualify(root, {
          plan,
          record: {
            bytes: retained.configurationBytes.toString("utf8"),
            file: join(directory, "configuration.json"),
            sha256: plan.configurationDigest,
            configuration,
          },
          configuration,
          directory,
          qualificationRuntime,
          runtimeAuthorization,
          inspection,
          recoveryAuthorization,
          environment,
          signal,
        });
        assert(
          result?.receipt?.sourceRevision === plan.source &&
            result.receipt.manifestSha256 ===
              runtimeAuthorization.manifestSha256 &&
            result.receipt.runtimeAuthorizationDigest ===
              runtimeAuthorization.authorizationDigest,
          "Qualification receipt differs from original manifest or runtime authorization",
        );
        assert.equal(
          result.path,
          join(directory, "release-qualification.json"),
          "Qualification receipt path is not owned restored output",
        );
        assert.deepEqual(
          JSON.parse(checkpointFile(result.path)),
          result.receipt,
          "Qualification receipt file differs from worker output",
        );
        attempt.status = "passed";
        attempt.receipt = result;
        const qualified = await persist();
        atomicJson(attemptFile, attempt);
        return {
          status: "qualified",
          checkpointId: qualified.checkpointId,
          operationId: plan.operation,
          authorizationDigest: runtimeAuthorization.authorizationDigest,
          receipt: result,
        };
      } catch (error) {
        attempt.status = "unknown";
        atomicJson(attemptFile, attempt);
        await persist();
        throw error;
      }
    });
  return adapters
    ? execute(environment, adapters)
    : withReleaseSSH({ root, environment }, (prepared) => execute(prepared));
}
export async function main(
  argv = process.argv.slice(2),
  { root = resolve(import.meta.dirname, ".."), ...options } = {},
) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "restore-authorization": { type: "string" },
      inspection: { type: "string" },
      "runtime-authorization": { type: "string" },
      "prepare-runtime": { type: "boolean" },
    },
  });
  const read = (name) => {
    assert(values[name], `Select --${name} FILE`);
    return JSON.parse(readFileSync(values[name], "utf8"));
  };
  const recoveryAuthorization = read("restore-authorization");
  const observation = values.inspection
    ? read("inspection")
    : recoveryAuthorization.inspection;
  assert(
    observation,
    "Select --inspection FILE with the original restoration inspection",
  );
  const inspection = observation.reconciliationDigest
    ? observation
    : { ...observation, reconciliationDigest: digest(observation) };
  assert(
    !(values["prepare-runtime"] && values["runtime-authorization"]),
    "Select either --prepare-runtime or --runtime-authorization FILE",
  );
  let runtimeAuthorization;
  if (values["prepare-runtime"]) {
    const directory = recoveryAuthorization.directory;
    const plan = JSON.parse(checkpointFile(join(directory, "plan.json")));
    const retained = validateRestoredCheckpoint(
      recoveryAuthorization.descriptor,
      directory,
      plan,
    );
    const record = {
      bytes: retained.configurationBytes.toString("utf8"),
      file: join(directory, "configuration.json"),
      sha256: plan.configurationDigest,
      configuration: JSON.parse(retained.configurationBytes),
    };
    const prepare =
      options.adapters?.prepareRuntime ??
      (await import("./release-runtime-recovery.mjs"))
        .prepareRestoredQualificationRuntime;
    ({ runtimeAuthorization } = await prepare(root, {
      plan,
      record,
      directory,
      inspection,
      recoveryAuthorization,
      environment: options.environment ?? process.env,
      signal: options.signal,
    }));
  } else runtimeAuthorization = read("runtime-authorization");
  return requalifyCheckpoint(root, {
    recoveryAuthorization,
    inspection,
    runtimeAuthorization,
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
      "Restored qualification blocked; inspect the retained attempt\n",
    );
    process.exitCode = 1;
  }
}
