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
fn refuses_unknown_legacy_floor_before_any_write() {
    let root = workspace(Some(
        r#"{"minimumAppVersion":"2026.11.28","lastAppliedMigration":3}"#,
    ));
    let error = prepare(root.path()).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::UpdateRequired);
    assert_eq!(error.required_app_version(), Some("2026.11.28"));
    assert!(!root.path().join(".situate/.migrations").exists());
}
#[test]
fn opens_published_migration_three_metadata_without_release_build_inputs() {
    let bytes =
        r#"{"minimumAppVersion":"2026.11.27","lastAppliedMigration":3,"future":{"opaque":true}}"#;
    let root = workspace(Some(bytes));
    for _ in 0..2 {
        drop(prepare(root.path()).unwrap());
        assert_eq!(
            fs::read(root.path().join(".situate/migrations.json")).unwrap(),
            bytes.as_bytes()
        );
    }
}

#[test]
fn later_position_and_unknown_fields_are_preserved_byte_for_byte() {
    let bytes = r#"{"minimumAppVersion":"2026.11.27","minimumReaderEpoch":3,"lastAppliedMigration":43,"future":{"opaque":true}}"#;
    let root = workspace(Some(bytes));
    let first = prepare(root.path()).unwrap();
    let second = prepare(root.path()).unwrap();
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
            prepare(root.path()).unwrap_err().kind(),
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
        prepare(root.path()).unwrap_err().kind(),
        MigrationErrorKind::InvalidMetadata
    );
    assert!(!root.path().join(".situate/.migrations").exists());
    assert_eq!(
        fs::read_to_string(root.path().join(".situate/migrations.json")).unwrap(),
        bytes
    );
}
#[test]
fn unknown_reader_epoch_refuses_opening_without_writing() {
    let bytes =
        r#"{"minimumAppVersion":"2026.12.1","lastAppliedMigration":4,"minimumReaderEpoch":4}"#;
    let root = workspace(Some(bytes));
    assert_eq!(
        prepare(root.path()).unwrap_err().kind(),
        MigrationErrorKind::ReaderUpdateRequired
    );
    assert!(!root.path().join(".situate/.migrations").exists());
    assert_eq!(
        fs::read_to_string(root.path().join(".situate/migrations.json")).unwrap(),
        bytes
    );
}

#[test]
fn explicit_reader_metadata_cannot_lower_the_guard_for_legacy_clients() {
    for bytes in [
        r#"{"minimumAppVersion":"0.1.6","lastAppliedMigration":3,"minimumReaderEpoch":3}"#,
        r#"{"minimumAppVersion":"0.1.6","lastAppliedMigration":3,"minimumReaderEpoch":2}"#,
        r#"{"minimumAppVersion":"2026.11.27","lastAppliedMigration":2,"minimumReaderEpoch":3}"#,
        r#"{"minimumAppVersion":"2026.11.27","lastAppliedMigration":3,"minimumReaderEpoch":null}"#,
    ] {
        let root = workspace(Some(bytes));
        assert_eq!(
            prepare(root.path()).unwrap_err().kind(),
            MigrationErrorKind::InvalidMetadata
        );
        assert!(!root.path().join(".situate/.migrations").exists());
    }
}
#[test]
fn retained_lease_prevents_or_rejects_marker_replacement() {
    let root = workspace(Some(
        r#"{"minimumAppVersion":"2026.11.27","lastAppliedMigration":3}"#,
    ));
    let lease = prepare(root.path()).unwrap();
    lease.validate().unwrap();
    let moved = root.path().join(".situate-original");
    let rename = fs::rename(root.path().join(".situate"), &moved);
    if cfg!(windows) {
        assert!(matches!(rename.unwrap_err().raw_os_error(), Some(5 | 32)));
        assert!(!moved.exists());
        lease.validate().unwrap();
        return;
    }
    rename.unwrap();
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
#[cfg(unix)]
#[test]
fn refuses_marker_and_metadata_symlinks_without_touching_the_target() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    symlink(outside.path(), root.path().join(".situate")).unwrap();
    assert!(prepare(root.path()).is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    fs::remove_file(root.path().join(".situate")).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    fs::write(outside.path().join("metadata"), "untouched").unwrap();
    symlink(
        outside.path().join("metadata"),
        root.path().join(".situate/migrations.json"),
    )
    .unwrap();
    assert!(prepare(root.path()).is_err());
    assert_eq!(
        fs::read_to_string(outside.path().join("metadata")).unwrap(),
        "untouched"
    );
}
