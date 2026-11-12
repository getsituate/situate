use crate::files::{self, Session};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Emitter, Manager};

const ERROR: &str = "native.updates.preparationFailed";
#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: &'static str,
    pub workspace_ids: Vec<String>,
}
struct Attempt {
    token: String,
    sessions: HashMap<String, Vec<Arc<Session>>>,
    workspaces: HashMap<String, Vec<String>>,
    ready: HashSet<String>,
    cancelled: bool,
    installing: bool,
    forced: bool,
    stopping: bool,
}
#[derive(Default)]
pub struct Preparation {
    pub held: AtomicBool,
    pub sealed: AtomicBool,
    attempt: Mutex<Option<Attempt>>,
    history: Mutex<HashMap<String, HashMap<String, Status>>>,
}
impl Attempt {
    fn pause(&mut self, window: &str) -> Result<(), String> {
        for session in self.sessions.get(window).ok_or(ERROR)? {
            files::pause_for_quit(session, &self.token, self.forced).map_err(|_| ERROR)?;
        }
        self.ready.insert(window.into());
        Ok(())
    }
    fn finish(&self) -> Result<(), String> {
        if self.cancelled || !self.installing || self.ready.len() != self.sessions.len() {
            return Err(ERROR.into());
        }
        let sessions = self
            .sessions
            .values()
            .flatten()
            .cloned()
            .collect::<Vec<_>>();
        files::commit_quit(&sessions, self.forced).map_err(|_| ERROR.into())
    }
    fn resume(&mut self) {
        for session in self.sessions.values().flatten() {
            files::resume_quit(session, &self.token);
        }
        self.cancelled = true;
    }
}
impl Preparation {
    pub fn begin(&self, app: &tauri::AppHandle, forced: bool) -> Result<String, String> {
        crate::workspaces::with_lifecycle_participants(app, |mut sessions, mut workspaces| {
            let mut pending = self.attempt.lock().map_err(|_| ERROR)?;
            if crate::lifecycle::ordinary_quit_pending(app)
                || crate::recovery::any_pending(app)
                || self.held.load(Ordering::Acquire)
            {
                return Err("native.updates.busy".into());
            }
            // Windows without a workspace still own drafts, layouts and dictation UI.
            for (label, _) in app.webview_windows() {
                if label == "main" || label.starts_with("workspace-") {
                    sessions.entry(label.clone()).or_default();
                    workspaces.entry(label).or_default();
                }
            }
            let token = uuid::Uuid::new_v4().to_string();
            if let Some(previous) = pending.as_ref() {
                let statuses = previous
                    .workspaces
                    .iter()
                    .map(|(window, ids)| {
                        (
                            window.clone(),
                            Status {
                                state: "cancelled",
                                workspace_ids: ids.clone(),
                            },
                        )
                    })
                    .collect();
                self.history
                    .lock()
                    .map_err(|_| ERROR)?
                    .insert(previous.token.clone(), statuses);
            }
            self.held.store(true, Ordering::Release);
            self.sealed.store(false, Ordering::Release);
            *pending = Some(Attempt {
                token: token.clone(),
                sessions,
                workspaces,
                ready: HashSet::new(),
                cancelled: false,
                installing: false,
                forced,
                stopping: true,
            });
            Ok(token)
        })
    }
    pub fn status(&self, window: &str, token: &str) -> Result<Status, String> {
        let pending = self.attempt.lock().map_err(|_| ERROR)?;
        let Some(attempt) = pending.as_ref().filter(|a| a.token == token) else {
            return self
                .history
                .lock()
                .map_err(|_| ERROR)?
                .get(token)
                .and_then(|windows| windows.get(window))
                .cloned()
                .ok_or_else(|| ERROR.into());
        };
        let workspace_ids = attempt.workspaces.get(window).ok_or(ERROR)?.clone();
        Ok(Status {
            state: if attempt.cancelled {
                "cancelled"
            } else if attempt.installing {
                "installing"
            } else {
                "pending"
            },
            workspace_ids,
        })
    }
    pub fn acknowledge<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        window: &str,
        token: &str,
        approved: bool,
        reason: Option<&str>,
    ) -> Result<(), String> {
        let forced = {
            let pending = self.attempt.lock().map_err(|_| ERROR)?;
            pending
                .as_ref()
                .is_some_and(|a| a.token == token && a.forced)
        };
        if forced {
            return Err(ERROR.into());
        }
        if !approved {
            if self.status(window, token)?.state == "cancelled" {
                return Ok(());
            }
            let reason = match reason {
                Some(
                    "conversation_save" | "files_pending" | "dictation_active" | "window_error",
                ) => reason,
                _ => Some("window_rejected"),
            };
            super::diagnostics::record(app, "prepare_window", reason, false);
            return self.cancel(app, token);
        }
        let mut pending = self.attempt.lock().map_err(|_| ERROR)?;
        let attempt = pending
            .as_mut()
            .filter(|a| a.token == token && !a.cancelled && !a.installing)
            .ok_or(ERROR)?;
        if crate::dictation::active_window(app, window) {
            super::diagnostics::record(app, "prepare_window", Some("dictation_active"), false);
            return Err(ERROR.into());
        }
        let result = attempt.pause(window);
        super::diagnostics::record(
            app,
            "prepare_window",
            result.as_ref().err().map(|_| "files_pending"),
            false,
        );
        result
    }
    pub fn actions_stopped(&self, token: &str) -> Result<(), String> {
        let mut pending = self.attempt.lock().map_err(|_| ERROR)?;
        let attempt = pending.as_mut().filter(|a| a.token == token).ok_or(ERROR)?;
        attempt.stopping = false;
        if attempt.cancelled {
            return Err(ERROR.into());
        }
        Ok(())
    }
    pub fn force_ready(&self, token: &str) -> Result<(), String> {
        let mut pending = self.attempt.lock().map_err(|_| ERROR)?;
        let attempt = pending
            .as_mut()
            .filter(|a| {
                a.token == token && a.forced && !a.stopping && !a.cancelled && !a.installing
            })
            .ok_or(ERROR)?;
        for window in attempt.sessions.keys().cloned().collect::<Vec<_>>() {
            attempt.pause(&window)?;
        }
        Ok(())
    }
    pub fn notify(&self, app: &tauri::AppHandle, token: &str) -> Result<bool, String> {
        let pending = self.attempt.lock().map_err(|_| ERROR)?;
        let attempt = pending
            .as_ref()
            .filter(|a| a.token == token && !a.cancelled)
            .ok_or(ERROR)?;
        if attempt.ready.len() == attempt.sessions.len() {
            return Ok(true);
        }
        for window in attempt
            .sessions
            .keys()
            .filter(|w| !attempt.ready.contains(*w))
        {
            if !app.webview_windows().contains_key(window) {
                super::diagnostics::record(
                    app,
                    "prepare_window",
                    Some("window_missing"),
                    attempt.forced,
                );
                return Err(ERROR.into());
            }
            app.emit_to(window, "updates-prepare-requested", token)
                .map_err(|_| ERROR)?;
        }
        Ok(false)
    }
    pub fn seal_for_install<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        token: &str,
    ) -> Result<(), String> {
        crate::workspaces::with_lifecycle_participants(app, |_, _| {
            if crate::ai::has_running_actions(app).map_err(|_| ERROR)? {
                return Err("native.updates.runningActions".into());
            }
            self.seal(token)
        })
    }
    pub fn seal(&self, token: &str) -> Result<(), String> {
        let mut pending = self.attempt.lock().map_err(|_| ERROR)?;
        let attempt = pending
            .as_mut()
            .filter(|a| a.token == token && !a.cancelled)
            .ok_or(ERROR)?;
        if attempt.stopping || attempt.ready.len() != attempt.sessions.len() {
            return Err(ERROR.into());
        }
        attempt.installing = true;
        self.sealed.store(true, Ordering::Release);
        Ok(())
    }
    pub fn cancel<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        token: &str,
    ) -> Result<(), String> {
        let mut pending = self.attempt.lock().map_err(|_| ERROR)?;
        let attempt = pending.as_mut().filter(|a| a.token == token).ok_or(ERROR)?;
        if attempt.installing {
            return Err(ERROR.into());
        }
        self.release(app, attempt);
        Ok(())
    }
    fn release<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, attempt: &mut Attempt) {
        attempt.resume();
        if !attempt.stopping {
            for scope in attempt.workspaces.values().flatten() {
                crate::ai::cancel_close(app, scope);
            }
            self.sealed.store(false, Ordering::Release);
            self.held.store(false, Ordering::Release);
        }
        let _ = app.emit("updates-preparation-cancelled", &attempt.token);
    }
    pub fn unchanged<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, token: &str) {
        if let Ok(mut pending) = self.attempt.lock()
            && let Some(attempt) = pending.as_mut().filter(|a| a.token == token)
        {
            attempt.installing = false;
            self.release(app, attempt);
        }
    }
    pub fn window_changed(&self, app: &tauri::AppHandle, window: &str) {
        if let Ok(mut pending) = self.attempt.lock()
            && let Some(attempt) = pending.as_mut().filter(|a| {
                !a.forced && !a.cancelled && !a.installing && a.sessions.contains_key(window)
            })
        {
            self.release(app, attempt);
        }
    }
    pub fn finalize(&self, app: &tauri::AppHandle, token: &str) -> Result<(), String> {
        let pending = self.attempt.lock().map_err(|_| ERROR)?;
        let attempt = pending
            .as_ref()
            .filter(|a| a.token == token && a.installing && !a.cancelled)
            .ok_or(ERROR)?;
        attempt.finish()?;
        app.state::<crate::lifecycle::Quit>()
            .approved
            .store(true, Ordering::Release);
        crate::workspaces::exiting(app);
        Ok(())
    }
}
