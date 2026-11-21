use cap_std::fs::Dir;
use situate_migrations::directory_for_sync;
use std::io;

mod sync_batch;
pub(crate) use sync_batch::SyncBatch;
#[cfg(all(test, target_vendor = "apple"))]
pub(crate) use sync_batch::testing;

#[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
pub(crate) fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()> {
    rustix::fs::renameat_with(
        from.try_clone()?.into_std_file(),
        old,
        to.try_clone()?.into_std_file(),
        new,
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .map_err(io::Error::from)
}

#[cfg(windows)]
pub(crate) fn rename_noreplace(from: &Dir, old: &str, to: &Dir, new: &str) -> io::Result<()> {
    use std::os::windows::{ffi::OsStrExt, ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, MoveFileExW};
    fn path(dir: &Dir, name: &str) -> io::Result<Vec<u16>> {
        let file = dir.try_clone()?.into_std_file();
        let mut buffer = vec![0u16; 32768];
        // The directory handle was opened without following symlinks. Windows
        // publication still requires ancestors to stay put until MoveFileExW.
        let size = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        if size as usize >= buffer.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "native.content.path.tooLong",
            ));
        }
        buffer.truncate(size as usize);
        let path = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer)).join(name);
        Ok(path.as_os_str().encode_wide().chain(Some(0)).collect())
    }
    let from = path(from, old)?;
    let to = path(to, new)?;
    // Zero flags exclude replacement, including an existing empty directory.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(not(any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    windows
)))]
pub(crate) fn rename_noreplace(_from: &Dir, _old: &str, _to: &Dir, _new: &str) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "native.content.operation.publicationUnsupported",
    ))
}

pub(crate) fn sync_directory(dir: &Dir) -> io::Result<()> {
    directory_for_sync(dir)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cap_std::ambient_authority;
    use std::{fs, path::Path};

    #[test]
    fn nofollow_directory_can_be_synced() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("data")).unwrap();
        let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        let dir = Dir::from_std_file(
            cap_primitives::fs::open_dir_nofollow(&root.into_std_file(), Path::new("data"))
                .unwrap(),
        );
        dir.write("saved", b"contents").unwrap();
        let sync_handle = directory_for_sync(&dir)
            .unwrap_or_else(|error| panic!("Opening directory sync handle failed: {error:?}"));
        sync_handle
            .sync_all()
            .unwrap_or_else(|error| panic!("Flushing directory sync handle failed: {error:?}"));
        sync_directory(&dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn held_directory_blocks_replacement_and_syncs_the_original() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data");
        let other = temp.path().join("other");
        fs::create_dir(&data).unwrap();
        fs::create_dir(&other).unwrap();
        let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        let dir = Dir::from_std_file(
            cap_primitives::fs::open_dir_nofollow(&root.into_std_file(), Path::new("data"))
                .unwrap(),
        );
        let original =
            same_file::Handle::from_file(dir.try_clone().unwrap().into_std_file()).unwrap();
        assert_eq!(
            fs::rename(&data, temp.path().join("moved"))
                .unwrap_err()
                .raw_os_error(),
            Some(32)
        );
        assert!(!temp.path().join("moved").exists());
        dir.write("saved", b"contents").unwrap();

        let sync_handle = directory_for_sync(&dir).unwrap();
        assert_eq!(
            same_file::Handle::from_file(sync_handle.try_clone().unwrap()).unwrap(),
            original
        );
        sync_handle.sync_all().unwrap();
        sync_directory(&dir).unwrap();
        assert_eq!(fs::read(data.join("saved")).unwrap(), b"contents");
        assert!(fs::read_dir(other).unwrap().next().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn directory_reopen_sharing_errors_are_propagated() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ,
        };
        let temp = tempfile::tempdir().unwrap();
        let file = fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(temp.path())
            .unwrap();
        let dir = Dir::from_std_file(file);
        assert_eq!(sync_directory(&dir).unwrap_err().raw_os_error(), Some(32));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn directory_open_errors_are_propagated() {
        let file = tempfile::tempfile().unwrap();
        let invalid_directory = Dir::from_std_file(file);
        assert_eq!(
            sync_directory(&invalid_directory)
                .unwrap_err()
                .raw_os_error(),
            Some(libc::ENOTDIR)
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn filesystem_sync_errors_are_propagated() {
        // Procfs permits opening directories but does not support fsync.
        let dir = Dir::open_ambient_dir("/proc", ambient_authority()).unwrap();
        assert_eq!(
            directory_for_sync(&dir)
                .unwrap()
                .sync_all()
                .unwrap_err()
                .raw_os_error(),
            Some(libc::EINVAL)
        );
        assert_eq!(
            sync_directory(&dir).unwrap_err().raw_os_error(),
            Some(libc::EINVAL)
        );
    }

    #[cfg(unix)]
    #[test]
    fn sync_handle_keeps_directory_identity_after_rename_and_symlink_replacement() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("data")).unwrap();
        fs::create_dir(temp.path().join("other")).unwrap();
        let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        let dir = Dir::from_std_file(
            cap_primitives::fs::open_dir_nofollow(&root.into_std_file(), Path::new("data"))
                .unwrap(),
        );
        let original =
            same_file::Handle::from_file(dir.try_clone().unwrap().into_std_file()).unwrap();
        fs::rename(temp.path().join("data"), temp.path().join("moved")).unwrap();
        std::os::unix::fs::symlink("other", temp.path().join("data")).unwrap();

        let sync_handle = directory_for_sync(&dir).unwrap();
        assert_eq!(
            same_file::Handle::from_file(sync_handle.try_clone().unwrap()).unwrap(),
            original
        );
        sync_handle.sync_all().unwrap();
        sync_directory(&dir).unwrap();
    }
}
