use super::*;
use serde_json::json;
use std::fs;

thread_local! {
    pub(super) static FAILURE: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}
const ID: &str = "ae33fbf1-b47d-4f92-a249-a6f020bc4e4f";
const SECOND_REQUEST: &str = "be33fbf1-b47d-4f92-a249-a6f020bc4e4f";
const REQUEST: &str = "ce33fbf1-b47d-4f92-a249-a6f020bc4e4f";
fn setup() -> (tempfile::TempDir, Store, Record) {
    let root = tempfile::tempdir().unwrap();
    let store = Store::new(root.path().join("plugin-actions"));
    let record = store
        .create(ID, &"a".repeat(64), "sample", 7, "publish")
        .unwrap();
    (root, store, record)
}
#[test]
fn stale_observation_revisions_cannot_replace_a_saved_receipt() {
    let (_root, store, initial) = setup();
    let observed = initial
        .observe(REQUEST, json!({"success":true,"statusCode":201}))
        .unwrap();
    store.save(&observed).unwrap();
    let stale = initial
        .observe(REQUEST, json!({"success":false,"statusCode":500}))
        .unwrap();
    assert_eq!(store.save(&stale).unwrap_err(), CONFLICT);
    assert_eq!(store.load(ID).unwrap(), observed);
}

#[test]
fn observations_terminal_states_and_reopening_are_passive() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Store>();
    let (root, store, initial) = setup();
    let observed = initial
        .observe(
            REQUEST,
            json!({"success":true,"uncertain":false,"statusCode":201}),
        )
        .unwrap();
    store.save(&observed).unwrap();
    assert!(observed.observe(REQUEST, json!({"success":true})).is_err());
    for status in [Status::Completed, Status::Failed, Status::Disconnected] {
        let terminal = observed
            .terminal(status, status != Status::Completed)
            .unwrap();
        assert!(terminal.status().is_terminal());
        assert!(
            terminal
                .observe(SECOND_REQUEST, json!({"success":true}))
                .is_err()
        );
        assert!(terminal.terminal(Status::Completed, false).is_err());
    }
    let terminal = observed.terminal(Status::Disconnected, true).unwrap();
    store.save(&terminal).unwrap();
    let bytes = fs::read(root.path().join(format!("plugin-actions/{ID}.json"))).unwrap();
    let reopened = Store::new(root.path().join("plugin-actions"));
    assert_eq!(reopened.load(ID).unwrap(), terminal);
    assert!(terminal.uncertain());
    assert_eq!(
        fs::read(root.path().join(format!("plugin-actions/{ID}.json"))).unwrap(),
        bytes
    );
    assert_eq!(
        reopened
            .create(ID, &"a".repeat(64), "sample", 7, "publish")
            .unwrap_err(),
        CONFLICT
    );
}

#[test]
fn loading_running_records_never_rewrites_or_completes_them() {
    let (root, store, initial) = setup();
    assert_eq!(store.load(ID).unwrap(), initial);
    let observed = initial.observe(REQUEST, json!({"success":true})).unwrap();
    store.save(&observed).unwrap();
    assert_eq!(observed.status(), Status::Running);
    let before = fs::read(root.path().join(format!("plugin-actions/{ID}.json"))).unwrap();
    assert_eq!(
        Store::new(root.path().join("plugin-actions"))
            .load(ID)
            .unwrap(),
        observed
    );
    assert_eq!(
        fs::read(root.path().join(format!("plugin-actions/{ID}.json"))).unwrap(),
        before
    );
}

#[test]
fn failed_saves_preserve_previous_bytes_and_cannot_advance_the_receipt() {
    let (root, store, initial) = setup();
    let staged = initial.observe(REQUEST, json!({"success":true})).unwrap();
    let path = root.path().join(format!("plugin-actions/{ID}.json"));
    let before = fs::read(&path).unwrap();
    for point in ["file-sync", "rename"] {
        FAILURE.set(Some(point));
        assert_eq!(store.save(&staged).unwrap_err(), SAVE_FAILED);
        assert_eq!(store.load(ID).unwrap(), initial);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
    store.save(&staged).unwrap();
    assert_eq!(store.load(ID).unwrap(), staged);
    assert_eq!(initial.revision(), 0);
}

#[test]
fn post_rename_uncertainty_keeps_new_bytes_and_retry_performs_a_new_flush() {
    let (_root, store, initial) = setup();
    let staged = initial.terminal(Status::Failed, true).unwrap();
    FAILURE.set(Some("directory-sync"));
    assert_eq!(store.save(&staged).unwrap_err(), UNKNOWN);
    assert_eq!(store.load(ID).unwrap(), staged);
    FAILURE.set(Some("file-sync"));
    assert_eq!(store.save(&staged).unwrap_err(), SAVE_FAILED);
    assert_eq!(store.load(ID).unwrap(), staged);
    store.save(&staged).unwrap();
    assert_eq!(store.load(ID).unwrap(), staged);
}

#[test]
fn validation_rejects_raw_payloads_ids_and_unbounded_receipts() {
    let (_root, store, initial) = setup();
    for value in [
        json!({"body":"secret"}),
        json!({"stdout":"secret"}),
        json!({"headers":{}}),
        json!({"status":"https://example.com?secret"}),
        json!({"status": "x".repeat(129)}),
        json!({"code":{"nested":true}}),
    ] {
        assert!(initial.observe(REQUEST, value).is_err());
    }
    assert!(store.load("../../elsewhere").is_err());
    assert!(
        store
            .create("not-uuid", &"a".repeat(64), "sample", 7, "publish")
            .is_err()
    );
    let mut value = serde_json::to_value(initial).unwrap();
    value["body"] = json!("secret");
    assert!(serde_json::from_value::<Record>(value).is_err());
}

#[test]
fn obsolete_receipts_are_not_rewritten_or_reinitialized() {
    let (root, store, initial) = setup();
    let path = root.path().join(format!("plugin-actions/{ID}.json"));
    let mut value = serde_json::to_value(&initial).unwrap();
    value["version"] = json!(1);
    value["approvals"] = json!([]);
    let before = serde_json::to_vec(&value).unwrap();
    fs::write(&path, &before).unwrap();
    assert!(store.load(ID).is_err());
    assert!(store.save(&initial).is_err());
    assert!(
        store
            .create(ID, &"a".repeat(64), "sample", 7, "publish")
            .is_err()
    );
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn private_files_symlink_refusal_and_corruption_preserve_existing_content() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let (root, store, initial) = setup();
    let path = root.path().join(format!("plugin-actions/{ID}.json"));
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    fs::write(&path, b"invalid").unwrap();
    assert!(store.load(ID).is_err());
    assert!(store.save(&initial).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"invalid");
    fs::remove_file(&path).unwrap();
    let outside = root.path().join("outside");
    fs::write(&outside, b"retained").unwrap();
    symlink(&outside, &path).unwrap();
    assert!(store.load(ID).is_err());
    assert!(store.save(&initial).is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"retained");
    let alias = root.path().join("alias");
    symlink(root.path().join("plugin-actions"), &alias).unwrap();
    assert!(
        Store::new(alias)
            .create(REQUEST, &"a".repeat(64), "sample", 1, "publish")
            .is_err()
    );
}
