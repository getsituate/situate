use super::*;
use std::fs;

#[test]
fn recorded_tree_changes_report_add_modify_delete_without_rename_inference() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    for (path, bytes) in [
        ("modified.txt", "old"),
        ("deleted.txt", "deleted"),
        ("old-name.txt", "moved"),
        ("stable.txt", "unchanged"),
    ] {
        fs::write(root.path().join(path), bytes).unwrap();
    }
    fs::write(root.path().join("large.bin"), vec![0; 8 * 1024 * 1024]).unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let before = store.record_external_changes().unwrap();
    fs::write(root.path().join("modified.txt"), "new").unwrap();
    fs::remove_file(root.path().join("deleted.txt")).unwrap();
    fs::rename(
        root.path().join("old-name.txt"),
        root.path().join("new-name.txt"),
    )
    .unwrap();
    fs::write(root.path().join("added.txt"), "added").unwrap();
    let after = store.record_external_changes().unwrap();
    fs::write(root.path().join("modified.txt"), "not recorded").unwrap();
    let changes = store.changes_between_revisions(&before, &after).unwrap();
    assert_eq!(
        serde_json::to_value(changes).unwrap(),
        serde_json::json!([
            {"path":"added.txt","status":"A"},
            {"path":"deleted.txt","status":"D"},
            {"path":"modified.txt","status":"M"},
            {"path":"new-name.txt","status":"A"},
            {"path":"old-name.txt","status":"D"}
        ])
    );
    assert!(
        store
            .changes_between_revisions(&after, &after)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        store.repo.head().unwrap().target().unwrap().to_string(),
        after
    );
    assert!(store.changes_between_revisions("HEAD", &after).is_err());
    assert!(
        store
            .changes_between_revisions(&before.to_ascii_uppercase(), &after)
            .is_err()
    );
}

#[test]
fn previously_recorded_artifacts_remain_readable_without_reporting_a_content_deletion() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    fs::write(root.path().join(".DS_Store"), "retained metadata").unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let before = {
        let parent = store.repo.head().unwrap().peel_to_commit().unwrap();
        let blob = store.repo.blob(b"retained metadata").unwrap();
        let mut tree = store
            .repo
            .treebuilder(Some(&parent.tree().unwrap()))
            .unwrap();
        tree.insert(".DS_Store", blob, 0o100644).unwrap();
        let tree = store.repo.find_tree(tree.write().unwrap()).unwrap();
        git_storage::commit(
            &store.repo,
            &store.history_dir,
            &tree,
            &[&parent],
            "native.history.externalChanges",
        )
        .unwrap()
        .to_string()
    };
    let after = store.record_external_changes().unwrap();
    assert_ne!(before, after);
    assert_eq!(store.record_external_changes().unwrap(), after);
    assert!(
        store
            .changes_between_revisions(&before, &after)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        store.read_revision(".DS_Store", &before).unwrap(),
        b"retained metadata"
    );
    assert!(store.read_revision(".DS_Store", &after).is_err());
    assert_eq!(
        fs::read(root.path().join(".DS_Store")).unwrap(),
        b"retained metadata"
    );
}

#[test]
fn internal_metadata_is_not_exposed_as_user_file_changes() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    let store = ContentStore::open(root.path()).unwrap();
    let parent = store.repo.head().unwrap().peel_to_commit().unwrap();
    let blob = store.repo.blob(b"internal metadata").unwrap();
    let mut internal = store.repo.treebuilder(None).unwrap();
    internal.insert("lineage", blob, 0o100644).unwrap();
    let internal = internal.write().unwrap();
    let mut tree = store
        .repo
        .treebuilder(Some(&parent.tree().unwrap()))
        .unwrap();
    tree.insert(".situate", internal, 0o040000).unwrap();
    tree.insert(".situate-write-stage", blob, 0o100644).unwrap();
    tree.insert(".DS_Store", blob, 0o100644).unwrap();
    tree.insert(".AppleDouble", internal, 0o040000).unwrap();
    tree.insert("visible.txt", blob, 0o100644).unwrap();
    let tree = store.repo.find_tree(tree.write().unwrap()).unwrap();
    let message = history_records::Envelope {
        version: 1,
        parent_tree: Some(parent.tree_id().to_string()),
        result_tree: tree.id().to_string(),
        fact: history_records::Fact::Observation,
    }
    .message("native.history.externalChanges")
    .unwrap();
    let author = Signature::now("Test", "test@example.invalid").unwrap();
    let after = store
        .repo
        .commit(None, &author, &author, &message, &tree, &[&parent])
        .unwrap();
    assert_eq!(
        store
            .changes_between_revisions(&parent.id().to_string(), &after.to_string())
            .unwrap(),
        vec![RevisionChange {
            path: "visible.txt".into(),
            status: RevisionChangeStatus::Added,
        }]
    );
}
