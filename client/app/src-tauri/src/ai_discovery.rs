use super::*;
use crate::workspaces::{AuthorizationSession, with_authorization_session};
use sha2::{Digest, Sha256};
use situate_core::ai_storage::connections::Record;
use std::collections::HashSet;

const ERROR: &str = "native.ai.catalog.unavailable";
const PAGE_BYTES: usize = 2 * 1024 * 1024;
const TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_MODELS: usize = 2000;
const MAX_PAGES: usize = 20;

fn bundled_ids(provider: &str) -> HashSet<String> {
    let inventory: Value = serde_json::from_str(CATALOG).expect("bundled catalog");
    inventory["providers"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|entry| entry["id"] == provider)
        .and_then(|entry| entry["models"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|model| model["id"].as_str().map(str::to_owned))
        .collect()
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selectable: Vec<DiscoveredModel>,
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            source: Source::Unknown,
            models: vec![],
            checked_at: None,
            selectable: vec![],
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoveredModel {
    pub id: String,
    pub context_window: u32,
    pub max_tokens: u32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub image_input: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<ThinkingCapabilities>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThinkingCapabilities {
    pub levels: Vec<String>,
    pub default: String,
}

impl ThinkingCapabilities {
    pub(super) fn from_levels(
        levels: &[&str],
        supports: impl Fn(&str) -> bool,
        preferred: &str,
    ) -> Option<Self> {
        let levels: Vec<String> = levels
            .iter()
            .copied()
            .filter(|level| supports(level))
            .map(str::to_owned)
            .collect();
        let default = levels
            .iter()
            .find(|level| level.as_str() == preferred)
            .or_else(|| levels.first())?
            .clone();
        Some(Self { levels, default })
    }
}

pub(super) fn openai_thinking(config: &Config, id: &str) -> Option<&'static OpenAiThinking> {
    let capabilities = sources::openai_metadata::capabilities();
    (config.provider == "openai"
        && config.endpoint.is_none()
        && capabilities.models.iter().any(|model| model == id))
    .then_some(capabilities)
}

#[derive(Deserialize)]
pub(super) struct OpenAiThinking {
    models: Vec<String>,
    pub(super) levels: Vec<String>,
    pub(super) default: String,
}

impl DiscoveredModel {
    pub(super) fn thinking(&self, config: &Config) -> Option<(&[String], &str)> {
        if let Some(verified) = openai_thinking(config, &self.id) {
            return Some((&verified.levels, &verified.default));
        }
        if matches!(config.provider.as_str(), "anthropic" | "openrouter")
            && config.endpoint.is_none()
        {
            return self
                .thinking
                .as_ref()
                .map(|thinking| (thinking.levels.as_slice(), thinking.default.as_str()));
        }
        None
    }

    pub(super) fn validate_thinking(&self, config: &Config, level: &str) -> bool {
        self.thinking(config).map_or(level == "off", |(levels, _)| {
            levels.iter().any(|allowed| allowed == level)
        })
    }

    pub(super) fn descriptor(&self, config: &Config) -> Option<Value> {
        if config.endpoint.is_some()
            || (config.auth == Some(AuthKind::Oauth) && config.provider != "openai")
        {
            return None;
        }
        let (api, base) = match config.provider.as_str() {
            "openai" => ("openai-responses", "https://api.openai.com/v1"),
            "anthropic" => ("anthropic-messages", "https://api.anthropic.com"),
            "openrouter" => ("openai-completions", "https://openrouter.ai/api/v1"),
            _ => return None,
        };
        let input = if self.image_input {
            vec!["text", "image"]
        } else {
            vec!["text"]
        };
        let mut descriptor = serde_json::json!({
            "id":self.id,"name":self.id,"provider":config.provider,"type":"chat",
            "api":api,"baseUrl":base,"input":input,
            "reasoning":openai_thinking(config, &self.id).is_some() || self.thinking.is_some(),"cost":null,
            "contextWindow":self.context_window,"maxTokens":self.max_tokens,
            "compat":{"supportsStore":false,"supportsDeveloperRole":false,
                "supportsReasoningEffort":false,"supportsUsageInStreaming":false,
                "maxTokensField":"max_tokens"}
        });
        if config.auth == Some(AuthKind::Oauth) {
            descriptor["compat"]["supportsMaxOutputTokens"] = serde_json::json!(false);
        }
        if config.provider == "anthropic" && self.thinking.is_some() {
            descriptor["compat"]["forceAdaptiveThinking"] = serde_json::json!(true);
            descriptor["thinkingLevelMap"] = serde_json::json!({"off":null});
        }
        if config.provider == "openrouter" {
            if self
                .thinking
                .as_ref()
                .is_some_and(|thinking| thinking.levels.iter().any(|level| level == "off"))
            {
                descriptor["thinkingLevelMap"] = serde_json::json!({"off":"none"});
            }
            descriptor["compat"]["openRouterRouting"] =
                serde_json::json!({"require_parameters":true});
        }
        Some(descriptor)
    }
}

impl Catalog {
    pub(super) fn selectable(&self, config: &Config, id: &str) -> Option<DiscoveredModel> {
        if !matches!(self.source, Source::Account | Source::Provider)
            || !self.models.iter().any(|model| model == id)
        {
            return None;
        }
        self.selectable
            .iter()
            .find(|model| model.id == id && model.descriptor(config).is_some())
            .filter(|_| !bundled_ids(&config.provider).contains(id))
            .cloned()
    }
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
            checked_at: None,
            selectable: vec![],
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
        if matches!(strategy(&connection.config), Ok(ModelRefresh::Bundled)) {
            Catalog::static_models(&connection.config)
        } else {
            Catalog::default()
        }
    })
}
#[path = "ai_model_sources.rs"]
mod sources;
use sources::{ModelRefresh, fetch, strategy};
#[cfg(test)]
use sources::{Protocol, Request, collect, observe, request};

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
const REFRESH_INTERVAL: u64 = 24 * 60 * 60;

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn due(catalog: &Catalog, now: u64) -> bool {
    catalog.checked_at.is_none_or(|checked| {
        now.checked_sub(checked)
            .is_none_or(|age| age >= REFRESH_INTERVAL)
    })
}

pub(super) fn attach(connection: &mut Connection, observed: Catalog) -> Result<(), String> {
    let mut next = if observed.source == Source::Unknown {
        connection.catalog.clone().unwrap_or(observed)
    } else {
        observed
    };
    next.checked_at = Some(unix_seconds());
    let previous = connection.catalog.replace(next);
    if serde_json::to_vec(&connection)
        .map_err(|_| KEY_ERROR)?
        .len()
        > 65_536
    {
        connection.catalog = previous;
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
pub(super) fn schedule_refresh(
    app: tauri::AppHandle,
    window: &str,
    scope: String,
    status: &Status,
) {
    let Some(config) = status.config.as_ref().filter(|_| status.available) else {
        return;
    };
    let Some(id) = config.connection_id.clone() else {
        return;
    };
    if !matches!(strategy(config), Ok(ModelRefresh::Live(_)))
        || !due(&status.catalog, unix_seconds())
    {
        return;
    }
    let Ok(session) = crate::workspaces::authorization_session(&app, window, &scope) else {
        return;
    };
    let key = (scope, id);
    let state = app.state::<Ai>();
    let Ok(mut pending) = state.catalog_refreshes.lock() else {
        return;
    };
    if !pending.insert(key.clone()) {
        return;
    }
    drop(pending);
    let window = window.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let changed = matches!(
            refresh_catalog(&app, &window, &session, &key.0, Some(&key.1), false),
            Ok(Some((_, true)))
        );
        if let Ok(mut pending) = app.state::<Ai>().catalog_refreshes.lock() {
            pending.remove(&key);
        }
        if changed {
            let _ = app.emit_to(&window, "ai-models-changed", &key.0);
        }
    });
}

fn catalog_fingerprint(
    storage: &Storage,
    keys: &impl KeyStore,
    id: &str,
) -> Result<[u8; 32], String> {
    let bytes = storage.load_connection(keys, id)?.ok_or(KEY_ERROR)?;
    Ok(Sha256::digest(bytes).into())
}

fn persist_refresh(
    storage: &Storage,
    keys: &impl KeyStore,
    record: &Record,
    fingerprint: [u8; 32],
    connection: &mut Connection,
    observed: Catalog,
) -> Result<Status, String> {
    ensure_unchanged(storage, record)?;
    if catalog_fingerprint(storage, keys, &record.id)? != fingerprint {
        return Err("native.ai.catalog.connectionChanged".into());
    }
    store_observation(storage, keys, record, connection, observed)
}

fn refresh_catalog(
    app: &tauri::AppHandle,
    window: &str,
    session: &AuthorizationSession,
    scope: &str,
    connection_id: Option<&str>,
    manual: bool,
) -> Result<Option<(Status, bool)>, String> {
    let state = app.state::<Ai>();
    let keys = OsKeys(app.clone());
    let token = CancellationToken::new();
    let gate = || tauri::async_runtime::block_on(state.credential_guard(scope, &token));
    let snapshot = {
        let _gate = gate()?;
        let (storage, _lock, mut connection) =
            with_authorization_session(app, window, session, |location| {
                let storage = storage(app, location)?;
                let lock = storage.lock_credentials()?;
                let connection = load_connection_id(&storage, app, connection_id)?;
                Ok((storage, lock, connection))
            })?;
        let expired = connection
            .oauth
            .as_ref()
            .is_some_and(|grant| grant.expired());
        if !manual && (expired || !due(&catalog(&connection), unix_seconds())) {
            return Ok(None);
        }
        let id = connection.config.connection_id.clone().ok_or(KEY_ERROR)?;
        if expired {
            let context = conversations::Context::new(
                app.clone(),
                window.into(),
                scope.into(),
                session.clone(),
            );
            connection = tauri::async_runtime::block_on(native_model::refresh(
                &context,
                storage,
                connection,
                token.clone(),
            ))?;
        }
        with_authorization_session(app, window, session, |location| {
            let storage = unrecovered_storage(app, location)?;
            let record = capture_record(&storage, &connection)?;
            let fingerprint = catalog_fingerprint(&storage, &keys, &id)?;
            Ok((record, fingerprint, connection))
        })?
    };
    let (record, fingerprint, mut connection) = snapshot;
    let observed = fetch_for_app(app, &connection);
    let previous = catalog(&connection);
    let changed = observed.source != Source::Unknown
        && (observed.source != previous.source
            || observed.models != previous.models
            || observed.selectable != previous.selectable);
    let _gate = gate()?;
    with_authorization_session(app, window, session, |location| {
        let storage = storage(app, location)?;
        let _lock = storage.lock_credentials()?;
        let _preferences = storage.lock_preferences()?;
        let mut status = persist_refresh(
            &storage,
            &keys,
            &record,
            fingerprint,
            &mut connection,
            observed,
        )?;
        if state.is_rejected(scope, Some(&record.id))? {
            status.available = false;
            status.reason = Some(REJECTED.into());
        }
        Ok(Some((status, changed)))
    })
}

#[tauri::command]
pub async fn ai_refresh_models(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: Option<String>,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = crate::workspaces::authorization_session(&app, window.label(), &scope)?;
        refresh_catalog(
            &app,
            window.label(),
            &session,
            &scope,
            connection_id.as_deref(),
            true,
        )?
        .map(|(status, _)| status)
        .ok_or_else(|| ERROR.into())
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}

#[cfg(test)]
#[path = "ai_discovery_tests.rs"]
mod tests;
