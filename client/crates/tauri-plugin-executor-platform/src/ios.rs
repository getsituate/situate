use super::*;
use tauri::{
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
};

tauri::ios_plugin_binding!(init_plugin_executor_platform);

struct Platform {
    plugin: PluginHandle<Wry>,
    events: Channel<Value>,
}

pub(super) fn setup(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, ()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let target = app.clone();
    // Mobile channels are retained by Tauri; reuse one rather than leaking a channel per workspace.
    let events = Channel::new(move |body| {
        if let Ok(value) = body.deserialize::<Value>()
            && let Some(id) = value.get("id").and_then(Value::as_str)
        {
            let session = target
                .state::<Sessions>()
                .0
                .lock()
                .unwrap()
                .get(id)
                .cloned();
            if let (Some(session), Some(event)) = (session, value.get("event")) {
                ExecutorHandle {
                    app: target.clone(),
                    session,
                }
                .event(event.clone());
            }
        }
        Ok(())
    });
    app.manage(Platform {
        plugin: api.register_ios_plugin(init_plugin_executor_platform)?,
        events,
    });
    Ok(())
}

#[derive(Deserialize)]
struct CaptureReply {
    png: String,
}

/// Captures the original Tauri view only. The caller owns UI admission and mount validation.
pub async fn capture(app: &AppHandle<Wry>, rect: Value) -> Result<String, String> {
    let platform = app.state::<Platform>();
    let reply = tokio::time::timeout(
        std::time::Duration::from_secs(6),
        platform
            .plugin
            .run_mobile_plugin_async::<CaptureReply>("capture", rect),
    )
    .await
    .map_err(|_| "native.plugins.captureUnavailable")?
    .map_err(|_| "native.plugins.captureUnavailable")?;
    if reply.png.is_empty() || reply.png.len() > 24 * 1024 * 1024 {
        return Err("native.plugins.captureUnavailable".into());
    }
    Ok(reply.png)
}

pub(super) async fn capture_executor(
    handle: &ExecutorHandle,
    rect: CaptureRect,
) -> Result<String, String> {
    let reply = tokio::time::timeout(
        std::time::Duration::from_secs(6),
        handle
            .app
            .state::<Platform>()
            .plugin
            .run_mobile_plugin_async::<CaptureReply>(
                "captureExecutor",
                serde_json::json!({"id": handle.session.id, "rect": rect}),
            ),
    )
    .await
    .map_err(|_| "native.plugins.captureUnavailable")?
    .map_err(|_| "native.plugins.captureUnavailable")?;
    if reply.png.is_empty() || reply.png.len() > 24 * 1024 * 1024 {
        return Err("native.plugins.captureUnavailable".into());
    }
    Ok(reply.png)
}

pub(super) fn bridge() -> &'static str {
    "event => window.webkit.messageHandlers.executor.postMessage(event)"
}

pub(super) async fn open(handle: &ExecutorHandle) -> Result<(), String> {
    let state = handle.app.state::<Platform>();
    state
        .plugin
        .run_mobile_plugin_async::<Value>(
            "open",
            serde_json::json!({
                "id": handle.session.id, "html": handle.session.document, "events": &state.events,
                "preview": handle.session.document_kind == DocumentKind::Preview,
            }),
        )
        .await
        .map(|_| ())
        .map_err(|_| "executor.openFailed".into())
}

pub(super) async fn send(handle: &ExecutorHandle, script: String) -> Result<(), String> {
    handle
        .app
        .state::<Platform>()
        .plugin
        .run_mobile_plugin_async::<Value>(
            "send",
            serde_json::json!({
                "id": handle.session.id, "script": script,
            }),
        )
        .await
        .map(|_| ())
        .map_err(|_| "executor.sendFailed".into())
}

pub(super) async fn close(handle: &ExecutorHandle) -> Result<(), String> {
    handle
        .app
        .state::<Platform>()
        .plugin
        .run_mobile_plugin_async::<Value>(
            "close",
            serde_json::json!({
                "id": handle.session.id,
            }),
        )
        .await
        .map(|_| ())
        .map_err(|_| "executor.closeFailed".into())
}
