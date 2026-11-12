pub const TITLE: &str = "Situate Dev";
pub const ACTIONS: [&str; 7] = [
    "[c] Desktop client",
    "[t] Tests…",
    "[a] Architecture docs",
    "[d] Design workshop",
    "[w] Build & open website",
    "[r] Requirements preview",
    "[R] Release…",
];
pub const REQUIREMENTS: &str = "Requirements preview";
pub const REQUIREMENTS_READY: &str = "Requirements preview: ";
pub const TASK_NAMES: [&str; 7] = [
    "Desktop client",
    "Tests · Changed unit",
    "Tests · Quick",
    "Tests · MVP suite",
    "Architecture docs",
    "Design workshop",
    "Website preview",
];
pub const FOOTER: &str =
    "Click to run/view · Wheel to scroll · Tab Focus · ↑↓/jk Select · Enter Run/view";
pub const BUTTON_ACTIONS: &str = "[Actions]";
pub const BUTTON_OUTPUT: &str = "[Output]";
pub const BUTTON_HELP: &str = "[? Help]";
pub const BUTTON_QUIT: &str = "[q Quit]";
pub const BUTTON_STOP: &str = "[s Stop]";
pub const BUTTON_RERUN: &str = "[Ctrl+r Rerun]";
pub const BUTTON_INSPECT_PI: &str = "[i Inspect with Pi]";
pub const INSPECTION_NO_RUN: &str = "Select a run to inspect with Pi.";
pub const INSPECTION_PI_MISSING: &str = "The checkout's Pi package is missing. Run node tools/npm-ci.mjs from the repository root, then try again.";
pub const INSPECTION_CAPTURE_FAILED: &str =
    "Could not capture the full process log. Pi inspection can use only the retained output tail.";
pub const INSPECTION_SAVED: &str = "Inspection files saved at:";
pub const INSPECTION_START_FAILED: &str = "Could not start Pi";
pub const INSPECTION_SAVE_FAILED: &str = "Could not finish saving inspection files";
pub const BUTTON_LOGS: &str = "[Logs]";
pub const BUTTON_RESULTS: &str = "[Results]";
pub const BUTTON_FOLLOW: &str = "[End Follow]";
pub const BUTTON_COPY: &str = "[Copy]";
pub const COPIED: &str = "Selected log text copied.";
pub const COPY_FAILED: &str = "Could not copy selected log text to the clipboard.";
pub const BUTTON_CANCEL: &str = "[Esc Cancel]";
pub const BUTTON_CLOSE: &str = "[Esc Close]";
pub const BUTTON_RUN: &str = "[y Run]";
pub const BUTTON_INSTALL: &str = "[y Install & start]";
pub const BUTTON_STOP_QUIT: &str = "[y Stop & quit]";
pub const TEST_OPTIONS: [&str; 3] = [
    "[1] Changed unit tests",
    "[2] Quick checks",
    "[3] MVP suite",
];
pub const EMPTY: &str = "Choose an action to start. Output and results appear here.";
pub const TEST_MENU: &str =
    "Choose a test profile.\nTests may install missing npm dependencies using npm ci.";
pub const FULL_CONFIRM: &str = "Run the MVP suite?\nIncludes shared checks and macOS product verification.\nRequired tools and services must already be available.";
pub const QUIT_CONFIRM: &str = "Stop all tasks started here and quit?";
pub const HELP: &str = "c  Start desktop client     d  Open design workshop\nw  Build & open website     a  Build & open architecture docs\nt  Choose test profile      r  Build & open requirements\nR (Shift+r)  Build / publish release\nTab  Switch list/output     Enter  Run action / view run\n↑↓ / jk  Select or scroll   PgUp/PgDn  Scroll page\nHome / End  First / follow latest output\ne  Toggle results/logs     ←→  Scroll horizontally\no  Application/process output (desktop launches only)\np  Pause application view  l/g/x  Level/category/trace\nSelect a desktop run to filter by its discovered session.\ns  Stop selected run        Ctrl+r  Rerun selected task\ni  Exit console & inspect selected run with Pi\nq / Ctrl-C  Quit            Esc  Close this dialog\n\nClick actions, runs and buttons to operate the console.\nWheel over a pane to scroll; wheel over dialogs to read more.\nDrag within logs to select text; click Copy to copy the selection.\nEsc or a click clears the selection; scrolling resumes the view.\nCmd-C also copies if forwarded by the terminal.\nHold Shift to use the terminal selection instead.\nNO_COLOR=1 disables colors.\n\nOnly tasks started by this console are stopped.\nView buffers are bounded; the oldest lines and runs expire.\nTest/release output is also captured in private temporary files.\nInspect with Pi stops owned tasks, saves the selected run's evidence,\nand starts Pi in this terminal. Other temporary captures are removed.";
pub const RELEASES: &str = "Release";
pub const VERSION_CURRENT: &str = "Current app version";
pub const VERSION_NEXT: &str = "Release app version";
pub const VERSION_BUILD_CURRENT: &str = "c Build current version";
pub const VERSION_PROMPT: &str = "Enter major.minor.patch, without leading zeroes or suffixes. New or incomplete releases continue with changelog preparation. Prepared versions continue to tests. Choose Build current version to use the checkout without changelog preparation. Build validation still applies. Enter continues; Esc cancels.";
pub const VERSION_INVALID: &str =
    "Enter a valid major.minor.patch version not older than the current version.";
pub const VERSION_INVALID_SOURCE: &str =
    "Version files are missing, inconsistent or use an unsupported format.";
pub const VERSION_CHANGED: &str =
    "The source revision or app version changed. Start the release again.";
pub const RELEASE_TESTS_PROMPT: &str = "Run the complete MVP test suite before this release?\nRuns node tools/test.mjs --json without a changed-file filter. Includes regular shared checks and macOS/iOS verification; extended workshop and visual sweeps are separate.\nYou can skip tests. Nothing is built or published until you review the result and confirm the release separately.\nRequired tools and services must already be available.";
pub const RELEASE_TESTS_RUN: &str = "[y Run all MVP tests]";
pub const RELEASE_TESTS_SKIP: &str = "[s Skip tests]";
pub const RELEASE_TESTS_RETRY: &str = "[r Run tests again]";
pub const RELEASE_TESTS_OVERRIDE_BUTTON: &str = "[s Continue without passing tests]";
pub const RELEASE_TESTS_RESULT: &str = "Release tests";
pub const RELEASE_TESTS_UNAVAILABLE: &str =
    "Test results are unavailable. This is not a passing test run.";
pub const RELEASE_TESTS_SKIPPED: &str = "Tests skipped for this release.";
pub const RELEASE_TESTS_OVERRIDE: &str = "Continuing without passing tests.";
pub const RELEASE_TESTS_REVIEW: &str = "Review the suite results below. Continue to the separate release confirmation, run tests again, or cancel. Page Up/Down scrolls the results.\nThis run checks the current checkout; it does not replace exact-artifact native update qualification. Inspect with Pi exits the console and stops its active tasks.";
pub const PUBLICATION_CHECK: &str = "Release · Check";
pub const PUBLICATION_STAGE: &str = "Release · Prepare";
pub const PUBLICATION_PUBLISH: &str = "Release · Publish";
pub const PUBLICATION_INSPECT: &str = "Release · Inspect";
pub const PUBLICATION_RECONCILE: &str = "Release · Reconcile";
pub const PUBLICATION_REVISION: &str = "Source revision";
pub const PUBLICATION_BUILD: &str = "Build";
pub const PUBLICATION_JOURNAL: &str = "Publication journal present";
pub const PUBLICATION_METADATA_ERROR: &str = "Release metadata is missing, unsafe or invalid.";
pub const PUBLICATION_EXISTING_JOURNAL: &str =
    "A publication journal exists. Inspect the remote state; do not publish again.";
pub const PUBLICATION_TARGET_INVALID: &str = "The publication destination or version is invalid. Reload the destination from the release menu.";
pub const PUBLICATION_EMPTY: &str =
    "No readable Apple release manifests found in client/artifacts/apple-*/.";
pub const PUBLICATION_SELECT: &str = "Select a build with Previous / Next, then Continue.\nIncomplete builds can be inspected but cannot be published.";
pub const PUBLICATION_OPTIONS: [&str; 5] = [
    "[1] Check locally",
    "[2] Prepare locally",
    "[3] Publish download & update",
    "[4] Inspect remote status",
    "[5] Reconcile publication",
];
pub const PUBLICATION_PREVIOUS: &str = "[↑ Previous build]";
pub const PUBLICATION_NEXT: &str = "[↓ Next build]";
pub const PUBLICATION_TARGET: &str = "Confirm destination and version below. The SSH host comes from WEBSITE_DEPLOY_HOST in the environment or repository-root .env.\nThis changes the macOS download and app-update feed, not the website deployment.";
pub const PUBLICATION_DESTINATION_FAILED: &str = "Could not load WEBSITE_DEPLOY_HOST. Set a valid SSH alias or user@hostname in the environment or private repository-root .env (mode 0600). CI uses environment variables only.";
pub const PUBLICATION_APPROVAL: &str = "This changes the macOS download and app-update feed.\nReview the test status above. Confirm the source revision has been reviewed and publication to this destination is approved. The test-suite run does not replace exact-artifact native update qualification.\nNo automatic retry or rollback.";
pub const PUBLICATION_RECOVERY: &str = "Inspect first. Confirm the original SSH/host operation has stopped. Review the retained transport archive before manually removing it, then explicitly reconcile the identical stage. Never remove active locks or pending markers.";
pub const PUBLICATION_UNCERTAIN: &str = "Remote publication state may be uncertain.\nStopping SSH does not prove failure or rollback.\nUse Inspect remote status before any explicit reconciliation. Do not retry publication.";
pub const PUBLICATION_LOCAL: &str = "Check and prepare verify the existing packages locally without building or publishing. The reviewed commit must be available locally and match the build manifest. The current checkout may differ and contain local edits.";
pub const PUBLICATION_INSPECT_CONFIRM: &str = "Read remote publication status over SSH and save the observation in the local journal? This does not resume or cancel a remote operation.";
pub const RELEASE_MACOS: &str = "Release · macOS";
pub const RELEASE_IOS: &str = "Release · iOS";
pub const RELEASE_ALL: &str = "Release · macOS + iOS";
pub const RELEASE_OPTIONS: [&str; 4] = [
    "[1] macOS (Universal DMG)",
    "[2] iOS + TestFlight",
    "[3] macOS + iOS + TestFlight",
    "[4] Publish / inspect macOS release…",
];
pub const RELEASE_MENU: &str = "Choose a build or an existing macOS release.\nmacOS builds direct packages locally; iOS uploads to TestFlight.\nBuilding does not publish macOS downloads or activate an app release.\nPublish / inspect selects exact artifacts for a separate operation.";
pub const RELEASE_NUMBER: &str = "iOS build number (1–9999)";
pub const RELEASE_NUMBER_HELP: &str = "Enter a new build number for TestFlight.\nAfter an interrupted upload, check App Store Connect before retrying.\nBackspace edits; Enter continues.";
pub const RELEASE_NUMBER_INVALID: &str =
    "Enter a build number from 1 to 9999, without leading zeroes.";
pub const RELEASE_CONFIRM: &str = "Create signed distribution packages?\nmacOS: direct packages, Apple notarization; no publication.\niOS: externally managed; may create Apple signing assets.\nSaved under client/artifacts/apple-*/. No website deployment.";
pub const RELEASE_UPLOAD_CONFIRM: &str = "The new iOS build will be uploaded to TestFlight.\nNo public App Store release will be submitted.\nApple processing and compliance may still be required.";
pub const RELEASE_HOST: &str = "Apple releases require macOS with Xcode.";
pub const RELEASE_CONFLICT: &str = "Release operations cannot overlap client, test, or other release runs. Stop the active run first.";
pub const BUTTON_CONTINUE: &str = "[Enter Continue]";
pub const INSTALL_RELEASE_CONFIRM: &str = "Client dependencies are missing.\nInstall them with npm ci --include=dev and continue the release?\nThis downloads packages and may run package install scripts.";
pub const TESTS: &str = "Tests";
pub const CONFIRM: &str = "Confirm";
pub const INSTALL_CONFIRM: &str = "Client dependencies are missing.\nInstall them with npm ci --include=dev and start the selected app?\nThis downloads packages and may run package install scripts.";
pub const INSTALL_TITLE: &str = "Client setup";
pub const INSTALL_TEST_CONFLICT: &str =
    "Wait for the test run to finish before installing client dependencies.";
pub const CLIENT_INSTALL_CONFLICT: &str =
    "Wait for client setup to finish before starting another app.";
pub const TEST_INSTALL_CONFLICT: &str = "Wait for client setup to finish before running tests.";
pub const HELP_TITLE: &str = "Help";
pub const ACTIONS_TITLE: &str = "Actions / Runs";
pub const OUTPUT_TITLE: &str = "Output";
pub const RESULTS: &str = "Results";
pub const LOGS: &str = "Logs";
pub const RUNNING: &str = "Running";
pub const STOPPING: &str = "Stopping";
pub const PASSED: &str = "Passed";
pub const FAILED: &str = "Failed";
pub const CANCELLED: &str = "Cancelled";
pub const NO_TESTS: &str = "No tests selected";
pub const NO_REPORT: &str = "No test report available; see logs.";
pub const DUPLICATE: &str = "This task is already running.";
pub const TEST_CONFLICT: &str = "A test run is already active.";
pub const FULL_CLIENT_CONFLICT: &str =
    "Stop the client before running the MVP suite; native tests share application resources.";
pub const TEST_CLIENT_CONFLICT: &str =
    "Wait for the MVP suite to finish before starting the client.";
pub const REPORT_INVALID: &str = "Invalid or missing test report";
pub const REPORT_TOO_LARGE: &str = "Test report exceeded the 8 MiB limit";
pub const PIPE_TIMEOUT: &str = "Output streams did not close; output may be incomplete.";
pub const ROOT_ERROR: &str =
    "Run this command inside a Situate checkout containing tools/test.mjs and client/package.json.";
pub const TERMINAL_REQUIRED: &str =
    "An interactive terminal is required. Run npm run dev in a terminal.";
pub const USAGE: &str = "Usage: situate-dev [--help]\n\nStart the development console from anywhere inside a Situate checkout.\nRequires macOS or Linux, Cargo, and the tools needed by each selected task.";
pub const SHUTDOWN: &str = "Stopping tasks…";
pub const START_FAILED: &str =
    "Could not start command; check that the tool is installed and on PATH";
pub const OPEN_FAILED: &str =
    "Could not open the browser. Open docs/architecture/index.html manually.";
pub const WEBSITE_READY: &str = "Website preview: ";
pub const WEBSITE_NOT_READY: &str = "Preview exited before its local server was ready.";
pub const WEBSITE_OPEN_FAILED: &str = "Could not open the preview in the browser.";
pub const WEBSITE_OPENED: &str = "Browser launch requested.";
pub const REPORT_ERROR: &str = "Test runner error";
pub const TRIMMED: &str = "Older output discarded";
pub const EXIT: &str = "Exit";
pub const PROCESS_TABLE: &str = "Could not inspect owned processes";
pub const INVALID_PID: &str = "Invalid root PID";
pub const INVALID_PROCESS_TABLE: &str = "Invalid ps process table";
pub const APPLICATION_TITLE: &str = "Application diagnostics (read-only)";
pub const APPLICATION_BUTTON: &str = "[o Application]";
pub const PROCESS_BUTTON: &str = "[o Process output]";
pub const PAUSE_BUTTON: &str = "[p Pause]";
pub const LEVEL_BUTTON: &str = "[l Level]";
pub const CATEGORY_BUTTON: &str = "[g Category]";
pub const TRACE_BUTTON: &str = "[x Trace]";

pub fn application_session(session: Option<&str>) -> String {
    format!(
        "Session: {} (select a desktop run to change)",
        session.unwrap_or("not discovered")
    )
}
pub fn application_filters(level: &str, category: Option<&str>, trace: Option<&str>) -> String {
    format!(
        "Level >= {level} | category: {} | trace: {}",
        category.unwrap_or("all"),
        trace.unwrap_or("all")
    )
}
pub fn application_omissions(omitted: usize, unsupported: usize, evicted: usize) -> String {
    format!(
        "Viewer omissions: {omitted} | unsupported schema: {unsupported} | buffer evictions: {evicted}"
    )
}
pub const APPLICATION_NO_COLLECTOR: &str =
    "No native collector for this run. Select a desktop launch.";
pub const APPLICATION_PAUSED: &str = "Viewer paused; native recording unchanged";
pub const APPLICATION_WAITING: &str = "Waiting for native discovery; recording not confirmed";
pub const APPLICATION_INVALID: &str = "Invalid native discovery metadata; recording not confirmed";
pub const APPLICATION_DISCOVERY_UNAVAILABLE: &str =
    "Native discovery unavailable; recording not confirmed";
pub const APPLICATION_UNAVAILABLE: &str = "Native diagnostic storage/writer unavailable";
pub const APPLICATION_FILES_UNAVAILABLE: &str = "Diagnostic files unavailable to viewer";
pub const APPLICATION_RECORDS_WAITING: &str = "Waiting for records from this launch";
pub const APPLICATION_FOLLOWING: &str = "Following this launch";
pub const APPLICATION_INIT_FAILED: &str = "Application-log discovery could not be initialized";
