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
#[test]
fn every_implemented_connection_method_declares_a_refresh_strategy() {
    let policy: Value = serde_json::from_str(PROVIDER_POLICY).unwrap();
    for (provider, entry) in policy["providers"].as_object().unwrap() {
        for (method, entry) in entry["methods"].as_object().unwrap() {
            if entry["status"] != "implemented" {
                continue;
            }
            let auth = match method.as_str() {
                "oauth" => AuthKind::Oauth,
                "api_key" => AuthKind::ApiKey,
                _ => panic!("Unsupported authentication method: {method}"),
            };
            assert!(
                strategy(&config(provider, auth)).is_ok(),
                "{provider}/{method}"
            );
        }
    }
}

#[test]
fn legacy_cache_is_due_and_refresh_is_throttled_across_reopening() {
    let mut catalog: Catalog = serde_json::from_value(json!({
        "source":"account", "models":["gpt-4o-mini"]
    }))
    .unwrap();
    let now = 200_000;
    assert!(due(&catalog, now));
    catalog.checked_at = Some(now);
    let reopened: Catalog = serde_json::from_value(serde_json::to_value(catalog).unwrap()).unwrap();
    assert_eq!(reopened.models, ["gpt-4o-mini"]);
    assert!(!due(&reopened, now + REFRESH_INTERVAL - 1));
    assert!(due(&reopened, now + REFRESH_INTERVAL));
    assert!(due(&reopened, now - 1));
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
async fn router_observation_keeps_a_large_account_catalog_with_compact_route_limits() {
    let models = (0..400)
        .map(|index| {
            json!({
                "id": format!("vendor/chat-{index}"),
                "name": "N".repeat(240),
                "architecture":{"input_modalities":["text","image"],"output_modalities":["text"]},
                "supported_parameters":["tools"], "endpoints":["/api/v1/chat/completions"],
                "context_length": 8192, "top_provider":{"max_completion_tokens":2048}
            })
        })
        .collect::<Vec<_>>();
    let pages = models
        .chunks(100)
        .map(|page| (200, json!({"data":page,"total_count":400})))
        .collect();
    let service = server(pages, None).await;
    let catalog = collect(request_to(&service, Protocol::Router))
        .await
        .unwrap();
    assert_eq!(catalog.models.len(), 400);
    assert_eq!(catalog.selectable.len(), 400);
    assert_eq!(catalog.selectable[399].max_tokens, 2048);
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
            models: vec![],
            checked_at: None,
            selectable: vec![],
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
        checked_at: None,
        selectable: vec![],
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
        catalog: Some(Catalog {
            source: Source::Account,
            models: vec!["gpt-4o-mini".into()],
            checked_at: None,
            selectable: vec![],
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
async fn keyless_custom_discovery_omits_authorization() {
    let service = server(vec![(200, json!({"data":[{"id":"local-model"}]}))], None).await;
    let mut query = request_to(&service, Protocol::Custom);
    query.secret.clear();
    assert_eq!(collect(query).await.unwrap().models, ["local-model"]);
    assert!(!service.requests.lock().unwrap()[0].contains("authorization:"));
}

#[tokio::test]
async fn only_an_unsupported_custom_model_endpoint_enables_manual_selection() {
    let config = config("custom", AuthKind::ApiKey);
    for (status, source, accepted) in [
        (404, Source::Manual, true),
        (500, Source::Unknown, false),
        (401, Source::Unknown, false),
        (200, Source::Provider, false),
    ] {
        let service = server(vec![(status, json!({"data":[{"id":"listed"}]}))], None).await;
        let catalog = observe(
            request_to(&service, Protocol::Custom),
            Duration::from_secs(2),
        )
        .await;
        assert_eq!(catalog.source, source);
        assert_eq!(
            catalog.admits_selection(&config, "unlisted").is_ok(),
            accepted
        );
    }
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
async fn qualified_live_models_survive_reopen_and_use_only_the_native_provider_transport() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let _lease = storage.lock_credentials().unwrap();
    let id = "vendor/new-tool-model";
    let router = server(vec![(200, json!({
        "total_count": 2, "data":[
            {"id":id, "architecture":{"input_modalities":["text"],"output_modalities":["text"]},
             "supported_parameters":["tools"], "endpoints":["/api/v1/chat/completions"],
             "context_length": 8192, "top_provider":{"max_completion_tokens": 2048},
             "baseUrl":"https://untrusted.invalid"},
            {"id":"text-without-tools", "architecture":{"input_modalities":["text"],"output_modalities":["text"]},
             "endpoints":["/api/v1/chat/completions"],"context_length":8192,
             "top_provider":{"max_completion_tokens":2048}}
        ]
    }))], None).await;
    let observed = collect(request_to(&router, Protocol::Router))
        .await
        .unwrap();
    let mut connection = Connection {
        config: config("openrouter", AuthKind::ApiKey),
        key: "synthetic-key".into(),
        oauth: None,
        catalog: None,
    };
    workspace.save(&connection, false);
    let connection_id = connection.config.connection_id.clone().unwrap();
    store_observation(&storage, &workspace.keys, &mut connection, observed).unwrap();
    let mut reopened = workspace.load(&connection_id);
    let observed = catalog(&reopened);
    assert_eq!(observed.models, [id, "text-without-tools"]);
    assert!(model::admit_workspace(&storage, &reopened).is_err());
    assert!(
        model::save_observed(
            &storage,
            &reopened.config,
            "text-without-tools".into(),
            &observed
        )
        .is_err()
    );
    model::save_observed(&storage, &reopened.config, id.into(), &observed).unwrap();
    let choice = model::admit_workspace(&storage, &reopened).unwrap();
    let (api, url, _) = choice.target().unwrap();
    assert_eq!(api, "openai-completions");
    assert_eq!(url, "https://openrouter.ai/api/v1/chat/completions");
    let descriptor = native_model::descriptor(&choice).unwrap();
    assert_eq!(descriptor["maxTokens"], 2048);
    assert_eq!(descriptor["contextWindow"], 8192);
    let prepared = crate::ai_protocol::build_request(
        &api,
        &descriptor,
        &choice.thinking,
        &[json!({"role":"user","content":"hello"})],
        &[],
        None,
    )
    .unwrap();
    assert_eq!(prepared.body["model"], id);
    assert_eq!(prepared.body["stream"], true);
    assert_eq!(
        prepared.body["provider"],
        json!({"require_parameters":true})
    );
    model::validate_payload(&choice, &prepared.body).unwrap();

    store_observation(
        &storage,
        &workspace.keys,
        &mut reopened,
        Catalog {
            source: Source::Account,
            ..Catalog::default()
        },
    )
    .unwrap();
    assert!(model::admit_workspace(&storage, &reopened).is_err());
    assert_eq!(
        status(&storage, &reopened, false).selected_model.as_deref(),
        Some(id)
    );
    assert_eq!(choice.target().unwrap().1, url);
}

#[tokio::test]
async fn anthropic_limits_qualify_active_messages_models_but_openai_ids_alone_do_not() {
    let anthropic = server(vec![(200, json!({"has_more":false,"data":[
        {"id":"claude-new","display_name":"Fixture Claude","type":"model","lifecycle":"active","max_input_tokens":8192,"max_tokens":2048,"capabilities":{"image_input":{"supported":true},"effort":{"medium":{"supported":true}},"thinking":{"types":{"adaptive":{"supported":true},"disabled":{"supported":true}}}}},
        {"id":"claude-no-limits","type":"model","lifecycle":"active"},
        {"id":"claude-old","type":"model","lifecycle":"deprecated","max_input_tokens":8192,"max_tokens":2048}
    ]}))], None).await;
    let observed = collect(request_to(&anthropic, Protocol::Anthropic))
        .await
        .unwrap();
    let config = config("anthropic", AuthKind::ApiKey);
    let qualified = observed.selectable(&config, "claude-new").unwrap();
    assert_eq!(qualified.name.as_deref(), Some("Fixture Claude"));
    assert!(qualified.image_input);
    let descriptor = qualified.descriptor(&config).unwrap();
    assert_eq!(descriptor["api"], "anthropic-messages");
    assert_eq!(descriptor["maxTokens"], 2048);
    assert_eq!(qualified.thinking_levels, ["medium"]);
    assert!(!qualified.supports_thinking("high"));
    let request = crate::ai_protocol::build_request(
        "anthropic-messages",
        &descriptor,
        "medium",
        &[],
        &[],
        None,
    )
    .unwrap();
    assert_eq!(request.body["thinking"]["type"], "adaptive");
    assert_eq!(request.body["output_config"]["effort"], "medium");
    assert!(observed.selectable(&config, "claude-no-limits").is_none());
    assert!(observed.selectable(&config, "claude-old").is_none());

    let openai = server(vec![(200, json!({"data":[{"id":"gpt-new"}]}))], None).await;
    let observed = collect(request_to(&openai, Protocol::OpenAi))
        .await
        .unwrap();
    assert_eq!(observed.models, ["gpt-new"]);
    assert!(observed.selectable.is_empty());
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
            checked_at: None,
            selectable: vec![],
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
            checked_at: None,
            selectable: vec![],
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
    assert_eq!(result.catalog.source, Source::Account);
    assert_eq!(result.catalog.models, ["gpt-4o-mini"]);
    assert!(!due(&result.catalog, unix_seconds()));
    assert_eq!(result.selected_model.as_deref(), Some("gpt-4o-mini"));
    assert_eq!(storage.read_connection_settings(&first_id).unwrap(), before);
    let result = store_observation(
        &storage,
        &workspace.keys,
        &mut first,
        Catalog {
            source: Source::Account,
            models: vec![],
            checked_at: None,
            selectable: vec![],
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
    assert_eq!(request(&restored).unwrap().secret, "rotated-access");
    let denied = server(vec![(401, json!({}))], None).await;
    let observed = observe(
        Request {
            endpoint: denied.url.clone(),
            protocol: Protocol::Direct,
            secret: request(&restored).unwrap().secret,
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
        checked_at: None,
        selectable: vec![],
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
    query.secret = request(&first).unwrap().secret;
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
        checked_at: None,
        selectable: vec![],
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
        checked_at: None,
        selectable: vec![],
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
        checked_at: None,
        selectable: vec![],
    });
    workspace.save(&connection, false);
    let id = connection.config.connection_id.as_deref().unwrap();
    let stale = workspace.load(id);
    assert_eq!(catalog(&stale).models, ["gpt-6.1-sol"]);
    connection.catalog = Some(Catalog {
        source: Source::Account,
        models: vec![],
        checked_at: None,
        selectable: vec![],
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
            checked_at: None,
            selectable: vec![],
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
async fn native_openai_request_authenticates_with_the_stored_browser_grant() {
    let service = server(vec![(401, json!({}))], None).await;
    let connection = browser();
    assert!(connection.key.is_empty());
    let result = send(
        (
            connection,
            "openai-responses".into(),
            service.url.to_string(),
            "{}".into(),
            HashMap::new(),
        ),
        CancellationToken::new(),
        |_| Ok(()),
        None,
    )
    .await;
    assert_eq!(result.err().as_deref(), Some(REJECTED));
    assert!(
        service.requests.lock().unwrap()[0]
            .to_ascii_lowercase()
            .contains("authorization: bearer synthetic-access\r\n")
    );
}

#[test]
fn catalog_refresh_does_not_overwrite_credentials_renewed_during_discovery() {
    let workspace = Workspace::new();
    let storage = workspace.storage();
    let mut captured = browser();
    workspace.save(&captured, false);
    let record = capture_record(&storage, &captured).unwrap();
    let fingerprint = catalog_fingerprint(&storage, &workspace.keys, &record.id).unwrap();

    let mut renewed = workspace.load(&record.id);
    renewed.oauth.as_mut().unwrap().expires = u64::MAX;
    workspace.save(&renewed, true);
    assert!(storage.connection_record(&record.id).unwrap() == record);

    let _lock = storage.lock_credentials().unwrap();
    let result = persist_refresh(
        &storage,
        &workspace.keys,
        &record,
        fingerprint,
        &mut captured,
        Catalog {
            source: Source::Account,
            models: vec!["gpt-6.2-sol".into()],
            ..Catalog::default()
        },
    );

    assert_eq!(
        result.err().as_deref(),
        Some("native.ai.catalog.connectionChanged")
    );
    let saved = workspace.load(&record.id);
    assert_eq!(saved.oauth.unwrap().expires, u64::MAX);
    assert!(saved.catalog.is_none());
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
