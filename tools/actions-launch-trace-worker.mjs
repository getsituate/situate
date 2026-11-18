import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createLaunchTraceAdapters } from "../client/scripts/release-launch-trace.mjs";
import { qualifyFinalArtifacts } from "./release-qualification-worker.mjs";
import { qualificationProgressWriter } from "./qualification-progress.mjs";
import { qualificationEnvironment } from "./release-runtime.mjs";
import { runCoordinated } from "./run-coordinated.mjs";

export async function traceFinalArtifactLaunch({
  traceFile,
  progress = () => {},
  qualify = qualifyFinalArtifacts,
  ...input
}) {
  const adapters = createLaunchTraceAdapters(traceFile);
  let phase = "candidate_payload";
  const report = (name, status, command = "none", elapsedMs) => {
    if (command === "none") phase = name;
    progress(name, status, command, elapsedMs);
  };
  const execute = adapters.createProcess({
    progress: report,
    getPhase: () => phase,
  });
  await qualify({
    ...input,
    progress: report,
    createHost: (configuration, options) =>
      adapters.createHost(configuration, { ...options, execute }),
  });
  assert.fail("Launch tracing cannot complete product qualification");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      directory: { type: "string" },
      configuration: { type: "string" },
      "configuration-sha256": { type: "string" },
      "progress-file": { type: "string" },
      "runtime-authorization": { type: "string" },
      "runtime-authorization-sha256": { type: "string" },
      "launch-trace": { type: "string" },
    },
  });
  const progress = values["progress-file"]
    ? qualificationProgressWriter(resolve(values["progress-file"]))
    : () => {};
  if (process.env.SITUATE_COORDINATED_DESKTOP !== "1") {
    try {
      progress("desktop", "queued");
      process.exitCode = await runCoordinated({
        directory: fileURLToPath(new URL("../", import.meta.url)),
        resource: "desktop",
        command: process.execPath,
        args: process.argv.slice(1),
        environment: qualificationEnvironment(process.env),
        cleanupGraceMs: 75000,
        onTiming: (event) => {
          if (
            event.resource === "desktop" &&
            ["acquired", "released"].includes(event.phase)
          )
            progress("desktop", event.phase);
        },
      });
    } catch {
      process.stderr.write("Launch trace desktop ownership failed\n");
      process.exitCode = 1;
    }
  } else {
    const abort = new AbortController(),
      cancel = () => abort.abort(new Error("Launch trace cancelled"));
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    try {
      assert(
        values.directory &&
          values.configuration &&
          values["runtime-authorization"] &&
          values["launch-trace"] &&
          /^[a-f0-9]{64}$/.test(values["configuration-sha256"] ?? "") &&
          /^[a-f0-9]{64}$/.test(values["runtime-authorization-sha256"] ?? ""),
        "Select exact recovery artifacts and private trace storage",
      );
      await traceFinalArtifactLaunch({
        directory: resolve(values.directory),
        configuration: resolve(values.configuration),
        configurationSha256: values["configuration-sha256"],
        runtimeAuthorization: values["runtime-authorization"],
        runtimeAuthorizationSha256: values["runtime-authorization-sha256"],
        traceFile: resolve(values["launch-trace"]),
        signal: abort.signal,
        progress,
      });
    } catch {
      process.stderr.write(
        "Launch diagnostic stopped without qualification evidence\n",
      );
    } finally {
      process.exitCode = 1;
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
}
