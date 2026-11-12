use super::*;
#[path = "ai_connections_failure_tests.rs"]
mod failures;
use std::cell::{Cell, RefCell};

thread_local! { pub(super) static FAIL_MANIFEST: Cell<bool> = const { Cell::new(false) }; }
struct ManifestFailure;
impl ManifestFailure {
    fn new() -> Self {
        FAIL_MANIFEST.set(true);
        Self
    }
}
impl Drop for ManifestFailure {
    fn drop(&mut self) {
        FAIL_MANIFEST.set(false);
    }
}
fn manifest_path(storage: &Storage) -> std::path::PathBuf {
    storage.device().unwrap().location.join(format!(
        "{}-{MANIFEST}",
        storage.workspace_identity().unwrap()
    ))
}
type KeyReadHook = (usize, Box<dyn FnOnce()>);

#[derive(Default)]
struct Keys {
    values: RefCell<BTreeMap<String, Vec<u8>>>,
    gets: Cell<usize>,
    fail_get: Cell<Option<usize>>,
    fail_set: Cell<bool>,
    fail_delete: Cell<bool>,
    on_get: RefCell<Option<KeyReadHook>>,
}
impl KeyStore for Keys {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        let count = self.gets.get() + 1;
        self.gets.set(count);
        if self.fail_get.get() == Some(count) {
            return Err("readback failed".into());
        }
        if self
            .on_get
            .borrow()
            .as_ref()
            .is_some_and(|(at, _)| *at == count)
        {
            let (_, action) = self.on_get.borrow_mut().take().unwrap();
            action();
        }
        self.values
            .borrow()
            .get(account)
            .cloned()
            .ok_or_else(|| "missing key".into())
    }
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
        if self.fail_set.get() {
            return Err("write failed".into());
        }
        assert_eq!(key.len(), 32);
        self.values.borrow_mut().insert(account.into(), key.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        if self.fail_delete.get() {
            return Err("delete failed".into());
        }
        self.values.borrow_mut().remove(account);
        Ok(())
    }
}
fn workspace() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(".situate")).unwrap();
    dir
}
fn open(workspace: &Path, device: &Path) -> Storage {
    Storage::open(&workspace.canonicalize().unwrap(), "window-scope")
        .unwrap()
        .with_device_store(&device.canonicalize().unwrap())
        .unwrap()
}
fn config(id: &str, endpoint: Option<&str>) -> Value {
    serde_json::json!({"provider":if endpoint.is_some() {"custom"} else {"openai"},"connectionId":id,"endpoint":endpoint})
}
fn save(
    storage: &Storage,
    keys: &Keys,
    id: &str,
    endpoint: Option<&str>,
    secret: &str,
    replacing: bool,
) {
    let config = config(id, endpoint);
    let bytes = serde_json::to_vec(&serde_json::json!({"config":config,"key":secret})).unwrap();
    storage
        .save_connection(keys, id, config, &bytes, replacing)
        .unwrap();
}
#[test]
fn independent_accounts_endpoints_selection_and_preferences_reopen_without_workspace_secrets() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let ids = [id(), id(), id(), id()];
    for (index, endpoint) in [
        None,
        None,
        Some("https://one.invalid/v1"),
        Some("https://two.invalid/v1"),
    ]
    .into_iter()
    .enumerate()
    {
        save(
            &storage,
            &keys,
            &ids[index],
            endpoint,
            &format!("synthetic-secret-{index}"),
            false,
        );
        storage
            .save_connection_model(&ids[index], format!("model-{index}").as_bytes())
            .unwrap();
    }
    storage.select_connection(&ids[1]).unwrap();
    let reopened = open(ws.path(), device.path());
    let registry_lock = storage
        .device()
        .unwrap()
        .lock_named("associations.lock")
        .unwrap();
    assert_eq!(reopened.selected_connection().unwrap().unwrap().id, ids[1]);
    drop(registry_lock);
    assert_eq!(
        reopened
            .connection_manifest()
            .unwrap()
            .unwrap()
            .connections
            .len(),
        4
    );
    assert_eq!(
        reopened.read_connection_model(&ids[0]).unwrap().unwrap(),
        b"model-0"
    );
    for file in std::fs::read_dir(ws.path().join(".situate")).unwrap() {
        assert!(
            !String::from_utf8_lossy(&std::fs::read(file.unwrap().path()).unwrap())
                .contains("synthetic-secret")
        );
    }
    assert!(
        String::from_utf8_lossy(&reopened.load(&keys).unwrap().unwrap())
            .contains("synthetic-secret-1")
    );
    reopened.forget_connection(&keys, &ids[1]).unwrap();
    assert!(reopened.load(&keys).unwrap().is_none());
    assert_eq!(
        reopened
            .connection_manifest()
            .unwrap()
            .unwrap()
            .connections
            .len(),
        4
    );
    reopened.remove_connection(&keys, Some(&ids[0])).unwrap();
    assert_eq!(
        reopened
            .connection_manifest()
            .unwrap()
            .unwrap()
            .connections
            .len(),
        3
    );
    assert!(reopened.load_connection(&keys, &ids[2]).unwrap().is_some());
    assert_eq!(keys.values.borrow().len(), 2);
}
#[test]
fn rename_preserves_credentials_preferences_and_other_accounts_even_after_forgetting() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let first = id();
    let second = id();
    save(&storage, &keys, &first, None, "first-secret", false);
    save(&storage, &keys, &second, None, "second-secret", false);
    storage
        .save_connection_settings(&first, b"preferences")
        .unwrap();
    storage.rename_connection(&keys, &first, "Work").unwrap();
    assert_eq!(
        storage.connection_record(&first).unwrap().config["label"],
        "Work"
    );
    assert!(
        String::from_utf8_lossy(&storage.load_connection(&keys, &first).unwrap().unwrap())
            .contains("first-secret")
    );
    assert!(storage.rename_connection(&keys, &second, " work ").is_err());
    assert!(storage.rename_connection(&keys, &first, "  ").is_err());
    assert_eq!(
        storage.read_connection_settings(&first).unwrap().unwrap(),
        b"preferences"
    );
    storage.forget_connection(&keys, &first).unwrap();
    storage
        .rename_connection(&keys, &first, "Personal")
        .unwrap();
    assert_eq!(
        storage.connection_record(&first).unwrap().config["label"],
        "Personal"
    );
    assert!(storage.load_connection(&keys, &first).unwrap().is_none());
    assert!(storage.load_connection(&keys, &second).unwrap().is_some());
    assert_eq!(storage.selected_connection().unwrap().unwrap().id, first);
    storage.remove_connection(&keys, Some(&first)).unwrap();
    assert!(storage.selected_connection().unwrap().is_none());
    assert!(storage.load_connection(&keys, &second).unwrap().is_some());
}
#[test]
fn devices_and_copied_locations_start_empty_without_transferring_access() {
    let ws = workspace();
    let copy = workspace();
    let device_a = tempfile::tempdir().unwrap();
    let device_b = tempfile::tempdir().unwrap();
    let a = open(ws.path(), device_a.path());
    let b = open(ws.path(), device_b.path());
    let copied = open(copy.path(), device_a.path());
    let ka = Keys::default();
    let kb = Keys::default();
    let account = id();
    save(&a, &ka, &account, None, "device-a", false);
    a.save_connection_settings(&account, b"local-defaults")
        .unwrap();
    a.save_conversation_preferences("chat", b"local-override")
        .unwrap();
    let before = std::fs::read(manifest_path(&a)).unwrap();
    for fresh in [&b, &copied] {
        assert!(fresh.connection_manifest().unwrap().is_none());
        assert!(
            fresh
                .read_conversation_preferences("chat")
                .unwrap()
                .is_none()
        );
    }
    save(
        &b,
        &kb,
        &id(),
        Some("https://device-b.invalid/v1"),
        "device-b",
        false,
    );
    save(&copied, &ka, &id(), None, "copied-location", false);
    assert_eq!(std::fs::read(manifest_path(&a)).unwrap(), before);
    assert!(String::from_utf8_lossy(&a.load(&ka).unwrap().unwrap()).contains("device-a"));
    assert!(String::from_utf8_lossy(&b.load(&kb).unwrap().unwrap()).contains("device-b"));
    assert!(
        String::from_utf8_lossy(&copied.load(&ka).unwrap().unwrap()).contains("copied-location")
    );
    assert!(
        std::fs::read_dir(ws.path().join(".situate"))
            .unwrap()
            .next()
            .is_none()
    );
}
#[test]
fn changed_manifest_destination_or_foreign_identity_cannot_redirect_saved_secret() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let account = id();
    save(
        &storage,
        &keys,
        &account,
        Some("https://approved.invalid/v1"),
        "synthetic",
        false,
    );
    let mut manifest = storage.connection_manifest().unwrap().unwrap();
    manifest.connections[0].config["endpoint"] = Value::String("https://other.invalid/v1".into());
    storage.publish_manifest(&manifest).unwrap();
    assert!(storage.load(&keys).is_err());
    assert!(
        storage
            .save_connection(
                &keys,
                &account,
                config(&account, None),
                b"replacement",
                true
            )
            .is_err()
    );
    manifest.workspace_id = id();
    storage.publish_manifest(&manifest).unwrap();
    assert!(storage.load(&keys).unwrap().is_none());
    assert_eq!(keys.values.borrow().len(), 1);
}
#[test]
fn write_and_readback_failures_preserve_prior_secret_and_rotation_retires_only_durable_key() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    let account = id();
    save(&storage, &keys, &account, None, "old", false);
    let old = storage.load(&keys).unwrap().unwrap();
    let rotated =
        serde_json::to_vec(&serde_json::json!({"config":config(&account,None),"key":"rotated"}))
            .unwrap();
    keys.fail_set.set(true);
    assert!(storage.save(&keys, &rotated).is_err());
    keys.fail_set.set(false);
    assert_eq!(*storage.load(&keys).unwrap().unwrap(), *old);
    // Prior decrypt, wrapping-key readback, then staged ciphertext decryption.
    keys.fail_get.set(Some(keys.gets.get() + 3));
    assert!(storage.save(&keys, &rotated).is_err());
    keys.fail_get.set(None);
    assert_eq!(*storage.load(&keys).unwrap().unwrap(), *old);
    let prior_accounts: Vec<_> = keys.values.borrow().keys().cloned().collect();
    storage.save(&keys, &rotated).unwrap();
    assert_eq!(*storage.load(&keys).unwrap().unwrap(), rotated);
    assert!(
        prior_accounts
            .iter()
            .any(|account| !keys.values.borrow().contains_key(account))
    );
}
#[test]
fn corrupt_manifest_and_old_development_records_are_never_imported_or_reset() {
    let ws = workspace();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let storage = open(ws.path(), device.path());
    std::fs::write(
        ws.path().join(".situate/ai-connection.json"),
        b"old opaque data",
    )
    .unwrap();
    assert!(storage.load(&keys).unwrap().is_none());
    std::fs::write(manifest_path(&storage), b"{").unwrap();
    assert!(storage.load(&keys).is_err());
    assert!(
        storage
            .save_connection(&keys, &id(), Value::Null, b"secret", false)
            .is_err()
    );
    assert_eq!(std::fs::read(manifest_path(&storage)).unwrap(), b"{");
    assert_eq!(
        std::fs::read(ws.path().join(".situate/ai-connection.json")).unwrap(),
        b"old opaque data"
    );
}
