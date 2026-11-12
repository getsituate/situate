use super::*;
use std::time::Duration;

fn count(host: &Fixture, kind: RequestKind) -> usize {
    host.requests
        .lock()
        .unwrap()
        .iter()
        .filter(|r| r.kind == kind)
        .count()
}

#[tokio::test]
async fn comments_never_receive_full_history_or_instructions_and_do_not_block_main_completion() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    host.aux_gate.forget_permits(100);
    host.aux_ignore_cancel.store(true, Ordering::SeqCst);
    {
        let mut config = host.config.lock().unwrap();
        config.generate_comments = true;
        config.instructions = vec![json!({"role":"system","content":"PRIVATE MAIN INSTRUCTIONS"})];
    }
    let mut record = host.durable();
    record.messages = json!([
        {"role":"user","content":"PRIVATE OLDER REQUEST","timestamp":1},
        {"role":"toolResult","toolCallId":"old","toolName":"read","content":[{"type":"text","text":"PRIVATE RAW RESULT"}],"isError":false,"timestamp":2}
    ]);
    save_record(&host.storage, &record).unwrap();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Topic ".repeat(200), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    host.aux_entered.notified().await;
    {
        let requests = host.requests.lock().unwrap();
        let request = requests
            .iter()
            .find(|r| r.kind == RequestKind::Comment)
            .unwrap();
        assert_eq!(request.context.len(), 1);
        let serialized = serde_json::to_string(&request.context).unwrap()
            + &serde_json::to_string(&request.config.instructions).unwrap();
        for excluded in [
            "PRIVATE MAIN INSTRUCTIONS",
            "PRIVATE OLDER REQUEST",
            "PRIVATE RAW RESULT",
        ] {
            assert!(!serialized.contains(excluded));
        }
        assert!(
            request.context[0]["content"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                < 400
        );
        assert!(request.definitions.is_empty());
        assert!(request.config.max_tokens <= 96);
    }
    host.gate.add_permits(1);
    let settled = tokio::time::timeout(Duration::from_secs(2), owner.settled())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(settled.phase, Phase::Idle);
    assert!(!owner.is_busy());
    assert_eq!(count(&host, RequestKind::Comment), 1);
    let before = host.durable();
    host.aux_gate.add_permits(1);
    tokio::task::yield_now().await;
    assert_eq!(host.durable(), before);
}

#[tokio::test]
async fn disabled_auxiliaries_make_no_requests_and_auxiliary_partials_cannot_replace_main() {
    let host = Fixture::new();
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("disabled".into(), "Topic".into(), 10)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    assert_eq!(count(&host, RequestKind::Comment), 0);
    assert_eq!(count(&host, RequestKind::Title), 0);
    let host = Fixture::new();
    host.gate.forget_permits(20);
    host.config.lock().unwrap().generate_comments = true;
    host.partials.lock().unwrap().push(Progress::PartialMessage(
        json!({"role":"assistant","content":[{"type":"text","text":"Main partial"}]}),
    ));
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Topic".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    host.aux_entered.notified().await;
    assert_eq!(
        owner.snapshot().await.unwrap().partial_message.unwrap()["content"][0]["text"],
        "Main partial"
    );
    owner.cancel_retained();
    owner.settled().await.unwrap();
    assert_eq!(
        host.durable().messages[1]["content"][0]["text"],
        "Main partial"
    );
}

#[tokio::test]
async fn title_uses_only_first_bounded_request_and_cannot_overwrite_manual_rename() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    host.aux_gate.forget_permits(100);
    host.aux_ignore_cancel.store(true, Ordering::SeqCst);
    host.config.lock().unwrap().generate_title = true;
    *host.prepare_model.lock().unwrap() = Some(Box::new(|_, config, _| {
        config.instructions =
            vec![json!({"role":"system","content":"PrivatePreparedInstructions"})];
        Ok(())
    }));
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Topic ".repeat(1000), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    host.aux_entered.notified().await;
    {
        let requests = host.requests.lock().unwrap();
        let request = requests
            .iter()
            .find(|r| r.kind == RequestKind::Title)
            .unwrap();
        assert_eq!(request.context.len(), 1);
        assert_eq!(
            request.context[0]["content"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            2000
        );
        assert!(request.definitions.is_empty());
        assert!(request.config.max_tokens <= 96);
        assert_eq!(host.preparations.lock().unwrap().len(), 1);
        assert!(
            !serde_json::to_string(&request.config)
                .unwrap()
                .contains("PrivatePreparedInstructions")
        );
        assert!(
            request.config.instructions[0]["content"]
                .as_str()
                .unwrap()
                .contains("3–7 words")
        );
    }
    let expected = owner.snapshot().await.unwrap().record.title;
    owner
        .apply(
            "rename".into(),
            json!({"version":1,"type":"renameTitle","expected":expected,"title":"Manual title"}),
        )
        .await
        .unwrap();
    host.aux_gate.add_permits(1);
    host.gate.add_permits(1);
    assert_eq!(owner.settled().await.unwrap().record.title, "Manual title");
    assert_eq!(host.durable().title, "Manual title");
}

#[tokio::test(start_paused = true)]
async fn comments_are_throttled_and_only_changed_descriptions_trigger_another_request() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    host.config.lock().unwrap().generate_comments = true;
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Topic".into(), 10)
        .await
        .unwrap();
    host.aux_entered.notified().await;
    loop {
        let changed = owner.changed.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        if owner.snapshot().await.unwrap().activity_comment == "Finished" {
            break;
        }
        changed.await;
    }
    tokio::time::advance(Duration::from_secs(60)).await;
    assert_eq!(count(&host, RequestKind::Comment), 1);
    owner
        .checkpoint("run", |record| {
            append_event(
                record,
                "run",
                "tool_intent",
                json!({"name":"read","args":{},"toolCallId":"read"}),
            )
        })
        .await
        .unwrap();
    tokio::time::advance(Duration::from_secs(15)).await;
    host.aux_entered.notified().await;
    assert_eq!(count(&host, RequestKind::Comment), 2);
    owner.cancel_retained();
    owner.settled().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_timed_out_comment_does_not_overlap_an_unwinding_provider_or_block_terminal_cleanup() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    host.aux_gate.forget_permits(100);
    host.aux_ignore_cancel.store(true, Ordering::SeqCst);
    host.config.lock().unwrap().generate_comments = true;
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Topic".into(), 10)
        .await
        .unwrap();
    host.aux_entered.notified().await;
    tokio::time::advance(Duration::from_secs(8)).await;
    owner
        .checkpoint("run", |record| {
            append_event(
                record,
                "run",
                "tool_intent",
                json!({"name":"read","args":{},"toolCallId":"read"}),
            )
        })
        .await
        .unwrap();
    tokio::time::advance(Duration::from_secs(60)).await;
    assert_eq!(count(&host, RequestKind::Comment), 1);
    owner.cancel_retained();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Interrupted);
    assert!(!owner.is_busy());
}

#[tokio::test]
async fn failed_auxiliary_inference_does_not_fail_main_or_repeat_unchanged_context() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    host.config.lock().unwrap().generate_comments = true;
    *host.aux_response.lock().unwrap() = Err("auxiliary-network-error".into());
    *host.turns.lock().unwrap() = VecDeque::from([turn(false)]);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("run".into(), "Topic".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    host.aux_entered.notified().await;
    host.gate.add_permits(1);
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    assert_eq!(count(&host, RequestKind::Comment), 1);
    assert_eq!(owner.snapshot().await.unwrap().error, None);
}
