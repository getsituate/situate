use super::*;

fn pending() -> (State, oneshot::Receiver<Result<Value, String>>) {
    let (sender, receiver) = oneshot::channel();
    let mut state = State::default();
    state.pending.insert(
        "request".into(),
        Pending {
            renderer: "renderer".into(),
            identity: (7, "invocation".into()),
            sender,
        },
    );
    (state, receiver)
}

#[tokio::test]
async fn only_the_bound_renderer_and_full_identity_can_acknowledge() {
    let (mut state, receiver) = pending();
    for (window, generation, invocation, request) in [
        ("other", 7, "invocation", "request"),
        ("main", 7, "invocation", "request"),
        ("renderer", 6, "invocation", "request"),
        ("renderer", 7, "other", "request"),
        ("renderer", 7, "invocation", "other"),
    ] {
        assert!(take_reply(&mut state, window, generation, invocation, request).is_err());
        assert_eq!(state.pending.len(), 1);
    }
    let accepted = take_reply(&mut state, "renderer", 7, "invocation", "request").unwrap();
    accepted.sender.send(Ok(json!({"observed":true}))).unwrap();
    assert_eq!(receiver.await.unwrap().unwrap(), json!({"observed":true}));
    assert!(take_reply(&mut state, "renderer", 7, "invocation", "request").is_err());
}

fn owned(renderer: &str) -> Presentation {
    Presentation {
        window: "main".into(),
        scope: "scope".into(),
        renderer: renderer.into(),
        ready: watch::channel(None).0,
        capture: Arc::new(tokio::sync::Mutex::new(())),
    }
}

#[test]
fn messages_require_the_current_native_renderer_not_just_a_reused_invocation_identity() {
    let mut state = State::default();
    let identity = (7, "invocation".into());
    state
        .presentations
        .insert(identity.clone(), owned("current"));
    assert!(presentation(&state, &identity, "old-renderer").is_err());
    assert!(presentation(&state, &(8, "invocation".into()), "current").is_err());
    assert!(presentation(&state, &(7, "other".into()), "current").is_err());
    let accepted = presentation(&state, &identity, "current").unwrap();
    assert_eq!(accepted.window, "main");
    assert_eq!(accepted.scope, "scope");
}

#[test]
fn only_failed_destruction_can_start_one_explicit_retry() {
    let closing = Closing {
        owned: owned("renderer"),
        result: watch::channel(None).0,
    };
    assert!(!closing.retry_failed_close());
    closing
        .result
        .send_replace(Some(Err("close-failed".into())));
    assert!(closing.retry_failed_close());
    assert!(closing.result.borrow().is_none());
    assert!(!closing.retry_failed_close());
    closing.result.send_replace(Some(Ok(())));
    assert!(!closing.retry_failed_close());
    assert_eq!(*closing.result.borrow(), Some(Ok(())));
}

#[tokio::test]
async fn revocation_removes_only_the_target_renderer_and_its_pending_requests() {
    let (mut state, receiver) = pending();
    let identity = (7, "invocation".into());
    state
        .presentations
        .insert(identity.clone(), owned("renderer"));
    let other_identity = (8, "other".into());
    state
        .presentations
        .insert(other_identity.clone(), owned("other-renderer"));
    let (sender, other_receiver) = oneshot::channel();
    state.pending.insert(
        "other-request".into(),
        Pending {
            renderer: "other-renderer".into(),
            identity: other_identity.clone(),
            sender,
        },
    );
    let (removed, pending) = remove_invocation(&mut state, &identity);
    assert_eq!(removed.unwrap().renderer, "renderer");
    assert!(presentation(&state, &identity, "renderer").is_err());
    assert!(presentation(&state, &other_identity, "other-renderer").is_ok());
    assert_eq!(pending.len(), 1);
    for request in pending {
        request.sender.send(Err(CANCELLED.into())).unwrap();
    }
    assert_eq!(receiver.await.unwrap(), Err(CANCELLED.into()));
    let other = take_reply(&mut state, "other-renderer", 8, "other", "other-request").unwrap();
    other.sender.send(Ok(Value::Bool(true))).unwrap();
    assert_eq!(other_receiver.await.unwrap(), Ok(Value::Bool(true)));
    assert!(remove_invocation(&mut state, &identity).0.is_none());
}

#[tokio::test]
async fn timeout_does_not_claim_a_rendering_acknowledgement() {
    let (mut state, receiver) = pending();
    let cancel = CancellationToken::new();
    assert_eq!(
        await_reply(receiver, &cancel, Duration::ZERO).await,
        Err(UNAVAILABLE.into())
    );
    let late = take_reply(&mut state, "renderer", 7, "invocation", "request").unwrap();
    assert!(late.sender.send(Ok(Value::Bool(true))).is_err());
}

#[tokio::test]
async fn cancelled_checks_never_admit_an_already_ready_renderer() {
    let (_sender, mut ready) = watch::channel(Some(Ok::<_, String>("renderer")));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        await_ready(&mut ready, &cancel).await,
        Err(CANCELLED.into())
    );
}

#[tokio::test]
async fn renderer_readiness_waits_for_bootstrap_and_preserves_startup_failure() {
    let (sender, mut ready) = watch::channel(None::<Result<&str, String>>);
    let cancel = CancellationToken::new();
    let waiting = await_ready(&mut ready, &cancel);
    tokio::pin!(waiting);
    assert!(futures_util::poll!(&mut waiting).is_pending());
    sender.send_replace(Some(Ok("renderer")));
    assert_eq!(waiting.await, Ok("renderer"));
    let (_sender, mut failed) = watch::channel(Some(Err::<&str, _>(UNAVAILABLE.into())));
    assert_eq!(
        await_ready(&mut failed, &cancel).await,
        Err(UNAVAILABLE.into())
    );
}

#[tokio::test]
async fn retirement_waits_for_late_bootstrap_capture_and_confirmed_destruction() {
    let (ready, receiver) = watch::channel(None::<Result<&str, String>>);
    let capture = Arc::new(tokio::sync::Mutex::new(()));
    let in_flight = capture.lock().await;
    let (destroyed, destruction) = oneshot::channel();
    let closing = close_after_bootstrap(receiver, capture.clone(), |opened| async move {
        assert_eq!(opened, Ok("late-renderer"));
        destruction.await.unwrap()
    });
    tokio::pin!(closing);
    assert!(futures_util::poll!(&mut closing).is_pending());
    ready.send_replace(Some(Ok("late-renderer")));
    assert!(futures_util::poll!(&mut closing).is_pending());
    drop(in_flight);
    assert!(futures_util::poll!(&mut closing).is_pending());
    destroyed.send(Ok(())).unwrap();
    assert_eq!(closing.await, Ok(()));
}

#[tokio::test]
async fn failed_bootstrap_still_requires_native_cleanup_and_close_errors_are_preserved() {
    let (_sender, receiver) = watch::channel(Some(Err::<(), _>("bootstrap-failed".into())));
    let result = close_after_bootstrap(
        receiver,
        Arc::new(tokio::sync::Mutex::new(())),
        |opened| async move {
            assert_eq!(opened, Err("bootstrap-failed".into()));
            Err("close-failed".into())
        },
    )
    .await;
    assert_eq!(result, Err("close-failed".into()));
}

#[tokio::test]
async fn cancellation_and_renderer_loss_fail_closed() {
    let (_state, receiver) = pending();
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        await_reply(receiver, &cancel, TIMEOUT).await,
        Err(CANCELLED.into())
    );
    let (state, receiver) = pending();
    drop(state);
    assert_eq!(
        await_reply(receiver, &CancellationToken::new(), TIMEOUT).await,
        Err(UNAVAILABLE.into())
    );
}

#[tokio::test]
async fn cancellation_joins_the_native_capture_before_releasing_its_presentation() {
    let (finish, finished) = oneshot::channel::<Result<String, String>>();
    let cancel = CancellationToken::new();
    let joined = await_capture(async move { finished.await.unwrap() }, &cancel);
    tokio::pin!(joined);
    assert!(futures_util::poll!(&mut joined).is_pending());
    cancel.cancel();
    assert!(futures_util::poll!(&mut joined).is_pending());
    assert!(!finish.is_closed());
    finish
        .send(Ok("captured-before-cancellation".into()))
        .unwrap();
    assert_eq!(joined.await, Err(CANCELLED.into()));
}

#[tokio::test]
async fn cancelled_capture_never_starts_and_native_failures_remain_errors() {
    let started = std::cell::Cell::new(false);
    let cancel = CancellationToken::new();
    cancel.cancel();
    let capture = async {
        started.set(true);
        Ok("unexpected-image".into())
    };
    assert_eq!(await_capture(capture, &cancel).await, Err(CANCELLED.into()));
    assert!(!started.get());
    assert_eq!(
        await_capture(async { Err(UNAVAILABLE.into()) }, &CancellationToken::new()).await,
        Err(UNAVAILABLE.into())
    );
}

#[test]
fn replies_require_explicit_values_and_do_not_expose_renderer_errors() {
    assert!(reply_result(None, None).is_err());
    assert_eq!(
        reply_result(Some(Value::Null), None).unwrap(),
        Ok(Value::Null)
    );
    assert_eq!(
        reply_result(None, Some("private plugin source".into())).unwrap(),
        Err(UNAVAILABLE.into())
    );
    assert!(reply_result(Some(Value::String("x".repeat(MAX_REPLY))), None).is_err());
}
