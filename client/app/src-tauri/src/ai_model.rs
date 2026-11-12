use super::*;
#[cfg(test)]
use crate::conversation_fixtures::FixtureConversations;

const MODEL_ERROR: &str = "native.ai.model.savedUnavailable";
const CHOOSE: &str = "native.ai.model.required";
include!("ai_settings.rs");

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Choice {
    version: u8,
    pub(super) connection: Config,
    pub(super) model: String,
    #[serde(default = "off")]
    pub(super) thinking: String,
    #[serde(default)]
    pub(super) catalog_revision: Option<String>,
}
fn off() -> String {
    "off".into()
}
impl Config {
    pub(super) fn association(&self) -> Self {
        let mut config = self.clone();
        config.legacy_model = None;
        config.label = None;
        config.auth = Some(config.auth.unwrap_or(AuthKind::ApiKey));
        config
    }
    pub(super) fn public(&self) -> Self {
        let mut config = self.clone();
        config.legacy_model = None;
        config
    }
}
pub(super) fn validate_config(config: &Config) -> Result<(), String> {
    admit_method(config)?;
    if config.provider == "custom" {
        if config.auth == Some(AuthKind::Oauth) {
            return Err("native.ai.login.openaiOnly".into());
        }
        validate_endpoint(
            config
                .endpoint
                .as_deref()
                .ok_or("native.ai.endpoint.required")?,
        )?;
        return Ok(());
    }
    if config.endpoint.is_some() {
        return Err("native.ai.endpoint.builtinFixed".into());
    }
    if config.auth == Some(AuthKind::Oauth)
        && !matches!(config.provider.as_str(), "openai" | "openai-codex")
    {
        return Err("native.ai.provider.authenticationUnavailable".into());
    }
    let catalog: Value = serde_json::from_str(CATALOG).map_err(|_| NETWORK_ERROR)?;
    let provider = catalog["providers"]
        .as_array()
        .and_then(|providers| {
            providers
                .iter()
                .find(|provider| provider["id"] == config.provider)
        })
        .ok_or("native.ai.provider.choose")?;
    let method = if config.auth == Some(AuthKind::Oauth) {
        "oauth"
    } else {
        "api_key"
    };
    if !provider["methods"]
        .as_array()
        .is_some_and(|methods| methods.iter().any(|entry| entry["id"] == method))
    {
        return Err("native.ai.provider.authenticationUnavailable".into());
    }
    if !provider["models"].as_array().is_some_and(|models| {
        models.iter().any(|entry| {
            entry["id"]
                .as_str()
                .is_some_and(|id| target(config, id).is_ok())
        })
    }) {
        return Err("native.ai.model.noneCompatible".into());
    }
    Ok(())
}
fn selected(storage: &Storage, config: &Config) -> Result<Option<Choice>, String> {
    if let Some(settings) = read_settings(storage, config)? {
        return Ok(settings.chat.map(|choice| choice.snapshot(config)));
    }
    let metadata = match config.connection_id.as_deref() {
        Some(id) => storage.read_connection_model(id),
        None => storage.read_model(),
    };
    let model = match metadata.map_err(|_| MODEL_ERROR)? {
        Some(bytes) => {
            let saved: Choice = serde_json::from_slice(&bytes).map_err(|_| MODEL_ERROR)?;
            if saved.version != 1 || saved.connection.legacy_model.is_some() {
                return Err(MODEL_ERROR.into());
            }
            if saved.connection.association() != config.association() {
                return Ok(None);
            }
            Some(saved.model)
        }
        None => config.legacy_model.clone(),
    };
    model
        .map(|model| {
            if model.trim().is_empty() || model.len() > 256 || model.chars().any(char::is_control) {
                return Err(MODEL_ERROR.into());
            }
            Ok(Choice {
                version: 1,
                connection: config.association(),
                thinking: default_thinking(config, &model).unwrap_or_else(|_| off()),
                catalog_revision: None,
                model,
            })
        })
        .transpose()
}
include!("ai_preferences.rs");
#[cfg(any(test, feature = "native-smoke"))]
pub(super) fn required(storage: &Storage, config: &Config) -> Result<Choice, String> {
    workspace_choice(storage, config, &discovery::Catalog::static_models(config))
}
pub(super) fn resolve_choice(
    mut choice: Choice,
    observed: &discovery::Catalog,
    kind: &str,
) -> Result<Choice, String> {
    if choice.model == "recommended" {
        let resolved = recommendation(&choice.connection, observed, kind)?;
        choice.model = resolved.model;
        choice.catalog_revision = resolved.catalog_revision;
        if choice.thinking == "recommended" {
            choice.thinking = resolved.thinking;
        }
    }
    if choice.thinking == "recommended" {
        choice.thinking = if kind == "comment" {
            comment_thinking(&choice.connection, &choice.model)?
        } else {
            default_thinking(&choice.connection, &choice.model)?
        };
    }
    target(&choice.connection, &choice.model).map_err(|_| MODEL_ERROR)?;
    validate_thinking(&choice.connection, &choice.model, &choice.thinking)?;
    if kind == "comment" && choice.thinking != comment_thinking(&choice.connection, &choice.model)?
    {
        return Err(MODEL_ERROR.into());
    }
    observed.admits(&choice.model)?;
    Ok(choice)
}
pub(super) fn validate_snapshot(choice: &Choice, config: &Config) -> Result<(), String> {
    if choice.connection != config.association() {
        return Err("native.ai.access.changedDuringTurn".into());
    }
    target(config, &choice.model)?;
    validate_thinking(config, &choice.model, &choice.thinking)?;
    Ok(())
}
pub(super) fn validate_payload(choice: &Choice, payload: &Value) -> Result<(), String> {
    if payload["model"] != choice.model {
        return Err("native.ai.model.requestMismatch".into());
    }
    if payload["stream"] != true
        || payload.get("tools").is_some_and(|tools| {
            tools.as_array().is_none_or(|tools| {
                tools.len() > 128
                    || tools.iter().any(|tool| {
                        let function = tool.get("function").unwrap_or(tool);
                        !function
                            .get("name")
                            .and_then(Value::as_str)
                            .is_some_and(|name| {
                                !name.is_empty()
                                    && name.len() <= 128
                                    && name.bytes().all(|byte| {
                                        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
                                    })
                            })
                            || !function
                                .get("parameters")
                                .or_else(|| function.get("input_schema"))
                                .is_some_and(Value::is_object)
                    })
            })
        })
    {
        return Err("native.ai.request.streamingOnly".into());
    }
    let descriptor = super::native_model::descriptor(choice)?;
    let (api, _, _) = target(&choice.connection, &choice.model)?;
    let maximum = payload
        .get("max_output_tokens")
        .or_else(|| payload.get("max_completion_tokens"))
        .or_else(|| payload.get("max_tokens"))
        .map(|value| value.as_u64().ok_or(MODEL_ERROR))
        .transpose()?;
    let expected =
        crate::ai_protocol::build_request(&api, &descriptor, &choice.thinking, &[], &[], maximum)?
            .body;
    for key in [
        "reasoning_effort",
        "thinking",
        "generationConfig",
        "output_config",
    ] {
        if payload.get(key) != expected.get(key) {
            return Err("native.ai.model.requestMismatch".into());
        }
    }
    match (payload.get("reasoning"), expected.get("reasoning")) {
        (None, None) => {}
        (Some(actual), Some(expected))
            if actual.is_object()
                && actual["effort"] == expected["effort"]
                && actual.as_object().is_some_and(|object| {
                    object
                        .keys()
                        .all(|key| matches!(key.as_str(), "effort" | "summary"))
                })
                && actual
                    .get("summary")
                    .is_none_or(|summary| Some(summary) == expected.get("summary")) => {}
        _ => return Err("native.ai.model.requestMismatch".into()),
    }
    if payload.get("store").is_some_and(|store| store != false)
        || api == "openai-codex-responses"
            && (payload["store"] != false || payload.get("max_output_tokens").is_some())
        || api == "openai-responses"
            && descriptor["compat"]["supportsMaxOutputTokens"] == false
            && payload.get("max_output_tokens").is_some()
    {
        return Err("native.ai.model.requestMismatch".into());
    }
    let expected_inline = expected["messages"]
        .as_array()
        .and_then(|messages| messages.last())
        .filter(|message| message.get("output_config").is_some());
    let actual_inline = payload["messages"]
        .as_array()
        .and_then(|messages| messages.last())
        .filter(|message| message.get("output_config").is_some());
    if actual_inline != expected_inline
        || payload["messages"].as_array().is_some_and(|messages| {
            messages
                .iter()
                .take(messages.len().saturating_sub(1))
                .any(|message| message.get("output_config").is_some())
        })
    {
        return Err("native.ai.model.requestMismatch".into());
    }
    Ok(())
}
pub(super) fn status(storage: &Storage, config: &Config, rejected: bool) -> Status {
    let (selected_model, model_error) = match selected(storage, config) {
        Ok(Some(choice)) => {
            let error = target(config, &choice.model)
                .err()
                .map(|_| MODEL_ERROR.to_owned());
            (Some(choice.model), error)
        }
        Ok(None) => (None, None),
        Err(error) => (None, Some(error)),
    };
    Status {
        catalog: discovery::Catalog::default(),
        config: Some(config.public()),
        available: !rejected,
        reason: rejected.then(|| REJECTED.into()),
        selected_model,
        model_error,
        model_preference: None,
        model_inherited: true,
        thinking_inherited: true,
        thinking_preference: None,
        thinking_level: None,
        inherited_thinking_level: None,
        recommended_thinking_level: None,
    }
}
pub(super) fn resolve_status(storage: &Storage, config: &Config, mut status: Status) -> Status {
    match selected(storage, config).and_then(|choice| {
        choice
            .map(|choice| {
                status.model_preference = Some(choice.model);
                workspace_choice(storage, config, &status.catalog)
            })
            .transpose()
    }) {
        Ok(Some(choice)) => {
            status.thinking_preference = inherited_thinking(storage, config, &choice.model).ok();
            status.selected_model = Some(choice.model);
            status.thinking_level = Some(choice.thinking);
            status.model_error = None;
        }
        Ok(None) => (),
        Err(error) => {
            status.model_error = Some(error);
            if status.selected_model.as_deref() == Some("recommended") {
                status.selected_model = None;
            }
        }
    }
    status
}
pub(super) fn save(storage: &Storage, config: &Config, model: String) -> Result<Status, String> {
    if model != "recommended" {
        target(config, &model)?;
    }
    let mut settings = match settings(storage, config) {
        Ok(settings) => settings,
        Err(error) => {
            if match config.connection_id.as_deref() {
                Some(id) => storage.read_connection_settings(id)?,
                None => storage.read_settings()?,
            }
            .is_some()
            {
                return Err(error);
            }
            WorkspaceAiSettings {
                version: 1,
                chat: None,
                comment: None,
                generated_comments: true,
                show_inline_model: false,
            }
        }
    };
    settings.chat = Some(ModelChoice {
        thinking: "recommended".into(),
        model,
        catalog_revision: None,
    });
    write_settings(storage, config, &settings)?;
    Ok(status(storage, config, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn legacy_azure_connections_and_model_choices_keep_their_association() {
        let connection: Connection = serde_json::from_value(json!({
            "config":{"provider":"azure-openai-responses","model":"deployment","endpoint":null},
            "key":"synthetic"
        }))
        .unwrap();
        let (directory, storage) = workspace();
        let stored = serde_json::to_vec(&json!({
            "version":1,"connection":{"provider":"azure-openai-responses","endpoint":null},
            "model":"chosen-deployment","thinking":"off"
        }))
        .unwrap();
        let path = directory.path().join(".situate/chat-model.json");
        std::fs::write(&path, &stored).unwrap();
        assert_eq!(connection.config.provider, "azure");
        assert_eq!(
            connection.config.legacy_model.as_deref(),
            Some("deployment")
        );
        let restored = selected(&storage, &connection.config).unwrap().unwrap();
        assert!(restored.connection == connection.config.association());
        assert_eq!(restored.model, "chosen-deployment");
        assert_eq!(std::fs::read(&path).unwrap(), stored);
        assert_eq!(
            serde_json::to_value(&connection).unwrap()["config"]["provider"],
            "azure"
        );
        assert!(required(&storage, &connection.config).is_err());
    }

    fn config(provider: &str, auth: Option<AuthKind>) -> Config {
        Config {
            provider: provider.into(),
            connection_id: None,
            label: None,
            http_acknowledgement: None,
            auth,
            endpoint: None,
            legacy_model: None,
        }
    }
    fn workspace() -> (tempfile::TempDir, Storage) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "workspace").unwrap();
        (directory, storage)
    }
    #[test]
    fn fresh_api_and_oauth_connections_are_valid_without_any_model_and_do_not_choose_one() {
        let (_directory, storage) = workspace();
        for auth in [None, Some(AuthKind::ApiKey), Some(AuthKind::Oauth)] {
            let config = config("openai", auth);
            validate_config(&config).unwrap();
            assert!(required(&storage, &config).is_err());
            let status = status(&storage, &config, false);
            assert!(status.available);
            assert!(status.selected_model.is_none());
            assert!(status.model_error.is_none());
            assert!(
                serde_json::to_value(&status).unwrap()["config"]
                    .get("model")
                    .is_none()
            );
        }
        assert!(validate_config(&config("anthropic", Some(AuthKind::Oauth))).is_err());
        let codex = config("openai-codex", Some(AuthKind::Oauth));
        assert_eq!(
            validate_config(&codex).is_ok(),
            admit_method(&codex).is_ok()
        );
        assert!(validate_config(&config("missing-provider", None)).is_err());
    }
    #[test]
    fn deferred_provider_methods_cannot_configure_or_dispatch_catalog_models() {
        for (provider, auth, model) in [
            ("groq", AuthKind::ApiKey, "llama-3.3-70b-versatile"), // gitleaks:allow -- public model ID
            ("deepseek", AuthKind::ApiKey, "deepseek-flash"),
            ("openrouter", AuthKind::Oauth, "openai/gpt-4o-mini"),
            ("anthropic", AuthKind::Oauth, "claude-haiku-4-5"),
        ] {
            let config = config(provider, Some(auth));
            assert!(validate_config(&config).is_err(), "{provider}");
            assert!(target(&config, model).is_err(), "{provider}");
        }
    }
    #[test]
    fn selected_key_methods_and_custom_endpoints_retain_native_admission() {
        for (provider, model) in [
            ("openai", "gpt-4o-mini"),
            ("anthropic", "claude-haiku-4-5"),
            ("openrouter", "openai/gpt-4o-mini"),
        ] {
            let config = config(provider, Some(AuthKind::ApiKey));
            validate_config(&config).unwrap();
            target(&config, model).unwrap();
        }
        let mut custom = config("custom", None);
        custom.endpoint = Some("http://localhost:8888/v1".into());
        validate_config(&custom).unwrap();
        target(&custom, "local-chat").unwrap();
    }
    #[test]
    fn explicit_model_changes_survive_reopen_and_preserve_chat_and_encrypted_connection() {
        let (directory, storage) = workspace();
        let path = directory.path().canonicalize().unwrap();
        let config = config("openai", Some(AuthKind::Oauth));
        let connection_path = path.join(".situate/ai-connection.json");
        // Model storage must never inspect, replace or migrate the credential envelope.
        std::fs::write(&connection_path, b"opaque encrypted envelope").unwrap();
        let history = br#"[{"content":"First message","role":"user","timestamp":1}]"#;
        let mut record = storage.create_conversation("chat", "").unwrap();
        record.messages = serde_json::from_slice(history).unwrap();
        let saved = storage.save_fixture_conversation(&record, 0).unwrap();
        let first = save(&storage, &config, "gpt-4o-mini".into()).unwrap();
        assert_eq!(first.selected_model.as_deref(), Some("gpt-4o-mini"));
        let admitted = required(&storage, &config).unwrap();
        let second = save(&storage, &config, "gpt-5.4".into()).unwrap();
        assert_eq!(second.selected_model.as_deref(), Some("gpt-5.4"));
        assert_eq!(admitted.model, "gpt-4o-mini");
        assert!(validate_payload(&admitted, &json!({"model":"gpt-4o-mini","stream":true})).is_ok());
        assert!(validate_payload(&admitted, &json!({"model":"gpt-5.4","stream":true})).is_err());
        let reopened = Storage::open(&path, "workspace").unwrap();
        assert_eq!(required(&reopened, &config).unwrap().model, "gpt-5.4");
        assert_eq!(reopened.read_conversation("chat").unwrap().unwrap(), saved);
        assert_eq!(
            std::fs::read(connection_path).unwrap(),
            b"opaque encrypted envelope"
        );
    }
    #[test]
    fn legacy_model_is_read_only_fallback_and_invalid_metadata_never_falls_back() {
        let (directory, storage) = workspace();
        let connection: Connection = serde_json::from_value(json!({"config":{"provider":"openai","model":"gpt-4o-mini","endpoint":null},"key":"synthetic"})).unwrap();
        assert_eq!(
            required(&storage, &connection.config).unwrap().model,
            "gpt-4o-mini"
        );
        assert!(storage.read_model().unwrap().is_none());
        let path = directory.path().join(".situate/chat-model.json");
        for malformed in [b"{".as_slice(), br#"{"version":2,"connection":{"provider":"openai","endpoint":null},"model":"gpt-5.4"}"#, br#"{"version":1,"connection":{"provider":"openai","endpoint":null},"model":42}"#, br#"{"version":1,"connection":{"provider":"openai","endpoint":null},"model":"invalid\nmodel"}"#] {
            std::fs::write(&path, malformed).unwrap();
            let status = status(&storage, &connection.config, false);
            assert!(status.available);
            assert!(status.selected_model.is_none());
            assert_eq!(status.model_error.as_deref(), Some(MODEL_ERROR));
            assert!(required(&storage, &connection.config).is_err());
        }
        let recovered = save(&storage, &connection.config, "gpt-5.4".into()).unwrap();
        assert_eq!(recovered.selected_model.as_deref(), Some("gpt-5.4"));
        assert!(recovered.model_error.is_none());
        assert_eq!(
            connection.config.legacy_model.as_deref(),
            Some("gpt-4o-mini")
        );
    }
    #[test]
    fn retired_stored_and_legacy_models_remain_visible_but_require_explicit_reselection() {
        for legacy in [false, true] {
            let (_directory, storage) = workspace();
            let mut config = config("openai", None);
            let retired = "retired-model";
            if legacy {
                config.legacy_model = Some(retired.into());
            } else {
                let choice = Choice {
                    version: 1,
                    connection: config.association(),
                    model: retired.into(),
                    thinking: off(),
                    catalog_revision: None,
                };
                storage
                    .save_model(&serde_json::to_vec(&choice).unwrap())
                    .unwrap();
            }
            let before = storage.read_model().unwrap();
            let unavailable = status(&storage, &config, false);
            assert!(unavailable.available);
            assert_eq!(unavailable.selected_model.as_deref(), Some(retired));
            assert_eq!(unavailable.model_error.as_deref(), Some(MODEL_ERROR));
            assert_eq!(
                required(&storage, &config).err().as_deref(),
                Some(MODEL_ERROR)
            );
            assert_eq!(storage.read_model().unwrap(), before);
            let recovered = save(&storage, &config, "gpt-4o-mini".into()).unwrap();
            assert_eq!(recovered.selected_model.as_deref(), Some("gpt-4o-mini"));
            assert!(recovered.model_error.is_none());
            let admitted = required(&storage, &config).unwrap();
            validate_snapshot(&admitted, &config).unwrap();
            assert_eq!(admitted.model, "gpt-4o-mini");
            assert_eq!(config.legacy_model.as_deref(), legacy.then_some(retired));
        }
    }
    #[test]
    fn unavailable_id_from_another_connection_is_not_exposed_or_used_as_legacy_fallback() {
        let (_directory, storage) = workspace();
        let choice = Choice {
            version: 1,
            connection: config("anthropic", None).association(),
            model: "other-retired-model".into(),
            thinking: off(),
            catalog_revision: None,
        };
        storage
            .save_model(&serde_json::to_vec(&choice).unwrap())
            .unwrap();
        let mut current = config("openai", None);
        current.legacy_model = Some("legacy-retired-model".into());
        let status = status(&storage, &current, false);
        assert!(status.selected_model.is_none());
        assert!(status.model_error.is_none());
        assert!(required(&storage, &current).is_err());
        assert!(
            !serde_json::to_string(&status)
                .unwrap()
                .contains("retired-model")
        );
    }
    #[test]
    fn association_rejects_another_provider_auth_endpoint_or_workspace_without_global_fallback() {
        let (_one, storage) = workspace();
        let (_two, other) = workspace();
        let openai = config("openai", None);
        save(&storage, &openai, "gpt-4o-mini".into()).unwrap();
        assert!(required(&other, &openai).is_err());
        assert!(required(&storage, &config("anthropic", None)).is_err());
        assert!(required(&storage, &config("openai", Some(AuthKind::Oauth))).is_err());
        assert_eq!(
            required(&storage, &config("openai", Some(AuthKind::ApiKey)))
                .unwrap()
                .model,
            "gpt-4o-mini"
        );
        let mut custom = config("custom", None);
        custom.endpoint = Some("http://localhost:8888/v1".into());
        validate_config(&custom).unwrap();
        save(&other, &custom, "manual-local-model".into()).unwrap();
        custom.endpoint = Some("http://localhost:8889/v1".into());
        assert!(required(&other, &custom).is_err());
        assert_eq!(required(&storage, &openai).unwrap().model, "gpt-4o-mini");
    }
    #[test]
    fn settings_pin_main_and_comment_snapshots_with_verified_reasoning() {
        let (_directory, storage) = workspace();
        let config = config("openai", Some(AuthKind::Oauth));
        let mut saved = WorkspaceAiSettings {
            version: 1,
            chat: Some(ModelChoice {
                model: "gpt-6.1-sol".into(),
                thinking: "medium".into(),
                catalog_revision: Some("2026-10-05.1".into()),
            }),
            comment: Some(ModelChoice {
                model: "gpt-6.1-sol".into(),
                thinking: "low".into(),
                catalog_revision: None,
            }),
            generated_comments: true,
            show_inline_model: false,
        };
        write_settings(&storage, &config, &saved).unwrap();
        let main = required(&storage, &config).unwrap();
        assert_eq!(main.thinking, "medium");
        assert_eq!(
            small_choice(&storage, &config).unwrap().unwrap().thinking,
            "low"
        );
        saved.chat.as_mut().unwrap().thinking = "high".into();
        write_settings(&storage, &config, &saved).unwrap();
        assert_eq!(main.thinking, "medium");
        assert_eq!(required(&storage, &config).unwrap().thinking, "high");
        save(&storage, &config, "gpt-4o-mini".into()).unwrap();
        save(&storage, &config, "gpt-6.1-sol".into()).unwrap();
        assert_eq!(required(&storage, &config).unwrap().thinking, "high");
        let valid = json!({"model":"gpt-6.1-sol", "stream":true, "reasoning":{"effort":"medium"}, "tools":[{"type":"function","name":"read","parameters":{"type":"object"}}]});
        validate_payload(&main, &valid).unwrap();
        let mut wrong = valid.clone();
        wrong["reasoning"]["effort"] = json!("high");
        assert!(validate_payload(&main, &wrong).is_err());
        saved.chat.as_mut().unwrap().thinking = "xhigh".into();
        assert!(write_settings(&storage, &config, &saved).is_err());
        saved.chat.as_mut().unwrap().thinking = "medium".into();
        saved.comment.as_mut().unwrap().thinking = "medium".into();
        assert!(write_settings(&storage, &config, &saved).is_err());
        saved.comment.as_mut().unwrap().thinking = "low".into();
        saved.generated_comments = false;
        write_settings(&storage, &config, &saved).unwrap();
        assert_eq!(
            small_choice(&storage, &config).unwrap().unwrap().thinking,
            "low"
        );
    }
    #[test]
    fn selected_models_are_validated_against_provider_auth_transport_and_exact_admission() {
        let (_directory, storage) = workspace();
        let openai = config("openai", Some(AuthKind::Oauth));
        for id in ["", "claude-sonnet-4-5", "missing-model", "bad\nmodel"] {
            assert!(save(&storage, &openai, id.into()).is_err());
        }
        assert!(storage.read_model().unwrap().is_none());
        save(&storage, &openai, "gpt-4o-mini".into()).unwrap();
        let choice = required(&storage, &openai).unwrap();
        validate_snapshot(&choice, &openai).unwrap();
        assert!(validate_snapshot(&choice, &config("openai", None)).is_err());
        assert!(validate_snapshot(&choice, &config("anthropic", None)).is_err());
        let mut overridden = openai.clone();
        overridden.endpoint = Some("https://other.invalid/v1".into());
        assert!(validate_snapshot(&choice, &overridden).is_err());
        assert!(save(&storage, &overridden, "gpt-4o-mini".into()).is_err());
        for payload in [
            json!({"model":"gpt-5.4","stream":true}),
            json!({"model":"gpt-4o-mini","stream":false}),
            json!({"model":"gpt-4o-mini","stream":true,"tools":[{}]}),
        ] {
            assert!(validate_payload(&choice, &payload).is_err());
        }
        assert_eq!(required(&storage, &openai).unwrap().model, "gpt-4o-mini");
    }
}
