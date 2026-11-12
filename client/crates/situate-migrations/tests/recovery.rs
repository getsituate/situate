use situate_migrations::prepare;
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
    let lease = prepare(root.path(), "0.1.6").unwrap();
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
    let lease = prepare(root.path(), "0.1.6").unwrap();
    assert_eq!(fs::read(managed.join("committed")).unwrap(), b"new");
    assert!(!managed.join(".migrations/retired.tar").exists());
    drop(lease);
}

#[test]
fn corrupt_recovery_archive_never_overwrites_live_data() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir_all(managed.join(".migrations")).unwrap();
    fs::write(managed.join("original"), "retain").unwrap();
    fs::write(managed.join(".migrations/backup.tar"), "corrupt archive").unwrap();
    assert!(prepare(root.path(), "0.1.6").is_err());
    assert_eq!(fs::read(managed.join("original")).unwrap(), b"retain");
    assert_eq!(
        fs::read(managed.join(".migrations/backup.tar")).unwrap(),
        b"corrupt archive"
    );
}
