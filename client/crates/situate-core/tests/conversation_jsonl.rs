use serde_json::json;
use situate_core::{
    ai_storage::Storage,
    conversation_history::{ACTIVE_HISTORY_LIMIT, ConversationMetadata, HistoryEntry},
};
use std::{fs, io::Write};
fn workspace() -> (tempfile::TempDir, Storage) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    let storage = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
    storage
        .create_conversation_metadata(&ConversationMetadata::new("one", "Work"))
        .unwrap();
    (temp, storage)
}
fn message(id: &str, parent: Option<&str>, text: &str) -> HistoryEntry {
    HistoryEntry::new(
        id,
        parent.map(str::to_owned),
        "message",
        json!({"message":{"role":"user","content":text,"timestamp":1}}),
    )
}
#[test]
fn branch_local_compaction_keeps_originals_once_and_pages_global_offsets() {
    let (temp, storage) = workspace();
    let entries = [
        message("a", None, "A"),
        message("b", Some("a"), "B"),
        message("c", Some("b"), "C"),
        HistoryEntry::new(
            "k",
            Some("c".into()),
            "compaction",
            json!({"summary":"A and B","firstKeptEntryId":"c","runId":"run"}),
        ),
        message("d", Some("k"), "D"),
    ];
    storage
        .append_conversation_entries("one", 0, &entries, Some("d"))
        .unwrap();
    let context = storage.read_conversation_context("one").unwrap().unwrap();
    assert_eq!(
        context
            .entries
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        ["c", "d"]
    );
    assert_eq!(context.message_offset, 2);
    assert!(!context.truncated);
    let page = storage.read_conversation_history("one", None, 2).unwrap();
    assert_eq!(page.message_offset, 3);
    assert_eq!(page.entries[0].id, "k");
    assert_eq!(page.next_before.as_deref(), Some("k"));
    let older = storage
        .read_conversation_history("one", page.next_before.as_deref(), 2)
        .unwrap();
    assert_eq!(older.message_offset, 1);
    assert_eq!(
        older
            .entries
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        ["b", "c"]
    );
    let original = fs::read(temp.path().join(".situate/conversations/one/history.jsonl")).unwrap();
    storage
        .append_conversation_entries(
            "one",
            1,
            &[message("branch", Some("a"), "E")],
            Some("branch"),
        )
        .unwrap();
    let branch = storage.read_conversation_context("one").unwrap().unwrap();
    assert!(branch.compaction.is_none());
    assert_eq!(
        branch
            .entries
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        ["a", "branch"]
    );
    assert!(
        storage
            .is_conversation_ancestor("one", "a", "branch")
            .unwrap()
    );
    assert!(
        !storage
            .is_conversation_ancestor("one", "d", "branch")
            .unwrap()
    );
    assert!(
        fs::read(temp.path().join(".situate/conversations/one/history.jsonl"))
            .unwrap()
            .starts_with(&original)
    );
}
#[test]
fn retry_identity_is_idempotent_but_changed_payload_and_missing_parent_fail_closed() {
    let (temp, storage) = workspace();
    let entry = message("a", None, "A");
    let saved = storage
        .append_conversation_entries("one", 0, std::slice::from_ref(&entry), Some("a"))
        .unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let bytes = fs::read(&path).unwrap();
    assert_eq!(
        storage
            .append_conversation_entries("one", 0, &[entry], Some("a"))
            .unwrap(),
        saved
    );
    assert!(
        storage
            .append_conversation_entries("one", 1, &[message("a", None, "changed")], Some("a"))
            .is_err()
    );
    assert!(
        storage
            .append_conversation_entries("one", 1, &[message("b", Some("missing"), "B")], Some("b"))
            .is_err()
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn incomplete_tail_is_readable_and_preserved_before_repair() {
    let (temp, storage) = workspace();
    storage
        .append_conversation_entries("one", 0, &[message("a", None, "A")], Some("a"))
        .unwrap();
    let dir = temp.path().join(".situate/conversations/one");
    let path = dir.join("history.jsonl");
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(b"{\"version\":1,\"id\":\"broken").unwrap();
    drop(file);
    assert_eq!(
        storage
            .read_conversation_history("one", None, 10)
            .unwrap()
            .entries
            .len(),
        1
    );
    storage
        .append_conversation_entries("one", 1, &[message("b", Some("a"), "B")], Some("b"))
        .unwrap();
    let preserved: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "bin"))
        .collect();
    assert_eq!(preserved.len(), 1);
    assert_eq!(
        fs::read(&preserved[0]).unwrap(),
        b"{\"version\":1,\"id\":\"broken"
    );
    assert_eq!(
        storage
            .read_conversation_history("one", None, 10)
            .unwrap()
            .entries
            .len(),
        2
    );
}
#[test]
fn complete_corruption_is_not_skipped_or_replaced() {
    let (temp, storage) = workspace();
    storage
        .append_conversation_entries("one", 0, &[message("a", None, "A")], Some("a"))
        .unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"not-json\n")
        .unwrap();
    let bytes = fs::read(&path).unwrap();
    assert!(storage.read_conversation_context("one").is_err());
    assert!(
        storage
            .append_conversation_entries("one", 1, &[message("b", Some("a"), "B")], Some("b"))
            .is_err()
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn normal_context_is_bounded_and_old_originals_remain_pageable() {
    let (_temp, storage) = workspace();
    let mut entries = Vec::new();
    for i in 0usize..600 {
        entries.push(message(
            &format!("m{i}"),
            i.checked_sub(1).map(|p| format!("m{p}")).as_deref(),
            "text",
        ));
    }
    storage
        .append_conversation_entries("one", 0, &entries, Some("m599"))
        .unwrap();
    let context = storage.read_conversation_context("one").unwrap().unwrap();
    assert_eq!(context.entries.len(), ACTIVE_HISTORY_LIMIT);
    assert!(context.truncated);
    assert_eq!(context.message_offset, 600 - ACTIVE_HISTORY_LIMIT);
    let older = storage
        .read_conversation_history("one", context.next_before.as_deref(), 100)
        .unwrap();
    assert_eq!(older.entries.len(), 100);
    assert_eq!(older.message_offset, 244);
    assert_eq!(
        storage
            .read_conversation_metadata("one")
            .unwrap()
            .unwrap()
            .message_count,
        600
    );
}
#[test]
fn waiting_inputs_and_unfinished_questions_survive_compaction_without_payload_copies() {
    let (_temp, storage) = workspace();
    let mut input = message("input", None, "Waiting");
    input.data["input"] = json!({"id":"action","kind":"followUp","state":"waiting","attachments":[],"references":[],"timestamp":1});
    let presented = HistoryEntry::new(
        "q",
        Some("input".into()),
        "event",
        json!({"id":"question-event","runId":"run","sequence":1,"type":"question_presented","data":{"id":"question","prompt":"Which?"}}),
    );
    let compaction = HistoryEntry::new(
        "k",
        Some("q".into()),
        "compaction",
        json!({"summary":"Earlier work","firstKeptEntryId":"k","runId":"run"}),
    );
    storage
        .append_conversation_entries("one", 0, &[input, presented, compaction], Some("k"))
        .unwrap();
    let context = storage.read_conversation_context("one").unwrap().unwrap();
    assert!(context.entries.is_empty());
    assert_eq!(
        context
            .active_entries
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        ["input", "q"]
    );
    let status = HistoryEntry::new(
        "consumed",
        Some("k".into()),
        "inputStatus",
        json!({"inputId":"action","state":"consumed"}),
    );
    let done = HistoryEntry::new(
        "done",
        Some("consumed".into()),
        "event",
        json!({"id":"done-event","runId":"run","sequence":2,"type":"question_action_completed","data":{"questionId":"question"}}),
    );
    storage
        .append_conversation_entries("one", 1, &[status, done], Some("done"))
        .unwrap();
    assert!(
        storage
            .read_conversation_context("one")
            .unwrap()
            .unwrap()
            .active_entries
            .is_empty()
    );
}
#[test]
fn history_has_no_sixteen_mib_total_or_result_ceiling() {
    let (temp, storage) = workspace();
    let text = "x".repeat(17 * 1024 * 1024);
    storage
        .append_conversation_entries("one", 0, &[message("large", None, &text)], Some("large"))
        .unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    let before = fs::metadata(&path).unwrap().len();
    storage
        .append_conversation_entries(
            "one",
            1,
            &[message("small", Some("large"), "next")],
            Some("small"),
        )
        .unwrap();
    let after = fs::metadata(path).unwrap().len();
    assert!(after - before < 512);
    assert_eq!(
        storage
            .read_conversation_entry("one", "large")
            .unwrap()
            .unwrap()
            .data["message"]["content"]
            .as_str()
            .unwrap()
            .len(),
        text.len()
    );
}
#[cfg(unix)]
#[test]
fn directories_files_and_locks_reject_symlinks_and_writes_remain_in_held_workspace() {
    use std::os::unix::fs::symlink;
    let (temp, storage) = workspace();
    let external = tempfile::tempdir().unwrap();
    let target = external.path().join("target");
    fs::write(&target, b"outside").unwrap();
    let path = temp.path().join(".situate/conversations/one/history.jsonl");
    fs::remove_file(&path).unwrap();
    symlink(&target, &path).unwrap();
    assert!(storage.read_conversation_context("one").is_err());
    assert!(
        storage
            .append_conversation_entries("one", 0, &[message("a", None, "A")], Some("a"))
            .is_err()
    );
    assert_eq!(fs::read(&target).unwrap(), b"outside");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(storage.read_conversation_context("one").is_err());
    let lock = temp.path().join(".situate/conversations.lock");
    fs::remove_file(&lock).unwrap();
    symlink(&target, &lock).unwrap();
    assert!(storage.read_conversation_metadata("one").is_err());
    assert_eq!(fs::read(&target).unwrap(), b"outside");
}
#[cfg(unix)]
#[test]
fn metadata_failure_keeps_appended_history_and_retry_does_not_duplicate() {
    use std::os::unix::fs::PermissionsExt;
    let (temp, storage) = workspace();
    let dir = temp.path().join(".situate/conversations/one");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let entry = message("a", None, "A");
    let failed =
        storage.append_conversation_entries("one", 0, std::slice::from_ref(&entry), Some("a"));
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(failed.is_err());
    assert_eq!(
        storage
            .read_conversation_metadata("one")
            .unwrap()
            .unwrap()
            .selected_entry_id,
        None
    );
    let before = fs::read(dir.join("history.jsonl")).unwrap();
    assert!(!before.is_empty());
    storage
        .append_conversation_entries("one", 0, &[entry], Some("a"))
        .unwrap();
    assert_eq!(fs::read(dir.join("history.jsonl")).unwrap(), before);
}
