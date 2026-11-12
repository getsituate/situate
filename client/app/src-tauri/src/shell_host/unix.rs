use super::{CommandOutcome, CommandOutput, CommandRequest, CommandResult, ShellError};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::time::{Instant, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

const DRAIN_TIMEOUT: Duration = Duration::from_millis(500);

struct OwnedGroup {
    child: Child,
    group: Option<libc::pid_t>,
}

impl OwnedGroup {
    fn terminate(&mut self) -> Result<(), ShellError> {
        if let Some(group) = self.group {
            // The unreaped leader pins the group ID until after this signal.
            let result = unsafe { libc::kill(-group, libc::SIGKILL) };
            if result != 0 {
                let error = std::io::Error::last_os_error().raw_os_error();
                if error != Some(libc::ESRCH) && !zombie_only_group(group, error) {
                    return Err(ShellError::WaitFailed);
                }
            }
            self.group = None;
        }
        Ok(())
    }

    fn exited(&self) -> Result<bool, ShellError> {
        let Some(pid) = self.group else {
            return Err(ShellError::WaitFailed);
        };
        // WNOWAIT observes exit without releasing the PID for reuse. Child::wait
        // is deliberately not polled until the entire owned group is signalled.
        let mut status: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut status,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result != 0 {
            if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                return Ok(false);
            }
            return Err(ShellError::WaitFailed);
        }
        Ok(unsafe { status.si_pid() } != 0)
    }
}

impl Drop for OwnedGroup {
    fn drop(&mut self) {
        let _ = self.terminate();
        // kill_on_drop also arranges asynchronous reaping if the caller abandons
        // this future. Normal cancellation awaits cleanup before reconciliation.
    }
}

#[cfg(target_os = "macos")]
fn zombie_only_group(group: libc::pid_t, error: Option<i32>) -> bool {
    // Darwin reports EPERM when no live group member can receive the signal.
    // Do not mistake a live, unsignalable member for an already exited group.
    if error != Some(libc::EPERM) {
        return false;
    }
    let mut pids = [0 as libc::pid_t; 4096];
    let capacity = std::mem::size_of_val(&pids) as libc::c_int;
    let bytes = unsafe { libc::proc_listpgrppids(group, pids.as_mut_ptr().cast(), capacity) };
    if bytes <= 0 || bytes >= capacity {
        return false;
    }
    for pid in pids
        .iter()
        .take(bytes as usize / std::mem::size_of::<libc::pid_t>())
    {
        let mut info: libc::proc_bsdshortinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of_val(&info) as libc::c_int;
        let count = unsafe {
            libc::proc_pidinfo(
                *pid,
                libc::PROC_PIDT_SHORTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdshortinfo).cast(),
                size,
            )
        };
        if count == 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
            continue;
        }
        if count != size || (info.pbsi_pgid == group as u32 && info.pbsi_status != libc::SZOMB) {
            return false;
        }
    }
    true
}

#[cfg(not(target_os = "macos"))]
fn zombie_only_group(_group: libc::pid_t, _error: Option<i32>) -> bool {
    false
}

#[derive(Default)]
struct Capture {
    bytes: Vec<u8>,
    total: u64,
    eof: bool,
    failed: bool,
}

impl Capture {
    fn append(&mut self, bytes: &[u8], limit: usize) {
        self.total = self.total.saturating_add(bytes.len() as u64);
        let remaining = limit.saturating_sub(self.bytes.len());
        self.bytes
            .extend_from_slice(&bytes[..remaining.min(bytes.len())]);
    }

    fn finish(self) -> CommandOutput {
        CommandOutput {
            text: String::from_utf8_lossy(&self.bytes).into_owned(),
            captured_bytes: self.bytes.len(),
            total_bytes: self.total,
            truncated: self.total > self.bytes.len() as u64,
            incomplete: !self.eof || self.failed,
        }
    }
}

async fn read_chunk(reader: &mut (impl AsyncRead + Unpin), capture: &mut Capture, limit: usize) {
    let mut bytes = [0; 8192];
    match reader.read(&mut bytes).await {
        Ok(0) => capture.eof = true,
        Ok(count) => capture.append(&bytes[..count], limit),
        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
        Err(_) => {
            capture.failed = true;
            capture.eof = true;
        }
    }
}

pub(super) async fn execute(
    request: CommandRequest,
    cancellation: CancellationToken,
) -> Result<CommandResult, ShellError> {
    if cancellation.is_cancelled() {
        return Ok(CommandResult {
            outcome: CommandOutcome::Cancelled,
            exit_code: None,
            signal: None,
            stdout: Capture {
                eof: true,
                ..Capture::default()
            }
            .finish(),
            stderr: Capture {
                eof: true,
                ..Capture::default()
            }
            .finish(),
        });
    }
    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    let mut command = Command::new(&request.executable);
    command
        .args(&request.args)
        .current_dir(&request.cwd)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Do not inherit application secrets, proxy credentials, shell startup
    // hooks, or provider configuration. These OS conveniences are not secrets.
    for name in ["HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.as_std_mut().process_group(0);
    let child = command.spawn().map_err(|_| ShellError::SpawnFailed)?;
    let group = child.id().ok_or(ShellError::SpawnFailed)? as libc::pid_t;
    let mut owned = OwnedGroup {
        child,
        group: Some(group),
    };
    let mut stdout = owned.child.stdout.take().ok_or(ShellError::SpawnFailed)?;
    let mut stderr = owned.child.stderr.take().ok_or(ShellError::SpawnFailed)?;
    let mut out = Capture::default();
    let mut err = Capture::default();
    let mut poll = tokio::time::interval(Duration::from_millis(10));
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let outcome = loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break CommandOutcome::Cancelled,
            _ = tokio::time::sleep_until(deadline) => break CommandOutcome::TimedOut,
            _ = poll.tick() => {
                if owned.exited()? { break CommandOutcome::Exited; }
            }
            _ = read_chunk(&mut stdout, &mut out, request.output_limit_bytes), if !out.eof => {},
            _ = read_chunk(&mut stderr, &mut err, request.output_limit_bytes), if !err.eof => {},
        }
    };
    // A successful leader exit does not permit its background children to keep
    // running after the mutation window or hold the pipe readers open forever.
    owned.terminate()?;
    let drain_deadline = Instant::now() + DRAIN_TIMEOUT;
    while !out.eof || !err.eof {
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(drain_deadline) => break,
            _ = read_chunk(&mut stdout, &mut out, request.output_limit_bytes), if !out.eof => {},
            _ = read_chunk(&mut stderr, &mut err, request.output_limit_bytes), if !err.eof => {},
        }
    }
    let status = tokio::time::timeout(Duration::from_secs(1), owned.child.wait())
        .await
        .map_err(|_| ShellError::WaitFailed)?
        .map_err(|_| ShellError::WaitFailed)?;
    Ok(CommandResult {
        outcome,
        exit_code: status.code(),
        signal: status.signal(),
        stdout: out.finish(),
        stderr: err.finish(),
    })
}
