use situate_host_api::external::ExternalOpenHost;
use std::{ffi::OsStr, io};

#[cfg(target_os = "macos")]
use situate_host_macos::external::Host;
#[cfg(target_os = "linux")]
use situate_host_posix::external::Host;
#[cfg(windows)]
use situate_host_windows::external::Host;

pub fn open(target: &OsStr) -> io::Result<()> {
    Host::open(target)
}
