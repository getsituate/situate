use crate::files::CoordinatedAccess;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

const CLEANUP_FAILED: &str = "native.provider.coordination.failed";
type Closer = Box<dyn FnMut() -> Result<(), String> + Send + Sync + 'static>;
type Resource = Arc<Mutex<Closer>>;

struct Failed {
    resource: Resource,
    error: String,
}

#[derive(Default)]
struct State {
    guards: usize,
    running: usize,
    failed: Vec<Failed>,
}

#[derive(Default)]
pub(crate) struct Releases {
    state: Mutex<State>,
    changed: Notify,
    settling: tokio::sync::Mutex<()>,
}

pub(crate) struct StorageGuard {
    releases: Arc<Releases>,
    resource: Option<Resource>,
}

impl Releases {
    pub(crate) fn guard(self: &Arc<Self>, mut access: CoordinatedAccess) -> StorageGuard {
        self.guard_closer(Box::new(move || access.finish()))
    }

    fn guard_closer(self: &Arc<Self>, closer: Closer) -> StorageGuard {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .guards += 1;
        StorageGuard {
            releases: self.clone(),
            resource: Some(Arc::new(Mutex::new(closer))),
        }
    }

    pub(crate) fn track_failed(self: &Arc<Self>, mut access: CoordinatedAccess, error: String) {
        self.track_failed_closer(Box::new(move || access.finish()), error);
    }

    fn track_failed_closer(&self, closer: Closer, error: String) {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .failed
            .push(Failed {
                resource: Arc::new(Mutex::new(closer)),
                error,
            });
        self.changed.notify_waiters();
    }

    pub(crate) fn is_active(&self) -> bool {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.guards != 0 || state.running != 0 || !state.failed.is_empty()
    }

    /// Each accepted settle owns one retry pass, even if its waiter disconnects.
    pub(crate) async fn settle(self: &Arc<Self>) -> Result<(), String> {
        let releases = self.clone();
        tokio::spawn(async move {
            let _settling = releases.settling.lock().await;
            releases.wait_owned().await;
            let failed = {
                let mut state = releases
                    .state
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                let failed = std::mem::take(&mut state.failed);
                state.running += failed.len();
                failed
            };
            for entry in failed {
                releases.dispatch(entry.resource);
            }
            loop {
                let changed = releases.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                {
                    let state = releases
                        .state
                        .lock()
                        .unwrap_or_else(|error| error.into_inner());
                    if state.guards == 0 && state.running == 0 {
                        return state
                            .failed
                            .first()
                            .map_or(Ok(()), |entry| Err(entry.error.clone()));
                    }
                }
                changed.await;
            }
        })
        .await
        .map_err(|_| CLEANUP_FAILED.to_owned())?
    }

    async fn wait_owned(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            {
                let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
                if state.guards == 0 && state.running == 0 {
                    return;
                }
            }
            changed.await;
        }
    }

    fn dispatch(self: &Arc<Self>, resource: Resource) {
        let releases = self.clone();
        let closing = resource.clone();
        // The resource remains retained here if the blocking worker cannot start.
        if std::thread::Builder::new()
            .name("situate-storage-release".into())
            .spawn(move || {
                let result = {
                    let mut closer = closing.lock().unwrap_or_else(|error| error.into_inner());
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut *closer))
                        .unwrap_or_else(|_| Err(CLEANUP_FAILED.into()))
                };
                releases.complete(closing, result);
            })
            .is_err()
        {
            self.complete(resource, Err(CLEANUP_FAILED.into()));
        }
    }

    fn complete(&self, resource: Resource, result: Result<(), String>) {
        {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.running -= 1;
            if let Err(error) = result {
                state.failed.push(Failed { resource, error });
            }
        }
        self.changed.notify_waiters();
    }
}

impl Drop for StorageGuard {
    fn drop(&mut self) {
        if let Some(resource) = self.resource.take() {
            {
                let mut state = self
                    .releases
                    .state
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                state.guards -= 1;
                state.running += 1;
            }
            self.releases.dispatch(resource);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Barrier,
        atomic::{AtomicUsize, Ordering},
    };

    #[tokio::test]
    async fn failed_releases_remain_busy_and_each_settle_retries_the_same_resource_once() {
        fn send_sync_static<T: Send + Sync + 'static>() {}
        send_sync_static::<StorageGuard>();
        let releases = Arc::new(Releases::default());
        let attempts = Arc::new(AtomicUsize::new(0));
        let observed = Arc::new(Mutex::new(Vec::new()));
        let calls = attempts.clone();
        let identities = observed.clone();
        let guard = releases.guard_closer(Box::new(move || {
            identities.lock().unwrap().push(7);
            if calls.fetch_add(1, Ordering::SeqCst) < 2 {
                Err("close-failed".into())
            } else {
                Ok(())
            }
        }));
        assert!(releases.is_active());
        drop(guard);
        releases.wait_owned().await;
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(releases.is_active());
        assert_eq!(releases.settle().await, Err("close-failed".into()));
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert!(releases.is_active());
        releases.settle().await.unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        assert_eq!(*observed.lock().unwrap(), vec![7, 7, 7]);
        assert!(!releases.is_active());
        releases.settle().await.unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn raw_failed_resources_are_retained_without_an_automatic_retry() {
        let releases = Arc::new(Releases::default());
        let attempts = Arc::new(AtomicUsize::new(0));
        let calls = attempts.clone();
        releases.track_failed_closer(
            Box::new(move || {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }),
            "lost-acknowledgement".into(),
        );
        assert!(releases.is_active());
        assert_eq!(attempts.load(Ordering::SeqCst), 0);
        releases.settle().await.unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(!releases.is_active());
    }

    #[tokio::test]
    async fn dropping_a_settle_waiter_preserves_its_blocked_retry_and_later_failure() {
        let releases = Arc::new(Releases::default());
        let entered = Arc::new(Notify::new());
        let finish = Arc::new(Barrier::new(2));
        let observed = entered.clone();
        let closing = finish.clone();
        let attempts = Arc::new(AtomicUsize::new(0));
        let calls = attempts.clone();
        releases.track_failed_closer(
            Box::new(move || {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    observed.notify_one();
                    closing.wait();
                    Err("close-still-failed".into())
                } else {
                    Ok(())
                }
            }),
            "close-failed".into(),
        );
        let waiter_releases = releases.clone();
        let waiter = tokio::spawn(async move { waiter_releases.settle().await });
        entered.notified().await;
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        assert!(releases.is_active());
        finish.wait();
        releases.wait_owned().await;
        assert!(releases.is_active());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        releases.settle().await.unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert!(!releases.is_active());
    }

    #[tokio::test]
    async fn settle_does_not_close_a_resource_while_its_storage_guard_is_still_live() {
        let releases = Arc::new(Releases::default());
        let attempts = Arc::new(AtomicUsize::new(0));
        let calls = attempts.clone();
        let guard = releases.guard_closer(Box::new(move || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }));
        let mut waiting = Box::pin(releases.settle());
        std::future::poll_fn(|context| {
            assert!(waiting.as_mut().poll(context).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        assert_eq!(attempts.load(Ordering::SeqCst), 0);
        assert!(releases.is_active());
        drop(guard);
        waiting.await.unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(!releases.is_active());
    }

    #[tokio::test]
    async fn a_panicking_close_is_retained_as_unknown_until_an_explicit_retry_succeeds() {
        let releases = Arc::new(Releases::default());
        let attempts = Arc::new(AtomicUsize::new(0));
        let calls = attempts.clone();
        let guard = releases.guard_closer(Box::new(move || {
            assert_ne!(calls.fetch_add(1, Ordering::SeqCst), 0, "close interrupted");
            Ok(())
        }));
        drop(guard);
        releases.wait_owned().await;
        assert!(releases.is_active());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        releases.settle().await.unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert!(!releases.is_active());
    }
}
