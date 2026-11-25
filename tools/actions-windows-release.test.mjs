import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { releaseHistoryPlugin } from "../client/scripts/release-history.mjs";
import { canonical, catalogDigest, digest } from "./release-catalog.mjs";

const script = fileURLToPath(
  new URL("./actions-windows-release.mjs", import.meta.url),
);

test("the Windows build receives the history and migration inputs bound to its reserved version", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "windows-release-actions-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const mock = join(temp, "mock-download.mjs");
  writeFileSync(
    mock,
    `import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { copyFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, join } from "node:path";
import timers from "node:timers/promises";
let calls = 0;
timers.setTimeout = async () => {};
childProcess.spawnSync = (command, args) => {
  assert(isAbsolute(command));
  if (args[0] === "api") {
    assert.deepEqual(args, ["api", "repos/getsituate/situate/actions/runs/123/attempts/2/jobs?per_page=100"]);
    const job = {
      name: "Create GitHub Release",
      status: process.env.MOCK_JOB_FAILED ? "completed" : "in_progress",
      conclusion: process.env.MOCK_JOB_FAILED ? "failure" : null,
    };
    return { status: 0, stdout: JSON.stringify({ jobs: [job] }) };
  }
  assert.deepEqual(args.slice(0, -1), [
    "run", "download", "123", "--repo", "getsituate/situate",
    "--name", "windows-reservation-2", "--dir",
  ]);
  if (++calls === 1)
    return { status: 1, stderr: "no artifact matches any of the names or patterns provided" };
  for (const name of ["reservation.json", "release-inputs.json", "situate-release-history.json"])
    copyFileSync(join(process.env.MOCK_INPUTS, name), join(args.at(-1), name));
  return { status: 0 };
};
syncBuiltinESMExports();
`,
  );
  const source = "e".repeat(40);
  const output = join(temp, "github-output");
  const environmentFile = join(temp, "github-env");
  const reservation = join(temp, "reservation.json");
  const version = "2026.11.23";
  const catalog = {
    schemaVersion: 1,
    installedVersion: version,
    releases: [
      {
        version,
        locales: {
          en: { title: "Changes", entries: [] },
          de: { title: "Änderungen", entries: [] },
        },
      },
    ],
  };
  const catalogBytes = `${canonical(catalog)}\n`;
  const history = join(temp, "situate-release-history.json");
  writeFileSync(history, catalogBytes);
  const manifestBytes = `${canonical({
    schemaVersion: 1,
    kind: "situate-release-inputs",
    source,
    baseline: "d".repeat(40),
    version,
    build: "2026.11.23",
    tag: `v${version}`,
    fragments: [],
    fragmentDigest: digest("[]"),
    migrationMinimumVersions: { 3: "2026.11.10" },
    history: {
      file: "situate-release-history.json",
      sha256: digest(catalogBytes),
      contentSha256: catalogDigest(catalog),
    },
    previous: null,
  })}\n`;
  writeFileSync(join(temp, "release-inputs.json"), manifestBytes);
  const identity = {
    source,
    version,
    operationId: "actions-123-2",
    generatedInputDigest: digest(manifestBytes),
  };
  const env = {
    ProgramFiles: process.env.ProgramFiles,
    GITHUB_REPOSITORY: "getsituate/situate",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF:
      "getsituate/situate/.github/workflows/release-macos.yml@refs/heads/main",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: source,
    GITHUB_OUTPUT: output,
    GITHUB_ENV: environmentFile,
    MOCK_INPUTS: temp,
    RUNNER_TEMP: temp,
  };
  const run = (overrides) =>
    spawnSync(
      process.execPath,
      ["--import", pathToFileURL(mock).href, script, "version"],
      {
        env: { ...env, ...overrides },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
  writeFileSync(reservation, JSON.stringify(identity));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), `version=${version}\n`);
  const selected = readFileSync(environmentFile, "utf8");
  const inputs = Object.fromEntries(
    selected
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
  assert.equal(inputs.SITUATE_MIGRATION_MINIMUM_VERSIONS, '{"3":"2026.11.10"}');
  const frontend = await releaseHistoryPlugin({
    version,
    environment: { ...inputs, SITUATE_RELEASE_VERSION: version },
  }).config();
  assert.deepEqual(
    JSON.parse(frontend.define.__SITUATE_RELEASE_HISTORY__),
    catalog,
  );

  const failedProducer = run({ MOCK_JOB_FAILED: "1" });
  assert.notEqual(failedProducer.status, 0);
  assert.match(failedProducer.stderr, /Create GitHub Release did not succeed/);
  assert.notEqual(run({ GITHUB_SHA: "f".repeat(40) }).status, 0);
  writeFileSync(
    reservation,
    JSON.stringify({ ...identity, operationId: "actions-123-1" }),
  );
  assert.notEqual(run().status, 0);
  writeFileSync(reservation, JSON.stringify(identity));
  writeFileSync(history, `${catalogBytes} \n`);
  const tampered = run();
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /Sealed catalog bytes differ/);
  assert.equal(readFileSync(environmentFile, "utf8"), selected);
  assert.equal(readFileSync(output, "utf8"), `version=${version}\n`);
});
