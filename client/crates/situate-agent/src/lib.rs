use rig_agent::run::{AgentRun, AgentRunStep, ModelTurnOutcome};
pub use rig_core::completion::ToolDefinition;
use serde::Serialize;
use serde_json::{Value, json};
use situate_core::{
    ConversationRecord,
    conversation_history::{ConversationContext, ConversationMetadata, HistoryEntry},
    conversation_runtime::{Event, Run},
};
use std::{
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

mod context;
mod persistence;
mod projection;
mod transcript;
#[derive(Clone, Debug, Serialize)]
pub struct ToolResult {
    pub content: Vec<Value>,
    pub details: Value,
    #[serde(rename = "structuredContent", skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
    #[serde(skip)]
    pub is_error: bool,
}
impl ToolResult {
    pub fn json(value: Value) -> Self {
        Self {
            content: vec![json!({"type":"text","text":value.to_string()})],
            is_error: value["isError"] == true,
            details: value,
            structured_content: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum ToolOutcome {
    Completed(ToolResult),
    Failed(String),
    /// The host has revoked this executor generation and settled native cleanup.
    /// The effect may have happened; neither the owner nor a new executor may replay it.
    Disconnected {
        generation: u64,
        observations: Vec<Value>,
    },
}

mod auxiliary;
mod contracts;
pub use contracts::*;
mod actions;
mod compaction;
mod execution;
mod questions;
pub use questions::validate as validate_question;
mod subscription;
pub use subscription::{Subscription, SubscriptionError, Update};

#[derive(Clone, Debug)]
pub struct SaveFailure {
    pub error: String,
}
impl From<String> for SaveFailure {
    fn from(error: String) -> Self {
        Self { error }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Running,
    PersistenceFailed,
    Interrupted,
}

/// Host admission and operation leases must also settle before shutdown can proceed.
/// A quiescent persistence failure still retains its checkpoint and is not idle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Quiescence {
    Idle,
    PersistenceFailed,
    CleanupRequired,
    Active,
}

#[derive(Clone, Debug)]
pub struct QuiescenceSnapshot {
    pub status: Quiescence,
    pub action_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub record: ConversationRecord,
    pub message_entry_ids: Vec<String>,
    pub selected_entry_id: Option<String>,
    pub history_before: Option<String>,
    pub message_offset: usize,
    pub event_offset: usize,
    pub has_history: bool,
    pub phase: Phase,
    pub action_id: Option<String>,
    pub error: Option<String>,
    pub task_active: bool,
    pub position: u64,
    pub partial_message: Option<Value>,
    pub activity_comment: String,
    pub question_busy: bool,
}

struct State {
    snapshot: Snapshot,
    cancel: CancellationToken,
    pending: Option<ConversationRecord>,
    deferred: Option<ConversationRecord>,
    cleanup_required: bool,
    title_epoch: u64,
    metadata: ConversationMetadata,
    saved: ConversationRecord,
    batch: Option<persistence::Batch>,
    resolved_inputs: std::collections::HashMap<String, Value>,
    input_entry_ids: std::collections::HashMap<String, String>,
    active_inputs: Vec<String>,
    draft_receipts: std::collections::HashMap<String, Value>,
    context_truncated: bool,
}

struct PendingMutation<H: Host> {
    owner: Arc<Owner<H>>,
    armed: bool,
}
impl<H: Host> PendingMutation<H> {
    fn release(&mut self) {
        if self.armed {
            self.owner.pending_mutations.fetch_sub(1, Ordering::SeqCst);
            self.owner.changed.notify_waiters();
            self.armed = false;
        }
    }
}
impl<H: Host> Drop for PendingMutation<H> {
    fn drop(&mut self) {
        if self.armed {
            self.release();
            let owner = self.owner.clone();
            tokio::spawn(async move {
                let mut state = owner.state.lock().await;
                owner.publish(&mut state);
            });
        }
    }
}

/// One instance is retained by the application for one conversation and workspace session.
/// Views may drop every snapshot without cancelling its task.
pub struct Owner<H: Host> {
    host: Arc<H>,
    state: Mutex<State>,
    actions: Mutex<()>,
    pending_mutations: AtomicUsize,
    changed: Notify,
    stop: std::sync::Mutex<CancellationToken>,
    updates: tokio::sync::broadcast::Sender<Update>,
    cancel_run: std::sync::Mutex<Option<(String, CancellationToken)>>,
    receipts: std::sync::Mutex<std::collections::HashMap<String, Value>>,
    busy: AtomicBool,
    aux_cancel: std::sync::Mutex<Option<CancellationToken>>,
    title_cancel: std::sync::Mutex<Option<CancellationToken>>,
    aux_tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl<H: Host> Owner<H> {
    pub async fn open(host: Arc<H>) -> Result<Arc<Self>, String> {
        host.validate_session()?;
        let context = host.load().await?;
        let (mut record, message_entry_ids) = persistence::project(&context)?;
        if let Some(runtime) = &mut record.runtime {
            for event in &mut runtime.events {
                if let Some(id) = event.data["resultEntryId"].as_str() {
                    let original = host
                        .entry(id.to_owned())
                        .await?
                        .ok_or("native.ai.conversation.versionInvalid")?;
                    event.data["result"] = persistence::tool_result(&original.data["message"]);
                }
            }
        }
        let saved = record.clone();
        if record.version != 2 {
            return Err("native.ai.conversation.versionInvalid".into());
        }
        let mut interrupted = false;
        if let Some(runtime) = &mut record.runtime {
            for run in &mut runtime.runs {
                if run.state == "running" {
                    run.state = "interrupted".into();
                    interrupted = true;
                }
            }
        }
        let receipts = record
            .runtime
            .as_ref()
            .map(|r| {
                r.events
                    .iter()
                    .filter(|e| e.kind == "action_accepted")
                    .map(|e| (e.run_id.clone(), e.data["action"].clone()))
                    .collect()
            })
            .unwrap_or_default();
        let owner = Arc::new(Self {
            host,
            state: Mutex::new(State {
                snapshot: Snapshot {
                    phase: if record
                        .runtime
                        .as_ref()
                        .and_then(|r| r.runs.last())
                        .is_some_and(|run| run.state != "completed")
                    {
                        Phase::Interrupted
                    } else {
                        Phase::Idle
                    },
                    action_id: record
                        .runtime
                        .as_ref()
                        .and_then(|r| r.runs.last())
                        .map(|run| run.id.clone()),
                    message_entry_ids,
                    selected_entry_id: context.metadata.selected_entry_id.clone(),
                    history_before: context.entries.first().map(|entry| entry.id.clone()),
                    message_offset: context.message_offset,
                    event_offset: context.event_offset,
                    has_history: context.metadata.message_count > 0,
                    record,
                    error: None,
                    task_active: false,
                    position: 0,
                    partial_message: None,
                    activity_comment: String::new(),
                    question_busy: false,
                },
                cancel: CancellationToken::new(),
                pending: None,
                deferred: None,
                cleanup_required: false,
                title_epoch: 0,
                metadata: context.metadata,
                saved,
                batch: None,
                resolved_inputs: Default::default(),
                input_entry_ids: context
                    .entries
                    .iter()
                    .chain(context.active_entries.iter())
                    .filter_map(|entry| {
                        entry.data["input"]["id"]
                            .as_str()
                            .map(|id| (id.to_owned(), entry.id.clone()))
                    })
                    .collect(),
                active_inputs: vec![],
                draft_receipts: Default::default(),
                context_truncated: context.truncated,
            }),
            actions: Mutex::new(()),
            pending_mutations: AtomicUsize::new(0),
            changed: Notify::new(),
            stop: std::sync::Mutex::new(CancellationToken::new()),
            updates: tokio::sync::broadcast::channel(8).0,
            cancel_run: std::sync::Mutex::new(None),
            receipts: std::sync::Mutex::new(receipts),
            busy: AtomicBool::new(false),
            aux_cancel: std::sync::Mutex::new(None),
            title_cancel: std::sync::Mutex::new(None),
            aux_tasks: Mutex::new(Vec::new()),
        });
        if interrupted {
            let mut state = owner.state.lock().await;
            let record = state.snapshot.record.clone();
            let _ = owner.persist(&mut state, record).await;
        }
        Ok(owner)
    }

    pub fn is_busy(&self) -> bool {
        self.pending_mutations.load(Ordering::SeqCst) != 0 || self.busy.load(Ordering::SeqCst)
    }

    /// Inspects an already captured owner without fresh workspace authorization.
    /// IPC callers must be authorized separately before obtaining this handle.
    pub async fn quiescence(&self) -> QuiescenceSnapshot {
        let state = self.state.lock().await;
        let status =
            if state.snapshot.task_active || self.pending_mutations.load(Ordering::SeqCst) != 0 {
                Quiescence::Active
            } else if state.cleanup_required {
                Quiescence::CleanupRequired
            } else if state.snapshot.phase == Phase::PersistenceFailed {
                Quiescence::PersistenceFailed
            } else if state.snapshot.question_busy || state.snapshot.phase == Phase::Running {
                Quiescence::Active
            } else {
                Quiescence::Idle
            };
        QuiescenceSnapshot {
            status,
            action_id: state.snapshot.action_id.clone(),
        }
    }

    pub async fn snapshot(&self) -> Result<Snapshot, String> {
        let state = self.state.lock().await;
        self.host.validate_session()?;
        Ok(self.projected_snapshot(&state))
    }

    pub async fn edit_draft(
        self: &Arc<Self>,
        expected: &str,
        draft: String,
    ) -> Result<Snapshot, String> {
        let expected = expected.to_owned();
        self.mutate(move |owner| async move { owner.save_draft(&expected, draft).await })
            .await
    }

    async fn save_draft(&self, expected: &str, draft: String) -> Result<Snapshot, String> {
        let mut state = self.state.lock().await;
        self.host.validate_session()?;
        if state.snapshot.record.draft != expected {
            return Err("native.ai.conversation.conflict".into());
        }
        if state.snapshot.phase == Phase::PersistenceFailed {
            return Err("native.ai.conversation.saveFailed".into());
        }
        state.snapshot.record.draft = draft;
        self.publish(&mut state);
        Ok(state.snapshot.clone())
    }

    pub async fn submit(
        self: &Arc<Self>,
        action_id: String,
        text: String,
        timestamp: u64,
    ) -> Result<Snapshot, String> {
        self.apply(
            action_id,
            json!({"version":1,"type":"submit","input":{
            "text":text,"attachments":[],"references":[]},"timestamp":timestamp}),
        )
        .await
    }

    async fn admit(
        self: &Arc<Self>,
        action_id: String,
        input: Input,
        timestamp: u64,
        cancel: CancellationToken,
        action: Value,
    ) -> Result<Snapshot, String> {
        let mut state = self.state.lock().await;
        self.host.validate_session()?;
        if state.snapshot.task_active
            || state.snapshot.question_busy
            || matches!(
                state.snapshot.phase,
                Phase::Running | Phase::PersistenceFailed
            )
        {
            return Err("native.ai.response.finishFirst".into());
        }
        self.retire_questions(&mut state, &action_id).await?;
        state.active_inputs.clear();
        let retained: std::collections::HashSet<_> =
            state.snapshot.message_entry_ids.iter().cloned().collect();
        state.resolved_inputs.retain(|id, _| retained.contains(id));
        if questions::pending(&state.snapshot.record).is_some()
            || questions::action_pending(&state.snapshot.record).is_some()
        {
            return Err("chatQuestion.busy".into());
        }
        let mut record = state.snapshot.record.clone();
        let first = !record
            .messages
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["role"] == "user")
            && !record.runtime.as_ref().is_some_and(|r| {
                r.events.iter().any(|e| {
                    e.kind == "action_accepted" && e.data["action"]["type"] == "renameTitle"
                })
            });
        if first {
            let title = auxiliary::provisional_title(&input.text);
            if !title.is_empty() {
                record.title = title;
            }
        }
        record
            .messages
            .as_array_mut()
            .unwrap()
            .push(persistence::original(&input, timestamp));
        let runtime = record.runtime.get_or_insert_default();
        runtime
            .pending
            .push(situate_core::conversation_runtime::Pending {
                id: action_id.clone(),
                kind: "steering".into(),
                state: "pending".into(),
                text: input.text.clone(),
                attachments: input.attachments.clone(),
                references: input.references.clone(),
                timestamp,
            });
        runtime.runs.push(Run {
            id: action_id.clone(),
            state: "running".into(),
            started_at: timestamp,
            ended_at: None,
            usage: None,
            references: input.references.clone(),
        });
        if actions::draft(&record) == input {
            actions::set_draft(&mut record, Input::default());
        }
        append_event(
            &mut record,
            &action_id,
            "action_accepted",
            json!({"action":action}),
        );
        let start_count = state.metadata.message_count;
        append_event(
            &mut record,
            &action_id,
            "work_block_start",
            json!({
                "workId":action_id,"startMessageCount":start_count,"startedAt":timestamp
            }),
        );
        append_event(
            &mut record,
            &action_id,
            "input_accepted",
            json!({"input":input}),
        );
        state.cancel = cancel;
        state.snapshot.action_id = Some(action_id.clone());
        *self.cancel_run.lock().unwrap_or_else(|e| e.into_inner()) =
            Some((action_id.clone(), state.cancel.clone()));
        self.persist(&mut state, record).await?;
        state.snapshot.phase = Phase::Running;
        state.snapshot.task_active = true;
        self.publish(&mut state);
        let snapshot = state.snapshot.clone();
        let cancel = state.cancel.clone();
        drop(state);
        let run = AgentRun::new("Continue the admitted conversation").max_turns(128);
        let owner = self.clone();
        let worker = tokio::spawn(owner.clone().drive(run, action_id, timestamp, cancel));
        tokio::spawn(async move {
            if worker.await.is_err() {
                let _action = owner.actions.lock().await;
                owner.worker_failed(true).await;
            }
        });
        Ok(snapshot)
    }

    /// Cancels an already captured owner without acquiring workspace/admission locks.
    /// IPC callers must be authorized separately before obtaining this handle.
    pub fn cancel_retained(&self) {
        let mut stop = self.stop.lock().unwrap_or_else(|error| error.into_inner());
        stop.cancel();
        *stop = CancellationToken::new();
        if let Some((_, cancel)) = self
            .cancel_run
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            cancel.cancel();
        }
        if let Some(cancel) = self
            .aux_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            cancel.cancel();
        }
        if let Some(cancel) = self
            .title_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            cancel.cancel();
        }
    }

    pub fn cancel_run_retained(&self, run_id: &str) -> bool {
        let active = self.cancel_run.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((id, cancel)) = active.as_ref()
            && id == run_id
        {
            cancel.cancel();
            true
        } else {
            false
        }
    }

    /// Retries the retained domain checkpoint only. Never restarts Rig or effects.
    pub async fn retry_persistence(self: &Arc<Self>) -> Result<Snapshot, String> {
        self.mutate(|owner| async move { owner.retry_checkpoint().await })
            .await
    }

    async fn retry_checkpoint(self: &Arc<Self>) -> Result<Snapshot, String> {
        let cleanup = {
            let state = self.state.lock().await;
            state.cleanup_required.then(|| {
                (
                    state.snapshot.action_id.clone().unwrap_or_default(),
                    state.cancel.clone(),
                )
            })
        };
        if let Some((id, cancel)) = cleanup {
            self.drain_host(id, cancel).await?;
            let mut state = self.state.lock().await;
            state.cleanup_required = false;
            state.snapshot.task_active = false;
            state.snapshot.question_busy = false;
        }
        let mut state = self.state.lock().await;
        self.host.validate_session()?;
        if state.snapshot.task_active {
            return Err("native.ai.response.finishFirst".into());
        }
        if state.snapshot.phase != Phase::PersistenceFailed {
            return Ok(state.snapshot.clone());
        }
        let exact = state
            .pending
            .clone()
            .ok_or("native.ai.conversation.saveFailed")?;
        self.persist(&mut state, exact).await?;
        let mut record = state
            .deferred
            .take()
            .unwrap_or_else(|| state.snapshot.record.clone());
        record.revision = state.snapshot.record.revision;
        if let Some(run) = record
            .runtime
            .as_mut()
            .and_then(|runtime| runtime.runs.last_mut())
            && run.state == "running"
        {
            run.state = "interrupted".into();
            run.ended_at = Some(self.host.now_ms().max(run.started_at));
        }
        let completed = record
            .runtime
            .as_ref()
            .and_then(|runtime| runtime.runs.last())
            .is_some_and(|run| run.state == "completed");
        self.persist(&mut state, record).await?;
        state.snapshot.phase = if completed {
            Phase::Idle
        } else {
            Phase::Interrupted
        };
        self.publish(&mut state);
        Ok(state.snapshot.clone())
    }

    // Accepted mutations outlive their reply channel; the gate also orders panic recovery.
    async fn mutate<E, F, Fut>(self: &Arc<Self>, action: F) -> Result<Snapshot, E>
    where
        E: From<String> + Send + 'static,
        F: FnOnce(Arc<Self>) -> Fut + Send + 'static,
        Fut: Future<Output = Result<Snapshot, E>> + Send + 'static,
    {
        let owner = self.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        self.pending_mutations.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(async move {
            let mut pending = PendingMutation {
                owner: owner.clone(),
                armed: true,
            };
            let _action = owner.actions.lock().await;
            let worker = tokio::spawn(action(owner.clone()));
            let result = match worker.await {
                Ok(result) => result,
                Err(_) => {
                    owner.worker_failed(false).await;
                    Err(E::from("native.ai.request.failed".to_owned()))
                }
            };
            let snapshot = owner.finalize_mutation(&mut pending).await;
            let _ = send.send(result.map(|_| snapshot));
        });
        receive
            .await
            .map_err(|_| E::from("native.ai.request.failed".to_owned()))?
    }

    async fn finalize_mutation(&self, pending: &mut PendingMutation<H>) -> Snapshot {
        pending.release();
        let mut state = self.state.lock().await;
        self.publish(&mut state);
        self.projected_snapshot(&state)
    }

    async fn worker_failed(self: &Arc<Self>, execution_terminated: bool) {
        let (id, cancel) = {
            let mut state = self.state.lock().await;
            state.cancel.cancel();
            state.cleanup_required = true;
            (
                state.snapshot.action_id.clone().unwrap_or_default(),
                state.cancel.clone(),
            )
        };
        self.stop_auxiliaries().await;
        let drained = self.drain_host(id, cancel).await.is_ok();
        let mut state = self.state.lock().await;
        state.cleanup_required = !drained;
        state.snapshot.question_busy = false;
        let mut record = state
            .deferred
            .clone()
            .or_else(|| state.pending.clone())
            .unwrap_or_else(|| state.snapshot.record.clone());
        if let Some(run) = record
            .runtime
            .as_mut()
            .and_then(|runtime| runtime.runs.last_mut())
            && run.state == "running"
        {
            run.state = "error".into();
            let action = run.id.clone();
            append_event(
                &mut record,
                &action,
                "execution_finished",
                json!({"state":"error","error":"native.ai.request.failed"}),
            );
        }
        if state.pending.is_none() {
            state.pending = Some(state.snapshot.record.clone());
        }
        if let Some(partial) = state.snapshot.partial_message.clone()
            && let Ok(message) = transcript::interrupted(partial, self.host.now_ms(), false)
        {
            record.messages.as_array_mut().unwrap().push(message);
            state.snapshot.partial_message = None;
        }
        state.deferred = Some(record.clone());
        state.snapshot.record = record;
        state.snapshot.phase = Phase::PersistenceFailed;
        state.snapshot.error = Some("native.ai.request.failed".into());
        if execution_terminated {
            state.snapshot.task_active = !drained;
        }
        self.publish(&mut state);
    }

    /// An error leaves the owner retained and busy; it is not permission to
    /// release a failed persistence checkpoint or independently draining work.
    pub async fn wait_idle(&self) -> Result<(), String> {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let snapshot = self.snapshot().await?;
            if snapshot.phase == Phase::PersistenceFailed {
                return Err(snapshot
                    .error
                    .unwrap_or_else(|| "native.ai.conversation.saveFailed".into()));
            }
            if !snapshot.task_active {
                return Ok(());
            }
            changed.await;
        }
    }

    pub async fn settled(&self) -> Result<Snapshot, String> {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let snapshot = self.snapshot().await?;
            if !snapshot.task_active {
                return Ok(snapshot);
            }
            changed.await;
        }
    }

    async fn persist(
        &self,
        state: &mut State,
        mut record: ConversationRecord,
    ) -> Result<(), String> {
        match self.host.validate_session() {
            Ok(()) => {}
            Err(error) => {
                state.cancel.cancel();
                state.snapshot.phase = Phase::Interrupted;
                state.snapshot.error = Some(error.clone());
                self.changed.notify_waiters();
                return Err(error);
            }
        }
        let phase = state.snapshot.phase;
        state.pending = Some(record.clone());
        state.snapshot.phase = Phase::PersistenceFailed;
        self.busy.store(true, Ordering::SeqCst);
        match self.save_projection(state, &mut record).await {
            Ok(()) => {
                state.pending = None;
                state.snapshot.record = record;
                state.snapshot.record.revision = state.metadata.revision;
                state.snapshot.phase = phase;
                state.snapshot.error = None;
                self.trim_saved(state);
                self.publish(state);
                Ok(())
            }
            Err(failure) => {
                state.cancel.cancel();
                let mut observed = record;
                if let Some(deferred) = &state.deferred {
                    observed = deferred.clone();
                }
                state.snapshot.record = observed;
                state.snapshot.phase = Phase::PersistenceFailed;
                state.snapshot.error = Some(failure.error.clone());
                self.publish(state);
                Err(failure.error)
            }
        }
    }

    async fn checkpoint(
        &self,
        action: &str,
        mutate: impl FnOnce(&mut ConversationRecord),
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if state.snapshot.phase == Phase::PersistenceFailed {
            return Err("native.ai.conversation.saveFailed".into());
        }
        if state.snapshot.action_id.as_deref() != Some(action) {
            return Err("native.ai.turn.inactive".into());
        }
        let mut record = state.snapshot.record.clone();
        mutate(&mut record);
        self.persist(&mut state, record).await
    }

    async fn retain_outcome(
        &self,
        action: &str,
        mutate: impl FnOnce(&mut ConversationRecord),
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if state.snapshot.action_id.as_deref() != Some(action) {
            return Err("native.ai.turn.inactive".into());
        }
        let mut record = state.snapshot.record.clone();
        mutate(&mut record);
        if state.snapshot.phase == Phase::PersistenceFailed {
            state.deferred = Some(record.clone());
            state.snapshot.record = record;
            return Err("native.ai.conversation.saveFailed".into());
        }
        self.persist(&mut state, record).await
    }

    async fn drive(
        self: Arc<Self>,
        mut run: AgentRun,
        action: String,
        timestamp: u64,
        cancel: CancellationToken,
    ) {
        let result = self
            .drive_steps(&mut run, &action, timestamp, &cancel)
            .await;
        if matches!(result.as_ref(),Err(error) if error=="native.ai.worker.failed") {
            return;
        }
        let cancelled_before_cleanup = cancel.is_cancelled();
        let result = match result {
            Err(error)
                if cancelled_before_cleanup
                    && matches!(
                        error.as_str(),
                        "native.ai.response.stopped" | "native.ai.response.stoppedBilling"
                    ) =>
            {
                Ok(())
            }
            result => result,
        };
        if result.is_err() {
            cancel.cancel();
        }
        self.stop_auxiliaries().await;
        if let Err(error) = self.drain_host(action.clone(), cancel.clone()).await {
            let mut state = self.state.lock().await;
            state.cleanup_required = true;
            state.snapshot.phase = Phase::PersistenceFailed;
            state.snapshot.error = Some(error);
            if state.pending.is_none() {
                state.pending = Some(state.snapshot.record.clone());
            }
            self.publish(&mut state);
            return;
        }
        let mut state = self.state.lock().await;
        if state.snapshot.action_id.as_deref() != Some(&action) {
            return;
        }
        if state.snapshot.phase != Phase::PersistenceFailed {
            let mut record = state.snapshot.record.clone();
            let terminal = if cancelled_before_cleanup || (result.is_ok() && cancel.is_cancelled())
            {
                "interrupted"
            } else if result.is_err() {
                "error"
            } else {
                "completed"
            };
            if let Some(entry) = record
                .runtime
                .as_mut()
                .and_then(|runtime| runtime.runs.iter_mut().find(|run| run.id == action))
            {
                entry.state = terminal.into();
                entry.ended_at = Some(self.host.now_ms().max(entry.started_at));
            }
            let start = record
                .runtime
                .as_ref()
                .and_then(|r| r.runs.iter().find(|r| r.id == action))
                .map(|r| r.started_at)
                .unwrap_or(timestamp);
            let count = state.snapshot.message_offset + record.messages.as_array().unwrap().len();
            let start_count = record
                .runtime
                .as_ref()
                .and_then(|r| {
                    r.events
                        .iter()
                        .find(|e| e.run_id == action && e.kind == "work_block_start")
                })
                .map(|e| e.data["startMessageCount"].clone())
                .unwrap_or(json!(count));
            append_event(
                &mut record,
                &action,
                "work_block_end",
                json!({"workId":action,"startMessageCount":start_count,"messageCount":count,"durationMs":self.host.now_ms().saturating_sub(start),"outcome":if terminal == "completed" {"complete"} else {"cancelled"}}),
            );
            append_event(
                &mut record,
                &action,
                "execution_finished",
                json!({"state":terminal,"error":result.as_ref().err()}),
            );
            if self.persist(&mut state, record).await.is_ok() {
                state.snapshot.phase = if terminal == "completed" {
                    Phase::Idle
                } else {
                    Phase::Interrupted
                };
                state.snapshot.error = result.err();
            }
        }
        state.snapshot.task_active = false;
        let retained: std::collections::HashSet<_> =
            state.snapshot.message_entry_ids.iter().cloned().collect();
        state.resolved_inputs.retain(|id, _| retained.contains(id));
        state.snapshot.partial_message = None;
        self.publish(&mut state);
    }
}

fn append_event(record: &mut ConversationRecord, action: &str, kind: &str, data: Value) {
    let runtime = record.runtime.get_or_insert_default();
    let sequence = runtime
        .events
        .iter()
        .map(|event| event.sequence)
        .max()
        .unwrap_or(0)
        + 1;
    let id = persistence::entry_id();
    runtime.events.push(Event {
        id,
        run_id: action.into(),
        sequence,
        kind: kind.into(),
        data,
    });
}

#[cfg(test)]
mod tests;
