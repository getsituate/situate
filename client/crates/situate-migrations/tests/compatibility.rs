use situate_migrations::{MigrationErrorKind, prepare};
use std::fs;
fn workspace(metadata: Option<&str>) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    if let Some(value) = metadata {
        fs::write(root.path().join(".situate/migrations.json"), value).unwrap();
    }
    root
}
#[test]
fn refuses_update_before_any_write() {
    let root = workspace(Some(
        r#"{"minimumAppVersion":"0.1.10","lastAppliedMigration":1}"#,
    ));
    let error = prepare(root.path(), "0.1.9").unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::UpdateRequired);
    assert_eq!(error.required_app_version(), Some("0.1.10"));
    assert!(!root.path().join(".situate/.migrations").exists());
    assert!(prepare(root.path(), "0.1.10").is_ok());
}
#[test]
fn later_position_and_unknown_fields_are_preserved_byte_for_byte() {
    let bytes =
        r#"{"minimumAppVersion":"0.1.0","lastAppliedMigration":43,"future":{"opaque":true}}"#;
    let root = workspace(Some(bytes));
    let first = prepare(root.path(), "0.1.3").unwrap();
    let second = prepare(root.path(), "0.1.3").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join(".situate/migrations.json")).unwrap(),
        bytes
    );
    drop((first, second));
}
#[test]
fn rejects_corruption_without_initializing_or_resetting() {
    for bytes in [
        "",
        "broken",
        "{}",
        r#"{"minimumAppVersion":"n/a","lastAppliedMigration":1}"#,
        r#"{"minimumAppVersion":"0.1.3","lastAppliedMigration":-1}"#,
    ] {
        let root = workspace(Some(bytes));
        assert_eq!(
            prepare(root.path(), "0.1.3").unwrap_err().kind(),
            MigrationErrorKind::InvalidMetadata
        );
        assert_eq!(
            fs::read_to_string(root.path().join(".situate/migrations.json")).unwrap(),
            bytes
        );
        assert!(!root.path().join(".situate/.migrations").exists());
    }
}
#[test]
fn duplicate_metadata_fields_are_not_interpreted_as_a_lower_minimum() {
    let bytes =
        r#"{"minimumAppVersion":"0.9.0","minimumAppVersion":"0.0.0","lastAppliedMigration":1}"#;
    let root = workspace(Some(bytes));
    assert_eq!(
        prepare(root.path(), "0.1.3").unwrap_err().kind(),
        MigrationErrorKind::InvalidMetadata
    );
    assert!(!root.path().join(".situate/.migrations").exists());
    assert_eq!(
        fs::read_to_string(root.path().join(".situate/migrations.json")).unwrap(),
        bytes
    );
}
#[test]
fn semantic_version_precedence_ignores_build_metadata() {
    let root = workspace(Some(
        r#"{"minimumAppVersion":"0.1.3+new","lastAppliedMigration":2}"#,
    ));
    assert!(prepare(root.path(), "0.1.3+old").is_ok());
    assert_eq!(
        prepare(root.path(), "0.1.3-alpha").unwrap_err().kind(),
        MigrationErrorKind::UpdateRequired
    );
}
#[test]
fn retained_lease_rejects_a_replacement_at_the_original_path() {
    let root = workspace(Some(
        r#"{"minimumAppVersion":"0.0.0","lastAppliedMigration":2}"#,
    ));
    let lease = prepare(root.path(), "0.1.3").unwrap();
    lease.validate().unwrap();
    fs::rename(
        root.path().join(".situate"),
        root.path().join(".situate-original"),
    )
    .unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    let replacement = br#"{"minimumAppVersion":"9999.0.0","lastAppliedMigration":1}"#;
    fs::write(root.path().join(".situate/migrations.json"), replacement).unwrap();
    assert_eq!(
        lease.validate().unwrap_err().kind(),
        MigrationErrorKind::UnsafePath
    );
    assert_eq!(
        fs::read(root.path().join(".situate/migrations.json")).unwrap(),
        replacement
    );
    assert!(
        root.path()
            .join(".situate-original/.migrations/workspace.lock")
            .exists()
    );
}
#[test]
fn invalid_app_version_does_not_touch_data() {
    let root = workspace(None);
    assert_eq!(
        prepare(root.path(), "not-semver").unwrap_err().kind(),
        MigrationErrorKind::InvalidAppVersion
    );
    assert_eq!(
        fs::read_dir(root.path().join(".situate")).unwrap().count(),
        0
    );
}
#[cfg(unix)]
#[test]
fn refuses_marker_and_metadata_symlinks_without_touching_the_target() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    symlink(outside.path(), root.path().join(".situate")).unwrap();
    assert!(prepare(root.path(), "0.1.3").is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    fs::remove_file(root.path().join(".situate")).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    fs::write(outside.path().join("metadata"), "untouched").unwrap();
    symlink(
        outside.path().join("metadata"),
        root.path().join(".situate/migrations.json"),
    )
    .unwrap();
    assert!(prepare(root.path(), "0.1.3").is_err());
    assert_eq!(
        fs::read_to_string(outside.path().join("metadata")).unwrap(),
        "untouched"
    );
}
