use super::*;

fn attempt() -> (Quit, Arc<Session>, Arc<Session>) {
    let first = Arc::new(Session::default());
    let second = Arc::new(Session::default());
    let quit = Quit {
        pending: Mutex::new(Some(QuitAttempt {
            token: "current".into(),
            participants: HashMap::from([
                ("first".into(), vec![first.clone()]),
                ("second".into(), vec![second.clone()]),
            ]),
            ready: HashSet::new(),
        })),
        approved: AtomicBool::new(false),
        records: Mutex::new(HashMap::from([(
            "current".into(),
            QuitRecord {
                sequence: 1,
                state: QuitStatusKind::Pending,
                workspaces: HashMap::from([
                    ("first".into(), vec!["one".into()]),
                    ("second".into(), vec!["two".into()]),
                ]),
            },
        )])),
    };
    (quit, first, second)
}

#[test]
fn failed_cancellation_broadcast_is_recoverable_and_retry_does_not_repeat_rollback() {
    let (quit, first, second) = attempt();
    acknowledge_quit(&mut quit.pending.lock().unwrap(), "first", "current").unwrap();
    let result = quit.cancel("second", "current", || Err("Event delivery failed".into()));
    assert_eq!(result.unwrap_err(), "Event delivery failed");
    assert!(quit.pending.lock().unwrap().is_none());
    assert_eq!(
        quit.status("first", "current").unwrap(),
        QuitStatus {
            sequence: 1,
            state: QuitStatusKind::Cancelled,
            workspace_ids: vec!["one".into()],
        }
    );
    assert_eq!(
        quit.status("second", "current").unwrap().workspace_ids,
        ["two"]
    );
    quit.cancel("first", "current", || {
        panic!("An already cancelled attempt needs no broadcast")
    })
    .unwrap();
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
    assert!(quit.status("unrelated-window", "current").is_err());
    assert!(quit.status("first", "unknown-token").is_err());
    assert!(
        quit.cancel("unrelated-window", "current", || Ok(()))
            .is_err()
    );
}

#[test]
fn late_cancellation_of_an_old_token_does_not_cancel_a_new_attempt() {
    let (quit, _, _) = attempt();
    quit.cancel("first", "current", || Ok(())).unwrap();
    let (next, _, _) = attempt();
    let mut next_attempt = next.pending.into_inner().unwrap().unwrap();
    next_attempt.token = "next".into();
    *quit.pending.lock().unwrap() = Some(next_attempt);
    quit.records.lock().unwrap().insert(
        "next".into(),
        QuitRecord {
            sequence: 2,
            state: QuitStatusKind::Pending,
            workspaces: HashMap::from([("first".into(), vec!["one".into()])]),
        },
    );
    quit.cancel("first", "current", || {
        panic!("The old cancellation must be idempotent")
    })
    .unwrap();
    assert_eq!(
        quit.status("first", "next").unwrap().state,
        QuitStatusKind::Pending
    );
    quit.pending
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .require("first", "next")
        .unwrap();
}

#[test]
fn quit_detaches_only_after_all_windows_acknowledge() {
    let (quit, first, second) = attempt();
    let mut pending = quit.pending.lock().unwrap();
    assert_eq!(quit.phase(&pending), QuitPhase::Preparing);
    assert_eq!(
        acknowledge_quit(&mut pending, "first", "current").unwrap(),
        QuitOutcome::AwaitingWindows
    );
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
    assert_eq!(
        acknowledge_quit(&mut pending, "first", "current").unwrap(),
        QuitOutcome::AwaitingWindows
    );
    assert!(acknowledge_quit(&mut pending, "second", "obsolete").is_err());
    assert!(acknowledge_quit(&mut pending, "unknown", "current").is_err());
    assert_eq!(
        acknowledge_quit(&mut pending, "second", "current").unwrap(),
        QuitOutcome::Approved
    );
    assert!(first.detached.load(Ordering::Acquire));
    assert!(second.detached.load(Ordering::Acquire));
}

#[test]
fn cancellation_rejects_late_acknowledgment_without_detaching_any_workspace() {
    let (quit, first, second) = attempt();
    let mut pending = quit.pending.lock().unwrap();
    acknowledge_quit(&mut pending, "first", "current").unwrap();
    assert!(cancel_attempt(&mut pending, "second", "obsolete").is_err());
    assert_eq!(quit.phase(&pending), QuitPhase::Preparing);
    cancel_attempt(&mut pending, "second", "current").unwrap();
    assert_eq!(quit.phase(&pending), QuitPhase::Idle);
    assert!(acknowledge_quit(&mut pending, "second", "current").is_err());
    assert!(!first.detached.load(Ordering::Acquire));
    assert!(!second.detached.load(Ordering::Acquire));
}
