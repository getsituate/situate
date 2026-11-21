import assert from "node:assert/strict";
import { readFileSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { runCoordinated } from "./run-coordinated.mjs";
import { qualificationProgressWriter } from "./qualification-progress.mjs";
import { createQualificationProcess } from "../client/scripts/final-artifact-process.mjs";
import { parseArgs } from "node:util";
import { qualificationEnvironment } from "./release-runtime.mjs";
import { writeQualificationReceipt } from "./release-qualification.mjs";
import { createFinalArtifactQualificationHost } from "../client/scripts/final-artifact-qualification.mjs";

export async function qualifyFinalArtifacts({
  directory,
  configuration,
  configurationSha256,
  signal,
  progress = () => {},
  runtimeAuthorization,
  runtimeAuthorizationSha256,
  environment = process.env,
  createHost = createFinalArtifactQualificationHost,
  writeReceipt = writeQualificationReceipt,
}) {
  const stat = lstatSync(configuration);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      stat.size <= 2 * 1024 * 1024 &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid(),
    "Qualification configuration must be an owned private regular file",
  );
  const bytes = readFileSync(configuration);
  assert(
    createHash("sha256").update(bytes).digest("hex") === configurationSha256,
    "Qualification configuration differs from the authorized plan",
  );
  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new Error("Qualification configuration is not valid JSON");
  }
  let qualification = parsed.qualification;
  let runtimeAuthorizationDigest;
  if (runtimeAuthorization || runtimeAuthorizationSha256) {
    assert(
      runtimeAuthorization && runtimeAuthorizationSha256,
      "Qualification recovery requires pinned runtime authorization",
    );
    const { readQualificationRuntimeEnvelope } =
      await import("./qualification-runtime-envelope.mjs");
    const recovered = await readQualificationRuntimeEnvelope(
      runtimeAuthorization,
      runtimeAuthorizationSha256,
      {
        configuration: parsed,
        configurationBytes: bytes,
        manifestBytes: readFileSync(join(directory, "manifest.json")),
      },
    );
    qualification = recovered.qualificationRuntime.qualification;
    runtimeAuthorizationDigest = recovered.runtimeAuthorizationDigest;
  }
  const safeEnvironment = qualificationEnvironment(environment);
  let phase = "candidate_payload";
  const report = (name, status, command = "none", elapsedMs) => {
    if (command === "none") phase = name;
    progress(name, status, command, elapsedMs);
  };
  const execute = createQualificationProcess({
    progress: report,
    getPhase: () => phase,
  });
  const host = createHost(qualification, {
    environment: safeEnvironment,
    signal,
    execute,
    progress: report,
  });
  return writeReceipt({
    directory,
    qualificationHost: host,
    signal,
    execute,
    env: safeEnvironment,
    progress: report,
    ...(runtimeAuthorizationDigest ? { runtimeAuthorizationDigest } : {}),
  });
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
    },
  });
  const createProgress = () =>
    values["progress-file"] !== undefined
      ? qualificationProgressWriter(resolve(values["progress-file"]))
      : () => {};
  if (process.env.SITUATE_COORDINATED_DESKTOP !== "1") {
    try {
      const progress = createProgress();
      progress("desktop", "queued");
      process.exitCode = await runCoordinated({
        directory: fileURLToPath(new URL("../", import.meta.url)),
        resource: "desktop",
        command: process.execPath,
        args: process.argv.slice(1),
        environment: qualificationEnvironment(process.env),
        cleanupGraceMs: 75_000,
        onTiming: (event) => {
          if (
            event.resource === "desktop" &&
            ["acquired", "released"].includes(event.phase)
          )
            progress("desktop", event.phase);
        },
      });
    } catch {
      process.stderr.write("Qualification desktop ownership failed\n");
      process.exitCode = 1;
    }
  } else {
    const abort = new AbortController();
    const cancel = () => abort.abort(new Error("Qualification cancelled"));
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    try {
      const progress = createProgress();
      assert(
        values.directory &&
          values.configuration &&
          /^[a-f0-9]{64}$/.test(values["configuration-sha256"] ?? ""),
        "Select exact artifacts and authorized configuration",
      );
      const result = await qualifyFinalArtifacts({
        directory: resolve(values.directory),
        configuration: resolve(values.configuration),
        configurationSha256: values["configuration-sha256"],
        runtimeAuthorization: values["runtime-authorization"],
        runtimeAuthorizationSha256: values["runtime-authorization-sha256"],
        signal: abort.signal,
        progress,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stderr.write(
        "Qualification failed; inspect fixed-code progress and retained operation\n",
      );
      process.exitCode = 1;
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
}
