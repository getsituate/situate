use super::*;
use crate::content::{
    history_records::{Envelope, Fact},
    operations,
};
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::write(temp.path().join("a.txt"), "original").unwrap();
    temp
}
fn head(store: &ContentStore) -> String {
    store.repo.head().unwrap().target().unwrap().to_string()
}
fn fact(store: &ContentStore) -> Fact {
    Envelope::read(&store.repo.head().unwrap().peel_to_commit().unwrap())
        .unwrap()
        .fact
}
fn anchored(path: &str, revision: &str) -> ContentReference {
    ContentReference::Live {
        workspace_id: "test".into(),
        path: path.into(),
        anchor_revision: revision.into(),
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
fn interrupted_moves_preserve_effects_without_replay_and_gaps_survive_copy() {
    for phase in [1, 2, 3] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        let before = head(&store);
        INTERRUPT.set(phase);
        let outcome = store.move_entry("a.txt", "b.txt");
        if phase == 1 {
            assert!(outcome.is_err());
        } else {
            assert!(matches!(
                outcome.unwrap(),
                OperationOutcome::PartialFailure { .. }
            ));
        }
        let boundary = head(&store);
        assert!(matches!(fact(&store), Fact::Boundary { .. }));
        assert_eq!(store.read_revision("a.txt", &before).unwrap(), b"original");
        assert_eq!(
            store.resolve_reference(&reference).unwrap_err().to_string(),
            "native.content.reference.moveUncertain"
        );
        assert!(
            store
                .resolve_reference_path(&anchored("a.txt", &boundary))
                .is_err()
        );
        drop(store);
        let mut store = ContentStore::open(temp.path()).unwrap();
        assert!(matches!(fact(&store), Fact::Interrupted));
        assert_eq!(temp.path().join("a.txt").exists(), phase == 1);
        assert_eq!(temp.path().join("b.txt").exists(), phase != 1);
        if phase != 1 {
            fs::write(temp.path().join("a.txt"), "original").unwrap();
        }
        let fresh = store.capture_reference("test", "a.txt", None).unwrap();
        assert_eq!(
            store.resolve_reference_path(&fresh).unwrap(),
            Some("a.txt".into())
        );
        assert_eq!(
            store.resolve_reference(&reference).unwrap_err().to_string(),
            "native.content.reference.moveUncertain"
        );
        store.create_text("later.txt", "later").unwrap();
        drop(store);
        let copied = tempfile::tempdir().unwrap();
        copy_directory(temp.path(), copied.path());
        let store = ContentStore::open(copied.path()).unwrap();
        assert_eq!(
            store.resolve_reference(&reference).unwrap_err().to_string(),
            "native.content.reference.moveUncertain"
        );
        assert_eq!(
            store.resolve_reference_path(&fresh).unwrap(),
            Some("a.txt".into())
        );
        assert!(
            !fs::read_dir(copied.path().join(".situate"))
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("reference-"))
        );
    }
}

#[test]
fn stored_uncertain_references_remain_uncertain_after_copy_and_scope_binding() {
    use crate::{ai_storage::Storage, layout_storage::LayoutStorage};
    use serde_json::{Value, json};

    let source = workspace();
    let root = source.path().canonicalize().unwrap();
    let source_scope = revision_for_text(root.to_str().unwrap()).unwrap();
    let mut content = ContentStore::open(&root).unwrap();
    let reference = content
        .capture_reference(&source_scope, "a.txt", None)
        .unwrap();
    let storage = Storage::open(&root, &source_scope).unwrap();
    let mut record = storage.create_conversation("uncertain", "").unwrap();
    record.runtime = Some(serde_json::from_value(json!({"draftReferences":[reference]})).unwrap());
    let saved = storage.persist_runtime_fixture(&record, 0).unwrap();
    let layout = LayoutStorage::open(&root, &source_scope).unwrap();
    let snapshot = layout.save(None, json!({"version":1,"pinnedViews":[],"layout":{"tabs":[{"panes":[{"navigation":{"entries":[{"target":{"kind":"view","viewId":"files"},"presentation":{"reference":reference}}]}}]}]}})).unwrap();
    INTERRUPT.set(2);
    assert!(matches!(
        content.move_entry("a.txt", "b.txt").unwrap(),
        OperationOutcome::PartialFailure { .. }
    ));
    assert!(matches!(fact(&content), Fact::Boundary { .. }));
    assert_eq!(
        content
            .resolve_reference(&reference)
            .unwrap_err()
            .to_string(),
        "native.content.reference.moveUncertain"
    );
    drop((content, storage, layout));
    let content = ContentStore::open(&root).unwrap();
    assert!(matches!(fact(&content), Fact::Interrupted));
    let history_head = head(&content);
    drop(content);
    let chat_bytes = fs::read(root.join(".situate/conversations/uncertain/metadata.json")).unwrap();
    let layout_bytes = fs::read(root.join(".situate/layout.json")).unwrap();
    let copy = tempfile::tempdir().unwrap();
    copy_directory(&root, copy.path());
    let root = copy.path().canonicalize().unwrap();
    let scope = revision_for_text(root.to_str().unwrap()).unwrap();
    assert_ne!(scope, source_scope);
    let storage = Storage::open(&root, &scope).unwrap();
    let layout = LayoutStorage::open(&root, &scope).unwrap();
    let loaded = storage.read_conversation("uncertain").unwrap().unwrap();
    let loaded_layout = layout.load().unwrap();
    assert_eq!(loaded.revision, saved.revision);
    assert_eq!(loaded_layout.revision, snapshot.revision);
    let mut content = ContentStore::open(&root).unwrap();
    assert_eq!(head(&content), history_head);
    let from_layout: ContentReference = serde_json::from_value(loaded_layout.data.as_ref().unwrap()["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"]["reference"].clone()).unwrap();
    for rebound in [
        &loaded.runtime.as_ref().unwrap().draft_references[0],
        &from_layout,
    ] {
        assert_eq!(rebound.workspace_id(), scope);
        let mut expected = serde_json::to_value(&reference).unwrap();
        expected["workspaceId"] = Value::String(scope.clone());
        assert_eq!(serde_json::to_value(rebound).unwrap(), expected);
        assert_eq!(
            content.resolve_reference(rebound).unwrap_err().to_string(),
            "native.content.reference.moveUncertain"
        );
    }
    assert_eq!(
        fs::read(root.join(".situate/conversations/uncertain/metadata.json")).unwrap(),
        chat_bytes
    );
    assert_eq!(
        fs::read(root.join(".situate/layout.json")).unwrap(),
        layout_bytes
    );
    assert_eq!(
        storage
            .persist_runtime_fixture(&loaded, loaded.revision)
            .unwrap()
            .revision,
        loaded.revision + 2
    );
    assert!(
        layout
            .save(
                loaded_layout.revision.as_deref(),
                loaded_layout.data.unwrap()
            )
            .is_ok()
    );
    assert_eq!(
        content
            .resolve_reference(&from_layout)
            .unwrap_err()
            .to_string(),
        "native.content.reference.moveUncertain"
    );
    assert_eq!(head(&content), history_head);
    let saved_bytes =
        fs::read(root.join(".situate/conversations/uncertain/metadata.json")).unwrap();
    let fresh = content.capture_reference(&scope, "b.txt", None).unwrap();
    assert_eq!(
        content.resolve_reference_path(&fresh).unwrap(),
        Some("b.txt".into())
    );
    content.create_text("later.txt", "Later snapshot").unwrap();
    drop(content);
    let content = ContentStore::open(&root).unwrap();
    let reread = storage.read_conversation("uncertain").unwrap().unwrap();
    let old = &reread.runtime.as_ref().unwrap().draft_references[0];
    assert_eq!(old, &from_layout);
    assert_eq!(
        content.resolve_reference(old).unwrap_err().to_string(),
        "native.content.reference.moveUncertain"
    );
    assert_eq!(
        content.resolve_reference_path(&fresh).unwrap(),
        Some("b.txt".into())
    );
    assert_eq!(
        fs::read(root.join(".situate/conversations/uncertain/metadata.json")).unwrap(),
        saved_bytes
    );
}

#[test]
fn same_tree_boundary_is_sealed_even_when_sealing_acknowledgement_fails() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let old = store.capture_reference("test", "a.txt", None).unwrap();
    INTERRUPT.set(1);
    assert!(store.move_entry("a.txt", "b.txt").is_err());
    let boundary = store
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .tree_id();
    git_storage::FAIL_REF_SYNC.set(Some(0));
    assert!(store.capture_reference("test", "a.txt", None).is_err());
    assert!(matches!(fact(&store), Fact::Interrupted));
    assert_eq!(
        store
            .repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .tree_id(),
        boundary
    );
    let sealed = head(&store);
    let fresh = store.capture_reference("test", "a.txt", None).unwrap();
    assert_eq!(head(&store), sealed);
    assert_eq!(
        store.resolve_reference(&old).unwrap_err().to_string(),
        "native.content.reference.moveUncertain"
    );
    assert_eq!(
        store.resolve_reference_path(&fresh).unwrap(),
        Some("a.txt".into())
    );
}

#[test]
fn boundary_and_completed_ref_sync_failures_have_distinct_nonreplaying_outcomes() {
    for fail_after in [0, 1] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        git_storage::FAIL_REF_SYNC.set(Some(fail_after));
        let outcome = store.move_entry("a.txt", "b.txt");
        if fail_after == 0 {
            assert!(outcome.is_err());
            assert!(temp.path().join("a.txt").exists());
            assert!(!temp.path().join("b.txt").exists());
            assert!(matches!(fact(&store), Fact::Boundary { .. }));
        } else {
            assert!(matches!(
                outcome.unwrap(),
                OperationOutcome::PartialFailure { .. }
            ));
            assert!(matches!(fact(&store), Fact::Completed { .. }));
        }
        let published = head(&store);
        drop(store);
        let mut store = ContentStore::open(temp.path()).unwrap();
        if fail_after == 0 {
            assert_eq!(
                store.resolve_reference(&reference).unwrap_err().to_string(),
                "native.content.reference.moveUncertain"
            );
            assert!(matches!(fact(&store), Fact::Interrupted));
        } else {
            assert_eq!(head(&store), published);
            assert_eq!(
                store.resolve_reference_path(&reference).unwrap(),
                Some("b.txt".into())
            );
            assert!(store.move_entry("a.txt", "b.txt").is_err());
            assert_eq!(head(&store), published);
        }
    }
}

#[test]
fn durable_completion_and_lost_acknowledgement_do_not_add_a_gap_or_repeat_mutation() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    assert!(matches!(
        store.move_entry("a.txt", "b.txt").unwrap(),
        OperationOutcome::Complete { .. }
    ));
    let published = head(&store);
    let boundary = store
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .parent_id(0)
        .unwrap()
        .to_string();
    assert!(
        store
            .resolve_reference_path(&anchored("a.txt", &boundary))
            .is_err()
    );
    assert_eq!(
        store
            .history()
            .unwrap()
            .iter()
            .filter(|entry| entry.message == "native.history.moveContent")
            .count(),
        1
    );
    assert!(
        !store
            .history()
            .unwrap()
            .iter()
            .any(|entry| entry.revision == boundary)
    );
    drop(store);
    let mut store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(head(&store), published);
    assert_eq!(
        store.resolve_reference_path(&reference).unwrap(),
        Some("b.txt".into())
    );
    assert!(store.move_entry("a.txt", "b.txt").is_err());
    assert_eq!(head(&store), published);
}

#[test]
fn binary_copies_deletions_and_restorations_do_not_transfer_old_lineage() {
    let temp = workspace();
    fs::write(temp.path().join("a.pdf"), [0, 255, 1]).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.pdf", None).unwrap();
    let original = head(&store);
    store.copy_entry("a.pdf", "copy.pdf").unwrap();
    assert_eq!(
        store.resolve_reference_path(&reference).unwrap(),
        Some("a.pdf".into())
    );
    store.move_entry("a.pdf", "moved.pdf").unwrap();
    assert_eq!(
        store.resolve_reference_path(&reference).unwrap(),
        Some("moved.pdf".into())
    );
    assert!(store.resolve_reference(&reference).is_err());
    store.delete_entry("moved.pdf").unwrap();
    store.restore_deleted("a.pdf", &original, "a.pdf").unwrap();
    assert!(store.resolve_reference_path(&reference).unwrap().is_none());
    assert_eq!(fs::read(temp.path().join("a.pdf")).unwrap(), [0, 255, 1]);
}

#[test]
fn external_deletion_observation_is_terminal_and_copy_similarity_is_not_a_move() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    fs::rename(temp.path().join("a.txt"), temp.path().join("other.txt")).unwrap();
    store.record_external_changes().unwrap();
    fs::write(temp.path().join("a.txt"), "original").unwrap();
    store.record_external_changes().unwrap();
    assert!(store.resolve_reference_path(&reference).unwrap().is_none());
}

#[test]
fn capture_rejects_blob_races_equal_byte_replacement_and_replaced_ancestor() {
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/a.txt"), "original").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    assert!(
        store
            .capture_reference("test", "a.txt", Some(&"a".repeat(40)))
            .is_err()
    );
    CAPTURE_REPLACE.set(Some(b"original".to_vec()));
    assert!(store.capture_reference("test", "a.txt", None).is_err());
    CAPTURE_REPLACE.set(Some(b"changed".to_vec()));
    assert!(store.capture_reference("test", "a.txt", None).is_err());
    CAPTURE_ANCESTOR.set(Some("folder".into()));
    assert!(
        store
            .capture_reference("test", "folder/a.txt", None)
            .is_err()
    );
    fs::write(temp.path().join("new.txt"), "new").unwrap();
    let reference = store
        .capture_reference("test", "new.txt", Some(&revision_for_text("new").unwrap()))
        .unwrap();
    let ContentReference::Live {
        anchor_revision: anchor,
        ..
    } = reference
    else {
        panic!()
    };
    assert_ne!(anchor, revision_for_text("new").unwrap());
    assert_eq!(store.read_revision("new.txt", &anchor).unwrap(), b"new");
}

#[test]
fn separable_external_changes_are_not_attributed_to_the_completed_move() {
    let temp = workspace();
    fs::write(temp.path().join("unrelated.txt"), "before").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    operations::COMPLETE_EDIT.set(Some(("unrelated.txt".into(), b"external".to_vec(), false)));
    let OperationOutcome::Complete { history_revision } =
        store.move_entry("a.txt", "b.txt").unwrap()
    else {
        panic!()
    };
    assert_eq!(
        store
            .read_revision("unrelated.txt", &history_revision)
            .unwrap(),
        b"before"
    );
    assert_eq!(
        store.history().unwrap()[0].message,
        "native.history.externalChanges"
    );
    assert_eq!(
        store.read_revision("unrelated.txt", &head(&store)).unwrap(),
        b"external"
    );
}

#[test]
fn overlapping_edits_or_equal_byte_replacement_cannot_publish_completion() {
    for (bytes, replace) in [(b"changed".to_vec(), false), (b"original".to_vec(), true)] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        operations::COMPLETE_EDIT.set(Some(("b.txt".into(), bytes.clone(), replace)));
        assert!(matches!(
            store.move_entry("a.txt", "b.txt").unwrap(),
            OperationOutcome::PartialFailure { .. }
        ));
        assert!(matches!(fact(&store), Fact::Boundary { .. }));
        drop(store);
        let store = ContentStore::open(temp.path()).unwrap();
        assert!(matches!(fact(&store), Fact::Interrupted));
        assert_eq!(
            store.resolve_reference(&reference).unwrap_err().to_string(),
            "native.content.reference.moveUncertain"
        );
        assert_eq!(fs::read(temp.path().join("b.txt")).unwrap(), bytes);
    }
}

#[test]
fn partial_reference_patches_remain_partial_after_restart() {
    let temp = workspace();
    fs::write(
        temp.path().join("one.md"),
        format!("{}[a](a.txt)", crate::metadata::new_document()),
    )
    .unwrap();
    fs::write(
        temp.path().join("two.md"),
        format!("{}[a](a.txt)", crate::metadata::new_document()),
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    INTERRUPT.set(4);
    assert!(matches!(
        store.move_entry("a.txt", "b.txt").unwrap(),
        OperationOutcome::PartialFailure { .. }
    ));
    let before = [
        fs::read(temp.path().join("one.md")).unwrap(),
        fs::read(temp.path().join("two.md")).unwrap(),
    ];
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(
        before,
        [
            fs::read(temp.path().join("one.md")).unwrap(),
            fs::read(temp.path().join("two.md")).unwrap()
        ]
    );
    assert_eq!(
        store.resolve_reference(&reference).unwrap_err().to_string(),
        "native.content.reference.moveUncertain"
    );
    assert_eq!(
        store.history().unwrap()[0].message,
        "native.history.interruptedChanges"
    );
}

#[test]
fn shallow_replacement_and_graft_history_are_rejected_even_at_head_anchor() {
    for kind in ["shallow", "replacement", "graft"] {
        let temp = workspace();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        let id = store.repo.head().unwrap().target().unwrap();
        match kind {
            "shallow" => fs::write(
                temp.path().join(".situate/history.git/shallow"),
                format!("{id}\n"),
            )
            .unwrap(),
            "graft" => {
                fs::create_dir_all(temp.path().join(".situate/history.git/info")).unwrap();
                fs::write(
                    temp.path().join(".situate/history.git/info/grafts"),
                    format!("{id}\n"),
                )
                .unwrap();
            }
            _ => {
                store
                    .repo
                    .reference(&format!("refs/replace/{id}"), id, true, "replacement")
                    .unwrap();
            }
        }
        assert!(store.resolve_reference_path(&reference).is_err(), "{kind}");
        assert!(
            store.capture_reference("test", "a.txt", None).is_err(),
            "{kind}"
        );
        assert!(store.move_entry("a.txt", "b.txt").is_err(), "{kind}");
        assert!(temp.path().join("a.txt").exists());
    }
}
