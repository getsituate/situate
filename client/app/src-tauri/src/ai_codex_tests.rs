use super::*;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone, Default)]
struct Keys {
    values: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    fail: Arc<AtomicBool>,
}
impl KeyStore for Keys {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        self.values
            .lock()
            .unwrap()
            .get(account)
            .cloned()
            .ok_or(KEY_ERROR.into())
    }
    fn set(&self, account: &str, value: &[u8]) -> Result<(), String> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(KEY_ERROR.into());
        }
        self.values
            .lock()
            .unwrap()
            .insert(account.into(), value.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.values.lock().unwrap().remove(account);
        Ok(())
    }
}
fn credential(account: &str, expires: u64) -> crate::codex_oauth::Credential {
    crate::codex_oauth::Credential {
        access: format!(
            "fixture.{}.signature",
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(
                    &json!({"https://api.openai.com/auth": {"chatgpt_account_id": account}})
                )
                .unwrap()
            )
        ),
        refresh: "synthetic-refresh-private".into(),
        expires,
        account_id: account.into(),
    }
}
fn connection(expires: u64) -> Connection {
    Connection {
        catalog: None,
        config: Config {
            connection_id: Some("a".repeat(48)),
            label: Some("Fixture".into()),
            http_acknowledgement: None,
            auth: Some(AuthKind::Oauth),
            provider: "openai-codex".into(),
            legacy_model: None,
            endpoint: None,
        },
        key: String::new(),
        oauth: None,
        codex: Some(credential("account-fixture", expires)),
    }
}
struct Workspace {
    root: tempfile::TempDir,
    device: tempfile::TempDir,
    keys: Keys,
}
impl Workspace {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        Self {
            root,
            device: tempfile::tempdir().unwrap(),
            keys: Keys::default(),
        }
    }
    fn storage(&self) -> Storage {
        Storage::open(&self.root.path().canonicalize().unwrap(), "codex-workspace")
            .unwrap()
            .with_device_store(&self.device.path().canonicalize().unwrap())
            .unwrap()
    }
    fn save(&self, connection: &Connection) {
        let storage = self.storage();
        let _lock = storage.lock_credentials().unwrap();
        storage
            .save_connection(
                &self.keys,
                connection.config.connection_id.as_deref().unwrap(),
                serde_json::to_value(&connection.config).unwrap(),
                &serde_json::to_vec(connection).unwrap(),
                false,
            )
            .unwrap();
    }
    fn load(&self) -> Connection {
        decode_connection(&self.storage().load(&self.keys).unwrap().unwrap()).unwrap()
    }
}

#[test]
fn codex_credentials_require_exact_provider_method_account_and_secret_shape() {
    let valid = serde_json::to_value(connection(0)).unwrap();
    assert!(decode_connection(&serde_json::to_vec(&valid).unwrap()).is_ok());
    let mut invalid = Vec::new();
    for (path, value) in [
        ("/config/provider", json!("openai")),
        ("/config/provider", json!("custom")),
        ("/config/auth", json!("api_key")),
        ("/config/auth", Value::Null),
        ("/config/endpoint", json!("https://other.invalid")),
        ("/key", json!("duplicate-secret")),
        ("/codex/accountId", json!("different-account")),
        ("/codex/accountId", json!("account\r\nX-Injected: value")),
        ("/codex/access", json!("situate-native-oauth")),
        ("/codex/refresh", json!("")),
        ("/codex/access", json!("x".repeat(32769))),
        ("/codex", Value::Null),
    ] {
        let mut record = valid.clone();
        *record.pointer_mut(path).unwrap() = value;
        invalid.push(record);
    }
    let mut direct = valid.clone();
    direct["oauth"] = json!({"access":"fixture","refresh":"fixture","expires":0,"clientId":"issued","subject":"subject","scopes":["chatgpt.tokens.use.direct"]});
    invalid.push(direct);
    let mut unknown = valid.clone();
    unknown["codex"]["clientId"] = json!("direct-client");
    invalid.push(unknown);
    for record in invalid {
        let error = decode_connection(&serde_json::to_vec(&record).unwrap())
            .err()
            .unwrap();
        assert_eq!(error, "native.ai.access.invalidReconnect");
    }
    let workspace = Workspace::new();
    let mut mismatched = valid;
    mismatched["config"]["provider"] = json!("openai");
    let storage = workspace.storage();
    let _lock = storage.lock_credentials().unwrap();
    let bytes = serde_json::to_vec(&mismatched).unwrap();
    storage
        .save_connection(
            &workspace.keys,
            &"a".repeat(48),
            mismatched["config"].clone(),
            &bytes,
            false,
        )
        .unwrap();
    assert!(decode_connection(&storage.load(&workspace.keys).unwrap().unwrap()).is_err());
    assert_eq!(&*storage.load(&workspace.keys).unwrap().unwrap(), &bytes);
}

#[test]
fn direct_chatgpt_and_api_key_records_keep_their_separate_credential_contracts() {
    let direct = json!({
        "config": {"provider":"openai", "auth":"oauth", "endpoint":null},
        "key":"",
        "oauth": {"access":"synthetic-direct-access", "refresh":"synthetic-direct-refresh", "expires":0, "clientId":"issued-client", "subject":"verified-subject", "scopes":["chatgpt.tokens.use.direct"]}
    });
    assert!(decode_connection(&serde_json::to_vec(&direct).unwrap()).is_ok());
    for auth in [Value::Null, json!("api_key")] {
        let record = json!({"config":{"provider":"openai", "auth":auth, "endpoint":null},"key":"synthetic-key"});
        assert!(decode_connection(&serde_json::to_vec(&record).unwrap()).is_ok());
    }
    let keyless =
        json!({"config":{"provider":"custom", "endpoint":"http://localhost:8888/v1"}, "key":""});
    assert!(decode_connection(&serde_json::to_vec(&keyless).unwrap()).is_ok());
    for (field, value) in [
        ("/config/provider", json!("openai-codex")),
        ("/config/auth", json!("api_key")),
        ("/oauth/scopes", json!([])),
        ("/oauth/subject", json!("")),
    ] {
        let mut invalid = direct.clone();
        *invalid.pointer_mut(field).unwrap() = value;
        assert!(decode_connection(&serde_json::to_vec(&invalid).unwrap()).is_err());
    }
}

#[test]
fn codex_admission_uses_oauth_catalog_method_and_only_canonical_endpoint() {
    let config = connection(0).config;
    model::validate_config(&config).unwrap();
    let (api, url, headers) = target(&config, "gpt-6.1-sol").unwrap();
    assert_eq!(api, "openai-codex-responses");
    assert_eq!(url, "https://chatgpt.com/backend-api/codex/responses");
    assert_eq!(
        headers.get("openai-beta").map(String::as_str),
        Some("responses=experimental")
    );
    assert_eq!(headers.get("originator").map(String::as_str), Some("pi"));
    assert!(!headers.contains_key("authorization"));
    assert!(!headers.contains_key("chatgpt-account-id"));
    assert!(validate_headers(&api, &HashMap::new()).is_ok());
    for name in [
        "authorization",
        "Authorization",
        "chatgpt-account-id",
        "ChatGPT-Account-ID",
        "openai-beta",
        "originator",
        "host",
        "x-api-key",
        "cookie",
    ] {
        assert!(validate_headers(&api, &HashMap::from([(name.into(), "spoofed".into())])).is_err());
    }
    for auth in [None, Some(AuthKind::ApiKey)] {
        let mut wrong = config.clone();
        wrong.auth = auth;
        assert!(model::validate_config(&wrong).is_err());
        assert!(target(&wrong, "gpt-6.1-sol").is_err());
    }
    for endpoint in [
        "https://other.invalid",
        "https://chatgpt.com/backend-api",
        "http://chatgpt.com/backend-api",
    ] {
        let mut wrong = config.clone();
        wrong.endpoint = Some(endpoint.into());
        assert!(target(&wrong, "gpt-6.1-sol").is_err());
    }
    assert!(target(&config, "gpt-4o-mini").is_err());
    let mut direct = config;
    direct.provider = "openai".into();
    assert_eq!(
        target(&direct, "gpt-5.4").unwrap().1,
        "https://api.openai.com/v1/responses"
    );
}

#[test]
fn codex_payload_thinking_uses_catalog_mapping_without_allowing_a_second_effort_field() {
    for (model_id, thinking, effort) in [
        ("gpt-6.1-sol", "low", Some("low")),
        ("gpt-6.1-sol", "medium", Some("medium")),
        ("gpt-6.1-sol", "high", Some("high")),
        ("gpt-6.1-sol", "off", None),
        ("gpt-6-sol", "off", Some("none")),
        ("gpt-5.3-codex-spark", "off", Some("none")),
    ] {
        let choice: model::Choice = serde_json::from_value(json!({"version":1,"connection":connection(0).config,"model":model_id,"thinking":thinking})).unwrap();
        let mut body = json!({"model":model_id,"stream":true,"store":false});
        if let Some(effort) = effort {
            body["reasoning"] = json!({"effort":effort});
        }
        assert!(
            model::validate_payload(&choice, &body).is_ok(),
            "{model_id} {thinking}"
        );
        for field in [
            "reasoning_effort",
            "thinking",
            "generationConfig",
            "max_output_tokens",
        ] {
            let mut wrong = body.clone();
            wrong[field] = json!("high");
            assert!(model::validate_payload(&choice, &wrong).is_err());
        }
        body["store"] = json!(true);
        assert!(model::validate_payload(&choice, &body).is_err());
    }
}

async fn server(status: u16, body: String) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/codex/responses", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let size = socket.read(&mut chunk).await.unwrap();
            assert!(size > 0);
            bytes.extend_from_slice(&chunk[..size]);
            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        socket.write_all(format!("HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        String::from_utf8(bytes).unwrap()
    });
    (url, task)
}
fn channel() -> (Channel<Frame>, Arc<Mutex<Vec<String>>>) {
    let frames = Arc::new(Mutex::new(Vec::new()));
    let captured = frames.clone();
    (
        Channel::new(move |frame| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = frame {
                captured.lock().unwrap().push(json);
            }
            Ok(())
        }),
        frames,
    )
}

#[tokio::test]
async fn codex_native_request_injects_bearer_account_and_fixed_headers_without_public_secrets() {
    let connection = connection(u64::MAX);
    let access = connection.codex.as_ref().unwrap().access.clone();
    let workspace = Workspace::new();
    workspace.save(&connection);
    let status = serde_json::to_string(&model::status(
        &workspace.storage(),
        &connection.config,
        false,
    ))
    .unwrap();
    for secret in [&access, "account-fixture", "synthetic-refresh-private"] {
        assert!(!status.contains(secret));
    }
    let (api, _, headers) = target(&connection.config, "gpt-6.1-sol").unwrap();
    let (url, server) = server(200, "data: {\"type\":\"response.completed\"}\n\n".into()).await;
    let (channel, frames) = channel();
    send(
        (
            connection,
            api,
            url,
            "{\"model\":\"gpt-6.1-sol\",\"stream\":true,\"store\":false}".into(),
            headers,
        ),
        CancellationToken::new(),
        |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
        None,
    )
    .await
    .unwrap();
    let request = server.await.unwrap();
    let request_headers = request.split("\r\n\r\n").next().unwrap().to_lowercase();
    assert!(request_headers.contains(&format!("authorization: bearer {}", access.to_lowercase())));
    for expected in [
        "chatgpt-account-id: account-fixture",
        "openai-beta: responses=experimental",
        "originator: pi",
        "accept: text/event-stream",
        "content-type: application/json",
    ] {
        assert!(request_headers.contains(expected), "{expected}");
    }
    assert!(!request.contains("synthetic-refresh-private"));
    assert!(!request.contains("situate-native-oauth"));
    let public = frames.lock().unwrap().join("");
    assert!(public.contains("\"done\""));
    for secret in [&access, "account-fixture", "synthetic-refresh-private"] {
        assert!(!public.contains(secret));
    }
}

#[tokio::test]
async fn codex_rejections_and_errors_never_forward_provider_bodies() {
    for status in [401, 403, 429, 500, 302] {
        let connection = connection(u64::MAX);
        let (api, _, headers) = target(&connection.config, "gpt-6.1-sol").unwrap();
        let (url, server) = server(status, "synthetic-private-provider-body".into()).await;
        let (channel, frames) = channel();
        let error = send(
            (connection, api, url, "{}".into(), headers),
            CancellationToken::new(),
            |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(
            error,
            if status == 401 || status == 403 {
                REJECTED
            } else {
                "native.ai.request.rejected"
            }
        );
        assert!(frames.lock().unwrap().is_empty());
        server.await.unwrap();
    }
}

#[tokio::test]
async fn codex_rotation_is_durable_before_cancellation_and_prevents_any_chat_dispatch() {
    let workspace = Workspace::new();
    workspace.save(&connection(0));
    let storage = workspace.storage();
    let lock = storage.lock_credentials().unwrap();
    let cancel = CancellationToken::new();
    let caller = cancel.clone();
    let (release, wait) = tokio::sync::oneshot::channel();
    let (entered, dispatched) = tokio::sync::oneshot::channel();
    let mut operation = Box::pin(refresh_codex_connection(
        storage,
        workspace.load(),
        cancel.clone(),
        workspace.keys.clone(),
        |mut old, renewal| async move {
            caller.cancel();
            assert!(!renewal.is_cancelled());
            entered.send(()).unwrap();
            wait.await.unwrap();
            old.refresh = "synthetic-rotated-after-stop".into();
            old.expires = u64::MAX;
            Ok(old)
        },
    ));
    tokio::select! {
        result = &mut operation => panic!("Refresh completed before its response: {}", result.is_ok()),
        ready = dispatched => ready.unwrap(),
    }
    assert!(cancel.is_cancelled());
    assert!(workspace.storage().lock_credentials().is_err());
    release.send(()).unwrap();
    let renewed = operation.await.unwrap();
    let saved = workspace.load();
    assert_eq!(saved.codex.unwrap().refresh, "synthetic-rotated-after-stop");
    assert!(renewed.key.is_empty());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (channel, frames) = channel();
    assert_eq!(
        send(
            (
                renewed,
                "openai-codex-responses".into(),
                format!("http://{}", listener.local_addr().unwrap()),
                "{}".into(),
                HashMap::new()
            ),
            cancel,
            |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
            None,
        )
        .await
        .unwrap_err(),
        "native.ai.response.stopped"
    );
    assert!(frames.lock().unwrap().is_empty());
    assert!(
        tokio::time::timeout(Duration::from_millis(10), listener.accept())
            .await
            .is_err()
    );
    drop(lock);
}

#[tokio::test]
async fn codex_fresh_and_predispatch_cancelled_credentials_do_not_rotate() {
    for expires in [0, u64::MAX] {
        let workspace = Workspace::new();
        workspace.save(&connection(expires));
        let cancel = CancellationToken::new();
        if expires == 0 {
            cancel.cancel();
        }
        let result = refresh_codex_connection(
            workspace.storage(),
            workspace.load(),
            cancel,
            workspace.keys.clone(),
            |_, _| async { panic!("must not rotate") },
        )
        .await;
        assert_eq!(result.is_ok(), expires == u64::MAX);
        assert_eq!(
            workspace.load().codex.unwrap().refresh,
            "synthetic-refresh-private"
        );
    }
}

#[tokio::test]
async fn codex_refresh_failure_and_account_switch_cannot_replace_stored_access() {
    for failure in ["storage", "account", "provider"] {
        let workspace = Workspace::new();
        workspace.save(&connection(0));
        if failure == "storage" {
            workspace.keys.fail.store(true, Ordering::SeqCst);
        }
        let storage = workspace.storage();
        let _lock = storage.lock_credentials().unwrap();
        let result = refresh_codex_connection(
            storage,
            workspace.load(),
            CancellationToken::new(),
            workspace.keys.clone(),
            |mut old, _| async move {
                if failure == "provider" {
                    return Err(REJECTED.into());
                }
                if failure == "account" {
                    return Ok(credential("different-account", u64::MAX));
                }
                old.refresh = "synthetic-new-refresh".into();
                old.expires = u64::MAX;
                Ok(old)
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(
            workspace.load().codex.unwrap().refresh,
            "synthetic-refresh-private"
        );
    }
}

#[tokio::test]
async fn codex_waiting_preparations_reload_rotation_instead_of_rotating_twice() {
    let workspace = Workspace::new();
    workspace.save(&connection(0));
    let state = Ai::default();
    let first_cancel = CancellationToken::new();
    let second_cancel = CancellationToken::new();
    let gate = state
        .credential_guard("codex-workspace", &first_cancel)
        .await
        .unwrap();
    let mut queued = Box::pin(state.credential_guard("codex-workspace", &second_cancel));
    assert!(futures_util::poll!(&mut queued).is_pending());
    let storage = workspace.storage();
    let lock = storage.lock_credentials().unwrap();
    refresh_codex_connection(
        storage,
        workspace.load(),
        first_cancel,
        workspace.keys.clone(),
        |mut old, _| async move {
            old.refresh = "synthetic-once".into();
            old.expires = u64::MAX;
            Ok(old)
        },
    )
    .await
    .unwrap();
    drop(lock);
    drop(gate);
    let _second_gate = queued.await.unwrap();
    let storage = workspace.storage();
    let _lock = storage.lock_credentials().unwrap();
    let result = refresh_codex_connection(
        storage,
        workspace.load(),
        second_cancel,
        workspace.keys.clone(),
        |_, _| async { panic!("must use the durable rotation") },
    )
    .await
    .unwrap();
    assert_eq!(result.codex.unwrap().refresh, "synthetic-once");
}
