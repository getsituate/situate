use super::tests::{fixtures, server, tokens};
use super::*;
use crate::diagnostics::{Operation, OperationKind};
use serde_json::json;
use situate_core::diagnostics::{
    BoundContext, Collector, Destination, DestinationFilter, DestinationRegistration, EventInput,
    HostIdentity, OperationContext, Origin,
};
use std::sync::{Arc, Mutex, mpsc};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Memory(Arc<Mutex<Vec<Value>>>);
impl Destination for Memory {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::from_slice(bytes).unwrap());
        Ok(())
    }
}
struct Gate {
    memory: Memory,
    wait: Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>,
}
impl Destination for Gate {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        if let Some((ready, release)) = self.wait.take() {
            ready.send(()).unwrap();
            release.recv().unwrap();
        }
        self.memory.write(bytes)
    }
}
pub(crate) struct Capture {
    collector: Collector,
    memory: Memory,
    release: mpsc::Sender<()>,
}
impl Capture {
    pub(crate) fn new() -> Self {
        let memory = Memory::default();
        let (ready, waiting) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let collector = Collector::with_destinations(
            HostIdentity {
                device_id: Uuid::new_v4().to_string(),
                session_id: Uuid::new_v4().to_string(),
                app_version: "0.0.1".into(),
                platform: "test".into(),
                platform_version: "1".into(),
            },
            vec![DestinationRegistration {
                destination: Box::new(Gate {
                    memory: memory.clone(),
                    wait: Some((ready, released)),
                }),
                filter: DestinationFilter::default(),
            }],
        )
        .unwrap();
        let producer = collector
            .producer(BoundContext {
                origin: Origin::Native,
                workspace_id: None,
            })
            .unwrap();
        let probe: EventInput = serde_json::from_value(json!({
            "schema_version": 1, "event": "app.started", "category": "app", "level": "info",
            "timestamp_ms": 0, "sequence": 0, "attributes": {}
        }))
        .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while !producer.emit(probe.clone()) {
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        // Hold the writer outside the queue lock so event assertions do not race its drain.
        waiting.recv_timeout(Duration::from_secs(1)).unwrap();
        Self {
            collector,
            memory,
            release,
        }
    }
    pub(crate) fn operation(&self, parent: Option<OperationContext>) -> Operation {
        self.operation_kind(OperationKind::OpenAiLogin, parent)
    }
    pub(crate) fn operation_kind(
        &self,
        kind: OperationKind,
        parent: Option<OperationContext>,
    ) -> Operation {
        let producer = self
            .collector
            .producer(BoundContext {
                origin: Origin::Native,
                workspace_id: Some("33333333-3333-4333-8333-333333333333".into()),
            })
            .unwrap();
        Operation::with_producer(producer, kind, parent)
    }
    fn stop(&self) {
        let _ = self.release.send(());
        assert!(self.collector.shutdown(Duration::from_secs(1)));
    }
    pub(crate) fn records(self) -> Vec<Value> {
        self.stop();
        self.memory
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|record| record["category"] == "model")
            .cloned()
            .collect()
    }
}
#[test]
fn operation_terminal_outcomes_have_consistent_levels_and_one_owner() {
    for (outcome, code, level) in [
        ("success", None, "info"),
        ("cancelled", Some("cancelled"), "info"),
        ("failure", Some("unknown"), "error"),
        ("rejected", None, "info"),
        ("rejected", Some("permission_denied"), "warn"),
    ] {
        let capture = Capture::new();
        capture.operation(None).finish(outcome, code);
        let records = capture.records();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["level"], "info");
        assert_eq!(records[1]["event"], "operation.finished");
        assert_eq!(records[1]["level"], level);
        assert_eq!(records[1]["attributes"]["outcome"], outcome);
        assert_eq!(
            records[1]["context"]["span_id"],
            records[0]["context"]["span_id"]
        );
    }
}

#[tokio::test]
async fn abandoned_and_aborted_operations_are_interrupted_not_user_cancelled() {
    for aborted in [false, true] {
        let capture = Capture::new();
        let operation = capture.operation(None);
        if aborted {
            let (entered, ready) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(async move {
                let _operation = operation;
                entered.send(()).unwrap();
                std::future::pending::<()>().await;
            });
            ready.await.unwrap();
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
        } else {
            drop(operation);
        }
        let records = capture.records();
        assert_eq!(records.len(), 2);
        assert_eq!(records[1]["level"], "warn");
        assert_eq!(records[1]["attributes"]["outcome"], "interrupted");
        assert_eq!(records[1]["attributes"]["error_code"], "interrupted");
    }
}

#[test]
fn observed_unwind_is_one_panic_failure_in_a_disposable_process() {
    const CHILD: &str = "SITUATE_DIAGNOSTIC_UNWIND_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "observed_unwind_is_one_panic_failure_in_a_disposable_process",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .status()
            .unwrap();
        assert!(status.success());
        return;
    }
    let capture = Capture::new();
    let operation = capture.operation(None);
    assert!(
        std::thread::spawn(move || {
            let _operation = operation;
            panic!("PRIVATE_PANIC_PAYLOAD_SENTINEL");
        })
        .join()
        .is_err()
    );
    let records = capture.records();
    assert_eq!(records.len(), 2);
    assert_eq!(records[1]["level"], "error");
    assert_eq!(records[1]["attributes"]["outcome"], "failure");
    assert_eq!(records[1]["attributes"]["error_code"], "panic");
    assert!(
        !serde_json::to_string(&records)
            .unwrap()
            .contains("PRIVATE_PANIC_PAYLOAD_SENTINEL")
    );
}

fn failure(records: &[Value], stage: &str, reason: &str) {
    assert!(records.iter().any(|record| {
        record["event"] == "operation.progress"
            && record["attributes"]["stage"] == stage
            && record["attributes"]["error_code"] == reason
            && record["level"] == "error"
    }));
    assert_eq!(records.last().unwrap()["attributes"]["outcome"], "failure");
}

#[tokio::test]
async fn exchange_records_correlated_stages_and_status_without_credentials_or_payloads() {
    let capture = Capture::new();
    let trace = capture.operation(Some(OperationContext {
        trace_id: "11111111-1111-4111-8111-111111111111".into(),
        span_id: "22222222-2222-4222-8222-222222222222".into(),
        parent_span_id: None,
        initiator: "user".into(),
    }));
    let mut auth = Authorization::new(None, 48231);
    auth.nonce = "fixture-attempt".into();
    let fixtures = fixtures();
    let mut response = tokens();
    response["id_token"] = fixtures["tokens"]["valid"].clone();
    let (endpoint, token_task) = server(200, response.to_string()).await;
    let (jwks, keys_task) = server(200, fixtures["jwks"].to_string()).await;
    let result = auth
        .exchange_at(
            &endpoint,
            &jwks,
            Callback {
                code: "PRIVATE_AUTHORIZATION_CODE".into(),
                client_id: "issued-client".into(),
            },
            &CancellationToken::new(),
            Some(&trace),
        )
        .await;
    assert!(result.is_ok());
    trace.result(&result);
    token_task.await.unwrap();
    keys_task.await.unwrap();
    let records = capture.records();
    let stages: Vec<_> = records
        .iter()
        .filter_map(|record| record["attributes"]["stage"].as_str())
        .collect();
    assert_eq!(
        stages,
        [
            "token_exchange",
            "token_exchange",
            "token_received",
            "identity_keys",
            "identity_keys",
            "identity_verify",
            "identity_verified",
            "credential",
            "credential_validated"
        ]
    );
    assert_eq!(records.first().unwrap()["event"], "operation.started");
    assert_eq!(records.last().unwrap()["event"], "operation.finished");
    assert_eq!(records.last().unwrap()["attributes"]["outcome"], "success");
    for (index, record) in records.iter().enumerate() {
        assert_eq!(record["sequence"], index);
        assert_eq!(
            record["context"]["trace_id"],
            "11111111-1111-4111-8111-111111111111"
        );
        assert_eq!(
            record["context"]["parent_span_id"],
            "22222222-2222-4222-8222-222222222222"
        );
        assert_eq!(
            record["context"]["span_id"],
            records[0]["context"]["span_id"]
        );
        assert_eq!(record["attributes"]["component"], "openai_login");
        assert_eq!(
            record["workspace_id"],
            "33333333-3333-4333-8333-333333333333"
        );
    }
    let statuses: Vec<_> = records
        .iter()
        .filter_map(|r| r["attributes"]["http_status"].as_u64())
        .collect();
    assert_eq!(statuses, [200, 200]);
    let serialized = serde_json::to_string(&records).unwrap();
    for private in [
        "PRIVATE_AUTHORIZATION_CODE",
        "issued-client",
        "synthetic-subject",
        "synthetic-access",
        "synthetic-refresh",
        "fixture-attempt",
        &auth.verifier,
        &auth.state,
        &endpoint,
        &jwks,
        response["id_token"].as_str().unwrap(),
    ] {
        assert!(!serialized.contains(private));
    }
}

#[tokio::test]
async fn http_failures_distinguish_token_and_key_fetch_without_recording_response_bodies() {
    for (stage, status, body, reason) in [
        (
            "token_exchange",
            400,
            "PRIVATE_PROVIDER_ERROR",
            "http_status",
        ),
        (
            "identity_keys",
            503,
            "PRIVATE_PROVIDER_ERROR",
            "http_status",
        ),
        (
            "token_exchange",
            200,
            "PRIVATE_INVALID_JSON",
            "response_invalid",
        ),
    ] {
        let capture = Capture::new();
        let trace = capture.operation(None);
        let (url, task) = server(status, body.into()).await;
        let result =
            request_json_diagnosed(&url, None, &CancellationToken::new(), Some(&trace), stage)
                .await;
        assert_eq!(result.as_ref().unwrap_err(), ERROR);
        trace.result(&result);
        task.await.unwrap();
        let records = capture.records();
        failure(&records, stage, reason);
        assert!(
            records
                .iter()
                .any(|r| r["attributes"]["http_status"] == status)
        );
        assert!(
            !serde_json::to_string(&records)
                .unwrap()
                .contains("PRIVATE_")
        );
    }
}

#[test]
fn identity_failures_are_distinguishable_without_logging_token_claims() {
    let fixtures = fixtures();
    for (name, reason) in [
        ("invalid_signature", "jwt_signature"),
        ("wrong_nonce", "jwt_nonce"),
        ("wrong_issuer", "jwt_issuer"),
        ("wrong_audience", "jwt_audience"),
        ("expired", "jwt_expired"),
        ("missing_nonce", "jwt_nonce_missing"),
        ("missing_iss", "jwt_issuer_missing"),
        ("missing_aud", "jwt_audience_missing"),
        ("missing_exp", "jwt_expiry_missing"),
        ("missing_sub", "jwt_subject_missing"),
        ("future_nbf", "jwt_not_yet_valid"),
        ("empty_subject", "jwt_subject"),
        ("unknown_key", "jwt_key"),
    ] {
        let capture = Capture::new();
        let trace = capture.operation(None);
        let token = fixtures["tokens"][name].as_str().unwrap();
        let result = identity::verify_with_keys(
            token,
            "issued-client",
            "fixture-attempt",
            &fixtures["jwks"],
            Some(&trace),
        );
        assert_eq!(result.as_ref().unwrap_err(), ERROR);
        trace.result(&result);
        let records = capture.records();
        failure(&records, "identity_verify", reason);
        let serialized = serde_json::to_string(&records).unwrap();
        for private in [
            token,
            "issued-client",
            "synthetic-subject",
            "fixture-attempt",
        ] {
            assert!(!serialized.contains(private));
        }
    }
}

#[test]
fn array_audiences_distinguish_malformed_members_from_missing_nonce() {
    let fixtures: Value =
        serde_json::from_str(include_str!("openai_audience_fixtures.json")).unwrap();
    for (name, reason) in [
        ("mixed_types", "jwt_audience_type"),
        ("missing_nonce", "jwt_nonce_missing"),
    ] {
        let capture = Capture::new();
        let trace = capture.operation(None);
        let token = fixtures["tokens"][name].as_str().unwrap();
        let result = identity::verify_with_keys(
            token,
            "issued-client",
            "fixture-attempt",
            &fixtures["jwks"],
            Some(&trace),
        );
        assert_eq!(result.as_ref().unwrap_err(), ERROR);
        trace.result(&result);
        let records = capture.records();
        failure(&records, "identity_verify", reason);
        assert!(!serde_json::to_string(&records).unwrap().contains(token));
    }
}

#[test]
fn missing_grant_fields_and_direct_access_scope_have_safe_specific_reasons() {
    for (field, reason) in [
        ("access_token", "access_token_missing"),
        ("refresh_token", "refresh_token_missing"),
        ("expires_in", "token_expiry"),
        ("scope", "scope_invalid"),
        ("direct", "direct_scope_missing"),
    ] {
        let capture = Capture::new();
        let trace = capture.operation(None);
        let mut response = tokens();
        if field == "direct" {
            response["scope"] = json!("PRIVATE_SCOPE");
        } else {
            response.as_object_mut().unwrap().remove(field);
        }
        let result = credential_diagnosed(
            &response,
            "PRIVATE_CLIENT".into(),
            "PRIVATE_SUBJECT".into(),
            now(),
            Some(&trace),
        );
        assert_eq!(result.as_ref().err().unwrap(), ERROR);
        trace.result(&result);
        let records = capture.records();
        failure(&records, "credential", reason);
        assert!(
            !serde_json::to_string(&records)
                .unwrap()
                .contains("PRIVATE_")
        );
    }
}

#[test]
fn independent_attempts_do_not_share_context_and_logging_shutdown_does_not_fail_credentials() {
    let capture = Capture::new();
    let first = capture.operation(None);
    let second = capture.operation(None);
    first.result(&Ok::<_, String>(()));
    second.result(&Err::<(), _>(CANCELLED.into()));
    let records = capture.records();
    let starts: Vec<_> = records
        .iter()
        .filter(|r| r["event"] == "operation.started")
        .collect();
    assert_eq!(starts.len(), 2);
    assert_ne!(
        starts[0]["context"]["trace_id"],
        starts[1]["context"]["trace_id"]
    );
    assert_eq!(
        records.last().unwrap()["attributes"]["outcome"],
        "cancelled"
    );

    let capture = Capture::new();
    let trace = capture.operation(None);
    capture.stop();
    let result = credential_diagnosed(
        &tokens(),
        "issued-client".into(),
        "synthetic-subject".into(),
        now(),
        Some(&trace),
    );
    assert!(result.is_ok());
    trace.result(&result);
}
