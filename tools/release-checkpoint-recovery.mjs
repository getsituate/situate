import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { digest, validatePlan } from "./pipeline-state.mjs";
import { createHostCheckpointStore } from "../infrastructure/releases/checkpoint.mjs";
import { createGitReservationAdapter } from "./release-reservation.mjs";
import { collectFragments } from "./change-fragments.mjs";
import {
  inspectCandidateReservation,
  verifiedBuilds,
} from "./pipeline-operations.mjs";
import { validateRestoredCheckpoint } from "./release-checkpoint.mjs";

export async function checkpointRecoveryAdapters(
  root,
  plan,
  { environment = process.env, checkpointStore, reservationAdapter } = {},
) {
  validatePlan(plan);
  assert.equal(
    plan.workflow,
    "create",
    "Only creation checkpoints may be restored",
  );
  const host = {
    WEBSITE_DEPLOY_HOST: plan.destination,
    WEBSITE_SSH_IDENTITY: environment.WEBSITE_SSH_IDENTITY,
    WEBSITE_SSH_KNOWN_HOSTS: environment.WEBSITE_SSH_KNOWN_HOSTS,
  };
  const checkpoints =
    checkpointStore ?? createHostCheckpointStore(host, { environment });
  const allocator =
    reservationAdapter ??
    createGitReservationAdapter({
      root,
      hostConfig: host,
      environment,
      readVerifiedBuilds: (snapshot) =>
        verifiedBuilds(root, plan, snapshot, environment),
    });
  return {
    async inspect() {
      const fragments = collectFragments(root, {
        base: plan.baseline.source,
        head: plan.source,
      }).map(({ id, path, sha256 }) => ({ id, path, sha256 }));
      const reservation = await inspectCandidateReservation(
        {
          operationId: plan.operation,
          sourceRevision: plan.source,
          fragmentDigest: digest(fragments),
        },
        allocator,
      );
      const state = await checkpoints.inspect({ plan });
      return {
        checkpoints: state,
        reservation,
        coordination: state.coordination,
        notarization: state.notarization,
        githubRelease: null,
      };
    },
    async restore({ observation, checkpointId, destination }) {
      assert.equal(
        observation.remote.reservation?.status,
        "reserved",
        "Restore requires an immutable reserved tag",
      );
      const result = await checkpoints.restore({
        plan,
        checkpointId,
        inspectionDigest: observation.remote.checkpoints.inspectionDigest,
        destination,
      });
      const retained = validateRestoredCheckpoint(
        result.descriptor,
        destination,
        plan,
      );
      assert.deepEqual(
        retained.operation.reservation,
        observation.remote.reservation.reservation,
        "Restored reservation differs from inspected tag",
      );
      return {
        ...result,
        manifestSha256: digest(
          readFileSync(join(destination, "manifest.json")),
        ),
      };
    },
  };
}
