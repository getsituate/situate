use serde::Deserialize;
use serde_json::{Value, json};
use situate_agent::{Progress, ProgressSink, ToolOutcome, ToolRequest, ToolResult};
use situate_core::plugins::action_store::{Record as ActionRecord, Status as ActionStatus, Store};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_executor_platform::{
    DocumentKind, Executor, ExecutorEvent, ExecutorHandle, OpenRequest,
};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

const UNAVAILABLE: &str = "native.plugins.unavailable";
const CANCELLED: &str = "native.plugins.hostCancelled";
const INVALID: &str = "native.plugins.checkInvalid";
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct Context {
    pub app: tauri::AppHandle,
    pub window: String,
    pub scope: String,
    pub authorization: crate::workspaces::AuthorizationSession,
}

#[derive(Default)]
pub struct Executors {
    workspaces: Mutex<HashMap<String, Arc<Workspace>>>,
    gates: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    closing: Mutex<HashSet<String>>,
    dispatched: Mutex<HashSet<(String, String, String)>>,
    unavailable: Mutex<HashMap<String, HashMap<String, Unavailable>>>,
}
#[derive(Clone)]
struct Unavailable {
    fingerprint: String,
    metadata: Value,
    required: HashSet<String>,
}
struct ManualLedger {
    store: Arc<Store>,
    record: ActionRecord,
    staged: Option<ActionRecord>,
    error: Option<String>,
}
struct Workspace {
    context: Context,
    platform: Mutex<Option<Arc<ExecutorHandle>>>,
    generations: Mutex<HashMap<u64, Arc<Generation>>>,
    closed: AtomicBool,
    stopped: AtomicBool,
    closing: AtomicBool,
}
struct Generation {
    id: u64,
    plugin_id: String,
    revision: Option<String>,
    incarnation: String,
    source: Value,
    revisions: crate::plugin_actions::Revisions,
    incarnations: crate::plugin_actions::Incarnations,
    test_id: Option<String>,
    ready: Mutex<Option<Result<Definitions, String>>>,
    load_sent: AtomicBool,
    changed: Notify,
    revoked: AtomicBool,
    terminated: AtomicBool,
    invocations: Mutex<HashMap<String, Arc<Invocation>>>,
}
#[derive(Clone, Default, Deserialize)]
struct Definitions {
    tools: Vec<Value>,
    exports: Vec<String>,
}
struct Invocation {
    id: String,
    run_id: String,
    cancel: CancellationToken,
    progress: Option<ProgressSink>,
    operation_gate: tokio::sync::Mutex<()>,
    ledger: tokio::sync::Mutex<Option<ManualLedger>>,
    action: Mutex<Option<crate::plugin_actions::ActionLease>>,
    images: Mutex<Vec<Value>>,
    state: Mutex<InvocationState>,
    changed: Notify,
}
struct PendingDispatch(Arc<Invocation>);
impl PendingDispatch {
    fn begin(invocation: Arc<Invocation>) -> Result<Self, String> {
        lock(&invocation.state)?.pending += 1;
        Ok(Self(invocation))
    }
}
impl Drop for PendingDispatch {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.pending -= 1;
        }
        self.0.changed.notify_waiters();
    }
}

#[derive(Default)]
struct InvocationState {
    terminal: Option<Terminal>,
    requests: HashSet<String>,
    pending: usize,
    observations: Vec<Value>,
}
impl InvocationState {
    fn admit(&mut self, request_id: &str, cancelled: bool) -> Result<(), String> {
        if self.terminal.is_some()
            || cancelled
            || self.requests.len() >= 128
            || !self.requests.insert(request_id.into())
        {
            return Err(INVALID.into());
        }
        self.pending += 1;
        Ok(())
    }
    fn disconnect(&mut self) {
        if self.terminal.is_none() || self.pending > 0 {
            match self.terminal.take() {
                Some(Terminal::Result(value)) => self
                    .observations
                    .push(json!({"operation":"toolResult","observedResult":value})),
                Some(Terminal::Error(error)) => self
                    .observations
                    .push(json!({"operation":"toolResult","observedError":error})),
                _ => {}
            }
            self.terminal = Some(Terminal::Disconnected);
        }
    }
    fn host_error_prevents_result(&self, test_id: Option<&str>) -> bool {
        test_id.is_none()
            && self
                .observations
                .iter()
                .any(|receipt| !receipt["error"].is_null())
    }
    fn complete(&mut self, terminal: Terminal) -> Result<(), String> {
        if self.terminal.is_some() {
            return Err(INVALID.into());
        }
        self.terminal = Some(terminal);
        Ok(())
    }
}
#[derive(Clone)]
enum Terminal {
    Result(Value),
    Error(String),
    Disconnected,
}
struct CapturedSource {
    source: Value,
    revision: Option<String>,
    incarnation: String,
    revisions: crate::plugin_actions::Revisions,
    incarnations: crate::plugin_actions::Incarnations,
}
struct InvocationRequest<'a> {
    run_id: &'a str,
    kind: &'a str,
    name: &'a str,
    args: Value,
    script: Option<&'a str>,
}
type ManualInvocationOwners = (Arc<Workspace>, Arc<Generation>, Arc<Invocation>);

#[derive(Clone)]
struct CapturedPlugin {
    workspace: Arc<Workspace>,
    generation: Arc<Generation>,
    definitions: Definitions,
}
#[derive(Clone, Default)]
pub struct CapturedTools {
    plugins: Vec<CapturedPlugin>,
    skills: Vec<Value>,
    unavailable: Vec<Value>,
}

impl Context {
    fn validate(&self) -> Result<(), String> {
        crate::workspaces::with_retained_session(
            &self.app,
            &self.window,
            &self.authorization,
            |_| Ok(()),
        )
    }
}

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    mutex.lock().map_err(|_| UNAVAILABLE.into())
}
fn next_generation() -> Result<u64, String> {
    NEXT_GENERATION
        .try_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1))
        .map_err(|_| UNAVAILABLE.into())
}
fn tool_prefix(plugin: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(plugin.as_bytes());
    let encoded: String = hash[..8].iter().map(|byte| format!("{byte:02x}")).collect();
    format!("plugin_{encoded}_")
}
impl Generation {
    fn register(&self, invocation: Arc<Invocation>) -> Result<bool, String> {
        let mut invocations = lock(&self.invocations)?;
        if self.revoked.load(Ordering::Acquire) {
            return Ok(false);
        }
        invocations.insert(invocation.id.clone(), invocation);
        Ok(true)
    }
    fn revoke(&self) -> bool {
        let first = !self.revoked.swap(true, Ordering::AcqRel);
        let _ = self.fail_initialization(&json!(UNAVAILABLE));
        self.changed.notify_waiters();
        if let Ok(invocations) = self.invocations.lock() {
            for invocation in invocations.values() {
                invocation.cancel.cancel();
                if let Ok(mut state) = invocation.state.lock() {
                    state.disconnect();
                }
                invocation.changed.notify_waiters();
            }
        }
        first
    }
    fn fail_initialization(&self, error: &Value) -> Result<(), String> {
        let mut ready = lock(&self.ready)?;
        if ready.is_none() {
            *ready = Some(Err(if self.test_id.is_some() {
                check_error(error)
            } else {
                worker_error(error)
            }));
        }
        Ok(())
    }
    fn snapshot(&self, definitions: &Definitions) -> Value {
        json!({"pluginId":self.plugin_id,"revision":self.revision,"incarnation":self.incarnation,"generation":self.id,"source":self.source,"tools":self.descriptors(definitions),"exports":definitions.exports})
    }
    fn descriptors(&self, definitions: &Definitions) -> Vec<Value> {
        definitions.tools.iter().map(|tool| json!({
            "name":format!("{}{}",tool_prefix(&self.plugin_id),tool["name"].as_str().unwrap_or_default()),
            "description":tool["description"],"parameters":tool["parameters"],
            "pluginId":self.plugin_id,"pluginName":self.source["manifest"]["name"],
            "revision":self.revision,"incarnation":self.incarnation,"generation":self.id
        })).collect()
    }
}

impl Workspace {
    async fn open(context: Context) -> Result<Arc<Self>, String> {
        context.validate()?;
        let workspace = Arc::new(Self {
            context: context.clone(),
            platform: Mutex::new(None),
            generations: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            closing: AtomicBool::new(false),
        });
        let weak = Arc::downgrade(&workspace);
        let callback = Arc::new(move |event| {
            if let Some(workspace) = weak.upgrade() {
                match event {
                    ExecutorEvent::Message { payload, .. } => {
                        let workspace = workspace.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = workspace.message(payload).await;
                        });
                    }
                    ExecutorEvent::Lost { .. } => {
                        workspace.lose();
                    }
                    ExecutorEvent::Stopped { .. } => {
                        workspace.stopped();
                    }
                }
            }
        });
        let platform = Executor::new(context.app.clone());
        let handle = platform
            .open(
                OpenRequest {
                    workspace_generation: uuid::Uuid::new_v4().to_string(),
                    supervisor_source: supervisor_source(&context.app)?,
                    document_kind: DocumentKind::Supervisor,
                },
                callback,
            )
            .await?;
        *lock(&workspace.platform)? = Some(Arc::new(handle));
        Ok(workspace)
    }
    async fn send(&self, message: Value) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err(UNAVAILABLE.into());
        }
        let handle = lock(&self.platform)?.clone().ok_or(UNAVAILABLE)?;
        handle.send(message).await
    }
    fn lose(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(generations) = self.generations.lock() {
            for generation in generations.values() {
                self.revoke(generation);
                generation.changed.notify_waiters();
            }
        }
    }
    fn prune_generations(&self) {
        if let Ok(mut generations) = self.generations.lock() {
            generations.retain(|_, generation| {
                !generation.revoked.load(Ordering::Acquire)
                    || !generation.terminated.load(Ordering::Acquire)
                    || generation
                        .invocations
                        .lock()
                        .map_or(true, |invocations| !invocations.is_empty())
            });
        }
    }
    fn stopped(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Ok(generations) = self.generations.lock() {
            for generation in generations.values() {
                generation.terminated.store(true, Ordering::Release);
                generation.changed.notify_waiters();
            }
        }
    }
    fn revoke(&self, generation: &Generation) {
        if !generation.revoke() {
            return;
        }
        if let Ok(platform) = self.platform.lock()
            && let Some(handle) = platform.clone()
        {
            let id = generation.id;
            tauri::async_runtime::spawn(async move {
                let _ = handle
                    .send(json!({"type":"terminate","generation":id}))
                    .await;
            });
        }
    }
    async fn load(
        self: &Arc<Self>,
        captured: CapturedSource,
        test_id: Option<String>,
        cancel: &CancellationToken,
    ) -> Result<CapturedPlugin, String> {
        let CapturedSource {
            source,
            revision,
            incarnation,
            revisions,
            incarnations,
        } = captured;
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let plugin_id = source["manifest"]["id"].as_str().ok_or(INVALID)?.to_owned();
        let generation = {
            let executors = self.context.app.state::<Executors>();
            let closing = lock(&executors.closing)?;
            if closing.contains(&self.context.scope) {
                return Err(UNAVAILABLE.into());
            }
            let mut generations = lock(&self.generations)?;
            if let Some(existing) = generations.values().find(|g| {
                g.plugin_id == plugin_id
                    && g.revision == revision
                    && g.incarnation == incarnation
                    && g.revisions == revisions
                    && g.incarnations == incarnations
                    && g.source == source
                    && g.test_id == test_id
                    && !g.revoked.load(Ordering::Acquire)
            }) {
                existing.clone()
            } else {
                let generation = Arc::new(Generation {
                    id: next_generation()?,
                    plugin_id,
                    revision,
                    incarnation,
                    source,
                    revisions,
                    incarnations,
                    test_id,
                    ready: Mutex::new(None),
                    load_sent: AtomicBool::new(false),
                    changed: Notify::new(),
                    revoked: AtomicBool::new(false),
                    terminated: AtomicBool::new(false),
                    invocations: Mutex::new(HashMap::new()),
                });
                generations.insert(generation.id, generation.clone());
                generation
            }
        };
        if !generation.load_sent.swap(true, Ordering::AcqRel)
            && let Err(error)=self.send(json!({"type":"load","generation":generation.id,"pluginId":generation.plugin_id,"source":generation.source})).await {
                self.revoke(&generation);
                self.wait_stopped(&generation).await?;
                self.prune_generations();
                return Err(error);
            }
        loop {
            let changed = generation.changed.notified();
            let ready = lock(&generation.ready)?.clone();
            if let Some(ready) = ready {
                match ready {
                    Ok(definitions) => {
                        return Ok(CapturedPlugin {
                            workspace: self.clone(),
                            generation: generation.clone(),
                            definitions,
                        });
                    }
                    Err(error) => {
                        self.wait_stopped(&generation).await?;
                        self.prune_generations();
                        return Err(error);
                    }
                }
            }
            tokio::select! {
                _ = changed => {},
                _ = cancel.cancelled() => { {let mut ready=lock(&generation.ready)?;if ready.is_none(){*ready=Some(Err(CANCELLED.into()));}} self.revoke(&generation); self.wait_stopped(&generation).await?;self.prune_generations();return Err(CANCELLED.into()); },
                _ = tokio::time::sleep(Duration::from_secs(30)) => { self.revoke(&generation);self.wait_stopped(&generation).await?;self.prune_generations();return Err(UNAVAILABLE.into()); }
            }
        }
    }
    async fn message(self: Arc<Self>, message: Value) -> Result<(), String> {
        if message.to_string().len() > 2 * 1024 * 1024 {
            self.lose();
            return Err(INVALID.into());
        }
        let id = message["generation"].as_u64().ok_or(INVALID)?;
        let generation = lock(&self.generations)?
            .get(&id)
            .cloned()
            .ok_or(UNAVAILABLE)?;
        let kind = message["type"].as_str().ok_or(INVALID)?;
        if kind == "terminated" {
            if !generation.revoked.load(Ordering::Acquire)
                || generation.terminated.swap(true, Ordering::AcqRel)
            {
                return Err(INVALID.into());
            }
            generation.changed.notify_waiters();
            self.prune_generations();
            return Ok(());
        }
        if generation.revoked.load(Ordering::Acquire) {
            return Err(UNAVAILABLE.into());
        }
        if kind == "ready" {
            let definitions: Definitions =
                serde_json::from_value(message.clone()).map_err(|_| INVALID)?;
            if validate_definitions(&definitions).is_err() {
                self.revoke(&generation);
                return Err(INVALID.into());
            }
            let declared = generation.source["manifest"]["exports"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect::<HashSet<_>>();
            if definitions.exports.iter().cloned().collect::<HashSet<_>>() != declared {
                self.revoke(&generation);
                return Err(INVALID.into());
            }
            let mut ready = lock(&generation.ready)?;
            if ready.is_some() {
                return Err(INVALID.into());
            }
            *ready = Some(Ok(definitions));
            generation.changed.notify_waiters();
            return Ok(());
        }
        if kind == "error" && message["invocationId"].is_null() {
            generation.fail_initialization(&message["error"])?;
            self.revoke(&generation);
            return Ok(());
        }
        let invocation_id = message["invocationId"].as_str().ok_or(INVALID)?;
        let invocation = lock(&generation.invocations)?
            .get(invocation_id)
            .cloned()
            .ok_or(UNAVAILABLE)?;
        match kind {
            "result" | "error" => {
                let mut state = lock(&invocation.state)?;
                state.complete(if kind == "result" {
                    Terminal::Result(message["result"].clone())
                } else {
                    Terminal::Error(if generation.test_id.is_some() {
                        check_error(&message["error"])
                    } else {
                        worker_error(&message["error"])
                    })
                })?;
                invocation.changed.notify_waiters();
            }
            "host" => {
                let request_id = message["requestId"].as_str().ok_or(INVALID)?.to_owned();
                crate::plugin_host::identifier(&request_id)?;
                {
                    let mut state = lock(&invocation.state)?;
                    state.admit(&request_id, invocation.cancel.is_cancelled())?;
                }
                let workspace = self.clone();
                tauri::async_runtime::spawn(async move {
                    let request = message["request"].clone();
                    let _operation_gate = invocation.operation_gate.lock().await;
                    use futures_util::FutureExt;
                    let mut outcome = std::panic::AssertUnwindSafe(workspace.host_request(
                        &generation,
                        &invocation,
                        request.clone(),
                    ))
                    .catch_unwind()
                    .await
                    .unwrap_or_else(|_| {
                        workspace.revoke(&generation);
                        Err(UNAVAILABLE.into())
                    });
                    let receipt = ledger_receipt(&request, &outcome);
                    let native_request = uuid::Uuid::new_v4().to_string();
                    if let Err(error) = save_manual(&invocation, move |record| {
                        record.observe(&native_request, receipt)
                    })
                    .await
                    {
                        workspace.revoke(&generation);
                        outcome = Err(error);
                    }
                    if let Ok(mut state) = invocation.state.lock() {
                        state
                            .observations
                            .push(observation(&request_id, &request, &outcome));
                        state.pending -= 1;
                    }
                    invocation.changed.notify_waiters();
                    let _ = workspace.send(match outcome {
                        Ok(result) => json!({"type":"hostReply","generation":generation.id,"invocationId":invocation.id,"requestId":request_id,"result":result}),
                        Err(error) => json!({"type":"hostReply","generation":generation.id,"invocationId":invocation.id,"requestId":request_id,"error":error}),
                    }).await;
                });
            }
            "progress" => {
                if lock(&invocation.state)?.terminal.is_some() {
                    return Err(INVALID.into());
                }
                if let Some(progress) = &invocation.progress {
                    progress
                        .send(Progress::PartialMessage(message["value"].clone()))
                        .await?;
                }
            }
            _ => return Err(INVALID.into()),
        }
        Ok(())
    }
    async fn host_request(
        self: &Arc<Self>,
        generation: &Arc<Generation>,
        invocation: &Arc<Invocation>,
        request: Value,
    ) -> Result<Value, String> {
        if generation.revoked.load(Ordering::Acquire) || invocation.cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        self.context.validate()?;
        let operation = request["operation"].as_str().ok_or(INVALID)?;
        if operation == "dependenciesInvoke" {
            let target = request["pluginId"].as_str().ok_or(INVALID)?;
            if !generation.source["manifest"]["dependencies"]
                .as_array()
                .is_some_and(|deps| deps.iter().any(|dep| dep.as_str() == Some(target)))
            {
                return Err(INVALID.into());
            }
            let target_generation = lock(&self.generations)?
                .values()
                .find(|g| {
                    g.plugin_id == target
                        && g.test_id == generation.test_id
                        && (generation.test_id.is_some()
                            || (generation.revisions.get(target) == Some(&g.revision)
                                && generation.incarnations.get(target) == Some(&g.incarnation)))
                        && !g.revoked.load(Ordering::Acquire)
                })
                .cloned()
                .ok_or(UNAVAILABLE)?;
            let definitions = lock(&target_generation.ready)?
                .clone()
                .ok_or(UNAVAILABLE)??;
            let export = request["exportName"].as_str().ok_or(INVALID)?;
            if !definitions.exports.iter().any(|name| name == export) {
                return Err(INVALID.into());
            }
            let plugin = CapturedPlugin {
                workspace: self.clone(),
                generation: target_generation,
                definitions,
            };
            return Box::pin(plugin.execute(
                InvocationRequest {
                    run_id: &invocation.run_id,
                    kind: "export",
                    name: export,
                    args: request["args"].clone(),
                    script: None,
                },
                invocation.progress.clone(),
                invocation.cancel.child_token(),
            ))
            .await
            .map_err(|_| UNAVAILABLE.into());
        }
        if operation.starts_with("preview") {
            return preview_request(self, generation, invocation, request).await;
        }
        let parsed: crate::plugin_host::Request =
            serde_json::from_value(request.clone()).map_err(|_| INVALID)?;
        if generation.revoked.load(Ordering::Acquire) || invocation.cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let host = crate::plugin_host::open_native(
            &self.context,
            generation.plugin_id.clone(),
            generation.test_id.clone(),
            Some(generation.revisions.clone()),
            Some(generation.incarnations.clone()),
        )
        .await?;
        let result = crate::plugin_host::request_native(
            self.context.app.clone(),
            &self.context.window,
            &host,
            uuid::Uuid::new_v4().to_string(),
            parsed,
            invocation.cancel.clone(),
        )
        .await;
        let _ = crate::plugin_host::close_native(&self.context.app, &self.context.window, &host);
        result
    }
    async fn wait_stopped(&self, generation: &Generation) -> Result<(), String> {
        let stopped = async {
            loop {
                let changed = generation.changed.notified();
                if generation.terminated.load(Ordering::Acquire) {
                    return;
                }
                changed.await;
            }
        };
        if tokio::time::timeout(Duration::from_secs(2), stopped)
            .await
            .is_err()
        {
            let handle = lock(&self.platform)?.clone().ok_or(UNAVAILABLE)?;
            handle.close().await?;
            self.lose();
        }
        Ok(())
    }
}

fn worker_error(value: &Value) -> String {
    let Some(key) = value.as_str().filter(|key| key.len() <= 128) else {
        return UNAVAILABLE.into();
    };
    if matches!(
        key,
        "plugins.checkSyntaxError"
            | "plugins.checkFailed"
            | "plugins.checkAssertionFailed"
            | "plugins.checkAssertionsRequired"
            | "plugins.checkTypeError"
            | "plugins.checkReferenceError"
            | "plugins.invalidContributions"
            | "plugins.moduleImportInvalid"
            | "plugins.moduleImportUnsupported"
            | "plugins.moduleCycle"
            | "plugins.moduleNotFound"
            | "plugins.previewUnavailable"
            | "plugins.previewViewNotFound"
            | "plugins.previewInvalidArguments"
            | "plugins.previewElementNotFound"
            | "plugins.executionCancelled"
    ) || (key.starts_with("native.")
        && situate_core::messages::text(situate_core::localization::Language::En, key)
            != situate_core::messages::text(
                situate_core::localization::Language::En,
                "native.unavailable",
            ))
    {
        key.into()
    } else {
        UNAVAILABLE.into()
    }
}
fn check_error(value: &Value) -> String {
    let code = worker_error(value);
    if code == UNAVAILABLE && value.as_str() != Some(UNAVAILABLE) {
        "plugins.checkFailed".into()
    } else {
        code
    }
}

fn fingerprint(value: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(value)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn persistence_error(error: String) -> String {
    if error == "native.plugins.actionOutcomeUnknown" {
        "native.plugins.stateOutcomeUnknown".into()
    } else {
        "native.plugins.stateSaveFailed".into()
    }
}
async fn persist_manual_intent(
    invocation: Arc<Invocation>,
    store: Arc<Store>,
    create: impl FnOnce() -> Result<ActionRecord, String> + Send + 'static,
) -> Result<(), String> {
    let pending = PendingDispatch::begin(invocation.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        // The writer retains admission even if its awaiting future is dropped.
        let _pending = pending;
        let record = create()?;
        *invocation.ledger.blocking_lock() = Some(ManualLedger {
            store,
            record,
            staged: None,
            error: None,
        });
        Ok(())
    })
    .await
    .map_err(|_| "native.plugins.stateSaveFailed")?
}

async fn begin_manual(
    context: &Context,
    generation: &Generation,
    invocation: &Arc<Invocation>,
    name: &str,
) -> Result<(), String> {
    let root = context
        .app
        .path()
        .app_local_data_dir()
        .map_err(|_| UNAVAILABLE)?;
    let store = Arc::new(Store::new(root.join("plugin-actions")));
    let writer = store.clone();
    let id = invocation.id.clone();
    let scope = fingerprint(format!("{}\0{}", context.scope, context.window).as_bytes());
    let plugin = generation.plugin_id.clone();
    let generation = generation.id;
    let name = name.to_owned();
    persist_manual_intent(invocation.clone(), store, move || {
        std::fs::create_dir_all(root).map_err(|_| "native.plugins.stateSaveFailed".to_owned())?;
        writer
            .create(&id, &scope, &plugin, generation, &name)
            .map_err(persistence_error)
    })
    .await
}
async fn save_manual(
    invocation: &Invocation,
    change: impl FnOnce(&ActionRecord) -> Result<ActionRecord, String> + Send,
) -> Result<(), String> {
    let mut ledger = invocation.ledger.lock().await;
    save_manual_locked(&mut ledger, change).await
}
async fn save_manual_locked(
    ledger: &mut Option<ManualLedger>,
    change: impl FnOnce(&ActionRecord) -> Result<ActionRecord, String> + Send,
) -> Result<(), String> {
    let Some(ledger) = ledger.as_mut() else {
        return Ok(());
    };
    if ledger.staged.is_some() {
        return Err(ledger
            .error
            .clone()
            .unwrap_or_else(|| "native.plugins.stateSaveFailed".into()));
    }
    let next = change(&ledger.record).map_err(persistence_error)?;
    ledger.staged = Some(next);
    persist_manual_staged(ledger).await
}
async fn persist_manual_staged(ledger: &mut ManualLedger) -> Result<(), String> {
    let Some(next) = ledger.staged.clone() else {
        return Ok(());
    };
    let store = ledger.store.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || store.save(&next))
        .await
        .map_err(|_| "native.plugins.actionSaveFailed".to_owned())
        .and_then(|result| result)
        .map_err(persistence_error);
    match saved {
        Ok(()) => {
            ledger.record = ledger.staged.take().ok_or(INVALID)?;
            ledger.error = None;
            Ok(())
        }
        Err(error) => {
            ledger.error = Some(error.clone());
            Err(error)
        }
    }
}
async fn finalize_manual(invocation: &Invocation) -> Result<(), String> {
    // Execute, Stop, and workspace abort can finalize the same invocation concurrently.
    let mut ledger = invocation.ledger.lock().await;
    if ledger
        .as_ref()
        .is_none_or(|ledger| ledger.record.status().is_terminal() && ledger.staged.is_none())
    {
        return Ok(());
    }
    let (status, uncertain) = {
        let state = lock(&invocation.state)?;
        let status = match state.terminal.as_ref().ok_or(INVALID)? {
            Terminal::Result(value)
                if value["isError"] != true
                    && state.observations.iter().all(|r| r["error"].is_null()) =>
            {
                ActionStatus::Completed
            }
            Terminal::Disconnected => ActionStatus::Disconnected,
            _ => ActionStatus::Failed,
        };
        (
            status,
            matches!(state.terminal, Some(Terminal::Disconnected))
                || state
                    .observations
                    .iter()
                    .any(|receipt| receipt["uncertain"] == true),
        )
    };
    save_manual_locked(&mut ledger, move |record| {
        record.terminal(
            if uncertain && status == ActionStatus::Completed {
                ActionStatus::Failed
            } else {
                status
            },
            uncertain,
        )
    })
    .await
}
fn ledger_receipt(request: &Value, outcome: &Result<Value, String>) -> Value {
    let mut receipt =
        json!({"success":outcome.is_ok(),"uncertain":outcome.is_err() && effectful(request)});
    match outcome {
        Ok(value) => {
            if let Some(value) = value.get("revision").filter(|v| v.is_string()) {
                receipt["revision"] = value.clone();
            }
            if let Some(value) = value.get("status").filter(|v| v.is_u64()) {
                receipt["statusCode"] = value.clone();
            }
            if let Some(value) = value
                .pointer("/commandResult/Ok/exitCode")
                .filter(|v| v.is_i64())
            {
                receipt["exitCode"] = value.clone();
            }
        }
        Err(error) => {
            receipt["code"] = json!(if error.starts_with("native.")
                && error.len() <= 128
                && error
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
            {
                error.as_str()
            } else {
                UNAVAILABLE
            });
        }
    }
    receipt
}
fn observation(request_id: &str, request: &Value, outcome: &Result<Value, String>) -> Value {
    let observed = outcome.as_ref().ok().map(|value| {
        let mut summary = json!({"completed":true});
        for field in [
            "status",
            "revision",
            "isError",
            "commandResult",
            "beforeHistoryRevision",
            "afterHistoryRevision",
            "reconciliationError",
            "attribution",
        ] {
            if let Some(value) = value.get(field) {
                summary[field] = value.clone();
            }
        }
        if let Some(result) = summary
            .get_mut("commandResult")
            .and_then(|v| v.get_mut("Ok"))
            && let Some(map) = result.as_object_mut()
        {
            map.remove("stdout");
            map.remove("stderr");
        }
        summary
    });
    json!({"requestId":request_id,"operation":request["operation"],"result":observed,"error":outcome.as_ref().err(),"uncertain":outcome.is_err() && effectful(request)})
}

fn effectful(request: &Value) -> bool {
    !matches!(
        request["operation"].as_str(),
        Some(
            "read"
                | "filesList"
                | "filesSearch"
                | "filesReadMany"
                | "credentialGet"
                | "processCapability"
        )
    )
}
fn validate_definitions(definitions: &Definitions) -> Result<(), String> {
    let mut names = HashSet::new();
    if definitions.tools.len() > 128 || definitions.exports.len() > 128 {
        return Err(INVALID.into());
    }
    for tool in &definitions.tools {
        let name = tool["name"].as_str().ok_or(INVALID)?;
        crate::plugin_host::identifier(name)?;
        if !names.insert(name)
            || tool["description"]
                .as_str()
                .is_none_or(|s| s.len() > 16_384)
            || !tool["parameters"].is_object()
            || tool["parameters"]["type"] != "object"
        {
            return Err(INVALID.into());
        }
    }
    names.clear();
    for name in &definitions.exports {
        if name.is_empty()
            || name.len() > 128
            || !name.bytes().enumerate().all(|(i, b)| {
                b.is_ascii_alphabetic() || matches!(b, b'_' | b'$') || (i > 0 && b.is_ascii_digit())
            })
        {
            return Err(INVALID.into());
        }
        if !names.insert(name) {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

impl CapturedPlugin {
    async fn execute(
        &self,
        request: InvocationRequest<'_>,
        progress: Option<ProgressSink>,
        cancel: CancellationToken,
    ) -> Result<Value, ToolOutcome> {
        let InvocationRequest {
            run_id,
            kind,
            name,
            args,
            script,
        } = request;
        let generation = &self.generation;
        if cancel.is_cancelled() {
            return Err(ToolOutcome::Failed(CANCELLED.into()));
        }
        if generation.revoked.load(Ordering::Acquire) {
            return Err(unavailable_before_dispatch());
        }
        self.workspace
            .context
            .validate()
            .map_err(ToolOutcome::Failed)?;
        if self.workspace.closing.load(Ordering::Acquire) {
            return Err(ToolOutcome::Failed(UNAVAILABLE.into()));
        }
        let invocation = Arc::new(Invocation {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: run_id.into(),
            cancel: cancel.child_token(),
            progress,
            operation_gate: tokio::sync::Mutex::new(()),
            ledger: tokio::sync::Mutex::new(None),
            action: Mutex::new(None),
            images: Mutex::new(Vec::new()),
            state: Mutex::new(InvocationState::default()),
            changed: Notify::new(),
        });
        let dispatch = PendingDispatch::begin(invocation.clone()).map_err(ToolOutcome::Failed)?;
        {
            let executors = self.workspace.context.app.state::<Executors>();
            let closing = lock(&executors.closing).map_err(ToolOutcome::Failed)?;
            if closing.contains(&self.workspace.context.scope) {
                return Err(ToolOutcome::Failed(UNAVAILABLE.into()));
            }
            if !generation
                .register(invocation.clone())
                .map_err(ToolOutcome::Failed)?
            {
                return Err(unavailable_before_dispatch());
            }
        }
        let action = if generation.test_id.is_none() {
            match crate::plugin_actions::begin_native(
                &self.workspace.context.app,
                &self.workspace.context.window,
                &self.workspace.context.scope,
                self.workspace.context.authorization.clone(),
                &generation.plugin_id,
                &generation.revisions,
                &generation.incarnations,
            ) {
                Ok(action) => Some(action),
                Err(error) => {
                    lock(&generation.invocations)
                        .map_err(ToolOutcome::Failed)?
                        .remove(&invocation.id);
                    return Err(ToolOutcome::Failed(error));
                }
            }
        } else {
            None
        };
        *lock(&invocation.action).map_err(ToolOutcome::Failed)? = action;
        if invocation.progress.is_none()
            && generation.test_id.is_none()
            && let Err(error) =
                begin_manual(&self.workspace.context, generation, &invocation, name).await
        {
            retire_invocation(&self.workspace, generation, &invocation)
                .await
                .map_err(ToolOutcome::Failed)?;
            return Err(ToolOutcome::Failed(error));
        }
        if self.workspace.send(json!({"type":"invoke","generation":generation.id,"invocationId":invocation.id,"kind":kind,"name":name,"args":args,"script":script})).await.is_err() { self.workspace.revoke(generation); }
        drop(dispatch);
        let result = loop {
            let changed = invocation.changed.notified();
            {
                let state = lock(&invocation.state).map_err(ToolOutcome::Failed)?;
                if state.pending == 0
                    && let Some(terminal) = &state.terminal
                {
                    break match terminal {
                        Terminal::Result(result) => {
                            if state.host_error_prevents_result(generation.test_id.as_deref()) {
                                Err(ToolOutcome::Completed(ToolResult::json(
                                    json!({"isError":true,"error":UNAVAILABLE,"observations":state.observations}),
                                )))
                            } else {
                                let mut result = result.clone();
                                let images = lock(&invocation.images)
                                    .map_err(ToolOutcome::Failed)?
                                    .clone();
                                if kind == "check" && result.is_object() {
                                    result["images"] = Value::Array(images);
                                    result["observations"] = json!(
                                        &state.observations
                                            [state.observations.len().saturating_sub(32)..]
                                    );
                                    result["observationsTruncated"] =
                                        json!(state.observations.len() > 32);
                                }
                                Ok(result)
                            }
                        }
                        Terminal::Error(error) => {
                            let mut result = ToolResult::json(
                                json!({"error":error,"observations":state.observations,"isError":true}),
                            );
                            result.is_error = true;
                            Err(ToolOutcome::Completed(result))
                        }
                        Terminal::Disconnected => {
                            Err(disconnected(generation.id, state.observations.clone()))
                        }
                    };
                }
            }
            tokio::select! {
                _ = changed => {},
                _ = cancel.cancelled(), if !generation.revoked.load(Ordering::Acquire) => { self.workspace.revoke(generation); }
            }
        };
        if generation.revoked.load(Ordering::Acquire) {
            self.workspace
                .wait_stopped(generation)
                .await
                .map_err(ToolOutcome::Failed)?;
        }
        finalize_manual(&invocation)
            .await
            .map_err(ToolOutcome::Failed)?;
        retire_invocation(&self.workspace, generation, &invocation)
            .await
            .map_err(ToolOutcome::Failed)?;
        result
    }
}
fn plugin_tool_result(value: Value) -> Result<ToolResult, String> {
    let object = value.as_object().ok_or(INVALID)?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "content" | "details" | "isError" | "structuredContent"
        )
    }) {
        return Err(INVALID.into());
    }
    let content = object
        .get("content")
        .and_then(Value::as_array)
        .ok_or(INVALID)?;
    if content.len() > 128
        || content.iter().any(|item| match item["type"].as_str() {
            Some("text") => !item["text"].is_string(),
            Some("image") => !item["data"].is_string() || !item["mimeType"].is_string(),
            _ => true,
        })
    {
        return Err(INVALID.into());
    }
    let is_error = match object.get("isError") {
        None => false,
        Some(Value::Bool(value)) => *value,
        _ => return Err(INVALID.into()),
    };
    let mut result = ToolResult::json(Value::Null);
    result.content = content.clone();
    result.details = object.get("details").cloned().unwrap_or(Value::Null);
    result.structured_content = object.get("structuredContent").cloned();
    result.is_error = is_error;
    Ok(result)
}
fn unavailable_before_dispatch() -> ToolOutcome {
    ToolOutcome::Failed(UNAVAILABLE.into())
}
fn disconnected(generation: u64, observations: Vec<Value>) -> ToolOutcome {
    ToolOutcome::Disconnected {
        generation,
        observations,
    }
}

impl CapturedTools {
    pub fn skills(&self) -> Vec<Value> {
        self.skills.clone()
    }
    pub fn unavailable(&self) -> Vec<Value> {
        self.unavailable.clone()
    }
    pub fn definitions(&self) -> Vec<Value> {
        self.plugins
            .iter()
            .flat_map(|p| p.generation.descriptors(&p.definitions))
            .collect()
    }
    pub async fn invoke(
        &self,
        request: ToolRequest,
        progress: ProgressSink,
        cancel: CancellationToken,
    ) -> ToolOutcome {
        for plugin in &self.plugins {
            let prefix = tool_prefix(&plugin.generation.plugin_id);
            if let Some(name) = request.definition.name.strip_prefix(&prefix)
                && plugin.definitions.tools.iter().any(|tool| {
                    tool["name"].as_str() == Some(name)
                        && tool["parameters"] == request.definition.parameters
                })
            {
                let admitted = lock(&plugin.workspace.context.app.state::<Executors>().dispatched)
                    .map(|mut dispatched| {
                        dispatched.insert((
                            plugin.workspace.context.scope.clone(),
                            request.run_id.clone(),
                            request.id.clone(),
                        ))
                    })
                    .unwrap_or(false);
                if !admitted {
                    return ToolOutcome::Failed("native.plugins.stateConflict".into());
                }
                return match plugin
                    .execute(
                        InvocationRequest {
                            run_id: &request.run_id,
                            kind: "tool",
                            name,
                            args: request.arguments,
                            script: None,
                        },
                        Some(progress),
                        cancel,
                    )
                    .await
                {
                    Ok(result) => match plugin_tool_result(result) {
                        Ok(result) => ToolOutcome::Completed(result),
                        Err(error) => ToolOutcome::Failed(error),
                    },
                    Err(outcome) => outcome,
                };
            }
        }
        ToolOutcome::Failed(UNAVAILABLE.into())
    }
    pub async fn drain(&self, run_id: &str) -> Result<(), String> {
        for plugin in &self.plugins {
            let invocations: Vec<_> = lock(&plugin.generation.invocations)?
                .values()
                .filter(|i| i.run_id == run_id)
                .cloned()
                .collect();
            if !invocations.is_empty() {
                plugin.workspace.revoke(&plugin.generation);
            }
            for invocation in &invocations {
                wait_drained(invocation).await?;
            }
            if plugin.generation.revoked.load(Ordering::Acquire) {
                plugin.workspace.wait_stopped(&plugin.generation).await?;
            }
            for invocation in invocations {
                retire_invocation(&plugin.workspace, &plugin.generation, &invocation).await?;
            }
        }
        Ok(())
    }
}
async fn retire_invocation(
    workspace: &Workspace,
    generation: &Generation,
    invocation: &Invocation,
) -> Result<(), String> {
    crate::plugin_preview::finish_invocation(&workspace.context.app, generation.id, &invocation.id)
        .await?;
    lock(&invocation.action)?.take();
    lock(&generation.invocations)?.remove(&invocation.id);
    workspace.prune_generations();
    Ok(())
}
async fn wait_drained(invocation: &Invocation) -> Result<(), String> {
    loop {
        let changed = invocation.changed.notified();
        if lock(&invocation.state)?.pending == 0 {
            return Ok(());
        }
        changed.await;
    }
}

async fn workspace(context: &Context) -> Result<Arc<Workspace>, String> {
    context.validate()?;
    let gate = lock(&context.app.state::<Executors>().gates)?
        .entry(context.scope.clone())
        .or_default()
        .clone();
    let _opening = gate.lock().await;
    if lock(&context.app.state::<Executors>().closing)?.contains(&context.scope) {
        return Err(UNAVAILABLE.into());
    }
    if let Some(workspace) = lock(&context.app.state::<Executors>().workspaces)?
        .get(&context.scope)
        .filter(|w| !w.closed.load(Ordering::Acquire) && w.context.validate().is_ok())
        .cloned()
    {
        return Ok(workspace);
    }
    let previous = lock(&context.app.state::<Executors>().workspaces)?
        .get(&context.scope)
        .cloned();
    if let Some(previous) = previous {
        let handle = lock(&previous.platform)?.clone();
        if let Some(handle) = handle {
            handle.close().await?;
        }
    }
    let opened = Workspace::open(context.clone()).await?;
    let state = context.app.state::<Executors>();
    if lock(&state.closing)?.contains(&context.scope) {
        let handle = lock(&opened.platform)?.clone().ok_or(UNAVAILABLE)?;
        handle.close().await?;
        return Err(UNAVAILABLE.into());
    }
    lock(&state.workspaces)?.insert(context.scope.clone(), opened.clone());
    Ok(opened)
}

fn current_platform() -> situate_core::plugins::PluginPlatform {
    if cfg!(target_os = "ios") {
        situate_core::plugins::PluginPlatform::Ios
    } else {
        situate_core::plugins::PluginPlatform::Macos
    }
}
fn supported_plugins(listing: &situate_core::plugins::runtime::Listing) -> HashSet<String> {
    let platform = current_platform();
    let candidates = listing
        .plugins
        .iter()
        .filter(|plugin| {
            plugin.enabled
                && plugin.error.is_none()
                && plugin.manifest.as_ref().is_some_and(|manifest| {
                    manifest
                        .platforms
                        .as_ref()
                        .is_none_or(|platforms| platforms.contains(&platform))
                })
        })
        .map(|plugin| plugin.id.clone())
        .collect::<HashSet<_>>();
    let mut supported = HashSet::new();
    loop {
        let ready = listing
            .plugins
            .iter()
            .filter(|plugin| {
                candidates.contains(&plugin.id)
                    && !supported.contains(&plugin.id)
                    && plugin.manifest.as_ref().is_some_and(|manifest| {
                        manifest
                            .dependencies
                            .iter()
                            .flatten()
                            .all(|id| supported.contains(id))
                    })
            })
            .map(|plugin| plugin.id.clone())
            .collect::<Vec<_>>();
        if ready.is_empty() {
            return supported;
        }
        supported.extend(ready);
    }
}

fn source_fingerprint(
    source: &Value,
    revisions: &crate::plugin_actions::Revisions,
    incarnations: &crate::plugin_actions::Incarnations,
) -> String {
    let revisions = revisions
        .iter()
        .collect::<std::collections::BTreeMap<_, _>>();
    let incarnations = incarnations
        .iter()
        .collect::<std::collections::BTreeMap<_, _>>();
    fingerprint(
        json!({"source":source,"revisions":revisions,"incarnations":incarnations})
            .to_string()
            .as_bytes(),
    )
}
fn source_metadata(source: &Value, revision: &Option<String>, incarnation: &str) -> Value {
    let mut metadata = json!({"pluginId":source["manifest"]["id"],"pluginName":source["manifest"]["name"],"incarnation":incarnation});
    if let Some(revision) = revision {
        metadata["revision"] = json!(revision);
    }
    metadata
}
fn source_skills(source: &Value, revision: &Option<String>, incarnation: &str) -> Vec<Value> {
    source["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|skill| {
            let mut metadata = source_metadata(source, revision, incarnation);
            metadata["path"] = skill["path"].clone();
            metadata["text"] = skill["text"].clone();
            metadata
        })
        .collect()
}
fn cached_unavailable<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &str,
    plugin_id: &str,
    signature: &str,
) -> Result<Option<Value>, String> {
    Ok(lock(&app.state::<Executors>().unavailable)?
        .get(scope)
        .and_then(|entries| entries.get(plugin_id))
        .filter(|entry| entry.fingerprint == signature)
        .map(|entry| entry.metadata.clone()))
}
fn remember_unavailable<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &str,
    plugin_id: String,
    signature: String,
    metadata: Value,
    required: HashSet<String>,
) -> Result<(), String> {
    lock(&app.state::<Executors>().unavailable)?
        .entry(scope.into())
        .or_default()
        .insert(
            plugin_id,
            Unavailable {
                fingerprint: signature,
                metadata,
                required,
            },
        );
    Ok(())
}
pub(crate) fn clear_unavailable<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &str,
    plugin_id: Option<&str>,
) {
    if let Some(executors) = app.try_state::<Executors>()
        && let Ok(mut unavailable) = executors.unavailable.lock()
    {
        if let Some(plugin_id) = plugin_id {
            if let Some(entries) = unavailable.get_mut(scope) {
                entries.retain(|id, entry| {
                    !id.is_empty() && id != plugin_id && !entry.required.contains(plugin_id)
                });
            }
        } else {
            unavailable.remove(scope);
        }
    }
}

pub(crate) fn ensure_capture_available<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &str,
) -> Result<(), String> {
    if lock(&app.state::<Executors>().closing)?.contains(scope) {
        return Err(UNAVAILABLE.into());
    }
    Ok(())
}

pub async fn capture(
    context: &Context,
    cancel: CancellationToken,
) -> Result<CapturedTools, String> {
    context.validate()?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let context_clone = context.clone();
    ensure_capture_available(&context.app, &context.scope)?;
    let captured=tauri::async_runtime::spawn_blocking(move||{
        crate::workspaces::with_retained_session(&context_clone.app,&context_clone.window,&context_clone.authorization,|location|{
            let root=crate::files::local_root(&context_clone.app,location)?.ok_or(UNAVAILABLE)?;
            let listing=situate_core::plugins::runtime::prepare(&root)?;
            let supported=supported_plugins(&listing);
            let mut sources=Vec::new();
            let mut unavailable=Vec::new();
            for plugin in listing.plugins.iter().filter(|plugin|plugin.enabled){
                if !supported.contains(&plugin.id){
                    unavailable.push(json!({"pluginId":plugin.id,"pluginName":plugin.manifest.as_ref().map(|manifest|manifest.name.clone()),"reason":"dependencyOrPlatformUnavailable","error":UNAVAILABLE}));
                    continue;
                }
                let captured=(||->Result<_,String>{
                    let revisions=crate::plugin_actions::capture_revisions(&context_clone.app,&context_clone.scope,&root,&plugin.id)?;
                    let incarnations=revisions.keys().map(|id|Ok((id.clone(),situate_core::plugins::folder::incarnation(&root,id)?))).collect::<Result<HashMap<_,_>,String>>()?;
                    let incarnation=incarnations.get(&plugin.id).cloned().ok_or(UNAVAILABLE)?;
                    let revision=revisions.get(&plugin.id).cloned().ok_or(UNAVAILABLE)?;
                    let source=if let Some(revision)=revision.as_ref(){situate_core::plugins::sources::at_revision(&root,&situate_core::plugins::sources::PackageRevision{plugin_id:plugin.id.clone(),revision:revision.clone(),incarnation:Some(incarnation.clone())})?}else{situate_core::plugins::runtime::load(&root,&plugin.id)?};
                    if source.manifest.platforms.as_ref().is_some_and(|platforms|!platforms.contains(&current_platform())){return Err(UNAVAILABLE.into());}
                    Ok((serde_json::to_value(source).map_err(|_|UNAVAILABLE)?,revision,incarnation,revisions,incarnations))
                })();
                match captured{
                    Ok(source)=>sources.push(source),
                    Err(error)=>unavailable.push(json!({"pluginId":plugin.id,"pluginName":plugin.manifest.as_ref().map(|manifest|manifest.name.clone()),"reason":"sourceUnavailable","error":worker_error(&json!(error))})),
                }
            }
            if situate_core::plugins::runtime::list(&root)?.revision!=listing.revision{return Err("native.plugins.stateConflict".into());}
            Ok((sources,unavailable))
        })
    }).await.map_err(|_|UNAVAILABLE.to_owned()).and_then(|result|result);
    context.validate()?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let (sources, mut unavailable) = match captured {
        Ok(captured) => captured,
        Err(error) => {
            return Ok(CapturedTools {
                unavailable: vec![
                    json!({"pluginId":null,"pluginName":null,"reason":"catalogUnavailable","error":worker_error(&json!(error))}),
                ],
                ..Default::default()
            });
        }
    };
    let skills = sources
        .iter()
        .flat_map(|(source, revision, incarnation, _, _)| {
            source_skills(source, revision, incarnation)
        })
        .collect();
    if sources.is_empty() {
        return Ok(CapturedTools {
            plugins: Vec::new(),
            skills,
            unavailable,
        });
    }
    let mut signatures = sources
        .iter()
        .map(|(source, _, _, revisions, incarnations)| {
            source_fingerprint(source, revisions, incarnations)
        })
        .collect::<Vec<_>>();
    signatures.sort();
    let executor_signature = fingerprint(signatures.join("\0").as_bytes());
    if let Some(warning) =
        cached_unavailable(&context.app, &context.scope, "", &executor_signature)?
    {
        unavailable.push(warning);
        return Ok(CapturedTools {
            plugins: Vec::new(),
            skills,
            unavailable,
        });
    }
    let workspace = match workspace(context).await {
        Ok(workspace) => workspace,
        Err(error) => {
            context.validate()?;
            if cancel.is_cancelled() {
                return Err(CANCELLED.into());
            }
            let warning = json!({"pluginId":null,"pluginName":null,"reason":"executorUnavailable","error":worker_error(&json!(error))});
            remember_unavailable(
                &context.app,
                &context.scope,
                String::new(),
                executor_signature,
                warning.clone(),
                HashSet::new(),
            )?;
            unavailable.push(warning);
            return Ok(CapturedTools {
                plugins: Vec::new(),
                skills,
                unavailable,
            });
        }
    };
    let attempts =
        sources
            .into_iter()
            .map(|(source, revision, incarnation, revisions, incarnations)| {
                let workspace = workspace.clone();
                let context = context.clone();
                let cancel = cancel.clone();
                async move {
                    let id = source["manifest"]["id"].as_str().ok_or(INVALID)?.to_owned();
                    let signature = source_fingerprint(&source, &revisions, &incarnations);
                    let metadata = source_metadata(&source, &revision, &incarnation);
                    let required = revisions.keys().cloned().collect::<HashSet<_>>();
                    if let Some(warning) =
                        cached_unavailable(&context.app, &context.scope, &id, &signature)?
                    {
                        return Ok((id, signature, metadata, required, None, Some(warning)));
                    }
                    let loaded = workspace
                        .load(
                            CapturedSource {
                                source,
                                revision,
                                incarnation,
                                revisions,
                                incarnations,
                            },
                            None,
                            &cancel,
                        )
                        .await;
                    match loaded {
                        Ok(plugin) => Ok((id, signature, metadata, required, Some(plugin), None)),
                        Err(error) => {
                            if cancel.is_cancelled() {
                                return Err(CANCELLED.into());
                            }
                            context.validate()?;
                            let unsettled =
                                lock(&workspace.generations)?.values().any(|generation| {
                                    generation.plugin_id == id
                                        && generation.revoked.load(Ordering::Acquire)
                                        && !generation.terminated.load(Ordering::Acquire)
                                });
                            if unsettled {
                                return Err(error);
                            }
                            let mut warning = metadata.clone();
                            warning["reason"] = json!("initializationUnavailable");
                            warning["error"] = json!(worker_error(&json!(error)));
                            if error != CANCELLED {
                                remember_unavailable(
                                    &context.app,
                                    &context.scope,
                                    id.clone(),
                                    signature.clone(),
                                    warning.clone(),
                                    required.clone(),
                                )?;
                            }
                            Ok((id, signature, metadata, required, None, Some(warning)))
                        }
                    }
                }
            });
    let results = futures_util::future::join_all(attempts)
        .await
        .into_iter()
        .collect::<Result<Vec<_>, String>>()?;
    context.validate()?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let initialized = results
        .iter()
        .filter_map(|(id, _, _, _, plugin, _)| plugin.as_ref().map(|_| id.clone()))
        .collect::<HashSet<_>>();
    let mut plugins = Vec::new();
    for (id, signature, metadata, required, plugin, warning) in results {
        if let Some(warning) = warning {
            unavailable.push(warning);
        }
        if let Some(plugin) = plugin {
            if required
                .iter()
                .any(|dependency| !initialized.contains(dependency))
            {
                workspace.revoke(&plugin.generation);
                workspace.wait_stopped(&plugin.generation).await?;
                workspace.prune_generations();
                let mut warning = metadata;
                warning["reason"] = json!("dependencyUnavailable");
                warning["error"] = json!(UNAVAILABLE);
                remember_unavailable(
                    &context.app,
                    &context.scope,
                    id,
                    signature,
                    warning.clone(),
                    required,
                )?;
                unavailable.push(warning);
            } else {
                if let Some(entries) =
                    lock(&context.app.state::<Executors>().unavailable)?.get_mut(&context.scope)
                {
                    entries.remove(&id);
                }
                plugins.push(plugin);
            }
        }
    }
    Ok(CapturedTools {
        plugins,
        skills,
        unavailable,
    })
}

pub async fn check(
    context: &Context,
    source: Value,
    test_id: String,
    script: String,
    timeout_ms: u64,
    progress: ProgressSink,
    cancel: CancellationToken,
) -> Result<Value, String> {
    check_inner(
        context,
        source,
        test_id,
        script,
        timeout_ms,
        Some(progress),
        cancel,
    )
    .await
}
fn check_result(outcome: Result<Value, ToolOutcome>) -> Result<Value, String> {
    match outcome {
        Ok(mut value) => {
            if value["passed"] == true {
                crate::plugin_checks::worker_evidence(&value)?;
            } else if value["passed"] == false
                && value["assertions"]
                    .as_u64()
                    .is_some_and(|n| u32::try_from(n).is_ok())
            {
                value["error"] = json!(check_error(&value["error"]));
                if let Some(failure) = value.get("failure")
                    && (!failure["assertion"]
                        .as_u64()
                        .is_some_and(|n| n > 0 && u32::try_from(n).is_ok())
                        || !matches!(failure["operator"].as_str(), Some("ok" | "equal"))
                        || ["actual", "expected"].iter().any(|key| {
                            !failure[key].as_str().is_some_and(|text| text.len() <= 4096)
                        })
                        || !failure.as_object().is_some_and(|fields| fields.len() == 4))
                {
                    return Err(INVALID.into());
                }
            } else {
                return Err(INVALID.into());
            }
            Ok(value)
        }
        Err(ToolOutcome::Completed(result)) => {
            let error = check_error(&result.details["error"]);
            check_diagnostic("script-failed", &error);
            let mut value =
                json!({"passed":false,"assertions":0,"assertionsKnown":false,"error":error});
            if let Some(observations) = result.details["observations"].as_array() {
                value["observations"] =
                    json!(&observations[observations.len().saturating_sub(32)..]);
                value["observationsTruncated"] = json!(observations.len() > 32);
            }
            Ok(value)
        }
        Err(ToolOutcome::Disconnected { observations, .. }) => {
            check_diagnostic("script-disconnected", UNAVAILABLE);
            Ok(
                json!({"passed":false,"assertions":0,"assertionsKnown":false,"error":UNAVAILABLE,
                "observations":&observations[observations.len().saturating_sub(32)..],
                "observationsTruncated":observations.len() > 32}),
            )
        }
        Err(ToolOutcome::Failed(error)) => Err(error),
    }
}
pub(crate) fn check_diagnostic(stage: &'static str, error: &str) {
    #[cfg(feature = "native-smoke")]
    eprintln!(
        "SITUATE_PLUGIN_CHECK_STAGE {}",
        json!({"stage":stage,"code":worker_error(&json!(error))})
    );
    #[cfg(not(feature = "native-smoke"))]
    let _ = (stage, error);
}

pub(crate) async fn check_inner(
    context: &Context,
    source: Value,
    test_id: String,
    script: String,
    timeout_ms: u64,
    progress: Option<ProgressSink>,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let workspace = workspace(context)
        .await
        .inspect_err(|error| check_diagnostic("workspace", error))?;
    let (target, sources) = if source.get("source").is_some() {
        (
            source["source"].clone(),
            source["sources"].as_array().cloned().unwrap_or_default(),
        )
    } else {
        (source.clone(), vec![source])
    };
    let check_cancel = cancel.child_token();
    let execute = async {
        let mut target_plugin = None;
        for source in sources {
            let plugin = workspace
                .load(
                    CapturedSource {
                        source: source.clone(),
                        revision: None,
                        incarnation: test_id.clone(),
                        revisions: HashMap::new(),
                        incarnations: HashMap::new(),
                    },
                    Some(test_id.clone()),
                    &check_cancel,
                )
                .await
                .inspect_err(|error| check_diagnostic("load", error))?;
            if source["manifest"]["id"] == target["manifest"]["id"] {
                target_plugin = Some(plugin);
            }
        }
        let plugin = target_plugin.ok_or(INVALID)?;
        let outcome = plugin
            .execute(
                InvocationRequest {
                    run_id: &test_id,
                    kind: "check",
                    name: "",
                    args: Value::Null,
                    script: Some(&script),
                },
                progress,
                check_cancel.clone(),
            )
            .await;
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        check_result(outcome)
    };
    tokio::pin!(execute);
    let outcome = tokio::select! {
        result=&mut execute=>result,
        _=tokio::time::sleep(Duration::from_millis(timeout_ms.clamp(100,60_000)))=>{check_cancel.cancel();execute.await}
    };
    let generations = lock(&workspace.generations)?
        .values()
        .filter(|g| g.test_id.as_deref() == Some(&test_id))
        .cloned()
        .collect::<Vec<_>>();
    for generation in &generations {
        workspace.revoke(generation);
    }
    for generation in &generations {
        let invocations = lock(&generation.invocations)?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for invocation in invocations {
            wait_drained(&invocation).await?;
        }
        workspace.wait_stopped(generation).await?;
    }
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    outcome
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Snapshot,
    Stop,
    Activity,
    PendingPersistences,
    RetryPersistence {
        #[serde(rename = "invocationId")]
        invocation_id: String,
    },
    Invoke {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        #[serde(rename = "exportName")]
        export_name: String,
        args: Value,
        generation: u64,
    },
}
impl Request {
    fn authorization<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        window: &str,
        scope: &str,
    ) -> Result<crate::workspaces::AuthorizationSession, String> {
        if matches!(self, Self::Activity | Self::Stop) {
            crate::workspaces::control_authorization_session(app, window, scope)
        } else {
            crate::workspaces::authorization_session(app, window, scope)
        }
    }
}

#[tauri::command]
pub async fn plugin_executor(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: Request,
) -> Result<Value, String> {
    let window = window.label().to_owned();
    let fresh = matches!(request, Request::Snapshot | Request::Invoke { .. });
    let existing = if fresh {
        None
    } else {
        lock(&app.state::<Executors>().workspaces)?
            .get(&scope)
            .map(|workspace| workspace.context.clone())
    };
    let context = if let Some(context) = existing {
        if context.window != window {
            return Err(UNAVAILABLE.into());
        }
        crate::workspaces::with_retained_control(&app, &window, &context.authorization, || Ok(()))?;
        context
    } else {
        if matches!(request, Request::RetryPersistence { .. }) {
            return Err(UNAVAILABLE.into());
        }
        let authorization = request.authorization(&app, &window, &scope)?;
        Context {
            app,
            window,
            scope,
            authorization,
        }
    };
    context.validate()?;
    match &request {
        Request::PendingPersistences => return pending_persistences(&context).await,
        Request::RetryPersistence { invocation_id } => {
            return retry_persistence(&context, invocation_id).await;
        }
        _ => {}
    }
    if matches!(request, Request::Stop | Request::Activity) {
        let workspace = lock(&context.app.state::<Executors>().workspaces)?
            .get(&context.scope)
            .cloned();
        let mut running = 0;
        if let Some(workspace) = workspace {
            let generations = lock(&workspace.generations)?
                .values()
                .cloned()
                .collect::<Vec<_>>();
            for generation in generations {
                if matches!(request, Request::Stop) {
                    workspace.revoke(&generation);
                }
                let invocations = lock(&generation.invocations)?
                    .values()
                    .cloned()
                    .collect::<Vec<_>>();
                running += invocations.len();
                if matches!(request, Request::Stop) {
                    for invocation in &invocations {
                        wait_drained(invocation).await?;
                    }
                    workspace.wait_stopped(&generation).await?;
                    for invocation in invocations {
                        finalize_manual(&invocation).await?;
                        retire_invocation(&workspace, &generation, &invocation).await?;
                    }
                }
            }
        }
        return Ok(json!({"runningActions":if matches!(request,Request::Stop){0}else{running}}));
    }
    let tools = capture(&context, CancellationToken::new()).await?;
    match request {
        Request::Stop
        | Request::Activity
        | Request::PendingPersistences
        | Request::RetryPersistence { .. } => unreachable!(),
        Request::Snapshot => Ok(
            json!({"plugins":tools.plugins.iter().map(|p|p.generation.snapshot(&p.definitions)).collect::<Vec<_>>(),"unavailable":tools.unavailable()}),
        ),
        Request::Invoke {
            plugin_id,
            export_name,
            args,
            generation,
        } => {
            let plugin = tools
                .plugins
                .iter()
                .find(|p| {
                    p.generation.plugin_id == plugin_id
                        && p.generation.id == generation
                        && p.definitions.exports.contains(&export_name)
                })
                .ok_or(UNAVAILABLE)?;
            let run_id = uuid::Uuid::new_v4().to_string();
            let result = plugin
                .execute(
                    InvocationRequest {
                        run_id: &run_id,
                        kind: "export",
                        name: &export_name,
                        args,
                        script: None,
                    },
                    None,
                    CancellationToken::new(),
                )
                .await;
            match result {
                Ok(value) => Ok(json!({"outcome":"completed","value":value})),
                Err(outcome) => {
                    let invocation = lock(&plugin.generation.invocations)?
                        .values()
                        .find(|i| i.run_id == run_id)
                        .cloned();
                    if let Some(invocation) = invocation
                        && let Some(ledger) = invocation.ledger.lock().await.as_ref()
                        && let Some(error) = ledger.error.as_ref()
                    {
                        return Ok(
                            json!({"outcome":"pendingPersistence","invocationId":invocation.id,"error":error}),
                        );
                    }
                    Err(match outcome {
                        ToolOutcome::Failed(error) => error,
                        _ => UNAVAILABLE.into(),
                    })
                }
            }
        }
    }
}

fn manual_invocations(context: &Context) -> Result<Vec<ManualInvocationOwners>, String> {
    context.validate()?;
    let workspace = lock(&context.app.state::<Executors>().workspaces)?
        .get(&context.scope)
        .cloned();
    let mut result = Vec::new();
    if let Some(workspace) = workspace {
        if workspace.context.window != context.window {
            return Err(UNAVAILABLE.into());
        }
        workspace.context.validate()?;
        for generation in lock(&workspace.generations)?.values() {
            for invocation in lock(&generation.invocations)?.values() {
                result.push((workspace.clone(), generation.clone(), invocation.clone()));
            }
        }
    }
    Ok(result)
}
async fn pending_persistences(context: &Context) -> Result<Value, String> {
    let mut pending = Vec::new();
    for (_, generation, invocation) in manual_invocations(context)? {
        if let Some(ledger) = invocation.ledger.lock().await.as_ref()
            && let Some(error) = ledger.error.as_ref()
        {
            pending.push(
                json!({"invocationId":invocation.id,"pluginId":generation.plugin_id,"error":error}),
            );
        }
    }
    Ok(Value::Array(pending))
}
async fn retry_persistence(context: &Context, id: &str) -> Result<Value, String> {
    let (workspace, generation, invocation) = manual_invocations(context)?
        .into_iter()
        .find(|(_, _, i)| i.id == id)
        .ok_or(UNAVAILABLE)?;
    if lock(&invocation.state)?.pending != 0 {
        return Err("native.plugins.stateBusy".into());
    }
    {
        let mut ledger = invocation.ledger.lock().await;
        let ledger = ledger.as_mut().ok_or(UNAVAILABLE)?;
        if let Err(error) = persist_manual_staged(ledger).await {
            return Ok(json!({"outcome":"pendingPersistence","invocationId":id,"error":error}));
        }
    }
    let terminal = invocation
        .ledger
        .lock()
        .await
        .as_ref()
        .is_some_and(|ledger| ledger.record.status().is_terminal());
    if !terminal && let Err(error) = finalize_manual(&invocation).await {
        return Ok(json!({"outcome":"pendingPersistence","invocationId":id,"error":error}));
    }
    let result = lock(&invocation.state)?.terminal.clone().ok_or(INVALID)?;
    retire_invocation(&workspace, &generation, &invocation).await?;
    match result {
        Terminal::Result(value) => Ok(json!({"outcome":"completed","value":value})),
        Terminal::Error(error) => Err(error),
        Terminal::Disconnected => Err(UNAVAILABLE.into()),
    }
}

pub(crate) fn scopes(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let Some(executors) = app.try_state::<Executors>() else {
        return Ok(Vec::new());
    };
    let mut scopes = lock(&executors.workspaces)?
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    scopes.extend(lock(&executors.gates)?.keys().cloned());
    let mut scopes = scopes.into_iter().collect::<Vec<_>>();
    scopes.sort();
    Ok(scopes)
}
pub(crate) fn has_any_active<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<bool, String> {
    let Some(executors) = app.try_state::<Executors>() else {
        return Ok(false);
    };
    if lock(&executors.gates)?
        .values()
        .any(|gate| gate.try_lock().is_err())
    {
        return Ok(true);
    }
    for workspace in lock(&executors.workspaces)?.values() {
        for generation in lock(&workspace.generations)?.values() {
            if !lock(&generation.invocations)?.is_empty()
                || (generation.revoked.load(Ordering::Acquire)
                    && !generation.terminated.load(Ordering::Acquire))
                || (generation.load_sent.load(Ordering::Acquire)
                    && lock(&generation.ready)?.is_none())
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

pub(crate) fn has_active(app: &tauri::AppHandle, scope: &str) -> Result<bool, String> {
    if let Some(executors) = app.try_state::<Executors>() {
        if lock(&executors.gates)?
            .get(scope)
            .is_some_and(|gate| gate.try_lock().is_err())
        {
            return Ok(true);
        }
        if let Some(workspace) = lock(&executors.workspaces)?.get(scope).cloned() {
            for generation in lock(&workspace.generations)?.values() {
                if !lock(&generation.invocations)?.is_empty()
                    || (generation.revoked.load(Ordering::Acquire)
                        && !generation.terminated.load(Ordering::Acquire))
                    || (generation.load_sent.load(Ordering::Acquire)
                        && lock(&generation.ready)?.is_none())
                {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}
pub(crate) fn prepare_close<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &str,
) -> Result<(), String> {
    if let Some(executors) = app.try_state::<Executors>() {
        lock(&executors.closing)?.insert(scope.into());
        if let Some(workspace) = lock(&executors.workspaces)?.get(scope) {
            workspace.closing.store(true, Ordering::Release);
        }
    }
    Ok(())
}
pub(crate) fn cancel_close<R: tauri::Runtime>(app: &tauri::AppHandle<R>, scope: &str) {
    if let Some(executors) = app.try_state::<Executors>() {
        if let Ok(mut closing) = executors.closing.lock() {
            closing.remove(scope);
        }
        if let Ok(workspaces) = executors.workspaces.lock()
            && let Some(workspace) = workspaces.get(scope)
        {
            workspace.closing.store(false, Ordering::Release);
        }
    }
}
pub(crate) async fn abort_all(app: &tauri::AppHandle, scope: &str) -> Result<(), String> {
    prepare_close(app, scope)?;
    let gate = match app.try_state::<Executors>() {
        Some(executors) => lock(&executors.gates)?.get(scope).cloned(),
        None => None,
    };
    let _opening = if let Some(gate) = gate.as_ref() {
        Some(gate.lock().await)
    } else {
        None
    };
    let workspace = match app.try_state::<Executors>() {
        Some(executors) => lock(&executors.workspaces)?.get(scope).cloned(),
        None => None,
    };
    if let Some(workspace) = workspace {
        workspace.closing.store(true, Ordering::Release);
        let generations = lock(&workspace.generations)?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for generation in &generations {
            workspace.revoke(generation);
        }
        for generation in &generations {
            let invocations = lock(&generation.invocations)?
                .values()
                .cloned()
                .collect::<Vec<_>>();
            for invocation in &invocations {
                wait_drained(invocation).await?;
            }
            workspace.wait_stopped(generation).await?;
            for invocation in invocations {
                finalize_manual(&invocation).await?;
                retire_invocation(&workspace, generation, &invocation).await?;
            }
        }
        let handle = lock(&workspace.platform)?.clone();
        if let Some(handle) = handle {
            handle.close().await?;
        }
        if !workspace.stopped.load(Ordering::Acquire) {
            return Err(UNAVAILABLE.into());
        }
    }
    Ok(())
}

pub(crate) fn invalidate_scope<R: tauri::Runtime>(app: &tauri::AppHandle<R>, scope: &str) {
    if let Some(executors) = app.try_state::<Executors>()
        && let Ok(mut workspaces) = executors.workspaces.lock()
        && workspaces
            .get(scope)
            .is_none_or(|workspace| workspace.stopped.load(Ordering::Acquire))
    {
        workspaces.remove(scope);
        if let Ok(mut gates) = executors.gates.lock() {
            gates.remove(scope);
        }
        if let Ok(mut closing) = executors.closing.lock() {
            closing.remove(scope);
        }
        if let Ok(mut dispatched) = executors.dispatched.lock() {
            dispatched.retain(|(owner, _, _)| owner != scope);
        }
        clear_unavailable(app, scope, None);
    }
}

fn supervisor_source(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(asset) = app.asset_resolver().get("executor-supervisor.js".into()) {
        return String::from_utf8(asset.bytes).map_err(|_| UNAVAILABLE.into());
    }
    #[cfg(debug_assertions)]
    {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/executor-supervisor.js");
        std::fs::read_to_string(path).map_err(|_| UNAVAILABLE.into())
    }
    #[cfg(not(debug_assertions))]
    Err(UNAVAILABLE.into())
}

async fn preview_request(
    workspace: &Workspace,
    generation: &Generation,
    invocation: &Invocation,
    mut request: Value,
) -> Result<Value, String> {
    let context = &workspace.context;
    let operation = request["operation"].as_str().ok_or(INVALID)?.to_owned();
    let mut args = request
        .get_mut("request")
        .map(Value::take)
        .unwrap_or_else(|| json!({}));
    if !args.is_object() {
        return Err(INVALID.into());
    }
    if operation == "previewOpen" {
        args["source"] = generation.source.clone();
        args["sources"] = Value::Array(
            lock(&workspace.generations)?
                .values()
                .filter(|g| g.test_id == generation.test_id && !g.revoked.load(Ordering::Acquire))
                .map(|g| g.source.clone())
                .collect(),
        );
    }
    let capture = operation == "previewStep" && args["action"] == "capture";
    if capture && lock(&invocation.images)?.len() >= 4 {
        return Err("native.plugins.checkLimit".into());
    }
    let result = crate::plugin_preview::executor_request(
        &context.app,
        &context.window,
        &context.scope,
        generation.id,
        &invocation.id,
        json!({"operation":operation,"args":args}),
        invocation.cancel.clone(),
    )
    .await?;
    if capture {
        let data = result["data"].as_str().ok_or(INVALID)?;
        if data.len() > 24 * 1024 * 1024 {
            return Err("native.plugins.checkLimit".into());
        }
        let mut images = lock(&invocation.images)?;
        if images.len() >= 4 {
            return Err("native.plugins.checkLimit".into());
        }
        images.push(result.clone());
        return Ok(json!({"captured":true,"mimeType":result["mimeType"]}));
    }
    Ok(result)
}

pub(crate) async fn preview_service(
    app: &tauri::AppHandle,
    window: &str,
    generation: u64,
    invocation_id: &str,
    plugin_id: &str,
    export_name: &str,
    args: Value,
) -> Result<Value, String> {
    let workspaces = lock(&app.state::<Executors>().workspaces)?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    for workspace in workspaces {
        if workspace.context.window != window {
            continue;
        }
        let origin = lock(&workspace.generations)?.get(&generation).cloned();
        if let Some(origin) = origin {
            let invocation = lock(&origin.invocations)?
                .get(invocation_id)
                .cloned()
                .ok_or(UNAVAILABLE)?;
            if lock(&invocation.state)?.terminal.is_some() || origin.revoked.load(Ordering::Acquire)
            {
                return Err(UNAVAILABLE.into());
            }
            let request = json!({"operation":"dependenciesInvoke","pluginId":plugin_id,"exportName":export_name,"args":args});
            if plugin_id != origin.plugin_id {
                return workspace.host_request(&origin, &invocation, request).await;
            }
            let definitions = lock(&origin.ready)?.clone().ok_or(UNAVAILABLE)??;
            if !definitions.exports.iter().any(|name| name == export_name) {
                return Err(INVALID.into());
            }
            return CapturedPlugin {
                workspace,
                generation: origin,
                definitions,
            }
            .execute(
                InvocationRequest {
                    run_id: &invocation.run_id,
                    kind: "export",
                    name: export_name,
                    args,
                    script: None,
                },
                invocation.progress.clone(),
                invocation.cancel.child_token(),
            )
            .await
            .map_err(|_| UNAVAILABLE.into());
        }
    }
    Err(UNAVAILABLE.into())
}

pub(crate) async fn retire_plugins(
    app: &tauri::AppHandle,
    scope: &str,
    plugin_ids: &[String],
) -> Result<(), String> {
    let workspace = match app.try_state::<Executors>() {
        Some(executors) => lock(&executors.workspaces)?.get(scope).cloned(),
        None => None,
    };
    if let Some(workspace) = workspace {
        let generations = lock(&workspace.generations)?
            .values()
            .filter(|g| {
                g.test_id.is_none()
                    && (plugin_ids.contains(&g.plugin_id)
                        || g.revisions.keys().any(|id| plugin_ids.contains(id)))
            })
            .cloned()
            .collect::<Vec<_>>();
        for generation in &generations {
            workspace.revoke(generation);
        }
        for generation in &generations {
            let invocations = lock(&generation.invocations)?
                .values()
                .cloned()
                .collect::<Vec<_>>();
            for invocation in &invocations {
                wait_drained(invocation).await?;
            }
            workspace.wait_stopped(generation).await?;
            for invocation in invocations {
                finalize_manual(&invocation).await?;
                retire_invocation(&workspace, generation, &invocation).await?;
            }
        }
    }
    Ok(())
}
pub(crate) async fn retire_affected(
    app: &tauri::AppHandle,
    scope: &str,
    incarnations: &crate::plugin_actions::Incarnations,
) -> Result<(), String> {
    let workspace = match app.try_state::<Executors>() {
        Some(executors) => lock(&executors.workspaces)?.get(scope).cloned(),
        None => None,
    };
    if let Some(workspace) = workspace {
        let generations = lock(&workspace.generations)?
            .values()
            .filter(|g| {
                g.test_id.is_none()
                    && incarnations
                        .iter()
                        .any(|(id, inc)| g.incarnations.get(id) == Some(inc))
            })
            .cloned()
            .collect::<Vec<_>>();
        for generation in &generations {
            workspace.revoke(generation);
        }
        for generation in generations {
            let invocations = lock(&generation.invocations)?
                .values()
                .cloned()
                .collect::<Vec<_>>();
            for invocation in &invocations {
                wait_drained(invocation).await?;
            }
            workspace.wait_stopped(&generation).await?;
            for invocation in invocations {
                finalize_manual(&invocation).await?;
                retire_invocation(&workspace, &generation, &invocation).await?;
            }
        }
    }
    Ok(())
}
pub(crate) async fn refresh(
    context: &Context,
    plugin_ids: &[String],
    cancel: CancellationToken,
) -> Result<(), String> {
    context.validate()?;
    retire_plugins(&context.app, &context.scope, plugin_ids).await?;
    for plugin_id in plugin_ids {
        clear_unavailable(&context.app, &context.scope, Some(plugin_id));
    }
    let captured = capture(context, cancel).await?;
    let direct = captured.unavailable.iter().any(|warning| {
        warning["pluginId"].is_null()
            || warning["pluginId"]
                .as_str()
                .is_some_and(|id| plugin_ids.iter().any(|plugin| plugin == id))
    });
    let dependent = lock(&context.app.state::<Executors>().unavailable)?
        .get(&context.scope)
        .is_some_and(|entries| {
            entries
                .values()
                .any(|entry| entry.required.iter().any(|id| plugin_ids.contains(id)))
        });
    if direct || dependent {
        return Err(UNAVAILABLE.into());
    }
    Ok(())
}

pub(crate) fn stop_affected(
    app: &tauri::AppHandle,
    scope: &str,
    incarnations: &crate::plugin_actions::Incarnations,
) -> Result<(), String> {
    if let Some(executors) = app.try_state::<Executors>()
        && let Some(workspace) = lock(&executors.workspaces)?.get(scope).cloned()
    {
        let generations = lock(&workspace.generations)?
            .values()
            .filter(|g| {
                incarnations
                    .iter()
                    .any(|(id, inc)| g.incarnations.get(id) == Some(inc))
            })
            .cloned()
            .collect::<Vec<_>>();
        for generation in generations {
            workspace.revoke(&generation);
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "ai_executor_tests.rs"]
mod tests;
