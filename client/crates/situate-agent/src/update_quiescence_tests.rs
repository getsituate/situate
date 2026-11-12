use super::*;

#[tokio::test]
async fn quiescent_persistence_failure_keeps_the_exact_checkpoint_and_uncertainty() {
    for published in [false, true] {
        let host = Fixture::new();
        host.fail_at("input", published);
        let owner = Owner::open(host.clone()).await.unwrap();
        assert!(
            owner
                .submit("action".into(), "Retained input".into(), 10)
                .await
                .is_err()
        );
        let before = owner.snapshot().await.unwrap();
        assert_eq!(before.phase, Phase::PersistenceFailed);
        assert!(!before.task_active);
        assert!(owner.is_busy());
        let (pending, deferred) = {
            let state = owner.state.lock().await;
            assert!(!state.cleanup_required);
            (state.pending.clone(), state.deferred.clone())
        };
        let durable = host.durable();
        owner.cancel_retained();
        let quiescence = owner.quiescence().await;
        assert_eq!(quiescence.status, Quiescence::PersistenceFailed);
        assert_eq!(quiescence.action_id.as_deref(), Some("action"));
        assert!(owner.is_busy());
        assert!(owner.wait_idle().await.is_err());
        assert_eq!(host.durable(), durable);
        let state = owner.state.lock().await;
        assert_eq!(state.pending, pending);
        assert_eq!(state.deferred, deferred);
        assert_eq!(state.snapshot.record, before.record);
        assert_eq!(host.models.load(Ordering::SeqCst), 0);
        assert_eq!(host.effects.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn terminal_save_failure_keeps_its_run_identity_and_observed_effects() {
    for published in [false, true] {
        let host = Fixture::new();
        host.fail_at("final", published);
        let owner = Owner::open(host.clone()).await.unwrap();
        owner
            .submit("action".into(), "Write it".into(), 10)
            .await
            .unwrap();
        let before = tokio::time::timeout(std::time::Duration::from_secs(5), owner.settled())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(before.phase, Phase::PersistenceFailed);
        assert!(!before.task_active);
        let (pending, deferred) = {
            let state = owner.state.lock().await;
            assert!(!state.cleanup_required);
            (state.pending.clone(), state.deferred.clone())
        };
        let durable = host.durable();
        assert_eq!(host.models.load(Ordering::SeqCst), 2);
        assert_eq!(host.effects.load(Ordering::SeqCst), 1);
        owner.cancel_retained();
        let quiescence = owner.quiescence().await;
        assert_eq!(quiescence.status, Quiescence::PersistenceFailed);
        assert_eq!(quiescence.action_id.as_deref(), Some("action"));
        assert_eq!(host.durable(), durable);
        assert_eq!(host.models.load(Ordering::SeqCst), 2);
        assert_eq!(host.effects.load(Ordering::SeqCst), 1);
        let state = owner.state.lock().await;
        assert_eq!(state.pending, pending);
        assert_eq!(state.deferred, deferred);
        assert_eq!(state.snapshot.record, before.record);
    }
}

#[tokio::test]
async fn captured_quiescence_remains_available_after_session_authorization_expires() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    host.live.store(false, Ordering::SeqCst);
    assert!(owner.snapshot().await.is_err());
    assert_eq!(owner.quiescence().await.status, Quiescence::Idle);
    assert!(!owner.is_busy());
}

#[tokio::test]
async fn inactive_task_does_not_hide_an_unresolved_cleanup_obligation() {
    let host = Fixture::new();
    host.fail_at("input", false);
    let owner = Owner::open(host).await.unwrap();
    assert!(
        owner
            .submit("action".into(), "Retained input".into(), 10)
            .await
            .is_err()
    );
    {
        let mut state = owner.state.lock().await;
        assert!(!state.snapshot.task_active);
        state.cleanup_required = true;
    }
    assert_eq!(owner.quiescence().await.status, Quiescence::CleanupRequired);
    assert!(owner.state.lock().await.cleanup_required);
    assert!(owner.is_busy());
}

#[tokio::test]
async fn queued_mutation_is_active_before_its_worker_starts() {
    let owner = Owner::open(Fixture::new()).await.unwrap();
    let action = owner.actions.lock().await;
    let writing = owner.clone();
    let write = tokio::spawn(async move { writing.edit_draft("", "New draft".into()).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while owner.pending_mutations.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!owner.state.lock().await.snapshot.task_active);
    assert_eq!(owner.quiescence().await.status, Quiescence::Active);
    drop(action);
    write.await.unwrap().unwrap();
    assert_eq!(owner.quiescence().await.status, Quiescence::Idle);
}
