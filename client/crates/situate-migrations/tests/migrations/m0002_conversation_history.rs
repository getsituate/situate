use serde_json::Value;
use situate_migrations::{MigrationErrorKind, prepare};
use std::{fs, path::Path};

#[test]
fn public_release_conversations_keep_original_messages_drafts_and_waiting_input() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/m0001/releases");
    for version in ["0.0.1", "0.1.0", "0.1.1", "0.1.2", "0.1.3", "0.1.5"] {
        let root = tempfile::tempdir().unwrap();
        let managed = root.path().join(".situate");
        fs::create_dir(&managed).unwrap();
        let mut original = Value::Null;
        for entry in fs::read_dir(fixtures.join(version)).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            let name = name.strip_suffix(".fixture").unwrap();
            let bytes = fs::read(entry.path()).unwrap();
            if name.starts_with("native-conversation-") {
                original = serde_json::from_slice(&bytes).unwrap();
            }
            fs::write(managed.join(name), bytes).unwrap();
        }
        let _lease = prepare(root.path(), "0.1.6").unwrap();
        let metadata: Value = serde_json::from_slice(
            &fs::read(managed.join("conversations/compatibility/metadata.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(metadata["title"], original["title"]);
        assert_eq!(metadata["legacyDraft"]["text"], original["draft"]);
        let entries: Vec<Value> =
            fs::read_to_string(managed.join("conversations/compatibility/history.jsonl"))
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
        assert_eq!(entries[0]["data"]["message"], original["messages"][0]);
        let queued = entries
            .iter()
            .find(|entry| entry["data"]["input"]["id"] == "queued-1")
            .unwrap();
        assert_eq!(
            queued["data"]["message"]["content"],
            original["runtime"]["pending"][0]["text"]
        );
        assert_eq!(queued["data"]["input"]["state"], "waiting");
        assert_eq!(queued["data"]["input"]["references"], serde_json::json!([]));
    }
}

#[test]
fn numbered_conversion_matches_independent_fixture_and_requires_the_new_app() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join(".situate");
    fs::create_dir(&managed).unwrap();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/m0002");
    fs::copy(
        fixtures.join("before/native-conversation-one.json"),
        managed.join("native-conversation-one.json"),
    )
    .unwrap();
    let lease = prepare(root.path(), "0.1.6").unwrap();
    let actual: Value =
        serde_json::from_slice(&fs::read(managed.join("conversations/one/metadata.json")).unwrap())
            .unwrap();
    let expected: Value = serde_json::from_slice(
        &fs::read(fixtures.join("after/conversations/one/metadata.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(actual, expected);
    let entries = |path| {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        entries(managed.join("conversations/one/history.jsonl")),
        entries(fixtures.join("after/conversations/one/history.jsonl"))
    );
    assert!(!managed.join("native-conversation-one.json").exists());
    drop(lease);
    let before = fs::read(managed.join("conversations/one/history.jsonl")).unwrap();
    assert_eq!(
        prepare(root.path(), "0.1.5").unwrap_err().kind(),
        MigrationErrorKind::UpdateRequired
    );
    let _lease = prepare(root.path(), "0.1.6").unwrap();
    assert_eq!(
        fs::read(managed.join("conversations/one/history.jsonl")).unwrap(),
        before
    );
}
