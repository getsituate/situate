use super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Server {
    url: reqwest::Url,
    requests: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn server(pages: Vec<(u16, Value)>, redirect: Option<String>) -> Server {
    server_with_hook(pages, redirect, None).await
}
async fn server_with_hook(
    pages: Vec<(u16, Value)>,
    redirect: Option<String>,
    mut hook: Option<Box<dyn FnOnce() + Send>>,
) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url =
        reqwest::Url::parse(&format!("http://{}/models", listener.local_addr().unwrap())).unwrap();
    let requests = Arc::new(Mutex::new(vec![]));
    let captured = requests.clone();
    let task = tokio::spawn(async move {
        for (status, body) in pages {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(socket.read_u8().await.unwrap());
                assert!(request.len() < 8192);
            }
            captured
                .lock()
                .unwrap()
                .push(String::from_utf8(request).unwrap());
            if let Some(hook) = hook.take() {
                hook();
            }
            let body = serde_json::to_vec(&body).unwrap();
            let location = redirect
                .as_ref()
                .map(|s| format!("Location: {s}\r\n"))
                .unwrap_or_default();
            socket.write_all(format!("HTTP/1.1 {status} fixture\r\nContent-Length: {}\r\nConnection: close\r\n{location}\r\n", body.len()).as_bytes()).await.unwrap();
            let _ = socket.write_all(&body).await;
        }
    });
    Server {
        url,
        requests,
        task,
    }
}
fn request_to(server: &Server, protocol: Protocol) -> Request {
    Request {
        endpoint: server.url.clone(),
        protocol,
        secret: "synthetic-inference-key".into(),
    }
}
fn config(provider: &str, auth: AuthKind) -> Config {
    Config {
        connection_id: Some(Storage::new_connection_id()),
        label: None,
        http_acknowledgement: None,
        provider: provider.into(),
        auth: Some(auth),
        legacy_model: None,
        endpoint: None,
    }
}
#[tokio::test]
async fn openai_key_and_direct_account_contracts_have_distinct_shapes_and_provenance() {
    let key = server(
        vec![(200, json!({"object":"list","data":[{"id":"gpt-4o-mini"}]}))],
        None,
    )
    .await;
    let found = collect(request_to(&key, Protocol::OpenAi)).await.unwrap();
    assert_eq!(found.source, Source::Provider);
    assert_eq!(found.models, ["gpt-4o-mini"]);
    let direct = server(
        vec![(
            200,
            json!({"models":[
                {"slug":"gpt-6.1-sol","visibility":"list"},
                {"slug":"hidden-model","visibility":"hidden"}
            ]}),
        )],
        None,
    )
    .await;
    let found = collect(request_to(&direct, Protocol::Direct))
        .await
        .unwrap();
    assert_eq!(found.source, Source::Account);
    assert_eq!(found.models, ["gpt-6.1-sol"]);
    for service in [&key, &direct] {
        let captured = service.requests.lock().unwrap();
        assert!(captured[0].starts_with("GET /models HTTP/1.1"));
        assert!(captured[0].contains("authorization: Bearer synthetic-inference-key"));
    }
    let wrong = server(vec![(200, json!({"data":[{"id":"gpt-4o-mini"}]}))], None).await;
    assert!(collect(request_to(&wrong, Protocol::Direct)).await.is_err());
}
#[tokio::test]
async fn anthropic_pagination_encodes_opaque_cursors_and_uses_only_inference_headers() {
    let service = server(vec![
        (200, json!({"data":[{"id":"cursor/with?&="}],"has_more":true,"last_id":"cursor/with?&="})),
        (200, json!({"data":[{"id":"claude-sonnet-5-5"}],"has_more":false,"last_id":"claude-sonnet-5-5"})),
    ], None).await;
    let found = collect(request_to(&service, Protocol::Anthropic))
        .await
        .unwrap();
    assert_eq!(found.source, Source::Provider);
    assert_eq!(found.models.len(), 2);
    let requests = service.requests.lock().unwrap();
    assert!(requests[0].starts_with("GET /models?limit=100 "));
    assert!(requests[1].contains("after_id=cursor%2Fwith%3F%26%3D"));
    for request in requests.iter() {
        assert!(request.contains("x-api-key: synthetic-inference-key"));
        assert!(request.contains("anthropic-version: 2023-06-01"));
        assert!(!request.contains("authorization:"));
        assert!(!request.contains("anthropic-workspace-id:"));
    }
}
#[tokio::test]
async fn router_uses_local_offsets_and_never_follows_service_pagination_links() {
    let service = server(vec![
        (200, json!({"data":[{"id":"openai/gpt-6.1-sol"}],"total_count":2,"links":{"next":"https://untrusted.invalid/secret"}})),
        (200, json!({"data":[{"id":"openai/gpt-4o-mini"}],"total_count":2})),
    ], None).await;
    let found = collect(request_to(&service, Protocol::Router))
        .await
        .unwrap();
    assert_eq!(found.source, Source::Account);
    assert_eq!(found.models, ["openai/gpt-6.1-sol", "openai/gpt-4o-mini"]);
    let requests = service.requests.lock().unwrap();
    assert!(requests[0].starts_with("GET /models?offset=0&limit=100&output_modalities=text "));
    assert!(requests[1].starts_with("GET /models?offset=1&limit=100&output_modalities=text "));
}
#[tokio::test]
async fn denials_redirects_partial_pages_and_malformed_ids_are_not_authoritative_empty_lists() {
    for (protocol, pages) in [
        (
            Protocol::OpenAi,
            vec![(403, json!({"error":"management key required"}))],
        ),
        (
            Protocol::OpenAi,
            vec![(200, json!({"data":[{"id":"bad\nmodel"}]}))],
        ),
        (
            Protocol::Router,
            vec![(200, json!({"data":[],"total_count":1}))],
        ),
        (
            Protocol::Anthropic,
            vec![
                (
                    200,
                    json!({"data":[{"id":"a"}],"has_more":true,"last_id":"a"}),
                ),
                (500, json!({})),
            ],
        ),
        (
            Protocol::Anthropic,
            vec![
                (
                    200,
                    json!({"data":[{"id":"a"}],"has_more":true,"last_id":"a"}),
                ),
                (
                    200,
                    json!({"data":[{"id":"a"}],"has_more":true,"last_id":"a"}),
                ),
            ],
        ),
    ] {
        let service = server(pages, None).await;
        assert!(collect(request_to(&service, protocol)).await.is_err());
    }
    let destination = server(vec![(200, json!({"data":[]}))], None).await;
    let redirect = server(vec![(302, json!({}))], Some(destination.url.to_string())).await;
    assert!(
        collect(request_to(&redirect, Protocol::OpenAi))
            .await
            .is_err()
    );
    assert!(destination.requests.lock().unwrap().is_empty());
    let empty = server(vec![(200, json!({"models":[]}))], None).await;
    assert_eq!(
        collect(request_to(&empty, Protocol::Direct)).await.unwrap(),
        Catalog {
            source: Source::Account,
            models: vec![]
        }
    );
}
#[tokio::test]
async fn page_record_and_aggregate_bounds_reject_partial_catalogs() {
    let too_many = server(vec![(200, json!({"data":(0..=MAX_MODELS).map(|i|json!({"id":format!("model-{i}")})).collect::<Vec<_>>()}))], None).await;
    assert!(
        collect(request_to(&too_many, Protocol::OpenAi))
            .await
            .is_err()
    );
    let oversized = server(
        vec![(200, json!({"data":[],"padding":"x".repeat(PAGE_BYTES)}))],
        None,
    )
    .await;
    assert!(
        collect(request_to(&oversized, Protocol::OpenAi))
            .await
            .is_err()
    );
    let pages = (0..=MAX_PAGES)
        .map(|i| {
            (
                200,
                json!({"data":[{"id":format!("m{i}")}],"has_more":true,"last_id":format!("m{i}")}),
            )
        })
        .collect();
    let many_pages = server(pages, None).await;
    assert!(
        collect(request_to(&many_pages, Protocol::Anthropic))
            .await
            .is_err()
    );
    assert_eq!(many_pages.requests.lock().unwrap().len(), MAX_PAGES);
    let large_pages = (0..6).map(|i| (200, json!({"data":[{"id":format!("m{i}")}],"has_more":true,"last_id":format!("m{i}"),"padding":"x".repeat(1800*1024)}))).collect();
    let aggregate = server(large_pages, None).await;
    assert!(
        collect(request_to(&aggregate, Protocol::Anthropic))
            .await
            .is_err()
    );
}
#[test]
fn account_exclusion_does_not_turn_provider_observations_into_entitlement_claims() {
    let mut observed = Catalog {
        source: Source::Account,
        models: vec!["available".into()],
    };
    assert!(observed.admits("missing").is_err());
    observed.admits("available").unwrap();
    for source in [Source::Provider, Source::Static, Source::Unknown] {
        observed.source = source;
        observed.admits("missing").unwrap();
    }
}
#[test]
fn observed_ids_resolve_symbolic_defaults_without_rewriting_preferences() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let config = config("openai", AuthKind::ApiKey);
    model::initialize(&storage, &config, &Catalog::default()).unwrap();
    let before = storage
        .read_connection_settings(config.connection_id.as_deref().unwrap())
        .unwrap()
        .unwrap();
    let choice: Value = serde_json::from_slice(&before).unwrap();
    assert_eq!(choice["settings"]["chat"]["model"], "recommended");
    let connection = Connection {
        config: config.clone(),
        key: "synthetic".into(),
        oauth: None,
        codex: None,
        catalog: Some(Catalog {
            source: Source::Account,
            models: vec!["gpt-4o-mini".into()],
        }),
    };
    assert_eq!(
        status(&storage, &connection, false)
            .selected_model
            .as_deref(),
        Some("gpt-4o-mini")
    );
    model::initialize(&storage, &config, &Catalog::default()).unwrap();
    assert_eq!(
        storage
            .read_connection_settings(config.connection_id.as_deref().unwrap())
            .unwrap()
            .unwrap(),
        before
    );
}
#[tokio::test]
async fn keyless_custom_discovery_omits_authorization_and_codex_never_substitutes_an_endpoint() {
    let service = server(vec![(200, json!({"data":[{"id":"local-model"}]}))], None).await;
    let mut query = request_to(&service, Protocol::Custom);
    query.secret.clear();
    assert_eq!(collect(query).await.unwrap().models, ["local-model"]);
    assert!(!service.requests.lock().unwrap()[0].contains("authorization:"));
    let connection = Connection {
        config: config("openai-codex", AuthKind::Oauth),
        key: String::new(),
        oauth: None,
        codex: None,
        catalog: None,
    };
    assert!(request(&connection).unwrap().is_none());
    assert_eq!(fetch(&connection).await.source, Source::Static);
}

#[derive(Clone, Default)]
struct Keys {
    values: Arc<Mutex<std::collections::HashMap<String, Vec<u8>>>>,
    fail_write: Arc<std::sync::atomic::AtomicBool>,
}
impl KeyStore for Keys {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        self.values
            .lock()
            .unwrap()
            .get(account)
            .cloned()
            .ok_or_else(|| "missing synthetic key".into())
    }
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
        if self.fail_write.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("synthetic key write failed".into());
        }
        self.values
            .lock()
            .unwrap()
            .insert(account.into(), key.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.values.lock().unwrap().remove(account);
        Ok(())
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
        Storage::open(&self.root.path().canonicalize().unwrap(), "discovery-test")
            .unwrap()
            .with_device_store(&self.device.path().canonicalize().unwrap())
            .unwrap()
    }
    fn manifest_path(&self) -> std::path::PathBuf {
        self.device.path().join(format!(
            "{}-ai-connections.json",
            self.storage()
                .connection_manifest()
                .unwrap()
                .unwrap()
                .workspace_id
        ))
    }
    fn save(&self, connection: &Connection, replacing: bool) {
        self.storage()
            .save_connection(
                &self.keys,
                connection.config.connection_id.as_deref().unwrap(),
                serde_json::to_value(&connection.config).unwrap(),
                &serde_json::to_vec(connection).unwrap(),
                replacing,
            )
            .unwrap();
    }
    fn load(&self, id: &str) -> Connection {
        decode_connection(
            &self
                .storage()
                .load_connection(&self.keys, id)
                .unwrap()
                .unwrap(),
        )
        .unwrap()
    }
}
fn store_observation(
    storage: &Storage,
    keys: &impl KeyStore,
    connection: &mut Connection,
    observed: Catalog,
) -> Result<Status, String> {
    let expected = capture_record(storage, connection)?;
    super::store_observation(storage, keys, &expected, connection, observed)
}
fn browser() -> Connection {
    Connection {
        config: config("openai", AuthKind::Oauth),
        key: String::new(),
        codex: None,
        catalog: None,
        oauth: Some(crate::openai_oauth::Credential {
            access: "synthetic-access".into(),
            refresh: "synthetic-refresh".into(),
            expires: 0,
            client_id: "synthetic-client".into(),
            subject: "synthetic-subject".into(),
            scopes: vec!["chatgpt.tokens.use.direct".into()],
        }),
    }
}
#[tokio::test]
async fn caches_are_encrypted_per_connection_and_failure_or_reauth_preserves_explicit_choices() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let _lease = storage.lock_credentials().unwrap();
    let mut first = browser();
    let mut second = browser();
    workspace.save(&first, false);
    workspace.save(&second, false);
    let first_id = first.config.connection_id.clone().unwrap();
    let second_id = second.config.connection_id.clone().unwrap();
    model::save(&storage, &first.config, "gpt-4o-mini".into()).unwrap();
    store_observation(
        &storage,
        &workspace.keys,
        &mut first,
        Catalog {
            source: Source::Account,
            models: vec!["gpt-4o-mini".into()],
        },
    )
    .unwrap();
    store_observation(
        &storage,
        &workspace.keys,
        &mut second,
        Catalog {
            source: Source::Account,
            models: vec!["gpt-6.1-sol".into()],
        },
    )
    .unwrap();
    assert_eq!(storage.selected_connection().unwrap().unwrap().id, first_id);
    assert_eq!(
        model::required(&storage, &first.config).unwrap().model,
        "gpt-4o-mini"
    );
    assert_eq!(
        model::required(&storage, &second.config).unwrap().model,
        "gpt-6.1-sol"
    );
    assert_eq!(catalog(&workspace.load(&first_id)).models, ["gpt-4o-mini"]);
    assert_eq!(catalog(&workspace.load(&second_id)).models, ["gpt-6.1-sol"]);
    let manifest = std::fs::read_to_string(workspace.manifest_path()).unwrap();
    assert!(!manifest.contains("catalog"));
    assert!(!manifest.contains("synthetic-access"));
    let before = storage.read_connection_settings(&first_id).unwrap();
    let denied = server(vec![(403, json!({"error":"not permitted"}))], None).await;
    let observed = observe(
        request_to(&denied, Protocol::Direct),
        Duration::from_secs(1),
    )
    .await;
    assert_eq!(observed, Catalog::default());
    let result = store_observation(&storage, &workspace.keys, &mut first, observed).unwrap();
    assert!(result.available);
    assert_eq!(result.catalog.source, Source::Unknown);
    assert_eq!(result.selected_model.as_deref(), Some("gpt-4o-mini"));
    assert_eq!(storage.read_connection_settings(&first_id).unwrap(), before);
    let result = store_observation(
        &storage,
        &workspace.keys,
        &mut first,
        Catalog {
            source: Source::Account,
            models: vec![],
        },
    )
    .unwrap();
    assert_eq!(
        result.model_error.as_deref(),
        Some("native.ai.model.savedUnavailable")
    );
    first.catalog = None;
    first.oauth.as_mut().unwrap().access = "reauthenticated-access".into();
    workspace.save(&first, true);
    assert_eq!(catalog(&workspace.load(&first_id)).source, Source::Unknown);
    assert_eq!(catalog(&workspace.load(&second_id)).models, ["gpt-6.1-sol"]);
    assert_eq!(storage.read_connection_settings(&first_id).unwrap(), before);
}
#[tokio::test]
async fn rotation_is_durable_before_discovery_and_survives_cancel_denial_and_cache_write_failure() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let _lease = storage.lock_credentials().unwrap();
    let connection = browser();
    let id = connection.config.connection_id.clone().unwrap();
    workspace.save(&connection, false);
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    refresh_connection(
        storage,
        connection,
        cancel.clone(),
        workspace.keys.clone(),
        |mut old, refresh_cancel| async move {
            stop.cancel();
            assert!(!refresh_cancel.is_cancelled());
            old.access = "rotated-access".into();
            old.refresh = "rotated-refresh".into();
            Ok(old)
        },
    )
    .await
    .unwrap();
    assert!(cancel.is_cancelled());
    let mut restored = workspace.load(&id);
    assert_eq!(restored.oauth.as_ref().unwrap().refresh, "rotated-refresh");
    assert_eq!(
        request(&restored).unwrap().unwrap().secret,
        "rotated-access"
    );
    let denied = server(vec![(401, json!({}))], None).await;
    let observed = observe(
        Request {
            endpoint: denied.url.clone(),
            protocol: Protocol::Direct,
            secret: request(&restored).unwrap().unwrap().secret,
        },
        Duration::from_secs(1),
    )
    .await;
    assert_eq!(observed.source, Source::Unknown);
    workspace
        .keys
        .fail_write
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        store_observation(
            &workspace.storage(),
            &workspace.keys,
            &mut restored,
            observed.clone()
        )
        .is_err()
    );
    workspace
        .keys
        .fail_write
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        workspace.load(&id).oauth.unwrap().refresh,
        "rotated-refresh"
    );
    store_observation(
        &workspace.storage(),
        &workspace.keys,
        &mut restored,
        observed,
    )
    .unwrap();
    assert_eq!(
        workspace.load(&id).oauth.unwrap().refresh,
        "rotated-refresh"
    );
    assert!(denied.requests.lock().unwrap()[0].contains("authorization: Bearer rotated-access"));
}
#[tokio::test]
async fn selection_change_during_renewal_keeps_rotation_and_discovery_bound_to_the_original_id() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let _lease = storage.lock_credentials().unwrap();
    let first = browser();
    let mut second = browser();
    second.oauth.as_mut().unwrap().refresh = "other-account-refresh".into();
    second.catalog = Some(Catalog {
        source: Source::Account,
        models: vec!["gpt-6.1-sol".into()],
    });
    workspace.save(&second, false);
    workspace.save(&first, false);
    let first_id = first.config.connection_id.clone().unwrap();
    let second_id = second.config.connection_id.clone().unwrap();
    let mut external = storage.connection_manifest().unwrap().unwrap();
    external.selected = Some(second_id.clone());
    let path = workspace.manifest_path();
    refresh_connection(
        storage,
        first,
        CancellationToken::new(),
        workspace.keys.clone(),
        |mut old, _| async move {
            std::fs::write(path, serde_json::to_vec(&external).unwrap()).unwrap();
            old.access = "first-new-access".into();
            old.refresh = "first-new-refresh".into();
            Ok(old)
        },
    )
    .await
    .unwrap();
    let mut first = workspace.load(&first_id);
    assert_eq!(first.oauth.as_ref().unwrap().refresh, "first-new-refresh");
    let service = server(
        vec![(
            200,
            json!({"models":[{"slug":"gpt-4o-mini","visibility":"list"}]}),
        )],
        None,
    )
    .await;
    let mut query = request_to(&service, Protocol::Direct);
    query.secret = request(&first).unwrap().unwrap().secret;
    let observed = observe(query, Duration::from_secs(1)).await;
    store_observation(&workspace.storage(), &workspace.keys, &mut first, observed).unwrap();
    assert_eq!(
        workspace
            .storage()
            .selected_connection()
            .unwrap()
            .unwrap()
            .id,
        second_id
    );
    let second = workspace.load(&second_id);
    assert_eq!(
        second.oauth.as_ref().unwrap().refresh,
        "other-account-refresh"
    );
    assert_eq!(catalog(&second).models, ["gpt-6.1-sol"]);
    assert_eq!(catalog(&workspace.load(&first_id)).models, ["gpt-4o-mini"]);
    assert!(service.requests.lock().unwrap()[0].contains("authorization: Bearer first-new-access"));
}

#[tokio::test]
async fn identity_change_between_credential_read_and_refresh_snapshot_stops_before_dispatch() {
    for field in ["revision", "workspace"] {
        let workspace = Workspace::new();
        let storage = workspace.storage();
        let _lease = storage.lock_credentials().unwrap();
        let connection = browser();
        workspace.save(&connection, false);
        let original = storage.connection_manifest().unwrap().unwrap();
        let record = original.connections[0].clone();
        let loaded = workspace.load(&record.id);
        let mut external = original.clone();
        if field == "revision" {
            external.connections[0].revision = Storage::new_connection_id();
        } else {
            external.workspace_id = Storage::new_connection_id();
        }
        assert_eq!(external.connections[0].config, record.config);
        let bytes = serde_json::to_vec(&external).unwrap();
        let path = workspace.manifest_path();
        std::fs::write(&path, &bytes).unwrap();
        let called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let invoked = called.clone();
        let result = refresh_connection(
            storage,
            loaded,
            CancellationToken::new(),
            workspace.keys.clone(),
            move |mut old, _| async move {
                invoked.store(true, std::sync::atomic::Ordering::SeqCst);
                old.refresh = "returned-rotation".into();
                Ok(old)
            },
        )
        .await;
        assert_eq!(result.err().as_deref(), Some("native.ai.access.required"));
        assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(std::fs::read(path).unwrap(), bytes);
        assert_eq!(workspace.keys.values.lock().unwrap().len(), 1);
        let reopened = workspace.storage();
        let retained = reopened
            .load_captured_connection(&workspace.keys, &original, &record)
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&retained).unwrap()["oauth"]["refresh"],
            "synthetic-refresh"
        );
    }
}

#[test]
fn settings_toggles_preserve_excluded_choices_but_changed_or_enabled_choices_require_admission() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let _lease = storage.lock_credentials().unwrap();
    let mut connection = browser();
    connection.catalog = Some(Catalog {
        source: Source::Account,
        models: vec!["gpt-6.1-sol".into(), "gpt-4o-mini".into()],
    });
    workspace.save(&connection, false);
    let initial = json!({"version":1,"chat":{"model":"gpt-6.1-sol","thinking":"medium","catalogRevision":null},"comment":{"model":"gpt-4o-mini","thinking":"off","catalogRevision":null},"generatedComments":true,"showInlineModel":false});
    model::save_current_settings(
        &storage,
        &connection,
        serde_json::from_value(initial.clone()).unwrap(),
    )
    .unwrap();
    connection.catalog = Some(Catalog {
        source: Source::Account,
        models: vec![],
    });
    workspace.save(&connection, true);
    let mut toggled = initial.clone();
    toggled["showInlineModel"] = json!(true);
    model::save_current_settings(
        &storage,
        &connection,
        serde_json::from_value(toggled.clone()).unwrap(),
    )
    .unwrap();
    toggled["generatedComments"] = json!(false);
    let saved = model::save_current_settings(
        &storage,
        &connection,
        serde_json::from_value(toggled.clone()).unwrap(),
    )
    .unwrap();
    assert_eq!(serde_json::to_value(saved).unwrap(), toggled);
    for field in ["chat", "comment", "generatedComments"] {
        let mut changed = toggled.clone();
        changed[field] = match field {
            "chat" => initial["comment"].clone(),
            "comment" => initial["chat"].clone(),
            _ => json!(true),
        };
        assert_eq!(
            model::save_current_settings(
                &storage,
                &connection,
                serde_json::from_value(changed).unwrap()
            )
            .err()
            .as_deref(),
            Some("native.ai.model.savedUnavailable")
        );
        assert_eq!(
            serde_json::to_value(model::load_current_settings(&storage, &workspace.keys).unwrap())
                .unwrap(),
            toggled
        );
    }
    toggled["comment"] = Value::Null;
    assert!(
        model::save_current_settings(
            &storage,
            &connection,
            serde_json::from_value(toggled).unwrap()
        )
        .is_ok()
    );
}

#[test]
fn settings_initialization_reads_the_latest_encrypted_catalog_even_when_config_is_unchanged() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let _lease = storage.lock_credentials().unwrap();
    let mut connection = browser();
    connection.catalog = Some(Catalog {
        source: Source::Account,
        models: vec!["gpt-6.1-sol".into()],
    });
    workspace.save(&connection, false);
    let id = connection.config.connection_id.as_deref().unwrap();
    let stale = workspace.load(id);
    assert_eq!(catalog(&stale).models, ["gpt-6.1-sol"]);
    connection.catalog = Some(Catalog {
        source: Source::Account,
        models: vec![],
    });
    workspace.save(&connection, true);
    assert!(stale.config == connection.config);
    let current =
        serde_json::to_value(model::load_current_settings(&storage, &workspace.keys).unwrap())
            .unwrap();
    assert_eq!(current["chat"]["model"], "recommended");
    assert_eq!(current["comment"]["model"], "recommended");
    let status = status(&storage, &connection, false);
    assert!(status.selected_model.is_none());
    assert!(status.model_error.is_some());
    assert!(storage.read_connection_settings(id).unwrap().is_some());
}

#[tokio::test]
async fn changed_or_removed_record_after_refresh_dispatch_retains_the_returned_grant() {
    for remove in [false, true] {
        let workspace = Workspace::new();
        let storage = workspace.storage();
        let _lease = storage.lock_credentials().unwrap();
        let first = browser();
        let second = browser();
        workspace.save(&second, false);
        workspace.save(&first, false);
        let first_id = first.config.connection_id.clone().unwrap();
        let second_id = second.config.connection_id.clone().unwrap();
        let mut external = storage.connection_manifest().unwrap().unwrap();
        external.selected = Some(second_id.clone());
        if remove {
            external.connections.retain(|r| r.id != first_id);
        } else {
            external
                .connections
                .iter_mut()
                .find(|r| r.id == first_id)
                .unwrap()
                .config["label"] = json!("Synced label");
        }
        let bytes = serde_json::to_vec(&external).unwrap();
        let dispatched_bytes = bytes.clone();
        let path = workspace.manifest_path();
        let dispatched_path = path.clone();
        let cancel = CancellationToken::new();
        let stop = cancel.clone();
        let result = refresh_connection(
            storage,
            first,
            cancel,
            workspace.keys.clone(),
            |mut old, _| async move {
                std::fs::write(dispatched_path, dispatched_bytes).unwrap();
                stop.cancel();
                old.access = "returned-access".into();
                old.refresh = "returned-rotating-grant".into();
                Ok(old)
            },
        )
        .await;
        assert_eq!(
            result.err().as_deref(),
            Some("native.ai.storage.publicationConflict")
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let reopened = workspace.storage();
        assert!(reopened.has_pending_connection_publication().unwrap());
        assert_eq!(
            reopened
                .conflicting_connection_publication()
                .unwrap()
                .unwrap()
                .id,
            first_id
        );
        assert_eq!(workspace.keys.values.lock().unwrap().len(), 3);
        let called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let invoked = called.clone();
        let second = workspace.load(&second_id);
        let next = refresh_connection(
            reopened,
            second,
            CancellationToken::new(),
            workspace.keys.clone(),
            move |old, _| async move {
                invoked.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(old)
            },
        )
        .await;
        assert_eq!(
            next.err().as_deref(),
            Some("native.ai.storage.publicationPending")
        );
        assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
        let storage = workspace.storage();
        storage
            .forget_connection(&workspace.keys, &first_id)
            .unwrap();
        assert!(!storage.has_pending_connection_publication().unwrap());
        assert_eq!(workspace.keys.values.lock().unwrap().len(), 1);
        assert_eq!(
            storage.selected_connection().unwrap().unwrap().id,
            second_id
        );
    }
}

#[tokio::test]
async fn external_configuration_and_selection_edits_during_discovery_are_not_replayed() {
    for changed_config in [false, true] {
        let workspace = Workspace::new();
        let storage = workspace.storage();
        let _lease = storage.lock_credentials().unwrap();
        let mut first = browser();
        let mut second = browser();
        second.catalog = Some(Catalog {
            source: Source::Account,
            models: vec!["gpt-6.1-sol".into()],
        });
        workspace.save(&second, false);
        workspace.save(&first, false);
        let expected = capture_record(&storage, &first).unwrap();
        let first_id = first.config.connection_id.clone().unwrap();
        let second_id = second.config.connection_id.clone().unwrap();
        let mut external = storage.connection_manifest().unwrap().unwrap();
        external.selected = Some(second_id.clone());
        if changed_config {
            external
                .connections
                .iter_mut()
                .find(|r| r.id == first_id)
                .unwrap()
                .config["label"] = json!("Synced label");
        }
        let external_bytes = serde_json::to_vec(&external).unwrap();
        let path = workspace.manifest_path();
        let write_path = path.clone();
        let write_bytes = external_bytes.clone();
        let before_keys = workspace.keys.values.lock().unwrap().clone();
        let service = server_with_hook(
            vec![(
                200,
                json!({"models":[{"slug":"gpt-4o-mini","visibility":"list"}]}),
            )],
            None,
            Some(Box::new(move || {
                std::fs::write(write_path, write_bytes).unwrap();
            })),
        )
        .await;
        let observed = observe(
            request_to(&service, Protocol::Direct),
            Duration::from_secs(1),
        )
        .await;
        let result =
            super::store_observation(&storage, &workspace.keys, &expected, &mut first, observed);
        if changed_config {
            assert_eq!(
                result.err().as_deref(),
                Some("native.ai.catalog.connectionChanged")
            );
            assert_eq!(*workspace.keys.values.lock().unwrap(), before_keys);
        } else {
            result.unwrap();
            assert_eq!(catalog(&workspace.load(&first_id)).models, ["gpt-4o-mini"]);
        }
        assert_eq!(std::fs::read(&path).unwrap(), external_bytes);
        assert_eq!(
            storage.selected_connection().unwrap().unwrap().id,
            second_id
        );
        assert_eq!(catalog(&workspace.load(&second_id)).models, ["gpt-6.1-sol"]);
    }
}

#[tokio::test]
async fn a_stalled_catalog_returns_unknown_within_the_overall_deadline() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint =
        reqwest::Url::parse(&format!("http://{}/models", listener.local_addr().unwrap())).unwrap();
    let task = tokio::spawn(async move {
        let (_socket, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
    });
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        observe(
            Request {
                endpoint,
                protocol: Protocol::OpenAi,
                secret: "synthetic".into(),
            },
            Duration::from_millis(10),
        ),
    )
    .await
    .unwrap();
    task.abort();
    assert_eq!(result, Catalog::default());
}
