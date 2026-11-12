use crate::{
    MigrationDescriptor, MigrationError, MigrationErrorKind, MigrationId, MigrationWorkspace,
    Result, backup, filesystem, metadata, registry, runner,
};
use cap_std::{ambient_authority, fs::Dir};
use std::{cell::RefCell, fs, path::Path, process::Command};

thread_local! {
    static FAILURE: RefCell<Option<(&'static str, usize)>> = const { RefCell::new(None) };
    static AFTER_COPY: RefCell<Option<Box<dyn FnOnce()>>> = const { RefCell::new(None) };
}
pub(crate) fn checkpoint(name: &str) -> Result<()> {
    if name == "backup-copied"
        && let Some(change) = AFTER_COPY.with_borrow_mut(Option::take)
    {
        change();
    }
    if let Ok(crash) = std::env::var("SITUATE_MIGRATION_TEST_CRASH")
        && crash == name
    {
        std::process::exit(73);
    }
    FAILURE.with_borrow_mut(|failure| {
        if let Some((target, remaining)) = failure
            && name == *target
        {
            *remaining -= 1;
            if *remaining == 0 {
                *failure = None;
                return Err(std::io::Error::from_raw_os_error(5).into());
            }
        }
        Ok(())
    })
}
fn fail(name: &'static str, count: usize) {
    FAILURE.with_borrow_mut(|v| *v = Some((name, count)));
}
fn root() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    fs::write(managed.join("counter"), "0").unwrap();
    fs::write(managed.join("opaque"), [0, 255, 4, 10]).unwrap();
    fs::write(
        managed.join("migrations.json"),
        r#"{"minimumAppVersion":"0.0.0","lastAppliedMigration":1,"unknown":{"keep":true}}"#,
    )
    .unwrap();
    fs::write(root.path().join("user.md"), "user data").unwrap();
    root
}
struct Two;
impl crate::Migration for Two {
    const VERSION: MigrationId = MigrationId(2);
    const MINIMUM_APP_VERSION: Option<&'static str> = None;
    fn apply(w: &MigrationWorkspace<'_>) -> Result<()> {
        let old: u32 = String::from_utf8(w.read("counter")?)
            .unwrap()
            .parse()
            .unwrap();
        w.write("counter", (old + 1).to_string().as_bytes())?;
        w.write("created", b"new")
    }
    fn validate(w: &MigrationWorkspace<'_>) -> Result<()> {
        if w.read("counter")? != b"1" {
            return Err(MigrationError::new(MigrationErrorKind::MigrationFailed));
        }
        Ok(())
    }
}
struct Three;
impl crate::Migration for Three {
    const VERSION: MigrationId = MigrationId(3);
    const MINIMUM_APP_VERSION: Option<&'static str> = None;
    fn apply(w: &MigrationWorkspace<'_>) -> Result<()> {
        w.write("third", b"complete")
    }
    fn validate(w: &MigrationWorkspace<'_>) -> Result<()> {
        if w.read("third")? != b"complete" {
            return Err(MigrationError::new(MigrationErrorKind::MigrationFailed));
        }
        Ok(())
    }
}
const CHAIN: &[MigrationDescriptor] = &[
    MigrationDescriptor::of::<crate::migrations::m0001_workspace_metadata::Migration>(),
    MigrationDescriptor::of::<Two>(),
    MigrationDescriptor::of::<Three>(),
];
fn assert_original(root: &Path) {
    let managed = root.join(".situate");
    assert_eq!(fs::read(managed.join("counter")).unwrap(), b"0");
    assert!(!managed.join("created").exists());
    assert!(!managed.join("third").exists());
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(managed.join("migrations.json")).unwrap()).unwrap();
    assert_eq!(value["lastAppliedMigration"], 1);
    assert_eq!(value["unknown"]["keep"], true);
    assert_eq!(fs::read(managed.join("opaque")).unwrap(), [0, 255, 4, 10]);
    assert_eq!(
        fs::read_to_string(root.join("user.md")).unwrap(),
        "user data"
    );
}
fn assert_final(root: &Path) {
    let managed = root.join(".situate");
    assert_eq!(fs::read(managed.join("counter")).unwrap(), b"1");
    assert_eq!(fs::read(managed.join("third")).unwrap(), b"complete");
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(managed.join("migrations.json")).unwrap()).unwrap();
    assert_eq!(value["lastAppliedMigration"], 3);
    assert_eq!(value["unknown"]["keep"], true);
    assert_eq!(fs::read(managed.join("opaque")).unwrap(), [0, 255, 4, 10]);
    let control = managed.join(filesystem::CONTROL);
    assert!(control.join("workspace.lock").is_file());
    for name in [backup::TEMPORARY, backup::RECOVERABLE, backup::RETIRED] {
        assert!(!control.join(name).exists());
    }
}
#[test]
fn skipped_steps_are_ordered_and_failure_restores_the_whole_starting_state() {
    let root = root();
    fail("step-applied", 2);
    let error = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::MigrationFailed);
    assert_original(root.path());
    let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap();
    assert_final(root.path());
    assert!(runner::prepare_with(root.path(), "0.1.3", CHAIN).is_ok());
    drop(lease);
}
#[test]
fn registry_rejects_duplicate_missing_reordered_and_invalid_version_entries() {
    for entries in [
        vec![CHAIN[0], CHAIN[0]],
        vec![CHAIN[0], CHAIN[2]],
        vec![CHAIN[1], CHAIN[0]],
    ] {
        assert_eq!(
            registry::validate(&entries).unwrap_err().kind(),
            MigrationErrorKind::InvalidRegistry
        );
    }
    let mut invalid = CHAIN[0];
    invalid.minimum_app_version = Some("bad");
    assert_eq!(
        registry::validate(&[invalid]).unwrap_err().kind(),
        MigrationErrorKind::InvalidRegistry
    );
    assert!(registry::validate(CHAIN).is_ok());
}
#[test]
fn only_declared_minimum_increases_are_published_with_the_completed_chain() {
    let root = root();
    let mut chain = CHAIN.to_vec();
    chain[1].minimum_app_version = Some("0.3.0");
    chain[2].minimum_app_version = Some("0.2.0");
    let lease = runner::prepare_with(root.path(), "0.3.0", &chain).unwrap();
    let path = root.path().join(".situate/migrations.json");
    let bytes = fs::read(&path).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["minimumAppVersion"], "0.3.0");
    assert_eq!(value["lastAppliedMigration"], 3);
    assert_eq!(
        crate::prepare(root.path(), "0.2.0").unwrap_err().kind(),
        MigrationErrorKind::UpdateRequired
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
    drop(lease);
}
#[test]
fn rolled_back_incompatible_conversion_does_not_report_update_required_parameters() {
    let root = root();
    let mut chain = CHAIN.to_vec();
    chain[1].minimum_app_version = Some("0.2.0");
    fail("step-applied", 1);
    let error = runner::prepare_with(root.path(), "0.2.0", &chain).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::MigrationFailed);
    assert_eq!(error.required_app_version(), None);
    assert_original(root.path());
}

#[test]
fn filesystem_cause_survives_migration_failure_classification() {
    use std::error::Error;
    struct Fails;
    impl crate::Migration for Fails {
        const VERSION: MigrationId = MigrationId(2);
        const MINIMUM_APP_VERSION: Option<&'static str> = None;
        fn apply(_: &MigrationWorkspace<'_>) -> Result<()> {
            Err(std::io::Error::from_raw_os_error(13).into())
        }
        fn validate(_: &MigrationWorkspace<'_>) -> Result<()> {
            panic!("a failed migration must not be validated");
        }
    }
    let root = root();
    let chain = [CHAIN[0], MigrationDescriptor::of::<Fails>()];
    let error = runner::prepare_with(root.path(), "0.1.6", &chain).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::MigrationFailed);
    assert_eq!(
        error
            .source()
            .unwrap()
            .downcast_ref::<std::io::Error>()
            .unwrap()
            .raw_os_error(),
        Some(13)
    );
    assert_original(root.path());
}

#[test]
fn incomplete_copy_is_never_used_as_recovery_source() {
    let root = root();
    fail("copy-entry", 1);
    assert!(runner::prepare_with(root.path(), "0.1.3", CHAIN).is_err());
    assert_original(root.path());
    assert!(
        root.path()
            .join(".situate/.migrations")
            .join(backup::TEMPORARY)
            .is_file()
    );
    let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap();
    assert_final(root.path());
    drop(lease);
}
#[test]
fn restoration_failure_preserves_the_complete_backup_and_next_open_recovers() {
    let root = root();
    let managed = Dir::open_ambient_dir(root.path().join(".situate"), ambient_authority()).unwrap();
    let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
    backup::create(&managed, &control).unwrap();
    fs::write(root.path().join(".situate/counter"), "changed").unwrap();
    fail("restore-empty", 1);
    assert_eq!(
        runner::prepare_with(root.path(), "0.1.3", CHAIN)
            .unwrap_err()
            .kind(),
        MigrationErrorKind::RestorationFailed
    );
    assert!(
        root.path()
            .join(".situate/.migrations")
            .join(backup::RECOVERABLE)
            .is_file()
    );
    assert_eq!(archived(root.path(), "payload/counter"), b"0");
    let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap();
    assert_final(root.path());
    drop(lease);
}
#[test]
fn cleanup_failure_does_not_restore_a_retired_backup() {
    let root = root();
    fail("cleanup-start", 1);
    let error = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::CleanupFailed);
    assert_eq!(
        std::error::Error::source(&error)
            .unwrap()
            .downcast_ref::<std::io::Error>()
            .unwrap()
            .raw_os_error(),
        Some(5)
    );
    assert_eq!(
        fs::read(root.path().join(".situate/counter")).unwrap(),
        b"1"
    );
    let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap();
    assert_final(root.path());
    drop(lease);
}
#[test]
fn shared_session_blocks_pending_conversion_but_not_current_openers() {
    let root = root();
    let first = runner::prepare_with(root.path(), "0.1.3", &CHAIN[..1]).unwrap();
    assert!(runner::prepare_with(root.path(), "0.1.3", &CHAIN[..1]).is_ok());
    assert_eq!(
        runner::prepare_with(root.path(), "0.1.3", CHAIN)
            .unwrap_err()
            .kind(),
        MigrationErrorKind::Busy
    );
    assert_original(root.path());
    drop(first);
    let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap();
    assert_final(root.path());
    drop(lease);
}
#[test]
fn fresh_private_marker_initializes_latest_without_legacy_conversion() {
    let root = tempfile::tempdir().unwrap();
    let managed = Dir::open_ambient_dir(root.path(), ambient_authority()).unwrap();
    runner::initialize_fresh(&managed, "0.1.6").unwrap();
    assert_eq!(
        metadata::load(&managed).unwrap().unwrap()["lastAppliedMigration"],
        2
    );
    assert!(runner::initialize_fresh(&managed, "0.1.6").is_err());
}
#[test]
fn restricted_migration_access_rejects_escapes_and_runner_owned_paths() {
    let root = root();
    let dir = Dir::open_ambient_dir(root.path().join(".situate"), ambient_authority()).unwrap();
    let w = MigrationWorkspace { managed: &dir };
    for path in [
        "../user.md",
        "/tmp/outside",
        ".migrations/workspace.lock",
        ".MIGRATIONS/workspace.lock",
        ".MiGrAtIoNs/backup/manifest.json",
        "migrations.json",
        "MIGRATIONS.JSON",
    ] {
        assert_eq!(
            w.write(path, b"bad").unwrap_err().kind(),
            MigrationErrorKind::UnsafePath
        );
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.path(), root.path().join(".situate/escape")).unwrap();
        assert!(w.write("escape/user.md", b"bad").is_err());
        assert!(w.read("escape/user.md").is_err());
    }
    assert_eq!(
        fs::read_to_string(root.path().join("user.md")).unwrap(),
        "user data"
    );
}
#[test]
fn filesystem_alias_of_runner_metadata_is_not_a_conversion_target() {
    let root = root();
    let managed = root.path().join(".situate");
    fs::hard_link(managed.join("migrations.json"), managed.join("alias.json")).unwrap();
    let dir = Dir::open_ambient_dir(&managed, ambient_authority()).unwrap();
    let w = MigrationWorkspace { managed: &dir };
    assert_eq!(
        w.write("alias.json", b"bad").unwrap_err().kind(),
        MigrationErrorKind::UnsafePath
    );
    assert_original(root.path());
}
#[test]
fn write_flush_rename_and_delete_failures_remain_recoverable() {
    for (point, count) in [
        ("copy-write", 1),
        ("file-sync", 1),
        ("file-write", 1),
        ("replace-rename", 1),
        ("publish-rename", 1),
        ("retire-rename", 1),
        ("delete-entry", 1),
        ("directory-sync", 1),
        ("directory-sync", 5),
    ] {
        let root = root();
        fail(point, count);
        assert!(
            runner::prepare_with(root.path(), "0.1.3", CHAIN).is_err(),
            "{point}"
        );
        FAILURE.with_borrow_mut(|f| *f = None);
        let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN)
            .unwrap_or_else(|e| panic!("{point}: {e}"));
        assert_final(root.path());
        drop(lease);
    }
}
fn archived(root: &Path, name: &str) -> Vec<u8> {
    use std::io::Read;
    let file = fs::File::open(root.join(".situate/.migrations").join(backup::RECOVERABLE)).unwrap();
    for entry in tar::Archive::new(file).entries().unwrap() {
        let mut entry = entry.unwrap();
        if entry.path().unwrap() == Path::new(name) {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            return bytes;
        }
    }
    panic!("missing archive entry: {name}");
}

#[test]
fn archive_cleanup_ignores_unrelated_files_and_directories() {
    let root = root();
    let managed_path = root.path().join(".situate");
    let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
    let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
    let control_path = managed_path.join(filesystem::CONTROL);
    for name in [".DS_Store", "unrelated-file"] {
        fs::write(control_path.join(name), "retain").unwrap();
    }
    fs::create_dir(control_path.join("unrelated-directory")).unwrap();
    for name in [backup::TEMPORARY, backup::RETIRED] {
        fs::write(control_path.join(name), "partial archive").unwrap();
    }
    backup::cleanup(&control).unwrap();
    for name in [".DS_Store", "unrelated-file"] {
        assert_eq!(fs::read(control_path.join(name)).unwrap(), b"retain");
    }
    assert!(control_path.join("unrelated-directory").is_dir());
    assert!(!control_path.join(backup::TEMPORARY).exists());
    assert!(!control_path.join(backup::RETIRED).exists());
    assert_original(root.path());
}

#[cfg(unix)]
#[test]
fn archive_cleanup_does_not_follow_symlinks_or_delete_directories() {
    for directory in [false, true] {
        let root = root();
        let managed_path = root.path().join(".situate");
        let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
        let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
        let candidate = managed_path
            .join(filesystem::CONTROL)
            .join(backup::TEMPORARY);
        let outside = root.path().join("outside");
        fs::write(&outside, "retain").unwrap();
        if directory {
            fs::create_dir(&candidate).unwrap();
        } else {
            std::os::unix::fs::symlink(&outside, &candidate).unwrap();
        }
        assert!(backup::cleanup(&control).is_err());
        assert!(fs::symlink_metadata(candidate).is_ok());
        assert_eq!(fs::read(outside).unwrap(), b"retain");
        assert_original(root.path());
    }
}

#[test]
fn archive_verification_does_not_rescan_live_directories() {
    let root = root();
    let managed_path = root.path().join(".situate");
    for name in [".DS_Store", "third-party-metadata"] {
        fs::write(managed_path.join(name), "snapshot").unwrap();
    }
    let changed = managed_path.clone();
    AFTER_COPY.with_borrow_mut(|change| {
        *change = Some(Box::new(move || {
            for name in [".DS_Store", "third-party-metadata"] {
                fs::write(changed.join(name), "later").unwrap();
            }
            fs::create_dir(changed.join("new-directory")).unwrap();
            fs::write(changed.join("new-directory/new-file"), "later").unwrap();
        }))
    });
    let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
    let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
    backup::create(&managed, &control).unwrap();
    backup::verify(&control).unwrap();
    assert!(
        managed_path
            .join(".migrations")
            .join(backup::RECOVERABLE)
            .is_file()
    );
    for name in [".DS_Store", "third-party-metadata"] {
        assert_eq!(
            archived(root.path(), &format!("payload/{name}")),
            b"snapshot"
        );
        assert_eq!(fs::read(managed_path.join(name)).unwrap(), b"later");
    }
    assert_eq!(archived(root.path(), "payload/opaque"), [0, 255, 4, 10]);
    let manifest: serde_json::Value =
        serde_json::from_slice(&archived(root.path(), "manifest.json")).unwrap();
    assert!(manifest.get(".migrations").is_none());
    assert!(manifest.get("new-directory").is_none());
    assert_original(root.path());
}

#[test]
fn invalid_temporary_archive_is_not_published() {
    use std::io::Write;
    let root = root();
    let managed_path = root.path().join(".situate");
    let archive_path = managed_path.join(".migrations").join(backup::TEMPORARY);
    AFTER_COPY.with_borrow_mut(|change| {
        *change = Some(Box::new(move || {
            fs::OpenOptions::new()
                .write(true)
                .open(archive_path)
                .unwrap()
                .write_all(b"x")
                .unwrap();
        }))
    });
    let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
    let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
    assert!(backup::create(&managed, &control).is_err());
    assert!(
        !managed_path
            .join(".migrations")
            .join(backup::RECOVERABLE)
            .exists()
    );
    assert_original(root.path());
}

#[test]
fn corrupt_or_truncated_archives_do_not_replace_live_state() {
    for target in [
        "payload/counter",
        "manifest.json",
        "truncated",
        "missing-manifest",
    ] {
        let root = root();
        let managed_path = root.path().join(".situate");
        let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
        let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
        backup::create(&managed, &control).unwrap();
        let path = managed_path.join(".migrations").join(backup::RECOVERABLE);
        let mut bytes = fs::read(&path).unwrap();
        if target == "truncated" {
            bytes.truncate(600);
        } else {
            let file = fs::File::open(&path).unwrap();
            let entry = tar::Archive::new(file)
                .entries()
                .unwrap()
                .map(|entry| entry.unwrap())
                .find(|entry| {
                    entry.path().unwrap()
                        == Path::new(if target == "missing-manifest" {
                            "manifest.json"
                        } else {
                            target
                        })
                })
                .map(|entry| (entry.raw_header_position(), entry.raw_file_position()))
                .unwrap();
            if target == "missing-manifest" {
                bytes.truncate(entry.0 as usize);
            } else {
                bytes[entry.1 as usize] ^= 1;
            }
        }
        fs::write(&path, bytes).unwrap();
        assert!(runner::prepare_with(root.path(), "0.1.6", CHAIN).is_err());
        assert_original(root.path());
        assert!(path.is_file());
    }
}

#[test]
fn malformed_archive_paths_and_entry_types_are_rejected_before_restoration() {
    for (name, kind, duplicate) in [
        ("payload/../user.md", tar::EntryType::Regular, false),
        ("/user.md", tar::EntryType::Regular, false),
        (
            "payload/.migrations/workspace.lock",
            tar::EntryType::Regular,
            false,
        ),
        ("payload/link", tar::EntryType::Symlink, false),
        ("payload/link", tar::EntryType::Link, false),
        ("payload/counter", tar::EntryType::Regular, true),
    ] {
        let root = root();
        let managed_path = root.path().join(".situate");
        let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
        let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
        let file =
            fs::File::create(managed_path.join(".migrations").join(backup::RECOVERABLE)).unwrap();
        let mut archive = tar::Builder::new(file);
        let mut header = tar::Header::new_gnu();
        header.set_size(0);
        header.set_mode(0o600);
        header.set_entry_type(kind);
        header.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
        header.set_cksum();
        archive.append(&header, std::io::empty()).unwrap();
        if duplicate {
            archive.append(&header, std::io::empty()).unwrap();
        }
        let key = name.strip_prefix("payload/").unwrap_or(name);
        let manifest = serde_json::json!({
            (key): {"directory": false, "mode": 384, "bytes": 0,
                  "digest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
        })
        .to_string();
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest.len() as u64);
        header.set_mode(0o600);
        archive
            .append_data(&mut header, "manifest.json", manifest.as_bytes())
            .unwrap();
        archive.finish().unwrap();
        assert!(backup::restore(&managed, &control).is_err(), "{name}");
        assert_original(root.path());
    }
}

#[test]
fn archive_compatibility_is_checked_before_restoring_older_live_metadata() {
    let root = root();
    let managed_path = root.path().join(".situate");
    let metadata_path = managed_path.join("migrations.json");
    let compatible = fs::read(&metadata_path).unwrap();
    fs::write(
        &metadata_path,
        r#"{"minimumAppVersion":"9999.0.0","lastAppliedMigration":1}"#,
    )
    .unwrap();
    let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
    let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
    backup::create(&managed, &control).unwrap();
    fs::write(&metadata_path, &compatible).unwrap();
    let error = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::UpdateRequired);
    assert_eq!(error.required_app_version(), Some("9999.0.0"));
    assert_original(root.path());
}

#[cfg(unix)]
#[test]
fn archive_and_restoration_are_private_and_preserve_normal_file_modes() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let root = root();
    let managed_path = root.path().join(".situate");
    fs::set_permissions(
        managed_path.join("opaque"),
        fs::Permissions::from_mode(0o400),
    )
    .unwrap();
    let nested = managed_path.join("retained");
    fs::create_dir_all(nested.join("empty")).unwrap();
    let long_name = "résumé-".repeat(16);
    fs::write(nested.join(&long_name), b"executable").unwrap();
    fs::set_permissions(nested.join(&long_name), fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&nested, fs::Permissions::from_mode(0o500)).unwrap();
    let managed = Dir::open_ambient_dir(&managed_path, ambient_authority()).unwrap();
    let control = filesystem::ensure_child(&managed, filesystem::CONTROL).unwrap();
    backup::create(&managed, &control).unwrap();
    let archive_path = managed_path.join(".migrations").join(backup::RECOVERABLE);
    assert_eq!(fs::metadata(&archive_path).unwrap().mode() & 0o777, 0o600);
    assert_eq!(
        fs::metadata(managed_path.join(".migrations"))
            .unwrap()
            .mode()
            & 0o777,
        0o700
    );
    fs::write(managed_path.join("counter"), "changed").unwrap();
    assert_eq!(archived(root.path(), "payload/counter"), b"0");
    backup::restore(&managed, &control).unwrap();
    assert_original(root.path());
    assert_eq!(fs::metadata(&managed_path).unwrap().mode() & 0o777, 0o700);
    assert_eq!(
        fs::metadata(managed_path.join("opaque")).unwrap().mode() & 0o777,
        0o400
    );
    assert_eq!(fs::metadata(&nested).unwrap().mode() & 0o777, 0o500);
    assert_eq!(
        fs::metadata(nested.join(&long_name)).unwrap().mode() & 0o777,
        0o700
    );
    assert_eq!(fs::read(nested.join(long_name)).unwrap(), b"executable");
    assert!(nested.join("empty").is_dir());
    fs::set_permissions(nested, fs::Permissions::from_mode(0o700)).unwrap();
}
#[test]
fn position_zero_metadata_preserves_its_minimum_and_opaque_fields() {
    let root = root();
    let path = root.path().join(".situate/migrations.json");
    fs::write(
        &path,
        r#"{"minimumAppVersion":"0.1.2","lastAppliedMigration":0,"future":{"retain":true}}"#,
    )
    .unwrap();
    let _lease = runner::prepare_with(root.path(), "0.1.3", &CHAIN[..1]).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["minimumAppVersion"], "0.1.2");
    assert_eq!(value["lastAppliedMigration"], 1);
    assert_eq!(value["future"]["retain"], true);
}
#[test]
fn crash_child() {
    let Ok(root) = std::env::var("SITUATE_MIGRATION_TEST_ROOT") else {
        return;
    };
    let _lease = runner::prepare_with(Path::new(&root), "0.1.3", CHAIN).unwrap();
}
#[test]
fn process_exit_at_each_publication_boundary_recovers_without_duplicate_conversion() {
    for point in [
        "copy-entry",
        "backup-copied",
        "file-sync",
        "backup-complete",
        "backup-published",
        "backup-durable",
        "step-before",
        "step-applied",
        "step-validated",
        "metadata-durable",
        "retire-start",
        "backup-retired",
        "retirement-durable",
        "cleanup-start",
        "cleanup-finished",
        "entry-deleted",
    ] {
        let root = root();
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "runner_cases::crash_child", "--nocapture"])
            .env("SITUATE_MIGRATION_TEST_ROOT", root.path())
            .env("SITUATE_MIGRATION_TEST_CRASH", point)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73), "checkpoint {point}");
        let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN)
            .unwrap_or_else(|e| panic!("{point}: {e}"));
        assert_final(root.path());
        drop(lease);
    }
}
#[test]
fn process_exit_during_restoration_retries_from_immutable_source() {
    for point in [
        "restore-remove",
        "restore-empty",
        "restore-write",
        "restore-entry",
        "restored",
    ] {
        let root = root();
        let dir = Dir::open_ambient_dir(root.path().join(".situate"), ambient_authority()).unwrap();
        let control = filesystem::ensure_child(&dir, filesystem::CONTROL).unwrap();
        backup::create(&dir, &control).unwrap();
        fs::write(root.path().join(".situate/counter"), "damaged").unwrap();
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "runner_cases::crash_child", "--nocapture"])
            .env("SITUATE_MIGRATION_TEST_ROOT", root.path())
            .env("SITUATE_MIGRATION_TEST_CRASH", point)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73));
        let lease = runner::prepare_with(root.path(), "0.1.3", CHAIN).unwrap();
        assert_final(root.path());
        drop(lease);
    }
}
