#![cfg(any(target_os = "macos", target_os = "linux"))]

use nix::{
    fcntl::{FcntlArg, FdFlag, OFlag, fcntl},
    pty::{Winsize, openpty},
    sys::{
        signal::{Signal, kill},
        termios::{Termios, tcgetattr},
    },
    unistd::{Pid, setsid},
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[test]
fn standalone_version_commit_command_is_not_available() {
    let output = Command::new(env!("CARGO_BIN_EXE_situate-dev"))
        .args(["--set-release-version", "0.1.2", "0.1.3"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Usage:"));
}

const PIPELINE_CLI: &str = r#"
if [ "$1" = tools/pipeline.mjs ]; then
  printf '%s\n' "$@" > "pipeline.$2.args"
  action=$2; workflow=$3; shift 3
  source=; base=; destination=; operation=; release=; repository=; output=; plan=; confirmation=
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --source) source=$2;; --base) base=$2;; --destination) destination=$2;;
      --operation) operation=$2;; --release-id) release=$2;; --repository) repository=$2;;
      --output) output=$2;; --plan) plan=$2;; --confirm) confirmation=$2;;
      *) echo unexpected-argument >&2; exit 90;;
    esac
    shift 2
  done
  digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  case "$action" in
    plan)
      if [ -f malformed-plan ]; then echo '{'; exit 0; fi
      printf '{"schemaVersion":1,"workflow":"%s","source":"%s","base":"%s","destination":"%s","operation":"%s","releaseId":"%s","repository":"%s","authorizationDigest":"%s","lanes":[{"id":"mandatory-gates"}]}' "$workflow" "$source" "$base" "$destination" "$operation" "$release" "$repository" "$digest" > "$output"
      /bin/cat "$output";;
    run)
      [ "$confirmation" = "$digest" ] && [ -s "$plan" ] || exit 91
      printf '{"type":"suite","lane":"shared","suite":"unit","status":"passed"}\n'
      printf '{"type":"stage","stage":"mandatory-gates","status":"running"}\n'
      echo $$ > pipeline.pid
      while [ -f hold-pipeline ]; do sleep 1; done
      if [ -f partial-result ]; then printf '{"type":"result"'; exit 0; fi
      if [ -f fail-pipeline ]; then printf '{"type":"result","status":"failed"}\n'; exit 1; fi
      printf '{"type":"result","status":"completed"}\n';;
    inspect)
      [ -n "$operation" ] && [ -z "$plan" ] || exit 93
      if [ -f partial-inspection ]; then printf '{"schemaVersion":1'; exit 0; fi
      if [ -f wrong-operation ]; then operation=another-operation; fi
      printf '{"schemaVersion":1,"operationId":"%s","planDigest":"%s","stateDigest":"%s","remote":{"state":"retained"},"reconciliationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n' "$operation" "$digest" "$digest";;
    reconcile|status)
      [ -n "$operation" ] && [ -z "$plan" ] || exit 94
      if [ "$action" = reconcile ]; then
        [ "$confirmation" = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ] || exit 95
        printf '{"type":"stage","stage":"promote","status":"passed"}\n'
      fi
      if [ -f partial-journal ]; then printf '{"schemaVersion":1'; exit 0; fi
      printf '{"schemaVersion":1,"operationId":"%s","plan":{"workflow":"%s","authorizationDigest":"%s"},"status":"completed","stages":[]}\n' "$operation" "$workflow" "$digest";;
    *) exit 92;;
  esac
  exit 0
fi
"#;

fn enter_create_inputs(console: &mut Console) {
    console.keys(b"R1");
    console.wait_for(|s| s.text().contains("Workflow: create"));
    console.keys(
        format!(
            "{}\t{}\toperator@host\toperation-1",
            "a".repeat(40),
            "b".repeat(40)
        )
        .as_bytes(),
    );
    console.wait_for(|s| s.text().contains("operation-1_"));
}

#[test]
fn workflow_plans_then_confirms_exact_saved_plan_with_keyboard_and_mouse() {
    let mut console = Console::start();
    enter_create_inputs(&mut console);
    console.click("Enter Plan");
    console.wait_for(|s| s.text().contains("Authorize exact plan"));
    assert!(!console.file("pipeline.run.args"));
    assert!(!console.file("tests.started"));
    console.click("y Authorize exact plan");
    console
        .wait_for(|s| s.file("pipeline.run.args") && s.text().contains("Release · Run · Passed"));
    let args = fs::read_to_string(console.root.path().join("pipeline.run.args")).unwrap();
    assert!(args.contains("\nrun\ncreate\n--plan\n"));
    assert!(args.contains(&format!("\n--confirm\n{}", "a".repeat(64))));
    assert!(console.text().contains("mandatory-gates"));
    console.keys(b"\x12");
    console.wait_for(|s| {
        s.text().contains("Workflow: create") && s.text().contains("Inspect the existing operation")
    });
    console.click("[Esc Cancel]");
    console.wait_for(|s| !s.text().contains("Workflow: create"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn publication_selects_exact_github_release_without_a_builder_or_actions() {
    let mut console = Console::start();
    console.keys(b"R2");
    console.wait_for(|s| s.text().contains("Workflow: publish"));
    console.keys(b"42\toperator@host\toriginal-operation\r");
    console.wait_for(|s| s.text().contains("Authorize exact plan"));
    let plan = fs::read_to_string(console.root.path().join("pipeline.plan.args")).unwrap();
    assert!(plan.contains("\n--release-id\n42\n"));
    assert!(plan.contains("\n--repository\ngetsituate/situate\n"));
    console.keys(b"y");
    console
        .wait_for(|s| s.text().contains("Release · Run · Passed") && s.file("pipeline.run.args"));
    assert!(!console.file("release.args"));
    assert!(!console.file("tests.started"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn malformed_plan_and_partial_result_are_not_successes() {
    let mut console = Console::start();
    fs::write(console.root.path().join("malformed-plan"), "").unwrap();
    enter_create_inputs(&mut console);
    console.keys(b"\r");
    console.wait_for(|s| s.text().contains("Invalid or incomplete workflow plan"));
    assert!(!console.file("pipeline.run.args"));
    fs::remove_file(console.root.path().join("malformed-plan")).unwrap();
    fs::write(console.root.path().join("partial-result"), "").unwrap();
    console.keys(b"\r");
    console.wait_for(|s| s.text().contains("Authorize exact plan"));
    console.keys(b"y");
    console.wait_for(|s| {
        s.text().contains("Invalid or partial workflow event") && s.text().contains("Failed")
    });
    console.keys(b"q");
    console.finish();
}

#[test]
fn reopened_workflow_inspects_before_explicit_cross_host_reconciliation() {
    let mut console = Console::start();
    enter_create_inputs(&mut console);
    console.click("[Esc Cancel]");
    console.wait_for(|s| !s.text().contains("Workflow: create"));
    console.keys(b"R1");
    console.wait_for(|s| s.text().contains("Workflow: create"));
    console.keys(
        format!(
            "{}\t{}\tother-host\toriginal-operation",
            "a".repeat(40),
            "b".repeat(40)
        )
        .as_bytes(),
    );
    console.wait_for(|s| s.text().contains("original-operation_"));
    console.click("F2 Inspect operation");
    console.wait_for(|s| s.text().contains("Reconcile inspected operation"));
    assert_eq!(
        fs::read_to_string(console.root.path().join("pipeline.inspect.args")).unwrap(),
        "tools/pipeline.mjs\ninspect\ncreate\n--operation\noriginal-operation\n"
    );
    assert!(!console.file("pipeline.plan.args"));
    assert!(!console.file("pipeline.reconcile.args"));
    console.keys(b"y");
    console.wait_for(|s| {
        s.file("pipeline.reconcile.args") && s.text().contains("Release · Reconcile · Passed")
    });
    assert!(!console.file("pipeline.run.args"));
    assert_eq!(
        fs::read_to_string(console.root.path().join("pipeline.reconcile.args")).unwrap(),
        format!(
            "tools/pipeline.mjs\nreconcile\ncreate\n--operation\noriginal-operation\n--confirm\n{}\n",
            "b".repeat(64)
        )
    );
    console.keys(b"q");
    console.finish();
}

#[test]
fn status_and_inspection_use_operation_json_without_source_or_plan() {
    let mut console = Console::start();
    console.keys(b"R1");
    console.wait_for(|s| s.text().contains("Workflow: create"));
    console.keys(b"\t\t\toriginal-operation");
    console.wait_for(|s| s.text().contains("original-operation_"));
    console.click("F3 Operation status");
    console.wait_for(|s| s.text().contains("Release · Status · Passed"));
    assert_eq!(
        fs::read_to_string(console.root.path().join("pipeline.status.args")).unwrap(),
        "tools/pipeline.mjs\nstatus\ncreate\n--operation\noriginal-operation\n"
    );
    console.click("[Results]");
    console.wait_for(|s| s.text().contains("operationId") && s.text().contains("completed"));
    console.keys(b"\x12");
    console.wait_for(|s| s.text().contains("Workflow: create"));
    fs::write(console.root.path().join("partial-inspection"), "").unwrap();
    console.click("F2 Inspect operation");
    console.wait_for(|s| {
        s.text().contains("Invalid or partial operation JSON") && s.text().contains("Failed")
    });
    assert!(!console.file("pipeline.reconcile.args"));
    assert!(!console.file("pipeline.plan.args"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn cancelled_workflow_preserves_uncertainty_and_never_retries_a_write() {
    let mut console = Console::start();
    fs::write(console.root.path().join("hold-pipeline"), "").unwrap();
    enter_create_inputs(&mut console);
    console.keys(b"\r");
    console.wait_for(|s| s.text().contains("Authorize exact plan"));
    console.keys(b"y");
    console.wait_for(|s| s.file("pipeline.pid"));
    console.keys(b"s");
    console.wait_for(|s| {
        s.text().contains("Cancelled") && s.text().contains("remote outcome may be uncertain")
    });
    console.keys(b"\x12");
    console.wait_for(|s| s.text().contains("Workflow: create"));
    assert!(!console.file("pipeline.reconcile.args"));
    console.keys(b"\r");
    console.wait_for(|s| s.text().contains("Authorize exact plan"));
    console.keys(b"y");
    console.wait_for(|s| s.text().contains("Inspect this operation first"));
    assert!(!console.file("pipeline.reconcile.args"));
    console.click("[Esc Cancel]");
    console.wait_for(|s| !s.text().contains("Workflow: create"));
    console.keys(b"q");
    console.finish();
}

struct Console {
    root: tempfile::TempDir,
    child: Child,
    master: File,
    original: Termios,
    output: Vec<u8>,
    read_limit: usize,
    respond_cursor: bool,
    screen: vt100::Parser,
}
impl Console {
    fn start() -> Self {
        Self::spawn(true)
    }
    fn spawn(respond_cursor: bool) -> Self {
        Self::spawn_with_color(respond_cursor, true)
    }
    fn spawn_with_color(respond_cursor: bool, color: bool) -> Self {
        let root = tempfile::tempdir().unwrap();
        for path in ["tools", "client", "docs/architecture", "bin"] {
            fs::create_dir_all(root.path().join(path)).unwrap();
        }
        fs::write(root.path().join("tools/test.mjs"), "").unwrap();
        fs::write(root.path().join("client/package.json"), "{}").unwrap();
        fs::create_dir_all(root.path().join("client/app/src-tauri")).unwrap();
        fs::write(
            root.path().join("client/app/src-tauri/tauri.conf.json"),
            r#"{"version":"0.1.1"}"#,
        )
        .unwrap();
        fs::create_dir_all(root.path().join("releases/0.1.1")).unwrap();
        fs::write(root.path().join("releases/0.1.1/release.json"), "{}").unwrap();
        let entries: Vec<String> =
            serde_json::from_str(include_str!("../client-dependencies.json")).unwrap();
        let mut install = String::new();
        for entry in entries {
            let path = root.path().join("client/node_modules").join(&entry);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, "fixture").unwrap();
            let relative = Path::new("client/node_modules").join(entry);
            install.push_str(&format!(
                "mkdir -p '{}'; touch '{}'\n",
                relative.parent().unwrap().display(),
                relative.display()
            ));
        }
        // Exceed the refresh interval to exercise yielding between inspections.
        script(
            &root.path().join("bin/ps"),
            "if [ -f slow-process-inspection ]; then /bin/sleep 0.3; fi\nexec /bin/ps \"$@\"",
        );
        script(
            &root.path().join("bin/npm"),
            "echo $$ > ../client.pid\nwhile :; do printf 'client output\\n'; done",
        );
        script(
            &root.path().join("bin/node"),
            &format!(
                "if [ \"$1\" = tools/run-coordinated.mjs ]; then\nif [ \"$3\" != node ]; then shift 2; exec \"$@\"; fi\nshift 3\nfi\nif [ \"$1\" = website/site.mjs ] || [ \"$1\" = requirements/scripts/preview.js ]; then\nprintf '%s\\n' \"$@\" > website.args\necho $$ > website.pid\nif [ -f fail-website ]; then echo website-build-failed >&2; exit 1; fi\nif [ -f hold-website ]; then while :; do sleep 1; done; fi\nif [ \"$1\" = requirements/scripts/preview.js ]; then\necho 'Requirements preview: http://127.0.0.1:43127/'\nelse\necho 'Website preview: http://127.0.0.1:43127/'\nfi\necho 'Website preview: http://127.0.0.1:43127/'\nwhile :; do sleep 1; done\nfi\nif [ \"$1\" = tools/prepare-client.mjs ]; then\necho setup > setup.started\nif [ -f fail-setup ]; then echo installation-failed; exit 1; fi\nif [ -f hold-setup ]; then while :; do sleep 1; done; fi\n{install}\nexit 0\nfi\necho invoked > tests.started\nprintf '%s\\n' \"$@\" > tests.args\necho $$ > tests.pid\nwhile [ -f hold-tests ]; do sleep 1; done\nprintf 'progress\\n' >&2\nif [ -f test-report ]; then /bin/cat test-report; exit 0; fi\nprintf '%s' '{{\"status\":\"no-tests\",\"results\":[]}}'"
            ),
        );
        let node = root.path().join("bin/node");
        let existing = fs::read_to_string(&node).unwrap();
        script(&node, &format!("{PIPELINE_CLI}\n{existing}"));
        script(
            &root.path().join("bin/asciidoctor"),
            "if [ -f fail-render ]; then echo render-failed >&2; exit 1; fi\necho html > docs/architecture/index.html",
        );
        for opener in ["open", "xdg-open"] {
            script(
                &root.path().join(format!("bin/{opener}")),
                "printf '%s\\n' \"$@\" >> browser.args\nif [ -f fail-browser ]; then exit 1; fi\necho opened > browser.opened",
            );
        }
        let pty = openpty(
            Some(&Winsize {
                ws_row: 30,
                ws_col: 110,
                ws_xpixel: 0,
                ws_ypixel: 0,
            }),
            None,
        )
        .unwrap();
        let original = tcgetattr(&pty.slave).unwrap();
        fcntl(&pty.master, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC)).unwrap();
        fcntl(&pty.slave, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC)).unwrap();
        let master = File::from(pty.master);
        let slave = File::from(pty.slave);
        let mut command = Command::new(env!("CARGO_BIN_EXE_situate-dev"));
        command
            .current_dir(root.path())
            .env("TERM", "xterm-256color")
            .env("NO_COLOR", if color { "" } else { "1" })
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    root.path().join("bin").display(),
                    std::env::var("PATH").unwrap_or_default()
                ),
            )
            .stdin(Stdio::from(slave.try_clone().unwrap()))
            .stdout(Stdio::from(slave.try_clone().unwrap()))
            .stderr(Stdio::from(slave));
        // A separate session prevents raw-mode tests from changing the caller's terminal.
        unsafe {
            command.pre_exec(|| {
                setsid().map_err(std::io::Error::from)?;
                if nix::libc::ioctl(0, nix::libc::TIOCSCTTY as _, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let child = command.spawn().unwrap();
        fcntl(&master, FcntlArg::F_SETFL(OFlag::O_NONBLOCK)).unwrap();
        let mut console = Self {
            root,
            child,
            master,
            original,
            output: vec![],
            read_limit: 16384,
            respond_cursor,
            screen: vt100::Parser::new(30, 110, 0),
        };
        if respond_cursor {
            console.wait_for(|s| s.text().contains("Situate Dev"));
        }
        console
    }
    fn text(&self) -> String {
        self.screen.screen().contents()
    }
    fn drain(&mut self) {
        let mut bytes = [0; 16384];
        for _ in 0..32 {
            match self.master.read(&mut bytes[..self.read_limit]) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    self.screen.process(&bytes[..n]);
                    let from = self.output.len().saturating_sub(3);
                    self.output.extend_from_slice(&bytes[..n]);
                    if self.respond_cursor
                        && self.output[from..].windows(4).any(|b| b == b"\x1b[6n")
                    {
                        self.master.write_all(b"\x1b[1;1R").unwrap();
                    }
                }
            }
        }
        if self.output.len() > 512 * 1024 {
            self.output.drain(..self.output.len() - 256 * 1024);
        }
    }
    fn wait_for(&mut self, ready: impl Fn(&Self) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            self.drain();
            if ready(self) {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "terminal timeout: {}",
                self.text()
            );
            thread::sleep(Duration::from_millis(20));
        }
    }
    fn keys(&mut self, keys: &[u8]) {
        self.master.write_all(keys).unwrap();
    }
    fn position(&self, label: &str) -> Option<(u16, u16)> {
        let (rows, columns) = self.screen.screen().size();
        for row in 0..rows {
            for column in 0..columns {
                if label.chars().enumerate().all(|(offset, c)| {
                    self.screen
                        .screen()
                        .cell(row, column + offset as u16)
                        .is_some_and(|cell| cell.contents() == c.to_string())
                }) {
                    return Some((row, column));
                }
            }
        }
        None
    }
    fn click(&mut self, label: &str) {
        self.wait_for(|s| s.position(label).is_some());
        let (row, column) = self.position(label).unwrap();
        self.keys(
            format!(
                "\x1b[<0;{};{}M\x1b[<0;{};{}m",
                column + 1,
                row + 1,
                column + 1,
                row + 1
            )
            .as_bytes(),
        );
    }
    fn file(&self, path: &str) -> bool {
        self.root.path().join(path).exists()
    }
    fn finish(&mut self) {
        self.finish_with(true);
    }
    fn finish_with(&mut self, success: bool) {
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            self.drain();
            if let Some(status) = self.child.try_wait().unwrap() {
                assert_eq!(status.success(), success, "{status}: {}", self.text());
                break;
            }
            assert!(
                Instant::now() < deadline,
                "console did not exit: {}",
                self.text()
            );
            thread::sleep(Duration::from_millis(20));
        }
        self.drain();
        assert_eq!(tcgetattr(&self.master).unwrap(), self.original);
        let raw = String::from_utf8_lossy(&self.output);
        assert!(raw.contains("\x1b[?1049l"));
        assert!(raw.contains("\x1b[?25h"));
        assert!(raw.contains("\x1b[?1006l"));
        assert_eq!(
            self.screen.screen().mouse_protocol_mode(),
            vt100::MouseProtocolMode::None
        );
    }
}
impl Drop for Console {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = kill(Pid::from_raw(self.child.id() as i32), Signal::SIGTERM);
            for _ in 0..100 {
                self.drain();
                if self.child.try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
fn script(path: &Path, body: &str) {
    fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}
fn process_stopped(pid: &str) -> bool {
    let output = Command::new("ps")
        .args(["-o", "stat=", "-p", pid.trim()])
        .output()
        .unwrap();
    let state = String::from_utf8_lossy(&output.stdout);
    state.trim().is_empty() || state.trim().starts_with('Z')
}

#[test]
fn mouse_can_start_stop_rerun_and_quit_the_client() {
    let mut console = Console::start();
    assert_eq!(
        console.screen.screen().mouse_protocol_encoding(),
        vt100::MouseProtocolEncoding::Sgr
    );
    console.click("[c] Desktop client");
    console.wait_for(|s| s.file("client.pid") && s.text().contains("[s Stop]"));
    let pid = fs::read_to_string(console.root.path().join("client.pid")).unwrap();
    console.click("[s Stop]");
    console.wait_for(|s| s.text().contains("Cancelled"));
    assert!(process_stopped(&pid));
    fs::remove_file(console.root.path().join("client.pid")).unwrap();
    console.click("[Ctrl+r Rerun]");
    console.wait_for(|s| s.file("client.pid"));
    console.click("[q Quit]");
    console.wait_for(|s| s.text().contains("Stop all tasks"));
    console.click("[y Stop & quit]");
    console.finish();
}

#[test]
fn mouse_test_menu_respects_confirmation_and_opens_results() {
    let mut console = Console::start();
    console.click("[t] Tests");
    console.click("[3] Selected suites");
    console.wait_for(|s| s.text().contains("Run the selected suites?"));
    assert!(!console.file("tests.started"));
    console.click("[Esc Cancel]");
    console.click("[t] Tests");
    console.click("[1] Changed unit tests");
    console.wait_for(|s| s.text().contains("No tests selected"));
    console.click("[Results]");
    console.wait_for(|s| {
        s.screen
            .screen()
            .contents_between(5, 30, 12, 109)
            .contains("No tests selected")
    });
    console.click("[q Quit]");
    console.finish();
}

#[test]
fn client_setup_can_be_confirmed_with_the_mouse() {
    let mut console = Console::start();
    fs::remove_dir_all(console.root.path().join("client/node_modules")).unwrap();
    console.click("[c] Desktop client");
    console.wait_for(|s| s.text().contains("Client setup"));
    assert!(!console.file("setup.started"));
    console.click("[y Install & start]");
    console.wait_for(|s| s.file("client.pid"));
    console.click("[q Quit]");
    console.click("[y Stop & quit]");
    console.finish();
}

#[test]
fn colors_can_be_disabled_without_disabling_mouse_controls() {
    for color in [true, false] {
        let mut console = Console::spawn_with_color(true, color);
        let header = console.screen.screen().cell(0, 1).unwrap();
        if color {
            assert!(matches!(header.bgcolor(), vt100::Color::Rgb(..)));
            assert_ne!(header.fgcolor(), header.bgcolor());
        } else {
            assert_eq!(header.fgcolor(), vt100::Color::Default);
            assert_eq!(header.bgcolor(), vt100::Color::Default);
        }
        console.click("[? Help]");
        console.click("[Esc Close]");
        console.click("[q Quit]");
        console.finish();
    }
}

#[test]
fn initialization_error_restores_terminal() {
    let mut console = Console::spawn(false);
    console.finish_with(false);
}

#[test]
fn fresh_client_setup_requires_confirmation_then_starts_the_client() {
    let mut console = Console::start();
    fs::remove_dir_all(console.root.path().join("client/node_modules")).unwrap();
    console.keys(b"c");
    console.wait_for(|s| s.text().contains("Client setup"));
    assert!(!console.file("setup.started") && !console.file("client.pid"));
    console.keys(b"n");
    console.keys(b"d");
    console.wait_for(|s| s.text().contains("Client setup"));
    console.keys(b"y");
    console.wait_for(|s| s.file("client.pid"));
    assert!(console.file("setup.started"));
    console.keys(b"qy");
    console.finish();
}

#[test]
fn failed_client_setup_does_not_start_the_client() {
    let mut console = Console::start();
    fs::remove_dir_all(console.root.path().join("client/node_modules")).unwrap();
    fs::write(console.root.path().join("fail-setup"), "").unwrap();
    console.keys(b"cy");
    console.wait_for(|s| s.text().contains("Failed"));
    assert!(console.text().contains("installation-failed"));
    assert!(!console.file("client.pid"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn client_setup_blocks_tests_and_can_be_cancelled() {
    let mut console = Console::start();
    fs::remove_dir_all(console.root.path().join("client/node_modules")).unwrap();
    fs::write(console.root.path().join("hold-setup"), "").unwrap();
    console.keys(b"cy");
    console.wait_for(|s| s.file("setup.started"));
    console.keys(b"t2");
    console.wait_for(|s| s.text().contains("Wait for client setup"));
    assert!(!console.file("tests.started"));
    console.keys(b"s");
    console.wait_for(|s| s.text().contains("Cancelled"));
    assert!(!console.file("client.pid"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn inspect_with_pi_replaces_the_console_and_keeps_the_full_test_evidence() {
    let mut console = Console::start();
    fs::create_dir_all(console.root.path().join("node_modules/.bin")).unwrap();
    fs::write(console.root.path().join("node_modules/.bin/pi"), "fixture").unwrap();
    script(
        &console.root.path().join("bin/node"),
        r#"
case "$1" in
  */node_modules/.bin/pi)
    test -t 0 && test -t 1 && test -t 2 || exit 90
    prompt=$3
    directory=${prompt#*local evidence in }
    directory=${directory%%: summary.json*}
    /bin/cat "$directory/summary.json" > pi.summary || exit 91
    test -r "$directory/report.json" && test -r "$directory/output.log" || exit 92
    printf '%s\n' "$@" > pi.args
    pwd > pi.cwd
    echo pi-started
    exit 0
    ;;
esac
if [ "$1" = tools/test.mjs ]; then
  index=0
  while [ "$index" -lt 3200 ]; do
    printf 'test-line-%s\n' "$index" >&2
    index=$((index + 1))
  done
  printf '%s' '{"status":"failed","results":[{"id":"fixture-suite","status":"failed","durationMs":1,"exitCode":1,"error":"fixture failure"}]}'
  exit 1
fi
exit 99
"#,
    );
    console.keys(b"t1");
    console.wait_for(|s| s.text().contains("Failed") && s.text().contains("test-line-3199"));
    console.keys(b"i");
    console.wait_for(|s| s.file("pi.args"));
    console.finish();
    let args = fs::read_to_string(console.root.path().join("pi.args")).unwrap();
    let arguments: Vec<_> = args.lines().collect();
    assert_eq!(arguments.len(), 3);
    assert_eq!(arguments[1], "--");
    let directory = arguments[2]
        .split_once("local evidence in ")
        .unwrap()
        .1
        .split_once(": summary.json")
        .unwrap()
        .0;
    let directory = Path::new(directory);
    let output = fs::read_to_string(directory.join("output.log")).unwrap();
    assert!(output.contains("test-line-0\n"));
    assert!(output.contains("test-line-3199\n"));
    let summary: serde_json::Value =
        serde_json::from_slice(&fs::read(directory.join("summary.json")).unwrap()).unwrap();
    assert_eq!(summary["status"], "Failed");
    let pi_summary: serde_json::Value =
        serde_json::from_slice(&fs::read(console.root.path().join("pi.summary")).unwrap()).unwrap();
    assert_eq!(pi_summary, summary);
    assert_eq!(summary["runFinished"], true);
    assert_eq!(summary["outputCapturedFromStart"], true);
    assert!(summary["memoryLinesDiscarded"].as_u64().unwrap() > 0);
    let report: serde_json::Value =
        serde_json::from_slice(&fs::read(directory.join("report.json")).unwrap()).unwrap();
    assert_eq!(report["results"][0]["error"], "fixture failure");
    assert_eq!(
        fs::read_to_string(console.root.path().join("pi.cwd"))
            .unwrap()
            .trim(),
        console
            .root
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
    );
    assert!(!console.file("release.args"));
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn inspect_with_pi_stops_owned_tasks_before_handoff() {
    let mut console = Console::start();
    fs::create_dir_all(console.root.path().join("node_modules/.bin")).unwrap();
    fs::write(console.root.path().join("node_modules/.bin/pi"), "fixture").unwrap();
    console.keys(b"d");
    console.wait_for(|s| s.file("client.pid") && s.text().contains("client output"));
    let pid = fs::read_to_string(console.root.path().join("client.pid")).unwrap();
    script(
        &console.root.path().join("bin/node"),
        "test -t 0 && test -t 1 || exit 90\nprintf '%s\\n' \"$@\" > pi.args\nexit 0",
    );
    console.keys(b"i");
    console.wait_for(|s| s.file("pi.args"));
    console.finish();
    assert!(process_stopped(pid.trim()));
    let args = fs::read_to_string(console.root.path().join("pi.args")).unwrap();
    let prompt = args.lines().nth(2).unwrap();
    let directory = prompt
        .split_once("local evidence in ")
        .unwrap()
        .1
        .split_once(": summary.json")
        .unwrap()
        .0;
    let summary: serde_json::Value =
        serde_json::from_slice(&fs::read(Path::new(directory).join("summary.json")).unwrap())
            .unwrap();
    assert_eq!(summary["outputCapturedFromStart"], false);
    assert_eq!(summary["status"], "Cancelled");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn application_diagnostics_navigation_is_read_only_and_restores_terminal() {
    let mut console = Console::start();
    let directory = console.root.path().join("client/logs");
    fs::create_dir(&directory).unwrap();
    let record = |session: &str, event: &str| {
        format!(
            "{}\n",
            serde_json::json!({
                "schema_version":1,"timestamp_ms":42,"level":"info","category":"app",
                "origin":"native","event":event,"session_id":session
            })
        )
    };
    let session = "11111111-1111-4111-8111-111111111111";
    let file = directory.join("segment-00000000000000000000.jsonl");
    let mut first = record(session, "app.begin");
    for index in 0..40 {
        first.push_str(&record(session, &format!("app.step{index}")));
    }
    first.push_str(&record(session, "app.started"));
    first.push_str(&record(
        "22222222-2222-4222-8222-222222222222",
        "other.session",
    ));
    fs::write(&file, &first).unwrap();
    script(
        &console.root.path().join("bin/npm"),
        r#"
printf '%s' "$SITUATE_DEV_DIAGNOSTICS_MANIFEST" > ../manifest.path
printf '{"version":1,"directory":"%s/logs","session_id":"11111111-1111-4111-8111-111111111111","status":"ready"}' "$PWD" > "$SITUATE_DEV_DIAGNOSTICS_MANIFEST"
echo $$ > ../client.pid
while :; do sleep 1; done
"#,
    );
    console.keys(b"c");
    console.wait_for(|s| s.file("client.pid"));
    console.click("[o Application]");
    console.wait_for(|s| s.text().contains("app.started"));
    assert!(!console.text().contains("other.session"));
    console.keys(b"\x1b[H");
    console.wait_for(|s| s.text().contains("app.begin"));
    console.keys(b"\x1b[F");
    console.wait_for(|s| s.text().contains("app.started"));
    console.click("[p Pause]");
    console.wait_for(|s| s.text().contains("Viewer paused"));
    let input = first + &record(session, "app.stopped");
    fs::write(&file, &input).unwrap();
    console.click("[p Pause]");
    console.wait_for(|s| s.text().contains("app.stopped"));
    console.keys(b"l");
    console.wait_for(|s| s.text().contains("Level >= debug"));
    console.keys(b"g");
    console.wait_for(|s| s.text().contains("category: app"));
    console.keys(b"x");
    console.wait_for(|s| s.text().contains("trace: all"));
    console.click("[o Process output]");
    console.wait_for(|s| s.text().contains("[s Stop]"));
    let manifest = fs::read_to_string(console.root.path().join("manifest.path")).unwrap();
    assert!(Path::new(&manifest).is_absolute());
    assert_eq!(
        fs::metadata(Path::new(&manifest).parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    console.keys(b"qy");
    console.finish();
    assert_eq!(fs::read_to_string(&file).unwrap(), input);
    assert!(!Path::new(&manifest).exists());
}

#[test]
fn workshop_application_view_does_not_substitute_process_output() {
    let mut console = Console::start();
    console.keys(b"d");
    console.wait_for(|s| s.text().contains("client output"));
    // Fragment reads to expose the heading before the old output is cleared.
    console.read_limit = 8;
    console.keys(b"o");
    console.wait_for(|s| {
        let screen = s.text();
        screen.contains("No native collector") && !screen.contains("client output")
    });
    console.read_limit = 16384;
    console.keys(b"o");
    console.wait_for(|s| s.text().contains("client output"));
    console.keys(b"qy");
    console.finish();
}

#[cfg(target_os = "macos")]
#[test]
fn dragging_logs_exposes_copy_without_disabling_mouse_controls() {
    let mut console = Console::start();
    console.keys(b"d");
    console.wait_for(|s| s.position("client output").is_some());
    assert!(!console.text().contains("[Copy]"));
    let (row, column) = console.position("client output").unwrap();
    console.keys(
        format!(
            "\x1b[<0;{};{}M\x1b[<32;{};{}M\x1b[<0;{};{}m",
            column + 1,
            row + 1,
            column + 6,
            row + 1,
            column + 6,
            row + 1
        )
        .as_bytes(),
    );
    console.wait_for(|s| s.text().contains("[Copy]"));
    console.keys(b"\x1b");
    console.wait_for(|s| !s.text().contains("[Copy]"));
    console.click("[s Stop]");
    console.wait_for(|s| s.text().contains("Cancelled"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn normal_quit_restores_terminal() {
    let mut console = Console::start();
    console.keys(b"q");
    console.finish();
}

#[test]
fn full_tests_require_confirmation_and_empty_selection_is_visible() {
    let mut console = Console::start();
    console.keys(b"t3");
    console.wait_for(|s| s.text().contains("Run the selected suites?"));
    assert!(!console.file("tests.started"));
    console.keys(b"y");
    console.wait_for(|s| s.text().contains("No tests selected"));
    assert!(console.file("tests.started"));
    console.keys(b"e");
    console.wait_for(|s| s.text().contains("Results"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn preview_actions_open_once_and_support_stop_rerun_and_quit() {
    for (action, shortcut, expected) in [
        (
            "[w] Build & open website",
            b"w",
            "website/site.mjs\n--build\n--serve\n",
        ),
        (
            "[r] Requirements preview",
            b"r",
            "requirements/scripts/preview.js\n",
        ),
    ] {
        let mut console = Console::start();
        fs::remove_dir_all(console.root.path().join("client/node_modules")).unwrap();
        fs::write(console.root.path().join("slow-process-inspection"), "").unwrap();
        console.click(action);
        console.wait_for(|s| s.file("browser.opened"));
        assert!(!console.file("setup.started"));
        assert_eq!(
            fs::read_to_string(console.root.path().join("website.args")).unwrap(),
            expected
        );
        assert_eq!(
            fs::read_to_string(console.root.path().join("browser.args")).unwrap(),
            "http://127.0.0.1:43127/\n"
        );
        console.keys(shortcut);
        console.wait_for(|s| s.text().contains("already running"));
        let pid = fs::read_to_string(console.root.path().join("website.pid")).unwrap();
        console.keys(b"s");
        console.wait_for(|s| s.text().contains("Cancelled"));
        assert!(process_stopped(&pid));
        fs::remove_file(console.root.path().join("browser.opened")).unwrap();
        console.keys(b"\x12");
        console.wait_for(|s| s.file("browser.opened"));
        assert_eq!(
            fs::read_to_string(console.root.path().join("browser.args"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        let pid = fs::read_to_string(console.root.path().join("website.pid")).unwrap();
        console.keys(b"qy");
        console.finish();
        assert!(process_stopped(&pid));
    }
}

#[test]
fn website_build_failure_and_early_cancellation_do_not_open_a_browser() {
    for marker in ["fail-website", "hold-website"] {
        let mut console = Console::start();
        fs::write(console.root.path().join(marker), "").unwrap();
        console.keys(b"w");
        console.wait_for(|s| s.file("website.pid"));
        if marker == "fail-website" {
            console.wait_for(|s| s.text().contains("Failed"));
            assert!(console.text().contains("website-build-failed"));
        } else {
            console.keys(b"s");
            console.wait_for(|s| s.text().contains("Cancelled"));
        }
        assert!(!console.file("browser.opened"));
        assert!(!console.file("browser.args"));
        let pid = fs::read_to_string(console.root.path().join("website.pid")).unwrap();
        assert!(process_stopped(&pid));
        console.keys(b"q");
        console.finish();
    }
}

#[test]
fn website_browser_failure_stops_the_server_and_is_reported() {
    let mut console = Console::start();
    fs::write(console.root.path().join("slow-process-inspection"), "").unwrap();
    fs::write(console.root.path().join("fail-browser"), "").unwrap();
    console.keys(b"w");
    console.wait_for(|s| {
        s.text().contains("Failed") && s.text().contains("Could not open the preview")
    });
    assert!(!console.file("browser.opened"));
    let pid = fs::read_to_string(console.root.path().join("website.pid")).unwrap();
    assert!(process_stopped(&pid));
    console.keys(b"q");
    console.finish();
}

#[test]
fn browser_opens_only_after_successful_render() {
    let mut console = Console::start();
    fs::write(console.root.path().join("fail-render"), "").unwrap();
    console.keys(b"a");
    console.wait_for(|s| s.text().contains("render-failed"));
    assert!(!console.file("browser.opened"));
    console.wait_for(|s| s.text().contains("Failed"));
    fs::remove_file(console.root.path().join("fail-render")).unwrap();
    console.keys(b"\x12");
    console.wait_for(|s| s.file("browser.opened"));
    assert!(console.file("docs/architecture/index.html"));
    console.wait_for(|s| s.text().contains("Passed"));
    console.keys(b"q");
    console.finish();
}

#[test]
fn quit_remains_responsive_during_output_flood_and_stops_client() {
    let mut console = Console::start();
    console.keys(b"c");
    console.wait_for(|s| s.file("client.pid"));
    let pid = fs::read_to_string(console.root.path().join("client.pid")).unwrap();
    console.keys(b"q");
    console.wait_for(|s| s.text().contains("Stop all tasks"));
    console.keys(b"y");
    console.finish();
    assert!(process_stopped(&pid));
}

#[test]
fn termination_signals_restore_terminal_and_stop_owned_tasks() {
    for signal in [Signal::SIGINT, Signal::SIGTERM, Signal::SIGHUP] {
        let mut console = Console::start();
        console.keys(b"c");
        console.wait_for(|s| s.file("client.pid"));
        let pid = fs::read_to_string(console.root.path().join("client.pid")).unwrap();
        kill(Pid::from_raw(console.child.id() as i32), signal).unwrap();
        console.finish();
        assert!(process_stopped(&pid));
    }
}
