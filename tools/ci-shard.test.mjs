import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import {
  createShardPlan,
  parseOptions,
  partitionPlan,
  shards,
} from "./ci-shard.mjs";
import {
  createPlan,
  root,
  runPlan,
  sourceFiles,
  suiteInventory,
} from "./test.mjs";

const linuxSuites = () =>
  suiteInventory(sourceFiles(root), "linux").map(
    ({ covers: _covers, ...suite }) => suite,
  );
const fixture = () => ({
  profile: "all",
  suites: [
    { id: "runner-unit", kind: "unit" },
    { id: "unit", kind: "unit" },
    { id: "integration", kind: "integration" },
    { id: "check", kind: "check" },
    { id: "browser", kind: "browser" },
    { id: "workshop-chromium", kind: "browser" },
    { id: "workshop-webkit", kind: "browser" },
    { id: "native", kind: "native" },
    { id: "client-docker-context", kind: "integration" },
  ],
});

function cli(args, selection) {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.SITUATE_CI_SELECTION;
  if (selection !== undefined) environment.SITUATE_CI_SELECTION = selection;
  return spawnSync(process.execPath, ["tools/ci-shard.mjs", ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 10000,
  });
}

test("nonempty disjoint shards exactly cover the full Linux registry", () => {
  assert.deepEqual(shards, [
    "quick",
    "checks",
    "browser",
    "workshop-chromium",
    "workshop-webkit",
    "native",
    "docker",
  ]);
  const plans = shards.map((shard) =>
    createShardPlan(shard, root, undefined, { extended: true }),
  );
  const combined = plans.flatMap((plan) => plan.suites);
  assert.equal(
    new Set(combined.map((suite) => suite.id)).size,
    combined.length,
  );
  const byId = (suites) => [...suites].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(combined), byId(linuxSuites()));
  for (const plan of plans) {
    assert.ok(plan.suites.length > 0);
    assert.equal(plan.profile, "all");
    assert.equal(plan.changed, false);
    assert.equal(plan.base, null);
  }
  assert.deepEqual(
    plans[1].suites.filter(
      (suite) => !["unit", "integration", "check"].includes(suite.kind),
    ),
    [],
  );
  assert.ok(plans[2].suites.every((suite) => suite.kind === "browser"));
  for (const shard of ["workshop-chromium", "workshop-webkit"]) {
    assert.deepEqual(
      plans.find((plan) => plan.shard === shard).suites.map(({ id }) => id),
      [shard],
    );
    assert.ok(!plans[2].suites.some(({ id }) => id === shard));
  }
  assert.deepEqual(
    plans[2].suites.map(({ id }) => id),
    linuxSuites()
      .filter(
        ({ kind, id }) =>
          kind === "browser" &&
          !["workshop-chromium", "workshop-webkit"].includes(id),
      )
      .map(({ id }) => id),
  );
  assert.ok(plans[5].suites.every((suite) => suite.kind === "native"));
  assert.deepEqual(
    plans[6].suites.map((suite) => suite.id),
    ["client-docker-context", "design-website-hosting"],
  );
  const native = plans[5].suites.find((suite) => suite.id === "client-native");
  assert.equal(native.command, "dbus-run-session");
  assert.deepEqual(native.args.slice(0, 4), [
    "--",
    "xvfb-run",
    "-a",
    process.execPath,
  ]);
});

test("macOS executor boundaries are excluded from shared checks and retain their diagnostic owner", () => {
  const id = "client-executor-integration";
  const checks = createShardPlan("checks");
  assert.ok(!checks.suites.some((suite) => suite.id === id));
  assert.equal(
    createShardPlan("checks", root, undefined, { extended: true }).suites.find(
      (suite) => suite.id === id,
    ).kind,
    "integration",
  );
  assert.ok(checks.deferredSuiteIds.includes(id));
  assert.ok(!createShardPlan("quick").suites.some((suite) => suite.id === id));
  assert.ok(
    !createShardPlan("browser", root, undefined, {
      extended: true,
    }).suites.some((suite) => suite.id === id),
  );
});

test("the extended host plan remains full and unfiltered", () => {
  assert.deepEqual(
    createPlan({ extended: true }).suites,
    suiteInventory(sourceFiles(root)).map(
      ({ covers: _covers, ...suite }) => suite,
    ),
  );
});

test("shared shard plans exclude macOS-host suites while diagnostics preserve raw partitions", () => {
  const checks = createShardPlan("checks");
  assert.equal(checks.scope, "macos");
  assert.equal(checks.profile, "supported");
  assert.ok(checks.deferredSuiteIds.includes("client-core"));
  assert.ok(checks.deferredSuiteIds.includes("root-kotlin"));
  for (const id of [
    "client-core",
    "client-host",
    "client-clippy",
    "root-kotlin",
    "dev-tui-unit",
  ])
    assert.ok(!checks.suites.some((suite) => suite.id === id), id);
  assert.ok(
    createShardPlan("quick").suites.some(({ id }) => id === "client-vue"),
  );
  for (const shard of [
    "browser",
    "workshop-chromium",
    "workshop-webkit",
    "native",
  ])
    assert.throws(() => createShardPlan(shard), /No suites selected/);
  const selection = Object.fromEntries(shards.map((shard) => [shard, []]));
  selection.browser = ["client-browser"];
  assert.throws(() => createShardPlan("browser", root, selection), /deferred/);
  assert.equal(
    createShardPlan("browser", root, selection, { extended: true }).scope,
    "extended",
  );
});

test("new suites join their category automatically; unknown categories fail", () => {
  for (const [kind, shard] of [
    ["unit", "checks"],
    ["integration", "checks"],
    ["check", "checks"],
    ["browser", "browser"],
    ["native", "native"],
  ]) {
    const plan = fixture();
    const added = { id: `new-${kind}`, kind };
    plan.suites.push(added);
    assert.ok(partitionPlan(plan)[shard].suites.includes(added));
  }
  const plan = fixture();
  plan.suites.push({ id: "new-category", kind: "future" });
  assert.throws(
    () => partitionPlan(plan),
    /Unclassified CI suite: new-category/,
  );
});

test("empty shards and duplicate suite IDs fail rather than report success", () => {
  for (const id of [
    "runner-unit",
    "browser",
    "workshop-chromium",
    "workshop-webkit",
    "native",
    "client-docker-context",
  ]) {
    const plan = fixture();
    plan.suites = plan.suites.filter((suite) => suite.id !== id);
    assert.throws(() => partitionPlan(plan), /No suites selected/);
  }
  const plan = fixture();
  plan.suites = plan.suites.filter(
    (suite) => !["unit", "check", "integration"].includes(suite.id),
  );
  assert.throws(() => partitionPlan(plan), /No suites selected.*checks/);
  assert.throws(() => partitionPlan({ suites: [] }), /No suites selected/);
  const duplicate = fixture();
  duplicate.suites.push(duplicate.suites[0]);
  assert.throws(() => partitionPlan(duplicate), /Duplicate suite/);
});

test("options require a valid shard and bounded per-suite timeout", () => {
  assert.equal(parseOptions(["--shard", "checks"]).timeout, 1800);
  assert.equal(
    parseOptions(["--shard", "native", "--timeout", "42"]).timeout,
    42,
  );
  for (const shard of [undefined, "", "all", "toString"])
    assert.throws(() => createShardPlan(shard), /--shard must/);
  for (const args of [
    [],
    ["--shard", ""],
    ["--shard", "all"],
    ["--unit"],
    ["extra"],
  ])
    assert.throws(() => parseOptions(args));
  for (const timeout of ["0", "-1", "1.5", "NaN", "86401", ""])
    assert.throws(
      () => parseOptions(["--shard", "checks", "--timeout", timeout]),
      /--timeout/,
    );
});

test("CLI lists Linux JSON plans without executing suites and reports option errors", () => {
  const listed = cli(["--shard", "native", "--list", "--json", "--extended"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), {
    ...createShardPlan("native", root, undefined, { extended: true }),
    status: "planned",
  });
  const invalid = cli(["--shard", "missing", "--json"]);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).status, "error");
  if (process.platform !== "linux") {
    const execution = cli(["--shard", "native", "--json"]);
    assert.equal(execution.status, 2);
    assert.match(JSON.parse(execution.stdout).error, /only execute on Linux/);
  }
});

test("selection filters only registered suites in their assigned shard", () => {
  const selection = Object.fromEntries(shards.map((shard) => [shard, []]));
  selection.quick = ["root-lint"];
  selection.browser = ["client-browser"];
  assert.deepEqual(
    createShardPlan("quick", root, selection).suites.map(({ id }) => id),
    ["root-lint"],
  );
  assert.throws(
    () => createShardPlan("native", root, selection),
    /No suites selected/,
  );
  for (const invalid of [
    null,
    [],
    {},
    { ...selection, checks: "runner-unit" },
    { ...selection, checks: ["root-lint"] },
    { ...selection, browser: ["unknown"] },
  ])
    assert.throws(() => createShardPlan("quick", root, invalid));
  assert.throws(
    () =>
      createShardPlan("quick", root, {
        ...selection,
        quick: ["root-lint", "root-lint"],
      }),
    /Duplicate selected suite/,
  );
});

test("CLI honors selection JSON and fails malformed, duplicate or empty selections", () => {
  const selection = Object.fromEntries(shards.map((shard) => [shard, []]));
  selection.quick = ["runner-unit"];
  const result = cli(
    ["--shard", "quick", "--list", "--json"],
    JSON.stringify(selection),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).suites.map(({ id }) => id),
    ["runner-unit"],
  );
  for (const raw of [
    "",
    "{",
    "null",
    JSON.stringify({ ...selection, quick: [] }),
    JSON.stringify({ ...selection, quick: ["client-native"] }),
    JSON.stringify({ ...selection, quick: ["runner-unit", "runner-unit"] }),
  ]) {
    const invalid = cli(["--shard", "quick", "--list", "--json"], raw);
    assert.equal(invalid.status, 2, raw);
    assert.equal(JSON.parse(invalid.stdout).status, "error");
  }
});

test("shard plans use runner exit, timeout, continuation and cancellation semantics", async () => {
  const plan = partitionPlan(fixture()).checks;
  plan.suites = plan.suites.map((suite, index) => ({
    ...suite,
    project: "runner",
    cwd: ".",
    command: process.execPath,
    args: [
      "-e",
      ["process.exit(7)", "setInterval(() => {}, 1000)", "process.exit(0)"][
        index
      ],
    ],
  }));
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const report = await runPlan(plan, { timeout: 1, output });
  assert.equal(report.status, "failed");
  assert.equal(report.shard, "checks");
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["failed", "timed-out", "passed"],
  );
  assert.equal(report.results[0].exitCode, 7);
  const controller = new AbortController();
  const cancelled = await runPlan(plan, {
    signal: controller.signal,
    execute: async (_suite, { signal }) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      throw new Error("Interrupted");
    },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(
    cancelled.results.map((result) => result.status),
    ["cancelled", "not-run", "not-run"],
  );
});
