use super::history_records::{Envelope, Fact, Operation};
use super::*;
use std::fs;

fn append(store: &ContentStore, tree: Oid, fact: Fact) -> Oid {
    let parent = store.repo.head().unwrap().peel_to_commit().unwrap();
    let record = Envelope {
        version: 1,
        parent_tree: Some(parent.tree_id().to_string()),
        result_tree: tree.to_string(),
        fact,
    };
    let author = Signature::now("Test", "test@example.invalid").unwrap();
    store
        .repo
        .commit(
            Some("HEAD"),
            &author,
            &author,
            &record.message("native.history.externalChanges").unwrap(),
            &store.repo.find_tree(tree).unwrap(),
            &[&parent],
        )
        .unwrap()
}

#[test]
fn cumulative_reconstruction_limits_do_not_cap_workspace_write_or_open_lifetime() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::write(temp.path().join("a.txt"), "original").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let blob = store.repo.blob(b"original").unwrap();
    let mut builder = store.repo.treebuilder(None).unwrap();
    builder.insert("a.txt", blob, 0o100644).unwrap();
    for index in 0..9_999 {
        builder
            .insert(format!("file{index}.txt"), blob, 0o100644)
            .unwrap();
    }
    let mut tree = builder.write().unwrap();
    drop(builder);
    append(&store, tree, Fact::Observation);
    for index in 0..6 {
        let (source, destination) = if index % 2 == 0 {
            ("a.txt", "b.txt")
        } else {
            ("b.txt", "a.txt")
        };
        let mut builder = store
            .repo
            .treebuilder(Some(&store.repo.find_tree(tree).unwrap()))
            .unwrap();
        builder.remove(source).unwrap();
        builder.insert(destination, blob, 0o100644).unwrap();
        let result = builder.write().unwrap();
        let boundary = append(
            &store,
            tree,
            Fact::Boundary {
                operation: Operation::Move {
                    source: source.into(),
                    destination: destination.into(),
                },
                expected_tree: result.to_string(),
                patches: Vec::new(),
            },
        );
        append(
            &store,
            result,
            Fact::Completed {
                boundary: boundary.to_string(),
            },
        );
        tree = result;
    }
    assert!(store.history().is_ok());
    let deleted = store.deleted_files().unwrap();
    assert!(deleted.iter().any(|entry| entry.path == "file0.txt"));
    assert!(!deleted.iter().any(|entry| entry.path == "a.txt"));
    store.record_external_changes().unwrap();
    assert!(store.history().is_ok());
    assert!(
        store
            .deleted_files()
            .unwrap()
            .iter()
            .any(|entry| entry.path == "file9998.txt")
    );
    assert!(matches!(
        store.create_text("later.txt", "later").unwrap(),
        SaveOutcome::Saved { .. }
    ));
    drop(store);
    let mut store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(store.read_text("later.txt").unwrap().text, "later");
    assert!(matches!(
        store.move_entry("later.txt", "moved.txt").unwrap(),
        OperationOutcome::Complete { .. }
    ));
}

#[test]
fn file_history_reuses_unchanged_subtrees_in_one_bounded_reconstruction() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    let note = crate::metadata::new_document();
    fs::write(temp.path().join("note.md"), &note).unwrap();
    let store = ContentStore::open(temp.path()).unwrap();
    let blob = store.repo.blob(b"original").unwrap();
    let mut builder = store.repo.treebuilder(None).unwrap();
    builder.insert("a.txt", blob, 0o100644).unwrap();
    builder
        .insert(
            "note.md",
            store.repo.blob(note.as_bytes()).unwrap(),
            0o100644,
        )
        .unwrap();
    for index in 0..1_998 {
        builder
            .insert(format!("file{index}.txt"), blob, 0o100644)
            .unwrap();
    }
    let mut tree = builder.write().unwrap();
    drop(builder);
    append(&store, tree, Fact::Observation);
    for index in 0..30 {
        let (source, destination) = if index % 2 == 0 {
            ("a.txt", "b.txt")
        } else {
            ("b.txt", "a.txt")
        };
        let mut builder = store
            .repo
            .treebuilder(Some(&store.repo.find_tree(tree).unwrap()))
            .unwrap();
        builder.remove(source).unwrap();
        builder.insert(destination, blob, 0o100644).unwrap();
        let result = builder.write().unwrap();
        let boundary = append(
            &store,
            tree,
            Fact::Boundary {
                operation: Operation::Move {
                    source: source.into(),
                    destination: destination.into(),
                },
                expected_tree: result.to_string(),
                patches: Vec::new(),
            },
        );
        append(
            &store,
            result,
            Fact::Completed {
                boundary: boundary.to_string(),
            },
        );
        tree = result;
        if index == 11 {
            assert!(store.file_history("note.md").is_ok());
        }
    }
    assert!(store.history().is_ok());
    let history = store.file_history("note.md").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].message, "native.history.initialContent");
    assert!(store.deleted_files().is_ok());
}
