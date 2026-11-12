use serde::Serialize;
use serde_json::{Value, json};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Owner {
    id: String,
    window: String,
    scope: String,
    conversation: String,
    phase: String,
}
struct State {
    model: String,
    progress: u64,
    owner: Option<Owner>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            model: "missing".into(),
            progress: 0,
            owner: None,
        }
    }
}
impl State {
    fn reserve(&mut self, owner: Owner) -> Result<(), String> {
        if self.model != "ready" || self.owner.is_some() {
            return Err("dictation.elsewhere".into());
        }
        self.owner = Some(owner);
        Ok(())
    }
    fn authorized(&self, window: &str, id: Option<&str>) -> bool {
        self.owner
            .as_ref()
            .is_some_and(|owner| owner.window == window && id == Some(&owner.id))
    }
}
#[derive(Default)]
pub(crate) struct Dictation(Mutex<State>);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
unsafe extern "C" {
    fn situate_dictation_setup(
        path: *const std::ffi::c_char,
        library: *const std::ffi::c_char,
        loader: *const std::ffi::c_char,
        source: *const std::ffi::c_char,
        callback: extern "C" fn(*const std::ffi::c_char),
    );
    fn situate_dictation_command(command: *const std::ffi::c_char, id: *const std::ffi::c_char);
}
fn command(action: &str, id: &str) {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let action = std::ffi::CString::new(action).unwrap();
        let id = std::ffi::CString::new(id).unwrap();
        unsafe { situate_dictation_command(action.as_ptr(), id.as_ptr()) };
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    let _ = (action, id);
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
extern "C" fn receive(data: *const std::ffi::c_char) {
    // Swift owns this string for the duration of the synchronous callback.
    let data = unsafe { std::ffi::CStr::from_ptr(data) };
    let Ok(event) = serde_json::from_slice::<Value>(data.to_bytes()) else {
        return;
    };
    let Some(app) = APP.get() else { return };
    let capability = app.state::<Dictation>();
    let Ok(mut state) = capability.0.lock() else {
        return;
    };
    if let Some(model) = event["model"].as_str() {
        if ![
            "checking",
            "waiting",
            "downloading",
            "preparing",
            "ready",
            "failed",
            "storage",
        ]
        .contains(&model)
        {
            return;
        }
        state.model = model.into();
        if let Some(progress) = event["progress"].as_u64() {
            state.progress = progress.min(100);
        }
    } else {
        let Some(owner) = state.owner.as_mut() else {
            return;
        };
        if event["id"].as_str() != Some(&owner.id) {
            return;
        }
        if let Some(level) = event["level"].as_f64() {
            if owner.phase == "recording" && level.is_finite() {
                let _ = app.emit_to(
                    &owner.window,
                    "dictation-level",
                    json!({ "id": owner.id, "level": level.clamp(0.0, 1.0) }),
                );
            }
            return;
        }
        if event["phase"] == "finished" {
            let window = owner.window.clone();
            let _ = app.emit_to(&window, "dictation-result", &event);
            state.owner = None;
        } else if let Some(phase) = event["phase"].as_str()
            && ["permission", "recording", "transcribing"].contains(&phase)
        {
            owner.phase = phase.into();
        }
    }
    drop(state);
    let _ = app.emit("dictation-changed", ());
}

pub(crate) fn setup(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if let Ok(directory) = app.path().app_data_dir() {
        let directory = directory.join("dictation");
        if let Ok(path) = std::ffi::CString::new(directory.to_string_lossy().as_bytes()) {
            let (library, loader) = if cfg!(debug_assertions) {
                let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("dictation");
                (
                    root.join(".build/media/libSituateMedia.dylib"),
                    root.join("Media/loader.pl"),
                )
            } else {
                let Ok(resources) = app.path().resource_dir() else {
                    return;
                };
                (
                    resources.join("../Frameworks/libSituateMedia.dylib"),
                    resources.join("dictation/loader.pl"),
                )
            };
            let Ok(library) = std::ffi::CString::new(library.to_string_lossy().as_bytes()) else {
                return;
            };
            let Ok(loader) = std::ffi::CString::new(loader.to_string_lossy().as_bytes()) else {
                return;
            };
            let source =
                std::ffi::CString::new(option_env!("SITUATE_DICTATION_MODEL_SOURCE").unwrap_or(""))
                    .unwrap();
            unsafe {
                situate_dictation_setup(
                    path.as_ptr(),
                    library.as_ptr(),
                    loader.as_ptr(),
                    source.as_ptr(),
                    receive,
                )
            };
        }
    }
}

pub(crate) fn active(app: &tauri::AppHandle, scope: &str) -> bool {
    app.state::<Dictation>()
        .0
        .lock()
        .map(|s| s.owner.as_ref().is_some_and(|o| o.scope == scope))
        .unwrap_or(true)
}

pub(crate) fn active_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, window: &str) -> bool {
    app.state::<Dictation>()
        .0
        .lock()
        .map(|s| s.owner.as_ref().is_some_and(|o| o.window == window))
        .unwrap_or(true)
}

pub(crate) fn forget_window(app: &tauri::AppHandle, window: &str) {
    if let Ok(state) = app.state::<Dictation>().0.lock()
        && let Some(owner) = &state.owner
        && owner.window == window
    {
        command("discard", &owner.id);
    }
}

#[cfg(target_os = "macos")]
pub(crate) async fn stop_for_update(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Dictation>();
    let id = state
        .0
        .lock()
        .map_err(|_| "native.updates.stopFailed")?
        .owner
        .as_ref()
        .map(|owner| owner.id.clone());
    if let Some(id) = id {
        command("discard", &id);
    }
    wait_until_idle(&state).await
}

#[cfg(target_os = "macos")]
async fn wait_until_idle(state: &Dictation) -> Result<(), String> {
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let idle = state
                .0
                .lock()
                .map_err(|_| "native.updates.stopFailed")?
                .owner
                .is_none();
            if idle {
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .map_err(|_| "native.updates.stopFailed")?
}

#[tauri::command]
pub(crate) fn dictation_snapshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    let capability = app.state::<Dictation>();
    let state = capability.0.lock().map_err(|_| "dictation.failed")?;
    Ok(json!({
        "supported": cfg!(all(target_os = "macos", target_arch = "aarch64")),
        "model": state.model, "progress": state.progress, "busy": state.owner.is_some(),
        "owner": state.owner.as_ref().filter(|o| o.window == window.label()),
    }))
}

#[tauri::command]
pub(crate) fn dictation_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    conversation: String,
    id: String,
) -> Result<(), String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64"))
        || uuid::Uuid::parse_str(&id).is_err()
    {
        return Err("dictation.failed".into());
    }
    if crate::lifecycle::quit_pending(&app) {
        return Err("dictation.failed".into());
    }
    crate::workspaces::with_open_storage(&app, window.label(), &scope, |_| Ok(()))?;
    let capability = app.state::<Dictation>();
    let mut state = capability.0.lock().map_err(|_| "dictation.failed")?;
    state.reserve(Owner {
        id: id.clone(),
        window: window.label().into(),
        scope,
        conversation,
        phase: "permission".into(),
    })?;
    drop(state);
    command("start", &id);
    let _ = app.emit("dictation-changed", ());
    Ok(())
}

#[tauri::command]
pub(crate) fn dictation_control(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    id: Option<String>,
) -> Result<(), String> {
    if action == "retry" {
        command("retry", "");
        return Ok(());
    }
    if !["stop", "discard"].contains(&action.as_str()) {
        return Err("dictation.failed".into());
    }
    let capability = app.state::<Dictation>();
    let state = capability.0.lock().map_err(|_| "dictation.failed")?;
    let Some(owner) = state.owner.as_ref() else {
        return Ok(());
    };
    if !state.authorized(window.label(), id.as_deref()) {
        return Err("dictation.failed".into());
    }
    command(&action, &owner.id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn owner(window: &str, id: &str) -> Owner {
        Owner {
            id: id.into(),
            window: window.into(),
            scope: "workspace".into(),
            conversation: "chat".into(),
            phase: "permission".into(),
        }
    }
    #[test]
    fn admission_is_reserved_before_permission_and_excludes_other_windows() {
        let mut state = State {
            model: "ready".into(),
            ..State::default()
        };
        state.reserve(owner("first", "current")).unwrap();
        assert!(state.reserve(owner("second", "other")).is_err());
        assert!(state.authorized("first", Some("current")));
        assert!(!state.authorized("second", Some("current")));
        assert!(!state.authorized("first", Some("old")));
        state.owner.as_mut().unwrap().phase = "transcribing".into();
        assert!(state.reserve(owner("first", "other")).is_err());
        state.owner = None;
        state.reserve(owner("second", "next")).unwrap();
        assert!(!state.authorized("first", Some("current")));
    }
    #[cfg(target_os = "macos")]
    #[tokio::test(start_paused = true)]
    async fn update_waits_for_native_dictation_completion() {
        let state = std::sync::Arc::new(Dictation(Mutex::new(State {
            owner: Some(owner("first", "current")),
            ..State::default()
        })));
        let pending = state.clone();
        let waiting = tokio::spawn(async move { wait_until_idle(&pending).await });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        state.0.lock().unwrap().owner = None;
        tokio::time::advance(std::time::Duration::from_millis(50)).await;
        assert!(waiting.await.unwrap().is_ok());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test(start_paused = true)]
    async fn update_rejects_a_dictation_owner_that_never_finishes() {
        let state = Dictation(Mutex::new(State {
            owner: Some(owner("first", "current")),
            ..State::default()
        }));
        assert_eq!(
            wait_until_idle(&state).await,
            Err("native.updates.stopFailed".into())
        );
        assert!(state.0.lock().unwrap().owner.is_some());
    }

    #[test]
    fn incomplete_provisioning_never_admits_recording() {
        for model in [
            "checking",
            "waiting",
            "downloading",
            "preparing",
            "failed",
            "storage",
        ] {
            let mut state = State {
                model: model.into(),
                ..State::default()
            };
            assert!(state.reserve(owner("first", "operation")).is_err());
            assert!(state.owner.is_none());
        }
    }
}
