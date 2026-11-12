use super::*;
use std::{fs, os::unix::fs::symlink};

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::create_dir(temp.path().join("nested")).unwrap();
    fs::write(temp.path().join("nested/note.md"), b"before").unwrap();
    temp
}

#[test]
fn unchanged_scans_reuse_acknowledged_history() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let previous = store.repo.head().unwrap().target().unwrap();
    #[cfg(target_vendor = "apple")]
    let recording = crate::durable_storage::testing::start();
    for _ in 0..3 {
        assert_eq!(
            store.record_external_changes().unwrap(),
            previous.to_string()
        );
    }
    assert_eq!(store.history().unwrap().len(), 1);
    #[cfg(target_vendor = "apple")]
    assert!(recording.events().is_empty());
}

#[test]
fn cached_scans_recheck_replaced_files_and_ancestor_directories() {
    let temp = workspace();
    let path = temp.path().join("nested/note.md");
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let replacement = temp.path().join("replacement");
    fs::write(&replacement, b"after!").unwrap();
    fs::File::options()
        .write(true)
        .open(&replacement)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    fs::rename(replacement, &path).unwrap();
    let revision = store.record_external_changes().unwrap();
    assert_eq!(
        store.read_revision("nested/note.md", &revision).unwrap(),
        b"after!"
    );

    let outside = tempfile::tempdir().unwrap();
    fs::rename(temp.path().join("nested"), outside.path().join("previous")).unwrap();
    fs::create_dir(temp.path().join("nested")).unwrap();
    fs::write(&path, b"third!").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let revision = store.record_external_changes().unwrap();
    assert_eq!(
        store.read_revision("nested/note.md", &revision).unwrap(),
        b"third!"
    );
    assert_eq!(
        fs::read(outside.path().join("previous/note.md")).unwrap(),
        b"after!"
    );
}

#[test]
fn cached_files_replaced_by_symlinks_or_special_files_do_not_reuse_blobs() {
    for symbolic in [true, false] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let previous = store.repo.head().unwrap().target().unwrap();
        let path = temp.path().join("nested/note.md");
        fs::remove_file(&path).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::write(outside.path(), b"outside synthetic bytes").unwrap();
        if symbolic {
            symlink(outside.path(), &path).unwrap();
            let revision = store.record_external_changes().unwrap();
            assert!(store.read_revision("nested/note.md", &revision).is_err());
            assert!(!store.observations.blobs.contains_key("nested/note.md"));
        } else {
            assert!(
                std::process::Command::new("mkfifo")
                    .arg(&path)
                    .status()
                    .unwrap()
                    .success()
            );
            assert!(matches!(
                store.record_external_changes(),
                Err(ContentError::InvalidPath)
            ));
            assert_eq!(store.repo.head().unwrap().target(), Some(previous));
        }
        assert_eq!(
            fs::read(outside.path()).unwrap(),
            b"outside synthetic bytes"
        );
    }
}

#[cfg(target_vendor = "apple")]
#[test]
fn permission_changes_fail_without_acknowledging_a_new_snapshot() {
    use std::os::unix::fs::PermissionsExt;
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let previous = store.repo.head().unwrap().target().unwrap();
    let stamp = store.observations.blobs["nested/note.md"].stamp.clone();
    let path = temp.path().join("nested/note.md");
    let permissions = fs::metadata(&path).unwrap().permissions();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
    let snapshot = store.record_external_changes();
    let read = store.read_text("nested/note.md");
    fs::set_permissions(path, permissions).unwrap();
    assert!(matches!(snapshot, Err(ContentError::Io(_))));
    assert!(matches!(read, Err(ContentError::Io(_))));
    assert_eq!(store.repo.head().unwrap().target(), Some(previous));
    assert_eq!(store.observations.durable_head.get(), Some(previous));
    assert_eq!(store.observations.blobs["nested/note.md"].stamp, stamp);
    assert_eq!(
        store.record_external_changes().unwrap(),
        previous.to_string()
    );
}
