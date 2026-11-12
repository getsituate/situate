use super::*;

fn attempt() -> Attempt {
    Attempt {
        token: "attempt".into(),
        kind: "restart".into(),
        sessions: HashMap::from([
            ("main".into(), vec![Arc::new(Session::default())]),
            ("workspace-1".into(), vec![Arc::new(Session::default())]),
        ]),
        workspaces: HashMap::from([
            ("main".into(), vec!["one".into()]),
            ("workspace-1".into(), vec!["two".into()]),
        ]),
        registrations: HashMap::from([
            ("main".into(), "page-one".into()),
            ("workspace-1".into(), "page-two".into()),
        ]),
        ready: HashSet::new(),
        state: "pending",
    }
}
#[test]
fn terminal_status_survives_a_new_attempt_without_authorizing_other_windows() {
    let state = Recovery::default();
    for terminal_state in ["cancelled", "completed"] {
        let mut previous = attempt();
        previous.token = terminal_state.into();
        previous.state = terminal_state;
        state.retain_terminal(&previous).unwrap();
    }
    *state.attempt.lock().unwrap() = Some(attempt());
    for terminal_state in ["cancelled", "completed"] {
        let status = state.status("main", terminal_state).unwrap();
        assert_eq!(status.state, terminal_state);
        assert_eq!(status.workspace_ids, ["one"]);
        assert!(state.status("foreign-window", terminal_state).is_err());
    }
    assert_eq!(state.status("main", "attempt").unwrap().state, "pending");
    assert!(state.status("main", "unknown").is_err());
}

#[test]
fn terminal_history_capacity_never_evicts_an_unconfirmed_cancellation() {
    let state = Recovery::default();
    let mut previous = attempt();
    assert!(state.retain_terminal(&previous).is_err());
    previous.state = "cancelled";
    for index in 0..TERMINAL_LIMIT {
        previous.token = format!("cancelled-{index}");
        state.retain_terminal(&previous).unwrap();
    }
    previous.token = "overflow".into();
    assert!(state.retain_terminal(&previous).is_err());
    assert_eq!(state.terminal.lock().unwrap().len(), TERMINAL_LIMIT);
    assert_eq!(
        state.status("main", "cancelled-0").unwrap().state,
        "cancelled"
    );
    previous.token = "cancelled-0".into();
    state.retain_terminal(&previous).unwrap();
}

#[test]
fn recovery_allows_owned_appearance_and_onboarding_checkpoints_but_not_execution() {
    use situate_core::{
        appearance,
        onboarding::{OnboardingRecord, OnboardingStorage},
        workspaces::Location,
    };
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    std::fs::create_dir(root.join(".situate")).unwrap();
    let location = Location {
        id: "one".into(),
        name: "Workspace".into(),
        display: "Workspace".into(),
        kind: "path".into(),
        handle: root.to_str().unwrap().into(),
    };
    let app = tauri::test::mock_builder()
        .manage(Recovery {
            attempt: Mutex::new(Some(attempt())),
            ..Recovery::default()
        })
        .manage(crate::workspaces::test_workspaces(&[("main", location)]))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    assert!(crate::workspaces::authorization_session(app.handle(), "main", "one").is_err());
    crate::workspaces::with_open_storage(app.handle(), "main", "one", |location| {
        appearance::Storage::open(std::path::Path::new(&location.handle))?
            .update(appearance::Accent::Cobalt, None)?;
        Ok(())
    })
    .unwrap();
    let authorization =
        crate::workspaces::storage_authorization_session(app.handle(), "main", "one").unwrap();
    crate::workspaces::with_retained_session(app.handle(), "main", &authorization, |location| {
        OnboardingStorage::open(std::path::Path::new(&location.handle), "one")?.save(
            None,
            OnboardingRecord {
                description: "Retained setup draft".into(),
                ..Default::default()
            },
        )?;
        Ok(())
    })
    .unwrap();
    assert_eq!(
        appearance::Storage::open(&root)
            .unwrap()
            .snapshot()
            .unwrap()
            .accent,
        appearance::Accent::Cobalt
    );
    assert_eq!(
        OnboardingStorage::open(&root, "one")
            .unwrap()
            .load()
            .unwrap()
            .record
            .unwrap()
            .description,
        "Retained setup draft"
    );
    assert!(
        crate::workspaces::with_open_storage(
            app.handle(),
            "foreign-window",
            "one",
            |_| -> Result<(), String> { panic!("foreign persistence admitted") }
        )
        .is_err()
    );
    assert!(
        crate::workspaces::storage_authorization_session(app.handle(), "main", "foreign-scope")
            .is_err()
    );
    assert!(crate::workspaces::authorization_session(app.handle(), "main", "one").is_err());
}

#[test]
fn requires_every_window_and_exact_registration_before_relaunch() {
    let mut a = attempt();
    assert!(a.status("other", "attempt").is_err());
    assert!(a.acknowledge("main", "stale", "page-one", true).is_err());
    assert!(a.acknowledge("main", "attempt", "old-page", true).is_err());
    a.acknowledge("main", "attempt", "page-one", true).unwrap();
    assert!(
        a.finish(|| panic!("missing acknowledgement launched"))
            .is_err()
    );
    a.acknowledge("workspace-1", "attempt", "page-two", true)
        .unwrap();
    let mut launched = 0;
    a.finish(|| {
        launched += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(launched, 1);
    assert!(a.finish(|| panic!("replayed launch")).is_err());
}
#[test]
fn rejection_and_late_acknowledgement_never_relaunch() {
    let mut a = attempt();
    a.acknowledge("main", "attempt", "page-one", false).unwrap();
    assert!(
        a.acknowledge("workspace-1", "attempt", "page-two", true)
            .is_err()
    );
    assert!(a.finish(|| panic!("rejected attempt launched")).is_err());
    a.state = "cancelled";
    assert!(a.acknowledge("main", "attempt", "page-one", true).is_err());
}
#[test]
fn failed_checkpoint_prevents_the_injected_reopen_effect() {
    let mut a = attempt();
    a.acknowledge("main", "attempt", "page-one", true).unwrap();
    a.acknowledge("workspace-1", "attempt", "page-two", true)
        .unwrap();
    assert!(a.finish(|| Err(ERROR.into())).is_err());
    assert_eq!(a.state, "pending");
}
#[test]
fn scoped_barrier_does_not_block_other_workspaces() {
    let mut a = attempt();
    a.kind = "workspace".into();
    a.sessions.remove("workspace-1");
    a.workspaces.remove("workspace-1");
    let app = tauri::test::mock_builder()
        .manage(Recovery {
            attempt: Mutex::new(Some(a)),
            registrations: Mutex::default(),
            ..Recovery::default()
        })
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    assert!(admission_held(app.handle(), Some("one")));
    assert!(!admission_held(app.handle(), Some("two")));
    assert!(!admission_held(app.handle(), None));
    window_changed(app.handle(), "main");
    assert!(any_pending(app.handle()));
    assert_eq!(
        app.state::<Recovery>()
            .attempt
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .state,
        "rejected"
    );
}
