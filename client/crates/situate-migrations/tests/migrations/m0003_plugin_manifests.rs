use serde_json::Value;
use std::fs;

#[test]
fn published_manifest_is_rewritten_once_and_keeps_its_exports() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    let source = managed.join("plugins/archive/code");
    fs::create_dir_all(&source).unwrap();
    fs::write(
        managed.join("migrations.json"),
        br#"{"minimumAppVersion":"0.1.6","lastAppliedMigration":2}"#,
    )
    .unwrap();
    let manifest = source.join("plugin.json");
    fs::write(
        &manifest,
        include_bytes!("../fixtures/m0003/before/plugin.json.fixture"),
    )
    .unwrap();
    drop(situate_migrations::prepare(root.path()).unwrap());
    let bytes = fs::read(&manifest).unwrap();
    let expected: Value = serde_json::from_slice(include_bytes!(
        "../fixtures/m0003/after/plugin.json.fixture"
    ))
    .unwrap();
    assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), expected);
    drop(situate_migrations::prepare(root.path()).unwrap());
    assert_eq!(fs::read(&manifest).unwrap(), bytes);
}
