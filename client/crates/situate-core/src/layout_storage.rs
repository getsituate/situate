use crate::ai_storage::Storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1collisiondetection::Sha1CD;
use std::path::Path;

#[path = "layout_plugins.rs"]
mod plugins;
pub use plugins::Incarnations;

const FILE: &str = "layout.json";
const FAILED: &str = "native.layout.storage.failed";
const INVALID: &str = "native.layout.storage.invalid";
const CONFLICT: &str = "native.layout.storage.conflict";
pub const MAX_LAYOUT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct Snapshot {
    pub revision: Option<String>,
    pub data: Option<Value>,
    #[serde(rename = "pluginIncarnations")]
    pub plugin_incarnations: Incarnations,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u64,
    generation: String,
    data: Value,
}

pub struct LayoutStorage(Storage);

impl LayoutStorage {
    pub fn open(path: &Path, scope: &str) -> Result<Self, String> {
        Storage::open(path, scope)
            .map(Self)
            .map_err(|_| FAILED.into())
    }

    pub fn load(&self) -> Result<Snapshot, String> {
        let _plugins = self
            .0
            .lock_named_shared("plugin-state.lock")
            .map_err(|_| "native.layout.storage.busy")?;
        match self.read()? {
            None => Ok(Snapshot {
                revision: None,
                data: None,
                plugin_incarnations: Incarnations::new(),
            }),
            Some(bytes) => decode(&bytes, &self.0),
        }
    }

    pub fn save(&self, expected_revision: Option<&str>, data: Value) -> Result<Snapshot, String> {
        self.save_with_plugins(expected_revision, data, &Incarnations::new())
    }

    /// Incarnations must belong to the submitted UI state, not a freshly queried inventory.
    /// Unproven or replaced plugin references are cleared; built-in state is retained.
    pub fn save_with_plugins(
        &self,
        expected_revision: Option<&str>,
        mut data: Value,
        expected_plugins: &Incarnations,
    ) -> Result<Snapshot, String> {
        validate(&data)?;
        if serde_json::to_vec(&data).map_err(|_| INVALID)?.len() as u64 > MAX_LAYOUT_BYTES {
            return Err("native.layout.storage.tooLarge".into());
        }
        let _lock = self
            .0
            .lock_named("layout.lock")
            .map_err(|_| "native.layout.storage.busy")?;
        // Immutable plugin records can be published alongside readers; owner mutation cannot.
        let _plugins = self
            .0
            .lock_named_shared("plugin-state.lock")
            .map_err(|_| "native.layout.storage.busy")?;
        let previous = self.read()?;
        let revision = previous
            .as_deref()
            .map(|bytes| decode(bytes, &self.0))
            .transpose()?
            .and_then(|snapshot| snapshot.revision);
        if revision.as_deref() != expected_revision {
            return Err(CONFLICT.into());
        }
        plugins::store(&self.0.dir, &mut data, expected_plugins)?;
        crate::reference_storage::Projection::Store
            .layout(&mut data, &self.0.scope)
            .map_err(|_| INVALID)?;
        let bytes = serde_json::to_vec(&Envelope {
            version: 1,
            generation: uuid::Uuid::new_v4().to_string(),
            data,
        })
        .map_err(|_| INVALID)?;
        if bytes.len() as u64 > MAX_LAYOUT_BYTES {
            return Err("native.layout.storage.tooLarge".into());
        }
        let saved = decode(&bytes, &self.0)?;
        if let Some(original) = &previous {
            let envelope: Envelope = serde_json::from_slice(original).map_err(|_| INVALID)?;
            if plugins::has_legacy(&envelope.data)? {
                // This inert original host snapshot is never read as plugin installation state.
                let recovery = format!(
                    "layout-legacy-recovery-{}.json",
                    revision.as_deref().ok_or(INVALID)?
                );
                plugins::write_immutable(&self.0.dir, &recovery, original)?;
            }
        }
        if self.read()? != previous {
            return Err(CONFLICT.into());
        }
        let temporary = format!("layout-{}.tmp", uuid::Uuid::new_v4());
        if !self
            .0
            .replace(FILE, &temporary, &bytes)
            .map_err(|_| FAILED)?
        {
            return Err("native.layout.storage.durability".into());
        }
        Ok(saved)
    }

    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        match self.0.dir.symlink_metadata(FILE) {
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => return Err(FAILED.into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(FAILED.into()),
        }
        self.0
            .read_named(FILE, MAX_LAYOUT_BYTES)
            .map_err(|_| FAILED.into())
    }
}

fn validate(data: &Value) -> Result<(), String> {
    let object = data.as_object().ok_or(INVALID)?;
    let version = object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or(INVALID)?;
    if version != 1 {
        return Err("native.layout.storage.unsupported".into());
    }
    if object.len() != 3
        || !data["layout"].is_object()
        || !data["pinnedViews"]
            .as_array()
            .is_some_and(|pins| pins.iter().all(Value::is_string))
    {
        return Err(INVALID.into());
    }
    Ok(())
}

fn decode(bytes: &[u8], storage: &Storage) -> Result<Snapshot, String> {
    let raw = crate::reference_storage_json::decode_layout(bytes).map_err(|_| INVALID)?;
    if raw
        .get("version")
        .and_then(Value::as_u64)
        .is_some_and(|version| version != 1)
    {
        return Err("native.layout.storage.unsupported".into());
    }
    let mut envelope: Envelope = serde_json::from_value(raw).map_err(|_| INVALID)?;
    if envelope.version != 1 || uuid::Uuid::parse_str(&envelope.generation).is_err() {
        return Err(INVALID.into());
    }
    let plugin_incarnations = plugins::load(&storage.dir, &mut envelope.data)?;
    validate(&envelope.data)?;
    crate::reference_storage::Projection::Bind
        .layout(&mut envelope.data, &storage.scope)
        .map_err(|_| INVALID)?;
    let mut hash = Sha1CD::default();
    hash.update(bytes);
    let digest = hash.finalize_cd().map_err(|_| INVALID)?;
    let revision = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(Snapshot {
        revision: Some(revision),
        data: Some(envelope.data),
        plugin_incarnations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn workspace() -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join(".situate")).unwrap();
        directory
    }
    fn open(directory: &tempfile::TempDir) -> LayoutStorage {
        LayoutStorage::open(&directory.path().canonicalize().unwrap(), "test-workspace").unwrap()
    }
    fn data() -> Value {
        json!({"version":1,"layout":{"tabs":[],"activeTabId":null},"pinnedViews":["files"]})
    }

    #[test]
    fn roundtrip_reopen_transfer_and_workspace_isolation() {
        let source = workspace();
        let destination = workspace();
        let store = open(&source);
        assert_eq!(
            store.load().unwrap(),
            Snapshot {
                revision: None,
                data: None,
                plugin_incarnations: Incarnations::new(),
            }
        );
        let saved = store.save(None, data()).unwrap();
        assert_eq!(saved.data, Some(data()));
        assert_eq!(open(&source).load().unwrap(), saved);
        assert_eq!(open(&destination).load().unwrap().data, None);
        fs::copy(
            source.path().join(".situate/layout.json"),
            destination.path().join(".situate/layout.json"),
        )
        .unwrap();
        assert_eq!(open(&destination).load().unwrap(), saved);
    }

    #[test]
    fn stale_creation_update_and_external_byte_changes_conflict() {
        let directory = workspace();
        let store = open(&directory);
        let first = store.save(None, data()).unwrap();
        assert_eq!(store.save(None, data()).unwrap_err(), CONFLICT);
        let second = store.save(first.revision.as_deref(), data()).unwrap();
        assert_ne!(first.revision, second.revision);
        assert_eq!(
            store.save(first.revision.as_deref(), data()).unwrap_err(),
            CONFLICT
        );
        let path = directory.path().join(".situate/layout.json");
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(b' ');
        fs::write(&path, &bytes).unwrap();
        assert_eq!(
            store.save(second.revision.as_deref(), data()).unwrap_err(),
            CONFLICT
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::remove_file(&path).unwrap();
        assert_eq!(
            store.save(second.revision.as_deref(), data()).unwrap_err(),
            CONFLICT
        );
    }

    #[test]
    fn invalid_unknown_oversized_and_failed_saves_preserve_data() {
        let directory = workspace();
        let store = open(&directory);
        let path = directory.path().join(".situate/layout.json");
        let saved = store.save(None, data()).unwrap();
        let original = fs::read(&path).unwrap();
        for invalid in [
            json!(null),
            json!({"version":2}),
            json!({"version":1,"layout":{},"pinnedViews":[1]}),
            json!({"version":1,"layout":{},"pinnedViews":["x".repeat(MAX_LAYOUT_BYTES as usize)]}),
        ] {
            assert!(store.save(saved.revision.as_deref(), invalid).is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        for bytes in [
            b"not json".to_vec(),
            b"{\"version\":99}".to_vec(),
            serde_json::to_vec(&json!({"version":1,"generation":"00000000-0000-4000-8000-000000000001","data":{"version":2,"layout":{},"pinnedViews":[]}})).unwrap(),
            serde_json::to_vec(&json!({"version":1,"generation":"00000000-0000-4000-8000-000000000001","data":{"version":1,"layout":null,"pinnedViews":[]}})).unwrap(),
            vec![b' '; MAX_LAYOUT_BYTES as usize + 1],
        ] {
            fs::write(&path, &bytes).unwrap();
            assert!(store.load().is_err());
            assert!(store.save(None, data()).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(store.save(None, data()).is_err());
        assert!(path.is_dir());
    }

    fn install(directory: &tempfile::TempDir) -> Incarnations {
        let runtime = directory.path().join(".situate/plugins/demo/.runtime");
        fs::create_dir_all(&runtime).unwrap();
        let incarnation = uuid::Uuid::new_v4().to_string();
        fs::write(runtime.join("identity"), &incarnation).unwrap();
        [("demo".into(), incarnation)].into()
    }
    fn plugin_data() -> Value {
        let tab = json!({"id":"tab","panes":[{"id":"pane","navigation":{"entries":[
            {"id":"plugin","target":{"kind":"view","viewId":"demo:board","contentId":"private-item"},"presentation":{"draft":"private-plugin-payload"}},
            {"id":"builtin","target":{"kind":"conversation","conversationId":"chat"},"presentation":{"scroll":21}}
        ],"cursor":0}}],"name":"Topic","conversationIds":["chat"]});
        json!({"version":1,"layout":{"tabs":[tab.clone()],"closedTabs":[{"tab":tab,"index":0}],"activeTabId":"tab"},"pinnedViews":["files","demo:board"]})
    }
    #[test]
    fn plugin_payload_is_local_and_roundtrips_open_and_closed_history_after_restart() {
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        let saved = store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        assert_eq!(saved.data, Some(plugin_data()));
        assert_eq!(saved.plugin_incarnations, owners);
        assert_eq!(open(&directory).load().unwrap(), saved);
        let host = fs::read_to_string(directory.path().join(".situate/layout.json")).unwrap();
        assert!(!host.contains("private-plugin-payload"));
        assert!(!host.contains("private-item"));
        assert!(host.contains("recordId"));
        assert_eq!(
            fs::read_dir(
                directory
                    .path()
                    .join(".situate/plugins/demo/.runtime/presentation")
            )
            .unwrap()
            .count(),
            1
        );
    }
    #[test]
    fn closed_application_deletion_and_reinstall_never_inherit_host_references() {
        for reinstall in [false, true] {
            let directory = workspace();
            let owners = install(&directory);
            let saved = open(&directory)
                .save_with_plugins(None, plugin_data(), &owners)
                .unwrap();
            fs::remove_dir_all(directory.path().join(".situate/plugins/demo")).unwrap();
            if reinstall {
                install(&directory);
            }
            let loaded = open(&directory).load().unwrap();
            let data = loaded.data.unwrap();
            assert_eq!(loaded.revision, saved.revision);
            assert_eq!(data["pinnedViews"], json!(["files"]));
            for tab in [
                &data["layout"]["tabs"][0],
                &data["layout"]["closedTabs"][0]["tab"],
            ] {
                let entries = &tab["panes"][0]["navigation"]["entries"];
                assert_eq!(entries[0]["target"], json!({"kind":"empty"}));
                assert_eq!(entries[0]["presentation"], Value::Null);
                assert_eq!(
                    entries[1],
                    plugin_data()["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][1]
                );
                assert_eq!(tab["conversationIds"], json!(["chat"]));
                assert_eq!(tab["name"], "Topic");
            }
            let late = open(&directory)
                .save_with_plugins(saved.revision.as_deref(), plugin_data(), &owners)
                .unwrap();
            assert_eq!(late.data, Some(data));
            assert!(
                !directory
                    .path()
                    .join(".situate/plugins/demo/.runtime/presentation")
                    .exists()
            );
            if !reinstall {
                assert!(!directory.path().join(".situate/plugins/demo").exists());
            }
        }
    }
    #[test]
    fn conflicting_plugin_save_cannot_overwrite_previously_published_presentation() {
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        let saved = store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        let directory_path = directory
            .path()
            .join(".situate/plugins/demo/.runtime/presentation");
        let records: Vec<_> = fs::read_dir(&directory_path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        let mut replacement = plugin_data();
        replacement["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"] =
            json!("new draft");
        replacement["layout"]["closedTabs"][0]["tab"]["panes"][0]["navigation"]["entries"][0]["presentation"] =
            json!("new closed draft");
        assert_eq!(
            store
                .save_with_plugins(None, replacement, &owners)
                .unwrap_err(),
            CONFLICT
        );
        assert_eq!(open(&directory).load().unwrap(), saved);
        assert_eq!(
            fs::read_dir(&directory_path)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect::<Vec<_>>(),
            records
        );
    }
    #[test]
    fn unrelated_host_saves_reuse_content_addressed_payloads() {
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        let saved = store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        let dir = directory
            .path()
            .join(".situate/plugins/demo/.runtime/presentation");
        let record = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
        let original_payload = fs::read(&record).unwrap();
        let mut changed = saved.data.unwrap();
        changed["layout"]["tabs"][0]["name"] = json!("Renamed topic");
        changed["pinnedViews"] = json!(["files"]);
        let saved = store
            .save_with_plugins(saved.revision.as_deref(), changed.clone(), &owners)
            .unwrap();
        assert_eq!(saved.data, Some(changed.clone()));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        assert_eq!(fs::read(&record).unwrap(), original_payload);
        changed["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"] =
            json!({"draft":"changed"});
        store
            .save_with_plugins(saved.revision.as_deref(), changed, &owners)
            .unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        assert_eq!(fs::read(&record).unwrap(), original_payload);
        let other = workspace();
        let other_owners = install(&other);
        open(&other)
            .save_with_plugins(None, plugin_data(), &other_owners)
            .unwrap();
        let other_record = fs::read_dir(
            other
                .path()
                .join(".situate/plugins/demo/.runtime/presentation"),
        )
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .file_name();
        assert_eq!(record.file_name().unwrap(), other_record);
    }
    #[test]
    fn earlier_random_record_ids_remain_readable_and_upgrade_without_overwriting() {
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        let path = directory.path().join(".situate/layout.json");
        let mut host: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let record = host["data"]["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["target"]["recordId"].as_str().unwrap().to_owned();
        let old_id = uuid::Uuid::new_v4().to_string();
        let dir = directory
            .path()
            .join(".situate/plugins/demo/.runtime/presentation");
        fs::rename(
            dir.join(format!("{record}.json")),
            dir.join(format!("{old_id}.json")),
        )
        .unwrap();
        for tab in ["tabs", "closedTabs"] {
            let tab = if tab == "tabs" {
                &mut host["data"]["layout"]["tabs"][0]
            } else {
                &mut host["data"]["layout"]["closedTabs"][0]["tab"]
            };
            tab["panes"][0]["navigation"]["entries"][0]["target"]["recordId"] = json!(old_id);
        }
        fs::write(&path, serde_json::to_vec(&host).unwrap()).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.data, Some(plugin_data()));
        store
            .save_with_plugins(loaded.revision.as_deref(), loaded.data.unwrap(), &owners)
            .unwrap();
        assert!(dir.join(format!("{old_id}.json")).exists());
        assert!(dir.join(format!("{record}.json")).exists());
        assert_eq!(store.load().unwrap().data, Some(plugin_data()));
    }
    #[cfg(unix)]
    #[test]
    fn unreadable_and_corrupt_surviving_payloads_block_load_and_save_without_erasure() {
        use std::os::unix::fs::symlink;
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        let saved = store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        let host: Value = serde_json::from_slice(
            &fs::read(directory.path().join(".situate/layout.json")).unwrap(),
        )
        .unwrap();
        let record = host["data"]["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["target"]["recordId"].as_str().unwrap();
        let payload = directory.path().join(format!(
            ".situate/plugins/demo/.runtime/presentation/{record}.json"
        ));
        let previous = fs::read(directory.path().join(".situate/layout.json")).unwrap();
        let original_payload = fs::read(&payload).unwrap();
        for corrupt in [
            vec![b' '; MAX_LAYOUT_BYTES as usize + 1],
            b"not json".to_vec(),
            br#"{"target":{"kind":"view","viewId":"demo:board"},"presentation":"tampered"}"#
                .to_vec(),
        ] {
            fs::write(&payload, &corrupt).unwrap();
            assert!(store.load().is_err());
            assert!(
                store
                    .save_with_plugins(saved.revision.as_deref(), plugin_data(), &owners)
                    .is_err()
            );
            assert_eq!(
                fs::read(directory.path().join(".situate/layout.json")).unwrap(),
                previous
            );
            assert_eq!(fs::read(&payload).unwrap(), corrupt);
        }
        fs::write(&payload, &original_payload).unwrap();
        if unsafe { libc::geteuid() } != 0 {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&payload, fs::Permissions::from_mode(0o000)).unwrap();
            assert!(store.load().is_err());
            assert!(
                store
                    .save_with_plugins(saved.revision.as_deref(), plugin_data(), &owners)
                    .is_err()
            );
            fs::set_permissions(&payload, fs::Permissions::from_mode(0o600)).unwrap();
            assert_eq!(
                fs::read(directory.path().join(".situate/layout.json")).unwrap(),
                previous
            );
        }
        let identity = directory
            .path()
            .join(".situate/plugins/demo/.runtime/identity");
        fs::write(&identity, "corrupt identity").unwrap();
        assert!(store.load().is_err());
        assert!(
            store
                .save_with_plugins(saved.revision.as_deref(), plugin_data(), &owners)
                .is_err()
        );
        assert_eq!(
            fs::read(directory.path().join(".situate/layout.json")).unwrap(),
            previous
        );
        fs::write(identity, &owners["demo"]).unwrap();
        assert_eq!(store.load().unwrap(), saved);
        let external = directory.path().join("sentinel");
        fs::write(&external, b"keep").unwrap();
        fs::remove_file(&payload).unwrap();
        symlink(&external, &payload).unwrap();
        assert!(store.load().is_err());
        assert!(
            store
                .save_with_plugins(saved.revision.as_deref(), plugin_data(), &owners)
                .is_err()
        );
        assert_eq!(
            fs::read(directory.path().join(".situate/layout.json")).unwrap(),
            previous
        );
        assert_eq!(fs::read(&external).unwrap(), b"keep");
        let runtime = directory.path().join(".situate/plugins/demo/.runtime");
        fs::remove_dir_all(runtime.join("presentation")).unwrap();
        symlink(directory.path(), runtime.join("presentation")).unwrap();
        assert!(store.load().is_err());
        assert!(
            store
                .save_with_plugins(saved.revision.as_deref(), plugin_data(), &owners)
                .is_err()
        );
        assert_eq!(
            fs::read(directory.path().join(".situate/layout.json")).unwrap(),
            previous
        );
        assert_eq!(fs::read(&external).unwrap(), b"keep");
    }
    #[test]
    fn internal_host_references_cannot_bypass_captured_ownership_on_save() {
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        let saved = store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        let path = directory.path().join(".situate/layout.json");
        let previous = fs::read(&path).unwrap();
        let host: Value = serde_json::from_slice(&previous).unwrap();
        let mut replay = plugin_data();
        replay["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["target"] =
            host["data"]["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["target"]
                .clone();
        assert!(store.save(saved.revision.as_deref(), replay).is_err());
        assert_eq!(fs::read(&path).unwrap(), previous);
        let mut malformed = plugin_data();
        malformed["layout"]["closedTabs"] = json!([1]);
        assert!(store.save(saved.revision.as_deref(), malformed).is_err());
        assert_eq!(fs::read(&path).unwrap(), previous);
    }
    #[test]
    fn unproven_installations_are_not_initialized_or_adopted() {
        let directory = workspace();
        let runtime = directory.path().join(".situate/plugins/demo/.runtime");
        fs::create_dir_all(runtime.parent().unwrap()).unwrap();
        let expected = [("demo".into(), uuid::Uuid::new_v4().to_string())].into();
        let store = open(&directory);
        let saved = store
            .save_with_plugins(None, plugin_data(), &expected)
            .unwrap();
        assert_eq!(
            saved.data.as_ref().unwrap()["pinnedViews"],
            json!(["files"])
        );
        assert!(!runtime.exists());
        fs::create_dir(&runtime).unwrap();
        fs::write(runtime.join("identity"), "not-a-uuid").unwrap();
        let previous = fs::read(directory.path().join(".situate/layout.json")).unwrap();
        assert!(
            store
                .save_with_plugins(saved.revision.as_deref(), plugin_data(), &expected)
                .is_err()
        );
        assert_eq!(
            fs::read(directory.path().join(".situate/layout.json")).unwrap(),
            previous
        );
        assert!(!runtime.join("presentation").exists());
        assert_eq!(fs::read(runtime.join("identity")).unwrap(), b"not-a-uuid");
    }
    #[test]
    fn legacy_plugin_state_is_not_adopted_but_builtin_history_survives() {
        let directory = workspace();
        install(&directory);
        let legacy = serde_json::to_vec(&Envelope {
            version: 1,
            generation: uuid::Uuid::new_v4().to_string(),
            data: plugin_data(),
        })
        .unwrap();
        fs::write(directory.path().join(".situate/layout.json"), &legacy).unwrap();
        let snapshot = open(&directory).load().unwrap();
        let loaded = snapshot.data.unwrap();
        assert_eq!(loaded["pinnedViews"], json!(["files"]));
        assert_eq!(
            loaded["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["target"],
            json!({"kind":"empty"})
        );
        assert_eq!(
            loaded["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][1]["presentation"],
            json!({"scroll":21})
        );
        assert_eq!(
            fs::read(directory.path().join(".situate/layout.json")).unwrap(),
            legacy
        );
        let mut ordinary = loaded;
        ordinary["layout"]["tabs"][0]["name"] = json!("Renamed");
        ordinary["pinnedViews"] = json!([]);
        let saved = open(&directory)
            .save(snapshot.revision.as_deref(), ordinary.clone())
            .unwrap();
        assert_eq!(saved.data, Some(ordinary));
        let recovery = directory.path().join(format!(
            ".situate/layout-legacy-recovery-{}.json",
            snapshot.revision.unwrap()
        ));
        assert_eq!(fs::read(&recovery).unwrap(), legacy);
        assert!(
            !fs::read_to_string(directory.path().join(".situate/layout.json"))
                .unwrap()
                .contains("private-plugin-payload")
        );
        open(&directory)
            .save(saved.revision.as_deref(), saved.data.unwrap())
            .unwrap();
        assert_eq!(fs::read(&recovery).unwrap(), legacy);
    }

    #[test]
    fn failed_legacy_recovery_publication_preserves_the_only_original() {
        let directory = workspace();
        let legacy = serde_json::to_vec(&Envelope {
            version: 1,
            generation: uuid::Uuid::new_v4().to_string(),
            data: plugin_data(),
        })
        .unwrap();
        let path = directory.path().join(".situate/layout.json");
        fs::write(&path, &legacy).unwrap();
        let store = open(&directory);
        let loaded = store.load().unwrap();
        let recovery = directory.path().join(format!(
            ".situate/layout-legacy-recovery-{}.json",
            loaded.revision.as_deref().unwrap()
        ));
        fs::write(&recovery, b"existing unrelated recovery data").unwrap();
        assert!(
            store
                .save(loaded.revision.as_deref(), loaded.data.clone().unwrap())
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), legacy);
        assert_eq!(
            fs::read(&recovery).unwrap(),
            b"existing unrelated recovery data"
        );
        fs::write(&recovery, &legacy).unwrap();
        store
            .save(loaded.revision.as_deref(), loaded.data.unwrap())
            .unwrap();
        assert_eq!(fs::read(&recovery).unwrap(), legacy);
        assert!(!directory.path().join(".situate/plugins").exists());
    }

    #[test]
    fn shared_plugin_guard_allows_layout_reads_and_payload_publication() {
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        let first = store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        let guard = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(directory.path().join(".situate/plugin-state.lock"))
            .unwrap();
        guard.try_lock_shared().unwrap();
        assert_eq!(store.load().unwrap(), first);
        let mut changed = plugin_data();
        changed["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"]["draft"] =
            json!("updated plugin draft");
        let saved = store
            .save_with_plugins(first.revision.as_deref(), changed.clone(), &owners)
            .unwrap();
        assert_eq!(saved.data, Some(changed));
        assert_eq!(store.load().unwrap(), saved);
        assert_eq!(
            crate::plugins::runtime::uninstall(
                &directory.path().canonicalize().unwrap(),
                "demo",
                None
            )
            .unwrap_err(),
            "native.plugins.stateBusy"
        );
    }

    #[test]
    fn exclusive_plugin_mutation_blocks_layout_without_changing_saved_bytes() {
        let directory = workspace();
        let owners = install(&directory);
        let store = open(&directory);
        let saved = store
            .save_with_plugins(None, plugin_data(), &owners)
            .unwrap();
        let bytes = fs::read(directory.path().join(".situate/layout.json")).unwrap();
        let guard = store.0.lock_named("plugin-state.lock").unwrap();
        assert_eq!(store.load().unwrap_err(), "native.layout.storage.busy");
        assert_eq!(
            store
                .save_with_plugins(saved.revision.as_deref(), plugin_data(), &owners)
                .unwrap_err(),
            "native.layout.storage.busy"
        );
        assert_eq!(
            fs::read(directory.path().join(".situate/layout.json")).unwrap(),
            bytes
        );
        drop(guard);
        assert_eq!(store.load().unwrap(), saved);
    }

    #[test]
    fn concurrent_writer_lock_preserves_previous_bytes() {
        let directory = workspace();
        let store = open(&directory);
        let saved = store.save(None, data()).unwrap();
        let _lock = store.0.lock_named("layout.lock").unwrap();
        assert_eq!(
            open(&directory)
                .save(saved.revision.as_deref(), data())
                .unwrap_err(),
            "native.layout.storage.busy"
        );
        assert_eq!(store.load().unwrap(), saved);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_redirect_layout_marker_or_lock() {
        use std::os::unix::fs::symlink;
        let directory = workspace();
        let outside = workspace();
        let target = outside.path().join("sentinel");
        fs::write(&target, b"keep").unwrap();
        let path = directory.path().join(".situate/layout.json");
        symlink(&target, &path).unwrap();
        let store = open(&directory);
        assert!(store.load().is_err());
        assert!(store.save(None, data()).is_err());
        fs::remove_file(&target).unwrap();
        assert!(store.load().is_err());
        assert!(store.save(None, data()).is_err());
        fs::write(&target, b"keep").unwrap();
        fs::remove_file(&path).unwrap();
        fs::remove_file(directory.path().join(".situate/layout.lock")).unwrap();
        symlink(&target, directory.path().join(".situate/layout.lock")).unwrap();
        assert!(store.save(None, data()).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"keep");
        fs::remove_file(directory.path().join(".situate/layout.lock")).unwrap();
        fs::remove_file(directory.path().join(".situate/plugin-state.lock")).unwrap();
        fs::remove_dir(directory.path().join(".situate")).unwrap();
        symlink(
            outside.path().join(".situate"),
            directory.path().join(".situate"),
        )
        .unwrap();
        assert!(
            LayoutStorage::open(&directory.path().canonicalize().unwrap(), "test-workspace")
                .is_err()
        );
    }
}
