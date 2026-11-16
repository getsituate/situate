import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createQualificationHost } from "../infrastructure/releases/qualification-host.mjs";
import { captureQualificationDeviceState } from "../client/scripts/final-artifact-qualification.mjs";
import { withReleaseSSH } from "./release-environment.mjs";
import {
  checkpointFile,
  validateRestoredCheckpoint,
} from "./release-checkpoint.mjs";
import { checkpointRecoveryAdapters } from "./release-checkpoint-recovery.mjs";
import { createQualificationRuntimeAuthorization } from "./release-runtime-authorization.mjs";
import { prepareReleaseRuntime } from "./release-runtime.mjs";
import { digest, operationDirectory, validatePlan } from "./pipeline-state.mjs";

async function originalAttempt(plan, environment) {
  const identity = /^actions-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(plan.operation);
  if (!identity) return;
  const response = await fetch(
    `https://api.github.com/repos/getsituate/situate/actions/runs/${identity[1]}/attempts/${identity[2]}`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/vnd.github+json",
        ...(environment.GH_TOKEN
          ? { Authorization: `Bearer ${environment.GH_TOKEN}` }
          : {}),
      },
    },
  );
  assert(response.ok, "Cannot verify the original creation attempt");
  let bytes = "";
  for await (const chunk of response.body) {
    bytes += Buffer.from(chunk).toString("utf8");
    assert(
      Buffer.byteLength(bytes) <= 1024 * 1024,
      "Original attempt observation exceeds its size limit",
    );
  }
  const run = JSON.parse(bytes);
  assert(
    String(run.id) === identity[1] &&
      String(run.run_attempt) === identity[2] &&
      run.repository?.id === 1455575895 &&
      run.head_sha === plan.source &&
      run.head_branch === "main" &&
      run.event === "push" &&
      run.path === ".github/workflows/release-macos.yml" &&
      run.status === "completed",
    "The exact original creation attempt must have ended before recovery",
  );
}

function runnerIdentity(configuration, plan, environment, account, platform) {
  assert(
    platform === "darwin" && account.uid > 500,
    "Qualification recovery requires an isolated macOS account",
  );
  const hosted = environment.GITHUB_ACTIONS === "true";
  if (hosted) {
    assert(
      environment.CI === "true" &&
        environment.RUNNER_ENVIRONMENT === "github-hosted" &&
        environment.RUNNER_OS === "macOS" &&
        environment.GITHUB_REPOSITORY === "getsituate/situate" &&
        environment.GITHUB_REF === "refs/heads/main" &&
        environment.GITHUB_REF_PROTECTED === "true" &&
        environment.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        environment.GITHUB_WORKFLOW_REF ===
          "getsituate/situate/.github/workflows/release-recovery.yml@refs/heads/main",
      "Qualification recovery requires the protected main recovery workflow",
    );
    assert(
      /^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ID ?? "") &&
        /^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ATTEMPT ?? "") &&
        `actions-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}` !==
          plan.operation,
      "Qualification recovery requires a different runner attempt",
    );
  } else {
    const original = configuration.qualification?.account;
    assert(
      original?.mode === "ephemeral-host" &&
        original.uid === account.uid &&
        original.name === account.username &&
        original.home === account.homedir,
      "Local preparation requires the explicitly configured disposable account",
    );
  }
}

async function prepare(
  root,
  {
    plan,
    record,
    directory,
    inspection,
    recoveryAuthorization,
    environment = process.env,
    signal,
    adapters = {},
  },
) {
  validatePlan(plan);
  const retained = validateRestoredCheckpoint(
    recoveryAuthorization.descriptor,
    directory,
    plan,
  );
  assert(
    record.sha256 === plan.configurationDigest &&
      digest(retained.configurationBytes) === record.sha256 &&
      digest(record.bytes) === record.sha256 &&
      isDeepStrictEqual(
        JSON.parse(retained.configurationBytes),
        record.configuration,
      ),
    "Recovery requires the exact original configuration",
  );
  const configuration = record.configuration;
  const account = adapters.account ?? userInfo();
  runnerIdentity(
    configuration,
    plan,
    environment,
    account,
    adapters.platform ?? process.platform,
  );
  assert(
    recoveryAuthorization.operationId === plan.operation &&
      recoveryAuthorization.planDigest === plan.authorizationDigest &&
      recoveryAuthorization.inspectionDigest ===
        inspection.reconciliationDigest,
    "Recovery preparation requires the inspected restore authorization",
  );
  const { reconciliationDigest, ...observation } = inspection;
  assert(
    digest(observation) === reconciliationDigest,
    "Recovery inspection changed",
  );
  signal?.throwIfAborted();
  await (adapters.readOriginalAttempt ?? originalAttempt)(plan, environment);
  (adapters.captureDeviceState ?? captureQualificationDeviceState)({
    home: account.homedir,
    uid: account.uid,
    identifier: JSON.parse(retained.manifestBytes).artifacts[0].identifier,
  });
  const routeNonce = adapters.routeNonce?.() ?? `qualification-${randomUUID()}`;
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(routeNonce) &&
      routeNonce !== plan.operation,
    "Select a fresh qualification route nonce",
  );
  const temporary = operationDirectory(root, routeNonce);
  assert(
    !existsSync(temporary),
    "Qualification preparation already exists; inspect it instead of replaying",
  );
  const parent = dirname(temporary);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  assert(
    parentStat.uid === process.getuid() && (parentStat.mode & 0o077) === 0,
    "Qualification preparation requires owned private storage",
  );
  mkdirSync(temporary, { mode: 0o700 });
  const predecessor = configuration.qualification.predecessor;
  const predecessorDirectory = join(temporary, "predecessor");
  mkdirSync(predecessorDirectory, { mode: 0o700 });
  const previous = predecessor.manifest.artifacts[0];
  for (const [source, name] of [
    ["predecessor-manifest.json", "manifest.json"],
    ...[
      previous.path,
      previous.updater.path,
      previous.updater.signaturePath,
    ].map((name) => [`predecessor-${name}`, name]),
  ]) {
    assert(
      /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name),
      "Invalid retained predecessor asset name",
    );
    const path = join(directory, source);
    const stat = lstatSync(path);
    assert(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        stat.uid === process.getuid() &&
        (stat.mode & 0o077) === 0,
      "Retained predecessor assets must be owned private files",
    );
    copyFileSync(
      path,
      join(predecessorDirectory, name),
      constants.COPYFILE_EXCL,
    );
  }
  return withReleaseSSH({ root, environment }, async (preparedEnvironment) => {
    const inspect =
      adapters.inspection ??
      (await checkpointRecoveryAdapters(root, plan, {
        environment: preparedEnvironment,
      }));
    assert(
      digest(await inspect.inspect()) === digest(inspection.remote),
      "External state changed; inspect and authorize again",
    );
    let host;
    let started = false;
    let owned = false;
    try {
      const originalResources = configuration.qualificationResources;
      const template = {
        ...configuration,
        qualification: {
          profile: "macos-direct-v1",
          tls: originalResources.tls,
          account: configuration.qualification.account,
        },
      };
      delete template.qualificationResources;
      const prospective = await (
        adapters.prepareRuntime ?? prepareReleaseRuntime
      )(
        root,
        { configuration: template, sha256: record.sha256 },
        {
          destination: plan.destination,
          operation: routeNonce,
          environment: preparedEnvironment,
          account,
          platform: adapters.platform ?? process.platform,
          ...(adapters.preparation ?? {}),
          createHost: (hostConfiguration) => {
            assert(
              hostConfiguration.publicFeedSha256 ===
                originalResources.publicFeedSha256,
              "The original public predecessor feed changed",
            );
            host = (adapters.createHost ?? createQualificationHost)(
              hostConfiguration,
              { environment: preparedEnvironment },
            );
            return {
              ...host,
              prepare: async (request) => {
                const family = await host.inspectFamily({
                  operationId: plan.operation,
                });
                assert(
                  Array.isArray(family.operations) &&
                    family.operations.every(
                      (member) =>
                        member.operationId === plan.operation &&
                        ["cleaned", "cleaned-retained"].includes(
                          member.status,
                        ) &&
                        (member.uncertain === undefined ||
                          member.uncertain === false) &&
                        member.containerRunning === false,
                    ),
                  "Prior qualification ownership is unresolved",
                );
                signal?.throwIfAborted();
                started = true;
                const facts = await host.prepare({
                  ...request,
                  operationId: plan.operation,
                  operationNonce: routeNonce,
                });
                owned = true;
                return facts;
              },
            };
          },
        },
      );
      signal?.throwIfAborted();
      const fresh = prospective.configuration;
      const qualificationRuntime = {
        qualification: {
          ...configuration.qualification,
          account: fresh.qualification.account,
          runnerImage: fresh.qualification.runnerImage,
          predecessor: {
            ...predecessor,
            directory: fresh.qualification.predecessor.directory,
          },
          routing: {
            ...configuration.qualification.routing,
            identityPath: fresh.qualification.routing.identityPath,
            identitySha256: fresh.qualification.routing.identitySha256,
            publicAddress: fresh.qualification.routing.publicAddress,
          },
        },
        qualificationResources: {
          ...originalResources,
          operation: routeNonce,
          facts: fresh.qualificationResources.facts,
        },
      };
      assert(
        digest(checkpointFile(join(directory, "configuration.json"))) ===
          record.sha256 &&
          digest(checkpointFile(join(directory, "manifest.json"))) ===
            digest(retained.manifestBytes),
        "Original restored inputs changed during preparation",
      );
      const runtimeAuthorization = createQualificationRuntimeAuthorization({
        plan,
        configuration,
        configurationBytes: retained.configurationBytes,
        manifestBytes: retained.manifestBytes,
        inspection,
        recoveryAuthorization,
        runtime: qualificationRuntime,
      });
      return { runtimeAuthorization, qualificationRuntime };
    } catch (cause) {
      if (owned) {
        try {
          await host.cleanup({
            operationId: plan.operation,
            operationNonce: routeNonce,
            retainArtifacts: true,
          });
        } catch (cleanup) {
          const error = new AggregateError(
            [cause, cleanup],
            "Qualification preparation cleanup is uncertain",
            { cause },
          );
          error.uncertain = true;
          throw error;
        }
      } else if (started && cause instanceof Error) cause.uncertain = true;
      throw cause;
    }
  });
}

export async function prepareRestoredQualificationRuntime(root, input) {
  try {
    return await prepare(root, input);
  } catch (cause) {
    const error = new Error(
      "Fresh qualification runtime preparation failed; inspect retained operation evidence",
      { cause },
    );
    error.uncertain = cause?.uncertain === true;
    throw error;
  }
}
