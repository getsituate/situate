use super::*;
use tokio::sync::oneshot;

#[test]
fn check_failures_are_negative_evidence_while_authorization_errors_remain_errors() {
    let failed = check_result(Err(ToolOutcome::Completed(ToolResult::json(
        json!({"isError":true,"error":"plugins.checkAssertionFailed"}),
    ))))
    .unwrap();
    assert_eq!(
        failed,
        json!({"passed":false,"assertions":0,"assertionsKnown":false,"error":"plugins.checkAssertionFailed"})
    );
    assert_eq!(
        check_result(Err(disconnected(1, vec![]))).unwrap(),
        json!({"passed":false,"assertions":0,"assertionsKnown":false,"error":UNAVAILABLE,"observations":[],"observationsTruncated":false})
    );
    assert_eq!(
        check_result(Err(ToolOutcome::Failed(CANCELLED.into()))),
        Err(CANCELLED.into())
    );
    assert!(check_result(Ok(json!({"passed":true,"assertions":0}))).is_err());
    assert_eq!(
        check_result(Ok(json!({"passed":true,"assertions":2}))).unwrap(),
        json!({"passed":true,"assertions":2})
    );
}

#[test]
fn check_results_preserve_failed_comparisons_and_completed_assertions() {
    let outcome = json!({"passed":false,"assertions":2,"error":"plugins.checkAssertionFailed",
        "failure":{"assertion":3,"operator":"equal","actual":"2","expected":"3"},
        "observations":[{"operation":"filesList","result":{"completed":true},"error":null}],
        "images":[{"mimeType":"image/png","data":"synthetic"}]});
    assert_eq!(check_result(Ok(outcome.clone())).unwrap(), outcome);
    for invalid in [
        json!({"passed":false,"assertions":-1}),
        json!({"passed":false,"assertions":4294967296_u64}),
        json!({"passed":false,"assertions":0,"failure":{"assertion":1,"operator":"equal","actual":"2","expected":"3","extra":"private"}}),
        json!({"passed":false,"assertions":0,"failure":{"assertion":1,"operator":"equal","actual":"x".repeat(4097),"expected":"3"}}),
    ] {
        assert!(check_result(Ok(invalid)).is_err());
    }
}

#[test]
fn check_exceptions_do_not_claim_an_unavailable_runtime_or_expose_text() {
    let failed = check_result(Err(ToolOutcome::Completed(ToolResult::json(
        json!({"error":"synthetic-private-payload","observations":[{"operation":"read","result":{"completed":true}}]}),
    )))).unwrap();
    assert_eq!(failed["error"], "plugins.checkFailed");
    assert_eq!(failed["assertionsKnown"], false);
    assert_eq!(
        failed["observations"],
        json!([{"operation":"read","result":{"completed":true}}])
    );
    assert!(!failed.to_string().contains("synthetic-private-payload"));
    assert_eq!(check_error(&json!(UNAVAILABLE)), UNAVAILABLE);
    assert_eq!(
        check_error(&json!("plugins.checkTypeError")),
        "plugins.checkTypeError"
    );
    let mut generation = generation();
    generation.test_id = Some("trial".into());
    generation
        .fail_initialization(&json!("private factory exception"))
        .unwrap();
    assert!(
        matches!(&*generation.ready.lock().unwrap(), Some(Err(code)) if code == "plugins.checkFailed")
    );
}

#[test]
fn disconnected_checks_retain_a_bounded_tail_of_observations() {
    let observations = (0..40)
        .map(|index| json!({"requestId":index,"operation":"read","result":{"completed":true}}))
        .collect();
    let result = check_result(Err(disconnected(1, observations))).unwrap();
    assert_eq!(result["observations"].as_array().unwrap().len(), 32);
    assert_eq!(result["observations"][0]["requestId"], 8);
    assert_eq!(result["observationsTruncated"], true);
    assert_eq!(result["assertionsKnown"], false);
}

#[test]
fn caught_fixture_host_denials_do_not_override_assertions_but_production_errors_do() {
    let mut state = InvocationState::default();
    assert!(!state.host_error_prevents_result(None));
    let receipt =
        json!({"operation":"http","error":"native.plugins.fixtureUnmatched","uncertain":true});
    state.observations.push(receipt.clone());
    assert!(!state.host_error_prevents_result(Some("fixture")));
    assert!(state.host_error_prevents_result(None));
    assert_eq!(state.observations, vec![receipt]);
    assert_eq!(
        check_result(Ok(json!({"passed":true,"assertions":1}))).unwrap(),
        json!({"passed":true,"assertions":1})
    );
    let failed_assertion = check_result(Err(ToolOutcome::Completed(ToolResult::json(
        json!({"error":"plugins.checkAssertionFailed"}),
    ))))
    .unwrap();
    assert_eq!(failed_assertion["passed"], false);
    assert_eq!(failed_assertion["error"], "plugins.checkAssertionFailed");
}

fn generation() -> Generation {
    Generation {
        id: 1,
        plugin_id: "sample".into(),
        revision: Some("checked-revision".into()),
        incarnation: "captured-incarnation".into(),
        source: json!({}),
        revisions: HashMap::new(),
        incarnations: HashMap::new(),
        test_id: None,
        ready: Mutex::new(None),
        load_sent: AtomicBool::new(true),
        changed: Notify::new(),
        revoked: AtomicBool::new(false),
        terminated: AtomicBool::new(false),
        invocations: Mutex::new(HashMap::new()),
    }
}

#[test]
fn factory_failure_retains_its_sanitized_cause_before_generic_revocation() {
    let generation = generation();
    generation
        .fail_initialization(&json!("plugins.checkFailed"))
        .unwrap();
    generation.fail_initialization(&json!(UNAVAILABLE)).unwrap();
    assert!(
        matches!(&*generation.ready.lock().unwrap(),Some(Err(error)) if error=="plugins.checkFailed")
    );
    assert!(!generation.terminated.load(Ordering::Acquire));
}

#[test]
fn duplicate_requests_and_terminal_callbacks_cannot_readmit_effects() {
    let mut state = InvocationState::default();
    state.admit("request-1", false).unwrap();
    assert!(state.admit("request-1", false).is_err());
    assert_eq!(state.pending, 1);
    state
        .complete(Terminal::Result(json!({"value":7})))
        .unwrap();
    assert!(
        state
            .complete(Terminal::Result(json!({"value":8})))
            .is_err()
    );
    assert!(state.admit("request-2", false).is_err());
    assert_eq!(state.pending, 1);
}

#[test]
fn revocation_denies_admission_without_discarding_observed_operations() {
    let mut state = InvocationState::default();
    state.admit("native-write", false).unwrap();
    state.complete(Terminal::Disconnected).unwrap();
    assert!(state.admit("late-effect", false).is_err());
    state.observations.push(observation(
        "native-write",
        &json!({"operation":"write"}),
        &Ok(json!({"revision":"retained-write"})),
    ));
    state.pending -= 1;
    assert_eq!(state.pending, 0);
    assert_eq!(
        state.observations[0]["result"]["revision"],
        "retained-write"
    );
    assert!(matches!(state.terminal, Some(Terminal::Disconnected)));
}

#[test]
fn generation_loss_retains_observed_reply_but_interrupts_pending_effects() {
    let mut state = InvocationState::default();
    state.admit("native-effect", false).unwrap();
    state
        .complete(Terminal::Result(
            json!({"content":[{"type":"text","text":"observed"}]}),
        ))
        .unwrap();
    state.disconnect();
    assert!(matches!(state.terminal, Some(Terminal::Disconnected)));
    assert_eq!(
        state.observations[0]["observedResult"]["content"][0]["text"],
        "observed"
    );
    assert_eq!(state.pending, 1);
    assert!(state.admit("late-request", false).is_err());
}

#[test]
fn a_settled_observed_result_is_not_reclassified_when_another_invocation_is_lost() {
    let mut state = InvocationState::default();
    state
        .complete(Terminal::Result(json!({"saved":true})))
        .unwrap();
    state.disconnect();
    assert!(matches!(state.terminal, Some(Terminal::Result(_))));
    assert!(state.observations.is_empty());
}

#[test]
fn cancellation_before_admission_does_not_consume_a_request_identity() {
    let mut state = InvocationState::default();
    assert!(state.admit("never-dispatched", true).is_err());
    assert!(state.requests.is_empty());
    assert_eq!(state.pending, 0);
}

#[test]
fn retained_suboperation_observations_exclude_secrets_and_payloads() {
    let request = json!({"operation":"credentialGet","name":"synthetic"});
    let receipt = observation(
        "read-secret",
        &request,
        &Ok(json!({"value":"synthetic-secret"})),
    );
    assert_eq!(
        receipt,
        json!({"requestId":"read-secret","operation":"credentialGet","result":{"completed":true},"error":null,"uncertain":false})
    );
    let receipt = observation(
        "http",
        &json!({"operation":"http"}),
        &Ok(json!({"status":201,"body":"private body"})),
    );
    assert_eq!(receipt["result"], json!({"completed":true,"status":201}));
}

#[test]
fn failed_effect_is_not_reported_as_no_effect_or_success() {
    let receipt = observation(
        "effect",
        &json!({"operation":"http"}),
        &Err("native.plugins.httpFailed".into()),
    );
    assert_eq!(receipt["uncertain"], true);
    assert!(receipt["result"].is_null());
    assert_eq!(receipt["error"], "native.plugins.httpFailed");
}

#[test]
fn tool_descriptors_are_bounded_and_names_are_unique() {
    assert!(
        validate_definitions(&Definitions {
            tools: vec![json!({"name":"read","description":"Read","parameters":{"type":"object"}})],
            exports: vec!["fetch".into()]
        })
        .is_ok()
    );
    assert!(
        validate_definitions(&Definitions {
            tools: vec![
                json!({"name":"read","description":"Read","parameters":{}}),
                json!({"name":"read","description":"Again","parameters":{}})
            ],
            exports: vec![]
        })
        .is_err()
    );
    assert!(
        validate_definitions(&Definitions {
            tools: vec![],
            exports: vec!["fetch".into(), "fetch".into()]
        })
        .is_err()
    );
}

fn invocation() -> Invocation {
    Invocation {
        id: uuid::Uuid::new_v4().to_string(),
        run_id: "manual-action".into(),
        cancel: CancellationToken::new(),
        progress: None,
        operation_gate: tokio::sync::Mutex::new(()),
        ledger: tokio::sync::Mutex::new(None),
        action: Mutex::new(None),
        images: Mutex::new(Vec::new()),
        state: Mutex::new(InvocationState::default()),
        changed: Notify::new(),
    }
}

#[test]
fn retired_generation_before_admission_is_known_unavailable_not_disconnected() {
    let generation = generation();
    assert!(generation.revoke());
    assert!(generation.revoked.load(Ordering::Acquire));
    assert!(generation.invocations.lock().unwrap().is_empty());
    assert!(
        matches!(unavailable_before_dispatch(),ToolOutcome::Failed(error) if error==UNAVAILABLE)
    );
    assert!(matches!(
        disconnected(generation.id, vec![]),
        ToolOutcome::Disconnected { generation: 1, .. }
    ));
}

#[test]
fn revocation_between_early_check_and_registration_rejects_the_old_generation() {
    let generation = generation();
    let invocation = Arc::new(invocation());
    let dispatch = PendingDispatch::begin(invocation.clone()).unwrap();
    assert!(!generation.revoked.load(Ordering::Acquire));
    assert!(generation.revoke());
    assert!(!generation.register(invocation.clone()).unwrap());
    assert!(
        matches!(unavailable_before_dispatch(),ToolOutcome::Failed(error) if error==UNAVAILABLE)
    );
    assert!(generation.invocations.lock().unwrap().is_empty());
    assert!(invocation.action.lock().unwrap().is_none());
    assert!(invocation.ledger.try_lock().unwrap().is_none());
    assert!(invocation.state.lock().unwrap().requests.is_empty());
    drop(dispatch);
    assert_eq!(invocation.state.lock().unwrap().pending, 0);
}

#[test]
fn repeated_revocation_finishes_cancellation_when_the_first_revoker_is_between_flag_and_fence() {
    let generation = generation();
    let invocation = Arc::new(invocation());
    assert!(generation.register(invocation.clone()).unwrap());
    assert!(!generation.revoked.swap(true, Ordering::AcqRel));
    assert!(!generation.revoke());
    assert!(invocation.cancel.is_cancelled());
    assert!(matches!(
        invocation.state.lock().unwrap().terminal,
        Some(Terminal::Disconnected)
    ));
    assert!(!generation.terminated.load(Ordering::Acquire));
}

#[tokio::test]
async fn registered_invocation_waits_for_dispatch_and_owned_host_operation_after_revoke() {
    let generation = generation();
    let invocation = Arc::new(invocation());
    let dispatch = PendingDispatch::begin(invocation.clone()).unwrap();
    assert!(generation.register(invocation.clone()).unwrap());
    invocation
        .state
        .lock()
        .unwrap()
        .admit("native-request", false)
        .unwrap();
    assert!(generation.revoke());
    let observed = generation
        .invocations
        .lock()
        .unwrap()
        .values()
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(observed.len(), 1);
    assert!(observed[0].cancel.is_cancelled());
    assert!(matches!(
        observed[0].state.lock().unwrap().terminal,
        Some(Terminal::Disconnected)
    ));
    let drained = wait_drained(&observed[0]);
    tokio::pin!(drained);
    assert!(futures_util::poll!(&mut drained).is_pending());
    drop(dispatch);
    assert!(futures_util::poll!(&mut drained).is_pending());
    invocation.state.lock().unwrap().pending -= 1;
    invocation.changed.notify_waiters();
    drained.await.unwrap();
}

#[tokio::test]
async fn ledger_intent_remains_owned_when_its_caller_future_is_dropped() {
    for succeeds in [true, false] {
        let directory = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(directory.path().join("actions")));
        let writer = store.clone();
        let generation = generation();
        let invocation = Arc::new(invocation());
        let id = invocation.id.clone();
        let dispatch = PendingDispatch::begin(invocation.clone()).unwrap();
        assert!(generation.register(invocation.clone()).unwrap());
        let (started, entered) = oneshot::channel();
        let (release, waiting) = std::sync::mpsc::channel();
        let intent = persist_manual_intent(invocation.clone(), store, move || {
            started.send(()).unwrap();
            waiting.recv().unwrap();
            if succeeds {
                writer
                    .create(&id, &fingerprint(b"workspace-session"), "sample", 1, "hold")
                    .map_err(persistence_error)
            } else {
                Err("native.plugins.stateSaveFailed".into())
            }
        });
        let mut intent = Box::pin(intent);
        assert!(futures_util::poll!(intent.as_mut()).is_pending());
        entered.await.unwrap();
        generation.revoke();
        drop(intent);
        drop(dispatch);
        let drained = wait_drained(&invocation);
        tokio::pin!(drained);
        assert!(futures_util::poll!(&mut drained).is_pending());
        assert!(invocation.ledger.lock().await.is_none());
        release.send(()).unwrap();
        drained.await.unwrap();
        assert_eq!(invocation.ledger.lock().await.is_some(), succeeds);
        finalize_manual(&invocation).await.unwrap();
        if succeeds {
            assert_eq!(
                invocation
                    .ledger
                    .lock()
                    .await
                    .as_ref()
                    .unwrap()
                    .record
                    .status(),
                ActionStatus::Disconnected
            );
        }
    }
}

fn manual_invocation() -> (tempfile::TempDir, Invocation) {
    let directory = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::new(directory.path().join("actions")));
    let id = uuid::Uuid::new_v4().to_string();
    let record = store
        .create(&id, &fingerprint(b"workspace-session"), "demo", 7, "send")
        .unwrap();
    let invocation = Invocation {
        id,
        run_id: "manual-action".into(),
        cancel: CancellationToken::new(),
        progress: None,
        operation_gate: tokio::sync::Mutex::new(()),
        ledger: tokio::sync::Mutex::new(Some(ManualLedger {
            store,
            record,
            staged: None,
            error: None,
        })),
        action: Mutex::new(None),
        images: Mutex::new(Vec::new()),
        state: Mutex::new(InvocationState::default()),
        changed: Notify::new(),
    };
    (directory, invocation)
}
#[test]
fn concurrent_manual_finalizers_commit_one_terminal_revision() {
    tauri::async_runtime::block_on(async {
        for (terminal, expected) in [
            (
                Terminal::Result(json!({"isError":false})),
                ActionStatus::Completed,
            ),
            (Terminal::Disconnected, ActionStatus::Disconnected),
        ] {
            let (_directory, invocation) = manual_invocation();
            invocation.state.lock().unwrap().terminal = Some(terminal);
            let ledger = invocation.ledger.lock().await;
            let revision = ledger.as_ref().unwrap().record.revision();
            let mut execute = Box::pin(finalize_manual(&invocation));
            let mut stop = Box::pin(finalize_manual(&invocation));
            let mut abort = Box::pin(finalize_manual(&invocation));
            assert!(futures_util::poll!(execute.as_mut()).is_pending());
            assert!(futures_util::poll!(stop.as_mut()).is_pending());
            assert!(futures_util::poll!(abort.as_mut()).is_pending());
            drop(ledger);
            let results = tokio::join!(execute, stop, abort);
            assert_eq!(results, (Ok(()), Ok(()), Ok(())));
            let record = {
                let ledger = invocation.ledger.lock().await;
                let ledger = ledger.as_ref().unwrap();
                assert!(ledger.staged.is_none());
                assert!(ledger.error.is_none());
                ledger.store.load(&invocation.id).unwrap()
            };
            assert_eq!(record.status(), expected);
            assert_eq!(record.revision(), revision + 1);
            finalize_manual(&invocation).await.unwrap();
            assert!(
                save_manual(&invocation, |record| record
                    .observe(&uuid::Uuid::new_v4().to_string(), json!({"success":true})))
                .await
                .is_err()
            );
            let ledger = invocation.ledger.lock().await;
            assert_eq!(
                ledger.as_ref().unwrap().store.load(&invocation.id).unwrap(),
                record
            );
        }
    });
}

#[test]
fn concurrent_finalization_preserves_failed_terminal_persistence_for_retry() {
    tauri::async_runtime::block_on(async {
        let (directory, invocation) = manual_invocation();
        invocation.state.lock().unwrap().terminal = Some(Terminal::Disconnected);
        std::fs::rename(
            directory.path().join("actions"),
            directory.path().join("retained"),
        )
        .unwrap();
        std::fs::write(directory.path().join("actions"), b"not a directory").unwrap();
        let ledger = invocation.ledger.lock().await;
        let original = ledger.as_ref().unwrap().record.clone();
        let mut execute = Box::pin(finalize_manual(&invocation));
        let mut stop = Box::pin(finalize_manual(&invocation));
        let mut abort = Box::pin(finalize_manual(&invocation));
        assert!(futures_util::poll!(execute.as_mut()).is_pending());
        assert!(futures_util::poll!(stop.as_mut()).is_pending());
        assert!(futures_util::poll!(abort.as_mut()).is_pending());
        drop(ledger);
        let results = tokio::join!(execute, stop, abort);
        let error = Err("native.plugins.stateSaveFailed".to_owned());
        assert_eq!(results, (error.clone(), error.clone(), error));
        assert_eq!(
            Store::new(directory.path().join("retained"))
                .load(&invocation.id)
                .unwrap(),
            original
        );
        {
            let mut ledger = invocation.ledger.lock().await;
            let ledger = ledger.as_mut().unwrap();
            assert_eq!(
                ledger.error.as_deref(),
                Some("native.plugins.stateSaveFailed")
            );
            assert_eq!(ledger.record, original);
            let staged = ledger.staged.clone().unwrap();
            assert_eq!(staged.status(), ActionStatus::Disconnected);
            assert!(staged.uncertain());
            assert_eq!(staged.revision(), original.revision() + 1);
            std::fs::remove_file(directory.path().join("actions")).unwrap();
            std::fs::rename(
                directory.path().join("retained"),
                directory.path().join("actions"),
            )
            .unwrap();
            persist_manual_staged(ledger).await.unwrap();
            assert!(ledger.staged.is_none());
            assert!(ledger.error.is_none());
            assert_eq!(ledger.record, staged);
            assert_eq!(ledger.store.load(&invocation.id).unwrap(), staged);
        }
        finalize_manual(&invocation).await.unwrap();
        let ledger = invocation.ledger.lock().await;
        assert_eq!(
            ledger.as_ref().unwrap().record.revision(),
            original.revision() + 1
        );
    });
}

#[test]
fn failed_observation_persistence_retains_intent_and_blocks_later_receipts() {
    tauri::async_runtime::block_on(async {
        let (directory, invocation) = manual_invocation();
        std::fs::rename(
            directory.path().join("actions"),
            directory.path().join("retained"),
        )
        .unwrap();
        std::fs::write(directory.path().join("actions"), b"not a directory").unwrap();
        let request = uuid::Uuid::new_v4().to_string();
        assert!(
            save_manual(&invocation, |record| record
                .observe(&request, json!({"success":true,"statusCode":201})))
            .await
            .is_err()
        );
        assert!(
            save_manual(&invocation, |record| record
                .observe(&uuid::Uuid::new_v4().to_string(), json!({"success":true})))
            .await
            .is_err()
        );
        let ledger = invocation.ledger.lock().await;
        let ledger = ledger.as_ref().unwrap();
        assert!(ledger.staged.is_some());
        assert!(ledger.record.observations().is_empty());
        assert!(
            Store::new(directory.path().join("retained"))
                .load(&invocation.id)
                .unwrap()
                .observations()
                .is_empty()
        );
    });
}

#[test]
fn interrupted_manual_receipt_records_known_outcomes_without_replaying() {
    tauri::async_runtime::block_on(async {
        let (_directory, invocation) = manual_invocation();
        let native_request = uuid::Uuid::new_v4().to_string();
        save_manual(&invocation, |record| {
            record.observe(
                &native_request,
                json!({"success":true,"revision":"saved-revision"}),
            )
        })
        .await
        .unwrap();
        invocation.state.lock().unwrap().terminal = Some(Terminal::Disconnected);
        finalize_manual(&invocation).await.unwrap();
        let ledger = invocation.ledger.lock().await;
        let ledger = ledger.as_ref().unwrap();
        let observed = ledger.store.load(&invocation.id).unwrap();
        assert_eq!(observed.status(), ActionStatus::Disconnected);
        assert!(observed.uncertain());
        assert_eq!(
            observed.observations()[0].receipt["revision"],
            "saved-revision"
        );
        assert_eq!(ledger.store.load(&invocation.id).unwrap(), observed);
    });
}

#[test]
fn manual_receipts_discard_credentials_and_payloads() {
    assert_eq!(
        ledger_receipt(
            &json!({"operation":"credentialGet"}),
            &Ok(json!({"value":"secret"}))
        ),
        json!({"success":true,"uncertain":false})
    );
}

#[test]
fn plugin_tool_content_and_details_are_not_wrapped_or_reclassified() {
    let content = json!([{"type":"text","text":"Saved"},{"type":"image","data":"c3ludGhldGlj","mimeType":"image/png"}]);
    let details = json!({"revision":"native-revision"});
    let result =
        plugin_tool_result(json!({"content":content,"details":details,"structuredContent":{"saved":true},"isError":true})).unwrap();
    assert_eq!(result.content, content.as_array().unwrap().clone());
    assert_eq!(result.details, details);
    assert_eq!(result.structured_content, Some(json!({"saved":true})));
    assert!(result.is_error);
    assert!(plugin_tool_result(json!({"text":"not a tool result"})).is_err());
    assert!(plugin_tool_result(json!({"content":[{"type":"text","text":7}]})).is_err());
    assert!(plugin_tool_result(json!({"content":[],"isError":"false"})).is_err());
}

#[test]
fn worker_exception_text_cannot_leak_private_values_into_results() {
    assert_eq!(
        worker_error(&json!("synthetic-private-credential")),
        UNAVAILABLE
    );
    assert_eq!(
        worker_error(&json!("native.synthetic_private_credential")),
        UNAVAILABLE
    );
    assert_eq!(
        worker_error(&json!("plugins.checkAssertionFailed")),
        "plugins.checkAssertionFailed"
    );
    assert_eq!(
        worker_error(&json!("native.plugins.stateConflict")),
        "native.plugins.stateConflict"
    );
}

#[test]
fn native_tool_capture_respects_platforms_and_complete_acyclic_dependencies() {
    use situate_core::plugins::runtime::{Listing, Summary};
    let mut entries = Vec::new();
    for (id, dependencies, enabled) in [
        ("base", vec![], true),
        ("consumer", vec!["base"], true),
        ("cycle-a", vec!["cycle-b"], true),
        ("cycle-b", vec!["cycle-a"], true),
        ("cyclic-consumer", vec!["cycle-a"], true),
        ("missing-consumer", vec!["missing"], true),
        ("disabled", vec![], false),
        ("disabled-consumer", vec!["disabled"], true),
    ] {
        let manifest=serde_json::from_value(json!({"schemaVersion":2,"id":id,"name":id,"description":"Fixture","serviceEntry":"service.js","dependencies":dependencies})).unwrap();
        entries.push(Summary {
            id: id.into(),
            enabled,
            manifest: Some(manifest),
            error: None,
            revision: None,
            incarnation: None,
        });
    }
    let excluded = if cfg!(target_os = "ios") {
        "macos"
    } else {
        "ios"
    };
    entries.push(Summary{id:"other-platform".into(),enabled:true,manifest:Some(serde_json::from_value(json!({"schemaVersion":2,"id":"other-platform","name":"Other","description":"Fixture","serviceEntry":"service.js","platforms":[excluded]})).unwrap()),error:None,revision:None,incarnation:None});
    let manifest=serde_json::from_value(json!({"schemaVersion":2,"id":"platform-consumer","name":"Consumer","description":"Fixture","serviceEntry":"service.js","dependencies":["other-platform"]})).unwrap();
    entries.push(Summary {
        id: "platform-consumer".into(),
        enabled: true,
        manifest: Some(manifest),
        error: None,
        revision: None,
        incarnation: None,
    });
    assert_eq!(
        supported_plugins(&Listing {
            plugins: entries,
            revision: None
        }),
        HashSet::from(["base".into(), "consumer".into()])
    );
}

#[test]
fn closing_a_scope_without_an_executor_does_not_block_its_replacement() {
    let app = tauri::test::mock_app();
    app.manage(Executors::default());
    let state = app.state::<Executors>();
    state.closing.lock().unwrap().insert("scope".into());
    state
        .gates
        .lock()
        .unwrap()
        .insert("scope".into(), Arc::new(tokio::sync::Mutex::new(())));
    state
        .dispatched
        .lock()
        .unwrap()
        .insert(("scope".into(), "run".into(), "tool".into()));
    invalidate_scope(app.handle(), "scope");
    assert!(!state.closing.lock().unwrap().contains("scope"));
    assert!(!state.gates.lock().unwrap().contains_key("scope"));
    assert!(state.dispatched.lock().unwrap().is_empty());
    assert!(!has_any_active(app.handle()).unwrap());
}

#[test]
fn unavailable_definitions_are_bound_to_the_captured_source_and_explicit_recovery() {
    let app = tauri::test::mock_app();
    app.manage(Executors::default());
    let source = json!({"manifest":{"id":"sample","name":"Sample"},"serviceEntry":"export default()=>({})","skills":[]});
    let revisions = HashMap::from([("sample".into(), Some("revision-a".into()))]);
    let incarnations = HashMap::from([("sample".into(), "incarnation-a".into())]);
    let signature = source_fingerprint(&source, &revisions, &incarnations);
    let warning =
        json!({"pluginId":"sample","reason":"initializationUnavailable","error":UNAVAILABLE});
    remember_unavailable(
        app.handle(),
        "scope",
        "sample".into(),
        signature.clone(),
        warning.clone(),
        HashSet::from(["sample".into()]),
    )
    .unwrap();
    assert_eq!(
        cached_unavailable(app.handle(), "scope", "sample", &signature).unwrap(),
        Some(warning.clone())
    );
    assert!(
        cached_unavailable(app.handle(), "other-scope", "sample", &signature)
            .unwrap()
            .is_none()
    );
    let mut changed_revisions = revisions.clone();
    changed_revisions.insert("dependency".into(), Some("new-dependency-revision".into()));
    assert!(
        cached_unavailable(
            app.handle(),
            "scope",
            "sample",
            &source_fingerprint(&source, &changed_revisions, &incarnations)
        )
        .unwrap()
        .is_none()
    );
    let mut changed_incarnations = incarnations.clone();
    changed_incarnations.insert("sample".into(), "replacement-incarnation".into());
    assert!(
        cached_unavailable(
            app.handle(),
            "scope",
            "sample",
            &source_fingerprint(&source, &revisions, &changed_incarnations)
        )
        .unwrap()
        .is_none()
    );
    let mut changed = source.clone();
    changed["serviceEntry"] = json!("export default()=>({exports:{read(){}}})");
    assert!(
        cached_unavailable(
            app.handle(),
            "scope",
            "sample",
            &source_fingerprint(&changed, &revisions, &incarnations)
        )
        .unwrap()
        .is_none()
    );
    remember_unavailable(
        app.handle(),
        "scope",
        "consumer".into(),
        "consumer-signature".into(),
        warning.clone(),
        HashSet::from(["sample".into(), "consumer".into()]),
    )
    .unwrap();
    remember_unavailable(
        app.handle(),
        "scope",
        "unrelated".into(),
        "other-signature".into(),
        warning,
        HashSet::from(["unrelated".into()]),
    )
    .unwrap();
    clear_unavailable(app.handle(), "scope", Some("sample"));
    assert!(
        cached_unavailable(app.handle(), "scope", "sample", &signature)
            .unwrap()
            .is_none()
    );
    assert!(
        cached_unavailable(app.handle(), "scope", "consumer", "consumer-signature")
            .unwrap()
            .is_none()
    );
    assert!(
        cached_unavailable(app.handle(), "scope", "unrelated", "other-signature")
            .unwrap()
            .is_some()
    );
}

#[test]
fn skill_snapshots_keep_captured_text_and_package_provenance() {
    let mut source = json!({"manifest":{"id":"knowledge","name":"Knowledge"},"serviceEntry":null,"uiEntry":null,"skills":[{"path":"SKILL.md","text":"Captured guidance"}]});
    let skills = source_skills(
        &source,
        &Some("checked-revision".into()),
        "captured-incarnation",
    );
    source["skills"][0]["text"] = json!("Later mutable content");
    assert_eq!(
        skills,
        vec![
            json!({"pluginId":"knowledge","pluginName":"Knowledge","path":"SKILL.md","text":"Captured guidance","revision":"checked-revision","incarnation":"captured-incarnation"})
        ]
    );
    let captured = CapturedTools {
        skills: skills.clone(),
        unavailable: vec![json!({"pluginId":"bad","error":UNAVAILABLE})],
        ..Default::default()
    };
    assert_eq!(captured.skills(), skills);
    assert!(captured.definitions().is_empty());
    assert_eq!(captured.unavailable()[0]["pluginId"], "bad");
}

#[cfg(target_os = "macos")]
#[test]
fn executor_controls_remain_authorized_while_lifecycle_admission_is_held() {
    let location = situate_core::workspaces::Location {
        id: "synthetic".into(),
        name: "Synthetic".into(),
        display: "Synthetic".into(),
        kind: "path".into(),
        handle: "synthetic".into(),
    };
    for update in [true, false] {
        let app = tauri::test::mock_builder()
            .manage(crate::workspaces::test_workspaces(&[(
                "workspace-1",
                location.clone(),
            )]))
            .manage(crate::lifecycle::Quit::default())
            .manage(Executors::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let retained = Request::Activity
            .authorization(app.handle(), "workspace-1", "synthetic")
            .unwrap();
        if update {
            crate::updates::hold_test_admission(app.handle());
            assert!(crate::updates::admission_held(app.handle()));
        } else {
            *app.state::<crate::lifecycle::Quit>()
                .pending
                .lock()
                .unwrap() = Some(crate::lifecycle::QuitAttempt {
                token: "quit-test".into(),
                participants: HashMap::new(),
                ready: HashSet::new(),
            });
            assert!(crate::lifecycle::ordinary_quit_pending(app.handle()));
        }
        assert!(crate::lifecycle::quit_pending(app.handle()));
        assert!(matches!(
            crate::workspaces::authorization_session(app.handle(), "workspace-1", "synthetic"),
            Err(error) if error == "native.workspace.quitting"
        ));
        for request in [Request::Activity, Request::Stop] {
            let cold = request
                .authorization(app.handle(), "workspace-1", "synthetic")
                .unwrap();
            for authorization in [&cold, &retained] {
                crate::workspaces::with_retained_control(
                    app.handle(),
                    "workspace-1",
                    authorization,
                    || Ok(()),
                )
                .unwrap();
                assert!(
                    crate::workspaces::with_retained_control(
                        app.handle(),
                        "workspace-2",
                        authorization,
                        || Ok(())
                    )
                    .is_err()
                );
            }
            for (window, scope) in [("workspace-2", "synthetic"), ("workspace-1", "missing")] {
                assert!(request.authorization(app.handle(), window, scope).is_err());
            }
        }
        for request in [
            Request::Snapshot,
            Request::Invoke {
                plugin_id: "sample".into(),
                export_name: "run".into(),
                args: Value::Null,
                generation: 1,
            },
            Request::PendingPersistences,
        ] {
            assert!(
                matches!(request.authorization(app.handle(), "workspace-1", "synthetic"), Err(error) if error == "native.workspace.quitting")
            );
        }
        assert!(
            app.state::<Executors>()
                .workspaces
                .lock()
                .unwrap()
                .is_empty()
        );
        assert!(app.state::<Executors>().gates.lock().unwrap().is_empty());
        let reopened = tauri::test::mock_builder()
            .manage(crate::workspaces::test_workspaces(&[(
                "workspace-1",
                location.clone(),
            )]))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        assert!(
            crate::workspaces::with_retained_control(
                reopened.handle(),
                "workspace-1",
                &retained,
                || Ok(())
            )
            .is_err()
        );
    }
}

#[test]
fn host_ipc_rejects_obsolete_execution_approval_fields() {
    let request = json!({"operation":"http","url":"https://example.invalid/","method":"POST","headers":{},"body":null,"approved":true});
    assert!(serde_json::from_value::<crate::plugin_host::Request>(request).is_err());
    let request:crate::plugin_host::Request=serde_json::from_value(json!({"operation":"http","url":"https://example.invalid/","method":"post","headers":{},"body":null})).unwrap();
    assert!(matches!(request, crate::plugin_host::Request::Http { .. }));
    assert!(serde_json::from_value::<Request>(json!({"operation":"pendingApprovals"})).is_err());
    assert!(
        serde_json::from_value::<Request>(json!({"operation":"decide","id":"old","allowed":true}))
            .is_err()
    );
}
