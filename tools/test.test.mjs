import test from "node:test";
import { mvpSuiteEnabled } from "./test-scope.mjs";
import { suiteAffectedFiles } from "./test-inputs.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import {
  root,
  projects,
  changedFiles,
  affectedProjects,
  sourceFiles,
  suiteInventory,
  createPlan,
  parseOptions,
  suiteEnvironment,
  runPlan,
  executeSuite,
  ownedDescendants,
  prepareDependencies,
  dependencyLockPath,
} from "./test.mjs";

function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-test-runner-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const put = (file, content = "fixture") => {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), content);
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test Runner");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(directory, "no-hooks"));
  put("client/source.txt");
  put("requirements/source.txt");
  put(".gitignore", "ignored/\n");
  git("add", ".");
  git("commit", "-m", "Initial fixture");
  return { directory, git, put };
}

const silent = () =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
const command = (id, code) => ({
  id,
  project: "runner",
  kind: "unit",
  cwd: ".",
  command: process.execPath,
  args: ["-e", code],
});

test("extended plan includes every category and both reference modes", () => {
  const plan = createPlan({ extended: true });
  assert.equal(plan.scope, "extended");
  assert.deepEqual(plan.deferredSuiteIds, []);
  assert.equal(plan.profile, "all");
  assert.deepEqual(plan.projects, projects);
  assert.deepEqual(
    [...new Set(plan.suites.map((suite) => suite.kind))].sort(),
    ["browser", "check", "integration", "native", "unit"],
  );
  for (const id of [
    "client-native",
    "client-docker-context",
    "client-scripts-integration",
    "pi-mcp",
    "pi-test-hook",
    "design-validation-browser",
    "design-reference-browser",
    "requirements-browser",
  ]) {
    assert.ok(
      plan.suites.some((suite) => suite.id === id),
      id,
    );
  }
  assert.ok(
    plan.suites
      .find((suite) => suite.id === "design-reference-browser")
      .args.includes("--browser"),
  );
});

test("MVP scope defers expensive sweeps and non-Apple product gates without deleting inventory", () => {
  const alwaysDeferred = [
    "root-kotlin",
    "client-workshop-host",
    "client-workshop-clippy",
    "client-visual",
    "client-visual-fixture",
    "workshop-chromium",
    "workshop-webkit",
    "design-website-browser",
    "design-validation-browser",
    "design-reference-browser",
    "design-mini-reference-browser",
    "design-bend-browser",
    "design-performance-browser",
    "design-mini-browser",
    "design-first-hello-browser",
    "design-listening-room-browser",
  ];
  const nonAppleDeferred = [
    "client-browser",
    "client-agent-runtime",
    "client-core",
    "client-host",
    "client-clippy",
    "client-native",
  ];
  for (const platform of ["darwin", "linux", "win32"]) {
    const plan = createPlan({ platform });
    const extended = createPlan({ platform, extended: true });
    const expected = [
      ...alwaysDeferred,
      ...(platform === "darwin" ? [] : nonAppleDeferred),
      ...(platform === "linux" ? ["dev-tui-unit", "dev-tui-clippy"] : []),
    ].sort();
    assert.equal(plan.scope, "mvp");
    assert.equal(plan.profile, "mvp");
    assert.deepEqual([...plan.deferredSuiteIds].sort(), expected, platform);
    assert.deepEqual(
      plan.suites,
      extended.suites.filter((suite) => !expected.includes(suite.id)),
    );
    for (const id of [
      "root-secrets",
      "root-audit",
      "root-rust",
      "client-vue",
      "workshop-vue",
      "workshop-types",
      "design-unit",
      "design-contracts",
    ]) {
      assert.ok(
        plan.suites.some((suite) => suite.id === id),
        `${platform}: ${id}`,
      );
    }
    if (platform === "darwin") {
      for (const id of [
        ...nonAppleDeferred,
        "root-swift",
        "client-workspace-access-swift",
        "client-agent-e2e",
        "client-onboarding-e2e",
        "client-plugins-e2e",
      ]) {
        assert.ok(
          plan.suites.some((suite) => suite.id === id),
          id,
        );
      }
    }
  }
  for (const id of [
    "root-swift",
    "client-workspace-access-swift",
    "client-agent-e2e",
    "client-onboarding-e2e",
    "client-plugins-e2e",
    "client-rust-coverage",
  ]) {
    assert.equal(mvpSuiteEnabled({ id }, "linux"), false, id);
    assert.equal(mvpSuiteEnabled({ id }, "win32"), false, id);
    assert.equal(mvpSuiteEnabled({ id }, "darwin"), true, id);
  }
  assert.equal(
    mvpSuiteEnabled({ id: "client-core" }),
    process.platform === "darwin",
  );
});

test("scope composes with every profile and reports only suites deferred from its selection", async () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    for (const profile of ["unit", "feedback", "checks", "coverage"]) {
      const options = parseOptions([`--${profile}`, "--extended"]);
      const extended = createPlan({ ...options, platform });
      const plan = createPlan({ [profile]: true, platform });
      assert.equal(plan.profile, profile);
      assert.equal(extended.profile, profile);
      assert.equal(extended.scope, "extended");
      assert.deepEqual(extended.deferredSuiteIds, []);
      assert.deepEqual(
        [
          ...plan.suites.map((suite) => suite.id),
          ...plan.deferredSuiteIds,
        ].sort(),
        extended.suites.map((suite) => suite.id).sort(),
      );
      assert.ok(plan.suites.every((suite) => mvpSuiteEnabled(suite, platform)));
      const report = await runPlan(plan, {
        execute: async () => ({ status: "passed", exitCode: 0 }),
        prepare: async () => ({ release() {} }),
      });
      assert.equal(report.status, "passed");
      assert.equal(report.scope, "mvp");
      assert.deepEqual(report.deferredSuiteIds, plan.deferredSuiteIds);
    }
  }
  assert.deepEqual(
    createPlan({ coverage: true, platform: "linux" }).suites.map((s) => s.id),
    ["client-vue-coverage"],
  );
});

test("the visual fixture suite fails when its test files are absent", (t) => {
  const { directory } = repository(t);
  const suite = createPlan({ extended: true }).suites.find(
    (suite) => suite.id === "client-visual-fixture",
  );
  const result = spawnSync(suite.command, suite.args, {
    cwd: directory,
    env: suiteEnvironment(suite, directory),
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Could not find/);
});

test("executor Chromium checks are a default MVP integration, never a unit or coverage run", () => {
  const id = "client-executor-integration";
  const integration = createPlan().suites.find((suite) => suite.id === id);
  assert.equal(integration.kind, "integration");
  assert.equal(integration.cwd, "client/app");
  assert.equal(integration.npm, "client");
  assert.deepEqual(integration.args, [
    "../node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "--allowOnly=false",
  ]);
  for (const platform of ["darwin", "linux", "win32"])
    assert.ok(createPlan({ platform }).suites.some((suite) => suite.id === id));
  for (const profile of ["quick", "unit", "feedback", "checks", "coverage"])
    assert.ok(
      !createPlan({ [profile]: true }).suites.some((suite) => suite.id === id),
      profile,
    );
  const unitConfig = readFileSync(
    join(root, "client/app/vitest.config.ts"),
    "utf8",
  );
  assert.match(
    unitConfig,
    /exclude:\s*\[\s*"\*\*\/node_modules\/\*\*",\s*"\*\*\/\.git\/\*\*",\s*"src\/plugins\/executor-boundary\.test\.ts",?\s*\]/u,
  );
  assert.match(
    unitConfig,
    /coverage:[\s\S]*exclude:\s*\["src\/\*\*\/\*\.test\.ts"/u,
  );
  const config = readFileSync(
    join(root, "client/app/vitest.integration.config.ts"),
    "utf8",
  );
  assert.match(config, /environment:\s*"node"/u);
  assert.match(config, /setupFiles:\s*\[\]/u);
  assert.match(
    config,
    /include:\s*\["src\/plugins\/executor-boundary\.test\.ts"\]/u,
  );
  assert.match(config, /passWithNoTests:\s*false/u);
  const manifest = JSON.parse(
    readFileSync(join(root, "client/package.json"), "utf8"),
  );
  assert.equal(
    manifest.scripts["test:executor"],
    "node ../tools/run-coordinated.mjs -- node ../tools/run-coordinated.mjs --resource build -- npm run test --workspace @situate/client -- --config vitest.integration.config.ts --allowOnly=false",
  );
});

test("feedback adds fast static checks; checks and coverage are explicit profiles", () => {
  const unitIds = new Set(
    createPlan({ unit: true }).suites.map((suite) => suite.id),
  );
  const feedback = createPlan({ feedback: true });
  assert.equal(feedback.profile, "feedback");
  assert.deepEqual(
    feedback.suites
      .filter((suite) => !unitIds.has(suite.id))
      .map((suite) => suite.id),
    [
      ...(["darwin", "linux"].includes(process.platform)
        ? ["dev-tui-format"]
        : []),
      "root-lint",
      "root-format",
      "workshop-types",
      "client-types",
      "client-format",
    ],
  );
  assert.ok(
    createPlan({ checks: true }).suites.every(
      (suite) => suite.kind === "check",
    ),
  );
  const coverage = createPlan({ coverage: true, extended: true });
  assert.deepEqual(
    coverage.suites.map((suite) => suite.id),
    ["client-vue-coverage", "client-rust-coverage"],
  );
  assert.equal(coverage.suites[0].npm, "client");
  assert.deepEqual(coverage.suites[1].args, [
    "llvm-cov",
    "--workspace",
    "--locked",
    "--lcov",
    "--output-path",
    "target/coverage/rust.lcov",
  ]);
  assert.throws(
    () => createPlan({ feedback: true, unit: true }),
    /Choose only one/,
  );
  assert.throws(
    () => parseOptions(["--checks", "--coverage"]),
    /Choose only one/,
  );
});

test("Pi defaults to the checkout dependency and supports only an explicit external override", (t) => {
  const { directory, put } = repository(t);
  assert.throws(
    () => suiteEnvironment({ environment: "pi" }, directory, {}),
    /Run npm ci/,
  );
  put("node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  assert.equal(
    suiteEnvironment({ environment: "pi" }, directory, {}).PI_PACKAGE_ROOT,
    join(directory, "node_modules/@earendil-works/pi-coding-agent"),
  );
  put("alternate-pi/dist/index.js");
  assert.equal(
    suiteEnvironment({ environment: "pi" }, directory, {
      PI_PACKAGE_ROOT: join(directory, "alternate-pi"),
    }).PI_PACKAGE_ROOT,
    join(directory, "alternate-pi"),
  );
});

test("dev TUI has independent locked Rust suites on supported hosts", () => {
  const files = sourceFiles(root);
  for (const host of ["darwin", "linux"]) {
    const suites = suiteInventory(files, host).filter(
      (suite) => suite.project === "dev-tui",
    );
    assert.deepEqual(
      suites.map(({ id, kind, cwd, command, args }) => ({
        id,
        kind,
        cwd,
        command,
        args,
      })),
      [
        {
          id: "dev-tui-unit",
          kind: "unit",
          cwd: "tools/dev-tui",
          command: "cargo",
          args: ["test", "--locked"],
        },
        {
          id: "dev-tui-format",
          kind: "check",
          cwd: "tools/dev-tui",
          command: "cargo",
          args: ["fmt", "--all", "--", "--check"],
        },
        {
          id: "dev-tui-clippy",
          kind: "check",
          cwd: "tools/dev-tui",
          command: "cargo",
          args: ["clippy", "--all-targets", "--locked", "--", "-D", "warnings"],
        },
      ],
    );
  }
  assert.ok(
    !suiteInventory(files, "win32").some(
      (suite) => suite.project === "dev-tui",
    ),
  );
});

test("dev TUI paths do not trigger the broad tools selection", () => {
  for (const file of [
    "src/main.rs",
    "Cargo.lock",
    "rust-toolchain.toml",
    "tests/process.rs",
  ]) {
    assert.deepEqual(affectedProjects([`tools/dev-tui/${file}`]), ["dev-tui"]);
  }
  assert.deepEqual(
    affectedProjects(["tools/dev-tui/src/main.rs", "client/app/src/App.vue"]),
    ["client", "dev-tui"],
  );
  assert.deepEqual(affectedProjects(["tools/dev.mjs"]), projects);
});

test("new tool tests are discovered by category", () => {
  const suites = suiteInventory([
    ...sourceFiles(root),
    "tools/quality.test.mjs",
    "tools/bootstrap.integration.test.mjs",
  ]);
  assert.ok(
    suites
      .find((suite) => suite.id === "runner-unit")
      .args.includes("tools/quality.test.mjs"),
  );
  assert.ok(
    suites
      .find((suite) => suite.id === "runner-integration")
      .args.includes("tools/bootstrap.integration.test.mjs"),
  );
});

test("unit profile excludes real servers, browsers, Docker and the native host build", () => {
  const plan = createPlan({ unit: true, extended: true });
  assert.ok(plan.suites.length > 0);
  assert.ok(plan.suites.every((suite) => suite.kind === "unit"));
  const scripts = plan.suites.find(
    (suite) => suite.id === "client-scripts-unit",
  );
  assert.ok(scripts.args.includes("client/scripts/ios-xcode.test.mjs"));
  assert.ok(scripts.args.every((arg) => !arg.includes(".integration.")));
  assert.deepEqual(
    plan.suites.find((suite) => suite.id === "client-core").args,
    ["test", "-p", "situate-core", "--locked"],
  );
  assert.ok(
    plan.suites
      .find((suite) => suite.id === "pi-unit")
      .args.includes(".pi/extensions/test-suite/index.test.mjs"),
  );
  assert.ok(!plan.suites.some((suite) => suite.id === "pi-test-hook"));
});

test("workshop browser projects retain the full inventory and separate outputs", () => {
  const files = sourceFiles(root);
  const expected = files.filter((file) =>
    /^client\/workshop\/tests\/browser\/.*\.(test|spec)\.[cm]?[jt]s$/.test(
      file,
    ),
  );
  assert.ok(expected.length > 0);
  const suites = suiteInventory(files).filter(
    ({ project, kind, cwd }) =>
      project === "client" && kind === "browser" && cwd === "client/workshop",
  );
  assert.deepEqual(
    suites.map(({ id }) => id),
    ["workshop-chromium", "workshop-webkit"],
  );
  for (const suite of suites) {
    assert.equal(suite.command, process.execPath);
    assert.equal(suite.npm, "client");
    assert.deepEqual(suite.covers, expected);
    assert.deepEqual(suite.args, [
      "../node_modules/@playwright/test/cli.js",
      "test",
      "--forbid-only",
      "--project",
      suite.id,
      "--output",
      `../test-results/${suite.id}`,
    ]);
  }
});

test("workshop interactions and models have independent suites", () => {
  const inventory = suiteInventory(sourceFiles(root));
  const suite = inventory.find(
    (candidate) => candidate.id === "workshop-chromium",
  );
  assert.equal(suite?.project, "client");
  assert.equal(suite.kind, "browser");
  assert.ok(
    suite.covers.includes("client/workshop/tests/browser/workshop.spec.ts"),
  );
  assert.ok(
    suite.covers.includes(
      "client/workshop/tests/browser/workshop-explorations.spec.ts",
    ),
  );
  assert.ok(
    suite.covers.includes("client/workshop/tests/browser/workshop-ai.spec.ts"),
  );
  assert.ok(
    suite.covers.includes(
      "client/workshop/tests/browser/workshop-conflicts.spec.ts",
    ),
  );
  const unit = createPlan({ unit: true });
  assert.ok(
    !unit.suites.some((candidate) =>
      ["workshop-chromium", "workshop-webkit"].includes(candidate.id),
    ),
  );
  assert.ok(unit.suites.some((candidate) => candidate.id === "workshop-vue"));
  const views = inventory.find((candidate) => candidate.id === "workshop-vue");
  for (const directory of ["editor", "navigation", "ai", "workshop/platform"]) {
    assert.ok(
      views.covers.some((file) =>
        file.startsWith(`client/workshop/src/${directory}/`),
      ),
    );
  }
});

test("all existing JS/TS tests are classified and new unknown tests fail closed", () => {
  const files = sourceFiles(root);
  assert.doesNotThrow(() => suiteInventory(files));
  assert.throws(
    () => suiteInventory([...files, "new-project/new.test.ts"]),
    /Unclassified tests/,
  );
  assert.throws(
    () => suiteInventory([...files, "client/packages/ui/new.test.ts"]),
    /Unclassified tests/,
  );
  assert.ok(
    suiteInventory(files)
      .find((suite) => suite.id === "requirements-integration")
      .covers.includes("requirements/tests/server.integration.test.js"),
  );
  assert.throws(
    () =>
      suiteInventory([...files, "client/app/src/server.integration.test.ts"]),
    /Unclassified tests/,
  );
  const added = suiteInventory([
    ...files,
    "client/scripts/new.test.mjs",
    "client/scripts/new.integration.test.mjs",
  ]);
  assert.ok(
    added
      .find((suite) => suite.id === "client-scripts-unit")
      .args.includes("client/scripts/new.test.mjs"),
  );
  assert.ok(
    !added
      .find((suite) => suite.id === "client-scripts-unit")
      .args.includes("client/scripts/new.integration.test.mjs"),
  );
  assert.ok(
    added
      .find((suite) => suite.id === "client-scripts-integration")
      .args.includes("client/scripts/new.integration.test.mjs"),
  );
});

test("MVP filtering cannot hide unclassified tests", (t) => {
  const { directory, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  put("design/unregistered.test.ts");
  for (const options of [{}, { unit: true }, { extended: true }]) {
    assert.throws(
      () => createPlan(options, directory),
      /Unclassified tests.*\n.*design\/unregistered.test.ts/,
    );
  }
});

test("affected projects include shared brand and browser dependencies", () => {
  assert.deepEqual(affectedProjects(["client/app/src/App.vue"]), ["client"]);
  assert.deepEqual(affectedProjects(["website/system/index.html"]), ["design"]);
  assert.deepEqual(affectedProjects(["infrastructure/website/deploy.mjs"]), [
    "design",
  ]);
  assert.deepEqual(
    affectedProjects(["infrastructure/production/inspect.mjs"]),
    ["design"],
  );
  assert.deepEqual(affectedProjects(["infrastructure/releases/remote.py"]), [
    "client",
    "design",
  ]);
  assert.deepEqual(affectedProjects(["requirements/src/app.js"]), [
    "requirements",
  ]);
  assert.deepEqual(affectedProjects(["requirements/data/goals/removed.md"]), [
    "requirements",
    "design",
  ]);
  assert.deepEqual(affectedProjects([".pi/role-mode/roles/cto/role.json"]), [
    "pi",
  ]);
  assert.deepEqual(affectedProjects(["design/brand/tokens.css"]), [
    "client",
    "design",
  ]);
  assert.deepEqual(affectedProjects(["design/brand/tokens.json"]), [
    "client",
    "design",
    "dev-tui",
  ]);
  assert.deepEqual(affectedProjects(["client/package-lock.json"]), [
    "client",
    "design",
  ]);
  assert.deepEqual(
    affectedProjects(["client/workshop/src/navigation/NavigationView.vue"]),
    ["client"],
  );
  assert.deepEqual(affectedProjects(["docs/architecture/README.md"]), [
    "design",
  ]);
  assert.deepEqual(affectedProjects(["tools/test.mjs"]), projects);
  assert.deepEqual(affectedProjects(["new-project/code.js"]), projects);
  assert.deepEqual(affectedProjects([".gitignore"]), projects);
  assert.deepEqual(affectedProjects([]), []);
});

test("feedback client selection follows frontend boundaries and keeps shared contracts", () => {
  const clientSuites = [
    "client-core",
    "client-format",
    "client-scripts-unit",
    "client-types",
    "client-vue",
    "workshop-types",
    "workshop-vue",
  ];
  const ids = (files) =>
    clientSuites
      .filter((id) => suiteAffectedFiles({ id }, files).length)
      .sort();
  assert.deepEqual(ids(["client/app/src/App.vue"]), [
    "client-scripts-unit",
    "client-types",
    "client-vue",
  ]);
  assert.deepEqual(ids(["client/workshop/src/editor/model.ts"]), [
    "client-scripts-unit",
    "workshop-types",
    "workshop-vue",
  ]);
  assert.deepEqual(ids(["client/packages/localization/src/en.json"]), [
    "client-core",
    "client-scripts-unit",
    "client-types",
    "client-vue",
    "workshop-types",
    "workshop-vue",
  ]);
  assert.deepEqual(ids(["design/brand/tokens.css"]), [
    "client-core",
    ...ids(["client/packages/ui/src/Button.vue"]),
  ]);
  assert.deepEqual(ids([".pi/extensions/test-suite/index.ts"]), []);
  for (const file of [
    "client/Cargo.toml",
    "client/app/src-tauri/src/lib.rs",
    "client/package-lock.json",
    "client/scripts/new.mjs",
    "tools/test.mjs",
    "unknown.ts",
    "client/packages/new/src/index.ts",
    "client/app/vite.config.ts",
  ])
    assert.deepEqual(ids([file]), clientSuites, file);
});

test("changed profiles share frontend boundaries while retaining their test categories", (t) => {
  const { directory, git, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  git("add", ".");
  git("commit", "-m", "Register suites");
  put("client/workshop/src/example.ts");
  const feedback = createPlan({ feedback: true, changed: true }, directory);
  assert.deepEqual(
    feedback.suites.map((s) => s.id),
    [
      "root-lint",
      "root-format",
      "client-scripts-unit",
      "workshop-vue",
      "workshop-types",
    ],
  );
  assert.deepEqual(
    createPlan(
      { unit: true, changed: true, extended: true },
      directory,
    ).suites.map(({ id }) => id),
    ["client-scripts-unit", "workshop-vue"],
  );
  const extended = createPlan({ changed: true, extended: true }, directory);
  assert.ok(extended.suites.some((s) => s.id === "workshop-webkit"));
  assert.ok(!extended.suites.some((s) => s.id === "client-native"));
  git("add", ".");
  git("commit", "-m", "Workshop change");
  assert.deepEqual(
    createPlan({ changed: true, base: "HEAD~1", extended: true }, directory)
      .suites.filter(({ id }) =>
        ["workshop-chromium", "workshop-webkit"].includes(id),
      )
      .map(({ id }) => id),
    ["workshop-chromium", "workshop-webkit"],
  );
  assert.deepEqual(
    createPlan({ feedback: true, changed: true, base: "HEAD~1" }, directory)
      .suites,
    feedback.suites,
  );
  assert.deepEqual(
    createPlan({ feedback: true, changed: true }, directory).suites,
    [],
  );
  put("client/package-lock.json");
  assert.ok(
    createPlan(
      { feedback: true, changed: true, extended: true },
      directory,
    ).suites.some((s) => s.id === "client-core"),
  );
});

test(
  "dev TUI changed feedback plans select its tests and formatting without frontend suites",
  { skip: !["darwin", "linux"].includes(process.platform) },
  (t) => {
    const { directory, git, put } = repository(t);
    for (const file of sourceFiles(root).filter((file) =>
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
    ))
      put(file);
    git("add", ".");
    git("commit", "-m", "Register suites");
    put("tools/dev-tui/src/main.rs");
    const plan = createPlan(
      { feedback: true, changed: true, extended: true },
      directory,
    );
    assert.deepEqual(plan.projects, ["dev-tui"]);
    assert.deepEqual(
      plan.suites.map((suite) => suite.id),
      ["dev-tui-unit", "dev-tui-format", "root-format"],
    );
    assert.deepEqual(
      createPlan(
        { unit: true, changed: true, extended: true },
        directory,
      ).suites.map((suite) => suite.id),
      ["dev-tui-unit"],
    );
  },
);

test("feedback changed documentation is scoped, rename/delete safe, and includes dirty code", (t) => {
  const { directory, git, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  put("client/README.md", "# Old\n");
  git("add", ".");
  git("commit", "-m", "Register suites");
  renameSync(
    join(directory, "client/README.md"),
    join(directory, "client/CHANGELOG.md"),
  );
  put("docs/guide.md", "# Guide\n");
  const plan = () => createPlan({ feedback: true, changed: true }, directory);
  assert.deepEqual(
    plan().suites.map(({ id }) => id),
    ["root-format", "design-contracts"],
  );
  const format = plan().suites.find(({ id }) => id === "root-format");
  assert.deepEqual(format.args, [
    "node_modules/prettier/bin/prettier.cjs",
    "--check",
    "--ignore-unknown",
    "--",
    "./client/CHANGELOG.md",
    "./docs/guide.md",
  ]);
  assert.ok(plan().suites.every(({ reasons }) => reasons.length > 0));
  put("client/app/src/App.vue");
  assert.deepEqual(
    plan().suites.map(({ id }) => id),
    [
      "root-lint",
      "root-format",
      "client-scripts-unit",
      "client-vue",
      "client-types",
      "design-contracts",
    ],
  );
  rmSync(join(directory, "client/app/src/App.vue"));
  rmSync(join(directory, "docs/guide.md"));
  rmSync(join(directory, "client/CHANGELOG.md"));
  assert.deepEqual(
    plan().suites.map(({ id }) => id),
    ["design-contracts"],
  );
});

test("document selection is shared by unit, feedback and full changed profiles", (t) => {
  const { directory, git, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  git("add", ".");
  git("commit", "-m", "Register suites");
  for (const file of [
    "docs/architecture/concept.adoc",
    "design/concepts/navigation.md",
    "client/README.md",
    "requirements/data/goals/GOAL-9999.md",
  ]) {
    put(file, "# Example\n");
    for (const profile of [{ unit: true }, { feedback: true }, {}]) {
      const expected = profile.unit ? [] : ["root-format"];
      if (!profile.unit && !profile.feedback) expected.push("root-secrets");
      if (file.startsWith("requirements/data/"))
        expected.push("requirements-unit", "requirements-catalog");
      expected.push("design-contracts");
      const plan = createPlan(
        { ...profile, changed: true, extended: true },
        directory,
      );
      assert.deepEqual(
        plan.suites.map(({ id }) => id),
        expected,
        file,
      );
      assert.ok(
        plan.suites.every(({ reasons }) =>
          reasons.includes(`Input changed: ${file}`),
        ),
      );
    }
    assert.deepEqual(
      createPlan({ coverage: true, changed: true, extended: true }, directory)
        .suites,
      [],
      file,
    );
    rmSync(join(directory, file));
  }
  put("design/concepts/navigation.md", "# Navigation\n");
  put("client/app/src/App.vue");
  for (const profile of [{ unit: true }, { feedback: true }, {}]) {
    const ids = createPlan({ ...profile, changed: true }, directory).suites.map(
      ({ id }) => id,
    );
    assert.ok(ids.includes("client-vue"));
    assert.ok(ids.includes("design-contracts"));
  }
});

test("cache diagnostics survive the runner and JSON report without changing status", async () => {
  const cache = {
    reason: "unsupported-configuration",
    configuration: "client/app/tsconfig.json",
    recorded: false,
  };
  const report = await runPlan(
    {
      profile: "feedback",
      suites: [{ id: "client-types", project: "client", kind: "check" }],
    },
    {
      execute: async () => ({
        status: "passed",
        exitCode: 0,
        durationMs: 1,
        reused: false,
        cache,
      }),
    },
  );
  assert.equal(report.status, "passed");
  assert.deepEqual(JSON.parse(JSON.stringify(report)).results[0].cache, cache);
});

test("scoped documentation formatting honors ignore files and configuration", (t) => {
  const { directory, git, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  put(".prettierignore", "docs/ignored.md\n");
  put(
    ".prettierrc.json",
    JSON.stringify({ proseWrap: "always", printWidth: 20 }),
  );
  git("add", ".");
  git("commit", "-m", "Register suites");
  put("docs/ignored.md", "#   Unformatted\n");
  put("docs/guide.md", "# Guide\n");
  put("docs/[draft]*.md", "# Draft\n");
  const format = createPlan(
    { feedback: true, changed: true },
    directory,
  ).suites.find(({ id }) => id === "root-format");
  const run = () =>
    spawnSync(
      format.command,
      [join(root, format.args[0]), ...format.args.slice(1)],
      { cwd: directory, encoding: "utf8" },
    );
  assert.equal(run().status, 0);
  put("docs/unselected.md", "#   Unselected\n");
  assert.equal(run().status, 0);
  put(
    "docs/guide.md",
    "# Guide\n\nThis is a long line that must wrap under the configured width.\n",
  );
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/guide\.md/);
  assert.doesNotMatch(result.stderr, /ignored\.md/);
});

test("successful-suite cache is explicitly limited to local feedback changed checks", () => {
  assert.equal(
    parseOptions(
      ["--feedback", "--changed", "--success-cache", "/tmp/cache"],
      {},
    )["success-cache"],
    "/tmp/cache",
  );
  for (const args of [
    ["--success-cache", "/tmp/cache"],
    ["--feedback", "--success-cache", "/tmp/cache"],
    ["--feedback", "--changed", "--success-cache", " "],
  ])
    assert.throws(() => parseOptions(args, {}), /success-cache/);
  assert.throws(
    () =>
      parseOptions(
        ["--feedback", "--changed", "--success-cache", "/tmp/cache"],
        {
          CI: "true",
        },
      ),
    /non-CI/,
  );
});

test("a fully deferred changed selection remains no-tests rather than passed", async (t) => {
  const { directory, git, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  git("add", ".");
  git("commit", "-m", "Register suites");
  put("tools/dev-tui/src/main.rs");
  const options = { unit: true, changed: true, platform: "linux" };
  const plan = createPlan(options, directory);
  assert.deepEqual(plan.suites, []);
  assert.deepEqual(plan.deferredSuiteIds, ["dev-tui-unit"]);
  const report = await runPlan(plan, {
    execute: () => assert.fail("No suite should run"),
  });
  assert.equal(report.status, "no-tests");
  assert.deepEqual(report.deferredSuiteIds, ["dev-tui-unit"]);
  assert.deepEqual(
    createPlan({ ...options, extended: true }, directory).suites.map(
      (s) => s.id,
    ),
    ["dev-tui-unit"],
  );
});

test("change detection unions index, working tree and untracked files without ignored output", (t) => {
  const { directory, git, put } = repository(t);
  put("client/source.txt", "staged");
  git("add", "client/source.txt");
  put("client/source.txt", "fixture");
  put("requirements/source.txt", "unstaged");
  put("new project/file with spaces.txt");
  put("ignored/cache.txt");
  assert.deepEqual(changedFiles(directory), [
    "client/source.txt",
    "new project/file with spaces.txt",
    "requirements/source.txt",
  ]);
});

test("renames select both old and new projects and deletions remain visible", (t) => {
  const { directory, git } = repository(t);
  renameSync(
    join(directory, "client/source.txt"),
    join(directory, "requirements/moved.txt"),
  );
  git("add", "-A");
  rmSync(join(directory, "requirements/source.txt"));
  assert.deepEqual(changedFiles(directory), [
    "client/source.txt",
    "requirements/moved.txt",
    "requirements/source.txt",
  ]);
});

test(
  "NUL-delimited paths preserve Unicode, tabs and newlines",
  { skip: process.platform === "win32" },
  (t) => {
    const { directory, put } = repository(t);
    const file = "client/café\tline\nbreak.txt";
    put(file);
    assert.deepEqual(changedFiles(directory), [file]);
  },
);

test("base selection uses the merge base and still includes local changes", (t) => {
  const { directory, git, put } = repository(t);
  git("branch", "feature");
  put("requirements/source.txt", "main only");
  git("commit", "-am", "Main advances");
  git("checkout", "feature");
  put("client/source.txt", "feature");
  git("commit", "-am", "Feature changes");
  put(".pi/local.txt");
  assert.deepEqual(changedFiles(directory, "main"), [
    ".pi/local.txt",
    "client/source.txt",
  ]);
  assert.deepEqual(changedFiles(directory, "HEAD"), [".pi/local.txt"]);
});

test("clean checkouts select nothing locally but committed changes can be selected", (t) => {
  const { directory, git, put } = repository(t);
  assert.deepEqual(changedFiles(directory), []);
  put("client/source.txt", "committed");
  git("commit", "-am", "Change client");
  assert.deepEqual(changedFiles(directory), []);
  assert.deepEqual(changedFiles(directory, "HEAD~1"), ["client/source.txt"]);
  assert.throws(() => changedFiles(directory, "does-not-exist"));
  assert.throws(() => changedFiles(directory, "--help"));
});

test("changed selection composes with both profiles before and after a commit", (t) => {
  const { directory, git, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  git("add", ".");
  git("commit", "-m", "Register fixture suites");
  assert.deepEqual(createPlan({ changed: true }, directory).suites, []);
  assert.deepEqual(
    createPlan({ changed: true }, directory).deferredSuiteIds,
    [],
  );
  put("client/app/src/component.vue");
  const full = createPlan({ changed: true }, directory);
  const unit = createPlan({ changed: true, unit: true }, directory);
  assert.deepEqual(full.projects, ["client"]);
  const extended = createPlan({ changed: true, extended: true }, directory);
  assert.ok(extended.suites.some((suite) => suite.id === "client-visual"));
  assert.ok(full.deferredSuiteIds.includes("client-visual"));
  assert.ok(!extended.suites.some((suite) => suite.id === "workshop-webkit"));
  assert.ok(!full.deferredSuiteIds.includes("design-validation-browser"));
  assert.equal(
    full.suites.some((suite) => suite.kind === "native"),
    process.platform === "darwin",
  );
  assert.ok(
    unit.suites.length > 0 &&
      unit.suites.every(
        (suite) => suite.project === "client" && suite.kind === "unit",
      ),
  );
  git("add", ".");
  git("commit", "-m", "Change client fixture");
  assert.deepEqual(
    createPlan({ changed: true, unit: true }, directory).suites,
    [],
  );
  assert.deepEqual(
    createPlan({ changed: true, base: "HEAD~1" }, directory).suites,
    full.suites,
  );
  assert.deepEqual(
    createPlan({ changed: true, unit: true, base: "HEAD~1" }, directory).suites,
    unit.suites,
  );
});

test("CLI enforces required selections and lists changed-suite reasons", (t) => {
  const { directory, git, put } = repository(t);
  for (const file of sourceFiles(root).filter((file) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ))
    put(file);
  for (const name of [
    "test.mjs",
    "test-scope.mjs",
    "test-budget.mjs",
    "quick-source.mjs",
    "test-inputs.mjs",
    "quality-cache.mjs",
    "cargo-environment.mjs",
    "compiler-cache.mjs",
    "run-coordinated.mjs",
    "worktree-supervisor.py",
  ])
    put(`tools/${name}`, readFileSync(join(root, "tools", name), "utf8"));
  git("add", ".");
  git("commit", "-m", "Register fixture suites");
  for (const [args, ci, expected] of [
    [[], "false", 0],
    [["--require-tests"], "false", 1],
    [[], "true", 1],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["tools/test.mjs", "--changed", "--json", ...args],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, CI: ci, NODE_TEST_CONTEXT: "" },
      },
    );
    assert.equal(result.status, expected, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "no-tests");
  }
  put("client/README.md", "# Client\n");
  const listed = spawnSync(
    process.execPath,
    ["tools/test.mjs", "--feedback", "--changed", "--list"],
    { cwd: directory, encoding: "utf8" },
  );
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /Input changed: client\/README\.md/);
});

test("Git failures are errors, not an empty successful selection", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-non-git-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => changedFiles(directory));
});

test("options compose and invalid filters fail explicitly", () => {
  assert.deepEqual(parseOptions([]), { timeout: 600 });
  const options = parseOptions([
    "--unit",
    "--changed",
    "--base",
    "HEAD~1",
    "--json",
    "--list",
  ]);
  assert.ok(options.unit && options.changed && options.json && options.list);
  assert.equal(options.base, "HEAD~1");
  assert.ok(parseOptions(["--extended", "--feedback", "--changed"]).extended);
  for (const args of [
    ["--base", "main"],
    ["--changed", "--base", ""],
    ["--timeout", "0"],
    ["--timeout", "1.5"],
    ["--timeout", "NaN"],
    ["--unknown"],
    ["--jobs", "2"],
    ["--feedback", "--jobs", "0"],
    ["--feedback", "--jobs", "9"],
    ["--feedback", "--jobs", "1.5"],
    ["extra"],
  ]) {
    assert.throws(() => parseOptions(args), args.join(" "));
  }
});

test("Pi package selection accepts paths with spaces and rejects empty overrides", () => {
  assert.equal(
    parseOptions(["--pi-package-root", "/installed Pi/package"])[
      "pi-package-root"
    ],
    "/installed Pi/package",
  );
  assert.throws(
    () => parseOptions(["--pi-package-root", ""]),
    /nonempty package directory/,
  );
});

test("design runs pin Playwright but leave browser defaults and explicit overrides to the harness", () => {
  const defaults = suiteEnvironment({ environment: "design" }, root, {});
  for (const key of [
    "BROWSER_CHANNEL",
    "BEND_BROWSER_CHANNEL",
    "PLAYWRIGHT_CHANNEL",
    "BROWSER_EXECUTABLE",
  ])
    assert.equal(defaults[key], undefined);
  const overrides = {
    BROWSER_CHANNEL: "chromium",
    BEND_BROWSER_CHANNEL: "chrome",
    PLAYWRIGHT_CHANNEL: "chromium-headless-shell",
    BROWSER_EXECUTABLE: "/custom/chrome",
  };
  const env = suiteEnvironment({ environment: "design" }, root, {
    ...overrides,
    PLAYWRIGHT_MODULE: "/other/playwright",
  });
  assert.equal(
    env.PLAYWRIGHT_MODULE,
    join(root, "client/node_modules/playwright"),
  );
  assert.equal(env.BEND_PLAYWRIGHT_MODULE, env.PLAYWRIGHT_MODULE);
  for (const [key, value] of Object.entries(overrides))
    assert.equal(env[key], value);
});

test("nested Node test workers cannot suppress registered suites", () => {
  const original = { NODE_TEST_CONTEXT: "child-v8", KEEP: "value" };
  const environment = suiteEnvironment({}, root, original);
  assert.equal(environment.NODE_TEST_CONTEXT, undefined);
  assert.equal(environment.KEEP, "value");
  assert.equal(original.NODE_TEST_CONTEXT, "child-v8");
});

test("Linux native testing supplies a display while other hosts run directly", () => {
  const files = sourceFiles(root);
  const linux = suiteInventory(files, "linux").find(
    (suite) => suite.id === "client-native",
  );
  assert.equal(linux.command, "dbus-run-session");
  assert.ok(linux.args.includes("xvfb-run"));
  assert.equal(
    suiteInventory(files, "darwin").find(
      (suite) => suite.id === "client-native",
    ).command,
    process.execPath,
  );
});

test("Swift workspace access checks run on macOS outside the fast profile", () => {
  const files = sourceFiles(root);
  const swift = suiteInventory(files, "darwin").find(
    (suite) => suite.id === "client-workspace-access-swift",
  );
  assert.equal(swift.kind, "integration");
  assert.equal(swift.command, process.execPath);
  assert.deepEqual(swift.args, [
    "client/scripts/test-workspace-access-swift.mjs",
  ]);
  for (const host of ["linux", "win32"]) {
    assert.ok(
      !suiteInventory(files, host).some(
        (suite) => suite.id === "client-workspace-access-swift",
      ),
    );
  }
});

test("execution attempts all suites after failures and prerequisite errors", async () => {
  const suites = ["failed", "missing", "passed"].map((id) => command(id, ""));
  const called = [];
  const report = await runPlan(
    { suites },
    {
      execute: async (suite) => {
        called.push(suite.id);
        if (suite.id === "missing") throw new Error("Tool is unavailable");
        return {
          status: suite.id,
          exitCode: suite.id === "passed" ? 0 : 1,
          durationMs: 0,
        };
      },
    },
  );
  assert.deepEqual(called, ["failed", "missing", "passed"]);
  assert.equal(report.status, "failed");
  assert.equal(report.results[1].error, "Tool is unavailable");
});

test(
  "parallel feedback suites share dependency leases and retain report order",
  { timeout: 2000 },
  async () => {
    const first = Promise.withResolvers();
    const bothStarted = Promise.withResolvers();
    const events = [];
    let active = 0;
    const suites = ["client-vue", "workshop-vue", "client-types"].map((id) => ({
      ...command(id, ""),
      npm: "client",
    }));
    const pending = runPlan(
      { profile: "feedback", suites },
      {
        prepare: async (workspace) => {
          events.push(`prepare:${workspace}`);
          return {
            release: () => {
              assert.equal(active, 0);
              events.push("release");
            },
          };
        },
        execute: async (suite) => {
          active++;
          assert.ok(active <= 2);
          events.push(suite.id);
          if (suite.id === "client-vue") await first.promise;
          if (suite.id === "workshop-vue") {
            bothStarted.resolve();
            await first.promise;
          }
          active--;
          return { status: "passed", exitCode: 0, durationMs: 1 };
        },
      },
    );
    await bothStarted.promise;
    first.resolve();
    const report = await pending;
    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.results.map((r) => r.id),
      suites.map((s) => s.id),
    );
    assert.equal(events.filter((e) => e === "prepare:client").length, 1);
    assert.equal(events.at(-1), "release");
    assert.ok(report.durationMs >= report.setupDurationMs);
  },
);

test("parallel Vue suites divide the host worker budget without changing other suite environments", async () => {
  for (const { parallelism, jobs, expected } of [
    { parallelism: 18, jobs: 2, expected: "4" },
    { parallelism: 18, jobs: 4, expected: "4" },
    { parallelism: 2, jobs: 8, expected: "1" },
    { parallelism: 1, jobs: 2, expected: "1" },
  ]) {
    const environment = { KEEP: "fixture" };
    const report = await runPlan(
      {
        profile: "feedback",
        suites: ["client-vue", "workshop-vue", "client-types"].map((id) =>
          command(id, ""),
        ),
      },
      {
        jobs,
        parallelism,
        environment,
        execute: async (suite, options) => {
          assert.deepEqual(options.environment, {
            KEEP: "fixture",
            ...(suite.id !== "client-types"
              ? { VITEST_MAX_WORKERS: expected }
              : {}),
          });
          return { status: "passed", exitCode: 0, durationMs: 0 };
        },
      },
    );
    assert.equal(report.status, "passed");
    assert.deepEqual(environment, { KEEP: "fixture" });
  }
});

test("serial runs preserve Vitest defaults and explicit worker settings are not replaced", async () => {
  for (const { profile, jobs, environment } of [
    { profile: "feedback", jobs: 1, environment: {} },
    { profile: "unit", jobs: 1, environment: {} },
    { profile: "all", jobs: 2, environment: {} },
    { profile: "feedback", jobs: 2, environment: { VITEST_MAX_WORKERS: "2" } },
    { profile: "feedback", jobs: 2, environment: { VITEST_MAX_WORKERS: "" } },
  ]) {
    const report = await runPlan(
      { profile, suites: [command("client-vue", "")] },
      {
        jobs,
        parallelism: 18,
        environment,
        execute: async (_suite, options) => {
          assert.deepEqual(options.environment, environment);
          return { status: "passed", exitCode: 0, durationMs: 0 };
        },
      },
    );
    assert.equal(report.status, "passed");
  }
});

for (const withDiagnostics of [false, true]) {
  test(`the default feedback worker budget reaches both Vue child processes${withDiagnostics ? " with queue diagnostics" : ""}`, async () => {
    let output = "";
    const report = await runPlan(
      {
        profile: "feedback",
        suites: ["client-vue", "workshop-vue"].map((id) =>
          command(
            id,
            `${withDiagnostics ? 'console.error("Waiting for the current build command to finish…");' : ""}
            console.log("WORKER_BUDGET ${id} " + process.env.VITEST_MAX_WORKERS);`,
          ),
        ),
      },
      {
        parallelism: 18,
        environment: {},
        buildLease: false,
        output: new Writable({
          write(chunk, _encoding, done) {
            output += chunk;
            done();
          },
        }),
      },
    );
    assert.equal(report.status, "passed");
    assert.deepEqual(
      output
        .split(/\r?\n/)
        .filter((line) => line.startsWith("WORKER_BUDGET "))
        .sort(),
      ["WORKER_BUDGET client-vue 4", "WORKER_BUDGET workshop-vue 4"],
    );
  });
}

test("source-fixture suites are exclusive and full profiles remain serial", async () => {
  for (const profile of ["feedback", "all"]) {
    let active = 0;
    const report = await runPlan(
      {
        profile,
        suites: [
          "root-lint",
          "runner-unit",
          "client-scripts-unit",
          "new-suite",
          "client-vue",
        ].map((id) => command(id, "")),
      },
      {
        jobs: 2,
        execute: async () => {
          assert.equal(active++, 0);
          await Promise.resolve();
          active--;
          return { status: "passed", exitCode: 0, durationMs: 0 };
        },
      },
    );
    assert.equal(report.status, "passed");
  }
  assert.equal(parseOptions(["--feedback", "--jobs", "1"]).jobs, 1);
  await assert.rejects(runPlan({ suites: [] }, { jobs: 0 }), /jobs/);
});

test("parallel cancellation stops queued suites and releases prepared dependencies", async () => {
  const controller = new AbortController();
  let released = false;
  const report = await runPlan(
    {
      profile: "feedback",
      suites: ["client-vue", "workshop-vue", "client-types"].map((id) => ({
        ...command(id, ""),
        npm: "client",
      })),
    },
    {
      signal: controller.signal,
      prepare: async () => ({
        release: () => {
          released = true;
        },
      }),
      execute: async () => {
        controller.abort();
        return { status: "cancelled", exitCode: null, durationMs: 0 };
      },
    },
  );
  assert.equal(report.status, "cancelled");
  assert.deepEqual(
    report.results.map((r) => r.status),
    ["cancelled", "not-run", "not-run"],
  );
  assert.equal(released, true);
});

test("parallel preparation acquires workspaces in order and does not retry failures", async () => {
  const prepared = [];
  const executed = [];
  const released = [];
  const report = await runPlan(
    {
      profile: "feedback",
      suites: [
        { ...command("requirements-unit", ""), npm: "requirements" },
        { ...command("client-vue", ""), npm: "client" },
        { ...command("workshop-vue", ""), npm: "client" },
      ],
    },
    {
      prepare: async (workspace) => {
        prepared.push(workspace);
        return {
          release: () => released.push(workspace),
          ...(workspace === "client"
            ? { failure: { status: "failed", exitCode: 2, durationMs: 0 } }
            : {}),
        };
      },
      execute: async (suite) => {
        executed.push(suite.id);
        return { status: "passed", exitCode: 0, durationMs: 0 };
      },
    },
  );
  assert.deepEqual(prepared, ["client", "requirements"]);
  assert.deepEqual(released, prepared);
  assert.deepEqual(executed, ["requirements-unit"]);
  assert.deepEqual(
    report.results.map((r) => r.status),
    ["passed", "failed", "failed"],
  );
});

test("empty selections are reported separately from successful test execution", async () => {
  assert.equal((await runPlan({ suites: [] })).status, "no-tests");
});

test("cancellation marks remaining suites not-run instead of passed", async () => {
  const controller = new AbortController();
  const suites = ["first", "second"].map((id) => command(id, ""));
  const report = await runPlan(
    { suites },
    {
      signal: controller.signal,
      execute: async () => {
        controller.abort();
        return { status: "cancelled", exitCode: null, durationMs: 0 };
      },
    },
  );
  assert.equal(report.status, "cancelled");
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["cancelled", "not-run"],
  );
});

test("subprocess failures and missing executables return failure results", async () => {
  const result = await executeSuite(command("exit", "process.exit(7)"), {
    output: silent(),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  const missing = await executeSuite(
    { ...command("missing", ""), command: "situate-no-such-test-executable" },
    { output: silent() },
  );
  assert.equal(missing.status, "failed");
  assert.match(missing.error, /ENOENT/);
});

test("termination never adopts a reused root PID or its unrelated descendants", () => {
  const snapshot = new Map([
    [10, { parent: 1, born: "replacement" }],
    [20, { parent: 10, born: "new child" }],
  ]);
  assert.deepEqual(
    [...ownedDescendants(new Map([[10, "original"]]), snapshot)],
    [],
  );
  assert.deepEqual([...ownedDescendants(new Map(), snapshot)], []);
});

test("escalation preserves owned orphans but rejects reused descendant PIDs", () => {
  const initial = new Map([
    [10, { parent: 1, born: "root" }],
    [20, { parent: 10, born: "child" }],
  ]);
  const owned = ownedDescendants(new Map([[10, "root"]]), initial);
  assert.deepEqual(
    [...owned],
    [
      [10, "root"],
      [20, "child"],
    ],
  );
  const orphan = new Map([
    [20, { parent: 1, born: "child" }],
    [30, { parent: 20, born: "grandchild" }],
  ]);
  assert.deepEqual(
    [...ownedDescendants(owned, orphan)],
    [
      [20, "child"],
      [30, "grandchild"],
    ],
  );
  orphan.set(20, { parent: 1, born: "replacement" });
  assert.deepEqual([...ownedDescendants(owned, orphan)], []);
});

test("suite deadlines stop a process instead of hanging the runner", async () => {
  const result = await executeSuite(
    command("timeout", "setInterval(() => {}, 1000)"),
    { timeout: 0.1, output: silent() },
  );
  assert.equal(result.status, "timed-out");
});

test("JSON list output is parseable and does not execute tests from a different cwd", () => {
  const result = spawnSync(
    process.execPath,
    [join(root, "tools/test.mjs"), "--unit", "--list", "--json"],
    { cwd: tmpdir(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, "planned");
  assert.ok(plan.suites.every((suite) => suite.kind === "unit"));
  assert.equal(result.stderr, "");
});

test("JSON help stays machine-readable", () => {
  const result = spawnSync(
    process.execPath,
    [join(root, "tools/test.mjs"), "--json", "--help"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, "help");
});

function npmFixture(t) {
  const f = repository(t);
  f.put("client/package-lock.json", "{}");
  const ready = () => {
    for (const file of [
      ".package-lock.json",
      "vitest/vitest.mjs",
      "vue-tsc/bin/vue-tsc.js",
      "vite/bin/vite.js",
      "@playwright/test/cli.js",
      "playwright/package.json",
      "typescript/package.json",
    ])
      f.put(`client/node_modules/${file}`);
  };
  const lock = dependencyLockPath(f.directory, "client");
  t.after(() => rmSync(lock, { recursive: true, force: true }));
  return { ...f, ready, output: silent() };
}

const passed = { status: "passed", exitCode: 0, durationMs: 1 };

test("only npm-dependent suites request workspace setup", () => {
  const suites = createPlan({ extended: true }).suites;
  assert.deepEqual(
    suites.filter((s) => s.npm === ".").map((s) => s.id),
    ["root-lint", "root-format", "design-unit"],
  );
  assert.deepEqual(
    suites.filter((s) => s.npm === "requirements").map((s) => s.id),
    [
      "requirements-unit",
      "requirements-integration",
      "requirements-catalog",
      "requirements-build",
      "requirements-browser",
    ],
  );
  for (const id of [
    "client-scripts-unit",
    "client-vue",
    "client-types",
    "client-browser",
    "client-visual-fixture",
    "client-native",
    "client-scripts-integration",
    "workshop-vue",
    "workshop-types",
    "workshop-chromium",
    "workshop-webkit",
    "design-validation-browser",
    "design-website-browser",
  ])
    assert.equal(suites.find((s) => s.id === id).npm, "client");
  assert.deepEqual(
    createPlan({ unit: true })
      .suites.filter((s) => s.npm)
      .map((s) => s.id),
    [
      "client-scripts-unit",
      "client-vue",
      "workshop-vue",
      "requirements-unit",
      "requirements-catalog",
      "design-unit",
    ],
  );
});

test("fresh npm workspace installs once before tests; prepared runs reuse it", async (t) => {
  const f = npmFixture(t);
  const events = [];
  const suite = { ...command("vue", ""), npm: "client" };
  const options = {
    directory: f.directory,
    output: f.output,
    prepare: (workspace, options) =>
      prepareDependencies(workspace, {
        ...options,
        install: async (installation) => {
          events.push("install");
          assert.equal(installation.cwd, "client");
          assert.equal(
            installation.command,
            process.platform === "win32" ? "cmd.exe" : "npm",
          );
          assert.deepEqual(
            installation.args,
            process.platform === "win32"
              ? ["/d", "/s", "/c", "npm ci --include=dev --no-audit --no-fund"]
              : ["ci", "--include=dev", "--no-audit", "--no-fund"],
          );
          f.ready();
          return passed;
        },
      }),
    execute: async () => {
      events.push("test");
      assert.ok(
        existsSync(join(f.directory, "client/node_modules/vitest/vitest.mjs")),
      );
      assert.ok(existsSync(dependencyLockPath(f.directory, "client")));
      return passed;
    },
  };
  assert.equal(
    (await runPlan({ suites: [suite, suite] }, options)).status,
    "passed",
  );
  assert.equal((await runPlan({ suites: [suite] }, options)).status, "passed");
  assert.deepEqual(events, ["install", "test", "test", "test"]);
  assert.equal(existsSync(dependencyLockPath(f.directory, "client")), false);
});

test("root suites install missing tools once and repair partial installations", async (t) => {
  const f = repository(t);
  f.put("package-lock.json", "{}");
  const suites = createPlan({ feedback: true }).suites.filter(
    (s) => s.npm === ".",
  );
  assert.equal(suites.length, 3);
  let installs = 0;
  let checks = 0;
  const options = {
    directory: f.directory,
    output: silent(),
    prepare: (workspace, options) =>
      prepareDependencies(workspace, {
        ...options,
        install: async (installation) => {
          assert.equal(installation.cwd, ".");
          installs++;
          for (const file of [
            ".package-lock.json",
            "eslint/bin/eslint.js",
            "prettier/bin/prettier.cjs",
            "marked/package.json",
          ])
            f.put(`node_modules/${file}`);
          return passed;
        },
      }),
    execute: async () => {
      checks++;
      assert.ok(existsSync(dependencyLockPath(f.directory, ".")));
      return passed;
    },
  };
  for (let run = 0; run < 2; run++) {
    assert.equal(
      (await runPlan({ profile: "feedback", suites }, options)).status,
      "passed",
    );
    assert.equal(installs, 1);
  }
  for (const entry of [
    "eslint/bin/eslint.js",
    "prettier/bin/prettier.cjs",
    "marked/package.json",
  ]) {
    rmSync(join(f.directory, "node_modules", entry));
    assert.equal(
      (await runPlan({ profile: "feedback", suites }, options)).status,
      "passed",
    );
  }
  assert.equal(installs, 4);
  assert.equal(checks, 15);
  assert.equal(existsSync(dependencyLockPath(f.directory, ".")), false);
});

test("partial npm installations are repaired, not mistaken for prepared checkouts", async (t) => {
  const f = npmFixture(t);
  f.ready();
  rmSync(join(f.directory, "client/node_modules/vitest/vitest.mjs"));
  let installs = 0;
  const prepared = await prepareDependencies("client", {
    ...f,
    install: async () => {
      installs++;
      f.ready();
      return passed;
    },
  });
  prepared.release();
  assert.equal(installs, 1);
});

test("installation failures retain status and diagnostics without retrying or hiding unrelated test failures", async (t) => {
  const f = npmFixture(t);
  let installs = 0;
  const report = await runPlan(
    {
      suites: [
        { ...command("vue", ""), npm: "client" },
        { ...command("types", ""), npm: "client" },
        command("other", ""),
      ],
    },
    {
      ...f,
      prepare: (workspace, options) =>
        prepareDependencies(workspace, {
          ...options,
          install: async () => {
            installs++;
            return {
              status: "failed",
              exitCode: 42,
              durationMs: 5,
              error: "registry unavailable",
            };
          },
        }),
      execute: async (suite) => {
        assert.equal(suite.id, "other");
        return { status: "failed", exitCode: 7, durationMs: 1 };
      },
    },
  );
  assert.equal(installs, 1);
  assert.equal(report.status, "failed");
  assert.deepEqual(
    report.results.map((r) => r.exitCode),
    [42, 42, 7],
  );
  assert.match(
    report.results[0].error,
    /npm ci --include=dev in client.*registry unavailable/,
  );
  assert.equal(existsSync(dependencyLockPath(f.directory, "client")), false);
});

test("missing lockfiles and incomplete successful installs fail with recovery instructions", async (t) => {
  const f = npmFixture(t);
  await assert.rejects(
    prepareDependencies("client", { ...f, install: async () => passed }),
    /node_modules is incomplete/,
  );
  rmSync(join(f.directory, "client/package-lock.json"));
  await assert.rejects(
    prepareDependencies("client", {
      ...f,
      install: async () => assert.fail("must not install without a lockfile"),
    }),
    /restore the lockfile/,
  );
  assert.equal(existsSync(dependencyLockPath(f.directory, "client")), false);
});

test("concurrent setup waits for the dependent suite and rechecks before installing", async (t) => {
  const f = npmFixture(t);
  let installs = 0;
  const options = {
    ...f,
    install: async () => {
      installs++;
      f.ready();
      return passed;
    },
  };
  const first = await prepareDependencies("client", options);
  assert.ok(existsSync(dependencyLockPath(f.directory, "client")));
  await assert.rejects(
    prepareDependencies("client", { ...options, timeout: 0.01 }),
    /Timed out waiting for dependency lock.*PID/,
  );
  assert.ok(existsSync(dependencyLockPath(f.directory, "client")));
  const second = prepareDependencies("client", options);
  first.release();
  const next = await second;
  next.release();
  assert.equal(installs, 1);
});

test("worktrees have independent locks and suite exceptions release ownership", async (t) => {
  const first = npmFixture(t);
  const second = npmFixture(t);
  first.ready();
  second.ready();
  assert.notEqual(
    dependencyLockPath(first.directory, "client"),
    dependencyLockPath(second.directory, "client"),
  );
  const held = await prepareDependencies("client", first);
  try {
    const report = await runPlan(
      { suites: [{ ...command("vue", ""), npm: "client" }] },
      {
        ...second,
        execute: async () => {
          throw new Error("suite could not start");
        },
      },
    );
    assert.equal(report.status, "failed");
    assert.equal(report.results[0].error, "suite could not start");
    assert.equal(
      existsSync(dependencyLockPath(second.directory, "client")),
      false,
    );
    assert.ok(existsSync(dependencyLockPath(first.directory, "client")));
  } finally {
    held.release();
  }
});

test("dependency lock waits are cancellable and time out without reclaiming another owner", async (t) => {
  const f = npmFixture(t);
  const lock = dependencyLockPath(f.directory, "client");
  mkdirSync(lock);
  await assert.rejects(
    prepareDependencies("client", { ...f, timeout: 0.01 }),
    /Timed out waiting for dependency lock.*confirming no runner/,
  );
  const controller = new AbortController();
  const pending = prepareDependencies("client", {
    ...f,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(existsSync(lock));
});

test("unverifiable dependency locks fail promptly without reclaiming them", async (t) => {
  const f = npmFixture(t);
  const lock = dependencyLockPath(f.directory, "client");
  mkdirSync(lock);
  await assert.rejects(
    prepareDependencies("client", { ...f, timeout: 2 }),
    /Cannot verify dependency lock owner/,
  );
  assert.ok(existsSync(lock));
});

test("dependency lock metadata identifies the owner and detects a reused PID", async (t) => {
  const f = npmFixture(t);
  f.ready();
  const lock = dependencyLockPath(f.directory, "client");
  const lease = await prepareDependencies("client", f);
  const ownerFile = join(lock, "owner.json");
  const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal(typeof owner.born, "string");
  writeFileSync(
    ownerFile,
    JSON.stringify({ ...owner, born: "different process" }),
  );
  await assert.rejects(
    prepareDependencies("client", { ...f, timeout: 2 }),
    /Dependency lock owner is no longer running/,
  );
  assert.ok(existsSync(lock));
  writeFileSync(ownerFile, JSON.stringify(owner));
  lease.release();
  assert.equal(existsSync(lock), false);
});

test("uncertain process teardown retains dependency exclusion", async (t) => {
  const f = npmFixture(t);
  f.ready();
  for (const profile of ["mvp", "feedback"]) {
    let executions = 0;
    const suite = { ...command("client-vue", ""), npm: "client" };
    const report = await runPlan(
      { profile, suites: [suite, { ...suite, id: "other" }] },
      {
        ...f,
        execute: async () => {
          executions++;
          return {
            status: "timed-out",
            exitCode: null,
            durationMs: 1,
            cleanupIncomplete: true,
          };
        },
      },
    );
    assert.equal(report.status, "failed");
    assert.equal(executions, 1);
    assert.deepEqual(
      report.results.map((result) => result.status),
      ["timed-out", "timed-out"],
    );
    const lock = dependencyLockPath(f.directory, "client");
    assert.ok(existsSync(lock));
    rmSync(lock, { recursive: true });
  }
});

test("installation cancellation and timeout cannot become successful test results", async (t) => {
  const f = npmFixture(t);
  for (const status of ["cancelled", "timed-out"]) {
    const controller = new AbortController();
    const report = await runPlan(
      {
        suites: [
          { ...command("vue", ""), npm: "client" },
          command("later", ""),
        ],
      },
      {
        ...f,
        signal: controller.signal,
        prepare: (workspace, options) =>
          prepareDependencies(workspace, {
            ...options,
            install: async () => {
              if (status === "cancelled") controller.abort();
              return { status, exitCode: null, durationMs: 1 };
            },
          }),
        execute: async (suite) => {
          assert.equal(suite.id, "later");
          return passed;
        },
      },
    );
    assert.equal(report.results[0].status, status);
    assert.equal(
      report.results[1].status,
      status === "cancelled" ? "not-run" : "passed",
    );
    assert.equal(existsSync(dependencyLockPath(f.directory, "client")), false);
  }
});

test("JSON usage errors have a nonzero exit code and a structured error", () => {
  const result = spawnSync(
    process.execPath,
    [join(root, "tools/test.mjs"), "--json", "--bad-option"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, "error");
});
