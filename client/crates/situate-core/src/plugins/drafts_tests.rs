use super::*;
use std::fs;

const ID: &str = "ae33fbf1-b47d-4f92-a249-a6f020bc4e4f";
const OTHER: &str = "be33fbf1-b47d-4f92-a249-a6f020bc4e4f";

fn snapshot(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut result = Vec::new();
    for entry in fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            result.push((path.clone(), Vec::new()));
            result.extend(snapshot(&path));
        } else {
            result.push((path.clone(), fs::read(&path).unwrap()));
        }
    }
    result.sort();
    result
}

fn location(root: &Path, id: &str) -> PathBuf {
    root.join(".situate/plugins/demo/drafts").join(id)
}

fn active(root: &Path) -> PathBuf {
    let code = root.join(".situate/plugins/demo/code");
    fs::create_dir_all(code.join("nested")).unwrap();
    fs::write(code.join("plugin.json"), r#"{"schemaVersion":2,"id":"demo","name":"Demo","description":"Synthetic plugin","skills":["nested/SKILL.md"]}"#).unwrap();
    fs::write(code.join("nested/SKILL.md"), "# Skill\n").unwrap();
    fs::write(code.join("image.bin"), [0, 255, 128, 1]).unwrap();
    code
}

#[test]
fn inspection_preserves_history_and_never_recopies_or_repairs() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let source = active(root);
    create(root, ID, "demo").unwrap();
    fs::remove_dir_all(source).unwrap();
    fs::write(
        location(root, ID).join("code/nested/SKILL.md"),
        "Unrecorded edit",
    )
    .unwrap();
    let before = snapshot(root);
    assert_eq!(inspect(root, ID).unwrap().plugin_id, "demo");
    assert_eq!(snapshot(root), before);
    let history = location(root, ID).join(".situate/history.git");
    fs::write(history.join("HEAD"), "corrupt").unwrap();
    let corrupt = snapshot(root);
    assert!(inspect(root, ID).is_err());
    assert_eq!(snapshot(root), corrupt);
    fs::remove_dir_all(&history).unwrap();
    let missing = snapshot(root);
    assert!(inspect(root, ID).is_err());
    assert_eq!(snapshot(root), missing);
}

#[test]
fn copies_only_code_and_keeps_active_installation_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let code = active(root);
    for technical in [".git", ".situate", ".situate-write-abandoned"] {
        fs::create_dir(code.join(technical)).unwrap();
        fs::write(code.join(technical).join("private"), "excluded").unwrap();
    }
    fs::create_dir_all(code.parent().unwrap().join("config")).unwrap();
    fs::write(code.parent().unwrap().join("config/private"), "excluded").unwrap();
    fs::write(root.join("note.md"), "unrelated").unwrap();
    let before = snapshot(&root.join(".situate/plugins/demo/code"));
    let config_before = snapshot(&root.join(".situate/plugins/demo/config"));
    let info = create(root, ID, "demo").unwrap();
    assert_eq!(
        serde_json::to_value(info).unwrap(),
        serde_json::json!({"version":1,"id":ID,"pluginId":"demo"})
    );
    assert_eq!(
        files(root, ID)
            .unwrap()
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        vec!["image.bin", "nested", "nested/SKILL.md", "plugin.json"]
    );
    assert_eq!(
        fs::read(location(root, ID).join("code/image.bin")).unwrap(),
        [0, 255, 128, 1]
    );
    assert!(!location(root, ID).join("note.md").exists());
    let source = read(root, ID, "nested/SKILL.md").unwrap();
    assert!(matches!(
        write(
            root,
            ID,
            "nested/SKILL.md",
            "# Changed\n",
            Some(&source.revision)
        )
        .unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert_eq!(snapshot(&root.join(".situate/plugins/demo/code")), before);
    assert_eq!(
        snapshot(&root.join(".situate/plugins/demo/config")),
        config_before
    );
    assert_eq!(validate(root, ID).unwrap().id, "demo");
}

#[test]
fn empty_drafts_are_distinct_never_reused_and_retain_versioned_history() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    create(root, ID, "demo").unwrap();
    create(root, OTHER, "demo").unwrap();
    assert!(files(root, ID).unwrap().is_empty());
    assert!(create(root, ID, "demo").is_err());
    assert!(matches!(
        mkdir(root, ID, "skills").unwrap(),
        OperationOutcome::Complete { .. }
    ));
    write(root, ID, "skills/a.md", "one", None).unwrap();
    let before = read(root, ID, "skills/a.md").unwrap();
    write(root, ID, "skills/a.md", "two", Some(&before.revision)).unwrap();
    assert!(files(root, OTHER).unwrap().is_empty());
    assert_eq!(list(root).unwrap().len(), 2);
    let store = ContentStore::open(&location(root, ID)).unwrap();
    let history = store.file_history("code/skills/a.md").unwrap();
    let versions: Vec<_> = history
        .iter()
        .filter_map(|entry| {
            store
                .read_revision("code/skills/a.md", &entry.revision)
                .ok()
        })
        .collect();
    assert!(versions.contains(&b"one".to_vec()));
    assert!(versions.contains(&b"two".to_vec()));
    assert_eq!(store.read_text("code/skills/a.md").unwrap().text, "two");
}

#[test]
fn stale_create_and_missing_parent_writes_do_not_clobber_or_create_directories() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    create(root, ID, "demo").unwrap();
    write(root, ID, "a.js", "one", None).unwrap();
    let before = read(root, ID, "a.js").unwrap();
    write(root, ID, "a.js", "two", Some(&before.revision)).unwrap();
    assert!(write(root, ID, "a.js", "lost", Some(&before.revision)).is_err());
    assert!(write(root, ID, "a.js", "lost", None).is_err());
    assert!(write(root, ID, "missing/a.js", "lost", None).is_err());
    assert!(mkdir(root, ID, "missing/nested").is_err());
    assert!(!location(root, ID).join("code/missing").exists());
    assert_eq!(read(root, ID, "a.js").unwrap().text, "two");
}

#[test]
fn inspections_do_not_write_or_initialize_history() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    assert!(list(root).unwrap().is_empty());
    assert!(fs::read_dir(root).unwrap().next().is_none());
    active(root);
    create(root, ID, "demo").unwrap();
    let before = snapshot(root);
    list(root).unwrap();
    files(root, ID).unwrap();
    read(root, ID, "nested/SKILL.md").unwrap();
    validate(root, ID).unwrap();
    assert_eq!(snapshot(root), before);
    fs::remove_dir_all(location(root, ID).join(".situate/history.git")).unwrap();
    let before = snapshot(root);
    assert!(read(root, ID, "nested/SKILL.md").is_err());
    assert!(list(root).unwrap()[0].error.is_some());
    assert!(write(root, ID, "a.js", "new", None).is_err());
    assert_eq!(snapshot(root), before);
}

#[test]
fn corrupt_metadata_and_history_are_not_repaired() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    create(root, ID, "demo").unwrap();
    let metadata = location(root, ID).join(".situate/plugin-draft.json");
    let valid = fs::read(&metadata).unwrap();
    for bytes in [
        b"{".to_vec(),
        br#"{"version":2,"id":"x","pluginId":"demo"}"#.to_vec(),
        br#"{"version":1,"id":"ae33fbf1-b47d-4f92-a249-a6f020bc4e4f","pluginId":"demo","extra":1}"#
            .to_vec(),
    ] {
        fs::write(&metadata, &bytes).unwrap();
        assert!(list(root).unwrap()[0].error.is_some());
        assert!(write(root, ID, "a.js", "new", None).is_err());
        assert_eq!(fs::read(&metadata).unwrap(), bytes);
    }
    fs::write(&metadata, valid).unwrap();
    let head = location(root, ID).join(".situate/history.git/HEAD");
    fs::write(&head, "corrupt").unwrap();
    assert!(write(root, ID, "a.js", "new", None).is_err());
    assert_eq!(fs::read_to_string(head).unwrap(), "corrupt");
    assert!(!location(root, ID).join("code/a.js").exists());
}

#[test]
fn failed_copy_remains_attributable_but_not_ready_or_reusable() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let code = active(root);
    fs::write(code.join("too-large.bin"), vec![0; MAX_TEXT as usize + 1]).unwrap();
    assert!(create(root, ID, "demo").is_err());
    let failed = list(root).unwrap().remove(0);
    assert_eq!(failed.id, ID);
    assert!(failed.info.is_none());
    assert!(failed.error.is_some());
    assert!(write(root, ID, "a.js", "lost", None).is_err());
    fs::remove_file(code.join("too-large.bin")).unwrap();
    assert!(create(root, ID, "demo").is_err());
    assert!(location(root, ID).exists());
}

#[test]
fn rejects_unsafe_ids_paths_and_oversized_text() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    for id in [
        "../escape",
        "not-uuid",
        "AE33FBF1-B47D-4F92-A249-A6F020BC4E4F",
    ] {
        assert!(create(root, id, "demo").is_err());
    }
    assert!(create(root, ID, "../demo").is_err());
    create(root, ID, "demo").unwrap();
    for path in [
        "../escape",
        "/tmp/file",
        "a//b",
        ".git/HEAD",
        ".situate/private",
        "nested/.situate-write-part",
        "CON",
        "a\\b",
    ] {
        assert!(write(root, ID, path, "lost", None).is_err(), "{path}");
        assert!(mkdir(root, ID, path).is_err(), "{path}");
        assert!(read(root, ID, path).is_err(), "{path}");
    }
    assert!(write(root, ID, "big.js", &"x".repeat(MAX_TEXT as usize + 1), None).is_err());
    assert!(files(root, ID).unwrap().is_empty());
}

#[test]
fn pending_recovery_text_blocks_writes_without_losing_either_version() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    create(root, ID, "demo").unwrap();
    write(root, ID, "a.js", "original", None).unwrap();
    let before = read(root, ID, "a.js").unwrap();
    let mut store = ContentStore::open(&location(root, ID)).unwrap();
    store
        .stage_draft(&content::Draft {
            path: "code/a.js".into(),
            base: Some(before.clone()),
            text: "retained".into(),
        })
        .unwrap();
    drop(store);
    assert!(matches!(
        write(root, ID, "a.js", "replacement", Some(&before.revision)),
        Err(DraftError::Content(ContentError::Busy))
    ));
    assert_eq!(read(root, ID, "a.js").unwrap().text, "original");
    let store = ContentStore::open(&location(root, ID)).unwrap();
    assert_eq!(store.drafts().unwrap()[0].text, "retained");
}

#[test]
fn history_boundary_failure_retains_original_and_recovery_text() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    create(root, ID, "demo").unwrap();
    write(root, ID, "a.js", "original", None).unwrap();
    let before = read(root, ID, "a.js").unwrap();
    let history = location(root, ID).join(".situate/history.git");
    let repo = git2::Repository::open_bare(&history).unwrap();
    let reference = repo.head().unwrap().name().unwrap().to_owned();
    drop(repo);
    let lock = history.join(format!("{reference}.lock"));
    fs::create_dir_all(lock.parent().unwrap()).unwrap();
    fs::write(&lock, "locked").unwrap();
    assert!(matches!(
        write(root, ID, "a.js", "replacement", Some(&before.revision)),
        Err(DraftError::Content(ContentError::History(_)))
    ));
    assert_eq!(read(root, ID, "a.js").unwrap().text, "original");
    assert_eq!(
        content::read_recovery_drafts(&location(root, ID)).unwrap()[0].text,
        "replacement"
    );
}

#[test]
fn entry_and_depth_limits_reject_copy_without_publishing_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let code = root.join(".situate/plugins/demo/code");
    fs::create_dir_all(&code).unwrap();
    for index in 0..=MAX_FILES {
        fs::write(code.join(format!("file-{index}")), "").unwrap();
    }
    assert!(matches!(
        create(root, ID, "demo"),
        Err(DraftError::Plugin(PluginError::TooLarge))
    ));
    fs::remove_dir_all(&code).unwrap();
    fs::create_dir_all(code.join(vec!["deep"; MAX_DEPTH + 1].join("/"))).unwrap();
    assert!(matches!(
        create(root, OTHER, "demo"),
        Err(DraftError::Plugin(PluginError::TooLarge))
    ));
    assert!(list(root).unwrap().iter().all(|draft| draft.info.is_none()));
}

#[test]
fn missing_active_code_retains_failed_draft_instead_of_creating_empty_code() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join(".situate/plugins/demo")).unwrap();
    assert!(create(root, ID, "demo").is_err());
    let drafts = list(root).unwrap();
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].id, ID);
    assert!(drafts[0].info.is_none());
    assert!(drafts[0].error.is_some());
    assert!(create(root, ID, "demo").is_err());
    assert!(write(root, ID, "a.js", "new", None).is_err());
    assert!(!location(root, ID).join(".situate/history.git").exists());
    create(root, OTHER, "absent").unwrap();
    assert!(files(root, OTHER).unwrap().is_empty());
}

#[test]
fn mkdir_rejects_external_oversized_code_without_changing_files_or_history() {
    for aggregate in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        create(root, ID, "demo").unwrap();
        let code = location(root, ID).join("code");
        let (count, size) = if aggregate {
            (65, MAX_TEXT)
        } else {
            (1, MAX_TEXT + 1)
        };
        for index in 0..count {
            fs::File::create(code.join(format!("asset-{index}.bin")))
                .unwrap()
                .set_len(size)
                .unwrap();
        }
        let before = snapshot(root);
        assert!(matches!(
            mkdir(root, ID, "nested"),
            Err(DraftError::Plugin(PluginError::TooLarge))
        ));
        assert_eq!(snapshot(root), before);
        assert!(!code.join("nested").exists());
    }
}

#[test]
fn aggregate_copy_limit_is_enforced() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let code = root.join(".situate/plugins/demo/code");
    fs::create_dir_all(&code).unwrap();
    for index in 0..65 {
        fs::File::create(code.join(format!("asset-{index}.bin")))
            .unwrap()
            .set_len(MAX_TEXT)
            .unwrap();
    }
    assert!(matches!(
        create(root, ID, "demo"),
        Err(DraftError::Plugin(PluginError::TooLarge))
    ));
    assert!(list(root).unwrap()[0].info.is_none());
}

#[cfg(unix)]
#[test]
fn symlinks_cannot_escape_source_or_draft_boundaries() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("private"), "untouched").unwrap();
    let code = active(root);
    symlink(outside.path(), code.join("escape")).unwrap();
    assert!(create(root, ID, "demo").is_err());
    fs::remove_file(code.join("escape")).unwrap();
    create(root, OTHER, "demo").unwrap();
    let draft_code = location(root, OTHER).join("code");
    symlink(outside.path(), draft_code.join("escape")).unwrap();
    assert!(write(root, OTHER, "escape/private", "lost", None).is_err());
    assert!(read(root, OTHER, "escape/private").is_err());
    assert!(mkdir(root, OTHER, "escape/nested").is_err());
    fs::remove_file(draft_code.join("escape")).unwrap();
    fs::rename(&draft_code, draft_code.with_file_name("old-code")).unwrap();
    symlink(outside.path(), &draft_code).unwrap();
    assert!(write(root, OTHER, "private", "lost", None).is_err());
    assert_eq!(
        fs::read_to_string(outside.path().join("private")).unwrap(),
        "untouched"
    );
}
