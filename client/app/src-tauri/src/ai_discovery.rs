use super::*;
use std::collections::HashSet;

const ERROR: &str = "native.ai.catalog.unavailable";
const PAGE_BYTES: usize = 2 * 1024 * 1024;
const TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_MODELS: usize = 2000;
const MAX_PAGES: usize = 20;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Account,
    Provider,
    Static,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub source: Source,
    pub models: Vec<String>,
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            source: Source::Unknown,
            models: vec![],
        }
    }
}
impl Catalog {
    pub(super) fn static_models(config: &Config) -> Self {
        let inventory: Value = serde_json::from_str(CATALOG).expect("bundled catalog");
        let models = inventory["providers"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| p["id"] == config.provider)
            .and_then(|p| p["models"].as_array())
            .into_iter()
            .flatten()
            .filter_map(|m| m["id"].as_str())
            .map(str::to_owned)
            .collect();
        Self {
            source: Source::Static,
            models,
        }
    }
    pub(super) fn admits(&self, model: &str) -> Result<(), String> {
        if self.source == Source::Account && !self.models.iter().any(|id| id == model) {
            return Err("native.ai.model.savedUnavailable".into());
        }
        Ok(())
    }
}
pub(super) fn catalog(connection: &Connection) -> Catalog {
    connection.catalog.clone().unwrap_or_else(|| {
        if connection.config.provider == "openai-codex" {
            Catalog::static_models(&connection.config)
        } else {
            Catalog::default()
        }
    })
}
#[derive(Clone, Copy)]
enum Protocol {
    OpenAi,
    Direct,
    Anthropic,
    Router,
    Custom,
}
struct Request {
    endpoint: reqwest::Url,
    protocol: Protocol,
    secret: String,
}
fn request(connection: &Connection) -> Result<Option<Request>, String> {
    admit_method(&connection.config)?;
    let (endpoint, protocol, secret) = match connection.config.provider.as_str() {
        "openai" if connection.config.auth == Some(AuthKind::Oauth) => (
            "https://api.openai.com/v1/models".to_owned(),
            Protocol::Direct,
            connection.oauth.as_ref().ok_or(ERROR)?.access.clone(),
        ),
        "openai" => (
            "https://api.openai.com/v1/models".into(),
            Protocol::OpenAi,
            connection.key.clone(),
        ),
        "anthropic" => (
            "https://api.anthropic.com/v1/models".into(),
            Protocol::Anthropic,
            connection.key.clone(),
        ),
        "openrouter" => (
            "https://openrouter.ai/api/v1/models/user".into(),
            Protocol::Router,
            connection.key.clone(),
        ),
        "custom" => {
            let base = connection.config.endpoint.as_deref().ok_or(ERROR)?;
            validate_http_consent(&connection.config, base, false)?;
            (
                format!("{}/models", base.trim_end_matches('/')),
                Protocol::Custom,
                connection.key.clone(),
            )
        }
        "openai-codex" => return Ok(None),
        _ => return Err(ERROR.into()),
    };
    Ok(Some(Request {
        endpoint: validate_endpoint(&endpoint)?,
        protocol,
        secret,
    }))
}
fn model_id(value: &Value) -> Result<String, String> {
    value
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 256
                && !id.chars().any(char::is_whitespace)
                && !id.chars().any(char::is_control)
        })
        .map(str::to_owned)
        .ok_or_else(|| ERROR.into())
}
async fn collect(request: Request) -> Result<Catalog, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ERROR)?;
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor: Option<String> = None;
    let mut offset = 0usize;
    let mut total_bytes = 0usize;
    let mut router_total = None;
    for _ in 0..MAX_PAGES {
        let mut url = request.endpoint.clone();
        match request.protocol {
            Protocol::Anthropic => {
                url.query_pairs_mut().append_pair("limit", "100");
                if let Some(cursor) = &cursor {
                    url.query_pairs_mut().append_pair("after_id", cursor);
                }
            }
            Protocol::Router => {
                url.query_pairs_mut()
                    .append_pair("offset", &offset.to_string())
                    .append_pair("limit", "100")
                    .append_pair("output_modalities", "text");
            }
            _ => (),
        }
        let mut query = client.get(url);
        if matches!(request.protocol, Protocol::Anthropic) {
            query = query
                .header("x-api-key", &request.secret)
                .header("anthropic-version", "2023-06-01");
        } else if !request.secret.is_empty() {
            query = query.bearer_auth(&request.secret);
        }
        let mut response = query.send().await.map_err(|_| ERROR)?;
        if response.status() != reqwest::StatusCode::OK
            || response
                .content_length()
                .is_some_and(|size| size > PAGE_BYTES as u64)
        {
            return Err(ERROR.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ERROR)? {
            total_bytes += chunk.len();
            if bytes.len() + chunk.len() > PAGE_BYTES || total_bytes > TOTAL_BYTES {
                return Err(ERROR.into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body: Value = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
        let items = body[if matches!(request.protocol, Protocol::Direct) {
            "models"
        } else {
            "data"
        }]
        .as_array()
        .ok_or(ERROR)?;
        if items.len() > MAX_MODELS
            || (matches!(request.protocol, Protocol::Anthropic | Protocol::Router)
                && items.len() > 100)
        {
            return Err(ERROR.into());
        }
        for item in items {
            if matches!(request.protocol, Protocol::Direct)
                && item["visibility"].as_str().ok_or(ERROR)? != "list"
            {
                continue;
            }
            let id = model_id(
                &item[if matches!(request.protocol, Protocol::Direct) {
                    "slug"
                } else {
                    "id"
                }],
            )?;
            if !seen.insert(id.clone()) || models.len() >= MAX_MODELS {
                return Err(ERROR.into());
            }
            models.push(id);
        }
        let more = match request.protocol {
            Protocol::Anthropic => {
                let more = body["has_more"].as_bool().ok_or(ERROR)?;
                if more {
                    let next = model_id(&body["last_id"])?;
                    if items.is_empty()
                        || items.last().and_then(|m| m["id"].as_str()) != Some(next.as_str())
                        || !cursors.insert(next.clone())
                    {
                        return Err(ERROR.into());
                    }
                    cursor = Some(next);
                }
                more
            }
            Protocol::Router => {
                let total = body["total_count"]
                    .as_u64()
                    .filter(|n| *n <= MAX_MODELS as u64)
                    .ok_or(ERROR)? as usize;
                if router_total.is_some_and(|prior| prior != total) {
                    return Err(ERROR.into());
                }
                router_total = Some(total);
                offset += items.len();
                if offset > total || (items.is_empty() && offset < total) {
                    return Err(ERROR.into());
                }
                offset < total
            }
            _ => false,
        };
        if !more {
            let catalog = Catalog {
                source: if matches!(request.protocol, Protocol::Direct | Protocol::Router) {
                    Source::Account
                } else {
                    Source::Provider
                },
                models,
            };
            if serde_json::to_vec(&catalog).map_err(|_| ERROR)?.len() > 24 * 1024 {
                return Err(ERROR.into());
            }
            return Ok(catalog);
        }
    }
    Err(ERROR.into())
}
async fn observe(request: Request, budget: Duration) -> Catalog {
    tokio::time::timeout(budget, collect(request))
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}
pub(super) async fn fetch(connection: &Connection) -> Catalog {
    match request(connection) {
        Ok(Some(request)) => observe(request, Duration::from_secs(30)).await,
        Ok(None) => Catalog::static_models(&connection.config),
        Err(_) => Catalog::default(),
    }
}
pub(super) fn fetch_for_app(app: &tauri::AppHandle, connection: &Connection) -> Catalog {
    tauri::async_runtime::block_on(async {
        tokio::time::timeout(Duration::from_secs(30), async {
            if request_local_network_permission(app, &connection.config)
                .await
                .is_err()
            {
                return Catalog::default();
            }
            fetch(connection).await
        })
        .await
        .unwrap_or_default()
    })
}
pub(super) fn attach(connection: &mut Connection, catalog: Catalog) -> Result<(), String> {
    connection.catalog = Some(catalog);
    if serde_json::to_vec(&connection)
        .map_err(|_| KEY_ERROR)?
        .len()
        > 65_536
    {
        connection.catalog = None;
    }
    Ok(())
}
pub(super) fn status(storage: &Storage, connection: &Connection, rejected: bool) -> Status {
    let mut status = model::status(storage, &connection.config, rejected);
    status.catalog = catalog(connection);
    model::resolve_status(storage, &connection.config, status)
}
pub(super) fn ensure_unchanged(
    storage: &Storage,
    expected: &situate_core::ai_storage::connections::Record,
) -> Result<(), String> {
    if storage.connection_record(&expected.id).as_ref() != Ok(expected) {
        return Err("native.ai.catalog.connectionChanged".into());
    }
    Ok(())
}
fn capture_record(
    storage: &Storage,
    connection: &Connection,
) -> Result<situate_core::ai_storage::connections::Record, String> {
    let record = storage.connection_record(
        connection
            .config
            .connection_id
            .as_deref()
            .ok_or(KEY_ERROR)?,
    )?;
    if record.config != serde_json::to_value(&connection.config).map_err(|_| KEY_ERROR)? {
        return Err("native.ai.catalog.connectionChanged".into());
    }
    Ok(record)
}
fn store_observation(
    storage: &Storage,
    keys: &impl KeyStore,
    expected: &situate_core::ai_storage::connections::Record,
    connection: &mut Connection,
    observed: Catalog,
) -> Result<Status, String> {
    ensure_unchanged(storage, expected)?;
    if expected.config != serde_json::to_value(&connection.config).map_err(|_| KEY_ERROR)? {
        return Err("native.ai.catalog.connectionChanged".into());
    }
    attach(connection, observed)?;
    storage.save_connection(
        keys,
        connection
            .config
            .connection_id
            .as_deref()
            .ok_or(KEY_ERROR)?,
        serde_json::to_value(&connection.config).map_err(|_| KEY_ERROR)?,
        &serde_json::to_vec(connection).map_err(|_| KEY_ERROR)?,
        true,
    )?;
    model::initialize(storage, &connection.config, &catalog(connection))?;
    Ok(status(storage, connection, false))
}
pub(super) fn finish_setup(
    storage: &Storage,
    app: &tauri::AppHandle,
    connection: &mut Connection,
) -> Result<Status, String> {
    let expected = capture_record(storage, connection)?;
    let observed = fetch_for_app(app, connection);
    store_observation(
        storage,
        &OsKeys(app.clone()),
        &expected,
        connection,
        observed,
    )
}
#[tauri::command]
pub async fn ai_refresh_models(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: Option<String>,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_connection_mutation(&app, window.label(), &scope, |location| {
            let storage = storage(&app, location)?;
            let _lock = storage.lock_credentials()?;
            let connection = load_connection_id(&storage, &app, connection_id.as_deref())?;
            let connection_id = connection.config.connection_id.clone().ok_or(KEY_ERROR)?;
            let mut status = if connection
                .oauth
                .as_ref()
                .is_some_and(|oauth| oauth.expired())
            {
                tauri::async_runtime::block_on(refresh_connection(
                    storage,
                    connection,
                    CancellationToken::new(),
                    OsKeys(app.clone()),
                    |old, cancel| async move { crate::openai_oauth::refresh(&old, &cancel).await },
                ))?;
                let storage = unrecovered_storage(&app, location)?;
                let bytes = storage
                    .load_connection(&OsKeys(app.clone()), &connection_id)?
                    .ok_or("native.ai.access.required")?;
                let mut connection = decode_connection(&bytes)?;
                finish_setup(&storage, &app, &mut connection)
            } else {
                let mut connection = connection;
                finish_setup(&storage, &app, &mut connection)
            }?;
            if app
                .state::<Ai>()
                .is_rejected(&scope, Some(&connection_id))?
            {
                status.available = false;
                status.reason = Some(REJECTED.into());
            }
            Ok(status)
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}

#[cfg(test)]
#[path = "ai_discovery_tests.rs"]
mod tests;
