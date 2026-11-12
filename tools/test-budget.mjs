export const QUICK_BUDGET_MS = 5_000;
export const QUICK_EXECUTION_MS = 4_000;
export const BUILD_SLOTS = 2;

export function workerBudget(parallelism) {
  // Browser workers also need CPU for their browser and server processes.
  return Math.max(1, Math.min(4, Math.floor(parallelism / (2 * BUILD_SLOTS))));
}

export function needsBuildLease(suite) {
  return (
    suite.command === "cargo" ||
    suite.command === "swift" ||
    ["browser", "coverage"].includes(suite.kind) ||
    [
      "client-vue",
      "client-executor-integration",
      "client-scripts-integration",
      "workshop-vue",
      "client-types",
      "workshop-types",
      "root-rust",
      "client-workspace-access-swift",
    ].includes(suite.id)
  );
}

export function isFeedbackSuite(suite) {
  return (
    suite.kind === "unit" ||
    new Set([
      "dev-tui-format",
      "root-lint",
      "root-format",
      "client-types",
      "workshop-types",
      "client-format",
    ]).has(suite.id)
  );
}
