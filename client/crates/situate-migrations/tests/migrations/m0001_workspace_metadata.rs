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
fn bootstrap_and_conversion_preserve_opaque_managed_bytes_and_user_files() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/m0001");
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    fs::write(root.path().join("user.md"), "User-owned content").unwrap();
    for (name, bytes) in files(&fixtures.join("before")) {
        fs::write(managed.join(name), bytes).unwrap();
    }
    let lease = situate_migrations::prepare(root.path()).unwrap();
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
        serde_json::json!({"minimumAppVersion":"2026.11.27","lastAppliedMigration":3,"minimumReaderEpoch":3})
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
    assert!(situate_migrations::prepare(root.path()).is_ok());
}
