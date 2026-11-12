use super::*;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    temp
}
fn complete(outcome: OperationOutcome) -> String {
    match outcome {
        OperationOutcome::Complete { history_revision } => history_revision,
        other => panic!("{other:?}"),
    }
}
const ID: &str = "CD906F2C-D76E-4927-BB88-8AD0FA2B6101";
const TASK: &str = "83901d28-121a-4f08-a0c5-406aad7c7c17";
fn note() -> String {
    format!(
        "---\r\n'situate-id': '{ID}' # keep\r\ncustom: {{text: unchanged}}\r\n---\r\n- [ ] Work <!-- {{situate-task-id: \"{TASK}\", due: tomorrow}} -->\r\n- [ ] Ordinary\r\n`<!-- situate-task-id: {TASK} -->`\r\n"
    )
}
#[test]
fn retained_nested_file_identity_allows_parent_move_and_detects_replacement() {
    let temp = workspace();
    fs::create_dir_all(temp.path().join("source/sub")).unwrap();
    fs::create_dir(temp.path().join("deep")).unwrap();
    fs::write(temp.path().join("source/sub/note.md"), b"original").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let identity = {
        let source = child_dir(&store.root, "source").unwrap();
        let sub = child_dir(&source, "sub").unwrap();
        let (bytes, identity) = operations::read_operation_file(&sub, "note.md", 1024).unwrap();
        assert_eq!(bytes, b"original");
        operations::PatchIdentity::new(identity, true).unwrap()
    };
    complete(store.move_entry("source", "deep/moved").unwrap());
    assert!(!temp.path().join("source").exists());
    let deep = child_dir(&store.root, "deep").unwrap();
    let moved = child_dir(&deep, "moved").unwrap();
    let sub = child_dir(&moved, "sub").unwrap();
    let (bytes, moved_identity) = operations::read_operation_file(&sub, "note.md", 1024).unwrap();
    assert_eq!(bytes, b"original");
    assert!(identity.matches(&moved_identity).unwrap());
    sub.rename("note.md", &sub, "retained.md").unwrap();
    sub.write("note.md", b"original").unwrap();
    let (bytes, replacement) = operations::read_operation_file(&sub, "note.md", 1024).unwrap();
    assert_eq!(bytes, b"original");
    assert!(!identity.matches(&replacement).unwrap());
}

#[test]
fn folder_and_binary_history_tracks_content_moves_and_deletion() {
    let temp = workspace();
    fs::create_dir(temp.path().join("docs.md")).unwrap();
    fs::write(temp.path().join("docs.md/raw.bin"), [0, 255, 1]).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    fs::write(temp.path().join("docs.md/raw.bin"), [0, 255, 2]).unwrap();
    store.record_external_changes().unwrap();
    let moved = complete(store.move_entry("docs.md", "moved").unwrap());
    let folder = store.file_history("moved").unwrap();
    assert_eq!(folder.len(), 3);
    assert_eq!(folder[0].path.as_deref(), Some("moved"));
    assert_eq!(folder[2].path.as_deref(), Some("docs.md"));
    assert_eq!(store.file_history("moved/raw.bin").unwrap().len(), 3);
    complete(store.delete_entry("moved").unwrap());
    let deleted = store.historical_file_history("moved", &moved).unwrap();
    assert_eq!(deleted.len(), 4);
    assert!(deleted[0].deleted);
}

#[test]
fn non_markdown_content_is_not_merged_as_text_even_when_its_bytes_are_utf8() {
    let temp = workspace();
    fs::write(
        temp.path().join("document.pdf"),
        "%PDF\nbefore\nmiddle\nend\n",
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    fs::write(
        temp.path().join("document.pdf"),
        "%PDF\nafter\nmiddle\nend\n",
    )
    .unwrap();
    let changed = store.record_external_changes().unwrap();
    let current = "%PDF\nafter\nmiddle\nlater\n";
    fs::write(temp.path().join("document.pdf"), current).unwrap();
    assert!(
        store
            .reverse_entry_change("document.pdf", &changed)
            .is_err()
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("document.pdf")).unwrap(),
        current
    );
    assert!(store.drafts().unwrap().is_empty());
}

#[test]
fn staged_draft_survives_restart_without_saving_and_bad_base_is_rejected() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "original").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    let draft = Draft {
        path: "note.md".into(),
        base: Some(base.clone()),
        text: "pending".into(),
    };
    store.stage_draft(&draft).unwrap();
    assert_eq!(store.history().unwrap().len(), 1);
    assert_eq!(revision_for_text(&base.text).unwrap(), base.revision);
    assert_eq!(
        revision_for_text("").unwrap(),
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
    );
    assert_eq!(store.read_text("note.md").unwrap(), base);
    drop(store);
    assert_eq!(read_recovery_drafts(temp.path()).unwrap(), vec![draft]);
}
#[test]
fn structural_roundtrip_preserves_binary_empty_directories_and_drafts() {
    let temp = workspace();
    fs::create_dir_all(temp.path().join("folder/empty")).unwrap();
    fs::write(temp.path().join("folder/raw.bin"), [0, 255, 13]).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    complete(store.create_folder("new").unwrap());
    assert!(store.create_folder("new").is_err());
    complete(store.move_entry("folder", "moved").unwrap());
    assert!(!temp.path().join("folder").exists());
    assert!(temp.path().join("moved/empty").is_dir());
    let revision = store.history().unwrap()[0].revision.clone();
    complete(store.delete_entry("moved").unwrap());
    assert!(
        store
            .deleted_files()
            .unwrap()
            .iter()
            .any(|entry| entry.path == "moved/raw.bin")
    );
    complete(store.restore_deleted("moved", &revision, "moved").unwrap());
    assert_eq!(
        fs::read(temp.path().join("moved/raw.bin")).unwrap(),
        [0, 255, 13]
    );
    assert!(temp.path().join("moved/empty").is_dir());
    assert!(store.restore_deleted("moved", &revision, "moved").is_err());
}
#[test]
fn copying_replaces_only_identity_scalars_and_recognized_links() {
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    let source = note();
    fs::write(temp.path().join("folder/a.md"), &source).unwrap();
    fs::write(temp.path().join("folder/b.md"), format!("[A](situate:{ID})\n[task](situate:{TASK})\n[outside](situate:4c966a4e-3d23-4d5e-b96b-7b9a90911948)\n")).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    complete(store.copy_entry("folder", "copied").unwrap());
    let copy = store.read_text("copied/a.md").unwrap().text;
    let metadata = crate::metadata::inspect(&copy);
    assert!(metadata.issues.is_empty(), "{metadata:?}\n{copy}");
    let new_task = &metadata.tasks[0].id;
    assert_ne!(new_task, TASK);
    assert_eq!(copy, source.replacen(TASK, new_task, 1));
    assert_eq!(store.read_text("folder/a.md").unwrap().text, source);
    let links = store.read_text("copied/b.md").unwrap().text;
    assert!(links.contains(&format!("[A](situate:{ID})")));
    assert!(links.contains(&format!("[task](situate:{new_task})")));
    assert!(links.contains("[outside](situate:4c966a4e-3d23-4d5e-b96b-7b9a90911948)"));
}
#[test]
fn malformed_frontmatter_is_preserved_by_copy_and_move() {
    let temp = workspace();
    let source = "---\nsituate-id: [broken\n---\nkeep\n";
    fs::write(temp.path().join("broken.md"), source).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    complete(store.copy_entry("broken.md", "copy.md").unwrap());
    assert_eq!(store.read_text("copy.md").unwrap().text, source);
    assert_eq!(store.read_text("broken.md").unwrap().text, source);
    complete(store.move_entry("broken.md", "moved.md").unwrap());
    assert_eq!(store.read_text("moved.md").unwrap().text, source);
}
#[test]
fn unrelated_invalid_yaml_is_preserved_without_enrichment() {
    let temp = workspace();
    let source = "---\ncustom: [broken\n---\nkeep\n";
    fs::write(temp.path().join("broken.md"), source).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    complete(store.copy_entry("broken.md", "copy.md").unwrap());
    let copy = store.read_text("copy.md").unwrap().text;
    assert!(copy.contains("custom: [broken\n---\nkeep\n"));
    assert_eq!(copy, source);
}
#[test]
fn historical_copy_and_restore_have_distinct_identity_semantics_and_no_clobber() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let revision = store.history().unwrap()[0].revision.clone();
    complete(
        store
            .historical_copy("note.md", &revision, "copy.md")
            .unwrap(),
    );
    assert_ne!(
        crate::metadata::inspect(&store.read_text("copy.md").unwrap().text).tasks[0].id,
        TASK
    );
    complete(store.delete_entry("note.md").unwrap());
    assert!(
        store
            .restore_deleted("note.md", &revision, "copy.md")
            .is_err()
    );
    complete(
        store
            .restore_deleted("note.md", &revision, "note.md")
            .unwrap(),
    );
    assert_eq!(store.read_text("note.md").unwrap().text, note());
}
#[test]
fn reverse_one_change_preserves_independent_edits_and_conflicts_are_reviewable() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "one\ntwo\nthree\nfour\nfive\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    let revision = match store
        .save("note.md", &base, "changed\ntwo\nthree\nfour\nfive\n")
        .unwrap()
    {
        SaveOutcome::Saved {
            history_revision, ..
        } => history_revision,
        other => panic!("{other:?}"),
    };
    fs::write(
        temp.path().join("note.md"),
        "changed\ntwo\nthree\nfour\nexternal\n",
    )
    .unwrap();
    assert!(matches!(
        store.reverse_change("note.md", &revision).unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert_eq!(
        store.read_text("note.md").unwrap().text,
        "one\ntwo\nthree\nfour\nexternal\n"
    );
    fs::write(
        temp.path().join("note.md"),
        "conflicting\ntwo\nthree\nfour\nexternal\n",
    )
    .unwrap();
    assert!(matches!(
        store.reverse_change("note.md", &revision).unwrap(),
        SaveOutcome::Conflict { .. }
    ));
    assert!(
        store
            .read_text("note.md")
            .unwrap()
            .text
            .starts_with("conflicting")
    );
}
#[test]
fn file_history_follows_managed_moves_not_reused_paths_or_unrelated_commits() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    complete(store.move_entry("note.md", "renamed.md").unwrap());
    store
        .create_text("note.md", &crate::metadata::new_document())
        .unwrap();
    complete(store.create_folder("unrelated").unwrap());
    let history = store.file_history("renamed.md").unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(
        store.read_file_revision("renamed.md", &initial).unwrap(),
        note().as_bytes()
    );
    assert!(store.read_file_revision("note.md", &initial).is_err());
    assert!(store.deleted_files().unwrap().is_empty());
}
#[test]
fn external_deleted_draft_restore_is_explicit_and_rechecks_collision() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    let text = base.text.replace("Work", "Pending work");
    fs::remove_file(temp.path().join("note.md")).unwrap();
    assert_eq!(
        store.save("note.md", &base, &text).unwrap(),
        SaveOutcome::ExternalDeleted
    );
    fs::write(temp.path().join("note.md"), "unrelated").unwrap();
    assert!(store.restore_draft("note.md", &base, &text).is_err());
    assert_eq!(store.drafts().unwrap()[0].text, text);
    fs::remove_file(temp.path().join("note.md")).unwrap();
    assert!(matches!(
        store.restore_draft("note.md", &base, &text).unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert!(store.drafts().unwrap().is_empty());
    assert_eq!(store.read_text("note.md").unwrap().text, text);
}
#[test]
fn boundary_publication_failure_preserves_original_without_starting_mutation() {
    let temp = workspace();
    fs::write(temp.path().join("note.bin"), [0, 255]).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let reference = store.repo.head().unwrap().name().unwrap().to_string();
    fs::write(
        temp.path()
            .join(format!(".situate/history.git/{reference}.lock")),
        "locked",
    )
    .unwrap();
    let recovery = store.repo.head().unwrap().target().unwrap().to_string();
    assert!(store.delete_entry("note.bin").is_err());
    assert_eq!(fs::read(temp.path().join("note.bin")).unwrap(), [0, 255]);
    assert_eq!(
        store.read_revision("note.bin", &recovery).unwrap(),
        [0, 255]
    );
    assert!(
        !fs::read_dir(temp.path().join(".situate"))
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("deleted-"))
    );
}
#[test]
fn relative_copy_and_move_links_preserve_targets_inside_and_outside_subtree() {
    let temp = workspace();
    fs::create_dir_all(temp.path().join("source/sub")).unwrap();
    fs::create_dir(temp.path().join("deep")).unwrap();
    fs::write(temp.path().join("outside.png"), [0, 255]).unwrap();
    fs::write(temp.path().join("source/peer.md"), "peer").unwrap();
    let source = "[peer](../peer.md#heading)\n![outside](../../outside.png)\n[web](https://example.com/a)\n`[code](../../outside.png)`\n";
    fs::write(temp.path().join("source/sub/note.md"), source).unwrap();
    fs::write(
        temp.path().join("backlink.md"),
        "[note](source/sub/note.md)\n",
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    complete(store.copy_entry("source", "deep/copied").unwrap());
    let copied = store.read_text("deep/copied/sub/note.md").unwrap().text;
    assert!(copied.ends_with("[peer](../peer.md#heading)\n![outside](../../../outside.png)\n[web](https://example.com/a)\n`[code](../../outside.png)`\n"));
    assert_eq!(store.read_text("source/sub/note.md").unwrap().text, source);
    assert_eq!(
        store.read_text("backlink.md").unwrap().text,
        "[note](source/sub/note.md)\n"
    );
    complete(store.move_entry("source", "deep/moved").unwrap());
    assert_eq!(
        store.read_text("backlink.md").unwrap().text,
        "[note](deep/moved/sub/note.md)\n"
    );
    assert!(
        store
            .read_text("deep/moved/sub/note.md")
            .unwrap()
            .text
            .contains("![outside](../../../outside.png)")
    );
}

#[test]
fn relative_links_roundtrip_encoded_destination_names_across_repeated_moves() {
    let temp = workspace();
    fs::create_dir(temp.path().join("source")).unwrap();
    fs::write(temp.path().join("source/target.md"), "target").unwrap();
    fs::write(
        temp.path().join("link.md"),
        "[target](source/target.md#section)\n![image](source/target.md)\n",
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let (destination, encoded) = if cfg!(windows) {
        ("space #%() ü", "space%20%23%25%28%29%20%C3%BC/target.md")
    } else {
        (
            "space #?%() ü",
            "space%20%23%3F%25%28%29%20%C3%BC/target.md",
        )
    };
    complete(store.move_entry("source", destination).unwrap());
    assert_eq!(
        store.read_text("link.md").unwrap().text,
        format!("[target]({encoded}#section)\n![image]({encoded})\n")
    );
    complete(store.move_entry(destination, "again").unwrap());
    assert_eq!(
        store.read_text("link.md").unwrap().text,
        "[target](again/target.md#section)\n![image](again/target.md)\n"
    );
}

#[test]
fn copying_preserves_user_metadata_and_ambiguous_task_links() {
    let temp = workspace();
    fs::create_dir(temp.path().join("source")).unwrap();
    let source = format!(
        "---\ncustom: \"[literal](situate:{ID})\"\nsituate-id: '{ID}'\n---\n[self](situate:{ID})\n- [ ] Work <!-- situate-task-id: {TASK} -->\n[task](situate:{TASK})\n"
    );
    fs::write(temp.path().join("source/note.md"), &source).unwrap();
    fs::write(temp.path().join("duplicate.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    complete(store.copy_entry("source", "copied").unwrap());
    let copy = store.read_text("copied/note.md").unwrap().text;
    assert!(copy.contains(&format!("custom: \"[literal](situate:{ID})\"")));
    assert!(copy.contains(&format!("[self](situate:{ID})")));
    assert!(copy.contains(&format!("[task](situate:{TASK})")));
    assert_ne!(crate::metadata::inspect(&copy).tasks[0].id, TASK);
    assert_eq!(store.read_text("source/note.md").unwrap().text, source);
}

#[test]
fn save_as_new_regenerates_draft_identities_and_rebases_links_without_discarding_source() {
    let temp = workspace();
    fs::create_dir_all(temp.path().join("source")).unwrap();
    fs::create_dir_all(temp.path().join("deep/new")).unwrap();
    fs::write(temp.path().join("outside.png"), [7]).unwrap();
    let text = format!(
        "{}[self](situate:{ID})\n![outside](../outside.png)\n[self path](note.md)\n",
        note()
    );
    let mut store = ContentStore::open(temp.path()).unwrap();
    let draft = Draft {
        path: "source/note.md".into(),
        base: None,
        text: text.clone(),
    };
    store.stage_draft(&draft).unwrap();
    assert!(matches!(
        store
            .create_from_draft("source/note.md", "deep/new/copy.markdown", &text)
            .unwrap(),
        SaveOutcome::Saved { .. }
    ));
    let copied = store.read_text("deep/new/copy.markdown").unwrap().text;
    let metadata = crate::metadata::inspect(&copied);
    assert_ne!(metadata.tasks[0].id, TASK);
    assert!(copied.contains(&format!("[self](situate:{ID})")));
    assert!(copied.contains("![outside](../../outside.png)"));
    assert!(copied.contains("[self path](copy.markdown)"));
    assert_eq!(store.drafts().unwrap(), vec![draft]);
    assert!(!temp.path().join("source/note.md").exists());
    assert!(
        store
            .create_from_draft(
                "source/note.md",
                "bad.md",
                "- [ ] Invalid <!-- situate-task-id: broken -->\n"
            )
            .is_err()
    );
    assert!(!temp.path().join("bad.md").exists());
    assert_eq!(store.drafts().unwrap()[0].text, text);
}

#[test]
fn source_drafts_block_moves_and_deletes_and_moved_identity_blocks_draft_restore() {
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/note.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("folder/note.md").unwrap();
    let text = base.text.replace("Work", "Pending");
    store
        .stage_draft(&Draft {
            path: "folder/note.md".into(),
            base: Some(base.clone()),
            text: text.clone(),
        })
        .unwrap();
    assert!(matches!(
        store.move_entry("folder", "moved"),
        Err(ContentError::DraftPersistence(_))
    ));
    assert!(matches!(
        store.delete_entry("folder"),
        Err(ContentError::DraftPersistence(_))
    ));
    fs::rename(
        temp.path().join("folder/note.md"),
        temp.path().join("elsewhere.md"),
    )
    .unwrap();
    assert!(matches!(
        store.restore_draft("folder/note.md", &base, &text),
        Err(ContentError::InvalidReview)
    ));
    assert_eq!(store.drafts().unwrap()[0].text, text);
    assert!(!temp.path().join("folder/note.md").exists());
}

#[test]
fn markdown_long_suffix_preserves_task_copy_history_and_external_bytes() {
    let temp = workspace();
    fs::write(temp.path().join("note.MARKDOWN"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    complete(store.copy_entry("note.MARKDOWN", "copy.markdown").unwrap());
    assert_ne!(
        crate::metadata::inspect(&store.read_text("copy.markdown").unwrap().text).tasks[0].id,
        TASK
    );
    complete(
        store
            .move_entry("note.MARKDOWN", "renamed.markdown")
            .unwrap(),
    );
    assert_eq!(
        store
            .resolved_revision_path("renamed.markdown", &initial)
            .unwrap(),
        "note.MARKDOWN"
    );
    fs::write(temp.path().join("new.Markdown"), "external").unwrap();
    store.record_external_changes().unwrap();
    assert_eq!(store.read_text("new.Markdown").unwrap().text, "external");
}

#[test]
fn structural_size_budget_is_aggregate_and_rejects_before_visible_mutation() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    fs::create_dir(temp.path().join("source")).unwrap();
    for name in ["a.bin", "b.bin"] {
        fs::File::create(temp.path().join("source").join(name))
            .unwrap()
            .set_len(40 * 1024 * 1024)
            .unwrap();
    }
    assert!(
        matches!(store.copy_entry("source", "copy"), Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::Unsupported)
    );
    assert!(
        matches!(store.delete_entry("source"), Err(ContentError::Io(error)) if error.kind() == io::ErrorKind::Unsupported)
    );
    assert!(!temp.path().join("copy").exists());
    assert_eq!(
        fs::metadata(temp.path().join("source/a.bin"))
            .unwrap()
            .len(),
        40 * 1024 * 1024
    );
    assert_eq!(store.history().unwrap().len(), 1);
}

#[test]
fn explicit_historical_copy_uses_selected_path_even_when_current_occupant_is_unrelated() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    complete(store.delete_entry("note.md").unwrap());
    let history = store.file_history("note.md").unwrap();
    assert!(history[0].deleted);
    assert_eq!(history[0].path.as_deref(), Some("note.md"));
    store
        .create_text("note.md", &crate::metadata::new_document())
        .unwrap();
    let selected_history = store.historical_file_history("note.md", &initial).unwrap();
    assert_eq!(selected_history.len(), 2);
    assert!(selected_history[0].deleted);
    assert_eq!(selected_history[1].revision, initial);
    complete(
        store
            .historical_copy("note.md", &initial, "historical.md")
            .unwrap(),
    );
    assert!(
        store
            .read_text("historical.md")
            .unwrap()
            .text
            .contains("custom: {text: unchanged}")
    );
}

#[test]
fn external_frontmatter_changes_merge_as_ordinary_metadata() {
    for replacement in [
        "situate-id: 4c966a4e-3d23-4d5e-b96b-7b9a90911948",
        "custom: removed",
    ] {
        let temp = workspace();
        let source = format!("---\nsituate-id: {ID}\n---\none\ntwo\nthree\nfour\nfive\n");
        fs::write(temp.path().join("note.md"), &source).unwrap();
        let mut store = ContentStore::open(temp.path()).unwrap();
        let base = store.read_text("note.md").unwrap();
        let external = source.replace(&format!("situate-id: {ID}"), replacement);
        fs::write(temp.path().join("note.md"), &external).unwrap();
        assert!(matches!(
            store
                .save("note.md", &base, &source.replace("five", "editor"))
                .unwrap(),
            SaveOutcome::Saved { .. }
        ));
        assert_eq!(
            store.read_text("note.md").unwrap().text,
            external.replace("five", "editor")
        );
    }
    let temp = workspace();
    let source = format!(
        "---\nsituate-id: {}\n---\none\ntwo\nthree\nfour\nfive\n",
        ID.to_lowercase()
    );
    fs::write(temp.path().join("note.md"), &source).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    fs::write(
        temp.path().join("note.md"),
        source.replace(&ID.to_lowercase(), ID),
    )
    .unwrap();
    assert!(matches!(
        store
            .save("note.md", &base, &source.replace("five", "editor"))
            .unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert!(store.read_text("note.md").unwrap().text.contains(ID));
    assert!(store.read_text("note.md").unwrap().text.contains("editor"));
}

#[test]
fn a_new_editor_base_cannot_replace_a_retained_recovery_draft() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "old").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    store
        .stage_draft(&Draft {
            path: "note.md".into(),
            base: Some(base),
            text: "retained".into(),
        })
        .unwrap();
    fs::write(temp.path().join("note.md"), "external").unwrap();
    let new_base = store.read_text("note.md").unwrap();
    assert!(matches!(
        store.save("note.md", &new_base, "new draft"),
        Err(ContentError::DraftPersistence(_))
    ));
    assert_eq!(store.drafts().unwrap()[0].text, "retained");
    assert_eq!(store.read_text("note.md").unwrap().text, "external");
}

#[test]
fn structural_reversal_moves_current_text_and_rejects_changed_creation() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let moved = complete(store.move_entry("note.md", "moved.md").unwrap());
    let updated = note().replace("Work", "Later independent edit");
    fs::write(temp.path().join("moved.md"), &updated).unwrap();
    assert!(matches!(
        store.reverse_entry_change("moved.md", &moved).unwrap(),
        ReversalOutcome::Structure(OperationOutcome::Complete { .. })
    ));
    assert_eq!(store.read_text("note.md").unwrap().text, updated);
    let created = complete(store.create_folder("empty").unwrap());
    fs::write(temp.path().join("empty/new.bin"), [7]).unwrap();
    assert!(matches!(
        store.reverse_entry_change("empty", &created),
        Err(ContentError::InvalidReview)
    ));
    fs::remove_file(temp.path().join("empty/new.bin")).unwrap();
    assert!(matches!(
        store.reverse_entry_change("empty", &created).unwrap(),
        ReversalOutcome::Structure(OperationOutcome::Complete { .. })
    ));
    let deleted = complete(store.delete_entry("note.md").unwrap());
    assert!(matches!(
        store.reverse_entry_change("note.md", &deleted).unwrap(),
        ReversalOutcome::Structure(OperationOutcome::Complete { .. })
    ));
    assert_eq!(store.read_text("note.md").unwrap().text, updated);
}

#[test]
fn observation_records_external_bytes_without_enrichment_or_yaml_repair() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    fs::write(temp.path().join("external.md"), "- [ ] Ordinary\n").unwrap();
    fs::write(
        temp.path().join("broken.md"),
        "---\nsituate-id: broken\n---\n",
    )
    .unwrap();
    store.record_external_changes().unwrap();
    let text = store.read_text("external.md").unwrap().text;
    assert_eq!(text, "- [ ] Ordinary\n");
    assert!(crate::metadata::inspect(&text).tasks.is_empty());
    let history = store.history().unwrap();
    assert_eq!(
        store
            .read_revision("external.md", &history[0].revision)
            .unwrap(),
        b"- [ ] Ordinary\n"
    );
    fs::write(temp.path().join("external.md"), "removed deliberately\n").unwrap();
    store.record_external_changes().unwrap();
    assert_eq!(
        store.read_text("external.md").unwrap().text,
        "removed deliberately\n"
    );
    assert_eq!(
        store.read_text("broken.md").unwrap().text,
        "---\nsituate-id: broken\n---\n"
    );
}

#[test]
fn recovery_can_be_explicitly_discarded_with_broken_history_but_not_while_owned() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    store
        .stage_draft(&Draft {
            path: "deleted/target.md".into(),
            base: None,
            text: "retained".into(),
        })
        .unwrap();
    assert!(matches!(
        discard_recovery_draft(temp.path(), "deleted/target.md"),
        Err(ContentError::Busy)
    ));
    drop(store);
    fs::write(temp.path().join(".situate/history.git/HEAD"), "broken").unwrap();
    discard_recovery_draft(temp.path(), "deleted/target.md").unwrap();
    assert!(read_recovery_drafts(temp.path()).unwrap().is_empty());
    assert_eq!(
        fs::read_to_string(temp.path().join(".situate/history.git/HEAD")).unwrap(),
        "broken"
    );
}

#[test]
fn deleted_lineage_stays_discoverable_when_its_old_path_is_reused() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), note()).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    complete(store.delete_entry("note.md").unwrap());
    store
        .create_text("note.md", &crate::metadata::new_document())
        .unwrap();
    assert!(
        store
            .deleted_files()
            .unwrap()
            .iter()
            .any(|entry| entry.path == "note.md")
    );
    assert!(
        store
            .restore_deleted("note.md", &initial, "note.md")
            .is_err()
    );
    complete(
        store
            .restore_deleted("note.md", &initial, "restored.md")
            .unwrap(),
    );
    assert_eq!(store.read_text("restored.md").unwrap().text, note());
    assert!(
        store
            .restore_deleted("note.md", &initial, "duplicate.md")
            .is_err()
    );
}

#[test]
fn markdown_history_uses_move_facts_despite_duplicate_changed_or_missing_frontmatter() {
    let temp = workspace();
    let source = "---\nsituate-id: ordinary\n---\noriginal\n";
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/note.md"), source).unwrap();
    fs::write(temp.path().join("duplicate.md"), source).unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    complete(store.move_entry("folder", "moved").unwrap());
    fs::write(
        temp.path().join("moved/note.md"),
        "edited without frontmatter\n",
    )
    .unwrap();
    store.record_external_changes().unwrap();
    complete(store.move_entry("moved/note.md", "final.md").unwrap());
    drop(store);
    let store = ContentStore::open(temp.path()).unwrap();
    let history = store.file_history("final.md").unwrap();
    assert_eq!(history.len(), 4);
    assert_eq!(history.last().unwrap().revision, initial);
    assert_eq!(
        store.read_file_revision("final.md", &initial).unwrap(),
        source.as_bytes()
    );
    assert!(store.deleted_files().unwrap().is_empty());
}

#[test]
fn copies_and_restoration_start_history_without_rebinding_deleted_lineage() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "same bytes\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let initial = store.history().unwrap()[0].revision.clone();
    let copied = complete(store.copy_entry("note.md", "copy.md").unwrap());
    assert_eq!(store.file_history("copy.md").unwrap().len(), 1);
    assert_eq!(store.file_history("copy.md").unwrap()[0].revision, copied);
    complete(store.delete_entry("note.md").unwrap());
    let restored = complete(
        store
            .restore_deleted("note.md", &initial, "note.md")
            .unwrap(),
    );
    assert_eq!(store.file_history("note.md").unwrap().len(), 1);
    assert_eq!(store.file_history("note.md").unwrap()[0].revision, restored);
    assert!(store.read_file_revision("note.md", &initial).is_err());
    let old = store.historical_file_history("note.md", &initial).unwrap();
    assert_eq!(old.len(), 2);
    assert!(old[0].deleted);
    assert_eq!(old[1].revision, initial);
    assert_eq!(
        store.read_revision("note.md", &initial).unwrap(),
        b"same bytes\n"
    );
    assert_eq!(
        store
            .resolve_entry_path("note.md", &initial, false)
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .resolve_entry_path("note.md", &restored, false)
            .unwrap()
            .as_deref(),
        Some("note.md")
    );
    assert!(
        store
            .deleted_files()
            .unwrap()
            .iter()
            .any(|entry| entry.path == "note.md")
    );
}

#[test]
fn structural_reversal_rejects_a_reused_markdown_path_even_with_identical_bytes() {
    let temp = workspace();
    fs::write(temp.path().join("note.md"), "original\n").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let moved = complete(store.move_entry("note.md", "moved.md").unwrap());
    complete(store.delete_entry("moved.md").unwrap());
    store.create_text("moved.md", "original\n").unwrap();
    assert!(matches!(
        store.reverse_entry_change("moved.md", &moved),
        Err(ContentError::InvalidReview)
    ));
    assert_eq!(store.read_text("moved.md").unwrap().text, "original\n");
    assert!(!temp.path().join("note.md").exists());
}

#[cfg(unix)]
#[test]
fn symlinks_and_readonly_sources_reject_structural_mutation() {
    use std::os::unix::{fs::PermissionsExt, fs::symlink};
    let temp = workspace();
    fs::create_dir(temp.path().join("folder")).unwrap();
    fs::write(temp.path().join("folder/note.md"), "keep").unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    fs::set_permissions(
        temp.path().join("folder/note.md"),
        fs::Permissions::from_mode(0o400),
    )
    .unwrap();
    assert!(store.delete_entry("folder").is_err());
    assert!(store.move_entry("folder", "moved").is_err());
    symlink("note.md", temp.path().join("folder/link")).unwrap();
    assert!(store.copy_entry("folder", "copied").is_err());
    assert!(temp.path().join("folder/note.md").exists());
}
