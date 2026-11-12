#[cfg(test)]
#[path = "ai_preferences_tests.rs"]
mod preference_tests;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConversationPreferences {
    model: Option<ModelOverride>,
    #[serde(default)]
    thinking: std::collections::BTreeMap<String, String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelOverride {
    connection_id: String,
    model: String,
}
fn preferences(storage: &Storage, conversation: &str) -> Result<ConversationPreferences, String> {
    storage
        .read_conversation_preferences(conversation)?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| MODEL_ERROR.into()))
        .unwrap_or_else(|| Ok(ConversationPreferences::default()))
}
fn save_preferences(
    storage: &Storage,
    conversation: &str,
    preferences: &ConversationPreferences,
) -> Result<(), String> {
    storage.save_conversation_preferences(
        conversation,
        &serde_json::to_vec(preferences).map_err(|_| MODEL_ERROR)?,
    )
}
pub(super) fn unavailable_conversation_status(
    storage: &Storage,
    conversation: Option<&str>,
    reason: Option<String>,
) -> Result<Status, String> {
    let mut status = connections::disconnected(reason);
    if let Some(conversation) = conversation {
        let saved = preferences(storage, conversation)?;
        status.model_inherited = saved.model.is_none();
        status.model_preference = saved.model.map(|saved| saved.model);
    }
    Ok(status)
}
pub(super) fn effective_record(
    storage: &Storage,
    conversation: Option<&str>,
) -> Result<Option<situate_core::ai_storage::connections::Record>, String> {
    if let Some(conversation) = conversation
        && let Some(saved) = preferences(storage, conversation)?.model
    {
        return storage.connection_record(&saved.connection_id).map(Some);
    }
    storage.selected_connection()
}
fn thinking_key(config: &Config, model: &str) -> Result<String, String> {
    Ok(format!(
        "{}:{model}",
        config.connection_id.as_deref().ok_or(MODEL_ERROR)?
    ))
}
fn inherited_thinking(storage: &Storage, config: &Config, model: &str) -> Result<String, String> {
    let stored = read_settings_bytes(storage, config)?
        .map(|bytes| serde_json::from_slice::<StoredSettings>(&bytes).map_err(|_| MODEL_ERROR))
        .transpose()?;
    Ok(stored
        .filter(|saved| saved.connection.association() == config.association())
        .and_then(|saved| saved.thinking_by_model.get(model).cloned())
        .unwrap_or_else(|| "recommended".into()))
}
fn workspace_choice(
    storage: &Storage,
    config: &Config,
    catalog: &discovery::Catalog,
) -> Result<Choice, String> {
    let mut choice = selected(storage, config)?.ok_or(CHOOSE)?;
    if config.connection_id.is_some() {
        choice.thinking = "recommended".into();
        choice = resolve_choice(choice, catalog, "chat")?;
        choice.thinking = inherited_thinking(storage, config, &choice.model)?;
    }
    resolve_choice(choice, catalog, "chat")
}
fn conversation_choice(
    storage: &Storage,
    config: &Config,
    conversation: &str,
    catalog: &discovery::Catalog,
) -> Result<(Choice, bool, bool, String), String> {
    let saved = preferences(storage, conversation)?;
    preference_choice(storage, config, &saved, catalog)
}
fn preference_choice(
    storage: &Storage,
    config: &Config,
    saved: &ConversationPreferences,
    catalog: &discovery::Catalog,
) -> Result<(Choice, bool, bool, String), String> {
    let inherited = saved.model.is_none();
    let mut choice = conversation_model(storage, config, saved.model.as_ref(), catalog)?;
    let explicit = saved
        .thinking
        .get(&thinking_key(config, &choice.model)?)
        .cloned();
    let thinking_inherited = explicit.is_none();
    let preference = explicit.unwrap_or(inherited_thinking(storage, config, &choice.model)?);
    choice.thinking = preference.clone();
    Ok((
        resolve_choice(choice, catalog, "chat")?,
        inherited,
        thinking_inherited,
        preference,
    ))
}
fn conversation_model(
    storage: &Storage,
    config: &Config,
    saved: Option<&ModelOverride>,
    catalog: &discovery::Catalog,
) -> Result<Choice, String> {
    let mut choice = match saved {
        Some(saved) => {
            if config.connection_id.as_deref() != Some(&saved.connection_id) {
                return Err(MODEL_ERROR.into());
            }
            Choice {
                version: 1,
                connection: config.association(),
                model: saved.model.clone(),
                thinking: "recommended".into(),
                catalog_revision: None,
            }
        }
        None => selected(storage, config)?.ok_or(CHOOSE)?,
    };
    choice.thinking = "recommended".into();
    resolve_choice(choice, catalog, "chat")
}
pub(super) fn admit_workspace(
    storage: &Storage,
    connection: &Connection,
) -> Result<Choice, String> {
    workspace_choice(storage, &connection.config, &discovery::catalog(connection))
}

pub(super) fn admit_conversation(
    storage: &Storage,
    connection: &Connection,
    conversation: &str,
) -> Result<Choice, String> {
    conversation_choice(
        storage,
        &connection.config,
        conversation,
        &discovery::catalog(connection),
    )
    .map(|value| value.0)
}
pub(super) fn conversation_status(
    storage: &Storage,
    config: &Config,
    status: Status,
    record: &ConversationRecord,
) -> Status {
    preference_status(storage, config, status, preferences(storage, &record.id))
}
pub(super) fn preview_conversation_status(
    storage: &Storage,
    config: &Config,
    status: Status,
    model: Option<String>,
    thinking: Option<String>,
) -> Status {
    let saved = (|| {
        let mut saved = ConversationPreferences::default();
        if let Some(model) = model {
            saved.model = Some(ModelOverride {
                connection_id: config.connection_id.clone().ok_or(MODEL_ERROR)?,
                model,
            });
        }
        if let Some(thinking) = thinking {
            let choice =
                conversation_model(storage, config, saved.model.as_ref(), &status.catalog)?;
            saved
                .thinking
                .insert(thinking_key(config, &choice.model)?, thinking);
        }
        Ok(saved)
    })();
    preference_status(storage, config, status, saved)
}
fn preference_status(
    storage: &Storage,
    config: &Config,
    mut status: Status,
    saved: Result<ConversationPreferences, String>,
) -> Status {
    let saved = match saved {
        Ok(saved) => saved,
        Err(error) => {
            status.model_error = Some(error);
            return status;
        }
    };
    status.model_inherited = saved.model.is_none();
    if let Some(model) = &saved.model {
        status.model_preference = Some(model.model.clone());
        status.selected_model = (model.model != "recommended").then(|| model.model.clone());
        status.thinking_level = None;
    }
    if let Ok(choice) = conversation_model(storage, config, saved.model.as_ref(), &status.catalog)
        && let Ok(key) = thinking_key(config, &choice.model)
    {
        status.thinking_inherited = !saved.thinking.contains_key(&key);
        status.thinking_preference = saved
            .thinking
            .get(&key)
            .cloned()
            .or_else(|| inherited_thinking(storage, config, &choice.model).ok());
    }
    match preference_choice(storage, config, &saved, &status.catalog) {
        Ok((choice, inherited, thinking_inherited, preference)) => {
            let mut preview = choice.clone();
            preview.thinking = "recommended".into();
            status.recommended_thinking_level = resolve_choice(preview, &status.catalog, "chat")
                .ok()
                .map(|resolved| resolved.thinking);
            status.inherited_thinking_level = inherited_thinking(storage, config, &choice.model)
                .and_then(|preference| {
                    let mut preview = choice.clone();
                    preview.thinking = preference;
                    resolve_choice(preview, &status.catalog, "chat")
                })
                .ok()
                .map(|resolved| resolved.thinking);
            status.selected_model = Some(choice.model);
            status.model_inherited = inherited;
            status.thinking_inherited = thinking_inherited;
            status.thinking_preference = Some(preference);
            status.thinking_level = Some(choice.thinking);
            status.model_error = None;
        }
        Err(error) => {
            status.model_error = Some(error);
        }
    }
    status
}
pub(super) fn select_conversation_model(
    storage: &Storage,
    connection: Option<&Connection>,
    conversation: &str,
    model: Option<String>,
) -> Result<(), String> {
    let mut saved = preferences(storage, conversation)?;
    saved.model = match model {
        Some(model) => {
            let connection = connection.ok_or(CHOOSE)?;
            let config = &connection.config;
            resolve_choice(
                Choice {
                    version: 1,
                    connection: config.association(),
                    model: model.clone(),
                    thinking: "recommended".into(),
                    catalog_revision: None,
                },
                &discovery::catalog(connection),
                "chat",
            )?;
            Some(ModelOverride {
                connection_id: config.connection_id.clone().ok_or(MODEL_ERROR)?,
                model,
            })
        }
        None => None,
    };
    save_preferences(storage, conversation, &saved)
}
pub(super) fn select_conversation_thinking(
    storage: &Storage,
    connection: &Connection,
    conversation: &str,
    thinking: Option<String>,
) -> Result<(), String> {
    let mut saved = preferences(storage, conversation)?;
    let choice = conversation_model(
        storage,
        &connection.config,
        saved.model.as_ref(),
        &discovery::catalog(connection),
    )?;
    if let Some(level) = &thinking
        && level != "recommended"
    {
        validate_thinking(&connection.config, &choice.model, level)?;
    }
    let key = thinking_key(&connection.config, &choice.model)?;
    match thinking {
        Some(level) => {
            saved.thinking.insert(key, level);
        }
        None => {
            saved.thinking.remove(&key);
        }
    }
    save_preferences(storage, conversation, &saved)
}
