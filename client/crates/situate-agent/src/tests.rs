use super::*;
use situate_core::ai_storage::Storage;
use situate_core::conversation_history::HistoryPage;
#[path = "fixture_persistence.rs"]
mod fixture_persistence;
use fixture_persistence::save_record;
#[path = "auxiliary_tests.rs"]
mod auxiliary_tests;
#[path = "history_tests.rs"]
mod history_tests;
#[path = "owner_tests.rs"]
mod owner_tests;
#[path = "update_quiescence_tests.rs"]
mod update_quiescence_tests;
use rig_core::message::ToolName;
use std::{
    collections::VecDeque,
    sync::{
        Mutex as StdMutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::Semaphore;

type PrepareModel =
    dyn Fn(&Fixture, &mut RunConfig, CancellationToken) -> Result<(), String> + Send + Sync;

struct Fixture {
    root: tempfile::TempDir,
    storage: Storage,
    live: AtomicBool,
    models: AtomicUsize,
    effects: AtomicUsize,
    turns: StdMutex<VecDeque<Value>>,
    fail: StdMutex<Option<(&'static str, bool)>>,
    gate: Semaphore,
    entered: Notify,
    disconnected: AtomicBool,
    finished: Notify,
    lose_readback: AtomicBool,
    tool_gate: Semaphore,
    cleanup_gate: Semaphore,
    tool_entered: Notify,
    draining: Notify,
    input_save_gate: Semaphore,
    input_save_entered: Notify,
    model_inputs: StdMutex<Vec<Vec<Value>>>,
    tool_output: StdMutex<Option<ToolResult>>,
    saved_questions: StdMutex<Vec<(usize, usize)>>,
    checkpoint_bytes: StdMutex<Vec<(String, u64)>>,
    panic_at: StdMutex<Option<&'static str>>,
    definitions: StdMutex<Vec<ToolDefinition>>,
    definition_reads: AtomicUsize,
    provenance: StdMutex<Value>,
    preparations: StdMutex<Vec<RunConfig>>,
    prepare_model: StdMutex<Option<Box<PrepareModel>>>,
    tool_configs: StdMutex<Vec<RunConfig>>,
    model_definitions: StdMutex<Vec<Vec<ToolDefinition>>>,
    dispatched_definitions: StdMutex<Vec<ToolDefinition>>,
    config: StdMutex<RunConfig>,
    requests: StdMutex<Vec<ModelRequest>>,
    partials: StdMutex<Vec<Progress>>,
    model_error: StdMutex<Option<String>>,
    drain_gate: Semaphore,
    drain_entered: Notify,
    drains: AtomicUsize,
    drain_error: AtomicBool,
    question_outcome: StdMutex<Option<Result<QuestionOutcome, String>>>,
    question_actions: AtomicUsize,
    retired_questions: StdMutex<Vec<String>>,
    inputs: StdMutex<Vec<Input>>,
    input_validations: AtomicUsize,
    input_validation_error: StdMutex<Option<String>>,
    context_prefix: StdMutex<Vec<Value>>,
    compaction_response: StdMutex<Value>,
    input_gate: Semaphore,
    input_entered: Notify,
    aux_gate: Semaphore,
    aux_entered: Notify,
    aux_ignore_cancel: AtomicBool,
    aux_response: StdMutex<Result<Value, String>>,
}
impl Fixture {
    fn new() -> Arc<Self> {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let storage = Storage::open(&root.path().canonicalize().unwrap(), "workspace").unwrap();
        storage.create_conversation("chat", "Chat").unwrap();
        Arc::new(Self {
            root,
            storage,
            live: AtomicBool::new(true),
            models: AtomicUsize::new(0),
            effects: AtomicUsize::new(0),
            turns: StdMutex::new(VecDeque::from([turn(true), turn(false)])),
            fail: StdMutex::new(None),
            gate: Semaphore::new(20),
            entered: Notify::new(),
            disconnected: AtomicBool::new(false),
            finished: Notify::new(),
            lose_readback: AtomicBool::new(false),
            tool_gate: Semaphore::new(20),
            cleanup_gate: Semaphore::new(20),
            tool_entered: Notify::new(),
            draining: Notify::new(),
            input_save_gate: Semaphore::new(20),
            input_save_entered: Notify::new(),
            model_inputs: StdMutex::new(vec![]),
            tool_output: StdMutex::new(None),
            saved_questions: StdMutex::new(vec![]),
            checkpoint_bytes: StdMutex::new(vec![]),
            panic_at: StdMutex::new(None),
            definitions: StdMutex::new(vec![ToolDefinition::new(
                ToolName::new("write").unwrap(),
                "Write a fixture",
                json!({"type":"object","properties":{}}),
            )]),
            definition_reads: AtomicUsize::new(0),
            provenance: StdMutex::new(json!({"pluginId":"fixture","pluginName":"Fixture"})),
            preparations: StdMutex::new(vec![]),
            prepare_model: StdMutex::new(None),
            tool_configs: StdMutex::new(vec![]),
            model_definitions: StdMutex::new(vec![]),
            dispatched_definitions: StdMutex::new(vec![]),
            config: StdMutex::new(RunConfig {
                settings: Value::Null,
                instructions: vec![],
                context_window: 200000,
                max_tokens: 8192,
                generate_title: false,
                generate_comments: false,
            }),
            requests: StdMutex::new(vec![]),
            partials: StdMutex::new(vec![]),
            model_error: StdMutex::new(None),
            drain_gate: Semaphore::new(100),
            drain_entered: Notify::new(),
            drains: AtomicUsize::new(0),
            drain_error: AtomicBool::new(false),
            question_outcome: StdMutex::new(None),
            question_actions: AtomicUsize::new(0),
            retired_questions: StdMutex::new(vec![]),
            inputs: StdMutex::new(vec![]),
            input_validations: AtomicUsize::new(0),
            input_validation_error: StdMutex::new(None),
            context_prefix: StdMutex::new(vec![]),
            compaction_response: StdMutex::new(turn(false)),
            input_gate: Semaphore::new(100),
            input_entered: Notify::new(),
            aux_gate: Semaphore::new(100),
            aux_entered: Notify::new(),
            aux_ignore_cancel: AtomicBool::new(false),
            aux_response: StdMutex::new(Ok(turn(false))),
        })
    }
    fn durable(&self) -> ConversationRecord {
        self.storage.read_conversation("chat").unwrap().unwrap()
    }
    fn fail_at(&self, point: &'static str, published: bool) {
        *self.fail.lock().unwrap() = Some((point, published));
    }
    fn panic_if(&self, point: &str) {
        let panics = {
            let mut expected = self.panic_at.lock().unwrap();
            if *expected == Some(point) {
                expected.take();
                true
            } else {
                false
            }
        };
        assert!(!panics, "fixture worker failure");
    }
}
impl Host for Fixture {
    fn now_ms(&self) -> u64 {
        20
    }
    fn validate_session(&self) -> Result<(), String> {
        if self.live.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err("session-inactive".into())
        }
    }
    async fn load(&self) -> Result<ConversationContext, String> {
        self.validate_session()?;
        self.storage
            .read_conversation_context("chat")?
            .ok_or("missing-chat".into())
    }
    async fn append(
        &self,
        expected_revision: u64,
        entries: Vec<HistoryEntry>,
        selected_entry_id: Option<String>,
    ) -> Result<ConversationMetadata, SaveFailure> {
        self.validate_session()?;
        let events: Vec<Value> = entries
            .iter()
            .filter(|entry| entry.kind == "event")
            .map(|entry| entry.data.clone())
            .collect();
        let previous = self.durable();
        let runtime = previous.runtime.unwrap_or_default();
        self.saved_questions.lock().unwrap().push((
            runtime
                .events
                .iter()
                .filter(|event| event.kind == "tool_execution_end")
                .count()
                + events
                    .iter()
                    .filter(|event| event["type"] == "tool_execution_end")
                    .count(),
            runtime
                .events
                .iter()
                .filter(|event| event.kind == "question_presented")
                .count()
                + events
                    .iter()
                    .filter(|event| event["type"] == "question_presented")
                    .count(),
        ));
        let point = if entries
            .iter()
            .any(|entry| entry.kind == "run" && entry.data["state"] != "running")
        {
            "final"
        } else if events
            .iter()
            .any(|event| event["type"] == "tool_execution_end")
        {
            "result"
        } else if events.iter().any(|event| event["type"] == "input_accepted") {
            "input"
        } else if events.iter().any(|event| event["type"] == "tool_intent") {
            "intent"
        } else {
            "other"
        };
        if point == "input" {
            self.input_save_entered.notify_one();
            self.input_save_gate.acquire().await.unwrap().forget();
        }
        let fail = {
            let mut fail = self.fail.lock().unwrap();
            if fail
                .as_ref()
                .is_some_and(|(expected, _)| *expected == point)
            {
                fail.take()
            } else {
                None
            }
        };
        if let Some((_, published)) = fail {
            if published {
                self.storage.append_conversation_entries(
                    "chat",
                    expected_revision,
                    &entries,
                    selected_entry_id.as_deref(),
                )?;
                let error = if self.lose_readback.swap(false, Ordering::SeqCst) {
                    "readback-failed-after-publication"
                } else {
                    "durability-failed"
                };
                return Err(error.to_owned().into());
            }
            return Err("save-failed".to_owned().into());
        }
        self.panic_if(point);
        let saved = self.storage.append_conversation_entries(
            "chat",
            expected_revision,
            &entries,
            selected_entry_id.as_deref(),
        )?;
        let checkpoint = events
            .last()
            .and_then(|event| event["type"].as_str())
            .unwrap_or("empty");
        let bytes = std::fs::metadata(
            self.root
                .path()
                .join(".situate/conversations/chat/history.jsonl"),
        )
        .unwrap()
        .len();
        self.checkpoint_bytes
            .lock()
            .unwrap()
            .push((checkpoint.into(), bytes));
        if point == "final" {
            self.checkpoint_bytes
                .lock()
                .unwrap()
                .push(("final".into(), bytes));
            self.finished.notify_one();
        }
        Ok(saved)
    }
    async fn update_metadata(
        &self,
        metadata: ConversationMetadata,
        expected_revision: u64,
    ) -> Result<ConversationMetadata, SaveFailure> {
        self.storage
            .update_conversation_metadata(&metadata, expected_revision)
            .map_err(Into::into)
    }
    async fn entry(&self, entry_id: String) -> Result<Option<HistoryEntry>, String> {
        self.storage.find_conversation_entry("chat", &entry_id)
    }
    async fn action(&self, action_id: String) -> Result<Option<HistoryEntry>, String> {
        self.storage.find_conversation_action("chat", &action_id)
    }
    async fn input_state(&self, input_id: String) -> Result<Option<String>, String> {
        self.storage
            .find_conversation_input_state("chat", &input_id)
    }
    async fn history(&self, before: Option<String>, limit: usize) -> Result<HistoryPage, String> {
        self.storage
            .read_conversation_history("chat", before.as_deref(), limit)
    }
    fn definitions(&self) -> Vec<ToolDefinition> {
        self.definition_reads.fetch_add(1, Ordering::SeqCst);
        self.definitions.lock().unwrap().clone()
    }
    async fn plugin_available(&self, plugin_id: String) -> Result<Value, String> {
        Ok(json!({"pluginId":plugin_id,"pluginName":"Active fixture"}))
    }
    async fn validate_input(&self, input: &Input) -> Result<(), String> {
        self.input_validations.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.input_validation_error.lock().unwrap().clone() {
            return Err(error);
        }
        if input
            .references
            .iter()
            .any(|reference| reference.workspace_id() != "workspace")
        {
            return Err("native.ai.conversation.versionInvalid".into());
        }
        for attachment in &input.attachments {
            let (stored, _) = self.storage.read_attachment(&attachment.id)?;
            if stored != *attachment {
                return Err("native.ai.conversation.versionInvalid".into());
            }
        }
        Ok(())
    }
    fn tool_provenance(&self, _definition: &ToolDefinition) -> Value {
        self.provenance.lock().unwrap().clone()
    }
    async fn prepare_model(
        &self,
        config: &mut RunConfig,
        cancel: CancellationToken,
    ) -> Result<(), String> {
        self.preparations.lock().unwrap().push(config.clone());
        if let Some(prepare) = self.prepare_model.lock().unwrap().as_ref() {
            prepare(self, config, cancel)?;
        }
        Ok(())
    }
    async fn capture(
        &self,
        _id: String,
        _metadata: ConversationMetadata,
        _cancel: CancellationToken,
    ) -> Result<RunConfig, String> {
        Ok(self.config.lock().unwrap().clone())
    }
    async fn input(
        &self,
        input: Input,
        timestamp: u64,
        _cancel: CancellationToken,
    ) -> Result<Value, String> {
        self.inputs.lock().unwrap().push(input.clone());
        self.input_entered.notify_one();
        self.input_gate.acquire().await.unwrap().forget();
        if input.attachments.is_empty() {
            return Ok(json!({"role":"user","content":input.text,"timestamp":timestamp}));
        }
        let mut content = vec![];
        if !input.text.is_empty() {
            content.push(json!({"type":"text","text":input.text}));
        }
        for attachment in input.attachments {
            let (stored, bytes) = self.storage.read_attachment(&attachment.id)?;
            if stored != attachment {
                return Err("native.ai.conversation.versionInvalid".into());
            }
            if attachment.mime_type == "text/plain" {
                content.push(json!({"type":"text","text":String::from_utf8(bytes).map_err(|_| "chat.attachmentEncoding")?}));
            } else {
                content.push(json!({"type":"image","data":format!("attachment:{}",attachment.id),"mimeType":attachment.mime_type}));
            }
        }
        Ok(json!({"role":"user","content":content,"timestamp":timestamp}))
    }
    async fn context(
        &self,
        messages: Vec<Value>,
        _config: RunConfig,
        _cancel: CancellationToken,
    ) -> Result<Vec<Value>, String> {
        let mut context = self.context_prefix.lock().unwrap().clone();
        context.extend(messages);
        Ok(context)
    }
    async fn question_retired(&self, question: Value) -> Result<bool, String> {
        Ok(self
            .retired_questions
            .lock()
            .unwrap()
            .iter()
            .any(|id| question["id"] == *id))
    }
    async fn question_action(
        &self,
        _question: Value,
        _response: Value,
        _cancel: CancellationToken,
    ) -> Result<QuestionOutcome, String> {
        self.question_actions.fetch_add(1, Ordering::SeqCst);
        self.question_outcome
            .lock()
            .unwrap()
            .take()
            .unwrap_or(Ok(QuestionOutcome::default()))
    }
    async fn drain(&self, _id: String, _cancel: CancellationToken) -> Result<(), String> {
        self.drains.fetch_add(1, Ordering::SeqCst);
        self.drain_entered.notify_one();
        self.drain_gate.acquire().await.unwrap().forget();
        if self.drain_error.load(Ordering::SeqCst) {
            Err("drain-failed".into())
        } else {
            Ok(())
        }
    }
    async fn model(
        &self,
        request: ModelRequest,
        progress: ProgressSink,
        cancel: CancellationToken,
    ) -> Result<Value, String> {
        self.validate_session()?;
        self.requests.lock().unwrap().push(request.clone());
        if matches!(request.kind, RequestKind::Title | RequestKind::Comment) {
            progress.send(Progress::PartialMessage(json!({"role":"assistant","content":[{"type":"text","text":"Auxiliary partial"}]}))).await?;
            self.aux_entered.notify_one();
            if self.aux_ignore_cancel.load(Ordering::SeqCst) {
                self.aux_gate.acquire().await.unwrap().forget();
            } else {
                tokio::select! {permit=self.aux_gate.acquire()=>permit.unwrap().forget(),_=cancel.cancelled()=>return Err("aux-cancelled".into())}
            }
            return self.aux_response.lock().unwrap().clone();
        }
        if request.kind == RequestKind::Compaction {
            return Ok(self.compaction_response.lock().unwrap().clone());
        }
        self.model_definitions
            .lock()
            .unwrap()
            .push(request.definitions);
        self.models.fetch_add(1, Ordering::SeqCst);
        self.model_inputs.lock().unwrap().push(request.context);
        let updates = std::mem::take(&mut *self.partials.lock().unwrap());
        for update in updates {
            progress.send(update).await?;
        }
        self.entered.notify_one();
        self.panic_if("model");
        tokio::select! {
            permit = self.gate.acquire() => permit.unwrap().forget(),
            _ = cancel.cancelled() => {
                self.draining.notify_one();
                self.cleanup_gate.acquire().await.unwrap().forget();
                return Err(self.model_error.lock().unwrap().take().unwrap_or_else(|| "native.ai.response.stopped".into()));
            }
        }
        self.validate_session()?;
        if let Some(error) = self.model_error.lock().unwrap().take() {
            return Err(error);
        }
        self.turns
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| "unexpected-model-call".into())
    }
    async fn tool(
        &self,
        request: ToolRequest,
        _progress: ProgressSink,
        cancel: CancellationToken,
    ) -> ToolOutcome {
        if let Err(error) = self.validate_session() {
            return ToolOutcome::Failed(error);
        }
        self.tool_configs.lock().unwrap().push(request.config);
        self.dispatched_definitions
            .lock()
            .unwrap()
            .push(request.definition);
        self.effects.fetch_add(1, Ordering::SeqCst);
        std::fs::write(self.root.path().join("effect.txt"), "acknowledged effect").unwrap();
        self.tool_entered.notify_one();
        self.panic_if("tool");
        tokio::select! {
            permit = self.tool_gate.acquire() => permit.unwrap().forget(),
            _ = cancel.cancelled() => {
                self.draining.notify_one();
                self.cleanup_gate.acquire().await.unwrap().forget();
            }
        }
        if let Some(output) = self.tool_output.lock().unwrap().take() {
            return ToolOutcome::Completed(output);
        }
        if self.disconnected.load(Ordering::SeqCst) {
            ToolOutcome::Disconnected {
                generation: 7,
                observations: vec![],
            }
        } else {
            ToolOutcome::Completed(ToolResult::json(json!({"path":"effect.txt","saved":true})))
        }
    }
}
fn onboarding_result(question: Value) -> (Arc<Fixture>, Value) {
    let host = Fixture::new();
    *host.provenance.lock().unwrap() = Value::Null;
    *host.definitions.lock().unwrap() = vec![ToolDefinition::new(
        ToolName::new("show_imported_files").unwrap(),
        "Review imported files",
        json!({"type":"object","properties":{}}),
    )];
    let mut response = turn(true);
    response["content"][0]["name"] = json!("show_imported_files");
    *host.turns.lock().unwrap() = VecDeque::from([response, turn(false)]);
    let files = (0..7).map(|i| json!({"kind":"live","workspaceId":"workspace","path":format!("Imported/{i}.md"),"anchorRevision":"a".repeat(40)})).collect::<Vec<_>>();
    let data = json!({"files":files,"missing":["Unavailable attachment"],"complete":false,"receipt":{"extra":"preserved"}});
    let mut output = ToolResult::json(data.clone());
    output.details["question"] = question;
    *host.tool_output.lock().unwrap() = Some(output);
    (host, data)
}

fn import_question() -> Value {
    json!({"id":"import-question","prompt":"Continue without missing files?","suggestions":[{"id":"support","label":"Continue"}],"context":{"kind":"onboarding","action":"import","conversation":"chat","record":situate_core::onboarding::OnboardingRecord { conversation_id:Some("chat".into()), step:situate_core::onboarding::Step::Sources, ..Default::default() }}})
}

#[tokio::test]
async fn onboarding_question_and_outcome_share_one_checkpoint_and_reopen() {
    let question = import_question();
    let (host, data) = onboarding_result(question.clone());
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Review imports".into(), 10)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    let saved = host.durable();
    let result = saved.messages.as_array().unwrap().last().unwrap();
    assert_eq!(result["details"], data);
    assert_eq!(
        serde_json::from_str::<Value>(result["content"][0]["text"].as_str().unwrap()).unwrap(),
        data
    );
    let events = &saved.runtime.as_ref().unwrap().events;
    let end = events
        .iter()
        .position(|e| e.kind == "tool_execution_end")
        .unwrap();
    assert_eq!(events[end].data["result"]["details"], data);
    assert_eq!(events[end + 1].kind, "question_presented");
    assert_eq!(events[end + 1].data["context"], question["context"]);
    assert_eq!(events[end + 1].sequence, events[end].sequence + 1);
    assert!(!host.saved_questions.lock().unwrap().contains(&(1, 0)));
    assert_eq!(
        questions::pending(&saved).unwrap()["context"],
        question["context"]
    );
    let reopened = Owner::open(host.clone()).await.unwrap();
    assert_eq!(
        questions::pending(&reopened.snapshot().await.unwrap().record),
        questions::pending(&saved)
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn rejected_onboarding_questions_retain_the_original_observed_payload() {
    for duplicate in [false, true] {
        let mut question = import_question();
        if !duplicate {
            question["prompt"] = json!("");
        }
        question["unknown"] = json!({"retain":"rejected payload"});
        let (host, _) = onboarding_result(question.clone());
        if duplicate {
            let mut record = host.durable();
            questions::present(&mut record, "previous", question.clone(), 1).unwrap();
            append_event(
                &mut record,
                "previous",
                "question_superseded",
                json!({"questionId":question["id"]}),
            );
            save_record(&host.storage, &record).unwrap();
        }
        let observed = host.tool_output.lock().unwrap().as_ref().unwrap().clone();
        let owner = Owner::open(host.clone()).await.unwrap();
        owner
            .submit("action".into(), "Review imports".into(), 10)
            .await
            .unwrap();
        let state = owner.settled().await.unwrap();
        assert_eq!(
            state.error.as_deref(),
            Some(if duplicate {
                "chatQuestion.stale"
            } else {
                "chatQuestion.invalid"
            })
        );
        let saved = host.durable();
        assert_eq!(
            saved.messages.as_array().unwrap().last().unwrap()["details"],
            observed.details
        );
        let events = &saved.runtime.as_ref().unwrap().events;
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == "question_presented")
                .count(),
            usize::from(duplicate)
        );
        assert_eq!(
            events
                .iter()
                .find(|e| e.kind == "tool_execution_end")
                .unwrap()
                .data["result"],
            serde_json::to_value(observed).unwrap()
        );
    }
}

#[tokio::test]
async fn onboarding_combined_checkpoint_retry_preserves_question_without_replaying_effects() {
    for (point, published, lose_readback) in [
        ("result", false, false),
        ("result", true, false),
        ("result", true, true),
        ("final", false, false),
        ("final", true, true),
    ] {
        let (host, _) = onboarding_result(import_question());
        host.fail_at(point, published);
        host.lose_readback.store(lose_readback, Ordering::SeqCst);
        let owner = Owner::open(host.clone()).await.unwrap();
        owner
            .submit("action".into(), "Review imports".into(), 10)
            .await
            .unwrap();
        assert_eq!(
            owner.settled().await.unwrap().phase,
            Phase::PersistenceFailed
        );
        let exact = owner.state.lock().await.pending.clone().unwrap();
        assert!(questions::pending(&exact).is_some());
        assert!(
            exact.messages.as_array().unwrap().last().unwrap()["details"]
                .get("question")
                .is_none()
        );
        assert_eq!(
            questions::pending(&host.durable()).is_some(),
            published || point == "final"
        );
        owner.retry_persistence().await.unwrap();
        let saved = host.durable();
        assert_eq!(saved.messages, exact.messages);
        let without_storage_refs = |record: &ConversationRecord| {
            let mut events = record.runtime.as_ref().unwrap().events.clone();
            for event in &mut events {
                event.data.as_object_mut().unwrap().remove("resultEntryId");
            }
            events
        };
        assert_eq!(without_storage_refs(&saved), without_storage_refs(&exact));
        assert_eq!(host.models.load(Ordering::SeqCst), 1);
        assert_eq!(host.effects.load(Ordering::SeqCst), 1);
        assert!(questions::pending(&saved).is_some());
    }
}

#[tokio::test]
async fn cancelled_onboarding_tool_retains_its_observed_result_and_question() {
    let (host, data) = onboarding_result(import_question());
    host.tool_gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Review imports".into(), 10)
        .await
        .unwrap();
    host.tool_entered.notified().await;
    owner.cancel_retained();
    let stopped = owner.settled().await.unwrap();
    assert_eq!(stopped.phase, Phase::Interrupted);
    assert_eq!(
        stopped
            .record
            .runtime
            .as_ref()
            .unwrap()
            .runs
            .last()
            .unwrap()
            .state,
        "interrupted"
    );
    assert_eq!(
        stopped.record.messages.as_array().unwrap().last().unwrap()["details"],
        data
    );
    assert!(questions::pending(&host.durable()).is_some());
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn large_actual_import_results_are_lossless_and_overflow_retains_the_exact_checkpoint() {
    for existing_history in [false, true] {
        let mut question = import_question();
        let files = (0..5000).map(|i| json!({"kind":"live","workspaceId":"workspace","path":format!("Imported/{i:04}-{}.md", "x".repeat(100)),"anchorRevision":"a".repeat(40)})).collect::<Vec<_>>();
        question["context"]["record"]["imported"] = json!(files);
        let (host, _) = onboarding_result(question.clone());
        host.config.lock().unwrap().context_window = 20_000_000;
        let data = json!({"files":files,"missing":["Attachment pending"],"complete":false,"receipt":{"opaque":["keep",7]}});
        let mut output = ToolResult::json(data.clone());
        output.details["question"] = question.clone();
        *host.tool_output.lock().unwrap() = Some(output);
        if existing_history {
            let mut record = host.durable();
            record.messages =
                json!([{"role":"user","content":"x".repeat(13_791_890),"timestamp":1}]);
            save_record(&host.storage, &record).unwrap();
        }
        let owner = Owner::open(host.clone()).await.unwrap();
        owner
            .submit("action".into(), "Review imports".into(), 10)
            .await
            .unwrap();
        let state = owner.settled().await.unwrap();
        {
            assert_eq!(state.phase, Phase::Idle);
            assert_eq!(state.error, None);
            let saved = host.durable();
            let result = saved.messages.as_array().unwrap().last().unwrap();
            assert_eq!(result["details"], data);
            assert_eq!(
                serde_json::from_str::<Value>(result["content"][0]["text"].as_str().unwrap())
                    .unwrap(),
                data
            );
            let end = saved
                .runtime
                .as_ref()
                .unwrap()
                .events
                .iter()
                .find(|e| e.kind == "tool_execution_end")
                .unwrap();
            assert_eq!(end.data["result"]["details"], data);
            assert_eq!(
                questions::pending(&saved).unwrap()["context"],
                question["context"]
            );
        }
        assert_eq!(host.effects.load(Ordering::SeqCst), 1);
        assert_eq!(host.models.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn plugin_question_payloads_are_not_sanitized_by_builtin_name() {
    let (host, _) = onboarding_result(import_question());
    *host.provenance.lock().unwrap() = json!({"pluginId":"fixture","pluginName":"Fixture"});
    let original = host
        .tool_output
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .details
        .clone();
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Review imports".into(), 10)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    assert_eq!(
        host.durable().messages.as_array().unwrap().last().unwrap()["details"],
        original
    );
}

#[tokio::test]
async fn large_import_question_preserves_legacy_history_through_answer_checkpoints() {
    let mut question = import_question();
    question["context"]["record"]["imported"] = Value::Array((0..4421).map(|i| json!({"kind":"live","workspaceId":"workspace","path":format!("Imported/{i:04}-{}.md", "x".repeat(100)),"anchorRevision":"a".repeat(40)})).collect());
    let (host, _) = onboarding_result(question.clone());
    host.config.lock().unwrap().context_window = 20_000_000;
    let mut record = host.durable();
    let old_question = import_question();
    let old_details = json!({"question":old_question,"unknown":{"receipt":"retained"}});
    record.messages = json!([
        {"role":"assistant","content":[{"type":"toolCall","id":"old-call","name":"show_imported_files","arguments":{}}],"timestamp":1,"stopReason":"toolUse","usage":null},
        {"role":"toolResult","toolCallId":"old-call","toolName":"show_imported_files","content":[{"type":"text","text":old_details.to_string()}],"details":old_details,"isError":false,"timestamp":2}
    ]);
    let old_result = json!({"toolCallId":"old-call","result":{"content":record.messages[1]["content"],"details":old_details}});
    append_event(&mut record, "old-run", "tool_execution_end", old_result);
    let padding = 13_791_890 - serde_json::to_vec(&record).unwrap().len();
    record.messages[1]["content"][0]["text"] =
        json!(format!("{}{}", old_details, " ".repeat(padding)));
    record = save_record(&host.storage, &record).unwrap();
    let old_messages = record.messages.as_array().unwrap().clone();
    let old_events = record.runtime.as_ref().unwrap().events.clone();
    let before = std::fs::read(
        host.root
            .path()
            .join(".situate/conversations/chat/history.jsonl"),
    )
    .unwrap();
    assert!(before.len() > 13_000_000);
    assert!(before.len() + 4 * serde_json::to_vec(&question).unwrap().len() > 16 * 1024 * 1024);
    let owner = Owner::open(host.clone()).await.unwrap();
    assert_eq!(
        std::fs::read(
            host.root
                .path()
                .join(".situate/conversations/chat/history.jsonl")
        )
        .unwrap(),
        before
    );
    owner
        .submit("action".into(), "Review imports".into(), 10)
        .await
        .unwrap();
    let state = owner.settled().await.unwrap();
    assert_eq!(state.phase, Phase::Idle);
    assert_eq!(state.error, None);
    assert_eq!(
        state
            .record
            .runtime
            .as_ref()
            .unwrap()
            .runs
            .last()
            .unwrap()
            .state,
        "completed"
    );
    assert_eq!(
        state.record.messages.as_array().unwrap().last().unwrap()["details"]["files"]
            .as_array()
            .unwrap()
            .len(),
        7
    );
    assert_eq!(
        questions::pending(&state.record).unwrap()["context"],
        question["context"]
    );
    *host.question_outcome.lock().unwrap() = Some(Ok(QuestionOutcome {
        question: None,
        continue_run: true,
    }));
    owner.apply("answer".into(), json!({"version":1,"type":"answerQuestion","response":{"questionId":"import-question","choiceId":"support"},"input":{"text":"","attachments":[],"references":[]},"timestamp":30})).await.unwrap();
    let completed = owner.settled().await.unwrap();
    assert_eq!(completed.phase, Phase::Idle);
    assert_eq!(completed.error, None);
    assert_eq!(
        completed
            .record
            .runtime
            .as_ref()
            .unwrap()
            .runs
            .last()
            .unwrap()
            .state,
        "completed"
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 2);
    {
        let sizes = host.checkpoint_bytes.lock().unwrap();
        for label in [
            "question_presented",
            "question_answered",
            "question_action_completed",
            "work_block_start",
            "final",
        ] {
            assert!(
                sizes
                    .iter()
                    .any(|(kind, bytes)| kind == label && *bytes > before.len() as u64),
                "{label}"
            );
        }
        assert!(sizes.iter().all(|(_, bytes)| *bytes >= before.len() as u64));
    }
    let saved = host.durable();
    assert_eq!(
        &saved.messages.as_array().unwrap()[..old_messages.len()],
        old_messages
    );
    assert_eq!(
        &saved.runtime.as_ref().unwrap().events[..old_events.len()],
        old_events
    );
    assert!(questions::pending(&saved).is_none());
    assert!(
        saved
            .runtime
            .as_ref()
            .unwrap()
            .events
            .iter()
            .any(|e| e.kind == "question_answered" && e.data["questionId"] == "import-question")
    );
    assert!(saved.runtime.as_ref().unwrap().events.iter().any(|e| e.kind
        == "question_action_completed"
        && e.data["questionId"] == "import-question"));
    assert_eq!(host.question_actions.load(Ordering::SeqCst), 1);
    let history = std::fs::read(
        host.root
            .path()
            .join(".situate/conversations/chat/history.jsonl"),
    )
    .unwrap();
    assert!(history.starts_with(&before));
    let reopened = Owner::open(host.clone()).await.unwrap();
    assert_eq!(reopened.snapshot().await.unwrap().record, saved);
}

async fn failing_title_checkpoint(owner: &Arc<Owner<Fixture>>) -> Result<Snapshot, String> {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        owner.edit_draft("", "Next".into()).await.unwrap();
        let expected = owner.snapshot().await.unwrap().record.title;
        owner
            .apply(
                "rename".into(),
                json!({"version":1,"type":"renameTitle","expected":expected,"title":"Next"}),
            )
            .await
    })
    .await
    .expect("title mutation did not settle")
}

fn turn(tool: bool) -> Value {
    json!({"role":"assistant","content":if tool {json!([{"type":"toolCall","id":"call-1","name":"write","arguments":{}}])} else {json!([{"type":"text","text":"Finished"}])},
        "timestamp":20,"stopReason":if tool {"toolUse"} else {"stop"},
        "usage":{"input":3,"output":2,"cacheRead":0,"cacheWrite":0,"totalTokens":5,"cost":{"input":0.1,"output":0.2,"cacheRead":0,"cacheWrite":0,"total":0.3}}})
}

#[tokio::test]
async fn task_finishes_without_observers_and_reopens_durable_completion() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let accepted = owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    assert_eq!(
        accepted.record.runtime.as_ref().unwrap().pending[0].state,
        "pending"
    );
    assert_eq!(accepted.record.messages.as_array().unwrap().len(), 1);
    // The application task, not a view or snapshot, retains ownership.
    drop(owner);
    host.finished.notified().await;
    assert_eq!(host.durable().runtime.unwrap().runs[0].state, "completed");
    let reopened = Owner::open(host.clone()).await.unwrap();
    assert_eq!(
        reopened.snapshot().await.unwrap().record.messages[3]["content"][0]["text"],
        "Finished"
    );
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn lost_acknowledgement_deduplicates_after_reload_and_rejects_changed_payload() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    let reopened = Owner::open(host.clone()).await.unwrap();
    reopened
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    assert_eq!(host.models.load(Ordering::SeqCst), 2);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    assert_eq!(
        reopened
            .submit("action".into(), "Changed".into(), 10)
            .await
            .unwrap_err(),
        "native.ai.conversation.conflict"
    );
}

#[tokio::test]
async fn failed_input_and_tool_intent_saves_prevent_new_effects() {
    for point in ["input", "intent"] {
        let host = Fixture::new();
        host.fail_at(point, false);
        let owner = Owner::open(host.clone()).await.unwrap();
        let submitted = owner.submit("action".into(), "Write it".into(), 10).await;
        if point == "input" {
            assert!(submitted.is_err());
        } else {
            submitted.unwrap();
        }
        assert_eq!(
            owner.settled().await.unwrap().phase,
            Phase::PersistenceFailed
        );
        assert_eq!(host.effects.load(Ordering::SeqCst), 0);
        let models = host.models.load(Ordering::SeqCst);
        owner.retry_persistence().await.unwrap();
        assert_eq!(host.effects.load(Ordering::SeqCst), 0);
        assert_eq!(host.models.load(Ordering::SeqCst), models);
        assert_eq!(host.durable().runtime.unwrap().runs[0].state, "interrupted");
    }
}

#[tokio::test]
async fn result_and_final_save_retries_do_not_repeat_effects_or_generation() {
    for point in ["result", "final"] {
        let host = Fixture::new();
        host.fail_at(point, false);
        let owner = Owner::open(host.clone()).await.unwrap();
        owner
            .submit("action".into(), "Write it".into(), 10)
            .await
            .unwrap();
        assert_eq!(
            owner.settled().await.unwrap().phase,
            Phase::PersistenceFailed
        );
        assert_eq!(host.effects.load(Ordering::SeqCst), 1);
        let models = host.models.load(Ordering::SeqCst);
        let saved = owner.retry_persistence().await.unwrap();
        assert_eq!(host.effects.load(Ordering::SeqCst), 1);
        assert_eq!(host.models.load(Ordering::SeqCst), models);
        assert_eq!(saved.record.messages[2]["details"]["saved"], true);
        let events = saved.record.runtime.unwrap().events;
        let intent = events.iter().find(|e| e.kind == "tool_intent").unwrap();
        let event = events
            .iter()
            .find(|e| e.kind == "tool_execution_end")
            .unwrap();
        assert_eq!(intent.data["toolCallId"], event.data["toolCallId"]);
        assert_eq!(event.data["toolCallId"], "call-1");
        assert_eq!(event.data["result"]["details"]["saved"], true);
        assert_eq!(event.data["result"]["content"][0]["type"], "text");
    }
}

#[tokio::test]
async fn published_write_error_remains_unacknowledged_until_explicit_reflush() {
    let host = Fixture::new();
    host.fail_at("input", true);
    let owner = Owner::open(host.clone()).await.unwrap();
    assert!(
        owner
            .submit("action".into(), "Write it".into(), 10)
            .await
            .is_err()
    );
    let unsaved = owner.snapshot().await.unwrap();
    assert_eq!(unsaved.phase, Phase::PersistenceFailed);
    assert!(unsaved.record.revision < host.durable().revision);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    let saved = owner.retry_persistence().await.unwrap();
    assert!(saved.record.revision > unsaved.record.revision);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn terminated_owner_running_state_is_interrupted_without_replay() {
    let host = Fixture::new();
    let mut record = host.durable();
    record.runtime = Some(Default::default());
    record.runtime.as_mut().unwrap().runs.push(Run {
        id: "old".into(),
        state: "running".into(),
        started_at: 1,
        ended_at: None,
        usage: None,
        references: vec![],
    });
    save_record(&host.storage, &record).unwrap();
    let owner = Owner::open(host.clone()).await.unwrap();
    assert_eq!(owner.snapshot().await.unwrap().phase, Phase::Interrupted);
    assert_eq!(host.durable().runtime.unwrap().runs[0].state, "interrupted");
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn old_session_cannot_publish_model_callback_or_read_snapshot() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    let before = host.durable();
    host.live.store(false, Ordering::SeqCst);
    host.gate.add_permits(1);
    // Wait for the old application task to finish without authorizing a view.
    loop {
        if owner.state.lock().await.snapshot.phase != Phase::Running {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert_eq!(owner.snapshot().await.unwrap_err(), "session-inactive");
    assert_eq!(host.durable(), before);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn executor_disconnect_retains_unknown_result_and_never_replays() {
    let host = Fixture::new();
    host.disconnected.store(true, Ordering::SeqCst);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    let finished = owner.settled().await.unwrap();
    assert_eq!(finished.phase, Phase::Interrupted);
    assert_eq!(
        finished.record.messages[2]["details"],
        json!({"outcome":"unknown","executorGeneration":7,"observations":[]})
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    let reopened = Owner::open(host.clone()).await.unwrap();
    reopened
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn draft_edits_are_field_specific_and_do_not_replace_the_transcript() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    let before = host.durable().messages;
    owner.edit_draft("", "Next request".into()).await.unwrap();
    assert!(owner.edit_draft("", "Stale".into()).await.is_err());
    assert_eq!(host.durable().messages, before);
    assert_eq!(owner.snapshot().await.unwrap().record.draft, "Next request");
    assert!(host.durable().draft.is_empty());
}

#[tokio::test]
async fn metadata_save_failure_cannot_release_a_still_draining_tool_or_lose_its_result() {
    let host = Fixture::new();
    host.tool_gate.forget_permits(20);
    host.cleanup_gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("first".into(), "Write it".into(), 10)
        .await
        .unwrap();
    host.tool_entered.notified().await;
    host.fail_at("other", false);
    assert!(failing_title_checkpoint(&owner).await.is_err());
    host.draining.notified().await;
    assert!(owner.snapshot().await.unwrap().task_active);
    assert!(owner.retry_persistence().await.is_err());
    assert!(
        owner
            .submit("second".into(), "New request".into(), 30)
            .await
            .is_err()
    );
    host.cleanup_gate.add_permits(1);
    let failed = owner.settled().await.unwrap();
    assert!(!failed.task_active);
    assert_eq!(failed.phase, Phase::PersistenceFailed);
    let saved = owner.retry_persistence().await.unwrap();
    assert_eq!(saved.record.messages[2]["details"]["saved"], true);
    assert_eq!(saved.record.draft, "Next");
    assert_eq!(saved.record.runtime.unwrap().runs[0].state, "interrupted");
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    host.turns.lock().unwrap().push_back(turn(false));
    host.tool_gate.add_permits(20);
    owner
        .submit("second".into(), "New request".into(), 30)
        .await
        .unwrap();
    let second = owner.settled().await.unwrap();
    assert_eq!(second.record.runtime.unwrap().runs[1].state, "completed");
}

#[tokio::test]
async fn retained_stop_does_not_wait_for_admission_and_waits_for_model_drain() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    host.cleanup_gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    let state = owner.state.lock().await;
    owner.cancel_retained();
    host.draining.notified().await;
    assert!(state.snapshot.task_active);
    drop(state);
    let waiter_owner = owner.clone();
    let waiter = tokio::spawn(async move { waiter_owner.settled().await.unwrap() });
    tokio::task::yield_now().await;
    assert!(!waiter.is_finished());
    host.cleanup_gate.add_permits(1);
    assert_eq!(waiter.await.unwrap().phase, Phase::Interrupted);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn every_content_returning_action_rejects_an_invalidated_session_even_when_idle() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    host.live.store(false, Ordering::SeqCst);
    assert!(owner.snapshot().await.is_err());
    assert!(owner.retry_persistence().await.is_err());
    assert!(owner.edit_draft("", "New".into()).await.is_err());
    assert!(
        owner
            .submit("action".into(), "Write it".into(), 10)
            .await
            .is_err()
    );
    assert!(owner.settled().await.is_err());
    owner.cancel_retained();
    assert!(host.durable().messages.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn unknown_publication_reconciles_exact_running_checkpoint_before_terminal_mutation() {
    let host = Fixture::new();
    host.fail_at("result", true);
    host.lose_readback.store(true, Ordering::SeqCst);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    let failed = owner.settled().await.unwrap();
    assert_eq!(failed.phase, Phase::PersistenceFailed);
    assert!(host.durable().revision > failed.record.revision);
    let saved = owner.retry_persistence().await.unwrap();
    assert_eq!(saved.record.runtime.unwrap().runs[0].state, "interrupted");
    assert_eq!(saved.record.messages[2]["details"]["saved"], true);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn concurrent_completion_waiters_all_observe_terminal_state() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    let barrier = Arc::new(tokio::sync::Barrier::new(9));
    let mut waiters = Vec::new();
    for _ in 0..8 {
        let owner = owner.clone();
        let barrier = barrier.clone();
        waiters.push(tokio::spawn(async move {
            barrier.wait().await;
            owner.settled().await.unwrap()
        }));
    }
    barrier.wait().await;
    host.gate.add_permits(20);
    for waiter in waiters {
        assert_eq!(waiter.await.unwrap().phase, Phase::Idle);
    }
    let run = host.durable().runtime.unwrap().runs.remove(0);
    assert_eq!(run.started_at, 10);
    assert_eq!(run.ended_at, Some(20));
}

#[tokio::test]
async fn completed_native_text_and_tool_history_can_continue_without_losing_messages() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("first".into(), "Write it".into(), 10)
        .await
        .unwrap();
    owner.settled().await.unwrap();
    host.turns.lock().unwrap().push_back(turn(false));
    let reopened = Owner::open(host.clone()).await.unwrap();
    reopened
        .submit("second".into(), "Explain it".into(), 30)
        .await
        .unwrap();
    reopened.settled().await.unwrap();
    let durable = host.durable();
    assert_eq!(durable.messages.as_array().unwrap().len(), 6);
    assert_eq!(durable.messages[2]["toolCallId"], "call-1");
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn consecutive_uncertain_publications_preserve_the_same_append_identity() {
    let host = Fixture::new();
    host.fail_at("input", true);
    let owner = Owner::open(host.clone()).await.unwrap();
    assert!(
        owner
            .submit("action".into(), "Write it".into(), 10)
            .await
            .is_err()
    );
    host.fail_at("input", true);
    host.lose_readback.store(true, Ordering::SeqCst);
    assert!(owner.retry_persistence().await.is_err());
    let published = host.durable();
    assert_eq!(published.revision, 1);
    let recovered = owner.retry_persistence().await.unwrap();
    assert!(recovered.record.revision > published.revision);
    assert_eq!(
        recovered.record.runtime.unwrap().runs[0].state,
        "interrupted"
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn stop_during_input_admission_cancels_the_new_token_before_any_effect() {
    let host = Fixture::new();
    host.input_save_gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    let submitting = owner.clone();
    let submission = tokio::spawn(async move {
        submitting
            .submit("action".into(), "Write it".into(), 10)
            .await
    });
    host.input_save_entered.notified().await;
    owner.cancel_retained();
    host.input_save_gate.add_permits(1);
    submission.await.unwrap().unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Interrupted);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn live_tool_context_preserves_empty_content_boundaries_errors_and_structure() {
    for content in [
        vec![],
        vec![
            json!({"type":"text","text":"First"}),
            json!({"type":"text","text":"Second"}),
        ],
    ] {
        for is_error in [false, true] {
            let host = Fixture::new();
            *host.tool_output.lock().unwrap() = Some(ToolResult {
                content: content.clone(),
                details: json!({}),
                is_error,
                structured_content: Some(json!({"value":[1,true]})),
            });
            let owner = Owner::open(host.clone()).await.unwrap();
            owner
                .submit("action".into(), "Write it".into(), 10)
                .await
                .unwrap();
            assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
            let retained = host.durable();
            assert_eq!(retained.messages[2]["content"], json!(content));
            assert_eq!(
                retained.messages[2]["structuredContent"],
                json!({"value":[1,true]})
            );
            let inputs = host.model_inputs.lock().unwrap();
            let live = inputs[1]
                .iter()
                .find(|m| m["role"] == "toolResult")
                .unwrap();
            assert_eq!(live, &retained.messages[2]);
            assert_eq!(live["isError"], is_error);
        }
    }
}

#[tokio::test]
async fn image_tool_output_is_retained_and_sent_without_fabricated_text() {
    let host = Fixture::new();
    *host.tool_output.lock().unwrap() = Some(ToolResult {
        content: vec![json!({"type":"image","data":"iVBORw0KGgo=","mimeType":"image/png"})],
        details: json!({"saved":true}),
        structured_content: None,
        is_error: false,
    });
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    let finished = owner.settled().await.unwrap();
    assert_eq!(finished.phase, Phase::Idle);
    assert_eq!(finished.record.messages[2]["content"][0]["type"], "image");
    let inputs = host.model_inputs.lock().unwrap();
    let result = inputs[1]
        .iter()
        .find(|message| message["role"] == "toolResult")
        .unwrap();
    assert_eq!(
        result["content"],
        json!([{"type":"image","data":"iVBORw0KGgo=","mimeType":"image/png"}])
    );
    assert_eq!(host.models.load(Ordering::SeqCst), 2);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn dropping_submission_acknowledgement_does_not_drop_accepted_work() {
    let host = Fixture::new();
    host.input_save_gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    let mut submission = Box::pin(owner.submit("action".into(), "Write it".into(), 10));
    std::future::poll_fn(|context| {
        assert!(submission.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    host.input_save_entered.notified().await;
    drop(submission);
    host.input_save_gate.add_permits(1);
    tokio::time::timeout(std::time::Duration::from_secs(5), host.finished.notified())
        .await
        .expect("accepted work must finish without its caller");
    let settled = owner.settled().await.unwrap();
    assert_eq!(settled.phase, Phase::Idle);
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    assert_eq!(host.models.load(Ordering::SeqCst), 2);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    assert_eq!(host.durable().runtime.unwrap().runs.len(), 1);
}

#[tokio::test]
async fn stop_while_submission_waits_for_mutation_lock_prevents_dispatch() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let state = owner.state.lock().await;
    let mut submission = Box::pin(owner.submit("action".into(), "Write it".into(), 10));
    std::future::poll_fn(|context| {
        assert!(submission.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    owner.cancel_retained();
    drop(state);
    submission.await.unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Interrupted);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn panic_retrying_an_older_checkpoint_preserves_later_observed_results() {
    let host = Fixture::new();
    host.tool_gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    host.tool_entered.notified().await;
    host.fail_at("other", false);
    assert!(failing_title_checkpoint(&owner).await.is_err());
    owner.settled().await.unwrap();
    *host.panic_at.lock().unwrap() = Some("other");
    assert!(owner.retry_persistence().await.is_err());
    let failed = owner.snapshot().await.unwrap();
    assert_eq!(failed.record.messages[2]["details"]["saved"], true);
    let saved = owner.retry_persistence().await.unwrap();
    assert_eq!(saved.record.messages[2]["details"]["saved"], true);
    assert_eq!(saved.record.draft, "Next");
    assert_eq!(host.durable().messages[2]["details"]["saved"], true);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
    assert_eq!(host.models.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn queued_admission_remains_active_after_its_observer_detaches() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let gate = owner.actions.lock().await;
    let mut submission = Box::pin(owner.submit("action".into(), "Write it".into(), 10));
    std::future::poll_fn(|context| {
        assert!(submission.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    assert!(owner.snapshot().await.unwrap().task_active);
    drop(submission);
    let mut settlement = Box::pin(owner.settled());
    std::future::poll_fn(|context| {
        assert!(settlement.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    drop(gate);
    let finished = settlement.await.unwrap();
    assert_eq!(finished.phase, Phase::Idle);
    assert!(!finished.task_active);
    assert_eq!(host.durable().runtime.unwrap().runs[0].state, "completed");
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn mutation_panic_does_not_release_a_still_draining_effect() {
    let host = Fixture::new();
    host.tool_gate.forget_permits(20);
    host.cleanup_gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    host.tool_entered.notified().await;
    *host.panic_at.lock().unwrap() = Some("other");
    assert!(failing_title_checkpoint(&owner).await.is_err());
    host.draining.notified().await;
    assert!(owner.snapshot().await.unwrap().task_active);
    assert!(owner.retry_persistence().await.is_err());
    host.cleanup_gate.add_permits(1);
    let failed = owner.settled().await.unwrap();
    assert_eq!(failed.phase, Phase::PersistenceFailed);
    assert_eq!(failed.record.messages[2]["details"]["saved"], true);
    let saved = owner.retry_persistence().await.unwrap();
    assert_eq!(saved.record.draft, "Next");
    assert_eq!(saved.record.messages[2]["details"]["saved"], true);
    assert_eq!(host.effects.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn failed_workers_settle_and_retain_checkpoints_without_replaying_effects() {
    for point in ["input", "model", "tool", "result", "final"] {
        let host = Fixture::new();
        *host.panic_at.lock().unwrap() = Some(point);
        let owner = Owner::open(host.clone()).await.unwrap();
        let submitted = owner.submit("action".into(), "Write it".into(), 10).await;
        if point == "input" {
            assert!(submitted.is_err());
        } else {
            submitted.unwrap();
        }
        let failed = tokio::time::timeout(std::time::Duration::from_secs(5), owner.settled())
            .await
            .expect("worker failure must release completion waiters")
            .unwrap();
        assert!(!failed.task_active);
        assert_eq!(failed.phase, Phase::PersistenceFailed, "{point}");
        assert_eq!(failed.error.as_deref(), Some("native.ai.request.failed"));
        assert!(
            owner
                .submit("other".into(), "Next".into(), 30)
                .await
                .is_err()
        );
        let models = host.models.load(Ordering::SeqCst);
        let effects = host.effects.load(Ordering::SeqCst);
        let saved = owner.retry_persistence().await.unwrap();
        assert_ne!(saved.phase, Phase::PersistenceFailed);
        assert_eq!(host.models.load(Ordering::SeqCst), models);
        assert_eq!(host.effects.load(Ordering::SeqCst), effects);
        assert_ne!(host.durable().runtime.unwrap().runs[0].state, "running");
        if matches!(point, "result" | "final") {
            assert_eq!(saved.record.messages[2]["details"]["saved"], true);
        }
    }
}

#[tokio::test]
async fn dispatched_tools_use_the_definition_captured_for_the_model_request() {
    let host = Fixture::new();
    host.gate.forget_permits(20);
    let owner = Owner::open(host.clone()).await.unwrap();
    let captured = host.definitions();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    host.entered.notified().await;
    host.definitions.lock().unwrap()[0].description = "Changed tool".into();
    host.gate.add_permits(20);
    owner.settled().await.unwrap();
    assert_eq!(host.model_definitions.lock().unwrap()[0], captured);
    assert_eq!(*host.dispatched_definitions.lock().unwrap(), captured);
    let events = host.durable().runtime.unwrap().events;
    let intent = events
        .iter()
        .find(|event| event.kind == "tool_intent")
        .unwrap();
    assert_eq!(intent.data["definition"]["description"], "Write a fixture");
}

#[tokio::test]
async fn maximum_length_action_identity_does_not_make_generated_events_invalid() {
    let host = Fixture::new();
    let owner = Owner::open(host.clone()).await.unwrap();
    let action = "x".repeat(256);
    owner
        .submit(action.clone(), "Write it".into(), 10)
        .await
        .unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Idle);
    let runtime = host.durable().runtime.unwrap();
    assert_eq!(runtime.runs[0].id, action);
    runtime.validate(4).unwrap();
}

#[tokio::test]
async fn ambiguous_tool_definitions_are_rejected_before_model_dispatch() {
    let host = Fixture::new();
    let definition = host.definitions()[0].clone();
    host.definitions.lock().unwrap().push(definition);
    let owner = Owner::open(host.clone()).await.unwrap();
    owner
        .submit("action".into(), "Write it".into(), 10)
        .await
        .unwrap();
    assert_eq!(owner.settled().await.unwrap().phase, Phase::Interrupted);
    assert_eq!(host.models.load(Ordering::SeqCst), 0);
    assert_eq!(host.effects.load(Ordering::SeqCst), 0);
}
