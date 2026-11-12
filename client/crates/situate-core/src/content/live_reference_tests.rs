use super::*;
use crate::ai_storage::Storage;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    temp
}
fn markdown(body: &str) -> String {
    format!("{}{}", crate::metadata::new_document(), body)
}
fn resolved(store: &ContentStore, reference: &ContentReference) -> (String, String) {
    let (_, path, version) = store.resolve_reference(reference).unwrap().unwrap();
    (path, version.text)
}

#[test]
fn persisted_draft_and_pending_follow_moves_after_reopen_without_changing_conversation_cas() {
    for path in ["original.md", "original.txt"] {
        let temp = workspace();
        let root = temp.path().canonicalize().unwrap();
        let original = if is_markdown(path) {
            markdown("Original source")
        } else {
            "Original source".into()
        };
        fs::write(root.join(path), &original).unwrap();
        let mut store = ContentStore::open(&root).unwrap();
        let reference = store
            .capture_reference("test", path, Some(&revision_for_text(&original).unwrap()))
            .unwrap();
        let storage = Storage::open(&root, "test").unwrap();
        let mut record = storage.create_conversation("draft", "").unwrap();
        record.runtime = Some(serde_json::from_value(serde_json::json!({
            "draftReferences":[reference],
            "pending":[{"id":"pending", "kind":"followUp", "state":"pending", "text":"Question", "attachments":[], "references":[reference], "timestamp":1}]
        })).unwrap());
        let saved = storage.persist_runtime_fixture(&record, 0).unwrap();
        drop((store, storage));

        let mut store = ContentStore::open(&root).unwrap();
        let destination = if is_markdown(path) {
            "moved.md"
        } else {
            "moved.txt"
        };
        assert!(matches!(
            store.move_entry(path, destination).unwrap(),
            OperationOutcome::Complete { .. }
        ));
        fs::write(
            root.join(path),
            if is_markdown(path) {
                markdown("Replacement")
            } else {
                "Replacement".into()
            },
        )
        .unwrap();
        drop(store);
        let store = ContentStore::open(&root).unwrap();
        let storage = Storage::open(&root, "test").unwrap();
        let mut loaded = storage.read_conversation("draft").unwrap().unwrap();
        assert_eq!(loaded, saved);
        let runtime = loaded.runtime.as_ref().unwrap();
        for reference in [
            &runtime.draft_references[0],
            &runtime.pending[0].references[0],
        ] {
            assert_eq!(
                resolved(&store, reference),
                (destination.into(), original.clone())
            );
        }
        loaded.draft = "A later draft".into();
        let mut metadata = storage
            .read_conversation_metadata("draft")
            .unwrap()
            .unwrap();
        metadata.legacy_draft.as_mut().unwrap()["text"] = serde_json::json!(loaded.draft);
        assert_eq!(
            storage
                .update_conversation_metadata(&metadata, loaded.revision)
                .unwrap()
                .revision,
            loaded.revision + 1
        );
    }
}

#[test]
fn markdown_capture_needs_no_frontmatter_and_metadata_never_selects_another_file() {
    let temp = workspace();
    let original = "---\nsituate-id: duplicate user value\n---\nOriginal";
    fs::write(temp.path().join("a.md"), original).unwrap();
    fs::write(temp.path().join("b.md"), original).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store
        .capture_reference("test", "a.md", Some(&revision_for_text(original).unwrap()))
        .unwrap();
    assert_eq!(
        resolved(&store, &reference),
        ("a.md".into(), original.into())
    );
    store.move_entry("a.md", "moved.md").unwrap();
    assert_eq!(resolved(&store, &reference).0, "moved.md");
    fs::write(temp.path().join("moved.md"), "# Without frontmatter").unwrap();
    assert_eq!(resolved(&store, &reference).1, "# Without frontmatter");
    assert!(
        store
            .capture_reference(
                "test",
                "moved.md",
                Some(&revision_for_text(original).unwrap())
            )
            .is_err()
    );
    let capture = store
        .capture_reference(
            "test",
            "moved.md",
            Some(&revision_for_text("# Without frontmatter").unwrap()),
        )
        .unwrap();
    let ContentReference::Live {
        anchor_revision, ..
    } = capture
    else {
        panic!()
    };
    assert_eq!(
        store.read_revision("moved.md", &anchor_revision).unwrap(),
        b"# Without frontmatter"
    );
    assert!(serde_json::from_value::<ContentReference>(serde_json::json!({"kind":"live","workspaceId":"test","path":"a.md","fileId":"11111111-1111-4111-8111-111111111111"})).is_err());
    assert!(
        serde_json::from_value::<ContentReference>(
            serde_json::json!({"kind":"live","workspaceId":"test","path":"a.md"})
        )
        .is_err()
    );
}

#[test]
fn markdown_copy_delete_reuse_and_restore_do_not_revive_old_live_reference() {
    let temp = workspace();
    fs::write(temp.path().join("a.md"), "Identical bytes").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.md", None).unwrap();
    let revision = store.record_external_changes().unwrap();
    store.copy_entry("a.md", "copy.md").unwrap();
    assert_eq!(resolved(&store, &reference).0, "a.md");
    store.delete_entry("a.md").unwrap();
    store.restore_deleted("a.md", &revision, "a.md").unwrap();
    assert!(store.resolve_reference(&reference).unwrap().is_none());
    let fresh = store.capture_reference("test", "a.md", None).unwrap();
    assert_eq!(resolved(&store, &fresh).1, "Identical bytes");
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    assert!(store.resolve_reference(&reference).unwrap().is_none());
    assert_eq!(resolved(&store, &fresh).0, "a.md");
}

#[test]
fn folder_moves_follow_only_after_the_captured_commit_and_preserve_anchor() {
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/a.txt"), "First").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let first = store
        .capture_reference("test", "folder/a.txt", None)
        .unwrap();
    store.move_entry("folder", "renamed").unwrap();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/a.txt"), "Second").unwrap();
    let second = store
        .capture_reference("test", "folder/a.txt", None)
        .unwrap();
    store.move_entry("renamed", "again").unwrap();
    assert_eq!(
        resolved(&store, &first),
        ("again/a.txt".into(), "First".into())
    );
    assert_eq!(
        resolved(&store, &second),
        ("folder/a.txt".into(), "Second".into())
    );
    assert_eq!(store.resolve_reference(&first).unwrap().unwrap().0, first);
}

#[test]
fn historical_reference_uses_exact_revision_and_path_despite_live_identity_move() {
    let temp = workspace();
    let original = markdown("Historical source");
    fs::write(temp.path().join("a.md"), &original).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let revision = store.record_external_changes().unwrap();
    let reference = ContentReference::Historical {
        workspace_id: "test".into(),
        path: "a.md".into(),
        revision: revision.clone(),
    };
    store.move_entry("a.md", "b.md").unwrap();
    fs::write(temp.path().join("a.md"), markdown("Replacement")).unwrap();
    fs::write(temp.path().join("b.md"), "Modified original").unwrap();
    assert_eq!(resolved(&store, &reference), ("a.md".into(), original));
    assert_eq!(
        store.resolve_reference(&reference).unwrap().unwrap().0,
        reference
    );
    assert_eq!(
        store
            .resolve_reference(&reference)
            .unwrap()
            .unwrap()
            .2
            .revision,
        revision
    );
}

#[test]
fn managed_deletion_stays_unresolved_when_a_path_is_reused() {
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/a.txt"), "Original").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store
        .capture_reference("test", "folder/a.txt", None)
        .unwrap();
    store.delete_entry("folder").unwrap();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/a.txt"), "Replacement").unwrap();
    drop(store);
    let mut store = ContentStore::open(temp.path()).unwrap();
    assert!(store.resolve_reference(&reference).unwrap().is_none());
    let replacement = store
        .capture_reference("test", "folder/a.txt", None)
        .unwrap();
    assert_eq!(resolved(&store, &replacement).1, "Replacement");
}

#[test]
fn reference_capture_and_text_resolution_have_separate_byte_limits() {
    let temp = workspace();
    fs::write(temp.path().join("a.txt"), "Small").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    fs::write(
        temp.path().join("a.txt"),
        vec![b'x'; MAX_REFERENCE_BYTES as usize + 1],
    )
    .unwrap();
    assert!(store.resolve_reference(&reference).is_err());
    let larger = store.capture_reference("test", "a.txt", None).unwrap();
    assert!(store.resolve_reference(&larger).is_err());
    fs::OpenOptions::new()
        .write(true)
        .open(temp.path().join("a.txt"))
        .unwrap()
        .set_len(operations::MAX_OPERATION_BYTES + 1)
        .unwrap();
    assert!(store.capture_reference("test", "a.txt", None).is_err());
}

#[cfg(unix)]
#[test]
fn held_root_remains_authoritative_after_ambient_path_replacement() {
    let temp = workspace();
    let root = temp.path().join("root");
    fs::create_dir_all(root.join(".situate")).unwrap();
    fs::write(root.join("a.txt"), "Original").unwrap();
    let mut store = ContentStore::open(&root).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    fs::rename(&root, temp.path().join("relocated")).unwrap();
    fs::create_dir_all(root.join(".situate")).unwrap();
    fs::write(root.join("a.txt"), "Replacement").unwrap();
    assert_eq!(store.read_text("a.txt").unwrap().text, "Original");
    assert!(store.resolve_reference(&reference).is_err());
    assert!(store.move_entry("a.txt", "b.txt").is_err());
    assert_eq!(
        fs::read_to_string(root.join("a.txt")).unwrap(),
        "Replacement"
    );
}
