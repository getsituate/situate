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
import { supportedSuiteEnabled, suiteAvailable } from "./test-scope.mjs";

const hostSuites = (platform) =>
  suiteInventory(sourceFiles(root), platform)
    .filter((suite) => suiteAvailable(suite, platform))
    .map(({ covers: _covers, ...suite }) => suite);
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

test("nonempty disjoint diagnostic shards exactly cover the available Linux registry", () => {
  assert.deepEqual(shards, [
    "quick",
    "checks",
    "browser",
    "workshop-chromium",
    "workshop-webkit",
    "native",
    "docker",
  ]);
  const inventory = hostSuites("linux");
  const partitions = partitionPlan({ suites: inventory });
  const plans = shards
    .filter((shard) => partitions[shard].suites.length)
    .map((shard) =>
      createShardPlan(shard, root, undefined, {
        extended: true,
        platform: "linux",
      }),
    );
  const combined = plans.flatMap(({ suites }) => suites);
  assert.equal(new Set(combined.map(({ id }) => id)).size, combined.length);
  const byId = (suites) => [...suites].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(combined), byId(inventory));
  for (const plan of plans) {
    assert.ok(plan.suites.length > 0);
    assert.equal(plan.profile, "all");
    assert.equal(plan.changed, false);
    assert.equal(plan.base, null);
  }
  assert.deepEqual(partitions.native.suites, []);
  assert.throws(
    () =>
      createShardPlan("native", root, undefined, {
        extended: true,
        platform: "linux",
      }),
    /No suites selected/,
  );
  assert.ok(
    partitions.checks.suites.every(({ kind }) =>
      ["unit", "integration", "check"].includes(kind),
    ),
  );
  assert.ok(partitions.browser.suites.every(({ kind }) => kind === "browser"));
  for (const shard of ["workshop-chromium", "workshop-webkit"]) {
    assert.deepEqual(
      partitions[shard].suites.map(({ id }) => id),
      [shard],
    );
    assert.ok(!partitions.browser.suites.some(({ id }) => id === shard));
  }
  assert.deepEqual(
    partitions.docker.suites.map(({ id }) => id),
    ["client-docker-context", "design-website-hosting"],
  );
});

test("integration diagnostics follow declared host availability while native journeys remain macOS-only", () => {
  for (const platform of ["linux", "darwin"])
    for (const extended of [false, true]) {
      const checks = createShardPlan("checks", root, undefined, {
        platform,
        extended,
      });
      const owner = hostSuites(platform).find(
        ({ id }) => id === "client-executor-integration",
      );
      assert.equal(
        checks.suites.some(({ id }) => id === "client-executor-integration"),
        Boolean(owner && (extended || supportedSuiteEnabled(owner))),
      );
      assert.ok(
        checks.suites.every((suite) => suiteAvailable(suite, platform)),
      );
    }
  const native = createShardPlan("native", root, undefined, {
    platform: "darwin",
    extended: true,
  });
  assert.deepEqual(
    native.suites.map(({ id }) => id),
    [
      "client-native",
      "client-agent-e2e",
      "client-onboarding-e2e",
      "client-plugins-e2e",
    ],
  );
  assert.ok(native.suites.every(({ command }) => command === process.execPath));
  assert.deepEqual(native.suites[0].args, ["scripts/test-native.mjs"]);
});

test("extended plans include diagnostics only when available on the requested host", () => {
  for (const platform of ["linux", "darwin"])
    assert.deepEqual(
      createPlan({ extended: true, platform }).suites,
      hostSuites(platform),
    );
});

test("supported Linux shards retain portable tooling and exclude macOS or opt-in checks", () => {
  const checks = createShardPlan("checks", root, undefined, {
    platform: "linux",
  });
  assert.equal(checks.scope, "supported");
  assert.equal(checks.profile, "supported");
  assert.ok(checks.deferredSuiteIds.includes("root-kotlin"));
  assert.ok(!checks.deferredSuiteIds.includes("client-core"));
  const supportedIds = new Set(
    createPlan({ platform: "linux" }).suites.map(({ id }) => id),
  );
  assert.deepEqual(
    checks.suites,
    partitionPlan({ suites: hostSuites("linux") }).checks.suites.filter(
      ({ id }) => supportedIds.has(id),
    ),
  );
  assert.ok(
    checks.suites.every(
      (suite) => suiteAvailable(suite, "linux") && supportedSuiteEnabled(suite),
    ),
  );
  assert.ok(!checks.suites.some(({ id }) => id === "root-kotlin"));
  assert.ok(
    createShardPlan("quick", root, undefined, {
      platform: "linux",
    }).suites.some(({ id }) => id === "client-vue"),
  );
  assert.deepEqual(
    createShardPlan("browser", root, undefined, {
      platform: "linux",
    }).suites.map(({ id }) => id),
    hostSuites("linux")
      .filter(
        (suite) => suite.kind === "browser" && supportedSuiteEnabled(suite),
      )
      .map(({ id }) => id),
  );
  for (const shard of ["workshop-chromium", "workshop-webkit", "native"])
    assert.throws(
      () => createShardPlan(shard, root, undefined, { platform: "linux" }),
      /No suites selected/,
    );
  const selection = Object.fromEntries(shards.map((shard) => [shard, []]));
  selection["workshop-chromium"] = ["workshop-chromium"];
  assert.throws(
    () =>
      createShardPlan("workshop-chromium", root, selection, {
        platform: "linux",
      }),
    /deferred/,
  );
  assert.equal(
    createShardPlan("workshop-chromium", root, selection, {
      extended: true,
      platform: "linux",
    }).scope,
    "extended",
  );
  selection.native = ["client-native"];
  assert.throws(
    () =>
      createShardPlan("native", root, selection, {
        extended: true,
        platform: "linux",
      }),
    /Invalid suite/,
  );
  assert.ok(
    createShardPlan("checks", root, undefined, {
      platform: "darwin",
    }).suites.some(({ id }) => id === "client-core"),
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

test("unselected empty families do not block other shards, but empty selections never pass", () => {
  const plan = fixture();
  plan.suites = plan.suites.filter(({ kind }) => kind !== "native");
  const partitions = partitionPlan(plan);
  assert.deepEqual(partitions.native.suites, []);
  assert.equal(partitions.checks.suites.length, 3);
  assert.throws(() => partitionPlan({ suites: [] }), /No suites selected/);
  const duplicate = fixture();
  duplicate.suites.push(duplicate.suites[0]);
  assert.throws(() => partitionPlan(duplicate), /Duplicate suite/);
  const selection = Object.fromEntries(shards.map((shard) => [shard, []]));
  assert.throws(
    () => createShardPlan("checks", root, selection, { platform: "linux" }),
    /No suites selected/,
  );
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
  assert.throws(
    () => createShardPlan("checks", root, undefined, { platform: "win32" }),
    /platform must/,
  );
});

test("CLI lists available Linux JSON plans without executing suites and reports option errors", () => {
  const listed = cli(["--shard", "checks", "--list", "--json", "--extended"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), {
    ...createShardPlan("checks", root, undefined, {
      extended: true,
      platform: "linux",
    }),
    status: "planned",
  });
  for (const args of [
    ["--shard", "missing", "--json"],
    ["--shard", "native", "--list", "--json", "--extended"],
  ]) {
    const invalid = cli(args);
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stdout).status, "error");
  }
  if (process.platform !== "linux") {
    const execution = cli(["--shard", "checks", "--json"]);
    assert.equal(execution.status, 2);
    assert.match(JSON.parse(execution.stdout).error, /only execute on Linux/);
  }
});

test("selection filters only registered suites in their host and assigned shard", () => {
  const selection = Object.fromEntries(shards.map((shard) => [shard, []]));
  selection.quick = ["root-lint"];
  selection.browser = ["requirements-browser"];
  assert.deepEqual(
    createShardPlan("quick", root, selection, { platform: "linux" }).suites.map(
      ({ id }) => id,
    ),
    ["root-lint"],
  );
  assert.throws(
    () => createShardPlan("native", root, selection, { platform: "linux" }),
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
    assert.throws(() =>
      createShardPlan("quick", root, invalid, { platform: "linux" }),
    );
  assert.throws(
    () =>
      createShardPlan(
        "quick",
        root,
        { ...selection, quick: ["root-lint", "root-lint"] },
        { platform: "linux" },
      ),
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
