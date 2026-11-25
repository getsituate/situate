use cap_std::fs::Dir;
use std::{fs::File, io};

pub trait FilesystemHost {
    /// Opens the held directory for synchronization without redirecting through its former path.
    fn directory_for_sync(directory: &Dir) -> io::Result<File>;

    /// Publishes without replacing an existing destination, including an empty directory.
    fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()>;
}
