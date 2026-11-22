#[cfg(test)]
mod tests;

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, DirBuilder, Metadata, OpenOptions};
use std::{
    ffi::OsStr,
    fs::File,
    io,
    path::{Component, Path, PathBuf},
};

pub struct HostFs;
impl situate_host_api::fs::FilesystemHost for HostFs {
    fn directory_for_sync(directory: &Dir) -> io::Result<File> {
        directory_for_sync(directory)
    }

    fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()> {
        rename_noreplace(from, old, to, new)
    }
}

pub const WRITABLE_SYNC_HANDLE: bool = false;
pub const RECHECK_HISTORY_CONTROLS: bool = false;
pub const RECOVER_UNFLUSHED_HISTORY: bool = true;
pub const RELEASE_CHILD_BEFORE_MOVE: bool = false;
pub const REMOVE_FAILED_HISTORY_STAGE: bool = true;
pub const STAGE_WORKSPACE_MARKER: bool = cfg!(any(target_os = "macos", target_os = "linux"));

pub fn open_workspace_stage(parent: &Dir, name: &str) -> io::Result<Dir> {
    use cap_fs_ext::DirExt;
    parent.open_dir_nofollow(name)
}

pub fn publish_workspace_marker(parent: &Dir, name: &str, _marker: &Dir) -> io::Result<()> {
    rename_noreplace(parent, name, parent, ".situate")
}

pub fn private_file_options(options: &mut OpenOptions) {
    use cap_std::fs::OpenOptionsExt;
    options.mode(0o600);
}
pub fn nonblocking_file_options(options: &mut OpenOptions) {
    options.nonblock(true);
}
pub fn private_dir_builder(builder: &mut DirBuilder) {
    use cap_std::fs::DirBuilderExt;
    builder.mode(0o700);
}
pub fn restrict_directory(dir: &Dir, name: &str) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    dir.set_permissions(
        name,
        cap_std::fs::Permissions::from_std(std::fs::Permissions::from_mode(0o700)),
    )
}
pub fn enforce_single_link_on_write(file: &cap_std::fs::File) -> io::Result<bool> {
    let file = file.try_clone()?.into_std();
    is_single_link(&file, &file.metadata()?)
}
pub fn is_single_link(_file: &File, metadata: &std::fs::Metadata) -> io::Result<bool> {
    use std::os::unix::fs::MetadataExt;
    Ok(metadata.nlink() == 1)
}
pub fn is_private_record(metadata: &Metadata) -> bool {
    use cap_std::fs::{MetadataExt, PermissionsExt};
    metadata.nlink() == 1 && metadata.permissions().mode() & 0o777 == 0o600
}
pub fn file_cache_identity(metadata: &std::fs::Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    Some((metadata.dev(), metadata.ino()))
}
pub fn file_change_identity(metadata: &Metadata) -> Option<(u64, u64, i64, i64, u32)> {
    use cap_std::fs::MetadataExt;
    Some((
        metadata.dev(),
        metadata.ino(),
        metadata.ctime(),
        metadata.ctime_nsec(),
        metadata.mode(),
    ))
}
pub fn executable(metadata: &Metadata) -> bool {
    use cap_std::fs::MetadataExt;
    metadata.mode() & 0o111 != 0
}
pub fn sync_registry_parent(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
pub fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()> {
    rustix::fs::renameat_with(
        from.try_clone()?.into_std_file(),
        old,
        to.try_clone()?.into_std_file(),
        new,
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .map_err(io::Error::from)
}
#[cfg(not(any(target_vendor = "apple", target_os = "linux", target_os = "android")))]
pub fn rename_noreplace(_from: &Dir, _old: &str, _to: &Dir, _new: &str) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "native.content.operation.publicationUnsupported",
    ))
}
pub fn publish_history(marker: &Dir, stage: &str, _history_path: &Path) -> io::Result<()> {
    rename_noreplace(marker, stage, marker, "history.git")
}
pub fn history_file_for_sync(dir: &Dir, name: &OsStr) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    Ok(dir.open_with(name, &options)?.into_std())
}
pub fn storage_root(
    path: &Path,
) -> Result<(std::path::PathBuf, std::path::Components<'_>), io::Error> {
    if !path.is_absolute() {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let mut components = path.components();
    let mut root = PathBuf::new();
    match components.clone().next() {
        Some(Component::RootDir) => {
            components.next();
        }
        _ => return Err(io::ErrorKind::InvalidInput.into()),
    }
    root.push(std::path::MAIN_SEPARATOR_STR);
    Ok((root, components))
}
pub struct PatchIdentity(same_file::Handle);
impl PatchIdentity {
    pub fn new(identity: same_file::Handle, _inside_moved_directory: bool) -> io::Result<Self> {
        Ok(Self(identity))
    }
    pub fn matches(&self, candidate: &same_file::Handle) -> io::Result<bool> {
        Ok(&self.0 == candidate)
    }
}
pub fn directory_for_sync(dir: &Dir) -> io::Result<File> {
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
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    dir.try_clone().map(Dir::into_std_file)
}

pub fn publish_new_file(dir: &Dir, stage: &str, name: &str) -> io::Result<()> {
    #[cfg(target_os = "android")]
    return rename_noreplace(dir, stage, dir, name);
    #[cfg(not(target_os = "android"))]
    dir.hard_link(stage, dir, name)
}
/// Finish the batch before publishing references to its files.
#[derive(Default)]
#[must_use]
pub struct SyncBatch {
    _private: (),
}
impl SyncBatch {
    pub fn sync_file(&mut self, file: File) -> io::Result<()> {
        file.sync_all()
    }
    pub fn sync_directory(&mut self, dir: &Dir) -> io::Result<()> {
        self.sync_file(directory_for_sync(dir)?)
    }
    pub fn finish(self) -> io::Result<()> {
        Ok(())
    }
}
