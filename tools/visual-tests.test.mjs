import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions, visualCommand } from "./visual-tests.mjs";
import { createPlan, sourceFiles, suiteInventory, root } from "./test.mjs";

const image = `ghcr.io/owner/ci@sha256:${"a".repeat(64)}`;
const host = { image, environment: {}, platform: "darwin", arch: "arm64" };

test("visual checks are read-only by default and accept only scoped update options", () => {
  assert.deepEqual(visualCommand(parseOptions([]), host).args, [
    "tools/ci-container.mjs",
    "--visual",
    "check",
  ]);
  assert.deepEqual(
    visualCommand(
      parseOptions(["--update", "--project", "mobile", "--grep", "^create$"]),
      host,
    ).args,
    [
      "tools/ci-container.mjs",
      "--visual",
      "update",
      "--project",
      "mobile",
      "--grep",
      "^create$",
    ],
  );
  for (const args of [
    ["--check", "--update"],
    ["--project", "unknown"],
    ["--update-snapshots=all"],
    ["--pass-with-no-tests"],
  ])
    assert.throws(() => parseOptions(args));
});

test("the locked CI container runs Playwright directly without nested Docker", () => {
  const command = visualCommand(
    parseOptions(["--project", "desktop", "--grep", "provider selection"]),
    {
      image,
      environment: { CI: "true", SITUATE_CI_IMAGE: image },
      platform: "linux",
      arch: "x64",
    },
  );
  assert.deepEqual(command.args, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "app/playwright.visual.config.ts",
    "--update-snapshots=none",
    "--project",
    "desktop",
  ]);
  assert.ok(command.cwd.endsWith("/client"));
  assert.deepEqual(command.env, { SITUATE_VISUAL_GREP: "provider selection" });
  assert.ok(!command.args.includes("--grep"));
});

test("CI cannot update baselines and a mismatched rendering environment fails closed", () => {
  assert.throws(
    () =>
      visualCommand({ update: true }, { ...host, environment: { CI: "true" } }),
    /not in CI/,
  );
  for (const override of [
    {
      environment: { SITUATE_CI_IMAGE: "other" },
      platform: "linux",
      arch: "x64",
    },
    {
      environment: { SITUATE_CI_IMAGE: image },
      platform: "darwin",
      arch: "x64",
    },
    {
      environment: { SITUATE_CI_IMAGE: image },
      platform: "linux",
      arch: "arm64",
    },
  ])
    assert.throws(
      () => visualCommand({}, { image, ...override }),
      /locked Linux/,
    );
});

test("visual screens are opt-in and never added to MVP or unit runs", () => {
  const files = sourceFiles(root);
  const suite = suiteInventory(files).find(({ id }) => id === "client-visual");
  assert.equal(suite.kind, "browser");
  assert.deepEqual(suite.args, ["tools/visual-tests.mjs"]);
  assert.ok(
    suite.covers.includes("client/app/tests/browser/workspaces-layout.spec.ts"),
  );
  assert.deepEqual(
    suite.covers,
    suiteInventory(files).find(({ id }) => id === "client-browser").covers,
  );
  assert.ok(
    createPlan({ extended: true }, root).suites.some(
      ({ id }) => id === "client-visual",
    ),
  );
  assert.ok(
    !createPlan({}, root).suites.some(({ id }) => id === "client-visual"),
  );
  assert.ok(
    !createPlan({ unit: true, extended: true }, root).suites.some(
      ({ id }) => id === "client-visual",
    ),
  );
});
