use super::*;
use serde_json::json;

fn config() -> Config {
    serde_json::from_value(json!({"provider": "openai", "endpoint": null})).unwrap()
}
fn workspace() -> (tempfile::TempDir, Storage) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap();
    std::fs::create_dir(path.join(".situate")).unwrap();
    let content = path.join("content");
    let device = path.join("device");
    std::fs::create_dir_all(content.join(".situate")).unwrap();
    std::fs::create_dir(&device).unwrap();
    let storage = Storage::open(&content, "workspace")
        .unwrap()
        .with_device_store(&device)
        .unwrap();
    (directory, storage)
}
fn synthetic_catalog() -> Value {
    json!({"revision": "synthetic.1", "rankedCandidates": [
        {"provider": "openai", "access": "api_key", "modelId": "gpt-4o-mini",
         "api": "openai-responses", "thinking": "off", "eligibility": "supported",
         "priority": {"chat": 20, "comment": 5}},
        {"provider": "openai", "access": "api_key", "modelId": "gpt-6.1-sol",
         "api": "openai-responses", "thinking": "medium", "eligibility": "supported",
         "priority": {"chat": 10, "comment": 10}}
    ]})
}
fn models() -> Vec<Value> {
    let inventory: Value = serde_json::from_str(CATALOG).unwrap();
    inventory["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|provider| provider["id"] == "openai")
        .unwrap()["models"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|model| model["id"] == "gpt-6.1-sol" || model["id"] == "gpt-4o-mini")
        .cloned()
        .collect()
}
#[test]
fn account_catalogs_and_independent_function_priorities_determine_choices() {
    let config = config();
    let catalog = synthetic_catalog();
    let mut both = models();
    let mini: Vec<_> = both
        .iter()
        .filter(|model| model["id"] == "gpt-4o-mini")
        .cloned()
        .collect();
    assert_eq!(
        ranked_choice(&config, "chat", &catalog, Some(&both))
            .unwrap()
            .unwrap()
            .model,
        "gpt-6.1-sol"
    );
    assert_eq!(
        ranked_choice(&config, "chat", &catalog, Some(&mini))
            .unwrap()
            .unwrap()
            .model,
        "gpt-4o-mini"
    );
    assert_eq!(
        ranked_choice(&config, "comment", &catalog, Some(&both))
            .unwrap()
            .unwrap()
            .model,
        "gpt-4o-mini"
    );
    both.reverse();
    let mut reordered = catalog.clone();
    reordered["rankedCandidates"]
        .as_array_mut()
        .unwrap()
        .reverse();
    assert_eq!(
        ranked_choice(&config, "chat", &reordered, Some(&both))
            .unwrap()
            .unwrap()
            .model,
        "gpt-6.1-sol"
    );
    assert!(
        ranked_choice(&config, "chat", &catalog, None)
            .unwrap()
            .is_none()
    );
    assert!(
        ranked_choice(&config, "chat", &catalog, Some(&[]))
            .unwrap()
            .is_none()
    );
}
#[test]
fn unsuitable_higher_priority_and_unranked_results_are_not_selected() {
    let config = config();
    for patch in [
        json!({"input": []}),
        json!({"type": "classifier"}),
        json!({"api": "unsupported"}),
    ] {
        let mut available = models();
        available
            .iter_mut()
            .find(|model| model["id"] == "gpt-6.1-sol")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert_eq!(
            ranked_choice(&config, "chat", &synthetic_catalog(), Some(&available))
                .unwrap()
                .unwrap()
                .model,
            "gpt-4o-mini"
        );
    }
    let mut unranked = models();
    for model in &mut unranked {
        model["id"] = json!("newly-discovered");
    }
    assert!(
        ranked_choice(&config, "chat", &synthetic_catalog(), Some(&unranked))
            .unwrap()
            .is_none()
    );
}
#[test]
fn openai_recommends_sol_62_only_with_qualified_discovery_and_only_for_chat() {
    for (auth, source, comment) in [
        (AuthKind::ApiKey, discovery::Source::Provider, "gpt-4o-mini"),
        (AuthKind::Oauth, discovery::Source::Account, "gpt-6.1-sol"),
    ] {
        let mut config = config();
        config.auth = Some(auth);
        let mut observed = discovery::Catalog {
            source,
            models: vec![
                "gpt-6.2-sol".into(),
                "gpt-6.1-sol".into(),
                "gpt-4o-mini".into(),
            ],
            checked_at: None,
            selectable: vec![],
        };
        let recommended = || {
            ModelChoice {
                model: "recommended".into(),
                thinking: "recommended".into(),
                catalog_revision: None,
            }
            .snapshot(&config)
        };
        assert_eq!(
            resolve_choice(recommended(), &observed, "chat").unwrap().model,
            "gpt-6.1-sol"
        );

        observed.selectable.push(discovery::DiscoveredModel {
            id: "gpt-6.2-sol".into(),
            name: None,
            thinking_levels: vec!["low".into(), "medium".into(), "max".into()],
            reasoning_none: false,
            context_window: 1_050_000,
            max_tokens: 128_000,
            image_input: true,
        });
        let chat = resolve_choice(recommended(), &observed, "chat").unwrap();
        assert_eq!(chat.model, "gpt-6.2-sol");
        assert_eq!(chat.thinking, "medium");
        assert_eq!(chat.target().unwrap().0, "openai-responses");
        assert_eq!(
            resolve_choice(recommended(), &observed, "comment")
                .unwrap()
                .model,
            comment
        );

        observed.models.push("gpt-6-luna".into());
        let small = resolve_choice(recommended(), &observed, "comment").unwrap();
        assert_eq!(small.model, "gpt-6-luna");
        assert_eq!(small.thinking, "off");
        observed.models.retain(|id| id != "gpt-6.2-sol");
        assert_eq!(
            resolve_choice(recommended(), &observed, "chat").unwrap().model,
            "gpt-6.1-sol"
        );
    }
}
#[test]
fn initialization_persists_symbolic_choices_without_rewriting_on_reopen() {
    let (directory, storage) = workspace();
    let config = config();
    initialize(
        &storage,
        &config,
        &discovery::Catalog::static_models(&config),
    )
    .unwrap();
    let bytes = read_settings_bytes(&storage, &config).unwrap().unwrap();
    let saved = read_settings(&storage, &config).unwrap().unwrap();
    let chat = saved.chat.unwrap();
    assert_eq!(chat.model, "recommended");
    assert_eq!(chat.thinking, "recommended");
    assert!(chat.catalog_revision.is_none());
    let comment = saved.comment.unwrap();
    assert_eq!(comment.model, "recommended");
    assert_eq!(comment.thinking, "recommended");
    let path = directory.path().canonicalize().unwrap();
    let reopened = Storage::open(&path.join("content"), "workspace")
        .unwrap()
        .with_device_store(&path.join("device"))
        .unwrap();
    initialize(
        &reopened,
        &config,
        &discovery::Catalog::static_models(&config),
    )
    .unwrap();
    assert_eq!(
        read_settings_bytes(&reopened, &config).unwrap().unwrap(),
        bytes
    );
}
#[test]
fn removed_explicit_selection_and_failed_request_do_not_trigger_fallback_or_change_snapshot() {
    let (_directory, storage) = workspace();
    let config = config();
    let saved = json!({"connection": config.association(), "settings": {
        "version": 1, "chat": {"model": "removed-model", "thinking": "off", "catalogRevision": "old.1"},
        "comment": null, "generatedComments": true, "showInlineModel": false
    }});
    let bytes = serde_json::to_vec(&saved).unwrap();
    save_settings_bytes(&storage, &config, &bytes).unwrap();
    let snapshot = selected(&storage, &config).unwrap().unwrap();
    assert!(required(&storage, &config).is_err());
    initialize(
        &storage,
        &config,
        &discovery::Catalog::static_models(&config),
    )
    .unwrap();
    assert_eq!(
        read_settings_bytes(&storage, &config).unwrap().unwrap(),
        bytes
    );
    assert_eq!(snapshot.model, "removed-model");
    assert_eq!(snapshot.catalog_revision.as_deref(), Some("old.1"));
}
#[test]
fn same_provider_connections_keep_independent_explicit_settings() {
    let (_directory, storage) = workspace();
    let mut first = config();
    first.connection_id = Some(Storage::new_connection_id());
    let mut second = config();
    second.connection_id = Some(Storage::new_connection_id());
    let explicit = WorkspaceAiSettings {
        version: 1,
        chat: Some(ModelChoice {
            model: "gpt-4o-mini".into(),
            thinking: "off".into(),
            catalog_revision: None,
        }),
        comment: None,
        generated_comments: false,
        show_inline_model: true,
    };
    write_settings(&storage, &first, &explicit).unwrap();
    let before = read_settings_bytes(&storage, &first).unwrap();
    initialize(&storage, &first, &discovery::Catalog::static_models(&first)).unwrap();
    initialize(
        &storage,
        &second,
        &discovery::Catalog::static_models(&second),
    )
    .unwrap();
    assert_eq!(read_settings_bytes(&storage, &first).unwrap(), before);
    assert_eq!(
        read_settings(&storage, &second)
            .unwrap()
            .unwrap()
            .chat
            .unwrap()
            .model,
        "recommended"
    );
    assert!(storage.read_settings().unwrap().is_none());
}
#[test]
fn qualified_provider_defaults_persist_independent_function_choices() {
    for (provider, expected_chat, expected_comment, comment_effort) in [
        ("anthropic", "claude-sonnet-5-5", "claude-haiku-5-5", "off"),
        (
            "openrouter",
            "openai/gpt-6.1-sol",
            "openai/gpt-6-luna",
            "off",
        ),
    ] {
        let (_directory, storage) = workspace();
        let config: Config = serde_json::from_value(json!({"provider": provider, "endpoint": null,
            "auth": "api_key"
        }))
        .unwrap();
        initialize(
            &storage,
            &config,
            &discovery::Catalog::static_models(&config),
        )
        .unwrap();
        let settings = read_settings(&storage, &config).unwrap().unwrap();
        assert_eq!(settings.chat.as_ref().unwrap().model, "recommended");
        assert_eq!(settings.chat.unwrap().thinking, "recommended");
        assert_eq!(required(&storage, &config).unwrap().model, expected_chat);
        let comment = small_choice(&storage, &config).unwrap().unwrap();
        assert_eq!(comment.model, expected_comment);
        assert_eq!(comment.thinking, comment_effort);
    }
}
#[test]
fn discovered_haiku_comment_explicitly_disables_thinking() {
    let config: Config =
        serde_json::from_value(json!({"provider": "anthropic", "auth": "api_key"})).unwrap();
    let observed = discovery::Catalog {
        source: discovery::Source::Provider,
        models: vec!["claude-haiku-5-5".into()],
        checked_at: None,
        selectable: vec![discovery::DiscoveredModel {
            id: "claude-haiku-5-5".into(),
            name: None,
            thinking_levels: vec!["low".into(), "medium".into()],
            reasoning_none: false,
            context_window: 1_000_000,
            max_tokens: 128_000,
            image_input: true,
        }],
    };
    let choice = resolve_choice(
        ModelChoice {
            model: "recommended".into(),
            thinking: "recommended".into(),
            catalog_revision: None,
        }
        .snapshot(&config),
        &observed,
        "comment",
    )
    .unwrap();
    assert_eq!(choice.model, "claude-haiku-5-5");
    assert_eq!(choice.thinking, "off");
    let request = crate::ai_protocol::build_request(
        "anthropic-messages",
        &crate::ai::native_model::descriptor(&choice).unwrap(),
        &choice.thinking,
        &[json!({"role": "user", "content": "Write a title."})],
        &[],
        Some(96),
    )
    .unwrap();
    assert_eq!(request.body["thinking"], json!({"type": "disabled"}));
    assert!(request.body.get("output_config").is_none());
}
#[test]
fn a_custom_chat_choice_does_not_need_a_recommended_comment_model() {
    let (_directory, storage) = workspace();
    let config: Config = serde_json::from_value(json!({
        "provider": "custom", "endpoint": "http://127.0.0.1:12345/v1", "auth": "api_key"
    }))
    .unwrap();
    let observed = discovery::Catalog {
        source: discovery::Source::Provider,
        models: vec!["synthetic-chat".into()],
        checked_at: None,
        selectable: vec![],
    };
    initialize(&storage, &config, &observed).unwrap();
    assert!(required(&storage, &config).is_err());
    save(&storage, &config, "synthetic-chat".into()).unwrap();
    assert_eq!(required(&storage, &config).unwrap().model, "synthetic-chat");
    let before = read_settings_bytes(&storage, &config).unwrap().unwrap();
    assert!(
        small_choice_observed(&storage, &config, &observed)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        read_settings_bytes(&storage, &config).unwrap().unwrap(),
        before
    );

    let mut explicit = settings(&storage, &config).unwrap();
    explicit.comment = Some(ModelChoice {
        model: "synthetic-comment".into(),
        thinking: "recommended".into(),
        catalog_revision: None,
    });
    write_settings(&storage, &config, &explicit).unwrap();
    assert_eq!(
        small_choice_observed(&storage, &config, &observed)
            .unwrap()
            .unwrap()
            .model,
        "synthetic-comment"
    );
    let restricted = discovery::Catalog {
        source: discovery::Source::Account,
        ..observed
    };
    assert_eq!(
        small_choice_observed(&storage, &config, &restricted)
            .err()
            .as_deref(),
        Some(MODEL_ERROR)
    );
}

#[test]
fn custom_and_deferred_auth_have_no_guessed_default() {
    let catalog: Value = serde_json::from_str(RECOMMENDATIONS).unwrap();
    let inventory: Value = serde_json::from_str(CATALOG).unwrap();
    for provider in ["anthropic", "openrouter", "custom"] {
        let config: Config = serde_json::from_value(json!({"provider": provider,
            "endpoint": if provider == "custom" { Some("https://example.invalid/v1") } else { None },
            "auth": if provider == "custom" { "api_key" } else { "oauth" }
        })).unwrap();
        let available = inventory["providers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == provider)
            .and_then(|entry| entry["models"].as_array())
            .map(Vec::as_slice);
        assert!(
            ranked_choice(&config, "chat", &catalog, available)
                .unwrap()
                .is_none()
        );
    }
}
