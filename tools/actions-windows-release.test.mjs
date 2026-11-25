import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("./actions-windows-release.mjs", import.meta.url),
);

test("the Windows build accepts the reserved version only from its own checkout and attempt", (t) => {
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
childProcess.spawnSync = (command, args) => {
  assert(isAbsolute(command));
  assert.deepEqual(args.slice(0, -1), [
    "run", "download", "123", "--repo", "getsituate/situate",
    "--name", "windows-reservation-2", "--dir",
  ]);
  copyFileSync(process.env.MOCK_RESERVATION, join(args.at(-1), "reservation.json"));
  return { status: 0 };
};
syncBuiltinESMExports();
`,
  );
  const source = "e".repeat(40);
  const output = join(temp, "github-output");
  const reservation = join(temp, "test-reservation.json");
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
    MOCK_RESERVATION: reservation,
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
  writeFileSync(
    reservation,
    JSON.stringify({
      source,
      version: "2026.11.23",
      operationId: "actions-123-2",
    }),
  );
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), "version=2026.11.23\n");
  assert.notEqual(run({ GITHUB_SHA: "f".repeat(40) }).status, 0);
  writeFileSync(
    reservation,
    JSON.stringify({
      source,
      version: "2026.11.23",
      operationId: "actions-123-1",
    }),
  );
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(output, "utf8"), "version=2026.11.23\n");
});
