use super::*;
use crate::ai_conversations::Context;
use situate_agent::{Progress, ProgressSink};
use std::sync::{Arc, Mutex as StdMutex};

pub(super) struct NativeRequest {
    pub key: RunKey,
    pub run_id: String,
    pub request_id: String,
    pub kind: RequestKind,
    pub sequence: u64,
    pub messages: Vec<Value>,
    pub definitions: Vec<Value>,
    pub max_tokens: Option<u64>,
}

pub(super) fn descriptor(choice: &model::Choice) -> Result<Value, String> {
    if choice.connection.provider == "custom" {
        return Ok(serde_json::json!({
            "id":choice.model,"name":choice.model,"provider":"custom",
            "api":"openai-completions","baseUrl":choice.connection.endpoint,
            "input":["text"],"reasoning":false,"cost":null,
            "contextWindow":32768,"maxTokens":4096,
            "compat":{"supportsStore":false,"supportsDeveloperRole":false,
                "supportsReasoningEffort":false,"supportsUsageInStreaming":false,
                "maxTokensField":"max_tokens"}
        }));
    }
    let catalog: Value = serde_json::from_str(CATALOG).map_err(|_| NETWORK_ERROR)?;
    let mut descriptor = catalog["providers"]
        .as_array()
        .and_then(|providers| {
            providers
                .iter()
                .find(|p| p["id"] == choice.connection.provider)
        })
        .and_then(|provider| provider["models"].as_array())
        .and_then(|models| models.iter().find(|m| m["id"] == choice.model))
        .cloned()
        .ok_or_else(|| "native.ai.model.chooseCatalog".to_owned())?;
    if choice.connection.provider == "openai" && choice.connection.auth == Some(AuthKind::Oauth) {
        descriptor["compat"]["supportsMaxOutputTokens"] = serde_json::json!(false);
    }
    Ok(descriptor)
}

pub(super) async fn execute(
    context: &Context,
    request: NativeRequest,
    progress: Option<ProgressSink>,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let state = context.app.state::<Ai>();
    let (token, choice) = context.control(|| {
        state.dispatch_request(
            &request.key,
            &request.run_id,
            &request.request_id,
            request.kind,
            request.sequence,
        )
    })?;
    let diagnostic = crate::diagnostics::Operation::begin(
        &context.app,
        &context.window,
        &context.scope,
        crate::diagnostics::OperationKind::Model,
        None,
    );
    let result = {
        let operation = execute_admitted(
            context,
            &request,
            choice,
            token.clone(),
            progress,
            diagnostic.as_ref(),
        );
        tokio::pin!(operation);
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                token.cancel();
                operation.await
            }
            result = &mut operation => result,
        }
    };
    state.finish_request(&request.key, &request.run_id, &request.request_id)?;
    if result.as_ref().is_err_and(|error| error == REJECTED)
        && let Ok(mut rejected) = state.rejected.lock()
        && let Some(connection) = state
            .active
            .lock()
            .ok()
            .and_then(|runs| runs.get(&request.key).and_then(|run| run.choice.clone()))
            .and_then(|choice| choice.connection.connection_id)
    {
        rejected.insert((context.scope.clone(), connection));
    }
    if let Some(diagnostic) = diagnostic {
        diagnostic.result(&result);
    }
    result
}

async fn execute_admitted(
    context: &Context,
    request: &NativeRequest,
    choice: model::Choice,
    token: CancellationToken,
    progress: Option<ProgressSink>,
    diagnostic: Option<&crate::diagnostics::Operation>,
) -> Result<Value, String> {
    let descriptor = descriptor(&choice)?;
    let (api, url, fixed_headers) = target(&choice.connection, &choice.model)?;
    let prepared = crate::ai_protocol::build_request(
        &api,
        &descriptor,
        &choice.thinking,
        &request.messages,
        &request.definitions,
        request.max_tokens,
    )?;
    model::validate_payload(&choice, &prepared.body)?;
    validate_headers(&api, &prepared.headers)?;
    let body = serde_json::to_string(&prepared.body).map_err(|_| NETWORK_ERROR)?;
    if body.len() > 32 * 1024 * 1024 {
        return Err("native.ai.conversation.tooLargeToSend".into());
    }
    let state = context.app.state::<Ai>();
    let gate = state.credential_guard(&context.scope, &token).await?;
    let prepared_context = context.clone();
    let prepared_choice = choice.clone();
    let prepared_token = token.clone();
    let (storage, lock, connection) = context
        .blocking(move || {
            prepared_context.with_location(|location| {
                if prepared_token.is_cancelled() {
                    return Err("native.ai.response.stopped".into());
                }
                let storage = storage(&prepared_context.app, location)?;
                let lock = storage.lock_credentials()?;
                let connection = load_connection_id(
                    &storage,
                    &prepared_context.app,
                    prepared_choice.connection.connection_id.as_deref(),
                )?;
                model::validate_snapshot(&prepared_choice, &connection.config)?;
                discovery::catalog(&connection).admits(&prepared_choice.model)?;
                Ok((storage, lock, connection))
            })
        })
        .await?;
    let connection = refresh(context, storage, connection, token.clone()).await?;
    drop(lock);
    drop(gate);
    context.validate()?;
    if token.is_cancelled() {
        return Err("native.ai.response.stopped".into());
    }
    request_local_network_permission(&context.app, &connection.config).await?;
    let mut headers = prepared.headers;
    headers.extend(fixed_headers);
    #[cfg(feature = "native-smoke")]
    let (url, body) = crate::agent_e2e::provider_request(&api, &url, &body)?;
    #[cfg(feature = "native-smoke")]
    if crate::agent_e2e::enabled() {
        headers.insert(
            "x-situate-test-kind".into(),
            match request.kind {
                RequestKind::Main => "main",
                RequestKind::Compaction => "compaction",
                RequestKind::Comment => "comment",
                RequestKind::Title => "title",
            }
            .into(),
        );
    }
    let assembler = Arc::new(StdMutex::new(crate::ai_protocol::Assembler::new(
        &api,
        descriptor,
        crate::ai_conversations::now_ms(),
    )?));
    let callback_assembler = assembler.clone();
    let (partial_send, mut partial_receive) = tokio::sync::watch::channel(None::<Value>);
    let mut transport = Box::pin(send(
        (connection, api, url, body, headers),
        token.clone(),
        move |frame| {
            if let Frame::Data { bytes } = frame
                && let Some(partial) = callback_assembler
                    .lock()
                    .map_err(|_| NETWORK_ERROR)?
                    .push(&bytes)?
            {
                partial_send.send_replace(Some(partial));
            }
            Ok(())
        },
        diagnostic,
    ));
    let mut progress_error = None;
    let transport_result = loop {
        tokio::select! {
            result = &mut transport => break result,
            changed = partial_receive.changed(), if progress.is_some() && progress_error.is_none() => {
                if changed.is_err() { continue; }
                let partial = partial_receive.borrow_and_update().clone();
                if let (Some(progress),Some(partial))=(&progress,partial)
                    && let Err(error)=progress.send(Progress::PartialMessage(partial)).await {
                    progress_error=Some(error);
                    token.cancel();
                }
            }
        }
    };
    drop(transport);
    let mut assembler = Arc::try_unwrap(assembler)
        .map_err(|_| NETWORK_ERROR)?
        .into_inner()
        .map_err(|_| NETWORK_ERROR)?;
    if let Err(error) = transport_result {
        if let Some(progress) = progress {
            let partial = assembler.partial();
            let _ = progress.send(Progress::PartialMessage(partial)).await;
        }
        return Err(progress_error.unwrap_or(error));
    }
    context.validate()?;
    if let Some(error) = progress_error {
        return Err(error);
    }
    let result = assembler.finalize();
    if result.is_err()
        && let Some(progress) = progress
    {
        let _ = progress
            .send(Progress::PartialMessage(assembler.partial()))
            .await;
    }
    result
}

async fn refresh(
    context: &Context,
    storage: Storage,
    mut connection: Connection,
    token: CancellationToken,
) -> Result<Connection, String> {
    let needs_refresh = connection.codex.as_ref().is_some_and(|c| c.expired())
        || connection.oauth.as_ref().is_some_and(|c| c.expired());
    if needs_refresh {
        if token.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        let keys = OsKeys(context.app.clone());
        let prepared_context = context.clone();
        let (storage, authenticated, keys, expected) = context
            .blocking(move || {
                prepared_context.validate()?;
                let expected = credential_snapshot(&storage, &connection, &keys)?;
                Ok((storage, connection, keys, expected))
            })
            .await?;
        connection = authenticated;
        context.validate()?;
        if token.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        // Rotating credentials must be retained even when Stop arrives after dispatch.
        if let Some(old) = connection.codex.clone() {
            let credential = crate::codex_oauth::refresh(&old, &CancellationToken::new())
                .await
                .map_err(|error| {
                    match error {
                        crate::codex_oauth::Error::Cancelled => "native.ai.response.stopped",
                        crate::codex_oauth::Error::Denied | crate::codex_oauth::Error::Expired => {
                            REJECTED
                        }
                        crate::codex_oauth::Error::Failed => NETWORK_ERROR,
                    }
                    .to_owned()
                })?;
            if credential.account_id != old.account_id {
                return Err(REJECTED.into());
            }
            connection.codex = Some(credential);
            validate_credentials(&connection)?;
        } else if let Some(old) = connection.oauth.clone() {
            connection.oauth =
                Some(crate::openai_oauth::refresh(&old, &CancellationToken::new()).await?);
        }
        let bytes = serde_json::to_vec(&connection).map_err(|_| KEY_ERROR)?;
        let save_context = context.clone();
        context
            .blocking(move || {
                save_context
                    .with_location(|_| save_rotated_credentials(&storage, &keys, expected, &bytes))
            })
            .await?;
    }
    if connection.oauth.is_some() {
        connection.key = connection.oauth.as_ref().ok_or(REJECTED)?.access.clone();
    }
    Ok(connection)
}
