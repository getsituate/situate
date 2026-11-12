use crate::*;

pub fn validate(question: &Value) -> Result<(), String> {
    let identifier = |v: &Value| {
        v.as_str()
            .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 256)
    };
    let q = question.as_object().ok_or("chatQuestion.invalid")?;
    if !identifier(&question["id"])
        || !question["prompt"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 16000)
    {
        return Err("chatQuestion.invalid".into());
    }
    if let Some(suggestions) = q.get("suggestions") {
        let suggestions = suggestions.as_array().ok_or("chatQuestion.invalid")?;
        let mut ids = std::collections::HashSet::new();
        for suggestion in suggestions {
            if !identifier(&suggestion["id"])
                || !ids.insert(suggestion["id"].as_str().unwrap())
                || !suggestion["label"]
                    .as_str()
                    .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 4000)
            {
                return Err("chatQuestion.invalid".into());
            }
        }
    }
    if let Some(preview) = q.get("preview") {
        let object = preview.as_object().ok_or("chatQuestion.invalid")?;
        if object
            .keys()
            .any(|key| !matches!(key.as_str(), "title" | "text" | "summary"))
            || !preview["title"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty() && s.len() <= 256)
            || !preview["text"].as_str().is_some_and(|s| s.len() <= 65536)
            || object
                .get("summary")
                .is_some_and(|v| !v.as_str().is_some_and(|s| s.len() <= 196608))
        {
            return Err("chatQuestion.invalid".into());
        }
    }
    Ok(())
}
pub(crate) fn pending(record: &ConversationRecord) -> Option<Value> {
    let mut current = None;
    for event in record.runtime.as_ref()?.events.iter() {
        match event.kind.as_str() {
            "question_presented" => current = Some(event.data.clone()),
            "question_answered" | "question_superseded"
                if current
                    .as_ref()
                    .is_some_and(|q| q["id"] == event.data["questionId"]) =>
            {
                current = None
            }
            _ => {}
        }
    }
    current
}
pub(crate) fn action_pending(record: &ConversationRecord) -> Option<String> {
    let runtime = record.runtime.as_ref()?;
    runtime.events.iter().find_map(|event| {
        if event.kind != "question_answered" {
            return None;
        }
        let id = event.data["questionId"].as_str()?;
        let contextual = runtime.events.iter().any(|e| {
            e.kind == "question_presented" && e.data["id"] == id && e.data.get("context").is_some()
        });
        let completed = runtime.events.iter().any(|e| {
            matches!(
                e.kind.as_str(),
                "question_action_completed" | "question_superseded"
            ) && e.data["questionId"] == id
        });
        (contextual && !completed).then(|| id.to_owned())
    })
}

pub(crate) fn present(
    record: &mut ConversationRecord,
    run: &str,
    mut question: Value,
    timestamp: u64,
) -> Result<(), String> {
    validate(&question)?;
    if record.runtime.as_ref().is_some_and(|r| {
        r.events
            .iter()
            .any(|e| e.kind == "question_presented" && e.data["id"] == question["id"])
    }) {
        return Err("chatQuestion.stale".into());
    }
    question["timestamp"] = json!(timestamp);
    append_event(record, run, "question_presented", question);
    Ok(())
}

impl<H: Host> Owner<H> {
    pub(crate) async fn retire_questions(
        &self,
        state: &mut State,
        run: &str,
    ) -> Result<(), String> {
        let mut candidates: Vec<Value> = pending(&state.snapshot.record).into_iter().collect();
        if let Some(id) = action_pending(&state.snapshot.record)
            && let Some(event) = state.snapshot.record.runtime.as_ref().and_then(|runtime| {
                runtime
                    .events
                    .iter()
                    .find(|e| e.kind == "question_presented" && e.data["id"] == id)
            })
            && !candidates.iter().any(|question| question["id"] == id)
        {
            candidates.push(event.data.clone());
        }
        if candidates.is_empty() {
            return Ok(());
        }
        let mut record = state.snapshot.record.clone();
        let mut changed = false;
        for question in candidates {
            if self.host.question_retired(question.clone()).await? {
                append_event(
                    &mut record,
                    run,
                    "question_superseded",
                    json!({"questionId":question["id"]}),
                );
                changed = true;
            }
        }
        if changed {
            self.persist(state, record).await?;
        }
        Ok(())
    }
    pub(crate) async fn answer_question(
        self: &Arc<Self>,
        id: String,
        raw: Value,
        response: Value,
        mut input: Input,
        timestamp: u64,
        cancel: CancellationToken,
    ) -> Result<Snapshot, String> {
        if cancel.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        let question = {
            let mut state = self.state.lock().await;
            if state.snapshot.task_active
                || state.snapshot.question_busy
                || state.snapshot.phase == Phase::PersistenceFailed
            {
                return Err("chatQuestion.busy".into());
            }
            self.retire_questions(&mut state, &id).await?;
            pending(&state.snapshot.record).ok_or("chatQuestion.stale")?
        };
        if response["questionId"] != question["id"] {
            return Err("chatQuestion.stale".into());
        }
        let answer = if let Some(choice) = response["choiceId"].as_str() {
            if response.get("text").is_some() {
                return Err("chatQuestion.invalid".into());
            }
            let selected = question["suggestions"]
                .as_array()
                .and_then(|s| s.iter().find(|s| s["id"] == choice))
                .ok_or("chatQuestion.invalid")?;
            input.attachments.clear();
            input.references.clear();
            json!({"text":selected["label"],"choiceId":choice})
        } else {
            let text = response["text"].as_str().ok_or("chatQuestion.empty")?;
            if text.len() > 1_048_576 {
                return Err("chatQuestion.empty".into());
            }
            json!({"text":text})
        };
        input.text = answer["text"].as_str().unwrap().into();
        input.validate(false)?;
        let message = self
            .host
            .input(input.clone(), timestamp, cancel.clone())
            .await?;
        transcript::validate(&message)?;
        if message["role"] != "user" {
            return Err("native.ai.response.invalid".into());
        }
        {
            let mut state = self.state.lock().await;
            if cancel.is_cancelled() {
                return Err("native.ai.response.stopped".into());
            }
            let mut record = state.snapshot.record.clone();
            record
                .messages
                .as_array_mut()
                .unwrap()
                .push(persistence::original(&input, timestamp));
            state
                .resolved_inputs
                .insert(persistence::input_entry_id(&id), message);
            record.runtime.get_or_insert_default().pending.push(
                situate_core::conversation_runtime::Pending {
                    id: id.clone(),
                    kind: "steering".into(),
                    state: "consumed".into(),
                    text: input.text.clone(),
                    attachments: input.attachments.clone(),
                    references: input.references.clone(),
                    timestamp,
                },
            );
            if actions::draft(&record) == input {
                actions::set_draft(&mut record, Input::default());
            }
            append_event(&mut record, &id, "action_accepted", json!({"action":raw}));
            append_event(
                &mut record,
                &id,
                "question_answered",
                json!({"questionId":question["id"],"inputId":id,"answer":answer,"response":response}),
            );
            self.persist(&mut state, record).await?;
            state.snapshot.question_busy = true;
            state.snapshot.action_id = Some(id.clone());
            state.cancel = cancel.clone();
            *self.cancel_run.lock().unwrap_or_else(|e| e.into_inner()) =
                Some((id.clone(), cancel.clone()));
            self.publish_progress(&mut state);
        }
        let result = self
            .complete_question(&id, question, response, cancel.clone())
            .await;
        self.finish_question_action(id, timestamp, cancel, result)
            .await
    }

    pub(crate) async fn retry_question_action(
        self: &Arc<Self>,
        id: String,
        raw: Value,
        question_id: String,
        cancel: CancellationToken,
    ) -> Result<Snapshot, String> {
        if cancel.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        let (question, response) = {
            let mut state = self.state.lock().await;
            if state.snapshot.task_active
                || state.snapshot.question_busy
                || state.snapshot.phase == Phase::PersistenceFailed
            {
                return Err("chatQuestion.busy".into());
            }
            self.retire_questions(&mut state, &id).await?;
            let runtime = state
                .snapshot
                .record
                .runtime
                .as_ref()
                .ok_or("chatQuestion.stale")?;
            if runtime.events.iter().any(|e| {
                matches!(
                    e.kind.as_str(),
                    "question_action_completed" | "question_superseded"
                ) && e.data["questionId"] == question_id
            }) {
                return Err("chatQuestion.stale".into());
            }
            let question = runtime
                .events
                .iter()
                .find(|e| e.kind == "question_presented" && e.data["id"] == question_id)
                .ok_or("chatQuestion.stale")?
                .data
                .clone();
            let response = runtime
                .events
                .iter()
                .find(|e| e.kind == "question_answered" && e.data["questionId"] == question_id)
                .ok_or("chatQuestion.stale")?
                .data["response"]
                .clone();
            let mut record = state.snapshot.record.clone();
            append_event(&mut record, &id, "action_accepted", json!({"action":raw}));
            self.persist(&mut state, record).await?;
            state.snapshot.question_busy = true;
            state.snapshot.action_id = Some(id.clone());
            state.cancel = cancel.clone();
            *self.cancel_run.lock().unwrap_or_else(|e| e.into_inner()) =
                Some((id.clone(), cancel.clone()));
            self.publish_progress(&mut state);
            (question, response)
        };
        let result = self
            .complete_question(&id, question, response, cancel.clone())
            .await;
        self.finish_question_action(id, self.host.now_ms(), cancel, result)
            .await
    }

    async fn finish_question_action(
        self: &Arc<Self>,
        id: String,
        timestamp: u64,
        cancel: CancellationToken,
        result: Result<bool, String>,
    ) -> Result<Snapshot, String> {
        if result.is_err() {
            cancel.cancel();
        }
        let drained = self.drain_host(id.clone(), cancel.clone()).await;
        self.host.validate_session()?;
        let mut state = self.state.lock().await;
        if let Err(error) = drained {
            state.cleanup_required = true;
            state.snapshot.task_active = true;
            if state.snapshot.phase != Phase::PersistenceFailed {
                state.snapshot.error = Some(error);
            }
            self.publish(&mut state);
            return match result {
                Err(error) if state.snapshot.phase == Phase::PersistenceFailed => Err(error),
                _ => Ok(self.projected_snapshot(&state)),
            };
        }
        state.snapshot.question_busy = false;
        match result {
            Err(error) => {
                if state.snapshot.phase == Phase::PersistenceFailed {
                    self.publish(&mut state);
                    return Err(error);
                }
                state.snapshot.error = Some(error);
                self.publish(&mut state);
                Ok(self.projected_snapshot(&state))
            }
            Ok(continued) => {
                state.snapshot.error = None;
                self.publish(&mut state);
                drop(state);
                if continued {
                    self.start_continuation(id, timestamp, cancel).await?;
                }
                self.snapshot().await
            }
        }
    }

    async fn complete_question(
        self: &Arc<Self>,
        id: &str,
        question: Value,
        response: Value,
        cancel: CancellationToken,
    ) -> Result<bool, String> {
        let outcome = if question.get("context").is_some() {
            if cancel.is_cancelled() {
                return Err("native.ai.response.stopped".into());
            }
            let host = self.host.clone();
            let retained = question.clone();
            tokio::spawn(async move { host.question_action(retained, response, cancel).await })
                .await
                .map_err(|_| "native.ai.request.failed".to_owned())??
        } else {
            QuestionOutcome {
                question: None,
                continue_run: true,
            }
        };
        let mut state = self.state.lock().await;
        let mut record = state.snapshot.record.clone();
        let continued = outcome.continue_run && outcome.question.is_none();
        if let Some(next) = outcome.question {
            present(&mut record, id, next, self.host.now_ms())?;
        }
        append_event(
            &mut record,
            id,
            "question_action_completed",
            json!({"questionId":question["id"]}),
        );
        self.persist(&mut state, record).await?;
        Ok(continued)
    }

    async fn start_continuation(
        self: &Arc<Self>,
        id: String,
        timestamp: u64,
        cancel: CancellationToken,
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;
        let mut record = state.snapshot.record.clone();
        record.runtime.get_or_insert_default().runs.push(Run {
            id: id.clone(),
            state: "running".into(),
            started_at: timestamp,
            ended_at: None,
            usage: None,
            references: vec![],
        });
        let count = state.snapshot.message_offset + record.messages.as_array().unwrap().len();
        append_event(
            &mut record,
            &id,
            "work_block_start",
            json!({"workId":id,"startMessageCount":count,"startedAt":timestamp}),
        );
        self.persist(&mut state, record).await?;
        state.snapshot.action_id = Some(id.clone());
        state.snapshot.task_active = true;
        state.snapshot.phase = Phase::Running;
        state.cancel = cancel.clone();
        *self.cancel_run.lock().unwrap_or_else(|e| e.into_inner()) =
            Some((id.clone(), cancel.clone()));
        self.publish(&mut state);
        drop(state);
        let owner = self.clone();
        let worker = tokio::spawn(owner.clone().drive(
            AgentRun::new("Continue the admitted conversation").max_turns(128),
            id,
            timestamp,
            cancel,
        ));
        tokio::spawn(async move {
            if worker.await.is_err() {
                let _action = owner.actions.lock().await;
                owner.worker_failed(true).await;
            }
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_validator_preserves_host_context_and_checks_question_content() {
        let question = json!({"id":"question","prompt":"Confirm?","suggestions":[{"id":"yes","label":"Yes"}],"preview":{"title":"Review","text":"Details","summary":"Summary"},"context":{"revision":"captured"}});
        let original = question.clone();
        crate::validate_question(&question).unwrap();
        assert_eq!(question, original);
        for prompt in [json!(""), json!(" \n "), json!(false)] {
            let mut invalid = question.clone();
            invalid["prompt"] = prompt;
            assert_eq!(
                crate::validate_question(&invalid),
                Err("chatQuestion.invalid".into())
            );
        }
        for preview in [
            json!({"title":"","text":"Details"}),
            json!({"title":"Review","text":"Details","unknown":true}),
        ] {
            let mut invalid = question.clone();
            invalid["preview"] = preview;
            assert!(crate::validate_question(&invalid).is_err());
        }
        let mut invalid = question;
        invalid["suggestions"] =
            json!([{"id":"same","label":"First"},{"id":"same","label":"Second"}]);
        assert!(crate::validate_question(&invalid).is_err());
    }
}
