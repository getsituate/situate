//! Native execution primitive; not an IPC command.
//!
//! Callers must hold the workspace content mutation window, retain editor drafts,
//! capture pre-existing changes, and reconcile after every result, including errors.
//! Cancel through the token and await completion before releasing that window.
//! Neither cwd nor process ownership restricts filesystem or network access.

use serde::Serialize;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

const MAX_TIMEOUT_MS: u64 = 300_000;
const MAX_OUTPUT_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCapability {
    pub available: bool,
    pub platform: &'static str,
    pub implementation: &'static str,
    pub interpreter: Option<&'static str>,
    pub interpreter_dialect: Option<&'static str>,
    pub interpreter_args: Vec<&'static str>,
    pub unavailable_reason: Option<&'static str>,
    pub ownership: &'static str,
    pub detached_descendants_contained: bool,
    pub requires_path_backed_workspace: bool,
    pub max_timeout_ms: u64,
    pub max_output_bytes_per_stream: usize,
}

pub fn capability() -> ShellCapability {
    let (implementation, interpreter, reason, ownership) =
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            if std::path::Path::new("/bin/sh").is_file() {
                ("nativeProcess", Some("/bin/sh"), None, "processGroup")
            } else {
                (
                    "unavailable",
                    None,
                    Some("systemInterpreterMissing"),
                    "none",
                )
            }
        } else if cfg!(target_os = "android") {
            (
                "unavailable",
                None,
                Some("androidAppUidExecutionNotVerified"),
                "none",
            )
        } else if cfg!(target_os = "ios") {
            (
                "unavailable",
                None,
                Some("iosEmbeddedHostNotReviewedOrIntegrated"),
                "none",
            )
        } else if cfg!(target_os = "windows") {
            (
                "unavailable",
                None,
                Some("windowsOwnedJobHostNotImplemented"),
                "none",
            )
        } else {
            (
                "unavailable",
                None,
                Some("platformHostNotImplemented"),
                "none",
            )
        };
    ShellCapability {
        available: reason.is_none(),
        platform: std::env::consts::OS,
        implementation,
        interpreter,
        interpreter_dialect: interpreter.map(|_| "posixSh"),
        interpreter_args: if interpreter.is_some() {
            vec!["-c"]
        } else {
            vec![]
        },
        unavailable_reason: reason,
        ownership,
        detached_descendants_contained: false,
        requires_path_backed_workspace: true,
        max_timeout_ms: MAX_TIMEOUT_MS,
        max_output_bytes_per_stream: MAX_OUTPUT_BYTES,
    }
}

/// Arguments are passed verbatim, never concatenated or interpreted by this host.
/// To run a script, explicitly select its interpreter and pass its script argument.
/// The admitted workspace directory must be supplied by the native file bridge,
/// not accepted as an arbitrary webview path. No environment overrides are accepted.
#[derive(Debug, Clone)]
pub struct CommandRequest {
    pub cwd: PathBuf,
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub timeout_ms: u64,
    pub output_limit_bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandOutcome {
    Exited,
    Cancelled,
    TimedOut,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    /// UTF-8 with replacement for invalid bytes, including a truncated code point.
    pub text: String,
    pub captured_bytes: usize,
    pub total_bytes: u64,
    pub truncated: bool,
    /// A pipe did not reach EOF within the drain deadline, or a read failed.
    pub incomplete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub outcome: CommandOutcome,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub stdout: CommandOutput,
    pub stderr: CommandOutput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellError {
    Unavailable,
    InvalidRequest,
    SpawnFailed,
    WaitFailed,
}

/// Only a workspace-owned, draft-coordinated native tool bridge may invoke this primitive.
/// Output is a bounded prefix; discarded bytes cannot be retrieved later.
/// Process groups cover ordinary descendants, not programs that detach with
/// setsid/setpgid. No security isolation or detached-daemon containment is claimed.
pub async fn execute(
    request: CommandRequest,
    cancellation: CancellationToken,
) -> Result<CommandResult, ShellError> {
    if !capability().available {
        return Err(ShellError::Unavailable);
    }
    if !request.cwd.is_absolute()
        || !request.cwd.is_dir()
        || !request.executable.is_absolute()
        || request.timeout_ms == 0
        || request.timeout_ms > MAX_TIMEOUT_MS
        || request.output_limit_bytes == 0
        || request.output_limit_bytes > MAX_OUTPUT_BYTES
        || request.args.len() > 256
        || request.args.iter().map(String::len).sum::<usize>() > 65_536
    {
        return Err(ShellError::InvalidRequest);
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return unix::execute(request, cancellation).await;
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = cancellation;
        Err(ShellError::Unavailable)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "shell_host/unix.rs"]
mod unix;

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
#[path = "shell_host/tests.rs"]
mod tests;
