import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  root as repositoryRoot,
  sourceFiles,
  suiteInventory,
} from "./test.mjs";
import {
  appAffected,
  hasSuiteInputRule,
  requiresFullSelection,
  suiteSelectionReasons,
} from "./test-inputs.mjs";
import {
  supportedSuiteEnabled,
  suiteHost,
  suiteExecution,
} from "./test-scope.mjs";

const execute = promisify(execFile);
const families = [
  [
    "policy",
    "linux",
    [
      "root-format",
      "root-lint",
      "root-secrets",
      "root-commits",
      "root-history-secrets",
      "root-rust",
      "root-swift",
      "design-contracts",
      "requirements-catalog",
    ],
  ],
  [
    "tooling",
    "linux",
    [
      "runner-unit",
      "runner-integration",
      "delivery-unit",
      "delivery-migrations",
      "client-scripts-unit",
      "client-scripts-integration",
      "requirements-unit",
      "requirements-integration",
      "requirements-build",
      "requirements-browser",
      "design-unit",
      "pi-unit",
      "pi-mcp",
      "pi-test-hook",
      "dev-tui-unit",
      "dev-tui-format",
      "dev-tui-clippy",
    ],
  ],
  ["tooling-macos", "macos", ["dev-tui-macos"]],
  [
    "docker-integration",
    "linux",
    ["client-docker-context", "design-website-hosting"],
    "host-docker",
  ],
  ["frontend", "linux", ["client-vue", "client-types"]],
  [
    "rust",
    "linux",
    [
      "client-agent-runtime",
      "client-migrations",
      "client-core",
      "client-format",
      "client-clippy",
    ],
  ],
  [
    "macos-code",
    "macos",
    [
      "client-core-macos",
      "client-host",
      "client-host-clippy",
      "client-dictation-swift",
      "client-workspace-access-swift",
    ],
  ],
  [
    "browser",
    "linux",
    [
      "client-browser-chromium",
      "client-browser-webkit",
      "client-executor-integration",
    ],
  ],
  [
    "macos-native",
    "macos",
    [
      "client-native",
      "client-agent-e2e",
      "client-onboarding-e2e",
      "client-plugins-e2e",
    ],
  ],
];

function validateMode(mode) {
  if (!["verify", "release"].includes(mode))
    throw new Error(`Unknown planning mode: ${mode}`);
}

function select(paths, { mode, inventory, appImpact }) {
  validateMode(mode);
  const mandatory = inventory.filter(supportedSuiteEnabled);
  for (const suite of mandatory) {
    if (!hasSuiteInputRule(suite))
      throw new Error(`Missing input rule: ${suite.id}`);
    const assignments = families.filter(([, , ids]) => ids.includes(suite.id));
    if (assignments.length !== 1)
      throw new Error(`Missing or ambiguous lane assignment: ${suite.id}`);
    if (assignments[0][1] !== suiteHost(suite))
      throw new Error(`Inconsistent suite host assignment: ${suite.id}`);
    const execution =
      assignments[0][3] ??
      (assignments[0][1] === "macos" ? "native" : "container");
    if (execution !== suiteExecution(suite))
      throw new Error(`Inconsistent suite execution assignment: ${suite.id}`);
  }
  const full = mode === "release" && appImpact;
  const selected = mandatory.flatMap((suite) => {
    const reasons = suiteSelectionReasons(suite, paths);
    const family = families.find(([, , ids]) => ids.includes(suite.id))[0];
    if (
      full &&
      (["frontend", "rust", "browser", "macos-code", "macos-native"].includes(
        family,
      ) ||
        [
          "root-rust",
          "root-swift",
          "delivery-unit",
          "delivery-migrations",
          "client-scripts-unit",
          "client-scripts-integration",
        ].includes(suite.id))
    )
      reasons.push("Complete macOS source verification for an app release.");
    return reasons.length ? [{ ...suite, reasons }] : [];
  });
  const lanes = families.flatMap(([id, host, ids, execution]) => {
    const suites = selected.filter((suite) => ids.includes(suite.id));
    return suites.length
      ? [
          {
            id,
            host,
            ...(execution ? { execution } : {}),
            timeoutSeconds: [
              "rust",
              "browser",
              "macos-code",
              "macos-native",
            ].includes(id)
              ? 1800
              : 600,
            suites: suites.map((suite) => suite.id),
            reasons: [...new Set(suites.flatMap((suite) => suite.reasons))],
          },
        ]
      : [];
  });
  return {
    appImpact,
    lanes,
    reasons: [
      ...paths
        .filter(requiresFullSelection)
        .map(
          (path) =>
            `Conservative supported selection for unclassified input: ${path}`,
        ),
      ...(full
        ? ["Cumulative app changes require complete macOS source verification."]
        : []),
    ],
  };
}

function validatePaths(paths) {
  if (
    !Array.isArray(paths) ||
    paths.some(
      (path) =>
        typeof path !== "string" ||
        !path ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part) => part === ".." || part === "." || !part),
    )
  )
    throw new Error("Changed paths must be repository-relative file paths.");
  return [...new Set(paths)].sort();
}

export function planPaths(paths, { mode = "verify" } = {}) {
  paths = validatePaths(paths);
  return select(paths, {
    mode,
    inventory: suiteInventory(sourceFiles(repositoryRoot), "darwin"),
    appImpact: paths.some(appAffected),
  });
}

export async function createPlan({
  root = repositoryRoot,
  source,
  base,
  mode = "verify",
  changedPaths,
  completedSource,
} = {}) {
  validateMode(mode);
  const git = async (...args) =>
    (
      await execute("git", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      })
    ).stdout;
  const commit = async (sha, label) => {
    if (typeof sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
      throw new Error(`${label} must be an exact full commit SHA.`);
    const resolved = (
      await git("rev-parse", "--verify", "--end-of-options", `${sha}^{commit}`)
    ).trim();
    if (resolved !== sha)
      throw new Error(`${label} must identify a commit, not a tag.`);
    return resolved;
  };
  source = await commit(source, "source");
  base = await commit(base, "base");
  if ((await git("rev-parse", "--is-shallow-repository")).trim() !== "false")
    throw new Error(
      "Planning requires complete Git history; shallow repositories are unsupported.",
    );
  const diff = async (from) =>
    (await git("diff", "--name-only", "--no-renames", "-z", from, source, "--"))
      .split("\0")
      .filter(Boolean);
  const ancestor = (await git("merge-base", base, source)).trim();
  const actualPaths = await diff(ancestor);
  const paths =
    changedPaths === undefined ? actualPaths : validatePaths(changedPaths);
  if (
    changedPaths !== undefined &&
    JSON.stringify(paths) !== JSON.stringify(validatePaths(actualPaths))
  )
    throw new Error("Changed paths do not match the exact source comparison.");
  let appPaths = paths;
  if (mode === "release") {
    completedSource = await commit(completedSource, "completedSource");
    await git("merge-base", "--is-ancestor", completedSource, source);
    appPaths = await diff(completedSource);
  }
  const files = (await git("ls-tree", "-r", "--name-only", "-z", source))
    .split("\0")
    .filter(Boolean);
  return {
    schemaVersion: 1,
    source,
    base,
    ...select(paths, {
      mode,
      inventory: suiteInventory(files, "darwin"),
      appImpact: appPaths.some(appAffected),
    }),
  };
}
