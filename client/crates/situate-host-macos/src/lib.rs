#[cfg(target_os = "macos")]
pub mod dictation;
#[cfg(target_os = "macos")]
pub mod external;
#[cfg(target_os = "macos")]
pub use situate_host_posix::process;
#[cfg(target_vendor = "apple")]
pub mod fs;
