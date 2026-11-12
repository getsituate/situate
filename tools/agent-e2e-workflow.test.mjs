import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlan, root, sourceFiles, suiteInventory } from "./test.mjs";
import { needsBuildLease } from "./test-budget.mjs";
import { createSuiteCacheExecutor } from "./suite-cache.mjs";

const read = (path) => readFileSync(join(root, path), "utf8");

test("paid workflow is manual, trusted default branch, protected environment and pinned actions", () => {
  const workflow = read(".github/workflows/agent-live.yml");
  assert.match(workflow, /on:\n {2}workflow_dispatch:\n/);
  assert.doesNotMatch(
    workflow,
    /pull_request|pull_request_target|workflow_run|schedule:|retry|continue-on-error/,
  );
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.repository == 'getsituate\/situate'/);
  assert.match(
    workflow,
    /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/,
  );
  assert.match(workflow, /environment: agent-live/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  for (const match of workflow.matchAll(/uses: (\S+)/g))
    assert.match(match[1], /@[a-f0-9]{40}$/);
  assert.equal((workflow.match(/secrets\./g) ?? []).length, 1);
  const [setup, run] = workflow.split("      - name: Run bounded live journey");
  assert.doesNotMatch(setup, /secrets\./);
  assert.match(
    run,
    /TEST_OPENAI_API_KEY: \$\{\{ secrets\.TEST_OPENAI_API_KEY \}\}/,
  );
  assert.match(run, /--provider openai --build-timeout/);
  assert.doesNotMatch(workflow, /--allow-paid/);
  assert.match(workflow, /path: test-results\/agent-live\.json/);
  assert.doesNotMatch(workflow, /path: test-results\/\s|\.log|\.png|cache@/);
});

test("provider sockets and process teardown run in the integration profile", () => {
  const suites = suiteInventory(sourceFiles(root), "darwin");
  for (const path of [
    "client/scripts/agent-e2e-provider.integration.test.mjs",
    "client/scripts/agent-e2e-process.integration.test.mjs",
  ]) {
    const selected = suites.filter((suite) => suite.args.includes(path));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].kind, "integration");
  }
});

test("plugins fixture runs in default macOS MVP with development and ordinary source chat", async (t) => {
  const plan = createPlan({ platform: "darwin" });
  const suite = plan.suites.find(({ id }) => id === "client-plugins-e2e");
  assert.ok(suite);
  assert.equal(suite.kind, "native");
  assert.equal(suite.cwd, "client");
  assert.equal(suite.npm, "client");
  assert.equal(suite.command, process.execPath);
  assert.deepEqual(suite.args, [
    "scripts/test-agent-e2e.mjs",
    "--journey",
    "plugins",
    "--provider",
    "fixture",
    "--max-requests",
    "7",
  ]);
  assert.equal(needsBuildLease(suite), false);
  for (const profile of ["quick", "unit", "feedback", "checks", "coverage"])
    assert.ok(
      !createPlan({ platform: "darwin", [profile]: true }).suites.some(
        ({ id }) => id === suite.id,
      ),
    );
  const cacheDirectory = mkdtempSync(
    join(tmpdir(), "situate-native-suite-cache-"),
  );
  t.after(() => rmSync(cacheDirectory, { recursive: true, force: true }));
  let executions = 0;
  const execute = createSuiteCacheExecutor({
    directory: root,
    cacheDirectory,
    execute: async () => {
      executions++;
      return { status: "passed", exitCode: 0 };
    },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await execute(suite);
    assert.equal(result.cache.reason, "unsupported-suite");
  }
  assert.equal(executions, 2);
});

test("full macOS registry includes free fixture; Linux remains explicit unsupported, never paid", () => {
  const files = sourceFiles(root);
  const mac = suiteInventory(files, "darwin");
  const suite = mac.find((suite) => suite.id === "client-agent-e2e");
  assert.equal(suite.kind, "native");
  assert.deepEqual(suite.args, ["scripts/test-agent-e2e.mjs"]);
  assert.equal(suite.npm, "client");
  const onboarding = mac.find((suite) => suite.id === "client-onboarding-e2e");
  assert.equal(onboarding.kind, "native");
  assert.deepEqual(onboarding.args, [
    "scripts/test-agent-e2e.mjs",
    "--journey",
    "onboarding",
  ]);
  assert.equal(onboarding.npm, "client");
  for (const platform of ["darwin", "linux", "win32"]) {
    const suites = suiteInventory(files, platform);
    assert.ok(suites.every((suite) => !suite.args.includes("openai")));
    if (platform !== "darwin")
      assert.ok(
        suites.every(
          (suite) =>
            ![
              "client-agent-e2e",
              "client-onboarding-e2e",
              "client-plugins-e2e",
            ].includes(suite.id),
        ),
      );
  }
  const quality = read(".github/workflows/quality.yml");
  assert.match(
    quality,
    /Native agent fixture journey\n {8}run: node client\/scripts\/test-agent-e2e\.mjs --build-timeout 1800/,
  );
  assert.doesNotMatch(
    quality,
    /TEST_OPENAI_API_KEY|--provider openai|test:agent:live/,
  );
  const scripts = JSON.parse(read("client/package.json")).scripts;
  assert.equal(scripts["test:agent"], "node scripts/test-agent-e2e.mjs");
  assert.equal(
    scripts["test:agent:live"],
    "node scripts/test-agent-e2e.mjs --provider openai",
  );
});
