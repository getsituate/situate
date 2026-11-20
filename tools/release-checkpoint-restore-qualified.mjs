import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  atomicJson,
  digest,
  validatePlan,
  withOperationLock,
} from "./pipeline-state.mjs";
import { checkpointFile } from "./release-checkpoint.mjs";
import { checkpointRecoveryAdapters } from "./release-checkpoint-recovery.mjs";
import { createHostCheckpointStore } from "../infrastructure/releases/checkpoint.mjs";
import { withReleaseSSH } from "./release-environment.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

export async function restoreQualifiedCheckpoint(
  root,
  {
    plan,
    checkpointId,
    destination,
    inspection,
    confirmation,
    draftId,
    environment = process.env,
    adapters,
  } = {},
) {
  validatePlan(plan);
  assert.equal(plan.workflow, "create");
  assert(
    checkpointId && destination,
    "Select an exact passed checkpoint and fresh destination",
  );
  const { reconciliationDigest, ...observation } = inspection;
  assert.equal(
    reconciliationDigest,
    digest(observation),
    "Inspection digest differs",
  );
  assert.equal(
    confirmation,
    reconciliationDigest,
    "Confirm the exact qualified checkpoint inspection",
  );
  assert.equal(inspection.operationId, plan.operation);
  assert.equal(inspection.planDigest, plan.authorizationDigest);
  assert.equal(
    inspection.remote.reservation?.status,
    "reserved",
    "Qualified restore requires its immutable reservation tag",
  );
  const execute = async (environment, adapters) =>
    withOperationLock(root, plan.operation, async () => {
      const reader =
        adapters?.inspection ??
        (await checkpointRecoveryAdapters(root, plan, { environment }));
      assert.equal(
        digest(await reader.inspect()),
        digest(inspection.remote),
        "External state changed; inspect qualified restoration again",
      );
      const host = {
        WEBSITE_DEPLOY_HOST: plan.destination,
        WEBSITE_SSH_IDENTITY: environment.WEBSITE_SSH_IDENTITY,
        WEBSITE_SSH_KNOWN_HOSTS: environment.WEBSITE_SSH_KNOWN_HOSTS,
      };
      const store =
        adapters?.store ?? createHostCheckpointStore(host, { environment });
      const result = await store.restoreQualified({
        plan,
        checkpointId,
        destination,
        inspectionDigest: inspection.remote.checkpoints.inspectionDigest,
        draftId,
      });
      const operation = JSON.parse(
        checkpointFile(join(destination, "operation.json")),
      );
      assert.deepEqual(
        operation.reservation,
        inspection.remote.reservation.reservation,
        "Qualified restore reservation differs from inspected tag",
      );
      const mappingFile = join(destination, "qualified-mapping.json");
      atomicJson(mappingFile, { schemaVersion: 1, ...result.mapping });
      return { status: "restored-qualified", ...result, mappingFile };
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
    options: Object.fromEntries(
      ["plan", "checkpoint", "destination", "inspection", "confirm"].map(
        (key) => [key, { type: "string" }],
      ),
    ),
  });
  assert(
    values.plan && values.inspection,
    "Select original --plan FILE and fresh --inspection FILE",
  );
  const observation = JSON.parse(checkpointFile(values.inspection));
  const inspection = observation.reconciliationDigest
    ? observation
    : { ...observation, reconciliationDigest: digest(observation) };
  return restoreQualifiedCheckpoint(root, {
    plan: JSON.parse(checkpointFile(values.plan)),
    checkpointId: values.checkpoint,
    destination: values.destination,
    inspection,
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
      "Qualified checkpoint restoration blocked; inspect retained state\n",
    );
    process.exitCode = 1;
  }
}
