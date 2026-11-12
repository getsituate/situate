mod capture;
pub use capture::CaptureRect;
mod document;
#[cfg(target_os = "ios")]
mod ios;
#[cfg(target_os = "ios")]
pub use ios::capture;
mod lifecycle;
#[cfg(target_os = "macos")]
mod macos;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};
use tauri::{
    AppHandle, Manager, Wry,
    plugin::{Builder, TauriPlugin},
};
use tokio::sync::oneshot;

const DISPATCH_DEADLINE: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentKind {
    Supervisor,
    Preview,
}

#[derive(Clone)]
pub struct OpenRequest {
    pub workspace_generation: String,
    /// Bundled document bootstrap; plugin services must execute in Workers.
    pub supervisor_source: String,
    pub document_kind: DocumentKind,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LossReason {
    Closed,
    HeartbeatExpired,
    BootstrapFailed,
    ProcessTerminated,
    Navigation,
    Backgrounded,
    TransportFailed,
    ApplicationExit,
}

#[derive(Clone, Debug)]
pub enum ExecutorEvent {
    Message {
        workspace_generation: String,
        payload: Value,
    },
    Lost {
        workspace_generation: String,
        reason: LossReason,
    },
    Stopped {
        workspace_generation: String,
    },
}

/// Callbacks are serialized per executor and must enqueue work without blocking or reentering it.
pub type EventCallback = Arc<dyn Fn(ExecutorEvent) + Send + Sync>;

type Ready = oneshot::Sender<Result<(), String>>;
struct Session {
    id: String,
    generation: String,
    document: String,
    document_kind: DocumentKind,
    lifecycle: Mutex<lifecycle::Lifecycle>,
    ready: Mutex<Option<Ready>>,
    callback: EventCallback,
    callback_gate: Mutex<()>,
    shutdown: tokio::sync::Mutex<()>,
    stopped: tokio::sync::watch::Sender<bool>,
    #[cfg(target_os = "macos")]
    created: std::sync::atomic::AtomicBool,
}

#[derive(Default)]
struct Sessions(Mutex<HashMap<String, Arc<Session>>>);

#[derive(Clone)]
pub struct Executor {
    app: AppHandle<Wry>,
}

#[derive(Clone)]
pub struct ExecutorHandle {
    app: AppHandle<Wry>,
    session: Arc<Session>,
}

impl Executor {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }

    /// Native-created macOS executor windows still owned by the platform, including during close.
    /// iOS executors are not Tauri windows.
    pub fn supervisor_window_labels(&self) -> Vec<String> {
        #[cfg(target_os = "macos")]
        {
            self.app
                .state::<Sessions>()
                .0
                .lock()
                .unwrap()
                .values()
                .filter(|session| session.created.load(Ordering::Acquire))
                .map(|session| session.id.clone())
                .collect()
        }
        #[cfg(not(target_os = "macos"))]
        Vec::new()
    }

    /// Retries native teardown even when opening failed before returning a handle.
    /// An absent generation is already stopped; native close failures remain retryable.
    pub async fn close_generation(&self, workspace_generation: &str) -> Result<(), String> {
        let session = self
            .app
            .state::<Sessions>()
            .0
            .lock()
            .unwrap()
            .values()
            .find(|session| session.generation == workspace_generation)
            .cloned();
        if let Some(session) = session {
            ExecutorHandle {
                app: self.app.clone(),
                session,
            }
            .close()
            .await?;
        }
        Ok(())
    }

    /// Returns after the bundled document loads. One executor may be open per workspace generation.
    /// Dropping a handle does not stop execution; workspace closure must await `close`.
    pub async fn open(
        &self,
        request: OpenRequest,
        callback: EventCallback,
    ) -> Result<ExecutorHandle, String> {
        if request.workspace_generation.is_empty() || request.workspace_generation.len() > 256 {
            return Err("executor.invalidGeneration".into());
        }
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let id = format!("executor-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let html = document::document(
            &request.supervisor_source,
            platform_bridge(),
            request.document_kind,
        )?;
        let (tx, rx) = oneshot::channel();
        let session = Arc::new(Session {
            id: id.clone(),
            generation: request.workspace_generation,
            document: html,
            document_kind: request.document_kind,
            lifecycle: Mutex::new(lifecycle::Lifecycle::new(Instant::now())),
            ready: Mutex::new(Some(tx)),
            callback,
            callback_gate: Mutex::new(()),
            shutdown: tokio::sync::Mutex::new(()),
            stopped: tokio::sync::watch::channel(false).0,
            #[cfg(target_os = "macos")]
            created: std::sync::atomic::AtomicBool::new(false),
        });
        {
            let state = self.app.state::<Sessions>();
            let mut sessions = state.0.lock().unwrap();
            if sessions
                .values()
                .any(|s| s.generation == session.generation)
            {
                return Err("executor.alreadyOpen".into());
            }
            sessions.insert(id.clone(), session.clone());
        }
        let handle = ExecutorHandle {
            app: self.app.clone(),
            session,
        };
        start_watchdog(&handle);
        let opened = tokio::time::timeout(DISPATCH_DEADLINE, platform_open(&handle))
            .await
            .unwrap_or_else(|_| Err("executor.openTimeout".into()));
        if let Err(error) = opened {
            let _ = terminate(handle.clone(), LossReason::BootstrapFailed).await;
            return Err(error);
        }
        rx.await.map_err(|_| "executor.openFailed".to_string())??;
        Ok(handle)
    }
}

impl ExecutorHandle {
    pub fn workspace_generation(&self) -> &str {
        &self.session.generation
    }

    /// Delivery is not execution acknowledgement. The broker must retain and correlate replies.
    pub async fn send(&self, payload: Value) -> Result<(), String> {
        if self.session.lifecycle.lock().unwrap().is_closed() {
            return Err("executor.closed".into());
        }
        let script = document::delivery(&payload)?;
        let delivered = tokio::time::timeout(DISPATCH_DEADLINE, platform_send(self, script))
            .await
            .unwrap_or_else(|_| Err("executor.sendTimeout".into()));
        if let Err(error) = delivered {
            terminate(self.clone(), LossReason::TransportFailed).await?;
            return Err(error);
        }
        Ok(())
    }

    /// Captures only this executor's native view; closure fences pending replies.
    /// Callers own authorization and must recheck admission after awaiting.
    /// Timeout fences the reply, not WebKit's internal snapshot completion.
    pub async fn capture(&self, rect: CaptureRect) -> Result<String, String> {
        rect.validate()?;
        if self.session.lifecycle.lock().unwrap().is_closed() {
            return Err("executor.closed".into());
        }
        #[cfg(target_os = "macos")]
        let result = {
            let window = self
                .app
                .get_webview_window(&self.session.id)
                .ok_or("executor.closed")?;
            capture::macos::capture(&window, rect, self.session.clone()).await
        };
        #[cfg(target_os = "ios")]
        let result = ios::capture_executor(self, rect).await;
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        let result = Err("executor.platformUnavailable".into());
        if self.session.lifecycle.lock().unwrap().is_closed() {
            return Err("executor.closed".into());
        }
        result
    }

    /// Revokes admission before destroying the native view. `Lost` fires once, including explicit close.
    /// `Stopped` follows successful native destruction; failure must not be treated as termination.
    /// This does not settle host operations already admitted by the broker.
    pub async fn close(&self) -> Result<(), String> {
        terminate(self.clone(), LossReason::Closed).await
    }

    fn lose(&self, reason: LossReason) {
        let _gate = self.session.callback_gate.lock().unwrap();
        if !self.session.lifecycle.lock().unwrap().close() {
            return;
        }
        if let Some(ready) = self.session.ready.lock().unwrap().take() {
            let _ = ready.send(Err("executor.lostDuringOpen".into()));
        }
        (self.session.callback)(ExecutorEvent::Lost {
            workspace_generation: self.session.generation.clone(),
            reason,
        });
    }

    fn stopped(&self) {
        let _gate = self.session.callback_gate.lock().unwrap();
        if *self.session.stopped.borrow() {
            return;
        }
        self.app
            .state::<Sessions>()
            .0
            .lock()
            .unwrap()
            .remove(&self.session.id);
        self.session.stopped.send_replace(true);
        (self.session.callback)(ExecutorEvent::Stopped {
            workspace_generation: self.session.generation.clone(),
        });
    }

    fn event(&self, value: Value) {
        if self.session.lifecycle.lock().unwrap().is_closed() {
            return;
        }
        match value.get("kind").and_then(Value::as_str) {
            Some("heartbeat") => self
                .session
                .lifecycle
                .lock()
                .unwrap()
                .heartbeat(Instant::now()),
            Some("ready") => {
                self.session.lifecycle.lock().unwrap().ready();
                if let Some(ready) = self.session.ready.lock().unwrap().take() {
                    let _ = ready.send(Ok(()));
                }
            }
            Some("message") => {
                let _gate = self.session.callback_gate.lock().unwrap();
                if self.session.lifecycle.lock().unwrap().is_closed() {
                    return;
                }
                if let Some(payload) = value.get("payload") {
                    (self.session.callback)(ExecutorEvent::Message {
                        workspace_generation: self.session.generation.clone(),
                        payload: payload.clone(),
                    });
                }
            }
            Some("lost") => {
                let reason = value
                    .get("reason")
                    .cloned()
                    .and_then(|v| serde_json::from_value(v).ok())
                    .unwrap_or(LossReason::TransportFailed);
                let handle = self.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = terminate(handle, reason).await;
                });
            }
            _ => {}
        }
    }
}

async fn terminate(handle: ExecutorHandle, reason: LossReason) -> Result<(), String> {
    handle.lose(reason);
    let _shutdown = handle.session.shutdown.lock().await;
    if *handle.session.stopped.borrow() {
        return Ok(());
    }
    tokio::time::timeout(DISPATCH_DEADLINE, platform_close(&handle))
        .await
        .map_err(|_| "executor.closeTimeout")??;
    handle.stopped();
    Ok(())
}

fn start_watchdog(handle: &ExecutorHandle) {
    let session = Arc::downgrade(&handle.session);
    let app = handle.app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let Some(session) = session.upgrade() else {
                return;
            };
            let state = session.lifecycle.lock().unwrap();
            if state.is_closed() {
                return;
            }
            let expired = state.expired(Instant::now());
            drop(state);
            if expired {
                tauri::async_runtime::spawn(async move {
                    let _ = terminate(
                        ExecutorHandle { app, session },
                        LossReason::HeartbeatExpired,
                    )
                    .await;
                });
                return;
            }
        }
    });
}

#[cfg(target_os = "ios")]
use ios::{
    bridge as platform_bridge, close as platform_close, open as platform_open,
    send as platform_send,
};
#[cfg(target_os = "macos")]
use macos::{
    bridge as platform_bridge, close as platform_close, open as platform_open,
    send as platform_send,
};

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn platform_bridge() -> &'static str {
    "()=>{}"
}
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn platform_open(_: &ExecutorHandle) -> Result<(), String> {
    Err("executor.platformUnavailable".into())
}
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn platform_send(_: &ExecutorHandle, _: String) -> Result<(), String> {
    Err("executor.platformUnavailable".into())
}
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn platform_close(_: &ExecutorHandle) -> Result<(), String> {
    Ok(())
}

pub fn init() -> TauriPlugin<Wry> {
    let builder = Builder::new("executor-platform")
        .setup(|app, _api| {
            app.manage(Sessions::default());
            #[cfg(target_os = "macos")]
            macos::setup(app)?;
            #[cfg(target_os = "ios")]
            ios::setup(app, _api)?;
            Ok(())
        })
        .on_event(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let sessions: Vec<_> = app
                    .state::<Sessions>()
                    .0
                    .lock()
                    .unwrap()
                    .values()
                    .cloned()
                    .collect();
                for session in sessions {
                    (ExecutorHandle {
                        app: app.clone(),
                        session,
                    })
                    .lose(LossReason::ApplicationExit);
                }
            }
        });
    #[cfg(target_os = "macos")]
    let builder = macos::configure(builder);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(|invoke| {
        invoke.resolver.reject("executor.nativeOnly");
        true
    });
    builder.build()
}
