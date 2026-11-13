# Developer setup

Clone [Situate](https://github.com/getsituate/situate), install the toolchains below, and use your preferred editor. Ordinary development and tests do not require an AI subscription, model credentials, Pi or Herdr.

```sh
git clone https://github.com/getsituate/situate.git
cd situate
```

Follow the [client setup guide](../../client/README.md) for native prerequisites and app commands, or the [requirements guide](../../requirements/README.md) for the catalog and viewer. [Agent-assisted development](#optional-agent-assisted-development) is optional.

## Prerequisites

- Git.
- [Volta](https://volta.sh/) for the repository-pinned Node.js and npm versions.
- Python 3 for coordinated test and dependency commands.
- [sccache](https://github.com/mozilla/sccache) is recommended for reusing Rust compilation results across local builds.

Develop the current MVP on macOS with Xcode for macOS. iOS, Windows, Linux desktop and Android are deferred and do not require compatibility work, SDK setup, simulators or store provisioning. Linux-hosted shared CI tooling remains useful, but does not establish Linux product support. See the [MVP platform scope](../../requirements/data/foundations.md#mvp-platform-scope) and [test tiers](testing.md#profiles-and-change-selection).

## Install Volta

Install Volta using its [official installation instructions](https://docs.volta.sh/guide/getting-started). On macOS with Homebrew:

```sh
brew install volta
volta setup
```

Restart your terminal so Volta's shims precede other Node installations on `PATH`. From the repository root:

```sh
volta --version
node --version
npm --version
volta which node
volta which npm
node tools/npm-ci.mjs
node tools/npm-ci.mjs client
node tools/npm-ci.mjs requirements
```

The root `package.json` pins Node **24.21.0** and npm **11.19.1**. Nested packages inherit those pins through `volta.extends`; Volta downloads and selects them automatically. Use the ordinary `node`, `npm`, and `npx` commands through Volta, not a system Node installation or another version manager. Restart long-running terminals and agents after changing the toolchain.

For an intentional upgrade, run `volta pin node@<version> npm@<version>` at the repository root. Update `client/.node-version`, the quality-tool npm pin, and container pins together, then rebuild and verify the CI image as described in the [container guide](../../client/docker/ci-README.md).

## Install sccache

On macOS with Homebrew:

```sh
brew install sccache
sccache --version
```

Keep a stable `sccache` release version 0.19.0 or newer on `PATH`. The development and test scripts [listed in the compiler-cache guide](testing.md#local-compiler-cache) use it automatically when available, with a shared local cache limited to `50G`. No activation flag is needed. Set `SITUATE_SCCACHE=0` to disable the integration or `SCCACHE_CACHE_SIZE` to change the limit before the cache server starts. Builds still work without sccache; scripts do not install it automatically.

The cache does not remove worktree-local build artifacts. Incremental compilation settings remain unchanged, and linker invocations are not cached. See the [compiler-cache guide](testing.md#local-compiler-cache) for configuration and limitations.

## Optional agent-assisted development

Pi runs the coding agent and provides CEO, CTO, Developer and Product Designer roles. Herdr manages agent terminals and isolated parallel work. Only this workflow requires access to a supported AI provider through a subscription or API key. Skip it for ordinary editing, development and tests.

### Install Pi

```sh
node tools/npm-ci.mjs
npx --no-install pi --version
```

Source: [Pi installation and usage](https://pi.dev).

### Install Herdr

Use the installer from [Herdr](https://herdr.dev), or choose another installation method from its website. Review the installer before running it:

```sh
installer="$(mktemp)"
curl -fsSL https://herdr.dev/install.sh -o "$installer"
less "$installer"
sh "$installer"
rm "$installer"
herdr --version
```

Follow any installer instructions to add Herdr to `PATH`, then restart your terminal if needed.

### Start Pi inside Herdr

From the repository root, start Herdr:

```sh
herdr
```

In a Herdr-managed shell pane, change to the repository root if necessary and run:

```sh
printf '%s\n' "$HERDR_ENV"  # Must print 1 before delegating tasks.
npx --no-install pi
```

Review the repository's `.pi/` files before approving Pi's project-trust prompt. Inside Pi:

- Run `/login` to configure your AI provider if needed.
- Run `/role ceo` for product direction, business priorities, and requirements, `/role cto` for architecture decisions, technical strategy, and operations, `/role developer` for scoped implementation, bug fixes, refactoring, and tests, or `/role product-designer` for UI/UX discovery, wireframes, prototypes, and usability evaluation. Use `/role off` to work without a role-specific prompt or skills.
- Developer provides clean-code, code-documentation, behavior-focused testing, risk-based test-design, and architectural-review skills. Load them for the relevant task; ordinary changes do not require a separate test plan or architecture decision.
- The CEO role replaces `requirements-engineer` and retains its requirements skills. Sessions using the removed role fall back to Off; select `/role ceo` to continue requirements work.
- Invoke `/skill:delegate-with-herdr` when you want to split work across agents. Editing delegates use separate Git worktrees; read-only reviewers use separate panes.

Keep provider credentials in Pi's user configuration, never in the repository. Do not grant project trust globally just to suppress the prompt.

## Local environment files in worktrees

Optional local secrets belong in the ignored `.env` at each repository root. [`.env.example`](../../.env.example) lists supported names without values. Create the primary checkout's `.env` privately before adding secrets:

```sh
(umask 077; set -C; : > .env)
```

This refuses to overwrite an existing file. Keep existing files owner-only with `chmod 600 .env`. Do not source the file as shell code; each consuming command parses its own supported variables. The [live agent test](testing.md#native-agent-journeys) reads only `TEST_OPENAI_API_KEY`, with existing environment variables taking precedence. CI uses environment secrets directly.

To opt into automatic copies for new worktrees on macOS or Linux, run from any checkout:

```sh
node tools/install-worktree-env-hook.mjs
```

The checked-in `tools/hooks/post-checkout` is installed as a standalone copy in the shared Git hooks directory. It discovers the primary checkout through Git, copies all of its `.env` into a linked worktree only when the destination is absent, and creates the copy with mode `0600`. It does not export variables or contact a secret manager. The source must be an owner-only regular file, without symlinks or hardlinks, no larger than 64 KiB. Both `.env` and `.env.*` must remain ignored, including on the destination branch, so interrupted temporary copies cannot enter ordinary staging.

Installation is optional and local; cloning the repository does not activate hooks. Existing hooks and `core.hooksPath` configurations are not replaced. Integrate the checked-in hook with your existing setup manually if either is already configured. An identical installed hook is left unchanged; later hook changes require reviewing and replacing the installed copy.

Git invokes `post-checkout` for normal `git worktree add`, but not with `--no-checkout`; worktree tools must invoke the Git hook for automatic copying. Existing worktrees are not backfilled by installation, and existing `.env` files are never synchronized or overwritten. To populate a missing file in an existing linked checkout, run `sh tools/hooks/post-checkout HEAD HEAD 1` there after configuring the primary checkout.

Every copy contains plaintext secrets readable by processes running as your user. Ignore rules do not protect against backups, compromised processes, or forced staging. Keep secrets out of commits and artifacts, remove obsolete copies, and update each copy when rotating a key. Maintainers can instead provide environment variables without installing the hook.

## Role-specific MCP servers

The Product Designer role connects [UI Skills](https://www.ui-skills.com/) and [Inspo](https://inspomcp.dev/). Their configurations live in `.pi/role-mode/roles/product-designer/role.json` under `mcpServers`, using Pi's standard MCP server configuration shape. No separate install or API key is required for these hosted endpoints.

The role switcher registers only the active role's servers. Switching to CEO, CTO, Developer or Off unregisters the design servers, closes their connections and makes their tools unavailable. Resume, reload and tree navigation restore the servers for the selected branch's role. Requests made before switching and content already returned to the conversation are not erased.

Use `/mcp` inside Pi to inspect the active connections. `pi mcp list` does not load extensions and therefore does not list role-registered servers. This requires a Pi version with `registerMcpServer` and `unregisterMcpServer` support and the built-in MCP extension enabled.

Do not also configure `ui-skills` or `inspo` in project or user `mcp.json`: those entries take precedence and load independently of the role. Other independently configured MCP servers are unaffected.

Design queries go to external hosted services. Use generic queries, keep private material out of them, and review licensing before reusing retrieved content.

## Herdr operational skill

The repository's `delegate-with-herdr` skill uses your user-level Herdr skill at:

```text
~/.pi/agent/skills/herdr/SKILL.md
```

If `PI_CODING_AGENT_DIR` is set, use that directory instead of `~/.pi/agent`. Keep an existing Herdr skill; do not overwrite personal customizations. If you do not have one, the delegation skill can read the current operational instructions directly from:

```sh
herdr --skill
```

No personal home directory or copied user configuration is required in the repository.

After changing repository skills, roles, or extensions, run `/reload` inside Pi. Restart Pi if removed extension tools remain visible in the current session.

## Run the repository test suite

From the repository root:

```sh
node tools/test.mjs
node tools/test.mjs --unit
node tools/test.mjs --quick
node tools/test.mjs --checks
node tools/test.mjs --changed --base origin/main
node tools/test.mjs --quick --changed
```

The default runs the active macOS MVP scope. Use `node tools/test.mjs --extended` for the complete current-host inventory, including deferred sweeps. The [test suite guide](testing.md) describes prerequisites, fast and long-running categories, affected-suite selection, and machine-readable results. Project-specific commands below remain available for targeted work.

## Development terminal

On macOS and Linux, run from the repository root:

```sh
./dev.sh
```

`npm run dev` starts the same console. The executable script also works when called by its path from another directory.

This launches `situate-dev`, the independent Rust workspace in `tools/dev-tui/`, with `cargo run --locked --manifest-path Cargo.toml` from that directory so its pinned **Rust 1.98.1** toolchain applies. Install rustup first. The launcher resolves the checkout from its own location, so `node /path/to/checkout/tools/dev.mjs` also works from subdirectories. The binary can locate the checkout from a working directory inside it.

- `c`: desktop client; `d`: [design workshop](design-workshop.md).
- `t`: tests menu (`1`: changed unit tests, `2`: quick checks, `3`: MVP suite with confirmation).
- `a`: render and open architecture documentation.
- `w`: build the website, serve the generated files locally and open the browser.
- `r`: build the requirements viewer, serve the generated files locally and open the browser.
- `R` (Shift+r): release menu (`1`: Universal macOS DMG, `4`: select an existing macOS release for publication or inspection, `5`: prepare release notes). Retained options `2` (iOS/TestFlight) and `3` (combined Apple builds) are deferred reference paths, not current release work. Builds, publication and starting a release-notes agent retain separate confirmation.
- `Tab`: switch focus; arrows or `j`/`k`: select or scroll.
- `s`: stop; `Ctrl+r`: rerun; `e`: open results or process logs; `End`: follow output.
- `i`: exit the console and inspect the viewed run with Pi in the same terminal. Also available in the release-test results dialog.
- `o`: switch between process output and read-only application diagnostics. For desktop launches, `l` cycles the minimum level, `g` the category, `x` the trace, and `p` pauses file reading. Select a desktop run to view only its discovered session.
- `q`: quit; confirm when tasks are still running.

Click an action to run it, a run to inspect it, or the visible buttons to stop, rerun, switch results/logs, and confirm dialogs. The mouse wheel scrolls the pane under the pointer; scrolling logs pauses following until **Follow** is clicked. Horizontal scrolling is supported in the output pane. On narrow terminals, use **Actions** and **Output** to switch views. Dialog text scrolls with the wheel or Page Up/Down. On macOS, drag within the visible logs to select text, then click **Copy** to copy only the selection. The log view stays still during selection while tasks and log recording continue. **Esc**, a click, or scrolling clears the selection; changing views or resizing also clears it. **Cmd-C** copies if the terminal forwards it to the console. Most terminals also allow their native text selection with Shift held while dragging.

Desktop development uses persistent, worktree-local app data under `client/.desktop-dev-data/`, separate from the installed application's data. Restarting the same checkout reuses it; another checkout starts with its own registry and settings. Existing production data is not copied. Stop the checkout's desktop processes before deliberately removing this directory to reset development state. Development ports remain automatically assigned. The desktop wrapper rejects custom Tauri `-c`/`--config` arguments so they cannot override the isolated data directory.

Application diagnostics come from the desktop client's existing JSONL files, discovered through a private per-launch manifest. Workshop runs have no native collector. Missing discovery does not confirm recording; unavailable storage/writer, malformed or unsupported records, and viewer-buffer evictions are shown separately. The viewer retains at most 3,000 records and 2 MiB of source record bytes, limits individual lines to 32 KiB, and never changes the diagnostic files. Pausing or filtering does not change native recording; files may rotate away while the view is paused.

The console uses the Situate brand colors. Run `NO_COLOR=1 ./dev.sh` for a monochrome interface; keyboard and mouse controls remain available.

Client actions use the [client setup prerequisites](../../client/README.md). If npm dependencies or the Tauri/Vite commands are missing, the console asks before running `npm ci --include=dev`, shows installation output, and starts the selected client only after successful setup. Setup cannot overlap a test run; SDKs and native toolchains still need to be installed separately. Tests use the [test suite prerequisites](testing.md#prerequisites). Documentation rendering requires Asciidoctor, plus `open` on macOS or `xdg-open` on Linux to open the result. Missing tools are reported in the selected run's output. Test profiles may install missing npm dependencies through the existing test runner.

Prepare the product version and reviewed localized notes through [release preparation](release-preparation.md) before a distribution build. The guide includes a manual command-line path without an agent. For the console's optional agent-assisted path, choose **Start Pi agent** to select the version and open a Herdr pane using your local Pi setup. Review the English draft yourself and ask the agent to translate when ready. After reviewing all languages, return to the console and choose **Changelog prepared** to validate the files and create one commit containing the version change and release notes. No editor opens automatically. The preparation agent never commits, publishes or signs an app. Follow the [commit conventions](commit-conventions.md) for new commits; local hook installation is optional.

Before an Apple build, the console shows the current app version and asks for the desired `major.minor.patch` version. A new version, or a current version without finalized notes, opens changelog preparation. If no preparation exists yet, the console asks for the comparison baseline and confirmation to start Pi. Review the draft and translations, then confirm **Changelog prepared**. The console commits the version and notes together and returns to the test prompt for the selected macOS release. Nothing is built until you confirm the build separately.

Re-entering a version with finalized notes permits another build without another preparation or commit. Older versions, leading zeroes and prerelease suffixes are rejected. Publishing an existing macOS artifact uses its manifest version unchanged; it does not rewrite the artifact or source version.

Preparation requires a clean checkout and index on a named branch, without an active merge or rebase. Existing Git hooks and signing settings apply; interactive signing may need an already-unlocked signing agent. Unrelated changes are refused rather than staged or committed. After a failed or interrupted preparation, inspect the run and private recovery files before retrying. The selected version and finalized notes are checked again before the Apple release script starts, including after dependency setup.

Before an Apple build or macOS publication, the release dialog asks whether to run the complete regular MVP suite (`node tools/test.mjs --json`, without `--changed`). Choose **Run all MVP tests** or **Skip tests**. The test run appears in the run list with live output and can be stopped normally. When it finishes, the dialog shows the overall status and each suite's result, duration, exit code and available errors. Scroll with Page Up/Down or the mouse wheel. Tests never start a release automatically: choose **Continue** after a passing run, then review and confirm the build or publication separately. You can also retry or cancel. Failed, cancelled, empty or invalid test results are not treated as a pass; **Continue without passing tests** explicitly bypasses them before the separate release confirmation. Skips and overrides are shown in that confirmation and apply only to the selected release attempt. Test results remain available in the run's **Results** and **Logs** views after closing the dialog.

This runs the default macOS MVP scope, not the opt-in extended workshop, design-browser or screenshot sweeps. Tests check the current checkout; publishing an existing artifact still requires its separate exact-artifact native qualification. Release retries ask about tests again rather than reusing an earlier approval.

Apple releases require macOS and the [Apple signing setup](../../client/README.md#apple-distribution) in the client guide. The console runs `release:apple` and shows its output and artifact directory. In the retained, deferred iOS path, selecting iOS adds `--upload-testflight`: after all selected packages build successfully, the new IPA is validated and uploaded. The confirmation dialog includes the upload; no public App Store release is submitted. Apple processing, compliance and tester access may still need attention. Use a new iOS build number for each upload. Rerunning an iOS release lets you edit the number before confirming. After a failed or interrupted upload, inspect App Store Connect and the run's `upload.json` before retrying; the console does not automatically retry. Release operations cannot overlap client, test, or other release runs in this console.

### Inspect a run with Pi

Press `i` or click **Inspect with Pi** in the output pane or release-test results dialog. The console stops its owned tasks, finishes collecting their output, restores the terminal and replaces itself with the checkout's pinned Pi CLI. Pi starts at the checkout root with a prompt to inspect the selected run, not to edit code, rerun tests or retry external operations. Other runs are not included in the evidence. Stopping a release process does not prove that an upload or publication was cancelled remotely.

Pi receives the absolute path to a private temporary directory containing:

- `summary.json`: task, checkout, branch, planned command arguments and working directories, final status, exit code, suite results and capture limits.
- `report.json`: the original test-runner output, including incomplete or malformed JSON when a run failed to produce a valid report. Non-test tasks may have an empty report.
- `output.log`: merged process output with terminal control sequences removed.

Test and release runs capture process output from launch, independently of the 3,000-line display buffer, up to 64 MiB per run. The raw report retains the process reader's 8 MiB limit. Other tasks, or a failed full-log capture, provide only the retained output tail. Capture gaps, write failures and truncation are recorded in the summary; missing evidence is not a successful run. Application diagnostic JSONL files, credential files, environment snapshots and workspace content are not copied. Process output can still contain sensitive data; review the evidence before sharing it.

The directory has mode `0700`, its files have mode `0600`, and it remains available to Pi after the console exits. Its path is printed before Pi starts. Remove it when the investigation is complete; operating-system temporary-file cleanup can also remove it. Captures not handed to Pi are removed when their run expires or the console exits. Output from earlier console sessions cannot be recovered this way. If Pi is not installed locally, the console stays open and asks you to run `node tools/npm-ci.mjs`; it never downloads Pi automatically. If startup fails after handoff, the saved evidence remains at the printed path. Pi's normal account configuration and project-trust checks still apply.

### Publish a macOS release

Open `R`, then `4`. Use **Previous build** / **Next build** and **Continue** to select an exact `client/artifacts/apple-*/` build. The console shows its version, full source revision, manifest status, distribution, platforms and publication journal when present. It skips unreadable or malformed manifests; appearing in the list does not establish that a build is publishable.

1. Choose **Check locally** to run the existing publisher's Apple and artifact verification. The displayed reviewed commit must exist locally and match the build manifest and signed app configuration. The current checkout can be on a different revision or branch and contain local changes. The build itself must have been created from a clean committed source.
2. Choose **Prepare locally** to create a verified stage beside the build, named `publication-apple-<run>`. This does not contact the server. An existing stage is never overwritten; publication revalidates its exact bytes.
3. After reviewing the source and native update qualification for the exact artifacts, choose **Publish download & update**. Review the destination and version loaded automatically from `WEBSITE_DEPLOY_HOST` and the selected build. Explicit environment values take precedence over the private repository-root `.env`, including empty values; CI uses environment variables only. No host or version needs to be typed. Choose whether to run the MVP tests, review their results or explicitly skip them, then review the selected build, revision and destination and confirm. Destination lookup is local and makes no SSH connection. The publisher independently checks the confirmed destination/version against its effective configuration before connecting, so changing the host after confirmation blocks publication. Publication switches both macOS download metadata and the update feed; it does not deploy the website.

Every action requires confirmation and runs through the worktree command queue. Check, prepare and publish revalidate artifacts independently; a prior successful console run is not a substitute for qualification evidence. See the [publisher prerequisites](../../infrastructure/releases/README.md) for credentials, signing identity, host preparation and exact-artifact qualification. Native qualification must be completed outside the console.

After an interrupted publication, choose **Inspect remote status**. It reads remote state and saves the observation in the local journal; it does not stop or resume the host operation. Confirm the original SSH process and host operation have stopped. Review the retained transport archive before manually removing it, then use **Reconcile publication** with a fresh destination/version confirmation to finish the identical staged release. The original stage is taken from the journal. Follow the [interrupted publication procedure](../../infrastructure/releases/README.md#interrupted-publication); do not remove active locks or pending markers. There are no automatic retries or application rollbacks. **Rerun** reopens build selection instead of repeating publication, and an existing journal blocks a new publication attempt.

The retired landing-page deployment is no longer offered. Use the [production deployment CLI](../../infrastructure/production/README.md#production-services-and-traffic-activation) for website updates; **Build & open website** remains a local preview.

### Local previews

The website preview action needs Node.js and `open` on macOS or `xdg-open` on Linux, but no client dependencies. It builds `website/dist`, starts a loopback-only server on an available port, and requests the browser only after that server is listening. The URL appears in the output. The task remains running while the preview is available; stop it with `s`, or stop and rerun with `Ctrl+r` to rebuild after changes. A failed build does not open a browser; a failed browser launch stops the preview and reports failure. This action does not deploy the website.

The requirements preview (`r`) uses the same browser and process controls. Install its dependencies once with `cd requirements && npm ci`; it does not install client dependencies. It validates the catalog, builds `requirements/dist`, and opens a loopback-only preview on an available port only after the build succeeds. Stop and rerun to rebuild after changes. The same build-and-serve command is available as `node requirements/scripts/preview.js` from the repository root (without automatic browser opening).

The console keeps recent logs in memory, prevents conflicting client and test runs, and stops its owned processes on exit. Successfully opened browsers remain open. The terminal does not require a backend server.

### Local dictation models

On Apple Silicon Macs, desktop development (`c` in the console or `cd client && npm run dev:client`) uses `~/Library/Caches/Situate/Dictation` as its model source instead of Hugging Face. Each worktree copies the pinned model files into its own app data and verifies their size and SHA-256 hashes. Recordings remain worktree-local. Once installed in a worktree, verified model files are reused even if the source is unavailable.

Populate the shared source once from a completed download in an existing checkout. Stop that checkout's client first, replace the example checkout path below, and copy only the revision directory, not recordings or other app data:

```sh
revision=7dd20fe6b1797d35f5e3307e8b1732d9a178edfe
source="/path/to/existing-checkout/client/.desktop-dev-data/dictation"
mkdir -p "$HOME/Library/Caches/Situate/Dictation"
cp -R "$source/$revision" "$HOME/Library/Caches/Situate/Dictation/"
```

The revision must match [`ModelManifest.swift`](../../client/app/src-tauri/dictation/Sources/SituateDictation/ModelManifest.swift). A new pinned revision needs its own complete source directory. A missing or corrupt local file makes dictation provisioning fail; it never falls back to an internet download. Typed chat remains available, and **Settings → Dictation** offers retry after the source is repaired. Local copying works offline.

To use another source directory, set the build-time variable `SITUATE_DICTATION_MODEL_SOURCE` to an absolute path before starting the console or `npm run dev:client`. Its layout is `<source>/<revision>/<model files>`. The variable is embedded at build time, not read from the running application's environment. Empty and relative values are rejected. Builds outside the desktop wrapper use Hugging Face when the variable is unset; release builds reject the local override and use the fixed Hugging Face source. Keep local paths out of release environments and do not distribute development binaries containing them.

## Run the client

The client has its own npm and Cargo workspaces under `client/`. Follow the [client setup guide](../../client/README.md) for the pinned Node/Rust toolchains, native prerequisites, development commands, tests, and desktop/mobile builds. Client development does not require Pi, Herdr, a backend, or model credentials.

## Architecture and host APIs

The architecture's [conversation tool matrix](../architecture/05-building-block-view/level-3/application/agent-integration/conversation-tools.adoc) lists model-callable tools, their purposes and their availability in normal chat and plugin development, including platform and recovery conditions.

The [architecture documentation](../architecture/index.adoc) describes workspace ownership, file/history storage, conversation execution and UI coordination. The [workspace view API](workspace-views.md) covers registration, navigation lifetimes and file-reference capture for client integrations. The [Git-derived file-reference development plan](git-derived-file-references-plan.md) sequences the accepted replacement of the independent move journal, including interruption behavior. Its original no-migration exception covers unpublished development formats only; changes to published formats require [release compatibility verification](testing.md#release-compatibility-verification).

## Run the requirements viewer

```sh
cd requirements
npm ci
npm run dev
```

Verification:

```sh
npm run validate
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

See [the requirements README](../../requirements/README.md) for catalog conventions and browser-test details.

For the role-switcher extension tests, run this from the repository root after `node tools/npm-ci.mjs`:

```sh
node --test .pi/extensions/role-switcher/*.test.mjs
```

Tests use the repository-local pinned Pi package. To deliberately test another installation, set `PI_PACKAGE_ROOT` to its package directory containing `package.json` and runtime dependencies.

## Mobile prototype toolchains on macOS

The retained instructions below are deferred mobile reference material, not macOS MVP setup. Do not install iOS runtimes, Android SDKs, simulators or emulators for routine macOS work. Install requested host tools once rather than separately in every worktree; framework dependencies belong to the individual prototype.

Only for explicitly requested mobile work, install Xcode from Apple, complete its first-launch setup, and install an iOS simulator runtime. Keep the separate Command Line Tools current through Software Update as well; Homebrew may reject source builds when they are older than the installed OS.

```sh
brew install --cask flutter android-commandlinetools
brew install openjdk@21 rustup cocoapods

export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$(brew --prefix rustup)/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

sdkmanager --licenses
sdkmanager 'platform-tools' 'emulator' 'platforms;android-36' \
  'build-tools;36.0.0' 'ndk;28.2.13676358' 'cmake;3.22.1' \
  'system-images;android-36;google_apis;arm64-v8a'

export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
export ANDROID_NDK_HOME="$NDK_HOME"
rustup toolchain install stable --profile minimal
rustup target add aarch64-apple-ios aarch64-apple-ios-sim \
  aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

flutter config --android-sdk "$ANDROID_HOME" --jdk-dir "$JAVA_HOME"
flutter doctor -v
```

Review and accept SDK licenses interactively. The ARM64 emulator image above is for Apple Silicon; choose a matching image on an Intel host. The listed SDK/NDK versions support the initial comparison; follow each prototype's pinned build configuration if it needs additional versions. Rustup is keg-only when installed alongside Homebrew Rust, so its `bin` directory must precede Homebrew's normal `bin` directory for mobile targets.

Keep environment exports in a user-local shell file and source it in each worktree. Do not commit machine-specific paths, signing identities or credentials. No Android Studio installation is required for command-line builds and emulator execution.

Create separate Android virtual devices for concurrent prototypes:

```sh
avdmanager create avd -n situate_tauri_api36 \
  -k 'system-images;android-36;google_apis;arm64-v8a' -d pixel_7
avdmanager create avd -n situate_flutter_api36 \
  -k 'system-images;android-36;google_apis;arm64-v8a' -d pixel_7
emulator -accel-check
emulator -avd situate_tauri_api36 -port 5554
# In a separate terminal:
emulator -avd situate_flutter_api36 -port 5556
adb devices
```

Use distinct iOS simulator IDs and Android serials for concurrent agents. With XcodeBuildMCP installed, discover simulator commands through `xcodebuildmcp simulator-management --help`, then list and boot the selected devices. `flutter devices` should report both mobile platforms. Toolchain detection and simulator boot are prerequisites, not proof that either prototype builds or runs; verify those in each worktree.

## Working conventions

Read [AGENTS.md](../../AGENTS.md) before contributing. Repository content is English and intended for public distribution. Review diffs for sensitive information and redistribution rights. Delegation does not grant permission to publish code or change remote repository state.
