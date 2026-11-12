use super::*;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let directory = std::env::temp_dir().canonicalize().unwrap();
    let root = tempfile::tempdir_in(directory).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    root
}

#[test]
fn missing_defaults_do_not_create_files_and_all_accents_survive_reopen() {
    let root = workspace();
    let store = Storage::open(root.path()).unwrap();
    let mut snapshot = store.snapshot().unwrap();
    assert_eq!(
        snapshot,
        Snapshot {
            writable: true,
            ..Snapshot::default()
        }
    );
    assert_eq!(
        fs::read_dir(root.path().join(".situate")).unwrap().count(),
        0
    );
    for (accent, name) in [
        (Accent::Violet, "violet"),
        (Accent::Cobalt, "cobalt"),
        (Accent::Sky, "sky"),
        (Accent::Tangerine, "tangerine"),
        (Accent::Peach, "peach"),
        (Accent::Lemon, "lemon"),
    ] {
        let saved = store.update(accent, snapshot.revision.as_deref()).unwrap();
        assert_eq!(saved.accent, accent);
        assert!(saved.writable);
        assert!(saved.revision.is_some());
        assert_ne!(saved.revision, snapshot.revision);
        assert_eq!(
            Storage::open(root.path()).unwrap().snapshot().unwrap(),
            saved
        );
        let document: Value = serde_json::from_slice(&store.bytes().unwrap().unwrap()).unwrap();
        assert_eq!(document["version"], 1);
        assert_eq!(document["accent"], name);
        snapshot = saved;
    }
}

#[test]
fn workspace_transfer_isolation_and_localization_independence() {
    let one = workspace();
    let two = workspace();
    let store = Storage::open(one.path()).unwrap();
    let localization = one.path().join(".situate/localization.json");
    fs::write(&localization, b"unrelated settings").unwrap();
    let saved = store.update(Accent::Peach, None).unwrap();
    let other = Storage::open(two.path()).unwrap();
    assert_eq!(other.snapshot().unwrap().accent, Accent::Violet);
    assert_eq!(other.snapshot().unwrap().revision, None);
    fs::copy(
        one.path().join(".situate/appearance.json"),
        two.path().join(".situate/appearance.json"),
    )
    .unwrap();
    assert_eq!(other.snapshot().unwrap(), saved);
    other
        .update(Accent::Sky, saved.revision.as_deref())
        .unwrap();
    assert_eq!(store.snapshot().unwrap(), saved);
    assert_eq!(fs::read(localization).unwrap(), b"unrelated settings");
}

#[test]
fn corrupt_unsupported_and_oversized_documents_are_preserved() {
    let root = workspace();
    let store = Storage::open(root.path()).unwrap();
    let path = root.path().join(".situate/appearance.json");
    for bytes in [
        b"not json".to_vec(),
        br#"{"version":2,"accent":"cobalt"}"#.to_vec(),
        br#"{"version":1,"accent":"green"}"#.to_vec(),
        br#"{"version":1}"#.to_vec(),
        br#"{"accent":"sky"}"#.to_vec(),
        b"null".to_vec(),
        vec![b' '; LIMIT as usize + 1],
    ] {
        fs::write(&path, &bytes).unwrap();
        assert_eq!(store.snapshot().unwrap_err(), INVALID);
        assert_eq!(store.update(Accent::Lemon, None).unwrap_err(), INVALID);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn external_edits_deletion_and_stale_creations_conflict_without_data_loss() {
    let root = workspace();
    let store = Storage::open(root.path()).unwrap();
    let path = root.path().join(".situate/appearance.json");
    let first = store.update(Accent::Cobalt, None).unwrap();
    assert_eq!(
        store.update(Accent::Sky, None).unwrap_err(),
        "native.appearance.changed"
    );
    let same = store
        .update(Accent::Cobalt, first.revision.as_deref())
        .unwrap();
    assert_ne!(first.revision, same.revision);
    assert_eq!(
        store
            .update(Accent::Sky, first.revision.as_deref())
            .unwrap_err(),
        "native.appearance.changed"
    );
    let external = br#"{"version":1,"accent":"cobalt","custom":"retained"}"#;
    fs::write(&path, external).unwrap();
    let received = store.snapshot().unwrap();
    assert_ne!(received.revision, same.revision);
    assert_eq!(
        store
            .update(Accent::Sky, same.revision.as_deref())
            .unwrap_err(),
        "native.appearance.changed"
    );
    assert_eq!(fs::read(&path).unwrap(), external);
    let saved = store
        .update(Accent::Lemon, received.revision.as_deref())
        .unwrap();
    let document: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(document["custom"], "retained");
    fs::remove_file(&path).unwrap();
    assert_eq!(
        store
            .update(Accent::Sky, saved.revision.as_deref())
            .unwrap_err(),
        "native.appearance.changed"
    );
    assert!(!path.exists());
}

#[test]
fn held_writer_lock_does_not_block_reads_or_replace_data() {
    let root = workspace();
    let store = Storage::open(root.path()).unwrap();
    let first = store.update(Accent::Sky, None).unwrap();
    let _lock = store.lock().unwrap();
    let reopened = Storage::open(root.path()).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), first);
    assert_eq!(
        reopened
            .update(Accent::Lemon, first.revision.as_deref())
            .unwrap_err(),
        "native.appearance.busy"
    );
    assert_eq!(reopened.snapshot().unwrap(), first);
}

#[cfg(unix)]
#[test]
fn read_only_directory_and_file_are_read_without_writes() {
    use std::os::unix::fs::PermissionsExt;
    let root = workspace();
    let directory = root.path().join(".situate");
    let path = directory.join("appearance.json");
    let store = Storage::open(root.path()).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    assert_eq!(store.snapshot().unwrap(), Snapshot::default());
    assert_eq!(
        store.update(Accent::Sky, None).unwrap_err(),
        "native.appearance.readOnly"
    );
    assert!(!directory.join("appearance.lock").exists());
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let saved = store.update(Accent::Peach, None).unwrap();
    fs::remove_file(directory.join("appearance.lock")).unwrap();
    let bytes = fs::read(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
    assert_eq!(
        store.snapshot().unwrap(),
        Snapshot {
            writable: false,
            ..saved.clone()
        }
    );
    assert_eq!(
        store
            .update(Accent::Sky, saved.revision.as_deref())
            .unwrap_err(),
        "native.appearance.readOnly"
    );
    assert!(!directory.join("appearance.lock").exists());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_files_locks_ancestors_and_nonregular_files_cannot_redirect_io() {
    use std::os::unix::fs::symlink;
    let root = workspace();
    let outside = workspace();
    let target = outside.path().join("sentinel");
    let path = root.path().join(".situate/appearance.json");
    let lock = root.path().join(".situate/appearance.lock");
    let store = Storage::open(root.path()).unwrap();
    for exists in [false, true] {
        if exists {
            fs::write(&target, b"keep").unwrap();
        }
        symlink(&target, &path).unwrap();
        assert!(store.snapshot().is_err());
        assert!(store.update(Accent::Sky, None).is_err());
        assert_eq!(target.exists(), exists);
        fs::remove_file(&path).unwrap();
    }
    symlink(&target, &lock).unwrap();
    assert!(store.update(Accent::Sky, None).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"keep");
    fs::remove_file(&lock).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(store.snapshot().is_err());
    assert!(store.update(Accent::Sky, None).is_err());
    fs::remove_dir(&path).unwrap();
    fs::remove_dir(root.path().join(".situate")).unwrap();
    symlink(
        outside.path().join(".situate"),
        root.path().join(".situate"),
    )
    .unwrap();
    assert!(Storage::open(root.path()).is_err());
    let alias = outside.path().join("alias");
    symlink(root.path(), &alias).unwrap();
    assert!(Storage::open(&alias).is_err());
}

#[cfg(unix)]
#[test]
fn held_directory_is_not_redirected_by_marker_replacement() {
    use std::os::unix::fs::symlink;
    let root = workspace();
    let outside = workspace();
    let store = Storage::open(root.path()).unwrap();
    let marker = root.path().join(".situate");
    let retained = root.path().join("retained");
    fs::rename(&marker, &retained).unwrap();
    symlink(outside.path().join(".situate"), &marker).unwrap();
    let saved = store.update(Accent::Sky, None).unwrap();
    assert_eq!(store.snapshot().unwrap(), saved);
    assert!(retained.join("appearance.json").is_file());
    assert!(!outside.path().join(".situate/appearance.json").exists());
    assert!(Storage::open(root.path()).is_err());
}

#[cfg(unix)]
#[test]
fn atomic_replacement_keeps_hardlink_alias_unchanged_and_private_permissions() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let root = workspace();
    let outside = workspace();
    let path = root.path().join(".situate/appearance.json");
    let alias = outside.path().join("sentinel");
    fs::write(&path, br#"{"version":1,"accent":"peach"}"#).unwrap();
    fs::hard_link(&path, &alias).unwrap();
    let before = fs::read(&alias).unwrap();
    let store = Storage::open(root.path()).unwrap();
    store
        .update(Accent::Sky, store.snapshot().unwrap().revision.as_deref())
        .unwrap();
    assert_eq!(fs::read(&alias).unwrap(), before);
    assert_ne!(
        fs::metadata(&path).unwrap().ino(),
        fs::metadata(&alias).unwrap().ino()
    );
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(
        !fs::read_dir(root.path().join(".situate"))
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp"))
    );
}
