import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { stableWindowsVersion } from "../client/scripts/windows-release.mjs";
import { digest, readOperation } from "./pipeline-state.mjs";
import { canonical } from "./release-catalog.mjs";
import {
  releaseCatalogFile,
  releaseInputsFile,
  verifyReleaseInputs,
} from "./release-inputs.mjs";
import { windowsInstallationPath } from "./pipeline-environment.mjs";

const env = process.env;
assert.equal(env.GITHUB_REPOSITORY, "getsituate/situate");
assert.equal(env.GITHUB_REF, "refs/heads/main");
assert.equal(env.GITHUB_REF_PROTECTED, "true");
assert.equal(env.GITHUB_EVENT_NAME, "push");
assert.equal(
  env.GITHUB_WORKFLOW_REF,
  "getsituate/situate/.github/workflows/release-macos.yml@refs/heads/main",
);
for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"])
  assert.match(env[name], /^[1-9][0-9]*$/u);
assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/u);
const staging = join(env.RUNNER_TEMP, "windows-release-inputs");
const operationId = `actions-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;

async function download(name) {
  mkdirSync(staging, { recursive: true });
  const artifact = `${name}-${env.GITHUB_RUN_ATTEMPT}`;
  const minutes = name === "windows-reservation" ? 75 : 240;
  const end = Date.now() + minutes * 60_000;
  const gh =
    process.platform === "win32"
      ? windowsInstallationPath(env.ProgramFiles, "GitHub CLI", "gh.exe")
      : process.platform === "darwin"
        ? "/opt/homebrew/bin/gh"
        : "/usr/bin/gh";
  do {
    const path = mkdtempSync(join(staging, `${name}-`));
    const result = spawnSync(
      gh,
      [
        "run",
        "download",
        env.GITHUB_RUN_ID,
        "--repo",
        env.GITHUB_REPOSITORY,
        "--name",
        artifact,
        "--dir",
        path,
      ],
      { timeout: 120_000, encoding: "utf8" },
    );
    if (result.status === 0) return path;
    rmSync(path, { recursive: true, force: true });
    if (
      !/no (?:valid )?artifacts? (?:found|matches any of the names or patterns provided)/iu.test(
        result.stderr ?? "",
      )
    )
      throw new Error(`Could not download ${artifact}.`);
    await setTimeout(15_000);
  } while (Date.now() < end);
  throw new Error(`Timed out waiting for ${artifact}.`);
}

function boundInputs(manifestFile, catalogFile, source, version, inputDigest) {
  const bytes = readFileSync(manifestFile, "utf8");
  assert.equal(digest(bytes), inputDigest, "Release input manifest differs");
  const manifest = JSON.parse(bytes);
  verifyReleaseInputs(manifest, readFileSync(catalogFile, "utf8"));
  assert.equal(manifest.source, source);
  assert.equal(manifest.version, version);
  return {
    SITUATE_RELEASE_HISTORY_FILE: catalogFile,
    SITUATE_RELEASE_HISTORY_SHA256: manifest.history.contentSha256,
    SITUATE_MIGRATION_MINIMUM_VERSIONS: canonical(
      manifest.migrationMinimumVersions ?? {},
    ),
  };
}

switch (process.argv[2]) {
  case "reservation": {
    const operation = readOperation(process.cwd(), operationId);
    assert.equal(operation.plan.source, env.GITHUB_SHA);
    const inputs = operation.stages.at(-1);
    assert.equal(inputs?.name, "inputs");
    assert(operation.stages.every(({ status }) => status === "passed"));
    const { version, sourceRevision, generatedInputDigest } =
      operation.reservation;
    assert.equal(sourceRevision, env.GITHUB_SHA);
    const { manifestFile, catalogFile } = inputs.output;
    boundInputs(
      manifestFile,
      catalogFile,
      sourceRevision,
      version,
      generatedInputDigest,
    );
    mkdirSync(staging, { recursive: true });
    copyFileSync(manifestFile, join(staging, releaseInputsFile));
    copyFileSync(catalogFile, join(staging, releaseCatalogFile));
    writeFileSync(
      join(staging, "reservation.json"),
      JSON.stringify({
        version: stableWindowsVersion(version),
        source: sourceRevision,
        operationId,
        generatedInputDigest,
      }),
      { flag: "wx" },
    );
    break;
  }
  case "version": {
    const path = await download("windows-reservation");
    const {
      source,
      version,
      operationId: reserved,
      generatedInputDigest,
    } = JSON.parse(readFileSync(join(path, "reservation.json"), "utf8"));
    assert.equal(source, env.GITHUB_SHA);
    assert.equal(reserved, operationId);
    const inputs = boundInputs(
      join(path, releaseInputsFile),
      join(path, releaseCatalogFile),
      source,
      version,
      generatedInputDigest,
    );
    for (const [name, value] of Object.entries(inputs)) {
      assert(!/[\r\n]/u.test(value));
      appendFileSync(env.GITHUB_ENV, `${name}=${value}\n`);
    }
    appendFileSync(
      env.GITHUB_OUTPUT,
      `version=${stableWindowsVersion(version)}\n`,
    );
    break;
  }
  case "collect": {
    const [x64, arm64, receipt] = await Promise.all(
      ["windows-x64", "windows-arm64", "windows-qualification"].map(download),
    );
    for (const [name, path] of Object.entries({
      SITUATE_WINDOWS_X64: x64,
      SITUATE_WINDOWS_ARM64: arm64,
      SITUATE_WINDOWS_QUALIFICATION_FILE: join(receipt, "qualification.json"),
    }))
      appendFileSync(env.GITHUB_ENV, `${name}=${path}\n`);
    break;
  }
  default:
    throw new Error("Unknown Windows release stage.");
}
