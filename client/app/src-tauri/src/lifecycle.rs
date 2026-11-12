use crate::files::{self, Session};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Emitter, Manager};

#[derive(Debug, PartialEq)]
pub(crate) enum CloseOutcome {
    AwaitingAi,
    AwaitingFiles,
    Closed,
}

pub(crate) fn close_workspace(
    app: &tauri::AppHandle,
    id: &str,
    participant: Option<(&str, &Session)>,
    commit: impl FnOnce() -> Result<(), String>,
) -> Result<CloseOutcome, String> {
    let result = (|| {
        if quit_pending(app) || crate::recovery::admission_held(app, Some(id)) {
            return Err("native.workspace.close.quitting".into());
        }
        if let Some((window, files)) = participant {
            if !crate::ai::prepare_close(app, id, window)? {
                files::resume_close(files);
                return Ok(CloseOutcome::AwaitingAi);
            }
            if !files.close_ready.load(Ordering::Acquire) {
                app.emit_to(window, "files-close-requested", id)
                    .map_err(|e| e.to_string())?;
                return Ok(CloseOutcome::AwaitingFiles);
            }
        }
        if crate::dictation::active(app, id) {
            if let Some((window, _)) = participant {
                app.emit_to(window, "dictation-close-requested", id)
                    .map_err(|e| e.to_string())?;
            }
            return Ok(CloseOutcome::AwaitingFiles);
        }
        commit()?;
        Ok(CloseOutcome::Closed)
    })();
    if result.is_err() || result == Ok(CloseOutcome::Closed) {
        if result.is_err()
            && let Some((_, files)) = participant
        {
            files::resume_close(files);
        }
        crate::ai::cancel_close(app, id);
    }
    result
}

#[derive(Default)]
pub(crate) struct Quit {
    pub(crate) pending: Mutex<Option<QuitAttempt>>,
    pub(crate) approved: AtomicBool,
    records: Mutex<HashMap<String, QuitRecord>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum QuitStatusKind {
    Pending,
    Cancelled,
    Approved,
}
struct QuitRecord {
    sequence: u64,
    state: QuitStatusKind,
    workspaces: HashMap<String, Vec<String>>,
}
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuitStatus {
    sequence: u64,
    state: QuitStatusKind,
    workspace_ids: Vec<String>,
}
impl QuitRecord {
    fn status(&self, window: &str) -> Result<QuitStatus, String> {
        let workspace_ids = self
            .workspaces
            .get(window)
            .ok_or("native.files.quit.otherWindow")?
            .clone();
        Ok(QuitStatus {
            sequence: self.sequence,
            state: self.state,
            workspace_ids,
        })
    }
}
#[derive(Debug, PartialEq)]
enum QuitPhase {
    Idle,
    Preparing,
    Approved,
}
impl Quit {
    fn status(&self, window: &str, token: &str) -> Result<QuitStatus, String> {
        let _pending = self.pending.lock().map_err(|e| e.to_string())?;
        self.records
            .lock()
            .map_err(|e| e.to_string())?
            .get(token)
            .ok_or("native.files.quit.unknown")?
            .status(window)
    }

    fn cancel(
        &self,
        window: &str,
        token: &str,
        notify: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        let mut records = self.records.lock().map_err(|e| e.to_string())?;
        if let Some(record) = records.get(token) {
            let status = record.status(window)?;
            if status.state == QuitStatusKind::Cancelled {
                return Ok(());
            }
            if status.state == QuitStatusKind::Approved {
                return Err("native.files.quit.finished".into());
            }
        }
        if self.phase(&pending) == QuitPhase::Approved {
            return Err("native.files.quit.finished".into());
        }
        cancel_attempt(&mut pending, window, token)?;
        if let Some(record) = records.get_mut(token) {
            record.state = QuitStatusKind::Cancelled;
        }
        drop(records);
        drop(pending);
        notify()
    }

    fn phase(&self, pending: &Option<QuitAttempt>) -> QuitPhase {
        if self.approved.load(Ordering::Acquire) {
            QuitPhase::Approved
        } else if pending.is_some() {
            QuitPhase::Preparing
        } else {
            QuitPhase::Idle
        }
    }
}
pub(crate) struct QuitAttempt {
    pub(crate) token: String,
    pub(crate) participants: HashMap<String, Vec<Arc<Session>>>,
    pub(crate) ready: HashSet<String>,
}
impl QuitAttempt {
    pub(crate) fn require(&self, window: &str, token: &str) -> Result<(), String> {
        if self.token != token || !self.participants.contains_key(window) {
            return Err("native.files.quit.notPendingForWindow".into());
        }
        Ok(())
    }
    fn rollback(&self) {
        for session in self.participants.values().flatten() {
            files::resume_quit(session, &self.token);
        }
    }
    fn acknowledge(&mut self, window: &str) -> Result<QuitOutcome, String> {
        for session in &self.participants[window] {
            files::pause_for_quit(session, &self.token, false)?;
        }
        self.ready.insert(window.into());
        if self.ready.len() != self.participants.len() {
            return Ok(QuitOutcome::AwaitingWindows);
        }
        let sessions: Vec<_> = self.participants.values().flatten().cloned().collect();
        files::commit_quit(&sessions, false)?;
        Ok(QuitOutcome::Approved)
    }
}
#[derive(Debug, PartialEq)]
pub(crate) enum QuitOutcome {
    AwaitingWindows,
    Approved,
}
pub(crate) fn cancel_attempt(
    pending: &mut Option<QuitAttempt>,
    window: &str,
    token: &str,
) -> Result<(), String> {
    pending
        .as_ref()
        .ok_or("native.files.quit.nonePending")?
        .require(window, token)?;
    pending.take().unwrap().rollback();
    Ok(())
}
pub(crate) fn acknowledge_quit(
    pending: &mut Option<QuitAttempt>,
    window: &str,
    token: &str,
) -> Result<QuitOutcome, String> {
    let attempt = pending.as_mut().ok_or("native.files.quit.nonePending")?;
    attempt.require(window, token)?;
    let result = attempt.acknowledge(window);
    if result.is_err() {
        pending.take().unwrap().rollback();
    }
    result
}

#[tauri::command]
pub(crate) fn lifecycle_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<QuitStatus, String> {
    app.state::<Quit>().status(window.label(), &token)
}

pub fn quit_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    crate::updates::admission_held(app)
        || crate::recovery::admission_held(app, None)
        || ordinary_quit_pending(app)
}
pub(crate) fn ordinary_quit_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.try_state::<Quit>().is_some_and(|quit| {
        quit.pending
            .lock()
            .map(|pending| quit.phase(&pending) != QuitPhase::Idle)
            .unwrap_or(true)
    })
}
#[cfg(feature = "native-smoke")]
pub fn approve_smoke_exit(app: &tauri::AppHandle) {
    app.state::<Quit>().approved.store(true, Ordering::Release);
}
pub fn request_quit(app: &tauri::AppHandle) {
    if crate::updates::admission_held(app) {
        return;
    }
    // File operations can hold workspace leases while waiting for a running process.
    if crate::ai::ensure_quit(app).is_err() {
        return;
    }
    let quit = app.state::<Quit>();
    let attempt =
        crate::workspaces::with_lifecycle_participants(app, |participants, workspaces| {
            let mut pending = quit.pending.lock().ok()?;
            if quit.phase(&pending) != QuitPhase::Idle
                || crate::updates::admission_held(app)
                || crate::recovery::any_pending(app)
                || crate::ai::ensure_quit(app).is_err()
            {
                return None;
            }
            let windows: Vec<_> = participants.keys().cloned().collect();
            let token = uuid::Uuid::new_v4().to_string();
            if participants.is_empty() {
                quit.approved.store(true, Ordering::Release);
            } else {
                let mut records = quit.records.lock().ok()?;
                let sequence = records.len() as u64 + 1;
                records.insert(
                    token.clone(),
                    QuitRecord {
                        sequence,
                        state: QuitStatusKind::Pending,
                        workspaces,
                    },
                );
                *pending = Some(QuitAttempt {
                    token: token.clone(),
                    participants,
                    ready: HashSet::new(),
                });
            }
            Some((token, windows))
        });
    let Some((token, windows)) = attempt else {
        return;
    };
    if windows.is_empty() {
        app.exit(0);
        return;
    }
    for window in windows {
        if app
            .emit_to(&window, "files-quit-requested", &token)
            .is_err()
        {
            let _ = cancel_quit(app, &window, &token);
            break;
        }
    }
}
pub fn exit_requested(app: &tauri::AppHandle, api: &tauri::ExitRequestApi) {
    if app.state::<Quit>().approved.load(Ordering::Acquire) {
        crate::workspaces::exiting(app);
    } else {
        api.prevent_exit();
        let app = app.clone();
        std::thread::spawn(move || request_quit(&app));
    }
}
pub(crate) fn cancel_quit(
    app: &tauri::AppHandle,
    window: &str,
    token: &str,
) -> Result<Value, String> {
    app.state::<Quit>().cancel(window, token, || {
        app.emit("files-quit-cancelled", token)
            .map_err(|e| e.to_string())
    })?;
    Ok(json!({"status":"ok"}))
}
pub(crate) fn quit_ready(
    app: &tauri::AppHandle,
    window: &str,
    token: &str,
) -> Result<Value, String> {
    let quit = app.state::<Quit>();
    let mut pending = quit.pending.lock().map_err(|e| e.to_string())?;
    if quit.phase(&pending) == QuitPhase::Approved {
        return Err("native.files.quit.finished".into());
    }
    if crate::dictation::active_window(app, window) {
        return Err("dictation.busySend".into());
    }
    let mut records = quit.records.lock().map_err(|e| e.to_string())?;
    let result = acknowledge_quit(&mut pending, window, token);
    let cancelled = result.is_err() && pending.is_none();
    if let Some(record) = records.get_mut(token) {
        if cancelled {
            record.state = QuitStatusKind::Cancelled;
        } else if result == Ok(QuitOutcome::Approved) {
            record.state = QuitStatusKind::Approved;
        }
    }
    drop(records);
    if result == Ok(QuitOutcome::Approved) {
        quit.approved.store(true, Ordering::Release);
        pending.take();
    }
    drop(pending);
    if cancelled {
        let _ = app.emit("files-quit-cancelled", token);
    }
    if result? == QuitOutcome::Approved {
        crate::workspaces::exiting(app);
        app.exit(0);
    }
    Ok(json!({"status":"ok"}))
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
