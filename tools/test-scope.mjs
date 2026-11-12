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
  "dev-tui-clippy",
]);

export function mvpSuiteEnabled(suite, platform = process.platform) {
  return (
    !deferred.has(suite.id) &&
    !(suite.project === "design" && suite.kind === "browser") &&
    (platform === "darwin" || !appleHostOnly.has(suite.id))
  );
}
