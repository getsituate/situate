use std::{ffi::OsStr, io};

pub trait ExternalOpenHost {
    /// Hands an already validated absolute file path or web URL to the system.
    fn open(target: &OsStr) -> io::Result<()>;
}
