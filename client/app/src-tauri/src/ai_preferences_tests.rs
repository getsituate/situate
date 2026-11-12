use super::*;
use serde_json::json;
use std::cell::RefCell;

#[derive(Default)]
struct Keys(RefCell<HashMap<String, Vec<u8>>>);
impl KeyStore for Keys {
    fn get(&self, id: &str) -> Result<Vec<u8>, String> {
        self.0
            .borrow()
            .get(id)
            .cloned()
            .ok_or_else(|| KEY_ERROR.into())
    }
    fn set(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        self.0.borrow_mut().insert(id.into(), bytes.into());
        Ok(())
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        self.0.borrow_mut().remove(id);
        Ok(())
    }
}
struct Fixture {
    root: tempfile::TempDir,
    keys: Keys,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("content/.situate")).unwrap();
        std::fs::create_dir(root.path().join("device")).unwrap();
        Self {
            root,
            keys: Keys::default(),
        }
    }
    fn storage(&self) -> Storage {
        let root = self.root.path().canonicalize().unwrap();
        Storage::open(&root.join("content"), "scope")
            .unwrap()
            .with_device_store(&root.join("device"))
            .unwrap()
    }
    fn connect(&self) -> Connection {
        let storage = self.storage();
        let config: Config =
            serde_json::from_value(json!({"provider":"openai","auth":"api_key","endpoint":null}))
                .unwrap();
        let (config, _) = connections::prepare_config(&storage, config).unwrap();
        let connection = Connection {
            catalog: Some(discovery::Catalog::static_models(&config)),
            config,
            key: "synthetic".into(),
            oauth: None,
            codex: None,
        };
        storage
            .save_connection(
                &self.keys,
                connection.config.connection_id.as_deref().unwrap(),
                serde_json::to_value(&connection.config).unwrap(),
                &serde_json::to_vec(&connection).unwrap(),
                false,
            )
            .unwrap();
        initialize(
            &storage,
            &connection.config,
            &discovery::catalog(&connection),
        )
        .unwrap();
        connection
    }
}
fn file_snapshot(
    root: &std::path::Path,
) -> std::collections::BTreeMap<std::path::PathBuf, Option<Vec<u8>>> {
    let mut snapshot = std::collections::BTreeMap::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            snapshot.insert(path.clone(), None);
            snapshot.extend(file_snapshot(&path));
        } else {
            snapshot.insert(path.clone(), Some(std::fs::read(path).unwrap()));
        }
    }
    snapshot
}

#[test]
fn preview_inherits_workspace_preferences_without_creating_a_conversation_or_preferences() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let connection = fixture.connect();
    let mut defaults = settings(&storage, &connection.config).unwrap();
    defaults.chat.as_mut().unwrap().thinking = "high".into();
    save_current_settings(&storage, &connection, defaults).unwrap();
    let before = file_snapshot(fixture.root.path());

    let status = preview_conversation_status(
        &storage,
        &connection.config,
        discovery::status(&storage, &connection, false),
        None,
        None,
    );
    assert!(status.available);
    assert!(status.model_error.is_none());
    assert_eq!(status.selected_model.as_deref(), Some("gpt-6.1-sol"));
    assert!(status.model_inherited);
    assert!(status.thinking_inherited);
    assert_eq!(status.thinking_preference.as_deref(), Some("high"));
    assert_eq!(status.thinking_level.as_deref(), Some("high"));
    assert_eq!(status.inherited_thinking_level.as_deref(), Some("high"));
    assert_eq!(status.recommended_thinking_level.as_deref(), Some("medium"));
    assert_eq!(file_snapshot(fixture.root.path()), before);

    let mut defaults = settings(&storage, &connection.config).unwrap();
    defaults.chat.as_mut().unwrap().model = "gpt-4o-mini".into();
    defaults.chat.as_mut().unwrap().thinking = "recommended".into();
    save_current_settings(&storage, &connection, defaults).unwrap();
    let before = file_snapshot(fixture.root.path());
    let status = preview_conversation_status(
        &storage,
        &connection.config,
        discovery::status(&storage, &connection, false),
        None,
        None,
    );
    assert!(status.model_error.is_none());
    assert!(status.model_inherited);
    assert!(status.thinking_inherited);
    assert_eq!(status.selected_model.as_deref(), Some("gpt-4o-mini"));
    assert_eq!(status.thinking_level.as_deref(), Some("off"));
    assert_eq!(file_snapshot(fixture.root.path()), before);
}

#[test]
fn preview_overrides_use_the_conversation_policy_without_writing_files() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let connection = fixture.connect();
    let mut defaults = settings(&storage, &connection.config).unwrap();
    defaults.chat.as_mut().unwrap().thinking = "high".into();
    save_current_settings(&storage, &connection, defaults).unwrap();
    let before = file_snapshot(fixture.root.path());
    let preview = |model: Option<&str>, thinking: Option<&str>| {
        preview_conversation_status(
            &storage,
            &connection.config,
            discovery::status(&storage, &connection, false),
            model.map(str::to_owned),
            thinking.map(str::to_owned),
        )
    };
    let status = preview(Some("gpt-4o-mini"), None);
    assert!(status.model_error.is_none());
    assert_eq!(status.selected_model.as_deref(), Some("gpt-4o-mini"));
    assert_eq!(status.model_preference.as_deref(), Some("gpt-4o-mini"));
    assert!(!status.model_inherited);
    assert!(status.thinking_inherited);
    assert_eq!(status.thinking_level.as_deref(), Some("off"));

    let status = preview(None, Some("low"));
    assert!(status.model_error.is_none());
    assert!(status.model_inherited);
    assert!(!status.thinking_inherited);
    assert_eq!(status.thinking_level.as_deref(), Some("low"));

    let status = preview(Some("recommended"), Some("recommended"));
    assert!(status.model_error.is_none());
    assert!(!status.model_inherited);
    assert!(!status.thinking_inherited);
    assert_eq!(status.model_preference.as_deref(), Some("recommended"));
    assert_eq!(status.selected_model.as_deref(), Some("gpt-6.1-sol"));
    assert_eq!(status.thinking_preference.as_deref(), Some("recommended"));
    assert_eq!(status.thinking_level.as_deref(), Some("medium"));
    assert_eq!(status.inherited_thinking_level.as_deref(), Some("high"));

    assert!(
        preview(Some("unavailable-model"), None)
            .model_error
            .is_some()
    );
    assert!(
        preview(None, Some("unavailable-level"))
            .model_error
            .is_some()
    );
    let inherited = preview(None, None);
    assert!(inherited.model_inherited);
    assert!(inherited.thinking_inherited);
    assert_eq!(inherited.thinking_level.as_deref(), Some("high"));
    assert_eq!(file_snapshot(fixture.root.path()), before);
}

#[test]
fn account_bound_overrides_survive_default_changes_and_orphans_can_restore_inheritance() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let a = fixture.connect();
    let b = fixture.connect();
    let a_id = a.config.connection_id.as_deref().unwrap();
    let b_id = b.config.connection_id.as_deref().unwrap();
    assert_ne!(a.config.label, b.config.label);
    assert_eq!(storage.selected_connection().unwrap().unwrap().id, a_id);
    assert_eq!(
        discovery::status(&storage, &b, false)
            .config
            .unwrap()
            .connection_id
            .as_deref(),
        Some(b_id)
    );
    let conversation = storage.create_conversation("one", "").unwrap();
    select_conversation_model(&storage, Some(&a), "one", Some("gpt-4o-mini".into())).unwrap();
    storage.select_connection(b_id).unwrap();
    assert_eq!(
        effective_record(&storage, Some("one")).unwrap().unwrap().id,
        a_id
    );
    assert_eq!(
        effective_record(&storage, Some("two")).unwrap().unwrap().id,
        b_id
    );
    let snapshot = admit_conversation(&storage, &a, "one").unwrap();
    assert_eq!(snapshot.model, "gpt-4o-mini");
    select_conversation_model(&storage, Some(&a), "one", Some("recommended".into())).unwrap();
    let reopened = fixture.storage();
    let status = conversation_status(
        &reopened,
        &a.config,
        discovery::status(&reopened, &a, false),
        &conversation,
    );
    assert!(!status.model_inherited);
    assert_eq!(status.model_preference.as_deref(), Some("recommended"));
    assert_eq!(status.selected_model.as_deref(), Some("gpt-6.1-sol"));
    assert_eq!(snapshot.model, "gpt-4o-mini");
    storage
        .remove_connection(&fixture.keys, Some(a_id))
        .unwrap();
    assert!(effective_record(&storage, Some("one")).is_err());
    let missing = unavailable_conversation_status(
        &storage,
        Some("one"),
        Some("native.ai.access.required".into()),
    )
    .unwrap();
    assert!(!missing.available);
    assert!(!missing.model_inherited);
    assert_eq!(missing.model_preference.as_deref(), Some("recommended"));
    select_conversation_model(&storage, None, "one", None).unwrap();
    assert_eq!(
        effective_record(&storage, Some("one")).unwrap().unwrap().id,
        b_id
    );
    assert_eq!(
        admit_conversation(&storage, &b, "one").unwrap().model,
        "gpt-6.1-sol"
    );
    assert_eq!(
        storage.read_conversation("one").unwrap().unwrap().revision,
        conversation.revision
    );
    storage
        .remove_connection(&fixture.keys, Some(b_id))
        .unwrap();
    assert!(storage.selected_connection().unwrap().is_none());
}
#[test]
fn thinking_is_remembered_per_concrete_model_and_recommended_is_distinct_from_inheritance() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let connection = fixture.connect();
    let config = &connection.config;
    let record = storage.create_conversation("one", "").unwrap();
    let mut defaults = settings(&storage, config).unwrap();
    defaults.chat.as_mut().unwrap().thinking = "high".into();
    let saved = save_current_settings(&storage, &connection, defaults.clone()).unwrap();
    assert_eq!(saved.chat.as_ref().unwrap().model, "recommended");
    assert_eq!(saved.chat.as_ref().unwrap().thinking, "high");
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .thinking,
        "high"
    );
    select_conversation_thinking(&storage, &connection, "one", Some("recommended".into())).unwrap();
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .thinking,
        "medium"
    );
    let status = conversation_status(
        &storage,
        config,
        discovery::status(&storage, &connection, false),
        &record,
    );
    assert!(!status.thinking_inherited);
    assert_eq!(status.thinking_preference.as_deref(), Some("recommended"));
    assert_eq!(status.thinking_level.as_deref(), Some("medium"));
    assert_eq!(status.inherited_thinking_level.as_deref(), Some("high"));
    assert_eq!(status.recommended_thinking_level.as_deref(), Some("medium"));
    let serialized = serde_json::to_value(&status).unwrap();
    assert_eq!(serialized["inheritedThinkingLevel"], "high");
    assert_eq!(serialized["recommendedThinkingLevel"], "medium");
    select_conversation_thinking(&storage, &connection, "one", Some("low".into())).unwrap();
    let snapshot = admit_conversation(&storage, &connection, "one").unwrap();
    select_conversation_model(
        &storage,
        Some(&connection),
        "one",
        Some("gpt-4o-mini".into()),
    )
    .unwrap();
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .thinking,
        "off"
    );
    select_conversation_model(
        &storage,
        Some(&connection),
        "one",
        Some("gpt-6.1-sol".into()),
    )
    .unwrap();
    assert_eq!(
        admit_conversation(&fixture.storage(), &connection, "one")
            .unwrap()
            .thinking,
        "low"
    );
    select_conversation_thinking(&storage, &connection, "one", None).unwrap();
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .thinking,
        "high"
    );
    defaults.chat = Some(ModelChoice {
        model: "gpt-4o-mini".into(),
        thinking: "recommended".into(),
        catalog_revision: None,
    });
    save_current_settings(&storage, &connection, defaults.clone()).unwrap();
    defaults.chat.as_mut().unwrap().model = "gpt-6.1-sol".into();
    let restored = save_current_settings(&storage, &connection, defaults.clone()).unwrap();
    assert_eq!(restored.chat.unwrap().thinking, "high");
    defaults.chat.as_mut().unwrap().thinking = "recommended".into();
    let explicit = save_current_settings(&storage, &connection, defaults).unwrap();
    assert_eq!(explicit.chat.unwrap().thinking, "recommended");
    assert_eq!(snapshot.thinking, "low");
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .thinking,
        "medium"
    );
}
#[test]
fn an_unavailable_saved_thinking_level_can_restore_inheritance() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let connection = fixture.connect();
    let record = storage.create_conversation("one", "").unwrap();
    let mut saved = preferences(&storage, "one").unwrap();
    saved.thinking.insert(
        thinking_key(&connection.config, "gpt-6.1-sol").unwrap(),
        "retired-level".into(),
    );
    save_preferences(&storage, "one", &saved).unwrap();
    assert!(admit_conversation(&storage, &connection, "one").is_err());
    let status = conversation_status(
        &storage,
        &connection.config,
        discovery::status(&storage, &connection, false),
        &record,
    );
    assert!(!status.thinking_inherited);
    assert_eq!(status.thinking_preference.as_deref(), Some("retired-level"));
    select_conversation_thinking(&storage, &connection, "one", None).unwrap();
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .thinking,
        "medium"
    );
}
#[test]
fn next_request_changes_do_not_modify_running_or_unsaved_snapshots() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let connection = fixture.connect();
    storage.create_conversation("one", "").unwrap();
    let state = Ai::default();
    let key = RunKey::new("scope", "one");
    state.reserve(key.clone(), "turn".into()).unwrap();
    let snapshot = admit_conversation(&storage, &connection, "one").unwrap();
    state.active.lock().unwrap().get_mut(&key).unwrap().choice = Some(snapshot);
    for unsaved in [false, true] {
        if unsaved {
            state
                .active
                .lock()
                .unwrap()
                .get_mut(&key)
                .unwrap()
                .network_done = true;
        }
        select_conversation_model(
            &storage,
            Some(&connection),
            "one",
            Some("gpt-4o-mini".into()),
        )
        .unwrap();
        let active = state.active.lock().unwrap();
        let captured = active.get(&key).unwrap().choice.as_ref().unwrap();
        assert_eq!(captured.model, "gpt-6.1-sol");
        assert_eq!(captured.thinking, "medium");
        assert_eq!(
            admit_conversation(&storage, &connection, "one")
                .unwrap()
                .model,
            "gpt-4o-mini"
        );
    }
}
#[test]
fn override_settings_remain_usable_after_the_workspace_default_is_removed() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let a = fixture.connect();
    let b = fixture.connect();
    let a_id = a.config.connection_id.as_deref().unwrap();
    let b_id = b.config.connection_id.as_deref().unwrap();
    storage.create_conversation("one", "").unwrap();
    select_conversation_model(&storage, Some(&a), "one", Some("gpt-4o-mini".into())).unwrap();
    storage.select_connection(b_id).unwrap();
    storage
        .remove_connection(&fixture.keys, Some(b_id))
        .unwrap();
    assert!(storage.selected_connection().unwrap().is_none());
    let mut defaults = load_connection_settings(&storage, &fixture.keys, Some(a_id)).unwrap();
    defaults.show_inline_model = true;
    save_current_settings(&storage, &a, defaults).unwrap();
    assert!(
        load_connection_settings(&fixture.storage(), &fixture.keys, Some(a_id))
            .unwrap()
            .show_inline_model
    );
    assert_eq!(
        admit_conversation(&storage, &a, "one").unwrap().model,
        "gpt-4o-mini"
    );
    assert!(storage.selected_connection().unwrap().is_none());
}
#[test]
fn rejected_access_is_scoped_to_the_effective_account_and_workspace() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let a = fixture.connect();
    let b = fixture.connect();
    let a_id = a.config.connection_id.as_deref().unwrap();
    let b_id = b.config.connection_id.as_deref().unwrap();
    storage.create_conversation("one", "").unwrap();
    select_conversation_model(&storage, Some(&a), "one", Some("gpt-4o-mini".into())).unwrap();
    storage.select_connection(b_id).unwrap();
    let state = Ai::default();
    state
        .rejected
        .lock()
        .unwrap()
        .insert(("scope".into(), a_id.into()));
    assert!(!state.is_rejected("scope", Some(b_id)).unwrap());
    assert!(!state.is_rejected("other", Some(a_id)).unwrap());
    assert!(
        discovery::status(
            &storage,
            &b,
            state.is_rejected("scope", Some(b_id)).unwrap()
        )
        .available
    );
    let effective = effective_record(&storage, Some("one")).unwrap().unwrap();
    assert!(state.is_rejected("scope", Some(&effective.id)).unwrap());
    assert!(!discovery::status(&storage, &a, true).available);
    state.clear_rejected("scope", Some(b_id)).unwrap();
    assert!(state.is_rejected("scope", Some(a_id)).unwrap());
    state.clear_rejected("scope", Some(a_id)).unwrap();
    assert!(!state.is_rejected("scope", Some(a_id)).unwrap());
}
#[test]
fn recommendations_follow_observation_but_explicit_choices_never_fall_back() {
    let fixture = Fixture::new();
    let storage = fixture.storage();
    let mut connection = fixture.connect();
    storage.create_conversation("one", "").unwrap();
    let mut defaults = settings(&storage, &connection.config).unwrap();
    defaults.chat.as_mut().unwrap().thinking = "high".into();
    save_current_settings(&storage, &connection, defaults).unwrap();
    let before = read_settings_bytes(&storage, &connection.config).unwrap();
    connection.catalog = Some(discovery::Catalog {
        source: discovery::Source::Account,
        models: vec!["gpt-4o-mini".into()],
    });
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .model,
        "gpt-4o-mini"
    );
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .thinking,
        "off"
    );
    assert_eq!(
        settings_for_catalog(
            &storage,
            &connection.config,
            &discovery::catalog(&connection)
        )
        .unwrap()
        .chat
        .unwrap()
        .thinking,
        "recommended"
    );
    assert_eq!(
        read_settings_bytes(&storage, &connection.config).unwrap(),
        before
    );
    select_conversation_model(
        &storage,
        Some(&connection),
        "one",
        Some("gpt-4o-mini".into()),
    )
    .unwrap();
    connection.catalog.as_mut().unwrap().models = vec!["gpt-6.1-sol".into()];
    assert!(admit_conversation(&storage, &connection, "one").is_err());
    assert_eq!(
        preferences(&storage, "one").unwrap().model.unwrap().model,
        "gpt-4o-mini"
    );
    select_conversation_model(&storage, None, "one", None).unwrap();
    assert_eq!(
        admit_conversation(&storage, &connection, "one")
            .unwrap()
            .model,
        "gpt-6.1-sol"
    );
}
