use crate::*;

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Update {
    Snapshot {
        position: u64,
        snapshot: Arc<Snapshot>,
    },
    Progress {
        position: u64,
        partial_message: Option<Arc<Value>>,
        activity_comment: String,
        question_busy: bool,
    },
}
impl Update {
    pub fn position(&self) -> u64 {
        match self {
            Self::Snapshot { position, .. } | Self::Progress { position, .. } => *position,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum SubscriptionError {
    Gap,
    Closed,
}

pub struct Subscription {
    receiver: tokio::sync::broadcast::Receiver<Update>,
    next: u64,
}
impl Subscription {
    pub async fn recv(&mut self) -> Result<Update, SubscriptionError> {
        match self.receiver.recv().await {
            Ok(update) if update.position() == self.next => {
                self.next += 1;
                Ok(update)
            }
            Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                Err(SubscriptionError::Gap)
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => Err(SubscriptionError::Closed),
        }
    }
}
impl<H: Host> Owner<H> {
    /// Snapshot and receiver share the state lock. A lagged receiver must attach
    /// again; event positions are correlation data, not authorization or run leases.
    pub async fn subscribe(&self) -> Result<(Snapshot, Subscription), String> {
        let state = self.state.lock().await;
        self.host.validate_session()?;
        let receiver = self.updates.subscribe();
        let snapshot = self.projected_snapshot(&state);
        let next = snapshot.position + 1;
        Ok((snapshot, Subscription { receiver, next }))
    }

    pub(crate) fn projected_snapshot(&self, state: &State) -> Snapshot {
        let mut snapshot = state.snapshot.clone();
        snapshot.task_active |= self.pending_mutations.load(Ordering::SeqCst) != 0;
        snapshot
    }

    pub(crate) fn publish(&self, state: &mut State) {
        self.busy.store(
            state.snapshot.task_active
                || state.snapshot.phase == Phase::PersistenceFailed
                || state.cleanup_required
                || state.snapshot.question_busy,
            Ordering::SeqCst,
        );
        state.snapshot.position = state
            .snapshot
            .position
            .checked_add(1)
            .expect("conversation position exhausted");
        let _ = self.updates.send(Update::Snapshot {
            position: state.snapshot.position,
            snapshot: Arc::new(self.projected_snapshot(state)),
        });
        self.changed.notify_waiters();
    }

    pub(crate) fn publish_progress(&self, state: &mut State) {
        self.busy.store(
            state.snapshot.task_active
                || state.snapshot.phase == Phase::PersistenceFailed
                || state.cleanup_required
                || state.snapshot.question_busy,
            Ordering::SeqCst,
        );
        state.snapshot.position = state
            .snapshot
            .position
            .checked_add(1)
            .expect("conversation position exhausted");
        let _ = self.updates.send(Update::Progress {
            position: state.snapshot.position,
            partial_message: state.snapshot.partial_message.clone().map(Arc::new),
            activity_comment: state.snapshot.activity_comment.clone(),
            question_busy: state.snapshot.question_busy,
        });
        self.changed.notify_waiters();
    }
}
