import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPlan, planPaths } from "./pipeline-plan.mjs";
import {
  createPlan as testPlan,
  parseOptions,
  sourceFiles,
  root,
  suiteInventory,
  runPlan,
} from "./test.mjs";

const suites = (plan) => plan.lanes.flatMap((lane) => lane.suites);

test("developer-only inputs and required declarations do not activate app lanes", () => {
  for (const path of [
    "tools/dev-tui/src/app.rs",
    "tools/dev-tui/Cargo.lock",
    "tools/dev-tui/Cargo.toml",
    "tools/dev-tui/rust-toolchain.toml",
    "tools/dev.mjs",
    ".env.example",
    "tools/pipeline.mjs",
    "tools/pipeline-plan.mjs",
    "tools/release-notary-integration.test.mjs",
    "client/scripts/apple-release.test.mjs",
    ".pi/role-mode/roles/developer/SYSTEM.md",
    "docs/development/testing.md",
    "requirements/data/goals/GOAL-0001.md",
    "requirements/package-lock.json",
    "client/workshop/package-lock.json",
    "client/workshop/src-tauri/Cargo.lock",
    "client/scripts/ios-xcode.mjs",
  ]) {
    for (const mode of ["verify", "release"]) {
      const plan = planPaths([path, "changes/new.json"], { mode });
      assert.equal(plan.appImpact, false, path);
      assert.ok(
        plan.lanes.every(
          (lane) =>
            ![
              "frontend",
              "macos-code",
              "macos-browser",
              "macos-native",
            ].includes(lane.id),
        ),
        path,
      );
      assert.ok(suites(plan).includes("delivery-unit"));
      assert.ok(suites(plan).includes("root-commits"));
      assert.ok(suites(plan).includes("root-history-secrets"));
      assert.ok(!suites(plan).includes("root-audit"));
      assert.equal(plan.reasons.length, 0, path);
    }
  }
  const tui = planPaths(["tools/dev-tui/Cargo.lock"]);
  assert.deepEqual(
    tui.lanes.find((lane) => lane.id === "tooling-macos").suites,
    ["dev-tui-unit", "dev-tui-format", "dev-tui-clippy"],
  );
});

test("app consumers and native harnesses have explicit host assignments", () => {
  const frontend = planPaths(["client/app/src/App.vue"]);
  assert.equal(frontend.appImpact, true);
  assert.ok(suites(frontend).includes("client-vue"));
  assert.equal(
    frontend.lanes.find((lane) => lane.id === "macos-browser").host,
    "macos",
  );
  assert.equal(
    frontend.lanes.find((lane) => lane.id === "frontend").host,
    "linux",
  );
  const harness = planPaths(["tools/native-vm.mjs"]);
  assert.equal(harness.appImpact, true);
  assert.ok(suites(harness).includes("client-native"));
  assert.ok(!suites(harness).includes("client-vue"));
  const unknown = planPaths(["unclassified/runtime.bin"]);
  assert.equal(unknown.appImpact, true);
  assert.match(unknown.reasons[0], /Conservative/);
});

test("release source gates are complete, unique and exclude diagnostics and advisory scans", () => {
  const plan = planPaths(["client/app/src/App.vue"], { mode: "release" });
  const ids = suites(plan);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of [
    "client-browser",
    "client-native",
    "client-agent-e2e",
    "client-migrations",
    "root-rust",
    "root-secrets",
    "client-types",
  ])
    assert.ok(ids.includes(id), id);
  for (const id of [
    "root-audit",
    "root-kotlin",
    "client-visual",
    "workshop-vue",
    "client-scripts-platform",
    "runner-platform",
    "dev-tui-unit",
    "requirements-build",
    "requirements-browser",
    "pi-unit",
  ])
    assert.ok(!ids.includes(id), id);
  for (const lane of plan.lanes) {
    const execution = testPlan({
      suite: lane.suites,
      platform: lane.host === "macos" ? "darwin" : "linux",
    });
    assert.deepEqual(
      execution.suites.map((suite) => suite.id).sort(),
      [...lane.suites].sort(),
    );
  }
});

test("explicit execution rejects missing hosts and IDs and preserves historical reports", async () => {
  assert.deepEqual(
    parseOptions(["--suite", "client-vue", "--suite", "root-secrets"]).suite,
    ["client-vue", "root-secrets"],
  );
  assert.throws(() => testPlan({ suite: ["unknown"] }), /Unknown suite/);
  assert.throws(
    () => testPlan({ suite: ["client-browser"], platform: "linux" }),
    /macOS host/,
  );
  assert.equal(testPlan().scope, "supported");
  const legacy = await runPlan({ scope: "mvp", profile: "mvp", suites: [] });
  assert.equal(legacy.scope, "mvp");
  assert.equal(legacy.profile, "mvp");
  assert.throws(
    () => testPlan({ suite: ["client-vue"], unit: true }),
    /cannot be combined/,
  );
});

test("delivery contracts have one owner and explicit consumer rules", () => {
  const additions = [
    "tools/pipeline.test.mjs",
    "tools/github-release.test.mjs",
    "infrastructure/releases/allocator.test.mjs",
    "infrastructure/releases/recovery.test.mjs",
  ];
  const inventory = suiteInventory(
    [...new Set([...sourceFiles(root), ...additions])],
    "darwin",
  );
  for (const path of additions)
    assert.deepEqual(
      inventory
        .filter((suite) => suite.covers.includes(path))
        .map((suite) => suite.id),
      ["delivery-unit"],
    );
  const plan = planPaths(["tools/pipeline.mjs"]);
  assert.ok(suites(plan).includes("delivery-unit"));
  assert.ok(!suites(plan).includes("runner-unit"));
  assert.ok(!suites(planPaths(["tools/dev.mjs"])).includes("delivery-unit"));
});

test("migration delivery contracts have one owner and follow release and native consumers", () => {
  const files = [
    "tools/migration-history.test.mjs",
    "tools/published-migrations.test.mjs",
  ];
  const inventory = suiteInventory(sourceFiles(root), "darwin");
  for (const path of files)
    assert.deepEqual(
      inventory
        .filter((suite) => suite.covers.includes(path))
        .map((suite) => suite.id),
      ["delivery-migrations"],
    );
  const execution = testPlan({
    suite: ["delivery-migrations"],
    platform: "linux",
  });
  assert.deepEqual(execution.suites[0].args, [
    "--test",
    "--test-concurrency=1",
    ...files,
  ]);
  for (const path of [
    "tools/migration-history.mjs",
    "tools/published-migrations.mjs",
    "tools/release-inputs.mjs",
    "client/scripts/apple-release.mjs",
    "client/crates/situate-migrations/src/registry.rs",
    "client/Cargo.lock",
    "releases/migration-checkpoint.json",
    "infrastructure/releases/transport.mjs",
  ])
    assert.ok(suites(planPaths([path])).includes("delivery-migrations"), path);
  for (const path of [
    "tools/dev.mjs",
    "tools/dev-tui/Cargo.lock",
    "docs/development/testing.md",
    "changes/new.json",
    "client/app/src/App.vue",
  ])
    assert.ok(!suites(planPaths([path])).includes("delivery-migrations"), path);
  assert.ok(
    !suites(planPaths(["tools/migration-history.mjs"])).includes("runner-unit"),
  );
  assert.equal(
    planPaths(["tools/migration-history.mjs"]).lanes.find((lane) =>
      lane.suites.includes("delivery-migrations"),
    ).id,
    "tooling",
  );
});

test("platform-only Node fixtures have independent optional discovery", () => {
  const inventory = suiteInventory(
    [
      ...new Set([
        ...sourceFiles(root),
        "tools/bootstrap-mobile.test.mjs",
        "client/scripts/ios-xcode.test.mjs",
        "client/scripts/ios-xcode.integration.test.mjs",
      ]),
    ],
    "darwin",
  );
  for (const [file, owner] of [
    ["tools/bootstrap-mobile.test.mjs", "runner-platform"],
    ["client/scripts/ios-xcode.test.mjs", "client-scripts-platform"],
    [
      "client/scripts/ios-xcode.integration.test.mjs",
      "client-scripts-platform-integration",
    ],
  ]) {
    assert.deepEqual(
      inventory
        .filter((suite) => suite.covers.includes(file))
        .map((suite) => suite.id),
      [owner],
    );
    assert.ok(!testPlan().suites.some((suite) => suite.id === owner));
  }
});

function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-plan-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  // The registry checks test discovery without reading test contents.
  for (const path of sourceFiles(root).filter((path) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path),
  )) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), "");
  }
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "test: fixture");
    return git("rev-parse", "HEAD");
  };
  return {
    directory,
    git,
    commit,
    write(path) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), "fixture\n");
    },
  };
}

test("exact source planning includes rename/deletion and ignores dirty checkout inputs", async (t) => {
  const repo = repository(t);
  repo.write("client/app/src/old.vue");
  const base = repo.commit();
  repo.git("mv", "client/app/src/old.vue", "tools/moved.vue");
  const source = repo.commit();
  repo.write("unclassified-dirty.bin");
  const plan = await createPlan({ root: repo.directory, source, base });
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.source, source);
  assert.equal(plan.base, base);
  assert.equal(plan.appImpact, true);
  assert.ok(
    plan.lanes
      .flatMap((lane) => lane.reasons)
      .some((reason) => reason.includes("client/app/src/old.vue")),
  );
  assert.ok(!JSON.stringify(plan).includes("unclassified-dirty.bin"));
  await assert.rejects(
    createPlan({ root: repo.directory, source: "HEAD", base }),
    /exact full commit SHA/,
  );
  await assert.rejects(
    createPlan({ root: repo.directory, source, base: "f".repeat(40) }),
  );
  await assert.rejects(
    createPlan({ root: repo.directory, source, base, changedPaths: [] }),
    /do not match/,
  );
});

test("release impact accumulates undelivered changes across tool-only commits", async (t) => {
  const repo = repository(t);
  const completedSource = repo.commit();
  repo.write("client/app/src/new.vue");
  const base = repo.commit();
  repo.write("tools/launcher.mjs");
  const source = repo.commit();
  assert.equal(
    (await createPlan({ root: repo.directory, source, base })).appImpact,
    false,
  );
  const plan = await createPlan({
    root: repo.directory,
    source,
    base,
    completedSource,
    mode: "release",
  });
  assert.equal(plan.appImpact, true);
  assert.ok(suites(plan).includes("client-native"));
  await assert.rejects(
    createPlan({ root: repo.directory, source, base, mode: "release" }),
    /completedSource/,
  );
  repo.git("checkout", "-b", "diverged", completedSource);
  repo.write("tools/diverged.mjs");
  const unrelated = repo.commit();
  await assert.rejects(
    createPlan({
      root: repo.directory,
      source,
      base,
      completedSource: unrelated,
      mode: "release",
    }),
  );
  const branchPlan = await createPlan({
    root: repo.directory,
    source,
    base: unrelated,
  });
  assert.equal(branchPlan.appImpact, true);
});

test("shallow history cannot become an empty successful plan", async (t) => {
  const repo = repository(t);
  const source = repo.commit();
  writeFileSync(join(repo.directory, ".git", "shallow"), `${source}\n`);
  await assert.rejects(
    createPlan({ root: repo.directory, source, base: source }),
    /complete Git history/,
  );
});
