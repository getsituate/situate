use super::*;

fn pending_key() -> PendingKey {
    PendingKey {
        window: "window".into(),
        scope: "workspace".into(),
        conversation: "conversation".into(),
        run: "run".into(),
        tool: "call".into(),
    }
}

#[test]
fn manual_cancellation_reaches_broker_and_evidence_without_cancelling_the_parent() {
    let pending = PendingChecks::default();
    let key = pending_key();
    let operation = pending.admit(key.clone()).unwrap();
    let broker = operation.token.child_token();
    let evidence = broker.clone();
    pending.cancel(key.clone()).unwrap();
    assert!(operation.token.is_cancelled());
    assert!(broker.is_cancelled());
    assert!(evidence.is_cancelled());
    drop(operation);
    assert!(pending.admit(key).is_err());
    let parent = CancellationToken::new();
    let check = parent.child_token();
    check.cancel();
    assert!(!parent.is_cancelled());
}

#[test]
fn dropping_an_unsettled_manual_owner_revokes_its_shared_token() {
    let pending = PendingChecks::default();
    let operation = pending.admit(pending_key()).unwrap();
    let broker = operation.token.child_token();
    drop(operation);
    assert!(broker.is_cancelled());
    assert!(pending.admit(pending_key()).is_err());
}

#[test]
fn cancellation_before_check_admission_cannot_start_a_worker() {
    let pending = PendingChecks::default();
    let key = pending_key();
    pending.cancel(key.clone()).unwrap();
    assert_eq!(
        pending.admit(key).err().unwrap(),
        "native.ai.response.stopped"
    );
    assert!(
        pending
            .admit(PendingKey {
                tool: "another-call".into(),
                ..pending_key()
            })
            .is_ok()
    );
}

#[test]
fn cancellation_is_exactly_scoped_and_duplicate_pending_admission_is_rejected() {
    let pending = PendingChecks::default();
    let key = pending_key();
    let operation = pending.admit(key.clone()).unwrap();
    for other in [
        PendingKey {
            window: "other".into(),
            ..key.clone()
        },
        PendingKey {
            scope: "other".into(),
            ..key.clone()
        },
        PendingKey {
            conversation: "other".into(),
            ..key.clone()
        },
        PendingKey {
            run: "other".into(),
            ..key.clone()
        },
        PendingKey {
            tool: "other".into(),
            ..key.clone()
        },
    ] {
        pending.cancel(other).unwrap();
        assert!(!operation.token.is_cancelled());
    }
    assert!(pending.admit(key.clone()).is_err());
    operation.finish();
    assert!(pending.admit(key).is_ok());
}

#[test]
fn scope_closure_cancels_checks_and_a_stale_guard_cannot_remove_reopened_admission() {
    let pending = PendingChecks::default();
    let key = pending_key();
    let previous = pending.admit(key.clone()).unwrap();
    let other = pending
        .admit(PendingKey {
            scope: "other".into(),
            ..key.clone()
        })
        .unwrap();
    pending.invalidate_scope("workspace");
    assert!(previous.token.is_cancelled());
    assert!(!other.token.is_cancelled());
    let current = pending.admit(key.clone()).unwrap();
    drop(previous);
    pending.cancel(key).unwrap();
    assert!(current.token.is_cancelled());
}

#[test]
fn native_development_instructions_format_only_the_starting_plugin_context() {
    let template = include_str!("../../src/ai/plugin-development-instructions.md");
    assert_eq!(template.matches("{{starting_context}}").count(), 1);
    for (id, expected, absent) in [
        ("", "No starting plugin is selected.", "Starting context:"),
        (
            "sample",
            "Starting context: sample.",
            "No starting plugin is selected.",
        ),
    ] {
        let development: Development =
            serde_json::from_value(json!({"version":2,"pluginId":id})).unwrap();
        let prompt = instructions(&development);
        assert_eq!(prompt.matches(expected).count(), 1);
        assert!(!prompt.contains(absent));
        assert!(!prompt.contains("{{starting_context}}"));
    }
}

#[test]
fn definitions_follow_conversation_development_mode() {
    let names = |development: Option<&Development>| {
        definitions(development, "00000000-0000-4000-8000-000000000001")
            .iter()
            .map(|value| value["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    let ordinary = names(None);
    assert!(ordinary.contains(&"start_plugin_development".into()));
    assert!(ordinary.contains(&"enter_plugin_development".into()));
    assert!(!ordinary.contains(&"edit_plugin_sources".into()));
    let legacy = definitions(None, "legacy");
    assert!(
        !legacy
            .iter()
            .any(|tool| tool["name"] == "enter_plugin_development")
    );
    assert!(
        legacy
            .iter()
            .any(|tool| tool["name"] == "start_plugin_development")
    );
    let development: Development = serde_json::from_value(json!({"version":2})).unwrap();
    let grouped = names(Some(&development));
    assert_eq!(
        grouped,
        vec![
            "inspect_plugin",
            "read_plugin_design",
            "read_plugin_development",
            "check_plugin_changes",
            "activate_plugin_changes",
            "inspect_plugin_changes"
        ]
    );
}

#[test]
fn pending_cancellation_ipc_is_strict_and_cannot_override_native_scope() {
    let value = json!({"operation":"cancelPending","toolCallId":"call"});
    assert!(
        matches!(serde_json::from_value::<crate::plugin_changes::Request>(value.clone()).unwrap(), crate::plugin_changes::Request::CancelPending {tool_call_id} if tool_call_id == "call")
    );
    let mut forged = value;
    forged["scope"] = json!("another-workspace");
    assert!(serde_json::from_value::<crate::plugin_changes::Request>(forged).is_err());
}

#[test]
fn design_resources_are_offline_and_exactly_selected() {
    let result = design(json!({"resource":"components"})).unwrap();
    let components: Value =
        serde_json::from_str(result.content[0]["text"].as_str().unwrap()).unwrap();
    assert!(components.get("SituateButton").is_some());
    assert_eq!(result.details, json!({"resource":"components"}));
    assert!(design(json!({"resource":"overview","path":"private"})).is_err());
    assert!(design(json!({"resource":"unknown"})).is_err());
}

#[test]
fn design_tool_ships_the_theme_catalog_and_registration_guide() {
    let development: Development = serde_json::from_value(json!({"version":2})).unwrap();
    let tools = definitions(Some(&development), "00000000-0000-4000-8000-000000000001");
    let definition = tools
        .iter()
        .find(|tool| tool["name"] == "read_plugin_design")
        .unwrap();
    assert!(
        definition["parameters"]["properties"]["resource"]["enum"]
            .as_array()
            .unwrap()
            .contains(&json!("themes"))
    );
    let result = design(json!({"resource":"themes"})).unwrap();
    assert_eq!(result.details, json!({"resource":"themes"}));
    let content = result.content[0]["text"].as_str().unwrap();
    assert!(content.contains("Settings → Appearance → Theme"));
    assert!(content.contains("host.themeApi"));
    let (_, json) = content.split_once("\n```json\n").unwrap();
    let catalog: Value = serde_json::from_str(json.strip_suffix("\n```").unwrap()).unwrap();
    let shared: Value = serde_json::from_str(include_str!(
        "../../src/ai/plugin-design/theme-variables.json"
    ))
    .unwrap();
    assert_eq!(catalog["contract"], shared);
    assert_eq!(catalog["brandDefaults"]["space-3"], "12px");
    assert_eq!(catalog["brandDefaults"]["text-body"], "1rem");
    assert!(catalog["brandDefaults"].get("target-min").is_none());
    assert!(!result.is_error);
}

#[test]
fn source_structure_operations_are_advertised_only_in_development() {
    let development: Development = serde_json::from_value(json!({"version":2})).unwrap();
    for (mode, expected) in [(None, false), (Some(&development), true)] {
        let tools = definitions(mode, "00000000-0000-4000-8000-000000000001");
        assert!(
            !tools
                .iter()
                .any(|tool| tool["name"] == "edit_plugin_sources")
        );
        let inspect = tools
            .iter()
            .find(|tool| tool["name"] == "inspect_plugin")
            .unwrap();
        let variants = inspect["parameters"]["anyOf"].as_array().unwrap();
        for operation in ["create", "mkdir", "remove", "rename", "capture"] {
            assert_eq!(
                variants
                    .iter()
                    .any(|variant| variant["properties"]["operation"]["const"] == operation),
                expected
            );
            assert!(is_source_operation(&json!({"operation":operation})));
        }
        assert!(
            !variants
                .iter()
                .any(|variant| variant["properties"]["operation"]["const"] == "write")
        );
    }
}

#[test]
fn authoring_resources_are_exactly_selected_and_advertised() {
    let resources = [
        (
            "package",
            include_str!("../../src/ai/plugin-authoring/package.md"),
        ),
        (
            "service-host",
            include_str!("../../src/ai/plugin-authoring/service-host.md"),
        ),
        (
            "checks",
            include_str!("../../src/ai/plugin-authoring/checks.md"),
        ),
        (
            "document-sources",
            include_str!("../../src/ai/document-sources/reference.md"),
        ),
        (
            "document-source-contract",
            include_str!("../../src/ai/document-sources/contract.js"),
        ),
    ];
    for (resource, content) in resources {
        let result = development_reference(json!({"resource":resource})).unwrap();
        assert_eq!(result.content, vec![json!({"type":"text","text":content})]);
        assert_eq!(result.details, json!({"resource":resource}));
        assert!(!result.is_error);
        assert!(result.structured_content.is_none());
    }
    assert!(
        development_reference(json!({"resource":"document-sources","path":"private"})).is_err()
    );
    assert!(development_reference(json!({"resource":"../secret"})).is_err());
    for development in [
        None,
        Some(serde_json::from_value(json!({"version":2})).unwrap()),
    ] {
        let definition = definitions(development.as_ref(), "00000000-0000-4000-8000-000000000001")
            .into_iter()
            .find(|value| value["name"] == "read_plugin_development")
            .unwrap();
        assert_eq!(
            definition["parameters"]["properties"]["resource"]["enum"],
            json!(resources.map(|(name, _)| name))
        );
        assert_eq!(definition["parameters"]["additionalProperties"], false);
    }
}
