use super::*;
use crate::agent_e2e::bootstrap_step;

pub(crate) fn snapshot_storage(
    app: &tauri::AppHandle,
    location: &situate_core::workspaces::Location,
) -> Result<Storage, String> {
    storage(app, location)
}

pub(crate) fn configure(
    app: &tauri::AppHandle,
    location: &situate_core::workspaces::Location,
    model_id: &str,
    token: &str,
    first_launch: bool,
) -> Result<(), String> {
    bootstrap_step("bootstrap-ai-storage");
    let storage = storage(app, location)?;
    let config = if first_launch {
        Config {
            connection_id: None,
            label: None,
            http_acknowledgement: None,
            auth: Some(AuthKind::ApiKey),
            provider: "openai".into(),
            legacy_model: None,
            endpoint: None,
        }
    } else {
        serde_json::from_value(storage.selected_connection()?.ok_or(KEY_ERROR)?.config)
            .map_err(|_| KEY_ERROR)?
    };
    bootstrap_step("bootstrap-provider-config");
    model::validate_config(&config)?;
    let (api, _, _) = target(&config, model_id)?;
    if api != "openai-responses" {
        return Err(NETWORK_ERROR.into());
    }
    bootstrap_step("bootstrap-credential-lock");
    let _lock = storage.lock_credentials()?;
    let (config, replacing) = if first_launch {
        connections::prepare_config(&storage, config)?
    } else {
        (config, true)
    };
    if first_launch {
        let connection = Connection {
            catalog: None,
            config: config.clone(),
            key: token.into(),
            oauth: None,
            codex: None,
        };
        bootstrap_step("bootstrap-credential-save");
        connections::save(&storage, app, &connection, replacing)?;
    }
    bootstrap_step("bootstrap-credential-read");
    let restored = load(&storage, app)?;
    if restored.key != token || restored.config != config {
        return Err(KEY_ERROR.into());
    }
    if first_launch {
        let thinking = if model_id == "gpt-4.1-mini" {
            "off"
        } else {
            "medium"
        };
        bootstrap_step("bootstrap-settings-save");
        storage.save_connection_settings(
            config.connection_id.as_deref().ok_or(KEY_ERROR)?,
            &serde_json::to_vec(&serde_json::json!({
                "connection": config,
                "settings": {
                    "version": 1,
                    "chat": { "model": model_id, "thinking": thinking, "catalogRevision": null },
                    "comment": null,
                    "generatedComments": false,
                    "showInlineModel": false
                },
                "thinking_by_model": { (model_id): thinking }
            }))
            .map_err(|_| KEY_ERROR)?,
        )?;
        bootstrap_step("bootstrap-conversations");
        storage.list_conversations()?;
    }
    bootstrap_step("bootstrap-model-validate");
    let choice = model::required(&storage, &config)?;
    model::validate_snapshot(&choice, &config)?;
    Ok(())
}
