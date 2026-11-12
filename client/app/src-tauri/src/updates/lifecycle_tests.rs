use super::*;

fn preparation() -> (Preparation, Arc<Session>, Arc<Session>) {
    let first = Arc::new(Session::default());
    let second = Arc::new(Session::default());
    let attempt = Attempt {
        token: "update-one".into(),
        sessions: HashMap::from([
            ("main".into(), vec![first.clone()]),
            ("workspace-2".into(), vec![second.clone()]),
            ("workspace-empty".into(), vec![]),
        ]),
        workspaces: HashMap::from([
            ("main".into(), vec!["one".into()]),
            ("workspace-2".into(), vec!["two".into()]),
            ("workspace-empty".into(), vec![]),
        ]),
        ready: HashSet::new(),
        cancelled: false,
        installing: false,
        forced: false,
        stopping: false,
    };
    (
        Preparation {
            held: AtomicBool::new(true),
            sealed: AtomicBool::new(false),
            attempt: Mutex::new(Some(attempt)),
            history: Mutex::default(),
        },
        first,
        second,
    )
}

#[test]
fn every_window_prepares_reversibly_before_any_session_detaches() {
    let (preparation, first, second) = preparation();
    assert!(preparation.seal("update-one").is_err());
    {
        let mut pending = preparation.attempt.lock().unwrap();
        let attempt = pending.as_mut().unwrap();
        attempt.pause("main").unwrap();
        attempt.pause("workspace-2").unwrap();
        assert!(attempt.finish().is_err());
        assert!(!first.detached.load(Ordering::Acquire));
        assert!(!second.detached.load(Ordering::Acquire));
    }
    assert!(preparation.seal("update-one").is_err());
    preparation
        .attempt
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .pause("workspace-empty")
        .unwrap();
    preparation.seal("update-one").unwrap();
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
    preparation
        .attempt
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .finish()
        .unwrap();
    assert!(first.detached.load(Ordering::Acquire));
    assert!(second.detached.load(Ordering::Acquire));
}
#[test]
fn veto_or_known_unchanged_failure_preserves_sessions_and_rejects_stale_tokens() {
    let (preparation, first, second) = preparation();
    {
        let mut pending = preparation.attempt.lock().unwrap();
        let attempt = pending.as_mut().unwrap();
        attempt.pause("main").unwrap();
        attempt.resume();
        assert!(attempt.finish().is_err());
    }
    assert_eq!(
        preparation.status("main", "update-one").unwrap().state,
        "cancelled"
    );
    assert!(preparation.status("unrelated", "update-one").is_err());
    assert!(preparation.status("main", "stale").is_err());
    assert!(preparation.seal("update-one").is_err());
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
    // An ordinary quit may still commit the same live sessions after update preparation is released.
    files::commit_quit(&[first.clone(), second.clone()], false).unwrap();
    assert!(first.detached.load(Ordering::Acquire));
    assert!(second.detached.load(Ordering::Acquire));
}
#[test]
fn forced_preparation_bypasses_window_acknowledgements_but_not_commit_ordering() {
    let (preparation, first, second) = preparation();
    assert!(preparation.force_ready("update-one").is_err());
    preparation.attempt.lock().unwrap().as_mut().unwrap().forced = true;
    assert!(preparation.force_ready("stale").is_err());
    preparation.force_ready("update-one").unwrap();
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
    assert!(
        preparation
            .attempt
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .finish()
            .is_err()
    );
    preparation.seal("update-one").unwrap();
    preparation
        .attempt
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .finish()
        .unwrap();
    assert!(first.detached.load(Ordering::Acquire));
    assert!(second.detached.load(Ordering::Acquire));
}

#[test]
fn cancelled_native_shutdown_cannot_seal_or_resume_installation_after_settling() {
    let (preparation, _, _) = preparation();
    {
        let mut pending = preparation.attempt.lock().unwrap();
        let attempt = pending.as_mut().unwrap();
        attempt.stopping = true;
        attempt.forced = true;
    }
    assert!(preparation.force_ready("update-one").is_err());
    assert!(preparation.seal("update-one").is_err());
    preparation
        .attempt
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .resume();
    assert!(preparation.held.load(Ordering::Acquire));
    assert!(preparation.actions_stopped("stale").is_err());
    assert!(preparation.actions_stopped("update-one").is_err());
    assert!(
        !preparation
            .attempt
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .stopping
    );
    assert!(preparation.force_ready("update-one").is_err());
    assert!(preparation.seal("update-one").is_err());
}

#[test]
fn cancelling_forced_preparation_leaves_sessions_attached() {
    let (preparation, first, second) = preparation();
    preparation.attempt.lock().unwrap().as_mut().unwrap().forced = true;
    preparation.force_ready("update-one").unwrap();
    preparation
        .attempt
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .resume();
    assert!(preparation.seal("update-one").is_err());
    assert!(preparation.force_ready("update-one").is_err());
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
    files::pause_for_quit(&first, "next", false).unwrap();
}

fn capture_app() -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    app.manage(crate::ai::Ai::default());
    app.manage(crate::ai_executor::Executors::default());
    app.manage(crate::plugin_host::Hosts::default());
    app
}

#[test]
fn veto_and_known_unchanged_release_restore_fresh_capture_admission() {
    for unchanged in [false, true] {
        let app = capture_app();
        let (preparation, first, second) = preparation();
        crate::ai_executor::prepare_close(app.handle(), "one").unwrap();
        assert!(crate::ai_executor::ensure_capture_available(app.handle(), "one").is_err());
        {
            let mut pending = preparation.attempt.lock().unwrap();
            let attempt = pending.as_mut().unwrap();
            attempt.pause("main").unwrap();
            if unchanged {
                attempt.pause("workspace-2").unwrap();
                attempt.pause("workspace-empty").unwrap();
            }
        }
        if unchanged {
            preparation.seal("update-one").unwrap();
            preparation.unchanged(app.handle(), "update-one");
        } else {
            preparation
                .acknowledge(
                    app.handle(),
                    "workspace-2",
                    "update-one",
                    false,
                    Some("window_error"),
                )
                .unwrap();
        }
        assert!(!preparation.held.load(Ordering::Acquire));
        assert!(crate::ai_executor::ensure_capture_available(app.handle(), "one").is_ok());
        assert!(!first.detached.load(Ordering::Acquire));
        assert!(!second.detached.load(Ordering::Acquire));
        assert!(preparation.seal("update-one").is_err());
    }
}

#[test]
fn cancellation_retains_capture_barriers_until_owned_cleanup_has_settled() {
    let app = capture_app();
    let (preparation, first, second) = preparation();
    preparation
        .attempt
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .stopping = true;
    crate::ai_executor::prepare_close(app.handle(), "one").unwrap();
    preparation.cancel(app.handle(), "update-one").unwrap();
    assert!(preparation.held.load(Ordering::Acquire));
    assert!(crate::ai_executor::ensure_capture_available(app.handle(), "one").is_err());
    assert!(preparation.actions_stopped("update-one").is_err());
    preparation.cancel(app.handle(), "update-one").unwrap();
    assert!(!preparation.held.load(Ordering::Acquire));
    assert!(crate::ai_executor::ensure_capture_available(app.handle(), "one").is_ok());
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
}

fn sealing_app() -> tauri::App<tauri::test::MockRuntime> {
    let app = capture_app();
    app.manage(crate::ai::conversations::Conversations::default());
    app.manage(crate::workspaces::test_workspaces(&[(
        "main",
        situate_core::workspaces::Location {
            id: "one".into(),
            name: "One".into(),
            display: "One".into(),
            kind: "path".into(),
            handle: "/fixture/one".into(),
        },
    )]));
    let (preparation, _, _) = preparation();
    {
        let mut pending = preparation.attempt.lock().unwrap();
        let attempt = pending.as_mut().unwrap();
        for window in ["main", "workspace-2", "workspace-empty"] {
            attempt.pause(window).unwrap();
        }
    }
    crate::ai_executor::prepare_close(app.handle(), "one").unwrap();
    let mut updates = super::super::Updates::new("1.0.0".into());
    updates.preparation = preparation;
    app.manage(updates);
    app
}

#[test]
fn sealing_rejects_late_retained_mutations_and_unchanged_release_reopens_them() {
    let app = sealing_app();
    let authorization =
        crate::workspaces::control_authorization_session(app.handle(), "main", "one").unwrap();
    let state = app.state::<super::super::Updates>();
    state
        .preparation
        .seal_for_install(app.handle(), "update-one")
        .unwrap();
    let late =
        crate::workspaces::with_retained_control(app.handle(), "main", &authorization, || {
            super::super::ensure_mutation_admitted(app.handle())?;
            Ok(crate::ai::tests::retain_update_activity(
                app.handle(),
                "one",
            ))
        });
    assert!(matches!(late, Err(error) if error == "native.updates.busy"));
    assert!(!crate::ai::has_running_actions(app.handle()).unwrap());
    state.preparation.unchanged(app.handle(), "update-one");
    assert!(!state.preparation.sealed.load(Ordering::Acquire));
    let activity =
        crate::workspaces::with_retained_control(app.handle(), "main", &authorization, || {
            super::super::ensure_mutation_admitted(app.handle())?;
            Ok(crate::ai::tests::retain_update_activity(
                app.handle(),
                "one",
            ))
        })
        .unwrap();
    assert!(crate::ai::has_running_actions(app.handle()).unwrap());
    drop(activity);
}

#[test]
fn work_admitted_before_sealing_prevents_installation_until_it_finishes() {
    let app = sealing_app();
    let authorization =
        crate::workspaces::control_authorization_session(app.handle(), "main", "one").unwrap();
    let worker_app = app.handle().clone();
    let (admitted, active) = std::sync::mpsc::channel();
    let (finish, waiting) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let activity =
            crate::workspaces::with_retained_control(&worker_app, "main", &authorization, || {
                super::super::ensure_mutation_admitted(&worker_app)?;
                Ok(crate::ai::tests::retain_update_activity(&worker_app, "one"))
            })
            .unwrap();
        admitted.send(()).unwrap();
        waiting.recv().unwrap();
        drop(activity);
    });
    active
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    let state = app.state::<super::super::Updates>();
    assert_eq!(
        state
            .preparation
            .seal_for_install(app.handle(), "update-one"),
        Err("native.updates.runningActions".into())
    );
    assert!(!state.preparation.sealed.load(Ordering::Acquire));
    finish.send(()).unwrap();
    worker.join().unwrap();
    state
        .preparation
        .seal_for_install(app.handle(), "update-one")
        .unwrap();
    assert!(state.preparation.sealed.load(Ordering::Acquire));
}

#[test]
fn status_recovers_a_missed_cancellation_without_exposing_other_windows() {
    let (preparation, _, _) = preparation();
    preparation.history.lock().unwrap().insert(
        "previous".into(),
        HashMap::from([(
            "main".into(),
            Status {
                state: "cancelled",
                workspace_ids: vec!["older".into()],
            },
        )]),
    );
    assert_eq!(
        preparation.status("main", "previous").unwrap().state,
        "cancelled"
    );
    assert!(preparation.status("workspace-2", "previous").is_err());
    assert_eq!(
        preparation.status("main", "update-one").unwrap().state,
        "pending"
    );
}
