import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sealPlan } from "./pipeline-state.mjs";

test("the pipeline CLI loads host-Docker and portable lane dependencies without an import cycle", (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-pipeline-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repository");
  mkdirSync(join(root, "tools"), { recursive: true });
  for (const name of [
    "pipeline.mjs",
    "pipeline-state.mjs",
    "pipeline-environment.mjs",
    "pipeline-container.mjs",
    "run-coordinated.mjs",
    "worktree-supervisor.py",
  ])
    copyFileSync(
      new URL(`./${name}`, import.meta.url),
      join(root, "tools", name),
    );
  writeFileSync(
    join(root, "tools/test.mjs"),
    `
export function sourceFiles() { return []; }
export function suiteInventory() { return [{ id: "fixture-check", project: "runner", kind: "integration", cwd: "." }]; }
export async function runPlan(plan, options) {
  if (options.environment.OPENAI_API_KEY) throw new Error("Unexpected provider credential");
  return { status: "passed", results: [{ id: "fixture-check", status: "passed", exitCode: 0 }] };
}
`,
  );
  writeFileSync(
    join(root, "tools/pipeline-container.py"),
    `
import json, sys
plan = json.load(open(sys.argv[3]))
result = {"schemaVersion": 1, "source": plan["source"], "planDigest": plan["authorizationDigest"], "lane": sys.argv[4], "host": "linux", "executionHost": "linux", "status": "passed", "results": [{"id": "fixture-check", "status": "passed", "exitCode": 0}]}
with open(sys.argv[5], "w") as output:
    json.dump(result, output)
`,
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic Maintainer");
  git("config", "user.email", "maintainer@example.invalid");
  git("add", ".");
  git("commit", "-qm", "test: lane fixture");
  const source = git("rev-parse", "HEAD");
  const environment = {
    ...process.env,
    OPENAI_API_KEY: "synthetic-provider",
    SITUATE_TOOL_CONTAINER: "",
  };
  delete environment.SITUATE_COORDINATED_WORKTREE;
  delete environment.SITUATE_DOCKER_LEASE;
  for (const execution of ["host-docker", "container"]) {
    const lane = {
      id: execution,
      host: "linux",
      suites: ["fixture-check"],
      ...(execution === "host-docker" ? { execution } : {}),
    };
    const plan = sealPlan({
      schemaVersion: 1,
      workflow: "verify",
      source,
      base: source,
      appImpact: false,
      lanes: [lane],
    });
    const planFile = join(directory, `${execution}-plan.json`);
    const receiptFile = join(directory, `${execution}-receipt.json`);
    writeFileSync(planFile, JSON.stringify(plan));
    const child = spawnSync(
      process.execPath,
      [
        join(root, "tools/pipeline.mjs"),
        "run",
        "verify",
        "--plan",
        planFile,
        "--lane",
        execution,
        "--receipt",
        receiptFile,
      ],
      {
        cwd: root,
        env: environment,
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(child.status, 0, `${execution}: ${child.stderr}`);
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.lane, execution);
    assert.equal(receipt.source, source);
    assert.equal(receipt.planDigest, plan.authorizationDigest);
    assert.deepEqual(receipt.results, [
      { id: "fixture-check", status: "passed", exitCode: 0 },
    ]);
  }
});
