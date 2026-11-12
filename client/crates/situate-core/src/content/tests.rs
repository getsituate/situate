use super::*;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    temp
}
fn saved(outcome: SaveOutcome) -> TextVersion {
    match outcome {
        SaveOutcome::Saved { version, .. } => version,
        other => panic!("Expected saved, got {other:?}"),
    }
}

#[cfg(unix)]
#[test]
fn content_owner_drop_unlocks_while_an_unrelated_child_holds_the_descriptor() {
    use std::io::{Read, Write};
    use std::os::fd::AsRawFd;
    use std::os::unix::{net::UnixStream, process::CommandExt};
    let root = workspace();
    let store = ContentStore::open(root.path()).unwrap();
    let (mut parent, child) = UnixStream::pair().unwrap();
    parent
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    child
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    let worker = std::thread::spawn(move || {
        let fd = child.as_raw_fd();
        let mut command = std::process::Command::new("/bin/sh");
        command.args(["-c", ":"]);
        // Only async-signal-safe syscalls run between fork and exec.
        unsafe {
            command.pre_exec(move || {
                let mut byte = 1u8;
                if libc::write(fd, (&byte as *const u8).cast(), 1) != 1
                    || libc::read(fd, (&mut byte as *mut u8).cast(), 1) != 1
                {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let result = command.spawn();
        drop(child);
        result.unwrap().wait().unwrap()
    });
    let mut ready = [0];
    parent.read_exact(&mut ready).unwrap();
    let while_owned = ContentStore::open(root.path());
    drop(store);
    let after_drop = ContentStore::open(root.path());
    parent.write_all(&[1]).unwrap();
    assert!(worker.join().unwrap().success());
    assert!(matches!(while_owned, Err(ContentError::Busy)));
    assert!(
        after_drop.is_ok(),
        "owner drop must release the lock while the child is paused: {:?}",
        after_drop.err()
    );
}

#[test]
fn ownership_guard_releases_the_lock_on_error_before_store_construction() {
    let root = workspace();
    let path = root.path().join(".situate/content.lock");
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .unwrap();
    let inherited = file.try_clone().unwrap();
    let failed: Result<()> = (|| {
        let _ownership = ContentOwnership::acquire(file)?;
        Err(ContentError::InvalidPath)
    })();
    assert!(matches!(failed, Err(ContentError::InvalidPath)));
    let reopened = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    assert!(ContentOwnership::acquire(reopened).is_ok());
    drop(inherited);
}

#[test]
fn ignored_artifacts_do_not_enter_listings_or_create_history() {
    let root = workspace();
    fs::create_dir(root.path().join("nested")).unwrap();
    fs::write(root.path().join("nested/.env"), "synthetic").unwrap();
    fs::write(root.path().join("note.tmp"), "retained").unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let before = store.record_external_changes().unwrap();
    fs::write(root.path().join(".DS_Store"), "finder").unwrap();
    fs::write(root.path().join("nested/.note.md.swp"), "swap").unwrap();
    fs::create_dir(root.path().join(".AppleDouble")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("/unavailable", root.path().join(".AppleDouble/link")).unwrap();
    assert_eq!(store.record_external_changes().unwrap(), before);
    assert_eq!(
        store
            .list()
            .unwrap()
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>(),
        vec!["nested", "nested/.env", "note.tmp"]
    );
    fs::write(root.path().join(".DS_Store"), "changed finder metadata").unwrap();
    assert_eq!(store.record_external_changes().unwrap(), before);
    assert_eq!(
        fs::read(root.path().join(".DS_Store")).unwrap(),
        b"changed finder metadata"
    );
    drop(store);
    let mut store = ContentStore::open(root.path()).unwrap();
    assert_eq!(store.record_external_changes().unwrap(), before);
    assert!(store.read_revision(".DS_Store", &before).is_err());
    fs::write(root.path().join("note.tmp"), "real edit").unwrap();
    assert_ne!(store.record_external_changes().unwrap(), before);
}

#[test]
fn history_tree_sync_preserves_nested_file_contents() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("objects")).unwrap();
    fs::write(temp.path().join("HEAD"), b"ref: refs/heads/main\n").unwrap();
    fs::write(temp.path().join("objects/blob"), [0, 255, 42]).unwrap();
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    sync_tree(&dir).unwrap();
    assert_eq!(
        fs::read(temp.path().join("HEAD")).unwrap(),
        b"ref: refs/heads/main\n"
    );
    assert_eq!(
        fs::read(temp.path().join("objects/blob")).unwrap(),
        [0, 255, 42]
    );
}

#[cfg(windows)]
#[test]
fn history_tree_sync_propagates_file_sharing_errors() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("HEAD");
    fs::write(&path, b"original").unwrap();
    let _reader = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&path)
        .unwrap();
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    match sync_tree(&dir).unwrap_err() {
        ContentError::Io(error) => assert_eq!(error.raw_os_error(), Some(32)),
        other => panic!("Expected a sharing error, got {other:?}"),
    }
    assert_eq!(fs::read(path).unwrap(), b"original");
}

#[cfg(windows)]
mod windows_history_sync {
    use super::*;
    use std::os::windows::fs::MetadataExt;

    fn readonly_object() -> (tempfile::TempDir, std::path::PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let repo = Repository::init_bare(temp.path()).unwrap();
        let oid = repo.blob(b"immutable history").unwrap().to_string();
        let path = temp.path().join("objects").join(&oid[..2]).join(&oid[2..]);
        assert!(fs::metadata(&path).unwrap().permissions().readonly());
        (temp, path)
    }

    fn assert_readonly_rejected(dir: &Dir) {
        match sync_tree(dir).unwrap_err() {
            ContentError::Io(error) => {
                assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
                assert_eq!(
                    error.to_string(),
                    "Read-only history files cannot be synchronized safely."
                );
            }
            other => panic!("Expected read-only rejection, got {other:?}"),
        }
    }

    #[test]
    fn existing_readonly_git_objects_are_rejected_without_changing_bytes_or_attributes() {
        let (temp, path) = readonly_object();
        let bytes = fs::read(&path).unwrap();
        let attributes = fs::metadata(&path).unwrap().file_attributes();
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        assert_readonly_rejected(&dir);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::metadata(path).unwrap().file_attributes(), attributes);
    }

    #[test]
    fn readonly_hardlinked_objects_are_rejected_without_changing_outside_aliases() {
        let (temp, path) = readonly_object();
        let outside = tempfile::tempdir().unwrap();
        let alias = outside.path().join("outside.bin");
        fs::hard_link(&path, &alias).unwrap();
        let bytes = fs::read(&alias).unwrap();
        let attributes = fs::metadata(&alias).unwrap().file_attributes();
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        assert_readonly_rejected(&dir);
        for entry in [&path, &alias] {
            assert_eq!(fs::read(entry).unwrap(), bytes);
            assert_eq!(fs::metadata(entry).unwrap().file_attributes(), attributes);
        }
    }

    #[test]
    fn ordinary_readonly_files_without_aliases_are_rejected_unchanged() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("HEAD");
        fs::write(&path, b"original").unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();
        let attributes = fs::metadata(&path).unwrap().file_attributes();
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        assert_readonly_rejected(&dir);
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::metadata(path).unwrap().file_attributes(), attributes);
    }

    #[test]
    fn writable_history_files_flush_without_changing_hardlink_aliases() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("HEAD");
        fs::write(&path, b"original").unwrap();
        assert!(!fs::metadata(&path).unwrap().permissions().readonly());
        let outside = tempfile::tempdir().unwrap();
        let alias = outside.path().join("outside.bin");
        fs::hard_link(&path, &alias).unwrap();
        let attributes = fs::metadata(&alias).unwrap().file_attributes();
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        sync_tree(&dir).unwrap();
        for entry in [&path, &alias] {
            assert_eq!(fs::read(entry).unwrap(), b"original");
            assert_eq!(fs::metadata(entry).unwrap().file_attributes(), attributes);
        }
    }

    #[test]
    fn junction_history_entries_cannot_mutate_outside_object_attributes() {
        let (outside, path) = readonly_object();
        let bytes = fs::read(&path).unwrap();
        let attributes = fs::metadata(&path).unwrap().file_attributes();
        let temp = tempfile::tempdir().unwrap();
        let link = temp.path().join("junction");
        let output = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
        match sync_tree(&dir).unwrap_err() {
            ContentError::History(message) => {
                assert_eq!(message, "native.content.history.unsupportedEntry");
            }
            error => panic!("Expected unsupported history entry, got {error:?}"),
        }
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::metadata(path).unwrap().file_attributes(), attributes);
        fs::remove_dir(link).unwrap();
    }
}

#[test]
fn marker_required_and_initial_history_preserves_text_binary_and_structure() {
    let missing = tempfile::tempdir().unwrap();
    assert!(ContentStore::open(missing.path()).is_err());
    assert!(!missing.path().join(".situate").exists());
    let temp = workspace();
    fs::create_dir(temp.path().join("notes")).unwrap();
    fs::create_dir(temp.path().join("empty")).unwrap();
    fs::write(temp.path().join("notes/a.md"), "# Original\n").unwrap();
    fs::write(temp.path().join("image.bin"), [0, 255, 128, 42]).unwrap();
    let store = ContentStore::open(temp.path()).unwrap();
    let history = store.history().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(
        store
            .read_revision("image.bin", &history[0].revision)
            .unwrap(),
        [0, 255, 128, 42]
    );
    assert_eq!(store.read_text("notes/a.md").unwrap().text, "# Original\n");
    assert!(store.read_text("image.bin").is_err());
    assert_eq!(
        store
            .list()
            .unwrap()
            .iter()
            .map(|e| e.path.as_str())
            .collect::<Vec<_>>(),
        ["empty", "image.bin", "notes", "notes/a.md"]
    );
    assert_eq!(
        fs::read(temp.path().join("image.bin")).unwrap(),
        [0, 255, 128, 42]
    );
    assert!(matches!(
        ContentStore::open(temp.path()),
        Err(ContentError::Busy)
    ));
    drop(store);
    let reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(reopened.history().unwrap(), history);
}

#[test]
fn streamed_binary_snapshots_preserve_all_bytes_and_empty_directory_trees() {
    let temp = workspace();
    let bytes: Vec<u8> = (0..24_577).map(|index| (index % 251) as u8).collect();
    fs::write(temp.path().join("attachment.bin"), &bytes).unwrap();
    fs::create_dir(temp.path().join("empty")).unwrap();
    let store = ContentStore::open(temp.path()).unwrap();
    let commit = store.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(
        store
            .read_revision("attachment.bin", &commit.id().to_string())
            .unwrap(),
        bytes
    );
    let tree = commit.tree().unwrap();
    let empty = tree.get_path(Path::new("empty")).unwrap();
    assert!(store.repo.find_tree(empty.id()).unwrap().is_empty());
}

#[test]
fn offline_save_reopen_and_external_reopen_history() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = saved(store.create_text("note.md", "original\n").unwrap());
    let edited = saved(store.save("note.md", &base, "edited\n").unwrap());
    assert_eq!(edited.text, "edited\n");
    assert!(store.drafts().unwrap().is_empty());
    assert_eq!(store.history().unwrap().len(), 3);
    drop(store);
    fs::write(temp.path().join("note.md"), "external while closed\n").unwrap();
    let store = ContentStore::open(temp.path()).unwrap();
    let history = store.history().unwrap();
    assert_eq!(history.len(), 4);
    assert_eq!(history[0].message, "native.history.externalChanges");
    assert_eq!(
        store
            .read_revision("note.md", &history[1].revision)
            .unwrap(),
        b"edited\n"
    );
}

#[test]
fn actual_git_three_way_merge_preserves_independent_edits_and_external_commit() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "one\ntwo\nthree\nfour\nfive\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    fs::write(
        temp.path().join("note.md"),
        "one\ntwo\nthree\nfour\nexternal\n",
    )
    .unwrap();
    let result = saved(
        store
            .save("note.md", &base, "editor\ntwo\nthree\nfour\nfive\n")
            .unwrap(),
    );
    assert_eq!(result.text, "editor\ntwo\nthree\nfour\nexternal\n");
    assert_eq!(
        fs::read_to_string(temp.path().join("note.md")).unwrap(),
        result.text
    );
    let history = store.history().unwrap();
    assert_eq!(
        history
            .iter()
            .map(|h| h.message.as_str())
            .collect::<Vec<_>>(),
        [
            "native.history.editFile",
            "native.history.externalChanges",
            "native.history.initialContent"
        ]
    );
    assert_eq!(
        store
            .read_revision("note.md", &history[1].revision)
            .unwrap(),
        b"one\ntwo\nthree\nfour\nexternal\n"
    );
}

fn conflict(store: &mut ContentStore, temp: &tempfile::TempDir) -> String {
    let base = store.read_text("note.md").unwrap();
    fs::write(temp.path().join("note.md"), "external\n").unwrap();
    match store.save("note.md", &base, "editor\n").unwrap() {
        SaveOutcome::Conflict {
            editor,
            external,
            review_token,
        } => {
            assert_eq!(editor, "editor\n");
            assert_eq!(external.text, "external\n");
            review_token
        }
        other => panic!("Expected conflict, got {other:?}"),
    }
}
#[test]
fn full_version_conflict_choices_and_durable_dismissal() {
    for choice in [VersionChoice::Editor, VersionChoice::External] {
        let temp = workspace();
        fs::write(temp.path().join("note.md"), "base\n").unwrap();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let token = conflict(&mut store, &temp);
        assert_eq!(
            fs::read_to_string(temp.path().join("note.md")).unwrap(),
            "external\n"
        );
        assert_eq!(store.drafts().unwrap()[0].text, "editor\n");
        let result = saved(store.resolve(&token, choice).unwrap());
        assert_eq!(
            result.text,
            match choice {
                VersionChoice::Editor => "editor\n",
                VersionChoice::External => "external\n",
            }
        );
        assert!(store.drafts().unwrap().is_empty());
    }
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    conflict(&mut store, &temp);
    drop(store);
    let mut store = ContentStore::open(temp.path()).unwrap();
    let drafts = store.drafts().unwrap();
    assert_eq!(drafts[0].text, "editor\n");
    assert_eq!(drafts[0].base.as_ref().unwrap().text, "base\n");
    store.discard_draft("note.md").unwrap();
    assert!(store.drafts().unwrap().is_empty());
}

#[test]
fn explicit_choice_rechecks_bytes_and_reused_path_identity() {
    for replace in [false, true] {
        let temp = workspace();
        fs::write(temp.path().join("note.md"), "base\n").unwrap();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let token = conflict(&mut store, &temp);
        let text = if replace {
            "external\n"
        } else {
            "new unseen edit\n"
        };
        if replace {
            fs::remove_file(temp.path().join("note.md")).unwrap();
        }
        fs::write(temp.path().join("note.md"), text).unwrap();
        assert_eq!(
            store.resolve(&token, VersionChoice::Editor).unwrap(),
            SaveOutcome::ChangedSinceReview
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("note.md")).unwrap(),
            text
        );
        assert_eq!(store.drafts().unwrap()[0].text, "editor\n");
    }
}

#[test]
fn external_deletion_never_recreates_target_and_retains_history_and_draft() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    fs::remove_file(temp.path().join("note.md")).unwrap();
    assert_eq!(
        store.save("note.md", &base, "pending\n").unwrap(),
        SaveOutcome::ExternalDeleted
    );
    assert!(!temp.path().join("note.md").exists());
    assert_eq!(store.drafts().unwrap()[0].text, "pending\n");
    let history = store.history().unwrap();
    assert_eq!(
        store
            .read_revision("note.md", &history[1].revision)
            .unwrap(),
        b"base\n"
    );
}

#[test]
fn draft_failure_prevents_target_write_and_reports_no_durability() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    fs::create_dir(
        temp.path()
            .join(".situate/drafts")
            .join(draft_name("note.md").unwrap()),
    )
    .unwrap();
    assert!(matches!(
        store.save("note.md", &base, "pending\n"),
        Err(ContentError::DraftPersistence(_))
    ));
    assert_eq!(
        fs::read_to_string(temp.path().join("note.md")).unwrap(),
        "base\n"
    );
}

#[test]
fn history_commit_failure_is_distinct_from_successful_target_write() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    git_storage::FAIL_REF_SYNC.set(Some(1));
    assert!(matches!(
        store.save("note.md", &base, "saved\n").unwrap(),
        SaveOutcome::SavedHistoryFailed { .. }
    ));
    assert_eq!(
        fs::read_to_string(temp.path().join("note.md")).unwrap(),
        "saved\n"
    );
    assert_eq!(store.drafts().unwrap()[0].text, "saved\n");
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(store.drafts().unwrap()[0].text, "saved\n");
}

#[test]
fn corrupt_history_is_not_reinitialized_and_content_untouched() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "keep\n").unwrap();
    drop(ContentStore::open(temp.path()).unwrap());
    fs::write(temp.path().join(".situate/history.git/HEAD"), "broken").unwrap();
    assert!(matches!(
        ContentStore::open(temp.path()),
        Err(ContentError::History(_))
    ));
    assert_eq!(
        fs::read_to_string(temp.path().join(".situate/history.git/HEAD")).unwrap(),
        "broken"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("note.md")).unwrap(),
        "keep\n"
    );
}

#[test]
fn create_does_not_clobber_and_invalid_paths_cannot_write_internals() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = saved(store.create_text("note.md", "keep\n").unwrap());
    assert!(store.create_text("note.md", "do not replace\n").is_err());
    assert_eq!(store.read_text("note.md").unwrap().text, "keep\n");
    for path in [
        "",
        ".",
        "..",
        "../escape.md",
        "/absolute",
        ".situate/state",
        "a/.git/config",
        ".GIT/config",
        "a//b",
        "a/./b",
        "a/../b",
        "a\\b",
        "C:escape",
        "trailing.",
        "bad\0name",
    ] {
        assert!(
            matches!(
                store.create_text(path, "bad"),
                Err(ContentError::InvalidPath)
            ),
            "{path}"
        );
        assert!(
            matches!(
                store.save(path, &base, "bad"),
                Err(ContentError::InvalidPath)
            ),
            "{path}"
        );
    }
    let wrong = TextVersion {
        text: "fabricated".into(),
        revision: base.revision,
    };
    assert!(matches!(
        store.save("note.md", &wrong, "bad"),
        Err(ContentError::InvalidBase)
    ));
}

#[test]
fn deletion_of_parent_folder_still_secures_pending_draft() {
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("folder/note.md").unwrap();
    fs::remove_dir_all(temp.path().join("folder")).unwrap();
    assert_eq!(
        store.save("folder/note.md", &base, "pending\n").unwrap(),
        SaveOutcome::ExternalDeleted
    );
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(store.drafts().unwrap()[0].text, "pending\n");
}

#[test]
fn failed_conflict_application_can_retry_without_discarding_the_review() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let token = conflict(&mut store, &temp);
    fs::write(temp.path().join("other.md"), "external change").unwrap();
    let head = store.repo.head().unwrap().name().unwrap().to_owned();
    let lock = temp
        .path()
        .join(".situate/history.git")
        .join(format!("{head}.lock"));
    fs::write(&lock, "locked").unwrap();
    assert!(store.resolve(&token, VersionChoice::Editor).is_err());
    assert_eq!(store.drafts().unwrap()[0].text, "editor\n");
    assert_eq!(store.read_text("note.md").unwrap().text, "external\n");
    fs::remove_file(lock).unwrap();
    assert_eq!(
        saved(store.resolve(&token, VersionChoice::Editor).unwrap()).text,
        "editor\n"
    );
}

#[cfg(unix)]
#[test]
fn failed_initial_snapshot_does_not_publish_broken_history() {
    let temp = workspace();
    fs::write(temp.path().join("invalid:name.md"), "keep").unwrap();
    assert!(matches!(
        ContentStore::open(temp.path()),
        Err(ContentError::InvalidPath)
    ));
    assert!(!temp.path().join(".situate/history.git").exists());
    fs::rename(
        temp.path().join("invalid:name.md"),
        temp.path().join("valid.md"),
    )
    .unwrap();
    let store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(store.history().unwrap().len(), 1);
    assert_eq!(store.read_text("valid.md").unwrap().text, "keep");
}

#[test]
fn failed_creation_preserves_existing_conflict_and_deleted_file_drafts() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let token = conflict(&mut store, &temp);
    assert!(store.create_text("note.md", "different draft").is_err());
    assert_eq!(store.drafts().unwrap()[0].text, "editor\n");
    fs::remove_file(temp.path().join("note.md")).unwrap();
    assert!(store.create_text("note.md", "different draft").is_err());
    assert!(!temp.path().join("note.md").exists());
    assert_eq!(store.drafts().unwrap()[0].text, "editor\n");
    assert_eq!(
        store.resolve(&token, VersionChoice::Editor).unwrap(),
        SaveOutcome::ExternalDeleted
    );
}

#[cfg(unix)]
#[test]
fn readonly_target_is_not_replaced_and_pending_text_is_durable() {
    use std::os::unix::fs::PermissionsExt;
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "keep\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    fs::set_permissions(
        temp.path().join("note.md"),
        fs::Permissions::from_mode(0o400),
    )
    .unwrap();
    assert!(
        matches!(store.save("note.md", &base, "pending\n"), Err(ContentError::Io(e)) if e.kind() == io::ErrorKind::PermissionDenied)
    );
    assert_eq!(store.read_text("note.md").unwrap().text, "keep\n");
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(store.drafts().unwrap()[0].text, "pending\n");
}

#[test]
fn history_publication_never_replaces_an_occupied_directory() {
    let temp = workspace();
    let marker_path = temp.path().join(".situate");
    fs::create_dir(marker_path.join("history.git")).unwrap();
    fs::create_dir(marker_path.join("staged")).unwrap();
    fs::write(marker_path.join("staged/HEAD"), "staged").unwrap();
    let marker = Dir::open_ambient_dir(&marker_path, ambient_authority()).unwrap();
    assert!(publish_history(&marker, "staged", &marker_path.join("history.git")).is_err());
    assert_eq!(
        fs::read_dir(marker_path.join("history.git"))
            .unwrap()
            .count(),
        0
    );
    assert!(marker_path.join("staged/HEAD").exists());
}

#[test]
fn corrupt_draft_is_reported_not_removed() {
    let temp = workspace();
    let store = ContentStore::open(temp.path()).unwrap();
    let draft = temp.path().join(".situate/drafts/broken.json");
    fs::write(&draft, "not json").unwrap();
    assert!(matches!(
        store.drafts(),
        Err(ContentError::DraftPersistence(_))
    ));
    assert_eq!(fs::read_to_string(draft).unwrap(), "not json");
}

#[test]
fn unsupported_or_broken_recovery_records_cannot_be_overwritten_by_saving() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    let draft_path = temp
        .path()
        .join(".situate/drafts")
        .join(draft_name("note.md").unwrap());
    let unsupported = serde_json::json!({
        "version": 2,
        "draft": { "path": "note.md", "base": null, "text": "retained text" }
    })
    .to_string();
    for data in [unsupported.as_str(), "broken record"] {
        fs::write(&draft_path, data).unwrap();
        assert!(matches!(
            read_recovery_drafts(temp.path()),
            Err(ContentError::DraftPersistence(_))
        ));
        assert!(matches!(
            store.save("note.md", &base, "new edit"),
            Err(ContentError::DraftPersistence(_))
        ));
        assert_eq!(fs::read_to_string(&draft_path).unwrap(), data);
        assert_eq!(
            fs::read_to_string(temp.path().join("note.md")).unwrap(),
            "base\n"
        );
    }
}

#[test]
fn recovery_drafts_remain_readable_when_history_cannot_open() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    conflict(&mut store, &temp);
    let expected = store.drafts().unwrap();
    drop(store);
    let head = temp.path().join(".situate/history.git/HEAD");
    fs::write(&head, "broken history").unwrap();
    assert!(ContentStore::open(temp.path()).is_err());
    assert_eq!(read_recovery_drafts(temp.path()).unwrap(), expected);
    assert_eq!(fs::read_to_string(&head).unwrap(), "broken history");
    assert_eq!(
        fs::read_to_string(temp.path().join("note.md")).unwrap(),
        "external\n"
    );
}

#[test]
fn recovery_read_does_not_initialize_storage_and_preserves_invalid_drafts() {
    let temp = workspace();
    assert!(read_recovery_drafts(temp.path()).unwrap().is_empty());
    assert_eq!(
        fs::read_dir(temp.path().join(".situate")).unwrap().count(),
        0
    );
    let drafts = temp.path().join(".situate/drafts");
    fs::create_dir(&drafts).unwrap();
    fs::write(drafts.join("broken.json"), "retained bytes").unwrap();
    assert!(matches!(
        read_recovery_drafts(temp.path()),
        Err(ContentError::DraftPersistence(_))
    ));
    assert_eq!(
        fs::read_to_string(drafts.join("broken.json")).unwrap(),
        "retained bytes"
    );
}

#[cfg(unix)]
#[test]
fn recovery_read_rejects_symlinked_draft_storage() {
    let temp = workspace();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), temp.path().join(".situate/drafts")).unwrap();
    assert!(read_recovery_drafts(temp.path()).is_err());
    assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
}

#[cfg(unix)]
#[test]
fn replacement_preserves_private_permissions_and_raw_git_does_not_run_filters_or_hooks() {
    use std::os::unix::fs::PermissionsExt;
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "base\n").unwrap();
    fs::set_permissions(
        temp.path().join("note.md"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let hook = temp.path().join(".situate/history.git/hooks/pre-commit");
    fs::create_dir_all(hook.parent().unwrap()).unwrap();
    fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    fs::set_permissions(hook, fs::Permissions::from_mode(0o700)).unwrap();
    store
        .repo
        .config()
        .unwrap()
        .set_str("filter.reject.clean", "false")
        .unwrap();
    store
        .repo
        .config()
        .unwrap()
        .set_bool("filter.reject.required", true)
        .unwrap();
    fs::write(temp.path().join(".gitattributes"), "*.md filter=reject\n").unwrap();
    let base = store.read_text("note.md").unwrap();
    saved(store.save("note.md", &base, "saved\n").unwrap());
    assert_eq!(
        fs::metadata(temp.path().join("note.md"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let commit = store.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(commit.author().name().unwrap(), "Situate");
    assert_eq!(commit.author().email().unwrap(), "content@situate.invalid");
    assert_eq!(
        store
            .read_revision("note.md", &commit.id().to_string())
            .unwrap(),
        b"saved\n"
    );
}

#[cfg(unix)]
#[test]
fn symlink_targets_parents_markers_and_history_are_rejected() {
    use std::os::unix::fs::symlink;
    let temp = workspace();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("private.md"), "private").unwrap();
    symlink(outside.path(), temp.path().join("escape")).unwrap();
    symlink(
        outside.path().join("private.md"),
        temp.path().join("linked.md"),
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    assert!(store.list().unwrap().is_empty());
    assert!(store.read_text("linked.md").is_err());
    assert!(store.create_text("escape/new.md", "bad").is_err());
    assert!(store.create_text("linked.md", "bad").is_err());
    assert!(!outside.path().join("new.md").exists());
    assert_eq!(
        fs::read_to_string(outside.path().join("private.md")).unwrap(),
        "private"
    );
    drop(store);
    symlink(
        outside.path().join("private.md"),
        temp.path().join(".situate/history.git/unsafe"),
    )
    .unwrap();
    assert!(matches!(
        ContentStore::open(temp.path()),
        Err(ContentError::History(_))
    ));
    let fake = tempfile::tempdir().unwrap();
    symlink(temp.path().join(".situate"), fake.path().join(".situate")).unwrap();
    assert!(ContentStore::open(fake.path()).is_err());
}
