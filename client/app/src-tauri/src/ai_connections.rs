use super::*;
#[cfg(test)]
#[path = "ai_connection_tests.rs"]
mod tests;

pub(super) fn disconnected(reason: Option<String>) -> Status {
    Status {
        catalog: discovery::Catalog::default(),
        config: None,
        available: false,
        reason,
        selected_model: None,
        model_error: None,
        model_preference: None,
        model_inherited: true,
        thinking_inherited: true,
        thinking_preference: None,
        thinking_level: None,
        inherited_thinking_level: None,
        recommended_thinking_level: None,
    }
}
fn record_status(
    storage: &Storage,
    app: &tauri::AppHandle,
    record: &situate_core::ai_storage::connections::Record,
    scope: &str,
) -> Result<Status, String> {
    let rejected = app.state::<Ai>().is_rejected(scope, Some(&record.id))?;
    let config: Config =
        serde_json::from_value(record.config.clone()).map_err(|_| "native.ai.storage.invalid")?;
    let mut status = model::status(storage, &config, rejected);
    if storage
        .conflicting_connection_publication()?
        .is_some_and(|pending| pending.id == record.id)
    {
        status.available = false;
        status.reason = Some("native.ai.storage.publicationConflict".into());
        return Ok(status);
    }
    let available = model::validate_config(&config).and_then(|()| {
        let bytes = storage
            .load_connection(&OsKeys(app.clone()), &record.id)?
            .ok_or_else(|| "native.ai.access.required".to_owned())?;
        decode_connection(&bytes)
    });
    match available {
        Ok(connection) => status = discovery::status(storage, &connection, rejected),
        Err(reason) => {
            status.available = false;
            status.reason = Some(reason);
        }
    }
    Ok(status)
}
#[tauri::command]
pub async fn ai_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    conversation: Option<String>,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_current(&app, window.label(), &scope, |location| {
            let storage = match storage(&app, location) {
                Ok(storage) => storage,
                Err(reason) => return Ok(disconnected(Some(reason))),
            };
            let record = match model::effective_record(&storage, conversation.as_deref()) {
                Ok(record) => record,
                Err(reason) => {
                    return model::unavailable_conversation_status(
                        &storage,
                        conversation.as_deref(),
                        Some(reason),
                    );
                }
            };
            let Some(record) = record else {
                return model::unavailable_conversation_status(
                    &storage,
                    conversation.as_deref(),
                    None,
                );
            };
            let status = record_status(&storage, &app, &record, &scope)?;
            if let Some(id) = conversation.as_deref() {
                let conversation = require_conversation(&storage, id)?;
                let config: Config = serde_json::from_value(record.config)
                    .map_err(|_| "native.ai.storage.invalid")?;
                Ok(model::conversation_status(
                    &storage,
                    &config,
                    status,
                    &conversation,
                ))
            } else {
                Ok(status)
            }
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
#[tauri::command]
pub async fn ai_preview_conversation_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    model: Option<String>,
    thinking: Option<String>,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_current(&app, window.label(), &scope, |location| {
            let storage = match unrecovered_storage(&app, location) {
                Ok(storage) => storage,
                Err(reason) => return Ok(disconnected(Some(reason))),
            };
            let record = match model::effective_record(&storage, None) {
                Ok(Some(record)) => record,
                Ok(None) => return Ok(disconnected(None)),
                Err(reason) => return Ok(disconnected(Some(reason))),
            };
            let status = record_status(&storage, &app, &record, &scope)?;
            let config: Config =
                serde_json::from_value(record.config).map_err(|_| "native.ai.storage.invalid")?;
            Ok(model::preview_conversation_status(
                &storage, &config, status, model, thinking,
            ))
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
#[tauri::command]
pub async fn ai_connections(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<Vec<Status>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let location =
            crate::workspaces::with_current(&app, window.label(), &scope, |l| Ok(l.clone()))?;
        let storage = storage(&app, &location)?;
        let Some(mut manifest) = storage.connection_manifest()? else {
            return Ok(vec![]);
        };
        if let Some(pending) = storage.conflicting_connection_publication()?
            && !manifest.connections.iter().any(|r| r.id == pending.id)
        {
            manifest.connections.push(pending);
        }
        manifest
            .connections
            .iter()
            .map(|r| record_status(&storage, &app, r, &scope))
            .collect()
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
#[tauri::command]
pub async fn ai_select_connection(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: String,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_connection(&app, window.label(), &scope, |storage| {
            storage.select_connection(&connection_id)?;
            record_status(
                storage,
                &app,
                &storage.connection_record(&connection_id)?,
                &scope,
            )
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
#[tauri::command]
pub async fn ai_forget_connection(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: String,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_connection(&app, window.label(), &scope, |storage| {
            storage.forget_connection(&OsKeys(app.clone()), &connection_id)?;
            match storage
                .connection_manifest()?
                .and_then(|m| m.connections.into_iter().find(|r| r.id == connection_id))
            {
                Some(record) => record_status(storage, &app, &record, &scope),
                None => Ok(disconnected(None)),
            }
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
pub(super) fn prepare_config(
    storage: &Storage,
    mut config: Config,
) -> Result<(Config, bool), String> {
    let replacing = config.connection_id.is_some();
    if let Some(id) = &config.connection_id {
        let previous: Config = serde_json::from_value(storage.connection_record(id)?.config)
            .map_err(|_| "native.ai.storage.invalid")?;
        if previous.provider != config.provider
            || previous.auth.unwrap_or(AuthKind::ApiKey) != config.auth.unwrap_or(AuthKind::ApiKey)
        {
            return Err("native.ai.connection.methodMismatch".into());
        }
    } else {
        config.connection_id = Some(Storage::new_connection_id());
    }
    let records = storage
        .connection_manifest()?
        .map(|m| m.connections)
        .unwrap_or_default();
    if config.label.is_none() {
        let base = config.provider.clone();
        let mut label = base.clone();
        let mut suffix = 2;
        while records.iter().any(|r| {
            r.config["label"]
                .as_str()
                .is_some_and(|existing| existing.eq_ignore_ascii_case(&label))
        }) {
            label = format!("{base} {suffix}");
            suffix += 1;
        }
        config.label = Some(label);
    }
    config.label = config.label.map(|label| label.trim().to_owned());
    if records.iter().any(|r| {
        Some(&r.id) != config.connection_id.as_ref()
            && r.config["label"]
                .as_str()
                .zip(config.label.as_deref())
                .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
    }) {
        return Err("native.ai.connection.labelInvalid".into());
    }
    if config.label.as_ref().is_some_and(|label| {
        label.trim().is_empty() || label.len() > 256 || label.chars().any(char::is_control)
    }) {
        return Err("native.ai.connection.labelInvalid".into());
    }
    if let Some(endpoint) = &config.endpoint {
        validate_http_consent(&config, endpoint, true)?;
    }
    Ok((config, replacing))
}
#[tauri::command]
pub async fn ai_rename_connection(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: String,
    label: String,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_connection(&app, window.label(), &scope, |storage| {
            storage.rename_connection(&OsKeys(app.clone()), &connection_id, &label)?;
            record_status(
                storage,
                &app,
                &storage.connection_record(&connection_id)?,
                &scope,
            )
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
fn conversation_status(
    storage: &Storage,
    app: &tauri::AppHandle,
    scope: &str,
    conversation: &str,
) -> Result<Status, String> {
    let record = require_conversation(storage, conversation)?;
    let effective = match model::effective_record(storage, Some(conversation)) {
        Ok(Some(record)) => record,
        Ok(None) => {
            return model::unavailable_conversation_status(storage, Some(conversation), None);
        }
        Err(reason) => {
            return model::unavailable_conversation_status(
                storage,
                Some(conversation),
                Some(reason),
            );
        }
    };
    let config: Config = serde_json::from_value(effective.config.clone()).map_err(|_| KEY_ERROR)?;
    let status = record_status(storage, app, &effective, scope)?;
    Ok(model::conversation_status(
        storage, &config, status, &record,
    ))
}
fn persist_conversation_preferences<T>(
    app: &tauri::AppHandle,
    window: &str,
    authorization: &crate::workspaces::AuthorizationSession,
    operation: impl FnOnce(&Storage) -> Result<T, String>,
) -> Result<T, String> {
    crate::workspaces::with_retained_session(app, window, authorization, |location| {
        let storage = unrecovered_storage(app, location)?;
        let _preferences = storage.lock_preferences()?;
        operation(&storage)
    })
}

#[tauri::command]
pub async fn ai_select_conversation_model(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    conversation: String,
    model: Option<String>,
) -> Result<Status, String> {
    let authorization =
        crate::workspaces::storage_authorization_session(&app, window.label(), &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        persist_conversation_preferences(&app, window.label(), &authorization, |storage| {
            require_conversation(storage, &conversation)?;
            let connection = if model.is_some() {
                Some(load_conversation(storage, &app, &conversation)?)
            } else {
                None
            };
            model::select_conversation_model(storage, connection.as_ref(), &conversation, model)?;
            conversation_status(storage, &app, &scope, &conversation)
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
#[tauri::command]
pub async fn ai_select_conversation_thinking(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    conversation: String,
    thinking: Option<String>,
) -> Result<Status, String> {
    let authorization =
        crate::workspaces::storage_authorization_session(&app, window.label(), &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        persist_conversation_preferences(&app, window.label(), &authorization, |storage| {
            require_conversation(storage, &conversation)?;
            let connection = load_conversation(storage, &app, &conversation)?;
            model::select_conversation_thinking(storage, &connection, &conversation, thinking)?;
            conversation_status(storage, &app, &scope, &conversation)
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
pub(super) fn save(
    storage: &Storage,
    app: &tauri::AppHandle,
    connection: &Connection,
    replacing: bool,
) -> Result<(), String> {
    storage.save_connection(
        &OsKeys(app.clone()),
        connection
            .config
            .connection_id
            .as_deref()
            .ok_or(KEY_ERROR)?,
        serde_json::to_value(&connection.config).map_err(|_| KEY_ERROR)?,
        &serde_json::to_vec(connection).map_err(|_| KEY_ERROR)?,
        replacing,
    )
}
