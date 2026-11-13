import test from "node:test";
import assert from "node:assert/strict";
import {
  hasSuiteInputRule,
  requiresFullSelection,
  suiteAffectedFiles,
} from "./test-inputs.mjs";
import { root, sourceFiles, suiteInventory } from "./test.mjs";

const affected = (id, ...files) => suiteAffectedFiles({ id }, files);

test("plain documentation is not a runtime input, but remains a link contract input", () => {
  const files = [
    "client/README.md",
    "client/docs/guide.md",
    "docs/development/testing.md",
    "docs/architecture/index.adoc",
    "design/concepts/navigation.md",
  ];
  for (const id of [
    "client-core",
    "client-vue",
    "client-types",
    "client-scripts-unit",
    "runner-unit",
    "root-lint",
    "pi-unit",
  ])
    assert.deepEqual(affected(id, ...files), [], id);
  assert.deepEqual(affected("design-contracts", ...files), files);
  assert.deepEqual(affected("root-format", ...files), files);
  assert.deepEqual(affected("client-vue", ...files, "client/app/src/App.vue"), [
    "client/app/src/App.vue",
  ]);
});

test("security policy selects document checks without runtime or build suites", () => {
  const file = "SECURITY.md";
  const documentChecks = new Set([
    "quick-source",
    "root-format",
    "root-secrets",
    "root-commits",
    "root-history-secrets",
    "design-contracts",
  ]);
  assert.equal(requiresFullSelection(file), false);
  for (const suite of suiteInventory(sourceFiles(root), "darwin"))
    assert.deepEqual(
      affected(suite.id, file),
      documentChecks.has(suite.id) ? [file] : [],
      suite.id,
    );
  assert.deepEqual(
    affected("client-vue", "client/app/src/prompts/SECURITY.md"),
    ["client/app/src/prompts/SECURITY.md"],
  );
});

test("release content retains compiler, packaging, app and terminal consumers", () => {
  const files = [
    "releases/1.10.0/release.json",
    "tools/release-catalog.mjs",
    "client/scripts/release-history.mjs",
    "client/packages/localization/locales.json",
    "client/packages/localization/src/catalogs/releases/1.10.0.de.json",
  ];
  for (const id of [
    "runner-unit",
    "client-scripts-unit",
    "client-scripts-integration",
    "client-vue",
    "client-types",
    "client-browser",
    "client-native",
    "dev-tui-unit",
  ])
    assert.deepEqual(affected(id, ...files), files, id);
  for (const file of files)
    assert.equal(requiresFullSelection(file), false, file);
  assert.deepEqual(affected("requirements-unit", ...files), []);
});

test("native conversation runtime checks follow owner and storage sources", () => {
  const files = [
    "client/crates/situate-agent/src/lib.rs",
    "client/crates/situate-core/src/conversation_store.rs",
    "client/packages/localization/src/en.json",
    "client/app/src/App.vue",
  ];
  assert.deepEqual(
    affected("client-agent-runtime", ...files),
    files.slice(0, 3),
  );
  const suite = suiteInventory(sourceFiles(root), "darwin").find(
    ({ id }) => id === "client-agent-runtime",
  );
  assert.equal(suite.kind, "unit");
  assert.equal(suite.cwd, "client");
  assert.deepEqual(suite.args, ["test", "-p", "situate-agent", "--locked"]);
});

test("migration package has an independent offline Cargo suite and scoped inputs", () => {
  const files = [
    "client/crates/situate-migrations/src/registry.rs",
    "client/crates/situate-migrations/tests/fixtures/m0001/before/opaque.json",
    "client/crates/situate-core/src/lib.rs",
    "client/app/src/App.vue",
    "client/Cargo.lock",
  ];
  assert.deepEqual(affected("client-migrations", ...files), [
    files[0],
    files[1],
    files[4],
  ]);
  for (const platform of ["darwin", "linux"]) {
    const suite = suiteInventory(sourceFiles(root), platform).find(
      ({ id }) => id === "client-migrations",
    );
    assert.equal(suite.kind, "unit");
    assert.equal(suite.cwd, "client");
    assert.equal(suite.command, "cargo");
    assert.equal(suite.npm, undefined);
    assert.deepEqual(suite.args, [
      "test",
      "-p",
      "situate-migrations",
      "--locked",
    ]);
  }
});

test("executor boundary checks have one integration owner and keep their runtime inputs", () => {
  const boundary = "client/app/src/plugins/executor-boundary.test.ts";
  const files = [...new Set([...sourceFiles(root), boundary])];
  const suites = suiteInventory(files, "darwin");
  assert.deepEqual(
    suites
      .filter((suite) => suite.covers.includes(boundary))
      .map(({ id }) => id),
    ["client-executor-integration"],
  );
  const integration = suites.find(
    ({ id }) => id === "client-executor-integration",
  );
  assert.equal(integration.kind, "integration");
  assert.equal(integration.npm, "client");
  assert.deepEqual(affected(integration.id, boundary), [boundary]);
  assert.deepEqual(affected("client-vue", boundary), []);
  assert.deepEqual(affected("client-vue-coverage", boundary), []);
  for (const file of [
    "client/app/src/plugins/executor-worker.ts",
    "client/app/src/plugins/module-source.ts",
    "client/app/src/plugins/contributions.ts",
    "client/app/src/plugins/host.ts",
    "client/app/vite.config.ts",
    "client/app/vitest.integration.config.ts",
    "client/package-lock.json",
  ])
    assert.deepEqual(affected(integration.id, file), [file]);
  assert.deepEqual(affected(integration.id, "docs/development/testing.md"), []);
});

test("all registered suites have explicit input rules", () => {
  for (const suite of suiteInventory(sourceFiles(root), "darwin"))
    assert.ok(hasSuiteInputRule(suite), suite.id);
});

test("plain documents and catalog records do not select builds or runtime journeys", () => {
  for (const id of [
    "runner-integration",
    "client-host",
    "client-native",
    "client-browser",
    "client-docker-context",
    "design-website-hosting",
    "requirements-integration",
    "requirements-build",
    "requirements-browser",
    "pi-test-hook",
    "root-audit",
  ]) {
    assert.deepEqual(affected(id, "design/concepts/navigation.md"), [], id);
    assert.deepEqual(
      affected(id, "requirements/data/goals/GOAL-9999.md"),
      [],
      id,
    );
  }
  assert.deepEqual(affected("root-secrets", "docs/guide.md"), [
    "docs/guide.md",
  ]);
  assert.deepEqual(affected("root-lint", "docs/guide.md"), []);
  for (const file of ["docs/example.vue", "client/packages/ui/README.ts"])
    assert.deepEqual(affected("client-vue", file), [file]);
});

test("Markdown fixtures, embedded sources, catalogs and role instructions retain consumers", () => {
  for (const [id, file] of [
    ["client-vue", "client/app/tests/fixtures/README.md"],
    ["client-vue", "client/app/src/prompts/welcome.md"],
    ["client-core", "client/crates/situate-core/src/prompt.md"],
    ["client-core", "client/contracts/fixture.md"],
    ["client-scripts-unit", "client/scripts/fixtures/example.md"],
    ["requirements-catalog", "requirements/data/goals/GOAL-0001.md"],
    ["requirements-unit", "requirements/data/goals/GOAL-0001.md"],
    ["design-contracts", "requirements/data/goals/GOAL-0001.md"],
    ["pi-unit", ".pi/role-mode/roles/developer/SYSTEM.md"],
    ["pi-unit", ".pi/skills/delegate/SKILL.md"],
    ["client-core", "client/packages/localization/src/en.json"],
    ["client-core", "client/app/src/ai/catalog.generated.json"],
    ["dev-tui-unit", "design/brand/tokens.json"],
    ["design-unit", "design/brand/docs/provenance.md"],
    ["design-unit", "design/brand/docs/illustration.md"],
    ["design-unit", "design/brand/README.md"],
    ["design-unit", "docs/marketing/onboarding/01-welcome-to-situate.md"],
    ["design-unit", "docs/marketing/onboarding/02-product-introduction.md"],
    ["design-unit", "docs/marketing/onboarding/02-product-introduction.pdf"],
    ["design-unit", "client/workshop/src/ai/assets/providers/LICENSE.txt"],
  ])
    assert.deepEqual(affected(id, file), [file], `${id}: ${file}`);
});

test("capability catalog sources and report artifacts retain their generator checks", () => {
  const files = [
    "docs/product-capability-catalog/README.md",
    "docs/product-capability-catalog/notes.md",
    "docs/product-capability-catalog/Situate-Product-Capability-Catalog.md",
    "docs/product-capability-catalog/generate-reading-edition.py",
    ...["note", "task-management", "email"].flatMap((area) =>
      ["md", "pdf"].map(
        (extension) => `docs/${area}-capabilities-fact-check.${extension}`,
      ),
    ),
  ];
  for (const id of ["design-unit", "root-format", "root-secrets"])
    assert.deepEqual(affected(id, ...files), files, id);
  for (const file of files)
    assert.equal(requiresFullSelection(file), false, file);
  for (const id of [
    "client-core",
    "client-vue",
    "client-host",
    "client-native",
    "runner-unit",
    "design-website-browser",
  ])
    assert.deepEqual(affected(id, ...files), [], id);
  for (const file of [
    "docs/product-capability-catalog/new-tool.py",
    "docs/product-capability-catalog/config.json",
    "docs/other-report.pdf",
  ]) {
    assert.equal(requiresFullSelection(file), true, file);
    assert.deepEqual(affected("client-vue", file), [file]);
  }
});

test("production infrastructure selects contracts and hosting without app or browser sweeps", () => {
  const files = [
    "infrastructure/production/inspect.mjs",
    "infrastructure/production/terraform/main.tf",
  ];
  assert.deepEqual(affected("design-unit", ...files), files);
  assert.deepEqual(affected("design-website-hosting", ...files), files);
  for (const id of [
    "client-core",
    "client-vue",
    "runner-unit",
    "design-website-browser",
  ])
    assert.deepEqual(affected(id, ...files), [], id);
});

test("release publication selects signing/publication contracts without application journeys", () => {
  const file = "infrastructure/releases/remote.py";
  assert.deepEqual(affected("design-unit", file), [file]);
  assert.deepEqual(affected("client-scripts-unit", file), [file]);
  for (const id of [
    "client-vue",
    "client-core",
    "client-native",
    "requirements-unit",
  ])
    assert.deepEqual(affected(id, file), [], id);
});

test("native execution helpers select their journeys and script contracts", () => {
  const files = [
    "tools/native-vm.mjs",
    "tools/native-vm-supervisor.py",
    "client/scripts/native-vm-package.mjs",
    "client/scripts/test-native.mjs",
    "client/scripts/test-agent-e2e.mjs",
    "client/scripts/document-source-fixtures.mjs",
  ];
  for (const id of [
    "client-native",
    "client-agent-e2e",
    "client-onboarding-e2e",
    "client-plugins-e2e",
    "client-scripts-unit",
  ])
    assert.deepEqual(affected(id, ...files), files, id);
});

test("plugins journey follows native execution sources without selecting ordinary documentation", () => {
  const files = [
    "client/app/src-tauri/src/ai_executor.rs",
    "client/crates/situate-agent/src/execution.rs",
    "client/app/src-tauri/tests/support/agent-e2e.js",
    "client/app/src/plugins/executor-worker.ts",
  ];
  assert.deepEqual(affected("client-plugins-e2e", ...files), files);
  assert.deepEqual(
    affected("client-plugins-e2e", "docs/development/testing.md"),
    [],
  );
});

test("embedded callback assets retain native response and policy checks", () => {
  const files = [
    "client/app/src/ai/browser-callback/page.html",
    "client/app/src/ai/browser-callback/page.css",
    "client/app/src/ai/browser-callback/runtime.js",
    "client/app/src/ai/browser-callback/score.js",
    "design/brand/tokens.css",
    "design/brand/assets/wordmark.svg",
    "design/brand/assets/card.svg",
    "design/brand/bend/performance.js",
    "design/brand/bend/svg/rest-welcome.svg",
  ];
  for (const id of ["client-core", "client-host", "client-clippy"])
    assert.deepEqual(affected(id, ...files), files, id);
  assert.deepEqual(
    affected("client-host", "client/workshop/src/auth-callback/score.ts"),
    [],
  );
  assert.deepEqual(affected("client-host", "design/brand/assets/book.svg"), []);
});

test("native updater modules and fixtures select the existing complete Rust host suite", () => {
  const files = [
    "client/app/src-tauri/src/updates.rs",
    "client/app/src-tauri/src/updates/native.rs",
    "client/app/src-tauri/tests/fixtures/updater/version-binding.json",
  ];
  assert.deepEqual(affected("client-host", ...files), files);
  const host = suiteInventory(sourceFiles(root), "darwin").find(
    (suite) => suite.id === "client-host",
  );
  assert.deepEqual(host.args, [
    "test",
    "--workspace",
    "--exclude",
    "situate-core",
    "--exclude",
    "situate-migrations",
    "--locked",
  ]);
});

test("runtime sources affect fingerprints and unknown suites and inputs are conservative", () => {
  for (const [id, file] of [
    ["client-vue", "client/app/src/editor.ts"],
    ["workshop-vue", "client/workshop/src/model.ts"],
    ["client-core", "client/crates/situate-core/src/lib.rs"],
    ["pi-unit", ".pi/extensions/test-suite/index.ts"],
    ["requirements-unit", "requirements/src/catalog.js"],
    ["runner-unit", "tools/test-inputs.mjs"],
  ])
    assert.deepEqual(affected(id, file), [file]);
  for (const file of [
    "new-area/input.md",
    "client/packages/new/input.md",
    "package-lock.json",
  ])
    for (const id of [
      "client-core",
      "client-vue",
      "runner-unit",
      "pi-unit",
      "requirements-unit",
    ])
      assert.deepEqual(affected(id, file), [file]);
  assert.deepEqual(affected("new-suite", "docs/guide.md"), ["docs/guide.md"]);
  assert.deepEqual(
    affected("client-vue", "client/app/src/old.md", "client/app/src/new.md"),
    ["client/app/src/old.md", "client/app/src/new.md"],
  );
});
