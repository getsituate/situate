use serde::Serialize;
use std::{future::Future, path::PathBuf};
pub use tokio_util::sync::CancellationToken;

pub const MAX_TIMEOUT_MS: u64 = 300_000;
pub const MAX_OUTPUT_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCapability {
    pub available: bool,
    pub platform: &'static str,
    pub implementation: &'static str,
    pub interpreter: Option<String>,
    pub interpreter_dialect: Option<&'static str>,
    pub interpreter_args: Vec<&'static str>,
    pub unavailable_reason: Option<&'static str>,
    pub ownership: &'static str,
    pub detached_descendants_contained: bool,
    pub requires_path_backed_workspace: bool,
    pub max_timeout_ms: u64,
    pub max_output_bytes_per_stream: usize,
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

/// Executes an admitted workspace command and drains owned work before returning.
/// This is not a filesystem or network sandbox.
pub trait ProcessHost {
    fn capability() -> ShellCapability;
    fn script_args(prefix: &[&str], command: String) -> Vec<String>;
    fn execute(
        request: CommandRequest,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<CommandResult, ShellError>> + Send;
}

#[derive(Default)]
pub struct Capture {
    bytes: Vec<u8>,
    total: u64,
    pub eof: bool,
    pub failed: bool,
}

impl Capture {
    pub fn append(&mut self, bytes: &[u8], limit: usize) {
        self.total = self.total.saturating_add(bytes.len() as u64);
        let remaining = limit.saturating_sub(self.bytes.len());
        self.bytes
            .extend_from_slice(&bytes[..remaining.min(bytes.len())]);
    }

    pub fn finish(self) -> CommandOutput {
        CommandOutput {
            text: String::from_utf8_lossy(&self.bytes).into_owned(),
            captured_bytes: self.bytes.len(),
            total_bytes: self.total,
            truncated: self.total > self.bytes.len() as u64,
            incomplete: !self.eof || self.failed,
        }
    }
}

pub fn cancelled_before_start() -> CommandResult {
    let empty = || {
        Capture {
            eof: true,
            ..Capture::default()
        }
        .finish()
    };
    CommandResult {
        outcome: CommandOutcome::Cancelled,
        exit_code: None,
        signal: None,
        stdout: empty(),
        stderr: empty(),
    }
}

impl CommandRequest {
    pub fn validate(&self) -> Result<(), ShellError> {
        let request = self;
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
        Ok(())
    }
}
