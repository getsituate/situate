use super::*;

fn input(text: &str) -> Value {
    json!({"text":text,"attachments":[],"references":[]})
}
async fn apply(
    owner: &Arc<Owner<Fixture>>,
    id: &str,
    mut action: Value,
) -> Result<Snapshot, String> {
    action["version"] = json!(1);
    owner.apply(id.into(), action).await
}
#[tokio::test]
async fn versioned_drafts_are_atomic_memory_only_field_mutations() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let mut desired = input("Draft");
    let attachment = host
        .storage
        .put_attachment("image/png", "image.png", b"\x89PNG\r\n\x1a\nsynthetic")
        .unwrap();
    desired["attachments"] = json!([attachment]);
    desired["references"] = json!([{"kind":"live","workspaceId":"workspace","path":"note.md","anchorRevision":"a".repeat(40)}]);
    let action = json!({"version":1,"type":"draft","expected":input(""),"input":desired});
    owner.apply("draft".into(), action.clone()).await.unwrap();
    let revision = host.durable().revision;
    owner.apply("draft".into(), action).await.unwrap();
    assert_eq!(host.durable().revision, revision);
    let active = owner.snapshot().await.unwrap().record;
    assert_eq!(active.draft, "Draft");
    assert!(host.durable().draft.is_empty());
    assert_eq!(active.runtime.as_ref().unwrap().draft_attachments.len(), 1);
    assert_eq!(active.runtime.as_ref().unwrap().draft_references.len(), 1);
    assert_eq!(
        apply(
            &owner,
            "stale",
            json!({"type":"draft","expected":input(""),"input":input("Old")})
        )
        .await
        .unwrap_err(),
        "native.ai.conversation.conflict"
    );
    assert!(
        owner
            .apply("draft".into(), json!({"version":1,"type":"recall"}))
            .await
            .is_err()
    );
    assert!(
        owner
            .apply("bad-version".into(), json!({"version":2,"type":"recall"}))
            .await
            .is_err()
    );
    assert!(!owner.is_busy());
    let reopened = Owner::open(host.clone()).await.unwrap();
    let duplicate = json!({"version":1,"type":"draft","expected":input(""),"input":desired});
    reopened.apply("draft".into(), duplicate).await.unwrap();
    assert_eq!(host.durable().revision, revision);
}

#[tokio::test]
async fn rejected_native_input_never_changes_records_or_poison_owner_persistence() {
    for kind in ["draft", "submit", "enqueue", "answerQuestion"] {
        let host = Fixture::new();
        let owner = Owner::open(host.clone()).await.unwrap();
        apply(
            &owner,
            "seed",
            json!({"type":"draft","expected":input(""),"input":input("Existing draft")}),
        )
        .await
        .unwrap();
        if kind == "answerQuestion" {
            apply(&owner, "present", json!({"type":"presentQuestion","question":{"id":"question","prompt":"Confirm?","context":{"revision":"captured"}}})).await.unwrap();
        }
        let before = host.durable();
        let active_before = owner.snapshot().await.unwrap().record;
        let validations = host.input_validations.load(Ordering::SeqCst);
        *host.input_validation_error.lock().unwrap() =
            Some("native.ai.conversation.versionInvalid".into());
        let mut incoming = input("Rejected input");
        incoming["references"] = json!([{"kind":"live","workspaceId":"foreign-workspace","path":"note.md","anchorRevision":"a".repeat(40)}]);
        let action = match kind {
            "draft" => json!({"type":kind,"expected":input("Existing draft"),"input":incoming}),
            "submit" => json!({"type":kind,"input":incoming,"timestamp":10}),
            "enqueue" => json!({"type":kind,"kind":"steering","input":incoming,"timestamp":10}),
            _ => {
                json!({"type":kind,"response":{"questionId":"question","text":"Rejected input"},"input":incoming,"timestamp":10})
            }
        };
        assert_eq!(
            apply(&owner, "rejected", action).await.unwrap_err(),
            "native.ai.conversation.versionInvalid"
        );
        assert_eq!(
            host.input_validations.load(Ordering::SeqCst),
            validations + 1
        );
        let snapshot = owner.snapshot().await.unwrap();
        assert_eq!(snapshot.record, active_before);
        assert_eq!(host.durable(), before);
        assert_eq!(snapshot.phase, Phase::Idle);
        assert_eq!(snapshot.error, None);
        assert!(!snapshot.task_active && !snapshot.question_busy);
        assert!(!owner.is_busy());
        assert_eq!(host.question_actions.load(Ordering::SeqCst), 0);
        assert_eq!(host.models.load(Ordering::SeqCst), 0);
        assert!(host.inputs.lock().unwrap().is_empty());
        *host.input_validation_error.lock().unwrap() = None;
        apply(
            &owner,
            "valid-draft",
            json!({"type":"draft","expected":input("Existing draft"),"input":input("Valid draft")}),
        )
        .await
        .unwrap();
        if kind == "answerQuestion" {
            apply(
                &owner,
                "supersede",
                json!({"type":"supersedeQuestion","questionId":"question"}),
            )
            .await
            .unwrap();
        }
        *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
        owner
            .submit("valid-submit".into(), "Valid request".into(), 20)
            .await
            .unwrap();
        assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
        assert!(!owner.is_busy());
    }
}

#[tokio::test]
async fn accepted_receipt_replay_bypasses_filesystem_validation_after_attachment_loss() {
    let host = Fixture::new();
    let attachment = host
        .storage
        .put_attachment("text/plain", "note.txt", b"Synthetic note")
        .unwrap();
    let owner = Owner::open(host.clone()).await.unwrap();
    let mut incoming = input("Draft");
    incoming["attachments"] = json!([attachment]);
    let action = json!({"version":1,"type":"draft","expected":input(""),"input":incoming});
    owner.apply("draft".into(), action.clone()).await.unwrap();
    let durable_before = host.durable();
    let accepted = owner.snapshot().await.unwrap().record;
    let validations = host.input_validations.load(Ordering::SeqCst);
    std::fs::remove_file(
        host.root
            .path()
            .join(".situate")
            .join(format!("attachment-{}.bin", attachment.id)),
    )
    .unwrap();
    *host.input_validation_error.lock().unwrap() =
        Some("native.ai.conversation.versionInvalid".into());
    let replay = owner.apply("draft".into(), action).await.unwrap();
    assert_eq!(replay.record, accepted);
    assert_eq!(host.durable(), durable_before);
    assert_eq!(host.input_validations.load(Ordering::SeqCst), validations);
    assert!(!owner.is_busy());
}

#[tokio::test]
async fn unavailable_expected_draft_attachments_do_not_prevent_removing_them() {
    let host = Fixture::new();
    let attachment = host
        .storage
        .put_attachment("text/plain", "note.txt", b"Synthetic note")
        .unwrap();
    let owner = Owner::open(host.clone()).await.unwrap();
    let mut previous = input("Draft");
    previous["attachments"] = json!([attachment]);
    apply(
        &owner,
        "draft",
        json!({"type":"draft","expected":input(""),"input":previous}),
    )
    .await
    .unwrap();
    std::fs::remove_file(
        host.root
            .path()
            .join(".situate")
            .join(format!("attachment-{}.bin", attachment.id)),
    )
    .unwrap();
    let before = host.durable();
    assert!(
        apply(
            &owner,
            "keep-missing",
            json!({"type":"draft","expected":previous,"input":previous})
        )
        .await
        .is_err()
    );
    assert_eq!(host.durable(), before);
    assert_eq!(owner.snapshot().await.unwrap().phase, Phase::Idle);
    assert!(!owner.is_busy());
    let removed = apply(
        &owner,
        "remove",
        json!({"type":"draft","expected":previous,"input":input("")}),
    )
    .await
    .unwrap();
    assert_eq!(removed.record.draft, "");
    assert!(
        removed
            .record
            .runtime
            .as_ref()
            .unwrap()
            .draft_attachments
            .is_empty()
    );
    assert_eq!(removed.phase, Phase::Idle);
    assert!(!owner.is_busy());
}

#[tokio::test]
async fn bounded_syntax_rejection_precedes_native_input_validation() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    for (id, action) in [
        (
            "draft",
            json!({"type":"draft","expected":input(""),"input":input(&"x".repeat(1_048_577))}),
        ),
        (
            "submit",
            json!({"type":"submit","input":input(""),"timestamp":10}),
        ),
        (
            "enqueue",
            json!({"type":"enqueue","kind":"followUp","input":input(""),"timestamp":10}),
        ),
        (
            "answer",
            json!({"type":"answerQuestion","response":{"questionId":"question","text":"Answer"},"input":input(&"x".repeat(1_048_577)),"timestamp":10}),
        ),
    ] {
        assert_eq!(
            apply(&owner, id, action).await.unwrap_err(),
            "native.ai.conversation.versionInvalid"
        );
    }
    assert_eq!(host.input_validations.load(Ordering::SeqCst), 0);
    assert!(!owner.is_busy());
    apply(
        &owner,
        "empty-draft",
        json!({"type":"draft","expected":input(""),"input":input("")}),
    )
    .await
    .unwrap();
    apply(&owner, "present", json!({"type":"presentQuestion","question":{"id":"question","prompt":"Confirm?","suggestions":[{"id":"yes","label":"Yes"}],"context":{"revision":"captured"}}})).await.unwrap();
    apply(&owner, "choice", json!({"type":"answerQuestion","response":{"questionId":"question","choiceId":"yes"},"input":input(""),"timestamp":10})).await.unwrap();
    assert_eq!(host.input_validations.load(Ordering::SeqCst), 2);
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn full_inputs_are_accepted_before_resolution_and_keep_references_on_run() {
    let host = Fixture::new();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    let attachment = host
        .storage
        .put_attachment("image/png", "image.png", b"\x89PNG\r\n\x1a\nsynthetic")
        .unwrap();
    let expected_image = format!("attachment:{}", attachment.id);
    let requested = json!({"text":"Explain","attachments":[attachment],"references":[{"kind":"historical","workspaceId":"workspace","path":"old.md","revision":"a".repeat(40)}]});
    let accepted = apply(
        &owner,
        "full",
        json!({"type":"submit","input":requested,"timestamp":10}),
    )
    .await
    .unwrap();
    assert_eq!(
        accepted.record.runtime.as_ref().unwrap().pending[0].state,
        "pending"
    );
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    let saved = host.durable();
    assert_eq!(saved.runtime.as_ref().unwrap().runs[0].references.len(), 1);
    assert!(saved.runtime.as_ref().unwrap().pending.is_empty());
    assert_eq!(
        host.storage
            .find_conversation_input_state("chat", "full")
            .unwrap()
            .as_deref(),
        Some("consumed")
    );
    assert_eq!(saved.messages[0]["content"], "Explain");
    assert_eq!(
        host.model_inputs.lock().unwrap()[0][0]["content"][1]["data"],
        expected_image
    );
    assert_eq!(host.inputs.lock().unwrap()[0].references.len(), 1);
    assert_eq!(
        host.storage
            .find_conversation_entry("chat", "input-full")
            .unwrap()
            .unwrap()
            .data["input"]["attachments"],
        requested["attachments"]
    );
}

#[tokio::test]
async fn recalling_queues_prioritizes_steering_and_does_not_consume_recalled_input() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Initial".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    apply(
        &owner,
        "follow",
        json!({"type":"enqueue","kind":"followUp","input":input("Follow"),"timestamp":11}),
    )
    .await
    .unwrap();
    apply(
        &owner,
        "steer",
        json!({"type":"enqueue","kind":"steering","input":input("Steer"),"timestamp":12}),
    )
    .await
    .unwrap();
    apply(
        &owner,
        "draft",
        json!({"type":"draft","expected":input(""),"input":input("Draft")}),
    )
    .await
    .unwrap();
    apply(&owner, "recall", json!({"type":"recall"}))
        .await
        .unwrap();
    assert_eq!(
        owner.snapshot().await.unwrap().record.draft,
        "Steer\n\nFollow\n\nDraft"
    );
    assert!(host.durable().draft.is_empty());
    assert!(
        host.durable()
            .runtime
            .as_ref()
            .unwrap()
            .pending
            .iter()
            .all(|p| p.state == "consumed")
    );
    host.gate.add_permits(20);
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    assert_eq!(host.inputs.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn steering_and_followups_are_consumed_at_distinct_model_boundaries() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    *host.turns.lock().unwrap() = VecDeque::from([turn(true), turn(false), turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Initial".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    apply(
        &owner,
        "steer",
        json!({"type":"enqueue","kind":"steering","input":input("Steer"),"timestamp":11}),
    )
    .await
    .unwrap();
    apply(
        &owner,
        "follow",
        json!({"type":"enqueue","kind":"followUp","input":input("Follow"),"timestamp":12}),
    )
    .await
    .unwrap();
    host.gate.add_permits(20);
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    let requests = host.model_inputs.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(!requests[0].iter().any(|m| m["content"] == "Steer"));
    assert!(requests[1].iter().any(|m| m["content"] == "Steer"));
    assert!(!requests[1].iter().any(|m| m["content"] == "Follow"));
    assert!(requests[2].iter().any(|m| m["content"] == "Follow"));
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn gateway_cancellation_captured_before_owner_readiness_preserves_submitted_input_without_inference()
 {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let cancel = CancellationToken::new();
    cancel.cancel();
    owner.cancel_retained();
    owner
        .apply_with_cancel(
            "cancelled".into(),
            json!({"version":1,"type":"submit","input":input("Retained request"),"timestamp":10}),
            cancel,
        )
        .await
        .unwrap();
    let snapshot = owner.settled().await.unwrap();
    assert_eq!(snapshot.phase, Phase::Interrupted);
    let pending = &snapshot.record.runtime.as_ref().unwrap().pending[0];
    assert_eq!(pending.text, "Retained request");
    assert_eq!(pending.state, "pending");
    assert_eq!(snapshot.record.messages[0]["content"], "Retained request");
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert!(host.inputs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn gateway_cancellation_preserves_pending_question_and_draft_until_explicit_answer_retry() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    apply(&owner,"present",json!({"type":"presentQuestion","question":{"id":"question","prompt":"Confirm?","context":{"revision":"captured"}}})).await.unwrap();
    apply(
        &owner,
        "draft",
        json!({"type":"draft","expected":input(""),"input":input("My answer")}),
    )
    .await
    .unwrap();
    let answer = json!({"version":1,"type":"answerQuestion","response":{"questionId":"question","text":"My answer"},"input":input("My answer"),"timestamp":10});
    let cancel = CancellationToken::new();
    cancel.cancel();
    owner.cancel_retained();
    assert_eq!(
        owner
            .apply_with_cancel("answer".into(), answer.clone(), cancel)
            .await
            .unwrap_err(),
        "native.ai.response.stopped"
    );
    let record = owner.snapshot().await.unwrap().record;
    assert_eq!(record.draft, "My answer");
    assert!(host.durable().draft.is_empty());
    assert_eq!(questions::pending(&record).unwrap()["id"], "question");
    assert!(record.messages.as_array().unwrap().is_empty());
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 0);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    owner.apply("answer".into(), answer).await.unwrap();
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 1);
    assert_eq!(host.durable().messages.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn scope_abort_cancels_gateway_actions_queued_before_the_owner_mutation_gate() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let gate = owner.actions.lock().await;
    let gateway = CancellationToken::new();
    let mut action = Box::pin(owner.apply_with_cancel(
        "queued".into(),
        json!({"version":1,"type":"submit","input":input("Queued request"),"timestamp":10}),
        gateway.child_token(),
    ));
    std::future::poll_fn(|context| {
        assert!(action.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    gateway.cancel();
    owner.cancel_retained();
    drop(gate);
    action.await.unwrap();
    let snapshot = owner.settled().await.unwrap();
    assert_eq!(snapshot.phase, Phase::Interrupted);
    assert_eq!(
        snapshot.record.runtime.as_ref().unwrap().pending[0].state,
        "pending"
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn scope_abort_during_followup_resolution_keeps_it_pending_until_an_explicit_later_action() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    *host.turns.lock().unwrap() = VecDeque::from([turn(false), turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Initial".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    host.input_entered.notified().await;
    apply(
        &owner,
        "follow",
        json!({"type":"enqueue","kind":"followUp","input":input("Follow up"),"timestamp":11}),
    )
    .await
    .unwrap();
    host.input_gate.forget_permits(100);
    host.gate.add_permits(1);
    host.input_entered.notified().await;
    owner.cancel_retained();
    host.input_gate.add_permits(1);
    let stopped = owner.settled().await.unwrap();
    assert_eq!(stopped.phase, Phase::Interrupted);
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    assert_eq!(
        stopped
            .record
            .runtime
            .as_ref()
            .unwrap()
            .pending
            .iter()
            .find(|entry| entry.id == "follow")
            .unwrap()
            .state,
        "pending"
    );
    assert!(
        stopped
            .record
            .messages
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["content"] == "Follow up")
    );
    assert!(
        !stopped
            .record
            .runtime
            .as_ref()
            .unwrap()
            .events
            .iter()
            .any(|event| event.kind == "input_consumed" && event.data["inputId"] == "follow")
    );
    apply(&owner, "recall", json!({"type":"recall"}))
        .await
        .unwrap();
    assert_eq!(owner.snapshot().await.unwrap().record.draft, "Follow up");
    assert!(host.durable().draft.is_empty());
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    host.input_gate.add_permits(1);
    host.gate.add_permits(1);
    owner
        .submit("explicit".into(), "Follow up".into(), 20)
        .await
        .unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(host.models.load(Ordering::SeqCst), 2);
}

async fn retained_decision(owner: &Arc<Owner<Fixture>>, host: &Arc<Fixture>, answered: bool) {
    apply(
        owner,
        "present",
        json!({"type":"presentQuestion","question":{
            "id":"decision","prompt":"Choose a method","context":{"revision":"captured"}
        }}),
    )
    .await
    .unwrap();
    if answered {
        *host.question_outcome.lock().unwrap() = Some(Err("host-action-failed".into()));
        apply(
            owner,
            "answer",
            json!({"type":"answerQuestion","response":{
            "questionId":"decision","text":"Use it"
        },"input":input("Use it"),"timestamp":10}),
        )
        .await
        .unwrap();
        assert_eq!(
            questions::action_pending(&host.durable()).as_deref(),
            Some("decision")
        );
    }
}

#[tokio::test]
async fn host_retirement_is_durable_before_submit_and_never_replays_pending_actions() {
    for answered in [false, true] {
        let host = Fixture::new();
        let owner = Owner::open(host.clone()).await.unwrap();
        retained_decision(&owner, &host, answered).await;
        host.retired_questions
            .lock()
            .unwrap()
            .push("decision".into());
        let submitted = owner
            .submit("ordinary".into(), "New request".into(), 11)
            .await
            .unwrap();
        let events = &submitted.record.runtime.as_ref().unwrap().events;
        let superseded = events
            .iter()
            .position(|e| e.kind == "question_superseded" && e.data["questionId"] == "decision")
            .unwrap();
        let accepted = events
            .iter()
            .position(|e| e.kind == "input_accepted" && e.run_id == "ordinary")
            .unwrap();
        assert!(superseded < accepted);
        assert!(questions::pending(&host.durable()).is_none());
        assert!(questions::action_pending(&host.durable()).is_none());
        owner.wait_idle().await.unwrap();
        assert_eq!(
            host.question_actions.load(Ordering::SeqCst),
            usize::from(answered)
        );
        let reopened = Owner::open(host.clone()).await.unwrap();
        assert!(
            apply(
                &reopened,
                "retry",
                json!({"type":"retryQuestionAction","questionId":"decision"})
            )
            .await
            .is_err()
        );
        assert_eq!(
            host.question_actions.load(Ordering::SeqCst),
            usize::from(answered)
        );
    }
}

#[tokio::test]
async fn retirement_blocks_direct_answers_and_retries_without_invoking_host_actions() {
    for answered in [false, true] {
        let host = Fixture::new();
        let owner = Owner::open(host.clone()).await.unwrap();
        retained_decision(&owner, &host, answered).await;
        host.retired_questions
            .lock()
            .unwrap()
            .push("decision".into());
        let action = if answered {
            json!({"type":"retryQuestionAction","questionId":"decision"})
        } else {
            json!({"type":"answerQuestion","response":{"questionId":"decision","text":"Use it"},"input":input("Use it"),"timestamp":11})
        };
        assert_eq!(
            apply(&owner, "obsolete", action).await.unwrap_err(),
            "chatQuestion.stale"
        );
        assert!(questions::pending(&host.durable()).is_none());
        assert!(questions::action_pending(&host.durable()).is_none());
        assert_eq!(
            host.question_actions.load(Ordering::SeqCst),
            usize::from(answered)
        );
    }
}

#[tokio::test]
async fn unrelated_questions_and_failed_retirement_persistence_cannot_admit_input() {
    for answered in [false, true] {
        let host = Fixture::new();
        let owner = Owner::open(host.clone()).await.unwrap();
        retained_decision(&owner, &host, answered).await;
        let before = host.durable();
        assert_eq!(
            owner
                .submit("blocked".into(), "New request".into(), 11)
                .await
                .unwrap_err(),
            "chatQuestion.busy"
        );
        assert_eq!(host.durable(), before);
        host.retired_questions
            .lock()
            .unwrap()
            .push("decision".into());
        *host.fail.lock().unwrap() = Some(("other", false));
        assert!(
            owner
                .submit("failed".into(), "New request".into(), 11)
                .await
                .is_err()
        );
        let failed = owner.snapshot().await.unwrap();
        assert_eq!(failed.phase, Phase::PersistenceFailed);
        assert_eq!(host.durable(), before);
        assert_eq!(host.models.load(Ordering::SeqCst), 0);
        assert_eq!(
            host.question_actions.load(Ordering::SeqCst),
            usize::from(answered)
        );
        assert!(
            owner
                .submit("still-blocked".into(), "New request".into(), 11)
                .await
                .is_err()
        );
        assert_eq!(host.durable(), before);
        owner.retry_persistence().await.unwrap();
        assert_eq!(host.models.load(Ordering::SeqCst), 0);
        assert!(questions::pending(&host.durable()).is_none());
        assert!(questions::action_pending(&host.durable()).is_none());
        owner
            .submit("recovered".into(), "New request".into(), 12)
            .await
            .unwrap();
        owner.wait_idle().await.unwrap();
        assert_eq!(
            host.question_actions.load(Ordering::SeqCst),
            usize::from(answered)
        );
    }
}

#[tokio::test]
async fn retirement_waits_for_failed_host_action_drain_before_admitting_input() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    apply(
        &owner,
        "present",
        json!({"type":"presentQuestion","question":{
            "id":"decision","prompt":"Choose a method","context":{"revision":"captured"}
        }}),
    )
    .await
    .unwrap();
    host.drain_gate.forget_permits(100);
    *host.question_outcome.lock().unwrap() = Some(Err("host-action-failed".into()));
    let answering = owner.clone();
    let answer = tokio::spawn(async move {
        apply(
            &answering,
            "answer",
            json!({"type":"answerQuestion",
                "response":{"questionId":"decision","text":"Use it"},
                "input":input("Use it"),"timestamp":10
            }),
        )
        .await
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        host.drain_entered.notified(),
    )
    .await
    .expect("question action did not reach drain");
    host.retired_questions
        .lock()
        .unwrap()
        .push("decision".into());
    let submitting = owner.clone();
    let submit = tokio::spawn(async move {
        submitting
            .submit("ordinary".into(), "New request".into(), 11)
            .await
    });
    tokio::task::yield_now().await;
    assert!(!submit.is_finished());
    assert!(owner.snapshot().await.unwrap().question_busy);
    assert!(
        !host
            .durable()
            .runtime
            .unwrap()
            .events
            .iter()
            .any(|e| e.kind == "question_superseded")
    );
    host.drain_gate.add_permits(100);
    answer.await.unwrap().unwrap();
    submit.await.unwrap().unwrap();
    owner.wait_idle().await.unwrap();
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 1);
    assert!(questions::action_pending(&host.durable()).is_none());
}

#[tokio::test]
async fn questions_validate_choices_and_retry_host_actions_without_duplicate_answers() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let question = json!({"id":"question","prompt":"Choose a method","suggestions":[{"id":"choice","label":"Use it"}],"context":{"revision":"captured"},"preview":{"title":"Method","text":"Explanation"}});
    apply(
        &owner,
        "present",
        json!({"type":"presentQuestion","question":question}),
    )
    .await
    .unwrap();
    assert!(apply(&owner,"invalid",json!({"type":"answerQuestion","response":{"questionId":"question","choiceId":"missing"},"input":input(""),"timestamp":10})).await.is_err());
    *host.question_outcome.lock().unwrap() = Some(Err("host-action-failed".into()));
    let answer = json!({"version":1,"type":"answerQuestion","response":{"questionId":"question","choiceId":"choice"},"input":input(""),"timestamp":10});
    let failed = owner.apply("answer".into(), answer.clone()).await.unwrap();
    assert_eq!(failed.error.as_deref(), Some("host-action-failed"));
    assert_eq!(failed.phase, Phase::Idle);
    assert!(!failed.question_busy);
    assert!(!failed.task_active);
    assert_eq!(
        questions::action_pending(&failed.record).as_deref(),
        Some("question")
    );
    assert_eq!(host.durable().messages.as_array().unwrap().len(), 1);
    assert_eq!(host.durable().messages[0]["content"], "Use it");
    owner.apply("answer".into(), answer).await.unwrap();
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 1);
    assert!(
        owner
            .submit("bypass".into(), "Continue".into(), 11)
            .await
            .is_err()
    );
    *host.question_outcome.lock().unwrap() = Some(Err("retry-host-action-failed".into()));
    let retried = apply(
        &owner,
        "failed-retry",
        json!({"type":"retryQuestionAction","questionId":"question"}),
    )
    .await
    .unwrap();
    assert_eq!(retried.error.as_deref(), Some("retry-host-action-failed"));
    assert_eq!(retried.phase, Phase::Idle);
    assert!(!retried.question_busy);
    assert_eq!(
        questions::action_pending(&retried.record).as_deref(),
        Some("question")
    );
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 2);
    assert_eq!(host.durable().messages.as_array().unwrap().len(), 1);
    *host.question_outcome.lock().unwrap() = Some(Ok(QuestionOutcome {
        question: Some(json!({"id":"next","prompt":"Review the result"})),
        continue_run: false,
    }));
    apply(
        &owner,
        "retry",
        json!({"type":"retryQuestionAction","questionId":"question"}),
    )
    .await
    .unwrap();
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 3);
    assert_eq!(host.durable().messages.as_array().unwrap().len(), 1);
    assert_eq!(questions::pending(&host.durable()).unwrap()["id"], "next");
    assert_eq!(owner.snapshot().await.unwrap().error, None);
    apply(
        &owner,
        "supersede",
        json!({"type":"supersedeQuestion","questionId":"next"}),
    )
    .await
    .unwrap();
    assert!(questions::pending(&host.durable()).is_none());
}

#[tokio::test]
async fn accepted_question_failure_waits_for_drain_before_returning_an_authoritative_snapshot() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    apply(&owner,"present",json!({"type":"presentQuestion","question":{"id":"question","prompt":"Confirm?","context":{"revision":"captured"}}})).await.unwrap();
    host.drain_gate.forget_permits(100);
    *host.question_outcome.lock().unwrap() = Some(Err("host-action-failed".into()));
    let answering = owner.clone();
    let task = tokio::spawn(async move {
        apply(&answering,"answer",json!({"type":"answerQuestion","response":{"questionId":"question","text":"Yes"},"input":input("Yes"),"timestamp":10})).await
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        host.drain_entered.notified(),
    )
    .await
    .expect("question action did not reach drain");
    assert!(!task.is_finished());
    assert!(owner.snapshot().await.unwrap().question_busy);
    assert!(owner.is_busy());
    let revision = host.durable().revision;
    host.drain_gate.add_permits(1);
    let snapshot = task.await.unwrap().unwrap();
    assert_eq!(snapshot.error.as_deref(), Some("host-action-failed"));
    assert_eq!(snapshot.phase, Phase::Idle);
    assert!(!snapshot.question_busy);
    assert!(!snapshot.task_active);
    assert!(!owner.is_busy());
    assert_eq!(snapshot.record.revision, revision);
    assert_eq!(snapshot.record.messages[0]["content"], "Yes");
    assert_eq!(
        questions::action_pending(&snapshot.record).as_deref(),
        Some("question")
    );
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 1);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn failed_question_receipt_persistence_is_not_reported_as_an_acknowledged_host_failure() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    apply(&owner,"present",json!({"type":"presentQuestion","question":{"id":"question","prompt":"Confirm?","context":{"revision":"captured"}}})).await.unwrap();
    host.fail_at("other", false);
    let result=apply(&owner,"answer",json!({"type":"answerQuestion","response":{"questionId":"question","text":"Yes"},"input":input("Yes"),"timestamp":10})).await;
    assert_eq!(result.unwrap_err(), "save-failed");
    assert_eq!(
        owner.snapshot().await.unwrap().phase,
        Phase::PersistenceFailed
    );
    assert!(owner.is_busy());
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 0);
    owner.retry_persistence().await.unwrap();
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 0);
    assert_eq!(
        questions::action_pending(&host.durable()).as_deref(),
        Some("question")
    );
    apply(
        &owner,
        "retry",
        json!({"type":"retryQuestionAction","questionId":"question"}),
    )
    .await
    .unwrap();
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 1);
    assert_eq!(host.durable().messages.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn effects_execute_without_an_observer_or_an_approval_action() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let (_, subscription) = owner.subscribe().await.unwrap();
    drop(subscription);
    owner
        .submit("run".into(), "External action".into(), 10)
        .await
        .unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    let events = host.durable().runtime.unwrap().events;
    assert!(events.iter().any(|event| event.kind == "tool_intent"));
    assert!(
        events
            .iter()
            .any(|event| event.kind == "tool_execution_end")
    );
    assert!(
        !events
            .iter()
            .any(|event| event.kind.starts_with("external_approval"))
    );
    assert_eq!(
        apply(
            &owner,
            "obsolete",
            json!({"type":"approval","approvalId":"old","allowed":true})
        )
        .await
        .unwrap_err(),
        "native.ai.conversation.versionInvalid"
    );
}

#[tokio::test]
async fn atomic_subscriptions_order_progress_and_require_resync_on_lag() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let (snapshot, mut subscription) = owner.subscribe().await.unwrap();
    assert_eq!(snapshot.position, 0);
    apply(
        &owner,
        "draft",
        json!({"type":"draft","expected":input(""),"input":input("one")}),
    )
    .await
    .unwrap();
    let update = subscription.recv().await.unwrap();
    assert_eq!(update.position(), snapshot.position + 1);
    assert!(matches!(update, Update::Snapshot { .. }));
    for index in 0..70 {
        let mut state = owner.state.lock().await;
        state.snapshot.activity_comment = format!("Activity {index}");
        owner.publish_progress(&mut state);
    }
    assert!(matches!(
        subscription.recv().await,
        Err(SubscriptionError::Gap)
    ));
    let (fresh, mut attached) = owner.subscribe().await.unwrap();
    {
        let mut state = owner.state.lock().await;
        state.snapshot.activity_comment = "Final".into();
        owner.publish_progress(&mut state);
    }
    assert_eq!(
        attached.recv().await.unwrap().position(),
        fresh.position + 1
    );
}

#[tokio::test]
async fn broadcast_retains_eight_updates_before_reporting_a_gap() {
    let host = Fixture::new();
    let owner = Owner::open(host).await.unwrap();
    let (_, mut fast) = owner.subscribe().await.unwrap();
    let (_, mut slow) = owner.subscribe().await.unwrap();
    for position in 1..=8 {
        {
            let mut state = owner.state.lock().await;
            state.snapshot.activity_comment = format!("Activity {position}");
            owner.publish_progress(&mut state);
        }
        assert_eq!(fast.recv().await.unwrap().position(), position);
    }
    assert_eq!(slow.recv().await.unwrap().position(), 1);
    for _ in 0..2 {
        let mut state = owner.state.lock().await;
        owner.publish_progress(&mut state);
    }
    assert!(matches!(slow.recv().await, Err(SubscriptionError::Gap)));
    assert_eq!(fast.recv().await.unwrap().position(), 9);
    assert_eq!(fast.recv().await.unwrap().position(), 10);
}

#[tokio::test]
async fn broadcast_subscribers_share_snapshot_and_large_progress_payloads_without_wire_changes() {
    let host = Fixture::new();
    let owner = Owner::open(host).await.unwrap();
    let (_, mut first) = owner.subscribe().await.unwrap();
    let (_, mut second) = owner.subscribe().await.unwrap();
    {
        let mut state = owner.state.lock().await;
        owner.publish(&mut state);
    }
    let left = first.recv().await.unwrap();
    let right = second.recv().await.unwrap();
    let (
        Update::Snapshot { snapshot: left, .. },
        Update::Snapshot {
            snapshot: right, ..
        },
    ) = (&left, &right)
    else {
        panic!("expected snapshots")
    };
    assert!(Arc::ptr_eq(left, right));
    let encoded = serde_json::to_value(Update::Snapshot {
        position: 1,
        snapshot: left.clone(),
    })
    .unwrap();
    assert_eq!(encoded["type"], "snapshot");
    assert_eq!(encoded["snapshot"]["record"]["id"], "chat");
    let partial = json!({"role":"assistant","content":[{"type":"text","text":"x".repeat(100000)}]});
    {
        let mut state = owner.state.lock().await;
        state.snapshot.partial_message = Some(partial.clone());
        owner.publish_progress(&mut state);
    }
    let left = first.recv().await.unwrap();
    let right = second.recv().await.unwrap();
    let (
        Update::Progress {
            partial_message: Some(a),
            ..
        },
        Update::Progress {
            partial_message: Some(b),
            ..
        },
    ) = (&left, &right)
    else {
        panic!("expected partial messages")
    };
    assert!(Arc::ptr_eq(a, b));
    let encoded = serde_json::to_value(left).unwrap();
    assert_eq!(encoded["type"], "progress");
    assert_eq!(encoded["partialMessage"], partial);
}

#[tokio::test]
async fn subscriptions_attached_before_mutation_finalization_receive_activity_clear() {
    let host = Fixture::new();
    let owner = Owner::open(host).await.unwrap();
    owner.pending_mutations.fetch_add(1, Ordering::SeqCst);
    let mut pending = PendingMutation {
        owner: owner.clone(),
        armed: true,
    };
    {
        let mut state = owner.state.lock().await;
        owner.publish(&mut state);
        assert!(!state.snapshot.task_active);
    }
    let (snapshot, mut subscription) = owner.subscribe().await.unwrap();
    assert!(snapshot.task_active);
    let final_snapshot = owner.finalize_mutation(&mut pending).await;
    assert!(!final_snapshot.task_active);
    let update = subscription.recv().await.unwrap();
    assert!(update.position() > snapshot.position);
    let Update::Snapshot { snapshot, .. } = update else {
        panic!("expected final snapshot")
    };
    assert!(!snapshot.task_active);
    drop(pending);
    assert_eq!(owner.pending_mutations.load(Ordering::SeqCst), 0);
    assert!(!owner.is_busy());
}

#[tokio::test]
async fn guard_drop_also_publishes_activity_clear_without_double_decrement() {
    let host = Fixture::new();
    let owner = Owner::open(host).await.unwrap();
    owner.pending_mutations.fetch_add(1, Ordering::SeqCst);
    let pending = PendingMutation {
        owner: owner.clone(),
        armed: true,
    };
    let (snapshot, mut subscription) = owner.subscribe().await.unwrap();
    assert!(snapshot.task_active);
    drop(pending);
    let update = subscription.recv().await.unwrap();
    let Update::Snapshot { snapshot, .. } = update else {
        panic!("expected final snapshot")
    };
    assert!(!snapshot.task_active);
    assert_eq!(owner.pending_mutations.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn native_continuation_and_unknown_accounting_remain_canonical() {
    let host = Fixture::new();
    let mut response = turn(false);
    response["usage"] = Value::Null;
    response["responseId"] = json!("response");
    response["continuation"] = json!({"format":"anthropic-messages","data":{"signature":"opaque"}});
    *host.turns.lock().unwrap() = VecDeque::from([response.clone(), turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("first".into(), "Explain".into(), 10)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    assert_eq!(host.durable().messages[1], response);
    owner
        .submit("next".into(), "Continue".into(), 20)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    assert_eq!(host.model_inputs.lock().unwrap()[1][1], response);
    assert_eq!(
        host.durable().runtime.unwrap().runs[0]
            .usage
            .as_ref()
            .unwrap()[0]["usage"],
        Value::Null
    );
}

#[tokio::test]
async fn explicit_stop_finishes_without_an_error_and_allows_another_request() {
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        for error in [
            "native.ai.response.stopped",
            "native.ai.response.stoppedBilling",
            "native.ai.conversation.saveFailed",
        ] {
            let host = Fixture::new();
            host.gate.forget_permits(20);
            *host.model_error.lock().unwrap() = Some(error.into());
            let owner = Owner::open(host.clone()).await.unwrap();
            owner
                .submit("run".into(), "Explain".into(), 10)
                .await
                .unwrap();
            host.entered.notified().await;
            owner.cancel_retained();
            let stopped = owner.settled().await.unwrap();
            assert_eq!(stopped.phase, Phase::Interrupted);
            assert!(!stopped.task_active);
            let expected_error = if error == "native.ai.conversation.saveFailed" {
                Some(error.to_string())
            } else {
                None
            };
            assert_eq!(stopped.error, expected_error);
            let events = &host.durable().runtime.unwrap().events;
            assert_eq!(
                events
                    .iter()
                    .find(|event| event.kind == "work_block_end")
                    .unwrap()
                    .data["outcome"],
                "cancelled"
            );
            assert_eq!(
                events
                    .iter()
                    .find(|event| event.kind == "execution_finished")
                    .unwrap()
                    .data["error"],
                json!(expected_error)
            );
            host.gate.add_permits(1);
            *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
            owner
                .submit("next".into(), "Continue".into(), 20)
                .await
                .unwrap();
            let next = owner.settled().await.unwrap();
            assert_eq!(next.phase, Phase::Idle);
            assert_eq!(next.error, None);
        }
    })
    .await
    .expect("stop and continuation must settle");
}

#[tokio::test]
async fn observed_partial_survives_model_failure_and_cancellation_with_unknown_usage() {
    for cancelled in [false, true] {
        let host = Fixture::new();
        host.partials.lock().unwrap().push(Progress::PartialMessage(json!({"role":"assistant","content":[{"type":"text","text":"Observed partial"}],"stopReason":"pending","responseId":"partial"})));
        if cancelled {
            host.gate.forget_permits(20);
        } else {
            *host.model_error.lock().unwrap() = Some("safe-provider-failure".into());
        }
        let owner = Owner::open(host.clone()).await.unwrap();
        owner
            .submit("run".into(), "Explain".into(), 10)
            .await
            .unwrap();
        if cancelled {
            host.entered.notified().await;
            owner.cancel_retained();
        }
        assert_eq!(owner.settled().await.unwrap().phase, Phase::Interrupted);
        let saved = host.durable();
        assert_eq!(saved.messages[1]["content"][0]["text"], "Observed partial");
        assert_eq!(saved.messages[1]["usage"], Value::Null);
        assert_eq!(
            saved.messages[1]["stopReason"],
            if cancelled { "aborted" } else { "error" }
        );
        assert_eq!(saved.messages[1]["responseId"], "partial");
    }
}

#[tokio::test]
async fn panic_does_not_release_independent_host_work_and_failed_drain_is_retryable() {
    let host = Fixture::new();
    host.drain_gate.forget_permits(100);
    *host.panic_at.lock().unwrap() = Some("model");
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Explain".into(), 10)
        .await
        .unwrap();
    host.drain_entered.notified().await;
    assert!(owner.snapshot().await.unwrap().task_active);
    assert!(owner.is_busy());
    host.drain_error.store(true, Ordering::SeqCst);
    host.drain_gate.add_permits(1);
    loop {
        let state = owner.state.lock().await;
        if state.snapshot.phase == Phase::PersistenceFailed {
            break;
        }
        drop(state);
        tokio::task::yield_now().await;
    }
    assert!(owner.is_busy());
    assert!(owner.snapshot().await.unwrap().task_active);
    host.drain_error.store(false, Ordering::SeqCst);
    host.drain_gate.add_permits(1);
    owner.retry_persistence().await.unwrap();
    assert!(!owner.is_busy());
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn tool_questions_suspend_generation_and_answer_starts_a_distinct_work_period() {
    let host = Fixture::new();
    *host.tool_output.lock().unwrap() = Some(ToolResult::json(
        json!({"question":{"id":"tool-question","prompt":"Which option?"}}),
    ));
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Choose".into(), 10)
        .await
        .unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    assert_eq!(
        questions::pending(&host.durable()).unwrap()["id"],
        "tool-question"
    );
    apply(&owner,"answer",json!({"type":"answerQuestion","response":{"questionId":"tool-question","text":"This option"},"input":input("This option"),"timestamp":11})).await.unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    assert_eq!(host.models.load(Ordering::SeqCst), 2);
    let record = host.durable();
    let events = &record.runtime.as_ref().unwrap().events;
    assert_eq!(
        events
            .iter()
            .filter(|e| e.kind == "work_block_start")
            .count(),
        2
    );
    assert_eq!(
        events.iter().filter(|e| e.kind == "work_block_end").count(),
        2
    );
    assert!(
        events
            .iter()
            .filter(|e| e.kind == "work_block_start")
            .all(|e| e.data["startedAt"].is_u64())
    );
    assert!(questions::pending(&record).is_none());
    assert_eq!(record.messages[3]["content"], "This option");
}

#[tokio::test]
async fn preparation_refreshes_next_request_after_steering_without_retargeting_the_old_batch() {
    let host = Fixture::new();
    host.tool_gate.forget_permits(20);
    let admitted = json!({"role":"system","content":"Admission instructions"});
    host.config.lock().unwrap().instructions = vec![admitted.clone()];
    *host.prepare_model.lock().unwrap() = Some(Box::new(move |host, config, _| {
        assert_eq!(config.instructions, vec![admitted.clone()]);
        let cycle = host.preparations.lock().unwrap().len();
        if cycle > 1 {
            assert!(host.effects.load(Ordering::SeqCst) >= 2);
            assert_eq!(
                host.storage
                    .find_conversation_input_state("chat", "steering")
                    .unwrap()
                    .as_deref(),
                Some("consumed")
            );
        }
        let generation = if cycle == 1 { "Old" } else { "New" };
        config.instructions =
            vec![json!({"role":"system","content":format!("{generation} request instructions")})];
        host.definitions.lock().unwrap()[0].description = format!("{generation} tool");
        *host.provenance.lock().unwrap() = json!({"pluginId":"fixture","pluginName":generation});
        Ok(())
    }));
    let mut batch = turn(true);
    let mut second = batch["content"][0].clone();
    second["id"] = json!("call-2");
    batch["content"].as_array_mut().unwrap().push(second);
    let mut next = turn(true);
    next["content"][0]["id"] = json!("call-3");
    *host.turns.lock().unwrap() = VecDeque::from([batch, next, turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Activate and continue".into(), 10)
        .await
        .unwrap();
    host.tool_entered.notified().await;
    apply(&owner, "steering", json!({"type":"enqueue","kind":"steering","input":input("Use the activated capability"),"timestamp":11})).await.unwrap();
    host.definitions.lock().unwrap()[0].description = "Retired live tool".into();
    *host.provenance.lock().unwrap() = json!({"pluginId":"fixture","pluginName":"Retired"});
    host.tool_gate.add_permits(20);
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(host.preparations.lock().unwrap().len(), 3);
    let requests = host.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].definitions[0].description, "Old tool");
    assert_eq!(requests[1].definitions[0].description, "New tool");
    assert_eq!(
        requests[1].config.instructions[0]["content"],
        "New request instructions"
    );
    assert!(
        requests[1]
            .context
            .iter()
            .any(|message| message["content"] == "Use the activated capability")
    );
    let dispatched = host.dispatched_definitions.lock().unwrap();
    assert_eq!(
        dispatched
            .iter()
            .map(|definition| definition.description.as_str())
            .collect::<Vec<_>>(),
        ["Old tool", "Old tool", "New tool"]
    );
    let configs = host.tool_configs.lock().unwrap();
    assert_eq!(
        configs[0].instructions[0]["content"],
        "Old request instructions"
    );
    assert_eq!(
        configs[1].instructions[0]["content"],
        "Old request instructions"
    );
    assert_eq!(
        configs[2].instructions[0]["content"],
        "New request instructions"
    );
    let record = host.durable();
    let intents = record
        .runtime
        .as_ref()
        .unwrap()
        .events
        .iter()
        .filter(|event| event.kind == "tool_intent")
        .collect::<Vec<_>>();
    assert_eq!(
        intents
            .iter()
            .map(|event| event.data["provenance"]["pluginName"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Old", "Old", "New"]
    );
    assert_eq!(host.effects.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn prepared_instructions_drive_compaction_budget_without_reaching_auxiliary_requests() {
    let host = Fixture::new();
    {
        let mut config = host.config.lock().unwrap();
        config.context_window = 4096;
        config.max_tokens = 512;
        config.generate_comments = true;
        config.instructions = vec![json!({"role":"system","content":"Admission instructions"})];
        config.settings = json!({"main":"captured-main","small":"captured-small"});
    }
    let admitted = serde_json::to_value(host.config.lock().unwrap().clone()).unwrap();
    *host.prepare_model.lock().unwrap() = Some(Box::new(|_, config, _| {
        config.instructions =
            vec![json!({"role":"system","content":"PrivatePreparedInstructions ".repeat(300)})];
        Ok(())
    }));
    let mut record = host.durable();
    record.messages =
        json!([{"role":"user","content":"Earlier input ".repeat(250),"timestamp":1},turn(false)]);
    save_record(&host.storage, &record).unwrap();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    host.gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Current request".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    host.aux_entered.notified().await;
    host.gate.add_permits(20);
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(host.preparations.lock().unwrap().len(), 1);
    assert_eq!(
        serde_json::to_value(host.config.lock().unwrap().clone()).unwrap(),
        admitted
    );
    let requests = host.requests.lock().unwrap();
    assert!(
        requests
            .iter()
            .any(|request| request.kind == RequestKind::Compaction)
    );
    assert!(
        requests
            .iter()
            .any(|request| request.kind == RequestKind::Comment)
    );
    let main = requests
        .iter()
        .find(|request| request.kind == RequestKind::Main)
        .unwrap();
    assert!(
        main.config.instructions[0]["content"]
            .as_str()
            .unwrap()
            .contains("PrivatePreparedInstructions")
    );
    assert_eq!(main.config.settings, admitted["settings"]);
    for auxiliary in requests
        .iter()
        .filter(|request| request.kind != RequestKind::Main)
    {
        assert!(
            !serde_json::to_string(&auxiliary.context)
                .unwrap()
                .contains("PrivatePreparedInstructions")
        );
        assert!(
            !serde_json::to_string(&auxiliary.config.instructions)
                .unwrap()
                .contains("PrivatePreparedInstructions")
        );
        assert!(auxiliary.definitions.is_empty());
    }
}

#[tokio::test]
async fn failed_cancelled_or_contract_breaking_preparation_never_advertises_or_requests_a_model() {
    for failure in [
        "error", "cancel", "settings", "window", "output", "title", "comments",
    ] {
        let host = Fixture::new();
        let admitted = serde_json::to_value(host.config.lock().unwrap().clone()).unwrap();
        *host.prepare_model.lock().unwrap() = Some(Box::new(move |_, config, cancel| {
            config.instructions =
                vec![json!({"role":"system","content":"Uncommitted instructions"})];
            match failure {
                "error" => return Err("prepare-failed".into()),
                "cancel" => cancel.cancel(),
                "settings" => config.settings = json!({"main":"changed-model"}),
                "window" => config.context_window += 1,
                "output" => config.max_tokens += 1,
                "title" => config.generate_title = true,
                "comments" => config.generate_comments = true,
                _ => unreachable!(),
            }
            Ok(())
        }));
        let owner = Owner::open(host.clone()).await.unwrap();
        owner
            .submit("run".into(), "Current request".into(), 10)
            .await
            .unwrap();
        let snapshot = owner.settled().await.unwrap();
        if failure == "error" {
            assert_eq!(snapshot.error.as_deref(), Some("prepare-failed"));
        } else if failure != "cancel" {
            assert_eq!(snapshot.error.as_deref(), Some("native.ai.model.invalid"));
        }
        assert_eq!(host.preparations.lock().unwrap().len(), 1);
        assert_eq!(host.definition_reads.load(Ordering::SeqCst), 0);
        assert!(host.requests.lock().unwrap().is_empty());
        assert!(host.dispatched_definitions.lock().unwrap().is_empty());
        assert!(
            !snapshot
                .record
                .runtime
                .unwrap()
                .events
                .iter()
                .any(|event| event.kind == "model_request_intent")
        );
        assert_eq!(
            serde_json::to_value(host.config.lock().unwrap().clone()).unwrap(),
            admitted
        );
        assert!(!owner.is_busy());
    }
}

#[tokio::test]
async fn compaction_updates_only_derived_context_and_records_separate_usage() {
    let host = Fixture::new();
    {
        let mut config = host.config.lock().unwrap();
        config.context_window = 1024;
        config.max_tokens = 256;
    }
    let mut record = host.durable();
    let mut earlier = turn(false);
    earlier["content"][0]["text"] = json!("Earlier response ".repeat(500));
    record.messages =
        json!([{"role":"user","content":"Earlier input ".repeat(500),"timestamp":1},earlier]);
    let original = record.messages.clone();
    save_record(&host.storage, &record).unwrap();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Current request".into(), 10)
        .await
        .unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    let record = host.durable();
    let history = host
        .storage
        .read_conversation_history("chat", None, 1000)
        .unwrap();
    let messages: Vec<Value> = history
        .entries
        .iter()
        .filter(|entry| entry.kind == "message")
        .map(|entry| entry.data["message"].clone())
        .collect();
    assert_eq!(&messages[..2], original.as_array().unwrap());
    assert_eq!(owner.snapshot().await.unwrap().message_offset, 2);
    assert_eq!(
        record
            .runtime
            .as_ref()
            .unwrap()
            .checkpoint
            .as_ref()
            .unwrap()
            .source_count,
        0
    );
    let requests = host.requests.lock().unwrap();
    let main = requests
        .iter()
        .find(|r| r.kind == RequestKind::Main)
        .unwrap();
    assert_eq!(main.context.len(), 2);
    assert_eq!(main.context[1]["content"], "Current request");
    assert!(
        main.context[0]["content"]
            .as_str()
            .unwrap()
            .contains("Context summary")
    );
    let usage = record.runtime.as_ref().unwrap().runs[0]
        .usage
        .as_ref()
        .unwrap();
    assert!(usage.iter().any(|entry| entry["kind"] == "compaction"));
    assert_eq!(
        usage.iter().filter(|entry| entry["kind"] == "main").count(),
        1
    );
}

#[tokio::test]
async fn compaction_requests_use_only_summary_instructions_without_main_context_or_tools() {
    let host = Fixture::new();
    let private = [
        "PrivateWorkingMethod",
        "PrivateDevelopment",
        "PrivateSkill",
        "PrivateOnboarding",
        "PrivateMainSystem",
    ];
    let instructions = private
        .iter()
        .map(|text| json!({"role":"system","content":text}))
        .collect::<Vec<_>>();
    {
        let mut config = host.config.lock().unwrap();
        config.context_window = 2048;
        config.max_tokens = 512;
        config.instructions = instructions.clone();
    }
    *host.context_prefix.lock().unwrap() = instructions;
    host.definitions.lock().unwrap()[0].description = "PrivateToolDefinition".into();
    let mut record = host.durable();
    let mut earlier = turn(false);
    earlier["content"][0]["text"] = json!("Earlier response ".repeat(500));
    record.messages =
        json!([{"role":"user","content":"Earlier input ".repeat(500),"timestamp":1},earlier]);
    save_record(&host.storage, &record).unwrap();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Current request".into(), 10)
        .await
        .unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    let requests = host.requests.lock().unwrap();
    let summaries = requests
        .iter()
        .filter(|request| request.kind == RequestKind::Compaction)
        .collect::<Vec<_>>();
    assert!(!summaries.is_empty());
    for request in summaries {
        assert_eq!(request.context.len(), 1);
        assert_eq!(request.context[0]["role"], "user");
        assert!(request.definitions.is_empty());
        assert_eq!(request.config.max_tokens, 512);
        assert_eq!(request.config.instructions.len(), 1);
        assert!(
            request.config.instructions[0]["content"]
                .as_str()
                .unwrap()
                .contains("Do not use tools")
        );
        let prompt = serde_json::to_string(&request.context).unwrap()
            + &serde_json::to_string(&request.config.instructions).unwrap();
        for excluded in private.iter().copied().chain(["PrivateToolDefinition"]) {
            assert!(!prompt.contains(excluded));
        }
    }
    let main = requests
        .iter()
        .find(|request| request.kind == RequestKind::Main)
        .unwrap();
    assert_eq!(main.config.max_tokens, 512);
    assert!(!main.definitions.is_empty());
    for expected in private {
        assert!(
            serde_json::to_string(&main.context)
                .unwrap()
                .contains(expected)
        );
    }
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn summary_tool_calls_never_gain_execution_permission_even_with_a_normal_finish_reason() {
    let host = Fixture::new();
    {
        let mut config = host.config.lock().unwrap();
        config.context_window = 1024;
        config.max_tokens = 256;
    }
    let mut record = host.durable();
    record.messages =
        json!([{"role":"user","content":"Older input ".repeat(1000),"timestamp":1},turn(false)]);
    save_record(&host.storage, &record).unwrap();
    let mut response = turn(true);
    response["stopReason"] = json!("stop");
    response["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"text","text":"A purported summary"}));
    *host.compaction_response.lock().unwrap() = response;
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Current request".into(), 10)
        .await
        .unwrap();
    let snapshot = owner.settled().await.unwrap();
    assert_eq!(snapshot.error.as_deref(), Some("chat.compactionFailed"));
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert!(
        host.requests.lock().unwrap().iter().all(
            |request| request.kind == RequestKind::Compaction && request.definitions.is_empty()
        )
    );
    assert!(
        snapshot
            .record
            .runtime
            .as_ref()
            .unwrap()
            .checkpoint
            .is_none()
    );
}

#[tokio::test]
async fn panic_after_progress_retains_the_observed_partial_without_replaying_generation() {
    let host = Fixture::new();
    host.partials.lock().unwrap().push(Progress::PartialMessage(
        json!({"role":"assistant","content":[{"type":"text","text":"Before panic"}]}),
    ));
    *host.panic_at.lock().unwrap() = Some("model");
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Explain".into(), 10)
        .await
        .unwrap();
    assert_eq!(
        owner.settled().await.unwrap().phase,
        Phase::PersistenceFailed
    );
    owner.retry_persistence().await.unwrap();
    assert_eq!(
        host.durable().messages[1]["content"][0]["text"],
        "Before panic"
    );
    assert_eq!(host.durable().messages[1]["usage"], Value::Null);
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn plugin_notifications_are_validated_receipted_facts_not_new_work() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let action = json!({"version":1,"type":"notifyPluginAvailable","pluginId":"plugin"});
    owner.apply("plugin".into(), action.clone()).await.unwrap();
    owner.apply("plugin".into(), action).await.unwrap();
    let record = host.durable();
    let events = &record.runtime.as_ref().unwrap().events;
    assert_eq!(
        events
            .iter()
            .filter(|e| e.kind == "plugin_available")
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .find(|e| e.kind == "plugin_available")
            .unwrap()
            .data["pluginName"],
        "Active fixture"
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert!(!owner.is_busy());
}
