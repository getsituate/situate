#[cfg(target_os = "macos")]
mod cache;
#[cfg(target_os = "macos")]
mod install;
#[cfg(target_os = "macos")]
mod lifecycle;
#[cfg(target_os = "macos")]
mod native;
mod policy;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_snapshot_ipc_uses_the_shared_wire_contract() {
        let state = Updates::new("1.0.0".into());
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            snapshot.last_successful_check = Some(1_700_000_000_123);
        }
        let app = tauri::test::mock_builder()
            .manage(state)
            .manage(crate::ai::Ai::default())
            .manage(crate::plugin_host::Hosts::default())
            .invoke_handler(tauri::generate_handler![updates_snapshot])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let response = tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "updates_snapshot".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize::<serde_json::Value>()
        .unwrap();
        assert_eq!(response["installedVersion"], "1.0.0");
        assert_eq!(response["phase"], "current");
        assert_eq!(response["lastSuccessfulCheck"], 1_700_000_000_123u64);
        assert_eq!(response["downloadedBytes"], 0);
        assert_eq!(response["runningActions"], false);
        for name in ["availableVersion", "artifactId", "totalBytes", "error"] {
            assert!(response[name].is_null());
        }
        assert_eq!(response.as_object().unwrap().len(), 10);
    }
}

use policy::Phase;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
mod diagnostics;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    supported: bool,
    installed_version: String,
    phase: Phase,
    available_version: Option<String>,
    artifact_id: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    last_successful_check: Option<u64>,
    error: Option<String>,
    running_actions: bool,
}
pub(crate) struct Updates {
    snapshot: Mutex<Snapshot>,
    #[cfg(target_os = "macos")]
    native: Mutex<Option<std::sync::Arc<native::Native>>>,
    #[cfg(target_os = "macos")]
    preparation: lifecycle::Preparation,
}
impl Updates {
    fn new(version: String) -> Self {
        Self {
            snapshot: Mutex::new(Snapshot {
                supported: policy::direct(
                    option_env!("SITUATE_DISTRIBUTION"),
                    cfg!(target_os = "macos"),
                ),
                installed_version: version,
                phase: Phase::Current,
                available_version: None,
                artifact_id: None,
                downloaded_bytes: 0,
                total_bytes: None,
                last_successful_check: None,
                error: None,
                running_actions: false,
            }),
            #[cfg(target_os = "macos")]
            native: Mutex::new(None),
            #[cfg(target_os = "macos")]
            preparation: lifecycle::Preparation::default(),
        }
    }
    fn change<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, f: impl FnOnce(&mut Snapshot)) {
        if let Ok(mut snapshot) = self.snapshot.lock() {
            f(&mut snapshot);
            snapshot.running_actions = crate::ai::has_running_actions(app).unwrap_or(true);
            let _ = app.emit("updates-changed", &*snapshot);
        }
    }
}
pub(crate) fn setup(app: &tauri::AppHandle) {
    let state = Updates::new(app.package_info().version.to_string());
    app.manage(state);
    #[cfg(target_os = "macos")]
    native::setup(app);
}
pub(crate) fn window_changed(app: &tauri::AppHandle, window: &str) {
    #[cfg(target_os = "macos")]
    if let Some(state) = app.try_state::<Updates>() {
        state.preparation.window_changed(app, window);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, window);
}
#[cfg(all(test, target_os = "macos"))]
pub(crate) fn hold_test_admission<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let state = Updates::new("1.0.0".into());
    state
        .preparation
        .held
        .store(true, std::sync::atomic::Ordering::Release);
    app.manage(state);
}

#[cfg(all(test, target_os = "macos"))]
pub(crate) fn seal_test_admission<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    hold_test_admission(app);
    app.state::<Updates>()
        .preparation
        .sealed
        .store(true, std::sync::atomic::Ordering::Release);
}

pub(crate) fn admission_held<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    #[cfg(target_os = "macos")]
    {
        app.try_state::<Updates>().is_some_and(|s| {
            s.preparation
                .held
                .load(std::sync::atomic::Ordering::Acquire)
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        false
    }
}
pub(crate) fn ensure_mutation_admitted<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if app.try_state::<Updates>().is_some_and(|state| {
        state
            .preparation
            .sealed
            .load(std::sync::atomic::Ordering::Acquire)
    }) {
        return Err("native.updates.busy".into());
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[tauri::command]
pub(crate) fn updates_snapshot<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Snapshot, String> {
    let state = app.state::<Updates>();
    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "native.updates.busy")?
        .clone();
    snapshot.running_actions = crate::ai::has_running_actions(&app).unwrap_or(true);
    Ok(snapshot)
}
#[tauri::command]
pub(crate) fn updates_check(app: tauri::AppHandle) -> Result<Snapshot, String> {
    #[cfg(target_os = "macos")]
    native::service(&app)?.check(app.clone(), true);
    #[cfg(not(target_os = "macos"))]
    return Err("native.updates.unsupported".into());
    #[allow(unreachable_code)]
    updates_snapshot(app)
}
#[tauri::command]
pub(crate) fn updates_install(
    app: tauri::AppHandle,
    abort_running: bool,
    artifact_id: String,
    force: Option<bool>,
) -> Result<Snapshot, String> {
    #[cfg(target_os = "macos")]
    native::service(&app)?.install(
        app.clone(),
        abort_running,
        artifact_id,
        force.unwrap_or(false),
    )?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (abort_running, artifact_id, force);
        return Err("native.updates.unsupported".into());
    }
    #[allow(unreachable_code)]
    updates_snapshot(app)
}
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub(crate) fn updates_preparation_status(token: String) -> Result<serde_json::Value, String> {
    let _ = token;
    Err("native.updates.unsupported".into())
}
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub(crate) fn updates_prepare_ack(
    token: String,
    approved: bool,
    reason: Option<String>,
) -> Result<(), String> {
    let _ = (token, approved, reason);
    Err("native.updates.unsupported".into())
}
#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) fn updates_preparation_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<lifecycle::Status, String> {
    app.state::<Updates>()
        .preparation
        .status(window.label(), &token)
}
#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) fn updates_prepare_ack(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
    approved: bool,
    reason: Option<String>,
) -> Result<(), String> {
    app.state::<Updates>().preparation.acknowledge(
        &app,
        window.label(),
        &token,
        approved,
        reason.as_deref(),
    )
}
