use crate::{MigrationError, MigrationErrorKind, Result};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::{
    ffi::OsStr,
    io::{Read, Write},
    sync::atomic::{AtomicU64, Ordering},
};

pub(crate) const CONTROL: &str = ".migrations";
static NEXT: AtomicU64 = AtomicU64::new(0);

pub(crate) fn child(dir: &Dir, name: impl AsRef<OsStr>) -> Result<Dir> {
    dir.open_dir_nofollow(std::path::Path::new(name.as_ref()))
        .map_err(|error| MigrationError::from(error).with_kind(MigrationErrorKind::UnsafePath))
}
pub(crate) fn ensure_child(dir: &Dir, name: &str) -> Result<Dir> {
    let mut builder = cap_std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use cap_std::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match dir.create_dir_with(name, &builder) {
        Ok(()) => sync(dir)?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.into()),
    }
    child(dir, name)
}
pub(crate) fn sync(dir: &Dir) -> Result<()> {
    checkpoint("directory-sync")?;
    directory_for_sync(dir)?.sync_all()?;
    Ok(())
}

/// Opens the held directory with the access required to flush its metadata.
pub fn directory_for_sync(dir: &Dir) -> std::io::Result<std::fs::File> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use rustix::fs::{Mode, OFlags, openat};
        // No-follow directory capabilities can be O_PATH descriptors, which cannot
        // be fsynced. Open the same directory through its handle, not its old path.
        Ok(openat(
            dir,
            ".",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )?
        .into())
    }
    #[cfg(windows)]
    {
        use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsMaybeDirExt};
        let mut options = cap_std::fs::OpenOptions::new();
        options
            .write(true)
            .maybe_dir(true)
            .follow(FollowSymlinks::No);
        // FlushFileBuffers needs write access, but ReOpenFile rejects directory
        // handles. cap-std opens "." through NtCreateFile relative to the held handle.
        dir.open_with(".", &options)
            .map(cap_std::fs::File::into_std)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
    {
        dir.try_clone().map(Dir::into_std_file)
    }
}
pub(crate) fn options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_fs_ext::OpenOptionsSyncExt;
        use cap_std::fs::OpenOptionsExt;
        options.nonblock(true).mode(0o600);
    }
    options
}
pub(crate) fn regular(dir: &Dir, name: &str) -> Result<()> {
    if !dir.symlink_metadata(name)?.is_file() {
        return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
    }
    Ok(())
}
pub(crate) fn open_read(dir: &Dir, name: &str) -> Result<cap_std::fs::File> {
    regular(dir, name)?;
    let file = dir.open_with(name, options().read(true))?;
    if !file.metadata()?.is_file() {
        return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
    }
    Ok(file)
}
pub(crate) fn read(dir: &Dir, name: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    open_read(dir, name)?.read_to_end(&mut bytes)?;
    Ok(bytes)
}
pub(crate) fn bounded_read(dir: &Dir, name: &str, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    open_read(dir, name)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
    }
    Ok(bytes)
}
pub(crate) fn exists(dir: &Dir, name: &str) -> Result<bool> {
    match dir.symlink_metadata(name) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
pub(crate) fn replace(dir: &Dir, name: &str, bytes: &[u8]) -> Result<()> {
    if exists(dir, name)? {
        regular(dir, name)?;
    }
    let temporary = format!(
        ".migration-write-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let mut file = dir.open_with(&temporary, options().write(true).create_new(true))?;
    let result = (|| {
        file.write_all(bytes)?;
        checkpoint("file-write")?;
        checkpoint("file-sync")?;
        file.sync_all()?;
        checkpoint("replace-rename")?;
        dir.rename(&temporary, dir, name)?;
        sync(dir)
    })();
    if result.is_err() {
        let _ = dir.remove_file(&temporary);
    }
    result
}
pub(crate) fn names(dir: &Dir) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in dir.entries()? {
        let name = entry?
            .file_name()
            .into_string()
            .map_err(|_| MigrationError::new(MigrationErrorKind::UnsafePath))?;
        names.push(name);
    }
    names.sort();
    Ok(names)
}
pub(crate) fn remove_tree(parent: &Dir, name: &str) -> Result<()> {
    checkpoint("delete-entry")?;
    let meta = parent.symlink_metadata(name)?;
    if meta.is_dir() {
        let dir = child(parent, name)?;
        #[cfg(unix)]
        {
            use cap_std::fs::{Permissions, PermissionsExt};
            dir.set_permissions(
                ".",
                Permissions::from_mode(dir.dir_metadata()?.permissions().mode() | 0o700),
            )?;
        }
        for entry in names(&dir)? {
            remove_tree(&dir, &entry)?;
        }
        // Windows directory capabilities deny deletion until closed.
        drop(dir);
        parent.remove_dir(name)?;
    } else if meta.is_file() {
        parent.remove_file(name)?;
    } else {
        return Err(MigrationError::new(MigrationErrorKind::UnsafePath));
    }
    checkpoint("entry-deleted")?;
    sync(parent)
}

pub(crate) fn checkpoint(name: &str) -> Result<()> {
    #[cfg(test)]
    crate::runner_cases::checkpoint(name)?;
    let _ = name;
    Ok(())
}
