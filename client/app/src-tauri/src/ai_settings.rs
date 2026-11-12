const RECOMMENDATIONS: &str = include_str!("../../src/ai/model-recommendations.json");
#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelChoice {
    pub(super) model: String,
    pub(super) thinking: String,
    pub(super) catalog_revision: Option<String>,
}
impl ModelChoice {
    fn snapshot(self, config: &Config) -> Choice {
        Choice {
            version: 1,
            connection: config.association(),
            model: self.model,
            thinking: self.thinking,
            catalog_revision: self.catalog_revision,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceAiSettings {
    version: u8,
    chat: Option<ModelChoice>,
    comment: Option<ModelChoice>,
    generated_comments: bool,
    show_inline_model: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredSettings {
    connection: Config,
    settings: WorkspaceAiSettings,
    #[serde(default)]
    thinking_by_model: std::collections::BTreeMap<String, String>,
}

pub(super) fn supported_thinking_levels(
    config: &Config,
    model: &str,
) -> Result<Vec<String>, String> {
    let (api, _, _) = target(config, model)?;
    let catalog: Value = serde_json::from_str(RECOMMENDATIONS).map_err(|_| MODEL_ERROR)?;
    let entry = catalog["verifiedThinking"].as_array().and_then(|entries| {
        entries.iter().find(|entry| {
            entry["provider"] == config.provider && entry["modelId"] == model && entry["api"] == api
        })
    });
    Ok(entry
        .and_then(|entry| entry["levels"].as_array())
        .map(|levels| {
            levels
                .iter()
                .filter_map(|level| level.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_else(|| vec!["off".into()]))
}
pub(super) fn comment_thinking(config: &Config, model: &str) -> Result<String, String> {
    let levels = supported_thinking_levels(config, model)?;
    let inventory: Value = serde_json::from_str(CATALOG).map_err(|_| MODEL_ERROR)?;
    let reasoning = inventory["providers"]
        .as_array()
        .and_then(|providers| {
            providers
                .iter()
                .find(|provider| provider["id"] == config.provider)
        })
        .and_then(|provider| provider["models"].as_array())
        .and_then(|models| models.iter().find(|entry| entry["id"] == model))
        .is_some_and(|entry| entry["reasoning"] == true);
    if reasoning && levels == ["off"] {
        return Err(MODEL_ERROR.into());
    }
    Ok(levels[0].clone())
}
fn default_thinking(config: &Config, model: &str) -> Result<String, String> {
    let levels = supported_thinking_levels(config, model)?;
    let recommendations: Value = serde_json::from_str(RECOMMENDATIONS).map_err(|_| MODEL_ERROR)?;
    let access = if config.auth == Some(AuthKind::Oauth) {
        "oauth"
    } else {
        "api_key"
    };
    if let Some(level) = recommendations["rankedCandidates"]
        .as_array()
        .and_then(|entries| {
            entries.iter().find(|entry| {
                entry["provider"] == config.provider
                    && entry["access"] == access
                    && entry["modelId"] == model
            })
        })
        .and_then(|entry| entry["thinking"].as_str())
        .filter(|level| levels.iter().any(|supported| supported == level))
    {
        return Ok(level.into());
    }
    Ok(levels[0].clone())
}
pub(super) fn validate_thinking(
    config: &Config,
    model: &str,
    thinking: &str,
) -> Result<(), String> {
    if !supported_thinking_levels(config, model)?
        .iter()
        .any(|level| level == thinking)
    {
        return Err(MODEL_ERROR.into());
    }
    Ok(())
}
fn validate_settings(config: &Config, settings: &WorkspaceAiSettings) -> Result<(), String> {
    if settings.version != 1 {
        return Err(MODEL_ERROR.into());
    }
    for choice in [&settings.chat, &settings.comment].into_iter().flatten() {
        if choice.model == "recommended" {
            continue;
        }
        target(config, &choice.model)?;
        if choice.thinking != "recommended" {
            validate_thinking(config, &choice.model, &choice.thinking)?;
        }
        if let Some(revision) = &choice.catalog_revision {
            let catalog: Value = serde_json::from_str(RECOMMENDATIONS).map_err(|_| MODEL_ERROR)?;
            if revision.len() > 128 || revision.is_empty() || revision.chars().any(char::is_control)
            {
                return Err(MODEL_ERROR.into());
            }
            if revision == catalog["revision"].as_str().unwrap_or_default()
                && !catalog["rankedCandidates"]
                    .as_array()
                    .is_some_and(|entries| {
                        entries.iter().any(|entry| {
                            entry["provider"] == config.provider
                                && entry["modelId"] == choice.model
                                && entry["access"]
                                    == if config.auth == Some(AuthKind::Oauth) {
                                        "oauth"
                                    } else {
                                        "api_key"
                                    }
                        })
                    })
            {
                return Err(MODEL_ERROR.into());
            }
        }
    }
    if let Some(comment) = &settings.comment
        && comment.model != "recommended"
        && comment.thinking != "recommended"
        && comment.thinking != comment_thinking(config, &comment.model)?
    {
        return Err(MODEL_ERROR.into());
    }
    Ok(())
}
fn read_settings(
    storage: &Storage,
    config: &Config,
) -> Result<Option<WorkspaceAiSettings>, String> {
    read_settings_bytes(storage, config)?
        .map(|bytes| {
            let saved: StoredSettings = serde_json::from_slice(&bytes).map_err(|_| MODEL_ERROR)?;
            if saved.settings.version != 1 {
                return Err(MODEL_ERROR.into());
            }
            if saved.connection.association() != config.association() {
                return Ok(WorkspaceAiSettings {
                    version: 1,
                    chat: None,
                    comment: None,
                    generated_comments: saved.settings.generated_comments,
                    show_inline_model: saved.settings.show_inline_model,
                });
            }
            Ok(saved.settings)
        })
        .transpose()
}
fn settings(storage: &Storage, config: &Config) -> Result<WorkspaceAiSettings, String> {
    if let Some(settings) = read_settings(storage, config)? {
        return Ok(settings);
    }
    let chat = selected(storage, config)?.map(|choice| ModelChoice {
        model: choice.model,
        thinking: choice.thinking,
        catalog_revision: choice.catalog_revision,
    });
    Ok(WorkspaceAiSettings {
        version: 1,
        chat,
        comment: None,
        generated_comments: true,
        show_inline_model: false,
    })
}
fn write_settings(
    storage: &Storage,
    config: &Config,
    settings: &WorkspaceAiSettings,
) -> Result<(), String> {
    write_settings_observed(
        storage,
        config,
        settings,
        &discovery::Catalog::static_models(config),
    )
}
fn write_settings_observed(
    storage: &Storage,
    config: &Config,
    settings: &WorkspaceAiSettings,
    observed: &discovery::Catalog,
) -> Result<(), String> {
    validate_settings(config, settings)?;
    let previous = read_settings_bytes(storage, config)?
        .map(|bytes| serde_json::from_slice::<StoredSettings>(&bytes).map_err(|_| MODEL_ERROR))
        .transpose()?;
    let previous = previous.filter(|saved| saved.connection.association() == config.association());
    let mut thinking_by_model = previous
        .as_ref()
        .map(|saved| saved.thinking_by_model.clone())
        .unwrap_or_default();
    let mut settings = settings.clone();
    if let Some(choice) = &mut settings.chat {
        let concrete = if choice.model == "recommended" {
            recommendation(config, observed, "chat")
                .ok()
                .map(|choice| choice.model)
        } else {
            Some(choice.model.clone())
        };
        if let Some(concrete) = concrete {
            let changed_model = previous
                .as_ref()
                .and_then(|saved| saved.settings.chat.as_ref())
                .is_some_and(|old| old.model != choice.model);
            if changed_model
                && choice.thinking == "recommended"
                && let Some(thinking) = thinking_by_model.get(&concrete)
            {
                choice.thinking = thinking.clone();
            }
            if choice.thinking != "recommended" {
                validate_thinking(config, &concrete, &choice.thinking)?;
            }
            thinking_by_model.insert(concrete, choice.thinking.clone());
        } else if choice.thinking != "recommended" {
            return Err(MODEL_ERROR.into());
        }
    }
    if let Some(comment) = &settings.comment
        && comment.model == "recommended"
        && comment.thinking != "recommended"
    {
        resolve_choice(comment.clone().snapshot(config), observed, "comment")?;
    }
    if thinking_by_model.len() > 1024 {
        return Err(MODEL_ERROR.into());
    }
    let saved = StoredSettings {
        connection: config.association(),
        settings,
        thinking_by_model,
    };
    save_settings_bytes(
        storage,
        config,
        &serde_json::to_vec(&saved).map_err(|_| MODEL_ERROR)?,
    )
}
fn read_settings_bytes(storage: &Storage, config: &Config) -> Result<Option<Vec<u8>>, String> {
    match config.connection_id.as_deref() {
        Some(id) => storage.read_connection_settings(id),
        None => storage.read_settings(),
    }
}
fn save_settings_bytes(storage: &Storage, config: &Config, bytes: &[u8]) -> Result<(), String> {
    match config.connection_id.as_deref() {
        Some(id) => storage.save_connection_settings(id, bytes),
        None => storage.save_settings(bytes),
    }
}
fn ranked_choice(
    config: &Config,
    kind: &str,
    catalog: &Value,
    available: Option<&[Value]>,
) -> Result<Option<ModelChoice>, String> {
    if config.endpoint.is_some() {
        return Ok(None);
    }
    let Some(available) = available else {
        return Ok(None);
    };
    let transports: Value = serde_json::from_str(TRANSPORTS).map_err(|_| MODEL_ERROR)?;
    let access = if config.auth == Some(AuthKind::Oauth) {
        "oauth"
    } else {
        "api_key"
    };
    let mut candidates: Vec<_> = catalog["rankedCandidates"]
        .as_array()
        .ok_or(MODEL_ERROR)?
        .iter()
        .filter(|entry| {
            entry["provider"] == config.provider
                && entry["access"] == access
                && entry["eligibility"] == "supported"
        })
        .collect();
    candidates.sort_by_key(|entry| entry["priority"][kind].as_u64().unwrap_or(u64::MAX));
    for entry in candidates {
        let model = entry["modelId"].as_str().ok_or(MODEL_ERROR)?;
        let Some(available_model) = available.iter().find(|item| {
            item["id"] == model
                && item["provider"] == config.provider
                && item["api"] == entry["api"]
                && item.get("type").is_none_or(|kind| kind == "chat")
                && item["input"]
                    .as_array()
                    .is_some_and(|inputs| inputs.iter().any(|input| input == "text"))
        }) else {
            continue;
        };
        let base = available_model["baseUrl"].as_str().unwrap_or_default();
        if !base.starts_with("https://")
            || base.contains(['{', '}'])
            || available_model["headers"]
                .as_object()
                .is_some_and(|headers| {
                    headers.keys().any(|name| {
                        !transports["modelHeaders"]
                            .as_array()
                            .is_some_and(|allowed| {
                                allowed.iter().any(|header| {
                                    header.as_str() == Some(&name.to_ascii_lowercase())
                                })
                            })
                    })
                })
        {
            continue;
        }
        let Ok((api, _, _)) = target(config, model) else {
            continue;
        };
        if entry["api"] != api {
            continue;
        }
        let levels = supported_thinking_levels(config, model)?;
        let thinking = entry["thinking"].as_str().ok_or(MODEL_ERROR)?;
        if !levels.iter().any(|level| level == thinking)
            || (available_model["reasoning"] == true && levels == ["off"])
        {
            continue;
        }
        return Ok(Some(ModelChoice {
            model: model.into(),
            thinking: if kind == "comment" {
                levels[0].clone()
            } else {
                thinking.into()
            },
            catalog_revision: Some(catalog["revision"].as_str().ok_or(MODEL_ERROR)?.into()),
        }));
    }
    Ok(None)
}
pub(super) fn initialize(
    storage: &Storage,
    config: &Config,
    observed: &discovery::Catalog,
) -> Result<(), String> {
    if read_settings(storage, config)?.is_some() || selected(storage, config)?.is_some() {
        return Ok(());
    }
    let _ = observed;
    let initial = WorkspaceAiSettings {
        version: 1,
        chat: Some(ModelChoice {
            model: "recommended".into(),
            thinking: "recommended".into(),
            catalog_revision: None,
        }),
        comment: Some(ModelChoice {
            model: "recommended".into(),
            thinking: "recommended".into(),
            catalog_revision: None,
        }),
        generated_comments: true,
        show_inline_model: false,
    };
    write_settings(storage, config, &initial)
}
fn recommendation(
    config: &Config,
    observed: &discovery::Catalog,
    kind: &str,
) -> Result<ModelChoice, String> {
    let catalog: Value = serde_json::from_str(RECOMMENDATIONS).map_err(|_| MODEL_ERROR)?;
    let inventory: Value = serde_json::from_str(CATALOG).map_err(|_| MODEL_ERROR)?;
    let available: Vec<Value> = inventory["providers"]
        .as_array()
        .and_then(|providers| {
            providers
                .iter()
                .find(|provider| provider["id"] == config.provider)
        })
        .and_then(|provider| provider["models"].as_array())
        .into_iter()
        .flatten()
        .filter(|model| {
            model["id"]
                .as_str()
                .is_some_and(|id| observed.models.iter().any(|available| available == id))
        })
        .cloned()
        .collect();
    ranked_choice(config, kind, &catalog, Some(&available))?.ok_or_else(|| MODEL_ERROR.into())
}
#[cfg(test)]
#[path = "ai_ranking_tests.rs"]
mod ranking_tests;
#[cfg(test)]
pub(super) fn small_choice(storage: &Storage, config: &Config) -> Result<Option<Choice>, String> {
    small_choice_observed(storage, config, &discovery::Catalog::static_models(config))
}
pub(super) fn small_choice_observed(
    storage: &Storage,
    config: &Config,
    observed: &discovery::Catalog,
) -> Result<Option<Choice>, String> {
    let settings = settings(storage, config)?;
    settings
        .comment
        .map(|choice| resolve_choice(choice.snapshot(config), observed, "comment"))
        .transpose()
}
#[cfg(test)]
pub(super) fn load_current_settings(
    storage: &Storage,
    keys: &impl KeyStore,
) -> Result<WorkspaceAiSettings, String> {
    load_connection_settings(storage, keys, None)
}
pub(super) fn load_connection_settings(
    storage: &Storage,
    keys: &impl KeyStore,
    connection_id: Option<&str>,
) -> Result<WorkspaceAiSettings, String> {
    let bytes = match connection_id {
        Some(id) => storage.load_connection(keys, id)?,
        None => storage.load(keys)?,
    }
    .ok_or("native.ai.access.required")?;
    let connection = decode_connection(&bytes)?;
    initialize(
        storage,
        &connection.config,
        &discovery::catalog(&connection),
    )?;
    settings_for_catalog(
        storage,
        &connection.config,
        &discovery::catalog(&connection),
    )
}
fn settings_for_catalog(
    storage: &Storage,
    config: &Config,
    observed: &discovery::Catalog,
) -> Result<WorkspaceAiSettings, String> {
    let mut current = settings(storage, config)?;
    if let Some(choice) = &mut current.chat
        && choice.model == "recommended"
        && let Ok(resolved) = recommendation(config, observed, "chat")
    {
        choice.thinking = inherited_thinking(storage, config, &resolved.model)?;
    }
    Ok(current)
}
pub(super) fn save_current_settings(
    storage: &Storage,
    connection: &Connection,
    next: WorkspaceAiSettings,
) -> Result<WorkspaceAiSettings, String> {
    let catalog = discovery::catalog(connection);
    let previous = settings_for_catalog(storage, &connection.config, &catalog)?;
    for (choice, changed) in [
        (&next.chat, next.chat != previous.chat),
        (
            &next.comment,
            next.comment != previous.comment
                || (next.generated_comments && !previous.generated_comments),
        ),
    ] {
        if changed
            && let Some(choice) = choice
            && choice.model != "recommended"
        {
            catalog.admits(&choice.model)?;
        }
    }
    write_settings_observed(storage, &connection.config, &next, &catalog)?;
    read_settings(storage, &connection.config)?.ok_or_else(|| MODEL_ERROR.into())
}
#[tauri::command]
pub async fn ai_settings_load(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: Option<String>,
) -> Result<WorkspaceAiSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_preferences(&app, window.label(), &scope, |storage| {
            load_connection_settings(storage, &OsKeys(app.clone()), connection_id.as_deref())
        })
    })
    .await
    .map_err(|_| MODEL_ERROR.to_owned())?
}
#[tauri::command]
pub async fn ai_settings_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    settings: WorkspaceAiSettings,
    connection_id: Option<String>,
) -> Result<WorkspaceAiSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_preferences(&app, window.label(), &scope, |storage| {
            let connection = load_connection_id(storage, &app, connection_id.as_deref())?;
            save_current_settings(storage, &connection, settings)
        })
    })
    .await
    .map_err(|_| MODEL_ERROR.to_owned())?
}
