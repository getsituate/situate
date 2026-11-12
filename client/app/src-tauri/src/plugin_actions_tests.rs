use super::*;
use futures_util::poll;
use serde_json::json;
use std::task::Poll;

fn ids(values: &[&str]) -> HashSet<String> {
    values.iter().map(|value| (*value).into()).collect()
}

fn begin(scope: &Scope, window: &str, required: &[&str]) -> String {
    scope
        .begin(
            required[0],
            window,
            crate::workspaces::AuthorizationSession::for_test(),
            || Ok(ids(required)),
        )
        .unwrap()
}

fn gate(scope: &Arc<Scope>, affected: &[&str]) -> PublicationGate {
    scope
        .gate(&affected.iter().map(|id| (*id).into()).collect::<Vec<_>>())
        .unwrap()
}

#[tokio::test]
async fn disable_allows_running_roots_to_make_host_calls_then_drains_them_before_publication() {
    let scope = Arc::new(Scope::default());
    let first = begin(&scope, "first", &["consumer", "connection"]);
    let second = begin(&scope, "second", &["consumer", "connection", "indirect"]);
    let unrelated = begin(&scope, "second", &["other"]);
    let request = host_request(&scope, &["consumer", "connection"]);
    let gate = scope
        .gate(&["connection".into(), "consumer".into()])
        .unwrap();
    let later_request = host_request(&scope, &["consumer", "connection"]);
    let other_request = host_request(&scope, &["other"]);
    let (actions, requests) = scope
        .counts(&["connection".into(), "consumer".into()])
        .unwrap();
    assert_eq!(
        serde_json::to_value(actions).unwrap(),
        json!([{"pluginId":"consumer","count":2}])
    );
    assert_eq!(requests, 2);
    let cancel = CancellationToken::new();
    let drain = gate.wait(&cancel);
    tokio::pin!(drain);
    assert!(poll!(&mut drain).is_pending());
    scope.end("first", &first).unwrap();
    scope.end("second", &second).unwrap();
    assert!(matches!(scope.request(|| Ok(ids(&["connection"]))), Err(error) if error == BUSY));
    assert!(poll!(&mut drain).is_pending());
    drop(request);
    assert!(poll!(&mut drain).is_pending());
    drop(later_request);
    drain.await.unwrap();
    gate.release();
    let resumed = host_request(&scope, &["connection"]);
    drop(resumed);
    drop(other_request);
    scope.end("second", &unrelated).unwrap();
}

#[tokio::test]
async fn releasing_disable_gate_cancels_drain_without_ending_running_work() {
    let scope = Arc::new(Scope::default());
    let action = begin(&scope, "first", &["consumer", "connection"]);
    let request = host_request(&scope, &["connection"]);
    let gate = scope.gate(&["connection".into()]).unwrap();
    let cancel = CancellationToken::new();
    let drain = gate.wait(&cancel);
    tokio::pin!(drain);
    assert!(poll!(&mut drain).is_pending());
    cancel.cancel();
    gate.release();
    assert_eq!(drain.await, Err(CANCELLED.into()));
    let (actions, requests) = scope.counts(&["connection".into()]).unwrap();
    assert_eq!(actions[0].count, 1);
    assert_eq!(requests, 1);
    let resumed = host_request(&scope, &["connection"]);
    scope.end("first", &action).unwrap();
    drop(request);
    drop(resumed);
}

#[tokio::test]
async fn shared_scope_drains_actions_across_windows_but_only_owner_can_end() {
    let actions = Actions::default();
    let first_window = actions.scope("workspace").unwrap();
    let second_window = actions.scope("workspace").unwrap();
    let first = begin(&first_window, "first", &["consumer", "connection"]);
    let second = begin(&second_window, "second", &["connection"]);
    let cancel = CancellationToken::new();
    let draining = gate(&first_window, &["connection"]).drain(&cancel);
    tokio::pin!(draining);
    assert!(poll!(&mut draining).is_pending());
    assert_eq!(second_window.end("second", &first), Err(UNAVAILABLE.into()));
    assert!(second_window.authorization("second", &first).is_err());
    assert!(poll!(&mut draining).is_pending());
    second_window.end("second", &second).unwrap();
    assert!(poll!(&mut draining).is_pending());
    first_window.end("first", &first).unwrap();
    let held = draining.await.unwrap();
    assert_eq!(first_window.end("first", &first), Err(UNAVAILABLE.into()));
    drop(held);
}

#[tokio::test]
async fn affected_admission_is_gated_while_unaffected_actions_and_publications_continue() {
    let scope = Arc::new(Scope::default());
    let first = begin(&scope, "first", &["consumer", "connection"]);
    let cancel = CancellationToken::new();
    let draining = gate(&scope, &["connection"]).drain(&cancel);
    tokio::pin!(draining);
    assert!(poll!(&mut draining).is_pending());
    assert_eq!(
        scope.begin(
            "root",
            "second",
            crate::workspaces::AuthorizationSession::for_test(),
            || { Ok(ids(&["other-consumer", "connection"])) }
        ),
        Err(BUSY.into())
    );
    let independent = begin(&scope, "second", &["unrelated"]);
    let other_gate = gate(&scope, &["another"]).drain(&cancel).await.unwrap();
    scope.end("first", &first).unwrap();
    let held = draining.await.unwrap();
    assert!(scope.gate(&["connection".into()]).is_err());
    drop(held);
    let new_action = begin(&scope, "second", &["connection"]);
    assert_eq!(
        scope.begin(
            "root",
            "second",
            crate::workspaces::AuthorizationSession::for_test(),
            || { Ok(ids(&["another"])) }
        ),
        Err(BUSY.into())
    );
    scope.end("second", &new_action).unwrap();
    scope.end("second", &independent).unwrap();
    drop(other_gate);
}

#[tokio::test]
async fn cancellation_releases_only_gate_and_never_fabricates_action_completion() {
    let scope = Arc::new(Scope::default());
    let first = begin(&scope, "first", &["connection"]);
    let cancel = CancellationToken::new();
    let draining = gate(&scope, &["connection"]).drain(&cancel);
    tokio::pin!(draining);
    assert!(poll!(&mut draining).is_pending());
    cancel.cancel();
    assert!(matches!(draining.await, Err(error) if error == CANCELLED));
    let second = begin(&scope, "second", &["connection"]);
    let retry_cancel = CancellationToken::new();
    let retry = gate(&scope, &["connection"]).drain(&retry_cancel);
    tokio::pin!(retry);
    scope.end("second", &second).unwrap();
    assert!(poll!(&mut retry).is_pending());
    scope.end("first", &first).unwrap();
    drop(retry.await.unwrap());
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(
        matches!(gate(&scope, &["connection"]).drain(&cancelled).await,
        Err(error) if error == CANCELLED)
    );
    begin(&scope, "first", &["connection"]);
}

#[tokio::test]
async fn actual_close_releases_actions_and_stale_gates_cannot_touch_reopened_scope() {
    let actions = Actions::default();
    let old = actions.scope("workspace").unwrap();
    let action = begin(&old, "first", &["connection"]);
    let cancel = CancellationToken::new();
    let draining = gate(&old, &["connection"]).drain(&cancel);
    tokio::pin!(draining);
    assert!(poll!(&mut draining).is_pending());
    let stale_held = gate(&old, &["other"]);
    actions.invalidate("workspace");
    assert!(matches!(draining.await, Err(error) if error == UNAVAILABLE));
    assert!(old.end("first", &action).is_err());
    assert!(
        old.begin(
            "root",
            "first",
            crate::workspaces::AuthorizationSession::for_test(),
            || { Ok(ids(&["connection"])) }
        )
        .is_err()
    );
    let reopened = actions.scope("workspace").unwrap();
    let held = gate(&reopened, &["other"]);
    drop(stale_held);
    assert_eq!(
        reopened.begin(
            "root",
            "second",
            crate::workspaces::AuthorizationSession::for_test(),
            || { Ok(ids(&["other"])) }
        ),
        Err(BUSY.into())
    );
    drop(held);
    begin(&reopened, "second", &["connection", "other"]);
}

#[tokio::test]
async fn nested_required_dependency_admission_counts_for_transitive_connection() {
    let required = required_closure("view", |id| {
        Ok(match id {
            "view" => json!({"dependencies": ["consumer", "connection"]}),
            "consumer" => json!({"dependencies": ["connection"]}),
            "connection" => json!({}),
            _ => panic!("unexpected plugin"),
        })
    })
    .unwrap();
    assert_eq!(required, ids(&["view", "consumer", "connection"]));
    let scope = Arc::new(Scope::default());
    let action = scope
        .begin(
            "root",
            "first",
            crate::workspaces::AuthorizationSession::for_test(),
            || Ok(required.clone()),
        )
        .unwrap();
    let cancel = CancellationToken::new();
    let draining = gate(&scope, &["connection"]).drain(&cancel);
    tokio::pin!(draining);
    assert!(poll!(&mut draining).is_pending());
    assert_eq!(
        scope.begin(
            "root",
            "second",
            crate::workspaces::AuthorizationSession::for_test(),
            || { Ok(required) }
        ),
        Err(BUSY.into())
    );
    scope.end("first", &action).unwrap();
    drop(draining.await.unwrap());
}

#[test]
fn active_manifest_errors_never_admit_partial_dependency_closure() {
    assert_eq!(
        required_closure("consumer", |id| {
            if id == "consumer" {
                Ok(json!({"dependencies": ["connection"]}))
            } else {
                Err("native.plugins.recoveryBlocked".into())
            }
        }),
        Err("native.plugins.recoveryBlocked".into())
    );
    assert_eq!(
        required_closure("consumer", |_| Ok(json!({"dependencies": 5}))),
        Err("native.plugins.invalidManifest".into())
    );
}

#[test]
fn revisions_must_match_exact_active_closure_including_provider() {
    let required = ids(&["consumer", "connection"]);
    let listing = json!({"plugins": [
        {"id":"consumer", "enabled":true, "revision":"root-same"},
        {"id":"connection", "enabled":true, "revision":"provider-new"},
        {"id":"unrelated", "enabled":true, "revision":"ignored"}
    ]});
    let current = HashMap::from([
        ("consumer".into(), Some("root-same".into())),
        ("connection".into(), Some("provider-new".into())),
    ]);
    validate_revisions(&required, Some(&current), listing.clone()).unwrap();
    let mut stale = current.clone();
    stale.insert("connection".into(), Some("provider-old".into()));
    let mut missing = current.clone();
    missing.remove("connection");
    let mut extra = current.clone();
    extra.insert("unrelated".into(), Some("ignored".into()));
    for revisions in [None, Some(stale), Some(missing), Some(extra)] {
        assert_eq!(
            validate_revisions(&required, revisions.as_ref(), listing.clone()),
            Err("native.plugins.stateConflict".into())
        );
    }
}

#[test]
fn omitted_revisions_are_allowed_only_for_entirely_legacy_closure() {
    let required = ids(&["consumer", "connection"]);
    let legacy = json!({"plugins": [
        {"id":"consumer", "enabled":true},
        {"id":"connection", "enabled":true, "revision":null}
    ]});
    validate_revisions(&required, None, legacy.clone()).unwrap();
    let explicit = HashMap::from([("consumer".into(), None), ("connection".into(), None)]);
    validate_revisions(&required, Some(&explicit), legacy.clone()).unwrap();
    let mut mixed = legacy.clone();
    mixed["plugins"][1]["revision"] = json!("published");
    assert!(validate_revisions(&required, None, mixed.clone()).is_err());
    assert!(validate_revisions(&required, Some(&explicit), mixed).is_err());
    let mut disabled = legacy;
    disabled["plugins"][1]["enabled"] = json!(false);
    assert!(validate_revisions(&required, None, disabled).is_err());
}

#[tokio::test]
async fn revision_conflict_does_not_leave_an_inflight_action() {
    let scope = Arc::new(Scope::default());
    let result = scope.begin(
        "root",
        "first",
        crate::workspaces::AuthorizationSession::for_test(),
        || {
            let required = ids(&["consumer"]);
            validate_revisions(
                &required,
                None,
                json!({"plugins":[
                    {"id":"consumer", "enabled":true, "revision":"published"}
                ]}),
            )?;
            Ok(required)
        },
    );
    assert_eq!(result, Err("native.plugins.stateConflict".into()));
    let cancel = CancellationToken::new();
    let draining = gate(&scope, &["consumer"]).drain(&cancel);
    fn assert_send<T: Send>(value: T) -> T {
        value
    }
    let mut draining = Box::pin(assert_send(draining));
    assert!(matches!(poll!(&mut draining), Poll::Ready(Ok(_))));
}

#[tokio::test]
async fn dropping_unfinished_acquire_future_releases_gate_not_action() {
    let scope = Arc::new(Scope::default());
    let action = begin(&scope, "first", &["connection"]);
    let cancel = CancellationToken::new();
    let mut waiting = Box::pin(gate(&scope, &["connection"]).drain(&cancel));
    assert!(matches!(poll!(&mut waiting), Poll::Pending));
    drop(waiting);
    let another = begin(&scope, "second", &["connection"]);
    scope.end("first", &action).unwrap();
    scope.end("second", &another).unwrap();
}

fn host_request(scope: &Arc<Scope>, required: &[&str]) -> RequestLease {
    scope.request(|| Ok(ids(required))).unwrap()
}

#[tokio::test]
async fn host_calls_continue_during_root_drain_then_close_atomically() {
    let scope = Arc::new(Scope::default());
    let root = begin(&scope, "tool-window", &["consumer", "connection"]);
    let cancel = CancellationToken::new();
    let waiting = gate(&scope, &["connection"]).drain(&cancel);
    tokio::pin!(waiting);
    assert!(poll!(&mut waiting).is_pending());
    let first = host_request(&scope, &["connection"]);
    let second = host_request(&scope, &["consumer", "connection"]);
    drop(first);
    let third = host_request(&scope, &["connection"]);
    assert!(poll!(&mut waiting).is_pending());
    scope.end("tool-window", &root).unwrap();
    for _ in 0..100 {
        assert!(matches!(scope.request(|| Ok(ids(&["connection"]))), Err(error) if error == BUSY));
    }
    let unrelated = host_request(&scope, &["unrelated"]);
    assert!(poll!(&mut waiting).is_pending());
    drop(second);
    assert!(poll!(&mut waiting).is_pending());
    drop(third);
    let mut held = waiting.await.unwrap();
    held.published().unwrap();
    drop(host_request(&scope, &["connection"]));
    drop(unrelated);
    drop(held);
}

#[tokio::test]
async fn closing_scope_invalidates_native_leases_without_releasing_reopened_requests() {
    let actions = Actions::default();
    let old = actions.scope("workspace").unwrap();
    let action = begin(&old, "publisher", &["connection"]);
    let old_request = host_request(&old, &["connection"]);
    let lease = ActionLease {
        scope: old.clone(),
        window: "publisher".into(),
        id: action,
    };
    let held = gate(&old, &["connection"]);
    actions.invalidate("workspace");
    assert!(
        old.begin(
            "root",
            "publisher",
            crate::workspaces::AuthorizationSession::for_test(),
            || Ok(ids(&["connection"]))
        )
        .is_err()
    );
    let reopened = actions.scope("workspace").unwrap();
    let request = host_request(&reopened, &["connection"]);
    let cancel = CancellationToken::new();
    let mut waiting = Box::pin(gate(&reopened, &["connection"]).drain(&cancel));
    drop(old_request);
    drop(lease);
    drop(held);
    assert!(poll!(&mut waiting).is_pending());
    drop(request);
    drop(waiting.await.unwrap());
}

#[tokio::test]
async fn no_root_gate_immediately_stops_new_requests_but_waits_existing_ones() {
    let scope = Arc::new(Scope::default());
    let request = host_request(&scope, &["connection"]);
    let cancel = CancellationToken::new();
    let mut waiting = Box::pin(gate(&scope, &["connection"]).drain(&cancel));
    assert!(matches!(scope.request(|| Ok(ids(&["connection"]))), Err(error) if error == BUSY));
    assert!(poll!(&mut waiting).is_pending());
    drop(request);
    let held = waiting.await.unwrap();
    assert!(matches!(scope.request(|| Ok(ids(&["connection"]))), Err(error) if error == BUSY));
    drop(held);
    drop(host_request(&scope, &["connection"]));
}

#[tokio::test]
async fn cancelling_request_drain_reopens_admission_without_ending_inflight_requests() {
    let scope = Arc::new(Scope::default());
    let request = host_request(&scope, &["connection"]);
    let cancel = CancellationToken::new();
    let mut waiting = Box::pin(gate(&scope, &["connection"]).drain(&cancel));
    assert!(poll!(&mut waiting).is_pending());
    cancel.cancel();
    assert!(matches!(waiting.await, Err(error) if error == CANCELLED));
    drop(host_request(&scope, &["connection"]));
    let retry_cancel = CancellationToken::new();
    let mut retry = Box::pin(gate(&scope, &["connection"]).drain(&retry_cancel));
    assert!(poll!(&mut retry).is_pending());
    drop(request);
    drop(retry.await.unwrap());
}

#[tokio::test]
async fn native_request_lease_survives_dropped_waiter_and_root_end() {
    let scope = Arc::new(Scope::default());
    let root = begin(&scope, "tool", &["connection"]);
    let lease = host_request(&scope, &["connection"]);
    let (started, observed) = tokio::sync::oneshot::channel();
    let (finish, finished) = std::sync::mpsc::channel();
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        started.send(()).unwrap();
        finished.recv().unwrap();
    });
    observed.await.unwrap();
    drop(worker);
    scope.end("tool", &root).unwrap();
    let cancel = CancellationToken::new();
    let mut waiting = Box::pin(gate(&scope, &["connection"]).drain(&cancel));
    assert!(poll!(&mut waiting).is_pending());
    finish.send(()).unwrap();
    drop(
        tokio::time::timeout(std::time::Duration::from_secs(5), waiting)
            .await
            .unwrap()
            .unwrap(),
    );
}

#[tokio::test]
async fn published_gate_blocks_all_affected_roots_until_native_release() {
    let state = Actions::default();
    let scope = state.scope("workspace").unwrap();
    let cancel = CancellationToken::new();
    let mut held = gate(&scope, &["connection"]).drain(&cancel).await.unwrap();
    held.published().unwrap();
    for window in ["publisher", "other-window"] {
        for required in [&["connection"][..], &["consumer", "connection"][..]] {
            assert_eq!(
                scope.begin(
                    "root",
                    window,
                    crate::workspaces::AuthorizationSession::for_test(),
                    || Ok(ids(required))
                ),
                Err(BUSY.into())
            );
        }
    }
    let unrelated = begin(&scope, "publisher", &["unrelated"]);
    scope.end("publisher", &unrelated).unwrap();
    let other = state.scope("other-workspace").unwrap();
    let independent = begin(&other, "publisher", &["connection"]);
    other.end("publisher", &independent).unwrap();
    assert!(held.published().is_err());
    held.release();
    let resumed = begin(&scope, "publisher", &["connection"]);
    let lease = ActionLease {
        scope: scope.clone(),
        window: "publisher".into(),
        id: resumed,
    };
    let waiting = gate(&scope, &["connection"]).drain(&cancel);
    tokio::pin!(waiting);
    assert!(poll!(&mut waiting).is_pending());
    drop(lease);
    drop(waiting.await.unwrap());
}

fn disable(
    root: &std::path::Path,
    id: &str,
    expected: Option<String>,
) -> Result<crate::plugin_runtime::Reply, String> {
    crate::plugin_runtime::dispatch(
        root,
        false,
        crate::plugin_runtime::Request::SetEnabled {
            plugin_id: id.into(),
            enabled: false,
            expected_revision: expected,
        },
    )
}

#[tokio::test]
async fn native_disable_waits_for_root_and_independent_host_requests() {
    use situate_core::plugins::runtime;
    let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    std::fs::create_dir(temp.path().join(".situate")).unwrap();
    install(temp.path(), "connection", &[]);
    install(temp.path(), "consumer", &["connection"]);
    install(temp.path(), "unrelated", &[]);
    let revision = runtime::prepare(temp.path()).unwrap().revision;
    let scope = Arc::new(Scope::default());
    let root = begin(&scope, "consumer-window", &["consumer", "connection"]);
    let cancel = CancellationToken::new();
    let pending = async {
        let _gate = gate(&scope, &["connection"]).drain(&cancel).await?;
        disable(temp.path(), "connection", revision)
    };
    tokio::pin!(pending);
    assert!(poll!(&mut pending).is_pending());
    assert!(
        matches!(scope.begin("root", "other-window", crate::workspaces::AuthorizationSession::for_test(), || Ok(ids(&["consumer", "connection"]))), Err(error) if error == BUSY)
    );
    let unrelated = begin(&scope, "other-window", &["unrelated"]);
    let request = host_request(&scope, &["connection"]);
    assert!(runtime::check_enabled(temp.path(), "connection").is_ok());
    scope.end("consumer-window", &root).unwrap();
    assert!(poll!(&mut pending).is_pending());
    assert!(matches!(scope.request(|| Ok(ids(&["connection"]))), Err(error) if error == BUSY));
    assert!(runtime::check_enabled(temp.path(), "connection").is_ok());
    drop(request);
    pending.await.unwrap();
    assert_eq!(
        runtime::check_enabled(temp.path(), "connection"),
        Err("native.plugins.disabled".into())
    );
    let listing = runtime::list(temp.path()).unwrap();
    assert!(
        !listing
            .plugins
            .iter()
            .find(|plugin| plugin.id == "consumer")
            .unwrap()
            .enabled
    );
    assert!(
        listing
            .plugins
            .iter()
            .find(|plugin| plugin.id == "unrelated")
            .unwrap()
            .enabled
    );
    scope.end("other-window", &unrelated).unwrap();
}

#[tokio::test]
async fn native_disable_rechecks_expected_revision_after_drain_without_changing_state() {
    use situate_core::plugins::runtime;
    let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    std::fs::create_dir(temp.path().join(".situate")).unwrap();
    install(temp.path(), "connection", &[]);
    let expected = runtime::prepare(temp.path()).unwrap().revision;
    let scope = Arc::new(Scope::default());
    let root = begin(&scope, "window", &["connection"]);
    let cancel = CancellationToken::new();
    let pending = async {
        let _gate = gate(&scope, &["connection"]).drain(&cancel).await?;
        disable(temp.path(), "connection", expected)
    };
    tokio::pin!(pending);
    assert!(poll!(&mut pending).is_pending());
    install(temp.path(), "unrelated", &[]);
    let before = runtime::list(temp.path()).unwrap().revision;
    scope.end("window", &root).unwrap();
    assert!(matches!(pending.await, Err(error) if error == "native.plugins.stateConflict"));
    assert_eq!(runtime::list(temp.path()).unwrap().revision, before);
    assert!(runtime::check_enabled(temp.path(), "connection").is_ok());
}

#[tokio::test]
async fn closing_scope_during_native_disable_drain_never_dispatches_mutation() {
    use situate_core::plugins::runtime;
    let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    std::fs::create_dir(temp.path().join(".situate")).unwrap();
    install(temp.path(), "connection", &[]);
    let expected = runtime::prepare(temp.path()).unwrap().revision;
    let actions = Actions::default();
    let scope = actions.scope("workspace").unwrap();
    begin(&scope, "window", &["connection"]);
    let cancel = CancellationToken::new();
    let pending = async {
        let _gate = gate(&scope, &["connection"]).drain(&cancel).await?;
        disable(temp.path(), "connection", expected.clone())
    };
    tokio::pin!(pending);
    assert!(poll!(&mut pending).is_pending());
    actions.invalidate("workspace");
    assert!(matches!(pending.await, Err(error) if error == UNAVAILABLE));
    assert_eq!(runtime::list(temp.path()).unwrap().revision, expected);
    assert!(runtime::check_enabled(temp.path(), "connection").is_ok());
}

#[tokio::test]
async fn native_disable_revalidates_closed_or_reopened_authorization_after_drain() {
    use crate::workspaces::{TestSessionChange, with_test_authorized_root};
    use situate_core::plugins::runtime;
    let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    std::fs::create_dir(temp.path().join(".situate")).unwrap();
    install(temp.path(), "connection", &[]);
    let expected = runtime::prepare(temp.path()).unwrap().revision;
    let location = situate_core::workspaces::Location {
        id: "workspace".into(),
        name: "Synthetic".into(),
        display: "Synthetic".into(),
        kind: "path".into(),
        handle: temp.path().to_string_lossy().into_owned(),
    };
    for change in [TestSessionChange::Close, TestSessionChange::Reopen] {
        let scope = Arc::new(Scope::default());
        let cancel = CancellationToken::new();
        let _gate = gate(&scope, &["connection"]).drain(&cancel).await.unwrap();
        let result = with_test_authorized_root(
            &[("window", location.clone())],
            "window",
            "workspace",
            true,
            change,
            |root| disable(root, "connection", expected.clone()),
        );
        assert!(result.is_err());
        assert_eq!(runtime::list(temp.path()).unwrap().revision, expected);
        assert!(runtime::check_enabled(temp.path(), "connection").is_ok());
    }
}

fn install(root: &std::path::Path, id: &str, dependencies: &[&str]) {
    use situate_core::plugins::{runtime, sources};
    sources::create(root, id).unwrap();
    sources::write(
        root,
        id,
        "plugin.json",
        &json!({
            "schemaVersion":2,"id":id,"name":id,"description":"Synthetic",
            "serviceEntry":"entry.js", "dependencies":dependencies
        })
        .to_string(),
        None,
    )
    .unwrap();
    sources::write(root, id, "entry.js", "export default () => ({})", None).unwrap();
    let revision = runtime::list(root).unwrap().revision;
    runtime::set_enabled(root, id, true, revision.as_deref()).unwrap();
}

#[test]
fn removal_refuses_running_work_without_waiting_and_closes_admission() {
    let scope = Arc::new(Scope::default());
    let action = begin(&scope, "window", &["consumer", "provider"]);
    assert!(matches!(scope.exclusive(&["provider".into()]), Err(error) if error == BUSY));
    assert!(scope.authorization("window", &action).is_ok());
    scope.end("window", &action).unwrap();
    let request = scope.request(|| Ok(ids(&["provider"]))).unwrap();
    assert!(matches!(scope.exclusive(&["provider".into()]), Err(error) if error == BUSY));
    drop(request);
    let held = scope.exclusive(&["provider".into()]).unwrap();
    assert!(matches!(scope.exclusive(&["provider".into()]), Err(error) if error == BUSY));
    assert!(
        scope
            .begin(
                "provider",
                "window",
                crate::workspaces::AuthorizationSession::for_test(),
                || Ok(ids(&["provider"]))
            )
            .is_err()
    );
    assert!(scope.request(|| Ok(ids(&["provider"]))).is_err());
    let independent = begin(&scope, "window", &["unrelated"]);
    scope.end("window", &independent).unwrap();
    drop(held);
    let published = gate(&scope, &["provider"]);
    assert!(matches!(scope.exclusive(&["provider".into()]), Err(error) if error == BUSY));
    drop(published);
    assert!(scope.exclusive(&["provider".into()]).is_ok());
}

#[test]
fn captured_actions_and_hosts_reject_an_identical_code_reinstallation() {
    use situate_core::plugins::runtime;
    let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    let root = temp.path();
    std::fs::create_dir(root.join(".situate")).unwrap();
    install(root, "sample", &[]);
    runtime::prepare(root).unwrap();
    let captured = active_revisions(root, "sample", |_| false).unwrap();
    let incarnations = current_incarnations(root, &captured).unwrap();
    let history = root.join(".situate/plugins/sample/.situate/history.git");
    let saved_history = root.join("saved-history.git");
    std::fs::rename(&history, &saved_history).unwrap();
    std::fs::remove_dir_all(root.join(".situate/plugins/sample")).unwrap();
    install(root, "sample", &[]);
    std::fs::remove_dir_all(&history).unwrap();
    std::fs::rename(&saved_history, &history).unwrap();
    runtime::prepare(root).unwrap();
    let current = active_revisions(root, "sample", |_| false).unwrap();
    let identities = current_incarnations(root, &current).unwrap();
    assert_eq!(captured, current);
    assert_ne!(incarnations, identities);
    let scope = Arc::new(Scope::default());
    let stale_action = scope.begin(
        "provider",
        "window",
        crate::workspaces::AuthorizationSession::for_test(),
        || {
            validate_captured(Some(&captured), &current)?;
            validate_incarnations(Some(&incarnations), &identities)?;
            Ok(current.keys().cloned().collect())
        },
    );
    assert_eq!(stale_action, Err("native.plugins.stateConflict".into()));
    let stale_host = scope.request(|| {
        validate_captured(Some(&captured), &current)?;
        validate_incarnations(Some(&incarnations), &identities)?;
        Ok(current.keys().cloned().collect())
    });
    assert!(matches!(stale_host, Err(error) if error == "native.plugins.stateConflict"));
    assert!(validate_incarnations(None, &identities).is_err());
    validate_incarnations(Some(&identities), &identities).unwrap();
}

#[tokio::test]
async fn publication_admits_only_current_host_closure_and_blocks_service_roots() {
    use situate_core::plugins::{publication, sources};
    let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    let root = temp.path();
    std::fs::create_dir(root.join(".situate")).unwrap();
    install(root, "connection", &[]);
    install(root, "consumer", &["connection"]);
    situate_core::plugins::runtime::prepare(root).unwrap();
    let scope = Arc::new(Scope::default());
    let captured = active_revisions(root, "consumer", |_| false).unwrap();
    assert!(captured.values().all(Option::is_some));
    validate_captured(Some(&captured), &captured).unwrap();
    let provider = sources::read(root, "connection", "entry.js").unwrap();
    sources::write(
        root,
        "connection",
        "entry.js",
        "export default () => ({updated:true})",
        Some(&provider.revision),
    )
    .unwrap();
    let selected = vec![sources::snapshot(root, "connection").unwrap()];
    let checked = publication::checked_closure(root, &selected).unwrap();
    let cancel = CancellationToken::new();
    let mut held = gate(&scope, &["connection"]).drain(&cancel).await.unwrap();
    let outcome = publication::publish(root, &selected, &checked, &[]).unwrap();
    assert_eq!(outcome.status, publication::PublicationStatus::Published);
    held.published().unwrap();
    let current = active_revisions(root, "consumer", |_| false).unwrap();
    assert!(validate_captured(None, &current).is_err());
    assert!(
        scope
            .request(|| {
                validate_captured(Some(&captured), &current)?;
                Ok(current.keys().cloned().collect())
            })
            .is_err()
    );
    drop(
        scope
            .request(|| {
                validate_captured(Some(&current), &current)?;
                Ok(current.keys().cloned().collect())
            })
            .unwrap(),
    );
    let stale_root = scope.begin(
        "root",
        "publisher",
        crate::workspaces::AuthorizationSession::for_test(),
        || {
            validate_captured(Some(&captured), &current)?;
            Ok(current.keys().cloned().collect())
        },
    );
    assert_eq!(stale_root, Err("native.plugins.stateConflict".into()));
    let staged = scope.begin(
        "root",
        "publisher",
        crate::workspaces::AuthorizationSession::for_test(),
        || {
            validate_captured(Some(&current), &current)?;
            Ok(current.keys().cloned().collect())
        },
    );
    assert_eq!(staged, Err(BUSY.into()));
    assert_eq!(
        active_revisions(root, "consumer", |id| id == "connection"),
        Err("native.plugins.recoveryBlocked".into())
    );
    assert_eq!(
        active_revisions(root, "consumer", |_| true),
        Err("native.plugins.recoveryBlocked".into())
    );
    drop(held);
}
