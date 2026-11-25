use super::*;
use cap_std::ambient_authority;
use std::fs;

fn sync_directory(dir: &Dir) -> io::Result<()> {
    directory_for_sync(dir)?.sync_all()
}

fn open_dir(dir: &Dir, name: &str) -> io::Result<Dir> {
    cap_primitives::fs::open_dir_nofollow(&dir.try_clone()?.into_std_file(), Path::new(name))
        .map(Dir::from_std_file)
}

fn open_note(dir: &Dir) -> io::Result<(Vec<u8>, same_file::Handle)> {
    use std::io::Read;
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = dir.open_with("note.md", &options)?.into_std();
    let identity = same_file::Handle::from_file(file.try_clone()?)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok((bytes, identity))
}

use crate::test_support::restricted_context;

#[test]
fn detached_identity_comparison_uses_all_identifier_bytes_and_volume() {
    use windows_sys::Win32::Storage::FileSystem::{FILE_ID_128, FILE_ID_INFO};
    let original = FILE_ID_INFO {
        VolumeSerialNumber: 7,
        FileId: FILE_ID_128 {
            Identifier: [0; 16],
        },
    };
    assert!(same_windows_file_ids(&original, &original));
    for byte in 0..16 {
        let mut replacement = original;
        replacement.FileId.Identifier[byte] = 1;
        assert!(!same_windows_file_ids(&original, &replacement));
    }
    let mut other_volume = original;
    other_volume.VolumeSerialNumber = 8;
    assert!(!same_windows_file_ids(&original, &other_volume));
}

#[test]
fn restricted_token_retains_identity_across_ancestor_move_and_replacement() {
    let _context = restricted_context().unwrap();
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir_all(temp.path().join("source/sub")).unwrap();
    fs::write(temp.path().join("source/sub/note.md"), b"original").unwrap();
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    let identity = {
        let source = open_dir(&root, "source").unwrap();
        let sub = open_dir(&source, "sub").unwrap();
        let (_, identity) = open_note(&sub).unwrap();
        PatchIdentity::new(identity, true).unwrap()
    };
    rename_noreplace(&root, "source", &root, "moved").unwrap();
    assert!(!temp.path().join("source").exists());
    let moved = open_dir(&root, "moved").unwrap();
    let sub = open_dir(&moved, "sub").unwrap();
    let (bytes, candidate) = open_note(&sub).unwrap();
    assert_eq!(bytes, b"original");
    assert!(identity.matches(&candidate).unwrap());
    sub.rename("note.md", &sub, "retained.md").unwrap();
    sub.write("note.md", b"original").unwrap();
    let (bytes, replacement) = open_note(&sub).unwrap();
    assert_eq!(bytes, b"original");
    assert!(!identity.matches(&replacement).unwrap());
    assert_eq!(sub.read("retained.md").unwrap(), b"original");
}

#[test]
fn held_directory_blocks_replacement_and_syncs_the_original() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("data");
    let other = temp.path().join("other");
    fs::create_dir(&data).unwrap();
    fs::create_dir(&other).unwrap();
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    let dir = Dir::from_std_file(
        cap_primitives::fs::open_dir_nofollow(&root.into_std_file(), Path::new("data")).unwrap(),
    );
    let original = same_file::Handle::from_file(dir.try_clone().unwrap().into_std_file()).unwrap();
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

#[test]
fn directory_reopen_sharing_errors_are_propagated() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ};
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
