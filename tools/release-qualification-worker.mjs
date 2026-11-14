import assert from "node:assert/strict";
import { readFileSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { runCoordinated } from "./run-coordinated.mjs";
import { parseArgs } from "node:util";
import { qualificationEnvironment } from "./release-runtime.mjs";
import { writeQualificationReceipt } from "./release-qualification.mjs";
import { createFinalArtifactQualificationHost } from "../client/scripts/final-artifact-qualification.mjs";

export async function qualifyFinalArtifacts({
  directory,
  configuration,
  configurationSha256,
  signal,
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
  const safeEnvironment = qualificationEnvironment(environment);
  const host = createHost(parsed.qualification, {
    environment: safeEnvironment,
    signal,
  });
  return writeReceipt({ directory, qualificationHost: host, signal });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.env.SITUATE_COORDINATED_DESKTOP !== "1") {
    try {
      process.exitCode = await runCoordinated({
        directory: fileURLToPath(new URL("../", import.meta.url)),
        resource: "desktop",
        command: process.execPath,
        args: process.argv.slice(1),
        environment: qualificationEnvironment(process.env),
        cleanupGraceMs: 75_000,
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
      const { values } = parseArgs({
        options: {
          directory: { type: "string" },
          configuration: { type: "string" },
          "configuration-sha256": { type: "string" },
        },
      });
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
        signal: abort.signal,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
}
