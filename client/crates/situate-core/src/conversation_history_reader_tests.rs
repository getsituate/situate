use super::super::index::SOURCE_READS;
use super::*;
use serde_json::json;
use std::fs;

fn workspace() -> (tempfile::TempDir, Storage) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    let storage = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
    storage.create_conversation("one", "History").unwrap();
    (temp, storage)
}

#[test]
fn selected_reader_uses_linear_source_reads_for_inputs_runs_and_rewinds() {
    for count in [100usize, 1000, 5000] {
        let (_temp, storage) = workspace();
        let mut parent = None;
        let mut entries = Vec::new();
        for i in 0..count {
            let input_id = format!("input-{i}");
            let logical = format!("request-{i}");
            entries.push(HistoryEntry::new(&input_id,parent,"message",json!({"message":{"role":"user","content":format!("Original {i} é🙂"),"timestamp":i},"input":{"id":logical,"kind":"followUp","state":"waiting","attachments":[],"references":[],"timestamp":i}})));
            let status_id = format!("status-{i}");
            let state = ["consumed", "recalled", "waiting"][i % 3];
            entries.push(HistoryEntry::new(
                &status_id,
                Some(input_id.clone()),
                "inputStatus",
                json!({"inputId":logical,"state":state}),
            ));
            let running = format!("running-{i}");
            let completed = format!("completed-{i}");
            let run_id = format!("run-{i}");
            entries.push(HistoryEntry::new(
                &running,
                Some(status_id),
                "run",
                json!({"id":run_id,"state":"running","startedAt":i}),
            ));
            entries.push(HistoryEntry::new(
                &completed,
                Some(running),
                "run",
                json!({"id":run_id,"state":"completed","startedAt":i,"endedAt":i+1}),
            ));
            parent = Some(completed);
            let fork = format!("fork-status-{i}");
            entries.push(HistoryEntry::new(
                &fork,
                Some(input_id),
                "inputStatus",
                json!({"inputId":logical,"state":"recalled"}),
            ));
            entries.push(HistoryEntry::new(
                format!("fork-run-{i}"),
                Some(fork),
                "run",
                json!({"id":run_id,"state":"error","startedAt":i}),
            ));
        }
        let saved = storage
            .append_conversation_entries("one", 0, &entries, parent.as_deref())
            .unwrap();
        drop(entries);
        SOURCE_READS.set(0);
        let mut reader = storage
            .conversation_history_reader("one", Some(saved.revision))
            .unwrap();
        assert_eq!(reader.records, count as u64 * 4);
        assert_eq!(
            reader.offsets.metadata().unwrap().len(),
            count as u64 * 4 * RECORD_BYTES
        );
        for _ in 0..3 {
            reader.rewind().unwrap();
            let (mut visited, mut consumed, mut latest) = (0, 0, 0);
            while let Some(item) = reader.next_entry().unwrap() {
                assert!(!item.entry.id.starts_with("fork"));
                visited += 1;
                if item.entry.kind == "message" && item.input_consumed {
                    consumed += 1;
                }
                if item.latest_run {
                    assert_eq!(item.entry.data["state"], "completed");
                    latest += 1;
                }
            }
            assert_eq!(visited, count * 4);
            assert_eq!(consumed, count.div_ceil(3));
            assert_eq!(latest, count);
        }
        reader.validate().unwrap();
        let reads = SOURCE_READS.get();
        let cache = storage.conversation_indexes.lock().unwrap();
        let hot = cache["one"].positions.len();
        println!(
            "selected_entries={} source_entry_reads={reads} hot_positions={hot} spool_bytes={}",
            count * 4,
            reader.records * RECORD_BYTES
        );
        assert!(reads <= count * 4 * 8);
        assert!(hot <= 1024);
    }
}

#[test]
fn reused_logical_input_ids_use_the_latest_status_on_the_whole_selected_path() {
    let (_temp, storage) = workspace();
    let input = |id: &str, parent: Option<String>| {
        HistoryEntry::new(
            id,
            parent,
            "message",
            json!({"message":{"role":"user","content":id,"timestamp":1},"input":{"id":"request","kind":"followUp","state":"waiting","attachments":[],"references":[],"timestamp":1}}),
        )
    };
    storage
        .append_conversation_entries(
            "one",
            0,
            &[
                input("first", None),
                HistoryEntry::new(
                    "consumed",
                    Some("first".into()),
                    "inputStatus",
                    json!({"inputId":"request","state":"consumed"}),
                ),
                input("duplicate", Some("consumed".into())),
            ],
            Some("duplicate"),
        )
        .unwrap();
    let mut reader = storage.conversation_history_reader("one", None).unwrap();
    let mut consumed = Vec::new();
    while let Some(item) = reader.next_entry().unwrap() {
        if item.input_consumed {
            consumed.push(item.entry.id);
        }
    }
    assert_eq!(consumed, ["first", "duplicate"]);
    reader.validate().unwrap();
    drop(reader);
    storage
        .append_conversation_entries(
            "one",
            1,
            &[HistoryEntry::new(
                "recalled",
                Some("duplicate".into()),
                "inputStatus",
                json!({"inputId":"request","state":"recalled"}),
            )],
            Some("recalled"),
        )
        .unwrap();
    let mut reader = storage.conversation_history_reader("one", None).unwrap();
    while let Some(item) = reader.next_entry().unwrap() {
        assert!(!item.input_consumed);
    }
    reader.validate().unwrap();
}
#[test]
fn iteration_releases_store_locks_and_rejects_changed_revision_or_history() {
    let (temp, storage) = workspace();
    let entry = HistoryEntry::new(
        "original",
        None,
        "message",
        json!({"message":{"role":"user","content":"Saved","timestamp":1}}),
    );
    let saved = storage
        .append_conversation_entries("one", 0, &[entry], Some("original"))
        .unwrap();
    assert!(
        matches!(storage.conversation_history_reader("one",Some(0)),Err(error) if error==CONFLICT)
    );
    let mut reader = storage
        .conversation_history_reader("one", Some(saved.revision))
        .unwrap();
    assert_eq!(reader.next_entry().unwrap().unwrap().entry.id, "original");
    assert!(
        storage
            .read_conversation_entry("one", "original")
            .unwrap()
            .is_some()
    );
    assert!(storage.read_conversation_metadata("one").unwrap().is_some());
    let mut metadata = storage.read_conversation_metadata("one").unwrap().unwrap();
    metadata.title = "Renamed".into();
    storage
        .update_conversation_metadata(&metadata, metadata.revision)
        .unwrap();
    assert_eq!(reader.validate(), Err(CONFLICT.into()));
    drop(reader);
    let mut reader = storage.conversation_history_reader("one", None).unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let mut bytes = fs::read(&path).unwrap();
    bytes[0] = b'!';
    fs::write(&path, &bytes).unwrap();
    assert!(matches!(reader.next_entry(),Err(error) if error==CONFLICT));
    assert!(storage.conversation_history_reader("one", None).is_err());
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn final_validation_detects_replacement_of_the_held_history_file() {
    let (temp, storage) = workspace();
    let entry = HistoryEntry::new(
        "original",
        None,
        "message",
        json!({"message":{"role":"user","content":"Saved","timestamp":1}}),
    );
    storage
        .append_conversation_entries("one", 0, &[entry], Some("original"))
        .unwrap();
    let mut reader = storage.conversation_history_reader("one", None).unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let replacement = path.with_extension("replacement");
    fs::write(&replacement, fs::read(&path).unwrap()).unwrap();
    fs::rename(&replacement, &path).unwrap();
    assert_eq!(reader.next_entry().unwrap().unwrap().entry.id, "original");
    assert_eq!(reader.validate(), Err(CONFLICT.into()));
}
