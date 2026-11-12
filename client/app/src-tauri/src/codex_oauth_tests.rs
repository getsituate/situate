use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn tokens(account: &str) -> Value {
    json!({
        "access_token": format!("synthetic.{}.signature", URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"https://api.openai.com/auth": {"chatgpt_account_id": account}})).unwrap())),
        "refresh_token": "synthetic-rotated", "expires_in": 3600,
    })
}
async fn server(replies: Vec<(u16, String)>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for (status, body) in replies {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0; 4096];
                let size = socket.read(&mut chunk).await.unwrap();
                assert!(size > 0);
                bytes.extend_from_slice(&chunk[..size]);
                if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let size: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + size {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            socket.write_all(format!("HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        }
        requests
    });
    (endpoint, task)
}
fn challenge() -> Challenge {
    Challenge {
        user_code: "TEST-CODE".into(),
        verification_uri: VERIFY.into(),
        expires_at: now() + 10000,
        device_auth_id: "synthetic-private-device".into(),
        interval: Duration::from_millis(1),
    }
}

#[tokio::test]
async fn start_exposes_only_safe_challenge_and_uses_fixed_client() {
    let (endpoint, task) = server(vec![(
        200,
        json!({"device_auth_id":"synthetic-device-secret","user_code":"TEST-CODE","interval":"5"})
            .to_string(),
    )])
    .await;
    let before = now();
    let result = start_at(&endpoint, &CancellationToken::new())
        .await
        .unwrap();
    let public = serde_json::to_value(&result).unwrap();
    assert_eq!(public.as_object().unwrap().len(), 3);
    assert_eq!(public["userCode"], "TEST-CODE");
    assert_eq!(
        public["verificationUri"],
        "https://auth.openai.com/codex/device"
    );
    assert!(!public.to_string().contains("synthetic-device-secret"));
    assert!(result.expires_at >= before + 900000);
    assert_eq!(result.interval, Duration::from_secs(5));
    let requests = task.await.unwrap();
    assert!(requests[0].contains("\"client_id\":\"app_EMoamEEZ73f0CkXaXp7hrann\""));
}
#[tokio::test]
async fn pending_then_code_exchange_uses_device_redirect_and_verifier() {
    let (endpoint, task) = server(vec![
        (403, "{}".into()),
        (
            200,
            json!({"authorization_code":"synthetic-code","code_verifier":"synthetic-verifier"})
                .to_string(),
        ),
        (200, tokens("account-one").to_string()),
    ])
    .await;
    let result = poll_at(
        &challenge(),
        &endpoint,
        &endpoint,
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(result.account_id, "account-one");
    assert_eq!(result.refresh, "synthetic-rotated");
    assert!(!result.expired());
    let requests = task.await.unwrap();
    assert!(requests[0].contains("\"device_auth_id\":\"synthetic-private-device\""));
    assert!(requests[2].contains("grant_type=authorization_code"));
    assert!(requests[2].contains("code_verifier=synthetic-verifier"));
    assert!(
        requests[2].contains("redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback")
    );
}
#[tokio::test]
async fn slowdown_adds_five_seconds_before_the_next_poll() {
    let (endpoint, task) = server(vec![
        (429, json!({"error": "slow_down"}).to_string()),
        (
            200,
            json!({"authorization_code": "fixture-code", "code_verifier": "fixture-verifier"})
                .to_string(),
        ),
        (200, tokens("account-one").to_string()),
    ])
    .await;
    let started = tokio::time::Instant::now();
    assert!(
        poll_at(
            &challenge(),
            &endpoint,
            &endpoint,
            &CancellationToken::new()
        )
        .await
        .is_ok()
    );
    assert!(started.elapsed() >= Duration::from_secs(5));
    assert_eq!(task.await.unwrap().len(), 3);
}

#[test]
fn errors_override_pending_http_status_and_slowdown_is_distinct() {
    assert!(matches!(progress(404, &json!({})), Ok(Progress::Pending)));
    assert!(matches!(
        progress(
            400,
            &json!({"error":{"code":"deviceauth_authorization_pending"}})
        ),
        Ok(Progress::Pending)
    ));
    assert!(matches!(
        progress(429, &json!({"error":"slow_down"})),
        Ok(Progress::SlowDown)
    ));
    assert!(matches!(
        progress(403, &json!({"error":"access_denied"})),
        Err(Error::Denied)
    ));
    assert!(matches!(
        progress(404, &json!({"error":"expired_token"})),
        Err(Error::Expired)
    ));
    assert!(matches!(
        progress(500, &json!({"error":"private-provider-message"})),
        Err(Error::Failed)
    ));
}
#[tokio::test]
async fn denial_and_expiry_end_polling() {
    for (code, expected) in [
        ("access_denied", Error::Denied),
        ("expired_token", Error::Expired),
    ] {
        let (endpoint, task) = server(vec![(403, json!({"error":code}).to_string())]).await;
        assert!(
            poll_at(
                &challenge(),
                &endpoint,
                &endpoint,
                &CancellationToken::new()
            )
            .await
            .err()
                == Some(expected)
        );
        assert_eq!(task.await.unwrap().len(), 1);
    }
    let mut expired = challenge();
    expired.expires_at = 0;
    assert!(
        poll_at(
            &expired,
            "not-a-url",
            "not-a-url",
            &CancellationToken::new()
        )
        .await
        .err()
            == Some(Error::Expired)
    );
    expired.expires_at = now() + 5;
    expired.interval = Duration::from_secs(100);
    assert!(
        poll_at(
            &expired,
            "not-a-url",
            "not-a-url",
            &CancellationToken::new()
        )
        .await
        .err()
            == Some(Error::Expired)
    );
}
#[tokio::test]
async fn cancellation_interrupts_wait_and_inflight_response() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(start(&cancel).await.err() == Some(Error::Cancelled));
    assert!(poll(&challenge(), &cancel).await.err() == Some(Error::Cancelled));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let cancel = CancellationToken::new();
    let operation = start_at(&endpoint, &cancel);
    let cancellation = async {
        let (_socket, _) = listener.accept().await.unwrap();
        cancel.cancel();
    };
    let (result, ()) = tokio::join!(operation, cancellation);
    assert!(result.err() == Some(Error::Cancelled));
}
#[tokio::test]
async fn renewal_returns_rotation_without_mutating_old_and_rejects_account_switch() {
    let old = credential(&tokens("account-one")).unwrap();
    for account in ["account-one", "account-two"] {
        let (endpoint, task) = server(vec![(200, tokens(account).to_string())]).await;
        let result = refresh_at(&endpoint, &old, &CancellationToken::new()).await;
        assert_eq!(result.is_ok(), account == "account-one");
        let requests = task.await.unwrap();
        assert!(requests[0].contains("grant_type=refresh_token"));
        assert!(requests[0].contains("client_id=app_EMoamEEZ73f0CkXaXp7hrann"));
        assert!(!requests[0].contains("client_secret"));
    }
    assert_eq!(old.account_id, "account-one");
}
#[tokio::test]
async fn dispatched_renewal_survives_caller_cancellation() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let cancel = CancellationToken::new();
    let old = credential(&tokens("account-one")).unwrap();
    let operation = refresh_at(&endpoint, &old, &cancel);
    let provider = async {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 8192];
        assert!(socket.read(&mut request).await.unwrap() > 0);
        cancel.cancel();
        let mut rotated = tokens("account-one");
        rotated["refresh_token"] = json!("synthetic-new-rotation");
        let body = rotated.to_string();
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    };
    let (result, ()) = tokio::join!(operation, provider);
    assert_eq!(result.unwrap().refresh, "synthetic-new-rotation");
    assert_eq!(old.refresh, "synthetic-rotated");
    assert!(refresh_at("not-a-url", &old, &cancel).await.err() == Some(Error::Cancelled));
}

#[test]
fn token_shape_claims_expiry_and_persisted_schema_are_validated() {
    let valid = credential(&tokens("account-one")).unwrap();
    let mut stored = serde_json::to_value(&valid).unwrap();
    assert_eq!(stored["accountId"], "account-one");
    stored["clientId"] = json!("dynamic-client");
    assert!(serde_json::from_value::<Credential>(stored).is_err());
    for account in ["", "account\r\nheader", "account with spaces"] {
        assert!(credential(&tokens(account)).is_err());
    }
    for (field, value) in [
        ("access_token", json!("situate-native-oauth")),
        ("refresh_token", json!("")),
        ("expires_in", json!(0)),
        ("expires_in", json!(-1)),
        ("expires_in", json!(1.5)),
        ("account_id", json!("other-account")),
    ] {
        let mut body = tokens("account-one");
        body[field] = value;
        assert!(credential(&body).is_err());
    }
}
#[tokio::test]
async fn malformed_oversized_redirect_and_error_responses_fail_without_body_disclosure() {
    for (status, body) in [
        (302, "private-redirect".into()),
        (500, "private-error".into()),
        (200, "not-json".into()),
        (200, "x".repeat(MAX_BODY + 1)),
        (
            200,
            json!({"device_auth_id":"private","user_code":"TEST","interval":-1}).to_string(),
        ),
    ] {
        let (endpoint, task) = server(vec![(status, body)]).await;
        assert!(start_at(&endpoint, &CancellationToken::new()).await.err() == Some(Error::Failed));
        task.await.unwrap();
    }
}
