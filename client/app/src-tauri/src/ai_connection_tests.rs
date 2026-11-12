use super::*;

fn custom(endpoint: &str) -> Config {
    Config {
        connection_id: None,
        label: None,
        http_acknowledgement: None,
        provider: "custom".into(),
        auth: None,
        endpoint: Some(endpoint.into()),
        legacy_model: None,
    }
}
#[test]
fn http_acknowledgement_is_canonical_destination_specific_and_checked_at_dispatch() {
    let mut config = custom("http://EXAMPLE.invalid:80/v1");
    assert!(validate_http_consent(&config, config.endpoint.as_deref().unwrap(), true).is_err());
    assert!(target(&config, "chat").is_err());
    config.http_acknowledgement = Some("http://example.invalid/v1".into());
    validate_http_consent(&config, config.endpoint.as_deref().unwrap(), true).unwrap();
    assert_eq!(
        target(&config, "chat").unwrap().1,
        "http://example.invalid/v1/chat/completions"
    );
    config.endpoint = Some("http://other.invalid/v1".into());
    assert!(target(&config, "chat").is_err());
    config.endpoint = Some("http://example.invalid/v2".into());
    assert!(target(&config, "chat").is_err());
    let local = custom("http://localhost:8888/v1");
    assert!(target(&local, "chat").is_ok());
    assert!(validate_http_consent(&local, local.endpoint.as_deref().unwrap(), true).is_err());
}
#[test]
fn native_ids_are_independent_and_replacement_cannot_claim_another_method_or_unknown_id() {
    let ws = tempfile::tempdir().unwrap();
    std::fs::create_dir(ws.path().join(".situate")).unwrap();
    let device = tempfile::tempdir().unwrap();
    let storage = device_storage(ws.path(), device.path());
    let keys = Keys::default();
    let config = custom("https://one.invalid/v1");
    let (first, replacing) = prepare_config(&storage, config.clone()).unwrap();
    assert!(!replacing);
    let (second, _) = prepare_config(&storage, config).unwrap();
    assert_ne!(first.connection_id, second.connection_id);
    assert!(prepare_config(&storage, first.clone()).is_err());
    storage
        .save_connection(
            &keys,
            first.connection_id.as_deref().unwrap(),
            serde_json::to_value(&first).unwrap(),
            b"synthetic",
            false,
        )
        .unwrap();
    let (third, _) = prepare_config(&storage, custom("https://three.invalid/v1")).unwrap();
    assert_ne!(third.label, first.label);
    let mut duplicate = third;
    duplicate.label = first.label.clone();
    assert!(prepare_config(&storage, duplicate).is_err());
    assert!(prepare_config(&storage, first.clone()).unwrap().1);
    let mut wrong_method = first;
    wrong_method.auth = Some(AuthKind::Oauth);
    assert!(prepare_config(&storage, wrong_method).is_err());
    let invalid = Config {
        label: Some("\n".into()),
        ..custom("https://one.invalid/v1")
    };
    assert!(prepare_config(&storage, invalid).is_err());
}

#[derive(Default)]
struct Keys {
    values: std::cell::RefCell<HashMap<String, Vec<u8>>>,
    gets: std::cell::Cell<usize>,
    fail_get: std::cell::Cell<Option<usize>>,
}
impl KeyStore for Keys {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        let count = self.gets.get() + 1;
        self.gets.set(count);
        if self.fail_get.get() == Some(count) {
            return Err("injected read failure".into());
        }
        self.values
            .borrow()
            .get(account)
            .cloned()
            .ok_or_else(|| "missing key".into())
    }
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
        self.values.borrow_mut().insert(account.into(), key.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.values.borrow_mut().remove(account);
        Ok(())
    }
}
fn device_storage(workspace: &Path, device: &Path) -> Storage {
    Storage::open(&workspace.canonicalize().unwrap(), "test-scope")
        .unwrap()
        .with_device_store(&device.canonicalize().unwrap())
        .unwrap()
}
fn pending_replacement(storage: &Storage, keys: &Keys) -> (String, Vec<u8>) {
    let _lock = storage.lock_credentials().unwrap();
    let id = Storage::new_connection_id();
    let mut config = custom("https://original.invalid/v1");
    config.connection_id = Some(id.clone());
    let data =
        serde_json::to_vec(&serde_json::json!({"config":config,"key":"original-secret"})).unwrap();
    storage
        .save_connection(
            keys,
            &id,
            serde_json::to_value(&config).unwrap(),
            &data,
            false,
        )
        .unwrap();
    config.endpoint = Some("https://replacement.invalid/v1".into());
    let replacement =
        serde_json::to_vec(&serde_json::json!({"config":config,"key":"replacement-secret"}))
            .unwrap();
    keys.fail_get.set(Some(keys.gets.get() + 3));
    assert_eq!(
        storage
            .save_connection(
                keys,
                &id,
                serde_json::to_value(&config).unwrap(),
                &replacement,
                true
            )
            .unwrap_err(),
        "injected read failure"
    );
    keys.fail_get.set(None);
    assert!(storage.has_pending_connection_publication().unwrap());
    (id, replacement)
}
#[test]
fn copied_and_moved_locations_never_claim_the_sources_pending_credentials() {
    let original = tempfile::tempdir().unwrap();
    let copied = tempfile::tempdir().unwrap();
    std::fs::create_dir(original.path().join(".situate")).unwrap();
    std::fs::create_dir(copied.path().join(".situate")).unwrap();
    let device = tempfile::tempdir().unwrap();
    let keys = Keys::default();
    let source = device_storage(original.path(), device.path());
    let (id, replacement) = pending_replacement(&source, &keys);
    let manifest = source.connection_manifest().unwrap().unwrap();
    let journal = device
        .path()
        .join(format!("publication-{}.json", manifest.workspace_id));
    let before = std::fs::read(&journal).unwrap();
    let copy = device_storage(copied.path(), device.path());
    recover_storage(&copy, &keys).unwrap();
    assert!(copy.load(&keys).unwrap().is_none());
    assert!(!copy.has_pending_connection_publication().unwrap());
    assert_eq!(std::fs::read(&journal).unwrap(), before);
    recover_storage(&source, &keys).unwrap();
    assert_eq!(
        *source.load_connection(&keys, &id).unwrap().unwrap(),
        replacement
    );
    // Windows cannot rename a workspace while Storage holds its directory open.
    drop(source);
    let moved = original.path().with_extension("moved");
    std::fs::rename(original.path(), &moved).unwrap();
    let moved_storage = device_storage(&moved, device.path());
    assert!(moved_storage.load(&keys).unwrap().is_none());
    drop(moved_storage);
    std::fs::rename(&moved, original.path()).unwrap();
    assert!(
        device_storage(original.path(), device.path())
            .load(&keys)
            .unwrap()
            .is_some()
    );
}
