const deferred = new Set([
  "root-kotlin",
  "workshop-chromium",
  "workshop-webkit",
  "client-workshop-host",
  "client-workshop-clippy",
  "client-visual",
  "client-visual-fixture",
]);

const appleHostOnly = new Set([
  "client-browser",
  "client-executor-integration",
  "client-agent-runtime",
  "client-core",
  "client-host",
  "client-clippy",
  "client-native",
  "client-agent-e2e",
  "client-onboarding-e2e",
  "client-plugins-e2e",
  "client-workspace-access-swift",
  "client-dictation-swift",
  "client-rust-coverage",
  "root-swift",
  "dev-tui-unit",
  "dev-tui-format",
  "dev-tui-clippy",
]);

const diagnostics = new Set([
  ...deferred,
  "root-audit",
  "workshop-vue",
  "workshop-types",
  "workshop-format",
  "runner-platform",
  "client-scripts-platform",
  "client-scripts-platform-integration",
]);

export function supportedSuiteEnabled(suite) {
  return (
    !diagnostics.has(suite.id) &&
    suite.kind !== "coverage" &&
    !(suite.project === "design" && suite.kind === "browser")
  );
}

export function suiteHost(suite) {
  if (
    appleHostOnly.has(suite.id) ||
    ["client-migrations", "client-format", "root-rust"].includes(suite.id)
  )
    return "macos";
  return "linux";
}

export function suiteAvailable(suite, platform = process.platform) {
  return suiteHost(suite) !== "macos" || platform === "darwin";
}

export function mvpSuiteEnabled(suite, platform = process.platform) {
  return (
    !deferred.has(suite.id) &&
    !(suite.project === "design" && suite.kind === "browser") &&
    (platform === "darwin" || !appleHostOnly.has(suite.id))
  );
}
