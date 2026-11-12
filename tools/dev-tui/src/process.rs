use crate::{
    actions::{CommandSpec, browser_target},
    owned::OwnedProcesses,
    text,
};
use nix::sys::signal::Signal;
use std::{io, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::{mpsc, watch},
    task::JoinHandle,
};

struct Foreground {
    previous: i32,
    handler: nix::libc::sighandler_t,
}
impl Foreground {
    fn give_to(pid: u32) -> io::Result<Self> {
        // Ignore job-control suspension only while transferring the terminal.
        unsafe {
            let previous = nix::libc::tcgetpgrp(0);
            let handler = nix::libc::signal(nix::libc::SIGTTOU, nix::libc::SIG_IGN);
            if nix::libc::tcsetpgrp(0, pid as i32) == -1 {
                nix::libc::signal(nix::libc::SIGTTOU, handler);
                return Err(io::Error::last_os_error());
            }
            nix::libc::kill(-(pid as i32), nix::libc::SIGCONT);
            Ok(Self { previous, handler })
        }
    }
}
impl Drop for Foreground {
    fn drop(&mut self) {
        unsafe {
            nix::libc::tcsetpgrp(0, self.previous);
            nix::libc::signal(nix::libc::SIGTTOU, self.handler);
        }
    }
}

pub const REPORT_LIMIT: usize = 8 * 1024 * 1024;
const LINE_LIMIT: usize = 4096;
const STOP_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub enum Event {
    Followup(usize),
    Output(usize, String),
    Finished(usize, Outcome),
}
#[derive(Clone, Debug, Default)]
pub struct Outcome {
    pub code: Option<i32>,
    pub cancelled: bool,
    pub report: Vec<u8>,
    pub error: Option<String>,
}
impl Outcome {
    pub fn success(&self) -> bool {
        self.code == Some(0) && !self.cancelled && self.error.is_none()
    }
}

pub fn clean(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&strip_ansi_escapes::strip(bytes))
        .chars()
        .filter(|c| !c.is_control() || *c == '\t')
        .collect()
}

struct Capture {
    bytes: Vec<u8>,
    overflow: bool,
}
async fn read_output(
    mut pipe: impl AsyncRead + Unpin,
    id: usize,
    tx: mpsc::Sender<Event>,
    report: bool,
) -> io::Result<Capture> {
    let mut buffer = [0; 4096];
    let mut capture = Capture {
        bytes: Vec::new(),
        overflow: false,
    };
    let mut line = Vec::new();
    loop {
        let n = pipe.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        if report {
            let available = REPORT_LIMIT.saturating_sub(capture.bytes.len());
            capture.bytes.extend_from_slice(&buffer[..n.min(available)]);
            capture.overflow |= n > available;
        } else {
            for byte in &buffer[..n] {
                if *byte == b'\n' || *byte == b'\r' || line.len() >= LINE_LIMIT {
                    if !line.is_empty() {
                        if tx.send(Event::Output(id, clean(&line))).await.is_err() {
                            return Ok(capture);
                        }
                        line.clear();
                    }
                    if *byte == b'\n' || *byte == b'\r' {
                        continue;
                    }
                }
                line.push(*byte);
            }
        }
    }
    if !line.is_empty() {
        let _ = tx.send(Event::Output(id, clean(&line))).await;
    }
    Ok(capture)
}

async fn cancelled(stop: &mut watch::Receiver<bool>) {
    if *stop.borrow() {
        return;
    }
    let _ = stop.changed().await;
}

pub async fn execute(
    spec: CommandSpec,
    id: usize,
    tx: mpsc::Sender<Event>,
    mut stop: watch::Receiver<bool>,
) -> Outcome {
    if *stop.borrow() {
        return Outcome {
            cancelled: true,
            ..Outcome::default()
        };
    }
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(if spec.interactive {
            Stdio::inherit()
        } else {
            Stdio::null()
        })
        .stdout(if spec.interactive {
            Stdio::inherit()
        } else if spec.handoff {
            Stdio::null()
        } else {
            Stdio::piped()
        })
        .stderr(if spec.interactive {
            Stdio::inherit()
        } else if spec.handoff {
            Stdio::null()
        } else {
            Stdio::piped()
        })
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .kill_on_drop(true)
        .process_group(0);
    command.env_remove(crate::application_logs::MANIFEST_ENV);
    if let Some(path) = &spec.diagnostics_manifest {
        command.env(crate::application_logs::MANIFEST_ENV, path);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            return Outcome {
                error: Some(format!("{} ({}): {e}", text::START_FAILED, spec.program)),
                ..Outcome::default()
            };
        }
    };
    let _foreground = if spec.interactive {
        match Foreground::give_to(child.id().expect("spawned editor")) {
            Ok(guard) => Some(guard),
            Err(error) => {
                let _ = child.kill().await;
                return Outcome {
                    error: Some(error.to_string()),
                    ..Outcome::default()
                };
            }
        }
    } else {
        None
    };
    let mut owned = match OwnedProcesses::new(child.id().expect("spawned child has an id")) {
        Ok(owned) => owned,
        Err(error) => {
            let _ = child.kill().await;
            return Outcome {
                error: Some(format!("{}: {error}", text::PROCESS_TABLE)),
                ..Outcome::default()
            };
        }
    };
    let stdout: Box<dyn AsyncRead + Send + Unpin> = child.stdout.take().map_or_else(
        || Box::new(tokio::io::empty()) as _,
        |pipe| Box::new(pipe) as _,
    );
    let stderr: Box<dyn AsyncRead + Send + Unpin> = child.stderr.take().map_or_else(
        || Box::new(tokio::io::empty()) as _,
        |pipe| Box::new(pipe) as _,
    );
    let mut stdout = tokio::spawn(read_output(stdout, id, tx.clone(), spec.report));
    let mut stderr = tokio::spawn(read_output(stderr, id, tx, false));
    let mut outcome = Outcome::default();
    let mut stop_deadline = None;
    let mut refresh = tokio::time::interval(Duration::from_millis(200));
    refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let status = loop {
        tokio::select! {
            status = child.wait() => break status,
            () = cancelled(&mut stop) => {
                outcome.cancelled = true;
                let deadline = tokio::time::Instant::now() + STOP_GRACE;
                stop_deadline = Some(deadline);
                if let Err(error) = owned.signal(Signal::SIGTERM) { outcome.error = Some(error.to_string()); }
                break match tokio::time::timeout_at(deadline, child.wait()).await {
                    Ok(status) => status,
                    Err(_) => {
                        if let Err(error) = owned.signal(Signal::SIGKILL) { outcome.error = Some(error.to_string()); }
                        let _ = child.start_kill();
                        child.wait().await
                    }
                };
            }
            _ = refresh.tick() => {
                if let Err(error) = owned.refresh() {
                    outcome.error = Some(format!("{}: {error}", text::PROCESS_TABLE));
                    let _ = child.start_kill();
                    break child.wait().await;
                }
                // Slow inspections must yield before the enclosing browser loop polls cancellation.
                refresh.reset();
            }
        }
    };
    match status {
        Ok(status) => outcome.code = status.code(),
        Err(e) => outcome.error = Some(e.to_string()),
    }
    outcome.cancelled |= *stop.borrow();
    // Launchers can exit before their applications finish flushing on SIGTERM.
    if let Some(deadline) = stop_deadline {
        while tokio::time::Instant::now() < deadline {
            match owned.has_live_processes() {
                Ok(false) => break,
                Err(error) => {
                    outcome.error = Some(error.to_string());
                    break;
                }
                Ok(true) => tokio::time::sleep(Duration::from_millis(50)).await,
            }
        }
    }
    // Successful browser handoffs outlive the console and do not retain its pipes.
    if !(spec.handoff && outcome.success())
        && let Err(error) = owned.signal(Signal::SIGKILL)
    {
        outcome.error = Some(error.to_string());
    }
    owned.disarm();
    let drained = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::join!(&mut stdout, &mut stderr)
    })
    .await;
    match drained {
        Ok((out, err)) => {
            for result in [out, err] {
                match result {
                    Ok(Ok(capture)) if capture.overflow => {
                        outcome.error = Some(text::REPORT_TOO_LARGE.into())
                    }
                    Ok(Ok(capture)) if !capture.bytes.is_empty() => outcome.report = capture.bytes,
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => outcome.error = Some(e.to_string()),
                    Err(e) => outcome.error = Some(e.to_string()),
                }
            }
        }
        Err(_) => {
            stdout.abort();
            stderr.abort();
            outcome.error = Some(text::PIPE_TIMEOUT.into());
        }
    }
    outcome.cancelled |= *stop.borrow();
    outcome
}

fn website_url(line: &str) -> Option<&str> {
    let url = line
        .strip_prefix(text::WEBSITE_READY)
        .or_else(|| line.strip_prefix(text::REQUIREMENTS_READY))?;
    let port = url.strip_prefix("http://127.0.0.1:")?.strip_suffix('/')?;
    if port.is_empty()
        || !port.bytes().all(|c| c.is_ascii_digit())
        || port.parse::<u16>().ok()? == 0
    {
        return None;
    }
    Some(url)
}

async fn execute_with_browser(
    spec: CommandSpec,
    mut opener: CommandSpec,
    id: usize,
    tx: mpsc::Sender<Event>,
    mut stop: watch::Receiver<bool>,
) -> Outcome {
    let (events, mut received) = mpsc::channel(128);
    let (cancel, stopped) = watch::channel(*stop.borrow());
    let command = execute(spec, id, events, stopped.clone());
    tokio::pin!(command);
    let mut browser: Option<JoinHandle<Outcome>> = None;
    let mut attempted = false;
    let mut failure = None;
    loop {
        tokio::select! {
            mut outcome = &mut command => {
                let _ = cancel.send(true);
                if let Some(worker) = browser {
                    let opened = worker.await.is_ok_and(|result| result.success());
                    if outcome.success() && !opened && !*stop.borrow() {
                        failure = Some(text::WEBSITE_OPEN_FAILED.into());
                    }
                }
                // The command may exit before its final output reaches the forwarding loop.
                while let Ok(event) = received.try_recv() {
                    let _ = tx.send(event).await;
                }
                if let Some(error) = failure {
                    outcome.error = Some(error);
                    outcome.cancelled = *stop.borrow();
                } else if outcome.success() && !attempted {
                    outcome.error = Some(text::WEBSITE_NOT_READY.into());
                }
                outcome.cancelled |= *stop.borrow();
                return outcome;
            }
            Some(event) = received.recv() => {
                if let Event::Output(_, ref line) = event
                    && !attempted && !*stopped.borrow() && !*stop.borrow()
                    && let Some(url) = website_url(line)
                {
                    attempted = true;
                    opener.args = vec![url.into()];
                    // The opener is a sibling of the server, so server cleanup cannot adopt a successful browser handoff.
                    browser = Some(tokio::spawn(execute(opener.clone(), id, tx.clone(), stopped.clone())));
                }
                if tx.send(event).await.is_err() {
                    let _ = cancel.send(true);
                }
            }
            result = async { browser.as_mut().expect("active browser worker").await }, if browser.is_some() => {
                browser = None;
                match result {
                    Ok(outcome) if outcome.success() => {
                        let _ = tx.send(Event::Output(id, text::WEBSITE_OPENED.into())).await;
                    }
                    Ok(outcome) if outcome.cancelled && *stop.borrow() => {}
                    result => {
                        let detail = match result {
                            Ok(outcome) => outcome.error.unwrap_or_else(|| format!("{}: {:?}", text::EXIT, outcome.code)),
                            Err(error) => error.to_string(),
                        };
                        failure = Some(format!("{} {detail}", text::WEBSITE_OPEN_FAILED));
                        let _ = cancel.send(true);
                    }
                }
            }
            () = cancelled(&mut stop), if !*stopped.borrow() => {
                let _ = cancel.send(true);
            }
        }
    }
}

pub fn start(
    id: usize,
    spec: CommandSpec,
    after_success: Option<CommandSpec>,
    tx: mpsc::Sender<Event>,
    stop: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        if let Some(root) = &spec.release_validation {
            let mut validation = crate::release::command(root, "validate", "");
            if spec
                .args
                .windows(2)
                .any(|args| args == ["--distribution", "direct"])
            {
                validation
                    .args
                    .extend(["--distribution".into(), "direct".into()]);
            }
            let outcome = execute(validation, id, tx.clone(), stop.clone()).await;
            if !outcome.success() {
                let _ = tx.send(Event::Finished(id, outcome)).await;
                return;
            }
        }
        let mut outcome = if spec.open_browser {
            let opener = browser_target(&spec.cwd, "");
            execute_with_browser(spec, opener, id, tx.clone(), stop.clone()).await
        } else {
            execute(spec, id, tx.clone(), stop.clone()).await
        };
        if outcome.success()
            && let Some(next) = after_success
        {
            let browser_handoff = next.handoff;
            let _ = tx.send(Event::Followup(id)).await;
            let _ = tx
                .send(Event::Output(id, format!("> {}", next.display())))
                .await;
            outcome = execute(next, id, tx.clone(), stop).await;
            if browser_handoff && !outcome.success() && !outcome.cancelled {
                outcome.error = Some(format!(
                    "{} {}",
                    text::OPEN_FAILED,
                    outcome.error.unwrap_or_default()
                ));
            }
        }
        let _ = tx.send(Event::Finished(id, outcome)).await;
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    async fn run(script: &str, report: bool) -> (Outcome, Vec<String>) {
        let (tx, mut rx) = mpsc::channel(128);
        let (_stop, stop) = watch::channel(false);
        let mut spec = CommandSpec::new("sh", &["-c", script], Path::new("/"));
        spec.report = report;
        let reader = tokio::spawn(async move {
            let mut lines = vec![];
            while let Some(Event::Output(_, line)) = rx.recv().await {
                lines.push(line);
            }
            lines
        });
        let outcome = execute(spec, 0, tx, stop).await;
        (outcome, reader.await.unwrap())
    }
    #[tokio::test]
    async fn captures_both_streams_and_nonzero_exit() {
        let (out, lines) = run("printf 'out\\n'; printf 'err\\n' >&2; exit 7", false).await;
        assert_eq!(out.code, Some(7));
        assert!(lines.contains(&"out".into()) && lines.contains(&"err".into()));
    }
    #[tokio::test]
    async fn keeps_json_stdout_separate_from_logs() {
        let (out, lines) = run(
            "printf '{\"status\":\"no-tests\"}'; printf 'progress\\n' >&2",
            true,
        )
        .await;
        assert_eq!(out.report, br#"{"status":"no-tests"}"#);
        assert_eq!(lines, ["progress"]);
    }
    #[tokio::test]
    async fn stops_the_owned_process_group_without_stopping_other_commands() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("child.pid");
        let script = format!("sleep 60 & echo $! > '{}'; wait", pid_file.display());
        let (tx, mut rx) = mpsc::channel(128);
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(execute(
            CommandSpec::new("sh", &["-c", &script], dir.path()),
            0,
            tx,
            stopped,
        ));
        let mut unrelated = Command::new("sleep")
            .arg("60")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while !pid_file.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid: i32 = std::fs::read_to_string(pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        stop.send(true).unwrap();
        while rx.recv().await.is_some() {}
        assert!(
            tokio::time::timeout(Duration::from_secs(8), task)
                .await
                .unwrap()
                .unwrap()
                .cancelled
        );
        assert!(unrelated.try_wait().unwrap().is_none());
        unrelated.kill().await.unwrap();
        // A terminated descendant can briefly remain as an init-owned zombie.
        let status = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&status.stdout);
        assert!(
            state.trim().is_empty() || state.trim().starts_with('Z'),
            "{state}"
        );
    }
    #[tokio::test]
    async fn missing_tool_is_a_visible_failure() {
        let (tx, _rx) = mpsc::channel(1);
        let (_stop, stop) = watch::channel(false);
        let out = execute(
            CommandSpec::new("/nonexistent/situate-tool", &[], Path::new("/")),
            0,
            tx,
            stop,
        )
        .await;
        assert!(out.error.unwrap().contains(text::START_FAILED));
    }
    #[tokio::test]
    async fn bounds_reports_and_splits_oversized_log_lines() {
        let (tx, mut rx) = mpsc::channel(16);
        let capture = read_output(
            tokio::io::repeat(b'x').take(REPORT_LIMIT as u64 + 1),
            0,
            tx.clone(),
            true,
        )
        .await
        .unwrap();
        assert!(capture.overflow);
        assert_eq!(capture.bytes.len(), REPORT_LIMIT);
        let bytes = vec![b'x'; LINE_LIMIT * 3 + 1];
        read_output(bytes.as_slice(), 0, tx, false).await.unwrap();
        let mut lengths = vec![];
        while let Ok(Event::Output(_, line)) = rx.try_recv() {
            lengths.push(line.len());
        }
        assert_eq!(lengths, [LINE_LIMIT, LINE_LIMIT, LINE_LIMIT, 1]);
    }
    #[tokio::test]
    async fn successful_browser_handoff_preserves_the_opened_process() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel(16);
        let (_stop, stop) = watch::channel(false);
        let mut spec = CommandSpec::new(
            "sh",
            &["-c", "sleep 60 & echo $! > browser.pid"],
            dir.path(),
        );
        spec.handoff = true;
        let outcome = execute(spec, 0, tx, stop).await;
        let pid: i32 = std::fs::read_to_string(dir.path().join("browser.pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let pid = nix::unistd::Pid::from_raw(pid);
        let alive = nix::sys::signal::kill(pid, None).is_ok();
        let _ = nix::sys::signal::kill(pid, Signal::SIGKILL);
        assert!(outcome.success(), "{outcome:?}");
        assert!(alive);
    }
    #[test]
    #[ignore]
    fn detached_fixture() {
        use std::os::unix::process::CommandExt;
        if !Path::new("fixture.enabled").exists() {
            return;
        }
        let mut command = if Path::new("fixture.cleanup").exists() {
            let mut command = std::process::Command::new("sh");
            // A foreground sleep can defer TERM after an earlier child was signalled.
            // The shell's builtin wait is interruptible, even for a replacement child.
            // Its isolated group lets the trap reap sleepers without a PID-assignment race.
            command.args([
                "-c",
                r#"trap 'trap "" TERM; kill -TERM 0; wait; sleep 0.15; echo cleaned > cleanup.done; exit 0' TERM
while :; do
    sleep 60 &
    echo ready > trap.ready
    wait
done"#,
            ]);
            command
        } else {
            let mut command = std::process::Command::new("sleep");
            command.arg("60");
            command
        };
        let mut child = command.process_group(0).spawn().unwrap();
        std::fs::write("detached.pid", child.id().to_string()).unwrap();
        child.wait().unwrap();
    }
    #[tokio::test]
    async fn cancellation_stops_detached_descendants() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("fixture.enabled"), "").unwrap();
        let executable = std::env::current_exe().unwrap();
        let (tx, mut rx) = mpsc::channel(128);
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(execute(
            CommandSpec::new(
                executable.to_str().unwrap(),
                &["--ignored", "--exact", "process::tests::detached_fixture"],
                dir.path(),
            ),
            0,
            tx,
            stopped,
        ));
        tokio::time::timeout(Duration::from_secs(5), async {
            while !dir.path().join("detached.pid").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(dir.path().join("detached.pid")).unwrap();
        stop.send(true).unwrap();
        while rx.recv().await.is_some() {}
        assert!(
            tokio::time::timeout(Duration::from_secs(8), task)
                .await
                .unwrap()
                .unwrap()
                .cancelled
        );
        let status = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", pid.trim()])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&status.stdout);
        let stopped = state.trim().is_empty() || state.trim().starts_with('Z');
        if !stopped {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid.trim().parse().unwrap()),
                Signal::SIGKILL,
            );
        }
        assert!(stopped, "{state}");
    }
    #[tokio::test]
    async fn stop_allows_descendant_cleanup_after_launcher_exits() {
        let dir = tempfile::tempdir().unwrap();
        for file in ["fixture.enabled", "fixture.cleanup"] {
            std::fs::write(dir.path().join(file), "").unwrap();
        }
        let executable = std::env::current_exe().unwrap();
        let (tx, mut rx) = mpsc::channel(128);
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(execute(
            CommandSpec::new(
                executable.to_str().unwrap(),
                &["--ignored", "--exact", "process::tests::detached_fixture"],
                dir.path(),
            ),
            0,
            tx,
            stopped,
        ));
        tokio::time::timeout(Duration::from_secs(5), async {
            while !dir.path().join("trap.ready").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        stop.send(true).unwrap();
        while rx.recv().await.is_some() {}
        assert!(
            tokio::time::timeout(Duration::from_secs(8), task)
                .await
                .unwrap()
                .unwrap()
                .cancelled
        );
        assert!(dir.path().join("cleanup.done").exists());
    }
    #[test]
    fn website_readiness_accepts_only_a_loopback_origin_with_a_valid_port() {
        assert_eq!(
            website_url("Website preview: http://127.0.0.1:43127/"),
            Some("http://127.0.0.1:43127/")
        );
        for line in [
            "Website preview: https://example.com/",
            "Website preview: http://127.0.0.1:0/",
            "Website preview: http://127.0.0.1:65536/",
            "Website preview: http://127.0.0.1:43127/private",
            "Website preview: http://127.0.0.1:43127/?token=private",
            "Website preview: http://127.0.0.1:43127/@example.com",
            "Website preview: http://127.0.0.1:43127/\n",
            "Website preview: http://127.0.0.1:+43127/",
            "Website preview: http://127.0.0.1:43127@evil/",
        ] {
            assert_eq!(website_url(line), None, "{line}");
        }
    }
    #[test]
    fn strips_terminal_controls() {
        assert_eq!(clean(b"\x1b[31mred\x1b[0m\x07\x1b]52;c;secret\x07"), "red");
    }
}
