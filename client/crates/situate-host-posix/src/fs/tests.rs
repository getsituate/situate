use super::*;
use cap_std::ambient_authority;
use std::fs;

fn sync_directory(dir: &Dir) -> io::Result<()> {
    directory_for_sync(dir)?.sync_all()
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

#[test]
fn sync_handle_keeps_directory_identity_after_rename_and_symlink_replacement() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("data")).unwrap();
    fs::create_dir(temp.path().join("other")).unwrap();
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    let dir = Dir::from_std_file(
        cap_primitives::fs::open_dir_nofollow(&root.into_std_file(), Path::new("data")).unwrap(),
    );
    let original = same_file::Handle::from_file(dir.try_clone().unwrap().into_std_file()).unwrap();
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
