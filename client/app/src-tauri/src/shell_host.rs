//! Native execution primitive; not an IPC command.
//!
//! Callers must hold the workspace content mutation window, retain editor drafts,
//! capture pre-existing changes, and reconcile after every result, including errors.
//! Cancel through the token and await completion before releasing that window.
//! Neither cwd nor process ownership restricts filesystem or network access.

use situate_core::platform::process::ProcessHost;
pub use situate_core::platform::process::{
    CommandOutcome, CommandOutput, CommandRequest, CommandResult, ShellCapability, ShellError,
};
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
use situate_core::platform::process::{MAX_OUTPUT_BYTES, MAX_TIMEOUT_MS};
use tokio_util::sync::CancellationToken;

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
use Unsupported as Host;
#[cfg(target_os = "macos")]
use situate_host_macos::process::Host;
#[cfg(target_os = "linux")]
use situate_host_posix::process::Host;
#[cfg(target_os = "windows")]
use situate_host_windows::process::Host;

pub(crate) fn capability() -> ShellCapability {
    Host::capability()
}

pub(crate) fn script_args(prefix: &[&str], command: String) -> Vec<String> {
    Host::script_args(prefix, command)
}

pub(crate) async fn execute(
    request: CommandRequest,
    cancellation: CancellationToken,
) -> Result<CommandResult, ShellError> {
    Host::execute(request, cancellation).await
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
struct Unsupported;
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
impl ProcessHost for Unsupported {
    fn capability() -> ShellCapability {
        ShellCapability {
            available: false,
            platform: std::env::consts::OS,
            implementation: "unavailable",
            interpreter: None,
            interpreter_dialect: None,
            interpreter_args: vec![],
            unavailable_reason: Some(if cfg!(target_os = "android") {
                "androidAppUidExecutionNotVerified"
            } else if cfg!(target_os = "ios") {
                "iosEmbeddedHostNotReviewedOrIntegrated"
            } else {
                "platformHostNotImplemented"
            }),
            ownership: "none",
            detached_descendants_contained: false,
            requires_path_backed_workspace: true,
            max_timeout_ms: MAX_TIMEOUT_MS,
            max_output_bytes_per_stream: MAX_OUTPUT_BYTES,
        }
    }

    fn script_args(prefix: &[&str], command: String) -> Vec<String> {
        prefix
            .iter()
            .map(|arg| (*arg).to_owned())
            .chain([command, "situate-command".into()])
            .collect()
    }

    async fn execute(
        _request: CommandRequest,
        _cancellation: CancellationToken,
    ) -> Result<CommandResult, ShellError> {
        Err(ShellError::Unavailable)
    }
}
