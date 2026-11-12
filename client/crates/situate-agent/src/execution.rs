use crate::*;
use situate_core::conversation_runtime::{Checkpoint, Pending};
use tokio::sync::mpsc;

impl<H: Host> Owner<H> {
    pub(crate) async fn drain_host(
        self: &Arc<Self>,
        id: String,
        cancel: CancellationToken,
    ) -> Result<(), String> {
        let owner = self.clone();
        tokio::spawn(async move { owner.host.drain(id, cancel).await })
            .await
            .map_err(|_| "native.ai.cleanup.failed".to_owned())?
    }

    async fn observe<F, T>(
        &self,
        action: &str,
        future: F,
        mut progress: mpsc::Receiver<Progress>,
        partial: bool,
        cancel: &CancellationToken,
    ) -> (T, Option<String>)
    where
        F: Future<Output = T> + Send,
        T: Send,
    {
        tokio::pin!(future);
        let mut open = true;
        let mut failure = None;
        loop {
            tokio::select! {
                biased;
                update = progress.recv(), if open => match update {
                    None => open = false,
                    Some(update) => {
                        if let Err(error) = self.progress(action,update,partial).await {
                            failure = Some(error);
                            cancel.cancel();
                            progress.close();
                            open = false;
                        }
                    }
                },
                value = &mut future => {
                    while let Ok(update) = progress.try_recv() {
                        if let Err(error) = self.progress(action,update,partial).await {
                            failure = Some(error);
                            cancel.cancel();
                        }
                    }
                    return (value,failure);
                }
            }
        }
    }

    async fn progress(&self, action: &str, update: Progress, partial: bool) -> Result<(), String> {
        self.host.validate_session()?;
        let mut state = self.state.lock().await;
        if state.snapshot.action_id.as_deref() != Some(action) {
            return Err("native.ai.turn.inactive".into());
        }
        match update {
            Progress::PartialMessage(message) if partial => {
                state.snapshot.partial_message = Some(message)
            }
            Progress::PartialMessage(_) => return Ok(()),
            Progress::ActivityComment(comment) => state.snapshot.activity_comment = comment,
        }
        self.publish_progress(&mut state);
        Ok(())
    }

    async fn retain_partial(&self, action: &str, cancelled: bool) -> Result<(), String> {
        let partial = self.state.lock().await.snapshot.partial_message.clone();
        let Some(partial) = partial else {
            return Ok(());
        };
        let message = transcript::interrupted(partial, self.host.now_ms(), cancelled)?;
        self.retain_outcome(action, |record| {
            record.messages.as_array_mut().unwrap().push(message)
        })
        .await?;
        let mut state = self.state.lock().await;
        state.snapshot.partial_message = None;
        self.publish_progress(&mut state);
        Ok(())
    }

    async fn consume(
        &self,
        action: &str,
        kind: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, String> {
        let _actions = self.actions.lock().await;
        let pending: Vec<Pending> = {
            let state = self.state.lock().await;
            state
                .snapshot
                .record
                .runtime
                .as_ref()
                .map(|r| {
                    r.pending
                        .iter()
                        .filter(|p| p.kind == kind && p.state == "pending")
                        .cloned()
                        .collect()
                })
                .unwrap_or_default()
        };
        if pending.is_empty() {
            return Ok(false);
        }
        let mut messages = Vec::new();
        for input in &pending {
            if cancel.is_cancelled() {
                return Err("native.ai.response.stopped".into());
            }
            let message = self
                .host
                .input(
                    Input {
                        text: input.text.clone(),
                        attachments: input.attachments.clone(),
                        references: input.references.clone(),
                    },
                    input.timestamp,
                    cancel.clone(),
                )
                .await?;
            transcript::validate(&message)?;
            if message["role"] != "user" {
                return Err("native.ai.response.invalid".into());
            }
            let entry_id = self
                .state
                .lock()
                .await
                .input_entry_ids
                .get(&input.id)
                .cloned()
                .ok_or("native.ai.conversation.versionInvalid")?;
            messages.push((entry_id, message));
        }
        let mut state = self.state.lock().await;
        if cancel.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        if state.snapshot.phase == Phase::PersistenceFailed {
            return Err("native.ai.conversation.saveFailed".into());
        }
        if state.snapshot.action_id.as_deref() != Some(action) {
            return Err("native.ai.turn.inactive".into());
        }
        let mut next = state.snapshot.record.clone();
        {
            let record = &mut next;
            let runtime = record.runtime.get_or_insert_default();
            for input in &pending {
                if let Some(entry) = runtime.pending.iter_mut().find(|p| p.id == input.id) {
                    entry.state = "consumed".into();
                }
                if let Some(run) = runtime.runs.iter_mut().find(|r| r.id == action) {
                    for reference in &input.references {
                        if !run.references.contains(reference) {
                            run.references.push(reference.clone());
                        }
                    }
                }
            }
            for input in &pending {
                append_event(
                    record,
                    action,
                    "input_consumed",
                    json!({"inputId":input.id}),
                );
            }
        }
        self.persist(&mut state, next).await?;
        for (id, message) in messages {
            if !state.active_inputs.contains(&id) {
                state.active_inputs.push(id.clone());
            }
            state.resolved_inputs.insert(id, message);
        }
        Ok(true)
    }

    pub(crate) async fn request(
        self: &Arc<Self>,
        action: &str,
        kind: RequestKind,
        context: Vec<Value>,
        definitions: Vec<ToolDefinition>,
        config: &RunConfig,
        cancel: &CancellationToken,
    ) -> Result<Value, String> {
        let request_id = {
            let mut state = self.state.lock().await;
            if state.snapshot.phase == Phase::PersistenceFailed {
                return Err("native.ai.conversation.saveFailed".into());
            }
            let mut record = state.snapshot.record.clone();
            let request_id = persistence::entry_id();
            append_event(
                &mut record,
                action,
                "model_intent",
                json!({"requestId":request_id,"kind":kind}),
            );
            self.persist(&mut state, record).await?;
            request_id
        };
        if cancel.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        let context = if kind == RequestKind::Main {
            self.host
                .context(context, config.clone(), cancel.clone())
                .await?
        } else {
            context
        };
        if cancel.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        self.host.validate_session()?;
        let (sender, receiver) = mpsc::channel(32);
        if kind == RequestKind::Main {
            let mut state = self.state.lock().await;
            state.snapshot.partial_message = None;
            self.publish_progress(&mut state);
        }
        let request = ModelRequest {
            run_id: action.into(),
            request_id: request_id.clone(),
            kind,
            context,
            definitions,
            config: config.clone(),
        };
        let host = self.host.clone();
        let token = cancel.clone();
        let worker =
            tokio::spawn(async move { host.model(request, ProgressSink(sender), token).await });
        let (outcome, progress_error) = self
            .observe(action, worker, receiver, kind == RequestKind::Main, cancel)
            .await;
        let response = match outcome {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                if kind == RequestKind::Main {
                    self.retain_partial(action, cancel.is_cancelled()).await?;
                }
                return Err(error);
            }
            Err(_) => {
                self.worker_failed(true).await;
                return Err("native.ai.worker.failed".into());
            }
        };
        if let Err(error) = transcript::validate(&response) {
            if kind == RequestKind::Main {
                self.retain_partial(action, cancel.is_cancelled()).await?;
            }
            return Err(error);
        }
        if response["role"] != "assistant" {
            return Err("native.ai.response.invalid".into());
        }
        self.retain_outcome(action, |record| {
            if kind == RequestKind::Main {
                record
                    .messages
                    .as_array_mut()
                    .unwrap()
                    .push(response.clone());
            }
            if let Some(run) = record
                .runtime
                .as_mut()
                .and_then(|r| r.runs.iter_mut().find(|r| r.id == action))
            {
                run.usage
                    .get_or_insert_default()
                    .push(json!({"kind":kind,"usage":response["usage"],"requestId":request_id}));
            }
            append_event(
                record,
                action,
                "model_completed",
                json!({"requestId":request_id,"kind":kind,"stopReason":response["stopReason"]}),
            );
        })
        .await?;
        {
            let mut state = self.state.lock().await;
            if kind == RequestKind::Main {
                state.snapshot.partial_message = None;
                self.publish_progress(&mut state);
            }
        }
        if let Some(error) = progress_error {
            return Err(error);
        }
        Ok(response)
    }

    async fn context_plan(
        self: &Arc<Self>,
        action: &str,
        config: &RunConfig,
        definitions: &[ToolDefinition],
        cancel: &CancellationToken,
    ) -> Result<Vec<Value>, String> {
        self.bootstrap_context(action, config, cancel).await?;
        let (originals, ids, waiting, checkpoint, cached, active_inputs) = {
            let state = self.state.lock().await;
            (
                state.snapshot.record.messages.as_array().unwrap().clone(),
                state.snapshot.message_entry_ids.clone(),
                state
                    .snapshot
                    .record
                    .runtime
                    .as_ref()
                    .map(|runtime| {
                        runtime
                            .pending
                            .iter()
                            .filter(|input| input.state == "pending")
                            .filter_map(|input| state.input_entry_ids.get(&input.id).cloned())
                            .collect::<std::collections::HashSet<_>>()
                    })
                    .unwrap_or_default(),
                state
                    .snapshot
                    .record
                    .runtime
                    .as_ref()
                    .and_then(|runtime| runtime.checkpoint.clone()),
                state.resolved_inputs.clone(),
                state.active_inputs.clone(),
            )
        };
        let mut source = Vec::new();
        let mut original_indices = Vec::new();
        for (index, message) in originals.iter().enumerate() {
            let id = &ids[index];
            if waiting.contains(id) {
                continue;
            }
            let entry = self.host.entry(id.clone()).await?;
            if let Some(input_id) = entry
                .as_ref()
                .and_then(|entry| entry.data["input"]["id"].as_str())
                && self.host.input_state(input_id.to_owned()).await?.as_deref() != Some("consumed")
            {
                continue;
            }
            let resolved = if let Some(message) = cached.get(id) {
                message.clone()
            } else if let Some(entry) = entry {
                if let Some(input) = entry.data.get("input") {
                    let input = Input {
                        text: persistence::message_text(message),
                        attachments: serde_json::from_value(input["attachments"].clone())
                            .map_err(|_| "native.ai.conversation.versionInvalid")?,
                        references: serde_json::from_value(
                            input.get("references").cloned().unwrap_or(json!([])),
                        )
                        .map_err(|_| "native.ai.conversation.versionInvalid")?,
                    };
                    let resolved = self
                        .host
                        .input(
                            input,
                            message["timestamp"].as_u64().unwrap_or_default(),
                            cancel.clone(),
                        )
                        .await?;
                    self.state
                        .lock()
                        .await
                        .resolved_inputs
                        .insert(id.clone(), resolved.clone());
                    resolved
                } else {
                    message.clone()
                }
            } else {
                message.clone()
            };
            source.push(resolved);
            original_indices.push(index);
        }
        let pinned: Vec<Value> = active_inputs
            .iter()
            .filter(|id| !ids.contains(id) && !waiting.contains(*id))
            .filter_map(|id| cached.get(id).cloned())
            .collect();
        original_indices.splice(0..0, std::iter::repeat_n(0, pinned.len()));
        source.splice(0..0, pinned);
        let (messages, boundary) =
            compaction::plan(&source, checkpoint.as_ref(), config, definitions);
        let Some(boundary) = boundary else {
            return Ok(messages);
        };
        let previous = checkpoint.as_ref().map_or(0, |c| c.source_count);
        let mut summary = checkpoint
            .as_ref()
            .map(|c| c.summary.clone())
            .unwrap_or_default();
        let summary_config = compaction::summary_config(config);
        for chunk in compaction::chunks(&source[previous..boundary], &summary_config)? {
            let prompt = format!("Previous summary:\n{summary}\nSegment:\n{chunk}");
            let response = self
                .request(
                    action,
                    RequestKind::Compaction,
                    vec![json!({"role":"user","content":prompt,"timestamp":self.host.now_ms()})],
                    vec![],
                    &summary_config,
                    cancel,
                )
                .await?;
            if response["stopReason"] != "stop"
                || response["content"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|block| block["type"] == "toolCall")
            {
                return Err("chat.compactionFailed".into());
            }
            summary = response_text(&response).trim().into();
            if summary.is_empty() {
                return Err("chat.compactionFailed".into());
            }
        }
        self.checkpoint(action, |record| {
            record.runtime.get_or_insert_default().checkpoint = Some(Checkpoint {
                source_count: original_indices[boundary],
                summary: summary.clone(),
                run_id: action.into(),
            });
            append_event(
                record,
                action,
                "context_compacted",
                json!({"sourceCount":boundary}),
            );
        })
        .await?;
        Ok(compaction::compact(
            &source,
            Some(&Checkpoint {
                source_count: boundary,
                summary,
                run_id: action.into(),
            }),
        ))
    }

    pub(crate) async fn drive_steps(
        self: &Arc<Self>,
        run: &mut AgentRun,
        action: &str,
        _timestamp: u64,
        cancel: &CancellationToken,
    ) -> Result<(), String> {
        if cancel.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        let metadata = self.state.lock().await.metadata.clone();
        let config = self
            .host
            .capture(action.into(), metadata, cancel.clone())
            .await?;
        if config.context_window < 256 || config.max_tokens == 0 {
            return Err("native.ai.model.invalid".into());
        }
        self.start_auxiliaries(action, &config, cancel).await;
        let mut request_config = config.clone();
        let mut definitions = Vec::new();
        let mut provenance = std::collections::HashMap::new();
        let mut calls: Vec<Value> = Vec::new();
        let mut model_calls = 0;
        loop {
            if cancel.is_cancelled() {
                return Err("native.ai.response.stopped".into());
            }
            match run.next_step().map_err(|_| "native.ai.request.failed")? {
                AgentRunStep::CallModel { turn, .. } => {
                    self.consume(action, "steering", cancel).await?;
                    if cancel.is_cancelled() {
                        return Err("native.ai.response.stopped".into());
                    }
                    let mut prepared = config.clone();
                    self.host
                        .prepare_model(&mut prepared, cancel.clone())
                        .await?;
                    if cancel.is_cancelled() {
                        return Err("native.ai.response.stopped".into());
                    }
                    if prepared.settings != config.settings
                        || prepared.context_window != config.context_window
                        || prepared.max_tokens != config.max_tokens
                        || prepared.generate_title != config.generate_title
                        || prepared.generate_comments != config.generate_comments
                    {
                        return Err("native.ai.model.invalid".into());
                    }
                    request_config = prepared;
                    definitions = self.host.definitions();
                    let mut names = std::collections::HashSet::new();
                    if definitions.iter().any(|d| !names.insert(&d.name)) {
                        return Err("native.ai.request.failed".into());
                    }
                    provenance = definitions
                        .iter()
                        .map(|d| (d.name.clone(), self.host.tool_provenance(d)))
                        .collect();
                    run.advertise_tools(turn, definitions.iter().cloned().map(Arc::new).collect());
                    let context = self
                        .context_plan(action, &request_config, &definitions, cancel)
                        .await?;
                    let response = self
                        .request(
                            action,
                            RequestKind::Main,
                            context,
                            definitions.clone(),
                            &request_config,
                            cancel,
                        )
                        .await?;
                    model_calls += 1;
                    if model_calls > 128 {
                        return Err("native.ai.response.limit".into());
                    }
                    calls = response["content"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|b| b["type"] == "toolCall")
                        .cloned()
                        .collect();
                    let mut ids = std::collections::HashSet::new();
                    if calls.iter().any(|c| !ids.insert(c["id"].as_str().unwrap())) {
                        return Err("native.ai.response.invalid".into());
                    }
                    let scheduling = transcript::scheduling(&response, &definitions)?;
                    if !matches!(
                        run.model_response(scheduling)
                            .map_err(|_| "native.ai.request.failed")?,
                        ModelTurnOutcome::Continue { .. }
                    ) {
                        return Err("native.ai.request.failed".into());
                    }
                }
                AgentRunStep::CallTools { calls: pending } => {
                    for call in pending {
                        let rig_agent::run::PendingToolCall::Execute(call) = call else {
                            return Err("native.ai.response.invalid".into());
                        };
                        let id = call.id().to_string();
                        let name = call.name().to_string();
                        let definition = definitions.iter().find(|d| d.name == name).cloned();
                        let original = calls
                            .iter()
                            .find(|c| c["id"] == id)
                            .cloned()
                            .ok_or("native.ai.response.invalid")?;
                        let args = original["arguments"].clone();
                        let message_index = {
                            let state = self.state.lock().await;
                            state.snapshot.message_offset
                                + state
                                    .snapshot
                                    .record
                                    .messages
                                    .as_array()
                                    .unwrap()
                                    .len()
                                    .saturating_sub(1)
                        };
                        self.checkpoint(action,|record| {
                            let mut data = json!({"toolCallId":id,"name":name,"args":args,"messageIndex":message_index,"definition":definition,"provenance":provenance.get(name.as_str())});
                            if let Some(meta) = provenance.get(name.as_str()).and_then(Value::as_object) { for key in ["pluginId","pluginName"] { if let Some(value) = meta.get(key) { data[key] = value.clone(); } } }
                            append_event(record,action,"tool_intent",data);
                        }).await?;
                        if cancel.is_cancelled() {
                            return Err("native.ai.response.stopped".into());
                        }
                        let started = self.host.now_ms();
                        let (outcome, progress_error) = if let Some(definition) = definition {
                            self.checkpoint(action, |record| {
                                append_event(
                                    record,
                                    action,
                                    "tool_execution_start",
                                    json!({"toolCallId":id,"args":args}),
                                )
                            })
                            .await?;
                            if cancel.is_cancelled() {
                                return Err("native.ai.response.stopped".into());
                            }
                            let (sender, receiver) = mpsc::channel(32);
                            let request = ToolRequest {
                                run_id: action.into(),
                                id: id.clone(),
                                definition,
                                arguments: args,
                                call: original,
                                config: request_config.clone(),
                            };
                            let host = self.host.clone();
                            let token = cancel.clone();
                            let worker = tokio::spawn(async move {
                                host.tool(request, ProgressSink(sender), token).await
                            });
                            let (outcome, error) =
                                self.observe(action, worker, receiver, false, cancel).await;
                            match outcome {
                                Ok(outcome) => (outcome, error),
                                Err(_) => {
                                    self.worker_failed(true).await;
                                    return Err("native.ai.worker.failed".into());
                                }
                            }
                        } else {
                            (
                                ToolOutcome::Failed("native.ai.tool.unavailable".into()),
                                None,
                            )
                        };
                        let (output, is_error, disconnected) = match outcome {
                            ToolOutcome::Completed(value) => {
                                let error = value.is_error;
                                (value, error, false)
                            }
                            ToolOutcome::Failed(error) => {
                                (ToolResult::json(json!({"error":error})), true, false)
                            }
                            ToolOutcome::Disconnected {
                                generation,
                                observations,
                            } => (
                                ToolResult::json(
                                    json!({"outcome":"unknown","executorGeneration":generation,"observations":observations}),
                                ),
                                true,
                                true,
                            ),
                        };
                        let scheduling = if disconnected || progress_error.is_some() {
                            Ok(())
                        } else {
                            (|| {
                                let receipt = rig_core::tool::ToolOutput::content(
                                    transcript::tool_content(&output.content)?,
                                )
                                .map_err(|_| "native.ai.request.failed")?;
                                let result = if is_error {
                                    rig_core::tool::ToolResult::failed(
                                        rig_core::tool::ToolExecutionError::other(
                                            "native.ai.tool.failed",
                                        )
                                        .with_model_output(receipt),
                                    )
                                } else {
                                    rig_core::tool::ToolResult::success(receipt)
                                };
                                run.answer(call.answer(result))
                                    .map_err(|_| "native.ai.request.failed".to_owned())
                            })()
                        };
                        let question = output.details.get("question").cloned();
                        let onboarding_question = question.is_some()
                            && matches!(
                                name.as_str(),
                                "propose_working_method" | "show_imported_files"
                            )
                            && provenance
                                .get(name.as_str())
                                .is_none_or(|p| p["pluginId"].is_null())
                            && !disconnected
                            && progress_error.is_none()
                            && scheduling.is_ok();
                        let mut presentation = Ok(());
                        let duration = self.host.now_ms().saturating_sub(started);
                        self.retain_outcome(action,|record| {
                            let mut message = json!({"role":"toolResult","toolCallId":id,"toolName":name,"content":output.content,"details":output.details,"isError":is_error,"timestamp":self.host.now_ms(),"durationMs":duration});
                            if let Some(structured) = &output.structured_content { message["structuredContent"] = structured.clone(); }
                            record.messages.as_array_mut().unwrap().push(message);
                            append_event(record,action,"tool_execution_end",json!({"toolCallId":id,"isError":is_error,"result":output,"durationMs":duration,"outcome":if disconnected {"unknown"} else {"observed"}}));
                            if onboarding_question {
                                let end_index = record.runtime.as_ref().unwrap().events.len() - 1;
                                presentation = questions::present(record, action, question.clone().unwrap(), self.host.now_ms());
                                if presentation.is_ok() {
                                    record.messages.as_array_mut().unwrap().last_mut().unwrap()["details"].as_object_mut().unwrap().remove("question");
                                    record.runtime.as_mut().unwrap().events[end_index].data["result"]["details"].as_object_mut().unwrap().remove("question");
                                }
                            }
                        }).await?;
                        if disconnected {
                            cancel.cancel();
                            return Err("executor-disconnected".into());
                        }
                        if let Some(error) = progress_error {
                            return Err(error);
                        }
                        scheduling?;
                        presentation?;
                        if onboarding_question {
                            return Ok(());
                        }
                        if let Some(question) = question {
                            questions::validate(&question)?;
                            let mut state = self.state.lock().await;
                            let mut record = state.snapshot.record.clone();
                            questions::present(&mut record, action, question, self.host.now_ms())?;
                            self.persist(&mut state, record).await?;
                            return Ok(());
                        }
                    }
                }
                AgentRunStep::Done(_) => {
                    if self.consume(action, "steering", cancel).await?
                        || self.consume(action, "followUp", cancel).await?
                    {
                        *run = AgentRun::new("Continue the admitted conversation").max_turns(128);
                        continue;
                    }
                    return Ok(());
                }
            }
        }
    }
}

fn response_text(message: &Value) -> String {
    message["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| (b["type"] == "text").then(|| b["text"].as_str()).flatten())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}
