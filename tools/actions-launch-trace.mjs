import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCheckpointRecovery } from "./actions-recovery.mjs";
import { requalifyCheckpoint } from "./release-checkpoint-qualify.mjs";
import { runPreparedQualification } from "./release-runtime.mjs";
import { withReleaseSSH } from "./release-environment.mjs";
import { retainLaunchTrace } from "../infrastructure/releases/launch-trace.mjs";
import { run } from "../client/scripts/ios-xcode.mjs";

export async function runLaunchTrace(
  root,
  environment,
  {
    recover = runCheckpointRecovery,
    requalify = requalifyCheckpoint,
    prepared = runPreparedQualification,
    execute = run,
    retain = retainLaunchTrace,
    ssh = withReleaseSSH,
    signal,
  } = {},
) {
  signal?.throwIfAborted();
  assert(
    environment.GITHUB_WORKFLOW_REF ===
      "getsituate/situate/.github/workflows/release-launch-trace.yml@refs/heads/main" &&
      environment.RECOVERY_ACTION === "qualify",
    "Select the protected launch trace workflow",
  );
  const temporary = lstatSync(environment.RUNNER_TEMP);
  assert(
    temporary.isDirectory() &&
      !temporary.isSymbolicLink() &&
      temporary.uid === process.getuid(),
    "Launch tracing requires owned temporary storage",
  );
  const directory = mkdtempSync(
    join(environment.RUNNER_TEMP, "situate-launch-trace-"),
  );
  const traceFile = join(directory, "launch-trace.json");
  let identity,
    restoredDirectory,
    returnedQualification = false;
  try {
    await recover(root, environment, {
      workflow: "launch-trace",
      signal,
      adapters: {
        qualify: async (root, input) => {
          identity = input.recoveryAuthorization.descriptor.identity;
          restoredDirectory = input.recoveryAuthorization.directory;
          return requalify(root, {
            ...input,
            adapters: {
              qualify: (root, options) =>
                prepared(root, {
                  ...options,
                  executeWorker: (command, args, options) => {
                    assert.equal(
                      args[0],
                      join(root, "tools/release-qualification-worker.mjs"),
                    );
                    return execute(
                      command,
                      [
                        join(root, "tools/actions-launch-trace-worker.mjs"),
                        ...args.slice(1),
                        "--launch-trace",
                        traceFile,
                      ],
                      options,
                    );
                  },
                }),
            },
          });
        },
      },
    });
    returnedQualification = true;
  } catch {
    // A trace attempt stops before product journeys and must retain an unknown qualification outcome.
  }
  signal?.throwIfAborted();
  assert(
    !returnedQualification &&
      identity &&
      restoredDirectory &&
      !existsSync(join(restoredDirectory, "release-qualification.json")),
    "Launch tracing cannot produce qualification evidence",
  );
  const fd = openSync(
    traceFile,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes;
  try {
    const stat = fstatSync(fd);
    assert(
      stat.isFile() &&
        stat.nlink === 1 &&
        stat.uid === process.getuid() &&
        (stat.mode & 0o777) === 0o600 &&
        stat.size <= 256 * 1024,
      "Unsafe private launch trace",
    );
    const buffer = Buffer.alloc(256 * 1024 + 1);
    let length = 0,
      count;
    do {
      count = readSync(fd, buffer, length, buffer.length - length, null);
      length += count;
    } while (count > 0 && length < buffer.length);
    assert(length <= 256 * 1024, "Private launch trace exceeds its bound");
    bytes = buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
  const trace = JSON.parse(bytes);
  assert(
    trace.kind === "macos-launch-diagnostic" &&
      trace.qualification === false &&
      trace.launch,
    "No bounded launch trace was captured",
  );
  const traceId = randomUUID();
  const retained = await ssh({ root, environment }, (env) =>
    retain(
      {
        WEBSITE_DEPLOY_HOST: environment.WEBSITE_DEPLOY_HOST,
        WEBSITE_SSH_IDENTITY: env.WEBSITE_SSH_IDENTITY,
        WEBSITE_SSH_KNOWN_HOSTS: env.WEBSITE_SSH_KNOWN_HOSTS,
      },
      { identity, traceId, bytes, environment: env, signal },
    ),
  );
  signal?.throwIfAborted();
  return {
    status: "trace-retained",
    qualified: false,
    operation: identity.operationId,
    ...retained,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const abort = new AbortController();
  const cancel = () => abort.abort(new Error("Launch trace cancelled"));
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    console.log(
      JSON.stringify(
        await runLaunchTrace(resolve(import.meta.dirname, ".."), process.env, {
          signal: abort.signal,
        }),
      ),
    );
  } catch {
    console.error(
      "Private launch trace did not complete; inspect the retained operation before another attempt",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
