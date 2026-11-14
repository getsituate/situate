const shared =
  /^(package(?:-lock)?\.json|\.node-version|\.prettier[^/]*|prettier\.config\.[^/]+|eslint\.config\.[^/]+|\.editorconfig|\.gitignore)$/;
const clientConfig =
  /^client\/(package(?:-lock)?\.json|Cargo\.(toml|lock)|rust-toolchain(?:\.toml)?|\.node-version)$/;
const appConfig = /^client\/app\/[^/]+$/;
const workshopConfig =
  /^client\/workshop\/[^/]+$|^client\/workshop\/src-tauri\//;
const platformInput =
  /^tools\/bootstrap-mobile|^client\/scripts\/(?:ios-|test-native-ios|native-ios-|generate-mobile-permissions)/;
const declarations = /^changes\//;
const swiftPolicy = /^\.(?:swift-format|swiftlint\.yml)$/;
const delivery =
  /^(?:tools\/(?:change-fragments|release-inputs|release-reservation|release-qualification|github-release|pipeline(?:-plan|-state|-operations)?)|infrastructure\/releases\/(?:allocator|recovery))(?:\.test)?\.mjs$/;
const migrationContracts =
  /^tools\/(?:migration-history|published-migrations)(?:\.test)?\.mjs$/;
const migrationConsumers =
  /^(?:tools\/(?:release|release-catalog|release-inputs|release-qualification)|client\/scripts\/apple-release|infrastructure\/releases\/(?:publish|transport))(?:\.test)?\.mjs$|^client\/crates\/situate-migrations\/|^releases\//;
const fixture =
  /(^|\/)(fixtures?|__fixtures__|tests?|src|data|templates|contracts|prompts)(\/|$)/;

export function isPlainDocumentation(file) {
  if (fixture.test(file) || file.startsWith(".pi/")) return false;
  return (
    /(^|\/)(docs|concepts)\/.*\.(md|mdx|adoc|rst|txt)$/.test(file) ||
    /(^|\/)(README|AGENTS|CHANGELOG|CONTRIBUTING|SECURITY|LICENSE|NOTICE)(\.(md|mdx|adoc|rst|txt))?$/.test(
      file,
    )
  );
}

const releaseInputs = (file) =>
  /^(releases\/|tools\/release[^/]*\.mjs$|client\/scripts\/release-history[^/]*\.mjs$|client\/packages\/localization\/(locales\.json$|src\/catalogs\/releases\/))/.test(
    file,
  );
const app = /^client\/app\/(src|tests)\//;
const workshop = /^client\/workshop\/(src|tests)\//;
const ui = /^client\/packages\/(ui|localization)\//;
const brand = /^design\/brand\//;
const onboarding = /^docs\/marketing\/onboarding\//;
const capabilityCatalog =
  /^docs\/(?:product-capability-catalog\/(?:[^/]+\.md|generate-reading-edition\.py)|(?:note|task-management|email)-capabilities-fact-check\.(?:md|pdf))$/;
const rust =
  /^client\/(crates|src-tauri|native|contracts)\/|^client\/app\/src-tauri\//;
const tools = /^tools\/(?!dev-tui\/)/;
const design = /^(design|website|infrastructure\/website)\//;
const productionInfrastructure = /^infrastructure\/(production|releases)\//;
const catalog =
  /^requirements\/data\/(?:foundations\.md|(?:goals|requirements)\/.*\.md)$/;
const frontend = (file) => ui.test(file) || brand.test(file);
const product = (file) =>
  app.test(file) || frontend(file) || rust.test(file) || releaseInputs(file);
const productUnit = (file) =>
  file !== "client/app/src/plugins/executor-boundary.test.ts" && product(file);
const workshopInput = (file) =>
  workshop.test(file) ||
  workshopConfig.test(file) ||
  frontend(file) ||
  rust.test(file);
const nativeHarness =
  /^(tools\/native-vm[^/]*\.(mjs|py)|client\/scripts\/(test-native[^/]*|test-agent-e2e|native-vm[^/]*|native-smoke[^/]*|native-desktop-session|coordinated-native[^/]*|agent-e2e-runtime|document-source-fixtures)\.mjs)$/;
const native = (file) =>
  product(file) || /^client\/app\//.test(file) || nativeHarness.test(file);
const requirements = (file) => file.startsWith("requirements/");
const pi = (file) => file.startsWith(".pi/") || tools.test(file);
const dev = (file) =>
  file.startsWith("tools/dev-tui/") ||
  file === "design/brand/tokens.json" ||
  releaseInputs(file);
const scripts = (file) =>
  /^client\//.test(file) ||
  /^tools\/native-vm[^/]*\.(mjs|py)$/.test(file) ||
  brand.test(file) ||
  /^infrastructure\/releases\//.test(file) ||
  releaseInputs(file);
const runner = (file) =>
  tools.test(file) ||
  /^(\.github\/|client\/(scripts|docker)\/)/.test(file) ||
  releaseInputs(file);
const callbackAssets = (file) =>
  /^client\/app\/src\/ai\/browser-callback\//.test(file) ||
  /^design\/brand\/(?:tokens\.css|assets\/(?:wordmark|card)\.svg|bend\/(?:performance\.js|svg\/rest-welcome\.svg))$/.test(
    file,
  );
const core = (file) =>
  rust.test(file) ||
  callbackAssets(file) ||
  /^client\/packages\/localization\//.test(file) ||
  /^client\/app\/src\/ai\/.*\.json$/.test(file);
const rules = {
  "runner-fast": runner,
  "quick-source": () => true,
  "runner-unit": (file) =>
    runner(file) && !delivery.test(file) && !migrationContracts.test(file),
  "delivery-migrations": (file) =>
    migrationContracts.test(file) ||
    migrationConsumers.test(file) ||
    [
      "tools/test.mjs",
      "tools/test-inputs.mjs",
      "tools/test-scope.mjs",
    ].includes(file),
  "delivery-unit": (file) =>
    delivery.test(file) ||
    declarations.test(file) ||
    /^releases\//.test(file) ||
    file === "tools/test.mjs" ||
    file === "tools/test-inputs.mjs" ||
    file === "tools/test-scope.mjs",
  "runner-platform": (file) => /^tools\/bootstrap-mobile/.test(file),
  "client-scripts-platform": (file) =>
    /^client\/scripts\/(?:ios-|test-native-ios|native-ios-|generate-mobile-permissions)/.test(
      file,
    ),
  "client-scripts-platform-integration": (file) =>
    /^client\/scripts\/ios-/.test(file),
  "runner-integration": runner,
  "client-scripts-unit": scripts,
  "client-scripts-integration": scripts,
  "client-vue": productUnit,
  "client-vue-coverage": productUnit,
  "client-executor-integration": product,
  "client-types": product,
  "client-browser-chromium": product,
  "client-browser-webkit": product,
  "client-visual": product,
  "client-visual-fixture": product,
  "workshop-vue": workshopInput,
  "workshop-types": workshopInput,
  "workshop-chromium": workshopInput,
  "workshop-webkit": workshopInput,
  "client-migrations": (file) =>
    /^client\/crates\/situate-migrations\//.test(file),
  "client-agent-runtime": core,
  "client-core": core,
  "client-core-macos": core,
  "client-rust-coverage": core,
  "client-host": core,
  "client-workshop-host": (file) => core(file) || workshopConfig.test(file),
  "client-format": (file) => rust.test(file),
  "client-clippy": core,
  "client-host-clippy": core,
  "client-workshop-clippy": (file) => core(file) || workshopConfig.test(file),
  "workshop-format": (file) => rust.test(file) || workshopConfig.test(file),
  "client-native": native,
  "client-agent-e2e": native,
  "client-onboarding-e2e": native,
  "client-plugins-e2e": native,
  "client-dictation-swift": (file) => rust.test(file),
  "client-workspace-access-swift": (file) => rust.test(file),
  "client-docker-context": (file) => /^client\/docker\//.test(file),
  "dev-tui-unit": dev,
  "dev-tui-macos": dev,
  "dev-tui-format": (file) => file.startsWith("tools/dev-tui/"),
  "dev-tui-clippy": dev,
  "requirements-unit": requirements,
  "requirements-catalog": requirements,
  "requirements-integration": requirements,
  "requirements-build": requirements,
  "requirements-browser": requirements,
  "design-unit": (file) =>
    design.test(file) ||
    onboarding.test(file) ||
    capabilityCatalog.test(file) ||
    productionInfrastructure.test(file) ||
    file === "client/workshop/src/ai/assets/providers/LICENSE.txt",
  "design-contracts": (file) =>
    design.test(file) || requirements(file) || isPlainDocumentation(file),
  "design-website-hosting": (file) =>
    /^(website|infrastructure\/(website|production))\//.test(file),
  "design-website-browser": (file) => design.test(file),
  "design-validation-browser": (file) => design.test(file),
  "design-reference-browser": (file) => design.test(file),
  "design-mini-reference-browser": (file) => design.test(file),
  "design-bend-browser": (file) => design.test(file),
  "design-performance-browser": (file) => design.test(file),
  "design-mini-browser": (file) => design.test(file),
  "design-first-hello-browser": (file) => design.test(file),
  "design-listening-room-browser": (file) => design.test(file),
  "pi-unit": pi,
  "pi-mcp": pi,
  "pi-test-hook": pi,
  "root-format": () => true,
  "root-lint": (file) => /\.[cm]?[jt]sx?$|\.vue$/.test(file),
  "root-secrets": () => true,
  "root-commits": () => true,
  "root-history-secrets": () => true,
  "root-audit": () => false,
  "root-rust": (file) => rust.test(file),
  "root-kotlin": (file) => rust.test(file),
  "root-swift": (file) => rust.test(file) || swiftPolicy.test(file),
};

export function hasSuiteInputRule(suite) {
  const id = typeof suite === "string" ? suite : suite.id;
  return Object.hasOwn(rules, id);
}

export function requiresFullSelection(file) {
  return shared.test(file) || !knownInput(file);
}

function knownInput(file) {
  return (
    isPlainDocumentation(file) ||
    file === ".env.example" ||
    onboarding.test(file) ||
    capabilityCatalog.test(file) ||
    app.test(file) ||
    workshop.test(file) ||
    workshopConfig.test(file) ||
    ui.test(file) ||
    rust.test(file) ||
    design.test(file) ||
    productionInfrastructure.test(file) ||
    releaseInputs(file) ||
    tools.test(file) ||
    clientConfig.test(file) ||
    appConfig.test(file) ||
    declarations.test(file) ||
    swiftPolicy.test(file) ||
    /^(tools\/dev-tui\/|requirements\/|\.pi\/|\.github\/|client\/scripts\/|client\/docker\/)/.test(
      file,
    )
  );
}

// Unknown suites and inputs retain coverage until their consumers are classified.
export function suiteAffectedFiles(suite, files) {
  const id = typeof suite === "string" ? suite : suite.id;
  if (!hasSuiteInputRule(id)) return [...files];
  const rule = rules[id];
  return files.filter((file) => {
    if (
      [
        "root-format",
        "root-secrets",
        "root-commits",
        "root-history-secrets",
        "quick-source",
      ].includes(id)
    )
      return true;
    if (file === ".env.example")
      return [
        "runner-unit",
        "runner-integration",
        "client-scripts-unit",
        "client-scripts-integration",
      ].includes(id);
    if (/^(?:tools|client\/scripts)\/.*\.test\.mjs$/.test(file))
      return (
        (!id.startsWith("client-") || id.startsWith("client-scripts-")) &&
        !id.startsWith("workshop-") &&
        rule(file)
      );
    if (shared.test(file)) return id !== "root-audit";
    if (workshopConfig.test(file))
      return (
        id.startsWith("workshop-") ||
        id.startsWith("client-workshop-") ||
        id.startsWith("client-scripts-")
      );
    if (platformInput.test(file))
      return (
        (rule(file) && !id.startsWith("client-")) ||
        (id.startsWith("client-scripts-") && rule(file))
      );
    if (clientConfig.test(file))
      return (
        id.startsWith("client-") ||
        id.startsWith("workshop-") ||
        id === "root-rust" ||
        id === "root-swift" ||
        id === "runner-unit" ||
        (id === "delivery-migrations" &&
          /^client\/(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?)$/.test(
            file,
          ))
      );
    if (appConfig.test(file))
      return id.startsWith("client-") || id === "runner-unit";
    if (/^requirements\/(package(?:-lock)?\.json|[^/]*config[^/]*)$/.test(file))
      return id.startsWith("requirements-");
    if (isPlainDocumentation(file))
      return (
        id === "design-contracts" ||
        (id === "design-unit" &&
          (brand.test(file) ||
            onboarding.test(file) ||
            capabilityCatalog.test(file)))
      );
    if (catalog.test(file))
      return [
        "requirements-unit",
        "requirements-catalog",
        "design-contracts",
      ].includes(id);
    // Lint does not consume non-JavaScript inputs, even in an unknown area.
    if (id === "root-lint") return rule(file);
    return rule(file) || !knownInput(file);
  });
}

export function appAffected(file) {
  if (/^(?:tools|client\/scripts)\/.*\.test\.mjs$/.test(file)) return false;
  if (
    isPlainDocumentation(file) ||
    declarations.test(file) ||
    workshopConfig.test(file) ||
    workshop.test(file) ||
    platformInput.test(file)
  )
    return false;
  if (requiresFullSelection(file)) return true;
  return (
    product(file) ||
    clientConfig.test(file) ||
    appConfig.test(file) ||
    nativeHarness.test(file) ||
    /^client\/scripts\/(?:apple-|updater-|qualify-direct|release|bundle-report|localization|ai-catalog|auth-callback|native-licenses)/.test(
      file,
    ) ||
    /^infrastructure\/releases\//.test(file)
  );
}

export function suiteSelectionReasons(suite, files) {
  return suiteAffectedFiles(suite, files).map(
    (file) => `Input changed: ${file}`,
  );
}
