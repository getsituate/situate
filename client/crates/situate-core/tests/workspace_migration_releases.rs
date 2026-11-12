use serde_json::json;
use situate_core::{ai_storage::Storage, conversation_history::HistoryEntry};
use std::{fs, path::Path};

#[test]
fn migrated_runtime_opaque_fields_remain_available_after_typed_projection_and_writes() {
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    let mut source:serde_json::Value=serde_json::from_str(include_str!("../../situate-migrations/tests/fixtures/m0001/releases/0.1.3/native-conversation-compatibility.json.fixture")).unwrap();
    source["runtime"]["pending"][0]["opaqueInput"] = json!({"retained":"input"});
    source["runtime"]["events"] = json!([{"id":"event","runId":"run","sequence":1,"type":"custom","data":{"detail":"original"},"opaqueEvent":{"retained":"event"}}]);
    source["runtime"]["runs"] = json!([{"id":"run","state":"completed","startedAt":1,"endedAt":2,"opaqueRun":{"retained":"run"}}]);
    fs::write(
        managed.join("native-conversation-compatibility.json"),
        serde_json::to_vec(&source).unwrap(),
    )
    .unwrap();
    let lease = situate_migrations::prepare(root.path(), "0.1.6").unwrap();
    let store = Storage::open(root.path(), "synthetic").unwrap();
    let record = store.read_conversation("compatibility").unwrap().unwrap();
    assert_eq!(
        record.runtime.as_ref().unwrap().events[0].data,
        json!({"detail":"original"})
    );
    assert_eq!(record.runtime.as_ref().unwrap().runs[0].state, "completed");
    assert_eq!(
        record.runtime.as_ref().unwrap().pending[0].text,
        "Retained queued input"
    );
    let page = store
        .read_conversation_history("compatibility", None, 100)
        .unwrap();
    assert_eq!(
        page.entries
            .iter()
            .find(|e| e.kind == "event")
            .unwrap()
            .data["opaqueEvent"],
        json!({"retained":"event"})
    );
    assert_eq!(
        page.entries.iter().find(|e| e.kind == "run").unwrap().data["opaqueRun"],
        json!({"retained":"run"})
    );
    assert_eq!(
        page.entries
            .iter()
            .find(|e| e.data.get("input").is_some())
            .unwrap()
            .data["input"]["opaqueInput"],
        json!({"retained":"input"})
    );
    let path = managed.join("conversations/compatibility/history.jsonl");
    let bytes = fs::read(&path).unwrap();
    let mut metadata = store
        .read_conversation_metadata("compatibility")
        .unwrap()
        .unwrap();
    metadata.title = "Renamed".into();
    store
        .update_conversation_metadata(&metadata, metadata.revision)
        .unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    drop(store);
    drop(lease);
    let _lease = situate_migrations::prepare(root.path(), "0.1.6").unwrap();
    let store = Storage::open(root.path(), "synthetic").unwrap();
    assert_eq!(
        store
            .read_conversation("compatibility")
            .unwrap()
            .unwrap()
            .runtime,
        record.runtime
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn public_release_conversations_drafts_and_queues_survive_migration_and_reopen() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../situate-migrations/tests/fixtures/m0001/releases");
    for version in ["0.0.1", "0.1.0", "0.1.1", "0.1.2", "0.1.3", "0.1.5"] {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let managed = root.path().join(".situate");
        fs::create_dir(&managed).unwrap();
        for entry in fs::read_dir(fixtures.join(version)).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            fs::write(
                managed.join(name.strip_suffix(".fixture").unwrap()),
                fs::read(entry.path()).unwrap(),
            )
            .unwrap();
        }
        let lease = situate_migrations::prepare(root.path(), "0.1.6").unwrap();
        let metadata = fs::read(managed.join("migrations.json")).unwrap();
        let store = Storage::open(root.path(), "synthetic-qualification").unwrap();
        let record = store.read_conversation("compatibility").unwrap().unwrap();
        assert_eq!(
            record.title, "Synthetic retained conversation",
            "release {version}"
        );
        assert_eq!(record.draft, "written by A", "release {version}");
        assert_eq!(record.messages[0]["content"], "Retained synthetic message");
        let pending = &record.runtime.as_ref().unwrap().pending;
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].text, "Retained queued input");
        assert_eq!(pending[0].state, "pending");
        let history_path = managed.join("conversations/compatibility/history.jsonl");
        let history = fs::read(&history_path).unwrap();
        assert!(
            !managed
                .join("native-conversation-compatibility.json")
                .exists()
        );
        let mut conversation = store
            .read_conversation_metadata("compatibility")
            .unwrap()
            .unwrap();
        conversation.legacy_draft.as_mut().unwrap()["text"] = json!("edited after migration");
        let saved = store
            .update_conversation_metadata(&conversation, conversation.revision)
            .unwrap();
        assert_eq!(fs::read(&history_path).unwrap(), history);
        let continuation = HistoryEntry::new(
            "new-input",
            saved.selected_entry_id,
            "message",
            json!({"message":{"role":"user","content":"Continue after upgrade","timestamp":2}}),
        );
        store
            .append_conversation_entries(
                "compatibility",
                saved.revision,
                &[continuation],
                Some("new-input"),
            )
            .unwrap();
        assert!(fs::read(&history_path).unwrap().starts_with(&history));
        drop(store);
        drop(lease);
        let before_refusal = fs::read(&history_path).unwrap();
        let error = situate_migrations::prepare(root.path(), version).unwrap_err();
        assert_eq!(
            error.kind(),
            situate_migrations::MigrationErrorKind::UpdateRequired
        );
        assert_eq!(error.required_app_version(), Some("0.1.6"));
        assert_eq!(fs::read(&history_path).unwrap(), before_refusal);
        assert_eq!(fs::read(managed.join("migrations.json")).unwrap(), metadata);
        let _reopened = situate_migrations::prepare(root.path(), "0.1.6").unwrap();
        let store = Storage::open(root.path(), "synthetic-qualification").unwrap();
        let record = store.read_conversation("compatibility").unwrap().unwrap();
        assert_eq!(record.draft, "edited after migration");
        assert_eq!(
            record.messages.as_array().unwrap().last().unwrap()["content"],
            "Continue after upgrade"
        );
        assert_eq!(record.runtime.as_ref().unwrap().pending[0].state, "pending");
        assert_eq!(fs::read(managed.join("migrations.json")).unwrap(), metadata);
    }
}
