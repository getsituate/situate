#[cfg(any(test, feature = "native-smoke"))]
#[path = "../tests/support/diagnostics_smoke.rs"]
pub mod smoke;

#[cfg(all(debug_assertions, desktop, unix))]
mod discovery;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use situate_core::diagnostics::{
    BoundContext, Collector, EventInput, HostIdentity, Level, OperationContext, Origin, Producer,
    load_or_create_device_id,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio::sync::Mutex;
use uuid::Uuid;

const MAX_REGISTRATIONS: usize = 64;
const MAX_WINDOW_REGISTRATIONS: usize = 16;
const MAX_BATCH_EVENTS: usize = 64;
const MAX_BATCH_BYTES: usize = 64 * 1024;

pub struct Diagnostics {
    runtime: Mutex<Option<Runtime>>,
    ready: tokio::sync::watch::Sender<bool>,
    registrations: tokio::sync::Semaphore,
    stopping: AtomicBool,
}
struct Runtime {
    #[cfg(feature = "native-smoke")]
    session_id: String,
    collector: Collector,
    application: Producer,
    application_sequence: u64,
    producers: HashMap<String, Registered>,
}
struct Registered {
    created: Instant,
    window: String,
    scope: Option<Scope>,
    producer: Producer,
}
struct Scope {
    handle: String,
    generation: Weak<crate::files::Session>,
}
impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(None),
            ready: tokio::sync::watch::channel(false).0,
            registrations: tokio::sync::Semaphore::new(MAX_REGISTRATIONS),
            stopping: AtomicBool::new(false),
        }
    }
}

pub fn setup(app: &tauri::AppHandle) {
    let handle = app.clone();
    if std::thread::Builder::new()
        .name("diagnostic-init".into())
        .spawn(move || {
            let state = handle.state::<Diagnostics>();
            let runtime = initialize(&handle).ok();
            let mut target = state.runtime.blocking_lock();
            if !state.stopping.load(Ordering::Acquire) {
                *target = runtime;
            }
            state.ready.send_replace(true);
        })
        .is_err()
    {
        app.state::<Diagnostics>().ready.send_replace(true);
    }
}

fn initialize(app: &tauri::AppHandle) -> std::io::Result<Runtime> {
    let launch_session = Uuid::new_v4().to_string();
    #[cfg(all(debug_assertions, desktop, unix))]
    let discovery = discovery::Manifest::from_env();
    let (logs, identity, platform_version) = directories(app).inspect_err(|_| {
        #[cfg(all(debug_assertions, desktop, unix))]
        if let Some(manifest) = &discovery {
            manifest.publish("", &launch_session, false);
        }
    })?;
    let device_id = load_or_create_device_id(&identity).inspect_err(|_| {
        #[cfg(all(debug_assertions, desktop, unix))]
        if let Some(manifest) = &discovery {
            manifest.publish(&logs.to_string_lossy(), &launch_session, false);
        }
    })?;
    let identity = HostIdentity {
        device_id,
        session_id: launch_session,
        app_version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        platform_version,
    };
    #[cfg(feature = "native-smoke")]
    let session_id = identity.session_id.clone();
    #[cfg(all(debug_assertions, desktop, unix))]
    let discovered = discovery.map(|manifest| discovery::start(&logs, identity.clone(), manifest));
    #[cfg(not(all(debug_assertions, desktop, unix)))]
    let discovered: Option<std::io::Result<Collector>> = None;
    let collector = match discovered {
        Some(collector) => collector?,
        #[cfg(not(feature = "native-smoke"))]
        None => Collector::start(&logs, identity)?,
        #[cfg(feature = "native-smoke")]
        None => smoke::start_collector(&logs, identity)?,
    };
    let application = collector
        .producer(BoundContext {
            origin: Origin::Native,
            workspace_id: None,
        })
        .ok_or_else(|| std::io::Error::other("diagnostic admission unavailable"))?;
    application.emit(event(
        "app.started",
        "app",
        Level::Info,
        0,
        None,
        Map::new(),
    ));
    Ok(Runtime {
        #[cfg(feature = "native-smoke")]
        session_id,
        collector,
        application,
        application_sequence: 1,
        producers: HashMap::new(),
    })
}

fn directories(app: &tauri::AppHandle) -> std::io::Result<(PathBuf, PathBuf, String)> {
    #[cfg(mobile)]
    {
        let response = app
            .state::<tauri_plugin_workspace_access::Access>()
            .request(json!({"operation":"diagnosticsDirectory"}))
            .map_err(|_| std::io::Error::other("diagnostic directory unavailable"))?;
        let directory = response
            .get("directory")
            .and_then(Value::as_str)
            .filter(|value| PathBuf::from(value).is_absolute())
            .ok_or_else(|| std::io::Error::other("diagnostic directory unavailable"))?;
        let version = response
            .get("platformVersion")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        Ok((
            PathBuf::from(directory).join("logs"),
            PathBuf::from(directory),
            numeric_version(version),
        ))
    }
    #[cfg(desktop)]
    {
        let logs = app
            .path()
            .app_log_dir()
            .map_err(std::io::Error::other)?
            .join("diagnostics");
        let identity = app
            .path()
            .app_local_data_dir()
            .map_err(std::io::Error::other)?
            .join("diagnostics");
        Ok((logs, identity, platform_version()))
    }
}

fn numeric_version(value: &str) -> String {
    let version: String = value
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .take(32)
        .collect();
    if version.is_empty() {
        "unknown".into()
    } else {
        version
    }
}

#[cfg(desktop)]
fn platform_version() -> String {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let mut data = std::mem::MaybeUninit::<libc::utsname>::uninit();
        // uname writes a fixed-size structure; only the numeric kernel release is retained.
        if unsafe { libc::uname(data.as_mut_ptr()) } == 0 {
            let data = unsafe { data.assume_init() };
            let bytes: Vec<u8> = data
                .release
                .iter()
                .take_while(|b| **b != 0)
                .map(|b| *b as u8)
                .collect();
            return numeric_version(&String::from_utf8_lossy(&bytes));
        }
    }
    "unknown".into()
}

#[derive(Serialize)]
pub struct Registration {
    producer_id: String,
}
#[derive(Default, Serialize)]
pub struct Admission {
    accepted: usize,
    dropped: usize,
}

#[tauri::command]
pub async fn diagnostics_register(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: Option<String>,
) -> Option<Registration> {
    if scope.as_ref().is_some_and(|s| s.len() > 8192) {
        return None;
    }
    let state = app.try_state::<Diagnostics>()?;
    let _permit = state.registrations.try_acquire().ok()?;
    let mut ready = state.ready.subscribe();
    if !*ready.borrow_and_update() {
        ready.changed().await.ok()?;
    }
    if state.stopping.load(Ordering::Acquire) {
        return None;
    }
    let admitted = match scope {
        Some(handle) => {
            let (identity, generation) = crate::workspaces::diagnostic_registration(
                app.clone(),
                window.label().into(),
                handle.clone(),
            )
            .await?;
            Some((
                identity,
                Scope {
                    handle,
                    generation: Arc::downgrade(&generation),
                },
            ))
        }
        None => None,
    };
    let mut runtime = state.runtime.lock().await;
    if state.stopping.load(Ordering::Acquire) || app.get_webview_window(window.label()).is_none() {
        return None;
    }
    let runtime = runtime.as_mut()?;
    runtime.producers.retain(|_, item| {
        app.get_webview_window(&item.window).is_some()
            && item.scope.as_ref().is_none_or(|scope| {
                scope
                    .generation
                    .upgrade()
                    .is_some_and(|session| !session.detached.load(Ordering::Acquire))
            })
    });
    if runtime.producers.len() >= MAX_REGISTRATIONS
        || runtime
            .producers
            .values()
            .filter(|item| item.window == window.label())
            .count()
            >= MAX_WINDOW_REGISTRATIONS
    {
        return None;
    }
    let producer = runtime.collector.producer(BoundContext {
        origin: Origin::Frontend,
        workspace_id: admitted.as_ref().map(|(id, _)| id.clone()),
    })?;
    let id = producer.id().to_owned();
    runtime.producers.insert(
        id.clone(),
        Registered {
            created: Instant::now(),
            producer,
            window: window.label().into(),
            scope: admitted.map(|(_, scope)| scope),
        },
    );
    Some(Registration { producer_id: id })
}

fn owns(
    registration: &Registered,
    window: &str,
    current: Option<&Arc<crate::files::Session>>,
) -> bool {
    registration.window == window
        && match &registration.scope {
            None => true,
            Some(scope) => current
                .zip(scope.generation.upgrade().as_ref())
                .is_some_and(|(current, bound)| {
                    Arc::ptr_eq(current, bound) && !bound.detached.load(Ordering::Acquire)
                }),
        }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Batch {
    producer: String,
    events: Vec<EventInput>,
}

fn parse_batch(body: &tauri::ipc::InvokeBody) -> Option<Batch> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => parse_batch_bytes(bytes),
        tauri::ipc::InvokeBody::Json(value) if cfg!(target_os = "android") => {
            parse_android_batch(value)
        }
        _ => None,
    }
}

fn parse_android_batch(value: &Value) -> Option<Batch> {
    // Tauri's Android bridge serializes Uint8Array as JSON before command dispatch.
    // Bound the decoded bytes before parsing events, not the framework's JSON allocation.
    let values = value.as_array()?;
    if values.len() > MAX_BATCH_BYTES {
        return None;
    }
    let bytes = values
        .iter()
        .map(|value| u8::try_from(value.as_u64()?).ok())
        .collect::<Option<Vec<_>>>()?;
    parse_batch_bytes(&bytes)
}

fn parse_batch_bytes(bytes: &[u8]) -> Option<Batch> {
    if bytes.len() > MAX_BATCH_BYTES {
        return None;
    }
    let batch: Batch = serde_json::from_slice(bytes).ok()?;
    (situate_core::diagnostics::valid_uuid(&batch.producer) && admitted_batch(&batch.events))
        .then_some(batch)
}

fn admitted_batch(events: &[EventInput]) -> bool {
    events.len() <= MAX_BATCH_EVENTS && events.iter().all(EventInput::is_valid)
}

#[tauri::command]
pub async fn diagnostics_emit(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<Admission, ()> {
    #[cfg(feature = "native-smoke")]
    smoke::BATCH_COUNT.fetch_add(1, Ordering::Relaxed);
    let batch = parse_batch(request.body()).ok_or(())?;
    Ok(admit_events(&app, window.label(), batch))
}

fn admit_events(app: &tauri::AppHandle, window: &str, batch: Batch) -> Admission {
    let Batch { producer, events } = batch;
    let rejected = Admission {
        accepted: 0,
        dropped: events.len(),
    };
    let Some(state) = app.try_state::<Diagnostics>() else {
        return rejected;
    };
    if state.stopping.load(Ordering::Acquire) {
        return rejected;
    }
    let Ok(runtime) = state.runtime.try_lock() else {
        return rejected;
    };
    let Some(runtime) = runtime.as_ref() else {
        return rejected;
    };
    let Some(registration) = runtime.producers.get(&producer) else {
        return rejected;
    };
    let current = registration.scope.as_ref().and_then(|scope| {
        crate::workspaces::diagnostic_session(app, window, &scope.handle)
            .map(|(_, session)| session)
    });
    if !owns(registration, window, current.as_ref()) {
        return rejected;
    }
    let count = events.len();
    let accepted = events
        .into_iter()
        .map(|event| usize::from(registration.producer.emit(event)))
        .sum();
    Admission {
        accepted,
        dropped: count - accepted,
    }
}

#[tauri::command]
pub async fn diagnostics_release(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    producer: String,
) {
    if producer.len() != 36 {
        return;
    }
    let Some(state) = app.try_state::<Diagnostics>() else {
        return;
    };
    let mut runtime = state.runtime.lock().await;
    let Some(runtime) = runtime.as_mut() else {
        return;
    };
    if runtime
        .producers
        .get(&producer)
        .is_some_and(|item| item.window == window.label())
    {
        runtime.producers.remove(&producer);
    }
}

pub fn forget_window(app: &tauri::AppHandle, window: &str) {
    let app = app.clone();
    let window = window.to_owned();
    let cutoff = Instant::now();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<Diagnostics>() else {
            return;
        };
        let mut runtime = state.runtime.lock().await;
        if let Some(runtime) = runtime.as_mut() {
            runtime
                .producers
                .retain(|_, item| item.window != window || item.created > cutoff);
        }
    });
}

#[cfg(target_os = "macos")]
pub(crate) fn application_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    mut event: EventInput,
) {
    if let Some(state) = app.try_state::<Diagnostics>()
        && !state.stopping.load(Ordering::Acquire)
        && let Ok(mut runtime) = state.runtime.try_lock()
        && let Some(runtime) = runtime.as_mut()
    {
        event.sequence = runtime.application_sequence;
        runtime.application_sequence = runtime
            .application_sequence
            .saturating_add(1)
            .min(9_007_199_254_740_991);
        runtime.application.emit(event);
    }
}

pub fn workspace_event(app: &tauri::AppHandle, workspace_id: Option<&str>, opened: bool) {
    let Some(workspace_id) = workspace_id else {
        return;
    };
    let Some(state) = app.try_state::<Diagnostics>() else {
        return;
    };
    let Ok(runtime) = state.runtime.try_lock() else {
        return;
    };
    let Some(runtime) = runtime.as_ref() else {
        return;
    };
    let Some(producer) = runtime.collector.producer(BoundContext {
        origin: Origin::Native,
        workspace_id: Some(workspace_id.to_owned()),
    }) else {
        return;
    };
    producer.emit(event(
        if opened {
            "workspace.opened"
        } else {
            "workspace.closed"
        },
        "workspace",
        Level::Info,
        0,
        None,
        Map::new(),
    ));
}

pub fn shutdown(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<Diagnostics>() else {
        return;
    };
    state.stopping.store(true, Ordering::Release);
    if let Ok(mut runtime) = state.runtime.try_lock()
        && let Some(runtime) = runtime.take()
    {
        runtime.application.emit(event(
            "app.stopping",
            "app",
            Level::Info,
            runtime.application_sequence,
            None,
            Map::new(),
        ));
        runtime.collector.shutdown(Duration::from_secs(1));
    }
}

fn event(
    name: &str,
    category: &str,
    level: Level,
    sequence: u64,
    context: Option<OperationContext>,
    attributes: Map<String, Value>,
) -> EventInput {
    EventInput {
        schema_version: 1,
        event: name.into(),
        level,
        category: category.into(),
        sequence,
        context,
        attributes,
        timestamp_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(9_007_199_254_740_991) as u64,
    }
}

pub(crate) fn observe_command<T>(
    app: &tauri::AppHandle,
    result: tauri::Result<Result<T, String>>,
) -> tauri::Result<Result<T, String>> {
    if let Some(code) = command_failure_code(&result) {
        runtime_failure(app, "command", code);
    }
    result
}

fn command_failure_code<T>(result: &tauri::Result<Result<T, String>>) -> Option<&'static str> {
    match result {
        Err(tauri::Error::JoinError(error)) if error.is_panic() => Some("panic"),
        Err(_) => Some("interrupted"),
        Ok(Err(error))
            if matches!(
                error.as_str(),
                "native.appearance.storage"
                    | "native.localization.storage"
                    | "native.layout.storage.failed"
            ) =>
        {
            Some("io")
        }
        _ => None,
    }
}

pub(crate) fn runtime_failure(app: &tauri::AppHandle, boundary: &'static str, code: &'static str) {
    let Some(state) = app.try_state::<Diagnostics>() else {
        return;
    };
    if state.stopping.load(Ordering::Acquire) {
        return;
    }
    let Ok(runtime) = state.runtime.try_lock() else {
        return;
    };
    let Some(producer) = runtime.as_ref().and_then(|runtime| {
        runtime.collector.producer(BoundContext {
            origin: Origin::Native,
            workspace_id: None,
        })
    }) else {
        return;
    };
    producer.emit(runtime_failure_event(boundary, code));
}

fn runtime_failure_event(boundary: &'static str, code: &'static str) -> EventInput {
    event(
        "runtime.failed",
        "app",
        if code == "interrupted" {
            Level::Warn
        } else {
            Level::Error
        },
        0,
        None,
        Map::from_iter([
            ("boundary".into(), json!(boundary)),
            ("error_code".into(), json!(code)),
        ]),
    )
}

pub fn parse_context(value: Value) -> Option<OperationContext> {
    let fields = value.as_object()?;
    if fields.len() > 4
        || fields
            .values()
            .any(|value| value.as_str().is_none_or(|s| s.len() > 36))
    {
        return None;
    }
    let context: OperationContext = serde_json::from_value(value).ok()?;
    (situate_core::diagnostics::valid_uuid(&context.trace_id)
        && situate_core::diagnostics::valid_uuid(&context.span_id)
        && context
            .parent_span_id
            .as_ref()
            .is_none_or(|id| situate_core::diagnostics::valid_uuid(id))
        && matches!(context.initiator.as_str(), "user" | "agent" | "background"))
    .then_some(context)
}

pub enum OperationKind {
    File(&'static str),
    Model,
    OpenAiLogin,
    CodexLogin,
    Tool { shell: bool },
}
impl OperationKind {
    fn fields(&self) -> (&'static str, &'static str, &'static str, &'static str) {
        match self {
            Self::File(action) => ("storage", action, "files", "user"),
            Self::Model => ("model", "request", "model", "agent"),
            Self::OpenAiLogin => ("model", "connect", "openai_login", "user"),
            Self::CodexLogin => ("model", "connect", "codex_login", "user"),
            Self::Tool { shell } => (
                "tool",
                "execute",
                if *shell { "shell" } else { "tool" },
                "agent",
            ),
        }
    }
}

const TASK_INTERRUPTED: u8 = 1;
const TASK_PANICKED: u8 = 2;

pub struct Operation {
    producer: Producer,
    context: OperationContext,
    kind: OperationKind,
    started: Instant,
    sequence: AtomicU64,
    task_failure: AtomicU8,
    finished: bool,
}
impl Operation {
    pub fn begin(
        app: &tauri::AppHandle,
        window: &str,
        scope: &str,
        kind: OperationKind,
        parent: Option<OperationContext>,
    ) -> Option<Self> {
        let (workspace_id, _) = crate::workspaces::diagnostic_session(app, window, scope)?;
        let state = app.try_state::<Diagnostics>()?;
        if state.stopping.load(Ordering::Acquire) {
            return None;
        }
        let runtime = state.runtime.try_lock().ok()?;
        let producer = runtime.as_ref()?.collector.producer(BoundContext {
            origin: Origin::Native,
            workspace_id: Some(workspace_id),
        })?;
        Some(Self::with_producer(producer, kind, parent))
    }
    pub(crate) fn with_producer(
        producer: Producer,
        kind: OperationKind,
        parent: Option<OperationContext>,
    ) -> Self {
        let context = OperationContext {
            trace_id: parent
                .as_ref()
                .map_or_else(|| Uuid::new_v4().to_string(), |c| c.trace_id.clone()),
            span_id: Uuid::new_v4().to_string(),
            parent_span_id: parent.as_ref().map(|c| c.span_id.clone()),
            initiator: parent
                .as_ref()
                .map_or_else(|| kind.fields().3.into(), |c| c.initiator.clone()),
        };
        let operation = Self {
            producer,
            context,
            kind,
            started: Instant::now(),
            sequence: AtomicU64::new(0),
            task_failure: AtomicU8::new(0),
            finished: false,
        };
        operation.record("operation.started", "success", None, Map::new());
        operation
    }
    pub(crate) fn observe_join<T>(&self, result: &tauri::Result<T>) {
        if let Err(tauri::Error::JoinError(error)) = result {
            // Cancellation can win the UI result before a drained worker's panic is observed.
            self.task_failure.fetch_max(
                if error.is_panic() {
                    TASK_PANICKED
                } else {
                    TASK_INTERRUPTED
                },
                Ordering::Relaxed,
            );
        }
    }
    pub fn checkpoint(
        &self,
        stage: &'static str,
        error: Option<&'static str>,
        status: Option<u16>,
    ) {
        let mut attributes = Map::from_iter([("stage".into(), json!(stage))]);
        if let Some(status) = status {
            attributes.insert("http_status".into(), json!(status));
        }
        self.record(
            "operation.progress",
            if error.is_some() {
                "failure"
            } else {
                "success"
            },
            error,
            attributes,
        );
    }
    pub(crate) fn model_response(
        &self,
        stage: &'static str,
        error: Option<&'static str>,
        status: Option<u16>,
        bytes: u64,
        idle_ms: f64,
    ) {
        let mut attributes = Map::from_iter([
            ("stage".into(), json!(stage)),
            ("bytes".into(), json!(bytes)),
            ("idle_ms".into(), json!(idle_ms.min(86_400_000.0))),
        ]);
        if let Some(status) = status {
            attributes.insert("http_status".into(), json!(status));
        }
        self.record(
            "operation.progress",
            if error == Some("cancelled") {
                "cancelled"
            } else if error.is_some() {
                "failure"
            } else {
                "success"
            },
            error,
            attributes,
        );
    }
    fn record(
        &self,
        name: &str,
        outcome: &str,
        error: Option<&str>,
        mut attributes: Map<String, Value>,
    ) {
        let (outcome, error) = match (name, self.task_failure.load(Ordering::Relaxed)) {
            ("operation.finished", TASK_PANICKED) => ("failure", Some("panic")),
            ("operation.finished", TASK_INTERRUPTED) if error != Some("panic") => {
                ("interrupted", Some("interrupted"))
            }
            _ => (outcome, error),
        };
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let (category, action, component, _) = self.kind.fields();
        attributes.insert("action".into(), json!(action));
        attributes.insert("component".into(), json!(component));
        if name == "operation.finished" || error.is_some() {
            attributes.insert("outcome".into(), json!(outcome));
        }
        if sequence != 0 {
            attributes.insert(
                "duration_ms".into(),
                json!((self.started.elapsed().as_secs_f64() * 1000.0).min(86_400_000.0)),
            );
        }
        if let Some(error) = error {
            attributes.insert("error_code".into(), json!(error));
        }
        self.producer.emit(event(
            name,
            category,
            if outcome == "failure" {
                Level::Error
            } else if outcome == "interrupted" || (error.is_some() && outcome != "cancelled") {
                Level::Warn
            } else if name == "operation.progress" {
                Level::Debug
            } else {
                Level::Info
            },
            sequence,
            Some(self.context.clone()),
            attributes,
        ));
    }
    pub fn result<T>(self, result: &Result<T, String>) {
        match result {
            Ok(_) => self.finish("success", None),
            Err(error)
                if matches!(
                    error.as_str(),
                    "native.ai.response.stopped"
                        | "native.ai.response.stoppedBilling"
                        | "native.ai.login.cancelled"
                ) =>
            {
                self.finish("cancelled", Some("cancelled"))
            }
            Err(error) if error == "native.ai.login.timeout" => {
                self.finish("failure", Some("timeout"))
            }
            Err(error) if error == "native.ai.login.denied" => {
                self.finish("failure", Some("permission_denied"))
            }
            Err(error)
                if error.starts_with("native.ai.request.")
                    || error.starts_with("native.ai.response.")
                    || error == "native.ai.access.rejected" =>
            {
                self.finish("failure", Some(crate::ai::model_error_code(error)))
            }
            Err(_) => self.finish("failure", Some("unknown")),
        }
    }
    pub fn finish(mut self, outcome: &str, error: Option<&str>) {
        self.record("operation.finished", outcome, error, Map::new());
        self.finished = true;
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        if !self.finished {
            let (outcome, error) = if std::thread::panicking() {
                ("failure", "panic")
            } else {
                ("interrupted", "interrupted")
            };
            self.record("operation.finished", outcome, Some(error), Map::new());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_failures_admit_only_known_operational_errors() {
        for error in [
            "native.appearance.storage",
            "native.localization.storage",
            "native.layout.storage.failed",
        ] {
            let result = Ok(Err::<(), _>(error.into()));
            assert_eq!(command_failure_code(&result), Some("io"));
        }
        for error in [
            "native.appearance.invalid",
            "native.localization.readOnly",
            "native.layout.conflict",
            "PRIVATE_PROVIDER_ERROR_SENTINEL",
        ] {
            assert_eq!(command_failure_code(&Ok(Err::<(), _>(error.into()))), None);
        }
        assert_eq!(command_failure_code(&Ok(Ok(()))), None);
        let event = runtime_failure_event("command", "io");
        assert!(event.is_valid());
        assert_eq!(event.level, Level::Error);
        assert_eq!(
            event.attributes,
            Map::from_iter([
                ("boundary".into(), json!("command")),
                ("error_code".into(), json!("io"))
            ])
        );
        assert!(event.context.is_none());
    }

    #[tokio::test]
    async fn command_join_cancellation_is_interrupted_not_normal_cancellation() {
        let task = tokio::spawn(std::future::pending::<()>());
        task.abort();
        let error = task.await.unwrap_err();
        assert!(error.is_cancelled());
        let result: tauri::Result<Result<(), String>> = Err(error.into());
        assert_eq!(command_failure_code(&result), Some("interrupted"));
        assert_eq!(
            runtime_failure_event("command", "interrupted").level,
            Level::Warn
        );
    }

    #[test]
    fn batch_rejects_private_content_and_excessive_input() {
        let safe = event(
            "ui.action",
            "ui",
            Level::Debug,
            0,
            None,
            Map::from_iter([("action".into(), json!("save"))]),
        );
        assert!(admitted_batch(std::slice::from_ref(&safe)));
        assert!(!admitted_batch(&vec![safe.clone(); MAX_BATCH_EVENTS + 1]));
        let mut unsafe_event = safe;
        unsafe_event
            .attributes
            .insert("message".into(), json!("PRIVATE_SENTINEL"));
        assert!(!admitted_batch(&[unsafe_event]));
    }

    #[test]
    fn raw_ingress_bounds_bytes_before_event_deserialization() {
        use tauri::ipc::InvokeBody;
        assert!(parse_batch(&InvokeBody::Raw(vec![b' '; MAX_BATCH_BYTES + 1])).is_none());
        assert!(
            parse_batch(&InvokeBody::Json(
                json!({"producer": Uuid::new_v4().to_string(), "events":[]})
            ))
            .is_none()
        );
        let batch = json!({"producer":"11111111-1111-4111-8111-111111111111", "events":[{
            "schema_version":1, "event":"ui.action", "level":"trace", "category":"ui", "timestamp_ms":0, "sequence":0, "attributes":{"action":"save"}
        }]});
        assert!(parse_batch(&InvokeBody::Raw(serde_json::to_vec(&batch).unwrap())).is_some());
        let mut unsafe_batch = batch;
        unsafe_batch["events"][0]["attributes"]["secret"] = json!("PRIVATE_SENTINEL");
        assert!(
            parse_batch(&InvokeBody::Raw(serde_json::to_vec(&unsafe_batch).unwrap())).is_none()
        );
    }

    const SAFE_BATCH: &[u8] = br#"{"producer":"11111111-1111-4111-8111-111111111111","events":[{"schema_version":1,"event":"ui.action","level":"trace","category":"ui","timestamp_ms":0,"sequence":0,"attributes":{"action":"save"}}]}"#;

    #[test]
    fn android_byte_envelope_preserves_the_batch_and_is_platform_specific() {
        let envelope = json!(SAFE_BATCH);
        let batch = parse_android_batch(&envelope).unwrap();
        assert_eq!(batch.producer, "11111111-1111-4111-8111-111111111111");
        assert_eq!(batch.events.len(), 1);
        assert_eq!(batch.events[0].event, "ui.action");
        assert_eq!(batch.events[0].attributes["action"], "save");
        assert_eq!(
            parse_batch(&tauri::ipc::InvokeBody::Json(envelope)).is_some(),
            cfg!(target_os = "android")
        );
    }

    #[test]
    fn both_transports_enforce_the_exact_decoded_byte_limit() {
        let mut bytes = SAFE_BATCH.to_vec();
        bytes.resize(MAX_BATCH_BYTES, b' ');
        assert!(parse_android_batch(&json!(&bytes)).is_some());
        assert!(parse_batch(&tauri::ipc::InvokeBody::Raw(bytes.clone())).is_some());
        bytes.push(b' ');
        assert!(parse_android_batch(&json!(&bytes)).is_none());
        assert!(parse_batch(&tauri::ipc::InvokeBody::Raw(bytes)).is_none());
    }

    #[test]
    fn android_envelope_rejects_non_bytes_and_other_json_shapes() {
        for invalid in [
            json!(-1),
            json!(256),
            json!(32.0),
            json!(288),
            json!(-224),
            json!(null),
            json!(true),
            json!("32"),
            json!([123]),
            json!({"byte":123}),
        ] {
            let mut bytes = json!(SAFE_BATCH);
            bytes.as_array_mut().unwrap().push(invalid);
            assert!(parse_android_batch(&bytes).is_none());
        }
        for invalid in [
            json!(null),
            json!({"0":123}),
            json!("[]"),
            json!([]),
            serde_json::from_slice(SAFE_BATCH).unwrap(),
        ] {
            assert!(parse_android_batch(&invalid).is_none());
        }
    }

    #[test]
    fn android_envelope_retains_event_validation_and_duplicate_rejection() {
        let safe: Value = serde_json::from_slice(SAFE_BATCH).unwrap();
        let mut private = safe.clone();
        private["events"][0]["attributes"]["message"] = json!("PRIVATE_SENTINEL");
        let mut excessive = safe.clone();
        excessive["events"] = json!(vec![safe["events"][0].clone(); MAX_BATCH_EVENTS + 1]);
        let mut invalid_producer = safe;
        invalid_producer["producer"] = json!("not-a-producer");
        for invalid in [private, excessive, invalid_producer] {
            let bytes = serde_json::to_vec(&invalid).unwrap();
            assert!(parse_android_batch(&json!(&bytes)).is_none());
            assert!(parse_batch(&tauri::ipc::InvokeBody::Raw(bytes)).is_none());
        }
        for invalid in [
            &b"\xff"[..],
            &b"{"[..],
            &br#"{"producer":"11111111-1111-4111-8111-111111111111","producer":"11111111-1111-4111-8111-111111111111","events":[]}"#[..],
        ] {
            assert!(parse_android_batch(&json!(invalid)).is_none());
            assert!(parse_batch(&tauri::ipc::InvokeBody::Raw(invalid.to_vec())).is_none());
        }
    }

    #[test]
    fn causal_context_rejects_unknown_fields_and_private_values() {
        let context = json!({"trace_id":"11111111-1111-4111-8111-111111111111", "span_id":"22222222-2222-4222-8222-222222222222", "initiator":"user"});
        assert!(parse_context(context.clone()).is_some());
        let mut private = context.clone();
        private["message"] = json!("PRIVATE_SENTINEL");
        assert!(parse_context(private).is_none());
        let mut invalid = context;
        invalid["span_id"] = json!("PRIVATE_SENTINEL");
        assert!(parse_context(invalid).is_none());
        assert!(parse_context(json!({"trace_id": {"nested":"PRIVATE_SENTINEL"}})).is_none());
    }

    #[test]
    fn registrations_are_bound_to_window_and_session_generation() {
        let collector = Collector::with_destinations(
            HostIdentity {
                device_id: Uuid::new_v4().to_string(),
                session_id: Uuid::new_v4().to_string(),
                app_version: "0.0.1".into(),
                platform: "test".into(),
                platform_version: "1".into(),
            },
            vec![],
        )
        .unwrap();
        let producer = collector
            .producer(BoundContext {
                origin: Origin::Frontend,
                workspace_id: None,
            })
            .unwrap();
        let session = Arc::new(crate::files::Session::default());
        let registered = Registered {
            created: Instant::now(),
            window: "workspace-1".into(),
            producer,
            scope: Some(Scope {
                handle: "synthetic-location".into(),
                generation: Arc::downgrade(&session),
            }),
        };
        assert!(owns(&registered, "workspace-1", Some(&session)));
        assert!(!owns(&registered, "workspace-2", Some(&session)));
        assert!(!owns(&registered, "workspace-1", None));
        let reopened = Arc::new(crate::files::Session::default());
        assert!(!owns(&registered, "workspace-1", Some(&reopened)));
        session.detached.store(true, Ordering::Release);
        assert!(!owns(&registered, "workspace-1", Some(&session)));
        assert!(collector.shutdown(Duration::from_secs(1)));
    }

    #[test]
    fn kernel_version_does_not_retain_custom_release_names() {
        assert_eq!(numeric_version("6.15.0-private-host"), "6.15.0");
        assert_eq!(numeric_version("PRIVATE_SENTINEL"), "unknown");
        assert!(numeric_version(&"1".repeat(100)).len() <= 32);
    }
}
