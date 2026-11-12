use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_executor_platform::{
    DocumentKind, Executor, ExecutorEvent, ExecutorHandle, OpenRequest,
};
use tokio::sync::{oneshot, watch};
use tokio_util::sync::CancellationToken;

const UNAVAILABLE: &str = "native.plugins.captureUnavailable";
const CANCELLED: &str = "plugins.executionCancelled";
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REPLY: usize = 32 * 1024 * 1024;

type Identity = (u64, String);
type Ready = Option<Result<Arc<ExecutorHandle>, String>>;
type CloseReceiver = watch::Receiver<Option<Result<(), String>>>;
struct Pending {
    renderer: String,
    identity: Identity,
    sender: oneshot::Sender<Result<Value, String>>,
}
#[derive(Clone)]
struct Presentation {
    window: String,
    scope: String,
    renderer: String,
    ready: watch::Sender<Ready>,
    capture: Arc<tokio::sync::Mutex<()>>,
}
struct Closing {
    owned: Presentation,
    result: watch::Sender<Option<Result<(), String>>>,
}
impl Closing {
    fn retry_failed_close(&self) -> bool {
        self.result.send_if_modified(|result| {
            if matches!(result, Some(Err(_))) {
                *result = None;
                true
            } else {
                false
            }
        })
    }
}
#[derive(Default)]
struct State {
    pending: HashMap<String, Pending>,
    presentations: HashMap<Identity, Presentation>,
    closing: HashMap<Identity, Closing>,
}
#[derive(Default)]
pub struct Renderers(Mutex<State>);

struct RequestGuard {
    app: tauri::AppHandle,
    request_id: String,
    identity: Identity,
    completed: bool,
}
impl Drop for RequestGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.app.state::<Renderers>().0.lock() {
            state.pending.remove(&self.request_id);
        }
        if !self.completed {
            forget_invocation(&self.app, self.identity.0, &self.identity.1);
        }
    }
}

fn take_reply(
    state: &mut State,
    renderer: &str,
    generation: u64,
    invocation_id: &str,
    request_id: &str,
) -> Result<Pending, String> {
    let pending = state.pending.get(request_id).ok_or(UNAVAILABLE)?;
    if pending.renderer != renderer || pending.identity != (generation, invocation_id.into()) {
        return Err(UNAVAILABLE.into());
    }
    state.pending.remove(request_id).ok_or(UNAVAILABLE.into())
}

fn presentation(
    state: &State,
    identity: &Identity,
    renderer: &str,
) -> Result<Presentation, String> {
    state
        .presentations
        .get(identity)
        .filter(|p| p.renderer == renderer)
        .cloned()
        .ok_or(UNAVAILABLE.into())
}

async fn message(
    app: tauri::AppHandle,
    identity: Identity,
    renderer: String,
    payload: Value,
) -> Result<(), String> {
    if serde_json::to_vec(&payload).map_err(|_| UNAVAILABLE)?.len() > MAX_REPLY
        || payload.get("generation").and_then(Value::as_u64) != Some(identity.0)
        || payload.get("invocationId").and_then(Value::as_str) != Some(&identity.1)
    {
        return Err(UNAVAILABLE.into());
    }
    let owned = presentation(
        &*app.state::<Renderers>().0.lock().map_err(|_| UNAVAILABLE)?,
        &identity,
        &renderer,
    )?;
    crate::workspaces::with_open_storage(&app, &owned.window, &owned.scope, |_| Ok(()))?;
    let request_id = payload
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or(UNAVAILABLE)?;
    match payload.get("type").and_then(Value::as_str) {
        Some("reply") => {
            let result = reply_result(
                payload.get("value").cloned(),
                payload
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            )?;
            let pending = take_reply(
                &mut *app.state::<Renderers>().0.lock().map_err(|_| UNAVAILABLE)?,
                &renderer,
                identity.0,
                &identity.1,
                request_id,
            )?;
            pending
                .sender
                .send(result)
                .map_err(|_| UNAVAILABLE.to_owned())?;
        }
        Some("service") => {
            let plugin_id = payload
                .get("dependency")
                .and_then(Value::as_str)
                .or_else(|| payload.get("pluginId").and_then(Value::as_str))
                .ok_or(UNAVAILABLE)?;
            let name = payload
                .get("name")
                .and_then(Value::as_str)
                .ok_or(UNAVAILABLE)?;
            let args = payload.get("args").cloned().ok_or(UNAVAILABLE)?;
            if serde_json::to_vec(&args).map_err(|_| UNAVAILABLE)?.len() > 1024 * 1024 {
                return Err(UNAVAILABLE.into());
            }
            let result = crate::ai_executor::preview_service(
                &app,
                &owned.window,
                identity.0,
                &identity.1,
                plugin_id,
                name,
                args,
            )
            .await;
            presentation(
                &*app.state::<Renderers>().0.lock().map_err(|_| UNAVAILABLE)?,
                &identity,
                &renderer,
            )?;
            let handle = owned
                .ready
                .borrow()
                .as_ref()
                .and_then(|ready| ready.as_ref().ok())
                .cloned()
                .ok_or(UNAVAILABLE)?;
            let reply = match result {
                Ok(value) => json!({"type":"serviceResult","requestId":request_id,"value":value}),
                Err(_) => {
                    json!({"type":"serviceResult","requestId":request_id,"error":UNAVAILABLE})
                }
            };
            handle.send(reply).await.map_err(|_| UNAVAILABLE)?;
        }
        _ => return Err(UNAVAILABLE.into()),
    }
    Ok(())
}

fn renderer_source(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(asset) = app.asset_resolver().get("plugin-check-renderer.js".into()) {
        return String::from_utf8(asset.bytes).map_err(|_| UNAVAILABLE.into());
    }
    #[cfg(debug_assertions)]
    {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../dist/plugin-check-renderer.js");
        std::fs::read_to_string(path).map_err(|_| UNAVAILABLE.into())
    }
    #[cfg(not(debug_assertions))]
    Err(UNAVAILABLE.into())
}

fn open_renderer(app: &tauri::AppHandle, identity: Identity, owned: Presentation) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let target = app.clone();
        let id = identity.clone();
        let renderer = owned.renderer.clone();
        let callback = Arc::new(move |event| {
            let app = target.clone();
            let identity = id.clone();
            let renderer = renderer.clone();
            tauri::async_runtime::spawn(async move {
                match event {
                    ExecutorEvent::Message { payload, .. } => {
                        let _ = message(app, identity, renderer, payload).await;
                    }
                    ExecutorEvent::Lost { .. } => {
                        let current = app
                            .state::<Renderers>()
                            .0
                            .lock()
                            .ok()
                            .and_then(|state| presentation(&state, &identity, &renderer).ok())
                            .is_some();
                        if current {
                            forget_invocation(&app, identity.0, &identity.1);
                        }
                    }
                    ExecutorEvent::Stopped { .. } => {}
                }
            });
        });
        let result = async {
            Executor::new(app.clone())
                .open(
                    OpenRequest {
                        workspace_generation: owned.renderer.clone(),
                        supervisor_source: renderer_source(&app)?,
                        document_kind: DocumentKind::Preview,
                    },
                    callback,
                )
                .await
                .map(Arc::new)
                .map_err(|_| UNAVAILABLE.to_owned())
        }
        .await;
        owned.ready.send_replace(Some(result));
    });
}

fn reply_result(
    value: Option<Value>,
    error: Option<String>,
) -> Result<Result<Value, String>, String> {
    if error.is_some() {
        return Ok(Err(UNAVAILABLE.into()));
    }
    let value = value.ok_or(UNAVAILABLE)?;
    if serde_json::to_vec(&value).map_err(|_| UNAVAILABLE)?.len() > MAX_REPLY {
        return Err(UNAVAILABLE.into());
    }
    Ok(Ok(value))
}

async fn await_reply(
    receiver: oneshot::Receiver<Result<Value, String>>,
    cancel: &CancellationToken,
    timeout: Duration,
) -> Result<Value, String> {
    tokio::select! {
        _ = cancel.cancelled() => Err(CANCELLED.into()),
        result = tokio::time::timeout(timeout, receiver) => result.map_err(|_| UNAVAILABLE.to_owned())?.map_err(|_| UNAVAILABLE.to_owned())?,
    }
}

async fn await_ready<T: Clone>(
    ready: &mut watch::Receiver<Option<Result<T, String>>>,
    cancel: &CancellationToken,
) -> Result<T, String> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(CANCELLED.into()),
        result = tokio::time::timeout(TIMEOUT, ready.wait_for(|value| value.is_some())) => result.map_err(|_| UNAVAILABLE)?.map_err(|_| UNAVAILABLE)?.as_ref().ok_or(UNAVAILABLE)?.clone(),
    }
}

async fn await_capture(
    capture: impl std::future::Future<Output = Result<String, String>>,
    cancel: &CancellationToken,
) -> Result<String, String> {
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    tokio::pin!(capture);
    // Releasing the presentation must wait for completion or a fenced native callback.
    tokio::select! {
        _ = cancel.cancelled() => {let _=capture.await;Err(CANCELLED.into())},
        result=&mut capture => {if cancel.is_cancelled(){Err(CANCELLED.into())}else{result}},
    }
}

pub(crate) async fn executor_request(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    generation: u64,
    invocation_id: &str,
    request: Value,
    cancel: CancellationToken,
) -> Result<Value, String> {
    crate::workspaces::with_open_storage(app, window, scope, |_| Ok(()))?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let operation = request
        .get("operation")
        .and_then(Value::as_str)
        .ok_or(UNAVAILABLE)?;
    if !["previewOpen", "previewStep", "previewClose"].contains(&operation)
        || serde_json::to_vec(&request).map_err(|_| UNAVAILABLE)?.len() > 4 * 1024 * 1024
    {
        return Err(UNAVAILABLE.into());
    }
    let identity = (generation, invocation_id.to_owned());
    let request_id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    let (owned, create) = {
        let state = app.state::<Renderers>();
        let mut locked = state.0.lock().map_err(|_| UNAVAILABLE)?;
        if locked.pending.len() >= 64 {
            return Err(UNAVAILABLE.into());
        }
        let create = operation == "previewOpen" && !locked.presentations.contains_key(&identity);
        if create {
            if locked.presentations.len() + locked.closing.len() >= 16
                || locked.closing.contains_key(&identity)
            {
                return Err(UNAVAILABLE.into());
            }
            locked.presentations.insert(
                identity.clone(),
                Presentation {
                    window: window.into(),
                    scope: scope.into(),
                    renderer: format!("plugin-preview-{}", uuid::Uuid::new_v4()),
                    ready: watch::channel(None).0,
                    capture: Arc::new(tokio::sync::Mutex::new(())),
                },
            );
        }
        let owned = locked
            .presentations
            .get(&identity)
            .filter(|p| p.window == window && p.scope == scope)
            .cloned()
            .ok_or(UNAVAILABLE)?;
        locked.pending.insert(
            request_id.clone(),
            Pending {
                renderer: owned.renderer.clone(),
                identity: identity.clone(),
                sender,
            },
        );
        (owned, create)
    };
    let mut guard = RequestGuard {
        app: app.clone(),
        request_id: request_id.clone(),
        identity: identity.clone(),
        completed: false,
    };
    if create {
        open_renderer(app, identity.clone(), owned.clone());
    }
    let is_capture = operation == "previewStep"
        && request.pointer("/args/action").and_then(Value::as_str) == Some("capture");
    let result = async {
        let mut ready = owned.ready.subscribe();
        let handle = await_ready(&mut ready, &cancel).await?;
        presentation(&*app.state::<Renderers>().0.lock().map_err(|_| UNAVAILABLE)?, &identity, &owned.renderer)?;
        if cancel.is_cancelled() { return Err(CANCELLED.into()); }
        handle.send(json!({"type":"request","request":{"generation":generation,"invocationId":invocation_id,"requestId":request_id,"operation":operation,"args":request.get("args").cloned().unwrap_or_else(||json!({}))}})).await.map_err(|_| UNAVAILABLE)?;
        let value = await_reply(receiver, &cancel, TIMEOUT).await?;
        crate::workspaces::with_open_storage(app, window, scope, |_| Ok(()))?;
        if is_capture {
            let rect = serde_json::from_value(value.get("rect").cloned().ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE)?;
            let _capture = owned.capture.lock().await;
            presentation(&*app.state::<Renderers>().0.lock().map_err(|_| UNAVAILABLE)?, &identity, &owned.renderer)?;
            let captured = await_capture(handle.capture(rect), &cancel).await;
            handle.send(json!({"type":"captureFinished","generation":generation,"invocationId":invocation_id})).await.map_err(|_| UNAVAILABLE)?;
            let data = captured?;
            crate::workspaces::with_open_storage(app, window, scope, |_| Ok(()))?;
            presentation(&*app.state::<Renderers>().0.lock().map_err(|_| UNAVAILABLE)?, &identity, &owned.renderer)?;
            if cancel.is_cancelled() { return Err(CANCELLED.into()); }
            Ok(json!({"data":data,"mimeType":"image/png"}))
        } else { Ok(value) }
    }.await;
    if result.is_err() || operation == "previewClose" {
        let closed = finish_invocation(app, generation, invocation_id).await;
        if result.is_ok() {
            closed?;
        }
    }
    guard.completed = true;
    result
}

fn remove_invocation(
    state: &mut State,
    identity: &Identity,
) -> (Option<Presentation>, Vec<Pending>) {
    let owned = state.presentations.remove(identity);
    let ids: Vec<_> = state
        .pending
        .iter()
        .filter(|(_, p)| &p.identity == identity)
        .map(|(id, _)| id.clone())
        .collect();
    let pending = ids
        .into_iter()
        .filter_map(|id| state.pending.remove(&id))
        .collect();
    (owned, pending)
}

fn release_invocation(
    app: &tauri::AppHandle,
    identity: &Identity,
) -> Result<Option<CloseReceiver>, String> {
    let (owned, result, pending) = {
        let state = app.state::<Renderers>();
        let mut locked = state.0.lock().map_err(|_| UNAVAILABLE)?;
        if let Some(closing) = locked.closing.get(identity) {
            if !closing.retry_failed_close() {
                return Ok(Some(closing.result.subscribe()));
            }
            (closing.owned.clone(), closing.result.clone(), Vec::new())
        } else {
            let (owned, pending) = remove_invocation(&mut locked, identity);
            let Some(owned) = owned else {
                return Ok(None);
            };
            let result = watch::channel(None).0;
            locked.closing.insert(
                identity.clone(),
                Closing {
                    owned: owned.clone(),
                    result: result.clone(),
                },
            );
            (owned, result, pending)
        }
    };
    for pending in pending {
        let _ = pending.sender.send(Err(CANCELLED.into()));
    }
    let receiver = result.subscribe();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let closed = close_after_bootstrap(
            owned.ready.subscribe(),
            owned.capture.clone(),
            |ready| async {
                match ready {
                    Ok(handle) => handle.close().await,
                    Err(_) => Executor::new(app).close_generation(&owned.renderer).await,
                }
                .map_err(|_| UNAVAILABLE.to_owned())
            },
        )
        .await;
        result.send_replace(Some(closed));
    });
    Ok(Some(receiver))
}

async fn close_after_bootstrap<T: Clone, F: std::future::Future<Output = Result<(), String>>>(
    mut ready: watch::Receiver<Option<Result<T, String>>>,
    capture: Arc<tokio::sync::Mutex<()>>,
    close: impl FnOnce(Result<T, String>) -> F,
) -> Result<(), String> {
    let opened = ready
        .wait_for(|value| value.is_some())
        .await
        .map_err(|_| UNAVAILABLE)?
        .as_ref()
        .ok_or(UNAVAILABLE)?
        .clone();
    let _capture = capture.lock().await;
    close(opened).await
}

pub(crate) async fn finish_invocation(
    app: &tauri::AppHandle,
    generation: u64,
    invocation_id: &str,
) -> Result<(), String> {
    let identity = (generation, invocation_id.to_owned());
    if let Some(mut closing) = release_invocation(app, &identity)? {
        closing
            .wait_for(|result| result.is_some())
            .await
            .map_err(|_| UNAVAILABLE)?
            .as_ref()
            .ok_or(UNAVAILABLE)?
            .clone()?;
        app.state::<Renderers>()
            .0
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .closing
            .remove(&identity);
    }
    Ok(())
}

pub(crate) fn forget_invocation(app: &tauri::AppHandle, generation: u64, invocation_id: &str) {
    let _ = release_invocation(app, &(generation, invocation_id.to_owned()));
}

pub fn forget_window(app: &tauri::AppHandle, window: &str) {
    let identities: Vec<_> = {
        let state = app.state::<Renderers>();
        let Ok(locked) = state.0.lock() else {
            return;
        };
        locked
            .presentations
            .iter()
            .filter(|(_, p)| p.window == window)
            .map(|(id, _)| id.clone())
            .chain(
                locked
                    .closing
                    .iter()
                    .filter(|(_, closing)| closing.owned.window == window)
                    .map(|(id, _)| id.clone()),
            )
            .collect()
    };
    for (generation, invocation) in identities {
        forget_invocation(app, generation, &invocation);
    }
}

#[cfg(test)]
#[path = "plugin_preview_tests.rs"]
mod tests;
