use crate::files::{self, Session};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

const ERROR: &str = "native.recovery.failed";
const TERMINAL_LIMIT: usize = 64;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    state: &'static str,
    workspace_ids: Vec<String>,
}
struct Attempt {
    token: String,
    kind: String,
    sessions: HashMap<String, Vec<Arc<Session>>>,
    workspaces: HashMap<String, Vec<String>>,
    registrations: HashMap<String, String>,
    ready: HashSet<String>,
    state: &'static str,
}
#[derive(Default)]
pub(crate) struct Recovery {
    registrations: Mutex<HashMap<String, String>>,
    attempt: Mutex<Option<Attempt>>,
    terminal: Mutex<HashMap<String, HashMap<String, Status>>>,
}
impl Recovery {
    fn status(&self, window: &str, token: &str) -> Result<Status, String> {
        let pending = self.attempt.lock().map_err(|_| ERROR)?;
        if let Some(attempt) = pending.as_ref().filter(|a| a.token == token) {
            return attempt.status(window, token);
        }
        self.terminal
            .lock()
            .map_err(|_| ERROR)?
            .get(token)
            .and_then(|windows| windows.get(window))
            .cloned()
            .ok_or_else(|| ERROR.into())
    }

    fn retain_terminal(&self, attempt: &Attempt) -> Result<(), String> {
        if !matches!(attempt.state, "cancelled" | "completed") {
            return Err(ERROR.into());
        }
        let mut terminal = self.terminal.lock().map_err(|_| ERROR)?;
        // A missing delivery acknowledgement is not permission to evict a window's cancellation record.
        if terminal.len() >= TERMINAL_LIMIT && !terminal.contains_key(&attempt.token) {
            return Err(ERROR.into());
        }
        terminal.insert(
            attempt.token.clone(),
            attempt
                .workspaces
                .iter()
                .map(|(window, ids)| {
                    (
                        window.clone(),
                        Status {
                            state: attempt.state,
                            workspace_ids: ids.clone(),
                        },
                    )
                })
                .collect(),
        );
        Ok(())
    }
}
impl Attempt {
    fn status(&self, window: &str, token: &str) -> Result<Status, String> {
        if self.token != token {
            return Err(ERROR.into());
        }
        Ok(Status {
            state: self.state,
            workspace_ids: self.workspaces.get(window).ok_or(ERROR)?.clone(),
        })
    }
    fn acknowledge(
        &mut self,
        window: &str,
        token: &str,
        registration: &str,
        approved: bool,
    ) -> Result<(), String> {
        self.status(window, token)?;
        if self.state != "pending"
            || self.registrations.get(window).map(String::as_str) != Some(registration)
        {
            return Err(ERROR.into());
        }
        if !approved {
            self.state = "rejected";
            return Ok(());
        }
        for session in self.sessions.get(window).ok_or(ERROR)? {
            files::pause_for_quit(session, token, false).map_err(|_| ERROR)?;
        }
        self.ready.insert(window.into());
        Ok(())
    }
    fn finish(&mut self, effect: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        if self.state != "pending" || self.ready.len() != self.sessions.len() {
            return Err(ERROR.into());
        }
        effect()?;
        self.state = "finishing";
        Ok(())
    }
}

pub(crate) fn any_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.try_state::<Recovery>().is_some_and(|state| {
        state
            .attempt
            .lock()
            .map(|a| {
                a.as_ref()
                    .is_some_and(|a| a.state != "cancelled" && a.state != "completed")
            })
            .unwrap_or(true)
    })
}

pub(crate) fn admission_held<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: Option<&str>,
) -> bool {
    app.try_state::<Recovery>().is_some_and(|state| {
        state
            .attempt
            .lock()
            .map(|attempt| {
                attempt.as_ref().is_some_and(|a| {
                    a.state != "cancelled"
                        && a.state != "completed"
                        && (a.kind == "restart"
                            || scope.is_some_and(|scope| {
                                a.workspaces.values().flatten().any(|id| id == scope)
                            }))
                })
            })
            .unwrap_or(true)
    })
}
pub(crate) fn window_changed<R: tauri::Runtime>(app: &tauri::AppHandle<R>, window: &str) {
    if let Some(state) = app.try_state::<Recovery>() {
        if let Ok(mut registrations) = state.registrations.lock() {
            registrations.remove(window);
        }
        if let Ok(mut attempt) = state.attempt.lock()
            && let Some(attempt) = attempt
                .as_mut()
                .filter(|a| a.state == "pending" && a.sessions.contains_key(window))
        {
            attempt.state = "rejected";
        }
    }
}
pub(super) fn local_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| ERROR)?;
    if !matches!(window.label(), "main") && !window.label().starts_with("workspace-") {
        return Err(ERROR.into());
    }
    if !matches!(url.scheme(), "tauri" | "http" | "https") {
        return Err(ERROR.into());
    }
    let host = url.host_str().unwrap_or_default();
    if !matches!(host, "localhost" | "tauri.localhost" | "127.0.0.1") {
        return Err(ERROR.into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn recovery_register(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    local_window(&window)?;
    let registration = uuid::Uuid::new_v4().to_string();
    let state = app.state::<Recovery>();
    let mut registrations = state.registrations.lock().map_err(|_| ERROR)?;
    if admission_held(&app, None) {
        return Err(ERROR.into());
    }
    registrations.insert(window.label().into(), registration.clone());
    Ok(registration)
}
#[tauri::command]
pub(crate) fn recovery_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<Status, String> {
    local_window(&window)?;
    app.state::<Recovery>().status(window.label(), &token)
}
#[tauri::command]
pub(crate) fn recovery_ack(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
    registration: String,
    approved: bool,
) -> Result<(), String> {
    local_window(&window)?;
    if approved && crate::dictation::active_window(&app, window.label()) {
        return Err(ERROR.into());
    }
    app.state::<Recovery>()
        .attempt
        .lock()
        .map_err(|_| ERROR)?
        .as_mut()
        .ok_or(ERROR)?
        .acknowledge(window.label(), &token, &registration, approved)
}
#[tauri::command]
pub(crate) async fn recovery_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: String,
    scope: Option<String>,
) -> Result<String, String> {
    local_window(&window)?;
    if kind != "workspace" && kind != "restart" {
        return Err(ERROR.into());
    }
    if kind == "restart" && !cfg!(target_os = "macos") {
        return Err("native.recovery.manualRestart".into());
    }
    let owner = window.label().to_owned();
    // The task owns cancellation and cleanup even if its IPC caller disappears.
    tauri::async_runtime::spawn(async move { run(&app, &owner, &kind, scope.as_deref()).await })
        .await
        .map_err(|_| ERROR.to_owned())?
}
async fn run(
    app: &tauri::AppHandle,
    owner: &str,
    kind: &str,
    scope: Option<&str>,
) -> Result<String, String> {
    let token =
        crate::workspaces::with_lifecycle_participants(app, |mut sessions, mut workspaces| {
            let state = app.state::<Recovery>();
            let registrations = state.registrations.lock().map_err(|_| ERROR)?;
            let mut pending = state.attempt.lock().map_err(|_| ERROR)?;
            if crate::lifecycle::ordinary_quit_pending(app)
                || crate::updates::admission_held(app)
                || pending
                    .as_ref()
                    .is_some_and(|a| a.state != "cancelled" && a.state != "completed")
            {
                return Err(ERROR.to_owned());
            }
            if kind == "workspace" {
                let scope = scope.ok_or(ERROR)?;
                let ids = workspaces.get(owner).ok_or(ERROR)?;
                let index = ids.iter().position(|id| id == scope).ok_or(ERROR)?;
                let session = sessions.get(owner).ok_or(ERROR)?[index].clone();
                sessions = HashMap::from([(owner.into(), vec![session])]);
                workspaces = HashMap::from([(owner.into(), vec![scope.into()])]);
            } else {
                for (window, _) in app.webview_windows() {
                    if window == "main" || window.starts_with("workspace-") {
                        sessions.entry(window.clone()).or_default();
                        workspaces.entry(window).or_default();
                    }
                }
            }
            if !sessions.contains_key(owner)
                || sessions.keys().any(|w| !registrations.contains_key(w))
            {
                return Err(ERROR.into());
            }
            let captured = sessions
                .keys()
                .map(|w| (w.clone(), registrations[w].clone()))
                .collect();
            let token = uuid::Uuid::new_v4().to_string();
            if let Some(previous) = pending.as_ref() {
                state.retain_terminal(previous)?;
            }
            *pending = Some(Attempt {
                token: token.clone(),
                kind: kind.into(),
                sessions,
                workspaces,
                registrations: captured,
                ready: HashSet::new(),
                state: "pending",
            });
            Ok(token)
        })?;
    let scopes = app
        .state::<Recovery>()
        .attempt
        .lock()
        .map_err(|_| ERROR)?
        .as_ref()
        .ok_or(ERROR)?
        .workspaces
        .values()
        .flatten()
        .cloned()
        .collect::<Vec<_>>();
    let handle = app.clone();
    let stopping_scopes = scopes.clone();
    let mut stopping = tauri::async_runtime::spawn(async move {
        for scope in stopping_scopes {
            crate::ai::stop_for_recovery(&handle, &scope)
                .await
                .map_err(|_| ERROR)?;
        }
        Ok::<_, String>(())
    });
    let stopped = match tokio::time::timeout(Duration::from_secs(30), &mut stopping).await {
        Ok(result) => result
            .map_err(|_| ERROR.to_owned())
            .and_then(|result| result),
        Err(_) => {
            // Never abandon an in-flight checkpoint or restore admission while teardown still writes.
            let _ = stopping.await;
            Err(ERROR.into())
        }
    };
    let result = async {
        stopped?;
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let waiting = {
                    let state = app.state::<Recovery>();
                    let registrations = state.registrations.lock().map_err(|_| ERROR)?;
                    let pending = state.attempt.lock().map_err(|_| ERROR)?;
                    let attempt = pending.as_ref().ok_or(ERROR)?;
                    if attempt.state != "pending"
                        || attempt.registrations.iter().any(|(w, r)| {
                            registrations.get(w) != Some(r)
                                || !app.webview_windows().contains_key(w)
                        })
                    {
                        return Err(ERROR.to_owned());
                    }
                    attempt
                        .sessions
                        .keys()
                        .filter(|w| !attempt.ready.contains(*w))
                        .cloned()
                        .collect::<Vec<_>>()
                };
                if waiting.is_empty() {
                    return Ok(());
                }
                for window in waiting {
                    app.emit_to(&window, "recovery-prepare", &token)
                        .map_err(|_| ERROR)?;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .map_err(|_| ERROR)??;
        let sessions = {
            let state = app.state::<Recovery>();
            let registrations = state.registrations.lock().map_err(|_| ERROR)?;
            let mut pending = state.attempt.lock().map_err(|_| ERROR)?;
            let attempt = pending.as_mut().ok_or(ERROR)?;
            if attempt
                .registrations
                .iter()
                .any(|(w, r)| registrations.get(w) != Some(r))
            {
                return Err(ERROR.into());
            }
            let sessions = attempt
                .sessions
                .values()
                .flatten()
                .cloned()
                .collect::<Vec<_>>();
            attempt.finish(|| {
                if kind == "restart" {
                    files::commit_quit(&sessions, false).map_err(|_| ERROR)?;
                }
                Ok(())
            })?;
            sessions
        };
        if kind == "workspace" {
            crate::workspaces::reopen_recovery(
                app,
                owner,
                scope.ok_or(ERROR)?,
                sessions.first().ok_or(ERROR)?,
            )?;
            app.state::<Recovery>()
                .attempt
                .lock()
                .map_err(|_| ERROR)?
                .as_mut()
                .ok_or(ERROR)?
                .state = "completed";
        }
        Ok::<_, String>(())
    }
    .await;
    if result.is_err() {
        let state = app.state::<Recovery>();
        if let Ok(mut pending) = state.attempt.lock()
            && let Some(attempt) = pending.as_mut()
        {
            attempt.state = "cancelled";
            for session in attempt.sessions.values().flatten() {
                files::resume_quit(session, &token);
            }
        }
        for scope in &scopes {
            crate::ai::cancel_close(app, scope);
        }
        let _ = app.emit("recovery-cancelled", &token);
        return Err(ERROR.into());
    }
    if kind == "restart" {
        app.state::<crate::lifecycle::Quit>()
            .approved
            .store(true, std::sync::atomic::Ordering::Release);
        crate::workspaces::exiting(app);
        #[cfg(target_os = "macos")]
        app.request_restart();
    } else {
        for scope in scopes {
            crate::ai::cancel_close(app, &scope);
        }
        app.emit_to(owner, "recovery-completed", &token)
            .map_err(|_| ERROR)?;
    }
    Ok(token)
}
#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
