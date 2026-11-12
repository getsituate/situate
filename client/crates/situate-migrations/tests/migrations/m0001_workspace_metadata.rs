use situate_migrations::MigrationErrorKind;
use std::{collections::BTreeMap, fs, path::Path};
fn files(path: &Path) -> BTreeMap<String, Vec<u8>> {
    fs::read_dir(path)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            (
                entry.file_name().into_string().unwrap(),
                fs::read(entry.path()).unwrap(),
            )
        })
        .collect()
}

#[test]
fn public_release_inputs_remain_unchanged_when_app_cannot_run_the_pending_chain() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/m0001/releases");
    for version in ["0.0.1", "0.1.0", "0.1.1", "0.1.2", "0.1.3", "0.1.5"] {
        let root = tempfile::tempdir().unwrap();
        let managed = root.path().join(".situate");
        fs::create_dir(&managed).unwrap();
        let expected: BTreeMap<_, _> = files(&fixtures.join(version))
            .into_iter()
            .map(|(name, bytes)| (name.strip_suffix(".fixture").unwrap().to_owned(), bytes))
            .collect();
        for (name, bytes) in &expected {
            fs::write(managed.join(name), bytes).unwrap();
        }
        let error = situate_migrations::prepare(root.path(), "0.1.3").unwrap_err();
        assert_eq!(error.kind(), MigrationErrorKind::UpdateRequired);
        assert_eq!(error.required_app_version(), Some("0.1.6"));
        for (name, bytes) in &expected {
            assert_eq!(
                &fs::read(managed.join(name)).unwrap(),
                bytes,
                "release {version}, file {name}"
            );
        }
        assert!(!managed.join("migrations.json").exists());
    }
}

#[test]
fn bootstrap_and_conversion_preserve_opaque_managed_bytes_and_user_files() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/m0001");
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    fs::write(root.path().join("user.md"), "User-owned content").unwrap();
    for (name, bytes) in files(&fixtures.join("before")) {
        fs::write(managed.join(name), bytes).unwrap();
    }
    let lease = situate_migrations::prepare(root.path(), "0.1.6").unwrap();
    let after = files(&fixtures.join("after"));
    assert_eq!(
        fs::read(managed.join("opaque.json")).unwrap(),
        after["opaque.json"]
    );
    assert_eq!(
        fs::read(managed.join("workspace.json")).unwrap(),
        after["workspace.json"]
    );
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(managed.join("migrations.json")).unwrap()).unwrap();
    assert_eq!(
        metadata,
        serde_json::json!({"minimumAppVersion":"0.1.6","lastAppliedMigration":2})
    );
    let conversation: serde_json::Value = serde_json::from_slice(
        &fs::read(managed.join("conversations/fixture/metadata.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(conversation["legacyDraft"]["text"], "Retained draft");
    assert_eq!(
        fs::read_to_string(root.path().join("user.md")).unwrap(),
        "User-owned content"
    );
    assert_eq!(
        fs::read_dir(managed.join(".migrations")).unwrap().count(),
        1
    );
    drop(lease);
    assert!(situate_migrations::prepare(root.path(), "0.1.6").is_ok());
}
