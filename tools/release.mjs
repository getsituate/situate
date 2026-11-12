import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  catalogDigest,
  readJson,
  safePath,
  validateReleaseForBuild,
  validatePreparedRelease,
} from "./release-catalog.mjs";
import {
  approveRelease,
  currentVersion,
  finalizeRelease,
  generateRelease,
  prepareRelease,
  releaseStatus,
  setVersion,
  translateRelease,
  withReleaseLock,
} from "./release-preparation.mjs";
import { createReleaseAgent } from "./release-agent.mjs";
import {
  acceptLocalTranslations,
  completeLocal,
  localTarget,
  startLocal,
} from "./release-local.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

export async function runReleaseCommand(
  root,
  argv,
  { agent, signal, herdr } = {},
) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: Object.fromEntries([
      ...[
        "version",
        "distribution",
        "baseline",
        "revision",
        "source-hash",
        "provider",
        "model",
        "api-key-env",
        "date",
        "feedback",
      ].map((key) => [key, { type: "string" }]),
      ...[
        "json",
        "allow-model-call",
        "retry-failed-model-call",
        "revise-draft",
      ].map((key) => [key, { type: "boolean" }]),
    ]),
  });
  const [command] = positionals;
  if (
    positionals.length !== 1 ||
    ![
      "status",
      "start-local",
      "complete-local",
      "accept-local-translations",
      "prepare",
      "generate",
      "approve",
      "translate",
      "finalize",
      "validate",
      "set-version",
    ].includes(command)
  )
    throw new Error(
      "Usage: tools/release.mjs <status|start-local|complete-local|accept-local-translations|prepare|generate|approve|translate|finalize|validate|set-version> [--version major.minor.patch]",
    );
  if (
    ["start-local", "complete-local", "accept-local-translations"].includes(
      command,
    ) &&
    !values.version
  )
    throw new Error("Select an explicit --version major.minor.patch");
  const version =
    values.version ??
    (command === "status" ? localTarget(root) : currentVersion(root));
  if (command === "status") return releaseStatus(root, version);
  if (command === "validate") {
    if (
      values.distribution &&
      !["direct", "external"].includes(values.distribution)
    )
      throw new Error("Choose --distribution direct or external");
    const direct = values.distribution === "direct";
    const catalog = direct
      ? validatePreparedRelease(root, version)
      : validateReleaseForBuild(root, version);
    const migrationQualification = direct
      ? (await import("./published-migrations.mjs")).qualifyPublishedMigrations(
          root,
        )
      : (await import("./migration-history.mjs")).qualifyMigrationHistory(root);
    return {
      version,
      phase: "ready",
      sha256: catalogDigest(catalog),
      migrationQualification,
    };
  }
  return withReleaseLock(root, async () => {
    if (command === "start-local")
      return startLocal(root, version, {
        baseline: values.baseline,
        signal,
        herdr,
      });
    if (command === "complete-local")
      return completeLocal(root, version, { signal });
    if (command === "accept-local-translations")
      return acceptLocalTranslations(root, version, values["source-hash"]);
    if (command === "prepare")
      return prepareRelease(root, version, {
        baseline: values.baseline,
        revision: values.revision,
      });
    if (command === "approve")
      return approveRelease(root, version, values["source-hash"]);
    if (command === "finalize")
      return finalizeRelease(root, version, { date: values.date });
    if (command === "set-version") return setVersion(root, version);
    let config = {};
    const configFile = safePath(root, ".release-preparation/agent.json");
    if (fs.existsSync(configFile))
      config = readJson(root, ".release-preparation/agent.json");
    for (const [key, value] of [
      ["provider", values.provider],
      ["model", values.model],
      ["apiKeyEnv", values["api-key-env"]],
    ])
      if (value !== undefined) config[key] = value;
    const options = {
      signal,
      reviseDraft: values["revise-draft"],
      feedback: values.feedback,
      retryFailedModelCall: values["retry-failed-model-call"],
      agentIdentity: agent
        ? "injected"
        : { provider: config.provider, model: config.model },
    };
    const invoke =
      agent ??
      createReleaseAgent(config, {
        allowModelCall: values["allow-model-call"],
      });
    return command === "generate"
      ? generateRelease(root, version, invoke, options)
      : translateRelease(root, version, invoke, options);
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new Error("Release preparation cancelled"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const main = async () => {
    if (process.argv[2] !== "status" && !coordinated(root)) {
      process.exitCode = await runCoordinated({
        directory: root,
        command: process.execPath,
        args: process.argv.slice(1),
        signal: controller.signal,
      });
      return;
    }
    const result = await runReleaseCommand(root, process.argv.slice(2), {
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2)}\n`,
    );
  };
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
