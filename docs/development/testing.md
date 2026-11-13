# Repository test suite

Run the suite from the repository root with [Volta](README.md#install-volta) selecting the root `package.json` Node.js and npm pins:

```sh
node tools/test.mjs
```

Without options, this runs the **macOS/iOS MVP scope**: shared unit/integration and security checks, plus product browser, Rust host, Swift and native journeys on macOS. Windows, Linux desktop and Android are deferred product targets. Linux may still run shared CI checks; that does not qualify a Linux product.

Workshop browser/native sweeps, design browser sweeps and screenshot comparisons are not part of routine MVP verification. They remain available through `--extended` or their dedicated commands. Use focused checks when changing the corresponding workshop, artwork or visual behavior. A passing MVP run does not claim coverage of these deferred checks or native iOS devices.

A failing selected suite does not prevent later suites from running. Missing dependencies and unavailable services are failures, not reasons to silently omit a selected suite.

The entry point, project selection, categories, commands, and execution policy live in [`tools/test.mjs`](../../tools/test.mjs). Individual test implementations remain with their projects. The [Pi extension](../../.pi/extensions/test-suite/index.ts) invokes this runner for automatic fast feedback; neither component installs a Git hook.

Secret scanning excludes the Git-ignored repository-root `.env`, installed dependencies and generated output. Application source, `.env.example`, `.env.local` and nested `.env` files remain scanned. Keep the root `.env` untracked.

## Profiles and change selection

```sh
# Unit and contract tests only
node tools/test.mjs --unit

# Dependency-free feedback with a five-second total budget
node tools/test.mjs --quick --changed

# Unit tests plus cached lint/format, Vue types and Rust formatting
node tools/test.mjs --feedback --changed

# Static/build checks only
node tools/test.mjs --checks

# Opt-in source coverage
node tools/test.mjs --coverage

# MVP scope for projects affected by local changes
node tools/test.mjs --changed

# Opt into the complete registered host inventory, including deferred sweeps
node tools/test.mjs --extended
node tools/test.mjs --extended --changed

# Fast tests for projects affected by local changes
node tools/test.mjs --unit --changed

# Include committed branch changes as well as local changes
node tools/test.mjs --changed --base origin/main
node tools/test.mjs --unit --changed --base origin/main

# Inspect the last commit, even in a clean worktree
node tools/test.mjs --changed --base HEAD~1

# Inspect selection without executing tests
node tools/test.mjs --unit --changed --list
node tools/test.mjs --list --json
```

The default scope policy is defined in [`tools/test-scope.mjs`](../../tools/test-scope.mjs). `--extended` opts into the complete current-host inventory and can be combined with profile and change selection. Plans and reports identify the scope and deferred suites; deferred checks are not reported as passed.

The `--unit`, `--quick`, `--feedback`, `--checks`, and `--coverage` profiles are mutually exclusive. `--unit` retains its test-only meaning. `--feedback` runs unit suites plus root lint/format, app and workshop typechecking, and Rust formatting; these checks may take minutes. CI's existing `quick` shard is a separate, broader selection and retains those checks. With `--changed`, every profile uses the suite input rules in [`tools/test-inputs.mjs`](../../tools/test-inputs.mjs). Ordinary documentation and documents under `concepts/` select formatting and documentation contracts, plus secret scanning in the full profile—not frontend, Rust, browser or native tests. Requirement records under `requirements/data/` retain catalog validation and catalog unit tests, not viewer builds or journeys. Markdown in fixtures, source, templates and Pi resources retains its consuming checks. Unknown inputs and shared configuration changes retain conservative coverage. A clean changed selection remains empty.

Feedback lint/format checks use worktree-local content caches under `node_modules/.cache/situate-quality/`. Prettier reuses unchanged files across source edits; lint invalidates on cross-file source and type-declaration changes. Configuration, ignore rules, installation receipts, and environment changes also invalidate reuse. Unsupported configurations or incomplete input scans fall back to uncached checks. Explicit `npm run lint`, `npm run format:check`, and full runner invocations remain uncached.

Quick checks have a **five-second total budget**, including planning and cleanup, regardless of `--timeout`. They run only the explicit dependency-free allowlist in `tools/test.mjs`: runner input contracts and source sanity checks. Source checks detect conflict markers, invalid JSON, and JavaScript syntax errors in changed files; an unfiltered quick run omits JavaScript subprocess checks. They do not replace lint, formatting, Vue/TypeScript checks, Rust tests, or pre-merge verification. Quick checks never install dependencies, acquire build slots, or wait for the artifact-writing worktree queue. They are read-only. An execution deadline reserves cleanup time; a budget overrun is a failure, never a pass. Any check that cannot fit this budget belongs in `--feedback` or another longer-running suite. `tools/test-budget.test.mjs` verifies the allowlist, deadline, and termination behavior. Pi also bounds automatic feedback and does not start a repair turn for a budget overrun. Under operating-system stalls, safe process teardown can outlast a deadline; this remains a failed check.

Feedback runs execute up to two independent suites concurrently. Use `--feedback --jobs 1` for serial execution or `--jobs <1-8>` with `--feedback`, `--quick` or `--unit` to set the limit. Unit runs default to one worker; full, integration, build, and coverage runs remain serial. Runner and client-script suites create temporary source fixtures, so they run exclusively, as do suites not explicitly registered for parallel execution. JSON results retain plan order even when suites finish out of order.

`--changed` combines staged changes, unstaged changes, and untracked non-ignored files. Deletions count; renames include both old and new paths. A clean worktree selects no suites unless `--base` adds committed changes. Git errors or unresolved references fail the command rather than being treated as an empty selection.

`--base` requires `--changed`. It compares `HEAD` with the merge base of `HEAD` and the supplied revision, then includes local changes too. The runner does not fetch remote references. Fetch the desired reference yourself when an up-to-date comparison is required.

All commands test the **current working tree**, not a temporary copy of the Git index or the base commit. Staging a file does not hide its unstaged edits from test execution. Do not edit source while a run is in progress. Outside the read-only quick profile, the runner, client dependency preparation, and `node tools/npm-ci.mjs` share a worktree-local command queue. Commands started in subdirectories use the same Git-worktree lease as commands started at its root. A second command waits, then checks the current files itself; it does not reuse another session's report. Separate worktrees can run browser suites concurrently without reserving ports. Full verification never reuses test results. Feedback lint/format checks can reuse content caches. Local `--feedback --changed --success-cache <private-directory>` runs may reuse unchanged successes for the explicitly supported Vue, typecheck, and Rust-core suites. Cache snapshots inspect dependency metadata and source content; unfamiliar executable configuration, unbounded native flags, or an exceeded snapshot budget forces execution. Suite results expose cache status, rejection reason, and inspection time. Cache records contain only digests and require a private existing directory.

Supported registry dependency versions/features and literal TypeScript/Vitest options invalidate prior results automatically. Configuration eligibility follows the bounded structural policy in [`tools/suite-cache-config.mjs`](../../tools/suite-cache-config.mjs), alongside Cargo's resolved dependency graph. Workspace member manifests and Vitest setup files must be inventoried, selected inputs contained within the repository. Unsupported configurations still execute their selected suites normally.

The executable `uiBoundary` hook must match the [known-source policy](../../tools/suite-cache-policy/ui-boundary.mjs); line indentation and trailing spaces/tabs may differ. Review changes to the hook's behavior before updating that policy. Do not automatically copy an altered hook into the policy to enable reuse. Failed, cancelled, or uncertain results are not reused; changed inputs or incomplete cleanup prevent recording a reusable success.

The queue requires Python 3 on macOS and Linux. Its detached supervisor holds an operating-system file lock while the command and its observed descendants run. Closing the caller, including a hard caller kill, requests descendant termination before releasing the lease. Do not kill the supervisor directly or delete its lock file: unlinking an active file lock can create independent owners. Interrupt a queued command to cancel it without stopping the current owner. The runner's `--timeout` applies to each suite after it starts, not to time spent waiting in the queue.

Across worktrees, the runner admits at most two heavy compilation, Vue/typecheck, or browser jobs at once. Native smoke and agent builds acquire a slot only for compilation, not while waiting for the desktop. Default Vitest, Cargo, Rust-test and product Playwright worker counts are capped at four (and reduced on small hosts); explicit environment overrides for Vitest/Cargo/Rust remain available. Cargo commands resolve the installed worktree-pinned toolchain through rustup instead of accidentally selecting a Homebrew compiler.

JSON reports separate `worktreeQueueWaitMs` from runner execution and expose total `elapsedMs`. Suite results include dependency `preparationDurationMs`, `resourceQueueWaitMs`, and `executionDurationMs`. Resource timing measures the runner's outer heavy-job lease; native scripts' internal build/desktop waits remain part of their suite execution time. Cache inspection has its own timing. Queue timings contain no command arguments or environment values.

Use `node tools/run-coordinated.mjs -- command arguments...` for other test/build commands that write this checkout's artifacts. A separate build command needs both the worktree lease and the shared build lease: `node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- command arguments...`. Direct `npm ci`, `cargo`, and test-framework invocations do not automatically join the queue. Avoid short outer timeouts for broad verification; use the runner's suite timeout or interrupt the caller and allow teardown to complete.

## Release compatibility verification

Changes to published storage formats or public plugin interfaces require verification against supported published versions under [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) and [REQ-0070](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md). Include the first public release while it is supported. Pre-release exceptions apply only to formats verified never to have shipped publicly; establish release provenance before excluding an older format.

- Inventory the affected persisted records, readers and writers, including unopened conversations, drafts, queues, references, history, layout, plugin state and device-local settings or provider connections. Identify the published versions covered by the change and any required conversion.
- Use synthetic fixtures created by a supported released version, or verified against its actual serializer. Record the source app version and fixture format. Keep fixtures free of personal workspaces, real credentials and provider tokens; do not rewrite old fixtures through the current writer before testing the upgrade.
- Open the old-format fixture with the new app, exercise the affected behavior, close and reopen it. Verify retained content, metadata, history, references, conversations and plugin state. Test direct upgrades that skip intermediate releases within the compatibility window.
- For shared workspace formats, test supported older/newer reading and writing, including preservation of unknown fields and newer information. A one-way migration that makes an older supported app unable to use compatible workspace data fails this policy even if the new app opens it successfully.
- Where migration is needed, inject write failure and process interruption at durable boundaries. Verify recoverable retained data, accurate errors and safe repeated opening without duplicate conversion, lost later edits or replay of completed or uncertain effects. Unknown, corrupt or unsupported records must not be overwritten with empty state.
- For public plugin interfaces, run unchanged plugins using the supported SDK and shared-component contracts. A newer plugin's minimum app version must not disable other compatible workspace functionality.
- Add focused storage tests and native upgrade/restart journeys on the affected active platforms. Browser checks do not qualify native storage, Keychain access or signed-installation upgrades. Use isolated application identities and synthetic provider records, never production user data.

Fresh-workspace tests remain necessary but do not establish upgrade safety. These are verification requirements, not a claim that the current runner already covers every published format. Report missing release fixtures, unavailable old binaries, untested migration boundaries and unavailable native qualification explicitly; do not present them as passed checks.

### Workspace migration checks

`client-migrations` runs `cargo test -p situate-migrations --locked` independently of the native host. It is included in unit, feedback and MVP verification, including shared Linux CI. Package sources and fixtures select it; application-only changes do not. Its filesystem and recovery tests always execute rather than reuse successful-suite results; Cargo build caching remains available. For a focused run:

```sh
node tools/run-coordinated.mjs -- cargo test --manifest-path client/Cargo.toml -p situate-migrations --locked
```

Direct macOS distribution validation through `node tools/release.mjs validate --distribution direct` and the Apple release builder reads immutable publication history over verified SSH. The committed publication checkpoint pins a release tuple and its stored-manifest digest. Its hash-bound qualification projection covers only exact predecessor tuples still present on the server. The checkpoint source and all uncovered publications require local Git ancestry, byte-identical migration implementations and unchanged registry/module prefixes. Qualification retains the complete history for publication race checks. Missing proof, changed records, unavailable required Git objects or SSH failures fail closed; the check never fetches Git objects or uses an offline cache. An empty server history can bootstrap only when no checkpoint is committed.

For iOS and external distribution, supply `SITUATE_MIGRATIONS_PUBLISHED_REVISION` as the full immutable source commit of the latest published release, selected from trusted publication evidence outside the candidate change. This source must exist locally and be ancestral to the candidate. These inputs are separate from release-note baselines and do not override direct macOS history. See [release preparation](release-preparation.md#published-migration-checkpoint) for checkpoint and qualification details.

For an explicit offline comparison of committed sources:

```sh
node tools/migration-history.mjs --published-revision FULL_PUBLISHED_COMMIT --revision HEAD
```

The check requires local commit objects and ancestry, byte-identical released implementation files, and unchanged typed registry and module-declaration prefixes. Appending entries is allowed; unsupported declaration syntax fails. Migration-bearing distribution builds fail without the baseline. Legacy/no-migration builds remain valid without it; after publishing migrations, always supply it, including when qualifying a candidate that removes all migrations. No release record or artifact schema changes are required.

History verification does not establish unchanged shared-helper behavior or replace released-format fixtures, minimum compatibility periods, mixed-version checks, or native macOS/iOS qualification.

## Categories

| Category      | Included in `--unit` | Boundary                                                                                                                                                                                                         |
| ------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`        | Yes                  | Runner selection/orchestration, mocked release/Xcode commands, Vue with mocked IPC, independent Rust core, requirements catalog, deterministic design/asset contracts, mocked Pi lifecycle                       |
| `integration` | No                   | Real Vite HTTP/WebSocket servers and UI import-boundary builds, process cancellation, Rust host compilation/tests, Docker context filtering, Pi session lifecycle, automatic test feedback, and local MCP server |
| `browser`     | No                   | Independent product and workshop Chromium/WebKit suites, requirements viewer, brand/reference/motion tests                                                                                                       |
| `native`      | No                   | Frontend build, host desktop shell rendering, and WebView → Tauri → Rust → filesystem smoke test                                                                                                                 |
| `check`       | No                   | Root ESLint/Prettier, Kotlin lint, Swift checks on macOS, dependency/security checks, Vue typechecking, Rust formatting/Clippy, requirements production build                                                    |

“Unit” includes fast local contract checks and temporary-file fixtures, but excludes browser launches, listening servers, Docker, and native application builds. Cold compilation of the Rust core or first-time JavaScript transpilation can still take longer than a warm run.

`client-executor-integration` runs `src/plugins/executor-boundary.test.ts` with a separate Node-based Vitest configuration, real Chromium, Vite bundling and a development server. It is included in the default MVP scope, not `--unit`, `--feedback` or Vue coverage. Run it separately with `cd client && npm run test:executor`; this command acquires the worktree and shared build-resource leases. Install the client's Playwright Chromium browser first as described under [Prerequisites](#prerequisites). Missing Chromium fails the suite; the command neither skips the tests nor installs a browser. Chromium checks do not qualify the native macOS/iOS executor boundary.

Mobile smoke instructions and release/installer compatibility checks remain in the [client guide](../../client/README.md). The runner executes the selected host test commands, with optional [macOS VM execution](#native-tests-in-a-macos-vm) for native journeys. It does not build a multi-platform release matrix, operate mobile devices, or replace manual installer testing. Existing test-level platform/history conditions remain visible in framework output; the runner itself does not skip selected suites based on tool availability.

On Apple Silicon, `client-dictation-swift` runs the Swift model-integrity and resumable-download tests. The optional recognition test reads `SITUATE_DICTATION_FIXTURE`: a directory containing `model/` with the pinned files from `client/app/src-tauri/dictation/Sources/SituateDictation/ModelManifest.swift`, plus purpose-made `english.aiff` and `german.aiff` speech containing “notebook” and “Notizbuch”, respectively. Run it with `SITUATE_DICTATION_FIXTURE=/path/to/fixtures swift test --package-path client/app/src-tauri/dictation --filter recognizesGermanAndEnglishWithoutLanguageHints`. Without that input, the recognition test is explicitly skipped. Synthetic speech verifies model integration, not microphone permissions or recognition quality on real speakers.

On macOS, `client-workspace-access-swift` compiles and runs the native workspace directory and content helper tests with Apple Swift. It is an integration suite, not part of `--unit`. It exercises temporary filesystem data and Foundation coordination; simulated security-scope grants do not prove actual picker access. Android instrumentation and mobile provider lifecycle checks remain separate device tests.

## Projects and dependencies

The selection groups are `runner`, `client`, `requirements`, `design`, `pi`, and `dev-tui`.

- Client app, independent workshop, product UI library, core, native hosts, scripts, and Docker inputs select the client group. Product and workshop Vue/browser/typecheck suites run separately; the workshop's standalone Cargo crate has its own host tests and formatting/Clippy checks.
- Brand changes also select the client, which consumes brand assets and tokens. Changes to `design/brand/tokens.json` additionally select the development terminal.
- Client npm manifests, lockfile, and Node pin also select design tests, which use the client's Playwright installation.
- Requirements data and documentation changes select design validation as well, because brand documentation links to those files.
- Pi roles, skills, and extension changes select Pi tests.
- Changes under `tools/dev-tui/` select only `dev-tui`. On macOS by default, and on Linux with `--extended`, its independent Cargo workspace runs `cargo test --locked`, `cargo fmt --all -- --check`, and `cargo clippy --all-targets --locked -- -D warnings`. Formatting is included in feedback checks; Clippy is included in checks and full runs. The crate's tests include isolated pseudo-terminal sessions for keyboard controls, process shutdown, and terminal restoration.
- Other runner changes and unrecognized paths conservatively select all projects.

Changed selections use per-suite input rules, not individual test-case granularity: app and workshop source/test changes select their own frontend checks and journeys within the chosen profile, plus shared client-script contracts. Shared UI changes select both frontends; localization changes also select Rust core tests because Rust embeds native catalogs. Ordinary documentation does not select code checks solely because it sits in a code project's directory. Formatting checks target changed existing files unless formatting configuration changes require a full scan. Deletions and both sides of renames still participate in suite selection. Plans include the changed inputs responsible for each selected suite. Selection is intersected with the active scope and profile. `--extended` restores deferred registered suites without bypassing inventory validation.

The registry also checks the Git-visible JavaScript/TypeScript test-file inventory. An unclassified conventional `.test.*` or `.spec.*` file is an error, including under `--unit`; register its category and command rather than letting it disappear from coverage. Framework include/exclude rules still control discovery inside their registered commands and must stay consistent with the registry. Rust tests are collected by the registered Cargo package/workspace commands.

## Prerequisites

- Install and configure Volta first; `node` and `npm` must resolve through its shims. Install root dependencies with `node tools/npm-ci.mjs`. They include the pinned Pi test runtime and JavaScript quality tools.
- Install the native quality tools pinned in `tools/toolchain.quality.json`. `node tools/quality.mjs` reports its available check commands; each check rejects missing or mismatched tools. The offline Cargo-deny policy check covers licenses, bans and sources. Run `node tools/quality.mjs rust-audit` separately for current Rust advisories and `node tools/quality.mjs audit` for npm vulnerabilities; both need network access. The target graph in `client/deny.toml` checks macOS and iOS dependencies regardless of the CI host. Shared vulnerabilities are not suppressed. Before resuming Windows, Linux desktop or Android support, restore the relevant audit targets and review their findings; `--extended` does not widen the dependency policy.
- Selected npm-dependent suites automatically run `npm ci --include=dev --no-audit --no-fund` in the repository root (lint/format checks), `client/`, or `requirements/` when npm's installation receipt or required tool entry points are missing. This uses the existing lockfile and honors npm's lifecycle-script policy. Prepared installations are reused; after changing manifests or lockfiles, run `node tools/npm-ci.mjs`, `node tools/npm-ci.mjs client`, or `node tools/npm-ci.mjs requirements` from the repository root to synchronize versions. These commands wait for checks in the same worktree before reinstalling. Shared or dangling `node_modules` symlinks are rejected before installation.
- Install the client's Playwright Chromium and WebKit browsers with `npx playwright install chromium webkit` from `client/`; install Chromium from `requirements/` too if its Playwright version differs.
- The development terminal requires its independently pinned Rust **1.98.1** toolchain with rustfmt and Clippy on macOS or Linux. Its suites run from `tools/dev-tui/` so rustup uses that crate's pin; they are not registered on Windows.
- Install the pinned Rust toolchain and [Apple host prerequisites](../../client/README.md#prerequisites). Kotlin and native Linux prerequisites are needed only for deferred checks. `node tools/bootstrap.mjs` checks MVP prerequisites; add `--extended` when opting into the comprehensive inventory. Explicit Linux native tests require `dbus-run-session` and `xvfb-run`.
- Start a Linux Docker engine with Buildx for Docker context validation. This test uses synthetic inputs, not a full release image or Microsoft SDK download.
- Pi tests default to `node_modules/@earendil-works/pi-coding-agent` at the repository root. Automatic Pi checks pass the running Pi package directory to the runner. For manual runs, use `--pi-package-root <directory>` or `PI_PACKAGE_ROOT` for an explicit override; the command-line option takes precedence. Global npm installations are never resolved implicitly.
- Install Python 3 and Bash for the workflow contract tests. These tests use fake device commands; they do not connect to mobile devices.
- Browser test servers bind OS-assigned ports on `127.0.0.1` and keep their listeners open through teardown. Playwright receives each endpoint from its own server's startup output; HTTP and Vite WebSocket traffic use that same listener. Existing development servers are neither reused nor stopped. `SITUATE_TEST_PORT` and `SITUATE_WORKSHOP_TEST_PORT` are no longer used; interactive development ports are unchanged.

Native smoke, agent-journey, and native screenshot GUI phases use a separate per-user desktop queue across worktrees. Compilation stays outside that queue, and each smoke run retains its isolated app data. Local execution requires an unlocked host desktop; queuing cannot isolate unrelated interactive applications. Optional VM execution moves native smoke and fixture agent journeys to the guest desktop while retaining local builds and compiler caches.

Cargo build output remains worktree-local, but Cargo normally shares its download cache. To avoid package-cache contention, set `SITUATE_ISOLATE_CARGO=1` when running the test runner. It uses `client/target/cargo-home` in that checkout and does not copy global credentials or configuration. An explicitly supplied `CARGO_HOME`, including an empty value, takes precedence. The isolated cache consumes additional disk space and does not automatically install missing Rust toolchains. Warm the selected cache deliberately with `SITUATE_ISOLATE_CARGO=1 node tools/cargo-cache.mjs warm`; this runs `cargo fetch --locked` for the client and development terminal and may download dependencies.

### Local compiler cache

When a stable `sccache` release version 0.19.0 or newer is installed on `PATH`, the test runner, desktop/workshop development (including through `./dev.sh`), native smoke tests, agent journeys, and `npm run ios:xcode` use it automatically. Set `SITUATE_SCCACHE=0` to disable this integration. If the executable is unavailable, its version cannot be determined, or it lacks client-side support, builds work without an added compiler wrapper. The scripts do not install sccache. Ordinary builds retain explicitly supplied Rust wrappers, including empty values; isolated agent builds never inherit personal wrappers.

The shared local cache defaults to `~/Library/Caches/situate/sccache` on macOS, with a `50G` limit. Set `SCCACHE_DIR` to an absolute path or `SCCACHE_CACHE_SIZE` to another positive size such as `75G` before starting the server. These scripts reserve local server port `4227` and ignore personal sccache configuration and remote-storage settings. Use one server for all worktrees. `SCCACHE_CLIENT_SIDE=1` keeps compilation and its temporary files in each build client; the daemon shares cache storage and statistics. Isolated test builds keep their own `TMPDIR`, home, and Cargo configuration; per-run cleanup never stops the shared daemon. Use matching sccache releases for clients and the daemon. Storage settings belong to the running server: before upgrading an older daemon or changing those settings, finish active builds and stop that server with `SCCACHE_SERVER_PORT=4227 sccache --stop-server`. After an enabled build has started the server, inspect its counters with `SCCACHE_SERVER_PORT=4227 sccache --show-stats`. The integration requests sccache's local fallback behavior, but daemon startup or client-side handshake failures can still fail a build.

Targets remain worktree-local. The compiler cache does not remove their artifacts, and its size limit does not bound total build storage. Incremental compilation remains unchanged; incrementally compiled crates and invocations of the system linker are not cacheable. Different worktree paths can reduce Rust cache hits. See [sccache Rust limitations](https://github.com/mozilla/sccache/blob/v0.19.0/docs/Rust.md). Runner coverage suites and release builders do not enable this integration; direct Cargo/Tauri commands also require their own explicit wrapper setup.

Native smoke debug builds default to `CARGO_PROFILE_DEV_DEBUG=line-tables-only`, retaining filename/line backtraces but not local-variable or type information. Set `CARGO_PROFILE_DEV_DEBUG=full` for a smoke build that needs full debugger information. This default does not change ordinary development, Rust unit-test, coverage, or release profiles. Agent journeys retain their fixed line-table setting and disabled incremental compilation.

The app, workshop, and requirements Playwright commands use the same isolated server lifecycle whether launched directly or through the root runner. Requirements fixtures are copied into a private temporary directory and removed on orderly shutdown. Forced termination can leave temporary files, but the OS releases the process's listeners. Workshop screenshot captures also use an OS-assigned port. Design browser checks load local files or inline content rather than starting HTTP servers; Rust and Pi HTTP fixtures already use retained ephemeral loopback listeners.

`cd client && npm run test:native -- --diagnostics` runs the focused native diagnostics journey: create an isolated workspace, navigate to a file through the product UI, verify frontend/native causal records from the current launch in local JSON Lines and reject synthetic content leakage. It does not replace the default native layout, recovery and restart suite. On mobile, create an empty `smoke-diagnostics` file in the smoke application's `app_data_dir()` before launching with fresh test data. Remove the marker and reset the disposable test data before running the default journey; never use the production application container.

For diagnostic resource measurements, run `cd client && npm run test:native -- --diagnostics-profile healthy`, replacing `healthy` with `disabled`, `slow` or `blocked` for comparison. Add `--release` to measure optimized builds; the default remains debug. These isolated builds keep the same file journey, sample ten seconds of idle time and issue 1,000 sequential native file snapshots while observing animation-frame intervals. The smoke coordinator polls readiness once per second during profiling. The disabled baseline has no collector but retains instrumentation call sites; the slow destination adds 10 ms before each file write, and the blocked destination never returns. These controls are compiled only into the separate smoke application, not the product.

`SITUATE_DIAGNOSTICS_MEASUREMENT` lines contain diagnostic batch calls, observed collector initialization/writer entry and host-process CPU/peak RSS where supported. Slow and blocked runs fail unless their writer was entered. Compare phase deltas for CPU and batch traffic; peak RSS is a process-lifetime high-water mark, not an allocation delta. Only the final burst report contains `totals`: persisted record/byte counts and persisted loss summaries. Earlier reports use `null`, so no log parsing occurs between resource samples. The burst's `file_timings` separates diagnostic admission/completion, workspace authorization, blocking-pool queue time and native dispatch execution (including content-session locks). Each stage retains at most 2,048 observations and reports overflow and contention losses. These are unpaired distributions of stages completed during the burst, including background file calls from the app; do not subtract their percentiles to estimate IPC time. Resource observations still include the smoke harness and IPC coordination; they do not isolate the cost of logging alone. Separate WebView processes are not included. Pending records and unpersisted losses are not counted. UI timings include IPC and storage, not just the diagnostic producer. A phase whose `visible` field is false is recorded but fails the profiling run, even if the window became visible again before the phase ended. Run modes repeatedly in alternating order without concurrent builds or UI automation. This short storage workload is not an agent-heavy session, background/suspension test, long-term retention measurement or automatic performance pass threshold.

### Native tests in a macOS VM

Native smoke and fixture agent journeys can build on the host and execute in a dedicated [Tart](https://tart.run/) macOS guest. The guest needs its own unlocked, logged-in desktop. Tart can display that desktop in a host window so tests can be observed; the application windows and their focus remain inside the guest. Browser, Rust unit, and Swift tests remain on the host; this mode does not qualify iOS devices or simulators.

Install Tart on Apple Silicon and choose a macOS image compatible with the host and the locally built application. Review the macOS, Xcode, image, and Tart license terms before use. A prepared Xcode image avoids depending on a host Xcode share. Pin the image digest rather than relying on a changing `latest` tag.

With a local VM named `situate-tests`, configure its resources while stopped:

```sh
tart set situate-tests --cpu 4 --memory 16384 --display 1440x1000 --no-display-refit
```

Run the VM in a separate terminal with a visible guest desktop, without audio, clipboard sharing, USB accessories, or shared directories:

```sh
tart run --no-audio --no-clipboard --no-usb-accessories situate-tests
```

Keep this VM window open across test runs, or minimize it when not observing tests. Tests connect through SSH and do not reopen the window. Avoid typing or clicking inside the guest during a journey. The fixed guest resolution and disabled display refitting keep host window resizing from changing test layouts. Add `--no-graphics` to the command when no host window is wanted.

The guest must have Homebrew, the Tart Guest Agent, an automatically logged-in test account, and Remote Login enabled. Use a disposable account with synthetic data, not a personal Apple account. From the repository root, configure access and the guest runtime:

```sh
node tools/native-vm-setup.mjs
# For another existing, running guest:
node tools/native-vm-setup.mjs --vm test-macos
```

Setup installs Volta and the repository-pinned Node.js/npm in the guest, disables guest display sleep, and checks the unlocked guest desktop. It creates a dedicated host SSH key and pins the guest's Ed25519 host key obtained directly through the Tart Guest Agent. It does not copy personal SSH keys or forward an SSH agent. A changed host key or a different existing configuration requires review rather than silent replacement.

Setup writes `~/.config/situate/native-test-vm.json`, shared by this account's worktrees. With that file present, the ordinary commands select VM execution automatically:

```sh
cd client
npm run test:native
npm run test:agent
npm run test:agent -- --journey onboarding
```

`SITUATE_NATIVE_VM_CONFIG` selects another configuration file. Set `SITUATE_NATIVE_EXECUTOR=vm` to require configured VM execution, or `SITUATE_NATIVE_EXECUTOR=local` to explicitly use the local desktop. Without a configuration, existing local execution remains available. A configured but unavailable VM fails the test; it never falls back to launching a host window. Paid agent-provider runs are not supported in VM mode and fail before credentials are read. The separate public-repository live qualification command also requires explicit local execution; it does not bypass VM selection to open a host window.

VM builds share the owned, worktree-local `client/target/agent-e2e-build/` build directory and use the [shared compiler cache](#local-compiler-cache). Native smoke retains its debug-profile and incremental-compilation overrides; agent journeys retain disabled incremental compilation and line-table debug information. The host transfers an immutable package containing the built executable, required test scripts, and synthetic fixtures. It does not transfer the checkout, installed dependencies, `.env`, credentials, or compiler caches. Checksums and file modes bind execution to the transferred package. The fixture provider, isolated application data and test keychain, restart checks, and cleanup run inside the guest.

Each guest executes one complete journey at a time across all worktrees, including restart and cleanup phases. Other worktrees can build locally while waiting. Host desktop checks are not required for VM builds; desktop checks occur in the guest before native launches. Cancellation and connection loss stop owned guest work through a lifetime supervisor. Failed or uncertain executions retain their run directory under the guest account's `.situate-test-runs` directory. Confirm that owned processes and test credentials have been cleaned up before removing retained runs; do not delete active queue locks or ownership evidence to unblock another test.

Re-run setup after changing the repository's Node/npm pins. Stop an idle guest with `tart stop situate-tests`. VM execution remains macOS host integration evidence, not a release, signing, or hardware qualification.

### Local process connection qualification

The default macOS native suite includes an offline process-backed connection and consumer. Run `node client/scripts/test-native-process.mjs` from the repository root to execute only that additional phase. It checks exact synthetic process fixtures without starting programs, then exercises direct execution without a command confirmation and cancellation through the production WebView and Rust host. The command writes only to the owned disposable workspace and returns fixed data. A second owned process verifies that cancelling workspace closure preserves running work, quit is blocked before file preparation, and explicit abort stops the worker and retains observed history before the workspace closes. No personal files, service accounts, network traffic or Notes automation are used.

### Public repository connection qualification

From the repository root, run `node client/scripts/test-native-live.mjs --live` with Volta shims first on `PATH`. This opt-in macOS journey reads public metadata from `api.github.com` without authentication. It creates a connection, two independently selected consumers, a workspace-file connection and an ordinary workspace edit in an owned disposable workspace. Synthetic checks cover denied/missing access, failed consumers and shared-interface changes before the active plugins make real GET requests. It also checks that removing temporary development data preserves the conversation, live stores and active revisions.

`--connection-only` runs just that additional journey; it does not replace `cd client && npm run test:native`. Without it, the controller also runs the standard native suite, including the offline process phase and reports either failure. Public network unavailability is a failure, not a fixture fallback. This command uses no personal account credentials, private repositories or external writes. Default plugin checks stay synthetic; neither this public-read example nor fixture account tests qualify authenticated account setup or Apple Notes automation.

Native smoke builds and loads bundled assets, not a Vite listener. Each invocation owns an isolated temporary application-data directory, and cleanup verifies its ownership. Native runs can still contend for desktop UI state and external tool resources such as Cargo's download cache; serialize native smoke instances. The iOS frontend integration tests already retain dynamic HTTP/WebSocket listeners; device/simulator runs are separate from browser verification.

Design browser tests use the client's installed Playwright module. Headless Linux runs default to its bundled Chromium headless shell; other runs use bundled full Chromium. The shell avoids full Chrome's Crashpad workers retaining browser pipes in isolated Linux runs. Explicit browser channel and executable overrides are preserved; the runner fixes only the Playwright module location. No Pi/model credentials or external MCP service are needed by the Pi tests: integration uses isolated temporary sessions, a local model stub, and a loopback MCP fixture.

Run `node tools/bootstrap.mjs` for a read-only host prerequisite check (`--coverage` also checks coverage dependencies). It reports missing executables, dependencies, browser binaries, and Docker connectivity; it does not prove runtime permissions or device access.

Dependency setup runs only for selected suites, never for `--list`, `--help`, or an empty selection. Installation output goes to stderr, including in JSON mode. A failed installation fails dependent suites without retrying within that run; unrelated suites still run. Setup has the same timeout and cancellation handling as test subprocesses.

Concurrent runners use an atomic lock directory in the system temporary directory, keyed by the canonical workspace path. Serial runs hold the lock through each dependent suite. Parallel runs acquire workspace locks in a fixed order before execution and retain them until all suites finish, so another runner cannot replace dependencies while any reader is active. Waiting is bounded by `--timeout` and can be cancelled. A forcibly killed runner may leave a lock behind; the timeout diagnostic gives its path. Remove it only after confirming the owning runner and installer have stopped. Manual npm commands do not participate in this lock: do not run them alongside tests in the same worktree.

The runner does not install host browsers or accept SDK licenses. Visual tests install their pinned browser inside the locked container as described below. Cargo and rustup retain their usual dependency/toolchain download behavior; offline execution requires a preinstalled toolchain and cached dependencies. `CARGO_NET_OFFLINE=true` prevents Cargo dependency downloads. The runner never commits or pushes this checkout or publishes release artifacts.

## Visual regression tests

Visual checkpoints reuse product browser tests in `client/app/tests/browser/` and compare the real Vue frontend against committed PNG baselines in `client/app/tests/visual/baselines/`. Tests tagged `@visual-desktop` or `@visual-mobile` run in the corresponding visual project. They retain their functional assertions and capture named intermediate states through the shared `visual` fixture. Ordinary Chromium/WebKit browser runs execute the same flows without screenshot comparisons.

The tagged flows cover workspace selection, creation and switching, the mobile navigation drawer, German settings, file reading and source editing, file menus, save conflicts and unsaved-change recovery, AI setup and provider search, chat model selection and saving errors, running responses, and long conversations. Tests select their own viewport sizes and mobile app behavior; there is no additional cross-product of every test and every device size. Synthetic IPC fixtures replace native storage and services, including Markdown rendering. These tests do not exercise Rust integration, real AI requests, or native WebViews. The independent design workshop is not part of this suite.

```sh
cd client
npm run test:visual
npm run test:visual -- --project mobile --grep 'provider selection'
npm run test:visual:report

# Regenerate every checkpoint after an intentional change:
npm run test:visual:update
npm run test:visual

# Or update only matching tests in one profile:
npm run test:visual:update -- --project mobile --grep 'provider selection'
```

Checks never create or update baselines. Missing references, pixel differences, empty selections, and passing tagged tests that never reach a checkpoint fail. `--grep` matches Playwright test titles, file names, and tags, not checkpoint names; it intersects the profile tag rather than selecting untagged tests. Updating without filters runs every tagged test and updates every checkpoint it reaches. Filtered updates change only the selected tests' checkpoints. Update mode is rejected in CI.

Review changed PNGs before committing them with the corresponding code change; do not use updates to hide unexplained failures. A failed update can leave modified images, so a successful full comparison is required afterward. The HTML report contains expected, actual, and difference images for mismatches and a checkpoint attachment for each test. Updating a baseline makes it the new reference, so also review baseline changes in the PR's image diff.

Both checking and updating use the Linux/amd64 image from `tools/ci-image.lock.json`, including on Apple Silicon. A running Docker engine and a non-root host user are required. The public GHCR image supports anonymous pulls; contributors do not need a GitHub account or registry token. An `unauthorized` response requires checking the pinned package's visibility and digest, not supplying credentials to untrusted code. No alternative image or host screenshot fallback is used. The wrapper validates the image lock and browser pins before launching.

The Docker command supports linked Git worktrees without mounting their external Git metadata. It installs Linux dependencies in a disposable container mount rather than replacing host `client/node_modules`. Downloads use a dedicated temporary cache by default; set `CI_CACHE_DIR` to an absolute, dedicated directory outside the checkout to retain them elsewhere. Do not run captures concurrently in the same checkout, because report directories are shared.

Rendering uses Chromium, real translations (English by default, German in the settings scenarios), UTC, a fixed starting date and time, light appearance, reduced motion, and device scale factor 1. Fonts are the system fonts supplied by the locked image; no font overrides or downloaded brand fonts are used. Assertions wait for the relevant UI and font readiness before capturing the viewport. The comparison permits no differing pixels beyond a default per-pixel color threshold of 0.01. This tolerates small color-rounding differences at antialiased borders, not a percentage of changed screen area. An individual capture can pass `{ threshold: 0.02 }` for verified SVG color-rounding differences. Keep overrides at affected checkpoints; they change color sensitivity, not the zero differing-pixel limit. Browser or image upgrades require reviewing new references; Linux screenshots do not establish macOS, Windows, or mobile-device font and WebView behavior.

The registry includes this as the `client-visual` browser suite. The default MVP scope excludes it; use `node tools/test.mjs --extended` or the dedicated visual command. `--unit` and `--quick` also exclude it. The separate `client-visual-fixture` browser suite verifies fixture failure modes with blank temporary pages and disposable references; it never writes product baselines. In the locked CI browser job, product comparisons run directly without nested Docker. The MVP Quality workflow does not run screenshot comparisons or upload visual artifacts. Dedicated visual runs retain their local comparisons under `client/test-results/`. To open a copied report from `client/`:

```sh
npx playwright show-report /path/to/visual-report
```

### Add checkpoints to an existing test

Import the shared `test` from `./test`, use `test.use({ localizationMode: "real" })`, and tag the test with the intended visual profile. Request the `visual` fixture alongside `page`. Assert the relevant heading, dialog, form value, error, or focus state before capturing it:

```ts
await expect(menu).toBeVisible();
await visual.capture("files.document.actions");
await page.keyboard.press("Escape");
await expect(trigger).toBeFocused();
await visual.capture("files.document.actions-closed");
```

The existing `files-layout.spec.ts` and `workspaces-layout.spec.ts` show complete examples. The fixture waits for fonts, applies the visual run's clock and network isolation, and delegates stable screenshot capture to Playwright. It requires real translations. Do not silently switch key-based localization tests to real text; add checkpoints to real-language flows or explicitly adapt their assertions.

A reference key consists of the semantic state name, actual viewport dimensions, locale, and project profile, not the test title. Use distinct names for different synthetic content or focus states, even when they share a screen. Multiple tests can compare against the same reference, but an update rejects a second writer for the same reference rather than accepting whichever test runs last. Keep a single capture owner per state/viewport for full updates; remove redundant capture calls, not the functional tests. No image-similarity deduplication is performed.

When removing or renaming a checkpoint, review and delete its obsolete PNGs explicitly. Checkpoint attachments describe the states captured by that run; they do not prove that every product state has a test. Keep behavior and accessibility assertions alongside the captures; screenshot approval is not a substitute for those checks.

## Native agent journeys

On macOS, the default MVP registry includes `client-agent-e2e` for ordinary chat/files, `client-onboarding-e2e` for guided setup, and `client-plugins-e2e` for checked plugin activation and request-local tools: built production Vue assets in the native WebView, Tauri commands, encrypted test credentials and persisted conversations across two launches. They use the existing agent runner. Their default provider is a deterministic loopback Responses fixture; they never call a paid API. Linux and Windows do not register these macOS-Keychain-dependent suites. Direct invocation there reports `blocked` with a nonzero exit code; the Linux full-suite gate does not claim this coverage. The macOS Quality job runs these fixture journeys separately. The plugin journey also performs one tool-initiated POST and one manual-export DELETE against an owned loopback fixture, without action-confirmation dialogs. It checks that neither is repeated after reopening.

Both `test:native` and `test:agent` require an unlocked macOS desktop throughout execution. In [VM mode](#native-tests-in-a-macos-vm), this is the guest desktop, not the host desktop. For local execution, keep the native test windows in the foreground; concurrent user interaction or UI automation can dismiss menus and suspend WebView rendering. A locked desktop cannot give the WebView focus and can suspend its JavaScript timers. The runners check before building and before each native launch; a locked or unreadable desktop state fails with `desktop-session-locked` or `desktop-session-unavailable`, not a passing skip. Unlock the desktop and rerun. These checks do not qualify behavior while the operating system is locked.

```sh
node tools/npm-ci.mjs client
cd client
npm run test:agent
npm run test:agent -- --journey onboarding
npm run test:agent -- --journey plugins --provider fixture --max-requests 7
# Explicit paid invocations; supply the dedicated TEST_OPENAI_API_KEY.
npm run test:agent:live
npm run test:agent:live -- --journey onboarding
```

The fixture journeys use fresh synthetic workspaces and Git-anchored Markdown references. Ordinary agent writes preserve exact source bytes; prepared new-file writes and `create_batch` allocate task IDs natively from `situate-task-id: null` intent. Imported Markdown is compared with the original source bytes, including existing metadata. Task conversion retains field meanings and assigns fresh task identities. Saved destination paths and revisions are checked against acknowledged publication results. Partial or uncertain batches must not be replayed as a whole.

`--journey workspace` is the default. `--journey onboarding` checks source conversion, task meanings, source preservation, instruction review and saved drafts across restart. After setup completes through its normal flow, the journey opens a new ordinary conversation and imports the same named synthetic sources into new destinations. It verifies fresh task IDs, unchanged earlier copies and originals, and unchanged working instructions. Saved-reference registration does not advance setup or claim complete import scope; a registration failure preserves the acknowledged write without replay. These fixtures do not qualify arbitrary source technologies, reconciliation of changed sources, or native iOS behavior.

`--journey plugins` uses a real Worker check and its native check ID to activate a new service version. It verifies the old response-batch identity, new tools in the next main request, unchanged admitted model settings and exactly four development requests. A separate ordinary conversation lists and reads a synthetic document source in three further requests, retaining source-qualified references, partial-list status and text provenance in model-visible tool content and the transcript. Neither conversation redispatches after reopening; no auxiliary requests are made. It accepts only the fixture provider.

Selecting `--provider openai` (supplied by `npm run test:agent:live`) explicitly permits paid API calls and requires a nonempty `TEST_OPENAI_API_KEY`. When that environment property is absent, live runs outside CI may read it from the current worktree's repository-root `.env`. An existing environment value, including an empty value, takes precedence and never falls back to the file. `CI=true`, fixture runs, help, and unsupported hosts never read the file. Only `TEST_OPENAI_API_KEY` is consumed: other entries are not injected into the environment, and dotenv content is parsed by Node rather than sourced or evaluated. Ordinary `OPENAI_API_KEY` and personal Pi credentials are not accepted. Missing test credentials, unsafe files, unsupported hosts, missing dependencies, unavailable Keychain access, or failed cleanup produce a nonzero blocked result. Install the pinned Rust toolchain and macOS native build prerequisites first. No paid calls are made by the normal runner, fast feedback, or fixture tests.

The optional `.env` is ignored by Git and belongs to each worktree. It must be an ordinary, non-symlink, single-link file no larger than 64 KiB; on POSIX it must belong to the current user and have mode `0600` (`chmod 600 .env`). Keep it private and never include its contents in logs or artifacts. To opt into copying the main checkout's `.env` into new worktrees, run `node tools/install-worktree-env-hook.mjs`. The installer uses the shared Git hooks directory without overriding `core.hooksPath` or replacing an existing hook; copying occurs only when the destination is absent, with mode `0600`. Hook installation is optional, not a prerequisite for tests or CI. It duplicates plaintext credentials across worktrees; environment-only secret injection remains supported.

The model is fixed to the catalog's API-key-capable `gpt-4.1-mini`, with thinking disabled. Live limits apply across both application launches: 24 requests, 1,024 output tokens per response, 24,576 reserved output tokens, a conservative cumulative 262,144 input-token reservation bound (UTF-8 request bytes plus image reservations), and 180 seconds after build. Each request is bounded to 60 seconds. A multi-request live assistant turn may wait up to 120 seconds within the unchanged shared deadline; fixture turns retain their 45-second bound. The no-cost fixture permits 64 requests, 65,536 reserved output tokens, 32 MiB per-request input/body/response limits, 256 MiB cumulative input reservations, and 300 seconds for long-input scenarios. `--max-requests`, `--max-input-tokens`, `--max-total-input-tokens`, `--max-output-tokens`, `--max-total-output-tokens`, and `--timeout` can lower these caps, not raise them. `--build-timeout` defaults to 900 seconds and permits up to 1,800. There are no automatic retries or shell-execution opt-ins.

Every run owns a private temporary home, workspace, app identifier, and credential namespace. Builds reuse the ownership-marked `client/target/agent-e2e-build/` cache under an exclusive lock held through both launches; Cargo configuration and credential files are not inherited. A stale `client/target/agent-e2e-build.lock/` blocks the run rather than being reclaimed. Remove it only after confirming the owning runner and native app have stopped. Build and app child environments exclude inherited secrets and personal configuration; the installed Rust toolchain remains a read-only build input. The live key stays in the loopback broker. Only its synthetic per-run bearer token traverses the application's production encrypted credential storage path. The `native-smoke` E2E harness explicitly selects a private, file-based macOS OS keychain at `agent-e2e.keychain` (or `agent-e2e.keychain-db`) inside the owned temporary root. Its random password is stored in a mode-0600 sibling file, never passed through JavaScript or command-line arguments, and retained with the keychain across restart. It neither changes the login/default keychain or search list nor falls back to personal credentials. This covers the production encrypted Storage and credential KeyStore paths with an explicit test OS keychain, not the user's login-keychain ACL/authorization or storage of the actual upstream API key. The broker enforces request/output/deadline limits and remains alive across restarts. Shell execution remains disabled. Plugin checks and activation are enabled only for the fixture-only `plugins` journey; the live broker rejects those tools. Local workspace navigation, file operations and the bounded onboarding tools remain available. On exit the runner launches bounded credential cleanup and removes only its owned temporary tree. A credential-cleanup failure retains the private tree and manifest for recovery instead of discarding the account inventory. An owned supervisor keeps the process-group identity alive until descendants are terminated, including when the application exits first. Uncertain process teardown retains the temporary tree and build lock; confirm all owned processes have stopped before recovering them. Forced host termination can prevent cleanup; do not publish leftover files or logs.

Stdout contains one allowlisted JSON result: outcome (`passed`, `blocked`, `product`, `provider`, `budget`, or `cancel`), fixed model, selected journey, run ID, completed phase count, cleanup status, and safe provider counts/usage/request IDs. Known native bootstrap stages, finite snapshot step/reason codes, and signed 32-bit credential OS status codes remain readable. Unknown assertion stages are represented by a SHA-256 digest rather than raw text. Optional native observations contain only control-presence booleans, bounded conversation/message/tool/draft-character and import-task/metadata-issue counts, and enumerated run states. Cleanup failures preserve the preceding outcome and code in `beforeCleanup`. Only actual upstream transport/protocol failures classify a failed live journey as `provider`; local request-contract violations remain `product`. Host build failures may include `build.reason` (`sccache-tempdir-unavailable` or `command-failed`) and `build.exitCode` (a numeric exit status or `null`). Build stdout/stderr is scanned with bounded buffers; raw app/build output, requests, credentials, and workspace snapshots are not exported. Only synthetic fixtures are used; review any additional local diagnostics before sharing them.

The [Agent live API workflow](../../.github/workflows/agent-live.yml) is manual-only, restricted to the canonical repository's default branch and a pinned checkout of the dispatched commit. Before dispatching, configure the `agent-live` GitHub environment with required reviewers, default-branch deployment restrictions, and its dedicated `TEST_OPENAI_API_KEY` secret. Protect and review the default branch; these protections require repository administration and are not created by the workflow. There is no schedule, pull-request trigger, retry, shared cache, or raw-log upload. Only the runner step receives the environment secret; the retained artifact is its structured JSON result. A workflow definition alone does not establish approval or authorize a live run.

## Native iOS application journey

The explicit iOS journey builds and runs the actual application, not a platform library harness. It requires macOS, Xcode, XcodeBuildMCP, XcodeGen, CocoaPods, an available iOS Simulator runtime and the `aarch64-apple-ios-sim` Rust target. Use the pinned Volta toolchain and an unused simulator selected by UUID:

```sh
xcodebuildmcp simulator list --output json
node client/scripts/test-native-ios.mjs --simulator-id <simulator-uuid>
```

The controller owns its worktree, build and simulator reservations. It refuses any pre-existing smoke app/data container before installation, never erases a simulator or uninstalls an app, and marks its new container before the first launch. Simulator builds use a valid ad-hoc signature without a developer account; unsigned simulator apps cannot exercise Keychain custody correctly.

Two launches must complete four local fixture requests, native file and Worker results, CPU-loop termination, unchanged durable conversation state and verified deletion of the run's exact credential accounts. No paid provider is contacted. A failed cleanup retains the simulator reservation and inventory for recovery; do not clear them or rerun against an unknown existing container. Other simulator applications and credentials are outside the journey's authority.

A passing run qualifies that debug application/runtime only. Physical-device background expiration, surviving-process suspension, locked/protected storage, minimum supported OS versions and production signing/distribution still require separate evidence. Browser and macOS VM passes cannot supply it.

## Frontend bundles

Production frontend builds report initial and lazy JavaScript sizes using [`bundle-report.mjs`](../../client/scripts/bundle-report.mjs). Initial JavaScript above 1,000,000 uncompressed bytes fails the build as a coarse code-growth safeguard; above 140,000 gzip bytes it produces a warning without failing. The initial graph includes shared static dependencies but excludes dynamic imports, even if they are triggered during startup. Missing or invalid build output still fails the check. These sizes do not measure native startup or first-use latency.

## Coverage

On macOS, `node tools/test.mjs --coverage` runs Vue tests with the exact Vitest-matched `@vitest/coverage-v8` provider, then Rust workspace tests (core, desktop host, and plugins) with `cargo-llvm-cov`. On other hosts the MVP scope includes Vue coverage only; use `--extended --coverage` to explicitly include deferred native coverage. Workspace coverage needs the same native compilation libraries as host tests; the Linux CI image supplies WebKitGTK, AppIndicator, SSL, zlib, and the C/C++ build tools. Install the latter at the version recorded in `tools/toolchain.quality.json`, using `cargo install cargo-llvm-cov --locked --version <version>`. The pinned Rust toolchain includes LLVM tools.

Reports live under `client/target/coverage/`: Vue HTML and LCOV in `vue/`, and Rust LCOV in `rust.lcov`. Vue includes unexecuted application `.ts` and `.vue` sources, excluding test files and type declarations. Rust instrumentation reports core and host application sources, including uncalled instrumented functions. This profile does not execute WebView or mobile smoke journeys and imposes no universal percentage threshold. Inspect uncovered behavior rather than treating aggregate percentages as an acceptance gate.

The Coverage workflow is explicitly manual and is not called by Quality, including its `full` mode. Its dedicated measurement opts into extended coverage so both Vue and Rust reports are produced on Linux. It captures the selected revision and current `main` commit and measures distinct revisions independently on Linux with the same harness. If both SHAs match, it measures the revision only once. Reports are retained for seven days; failed tests or invalid reports fail the measurement, but there is no percentage threshold. Counts use distinct executable source lines from LCOV `DA` records, which can differ from LLVM's generic-instantiation summary counters. An unsupported baseline is reported as unavailable, not zero.

Coverage jobs have read-only permissions and do not comment on PRs. The optional commenting workflow is retained in [`.github/disabled-workflows/coverage-comment.yml`](../../.github/disabled-workflows/coverage-comment.yml); GitHub does not discover it there.

## CI gates

The [Quality workflow](../../.github/workflows/quality.yml) selects checks by event and changed paths:

- Ready PRs run affected shared checks and a Git-history secret scan on Linux, plus affected macOS verification. CI and local changed selections use the same suite input rules. Documentation-only PRs retain formatting, document contracts and secret scanning; requirement records also retain catalog checks. Product UI and shared/native changes select macOS product browser tests; native Rust, Swift and fixture journeys remain on the Apple host. Unknown inputs widen selection within the MVP scope, not into deferred platforms.
- Draft PRs and pushes to `main` run affected fast checks and the history scan. PRs compare against their merge base; pushes compare against the preceding revision. An initial push without a preceding revision retains the unfiltered quick checks. Marking a PR ready triggers affected MVP selection again.
- Manual dispatch defaults to `full`, meaning all active MVP checks; choose `quick` for the short checks. Neither mode enables Windows, Linux product-native, Android, workshop/browser-artwork sweeps or visual comparisons.
- Vulnerability audits are excluded from Quality, including manual full and quick selections. The separate [Rust dependency audit workflow](../../.github/workflows/dependency-audit.yml) checks the client Cargo workspace weekly and on manual dispatch using `client/deny.toml`, including its macOS/iOS targets and advisory exceptions. It retains RustSec advisory, unmaintained-crate and yanked-version checks that Dependabot does not fully replace. Its failures do not feed `Required host quality`. Secret scans and Rust license, ban and source checks remain in Quality. Local audits remain available with `node tools/quality.mjs audit` (npm) and `node tools/quality.mjs rust-audit` (Cargo).
- [Dependabot](../../.github/dependabot.yml) handles npm vulnerability monitoring instead of a scheduled npm audit and also covers Cargo and GitHub Actions. Before relying on it, enable the dependency graph, Dependabot alerts and Dependabot security updates in the repository settings; the configuration file alone does not enable them. Routine npm and Cargo version-update PRs are disabled with `open-pull-requests-limit: 0`, which does not disable security-update PRs. Security fixes are grouped by ecosystem to reduce PR volume. GitHub Actions version updates remain weekly with at most five open version-update PRs; they are needed because [SHA-pinned actions do not receive Dependabot alerts](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems). Coverage depends on GitHub's dependency graph and advisory database; inspect alerts even when no fix PR is available. Dependabot does not replace secret scanning.
- There is no automatic weekly exhaustive run or automatic coverage run. Coverage remains available through its separate manual workflow.

Before an Apple release, dispatch Quality with `mode: full` on the release candidate and verify that `Required host quality` passes for that exact commit. Also perform the relevant native iOS simulator/device, signing and distribution checks; host CI does not supply that evidence. A quick or path-selected result is not a release verification. These workflows do not publish releases or configure GitHub release/branch protection.

[`tools/ci-selection.mjs`](../../tools/ci-selection.mjs) intersects affected suites with the active MVP scope. [`tools/ci-shard.mjs`](../../tools/ci-shard.mjs) retains exhaustive, disjoint registry partitions for validation and explicit diagnostics, including deferred browser and native partitions. The active workflow does not schedule those deferred partitions. macOS verification can run alongside quick checks after selection; the aggregate still requires both. Docker context validation remains available for infrastructure changes without mounting a Docker socket into test containers.

`Required host quality` requires every selected job to succeed and only accepts skips for deliberately unselected jobs. Selection errors, failed jobs, cancellations, and unexpected skips fail the aggregate. JSON results, logs, and visual reports are retained for seven days. Keep fixtures synthetic; never put credentials or private data in diagnostics.

### History storage tests

The core suite includes ordinary history initialization, external content changes, repeated object reuse, failed publication and flush retries, and reopening a workspace in a separate process. The Windows cases exercise real file/directory sharing errors and retained identities under a restricted token. These Windows-specific cases are deferred during the Apple MVP. Before resuming Windows support, run the complete Rust workspace suite on native Windows; successful macOS tests do not establish Windows behavior.

Tests with READONLY hardlink aliases retain their synthetic fixtures at the printed temporary paths, including on failure. Automatic cleanup could change attributes through an outside alias. The subprocess tests check readability after reopening, not persistence after power loss. Restricted-token execution does not establish equivalence to every account, security descriptor or filesystem configuration.

The opt-in Apple synchronization-batch check needs a second writable filesystem distinct from `TMPDIR`, such as a disposable APFS RAM volume. It creates temporary fixtures on both filesystems and verifies their separate final barriers. After provisioning the second filesystem, run from the repository root:

```sh
SITUATE_TEST_SECOND_FILESYSTEM=/Volumes/TestScratch node tools/run-coordinated.mjs -- cargo test --manifest-path client/Cargo.toml -p situate-core --locked durable_storage::sync_batch::tests::distinct_filesystems_receive_independent_barriers -- --exact --ignored
```

### Linux tool image and caches

Shared Linux checks, history scanning, optional coverage measurements and explicit deferred diagnostics use a digest-pinned GHCR image. The supported distribution target is `ghcr.io/getsituate/situate-ci-linux`, with public visibility required for anonymous contributor and fork-workflow access. The [image guide](../../client/docker/ci-README.md) describes its build inputs and runtime contract. `tools/ci-image.lock.json` records the image digest, platform, and tool-input fingerprint. Changed image inputs or mismatched Playwright pins fail validation rather than falling back to an unreviewed tag. Ordinary application dependency changes do not require an image rebuild unless they change the pinned browser tooling.

The image contains tools, system libraries, retained license notices, and compressed corresponding-source archives—not application code, project dependencies, browser archives, or user credentials. Each job mounts a fresh checkout and installs lockfile-governed dependencies. Download caches retain npm packages, Cargo registry/git downloads, and Playwright browsers. Separate build caches reuse compatible Rust build output; pinned Swift tools are cached by toolchain and runner identity rather than rebuilt on every macOS run.

Only trusted `main` push, scheduled, or manually dispatched runs may save shared caches. Download and Rust caches require successful preceding checks; the Swift action saves verified tools after installation, independently of later source-test results. PR jobs restore caches without uploading replacements. Build caches are separated by platform, architecture, job family, and build inputs; they do not replace test execution. Do not cache credentials, private runtime fixtures, reports, host homes, or `node_modules`. The image publisher does not consume these caches.

Rust quality/native jobs disable incremental compilation and retain line-table debug information rather than full debug data. Separate runners prevent browser and native build artifacts from accumulating on one disk. Container runs print free-space and target-directory diagnostics; the image itself still consumes disk space. Coverage keeps its instrumentation settings and measures both revisions with the same harness image.

To inspect a partition without running it:

```sh
node tools/ci-shard.mjs --shard browser --extended --list --json
```

To run a partition in the locked image, use a regular checkout whose `.git` directory is inside the checkout, a non-root Unix user, Docker, and a dedicated absolute cache path:

```sh
CI_CACHE_DIR=/tmp/situate-ci-downloads node tools/ci-container.mjs --shard checks
```

The container wrapper installs dependencies; the central runner can bootstrap missing root quality-tool, client, and requirements npm dependencies but does not install system tools. Linked Git worktrees require a separate regular checkout because their external Git metadata is not mounted. Containers receive no Docker socket, host home, or GitHub credentials. Registry authentication stays on the host. The image's public visibility is an intentional distribution policy, including its retained third-party sources and notices. Verify anonymous access to the pinned digest before activating consumers. Never provide a personal access token to untrusted PR code or move source execution into a privileged `pull_request_target` job to fix registry access.

### Updating the image

The `Publish Linux CI image` workflow builds on image-input, publisher or publishing-workflow changes pushed to `main` in exactly `getsituate/situate`. The build and publication jobs remove the same unused SDK directories as image consumers, only on GitHub-hosted Linux runners, to leave room for retained sources and temporary Docker export/load files. Maintainers can also dispatch it from `main` with a reviewed, full commit SHA to prepare an image before merging a toolchain update. It never publishes from a PR event. The read-only build job treats the candidate checkout as Docker build data; a separate publisher validates the same-run archive and pushes a unique run tag without executing the image. Normal publication requires an existing public container package linked to `getsituate/situate` by both name and the run's numeric repository ID, checked through `/orgs/getsituate/packages/container/situate-ci-linux`. No shared `latest` tag or dependency cache participates in publication.

Review the build, source inventories, and smoke results, then copy the published digest and input hash from the job summary into `tools/ci-image.lock.json` through a PR. The lock has `version: 1`, `platform: "linux/amd64"`, the digest-qualified `image` reference, and `inputsSha256`. Verify with `node tools/ci-image.mjs`; `node tools/ci-image.mjs --inputs` prints the current input hash. Rebuilding unchanged inputs still requires an explicit digest update. Security patches require updating the affected tool or base-image pins.

For an initially absent package, obtain explicit authorization for image distribution and review the [notices and source obligations](../../client/docker/ci-NOTICES.md). Verify organization package-creation rights and the exact repository identity. The trusted workflow must already exist on `main`; dispatch it with `bootstrap: true` and the reviewed source SHA. Bootstrap uses the same build, restricted verification, archive and provenance checks, but refuses an existing package. It creates a private package, checks exact repository linkage and produces no pinnable digest output. A permission error is not treated as an absent package. A failed post-push check may leave a package behind; inspect it rather than retrying bootstrap blindly.

An authorized operator must then review the package and explicitly change its visibility to **Public**. Grant the repository write access through **Manage Actions access** if linkage did not provide it. Dispatch normal publication (`bootstrap: false`), which requires public visibility before and after pushing. Verify an anonymous pull of the exact resulting digest using an empty Docker configuration, and check the permitted fork-PR path without privileged credentials before activating consumers. Consumers need neither package membership nor a PAT. Publication does not change visibility, update the lock, merge a PR or configure branch protection.

An empty repository cannot run this workflow. If publishing only one root commit is required, separately authorize a controlled build/verify/publish operation with equivalent trusted harness, source-free verification and retained provenance before publishing the source. Otherwise explicitly approve the trusted bootstrap commit on `main`. Do not import another repository's history or weaken lock validation to break the bootstrap dependency. For an OCI image index, include `org.opencontainers.image.source` as an index annotation as well as an image-config label, then verify GHCR repository association. A local Docker image ID is not a registry manifest digest; pin only a real published digest and its matching input fingerprint.

### Mobile CI (disabled)

iOS is an active MVP target, but automated iOS device verification is not currently provisioned. Native iOS checks remain explicit development and release work; macOS or browser passes do not establish iOS qualification. Android development and verification are deferred. The [Mobile platforms workflow](../../.github/disabled-workflows/mobile.yml) is retained outside `.github/workflows`, so GitHub does not discover or run it—not manually, on a schedule, or on releases. Host-side source checks and device-free contract tests remain active.

Before enabling iOS CI, separate it from the deferred Android job, review its triggers and move the intended workflow into `.github/workflows`. Its retained release trigger runs after publication, not as a release gate. The definitions require dedicated provisioned runners, not personal developer devices:

- `self-hosted, Linux, X64, situate-android`: JDK 21, writable KVM, Android command-line tools, SDK platform `android-37.0`, build tools `36.0.0`, NDK `28.2.13676358`, CMake `3.22.1`, emulator/platform tools, and the API 35 Google APIs x86_64 image. The runner operator must have reviewed and accepted the SDK licenses. The job initializes and builds the smoke configuration, boots an AVD with a job-specific name and directory, executes plugin instrumentation and plugin/app Android lint, and requires nonempty instrumentation results. It verifies the debuggable APK's application identity, installs it, and requires fresh passing reports on two launches. Startup refuses occupied emulator ports; device operations and cleanup verify the owned AVD name. Instrumentation also refuses to run while other devices are attached.
- `self-hosted, macOS, ARM64, situate-ios`: Xcode with completed first launch, an available iOS Simulator runtime, XcodeGen, CocoaPods, and the usual Rust/Node build prerequisites. The job builds the smoke configuration, requires exactly one built app with the smoke bundle identifier in its `Info.plist`, creates a disposable simulator, and requires a fresh passing `smoke-result.json` on each of two launches before deleting the simulator.

When enabled, the workflow retains mobile diagnostics for seven days, including on failure: the owned Android emulator log, plugin instrumentation XML, plugin/app lint reports, and each launch's fresh smoke report. iOS smoke reports are copied out before simulator cleanup. Artifact collection is limited to these job outputs, not runner logs or other device data.

These definitions do not accept SDK licenses, install signing identities, publish builds, or verify real document providers. If enabled, the jobs fail on missing provisioned tools and use an explicit `Required mobile quality` aggregate. Without matching runners, enabled jobs would remain queued; no mobile verification is implied. Keep self-hosted runners restricted to trusted workflow events. Workflow files alone do not configure branch protection or provision runners.

## Localization checks

Product translations live in `client/packages/localization/src/catalogs/`. Each language combines its base, UI and native catalogs. Keys must be unique within a language and present with nonempty values and matching interpolation parameters in every supported language. Use `@situate/localization` for translated text and workspace-dependent display formats; native user-facing errors carry message keys and parameters instead of English sentences.

```sh
cd client
npm run check:localization
```

The check also inspects product Vue, TypeScript and CSS sources for literal interface text and invalid translation-key use. It runs during product checks/builds and in the client script unit suite. This is a syntax and supported-source-flow check, not a proof of arbitrary cross-module data provenance. User documents and conversations are not translation catalogs, and the independent design workshop is not part of the product localization check.

Product Playwright tests import `test` and `expect` from `client/app/tests/browser/test.ts`. The shared automatic fixture defaults to key-only rendering and audits rendered text and accessibility attributes during each test. It retains detected violations even if a dialog closes or the page navigates. User content, formatted values and external identities require narrowly scoped content boundaries; these do not exempt unrelated controls or accessibility labels.

Use `test.use({ localizationMode: 'real' })` for tests whose assertions depend on actual language or text geometry. Keep layout checks in real-language mode: a key's length is not representative of its translation. The runtime audit covers states reached by a browser test; catalog and source checks remain necessary for other states.

## Automatic Pi feedback

The project extension loads when Pi trusts this checkout. Pi must run under Node 24 or newer. Run `/reload` in an existing session after adding or changing it. It runs the five-second, dependency-free quick profile at `agent_before_settle`, after ordinary agent work and queued continuations finish—not after each tool call or low-level `agent_end` event.

The extension delegates staged, unstaged, untracked non-ignored, and committed changes since the activity's starting commit to the central runner. This includes documentation, requirements, and Pi resources outside `client/`. An empty selection does not run tests or produce success feedback.

It runs the fast profile with the repository's Volta-selected Node and npm, independently of the Node version running Pi. To execute the selected checks explicitly without session result reuse:

```sh
volta run node tools/test.mjs --quick --changed --base <starting-commit> --json --pi-package-root <running-pi-package>
```

Volta must be available on `PATH`; there is no fallback to Pi's or the system's Node executable.

The starting commit is captured before the agent begins, so changes committed during that activity still select checks. Pre-existing local changes are included too. Selection and the quick deadline stay in the central runner. The extension also applies a deadline covering toolchain lookup and runner startup. It does not run Vue tests, typechecks, Rust tests, or dependency installation automatically. The current quick allowlist executes its checks each time; longer suites and optional result reuse belong to explicit feedback runs. A quick pass is not evidence that those longer suites passed.

Successful results appear only in the UI status and are stored as session metadata with report and log paths; they do not enter model context or request another response. Mixed reports identify reused successes separately from executed checks; an entirely reused successful selection is silent. Failures appear in the transcript and enter model context. A failure gives the agent **one automatic follow-up per user request** to fix its regressions or report existing failures and missing prerequisites, followed by a recheck. A failed recheck stays visible without another repair turn. A budget overrun is visible but does not request an automatic repair turn; move the slow check to a longer-running suite. Work continued by another extension can require another check, but cannot replenish this repair allowance.

Full reports and logs are saved in private temporary directories outside the checkout. Failure feedback includes their paths and a diagnostic excerpt of at most 24 log lines or 2,000 characters. Recognized error lines take precedence over trailing output from successful suites. Treat logs as local development data and review them before sharing. Checks are serialized within one extension instance, not across separate Pi processes or manual runner invocations; use separate worktrees for editing agents.

Use Pi's interrupt key (normally Escape) to cancel a running check in the TUI, or `/cancel-unit-tests` in any mode. Cancellation, session replacement, and reload do not start repair turns. For SDK/RPC callers, send `/cancel-unit-tests` as a **prompt**, not as steering or follow-up input. Pi currently exposes no operation signal during final settlement, so a generic SDK/RPC abort alone does not stop this boundary's test process; use the cancellation command before aborting the session.

Set `SITUATE_AUTO_TESTS=0` before starting Pi to disable automatic checks. Workers marked with `PI_SUBAGENT_WORKER=1` also leave testing to their caller. Neither setting disables explicit runner commands.

Before creating a pull request, run `node tools/test.mjs --changed --base origin/main` with an up-to-date base reference, as described in [`AGENTS.md`](../../AGENTS.md). The unfiltered default MVP scope remains available for full verification and is required before an Apple release. Deferred suites are run explicitly when relevant, not as an unconditional PR gate. There is no test commit hook or interception of Git commands.

## Results and automation

```sh
mkdir -p test-results
node tools/test.mjs --unit --changed --json > test-results/suite.json
node tools/test.mjs --changed --base origin/main --timeout 1200 --json > test-results/suite.json
```

With `--json`, stdout contains one JSON object; child output and progress go to stderr. `test-results/` is ignored by Git. Keep reports in an ignored directory or outside the checkout: shell redirection creates its output file before selection, so an untracked report in the source tree would itself count as a change. Plans contain the profile, changed files, selected projects, and suite commands. Execution reports add overall `status`, wall-clock `durationMs`, parallel dependency preparation `setupDurationMs`, and per-suite `results` with stable IDs, category, status, exit code, and duration. They do not embed test logs or environment variables. `--list --json` returns a plan without running tests; `--help --json` returns structured help.

When `--success-cache` is enabled, progress output explains why a suite ran instead of reusing a result. Each result's `cache` object provides the same reason as a stable `reason` code and, where relevant, a repository-relative `configuration` path. For executed suites, `recorded` indicates whether the new success was stored; `recordingReason` explains a refusal or storage failure. A cache miss or unsupported configuration does not change the suite's status or exit code. Cache records themselves contain only the input digest, not these diagnostics.

Exit codes:

- `0`: every selected suite passed, a local `no-tests` selection, help, or a listed plan.
- `1`: at least one suite failed or timed out, or an empty selection when `CI=true` or `--require-tests` is set.
- `2`: invalid options, Git/base resolution failure, or an unclassified test inventory.
- `130`, `143`, `129`: interrupted with SIGINT, SIGTERM, or SIGHUP respectively.

The default timeout is 600 seconds **per suite**. A timeout terminates that suite and continues with the next; interruption cancels the run and marks remaining suites `not-run`. Termination signals the suite process and discovered descendants before escalation, with process-identity checks and a bounded wait for output pipes to close. A cleanup diagnostic requires checking for remaining test processes before another run. The runner never stops unrelated development sessions or automatically reclaims application/build locks.
