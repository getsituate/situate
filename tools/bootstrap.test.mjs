import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { prerequisites, toolchainProblems } from "./bootstrap.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("all npm projects inherit the root Volta pins", () => {
  const { volta } = JSON.parse(read("package.json"));
  assert.match(volta.node, /^\d+\.\d+\.\d+$/);
  assert.match(volta.npm, /^\d+\.\d+\.\d+$/);
  assert.equal(read("client/.node-version").trim(), volta.node);
  assert.equal(
    JSON.parse(read("tools/toolchain.quality.json")).npm.version,
    volta.npm,
  );
  for (const [directory, parent] of [
    ["client", "../package.json"],
    ["requirements", "../package.json"],
    ["client/app", "../../package.json"],
    ["client/workshop", "../../package.json"],
    ["client/packages/ui", "../../../package.json"],
    ["client/packages/localization", "../../../package.json"],
  ]) {
    assert.deepEqual(
      JSON.parse(read(`${directory}/package.json`)).volta,
      { extends: parent },
      directory,
    );
  }
});

test("CI delegates toolchain setup to the shared bootstrap after pinned checkout", () => {
  const workflows = readdirSync(
    new URL("../.github/workflows/", import.meta.url),
  ).filter((name) => name.endsWith(".yml"));
  assert.ok(workflows.length > 0);
  for (const name of workflows) {
    const workflow = read(`.github/workflows/${name}`);
    assert.doesNotMatch(
      workflow,
      /actions\/setup-node|volta-cli\/action|run:.*(?:volta install|curl|npm install)/,
    );
    const steps = workflow.split(/^ {4}steps:\n/m).slice(1);
    assert.ok(steps.length > 0, name);
    for (const block of steps) {
      assert.match(block, /^ {6}- uses: actions\/checkout@[a-f0-9]{40}\n/);
      assert.match(
        block,
        /persist-credentials: false[\s\S]*?- run: python3 tools\/pipeline-bootstrap\.py\n/,
      );
    }
  }
});

test("MVP preflight requires Apple tools but not deferred platform SDKs", () => {
  const linux = prerequisites("/checkout", {
    platform: "linux",
    environment: {},
  });
  assert.ok(
    linux.some(
      (check) =>
        check.path ===
        join(
          "/checkout",
          "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
        ),
    ),
  );
  assert.ok(
    linux.some(
      (check) => check.command === "docker" && check.args[0] === "info",
    ),
  );
  assert.ok(!linux.some((check) => check.command === "pkg-config"));
  assert.ok(linux.some((check) => check.command === "volta"));
  assert.ok(!linux.some((check) => check.command === "xvfb-run"));
  assert.ok(!linux.some((check) => check.command === "xcodebuild"));
  const mac = prerequisites("/checkout", {
    platform: "darwin",
    environment: {},
  });
  assert.ok(mac.some((check) => check.command === "xcodebuild"));
  assert.ok(mac.some((check) => check.command === "swiftlint"));
  assert.ok(!mac.some((check) => check.command === "xvfb-run"));
  assert.ok(!mac.some((check) => check.command === "ktlint"));
});

test("extended preflight retains Kotlin and native Linux prerequisites", () => {
  const checks = prerequisites("/checkout", {
    platform: "linux",
    extended: true,
    environment: {},
  });
  for (const command of ["ktlint", "xvfb-run", "dbus-run-session"])
    assert.ok(checks.some((check) => check.command === command));
  assert.ok(
    checks.some(
      (check) =>
        check.command === "pkg-config" && check.args.includes("webkit2gtk-4.1"),
    ),
  );
  assert.ok(checks.some((check) => check.args?.includes("clippy")));
});

test("toolchain preflight rejects mismatched Node and npm versions", () => {
  const pins = { node: "24.21.0", npm: "11.19.1" };
  assert.deepEqual(toolchainProblems(pins, pins.node, pins.npm), []);
  assert.match(
    toolchainProblems(pins, "26.0.0", pins.npm)[0],
    /node 24\.21\.0.*Volta/,
  );
  assert.match(
    toolchainProblems(pins, pins.node, "12.0.0")[0],
    /npm 11\.19\.1.*Volta/,
  );
  assert.match(toolchainProblems(pins, pins.node, undefined)[0], /unavailable/);
});

test("coverage prerequisites are opt-in and explicit Pi overrides are preserved", () => {
  const basic = prerequisites("/checkout", { environment: {} });
  assert.ok(!basic.some((check) => check.args?.includes("llvm-cov")));
  const coverage = prerequisites("/checkout", {
    coverage: true,
    environment: { PI_PACKAGE_ROOT: "/alternate/pi" },
  });
  assert.ok(coverage.some((check) => check.args?.includes("llvm-cov")));
  assert.ok(
    coverage.some((check) =>
      check.path?.endsWith("@vitest/coverage-v8/package.json"),
    ),
  );
  assert.equal(coverage[0].path, join("/alternate/pi", "dist/index.js"));
});
