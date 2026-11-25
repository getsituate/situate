use situate_host_api::external::ExternalOpenHost;
use std::{
    ffi::OsStr,
    io,
    process::{Command, Stdio},
};

pub struct Host;

impl ExternalOpenHost for Host {
    fn open(target: &OsStr) -> io::Result<()> {
        let status = Command::new("/usr/bin/open")
            .arg("--")
            .arg(target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::other(status.to_string()))
        }
    }
}
