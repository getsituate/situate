use situate_migrations::{MigrationErrorKind, prepare};
use std::fs;

#[test]
fn incomplete_archive_is_not_restored_and_is_cleaned_before_opening() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir_all(managed.join(".migrations")).unwrap();
    fs::write(managed.join("original"), "retain").unwrap();
    fs::write(
        managed.join(".migrations/backup.tar.tmp"),
        "incomplete archive",
    )
    .unwrap();
    let lease = prepare(root.path()).unwrap();
    assert_eq!(fs::read(managed.join("original")).unwrap(), b"retain");
    assert!(!managed.join(".migrations/backup.tar.tmp").exists());
    drop(lease);
}

#[test]
fn retired_archive_is_deleted_without_replacing_committed_data() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir_all(managed.join(".migrations")).unwrap();
    fs::write(managed.join("committed"), "new").unwrap();
    fs::write(
        managed.join("migrations.json"),
        r#"{"minimumAppVersion":"0.0.0","lastAppliedMigration":1}"#,
    )
    .unwrap();
    fs::write(
        managed.join(".migrations/retired.tar"),
        "partly deleted archive",
    )
    .unwrap();
    let lease = prepare(root.path()).unwrap();
    assert_eq!(fs::read(managed.join("committed")).unwrap(), b"new");
    assert!(!managed.join(".migrations/retired.tar").exists());
    drop(lease);
}

#[test]
fn a_newer_reader_requirement_prevents_cleanup_of_a_retired_backup() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir_all(managed.join(".migrations")).unwrap();
    fs::write(managed.join(".migrations/workspace.lock"), b"").unwrap();
    let archive = managed.join(".migrations/retired.tar");
    fs::write(&archive, b"retired contents").unwrap();
    let path = managed.join("migrations.json");
    let metadata =
        br#"{"minimumAppVersion":"2026.12.1","lastAppliedMigration":4,"minimumReaderEpoch":4}"#;
    fs::write(&path, metadata).unwrap();

    let error = prepare(root.path()).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::ReaderUpdateRequired);
    assert_eq!(fs::read(archive).unwrap(), b"retired contents");
    assert_eq!(fs::read(path).unwrap(), metadata);
}

#[test]
fn corrupt_recovery_archive_never_overwrites_live_data() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir_all(managed.join(".migrations")).unwrap();
    fs::write(managed.join("original"), "retain").unwrap();
    fs::write(managed.join(".migrations/backup.tar"), "corrupt archive").unwrap();
    assert!(prepare(root.path()).is_err());
    assert_eq!(fs::read(managed.join("original")).unwrap(), b"retain");
    assert_eq!(
        fs::read(managed.join(".migrations/backup.tar")).unwrap(),
        b"corrupt archive"
    );
}
