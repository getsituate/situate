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
import { currentVersion, releaseStatus } from "./release-preparation.mjs";

function retainedTarget(root) {
  const file = ".release-preparation/active.json";
  return fs.existsSync(safePath(root, file))
    ? readJson(root, file).version
    : currentVersion(root);
}

export async function runReleaseCommand(root, argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "string" },
      distribution: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const [command] = positionals;
  if (positionals.length !== 1 || !["status", "validate"].includes(command))
    throw new Error(
      "Usage: node tools/release.mjs <status|validate> [--version major.minor.patch] [--distribution direct|external] [--json]",
    );
  if (
    values.distribution &&
    !["direct", "external"].includes(values.distribution)
  )
    throw new Error("Choose --distribution direct or external");
  const version =
    values.version ??
    (command === "status" ? retainedTarget(root) : currentVersion(root));
  if (command === "status") return releaseStatus(root, version);
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

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  runReleaseCommand(root, process.argv.slice(2))
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2)}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
