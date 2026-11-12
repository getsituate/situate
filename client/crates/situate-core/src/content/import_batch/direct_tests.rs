use super::tests::workspace;
use super::*;
use std::fs;

fn source_entry(path: &str, source: &Path) -> PreparedFile {
    PreparedFile::Source {
        path: path.into(),
        source_path: source.to_str().unwrap().into(),
    }
}

fn text_entry(path: &str, text: &str) -> PreparedFile {
    PreparedFile::Text {
        path: path.into(),
        text: text.into(),
    }
}

#[test]
fn direct_import_preserves_sources_metadata_links_and_history_without_staging() {
    let (temp, mut store) = workspace();
    let sources = tempfile::tempdir().unwrap();
    let source_root = sources.path().canonicalize().unwrap();
    fs::create_dir(temp.path().join("Notes/assets")).unwrap();
    let note = "---\ncustom:\n  nested: [one, two]\n---\n![Photo](assets/photo.png)\n[Paper](assets/paper.pdf)\n- [ ] Task <!-- situate-task-id: null -->\n- [-] Cancelled\n";
    let png = b"\x89PNG\r\n\x1a\n\0\xffimage";
    let pdf = b"%PDF-1.7\n\0\xffdocument";
    for (name, bytes) in [
        ("note.md", note.as_bytes()),
        ("photo.png", png),
        ("paper.pdf", pdf),
    ] {
        fs::write(source_root.join(name), bytes).unwrap();
    }
    let before: std::collections::BTreeSet<_> = fs::read_dir(temp.path().join(".situate"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    let result = store
        .create_batch_entries(
            vec![
                source_entry("Notes/note.md", &source_root.join("note.md")),
                source_entry("Notes/assets/photo.png", &source_root.join("photo.png")),
                source_entry("Notes/assets/paper.pdf", &source_root.join("paper.pdf")),
                text_entry("Notes/inline.md", "# Converted text\n"),
            ],
            true,
            || Ok(()),
        )
        .unwrap();
    let OperationOutcome::Complete { history_revision } = result.outcome else {
        panic!("direct import did not complete");
    };
    assert_eq!(result.files.len(), 4);
    let imported = store.read_text("Notes/note.md").unwrap().text;
    let tasks = crate::metadata::inspect(&imported).tasks;
    assert_eq!(tasks.len(), 1);
    uuid::Uuid::parse_str(&tasks[0].id).unwrap();
    assert_eq!(
        imported.replace(&format!("\"{}\"", tasks[0].id), "null"),
        note
    );
    for (name, bytes) in [
        ("note.md", note.as_bytes()),
        ("photo.png", png),
        ("paper.pdf", pdf),
    ] {
        assert_eq!(fs::read(source_root.join(name)).unwrap(), bytes);
    }
    for (name, bytes) in [("photo.png", png.as_slice()), ("paper.pdf", pdf.as_slice())] {
        assert_eq!(
            fs::read(temp.path().join("Notes/assets").join(name)).unwrap(),
            bytes
        );
        assert_eq!(
            store
                .read_revision(&format!("Notes/assets/{name}"), &history_revision)
                .unwrap(),
            bytes
        );
    }
    let after = fs::read_dir(temp.path().join(".situate"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(before, after);
    assert_eq!(fs::read_dir(temp.path().join("Notes")).unwrap().count(), 3);
    drop(store);
    let reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(
        reopened
            .read_revision("Notes/assets/photo.png", &history_revision)
            .unwrap(),
        png
    );
}

#[test]
fn direct_import_rejects_unreadable_unsafe_and_nonregular_sources_before_publication() {
    let (temp, mut store) = workspace();
    let sources = tempfile::tempdir().unwrap();
    let root = sources.path().canonicalize().unwrap();
    fs::write(root.join("source.bin"), b"original").unwrap();
    for source in [
        "relative/source.bin".to_string(),
        root.join("missing.bin").to_str().unwrap().to_string(),
        root.to_str().unwrap().to_string(),
        format!("{}/../source.bin", root.display()),
        format!("{}/./source.bin", root.display()),
    ] {
        assert!(
            store
                .create_batch_entries(
                    vec![
                        text_entry("Notes/a.md", "# A"),
                        PreparedFile::Source {
                            path: "Notes/file.bin".into(),
                            source_path: source
                        },
                    ],
                    false,
                    || Ok(())
                )
                .is_err()
        );
        assert_eq!(fs::read_dir(temp.path().join("Notes")).unwrap().count(), 0);
    }
    fs::write(temp.path().join("Notes/existing.bin"), b"keep").unwrap();
    assert!(
        store
            .create_batch_entries(
                vec![source_entry("Notes/existing.bin", &root.join("source.bin"))],
                false,
                || Ok(())
            )
            .is_err()
    );
    assert_eq!(
        fs::read(temp.path().join("Notes/existing.bin")).unwrap(),
        b"keep"
    );
}

#[cfg(unix)]
#[test]
fn direct_import_rejects_symlinks_in_files_and_ancestors() {
    let (temp, mut store) = workspace();
    let sources = tempfile::tempdir().unwrap();
    let root = sources.path().canonicalize().unwrap();
    fs::create_dir(root.join("real")).unwrap();
    fs::write(root.join("real/file.bin"), b"original").unwrap();
    std::os::unix::fs::symlink(root.join("real/file.bin"), root.join("link.bin")).unwrap();
    std::os::unix::fs::symlink(root.join("real"), root.join("link-dir")).unwrap();
    for path in ["link.bin", "link-dir/file.bin"] {
        assert!(
            store
                .create_batch_entries(
                    vec![source_entry("Notes/file.bin", &root.join(path))],
                    false,
                    || Ok(())
                )
                .is_err()
        );
    }
    assert_eq!(fs::read_dir(temp.path().join("Notes")).unwrap().count(), 0);
}

#[test]
fn direct_import_enforces_file_count_inline_and_source_byte_limits() {
    let (temp, mut store) = workspace();
    for entries in [
        vec![],
        (0..257)
            .map(|i| text_entry(&format!("Notes/{i}.md"), "text"))
            .collect(),
        vec![text_entry(
            "Notes/large.md",
            &"x".repeat(MAX_FILE_BYTES + 1),
        )],
    ] {
        assert!(
            store
                .create_batch_entries(entries, false, || Ok(()))
                .is_err()
        );
    }
    let sources = tempfile::tempdir().unwrap();
    let source = sources.path().canonicalize().unwrap().join("large.bin");
    let file = fs::File::create(&source).unwrap();
    file.set_len(MAX_OPERATION_BYTES + 1).unwrap();
    assert!(
        store
            .create_batch_entries(
                vec![source_entry("Notes/large.bin", &source)],
                false,
                || Ok(())
            )
            .is_err()
    );
    assert_eq!(fs::read_dir(temp.path().join("Notes")).unwrap().count(), 0);
}

#[test]
fn direct_source_changes_and_replacements_are_rejected_before_publication() {
    for replace in [false, true] {
        let (temp, mut store) = workspace();
        let sources = tempfile::tempdir().unwrap();
        let source = sources.path().canonicalize().unwrap().join("file.bin");
        fs::write(&source, b"original").unwrap();
        let mut changed = false;
        let result = store.create_batch_entries(
            vec![source_entry("Notes/file.bin", &source)],
            false,
            || {
                if !changed
                    && fs::read_dir(temp.path().join("Notes"))
                        .unwrap()
                        .next()
                        .is_some()
                {
                    changed = true;
                    if replace {
                        fs::rename(&source, source.with_extension("old")).unwrap();
                        fs::write(&source, b"original").unwrap();
                    } else {
                        fs::write(&source, b"changed").unwrap();
                    }
                }
                Ok(())
            },
        );
        assert!(changed);
        assert!(result.is_err());
        assert!(!temp.path().join("Notes/file.bin").exists());
    }
}

#[test]
fn direct_import_partial_failure_retains_verified_files_without_replay_on_reopen() {
    for mutate_source in [false, true] {
        let (temp, mut store) = workspace();
        let sources = tempfile::tempdir().unwrap();
        let source = sources.path().canonicalize().unwrap().join("file.bin");
        fs::write(&source, b"\0\xfforiginal").unwrap();
        let result = store
            .create_batch_entries(
                vec![
                    source_entry("Notes/a.bin", &source),
                    source_entry("Notes/b.bin", &source),
                ],
                false,
                || {
                    if temp.path().join("Notes/a.bin").exists() {
                        if mutate_source {
                            fs::write(&source, b"changed").unwrap();
                        } else {
                            return Err(ContentError::History(
                                "native.ai.request.cancelled".into(),
                            ));
                        }
                    }
                    Ok(())
                },
            )
            .unwrap();
        assert!(matches!(
            result.outcome,
            OperationOutcome::PartialFailure { .. }
        ));
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "Notes/a.bin");
        drop(store);
        let reopened = ContentStore::open(temp.path()).unwrap();
        assert_eq!(
            fs::read(temp.path().join("Notes/a.bin")).unwrap(),
            b"\0\xfforiginal"
        );
        assert!(!temp.path().join("Notes/b.bin").exists());
        assert!(
            reopened
                .validated_history()
                .unwrap()
                .iter()
                .any(|entry| matches!(
                    entry.fact,
                    super::super::history_records::Fact::Interrupted
                ))
        );
    }
}
