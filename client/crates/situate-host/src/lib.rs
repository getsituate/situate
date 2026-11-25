//! Compile-time selection for native platform operations.

#[cfg(any(target_os = "macos", target_os = "linux", windows))]
pub mod external;

#[cfg(target_vendor = "apple")]
pub use situate_host_macos::fs;
#[cfg(all(unix, not(target_vendor = "apple")))]
pub use situate_host_posix::fs;
#[cfg(all(unix, feature = "test-support"))]
pub use situate_host_posix::test_support as unix_test_support;
#[cfg(windows)]
pub use situate_host_windows::fs;
#[cfg(all(windows, feature = "test-support"))]
pub use situate_host_windows::test_support as windows_test_support;
