# Executor platform checks

Run commands from the repository root with the pinned Node.js and Rust toolchains.
These fixtures use no accounts or live services.

## macOS native boundary

```sh
node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- \
  cargo +1.98.1 run --manifest-path client/crates/tauri-plugin-executor-platform/tests/native/Cargo.toml --offline
```

The application creates no main UI WebView. It checks blob module Workers and imports,
network denial in both realms, generated Worker functions, termination of a synchronous
Worker loop, and native watchdog destruction of a hung supervisor. A successful run
prints `executor-native-test: passed` and exits. Append
`-- --supervisor client/app/dist/executor-supervisor.js` to also check the built supervisor's
captured module graph, export calls, and initialization, tool, and generated-check loops.

## iOS WebKit boundary

Requires Xcode, XcodeGen, XcodeBuildMCP, an installed iOS simulator, and the Tauri Swift API
at this crate's `.tauri/tauri-api` path. Tauri's ordinary iOS plugin build populates that
path. Its SwiftRs dependency must also be available locally for offline checks.

Generate the fixture from the same Rust document builder used in production:

```sh
mkdir -p client/crates/tauri-plugin-executor-platform/tests/ios/Resources
node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- \
  cargo +1.98.1 run --manifest-path client/crates/tauri-plugin-executor-platform/tests/native/Cargo.toml \
  --offline -- --print-ios-fixture \
  > client/crates/tauri-plugin-executor-platform/tests/ios/Resources/executor.html
node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- \
  cargo +1.98.1 run --manifest-path client/crates/tauri-plugin-executor-platform/tests/native/Cargo.toml \
  --offline -- --print-ios-fixture --supervisor client/app/dist/executor-supervisor.js \
  > client/crates/tauri-plugin-executor-platform/tests/ios/Resources/bundled.html
node tools/run-coordinated.mjs -- xcodegen generate \
  --spec client/crates/tauri-plugin-executor-platform/tests/ios/project.yml
node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- \
  xcodebuildmcp simulator test \
  --project-path client/crates/tauri-plugin-executor-platform/tests/ios/ExecutorHarness.xcodeproj \
  --scheme ExecutorHarness --simulator-id SIMULATOR_ID
```

The tests run the production offscreen `ExecutorWebView` with that document. They check
module Workers, blob imports, CSP, Worker termination, navigation loss, and view disposal.
Build the frontend first to produce `executor-supervisor.js`; without `bundled.html`, the
shipped-supervisor test reports a skip rather than claiming that coverage.
The separate `ExecutorPluginCompile` target compiles the production Swift plugin against
Tauri. These tests do not run the Rust-to-Tauri-to-Swift Channel bridge or qualify the Rust
iOS watchdog, physical-device lifecycle, background expiration, or App Store distribution.
