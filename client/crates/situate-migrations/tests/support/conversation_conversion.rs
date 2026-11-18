use super::*;
use crate::{MigrationDescriptor, runner};
use std::{collections::BTreeMap, fs, path::Path};

const CHAIN: &[MigrationDescriptor] = &[
    MigrationDescriptor::of::<crate::migrations::m0001_workspace_metadata::Migration>(),
    MigrationDescriptor::of::<Migration>(),
];

fn source(id: &str) -> Value {
    json!({"version":2,"id":id,"title":"Retained work","revision":4,
        "messages":[{"role":"user","content":"Original request","timestamp":1}],
        "draft":"Retained draft",
        "runtime":{"draftAttachments":[],"draftReferences":[],"pending":[],"events":[],"runs":[]}})
}

fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn visit(root: &Path, prefix: &Path, result: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(root.join(prefix)).unwrap() {
            let entry = entry.unwrap();
            let path = prefix.join(entry.file_name());
            if path.starts_with(".migrations") {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                visit(root, &path, result);
            } else {
                result.insert(
                    path.to_string_lossy().into_owned(),
                    fs::read(entry.path()).unwrap(),
                );
            }
        }
    }
    let mut result = BTreeMap::new();
    visit(root, Path::new(""), &mut result);
    result
}

#[test]
fn conversion_keeps_original_payloads_opaque_fields_draft_and_waiting_input() {
    let mut record = source("one");
    record["opaque"] = json!({"nested":["untouched",{"flag":true}]});
    record["runtime"]["futureItems"] = json!([{"opaque":1},{"opaque":2}]);
    record["runtime"]["pending"] = json!([
        {"id":"queued","kind":"followUp","state":"pending","text":"Waiting request",
         "attachments":[],"references":[],"timestamp":2,"opaque":"retained"},
        {"id":"consumed","kind":"steering","state":"consumed","text":"Already consumed",
         "attachments":[],"timestamp":0}
    ]);
    record["runtime"]["events"] = json!([
        {"id":"call-event","runId":"run","sequence":1,"type":"tool_intent",
         "data":{"name":"write","args":{"path":"note.md"}}}
    ]);
    record["runtime"]["runs"] = json!([
        {"id":"run","state":"running","startedAt":1,"references":[]}
    ]);
    let (metadata, entries) = convert(&record).unwrap();
    assert_eq!(metadata["legacyDraft"]["text"], "Retained draft");
    assert_eq!(metadata["messageCount"], 2);
    assert_eq!(metadata["eventCount"], 1);
    assert_eq!(entries[0]["data"]["message"], record["messages"][0]);
    let waiting = entries
        .iter()
        .find(|entry| entry["data"]["input"]["id"] == "queued")
        .unwrap();
    assert_eq!(waiting["data"]["message"]["content"], "Waiting request");
    assert_eq!(waiting["data"]["input"]["state"], "waiting");
    assert_eq!(waiting["data"]["input"]["opaque"], "retained");
    assert!(waiting["data"]["input"].get("text").is_none());
    assert_eq!(
        entries
            .iter()
            .find(|entry| entry["type"] == "event")
            .unwrap()["data"],
        record["runtime"]["events"][0]
    );
    assert_eq!(
        entries.iter().find(|entry| entry["type"] == "run").unwrap()["data"]["state"],
        "running"
    );
    assert!(
        entries
            .iter()
            .any(|entry| entry["data"]["field"] == "opaque"
                && entry["data"]["value"] == record["opaque"])
    );
    assert_eq!(
        entries
            .iter()
            .filter(|entry| entry["data"]["field"] == "futureItems")
            .count(),
        2
    );
    assert!(
        entries
            .iter()
            .any(|entry| entry["data"]["value"]["id"] == "consumed")
    );
}

#[test]
fn compaction_references_originals_and_retain_none_references_itself() {
    for (count, expected) in [(0, "migration-1"), (1, "migration-2")] {
        let mut record = source("one");
        record["runtime"]["checkpoint"] =
            json!({"sourceCount":count,"summary":"Prior work","runId":"run"});
        let (_, entries) = convert(&record).unwrap();
        let compaction = entries
            .iter()
            .find(|entry| entry["type"] == "compaction")
            .unwrap();
        assert_eq!(compaction["data"]["firstKeptEntryId"], expected);
        assert_eq!(
            entries
                .iter()
                .filter(|entry| entry["type"] == "message")
                .count(),
            1
        );
    }
    let mut record = source("one");
    record["runtime"]["checkpoint"] =
        json!({"sourceCount":2,"summary":"Invalid boundary","runId":"run"});
    assert!(convert(&record).is_err());
}

#[test]
fn late_invalid_conversation_restores_all_sources_and_other_managed_data() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    fs::write(
        managed.join("native-conversation-a.json"),
        serde_json::to_vec(&source("a")).unwrap(),
    )
    .unwrap();
    fs::write(managed.join("native-conversation-z.json"), b"{broken").unwrap();
    fs::write(managed.join("opaque.bin"), [0, 255, 4]).unwrap();
    fs::write(root.path().join("user.md"), "Outside managed state").unwrap();
    let before = tree(&managed);
    assert!(runner::prepare_with(root.path(), "0.1.6", CHAIN).is_err());
    assert_eq!(tree(&managed), before);
    assert_eq!(
        fs::read_to_string(root.path().join("user.md")).unwrap(),
        "Outside managed state"
    );
    assert!(runner::prepare_with(root.path(), "0.1.6", CHAIN).is_err());
    assert_eq!(tree(&managed), before);
}

#[test]
fn successful_conversion_preserves_all_chats_and_reopening_does_not_repeat_it() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    for id in ["a", "z"] {
        fs::write(
            managed.join(format!("native-conversation-{id}.json")),
            serde_json::to_vec(&source(id)).unwrap(),
        )
        .unwrap();
    }
    fs::write(managed.join("opaque.bin"), [0, 255, 4]).unwrap();
    let lease = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap();
    assert!(!managed.join("native-conversation-a.json").exists());
    assert!(managed.join("conversations/a/history.jsonl").is_file());
    assert!(managed.join("conversations/z/history.jsonl").is_file());
    assert_eq!(fs::read(managed.join("opaque.bin")).unwrap(), [0, 255, 4]);
    let metadata: Value =
        serde_json::from_slice(&fs::read(managed.join("migrations.json")).unwrap()).unwrap();
    assert_eq!(
        metadata,
        json!({"minimumAppVersion":"0.1.6","lastAppliedMigration":2})
    );
    let converted = tree(&managed);
    drop(lease);
    let _lease = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap();
    assert_eq!(tree(&managed), converted);
}

fn already_structured_workspace() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    let conversations = managed.join("conversations");
    fs::create_dir_all(conversations.join("one")).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/m0002/after");
    for file in ["metadata.json", "history.jsonl"] {
        let path = format!("conversations/one/{file}");
        fs::copy(fixture.join(&path), managed.join(path)).unwrap();
    }
    fs::write(conversations.join(".DS_Store"), [0, 255]).unwrap();
    fs::write(conversations.join("retained"), "not a directory").unwrap();
    fs::create_dir(conversations.join("old.backup")).unwrap();
    fs::write(conversations.join("old.backup/metadata.json"), b"{broken").unwrap();
    root
}

#[test]
fn already_structured_conversations_migrate_without_altering_unrelated_siblings() {
    let root = already_structured_workspace();
    let managed = root.path().join(".situate");
    let original = tree(&managed);
    let lease = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap();
    let migrated = tree(&managed);
    let mut records = migrated.clone();
    let metadata: Value =
        serde_json::from_slice(&records.remove("migrations.json").unwrap()).unwrap();
    assert_eq!(metadata["lastAppliedMigration"], 2);
    assert_eq!(records, original);
    drop(lease);
    let _reopened = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap();
    assert_eq!(tree(&managed), migrated);
}

#[test]
fn unrelated_siblings_do_not_mask_corrupt_or_missing_conversation_records() {
    use std::error::Error;

    for corrupt in [true, false] {
        let root = already_structured_workspace();
        let managed = root.path().join(".situate");
        let history = managed.join("conversations/one/history.jsonl");
        if corrupt {
            fs::write(&history, b"{broken\n").unwrap();
        } else {
            fs::remove_file(&history).unwrap();
        }
        let original = tree(&managed);
        let error = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap_err();
        assert_eq!(error.kind(), MigrationErrorKind::MigrationFailed);
        if !corrupt {
            assert_eq!(
                error
                    .source()
                    .unwrap()
                    .downcast_ref::<std::io::Error>()
                    .unwrap()
                    .kind(),
                std::io::ErrorKind::NotFound
            );
        }
        assert_eq!(tree(&managed), original);
    }
}

#[cfg(unix)]
#[test]
fn validation_never_follows_a_valid_id_symlink() {
    use crate::Migration as _;
    use cap_std::{ambient_authority, fs::Dir};

    let root = already_structured_workspace();
    let managed = root.path().join(".situate");
    let link = managed.join("conversations/one");
    let target = root.path().join("outside");
    fs::rename(&link, &target).unwrap();
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let managed = Dir::open_ambient_dir(managed, ambient_authority()).unwrap();
    // Backup rejects links independently; exercise the validator itself here.
    let error = Migration::validate(&MigrationWorkspace { managed: &managed }).unwrap_err();
    assert_eq!(error.kind(), MigrationErrorKind::UnsafePath);
    assert_eq!(fs::read_link(link).unwrap(), target);
}

#[test]
fn fixtures_match_independent_target_records() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/m0002");
    let before: Value = serde_json::from_slice(
        &fs::read(fixtures.join("before/native-conversation-one.json")).unwrap(),
    )
    .unwrap();
    let (metadata, entries) = convert(&before).unwrap();
    let expected_metadata: Value = serde_json::from_slice(
        &fs::read(fixtures.join("after/conversations/one/metadata.json")).unwrap(),
    )
    .unwrap();
    let expected_entries: Vec<Value> =
        fs::read_to_string(fixtures.join("after/conversations/one/history.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
    assert_eq!(metadata, expected_metadata);
    assert_eq!(entries, expected_entries);
}

#[test]
fn conversion_crash_child() {
    let Ok(root) = std::env::var("SITUATE_CONVERSATION_CONVERSION_ROOT") else {
        return;
    };
    runner::prepare_with(Path::new(&root), "0.1.6", CHAIN).unwrap();
}

#[test]
fn interrupted_conversion_and_source_cleanup_restore_then_convert_once() {
    for point in ["conversation-converted", "conversation-source-removed"] {
        let root = tempfile::tempdir().unwrap();
        let managed = root.path().join(".situate");
        fs::create_dir(&managed).unwrap();
        for id in ["a", "z"] {
            fs::write(
                managed.join(format!("native-conversation-{id}.json")),
                serde_json::to_vec(&source(id)).unwrap(),
            )
            .unwrap();
        }
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "migrations::m0002_conversation_history::tests::conversion_crash_child",
            ])
            .env("SITUATE_CONVERSATION_CONVERSION_ROOT", root.path())
            .env("SITUATE_MIGRATION_TEST_CRASH", point)
            .status()
            .unwrap();
        assert_eq!(child.code(), Some(73), "{point}");
        assert!(managed.join(".migrations/backup.tar").is_file());
        let lease = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap();
        for id in ["a", "z"] {
            let lines =
                fs::read_to_string(managed.join(format!("conversations/{id}/history.jsonl")))
                    .unwrap();
            let entries: Vec<Value> = lines
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            assert_eq!(
                entries
                    .iter()
                    .filter(|entry| entry["type"] == "message")
                    .count(),
                1
            );
            assert!(
                !managed
                    .join(format!("native-conversation-{id}.json"))
                    .exists()
            );
        }
        assert!(!managed.join(".migrations/backup.tar").exists());
        let saved = tree(&managed);
        drop(lease);
        let _lease = runner::prepare_with(root.path(), "0.1.6", CHAIN).unwrap();
        assert_eq!(tree(&managed), saved);
    }
}

#[cfg(unix)]
#[test]
fn legacy_symlink_cannot_be_read_or_replaced_by_conversion() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    let outside = root.path().join("private.json");
    fs::write(&outside, serde_json::to_vec(&source("one")).unwrap()).unwrap();
    std::os::unix::fs::symlink(&outside, managed.join("native-conversation-one.json")).unwrap();
    let original = fs::read(&outside).unwrap();
    assert!(runner::prepare_with(root.path(), "0.1.6", CHAIN).is_err());
    assert_eq!(fs::read(&outside).unwrap(), original);
}
