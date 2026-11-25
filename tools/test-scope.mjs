const deferred = new Set([
  "root-kotlin",
  "workshop-chromium",
  "workshop-webkit",
  "client-workshop-host",
  "client-workshop-clippy",
  "client-browser-webkit",
  "client-visual",
  "client-visual-fixture",
]);

export const windowsNativeSuites = Object.freeze([
  "client-windows-build",
  "client-windows-workspace",
]);

const appleHostOnly = new Set([
  "client-browser-msedge",
  "client-core-macos",
  "client-host",
  "client-host-clippy",
  "client-workshop-host",
  "client-workshop-clippy",
  "client-native",
  "client-native-compatibility",
  "client-dictation-recognition",
  "client-agent-e2e",
  "client-onboarding-e2e",
  "client-plugins-e2e",
  "client-workspace-access-swift",
  "client-dictation-swift",
  "client-rust-coverage",
  "dev-tui-macos",
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
    !(
      suite.project === "design" &&
      suite.kind === "browser" &&
      suite.id !== "design-website-browser"
    )
  );
}

export function suiteHost(suite) {
  if (windowsNativeSuites.includes(suite.id)) return "windows";
  if (appleHostOnly.has(suite.id)) return "macos";
  return "linux";
}

export function suiteExecution(suite) {
  if (["client-docker-context", "design-website-hosting"].includes(suite.id))
    return "host-docker";
  return suiteHost(suite) === "linux" ? "container" : "native";
}

export function suiteAvailable(suite, platform = process.platform) {
  if (suiteHost(suite) === "windows") return platform === "win32";
  if (suiteHost(suite) === "macos") return platform === "darwin";
  if (suite.id.startsWith("dev-tui-"))
    return ["darwin", "linux"].includes(platform);
  return true;
}

export function mvpSuiteEnabled(suite, platform = process.platform) {
  return (
    !deferred.has(suite.id) &&
    !(suite.project === "design" && suite.kind === "browser") &&
    (platform === "darwin" || !appleHostOnly.has(suite.id)) &&
    (platform === "win32" || !windowsNativeSuites.includes(suite.id))
  );
}
