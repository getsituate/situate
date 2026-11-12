use super::*;
use crate::durable_storage::testing::{self, Event};
use std::{fs, os::unix::fs::PermissionsExt};

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::write(temp.path().join("note.md"), b"first\n").unwrap();
    temp
}

#[test]
fn object_barrier_failure_prevents_reference_publication() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let previous = store.repo.head().unwrap().target().unwrap();
    fs::write(temp.path().join("note.md"), b"external\n").unwrap();
    let recording = testing::start();
    recording.fail_after(0);
    assert!(matches!(
        store.record_external_changes(),
        Err(ContentError::Io(_))
    ));
    assert_eq!(store.repo.head().unwrap().target(), Some(previous));
    assert!(
        recording
            .events()
            .iter()
            .all(|event| matches!(event, Event::Prepared(_)))
    );
    assert_eq!(
        fs::read(temp.path().join("note.md")).unwrap(),
        b"external\n"
    );
    let published = store.record_external_changes().unwrap();
    assert_ne!(published, previous.to_string());
    assert_eq!(store.history().unwrap().len(), 2);
    drop(store);
    let reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(reopened.history().unwrap()[0].revision, published);
    assert_eq!(
        reopened
            .read_revision("note.md", &previous.to_string())
            .unwrap(),
        b"first\n"
    );
}

#[test]
fn control_barrier_failure_is_retried_without_replaying_the_change() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let previous = store.repo.head().unwrap().target().unwrap();
    fs::write(temp.path().join("note.md"), b"external\n").unwrap();
    let identity = same_file::Handle::from_path(temp.path().join("note.md")).unwrap();
    let recording = testing::start();
    recording.fail_after(1);
    assert!(matches!(
        store.record_external_changes(),
        Err(ContentError::Io(_))
    ));
    let published = store.repo.head().unwrap().target().unwrap();
    assert_ne!(published, previous);
    assert_ne!(store.observations.durable_head.get(), Some(published));
    recording.fail_after(0);
    assert!(matches!(
        store.record_file("note.md", b"external\n", "native.history.editFile"),
        Err(ContentError::Io(_))
    ));
    assert_ne!(store.observations.durable_head.get(), Some(published));
    assert_eq!(
        store
            .record_file("note.md", b"external\n", "native.history.editFile")
            .unwrap(),
        published.to_string()
    );
    assert_eq!(
        store.record_external_changes().unwrap(),
        published.to_string()
    );
    assert_eq!(store.observations.durable_head.get(), Some(published));
    assert_eq!(store.history().unwrap().len(), 2);
    assert_eq!(
        same_file::Handle::from_path(temp.path().join("note.md")).unwrap(),
        identity
    );
    drop(store);
    let reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(
        reopened.history().unwrap()[0].revision,
        published.to_string()
    );
    assert_eq!(reopened.read_text("note.md").unwrap().text, "external\n");
}

#[test]
fn failed_reopen_barrier_preserves_history_and_recovery_drafts() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let previous = store.repo.head().unwrap().target().unwrap();
    let base = store.read_text("note.md").unwrap();
    store
        .stage_draft(&Draft {
            path: "note.md".into(),
            base: Some(base),
            text: "pending\n".into(),
        })
        .unwrap();
    drop(store);
    let recording = testing::start();
    recording.fail_after(0);
    assert!(matches!(
        ContentStore::open(temp.path()),
        Err(ContentError::Io(_))
    ));
    let drafts = read_recovery_drafts(temp.path()).unwrap();
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].text, "pending\n");
    let reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(reopened.repo.head().unwrap().target(), Some(previous));
    assert_eq!(reopened.history().unwrap().len(), 1);
    assert_eq!(reopened.drafts().unwrap(), drafts);
    assert_eq!(reopened.read_text("note.md").unwrap().text, "first\n");
}

#[test]
fn already_acknowledged_file_history_does_not_repeat_device_barriers() {
    let temp = workspace();
    let store = ContentStore::open(temp.path()).unwrap();
    let previous = store.repo.head().unwrap().target().unwrap();
    let recording = testing::start();
    assert_eq!(
        store
            .record_file("note.md", b"first\n", "native.history.editFile")
            .unwrap(),
        previous.to_string()
    );
    assert!(recording.events().is_empty());
    assert_eq!(store.history().unwrap().len(), 1);
}

#[test]
fn unchanged_save_does_not_require_creating_a_file_in_the_content_directory() {
    let temp = workspace();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let base = store.read_text("note.md").unwrap();
    let identity = same_file::Handle::from_path(temp.path().join("note.md")).unwrap();
    let permissions = fs::metadata(temp.path()).unwrap().permissions();
    fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o500)).unwrap();
    let unchanged = store.save("note.md", &base, &base.text);
    let changed = store.save("note.md", &base, "changed\n");
    fs::set_permissions(temp.path(), permissions).unwrap();
    assert!(matches!(unchanged.unwrap(), SaveOutcome::Saved { .. }));
    assert!(matches!(changed, Err(ContentError::Io(_))));
    assert_eq!(store.history().unwrap().len(), 1);
    assert_eq!(store.read_text("note.md").unwrap().text, "first\n");
    assert_eq!(store.drafts().unwrap()[0].text, "changed\n");
    assert_eq!(
        same_file::Handle::from_path(temp.path().join("note.md")).unwrap(),
        identity
    );
}
