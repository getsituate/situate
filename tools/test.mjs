#!/usr/bin/env node
import { spawn, spawnSync, execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { availableParallelism, tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { cachedQualitySuite } from "./quality-cache.mjs";
import { cargoEnvironment } from "./cargo-environment.mjs";
import { compilerCacheEnvironment } from "./compiler-cache.mjs";
import { supportedSuiteEnabled, suiteAvailable } from "./test-scope.mjs";
import {
  QUICK_BUDGET_MS,
  QUICK_EXECUTION_MS,
  isFeedbackSuite,
  workerBudget,
  needsBuildLease,
} from "./test-budget.mjs";
export { isFeedbackSuite } from "./test-budget.mjs";
import { suiteAffectedFiles, suiteSelectionReasons } from "./test-inputs.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const projects = [
  "runner",
  "client",
  "requirements",
  "design",
  "pi",
  "dev-tui",
];

function git(directory, args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const pathsFromGit = (output) => output.split("\0").filter(Boolean);

export function changedFiles(directory, base) {
  const parts = [
    git(directory, ["diff", "--name-only", "--no-renames", "-z", "--"]),
    git(directory, [
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "-z",
      "--",
    ]),
    git(directory, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  if (base) {
    const revision = git(directory, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${base}^{commit}`,
    ]).trim();
    const ancestor = git(directory, ["merge-base", "HEAD", revision]).trim();
    parts.push(
      git(directory, [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        ancestor,
        "HEAD",
        "--",
      ]),
    );
  }
  return [...new Set(parts.flatMap(pathsFromGit))].sort();
}

export function affectedProjects(files) {
  const affected = new Set();
  for (const file of files) {
    if (file.startsWith("tools/dev-tui/")) {
      affected.add("dev-tui");
      continue;
    }
    if (file.startsWith("tools/")) return [...projects];
    if (file.startsWith("client/")) {
      affected.add("client");
      // Design browser tests use the client's pinned Playwright installation.
      if (
        [
          "client/package.json",
          "client/package-lock.json",
          "client/.node-version",
        ].includes(file)
      )
        affected.add("design");
    } else if (file.startsWith("requirements/")) {
      affected.add("requirements");
      if (file.startsWith("requirements/data/")) affected.add("design");
    } else if (file.startsWith("infrastructure/releases/")) {
      affected.add("client");
      affected.add("design");
    } else if (file.startsWith(".pi/")) affected.add("pi");
    else if (
      file.startsWith("website/") ||
      file.startsWith("infrastructure/website/") ||
      file.startsWith("infrastructure/production/")
    )
      affected.add("design");
    else if (file.startsWith("design/")) {
      affected.add("design");
      if (file.startsWith("design/brand/")) affected.add("client");
      if (file === "design/brand/tokens.json") affected.add("dev-tui");
    } else if (file.startsWith("docs/") || file === "README.md") {
      // Brand validation also checks links to documentation outside design/.
      affected.add("design");
    } else return [...projects];
  }
  return projects.filter((project) => affected.has(project));
}

export function sourceFiles(directory) {
  return [
    ...new Set(
      pathsFromGit(
        git(directory, [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ]),
      ),
    ),
  ]
    .filter((file) => existsSync(join(directory, file)))
    .sort();
}

export function suiteInventory(files, host = process.platform) {
  const suites = [];
  const add = (
    id,
    project,
    kind,
    cwd,
    command,
    args,
    covers = [],
    environment,
  ) => {
    suites.push({
      id,
      project,
      kind,
      cwd,
      command,
      args,
      covers,
      ...(environment ? { environment } : {}),
    });
  };
  const node = (id, project, kind, args, covers = [], environment) =>
    add(id, project, kind, ".", process.execPath, args, covers, environment);
  const nodeTests = (id, project, kind, testFiles, environment) => {
    if (!testFiles.length)
      throw new Error(`No test files registered for ${id}.`);
    node(
      id,
      project,
      kind,
      ["--test", "--test-concurrency=1", ...testFiles],
      testFiles,
      environment,
    );
  };
  const matching = (pattern) => files.filter((file) => pattern.test(file));
  const executorBoundary = "client/app/src/plugins/executor-boundary.test.ts";
  const platformOnly = (file) =>
    /^tools\/bootstrap-mobile\.test\.mjs$/.test(file) ||
    /^client\/scripts\/(?:ios-xcode(?:\.integration)?|test-native-ios|native-ios-ipc-trace|generate-mobile-permissions)\.test\.mjs$/.test(
      file,
    );
  for (const [id, project, pattern] of [
    ["runner-platform", "runner", /^tools\/.*\.test\.mjs$/],
    [
      "client-scripts-platform",
      "client",
      /^client\/scripts\/[^/]+(?<!\.integration)\.test\.mjs$/,
    ],
    [
      "client-scripts-platform-integration",
      "client",
      /^client\/scripts\/[^/]+\.integration\.test\.mjs$/,
    ],
  ]) {
    const tests = matching(pattern).filter(platformOnly);
    if (tests.length)
      nodeTests(
        id,
        project,
        id.endsWith("integration") ? "integration" : "unit",
        tests,
      );
  }

  const migrationTests = matching(
    /^tools\/(?:migration-history|published-migrations)\.test\.mjs$/,
  );
  if (migrationTests.length)
    nodeTests("delivery-migrations", "runner", "unit", migrationTests);
  const deliveryTests = matching(
    /^(?:tools\/(?:change-fragments|release-inputs|release-reservation|release-qualification|github-release|pipeline(?:-plan|-state|-operations)?)|infrastructure\/releases\/(?:allocator|recovery))\.test\.mjs$/,
  );
  if (deliveryTests.length)
    nodeTests("delivery-unit", "runner", "unit", deliveryTests);
  nodeTests(
    "runner-unit",
    "runner",
    "unit",
    matching(/^tools\/.*(?<!\.integration)\.test\.mjs$/).filter(
      (file) =>
        !platformOnly(file) &&
        !deliveryTests.includes(file) &&
        !migrationTests.includes(file),
    ),
  );
  if (host === "darwin" || host === "linux") {
    add("dev-tui-unit", "dev-tui", "unit", "tools/dev-tui", "cargo", [
      "test",
      "--locked",
      "--",
      "--skip",
      "dragging_logs_exposes_copy_without_disabling_mouse_controls",
    ]);
    add("dev-tui-macos", "dev-tui", "integration", "tools/dev-tui", "cargo", [
      "test",
      "--locked",
      "--test",
      "terminal",
      "dragging_logs_exposes_copy_without_disabling_mouse_controls",
      "--",
      "--exact",
    ]);
    add("dev-tui-format", "dev-tui", "check", "tools/dev-tui", "cargo", [
      "fmt",
      "--all",
      "--",
      "--check",
    ]);
    add("dev-tui-clippy", "dev-tui", "check", "tools/dev-tui", "cargo", [
      "clippy",
      "--all-targets",
      "--locked",
      "--",
      "-D",
      "warnings",
    ]);
  }
  const npm = (script) =>
    host === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", `npm run ${script}`]]
      : ["npm", ["run", script]];
  add("root-lint", "runner", "check", ".", ...npm("lint"));
  add("root-format", "runner", "check", ".", ...npm("format:check"));
  node("root-commits", "runner", "check", ["tools/commit-check.mjs"]);
  add("root-history-secrets", "runner", "check", ".", "gitleaks", [
    "git",
    ".",
    "--redact",
    "--no-banner",
    "--config",
    ".gitleaks.toml",
  ]);
  for (const name of ["kotlin", "rust", "secrets", "audit", "swift"]) {
    add(`root-${name}`, "runner", "check", ".", ...npm(`quality:${name}`));
  }
  nodeTests(
    "runner-integration",
    "runner",
    "integration",
    matching(/^tools\/.*\.integration\.test\.mjs$/),
  );
  nodeTests(
    "client-scripts-unit",
    "client",
    "unit",
    matching(/^client\/scripts\/[^/]+(?<!\.integration)\.test\.mjs$/).filter(
      (file) => !platformOnly(file),
    ),
  );
  nodeTests(
    "client-scripts-integration",
    "client",
    "integration",
    matching(/^client\/scripts\/[^/]+\.integration\.test\.mjs$/).filter(
      (file) => !platformOnly(file),
    ),
  );
  add(
    "client-vue",
    "client",
    "unit",
    "client/app",
    process.execPath,
    ["../node_modules/vitest/vitest.mjs", "run", "--allowOnly=false"],
    matching(/^client\/app\/src\/.*(?<!\.integration)\.test\.ts$/).filter(
      (file) => file !== executorBoundary,
    ),
  );
  add(
    "client-executor-integration",
    "client",
    "integration",
    "client/app",
    process.execPath,
    [
      "../node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "--allowOnly=false",
    ],
    [executorBoundary],
  );
  add(
    "workshop-vue",
    "client",
    "unit",
    "client/workshop",
    process.execPath,
    ["../node_modules/vitest/vitest.mjs", "run", "--allowOnly=false"],
    matching(/^client\/workshop\/src\/.*(?<!\.integration)\.test\.ts$/),
  );
  add(
    "workshop-types",
    "client",
    "check",
    "client/workshop",
    process.execPath,
    ["../node_modules/vue-tsc/bin/vue-tsc.js", "--noEmit"],
  );
  add("client-agent-runtime", "client", "unit", "client", "cargo", [
    "test",
    "-p",
    "situate-agent",
    "--locked",
  ]);
  add("client-migrations", "client", "unit", "client", "cargo", [
    "test",
    "-p",
    "situate-migrations",
    "--locked",
  ]);
  add("client-core", "client", "unit", "client", "cargo", [
    "test",
    "-p",
    "situate-core",
    "--locked",
  ]);
  add("client-core-macos", "client", "integration", "client", "cargo", [
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
  add("client-host", "client", "integration", "client", "cargo", [
    "test",
    "--workspace",
    "--exclude",
    "situate-core",
    "--exclude",
    "situate-migrations",
    "--exclude",
    "situate-agent",
    "--locked",
  ]);
  add("client-workshop-host", "client", "integration", "client", "cargo", [
    "test",
    "--manifest-path",
    "workshop/src-tauri/Cargo.toml",
    "--target-dir",
    "target",
    "--locked",
  ]);
  if (host === "darwin") {
    add("client-dictation-swift", "client", "integration", "client", "swift", [
      "test",
      "--package-path",
      "app/src-tauri/dictation",
      "--disable-automatic-resolution",
    ]);
    node("client-workspace-access-swift", "client", "integration", [
      "client/scripts/test-workspace-access-swift.mjs",
    ]);
  }
  add("client-types", "client", "check", "client/app", process.execPath, [
    "../node_modules/vue-tsc/bin/vue-tsc.js",
    "--noEmit",
  ]);
  add("client-format", "client", "check", "client", "cargo", [
    "fmt",
    "--all",
    "--",
    "--check",
  ]);
  add("client-clippy", "client", "check", "client", "cargo", [
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
  add("client-host-clippy", "client", "check", "client", "cargo", [
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
  add("client-workshop-clippy", "client", "check", "client", "cargo", [
    "clippy",
    "--manifest-path",
    "workshop/src-tauri/Cargo.toml",
    "--target-dir",
    "target",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ]);
  for (const engine of ["chromium", "webkit"])
    add(
      `client-browser-${engine}`,
      "client",
      "browser",
      "client",
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--forbid-only",
        "--config",
        "app/playwright.config.ts",
        "--project",
        engine,
        "--output",
        `test-results/browser/${engine}`,
      ],
      matching(/^client\/app\/tests\/browser\/.*\.(test|spec)\.[cm]?[jt]s$/),
    );
  add(
    "client-visual",
    "client",
    "browser",
    ".",
    process.execPath,
    ["tools/visual-tests.mjs"],
    matching(/^client\/app\/tests\/browser\/.*\.(test|spec)\.[cm]?[jt]s$/),
  );
  // Coverage can target revisions predating this suite. Validate its file when
  // executing the browser command rather than during unrelated plan creation.
  node(
    "client-visual-fixture",
    "client",
    "browser",
    [
      "--test",
      "--test-concurrency=1",
      "client/app/tests/visual-contract/fixture.test.mjs",
    ],
    matching(/^client\/app\/tests\/visual-contract\/fixture\.test\.mjs$/),
  );
  for (const project of ["workshop-chromium", "workshop-webkit"])
    add(
      project,
      "client",
      "browser",
      "client/workshop",
      process.execPath,
      [
        "../node_modules/@playwright/test/cli.js",
        "test",
        "--forbid-only",
        "--project",
        project,
        "--output",
        `../test-results/${project}`,
      ],
      matching(
        /^client\/workshop\/tests\/browser\/.*\.(test|spec)\.[cm]?[jt]s$/,
      ),
    );
  add("workshop-format", "client", "check", "client", "cargo", [
    "fmt",
    "--manifest-path",
    "workshop/src-tauri/Cargo.toml",
    "--",
    "--check",
  ]);
  add(
    "client-native",
    "client",
    "native",
    "client",
    host === "linux" ? "dbus-run-session" : process.execPath,
    host === "linux"
      ? ["--", "xvfb-run", "-a", process.execPath, "scripts/test-native.mjs"]
      : ["scripts/test-native.mjs"],
  );
  if (host === "darwin") {
    add("client-agent-e2e", "client", "native", "client", process.execPath, [
      "scripts/test-agent-e2e.mjs",
    ]);
    add(
      "client-onboarding-e2e",
      "client",
      "native",
      "client",
      process.execPath,
      ["scripts/test-agent-e2e.mjs", "--journey", "onboarding"],
    );
    add("client-plugins-e2e", "client", "native", "client", process.execPath, [
      "scripts/test-agent-e2e.mjs",
      "--journey",
      "plugins",
      "--provider",
      "fixture",
      "--max-requests",
      "7",
    ]);
  }
  node("client-docker-context", "client", "integration", [
    "client/scripts/test-docker-context.mjs",
  ]);

  nodeTests(
    "requirements-unit",
    "requirements",
    "unit",
    matching(/^requirements\/tests\/.*(?<!\.integration)\.test\.js$/),
  );
  nodeTests(
    "requirements-integration",
    "requirements",
    "integration",
    matching(/^requirements\/tests\/.*\.integration\.test\.js$/),
  );
  add(
    "requirements-catalog",
    "requirements",
    "unit",
    "requirements",
    process.execPath,
    ["scripts/validate.js"],
  );
  add(
    "requirements-build",
    "requirements",
    "check",
    "requirements",
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build"],
  );
  add(
    "requirements-browser",
    "requirements",
    "browser",
    "requirements",
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", "--forbid-only"],
    matching(/^requirements\/tests\/.*\.spec\.js$/),
  );

  nodeTests("design-unit", "design", "unit", [
    "design/brand/bend/bend.test.cjs",
    "design/brand/bend/performance.test.cjs",
    "design/brand/bend/mini/mini.test.cjs",
    "design/brand/examples/first-hello/timeline.test.cjs",
    "design/brand/reference/reference.test.cjs",
    "design/marketing-onboarding/export.test.mjs",
    "design/product-capability-catalog/reading-edition.test.mjs",
    "website/site.test.mjs",
    "website/download.test.mjs",
    "infrastructure/website/deploy.test.mjs",
    "infrastructure/website/proxy.test.mjs",
    "infrastructure/production/inspect.test.mjs",
    "infrastructure/production/terraform.test.mjs",
    "infrastructure/production/deploy.test.mjs",
    "infrastructure/production/proxy.test.mjs",
    "infrastructure/releases/publish.test.mjs",
  ]);
  nodeTests("design-website-hosting", "design", "integration", [
    "infrastructure/website/hosting.integration.test.mjs",
    "infrastructure/production/hosting.integration.test.mjs",
  ]);
  node("design-contracts", "design", "unit", [
    "design/brand/validation/check.cjs",
  ]);
  for (const [id, file, args = []] of [
    ["website", "website/browser.test.mjs"],
    ["validation", "design/brand/validation/browser.cjs"],
    ["reference", "design/brand/reference/reference.test.cjs", ["--browser"]],
    ["mini-reference", "design/brand/reference/mini-example.test.cjs"],
    ["bend", "design/brand/bend/browser.test.cjs"],
    ["performance", "design/brand/bend/performance.browser.test.cjs"],
    ["mini", "design/brand/bend/mini/browser.test.cjs"],
    ["first-hello", "design/brand/examples/first-hello/browser.test.cjs"],
    ["listening-room", "design/brand/examples/listening-room/browser.test.cjs"],
  ])
    node(
      `design-${id}-browser`,
      "design",
      "browser",
      [file, ...args],
      id === "website"
        ? [
            file,
            "website/legal/browser.test.mjs",
            "website/product.browser.test.mjs",
            "website/waitlist.browser.test.mjs",
            "website/download.browser.test.mjs",
          ]
        : [file],
      "design",
    );

  nodeTests(
    "pi-unit",
    "pi",
    "unit",
    [
      ".pi/extensions/role-switcher/index.test.mjs",
      ".pi/extensions/test-suite/index.test.mjs",
    ],
    "pi",
  );
  nodeTests(
    "pi-mcp",
    "pi",
    "integration",
    [".pi/extensions/role-switcher/mcp.test.mjs"],
    "pi",
  );
  nodeTests(
    "pi-test-hook",
    "pi",
    "integration",
    [".pi/extensions/test-suite/integration.test.mjs"],
    "pi",
  );

  for (const suite of suites) {
    if (
      [
        "root-lint",
        "root-format",
        "design-unit",
        "runner-unit",
        "runner-integration",
      ].includes(suite.id)
    )
      suite.npm = ".";
    if (
      [
        "client-scripts-unit",
        "client-scripts-integration",
        "client-scripts-platform",
        "client-scripts-platform-integration",
        "client-vue",
        "client-executor-integration",
        "client-types",
        "client-browser-chromium",
        "client-browser-webkit",
        "client-visual",
        "client-visual-fixture",
        "client-native",
        "client-agent-e2e",
        "client-onboarding-e2e",
        "client-plugins-e2e",
        "workshop-vue",
        "workshop-types",
        "workshop-chromium",
        "workshop-webkit",
      ].includes(suite.id) ||
      suite.environment === "design"
    )
      suite.npm = "client";
    if (suite.project === "requirements") suite.npm = "requirements";
    if (suite.id.startsWith("client-browser-"))
      suite.browsers = [suite.id.slice("client-browser-".length)];
    if (
      [
        "client-executor-integration",
        "client-visual",
        "requirements-browser",
      ].includes(suite.id)
    )
      suite.browsers = ["chromium"];
  }

  const covered = new Set(suites.flatMap((suite) => suite.covers));
  const unknown = files.filter(
    (file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !covered.has(file),
  );
  if (unknown.length)
    throw new Error(
      `Unclassified tests. Register them in tools/test.mjs:\n${unknown.join("\n")}`,
    );
  return suites;
}

export function isQuickSuite(suite) {
  return ["quick-source", "runner-fast"].includes(suite.id);
}

export function createPlan(
  {
    unit = false,
    quick = false,
    feedback = false,
    checks = false,
    coverage = false,
    extended = false,
    suite: requestedSuites = [],
    platform = process.platform,
    changed = false,
    base,
  } = {},
  directory = root,
) {
  if ([unit, quick, feedback, checks, coverage].filter(Boolean).length > 1)
    throw new Error(
      "Choose only one of --unit, --quick, --feedback, --checks or --coverage.",
    );
  if (base && !changed) throw new Error("--base requires --changed.");
  const explicit =
    typeof requestedSuites === "string" ? [requestedSuites] : requestedSuites;
  if (
    explicit.length &&
    (unit || quick || feedback || checks || coverage || changed)
  )
    throw new Error("--suite cannot be combined with profiles or --changed.");
  const inventory = suiteInventory(sourceFiles(directory), "darwin");
  for (const id of explicit) {
    const suite = inventory.find((entry) => entry.id === id);
    if (!suite) throw new Error(`Unknown suite: ${id}`);
    if (!suiteAvailable(suite, platform))
      throw new Error(`Suite ${id} requires a macOS host.`);
  }
  const files = changed ? changedFiles(directory, base) : [];
  const selected = changed ? affectedProjects(files) : [...projects];
  let suites = inventory.filter(
    (suite) =>
      (!unit || suite.kind === "unit") &&
      (!feedback || isFeedbackSuite(suite)) &&
      (!checks || suite.kind === "check"),
  );
  if (quick) {
    suites = [
      {
        id: "runner-fast",
        project: "runner",
        kind: "unit",
        cwd: ".",
        command: process.execPath,
        args: ["--test", "--test-concurrency=1", "tools/test-inputs.test.mjs"],
      },
      {
        id: "quick-source",
        project: "runner",
        kind: "check",
        cwd: ".",
        command: process.execPath,
        args: ["tools/quick-source.mjs", ...(changed ? files : ["--scan"])],
      },
    ];
  }
  if (changed) {
    suites = suites.filter(
      (suite) => suiteAffectedFiles(suite, files).length > 0,
    );
    suites = suites.flatMap((suite) => {
      const reasons = suiteSelectionReasons(suite, files);
      if (suite.id !== "root-format") return [{ ...suite, reasons }];
      const broad = files.some((file) =>
        /(^|\/)(package(?:-lock)?\.json|\.prettier[^/]*|prettier\.config\.[^/]+|\.editorconfig|\.gitignore)$/.test(
          file,
        ),
      );
      if (broad) return [{ ...suite, reasons }];
      const existing = files.filter((file) =>
        existsSync(join(directory, file)),
      );
      if (!existing.length) return [];
      return [
        {
          ...suite,
          reasons,
          command: process.execPath,
          args: [
            "node_modules/prettier/bin/prettier.cjs",
            "--check",
            "--ignore-unknown",
            "--",
            ...existing.map((file) => `./${file}`),
          ],
        },
      ];
    });
  }
  if (coverage)
    suites = [
      {
        id: "client-vue-coverage",
        npm: "client",
        project: "client",
        kind: "coverage",
        cwd: "client/app",
        command: process.execPath,
        args: [
          "../node_modules/vitest/vitest.mjs",
          "run",
          "--allowOnly=false",
          "--coverage",
        ],
      },
      {
        id: "client-rust-coverage",
        project: "client",
        kind: "coverage",
        cwd: "client",
        command: "cargo",
        args: [
          "llvm-cov",
          "--workspace",
          "--locked",
          "--lcov",
          "--output-path",
          "target/coverage/rust.lcov",
        ],
      },
    ];
  if (coverage && changed)
    suites = suites
      .filter((suite) => suiteAffectedFiles(suite, files).length > 0)
      .map((suite) => ({
        ...suite,
        reasons: suiteSelectionReasons(suite, files),
      }));
  const enabled = (suite) =>
    suiteAvailable(suite, platform) &&
    (explicit.length
      ? explicit.includes(suite.id)
      : extended || coverage || supportedSuiteEnabled(suite));
  const deferredSuiteIds = suites
    .filter((suite) => !enabled(suite))
    .map((suite) => suite.id);
  suites = suites.filter(enabled);
  return {
    scope: extended ? "extended" : "supported",
    deferredSuiteIds,
    profile: unit
      ? "unit"
      : quick
        ? "quick"
        : feedback
          ? "feedback"
          : checks
            ? "checks"
            : coverage
              ? "coverage"
              : extended
                ? "all"
                : "supported",
    changed,
    base: base ?? null,
    changedFiles: files,
    projects: selected,
    suites: suites.map((suite) => {
      const entry = { ...suite };
      delete entry.covers;
      return entry;
    }),
  };
}

export function suiteEnvironment(suite, directory, environment = process.env) {
  const cargo = cargoEnvironment(directory, environment);
  const cacheRust =
    suite.kind !== "coverage" &&
    (suite.command === "cargo" || suite.id === "root-rust");
  const workers = String(workerBudget(availableParallelism()));
  const env = {
    VITEST_MAX_WORKERS: workers,
    CARGO_BUILD_JOBS: workers,
    RUST_TEST_THREADS: workers,
    ...(cacheRust ? compilerCacheEnvironment(cargo) : cargo),
    CI: "true",
  };
  // Node suppresses nested --test invocations when its worker marker is inherited.
  delete env.NODE_TEST_CONTEXT;
  if (suite.environment === "design") {
    const playwright = join(directory, "client/node_modules/playwright");
    env.PLAYWRIGHT_MODULE = playwright;
    env.BEND_PLAYWRIGHT_MODULE = playwright;
  }
  if (suite.environment === "pi") {
    env.PI_PACKAGE_ROOT ||= join(
      directory,
      "node_modules/@earendil-works/pi-coding-agent",
    );
    if (!existsSync(join(env.PI_PACKAGE_ROOT, "dist/index.js")))
      throw new Error(
        `Pi test dependency not found at ${env.PI_PACKAGE_ROOT}. Run npm ci at the repository root or set PI_PACKAGE_ROOT explicitly.`,
      );
  }
  return env;
}

function processSnapshot() {
  const listing = execFileSync("ps", ["-A", "-o", "pid=,ppid=,stat=,lstart="], {
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const snapshot = new Map();
  for (const line of listing.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
    if (match && !match[3].startsWith("Z"))
      snapshot.set(Number(match[1]), {
        parent: Number(match[2]),
        born: match[4],
      });
  }
  return snapshot;
}

export function ownedDescendants(owned, snapshot) {
  const live = new Set(
    [...owned]
      .filter(([pid, born]) => snapshot.get(pid)?.born === born)
      .map(([pid]) => pid),
  );
  let more = true;
  while (more) {
    more = false;
    for (const [pid, info] of snapshot) {
      if (!live.has(pid) && live.has(info.parent)) {
        live.add(pid);
        more = true;
      }
    }
  }
  return new Map([...live].map((pid) => [pid, snapshot.get(pid).born]));
}

export function executeSuite(
  suite,
  {
    directory = root,
    signal,
    timeout = 600,
    environment = process.env,
    output = process.stderr,
    stdout = output,
    terminationGraceMs = 2000,
    buildLease = true,
    detached = true,
  } = {},
) {
  signal?.throwIfAborted();
  const env = suiteEnvironment(suite, directory, environment);
  let command = suite.command;
  if (
    (command === "cargo" ||
      suite.kind === "native" ||
      suite.id === "root-rust") &&
    process.platform !== "win32"
  ) {
    const cargoPath = execFileSync("rustup", ["which", "cargo"], {
      cwd:
        command === "cargo"
          ? resolve(directory, suite.cwd)
          : join(directory, "client"),
      env,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (command === "cargo") command = cargoPath;
    env.PATH = [dirname(cargoPath), env.PATH].filter(Boolean).join(":");
  }
  return new Promise((done) => {
    const started = performance.now();
    const leased =
      buildLease && needsBuildLease(suite) && process.platform !== "win32";
    const suiteArgs =
      suite.id?.startsWith("client-browser-") &&
      suite.args.some((arg) => arg.includes("@playwright/test/cli.js")) &&
      !suite.args.includes("--workers")
        ? [
            ...suite.args,
            "--workers",
            String(workerBudget(availableParallelism())),
          ]
        : suite.args;
    const child = spawn(
      leased ? process.execPath : command,
      leased
        ? [
            join(root, "tools/run-coordinated.mjs"),
            "--resource",
            "build",
            "--",
            command,
            ...suiteArgs,
          ]
        : suiteArgs,
      {
        cwd: resolve(directory, suite.cwd),
        env,
        detached: detached && process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe", ...(leased ? ["pipe"] : [])],
      },
    );
    let resourceQueueWaitMs = 0;
    let timingBuffer = "";
    if (leased)
      child.stdio[3].on("data", (chunk) => {
        timingBuffer += chunk.toString();
        const lines = timingBuffer.split("\n");
        timingBuffer = lines.pop();
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.resource === "build" && event.phase === "acquired") {
              resourceQueueWaitMs = event.waitMs;
              timer = setTimeout(() => stop("timed-out"), timeout * 1000);
            }
          } catch {
            /* Invalid telemetry is not a test result. */
          }
        }
      });
    child.stdout.pipe(stdout, { end: false });
    child.stderr.pipe(output, { end: false });
    let stopped,
      escalation,
      drainDeadline,
      diagnostic,
      cleanupUncertain = false,
      terminationComplete = false,
      closed = false,
      finished = false;
    let owned = new Map();
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    child.once("spawn", () => {
      if (process.platform === "win32") return;
      try {
        const info = processSnapshot().get(child.pid);
        if (info && !exited) owned.set(child.pid, info.born);
      } catch (error) {
        cleanupUncertain = true;
        diagnostic = `Could not identify the test process: ${error.message}`;
      }
    });
    const send = (pid, name) => {
      try {
        process.kill(pid, name);
      } catch (error) {
        if (error.code !== "ESRCH") {
          cleanupUncertain = true;
          diagnostic = error.message;
        }
      }
    };
    const kill = (name) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        if (exited) return;
        const result = spawnSync(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { stdio: "ignore", timeout: 2000 },
        );
        if (result.error) diagnostic = result.error.message;
        return;
      }
      // Browser/native helpers can detach. Only extend ancestry from identities
      // observed while owned; a PID may have been reused while output pipes linger.
      try {
        owned = ownedDescendants(owned, processSnapshot());
        for (const pid of [...owned.keys()].reverse()) send(pid, name);
      } catch (error) {
        cleanupUncertain = true;
        diagnostic = `Could not inspect descendant processes: ${error.message}`;
      }
      if (!exited) child.kill(name);
    };
    const finish = (code, exitSignal, forced = false) => {
      if (finished || (stopped && !terminationComplete)) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(drainDeadline);
      signal?.removeEventListener("abort", abort);
      if (forced) {
        diagnostic = closed
          ? "Process termination could not be confirmed; check for remaining test processes."
          : "Child output did not close after termination; check for remaining test processes.";
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      }
      done({
        status: stopped ?? (code === 0 && !diagnostic ? "passed" : "failed"),
        exitCode: code,
        signal: exitSignal,
        durationMs: Math.round(performance.now() - started),
        resourceQueueWaitMs,
        executionDurationMs: Math.max(
          0,
          Math.round(performance.now() - started) - resourceQueueWaitMs,
        ),
        ...(diagnostic ? { error: diagnostic } : {}),
        ...(forced || cleanupUncertain ? { cleanupIncomplete: true } : {}),
      });
    };
    const stop = (reason) => {
      if (stopped || finished) return;
      stopped = reason;
      kill("SIGTERM");
      escalation = setTimeout(() => {
        kill("SIGKILL");
        const deadline = performance.now() + 1000;
        const drain = () => {
          if (closed && owned.size === 0 && !cleanupUncertain) {
            terminationComplete = true;
            finish(child.exitCode, child.signalCode);
            return;
          }
          try {
            owned = ownedDescendants(owned, processSnapshot());
          } catch (error) {
            cleanupUncertain = true;
            diagnostic = `Could not confirm process termination: ${error.message}`;
          }
          if ((closed && owned.size === 0) || performance.now() >= deadline) {
            terminationComplete = true;
            finish(
              child.exitCode,
              child.signalCode,
              !closed || owned.size > 0 || cleanupUncertain,
            );
          } else drainDeadline = setTimeout(drain, 25);
        };
        drain();
      }, terminationGraceMs);
    };
    const abort = () => stop("cancelled");
    let timer = leased
      ? undefined
      : setTimeout(() => stop("timed-out"), timeout * 1000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.once("error", (error) => {
      diagnostic = error.message;
    });
    child.once("close", (code, exitSignal) => {
      closed = true;
      // Closed pipes do not prove that descendants have finished terminating.
      if (!stopped) owned.clear();
      finish(code, exitSignal);
    });
  });
}

const npmEntrypoints = {
  ".": [
    "eslint/bin/eslint.js",
    "prettier/bin/prettier.cjs",
    "marked/package.json",
  ],
  client: [
    "vitest/vitest.mjs",
    "vue-tsc/bin/vue-tsc.js",
    "vite/bin/vite.js",
    "@playwright/test/cli.js",
    "playwright/package.json",
    "typescript/package.json",
  ],
  requirements: [
    "vite/bin/vite.js",
    "@playwright/test/cli.js",
    "yaml/package.json",
    "marked/package.json",
    "dompurify/package.json",
  ],
};

export function dependencyLockPath(directory, workspace) {
  const identity = createHash("sha256")
    .update(realpathSync(join(directory, workspace)))
    .digest("hex");
  return join(tmpdir(), `situate-npm-${identity}.lock`);
}

export async function prepareDependencies(
  workspace,
  {
    directory = root,
    signal,
    timeout = 600,
    output = process.stderr,
    install = executeSuite,
    extraEntrypoints = [],
    force = false,
    ...options
  } = {},
) {
  const project = resolve(directory, workspace);
  if (realpathSync(project) !== resolve(realpathSync(directory), workspace))
    throw new Error(
      "Dependency workspaces must not redirect to another checkout.",
    );
  const modules = join(project, "node_modules");
  let moduleInfo;
  try {
    moduleInfo = lstatSync(modules);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (moduleInfo && !moduleInfo.isDirectory())
    throw new Error(
      "node_modules must be a worktree-local directory; remove the link and install local dependencies.",
    );
  const lock = dependencyLockPath(directory, workspace);
  const deadline = performance.now() + timeout * 1000;
  const ownerFile = join(lock, "owner.json");
  const recovery =
    "Remove this directory only after confirming no runner, npm installer or dependent test process is still active.";
  let unidentifiedSince;
  while (true) {
    signal?.throwIfAborted();
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try {
        owner = JSON.parse(readFileSync(ownerFile, "utf8"));
        if (
          !Number.isInteger(owner.pid) ||
          owner.pid <= 0 ||
          typeof owner.born !== "string"
        )
          owner = undefined;
      } catch (error) {
        if (error.code === "ENOENT" && !existsSync(lock)) continue;
      }
      if (owner) {
        unidentifiedSince = undefined;
        if (processSnapshot().get(owner.pid)?.born !== owner.born) {
          // The previous owner may have released the lock while ps was running.
          try {
            const current = JSON.parse(readFileSync(ownerFile, "utf8"));
            if (current.pid !== owner.pid || current.born !== owner.born)
              continue;
          } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
          }
          throw new Error(
            `Dependency lock owner is no longer running (PID ${owner.pid}): ${lock}. ${recovery}`,
            { cause: error },
          );
        }
      } else {
        // Allow the mkdir owner to publish metadata; never reclaim an unknown lease.
        unidentifiedSince ??= performance.now();
        if (performance.now() - unidentifiedSince >= 1000)
          throw new Error(
            `Cannot verify dependency lock owner: ${lock}. ${recovery}`,
            { cause: error },
          );
      }
      if (performance.now() >= deadline)
        throw new Error(
          `Timed out waiting for dependency lock ${lock}${owner ? ` (PID ${owner.pid}, started ${owner.born})` : " (owner unknown)"}. ${recovery}`,
          { cause: error },
        );
      await delay(
        Math.min(100, Math.max(1, deadline - performance.now())),
        undefined,
        { signal },
      );
    }
  }
  let retained = false;
  const retain = () => {
    retained = true;
  };
  const release = () => {
    if (retained) return;
    unlinkSync(ownerFile);
    rmdirSync(lock);
  };
  try {
    const born = processSnapshot().get(process.pid)?.born;
    if (!born) throw new Error("Could not identify dependency lock owner.");
    writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, born }), {
      mode: 0o600,
    });
    const ready = () =>
      [
        ".package-lock.json",
        ...npmEntrypoints[workspace],
        ...extraEntrypoints,
      ].every((file) =>
        existsSync(join(directory, workspace, "node_modules", file)),
      );
    if (force || !ready()) {
      if (!existsSync(join(directory, workspace, "package-lock.json")))
        throw new Error(
          `Missing ${workspace}/package-lock.json; restore the lockfile before running tests.`,
        );
      output.write(
        `${force ? "Installing" : "Installing missing"} npm dependencies in ${workspace} with npm ci --include=dev…\n`,
      );
      const command = process.platform === "win32" ? "cmd.exe" : "npm";
      const args =
        process.platform === "win32"
          ? ["/d", "/s", "/c", "npm ci --include=dev --no-audit --no-fund"]
          : ["ci", "--include=dev", "--no-audit", "--no-fund"];
      const result = await install(
        { cwd: workspace, command, args },
        { ...options, directory, signal, timeout, output },
      );
      if (result.cleanupIncomplete) retain();
      if (result.status !== "passed") {
        return {
          release,
          retain,
          failure: {
            ...result,
            error: `Dependency installation in ${workspace} ${result.status} (exit ${result.exitCode ?? "unknown"}). See npm output above; resolve the error and run npm ci --include=dev in ${workspace} before retrying.${result.error ? ` ${result.error}` : ""}`,
          },
        };
      }
      if (!ready())
        throw new Error(
          `npm ci completed but ${workspace}/node_modules is incomplete. Run npm ci --include=dev in ${workspace} and inspect its output.`,
        );
    }
    // Keep the lock until the dependent suite exits: npm ci removes node_modules.
    return { release, retain };
  } catch (error) {
    if (existsSync(ownerFile)) release();
    else rmdirSync(lock);
    throw error;
  }
}

const parallelSafeSuites = new Set([
  "runner-fast",
  "quick-source",
  "root-lint",
  "root-format",
  "client-vue",
  "workshop-vue",
  "client-core",
  "client-types",
  "workshop-types",
  "client-format",
  "requirements-unit",
  "requirements-catalog",
  "design-unit",
  "design-contracts",
  "pi-unit",
]);

export async function runPlan(plan, configuration = {}) {
  const jobs =
    configuration.jobs ??
    (["quick", "feedback"].includes(plan.profile) ? 2 : 1);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8)
    throw new Error("jobs must be an integer from 1 to 8.");
  if (
    configuration.toolContainers === true &&
    plan.profile !== "quick" &&
    plan.suites.length &&
    (configuration.environment ?? process.env).SITUATE_TOOL_CONTAINER !== "1"
  ) {
    const { selectContainerSuites, runContainerPlan } =
      await import("./test-container.mjs");
    const portable = selectContainerSuites(plan);
    if (
      configuration.externalPiRoot &&
      portable.some((suite) => suite.environment === "pi")
    )
      throw new Error(
        "External Pi installations are unavailable in tool-container checks. Remove --pi-package-root to use repository dependencies.",
      );
    if (portable.length) {
      const { execute, prepare, ...containerOptions } = configuration;
      return runContainerPlan(plan, {
        ...containerOptions,
        execute: executeSuite,
        portable,
        runHost: (hostPlan, hostOptions) =>
          runHostPlan(hostPlan, {
            ...hostOptions,
            ...(execute ? { execute } : {}),
            ...(prepare ? { prepare } : {}),
          }),
      });
    }
  }
  return runHostPlan(plan, configuration);
}

async function runHostPlan(
  plan,
  {
    execute = executeSuite,
    prepare = prepareDependencies,
    signal,
    onStart = () => {},
    onResult = () => {},
    jobs = ["quick", "feedback"].includes(plan.profile) ? 2 : 1,
    parallelism = availableParallelism(),
    ...options
  } = {},
) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8)
    throw new Error("jobs must be an integer from 1 to 8.");

  if (
    plan.profile === "quick" &&
    plan.suites.some((suite) => !isQuickSuite(suite) || suite.npm)
  )
    throw new Error(
      "Quick checks must be dependency-free and explicitly registered; use --feedback for longer suites.",
    );
  const callerSignal = signal;
  const budgetSignal =
    plan.profile === "quick"
      ? AbortSignal.timeout(QUICK_EXECUTION_MS)
      : undefined;
  if (budgetSignal)
    signal = callerSignal
      ? AbortSignal.any([callerSignal, budgetSignal])
      : budgetSignal;
  // Builds and integration suites can share output directories and native state.
  const concurrency = ["quick", "feedback", "unit"].includes(plan.profile)
    ? jobs
    : 1;
  const started = performance.now();
  const results = new Array(plan.suites.length);
  const dependencyFailures = new Map();
  const prepared = new Map();
  const setupStarted = performance.now();
  if (concurrency > 1) {
    // Acquire in a fixed order and retain each lease across all readers. Another
    // runner must not replace node_modules between parallel dependent suites.
    for (const workspace of [
      ...new Set(plan.suites.map((s) => s.npm).filter(Boolean)),
    ].sort()) {
      if (signal?.aborted) break;
      try {
        const dependencies = await prepare(workspace, { ...options, signal });
        prepared.set(workspace, dependencies);
        if (dependencies.failure)
          dependencyFailures.set(workspace, dependencies.failure);
      } catch (error) {
        dependencyFailures.set(workspace, {
          status: signal?.aborted ? "cancelled" : "failed",
          exitCode: null,
          durationMs: 0,
          error: error.message,
        });
      }
    }
  }
  const setupDurationMs = Math.round(performance.now() - setupStarted);
  const run = async (index) => {
    const suite = plan.suites[index];
    let result;
    if (signal?.aborted)
      result = { status: "not-run", exitCode: null, durationMs: 0 };
    else {
      onStart(suite);
      let dependencies;
      const preparationStarted = performance.now();
      let preparationDurationMs = 0;
      try {
        if (
          suite.npm &&
          !prepared.has(suite.npm) &&
          !dependencyFailures.has(suite.npm)
        ) {
          try {
            dependencies = await prepare(suite.npm, { ...options, signal });
            if (dependencies.failure)
              dependencyFailures.set(suite.npm, dependencies.failure);
          } catch (error) {
            dependencyFailures.set(suite.npm, {
              status: signal?.aborted ? "cancelled" : "failed",
              exitCode: null,
              durationMs: 0,
              error: error.message,
            });
          }
        }
        preparationDurationMs = Math.round(
          performance.now() - preparationStarted,
        );
        result =
          dependencyFailures.get(suite.npm) ??
          (await execute(suite, {
            ...options,
            ...(plan.profile === "quick"
              ? { terminationGraceMs: 100, buildLease: false, detached: false }
              : {}),
            signal,
            ...(concurrency > 1 &&
            ["client-vue", "workshop-vue"].includes(suite.id)
              ? {
                  environment: {
                    VITEST_MAX_WORKERS: String(
                      Math.min(
                        workerBudget(parallelism),
                        Math.max(
                          1,
                          Math.floor((parallelism - 1) / concurrency),
                        ),
                      ),
                    ),
                    ...(options.environment ?? process.env),
                  },
                }
              : {}),
          }));
      } catch (error) {
        result = {
          status: signal?.aborted ? "cancelled" : "failed",
          exitCode: null,
          durationMs: 0,
          error: error.message,
        };
      } finally {
        if (result) result.preparationDurationMs = preparationDurationMs;
        if (result?.cleanupIncomplete && suite.npm) {
          (dependencies ?? prepared.get(suite.npm))?.retain?.();
          dependencyFailures.set(suite.npm, result);
        }
        dependencies?.release();
      }
    }
    results[index] = {
      id: suite.id,
      project: suite.project,
      kind: suite.kind,
      ...result,
    };
    onResult(results[index]);
  };
  try {
    let index = 0;
    while (index < plan.suites.length) {
      // Runner/script tests create temporary source fixtures in this checkout.
      // Keep them (and any newly registered suite) exclusive of source scanners.
      if (concurrency === 1 || !parallelSafeSuites.has(plan.suites[index].id)) {
        await run(index++);
        continue;
      }
      let end = index;
      while (
        end < plan.suites.length &&
        parallelSafeSuites.has(plan.suites[end].id)
      )
        end++;
      const workers = Array.from(
        { length: Math.min(concurrency, end - index) },
        async () => {
          while (index < end) await run(index++);
        },
      );
      await Promise.allSettled(workers).then((settled) => {
        const failure = settled.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      });
    }
  } finally {
    for (const dependencies of prepared.values()) dependencies.release();
  }
  const quickOverBudget =
    plan.profile === "quick" &&
    (budgetSignal?.aborted || performance.now() - started >= QUICK_BUDGET_MS);
  const status =
    quickOverBudget && !callerSignal?.aborted
      ? "failed"
      : signal?.aborted
        ? "cancelled"
        : results.some((result) => result.status !== "passed")
          ? "failed"
          : results.length
            ? "passed"
            : "no-tests";
  return {
    ...plan,
    status,
    ...(plan.profile === "quick" ? { budgetMs: QUICK_BUDGET_MS } : {}),
    ...(quickOverBudget && !callerSignal?.aborted
      ? {
          error:
            "Quick checks exceeded their execution budget; move slower suites to --feedback.",
        }
      : {}),
    results,
    durationMs: Math.round(performance.now() - started),
    setupDurationMs,
  };
}

export function parseOptions(args, environment = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      unit: { type: "boolean" },
      quick: { type: "boolean" },
      feedback: { type: "boolean" },
      checks: { type: "boolean" },
      coverage: { type: "boolean" },
      extended: { type: "boolean" },
      suite: { type: "string", multiple: true },
      "require-tests": { type: "boolean" },
      changed: { type: "boolean" },
      base: { type: "string" },
      list: { type: "boolean" },
      json: { type: "boolean" },
      "pi-package-root": { type: "string" },
      "success-cache": { type: "string" },
      timeout: { type: "string", default: "600" },
      jobs: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (
    !/^\d+$/.test(values.timeout) ||
    Number(values.timeout) < 1 ||
    Number(values.timeout) > 86400
  )
    throw new Error("--timeout must be an integer from 1 to 86400 seconds.");
  if (values.base !== undefined && (!values.changed || !values.base.trim()))
    throw new Error("--base requires --changed and a nonempty Git revision.");
  if (
    [
      values.unit,
      values.quick,
      values.feedback,
      values.checks,
      values.coverage,
    ].filter(Boolean).length > 1
  )
    throw new Error(
      "Choose only one of --unit, --quick, --feedback, --checks or --coverage.",
    );
  if (
    values["pi-package-root"] !== undefined &&
    !values["pi-package-root"].trim()
  )
    throw new Error("--pi-package-root requires a nonempty package directory.");
  if (
    values["success-cache"] !== undefined &&
    (!(values.quick || values.feedback) ||
      !values.changed ||
      !values["success-cache"].trim() ||
      environment.CI)
  )
    throw new Error(
      "--success-cache requires --quick/--feedback --changed, a nonempty directory, and a non-CI environment.",
    );
  if (
    values.jobs !== undefined &&
    (!/^[1-8]$/.test(values.jobs) ||
      !(values.unit || values.quick || values.feedback))
  )
    throw new Error(
      "--jobs requires --unit, --quick or --feedback and an integer from 1 to 8.",
    );
  return {
    ...values,
    timeout: Number(values.timeout),
    ...(values.jobs !== undefined ? { jobs: Number(values.jobs) } : {}),
  };
}

const help = `Usage: node tools/test.mjs [options]

No options runs supported suites available on this host, not optional diagnostics.
  --suite <id>     Run an explicit suite (repeatable); requires its execution host
  --extended       Restore the comprehensive current-host inventory, including deferred suites
  --unit           Unit and contract tests; no browsers, servers or native app builds
  --quick          Dependency-free source checks and fast contracts; five-second total budget
  --feedback       Unit tests plus cached lint/format, Vue types and Rust formatting
  --checks         Static/build checks only
  --coverage       Vue and Rust workspace coverage (requires native build tools)
  --require-tests  Fail an empty selection (always enabled in CI)
  --changed        Select projects affected by staged, unstaged and untracked changes
  --base <ref>     Also include commits since the merge base with <ref>; requires --changed
  --list           Print the selected suites without executing them
  --json           Print a JSON plan/result to stdout; test output stays on stderr
  --jobs <1-8>     Concurrent safe suites for --unit/--quick/--feedback (feedback: 2; unit: 1)
  --timeout <sec>  Timeout per suite (default 600); failures do not stop later suites
  --pi-package-root <path>  Pi installation for extension tests (overrides PI_PACKAGE_ROOT)
  --success-cache <path>  Private host-check cache for local --quick/--feedback --changed
  --help           Show this help

Examples:
  node tools/test.mjs --unit --changed
  node tools/test.mjs --changed --base origin/main
  node tools/test.mjs --unit --changed --base HEAD~1 --list --json

Outside --quick, portable checks require Docker and the pinned tool image.
Project dependencies and selected browsers are prepared inside the container.
Native and Docker-integration checks run on the host; install their prerequisites first.
Does not accept SDK licenses, install hooks, or commit/push this checkout.
See docs/development/testing.md for projects, categories and prerequisites.`;

export async function main(args = process.argv.slice(2)) {
  const controller = new AbortController();
  let exitSignal;
  const stop = (name) => {
    exitSignal = name;
    controller.abort();
  };
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(name, stop);
  const json = args.includes("--json");
  try {
    const options = parseOptions(args);
    const invocationStarted = performance.now();
    const worktreeQueueWaitMs = options.quick
      ? 0
      : Number(process.env.SITUATE_WORKTREE_WAIT_MS) || 0;
    delete process.env.SITUATE_WORKTREE_WAIT_MS;
    if (options.help) {
      console.log(json ? JSON.stringify({ status: "help", help }) : help);
      return 0;
    }
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error("Use Node 24 or newer; see client/.node-version.");
    const plan = createPlan(options);
    if (options.list) {
      if (json)
        console.log(JSON.stringify({ ...plan, status: "planned" }, null, 2));
      else {
        for (const suite of plan.suites)
          console.log(
            `${suite.id} [${suite.kind}] (${suite.cwd}): ${JSON.stringify([suite.command, ...suite.args])}${suite.reasons ? `\n  ${suite.reasons.join("\n  ")}` : ""}`,
          );
        console.log(
          `${plan.suites.length} suites selected (${plan.scope} scope, ${plan.profile} profile).`,
        );
        if (plan.deferredSuiteIds.length)
          console.log(`Not selected: ${plan.deferredSuiteIds.join(", ")}`);
      }
      return 0;
    }
    if (!json) {
      console.error(`Test scope: ${plan.scope}; profile: ${plan.profile}.`);
      if (plan.deferredSuiteIds.length)
        console.error(`Not selected: ${plan.deferredSuiteIds.join(", ")}`);
    }
    let execute = options.feedback
      ? (suite, executionOptions) =>
          executeSuite(cachedQualitySuite(suite, root), executionOptions)
      : executeSuite;
    let describeCache = () => "";
    if (options["success-cache"]) {
      const { createSuiteCacheExecutor, describeSuiteCacheResult } =
        await import("./suite-cache.mjs");
      describeCache = describeSuiteCacheResult;
      execute = createSuiteCacheExecutor({
        directory: root,
        cacheDirectory: resolve(options["success-cache"]),
        execute,
        affectedFiles: suiteAffectedFiles,
      });
    }
    const quickDeadline = options.quick
      ? AbortSignal.timeout(
          Math.max(
            1,
            QUICK_EXECUTION_MS -
              Math.round(performance.now() - invocationStarted),
          ),
        )
      : undefined;
    const report = await runPlan(plan, {
      execute,
      toolContainers: !options.quick && plan.suites.length > 0,
      ...(options["pi-package-root"]
        ? { externalPiRoot: resolve(options["pi-package-root"]) }
        : {}),
      ...(options["success-cache"]
        ? { successCacheDirectory: resolve(options["success-cache"]) }
        : {}),
      signal: quickDeadline
        ? AbortSignal.any([controller.signal, quickDeadline])
        : controller.signal,
      ...(options.quick
        ? { terminationGraceMs: 100, buildLease: false, detached: false }
        : {}),
      timeout: options.timeout,
      jobs: options.jobs,
      environment: options["pi-package-root"]
        ? {
            ...process.env,
            PI_PACKAGE_ROOT: resolve(options["pi-package-root"]),
          }
        : process.env,
      onStart: (suite) =>
        console.error(
          `\n${options["success-cache"] ? "Checking" : "Running"} ${suite.id} [${suite.kind}]`,
        ),
      onResult: (result) =>
        console.error(
          `${result.id}: ${result.reused ? "reused" : result.status}${result.error ? ` — ${result.error}` : ""}${describeCache(result)}`,
        ),
    });
    report.worktreeQueueWaitMs = worktreeQueueWaitMs;
    report.elapsedMs =
      Math.round(performance.now() - invocationStarted) +
      report.worktreeQueueWaitMs;
    if (options.quick) {
      report.budgetMs = QUICK_BUDGET_MS;
      if (
        quickDeadline.aborted ||
        report.elapsedMs >= QUICK_BUDGET_MS ||
        report.results.some((result) => result.exitCode === 75)
      ) {
        report.status = "failed";
        report.error =
          "Quick checks exceeded their five-second budget. Move slower checks to --feedback; run --feedback --changed for verification.";
        for (const result of report.results) {
          if (result.status === "cancelled") result.status = "timed-out";
        }
        console.error(report.error);
      }
    }
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        `\n${report.status}: ${report.results.filter((result) => result.status === "passed").length}/${report.results.length} suites passed (${plan.scope} scope, ${plan.profile} profile).`,
      );
      for (const result of report.results.filter(
        (result) => result.status !== "passed",
      ))
        console.log(`  ${result.id}: ${result.status}`);
      if (!plan.suites.length)
        console.log(
          "No tests selected for this scope, profile and change selection.",
        );
    }
    return exitSignal
      ? { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[exitSignal]
      : report.status === "failed" ||
          (report.status === "no-tests" &&
            (options["require-tests"] || process.env.CI === "true"))
        ? 1
        : 0;
  } catch (error) {
    if (json)
      console.log(JSON.stringify({ status: "error", error: error.message }));
    else console.error(error.message);
    return 2;
  } finally {
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.removeListener(name, stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const { coordinated, runCoordinated } = await import("./run-coordinated.mjs");
  process.exitCode =
    args.includes("--list") ||
    args.includes("--help") ||
    args.includes("--quick") ||
    coordinated(root)
      ? await main(args)
      : await runCoordinated({
          directory: root,
          command: process.execPath,
          args: [fileURLToPath(import.meta.url), ...args],
        });
}
