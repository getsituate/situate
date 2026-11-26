use super::*;

#[test]
fn an_installation_is_trusted_only_in_the_workspace_where_it_was_approved() {
    let mut device = Device::default();
    device.workspaces.insert(
        "garden".into(),
        Workspace {
            incarnation: Some("installed-on-this-device".into()),
            ..Default::default()
        },
    );

    assert!(device.owns("garden", "installed-on-this-device"));
    assert!(!device.owns("garden", "replacement"));
    assert!(!device.owns("elsewhere", "installed-on-this-device"));
    assert!(!device.owns("fresh-workspace", "replacement"));
}

#[test]
fn gmail_check_fixtures_return_synthetic_data_and_reject_unmatched_calls() {
    let responses = std::collections::HashMap::from([(
        "POST https://gmail.situate.invalid/listMetadata".to_owned(),
        crate::plugin_checks::HttpFixture {
            status: 200,
            body: r#"{"messages":[{"id":"example"}]}"#.into(),
        },
    )]);

    assert_eq!(
        fixture_response(
            &responses,
            "listMetadata",
            serde_json::json!({"accountId":"a0000000-0000-4000-8000-000000000001"})
        )
        .unwrap(),
        serde_json::json!({"messages":[{"id":"example"}]})
    );
    assert_eq!(
        fixture_response(&responses, "sendMessage", serde_json::json!({"accountId":"a0000000-0000-4000-8000-000000000001", "input":{"raw":"dGVzdA"}})).unwrap_err(),
        "native.gmail.testUnavailable"
    );
}

#[test]
fn a_fixture_does_not_satisfy_a_call_with_invalid_live_arguments() {
    use serde_json::json;
    let responses = [
        "listMessages",
        "getMessage",
        "selectAccount",
        "selectedAccount",
    ]
    .into_iter()
    .map(|name| {
        (
            format!("POST https://gmail.situate.invalid/{name}"),
            crate::plugin_checks::HttpFixture {
                status: 200,
                body: "null".into(),
            },
        )
    })
    .collect();
    let account = "a0000000-0000-4000-8000-000000000001";
    for (name, args) in [
        (
            "listMessages",
            json!({"accountId":account,"input":{"query":"demo","maxResults":51}}),
        ),
        (
            "listMessages",
            json!({"accountId":account,"input":{"q":"demo"}}),
        ),
        (
            "getMessage",
            json!({"accountId":account,"input":{"id":"demo","format":"raw"}}),
        ),
        ("selectAccount", json!({"accountId":"not-a-uuid"})),
        ("selectedAccount", json!({"accountId":account})),
    ] {
        assert_eq!(
            fixture_response(&responses, name, args),
            Err(INVALID.into()),
            "{name}"
        );
    }
    assert_eq!(
        fixture_response(
            &responses,
            "listMessages",
            json!({"accountId":account,"input":{"query":"demo","maxResults":5}})
        ),
        Ok(serde_json::Value::Null)
    );
}

pub(super) fn account(id: Uuid, requested: BTreeSet<Permission>, scopes: &[&str]) -> Account {
    Account {
        id,
        version: Uuid::new_v4(),
        subject: "synthetic-subject".into(),
        email: "inbox@example.test".into(),
        client: "synthetic-desktop-client".into(),
        requested,
        scopes: scopes.iter().map(|s| (*s).to_owned()).collect(),
        token: Some("synthetic-refresh-token".into()),
        expires: 100,
    }
}

#[test]
fn desktop_scope_requests_use_only_the_families_needed_by_the_selection() {
    use Permission::*;
    for (permissions, scopes) in [
        (
            vec![Read, Metadata],
            vec!["https://www.googleapis.com/auth/gmail.readonly"],
        ),
        (
            vec![Send],
            vec!["https://www.googleapis.com/auth/gmail.send"],
        ),
        (
            vec![Send, Draft],
            vec!["https://www.googleapis.com/auth/gmail.compose"],
        ),
        (
            vec![Metadata, Modify, Labels],
            vec!["https://www.googleapis.com/auth/gmail.modify"],
        ),
        (
            vec![FiltersRead, FiltersWrite, Delete],
            vec![
                "https://www.googleapis.com/auth/gmail.settings.basic",
                "https://mail.google.com/",
            ],
        ),
    ] {
        assert_eq!(requested_scopes(&permissions.into_iter().collect()), scopes);
    }
}

#[test]
fn an_update_requires_the_same_google_subject_and_applies_only_granted_permissions() {
    let mut workspace = Workspace::default();
    let id = Uuid::new_v4();
    let existing = account(
        id,
        BTreeSet::from([Permission::Metadata]),
        &["https://www.googleapis.com/auth/gmail.metadata"],
    );
    let version = existing.version;
    let subject = existing.subject.clone();
    workspace.accounts.insert(id, existing);
    let requested = BTreeSet::from([Permission::Metadata, Permission::Send]);
    let grant = |sub: &str| oauth::Grant {
        subject: sub.into(),
        email: "inbox@example.test".into(),
        token: "synthetic-new-token".into(),
        scopes: BTreeSet::from(["https://www.googleapis.com/auth/gmail.metadata".into()]),
        expires: None,
    };
    let wrong = apply_grant(
        &mut workspace,
        Some((id, version, &subject)),
        "synthetic-desktop-client".into(),
        requested.clone(),
        grant("another-subject"),
        200,
    );
    assert_eq!(wrong.err().as_deref(), Some("native.gmail.wrongAccount"));
    assert_eq!(
        workspace.accounts[&id].token.as_deref(),
        Some("synthetic-refresh-token")
    );
    let updated = apply_grant(
        &mut workspace,
        Some((id, version, &subject)),
        "synthetic-desktop-client".into(),
        requested,
        grant(&subject),
        200,
    )
    .unwrap();
    assert_eq!(updated.id, id);
    assert_eq!(updated.permissions, BTreeSet::from([Permission::Metadata]));
    assert_eq!(updated.missing, BTreeSet::from([Permission::Send]));
    assert_eq!(workspace.accounts[&id].expires, 605_000);
}

#[derive(Default)]
struct MemoryKeys(std::sync::Mutex<BTreeMap<String, Vec<u8>>>);
impl KeyStore for MemoryKeys {
    fn get(&self, name: &str) -> Result<Vec<u8>, String> {
        self.0
            .lock()
            .unwrap()
            .get(name)
            .cloned()
            .ok_or_else(|| STORAGE.into())
    }
    fn set(&self, name: &str, key: &[u8]) -> Result<(), String> {
        self.0.lock().unwrap().insert(name.into(), key.into());
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(name);
        Ok(())
    }
}

#[test]
fn credentials_and_selection_reopen_without_exposing_the_refresh_token() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().canonicalize().unwrap();
    let state = path.join(".situate");
    std::fs::create_dir(&state).unwrap();
    let keys = MemoryKeys::default();
    let id = Uuid::new_v4();
    let storage = Storage::open(&path, "gmail-test").unwrap();
    with_store(&storage, &keys, |device| {
        let workspace = device.workspaces.entry("one".into()).or_default();
        workspace.accounts.insert(
            id,
            account(
                id,
                BTreeSet::from([Permission::Metadata, Permission::Send]),
                &["https://www.googleapis.com/auth/gmail.metadata"],
            ),
        );
        workspace.selections.insert("consumer:one".into(), id);
        workspace.selections.insert("other:one".into(), id);
        Ok(((), true))
    })
    .unwrap();
    drop(storage);
    for entry in state.read_dir().unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("synthetic-refresh-token"));
    }
    let reopened = Storage::open(&path, "gmail-test").unwrap();
    with_store(&reopened, &keys, |device| {
        let workspace = &device.workspaces["one"];
        assert_eq!(workspace.selected("consumer:one").unwrap().id, id);
        assert_eq!(workspace.selected("other:one").unwrap().id, id);
        assert!(workspace.selected("consumer:replacement").is_none());
        let view = serde_json::to_value(workspace.accounts[&id].snapshot()).unwrap();
        assert_eq!(view["permissions"], serde_json::json!(["metadata"]));
        assert_eq!(view["partial"], true);
        assert!(!view.to_string().contains("synthetic-refresh-token"));
        block_grants(device, "synthetic-desktop-client", "synthetic-subject");
        assert!(
            device.workspaces["one"]
                .selected("other:one")
                .unwrap()
                .token
                .is_none()
        );
        Ok(((), true))
    })
    .unwrap();
}
