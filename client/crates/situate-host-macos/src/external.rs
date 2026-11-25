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
            .env_remove("SITUATE_GMAIL_TEST_CLIENT_ID")
            .env_remove("SITUATE_GMAIL_TEST_CLIENT_SECRET")
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
