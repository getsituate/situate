import test from "node:test";
import assert from "node:assert/strict";
import { createPlan, root, sourceFiles, suiteInventory } from "./test.mjs";
import { suiteHost, suiteExecution } from "./test-scope.mjs";
import { planPaths } from "./pipeline-plan.mjs";
import { suiteAffectedFiles } from "./test-inputs.mjs";

const inventory = () => suiteInventory(sourceFiles(root), "darwin");
const find = (id) => inventory().find((suite) => suite.id === id);

test("portable checks remain available on both execution hosts without a Linux product host", () => {
  const portable = [
    "root-rust",
    "root-swift",
    "dev-tui-unit",
    "dev-tui-format",
    "dev-tui-clippy",
    "client-browser",
    "client-executor-integration",
    "client-agent-runtime",
    "client-migrations",
    "client-core",
    "client-format",
    "client-clippy",
  ];
  const native = [
    "dev-tui-macos",
    "client-core-macos",
    "client-host",
    "client-host-clippy",
    "client-dictation-swift",
    "client-workspace-access-swift",
    "client-native",
    "client-agent-e2e",
    "client-onboarding-e2e",
    "client-plugins-e2e",
  ];
  for (const id of portable) assert.equal(suiteHost(find(id)), "linux", id);
  for (const id of native) assert.equal(suiteHost(find(id)), "macos", id);
  for (const platform of ["linux", "darwin"]) {
    const supported = createPlan({ platform });
    for (const id of portable)
      assert.ok(
        supported.suites.some((suite) => suite.id === id),
        `${platform}: ${id}`,
      );
    for (const id of native)
      assert.equal(
        supported.suites.some((suite) => suite.id === id),
        platform === "darwin",
        `${platform}: ${id}`,
      );
    assert.ok(
      !supported.suites.some((suite) => suite.id === "client-workshop-host"),
    );
    const extended = createPlan({ platform, extended: true });
    assert.ok(extended.suites.some((suite) => suite.id === "client-visual"));
    assert.ok(!extended.suites.some((suite) => suite.kind === "coverage"));
    assert.equal(
      extended.suites.some((suite) => suite.id === "client-workshop-host"),
      platform === "darwin",
    );
  }
});

test("Clippy separates portable packages from native host packages", () => {
  assert.deepEqual(find("client-clippy").args, [
    "clippy",
    "-p",
    "situate-core",
    "-p",
    "situate-agent",
    "-p",
    "situate-migrations",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ]);
  assert.deepEqual(find("client-host-clippy").args, [
    "clippy",
    "--workspace",
    "--exclude",
    "situate-core",
    "--exclude",
    "situate-agent",
    "--exclude",
    "situate-migrations",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ]);
  assert.ok(find("client-host").args.includes("situate-agent"));
});

test("macOS retains focused durability and platform-only terminal checks", () => {
  assert.deepEqual(find("client-core-macos").args, [
    "test",
    "-p",
    "situate-core",
    "--lib",
    "--locked",
    "--",
    "durable_storage::",
    "content::git_storage::sync_tests::",
    "content::observation::scan_tests::",
  ]);
  assert.deepEqual(find("dev-tui-macos").args, [
    "test",
    "--locked",
    "--test",
    "terminal",
    "dragging_logs_exposes_copy_without_disabling_mouse_controls",
    "--",
    "--exact",
  ]);
  assert.deepEqual(find("dev-tui-unit").args, [
    "test",
    "--locked",
    "--",
    "--skip",
    "dragging_logs_exposes_copy_without_disabling_mouse_controls",
  ]);
  for (const id of [
    "client-core",
    "client-core-macos",
    "client-clippy",
    "client-host-clippy",
  ])
    assert.deepEqual(
      suiteAffectedFiles(id, [
        "client/crates/situate-core/src/durable_storage.rs",
      ]),
      ["client/crates/situate-core/src/durable_storage.rs"],
    );
});

test("runtime dependency and browser prerequisites belong to their suite workspace", () => {
  for (const id of ["runner-unit", "runner-integration"])
    assert.equal(find(id).npm, ".", id);
  for (const [id, workspace, browsers] of [
    ["client-browser", "client", ["chromium", "webkit"]],
    ["client-executor-integration", "client", ["chromium"]],
    ["requirements-browser", "requirements", ["chromium"]],
  ]) {
    assert.equal(find(id).npm, workspace, id);
    assert.deepEqual(find(id).browsers, browsers, id);
  }
  for (const platform of ["linux", "darwin"])
    assert.deepEqual(
      createPlan({ suite: ["requirements-browser"], platform }).suites[0]
        .browsers,
      ["chromium"],
    );
});

test("Swift static policy is Linux-hosted without selecting product execution", () => {
  const plan = planPaths([".swiftlint.yml", ".swift-format"]);
  assert.equal(plan.appImpact, false);
  const lane = plan.lanes.find((entry) => entry.suites.includes("root-swift"));
  assert.equal(lane.id, "policy");
  assert.equal(lane.host, "linux");
  assert.ok(plan.lanes.every((entry) => entry.host === "linux"));
  assert.deepEqual(find("root-swift").args, ["run", "quality:swift"]);
});

test("Docker integration is isolated from container-executed tooling", () => {
  const plan = planPaths([
    "client/docker/Dockerfile",
    "infrastructure/website/compose.yml",
  ]);
  const docker = plan.lanes.find((lane) => lane.id === "docker-integration");
  assert.equal(docker.host, "linux");
  assert.equal(docker.execution, "host-docker");
  for (const id of docker.suites)
    assert.equal(suiteExecution(find(id)), "host-docker");
  assert.equal(suiteExecution(find("client-native")), "native");
  assert.equal(suiteExecution(find("client-browser")), "container");
  assert.deepEqual(docker.suites, [
    "client-docker-context",
    "design-website-hosting",
  ]);
  for (const lane of plan.lanes.filter(
    (lane) => lane.id !== "docker-integration",
  )) {
    assert.equal(lane.execution, undefined);
    assert.ok(lane.suites.every((id) => !docker.suites.includes(id)));
  }
  for (const platform of ["linux", "darwin"])
    assert.deepEqual(
      createPlan({ suite: docker.suites, platform }).suites.map(
        (suite) => suite.id,
      ),
      docker.suites,
    );
});

test("app release verification keeps native gates alongside portable code and browser lanes", () => {
  const plan = planPaths(["client/app/src/App.vue"], { mode: "release" });
  for (const [id, host] of [
    ["policy", "linux"],
    ["rust", "linux"],
    ["browser", "linux"],
    ["macos-code", "macos"],
    ["macos-native", "macos"],
  ])
    assert.equal(plan.lanes.find((lane) => lane.id === id).host, host, id);
  for (const [id, seconds] of [
    ["policy", 600],
    ["rust", 1800],
    ["browser", 1800],
    ["macos-code", 1800],
    ["macos-native", 1800],
  ])
    assert.equal(
      plan.lanes.find((lane) => lane.id === id).timeoutSeconds,
      seconds,
      id,
    );
  const ids = plan.lanes.flatMap((lane) => lane.suites);
  for (const id of [
    "root-swift",
    "root-rust",
    "client-core-macos",
    "client-host-clippy",
    "client-dictation-swift",
    "client-native",
    "client-agent-e2e",
  ])
    assert.ok(ids.includes(id), id);
  assert.equal(ids.length, new Set(ids).size);
  for (const lane of plan.lanes)
    for (const id of lane.suites)
      assert.equal(suiteHost(find(id)), lane.host, id);
});
