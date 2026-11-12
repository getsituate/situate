use super::*;
use std::fs;

#[test]
fn working_method_is_versioned_inside_metadata_without_changing_user_files() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    fs::create_dir(root.path().join("Situate")).unwrap();
    fs::create_dir_all(root.path().join(".pi/skills/example")).unwrap();
    let user_files = [
        ("AGENTS.md", "User-owned instructions"),
        ("Situate/working-method.md", "User-owned method"),
        (".pi/skills/example/SKILL.md", "User-owned skill"),
        ("note.md", "User-owned note"),
    ];
    for (path, text) in user_files {
        fs::write(root.path().join(path), text).unwrap();
    }
    fs::write(root.path().join(".situate/layout.json"), "private state").unwrap();
    assert_eq!(read_working_method(root.path()).unwrap(), None);
    let mut store = ContentStore::open(root.path()).unwrap();
    let created = store
        .create_text(".situate/working-method.md", "Review each Friday.")
        .unwrap();
    let SaveOutcome::Saved {
        version,
        history_revision,
    } = created
    else {
        panic!("working method was not published with history");
    };
    assert_eq!(
        read_working_method(root.path()).unwrap(),
        Some(version.clone())
    );
    assert_eq!(
        store
            .read_revision(".situate/working-method.md", &history_revision)
            .unwrap(),
        b"Review each Friday."
    );
    assert!(
        store
            .read_revision(".situate/layout.json", &history_revision)
            .is_err()
    );
    let internal: Vec<_> = store
        .list()
        .unwrap()
        .into_iter()
        .filter(|entry| entry.path.starts_with(".situate/"))
        .map(|entry| entry.path)
        .collect();
    assert_eq!(internal, [".situate/working-method.md"]);
    let updated = store
        .agent_write(
            ".situate/working-method.md",
            Some(&version.revision),
            "Review each Monday.",
        )
        .unwrap();
    assert!(matches!(updated, SaveOutcome::Saved { .. }));
    assert!(
        store
            .agent_write(
                ".situate/working-method.md",
                Some(&version.revision),
                "Stale rules"
            )
            .is_err()
    );
    assert!(store.drafts().unwrap().is_empty());
    drop(store);
    let reopened = ContentStore::open(root.path()).unwrap();
    assert_eq!(
        reopened
            .read_text(".situate/working-method.md")
            .unwrap()
            .text,
        "Review each Monday."
    );
    assert_eq!(
        reopened
            .file_history(".situate/working-method.md")
            .unwrap()
            .len(),
        2
    );
    for (path, text) in user_files {
        assert_eq!(fs::read_to_string(root.path().join(path)).unwrap(), text);
    }
    let mut names: Vec<_> = fs::read_dir(root.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    assert_eq!(
        names,
        [".pi", ".situate", "AGENTS.md", "Situate", "note.md"]
    );
}

#[test]
fn working_method_references_survive_edits_and_reopening() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let original = format!("{}Review Friday.", crate::metadata::new_document());
    store
        .create_text(".situate/working-method.md", &original)
        .unwrap();
    let reference = store
        .capture_reference("test", ".situate/working-method.md", None)
        .unwrap();
    let base = store.read_text(".situate/working-method.md").unwrap();
    let updated = original.replace("Friday", "Monday");
    store
        .save(".situate/working-method.md", &base, &updated)
        .unwrap();
    assert!(store.deleted_files().unwrap().is_empty());
    drop(store);
    let reopened = ContentStore::open(root.path()).unwrap();
    let (_, path, version) = reopened.resolve_reference(&reference).unwrap().unwrap();
    assert_eq!(path, ".situate/working-method.md");
    assert_eq!(version.text, updated);
}

#[test]
fn working_method_does_not_open_other_metadata_paths() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    assert!(store.create_folder(".situate/working-method.md").is_err());
    assert!(store.move_entry(".situate", "moved").is_err());
    assert!(store.copy_entry(".situate", "copied").is_err());
    assert!(store.delete_entry(".situate").is_err());
    assert!(root.path().join(".situate/history.git").is_dir());
    for path in [
        ".situate",
        ".situate/layout.json",
        ".situate/history.git/config",
        ".situate/../outside.md",
        "nested/.situate/working-method.md",
        ".situate/working-method.md/other",
        ".SITUATE/working-method.md",
    ] {
        assert!(store.create_text(path, "rules").is_err(), "{path}");
        assert!(store.read_text(path).is_err(), "{path}");
    }
    assert!(validate_portable_path(".situate/working-method.md").is_err());
    assert!(validate_provider_path(".situate/working-method.md").is_err());
}

#[cfg(unix)]
#[test]
fn working_method_rejects_symlinked_files_and_metadata_directories() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("working-method.md"), "outside").unwrap();
    symlink(outside.path(), root.path().join(".situate")).unwrap();
    assert!(read_working_method(root.path()).is_err());
    fs::remove_file(root.path().join(".situate")).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    symlink(
        outside.path().join("working-method.md"),
        root.path().join(".situate/working-method.md"),
    )
    .unwrap();
    assert!(read_working_method(root.path()).is_err());
    assert!(
        ContentStore::open(root.path())
            .unwrap()
            .create_text(".situate/working-method.md", "replacement")
            .is_err()
    );
    assert_eq!(
        fs::read_to_string(outside.path().join("working-method.md")).unwrap(),
        "outside"
    );
}
