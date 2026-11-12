use super::*;

fn seed(host: &Fixture, rows: Vec<(&str, &str, Value)>) {
    let metadata = host
        .storage
        .read_conversation_metadata("chat")
        .unwrap()
        .unwrap();
    let mut parent = metadata.selected_entry_id;
    let entries: Vec<_> = rows
        .into_iter()
        .map(|(id, kind, data)| {
            let entry = HistoryEntry::new(id, parent.clone(), kind, data);
            parent = Some(id.to_owned());
            entry
        })
        .collect();
    host.storage
        .append_conversation_entries("chat", metadata.revision, &entries, parent.as_deref())
        .unwrap();
}

async fn finish(owner: &Owner<Fixture>) -> Snapshot {
    tokio::time::timeout(std::time::Duration::from_secs(5), owner.settled())
        .await
        .expect("owner did not settle")
        .unwrap()
}

#[tokio::test]
async fn recalled_originals_are_history_only_after_submit_and_reopen() {
    let host = Fixture::new();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false), turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner.apply("queued".into(), json!({"version":1,"type":"enqueue","kind":"followUp","input":{"text":"Recalled request","attachments":[],"references":[]},"timestamp":1})).await.unwrap();
    owner
        .apply("recall".into(), json!({"version":1,"type":"recall"}))
        .await
        .unwrap();
    owner
        .submit("new".into(), "New request".into(), 2)
        .await
        .unwrap();
    finish(&owner).await;
    let reopened = Owner::open(host.clone()).await.unwrap();
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    reopened
        .submit("later".into(), "Later request".into(), 3)
        .await
        .unwrap();
    finish(&reopened).await;
    for context in host.model_inputs.lock().unwrap().iter() {
        assert!(
            !context
                .iter()
                .any(|message| message["content"] == "Recalled request")
        );
    }
    let history = host
        .storage
        .read_conversation_history("chat", None, 1000)
        .unwrap();
    assert_eq!(
        history
            .entries
            .iter()
            .filter(|entry| entry.kind == "message"
                && entry.data["message"]["content"] == "Recalled request")
            .count(),
        1
    );
    assert_eq!(
        host.storage
            .find_conversation_input_state("chat", "queued")
            .unwrap()
            .as_deref(),
        Some("recalled")
    );
}

#[tokio::test]
async fn published_queue_with_migration_identity_and_omitted_references_is_consumed_once() {
    let published: Value = serde_json::from_str(include_str!("../../situate-migrations/tests/fixtures/m0001/releases/0.1.3/native-conversation-compatibility.json.fixture")).unwrap();
    let mut input = published["runtime"]["pending"][0].clone();
    assert!(input.get("references").is_none());
    let text = input.as_object_mut().unwrap().remove("text").unwrap();
    input["state"] = json!("waiting");
    let host = Fixture::new();
    seed(
        &host,
        vec![(
            "migration-4",
            "message",
            json!({"message":{"role":"user","content":text,"timestamp":1},"input":input}),
        )],
    );
    *host.turns.lock().unwrap() = VecDeque::from([turn(false), turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    assert!(
        owner
            .snapshot()
            .await
            .unwrap()
            .record
            .runtime
            .as_ref()
            .unwrap()
            .pending[0]
            .references
            .is_empty()
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    owner
        .submit("fresh".into(), "Fresh request".into(), 2)
        .await
        .unwrap();
    finish(&owner).await;
    let contexts = host.model_inputs.lock().unwrap();
    assert_eq!(contexts.len(), 2);
    assert!(!contexts[0].iter().any(|message| message["content"] == text));
    assert_eq!(
        contexts[1]
            .iter()
            .filter(|message| message["content"] == text)
            .count(),
        1
    );
    assert_eq!(
        host.storage
            .find_conversation_input_state("chat", "queued-1")
            .unwrap()
            .as_deref(),
        Some("consumed")
    );
    assert_eq!(
        host.storage
            .find_conversation_entry("chat", "migration-4")
            .unwrap()
            .unwrap()
            .data["message"]["content"],
        text
    );
}

#[tokio::test]
async fn full_legacy_action_receipts_replay_without_an_inferred_input_entry() {
    let host = Fixture::new();
    let raw = json!({"version":1,"type":"submit","input":{"text":"Published request","attachments":[],"references":[]},"timestamp":1});
    seed(
        &host,
        vec![(
            "migration-receipt",
            "event",
            json!({"id":"accepted","runId":"published","sequence":1,"type":"action_accepted","data":{"action":raw}}),
        )],
    );
    let owner = Owner::open(host.clone()).await.unwrap();
    owner.apply("published".into(), raw.clone()).await.unwrap();
    let mut changed = raw;
    changed["input"]["text"] = json!("Changed request");
    assert_eq!(
        owner.apply("published".into(), changed).await.unwrap_err(),
        "native.ai.conversation.conflict"
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_tool_result_is_appended_once_and_its_event_references_the_original() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Write it".into(), 1)
        .await
        .unwrap();
    finish(&owner).await;
    let page = host
        .storage
        .read_conversation_history("chat", None, 1000)
        .unwrap();
    let results: Vec<_> = page
        .entries
        .iter()
        .filter(|entry| entry.kind == "message" && entry.data["message"]["role"] == "toolResult")
        .collect();
    assert_eq!(results.len(), 1);
    let end = page
        .entries
        .iter()
        .find(|entry| entry.kind == "event" && entry.data["type"] == "tool_execution_end")
        .unwrap();
    assert!(end.data["data"].get("result").is_none());
    assert_eq!(end.data["data"]["resultEntryId"], results[0].id);
    let accepted = page
        .entries
        .iter()
        .find(|entry| entry.kind == "event" && entry.data["type"] == "input_accepted")
        .unwrap();
    assert!(accepted.data["data"].get("input").is_none());
    let reopened = Owner::open(host.clone()).await.unwrap();
    assert_eq!(
        reopened
            .snapshot()
            .await
            .unwrap()
            .record
            .runtime
            .unwrap()
            .events
            .iter()
            .find(|event| event.kind == "tool_execution_end")
            .unwrap()
            .data["result"]["details"]["saved"],
        true
    );
}

#[tokio::test]
async fn a_submitted_legacy_draft_is_cleared_only_after_durable_acceptance() {
    let host = Fixture::new();
    let mut metadata = host
        .storage
        .read_conversation_metadata("chat")
        .unwrap()
        .unwrap();
    metadata.legacy_draft = Some(json!({"text":"Retained draft","attachments":[],"references":[]}));
    host.storage
        .update_conversation_metadata(&metadata, metadata.revision)
        .unwrap();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    assert_eq!(
        owner.snapshot().await.unwrap().record.draft,
        "Retained draft"
    );
    host.fail_at("input", false);
    assert!(
        owner
            .submit("run".into(), "Retained draft".into(), 1)
            .await
            .is_err()
    );
    assert!(
        host.storage
            .read_conversation_metadata("chat")
            .unwrap()
            .unwrap()
            .legacy_draft
            .is_some()
    );
    owner.retry_persistence().await.unwrap();
    assert!(
        host.storage
            .read_conversation_metadata("chat")
            .unwrap()
            .unwrap()
            .legacy_draft
            .is_none()
    );
    let reopened = Owner::open(host.clone()).await.unwrap();
    assert!(reopened.snapshot().await.unwrap().record.draft.is_empty());
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
}

#[test]
fn identical_inputs_in_one_batch_keep_distinct_logical_and_physical_identities() {
    let host = Fixture::new();
    let mut record = host.durable();
    record.messages = json!([{"role":"user","content":"Same","timestamp":1},{"role":"user","content":"Same","timestamp":1}]);
    for id in ["one", "two"] {
        record.runtime.get_or_insert_default().pending.push(
            situate_core::conversation_runtime::Pending {
                id: id.into(),
                kind: "steering".into(),
                state: "pending".into(),
                text: "Same".into(),
                attachments: vec![],
                references: vec![],
                timestamp: 1,
            },
        );
    }
    save_record(&host.storage, &record).unwrap();
    let entries = host
        .storage
        .read_conversation_history("chat", None, 1000)
        .unwrap()
        .entries;
    let inputs: Vec<_> = entries
        .iter()
        .filter(|entry| entry.kind == "message")
        .map(|entry| {
            (
                entry.id.as_str(),
                entry.data["input"]["id"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(inputs, vec![("input-one", "one"), ("input-two", "two")]);
}

#[tokio::test]
async fn empty_migrated_conversations_do_not_count_opaque_preservation_as_history() {
    let host = Fixture::new();
    seed(
        &host,
        vec![(
            "migration-version",
            "legacy",
            json!({"version":2,"opaque":"retained"}),
        )],
    );
    let owner = Owner::open(host).await.unwrap();
    let snapshot = owner.snapshot().await.unwrap();
    assert!(!snapshot.has_history);
    assert!(snapshot.selected_entry_id.is_some());
}

#[tokio::test]
async fn settled_question_events_leave_the_window_without_losing_the_active_question() {
    for answered in [false, true] {
        let host = Fixture::new();
        let owner = Owner::open(host.clone()).await.unwrap();
        owner.apply("old-present".into(), json!({"version":1,"type":"presentQuestion","question":{"id":"settled","prompt":"Earlier question"}})).await.unwrap();
        owner
            .apply(
                "old-close".into(),
                json!({"version":1,"type":"supersedeQuestion","questionId":"settled"}),
            )
            .await
            .unwrap();
        owner.apply("current-present".into(), json!({"version":1,"type":"presentQuestion","question":{"id":"current","prompt":"Current question","context":{"revision":"captured"}}})).await.unwrap();
        if answered {
            *host.question_outcome.lock().unwrap() = Some(Err("host-action-failed".into()));
            owner.apply("current-answer".into(), json!({"version":1,"type":"answerQuestion","response":{"questionId":"current","text":"Answer"},"input":{"text":"Answer","attachments":[],"references":[]},"timestamp":1})).await.unwrap();
        }
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            for index in 0..270 {
                owner
                    .apply(
                        format!("notice-{index}"),
                        json!({"version":1,"type":"notifyPluginAvailable","pluginId":"fixture"}),
                    )
                    .await
                    .unwrap();
            }
        })
        .await
        .expect("question history did not settle");
        let snapshot = owner.snapshot().await.unwrap();
        let events = &snapshot.record.runtime.as_ref().unwrap().events;
        assert!(
            events.len() <= 258,
            "retained {} events with answered={answered}: {:?}",
            events.len(),
            events
                .iter()
                .filter(|event| event.kind.starts_with("question_"))
                .map(|event| (&event.kind, &event.run_id, &event.data))
                .collect::<Vec<_>>()
        );
        assert!(!events.iter().any(|event| event.data["id"] == "settled" || event.data["questionId"] == "settled"));
        if answered {
            assert_eq!(
                questions::action_pending(&snapshot.record).as_deref(),
                Some("current")
            );
        } else {
            assert_eq!(
                questions::pending(&snapshot.record).unwrap()["id"],
                "current"
            );
        }
        let history = host
            .storage
            .read_conversation_history("chat", None, 1000)
            .unwrap();
        assert_eq!(
            history
                .entries
                .iter()
                .filter(|entry| entry.kind == "event"
                    && (entry.data["data"]["id"] == "settled"
                        || entry.data["data"]["questionId"] == "settled"))
                .count(),
            2
        );
        assert!(!history.entries.iter().any(|entry| entry.kind == "event"
            && matches!(
                entry.data["type"].as_str(),
                Some("question_superseded" | "question_action_completed")
            )
            && entry.data["data"]["questionId"] == "current"));
        assert_eq!(host.models.load(Ordering::SeqCst), 0);
    }
}

fn older_input_history(host: &Fixture) -> Value {
    let attachment = host
        .storage
        .put_attachment("text/plain", "source.txt", b"Attachment facts for summary")
        .unwrap();
    let original = json!({"message":{"role":"user","content":"Read source","timestamp":1},"input":{"id":"old-input","kind":"steering","state":"waiting","timestamp":1,"attachments":[attachment],"references":[{"kind":"historical","workspaceId":"workspace","path":"note.md","revision":"a".repeat(40)}]}});
    let mut entries = vec![
        HistoryEntry::new("old-original", None, "message", original.clone()),
        HistoryEntry::new(
            "old-consumed",
            Some("old-original".into()),
            "inputStatus",
            json!({"inputId":"old-input","state":"consumed"}),
        ),
    ];
    let mut parent = Some("old-consumed".into());
    for index in 0..320 {
        let id = format!("later-{index}");
        entries.push(HistoryEntry::new(id.clone(), parent, "message", json!({"message":{"role":"user","content":format!("Later {index}"),"timestamp":index+2}})));
        parent = Some(id);
    }
    host.storage
        .append_conversation_entries("chat", 0, &entries, parent.as_deref())
        .unwrap();
    original
}

#[tokio::test]
async fn older_compaction_resolves_consumed_input_sources_without_copying_them_to_history() {
    let host = Fixture::new();
    let original = older_input_history(&host);
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("new".into(), "Current request".into(), 400)
        .await
        .unwrap();
    assert_eq!(finish(&owner).await.phase, Phase::Idle);
    let requests = host.requests.lock().unwrap();
    assert!(
        requests
            .iter()
            .filter(|request| request.kind == RequestKind::Compaction)
            .any(|request| request
                .context
                .iter()
                .any(|message| persistence::message_text(message)
                    .contains("Attachment facts for summary")))
    );
    let inputs = host.inputs.lock().unwrap();
    let resolved = inputs
        .iter()
        .find(|input| input.text == "Read source")
        .unwrap();
    assert_eq!(
        json!(resolved.attachments),
        original["input"]["attachments"]
    );
    assert_eq!(json!(resolved.references), original["input"]["references"]);
    assert_eq!(
        inputs
            .iter()
            .filter(|input| input.text == "Read source")
            .count(),
        1
    );
    assert_eq!(
        host.storage
            .find_conversation_entry("chat", "old-original")
            .unwrap()
            .unwrap()
            .data,
        original
    );
    let history = std::fs::read_to_string(
        host.root
            .path()
            .join(".situate/conversations/chat/history.jsonl"),
    )
    .unwrap();
    assert!(!history.contains("Attachment facts for summary"));
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancelling_older_input_resolution_waits_for_the_resolver_without_main_dispatch() {
    let host = Fixture::new();
    let original = older_input_history(&host);
    host.input_gate.forget_permits(100);
    host.input_gate.add_permits(1);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("new".into(), "Current request".into(), 400)
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let entered = host.input_entered.notified();
            tokio::pin!(entered);
            entered.as_mut().enable();
            if host
                .inputs
                .lock()
                .unwrap()
                .iter()
                .any(|input| input.text == "Read source")
            {
                break;
            }
            entered.await;
        }
    })
    .await
    .expect("older input did not reach its resolver");
    owner.cancel_retained();
    assert!(owner.snapshot().await.unwrap().task_active);
    host.input_gate.add_permits(1);
    let stopped = finish(&owner).await;
    assert_eq!(stopped.phase, Phase::Interrupted);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
    assert!(
        stopped
            .record
            .runtime
            .as_ref()
            .unwrap()
            .checkpoint
            .is_none()
    );
    assert_eq!(
        host.storage
            .find_conversation_entry("chat", "old-original")
            .unwrap()
            .unwrap()
            .data,
        original
    );
}

#[tokio::test]
async fn bootstrap_compaction_streams_old_originals_and_releases_summarized_cache() {
    let host = Fixture::new();
    let mut parent = None;
    let mut entries = Vec::new();
    for index in 0..320 {
        let id = format!("original-{index}");
        entries.push(HistoryEntry::new(id.clone(), parent, "message", json!({"message":{"role":"user","content":format!("Original {index}"),"timestamp":index}})));
        parent = Some(id);
    }
    host.storage
        .append_conversation_entries("chat", 0, &entries, parent.as_deref())
        .unwrap();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false), turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    assert!(
        owner
            .snapshot()
            .await
            .unwrap()
            .record
            .messages
            .as_array()
            .unwrap()
            .len()
            <= 256
    );
    owner
        .submit("new".into(), "Current request".into(), 400)
        .await
        .unwrap();
    let state = finish(&owner).await;
    assert!(state.message_offset > 0);
    assert!(state.record.messages.as_array().unwrap().len() < 260);
    assert!(
        host.requests
            .lock()
            .unwrap()
            .iter()
            .any(|request| request.kind == RequestKind::Compaction)
    );
    assert!(
        state
            .record
            .messages
            .as_array()
            .unwrap()
            .iter()
            .all(|message| !persistence::message_text(message).contains("Context summary"))
    );
    owner
        .submit("next".into(), "Next request".into(), 401)
        .await
        .unwrap();
    finish(&owner).await;
    assert!(
        !host
            .model_inputs
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .iter()
            .any(|message| message["content"] == "Original 0")
    );
    assert_eq!(
        host.storage
            .find_conversation_entry("chat", "original-0")
            .unwrap()
            .unwrap()
            .data["message"]["content"],
        "Original 0"
    );
}
