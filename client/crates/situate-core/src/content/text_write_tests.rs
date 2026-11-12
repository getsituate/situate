use super::history_records::{Envelope, Fact, Operation};
use super::*;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::write(temp.path().join("a.txt"), "before").unwrap();
    temp
}
fn fact(store: &ContentStore) -> Fact {
    Envelope::read(&store.repo.head().unwrap().peel_to_commit().unwrap())
        .unwrap()
        .fact
}
fn head(store: &ContentStore) -> String {
    store.repo.head().unwrap().target().unwrap().to_string()
}
#[derive(Clone, Copy, Debug)]
enum Action {
    Save,
    Create,
    Restore,
}
fn prepare(action: Action) -> (tempfile::TempDir, ContentStore, TextVersion, &'static str) {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("a.txt").unwrap();
    if matches!(action, Action::Restore) {
        fs::remove_file(temp.path().join("a.txt")).unwrap();
        store.record_external_changes().unwrap();
    }
    let path = if matches!(action, Action::Create) {
        "created.txt"
    } else {
        "a.txt"
    };
    (temp, store, base, path)
}
fn perform(store: &mut ContentStore, action: Action, base: &TextVersion) -> Result<SaveOutcome> {
    match action {
        Action::Save => store.save("a.txt", base, "after"),
        Action::Create => store.create_text("created.txt", "after"),
        Action::Restore => store.restore_draft("a.txt", base, "after"),
    }
}
fn copy_directory(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &to.join(entry.file_name()));
        } else {
            fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }
}

#[test]
fn source_documents_keep_exact_bytes_through_save_history_and_draft_copy() {
    let temp = workspace();
    let original = "{\"name\":\"before\",\"items\":[]}\n";
    let updated = "{\"name\":\"after\",\"items\":[1]}\n";
    fs::write(temp.path().join("settings.json"), original).unwrap();
    fs::write(temp.path().join("LICENSE"), "plain extensionless text\n").unwrap();
    fs::write(temp.path().join("binary.md"), b"%PDF-1.7\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    store.record_external_changes().unwrap();
    assert_eq!(
        fs::read(temp.path().join("settings.json")).unwrap(),
        original.as_bytes()
    );
    assert_eq!(
        fs::read(temp.path().join("binary.md")).unwrap(),
        b"%PDF-1.7\n"
    );
    assert!(store.read_text("binary.md").is_err());
    assert_eq!(
        store.read_text("LICENSE").unwrap().text,
        "plain extensionless text\n"
    );
    let base = store.read_text("settings.json").unwrap();
    store
        .stage_draft(&Draft {
            path: "settings.json".into(),
            base: Some(base.clone()),
            text: updated.into(),
        })
        .unwrap();
    assert_eq!(store.drafts().unwrap()[0].text, updated);
    let outcome = store.save("settings.json", &base, updated).unwrap();
    let SaveOutcome::Saved {
        history_revision, ..
    } = outcome
    else {
        panic!("{outcome:?}")
    };
    assert_eq!(
        fs::read(temp.path().join("settings.json")).unwrap(),
        updated.as_bytes()
    );
    assert_eq!(
        store
            .read_revision("settings.json", &history_revision)
            .unwrap(),
        updated.as_bytes()
    );
    assert!(store.drafts().unwrap().is_empty());
    store
        .create_from_draft("settings.json", "copy.json", updated)
        .unwrap();
    assert_eq!(
        fs::read(temp.path().join("copy.json")).unwrap(),
        updated.as_bytes()
    );
    store
        .reverse_change("settings.json", &history_revision)
        .unwrap();
    assert_eq!(
        fs::read(temp.path().join("settings.json")).unwrap(),
        original.as_bytes()
    );
}

#[test]
fn write_facts_allow_only_a_changed_regular_file_with_matching_mode() {
    let temp = workspace();
    let store = ContentStore::open(temp.path()).unwrap();
    let before = store
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .tree()
        .unwrap();
    let blob = store.repo.blob(b"after").unwrap();
    let after = replace_tree_entry(&store.repo, &before, &["a.txt"], blob).unwrap();
    let write = Operation::Write {
        path: "a.txt".into(),
    };
    assert!(write.affects("a.txt"));
    assert!(!write.affects("a.txt-other"));
    assert!(
        tree_facts::validate_operation_tree(
            &store.repo,
            before.id(),
            after,
            &write,
            &[],
            &mut 100_000
        )
        .is_ok()
    );
    assert!(
        tree_facts::validate_operation_tree(
            &store.repo,
            before.id(),
            before.id(),
            &write,
            &[],
            &mut 100_000
        )
        .is_err()
    );
    let unrelated = replace_tree_entry(
        &store.repo,
        &store.repo.find_tree(after).unwrap(),
        &["other.txt"],
        blob,
    )
    .unwrap();
    assert!(
        tree_facts::validate_operation_tree(
            &store.repo,
            before.id(),
            unrelated,
            &write,
            &[],
            &mut 100_000
        )
        .is_err()
    );
    let mut builder = store.repo.treebuilder(Some(&before)).unwrap();
    builder.insert("a.txt", before.id(), 0o040000).unwrap();
    assert!(
        tree_facts::validate_operation_tree(
            &store.repo,
            before.id(),
            builder.write().unwrap(),
            &write,
            &[],
            &mut 100_000
        )
        .is_err()
    );
    builder.insert("a.txt", blob, 0o100755).unwrap();
    assert!(
        tree_facts::validate_operation_tree(
            &store.repo,
            before.id(),
            builder.write().unwrap(),
            &write,
            &[],
            &mut 100_000
        )
        .is_err()
    );
}

#[test]
fn interrupted_save_create_and_restore_keep_drafts_and_uncertain_provenance_without_replay() {
    for action in [Action::Save, Action::Create, Action::Restore] {
        for phase in [1, 2, 3] {
            for restart in [false, true] {
                let (temp, mut store, base, path) = prepare(action);
                let before_tree = store
                    .repo
                    .head()
                    .unwrap()
                    .peel_to_commit()
                    .unwrap()
                    .tree_id();
                text_writes::INTERRUPT.set(phase);
                let outcome = perform(&mut store, action, &base);
                if phase == 1 {
                    assert!(outcome.is_err());
                } else {
                    assert!(matches!(
                        outcome.unwrap(),
                        SaveOutcome::SavedHistoryFailed { .. }
                    ));
                }
                assert!(matches!(
                    fact(&store),
                    Fact::Boundary {
                        operation: Operation::Write { .. },
                        ..
                    }
                ));
                let published = fs::read(temp.path().join(path)).ok();
                let expected = if phase == 1 {
                    if matches!(action, Action::Save) {
                        Some(b"before".to_vec())
                    } else {
                        None
                    }
                } else {
                    Some(b"after".to_vec())
                };
                assert_eq!(published, expected, "{action:?} phase={phase}");
                assert_eq!(store.drafts().unwrap()[0].text, "after");
                if restart {
                    drop(store);
                    store = ContentStore::open(temp.path()).unwrap();
                } else {
                    store.record_external_changes().unwrap();
                }
                assert!(matches!(fact(&store), Fact::Interrupted));
                assert_eq!(
                    store.history().unwrap()[0].message,
                    "native.history.interruptedChanges"
                );
                assert_eq!(fs::read(temp.path().join(path)).ok(), expected);
                assert_eq!(store.drafts().unwrap()[0].text, "after");
                if phase == 1 {
                    assert_eq!(
                        store
                            .repo
                            .head()
                            .unwrap()
                            .peel_to_commit()
                            .unwrap()
                            .tree_id(),
                        before_tree
                    );
                }
            }
        }
    }
}

#[test]
fn successful_write_pairs_preserve_anchored_paths_and_separate_external_edits() {
    let temp = workspace();
    fs::write(temp.path().join("unrelated.txt"), "original").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    let base = store.read_text("a.txt").unwrap();
    text_writes::UNRELATED_WRITE.set(Some(("unrelated.txt".into(), b"external".to_vec())));
    let SaveOutcome::Saved {
        history_revision, ..
    } = store.save("a.txt", &base, "after").unwrap()
    else {
        panic!()
    };
    assert!(matches!(
        Envelope::read(
            &store
                .repo
                .find_commit(Oid::from_str(&history_revision).unwrap())
                .unwrap()
        )
        .unwrap()
        .fact,
        Fact::Completed { .. }
    ));
    assert_eq!(
        store.resolve_reference_path(&reference).unwrap(),
        Some("a.txt".into())
    );
    assert_eq!(
        store.read_revision("a.txt", &history_revision).unwrap(),
        b"after"
    );
    assert_eq!(
        store
            .read_revision("unrelated.txt", &history_revision)
            .unwrap(),
        b"original"
    );
    assert_eq!(
        store.read_revision("unrelated.txt", &head(&store)).unwrap(),
        b"external"
    );
    assert_eq!(store.history().unwrap().len(), 3);
    assert_eq!(
        store.history().unwrap()[0].message,
        "native.history.externalChanges"
    );
    assert_eq!(
        store.history().unwrap()[1].message,
        "native.history.editFile"
    );
    assert!(store.drafts().unwrap().is_empty());
}

#[test]
fn completed_write_sync_failure_and_lost_acknowledgement_do_not_replay_or_add_a_gap() {
    for action in [Action::Save, Action::Create, Action::Restore] {
        for lost_ack in [false, true] {
            let (temp, mut store, base, path) = prepare(action);
            if lost_ack {
                text_writes::INTERRUPT.set(4);
            } else {
                git_storage::FAIL_REF_SYNC.set(Some(1));
            }
            assert!(matches!(
                perform(&mut store, action, &base).unwrap(),
                SaveOutcome::SavedHistoryFailed { .. }
            ));
            assert!(matches!(fact(&store), Fact::Completed { .. }));
            let completed = head(&store);
            let before_identity = read_file(
                &store.parent(path).unwrap().0,
                &store.parent(path).unwrap().1,
            )
            .unwrap()
            .1;
            drop(store);
            let mut store = ContentStore::open(temp.path()).unwrap();
            assert_eq!(head(&store), completed);
            assert_eq!(store.read_text(path).unwrap().text, "after");
            assert_eq!(store.drafts().unwrap()[0].text, "after");
            let reference = store.capture_reference("test", path, None).unwrap();
            assert_eq!(
                store.resolve_reference_path(&reference).unwrap(),
                Some(path.into())
            );
            let (dir, name) = store.parent(path).unwrap();
            assert_eq!(read_file(&dir, &name).unwrap().1, before_identity);
            assert_eq!(head(&store), completed);
        }
    }
}

#[test]
fn boundary_sync_failure_prevents_publication_for_every_text_write() {
    for action in [Action::Save, Action::Create, Action::Restore] {
        let (temp, mut store, base, path) = prepare(action);
        git_storage::FAIL_REF_SYNC.set(Some(0));
        assert!(perform(&mut store, action, &base).is_err());
        assert!(matches!(fact(&store), Fact::Boundary { .. }));
        assert_eq!(
            fs::read(temp.path().join(path)).ok(),
            if matches!(action, Action::Save) {
                Some(b"before".to_vec())
            } else {
                None
            }
        );
        assert_eq!(store.drafts().unwrap()[0].text, "after");
        drop(store);
        let store = ContentStore::open(temp.path()).unwrap();
        assert!(matches!(fact(&store), Fact::Interrupted));
    }
}

#[test]
fn equal_byte_replacement_before_or_after_publication_permanently_gates_old_references() {
    for after in [false, true] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        let base = store.read_text("a.txt").unwrap();
        if after {
            text_writes::AFTER_PUBLICATION.set(Some(b"after".to_vec()));
        } else {
            text_writes::BEFORE_PUBLICATION.set(Some(b"before".to_vec()));
        }
        let outcome = store.save("a.txt", &base, "after").unwrap();
        if after {
            assert!(matches!(outcome, SaveOutcome::SavedHistoryFailed { .. }));
        } else {
            assert_eq!(outcome, SaveOutcome::ChangedSinceReview);
        }
        assert!(matches!(fact(&store), Fact::Boundary { .. }));
        store.record_external_changes().unwrap();
        assert!(matches!(fact(&store), Fact::Interrupted));
        assert_eq!(
            store
                .resolve_reference_path(&reference)
                .unwrap_err()
                .to_string(),
            "native.content.reference.moveUncertain"
        );
        let fresh = store.capture_reference("test", "a.txt", None).unwrap();
        assert_eq!(
            store.resolve_reference_path(&fresh).unwrap(),
            Some("a.txt".into())
        );
        store.create_text("later.txt", "later").unwrap();
        drop(store);
        let copied = tempfile::tempdir().unwrap();
        copy_directory(temp.path(), copied.path());
        let store = ContentStore::open(copied.path()).unwrap();
        assert_eq!(
            store
                .resolve_reference_path(&reference)
                .unwrap_err()
                .to_string(),
            "native.content.reference.moveUncertain"
        );
        assert_eq!(
            store.resolve_reference_path(&fresh).unwrap(),
            Some("a.txt".into())
        );
        assert_eq!(store.drafts().unwrap()[0].text, "after");
    }
}

#[test]
fn replaced_ancestor_cannot_turn_an_unverified_write_into_reference_continuity() {
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/a.txt"), "before").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store
        .capture_reference("test", "folder/a.txt", None)
        .unwrap();
    let base = store.read_text("folder/a.txt").unwrap();
    text_writes::REPLACE_ANCESTOR.set(Some("folder".into()));
    assert!(matches!(
        store.save("folder/a.txt", &base, "after").unwrap(),
        SaveOutcome::SavedHistoryFailed { .. }
    ));
    drop(store);
    let mut store = ContentStore::open(temp.path()).unwrap();
    assert!(matches!(fact(&store), Fact::Interrupted));
    assert_eq!(
        store
            .resolve_reference_path(&reference)
            .unwrap_err()
            .to_string(),
        "native.content.reference.moveUncertain"
    );
    let fresh = store
        .capture_reference("test", "folder/a.txt", None)
        .unwrap();
    assert_eq!(
        store.resolve_reference_path(&fresh).unwrap(),
        Some("folder/a.txt".into())
    );
    assert_eq!(store.drafts().unwrap()[0].text, "after");
}

#[test]
fn late_occupants_are_not_clobbered_by_creation_or_restoration() {
    for action in [Action::Create, Action::Restore] {
        let (temp, mut store, base, path) = prepare(action);
        text_writes::BEFORE_PUBLICATION.set(Some(b"occupant".to_vec()));
        assert!(perform(&mut store, action, &base).is_err());
        assert_eq!(fs::read(temp.path().join(path)).unwrap(), b"occupant");
        assert_eq!(store.drafts().unwrap()[0].text, "after");
        store.record_external_changes().unwrap();
        assert!(matches!(fact(&store), Fact::Interrupted));
    }
}

#[test]
fn unchanged_save_settles_pending_evidence_without_replacing_file_or_creating_an_action() {
    for failure in [0, 5, 6, 7, 8] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let base = store.read_text("a.txt").unwrap();
        text_writes::INTERRUPT.set(1);
        assert!(store.create_text("pending.txt", "pending").is_err());
        let identity = read_file(&store.root, "a.txt").unwrap().1;
        text_writes::INTERRUPT.set(failure);
        let outcome = store.save("a.txt", &base, &base.text).unwrap();
        match failure {
            0 => assert!(matches!(outcome, SaveOutcome::Saved { .. })),
            5 => assert!(matches!(
                outcome,
                SaveOutcome::SavedDraftCleanupFailed { .. }
            )),
            _ => assert!(matches!(outcome, SaveOutcome::SavedHistoryFailed { .. })),
        }
        assert!(matches!(fact(&store), Fact::Interrupted));
        assert_eq!(store.history().unwrap().len(), 2);
        assert_eq!(
            store.history().unwrap()[0].message,
            "native.history.interruptedChanges"
        );
        assert_eq!(read_file(&store.root, "a.txt").unwrap().1, identity);
        assert_eq!(
            store
                .drafts()
                .unwrap()
                .iter()
                .any(|draft| draft.path == "a.txt"),
            failure != 0
        );
        assert!(
            store
                .drafts()
                .unwrap()
                .iter()
                .any(|draft| draft.path == "pending.txt")
        );
    }
}

#[test]
fn completed_write_cleanup_failure_retains_draft_without_losing_completion() {
    let (temp, mut store, base, _) = prepare(Action::Save);
    text_writes::INTERRUPT.set(5);
    assert!(matches!(
        perform(&mut store, Action::Save, &base).unwrap(),
        SaveOutcome::SavedDraftCleanupFailed { .. }
    ));
    assert!(matches!(fact(&store), Fact::Completed { .. }));
    let completed = head(&store);
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(head(&store), completed);
    assert_eq!(store.drafts().unwrap()[0].text, "after");
}

#[test]
fn recreation_and_restoration_after_deletion_never_revive_an_old_anchor() {
    for restore in [false, true] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        let base = store.read_text("a.txt").unwrap();
        store.delete_entry("a.txt").unwrap();
        let outcome = if restore {
            store.restore_draft("a.txt", &base, "before")
        } else {
            store.create_text("a.txt", "before")
        };
        assert!(matches!(outcome.unwrap(), SaveOutcome::Saved { .. }));
        assert!(store.resolve_reference_path(&reference).unwrap().is_none());
    }
}

#[test]
fn unchanged_explicit_retry_does_not_erase_a_same_path_interruption_gap() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    let base = store.read_text("a.txt").unwrap();
    text_writes::INTERRUPT.set(1);
    assert!(store.save("a.txt", &base, "pending").is_err());
    assert!(matches!(
        store.save("a.txt", &base, "before").unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert!(matches!(fact(&store), Fact::Interrupted));
    assert_eq!(store.history().unwrap().len(), 2);
    assert_eq!(store.read_text("a.txt").unwrap().text, "before");
    assert!(store.drafts().unwrap().is_empty());
    assert_eq!(
        store
            .resolve_reference_path(&reference)
            .unwrap_err()
            .to_string(),
        "native.content.reference.moveUncertain"
    );
}

#[test]
fn failed_conflict_resolution_keeps_the_draft_and_cannot_replay_a_stale_choice() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("a.txt").unwrap();
    fs::write(temp.path().join("a.txt"), "external").unwrap();
    let SaveOutcome::Conflict { review_token, .. } = store.save("a.txt", &base, "editor").unwrap()
    else {
        panic!()
    };
    text_writes::INTERRUPT.set(3);
    assert!(matches!(
        store.resolve(&review_token, VersionChoice::Editor).unwrap(),
        SaveOutcome::SavedHistoryFailed { .. }
    ));
    store.record_external_changes().unwrap();
    assert!(matches!(fact(&store), Fact::Interrupted));
    assert_eq!(
        store.resolve(&review_token, VersionChoice::Editor).unwrap(),
        SaveOutcome::ChangedSinceReview
    );
    assert_eq!(store.read_text("a.txt").unwrap().text, "editor");
    assert_eq!(store.drafts().unwrap()[0].text, "editor");
}

#[test]
fn reversing_write_creation_requires_the_current_occupants_continuity() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let SaveOutcome::Saved {
        history_revision, ..
    } = store.create_text("created.txt", "same").unwrap()
    else {
        panic!()
    };
    store.delete_entry("created.txt").unwrap();
    store.create_text("created.txt", "same").unwrap();
    let before = head(&store);
    assert!(
        store
            .reverse_entry_change("created.txt", &history_revision)
            .is_err()
    );
    assert_eq!(head(&store), before);
    assert_eq!(store.read_text("created.txt").unwrap().text, "same");
}
