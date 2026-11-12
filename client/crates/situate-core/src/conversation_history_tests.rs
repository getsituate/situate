use super::*;
use serde_json::json;
use std::fs;
fn workspace() -> (tempfile::TempDir, Storage) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    let storage = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
    storage
        .create_conversation_metadata(&ConversationMetadata::new("one", "Work"))
        .unwrap();
    (temp, storage)
}
fn message(id: &str, parent: Option<&str>) -> HistoryEntry {
    HistoryEntry::new(
        id,
        parent.map(str::to_owned),
        "message",
        json!({"message":{"role":"user","content":id,"timestamp":1}}),
    )
}
#[test]
fn projections_keep_cross_run_order_and_rehydrate_results_outside_active_window() {
    let (_temp, storage) = workspace();
    let result = HistoryEntry::new(
        "result",
        None,
        "message",
        json!({"message":{"role":"toolResult","toolCallId":"call","toolName":"read","content":[{"type":"text","text":"output"}],"details":{"path":"a"},"structuredContent":{"rows":1},"isError":false,"timestamp":1}}),
    );
    let presented = HistoryEntry::new(
        "q",
        Some("result".into()),
        "event",
        json!({"id":"event-1","runId":"run-a","sequence":10,"type":"question_presented","data":{"id":"question","prompt":"Which?"}}),
    );
    let mut entries = vec![result, presented];
    let mut parent = "q".to_string();
    for i in 0..300 {
        let id = format!("gap-{i}");
        entries.push(message(&id, Some(&parent)));
        parent = id;
    }
    let retired = HistoryEntry::new(
        "retired",
        Some(parent),
        "event",
        json!({"id":"event-1","runId":"run-b","sequence":1,"type":"question_superseded","data":{"questionId":"question"}}),
    );
    let end = HistoryEntry::new(
        "end",
        Some("retired".into()),
        "event",
        json!({"id":"event-2","runId":"run-b","sequence":2,"type":"tool_execution_end","data":{"toolCallId":"call","resultEntryId":"result","isError":false}}),
    );
    entries.extend([retired, end]);
    storage
        .append_conversation_entries("one", 0, &entries, Some("end"))
        .unwrap();
    let record = storage.read_conversation("one").unwrap().unwrap();
    let runtime = record.runtime.unwrap();
    assert_eq!(
        runtime
            .events
            .iter()
            .map(|e| (e.run_id.as_str(), e.id.as_str()))
            .collect::<Vec<_>>(),
        [("run-b", "event-1"), ("run-b", "event-2")]
    );
    assert_eq!(
        runtime.events[1].data["result"],
        json!({"content":[{"type":"text","text":"output"}],"details":{"path":"a"},"structuredContent":{"rows":1}})
    );
    let events = [
        HistoryEntry::new(
            "a",
            None,
            "event",
            json!({"id":"same","runId":"first","sequence":10,"type":"question_presented","data":{"id":"old","prompt":"Which?"}}),
        ),
        HistoryEntry::new(
            "b",
            Some("a".into()),
            "event",
            json!({"id":"same","runId":"second","sequence":1,"type":"question_superseded","data":{"questionId":"old"}}),
        ),
    ];
    storage
        .append_conversation_entries("one", 1, &events, Some("b"))
        .unwrap();
    let projected = storage.read_conversation("one").unwrap().unwrap();
    let events = projected.runtime.unwrap().events;
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].run_id, "first");
    assert_eq!(events[1].run_id, "second");
}
#[test]
fn short_writes_are_completed_and_disk_full_keeps_partial_bytes_recoverable() {
    struct Short(Vec<u8>);
    impl Write for Short {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let n = bytes.len().min(2);
            self.0.extend_from_slice(&bytes[..n]);
            Ok(n)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut short = Short(Vec::new());
    append_lines(&mut short, &[b"first\n".to_vec(), b"second\n".to_vec()]).unwrap();
    assert_eq!(short.0, b"first\nsecond\n");
    let (temp, storage) = workspace();
    FAULT.set(Some(Fault::WriteAfter(11)));
    let entry = message("a", None);
    assert_eq!(
        storage.append_conversation_entries("one", 0, std::slice::from_ref(&entry), Some("a")),
        Err(STORAGE.into())
    );
    assert_eq!(
        storage
            .read_conversation_metadata("one")
            .unwrap()
            .unwrap()
            .revision,
        0
    );
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let partial = fs::read(&path).unwrap();
    assert_eq!(partial.len(), 11);
    storage
        .append_conversation_entries("one", 0, &[entry], Some("a"))
        .unwrap();
    let dir = path.parent().unwrap();
    let backup = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.extension().is_some_and(|e| e == "bin"))
        .unwrap();
    assert_eq!(fs::read(backup).unwrap(), partial);
    assert_eq!(
        storage
            .read_conversation_history("one", None, 10)
            .unwrap()
            .entries
            .len(),
        1
    );
}
#[test]
fn failed_sync_and_metadata_publication_preserve_originals_and_retry_identity() {
    for fault in [
        Fault::HistorySync,
        Fault::MetadataSync,
        Fault::MetadataRename,
        Fault::DirectorySync,
    ] {
        let (temp, storage) = workspace();
        FAULT.set(Some(fault));
        let entry = message("a", None);
        assert!(
            storage
                .append_conversation_entries("one", 0, std::slice::from_ref(&entry), Some("a"))
                .is_err()
        );
        let path = temp.path().join(".situate/conversations/one/history.jsonl");
        let bytes = fs::read(&path).unwrap();
        assert!(!bytes.is_empty());
        storage
            .append_conversation_entries("one", 0, &[entry], Some("a"))
            .unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert_eq!(
            storage
                .read_conversation_metadata("one")
                .unwrap()
                .unwrap()
                .selected_entry_id
                .as_deref(),
            Some("a")
        );
    }
    let (_temp, storage) = workspace();
    let mut metadata = storage.read_conversation_metadata("one").unwrap().unwrap();
    metadata.title = "Renamed".into();
    FAULT.set(Some(Fault::DirectorySync));
    assert!(storage.update_conversation_metadata(&metadata, 0).is_err());
    let saved = storage.update_conversation_metadata(&metadata, 0).unwrap();
    assert_eq!(saved.revision, 1);
    let mut changed = metadata;
    changed.title = "Other".into();
    assert_eq!(
        storage.update_conversation_metadata(&changed, 0),
        Err(CONFLICT.into())
    );
}
#[test]
fn failed_partial_backup_flush_does_not_truncate_or_append() {
    let (temp, storage) = workspace();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    fs::write(&path, b"{partial").unwrap();
    FAULT.set(Some(Fault::PartialBackupSync));
    assert!(
        storage
            .append_conversation_entries("one", 0, &[message("a", None)], Some("a"))
            .is_err()
    );
    assert_eq!(fs::read(&path).unwrap(), b"{partial");
    assert_eq!(
        storage
            .read_conversation_metadata("one")
            .unwrap()
            .unwrap()
            .revision,
        0
    );
}
#[test]
fn cache_rebuilds_after_same_length_replacement_and_in_place_edit() {
    let (temp, storage) = workspace();
    storage
        .append_conversation_entries("one", 0, &[message("a", None)], Some("a"))
        .unwrap();
    assert!(
        storage
            .read_conversation_entry("one", "a")
            .unwrap()
            .is_some()
    );
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let original = fs::read(&path).unwrap();
    let alternate = serde_json::to_vec(&message("b", None)).unwrap();
    assert_eq!(original.len(), alternate.len() + 1);
    let replacement = path.with_extension("replacement");
    let mut alternate = alternate;
    alternate.push(b'\n');
    fs::write(&replacement, &alternate).unwrap();
    fs::rename(&replacement, &path).unwrap();
    assert!(
        storage
            .read_conversation_entry("one", "a")
            .unwrap()
            .is_none()
    );
    assert!(storage.read_conversation_context("one").is_err());
    assert_eq!(
        storage
            .read_conversation_entry("one", "b")
            .unwrap()
            .unwrap()
            .id,
        "b"
    );
    fs::write(&path, &original).unwrap();
    assert_eq!(
        storage
            .read_conversation_entry("one", "a")
            .unwrap()
            .unwrap()
            .id,
        "a"
    );
    assert!(
        storage
            .read_conversation_entry("one", "b")
            .unwrap()
            .is_none()
    );
}
#[cfg(unix)]
#[test]
fn hardlinked_history_refuses_append_without_mutating_outside_alias() {
    let (temp, storage) = workspace();
    let external = tempfile::tempdir().unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let alias = external.path().join("alias");
    fs::hard_link(&path, &alias).unwrap();
    assert!(
        storage
            .append_conversation_entries("one", 0, &[message("a", None)], Some("a"))
            .is_err()
    );
    assert!(fs::read(alias).unwrap().is_empty());
}
#[test]
fn action_lookup_and_input_status_follow_selected_ancestry_and_legacy_receipts() {
    let (_temp, storage) = workspace();
    let mut input = message("input", None);
    input.data["input"] = json!({"id":"request","kind":"followUp","state":"waiting","attachments":[],"references":[],"timestamp":1});
    let action = HistoryEntry::new(
        "action",
        Some("input".into()),
        "action",
        json!({"actionId":"request","action":{"type":"submit"}}),
    );
    storage
        .append_conversation_entries("one", 0, &[input, action], Some("action"))
        .unwrap();
    assert_eq!(
        storage
            .find_conversation_input_state("one", "request")
            .unwrap()
            .as_deref(),
        Some("waiting")
    );
    let consumed = HistoryEntry::new(
        "status",
        Some("action".into()),
        "inputStatus",
        json!({"inputId":"request","state":"consumed"}),
    );
    storage
        .append_conversation_entries("one", 1, &[consumed], Some("status"))
        .unwrap();
    assert_eq!(
        storage
            .find_conversation_input_state("one", "request")
            .unwrap()
            .as_deref(),
        Some("consumed")
    );
    let legacy = HistoryEntry::new(
        "legacy-action",
        Some("input".into()),
        "event",
        json!({"id":"event","runId":"legacy","sequence":1,"type":"action_accepted","data":{"action":{"type":"submit"}}}),
    );
    storage
        .append_conversation_entries("one", 2, &[legacy], Some("legacy-action"))
        .unwrap();
    assert!(
        storage
            .find_conversation_action("one", "request")
            .unwrap()
            .is_none()
    );
    let receipt = storage
        .find_conversation_action("one", "legacy")
        .unwrap()
        .unwrap();
    assert_eq!(receipt.kind, "action");
    assert_eq!(
        receipt.data,
        json!({"actionId":"legacy","action":{"type":"submit"}})
    );
    assert_eq!(
        storage
            .find_conversation_input_state("one", "request")
            .unwrap()
            .as_deref(),
        Some("waiting")
    );
}
#[test]
fn lookup_memory_plateaus_while_history_grows_and_normal_appends_do_not_rescan() {
    let (_temp, storage) = workspace();
    let mut parent = None;
    let mut count = 0;
    let mut revision = 0;
    let mut baseline = 0;
    for size in [1000usize, 10000, 50000] {
        while count < size {
            let end = (count + 100).min(size);
            let mut entries = Vec::new();
            for i in count..end {
                let id = format!("entry-{i:08}");
                entries.push(message(&id, parent.as_deref()));
                parent = Some(id);
            }
            storage
                .append_conversation_entries("one", revision, &entries, parent.as_deref())
                .unwrap();
            revision += 1;
            count = end;
        }
        let context = storage.read_conversation_context("one").unwrap().unwrap();
        assert_eq!(context.entries.len(), ACTIVE_HISTORY_LIMIT);
        assert_eq!(context.metadata.message_count, size);
        let cache = storage.conversation_indexes.lock().unwrap();
        let index = &cache["one"];
        let bytes = index.estimated_bytes();
        let (hot, inputs, questions) = index.retained_state();
        println!(
            "entries={size} lookup_estimated_bytes={bytes} hot_positions={hot} context_entries={}",
            context.entries.len()
        );
        assert!(hot <= index::HOT_POSITION_LIMIT);
        assert_eq!((inputs, questions), (0, 0));
        assert_eq!(index.scanned_entries, 0);
        if baseline == 0 {
            baseline = bytes;
        } else {
            assert!(bytes <= baseline + baseline / 4);
        }
    }
}
#[test]
fn settled_inputs_and_questions_leave_no_growing_active_cache_and_evicted_receipts_still_deduplicate()
 {
    let (temp, storage) = workspace();
    let receipt = HistoryEntry::new(
        "receipt",
        None,
        "action",
        json!({"actionId":"request","action":{"type":"submit"}}),
    );
    let mut entries = vec![receipt.clone()];
    let mut parent = Some("receipt".to_owned());
    for i in 0..500 {
        let input_id = format!("input-{i}");
        let mut input = message(&input_id, parent.as_deref());
        input.data["input"] = json!({"id":input_id,"kind":"followUp","state":"waiting","attachments":[],"references":[],"timestamp":1});
        entries.push(input);
        parent = Some(input_id.clone());
        let status_id = format!("status-{i}");
        entries.push(HistoryEntry::new(
            &status_id,
            parent,
            "inputStatus",
            json!({"inputId":input_id,"state":"consumed"}),
        ));
        parent = Some(status_id);
        for kind in [
            "question_presented",
            "question_answered",
            "question_action_completed",
        ] {
            let physical = format!("{kind}-{i}");
            let data = if kind == "question_presented" {
                json!({"id":format!("q-{i}"),"context":{"kind":"synthetic"}})
            } else {
                json!({"questionId":format!("q-{i}")})
            };
            entries.push(HistoryEntry::new(
                &physical,
                parent,
                "event",
                json!({"id":physical,"runId":"run","sequence":i*3,"type":kind,"data":data}),
            ));
            parent = Some(physical);
        }
    }
    storage
        .append_conversation_entries("one", 0, &entries, parent.as_deref())
        .unwrap();
    let context = storage.read_conversation_context("one").unwrap().unwrap();
    assert!(context.active_entries.is_empty());
    {
        let mut cache = storage.conversation_indexes.lock().unwrap();
        let index = cache.get_mut("one").unwrap();
        let (_, inputs, questions) = index.retained_state();
        assert_eq!((inputs, questions), (0, 0));
        index.evict_hot_positions();
    }
    assert_eq!(
        storage
            .find_conversation_action("one", "request")
            .unwrap()
            .unwrap(),
        receipt
    );
    assert_eq!(
        storage
            .find_conversation_input_state("one", "input-0")
            .unwrap()
            .as_deref(),
        Some("consumed")
    );
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let before = fs::read(&path).unwrap();
    storage
        .append_conversation_entries("one", 1, &[receipt], Some("receipt"))
        .unwrap();
    assert_eq!(fs::read(path).unwrap(), before);
}
#[test]
fn missing_corrupt_and_incorrect_lookup_hints_rebuild_without_changing_history() {
    let (temp, storage) = workspace();
    let entries = [
        message("a", None),
        message("b", Some("a")),
        HistoryEntry::new(
            "action",
            Some("b".into()),
            "action",
            json!({"actionId":"request","action":{"type":"submit"}}),
        ),
    ];
    storage
        .append_conversation_entries("one", 0, &entries, Some("action"))
        .unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let bytes = fs::read(&path).unwrap();
    storage
        .conversation_indexes
        .lock()
        .unwrap()
        .get_mut("one")
        .unwrap()
        .remove_cache_file();
    assert_eq!(
        storage
            .read_conversation_entry("one", "a")
            .unwrap()
            .unwrap()
            .id,
        "a"
    );
    storage
        .conversation_indexes
        .lock()
        .unwrap()
        .get_mut("one")
        .unwrap()
        .corrupt_cache_file();
    assert_eq!(
        storage
            .find_conversation_action("one", "request")
            .unwrap()
            .unwrap()
            .id,
        "action"
    );
    {
        let mut cache = storage.conversation_indexes.lock().unwrap();
        let index = cache.get_mut("one").unwrap();
        let wrong = index.positions["b"].offset;
        index.positions.get_mut("a").unwrap().offset = wrong;
    }
    assert_eq!(
        storage
            .read_conversation_entry("one", "a")
            .unwrap()
            .unwrap()
            .id,
        "a"
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn interrupted_cache_update_is_not_proof_that_an_entry_or_action_is_absent() {
    let (temp, storage) = workspace();
    let entries = [message("a", None), message("b", Some("a"))];
    index::fail_cache_after(1);
    assert!(
        storage
            .append_conversation_entries("one", 0, &entries, Some("b"))
            .is_err()
    );
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let prefix = fs::read(&path).unwrap();
    assert_eq!(std::str::from_utf8(&prefix).unwrap().lines().count(), 1);
    storage
        .append_conversation_entries("one", 0, &entries, Some("b"))
        .unwrap();
    let bytes = fs::read(&path).unwrap();
    assert!(bytes.starts_with(&prefix));
    assert_eq!(std::str::from_utf8(&bytes).unwrap().lines().count(), 2);
    let cold = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
    index::fail_cache_after(0);
    assert!(cold.read_conversation_entry("one", "a").is_err());
    assert_eq!(
        cold.read_conversation_entry("one", "a")
            .unwrap()
            .unwrap()
            .id,
        "a"
    );
}
#[test]
fn shared_cache_survives_authorized_handle_reopen_but_not_workspace_identity_changes() {
    use crate::ai_storage::ConversationCache;
    let (temp, storage) = workspace();
    let mut entries = Vec::new();
    let mut parent = None;
    for i in 0..1500 {
        let id = format!("m{i}");
        entries.push(message(&id, parent.as_deref()));
        parent = Some(id);
    }
    storage
        .append_conversation_entries("one", 0, &entries, parent.as_deref())
        .unwrap();
    let handle = ConversationCache::default();
    let first = Storage::open(&temp.path().canonicalize().unwrap(), "test")
        .unwrap()
        .with_conversation_cache(handle.clone());
    first.read_conversation_context("one").unwrap();
    let initial = first.conversation_indexes.lock().unwrap()["one"].scanned_entries;
    assert_eq!(initial, 1500);
    drop(first);
    let next = Storage::open(&temp.path().canonicalize().unwrap(), "test")
        .unwrap()
        .with_conversation_cache(handle.clone());
    next.append_conversation_entries(
        "one",
        1,
        &[message("next", parent.as_deref())],
        Some("next"),
    )
    .unwrap();
    next.read_conversation_context("one").unwrap();
    assert_eq!(
        next.conversation_indexes.lock().unwrap()["one"].scanned_entries,
        initial
    );
    assert_eq!(
        next.read_conversation_entry("one", "m0")
            .unwrap()
            .unwrap()
            .id,
        "m0"
    );
    assert!(
        next.append_conversation_entries("one", 2, &[message("m0", None)], Some("m0"))
            .is_ok()
    );
    let (other, other_storage) = workspace();
    other_storage
        .append_conversation_entries("one", 0, &[message("other", None)], Some("other"))
        .unwrap();
    let other = Storage::open(&other.path().canonicalize().unwrap(), "other-scope")
        .unwrap()
        .with_conversation_cache(handle.clone());
    assert_eq!(
        other
            .read_conversation_context("one")
            .unwrap()
            .unwrap()
            .entries[0]
            .id,
        "other"
    );
    assert!(
        other
            .read_conversation_entry("one", "m0")
            .unwrap()
            .is_none()
    );
    let reopened = Storage::open(&temp.path().canonicalize().unwrap(), "new-scope")
        .unwrap()
        .with_conversation_cache(handle);
    assert_eq!(
        reopened
            .read_conversation_entry("one", "m0")
            .unwrap()
            .unwrap()
            .id,
        "m0"
    );
    assert!(
        reopened
            .read_conversation_entry("one", "other")
            .unwrap()
            .is_none()
    );
}
