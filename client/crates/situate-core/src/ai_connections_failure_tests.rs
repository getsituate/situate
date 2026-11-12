use super::*;

#[cfg(unix)]
struct ReadOnly(std::path::PathBuf);
#[cfg(unix)]
impl ReadOnly {
    fn new(path: &Path) -> Self {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o500)).unwrap();
        Self(path.into())
    }
}
#[cfg(unix)]
impl Drop for ReadOnly {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
}
#[cfg(unix)]
#[test]
fn device_write_denial_preserves_previous_and_metadata_denial_recovers_after_restart() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let account = id();
    save(
        &storage,
        &keys,
        &account,
        Some("https://one.invalid/v1"),
        "previous",
        false,
    );
    let previous = storage.load(&keys).unwrap().unwrap();
    let new_config = config(&account, Some("https://two.invalid/v1"));
    let new_bytes =
        serde_json::to_vec(&serde_json::json!({"config":new_config,"key":"newly-issued"})).unwrap();
    {
        let _denied = ReadOnly::new(device.path());
        assert!(
            storage
                .save_connection(&keys, &account, new_config.clone(), &new_bytes, true)
                .is_err()
        );
        assert_eq!(*storage.load(&keys).unwrap().unwrap(), *previous);
    }
    {
        let _denied = ManifestFailure::new();
        assert!(
            storage
                .save_connection(&keys, &account, new_config, &new_bytes, true)
                .is_err()
        );
        assert_eq!(*storage.load(&keys).unwrap().unwrap(), *previous);
        assert!(storage.has_pending_connection_publication().unwrap());
    }
    let reopened = open(ws.path(), device.path());
    let _lease = reopened.lock_credentials().unwrap();
    reopened.recover_connection_publication(&keys).unwrap();
    assert_eq!(*reopened.load(&keys).unwrap().unwrap(), new_bytes);
    assert!(!reopened.has_pending_connection_publication().unwrap());
    let current = reopened.selected_connection().unwrap().unwrap();
    assert_eq!(current.config["endpoint"], "https://two.invalid/v1");
    reopened.forget_connection(&keys, &account).unwrap();
    assert!(reopened.load(&keys).unwrap().is_none());
}
#[cfg(unix)]
#[test]
fn pending_publication_never_overwrites_a_subsequent_external_edit() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let account = id();
    save(&storage, &keys, &account, None, "previous", false);
    {
        let _denied = ManifestFailure::new();
        assert!(
            storage
                .save_connection(
                    &keys,
                    &account,
                    config(&account, Some("https://new.invalid/v1")),
                    b"synthetic issued session",
                    true
                )
                .is_err()
        );
    }
    let mut edited = storage.connection_manifest().unwrap().unwrap();
    edited.connections[0].config["endpoint"] = Value::String("https://external.invalid/v1".into());
    edited.selected = None;
    storage.publish_manifest(&edited).unwrap();
    assert_eq!(
        storage.recover_connection_publication(&keys).unwrap_err(),
        "native.ai.storage.publicationConflict"
    );
    assert!(storage.selected_connection().unwrap().is_none());
    assert!(storage.has_pending_connection_publication().unwrap());
    assert_eq!(
        storage
            .conflicting_connection_publication()
            .unwrap()
            .unwrap()
            .id,
        account
    );
    storage.forget_connection(&keys, &account).unwrap();
    assert!(!storage.has_pending_connection_publication().unwrap());
    assert!(storage.load_connection(&keys, &account).unwrap().is_none());
    assert_eq!(
        storage.connection_record(&account).unwrap().config["endpoint"],
        "https://external.invalid/v1"
    );
}
#[cfg(unix)]
#[test]
fn recovery_preserves_unrelated_local_records_and_selection() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let account = id();
    save(&storage, &keys, &account, None, "previous", false);
    let next = id();
    keys.fail_get.set(Some(keys.gets.get() + 2));
    assert!(
        storage
            .save_connection(
                &keys,
                &next,
                config(&next, None),
                b"synthetic issued session",
                false
            )
            .is_err()
    );
    keys.fail_get.set(None);
    let external = id();
    let mut edited = storage.connection_manifest().unwrap().unwrap();
    edited.connections.push(Record {
        id: external.clone(),
        revision: id(),
        config: config(&external, None),
    });
    edited.selected = Some(external.clone());
    storage.publish_manifest(&edited).unwrap();
    storage.recover_connection_publication(&keys).unwrap();
    assert_eq!(storage.selected_connection().unwrap().unwrap().id, external);
    assert_eq!(
        storage
            .connection_manifest()
            .unwrap()
            .unwrap()
            .connections
            .len(),
        3
    );
    assert!(storage.load_connection(&keys, &next).unwrap().is_some());
}
#[test]
fn external_edit_during_secure_store_readback_is_merged_before_metadata_publication() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let account = id();
    save(&storage, &keys, &account, None, "previous", false);
    let external = id();
    let mut edited = storage.connection_manifest().unwrap().unwrap();
    edited.connections.push(Record {
        id: external.clone(),
        revision: id(),
        config: config(&external, None),
    });
    edited.selected = Some(external.clone());
    let destination = manifest_path(&storage);
    keys.on_get.replace(Some((
        keys.gets.get() + 3,
        Box::new(move || {
            std::fs::write(destination, serde_json::to_vec(&edited).unwrap()).unwrap();
        }),
    )));
    save(
        &storage,
        &keys,
        &account,
        Some("https://new.invalid/v1"),
        "replacement",
        true,
    );
    assert_eq!(storage.selected_connection().unwrap().unwrap().id, external);
    assert_eq!(
        storage
            .connection_manifest()
            .unwrap()
            .unwrap()
            .connections
            .len(),
        2
    );
    assert_eq!(
        storage.connection_record(&account).unwrap().config["endpoint"],
        "https://new.invalid/v1"
    );
}

#[test]
fn replay_does_not_resurrect_a_published_creation_removed_by_another_writer() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let _lease = storage.lock_credentials().unwrap();
    let before = storage.connection_manifest().unwrap().unwrap();
    let account = id();
    save(&storage, &keys, &account, None, "issued", false);
    let after = storage.connection_manifest().unwrap().unwrap();
    let record = after.connections[0].clone();
    let envelope = serde_json::from_slice(
        &storage
            .device()
            .unwrap()
            .read_named(&Storage::secret_name(&after, &record), 262_144)
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    let pending = Publication {
        version: 1,
        phase: PublicationPhase::Publishing,
        before: Some(before.clone()),
        after,
        secret: Some(PendingSecret {
            record,
            envelope,
            previous_key: None,
        }),
    };
    let name = storage.pending_name().unwrap().unwrap();
    publish(
        storage.device().unwrap(),
        &name,
        &serde_json::to_vec(&pending).unwrap(),
    )
    .unwrap();
    storage.recover_connection_publication(&keys).unwrap();
    assert!(storage.load_connection(&keys, &account).unwrap().is_some());
    assert!(!storage.has_pending_connection_publication().unwrap());
    publish(
        storage.device().unwrap(),
        &name,
        &serde_json::to_vec(&pending).unwrap(),
    )
    .unwrap();
    storage.publish_manifest(&before).unwrap();
    let reopened = open(ws.path(), device.path());
    assert_eq!(
        reopened.recover_connection_publication(&keys).unwrap_err(),
        "native.ai.storage.publicationConflict"
    );
    assert!(
        reopened
            .connection_manifest()
            .unwrap()
            .unwrap()
            .connections
            .is_empty()
    );
    assert_eq!(
        reopened
            .conflicting_connection_publication()
            .unwrap()
            .unwrap()
            .id,
        account
    );
    assert_eq!(keys.values.borrow().len(), 1);
    reopened.forget_connection(&keys, &account).unwrap();
    assert!(keys.values.borrow().is_empty());
    assert!(!reopened.has_pending_connection_publication().unwrap());
}

#[cfg(unix)]
#[test]
fn attempted_creation_with_missing_manifest_entry_requires_explicit_discard() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let _lease = storage.lock_credentials().unwrap();
    let account = id();
    {
        let _denied = ManifestFailure::new();
        assert!(
            storage
                .save_connection(&keys, &account, config(&account, None), b"issued", false)
                .is_err()
        );
    }
    let reopened = open(ws.path(), device.path());
    assert_eq!(
        reopened.recover_connection_publication(&keys).unwrap_err(),
        "native.ai.storage.publicationConflict"
    );
    assert!(
        reopened
            .connection_manifest()
            .unwrap()
            .unwrap()
            .connections
            .is_empty()
    );
    assert_eq!(
        reopened
            .conflicting_connection_publication()
            .unwrap()
            .unwrap()
            .id,
        account
    );
    assert_eq!(keys.values.borrow().len(), 1);
    reopened.remove_connection(&keys, Some(&account)).unwrap();
    assert!(!reopened.has_pending_connection_publication().unwrap());
    assert!(keys.values.borrow().is_empty());
}

#[test]
fn discarding_conflicting_removal_cleans_old_and_current_revision_secrets() {
    for remove in [false, true] {
        let ws = workspace();
        let device = tempfile::tempdir().unwrap();
        let keys = Keys::default();
        let storage = open(ws.path(), device.path());
        let account = id();
        save(&storage, &keys, &account, None, "old", false);
        let before = storage.connection_manifest().unwrap().unwrap();
        let old = before.connections[0].clone();
        let mut after = before.clone();
        after.connections.clear();
        after.selected = None;
        let pending = Publication {
            version: 1,
            phase: PublicationPhase::Publishing,
            before: Some(before.clone()),
            after,
            secret: None,
        };
        let name = storage.pending_name().unwrap().unwrap();
        publish(
            storage.device().unwrap(),
            &name,
            &serde_json::to_vec(&pending).unwrap(),
        )
        .unwrap();
        let replacement = Record {
            id: account.clone(),
            revision: id(),
            config: config(&account, Some("https://synced.invalid/v1")),
        };
        let secret = storage
            .prepare_secret(&keys, &before, &replacement, b"current")
            .unwrap();
        publish(
            storage.device().unwrap(),
            &Storage::secret_name(&before, &replacement),
            &serde_json::to_vec(&secret.envelope).unwrap(),
        )
        .unwrap();
        let mut edited = before.clone();
        edited.connections[0] = replacement.clone();
        storage.publish_manifest(&edited).unwrap();
        assert_eq!(keys.values.borrow().len(), 2);
        assert_eq!(
            storage.recover_connection_publication(&keys).unwrap_err(),
            "native.ai.storage.publicationConflict"
        );
        keys.fail_delete.set(true);
        assert!(
            storage
                .discard_connection_publication(&keys, &account)
                .is_err()
        );
        assert!(storage.has_pending_connection_publication().unwrap());
        assert_eq!(keys.values.borrow().len(), 2);
        keys.fail_delete.set(false);
        if remove {
            storage.remove_connection(&keys, Some(&account)).unwrap();
        } else {
            storage.forget_connection(&keys, &account).unwrap();
            assert_eq!(
                storage.connection_record(&account).unwrap().revision,
                replacement.revision
            );
        }
        assert!(keys.values.borrow().is_empty());
        for record in [&old, &replacement] {
            assert!(
                storage
                    .device()
                    .unwrap()
                    .read_named(&Storage::secret_name(&before, record), 262_144)
                    .unwrap()
                    .is_none()
            );
        }
        assert!(!storage.has_pending_connection_publication().unwrap());
    }
}

#[test]
fn returned_rotation_is_journaled_against_the_captured_record_before_reconciling_local_edits() {
    for change in ["selection", "configuration", "removal"] {
        let ws = workspace();
        let device = tempfile::tempdir().unwrap();
        let keys = Keys::default();
        let storage = open(ws.path(), device.path());
        let _lease = storage.lock_credentials().unwrap();
        let account = id();
        let other = id();
        save(
            &storage,
            &keys,
            &account,
            Some("https://approved.invalid/v1"),
            "original-refresh",
            false,
        );
        save(&storage, &keys, &other, None, "other-refresh", false);
        storage.select_connection(&account).unwrap();
        let captured = storage.connection_manifest().unwrap().unwrap();
        let record = captured
            .connections
            .iter()
            .find(|r| r.id == account)
            .unwrap()
            .clone();
        let original = storage.load_connection(&keys, &account).unwrap().unwrap();
        let other_original = storage.load_connection(&keys, &other).unwrap().unwrap();
        let mut external = captured.clone();
        external.selected = Some(other.clone());
        if change == "configuration" {
            let changed = external
                .connections
                .iter_mut()
                .find(|r| r.id == account)
                .unwrap();
            changed.revision = id();
            changed.config["endpoint"] = Value::String("https://synced.invalid/v1".into());
        } else if change == "removal" {
            external.connections.retain(|r| r.id != account);
        }
        let external_bytes = serde_json::to_vec(&external).unwrap();
        std::fs::write(manifest_path(&storage), &external_bytes).unwrap();
        let rotated = serde_json::to_vec(
            &serde_json::json!({"config":record.config,"key":"returned-rotating-grant"}),
        )
        .unwrap();
        let result = storage.refresh_connection(&keys, &captured, &record, &rotated);
        assert_eq!(
            std::fs::read(manifest_path(&storage)).unwrap(),
            external_bytes
        );
        assert_eq!(
            *storage.load_connection(&keys, &other).unwrap().unwrap(),
            *other_original
        );
        assert_eq!(storage.selected_connection().unwrap().unwrap().id, other);
        if change == "selection" {
            result.unwrap();
            assert_eq!(
                *storage.load_connection(&keys, &account).unwrap().unwrap(),
                rotated
            );
            assert_eq!(keys.values.borrow().len(), 2);
            assert!(!storage.has_pending_connection_publication().unwrap());
        } else {
            assert_eq!(result.unwrap_err(), "native.ai.storage.publicationConflict");
            let reopened = open(ws.path(), device.path());
            let name = format!("publication-{}.json", captured.workspace_id);
            let pending: Publication = serde_json::from_slice(
                &reopened
                    .device()
                    .unwrap()
                    .read_named(&name, 1_048_576)
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
            let secret = pending.secret.as_ref().unwrap();
            assert_eq!(secret.record.id, account);
            assert_eq!(secret.record.revision, record.revision);
            let recovered = Storage::decrypt_bytes(
                &keys,
                &pending.after,
                &secret.record,
                &serde_json::to_vec(&secret.envelope).unwrap(),
            )
            .unwrap();
            assert_eq!(*recovered, rotated);
            assert_eq!(
                *reopened
                    .decrypt_record(&keys, &captured, &record)
                    .unwrap()
                    .unwrap(),
                *original
            );
            assert_eq!(keys.values.borrow().len(), 3);
            assert_eq!(
                reopened.recover_connection_publication(&keys).unwrap_err(),
                "native.ai.storage.publicationConflict"
            );
            assert_eq!(
                std::fs::read(manifest_path(&storage)).unwrap(),
                external_bytes
            );
            reopened.forget_connection(&keys, &account).unwrap();
            assert!(!reopened.has_pending_connection_publication().unwrap());
            assert_eq!(keys.values.borrow().len(), 1);
            assert_eq!(
                *reopened.load_connection(&keys, &other).unwrap().unwrap(),
                *other_original
            );
        }
    }
}

#[test]
fn captured_rotation_cannot_change_destination_or_authorize_a_copied_location() {
    let ws = workspace();
    let copied = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let account = id();
    save(
        &storage,
        &keys,
        &account,
        Some("https://approved.invalid/v1"),
        "original",
        false,
    );
    let captured = storage.connection_manifest().unwrap().unwrap();
    let record = captured.connections[0].clone();
    let original = storage.load(&keys).unwrap().unwrap();
    let mut changed_config = record.config.clone();
    changed_config["endpoint"] = Value::String("https://other.invalid/v1".into());
    let wrong =
        serde_json::to_vec(&serde_json::json!({"config":changed_config,"key":"rotated"})).unwrap();
    assert_eq!(
        storage
            .refresh_connection(&keys, &captured, &record, &wrong)
            .unwrap_err(),
        INVALID
    );
    let copy = open(copied.path(), device.path());
    assert_eq!(
        copy.refresh_connection(&keys, &captured, &record, &original)
            .unwrap_err(),
        ASSOCIATION_REQUIRED
    );
    assert!(!storage.has_pending_connection_publication().unwrap());
    assert_eq!(keys.values.borrow().len(), 1);
    assert_eq!(*storage.load(&keys).unwrap().unwrap(), *original);
}
