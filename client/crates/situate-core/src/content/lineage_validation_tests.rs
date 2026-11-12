use super::*;
use crate::content::history_records::{Envelope, Fact, MAX_COMMITS, MAX_RECORD_BYTES};
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::write(temp.path().join("a.txt"), "original").unwrap();
    temp
}
fn raw_commit(
    store: &ContentStore,
    tree: &git2::Tree<'_>,
    parents: &[&git2::Commit<'_>],
    message: &str,
) -> Oid {
    let author = Signature::now("Test", "test@example.invalid").unwrap();
    let id = store
        .repo
        .commit(None, &author, &author, message, tree, parents)
        .unwrap();
    let name = store.repo.head().unwrap().name().unwrap().to_string();
    store.repo.reference(&name, id, true, "test").unwrap();
    id
}
fn rewrite_head(store: &ContentStore, transform: impl FnOnce(String) -> String) -> Oid {
    let commit = store.repo.head().unwrap().peel_to_commit().unwrap();
    let parent = commit.parent(0).unwrap();
    raw_commit(
        store,
        &commit.tree().unwrap(),
        &[&parent],
        &transform(commit.message().unwrap().into()),
    )
}

#[test]
fn invalid_completed_facts_fail_closed_in_resolution_history_and_reversal() {
    for corruption in ["boundary", "tree", "version", "extra", "missing"] {
        let temp = workspace();
        fs::write(
            temp.path().join("a.md"),
            format!("{}original", crate::metadata::new_document()),
        )
        .unwrap();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let reference = store.capture_reference("test", "a.txt", None).unwrap();
        store.move_entry("a.txt", "b.txt").unwrap();
        let completed = store.repo.head().unwrap().peel_to_commit().unwrap();
        let tree = completed.tree_id().to_string();
        let boundary = completed.parent_id(0).unwrap().to_string();
        drop(completed);
        let bad = rewrite_head(&store, |message| match corruption {
            "boundary" => message.replace(
                &format!("\"boundary\":\"{boundary}\""),
                &format!("\"boundary\":\"{}\"", "a".repeat(40)),
            ),
            "tree" => message.replace(
                &format!("\"result_tree\":\"{tree}\""),
                &format!("\"result_tree\":\"{}\"", "a".repeat(40)),
            ),
            "version" => message.replace("\"version\":1", "\"version\":2"),
            "extra" => message.replace("\"version\":1", "\"version\":1,\"extra\":true"),
            _ => "native.history.moveContent".into(),
        });
        assert!(
            store.resolve_reference_path(&reference).is_err(),
            "{corruption}"
        );
        assert!(store.history().is_err(), "{corruption}");
        assert!(store.file_history("a.md").is_err(), "{corruption}");
        assert!(
            store.reverse_change("a.md", &bad.to_string()).is_err(),
            "{corruption}"
        );
        assert!(
            store
                .reverse_entry_change("b.txt", &bad.to_string())
                .is_err(),
            "{corruption}"
        );
        assert!(
            store
                .historical_copy("b.txt", &bad.to_string(), "copy.txt")
                .is_err(),
            "{corruption}"
        );
        assert!(!temp.path().join("copy.txt").exists());
        assert_eq!(fs::read(temp.path().join("b.txt")).unwrap(), b"original");
        assert!(store.drafts().unwrap().is_empty());
    }
}

#[test]
fn completion_after_an_intervening_observation_cannot_close_an_old_boundary() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    INTERRUPT.set(2);
    store.move_entry("a.txt", "b.txt").unwrap();
    let boundary = store.repo.head().unwrap().target().unwrap().to_string();
    store.record_external_changes().unwrap();
    let observation = store.repo.head().unwrap().peel_to_commit().unwrap();
    let record = Envelope {
        version: 1,
        parent_tree: Some(observation.tree_id().to_string()),
        result_tree: observation.tree_id().to_string(),
        fact: Fact::Completed { boundary },
    };
    raw_commit(
        &store,
        &observation.tree().unwrap(),
        &[&observation],
        &record.message("native.history.moveContent").unwrap(),
    );
    // An earlier gap can return unresolved; malformed metadata must never select b.txt.
    assert!(!matches!(
        store.resolve_reference_path(&reference),
        Ok(Some(_))
    ));
    assert!(store.history().is_err());
}

#[test]
fn matching_declared_trees_do_not_prove_an_impossible_move() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    INTERRUPT.set(1);
    assert!(store.move_entry("a.txt", "b.txt").is_err());
    let boundary = store.repo.head().unwrap().peel_to_commit().unwrap();
    let mut record = Envelope::read(&boundary).unwrap();
    if let Fact::Boundary { expected_tree, .. } = &mut record.fact {
        *expected_tree = boundary.tree_id().to_string();
    }
    let parent = boundary.parent(0).unwrap();
    let bad_boundary = raw_commit(
        &store,
        &boundary.tree().unwrap(),
        &[&parent],
        &record.message("native.history.operationBoundary").unwrap(),
    );
    let bad_boundary = store.repo.find_commit(bad_boundary).unwrap();
    let completed = Envelope {
        version: 1,
        parent_tree: Some(bad_boundary.tree_id().to_string()),
        result_tree: bad_boundary.tree_id().to_string(),
        fact: Fact::Completed {
            boundary: bad_boundary.id().to_string(),
        },
    };
    raw_commit(
        &store,
        &bad_boundary.tree().unwrap(),
        &[&bad_boundary],
        &completed.message("native.history.moveContent").unwrap(),
    );
    assert!(store.resolve_reference_path(&reference).is_err());
    assert!(store.history().is_err());
}

#[test]
fn missing_anchor_merge_and_oversized_envelope_never_return_a_path() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    let mut missing = reference.clone();
    if let ContentReference::Live {
        anchor_revision, ..
    } = &mut missing
    {
        *anchor_revision = "f".repeat(40);
    }
    assert!(store.resolve_reference_path(&missing).is_err());
    let parent = store.repo.head().unwrap().peel_to_commit().unwrap();
    let record = Envelope {
        version: 1,
        parent_tree: Some(parent.tree_id().to_string()),
        result_tree: parent.tree_id().to_string(),
        fact: Fact::Observation,
    };
    let message = record.message("native.history.externalChanges").unwrap();
    raw_commit(
        &store,
        &parent.tree().unwrap(),
        &[&parent, &parent],
        &message,
    );
    assert!(store.resolve_reference_path(&reference).is_err());
    raw_commit(
        &store,
        &parent.tree().unwrap(),
        &[&parent],
        &format!("{}{message}", "x".repeat(MAX_RECORD_BYTES)),
    );
    assert!(store.resolve_reference_path(&reference).is_err());
}

// A single pack preserves the full traversal boundary without thousands of
// individual object and reference flushes. Stored DEFLATE blocks need no codec.
fn append_observation_pack(repo: &git2::Repository, count: usize) {
    let head = repo.head().unwrap();
    let commit = head.peel_to_commit().unwrap();
    let tree = commit.tree_id();
    let mut parent = commit.id();
    let message = Envelope {
        version: 1,
        parent_tree: Some(tree.to_string()),
        result_tree: tree.to_string(),
        fact: Fact::Observation,
    }
    .message("native.history.externalChanges")
    .unwrap();
    let mut pack = b"PACK\0\0\0\x02".to_vec();
    pack.extend_from_slice(&u32::try_from(count).unwrap().to_be_bytes());
    for _ in 0..count {
        let bytes = format!(
            "tree {tree}\nparent {parent}\nauthor Test <test@example.invalid> 0 +0000\ncommitter Test <test@example.invalid> 0 +0000\n\n{message}"
        ).into_bytes();
        parent = Oid::hash_object(git2::ObjectType::Commit, &bytes).unwrap();
        let mut size = bytes.len();
        let mut header = 0x10 | (size & 0x0f) as u8;
        size >>= 4;
        while size != 0 {
            pack.push(header | 0x80);
            header = (size & 0x7f) as u8;
            size >>= 7;
        }
        pack.push(header);
        pack.extend_from_slice(&[0x78, 0x01]);
        let mut chunks = bytes.chunks(u16::MAX as usize).peekable();
        while let Some(chunk) = chunks.next() {
            let length = u16::try_from(chunk.len()).unwrap();
            pack.push(u8::from(chunks.peek().is_none()));
            pack.extend_from_slice(&length.to_le_bytes());
            pack.extend_from_slice(&(!length).to_le_bytes());
            pack.extend_from_slice(chunk);
        }
        let (mut a, mut b) = (1u32, 0u32);
        for byte in &bytes {
            a = (a + u32::from(*byte)) % 65_521;
            b = (b + a) % 65_521;
        }
        pack.extend_from_slice(&((b << 16) | a).to_be_bytes());
    }
    let mut checksum = sha1collisiondetection::Sha1CD::default();
    checksum.update(&pack);
    pack.extend_from_slice(&checksum.finalize_cd().unwrap());
    let database = repo.odb().unwrap();
    let mut writer = database.packwriter().unwrap();
    std::io::Write::write_all(&mut writer, &pack).unwrap();
    writer.commit().unwrap();
    repo.find_commit(parent).unwrap();
    repo.reference(head.name().unwrap(), parent, true, "test")
        .unwrap();
}

#[test]
fn packed_observations_preserve_valid_move_history() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    store.move_entry("a.txt", "b.txt").unwrap();
    let before = store.history().unwrap().len();
    append_observation_pack(&store.repo, 3);
    assert_eq!(store.history().unwrap().len(), before + 3);
    assert_eq!(
        store.resolve_reference_path(&reference).unwrap().as_deref(),
        Some("b.txt")
    );
}

#[test]
fn traversal_limit_does_not_skip_a_decisive_move() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.capture_reference("test", "a.txt", None).unwrap();
    store.move_entry("a.txt", "b.txt").unwrap();
    append_observation_pack(&store.repo, MAX_COMMITS);
    assert!(store.resolve_reference_path(&reference).is_err());
    assert!(store.history().is_err());
    store.record_external_changes().unwrap();
    assert!(matches!(
        store.create_text("later.txt", "later").unwrap(),
        SaveOutcome::Saved { .. }
    ));
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    assert_eq!(store.read_text("later.txt").unwrap().text, "later");
}

#[test]
fn tree_validation_rejects_excessive_depth_and_entry_count() {
    let temp = workspace();
    let store = ContentStore::open(temp.path()).unwrap();
    let blob = store.repo.blob(b"content").unwrap();
    let mut builder = store.repo.treebuilder(None).unwrap();
    builder.insert("file.txt", blob, 0o100644).unwrap();
    let mut tree = builder.write().unwrap();
    for _ in 0..65 {
        let mut builder = store.repo.treebuilder(None).unwrap();
        builder.insert("folder", tree, 0o040000).unwrap();
        tree = builder.write().unwrap();
    }
    assert!(crate::content::lineage::tree_image(&store.repo, tree).is_err());
    let mut builder = store.repo.treebuilder(None).unwrap();
    for index in 0..10_001 {
        builder
            .insert(format!("file{index}.txt"), blob, 0o100644)
            .unwrap();
    }
    assert!(crate::content::lineage::tree_image(&store.repo, builder.write().unwrap()).is_err());
}
