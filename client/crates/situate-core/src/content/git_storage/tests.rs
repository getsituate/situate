use super::*;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::write(temp.path().join("note.md"), b"first\n").unwrap();
    temp
}

#[test]
fn trees_match_git_ordering_and_modes_without_freshening() {
    let temp = tempfile::tempdir().unwrap();
    let repo = Repository::init_bare(temp.path()).unwrap();
    let blob = repo.blob(b"value").unwrap();
    let empty = repo.treebuilder(None).unwrap().write().unwrap();
    let mut builder = repo.treebuilder(None).unwrap();
    for (name, oid, mode) in [
        ("a.c", blob, 0o100644),
        ("a", empty, 0o040000),
        ("a0", blob, 0o100755),
        ("a-", blob, 0o100644),
        ("link", blob, 0o120000),
        ("notes-☕", blob, 0o100644),
    ] {
        builder.insert(name, oid, mode).unwrap();
    }
    let expected = builder.write().unwrap();
    assert_eq!(write_tree(&repo, &mut builder).unwrap(), expected);
    assert_eq!(builder.len(), 6);
    assert_eq!(repo.find_tree(expected).unwrap().len(), 6);
}

#[test]
fn streamed_objects_match_git_for_empty_chunked_and_reused_content() {
    let temp = tempfile::tempdir().unwrap();
    let repo = Repository::init_bare(temp.path()).unwrap();
    let database = repo.odb().unwrap();
    for bytes in [Vec::new(), (0..262_161).map(|i| (i % 251) as u8).collect()] {
        let expected = Oid::hash_object(ObjectType::Blob, &bytes).unwrap();
        for _ in 0..2 {
            let mut stream = BlobWriter::new(&database, bytes.len()).unwrap();
            for chunk in bytes.chunks(37) {
                stream.write_all(chunk).unwrap();
            }
            assert_eq!(stream.finish().unwrap(), expected);
            assert_eq!(repo.find_blob(expected).unwrap().content(), bytes);
        }
    }
}

#[test]
fn previous_history_and_reverted_content_survive_reopen_without_empty_commits() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    assert!(
        store
            .repo
            .config()
            .unwrap()
            .get_bool("core.fsyncObjectFiles")
            .unwrap()
    );
    for text in ["second\n", "first\n"] {
        let base = store.read_text("note.md").unwrap();
        assert!(matches!(
            store.save("note.md", &base, text).unwrap(),
            SaveOutcome::Saved { .. }
        ));
    }
    let latest = store.record_external_changes().unwrap();
    assert_eq!(store.history().unwrap().len(), 3);
    drop(store);
    let mut reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(reopened.record_external_changes().unwrap(), latest);
    assert_eq!(reopened.history().unwrap().len(), 3);
    assert_eq!(
        reopened.read_revision("note.md", &initial).unwrap(),
        b"first\n"
    );
    assert_eq!(reopened.read_text("note.md").unwrap().text, "first\n");
}

#[test]
fn published_observation_survives_flush_failure_and_unchanged_retry() {
    for reopen in [false, true] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let previous = store.history().unwrap()[0].revision.clone();
        fs::write(temp.path().join("note.md"), b"outside editor\n").unwrap();
        let identity = same_file::Handle::from_path(temp.path().join("note.md")).unwrap();
        FAIL_REF_SYNC.set(Some(0));
        assert!(matches!(
            store.record_external_changes(),
            Err(ContentError::Io(_))
        ));
        assert_eq!(FAIL_REF_SYNC.get(), None);
        let published = store.history().unwrap()[0].revision.clone();
        assert_ne!(published, previous);
        if reopen {
            drop(store);
            store = ContentStore::open(temp.path()).unwrap();
        }
        assert_eq!(store.record_external_changes().unwrap(), published);
        assert_eq!(
            store
                .record_file("note.md", b"outside editor\n", "native.history.editFile")
                .unwrap(),
            published
        );
        let history = store.history().unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].message, "native.history.externalChanges");
        assert_eq!(history[1].revision, previous);
        assert_eq!(
            store.read_revision("note.md", &previous).unwrap(),
            b"first\n"
        );
        assert_eq!(
            store.read_revision("note.md", &published).unwrap(),
            b"outside editor\n"
        );
        assert_eq!(store.read_text("note.md").unwrap().text, "outside editor\n");
        assert_eq!(
            same_file::Handle::from_path(temp.path().join("note.md")).unwrap(),
            identity
        );
    }
}

#[test]
fn older_repository_configuration_is_upgraded_without_replacing_history() {
    let temp = workspace();
    let store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    store
        .repo
        .config()
        .unwrap()
        .remove("core.fsyncObjectFiles")
        .unwrap();
    drop(store);
    fs::write(temp.path().join("note.md"), b"outside editor\n").unwrap();
    let store = ContentStore::open(temp.path()).unwrap();
    let history = store.history().unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[1].revision, initial);
    assert_eq!(history[0].message, "native.history.externalChanges");
    assert_eq!(
        store.read_revision("note.md", &initial).unwrap(),
        b"first\n"
    );
    assert!(
        store
            .repo
            .config()
            .unwrap()
            .get_bool("core.fsyncObjectFiles")
            .unwrap()
    );
}

#[test]
fn content_history_reopens_in_another_process() {
    const ROOT: &str = "SITUATE_HISTORY_REOPEN_ROOT";
    const NONCE: &str = "SITUATE_HISTORY_REOPEN_NONCE";
    #[cfg(windows)]
    let _context = super::super::windows_test_support::restricted_context().unwrap();
    if let Some(path) = std::env::var_os(ROOT) {
        let path = PathBuf::from(path);
        let store = ContentStore::open(&path).unwrap();
        let history = store.history().unwrap();
        assert_eq!(history.len(), 3);
        for (entry, bytes) in history
            .iter()
            .zip([b"outside\n".as_slice(), b"editor\n", b"first\n"])
        {
            assert_eq!(
                store.read_revision("note.md", &entry.revision).unwrap(),
                bytes
            );
        }
        assert_eq!(history[0].message, "native.history.externalChanges");
        fs::write(
            path.join(".situate/reopen-complete"),
            std::env::var(NONCE).unwrap(),
        )
        .unwrap();
        return;
    }
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    assert!(matches!(
        store.save("note.md", &base, "editor\n").unwrap(),
        SaveOutcome::Saved { .. }
    ));
    fs::write(temp.path().join("note.md"), b"outside\n").unwrap();
    store.record_external_changes().unwrap();
    drop(store);
    let nonce = uuid::Uuid::new_v4().to_string();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "content::git_storage::tests::content_history_reopens_in_another_process",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(ROOT, temp.path())
        .env(NONCE, &nonce)
        .status()
        .unwrap();
    assert!(status.success(), "reopen worker failed: {status}");
    assert_eq!(
        fs::read_to_string(temp.path().join(".situate/reopen-complete")).unwrap(),
        nonce
    );
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

    fn blocker(path: &Path, directory: bool) -> File {
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
        let mut options = fs::OpenOptions::new();
        options.read(true).share_mode(FILE_SHARE_READ);
        if directory {
            options.custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
        }
        options.open(path).unwrap()
    }

    fn assert_sharing_error(result: Result<String>) {
        match result.unwrap_err() {
            ContentError::Io(error) => assert_eq!(error.raw_os_error(), Some(32)),
            error => panic!("Expected sharing error, got {error:?}"),
        }
    }

    #[test]
    fn object_directory_failure_does_not_publish_the_new_reference() {
        let _context = super::super::super::windows_test_support::restricted_context().unwrap();
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let previous = store.history().unwrap()[0].revision.clone();
        fs::write(temp.path().join("note.md"), b"outside editor\n").unwrap();
        let pin = blocker(&temp.path().join(".situate/history.git/objects"), true);
        assert_sharing_error(store.record_external_changes());
        assert_eq!(store.history().unwrap()[0].revision, previous);
        drop(pin);
        let revision = store.record_external_changes().unwrap();
        assert_ne!(revision, previous);
        assert_eq!(store.history().unwrap().len(), 2);
        drop(store);
        let reopened = ContentStore::open(temp.path()).unwrap();
        assert_eq!(reopened.history().unwrap()[0].revision, revision);
        assert_eq!(
            reopened.read_revision("note.md", &revision).unwrap(),
            b"outside editor\n"
        );
    }

    #[test]
    fn existing_history_flush_failure_prevents_observation_publication() {
        let _context = super::super::super::windows_test_support::restricted_context().unwrap();
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let previous = store.history().unwrap()[0].revision.clone();
        fs::write(temp.path().join("note.md"), b"outside editor\n").unwrap();
        let pin = blocker(&temp.path().join(".situate/history.git/HEAD"), false);
        for _ in 0..2 {
            assert_sharing_error(store.record_external_changes());
            assert_eq!(store.history().unwrap()[0].revision, previous);
            assert_eq!(store.history().unwrap().len(), 1);
            assert_eq!(store.read_text("note.md").unwrap().text, "outside editor\n");
        }
        drop(pin);
        let published = store.record_external_changes().unwrap();
        assert_ne!(published, previous);
        assert_eq!(store.history().unwrap().len(), 2);
        assert_eq!(
            store.read_revision("note.md", &published).unwrap(),
            b"outside editor\n"
        );
    }

    #[test]
    fn post_reference_flush_failure_is_retried_even_when_content_is_unchanged() {
        let _context = super::super::super::windows_test_support::restricted_context().unwrap();
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let previous = store.history().unwrap()[0].revision.clone();
        fs::write(temp.path().join("note.md"), b"outside editor\n").unwrap();
        let pin = blocker(&temp.path().join(".situate/history.git/HEAD"), false);
        // Enter snapshot publication directly: the public observation path flushes
        // existing history first and would hit the blocker before updating the ref.
        assert_sharing_error(store.record_snapshot("native.history.externalChanges"));
        let published = store.history().unwrap()[0].revision.clone();
        assert_ne!(published, previous);
        assert_sharing_error(store.record_external_changes());
        assert_sharing_error(store.record_snapshot("native.history.externalChanges"));
        assert_sharing_error(store.record_file(
            "note.md",
            b"outside editor\n",
            "native.history.editFile",
        ));
        assert_eq!(store.history().unwrap()[0].revision, published);
        assert_eq!(store.history().unwrap().len(), 2);
        assert_eq!(
            store.read_revision("note.md", &published).unwrap(),
            b"outside editor\n"
        );
        drop(pin);
        assert_eq!(store.record_external_changes().unwrap(), published);
        assert_eq!(store.history().unwrap().len(), 2);
        drop(store);
        let reopened = ContentStore::open(temp.path()).unwrap();
        assert_eq!(reopened.history().unwrap()[0].revision, published);
    }

    #[test]
    fn reopening_retries_parent_publication_barriers_without_resetting_history() {
        let _context = super::super::super::windows_test_support::restricted_context().unwrap();
        let temp = workspace();
        let marker = temp.path().join(".situate");
        drop(ContentStore::open(temp.path()).unwrap());
        fs::remove_dir(marker.join("drafts")).unwrap();
        let pin = blocker(&marker, true);
        for _ in 0..3 {
            match ContentStore::open(temp.path()) {
                Err(ContentError::Io(error)) => assert_eq!(error.raw_os_error(), Some(32)),
                Err(error) => panic!("Expected sharing error, got {error:?}"),
                Ok(_) => panic!("Opening acknowledged an unflushed parent"),
            }
            assert!(marker.join("history.git/refs/heads/main").is_file());
        }
        assert!(marker.join("drafts").is_dir());
        let head = fs::read(marker.join("history.git/refs/heads/main")).unwrap();
        drop(pin);
        let reopened = ContentStore::open(temp.path()).unwrap();
        assert_eq!(reopened.history().unwrap().len(), 1);
        assert_eq!(
            fs::read(marker.join("history.git/refs/heads/main")).unwrap(),
            head
        );
        assert_eq!(reopened.read_text("note.md").unwrap().text, "first\n");
    }

    #[test]
    fn object_directory_junction_is_rejected_before_reference_publication() {
        let _context = super::super::super::windows_test_support::restricted_context().unwrap();
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let previous = store.history().unwrap()[0].revision.clone();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("untouched");
        fs::write(&target, b"outside bytes").unwrap();
        let attributes = fs::metadata(&target).unwrap().file_attributes();
        let link = temp
            .path()
            .join(".situate")
            .join("history.git")
            .join("objects")
            .join("foreign");
        // Captured pipe creation can be denied while impersonating a restricted token.
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .status()
            .unwrap();
        assert!(status.success(), "junction creation failed: {status}");
        fs::write(temp.path().join("note.md"), b"changed\n").unwrap();
        assert!(
            matches!(store.record_external_changes(), Err(ContentError::History(key)) if key == "native.content.history.unsupportedEntry")
        );
        assert_eq!(store.history().unwrap()[0].revision, previous);
        assert_eq!(fs::read(&target).unwrap(), b"outside bytes");
        assert_eq!(fs::metadata(&target).unwrap().file_attributes(), attributes);
        fs::remove_dir(link).unwrap();
    }

    #[test]
    fn existing_readonly_objects_and_outside_aliases_are_never_freshened() {
        let _context = super::super::super::windows_test_support::restricted_context().unwrap();
        // Retain synthetic aliases even on assertion failure: cleanup must not clear READONLY.
        let path = workspace().keep();
        eprintln!("History alias fixture: {}", path.display());
        let mut store = ContentStore::open(&path).unwrap();
        let oid = Oid::hash_object(ObjectType::Blob, b"first\n")
            .unwrap()
            .to_string();
        let object = path
            .join(".situate/history.git/objects")
            .join(&oid[..2])
            .join(&oid[2..]);
        let alias = path.join(".situate/outside-object-alias");
        fs::hard_link(&object, &alias).unwrap();
        let pin = blocker(&object, false);
        let identity = same_file::Handle::from_file(pin.try_clone().unwrap()).unwrap();
        let bytes = fs::read(&alias).unwrap();
        let before = pin.metadata().unwrap();
        assert!(before.permissions().readonly());
        let commit = store.repo.head().unwrap().target().unwrap();
        let database = store.repo.odb().unwrap();
        let raw = database.read(commit).unwrap();
        assert_eq!(
            write_object(&store.repo, ObjectType::Commit, raw.data()).unwrap(),
            commit
        );
        drop(raw);
        drop(database);
        for text in ["second\n", "first\n"] {
            let base = store.read_text("note.md").unwrap();
            assert!(matches!(
                store.save("note.md", &base, text).unwrap(),
                SaveOutcome::Saved { .. }
            ));
        }
        store.record_external_changes().unwrap();
        drop(store);
        let reopened = ContentStore::open(&path).unwrap();
        assert_eq!(reopened.history().unwrap().len(), 3);
        for name in [&object, &alias] {
            let after = fs::metadata(name).unwrap();
            assert_eq!(fs::read(name).unwrap(), bytes);
            assert_eq!(after.file_attributes(), before.file_attributes());
            assert_eq!(after.last_write_time(), before.last_write_time());
            assert_eq!(same_file::Handle::from_path(name).unwrap(), identity);
        }
    }
}
