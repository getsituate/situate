use crate::*;
use serde::Deserialize;
use situate_core::conversation_runtime::Pending;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Action {
    Draft {
        expected: Input,
        input: Input,
    },
    Submit {
        input: Input,
        timestamp: u64,
    },
    Enqueue {
        kind: String,
        input: Input,
        timestamp: u64,
    },
    Recall,
    Cancel {
        run_id: String,
    },
    RetryPersistence,
    RenameTitle {
        expected: String,
        title: String,
    },
    PresentQuestion {
        question: Value,
    },
    AnswerQuestion {
        response: Value,
        input: Input,
        timestamp: u64,
    },
    #[serde(rename = "retryQuestionAction")]
    RetryQuestion {
        question_id: String,
    },
    SupersedeQuestion {
        question_id: String,
    },
    NotifyPluginAvailable {
        plugin_id: String,
    },
}

pub(crate) fn draft(record: &ConversationRecord) -> Input {
    Input {
        text: record.draft.clone(),
        attachments: record
            .runtime
            .as_ref()
            .map(|r| r.draft_attachments.clone())
            .unwrap_or_default(),
        references: record
            .runtime
            .as_ref()
            .map(|r| r.draft_references.clone())
            .unwrap_or_default(),
    }
}
pub(crate) fn set_draft(record: &mut ConversationRecord, input: Input) {
    record.draft = input.text;
    let runtime = record.runtime.get_or_insert_default();
    runtime.draft_attachments = input.attachments;
    runtime.draft_references = input.references;
}

impl<H: Host> Owner<H> {
    pub async fn apply(
        self: &Arc<Self>,
        action_id: String,
        action: Value,
    ) -> Result<Snapshot, String> {
        let cancel = self
            .stop
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .child_token();
        self.apply_with_cancel(action_id, action, cancel).await
    }

    pub async fn apply_with_cancel(
        self: &Arc<Self>,
        action_id: String,
        action: Value,
        cancel: CancellationToken,
    ) -> Result<Snapshot, String> {
        if !situate_core::conversation_runtime::identity(&action_id) || action["version"] != 1 {
            return Err("native.ai.conversation.versionInvalid".into());
        }
        let mut payload = action.clone();
        payload
            .as_object_mut()
            .ok_or("native.ai.conversation.versionInvalid")?
            .remove("version");
        let parsed: Action =
            serde_json::from_value(payload).map_err(|_| "native.ai.conversation.versionInvalid")?;
        self.host.validate_session()?;
        {
            let mut receipts = self.receipts.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(previous) = receipts.get(&action_id)
                && previous != &action
            {
                return Err("native.ai.conversation.conflict".into());
            }
            if receipts.len() >= 256 {
                receipts.clear();
            }
            receipts.insert(action_id.clone(), action.clone());
        }
        if let Action::Cancel { run_id } = &parsed {
            let active = self.cancel_run.lock().unwrap_or_else(|e| e.into_inner());
            if let Some((id, token)) = active.as_ref()
                && id == run_id
            {
                token.cancel();
            }
        }
        self.mutate(move |owner| async move {
            owner.apply_action(action_id, action, parsed, cancel).await
        })
        .await
    }

    async fn apply_action(
        self: &Arc<Self>,
        id: String,
        raw: Value,
        action: Action,
        cancel: CancellationToken,
    ) -> Result<Snapshot, String> {
        {
            let state = self.state.lock().await;
            if let Some(previous) = state.draft_receipts.get(&id) {
                if previous != &raw {
                    return Err("native.ai.conversation.conflict".into());
                }
                return Ok(self.projected_snapshot(&state));
            }
        }
        if let Some(accepted) = self.host.action(id.clone()).await? {
            let legacy = accepted.data["action"].get("input").is_some();
            if accepted.data["action"]
                != if legacy {
                    raw.clone()
                } else {
                    persistence::receipt(&raw)
                }
            {
                return Err("native.ai.conversation.conflict".into());
            }
            if !legacy && matches!(action, Action::Submit { .. } | Action::Enqueue { .. }) {
                let original = self
                    .host
                    .entry(
                        accepted.data["inputEntryId"]
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| persistence::input_entry_id(&id)),
                    )
                    .await?
                    .ok_or("native.ai.conversation.versionInvalid")?;
                let input: Input = serde_json::from_value(raw["input"].clone())
                    .map_err(|_| "native.ai.conversation.versionInvalid")?;
                if original.data["message"]["content"] != input.text
                    || original.data["input"]["attachments"] != json!(input.attachments)
                    || original.data["input"]["references"] != json!(input.references)
                {
                    return Err("native.ai.conversation.conflict".into());
                }
            }
            let state = self.state.lock().await;
            if state.snapshot.phase != Phase::PersistenceFailed {
                return Ok(self.projected_snapshot(&state));
            }
            if !matches!(action, Action::RetryPersistence) {
                return Err("native.ai.conversation.saveFailed".into());
            }
        }
        {
            let state = self.state.lock().await;
            self.host.validate_session()?;
            if let Some(event) = state.snapshot.record.runtime.as_ref().and_then(|r| {
                r.events
                    .iter()
                    .find(|e| e.run_id == id && e.kind == "action_accepted")
            }) {
                if event.data != json!({"action":raw}) {
                    return Err("native.ai.conversation.conflict".into());
                }
                if state.snapshot.phase == Phase::PersistenceFailed {
                    if !matches!(action, Action::RetryPersistence) {
                        return Err("native.ai.conversation.saveFailed".into());
                    }
                } else {
                    return Ok(state.snapshot.clone());
                }
            }
        }
        match &action {
            Action::Draft { input, .. } | Action::AnswerQuestion { input, .. } => {
                input.validate(true)?;
                self.host.validate_input(input).await?;
            }
            Action::Submit { input, .. } | Action::Enqueue { input, .. } => {
                input.validate(false)?;
                self.host.validate_input(input).await?;
            }
            _ => {}
        }
        if matches!(action, Action::RetryPersistence) {
            self.retry_checkpoint().await?;
            let mut state = self.state.lock().await;
            if !state
                .snapshot
                .record
                .runtime
                .as_ref()
                .is_some_and(|runtime| {
                    runtime
                        .events
                        .iter()
                        .any(|event| event.run_id == id && event.kind == "action_accepted")
                })
            {
                let mut record = state.snapshot.record.clone();
                append_event(&mut record, &id, "action_accepted", json!({"action":raw}));
                self.persist(&mut state, record).await?;
            }
            return Ok(state.snapshot.clone());
        }
        if let Action::Submit { input, timestamp } = action {
            return self.admit(id, input, timestamp, cancel, raw).await;
        }
        if let Action::AnswerQuestion {
            response,
            input,
            timestamp,
        } = action
        {
            return self
                .answer_question(id, raw, response, input, timestamp, cancel)
                .await;
        }
        if let Action::RetryQuestion { question_id } = action {
            return self
                .retry_question_action(id, raw, question_id, cancel)
                .await;
        }
        let plugin = if let Action::NotifyPluginAvailable { plugin_id } = &action {
            let metadata = self.host.plugin_available(plugin_id.clone()).await?;
            if !metadata.is_object()
                || metadata["pluginId"] != *plugin_id
                || !metadata["pluginName"]
                    .as_str()
                    .is_some_and(|name| !name.trim().is_empty())
            {
                return Err("native.ai.tool.unavailable".into());
            }
            Some(metadata)
        } else {
            None
        };
        let mut state = self.state.lock().await;
        if state.snapshot.phase == Phase::PersistenceFailed {
            return Err("native.ai.conversation.saveFailed".into());
        }
        let mut record = state.snapshot.record.clone();
        match action {
            Action::Draft { expected, input } => {
                if draft(&record) != expected {
                    return Err("native.ai.conversation.conflict".into());
                }
                set_draft(&mut record, input);
                if state.draft_receipts.len() >= 256 {
                    state.draft_receipts.clear();
                }
                state.draft_receipts.insert(id, raw);
                state.snapshot.record = record;
                self.publish(&mut state);
                return Ok(state.snapshot.clone());
            }
            Action::Enqueue {
                kind,
                input,
                timestamp,
            } => {
                if !matches!(kind.as_str(), "steering" | "followUp") {
                    return Err("native.ai.conversation.versionInvalid".into());
                }
                let clear = draft(&record) == input;
                record
                    .messages
                    .as_array_mut()
                    .unwrap()
                    .push(persistence::original(&input, timestamp));
                record
                    .runtime
                    .get_or_insert_default()
                    .pending
                    .push(Pending {
                        id: id.clone(),
                        kind,
                        state: "pending".into(),
                        text: input.text,
                        attachments: input.attachments,
                        references: input.references,
                        timestamp,
                    });
                if clear {
                    set_draft(&mut record, Input::default());
                }
            }
            Action::Recall => {
                let current = draft(&record);
                let runtime = record.runtime.get_or_insert_default();
                let mut ordered = Vec::new();
                for kind in ["steering", "followUp"] {
                    ordered.extend(
                        runtime
                            .pending
                            .iter()
                            .filter(|p| p.state == "pending" && p.kind == kind),
                    );
                }
                let mut recalled = Input::default();
                let mut texts = Vec::new();
                for entry in &ordered {
                    if !entry.text.is_empty() {
                        texts.push(entry.text.clone());
                    }
                    for attachment in &entry.attachments {
                        if let Some(previous) = recalled
                            .attachments
                            .iter_mut()
                            .find(|a| a.id == attachment.id)
                        {
                            *previous = attachment.clone();
                        } else {
                            recalled.attachments.push(attachment.clone());
                        }
                    }
                    for reference in &entry.references {
                        if !recalled.references.contains(reference) {
                            recalled.references.push(reference.clone());
                        }
                    }
                }
                if !current.text.is_empty() {
                    texts.push(current.text);
                }
                recalled.text = texts.join("\n\n");
                for attachment in current.attachments {
                    if let Some(previous) = recalled
                        .attachments
                        .iter_mut()
                        .find(|a| a.id == attachment.id)
                    {
                        *previous = attachment;
                    } else {
                        recalled.attachments.push(attachment);
                    }
                }
                for reference in current.references {
                    if !recalled.references.contains(&reference) {
                        recalled.references.push(reference);
                    }
                }
                recalled.validate(true)?;
                runtime.pending.retain(|p| p.state == "consumed");
                set_draft(&mut record, recalled);
            }
            Action::Cancel { run_id } => {
                if !record
                    .runtime
                    .as_ref()
                    .is_some_and(|r| r.runs.iter().any(|r| r.id == run_id))
                    && !(state.snapshot.question_busy
                        && state.snapshot.action_id.as_deref() == Some(run_id.as_str()))
                {
                    return Err("native.ai.turn.inactive".into());
                }
                append_event(
                    &mut record,
                    &run_id,
                    "cancellation_requested",
                    json!({"actionId":id}),
                );
            }
            Action::RenameTitle { expected, title } => {
                let title = title.trim();
                if title.is_empty() || title.chars().count() > 256 {
                    return Err("chat.titleInvalid".into());
                }
                if record.title != expected {
                    return Err("native.ai.conversation.conflict".into());
                }
                state.title_epoch += 1;
                if let Some(cancel) = self
                    .title_cancel
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take()
                {
                    cancel.cancel();
                }
                record.title = title.into();
                record.title_input = None;
            }
            Action::PresentQuestion { question } => {
                if state.snapshot.task_active || state.snapshot.question_busy {
                    return Err("chatQuestion.busy".into());
                }
                questions::present(&mut record, &id, question, self.host.now_ms())?;
            }
            Action::SupersedeQuestion { question_id } => {
                if state.snapshot.task_active || state.snapshot.question_busy {
                    return Err("chatQuestion.busy".into());
                }
                if questions::pending(&record)
                    .as_ref()
                    .map(|q| q["id"].as_str().unwrap())
                    != Some(question_id.as_str())
                {
                    return Err("chatQuestion.stale".into());
                }
                append_event(
                    &mut record,
                    &id,
                    "question_superseded",
                    json!({"questionId":question_id}),
                );
            }
            Action::NotifyPluginAvailable { .. } => {
                let mut metadata = plugin.unwrap();
                metadata["timestamp"] = json!(self.host.now_ms());
                let run_id = state.snapshot.action_id.as_deref().unwrap_or(&id);
                append_event(&mut record, run_id, "plugin_available", metadata);
            }
            _ => unreachable!(),
        }
        append_event(&mut record, &id, "action_accepted", json!({"action":raw}));
        self.persist(&mut state, record).await?;
        Ok(state.snapshot.clone())
    }
}
