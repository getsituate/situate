use super::*;
use std::fs;

#[test]
fn new_file_publication_keeps_existing_file_directory_and_symlink_occupants() {
    let temp = tempfile::tempdir().unwrap();
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    fs::write(temp.path().join("file"), "existing").unwrap();
    fs::create_dir(temp.path().join("folder")).unwrap();
    for name in ["file", "folder"] {
        let stage = temporary_file(&dir, b"new").unwrap();
        assert!(publish_new_file(&dir, &stage, name).is_err());
        assert!(!dir.try_exists(stage).unwrap());
    }
    assert_eq!(fs::read(temp.path().join("file")).unwrap(), b"existing");
    assert!(temp.path().join("folder").is_dir());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("missing", temp.path().join("link")).unwrap();
        let stage = temporary_file(&dir, b"new").unwrap();
        assert!(publish_new_file(&dir, &stage, "link").is_err());
        assert!(
            fs::symlink_metadata(temp.path().join("link"))
                .unwrap()
                .is_symlink()
        );
    }
}

#[test]
fn new_file_publication_publishes_all_staged_bytes_and_removes_only_its_stage() {
    let temp = tempfile::tempdir().unwrap();
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    let bytes = vec![0xa5; 128 * 1024];
    let stage = temporary_file(&dir, &bytes).unwrap();
    let retained = temporary_file(&dir, b"unrelated stage").unwrap();
    publish_new_file(&dir, &stage, "new.bin").unwrap();
    sync_dir(&dir).unwrap();
    assert_eq!(fs::read(temp.path().join("new.bin")).unwrap(), bytes);
    assert!(!dir.try_exists(stage).unwrap());
    assert_eq!(
        fs::read(temp.path().join(retained)).unwrap(),
        b"unrelated stage"
    );
}

#[cfg(any(target_vendor = "apple", target_os = "linux", target_os = "android"))]
#[test]
fn descriptor_bound_no_replace_file_publication_preserves_a_racing_occupant() {
    let temp = tempfile::tempdir().unwrap();
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    let stage = temporary_file(&dir, b"complete new bytes").unwrap();
    require_absent(&dir, "new.txt", "native.content.destination.occupied").unwrap();
    fs::write(temp.path().join("new.txt"), "racing occupant").unwrap();
    assert!(operations::rename_noreplace(&dir, &stage, &dir, "new.txt").is_err());
    assert_eq!(
        fs::read(temp.path().join("new.txt")).unwrap(),
        b"racing occupant"
    );
    assert_eq!(
        fs::read(temp.path().join(&stage)).unwrap(),
        b"complete new bytes"
    );
    fs::remove_file(temp.path().join("new.txt")).unwrap();
    operations::rename_noreplace(&dir, &stage, &dir, "new.txt").unwrap();
    sync_dir(&dir).unwrap();
    assert_eq!(
        fs::read(temp.path().join("new.txt")).unwrap(),
        b"complete new bytes"
    );
    assert!(!dir.try_exists(stage).unwrap());
}
