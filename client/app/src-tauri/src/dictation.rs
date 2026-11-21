use serde::Serialize;
use serde_json::{Value, json};
use std::sync::Mutex;
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
    #[cfg(all(windows, target_arch = "x86_64"))]
    session: windows::Session,
}
impl Default for State {
    fn default() -> Self {
        Self {
            model: "missing".into(),
            progress: 0,
            owner: None,
            #[cfg(all(windows, target_arch = "x86_64"))]
            session: windows::Session::default(),
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
#[cfg(target_os = "macos")]
mod macos;
#[cfg(all(windows, target_arch = "x86_64"))]
mod windows;

#[cfg(not(all(windows, target_arch = "x86_64")))]
fn command(action: &str, id: &str) {
    #[cfg(target_os = "macos")]
    macos::command(action, id);
    #[cfg(not(target_os = "macos"))]
    let _ = (action, id);
}

#[cfg(any(target_os = "macos", all(windows, target_arch = "x86_64")))]
fn receive(app: &tauri::AppHandle, event: Value) {
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
            #[cfg(all(windows, target_arch = "x86_64"))]
            let event = if state.session.discard.is_cancelled() {
                json!({ "id": event["id"], "phase": "finished" })
            } else {
                event
            };
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
    #[cfg(target_os = "macos")]
    macos::setup(app);
    #[cfg(all(windows, target_arch = "x86_64"))]
    windows::setup(app);
    #[cfg(not(any(target_os = "macos", all(windows, target_arch = "x86_64"))))]
    let _ = app;
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
        #[cfg(all(windows, target_arch = "x86_64"))]
        state.session.discard.cancel();
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        command("discard", &owner.id);
    }
}

pub(crate) async fn discard_conversation(
    app: &tauri::AppHandle,
    scope: &str,
    conversation: &str,
) -> Result<(), String> {
    discard_target(&app.state::<Dictation>(), scope, conversation, |id| {
        #[cfg(all(windows, target_arch = "x86_64"))]
        if let Ok(state) = app.state::<Dictation>().0.lock()
            && state.owner.as_ref().is_some_and(|owner| owner.id == id)
        {
            state.session.discard.cancel();
        }
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        command("discard", id);
    })
    .await
}

async fn discard_target(
    state: &Dictation,
    scope: &str,
    conversation: &str,
    discard: impl FnOnce(&str),
) -> Result<(), String> {
    let id = state
        .0
        .lock()
        .map_err(|_| "dictation.failed")?
        .owner
        .as_ref()
        .filter(|owner| owner.scope == scope && owner.conversation == conversation)
        .map(|owner| owner.id.clone());
    let Some(id) = id else {
        return Ok(());
    };
    discard(&id);
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let finished = state
                .0
                .lock()
                .map_err(|_| "dictation.failed")?
                .owner
                .as_ref()
                .is_none_or(|owner| owner.id != id);
            if finished {
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .map_err(|_| "dictation.failed")?
}

#[cfg(any(target_os = "macos", all(windows, target_arch = "x86_64")))]
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
        #[cfg(target_os = "macos")]
        command("discard", &id);
        #[cfg(windows)]
        if let Ok(state) = state.0.lock()
            && state.owner.as_ref().is_some_and(|owner| owner.id == id)
        {
            state.session.discard.cancel();
        }
    }
    wait_until_idle(&state).await
}

#[cfg(any(target_os = "macos", all(windows, target_arch = "x86_64")))]
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
        "supported": supported(&app),
        "mobileDownload": cfg!(all(windows, target_arch = "x86_64")),
        "model": state.model, "progress": state.progress, "busy": state.owner.is_some(),
        "owner": state.owner.as_ref().filter(|o| o.window == window.label()),
    }))
}

fn supported(app: &tauri::AppHandle) -> bool {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        app.try_state::<windows::Paths>().is_some()
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        let _ = app;
        cfg!(target_os = "macos")
    }
}

#[tauri::command]
pub(crate) fn dictation_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    conversation: String,
    id: String,
) -> Result<(), String> {
    if !supported(&app) || uuid::Uuid::parse_str(&id).is_err() {
        return Err("dictation.failed".into());
    }
    if crate::lifecycle::quit_pending(&app) {
        return Err("dictation.failed".into());
    }
    let _admission =
        crate::ai_conversations::retain_conversation(&app, &window, &scope, &conversation)?;
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
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        state.session = windows::Session::default();
        windows::start(&app, &id, state.session.clone());
    }
    drop(state);
    #[cfg(not(all(windows, target_arch = "x86_64")))]
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
    if action == "retry" || action == "download" {
        #[cfg(all(windows, target_arch = "x86_64"))]
        windows::retry(&app, &action);
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        if action == "retry" {
            command("retry", "");
        }
        return Ok(());
    }
    if !["stop", "discard"].contains(&action.as_str()) {
        return Err("dictation.failed".into());
    }
    let capability = app.state::<Dictation>();
    let state = capability.0.lock().map_err(|_| "dictation.failed")?;
    if state.owner.is_none() {
        return Ok(());
    }
    if !state.authorized(window.label(), id.as_deref()) {
        return Err("dictation.failed".into());
    }
    #[cfg(all(windows, target_arch = "x86_64"))]
    if action == "discard" {
        state.session.discard.cancel();
    } else {
        state.session.stop.cancel();
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    command(&action, id.as_deref().unwrap_or_default());
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

    #[tokio::test(start_paused = true)]
    async fn conversation_deletion_discards_and_waits_only_for_its_dictation() {
        for phase in ["permission", "recording", "transcribing"] {
            let state = Dictation(Mutex::new(State {
                owner: Some(Owner {
                    phase: phase.into(),
                    ..owner("first", "current")
                }),
                ..State::default()
            }));
            discard_target(&state, "other-workspace", "chat", |_| {
                panic!("other workspace")
            })
            .await
            .unwrap();
            discard_target(&state, "workspace", "other-chat", |_| {
                panic!("other conversation")
            })
            .await
            .unwrap();
            let mut waiting = Box::pin(discard_target(&state, "workspace", "chat", |id| {
                assert_eq!(id, "current")
            }));
            std::future::poll_fn(|cx| {
                assert!(waiting.as_mut().poll(cx).is_pending());
                std::task::Poll::Ready(())
            })
            .await;
            state.0.lock().unwrap().owner = Some(owner("second", "next"));
            tokio::time::advance(std::time::Duration::from_millis(50)).await;
            waiting.await.unwrap();
            assert_eq!(state.0.lock().unwrap().owner.as_ref().unwrap().id, "next");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn conversation_deletion_retains_dictation_when_native_discard_never_finishes() {
        let state = Dictation(Mutex::new(State {
            owner: Some(owner("first", "current")),
            ..State::default()
        }));
        assert_eq!(
            discard_target(&state, "workspace", "chat", |_| {}).await,
            Err("dictation.failed".into())
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
