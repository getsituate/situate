use super::*;
use serde_json::json;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    root
}
fn open(root: &tempfile::TempDir, app: &tempfile::TempDir) -> LayoutStorage {
    let location = crate::workspaces::location(root.path()).unwrap();
    LayoutStorage::open_device(
        Path::new(&location.handle),
        &location.id,
        &app.path().canonicalize().unwrap(),
    )
    .unwrap()
}
fn data() -> Value {
    json!({"version":1,"layout":{"tabs":[],"activeTabId":null,"future":{"value":17}},"pinnedViews":[],"futureDocument":[1,2]})
}
fn legacy(root: &tempfile::TempDir) -> Vec<u8> {
    let value = json!({"version":1,"generation":"00000000-0000-4000-8000-000000000001","data":data(),"futureEnvelope":{"key":"retained"}});
    let mut bytes = serde_json::to_vec_pretty(&value).unwrap();
    bytes.push(b'\n');
    fs::write(root.path().join(".situate/layout.json"), &bytes).unwrap();
    bytes
}

#[test]
fn legacy_migration_preserves_exact_bytes_unknown_fields_and_reopens() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    let bytes = legacy(&root);
    let lease = situate_migrations::prepare(root.path()).unwrap();
    let store = open(&root, &app);
    let loaded = store.load().unwrap();
    lease.validate().unwrap();
    assert_eq!(loaded.data, Some(data()));
    assert_eq!(store.files().dir.read(FILE).unwrap(), bytes);
    assert!(!root.path().join(".situate/layout.json").exists());
    assert_eq!(open(&root, &app).load().unwrap(), loaded);
    store
        .save(loaded.revision.as_deref(), loaded.data.unwrap())
        .unwrap();
    let saved: Value = serde_json::from_slice(&store.files().dir.read(FILE).unwrap()).unwrap();
    assert_eq!(saved["futureEnvelope"], json!({"key":"retained"}));
    assert_eq!(saved["data"], data());
    assert!(!root.path().join(".situate/layout.json").exists());
    #[cfg(unix)]
    {
        use cap_std::fs::PermissionsExt;
        assert_eq!(
            store
                .files()
                .dir
                .dir_metadata()
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            store
                .files()
                .dir
                .metadata(FILE)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn version_one_split_layout_migrates_and_reopens_with_complete_history() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    let document = json!({
        "version":1,
        "pinnedViews":["files"],
        "layout":{
            "activeTabId":"topic",
            "tabs":[{
                "id":"topic","name":"Garden",
                "layout":{"kind":"split","id":"topic-split","axis":"row","ratio":0.6,
                    "first":{"kind":"pane","id":"files-pane"},
                    "second":{"kind":"pane","id":"chat-pane"}},
                "activePaneId":"files-pane","maximizedPaneId":"files-pane",
                "conversationIds":["chat-a"],
                "panes":[{
                    "id":"files-pane","navigation":{"cursor":1,"entries":[
                        {"id":"files-root-entry","target":{"kind":"view","viewId":"files"},"presentation":{"mode":"read","scrollTop":0,"expandedFolders":["notes"]}},
                        {"id":"files-current-entry","target":{"kind":"view","viewId":"files","contentId":"notes/plan.md"},"presentation":{"mode":"source","scrollTop":84,"scrollLeft":12,"selectionStart":8,"selectionEnd":14,"expandedFolders":["notes","notes/projects"]}}
                    ]}
                },{
                    "id":"chat-pane","navigation":{"cursor":0,"entries":[
                        {"id":"chat-entry","target":{"kind":"conversation","conversationId":"chat-a"},"presentation":{"scrollTop":32}}
                    ]}
                }]
            }],
            "closedTabs":[{"index":0,"tab":{
                "id":"closed-topic","name":"Archive",
                "layout":{"kind":"pane","id":"closed-files-pane"},
                "activePaneId":"closed-files-pane","maximizedPaneId":null,"conversationIds":[],
                "panes":[{"id":"closed-files-pane","navigation":{"cursor":0,"entries":[
                    {"id":"closed-file-entry","target":{"kind":"view","viewId":"files","contentId":"notes/archive.md"},"presentation":{"mode":"read","scrollTop":240,"expandedFolders":["notes"]}}
                ]}}]
            }}]
        }
    });
    let bytes = serde_json::to_vec_pretty(&json!({
        "version":1,"generation":"00000000-0000-4000-8000-000000000001","data":document
    }))
    .unwrap();
    fs::write(root.path().join(".situate/layout.json"), &bytes).unwrap();
    let location = crate::workspaces::location(root.path()).unwrap();
    let before = LayoutStorage::open(Path::new(&location.handle), &location.id)
        .unwrap()
        .load()
        .unwrap();
    assert_eq!(before.data, Some(document.clone()));
    let store = open(&root, &app);
    assert_eq!(store.load().unwrap(), before);
    assert_eq!(store.files().dir.read(FILE).unwrap(), bytes);
    assert!(!root.path().join(".situate/layout.json").exists());
    assert_eq!(open(&root, &app).load().unwrap(), before);
    assert_eq!(open(&root, &app).load().unwrap().data, Some(document));
}

#[test]
fn interrupted_migration_recovers_before_and_after_publication_and_removal() {
    for point in ["records", "published", "removed"] {
        let root = workspace();
        let app = tempfile::tempdir().unwrap();
        let original = legacy(&root);
        let store = open(&root, &app);
        device::INTERRUPT.with(|interrupt| interrupt.set(Some(point)));
        let result = store.load();
        device::INTERRUPT.with(|interrupt| interrupt.set(None));
        assert!(result.is_err());
        if point != "removed" {
            assert_eq!(
                fs::read(root.path().join(".situate/layout.json")).unwrap(),
                original
            );
        }
        if point != "records" {
            assert_eq!(store.files().dir.read(FILE).unwrap(), original);
        }
        assert_eq!(open(&root, &app).load().unwrap().data, Some(data()));
        assert_eq!(store.files().dir.read(FILE).unwrap(), original);
        assert!(!root.path().join(".situate/layout.json").exists());
    }
}

#[test]
fn malformed_sources_and_existing_destinations_are_never_reset() {
    for bytes in [
        b"not json".to_vec(),
        b"{\"version\":99}".to_vec(),
        vec![b' '; MAX_LAYOUT_BYTES as usize + 1],
    ] {
        let root = workspace();
        let app = tempfile::tempdir().unwrap();
        fs::write(root.path().join(".situate/layout.json"), &bytes).unwrap();
        let store = open(&root, &app);
        assert!(store.load().is_err());
        assert!(store.save(None, data()).is_err());
        assert_eq!(
            fs::read(root.path().join(".situate/layout.json")).unwrap(),
            bytes
        );
        assert!(!store.files().dir.try_exists(FILE).unwrap());
    }
    for same in [false, true] {
        let root = workspace();
        let app = tempfile::tempdir().unwrap();
        let bytes = legacy(&root);
        let store = open(&root, &app);
        let destination = if same {
            bytes.clone()
        } else {
            b"unreadable destination".to_vec()
        };
        store.files().dir.write(FILE, &destination).unwrap();
        assert_eq!(store.load().is_ok(), same);
        assert_eq!(store.files().dir.read(FILE).unwrap(), destination);
        if !same {
            assert_eq!(
                fs::read(root.path().join(".situate/layout.json")).unwrap(),
                bytes
            );
        }
    }
}

#[test]
fn blocked_publication_and_legacy_writer_lock_preserve_source() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    let bytes = legacy(&root);
    let store = open(&root, &app);
    let lock = store.0.lock_named("layout.lock").unwrap();
    assert_eq!(store.load().unwrap_err(), "native.layout.storage.busy");
    drop(lock);
    store.files().dir.create_dir(FILE).unwrap();
    assert!(store.load().is_err());
    assert_eq!(
        fs::read(root.path().join(".situate/layout.json")).unwrap(),
        bytes
    );
    store.files().dir.remove_dir(FILE).unwrap();
    assert_eq!(store.load().unwrap().data, Some(data()));
}

#[test]
fn copied_workspace_identity_does_not_share_device_layout() {
    let app = tempfile::tempdir().unwrap();
    let source = workspace();
    let copy = workspace();
    fs::write(
        source.path().join(".situate/workspace.json"),
        b"same portable identity",
    )
    .unwrap();
    fs::copy(
        source.path().join(".situate/workspace.json"),
        copy.path().join(".situate/workspace.json"),
    )
    .unwrap();
    let source_store = open(&source, &app);
    let saved = source_store.save(None, data()).unwrap();
    assert_eq!(open(&copy, &app).load().unwrap().data, None);
    assert_eq!(open(&source, &app).load().unwrap(), saved);
    let second_device = tempfile::tempdir().unwrap();
    assert_eq!(open(&source, &second_device).load().unwrap().data, None);
}

#[test]
fn same_location_reopens_with_a_new_authorization_scope_and_rebinds_references() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    let root_path = root.path().canonicalize().unwrap();
    let app_path = app.path().canonicalize().unwrap();
    let original = LayoutStorage::open_device(&root_path, "first-session", &app_path).unwrap();
    let reference = json!({"kind":"live","workspaceId":"first-session","path":"note.md","anchorRevision":"a".repeat(40)});
    let file =
        json!({"target":{"kind":"view","viewId":"files"},"presentation":{"reference":reference}});
    let mut entry = file.clone();
    entry["id"] = json!("entry");
    let tab = json!({"panes":[{"lastFiles":file,"navigation":{"entries":[entry],"cursor":0}}]});
    let data = json!({"version":1,"layout":{"tabs":[tab.clone()],"closedTabs":[{"tab":tab,"index":0}]},"pinnedViews":[]});
    let saved = original.save(None, data.clone()).unwrap();
    let bytes = original.files().dir.read(FILE).unwrap();
    let reopened = LayoutStorage::open_device(&root_path, "second-session", &app_path).unwrap();
    let snapshot = reopened.load().unwrap();
    assert_eq!(snapshot.revision, saved.revision);
    let mut expected = data.clone();
    for tab in ["tabs", "closedTabs"] {
        let tab = if tab == "tabs" {
            &mut expected["layout"][tab][0]
        } else {
            &mut expected["layout"][tab][0]["tab"]
        };
        tab["panes"][0]["lastFiles"]["presentation"]["reference"]["workspaceId"] =
            json!("second-session");
        tab["panes"][0]["navigation"]["entries"][0]["presentation"]["reference"]["workspaceId"] =
            json!("second-session");
    }
    assert_eq!(snapshot.data, Some(expected.clone()));
    assert_eq!(reopened.files().dir.read(FILE).unwrap(), bytes);
    assert_eq!(
        reopened
            .save(snapshot.revision.as_deref(), data)
            .unwrap_err(),
        INVALID
    );
    reopened
        .save(snapshot.revision.as_deref(), expected)
        .unwrap();
    let copy = workspace();
    assert_eq!(
        LayoutStorage::open_device(
            &copy.path().canonicalize().unwrap(),
            "second-session",
            &app_path
        )
        .unwrap()
        .load()
        .unwrap()
        .data,
        None
    );
}

#[test]
fn plugin_records_migrate_and_new_payloads_stay_device_local() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    let owners = super::tests::install(&root);
    let location = crate::workspaces::location(root.path()).unwrap();
    let legacy = LayoutStorage::open(Path::new(&location.handle), &location.id).unwrap();
    let saved = legacy
        .save_with_plugins(None, super::tests::plugin_data(), &owners)
        .unwrap();
    let bytes = fs::read(root.path().join(".situate/layout.json")).unwrap();
    let runtime = root.path().join(".situate/plugins/demo/.runtime");
    fs::create_dir(runtime.join("presentation/nested")).unwrap();
    fs::write(
        runtime.join("presentation/nested/unreachable.json"),
        b"old layout state",
    )
    .unwrap();
    fs::write(runtime.join("domain.json"), b"plugin domain state").unwrap();
    fs::write(
        root.path().join(".situate/layout-legacy-recovery-old.json"),
        b"old inline state",
    )
    .unwrap();
    fs::write(
        root.path().join(".situate/layout-interrupted.tmp"),
        b"incomplete layout",
    )
    .unwrap();
    let store = open(&root, &app);
    device::INTERRUPT.with(|interrupt| interrupt.set(Some("payload-removed")));
    let interrupted = store.load();
    device::INTERRUPT.with(|interrupt| interrupt.set(None));
    assert!(interrupted.is_err());
    assert_eq!(
        fs::read(root.path().join(".situate/layout.json")).unwrap(),
        bytes
    );
    assert_eq!(store.load().unwrap(), saved);
    assert_eq!(store.files().dir.read(FILE).unwrap(), bytes);
    assert!(!runtime.join("presentation").exists());
    assert_eq!(
        fs::read(runtime.join("domain.json")).unwrap(),
        b"plugin domain state"
    );
    assert_eq!(
        fs::read(runtime.join("identity")).unwrap(),
        owners["demo"].as_bytes()
    );
    assert!(
        !root
            .path()
            .join(".situate/layout-legacy-recovery-old.json")
            .exists()
    );
    assert!(!root.path().join(".situate/layout-interrupted.tmp").exists());
    assert_eq!(
        store
            .files()
            .dir
            .read("legacy-layout-recovery/presentation/demo/nested/unreachable.json")
            .unwrap(),
        b"old layout state"
    );
    assert_eq!(
        store
            .files()
            .dir
            .read("legacy-layout-recovery/layout-legacy-recovery-old.json")
            .unwrap(),
        b"old inline state"
    );
    assert_eq!(
        store
            .files()
            .dir
            .read("legacy-layout-recovery/layout-interrupted.tmp")
            .unwrap(),
        b"incomplete layout"
    );
    assert_eq!(open(&root, &app).load().unwrap(), saved);
    let record = store
        .files()
        .dir
        .entries()
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .find(|name| name.to_string_lossy().starts_with("plugin-"))
        .unwrap();
    let payload = store.files().dir.read(&record).unwrap();
    store.files().dir.remove_file(&record).unwrap();
    assert!(store.load().is_err());
    store.files().dir.write(&record, payload).unwrap();
    let mut changed = saved.data.unwrap();
    changed["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"] =
        json!({"draft":"new"});
    let saved = store
        .save_with_plugins(saved.revision.as_deref(), changed.clone(), &owners)
        .unwrap();
    assert_eq!(saved.data, Some(changed));
    assert!(
        !root
            .path()
            .join(".situate/plugins/demo/.runtime/presentation")
            .exists()
    );
    fs::remove_dir_all(root.path().join(".situate/plugins/demo")).unwrap();
    assert!(
        open(&root, &app)
            .load()
            .unwrap()
            .plugin_incarnations
            .is_empty()
    );
}

#[test]
fn completed_migration_does_not_scan_new_workspace_payloads() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    legacy(&root);
    let store = open(&root, &app);
    let loaded = store.load().unwrap();
    let presentation = root
        .path()
        .join(".situate/plugins/demo/.runtime/presentation");
    fs::create_dir_all(&presentation).unwrap();
    fs::write(
        presentation.join("unrelated.json"),
        b"later workspace state",
    )
    .unwrap();
    let temporary = root.path().join(".situate/layout-later.tmp");
    fs::write(&temporary, b"later temporary state").unwrap();
    assert_eq!(open(&root, &app).load().unwrap(), loaded);
    store
        .save(loaded.revision.as_deref(), loaded.data.unwrap())
        .unwrap();
    assert_eq!(
        fs::read(presentation.join("unrelated.json")).unwrap(),
        b"later workspace state"
    );
    assert_eq!(fs::read(&temporary).unwrap(), b"later temporary state");
    store
        .files()
        .dir
        .write(FILE, b"malformed local layout")
        .unwrap();
    assert!(store.load().is_err());
    assert!(store.save(None, data()).is_err());
    assert_eq!(
        store.files().dir.read(FILE).unwrap(),
        b"malformed local layout"
    );
    assert!(presentation.join("unrelated.json").exists());
}

#[test]
fn sidecar_pruning_retains_closed_history_and_never_precedes_commit() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    let owners = super::tests::install(&root);
    let store = open(&root, &app);
    let first = store
        .save_with_plugins(None, super::tests::plugin_data(), &owners)
        .unwrap();
    let records = || {
        store
            .files()
            .dir
            .entries()
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .filter(|name| name.to_string_lossy().starts_with("plugin-"))
            .collect::<Vec<_>>()
    };
    assert_eq!(records().len(), 1);
    let first_raw = store.files().dir.read(FILE).unwrap();
    let mut changed = first.data.clone().unwrap();
    changed["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"] =
        json!({"draft":"second"});
    let second = store
        .save_with_plugins(first.revision.as_deref(), changed.clone(), &owners)
        .unwrap();
    assert_eq!(records().len(), 2);
    assert_eq!(store.load().unwrap(), second);
    let previous_records = records();
    assert_eq!(
        store
            .save_with_plugins(first.revision.as_deref(), changed.clone(), &owners)
            .unwrap_err(),
        CONFLICT
    );
    assert_eq!(records().len(), 2);
    let mut invalid = changed.clone();
    invalid["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"] =
        json!({"draft":"uncommitted"});
    invalid["layout"]["tabs"][0]["panes"][0]["lastFiles"] = json!({"target":{"kind":"view","viewId":"files"},"presentation":{"reference":{"kind":"live","workspaceId":"foreign","path":"note.md","anchorRevision":"a".repeat(40)}}});
    assert_eq!(
        store
            .save_with_plugins(second.revision.as_deref(), invalid, &owners)
            .unwrap_err(),
        INVALID
    );
    assert_eq!(store.load().unwrap(), second);
    for record in previous_records {
        assert!(store.files().dir.try_exists(record).unwrap());
    }
    assert_eq!(records().len(), 3);
    store
        .files()
        .dir
        .create_dir("legacy-layout-recovery")
        .unwrap();
    store
        .files()
        .dir
        .write(
            "legacy-layout-recovery/retained.json",
            b"retained recovery state",
        )
        .unwrap();
    store
        .files()
        .dir
        .write("unrelated.json", b"unrelated state")
        .unwrap();
    let recovery = format!(
        "layout-legacy-recovery-{}.json",
        first.revision.as_deref().unwrap()
    );
    store.files().dir.write(&recovery, &first_raw).unwrap();
    changed["layout"]["closedTabs"] = json!([]);
    let third = store
        .save_with_plugins(second.revision.as_deref(), changed, &owners)
        .unwrap();
    assert_eq!(records().len(), 2);
    assert_eq!(open(&root, &app).load().unwrap(), third);
    assert_eq!(store.files().dir.read(&recovery).unwrap(), first_raw);
    store.files().dir.remove_file(&recovery).unwrap();
    let fourth = store
        .save_with_plugins(third.revision.as_deref(), third.data.unwrap(), &owners)
        .unwrap();
    assert_eq!(records().len(), 1);
    assert_eq!(store.load().unwrap(), fourth);
    assert_eq!(
        store
            .files()
            .dir
            .read("legacy-layout-recovery/retained.json")
            .unwrap(),
        b"retained recovery state"
    );
    assert_eq!(
        store.files().dir.read("unrelated.json").unwrap(),
        b"unrelated state"
    );
}

#[test]
fn remembered_files_references_bind_reopen_and_reject_foreign_locations() {
    let root = workspace();
    let app = tempfile::tempdir().unwrap();
    let location = crate::workspaces::location(root.path()).unwrap();
    let store = open(&root, &app);
    let reference = json!({"kind":"live","workspaceId":location.id,"path":"notes.md","anchorRevision":"a".repeat(40)});
    let pane = json!({"id":"pane","lastFiles":{"entryId":"previous-entry","target":{"kind":"view","viewId":"files"},"presentation":{"reference":reference,"scroll":21}},"navigation":{"entries":[],"cursor":-1}});
    let tab = json!({"id":"tab","panes":[pane]});
    let data = json!({"version":1,"layout":{"tabs":[tab.clone()],"closedTabs":[{"tab":tab,"index":0}]},"pinnedViews":[]});
    let saved = store.save(None, data.clone()).unwrap();
    assert_eq!(open(&root, &app).load().unwrap().data, Some(data.clone()));
    let bytes = store.files().dir.read(FILE).unwrap();
    let persisted: Value = serde_json::from_slice(&bytes).unwrap();
    for tab in [
        &persisted["data"]["layout"]["tabs"][0],
        &persisted["data"]["layout"]["closedTabs"][0]["tab"],
    ] {
        assert_eq!(
            tab["panes"][0]["lastFiles"]["presentation"]["reference"],
            json!({"kind":"live","path":"notes.md","anchorRevision":"a".repeat(40)})
        );
    }
    let mut foreign = data.clone();
    foreign["layout"]["tabs"][0]["panes"][0]["lastFiles"]["presentation"]["reference"]["workspaceId"] =
        json!("foreign");
    assert_eq!(
        store.save(saved.revision.as_deref(), foreign).unwrap_err(),
        INVALID
    );
    assert_eq!(store.files().dir.read(FILE).unwrap(), bytes);
    for target in [
        json!({"kind":"view","viewId":"demo:board"}),
        json!({"kind":"empty"}),
    ] {
        let mut invalid = data.clone();
        invalid["layout"]["closedTabs"][0]["tab"]["panes"][0]["lastFiles"]["target"] = target;
        assert_eq!(
            store.save(saved.revision.as_deref(), invalid).unwrap_err(),
            INVALID
        );
        assert_eq!(store.files().dir.read(FILE).unwrap(), bytes);
    }
    let malformed = String::from_utf8(bytes.clone())
        .unwrap()
        .replace("\"scroll\":21", "\"scroll\":21,\"reference\":null");
    store.files().dir.write(FILE, malformed.as_bytes()).unwrap();
    assert!(store.load().is_err());
    assert_eq!(store.files().dir.read(FILE).unwrap(), malformed.as_bytes());
}

#[test]
#[ignore = "manual native storage timing"]
fn measure_device_layout_roundtrips() {
    for mib in [2, 10, 30] {
        let root = workspace();
        let app = tempfile::tempdir().unwrap();
        let store = open(&root, &app);
        let mut data = data();
        // Include envelope overhead while keeping the serialized document near the ceiling.
        data["layout"]["payload"] = Value::String("x".repeat(mib * 1024 * 1024 - 1024));
        let start = std::time::Instant::now();
        let saved = store.save(None, data.clone()).unwrap();
        let save = start.elapsed();
        let start = std::time::Instant::now();
        let loaded = open(&root, &app).load().unwrap();
        let load = start.elapsed();
        assert_eq!(loaded, saved);
        let bytes = store.files().dir.metadata(FILE).unwrap().len();
        eprintln!(
            "device-local Rust LayoutStorage: bytes={bytes} save_ms={:.2} reopen_load_ms={:.2} roundtrip_ms={:.2}",
            save.as_secs_f64() * 1000.0,
            load.as_secs_f64() * 1000.0,
            (save + load).as_secs_f64() * 1000.0
        );
    }
}
