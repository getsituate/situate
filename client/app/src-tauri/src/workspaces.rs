#[cfg(test)]
use crate::conversation_fixtures::FixtureConversations;
#[cfg(feature = "native-smoke")]
#[path = "../tests/support/workspace_failure_smoke.rs"]
pub mod failure_smoke;
#[cfg(feature = "native-smoke")]
#[path = "../tests/support/workspace_smoke.rs"]
pub mod smoke;

use serde::Serialize;
use situate_core::{workspace_registry::Registry, workspaces::Location};
use std::path::Path;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub display: String,
}
impl From<&Location> for Entry {
    fn from(l: &Location) -> Self {
        Self {
            id: l.id.clone(),
            name: l.name.clone(),
            display: l.display.clone(),
        }
    }
}
#[derive(Clone, Serialize)]
pub struct Failure {
    pub location: Entry,
    pub message: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    ready: bool,
    mobile: bool,
    known: Vec<Entry>,
    open: Vec<Entry>,
    current: Option<Entry>,
    ai_setup: bool,
    onboarding: bool,
    onboarding_available: bool,
    failures: Vec<Failure>,
    error: Option<String>,
}
#[derive(Clone)]
struct Session {
    location: Location,
    diagnostic_identity: Option<String>,
    window: String,
    files: Arc<super::files::Session>,
    operations: Arc<Mutex<()>>,
    preparation: Option<Arc<crate::workspace_preparation::PreparedWorkspace>>,
    ai_setup: bool,
}
#[derive(Clone)]
pub(crate) struct AuthorizationSession(Session);

impl AuthorizationSession {
    pub(crate) fn identity(&self) -> usize {
        Arc::as_ptr(&self.0.operations) as usize
    }

    pub(crate) fn file_context(&self) -> (Location, Arc<super::files::Session>) {
        (self.0.location.clone(), self.0.files.clone())
    }
}

#[cfg(test)]
impl AuthorizationSession {
    pub(crate) fn for_test() -> Self {
        Self(Session {
            location: Location {
                id: "authorization-test".into(),
                name: "Authorization test".into(),
                display: "Authorization test".into(),
                kind: "path".into(),
                handle: "authorization-test".into(),
            },
            diagnostic_identity: None,
            window: "main".into(),
            files: Arc::new(super::files::Session::default()),
            operations: Arc::new(Mutex::new(())),
            preparation: None,
            ai_setup: false,
        })
    }
}

struct Inner {
    registry: Registry,
    path: PathBuf,
    sessions: Vec<Session>,
    parents: HashMap<String, Location>,
    ready: bool,
    error: Option<String>,
    failures: Vec<Failure>,
    #[cfg(desktop)]
    next: u64,
}
pub struct Workspaces {
    inner: Mutex<Inner>,
    quitting: AtomicBool,
}

impl Workspaces {
    fn diagnostic_session(
        &self,
        window: &str,
        runtime_scope: &str,
        mobile: bool,
    ) -> Option<(String, Arc<super::files::Session>)> {
        let inner = self.inner.try_lock().ok()?;
        self.diagnostic_binding(&inner, window, runtime_scope, mobile)
    }

    fn diagnostic_binding(
        &self,
        inner: &Inner,
        window: &str,
        runtime_scope: &str,
        mobile: bool,
    ) -> Option<(String, Arc<super::files::Session>)> {
        if self.quitting.load(Ordering::Relaxed) {
            return None;
        }
        let session = storage_session(&inner.sessions, window, runtime_scope, mobile).ok()?;
        Some((session.diagnostic_identity.clone()?, session.files.clone()))
    }

    // Lock order: session leases (workspace ID order for quit), registry, quit state, participants.
    // Operation callbacks retain only their session lease and must not acquire another lease.
    fn current_session(
        &self,
        window: &str,
        expected: &str,
        mobile: bool,
    ) -> Result<Session, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        scoped_session(&inner.sessions, window, expected, mobile).cloned()
    }

    fn with_operation<T>(
        &self,
        window: &str,
        expected: &str,
        mobile: bool,
        quit_pending: impl FnOnce() -> bool,
        operation: impl FnOnce(&Location) -> Result<T, String>,
    ) -> Result<T, String> {
        let candidate = self.current_session(window, expected, mobile)?;
        self.with_operation_candidate(window, expected, mobile, candidate, quit_pending, operation)
    }

    fn with_operation_candidate<T>(
        &self,
        window: &str,
        expected: &str,
        mobile: bool,
        candidate: Session,
        quit_pending: impl FnOnce() -> bool,
        operation: impl FnOnce(&Location) -> Result<T, String>,
    ) -> Result<T, String> {
        // Never wait for a workspace lease while holding the registry. Revalidate after waiting:
        // the same workspace ID may now belong to a newly opened session.
        let _lease = candidate
            .operations
            .lock()
            .map_err(|_| "native.workspace.operations.unavailable")?;
        let location = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "native.workspace.state.unavailable")?;
            let current = scoped_session(&inner.sessions, window, expected, mobile)?;
            require_generation(Some(current), Some(&candidate))?;
            if self.quitting.load(Ordering::SeqCst) || quit_pending() {
                return Err("native.workspace.quitting".into());
            }
            current.location.clone()
        };
        operation(&location)
    }

    fn with_open_storage_operation<T>(
        &self,
        window: &str,
        expected: &str,
        mobile: bool,
        operation: impl FnOnce(&Location) -> Result<T, String>,
    ) -> Result<T, String> {
        let candidate = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "native.workspace.state.unavailable")?;
            storage_session(&inner.sessions, window, expected, mobile)?.clone()
        };
        self.with_storage_candidate(window, expected, mobile, candidate, operation)
    }

    fn with_storage_candidate<T>(
        &self,
        window: &str,
        expected: &str,
        mobile: bool,
        candidate: Session,
        operation: impl FnOnce(&Location) -> Result<T, String>,
    ) -> Result<T, String> {
        let _lease = candidate
            .operations
            .lock()
            .map_err(|_| "native.workspace.operations.unavailable")?;
        let location = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "native.workspace.state.unavailable")?;
            let current = storage_session(&inner.sessions, window, expected, mobile)?;
            require_generation(Some(current), Some(&candidate))?;
            if self.quitting.load(Ordering::SeqCst) {
                return Err("native.workspace.quitting".into());
            }
            current.location.clone()
        };
        operation(&location)
    }

    fn authorization_session(
        &self,
        window: &str,
        expected: &str,
        mobile: bool,
        quit_pending: impl FnOnce() -> bool,
    ) -> Result<AuthorizationSession, String> {
        let candidate = self.current_session(window, expected, mobile)?;
        if candidate.window != window {
            return Err("native.workspace.session.inactive".into());
        }
        self.with_operation_candidate(
            window,
            expected,
            mobile,
            candidate.clone(),
            quit_pending,
            |_| Ok(AuthorizationSession(candidate)),
        )
    }

    fn with_authorization_session<T>(
        &self,
        window: &str,
        authorization: &AuthorizationSession,
        quit_pending: impl FnOnce() -> bool,
        operation: impl FnOnce(&Location) -> Result<T, String>,
    ) -> Result<T, String> {
        let candidate = &authorization.0;
        if candidate.window != window {
            return Err("native.workspace.session.inactive".into());
        }
        let _lease = candidate
            .operations
            .lock()
            .map_err(|_| "native.workspace.operations.unavailable")?;
        let location = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "native.workspace.state.unavailable")?;
            let current = inner
                .sessions
                .iter()
                .find(|session| {
                    session.location.id == candidate.location.id && session.window == window
                })
                .ok_or("native.workspace.session.inactive")?;
            require_generation(Some(current), Some(candidate))?;
            if self.quitting.load(Ordering::SeqCst) || quit_pending() {
                return Err("native.workspace.quitting".into());
            }
            current.location.clone()
        };
        operation(&location)
    }

    fn with_authorized_read<P, T>(
        &self,
        window: &str,
        authorization: &AuthorizationSession,
        quit_pending: impl Fn() -> bool,
        prepare: impl FnOnce(&Location) -> Result<P, String>,
        read: impl FnOnce(&P) -> Result<T, String>,
    ) -> Result<T, String> {
        // Long reads must not block Stop; retain prepared guards through the final generation check.
        let prepared =
            self.with_authorization_session(window, authorization, &quit_pending, prepare)?;
        let result = read(&prepared);
        self.with_authorization_session(window, authorization, quit_pending, |_| result)
    }

    fn with_close_session<T>(
        &self,
        window: &str,
        id: &str,
        mobile: bool,
        operation: impl FnOnce(Option<&Session>) -> Result<T, String>,
    ) -> Result<T, String> {
        let candidate = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "native.workspace.state.unavailable")?;
            if let Some(error) = &inner.error {
                return Err(error.clone());
            }
            let session = inner.sessions.iter().find(|s| s.location.id == id);
            if !mobile
                && !is_entry_window(&inner, window)
                && !session.is_some_and(|s| s.window == window)
            {
                return Err("native.workspace.close.other".into());
            }
            session.cloned()
        };
        let _lease = candidate
            .as_ref()
            .map(|session| session.operations.lock())
            .transpose()
            .map_err(|_| "native.workspace.operations.unavailable")?;
        {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "native.workspace.state.unavailable")?;
            require_generation(
                inner.sessions.iter().find(|s| s.location.id == id),
                candidate.as_ref(),
            )?;
        }
        operation(candidate.as_ref())
    }

    fn authorization_expired(
        &self,
        window: &str,
        authorization: &AuthorizationSession,
    ) -> Result<bool, String> {
        let candidate = &authorization.0;
        let inner = self
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        let current = inner.sessions.iter().find(|session| {
            session.location.id == candidate.location.id && session.window == window
        });
        Ok(candidate.window != window || require_generation(current, Some(candidate)).is_err())
    }

    fn with_authorized_control<T>(
        &self,
        window: &str,
        authorization: &AuthorizationSession,
        quit_pending: impl FnOnce() -> bool,
        control: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let candidate = &authorization.0;
        let inner = self
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        if candidate.window != window {
            return Err("native.workspace.session.inactive".into());
        }
        let current = inner
            .sessions
            .iter()
            .find(|session| {
                session.location.id == candidate.location.id && session.window == window
            })
            .ok_or("native.workspace.session.inactive")?;
        require_generation(Some(current), Some(candidate))?;
        if self.quitting.load(Ordering::SeqCst) || quit_pending() {
            return Err("native.workspace.quitting".into());
        }
        // Order workspace closure with control without waiting for I/O; control must not re-enter the registry.
        control()
    }

    fn with_process_control<T>(
        &self,
        window: &str,
        scope: &str,
        mobile: bool,
        control: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        scoped_session(&inner.sessions, window, scope, mobile)?;
        control()
    }

    fn with_quit_sessions<T>(&self, operation: impl FnOnce(&Inner) -> T) -> T {
        loop {
            let mut sessions = self.inner.lock().unwrap().sessions.clone();
            sessions.sort_by(|a, b| a.location.id.cmp(&b.location.id));
            let _leases: Vec<_> = sessions
                .iter()
                .map(|session| session.operations.lock().unwrap())
                .collect();
            let inner = self.inner.lock().unwrap();
            if inner.sessions.len() != sessions.len()
                || sessions.iter().any(|candidate| {
                    require_generation(
                        inner
                            .sessions
                            .iter()
                            .find(|s| s.location.id == candidate.location.id),
                        Some(candidate),
                    )
                    .is_err()
                })
            {
                continue;
            }
            // The registry and all session leases stay held until quit admission is published.
            return operation(&inner);
        }
    }
}

fn require_generation(
    current: Option<&Session>,
    candidate: Option<&Session>,
) -> Result<(), String> {
    match (current, candidate) {
        (None, None) => Ok(()),
        (Some(current), Some(candidate))
            if Arc::ptr_eq(&current.operations, &candidate.operations) =>
        {
            Ok(())
        }
        _ => Err(
            "This workspace session has changed. Retry the action in its current window.".into(),
        ),
    }
}

fn emit(app: &tauri::AppHandle) {
    let _ = app.emit("workspaces-changed", ());
}
fn native(
    app: &tauri::AppHandle,
    operation: &str,
    location: Option<&Location>,
    name: Option<&str>,
) -> Result<Option<Location>, String> {
    #[cfg(mobile)]
    {
        let response = app
            .state::<tauri_plugin_workspace_access::Access>()
            .request(
                serde_json::json!({"operation": operation, "location": location, "name": name.unwrap_or("")}),
            )?;
        serde_json::from_value(
            response
                .get("location")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        )
        .map_err(|_| "native.workspace.provider.invalidResponse".into())
    }
    #[cfg(desktop)]
    {
        use situate_core::workspaces as fs;
        let path = || -> Result<&Path, String> {
            let loc = location.ok_or("native.workspace.folder.choose")?;
            if loc.kind != "path" {
                return Err("native.workspace.handle.unsupportedOnDevice".into());
            }
            Ok(Path::new(&loc.handle))
        };
        match operation {
            "default" => Ok(app
                .path()
                .document_dir()
                .ok()
                .and_then(|p| fs::location(&p).ok())),
            "pick" => rfd::FileDialog::new()
                .set_title(situate_core::messages::text(
                    super::device_locale::preferences(app).language,
                    "native.workspace.dialog.chooseFolder",
                ))
                .pick_folder()
                .map(|p| fs::location(&p))
                .transpose(),
            "inspect" => fs::inspect(path()?).map(Some),
            "preflight" => {
                fs::preflight(path()?, name.ok_or("native.workspace.name.required")?)?;
                Ok(location.cloned())
            }
            "create" => {
                #[cfg(target_os = "macos")]
                let create = fs::create_for_onboarding;
                #[cfg(not(target_os = "macos"))]
                let create = fs::create;
                create(path()?, name.ok_or("native.workspace.name.required")?).map(Some)
            }
            _ => Err("native.workspace.operation.unknownFolder".into()),
        }
    }
}
fn inspect(app: &tauri::AppHandle, l: &Location) -> Result<Location, String> {
    native(app, "inspect", Some(l), None)?.ok_or("native.workspace.provider.noLocation".into())
}
fn admit_diagnostic_identity(app: &tauri::AppHandle, location: &Location) -> Option<String> {
    #[cfg(desktop)]
    {
        let _ = app;
        (location.kind == "path")
            .then(|| situate_core::workspace_identity::admit(Path::new(&location.handle)))
            .flatten()
    }
    #[cfg(mobile)]
    {
        let response = app
            .state::<tauri_plugin_workspace_access::Access>()
            .request(serde_json::json!({"operation": "identity", "location": location}))
            .ok()?;
        let id = response.get("workspaceId")?.as_str()?;
        let document = serde_json::to_vec(&serde_json::json!({"version": 1, "id": id})).ok()?;
        situate_core::workspace_identity::validate(&document)
    }
}

pub fn diagnostic_session(
    app: &tauri::AppHandle,
    window: &str,
    runtime_scope: &str,
) -> Option<(String, Arc<super::files::Session>)> {
    app.try_state::<Workspaces>()?
        .diagnostic_session(window, runtime_scope, cfg!(mobile))
}

pub async fn diagnostic_registration(
    app: tauri::AppHandle,
    window: String,
    runtime_scope: String,
) -> Option<(String, Arc<super::files::Session>)> {
    // Registration may wait for workspace admission, but never on the event/UI path.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.try_state::<Workspaces>()?;
        let inner = state.inner.lock().ok()?;
        state.diagnostic_binding(&inner, &window, &runtime_scope, cfg!(mobile))
    })
    .await
    .ok()
    .flatten()
}

fn persist(inner: &mut Inner, next: Registry) -> Result<(), String> {
    next.save(&inner.path)?;
    inner.registry = next;
    Ok(())
}
#[cfg(desktop)]
fn entry_window(inner: &mut Inner, app: &tauri::AppHandle) -> Result<(), String> {
    let main = app
        .webview_windows()
        .into_values()
        .find(|window| is_entry_window(inner, window.label()));
    let main = if let Some(main) = main {
        main
    } else {
        inner.next += 1;
        let mut config = app
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == "main")
            .cloned()
            .ok_or("native.workspace.window.entryUnavailable")?;
        config.label = format!("workspace-{}", inner.next);
        crate::windows::build(app, config).map_err(|_| "native.workspace.window.openFailed")?
    };
    main.show()
        .map_err(|_| "native.workspace.window.entryShowFailed")?;
    main.set_focus()
        .map_err(|_| "native.workspace.window.entryFocusFailed".into())
}
fn is_entry_window(inner: &Inner, window: &str) -> bool {
    (window == "main" || window.starts_with("workspace-"))
        && !inner
            .sessions
            .iter()
            .any(|session| session.window == window)
}
#[cfg(mobile)]
fn entry_window(_inner: &mut Inner, app: &tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("native.workspace.window.entryUnavailable")?;
    main.show()
        .and_then(|_| main.set_focus())
        .map_err(|_| "native.workspace.window.entryShowFailed".into())
}
fn prepare_session(
    sessions: &[Session],
    location: &Location,
    prepare: impl FnOnce() -> Result<Arc<crate::workspace_preparation::PreparedWorkspace>, String>,
) -> Result<Option<Arc<crate::workspace_preparation::PreparedWorkspace>>, String> {
    if let Some(session) = sessions.iter().find(|s| s.location.id == location.id) {
        if let Some(preparation) = &session.preparation {
            preparation.validate()?;
        }
        return Ok(session.preparation.clone());
    }
    prepare().map(Some)
}

fn open(
    inner: &mut Inner,
    app: &tauri::AppHandle,
    location: Location,
    remember: bool,
    creation_window: Option<&str>,
) -> Result<(), String> {
    open_with_accent(inner, app, location, remember, creation_window, None)
}

fn open_with_accent(
    inner: &mut Inner,
    app: &tauri::AppHandle,
    location: Location,
    remember: bool,
    creation_window: Option<&str>,
    accent: Option<situate_core::appearance::Accent>,
) -> Result<(), String> {
    if crate::lifecycle::quit_pending(app)
        || crate::recovery::admission_held(app, Some(&location.id))
    {
        return Err("native.workspace.open.quitting".into());
    }
    let existing = inner
        .sessions
        .iter()
        .position(|s| s.location.id == location.id);
    let preparation = prepare_session(&inner.sessions, &location, || {
        crate::workspace_preparation::prepare(app, &location).map(Arc::new)
    })?;
    if let Some(accent) = accent {
        let root = super::files::local_root(app, &location)?.ok_or("native.appearance.readOnly")?;
        situate_core::appearance::Storage::open(&root)?.update(accent, None)?;
    }
    let onboarding = onboarding_incomplete(app, &location)?;
    #[cfg(desktop)]
    let window = if let Some(index) = existing {
        app.get_webview_window(&inner.sessions[index].window)
            .ok_or("native.workspace.window.unavailable")?
    } else if let Some(label) = creation_window {
        if inner.sessions.iter().any(|session| session.window == label) {
            return Err("native.workspace.window.unavailable".into());
        }
        app.get_webview_window(label)
            .ok_or("native.workspace.window.unavailable")?
    } else {
        inner.next += 1;
        let label = format!("workspace-{}", inner.next);
        crate::windows::build(
            app,
            tauri::utils::config::WindowConfig {
                label,
                title: format!("{} — Situate", location.name),
                url: tauri::WebviewUrl::App("index.html".into()),
                width: if cfg!(feature = "native-smoke") {
                    768.
                } else {
                    1280.
                },
                height: 800.,
                min_width: Some(320.),
                min_height: Some(360.),
                visible: false,
                drag_drop_enabled: false,
                ..Default::default()
            },
        )
        .map_err(|_| "native.workspace.window.openFailed")?
    };
    let mut next = inner.registry.clone();
    next.opened(location.clone(), remember);
    if let Err(e) = persist(inner, next) {
        #[cfg(desktop)]
        if existing.is_none() && creation_window.is_none() {
            let _ = window.destroy();
        }
        return Err(situate_core::messages::error(
            "native.workspace.open.rememberFailed",
            serde_json::json!({"error": e}),
        ));
    }
    #[cfg(desktop)]
    window
        .set_title(&format!("{} — Situate", location.name))
        .map_err(|_| "native.workspace.window.presentFailed")?;
    let (files, operations, diagnostic_identity) = if let Some(index) = existing {
        let session = inner.sessions.remove(index);
        (
            session.files,
            session.operations,
            session.diagnostic_identity,
        )
    } else {
        (
            Arc::new(super::files::Session::default()),
            Arc::new(Mutex::new(())),
            admit_diagnostic_identity(app, &location),
        )
    };
    super::localization::initialize(app, &location);
    inner.sessions.push(Session {
        diagnostic_identity,
        files,
        operations,
        preparation,
        location,
        ai_setup: onboarding,
        #[cfg(desktop)]
        window: window.label().to_owned(),
        #[cfg(mobile)]
        window: "main".into(),
    });
    #[cfg(desktop)]
    {
        if creation_window.is_none()
            && window
                .show()
                .and_then(|_| window.unminimize())
                .and_then(|_| window.set_focus())
                .is_err()
        {
            if existing.is_none() {
                inner.sessions.pop();
                let _ = window.destroy();
            }
            return Err("native.workspace.window.presentFailed".into());
        }
        for entry in app.webview_windows().into_values() {
            if is_entry_window(inner, entry.label()) {
                let _ = entry.hide();
            }
        }
    }
    if existing.is_none() {
        crate::diagnostics::workspace_event(
            app,
            inner
                .sessions
                .last()
                .and_then(|s| s.diagnostic_identity.as_deref()),
            true,
        );
    }
    Ok(())
}
fn close_session(app: &tauri::AppHandle, window: &str, id: &str) -> Result<bool, String> {
    let state = app.state::<Workspaces>();
    let process_window = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        let session = inner
            .sessions
            .iter()
            .find(|session| session.location.id == id);
        if !cfg!(mobile)
            && !is_entry_window(&inner, window)
            && !session.is_some_and(|session| session.window == window)
        {
            return Err("native.workspace.close.other".into());
        }
        if let Some(session) = session
            && crate::plugin_host::prepare_process_close(app, id)?
        {
            Some(session.window.clone())
        } else {
            None
        }
    };
    if let Some(window) = process_window {
        let _ = app.emit_to(&window, "ai-close-requested", ());
        return Ok(false);
    }
    let result = state.with_close_session(window, id, cfg!(mobile), |participant| {
        let outcome = crate::lifecycle::close_workspace(
            app,
            id,
            participant.map(|session| (session.window.as_str(), session.files.as_ref())),
            || {
                let mut inner = state
                    .inner
                    .lock()
                    .map_err(|_| "native.workspace.state.unavailable")?;
                require_generation(
                    inner.sessions.iter().find(|s| s.location.id == id),
                    participant,
                )?;
                if crate::lifecycle::quit_pending(app) {
                    return Err("native.workspace.close.quitting".into());
                }
                commit_close(&mut inner, app, id)
            },
        )?;
        Ok(outcome == crate::lifecycle::CloseOutcome::Closed && participant.is_some())
    });
    if result.is_err() {
        crate::ai::cancel_close(app, id);
    }
    result
}

fn commit_close(inner: &mut Inner, app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    // Show the entry before committing; presentation failure must leave the session open.
    if inner
        .sessions
        .iter()
        .all(|session| session.location.id == id)
    {
        entry_window(inner, app)?;
    }
    if let Some(session) = close_record(inner, id)? {
        app.state::<crate::ai_conversations::Conversations>()
            .invalidate_scope(id);
        crate::plugin_changes::invalidate_scope(app, id);
        crate::plugin_host::invalidate_scope(app, id);
        crate::plugin_disable::invalidate_scope(app, id);
        crate::plugin_actions::invalidate_scope(app, id);
        crate::plugin_recovery::forget_scope(app, id);
        crate::diagnostics::workspace_event(app, session.diagnostic_identity.as_deref(), false);
        super::files::complete_close(&session.files);
        #[cfg(desktop)]
        if let Some(window) = app.get_webview_window(&session.window)
            && window.destroy().is_err()
        {
            inner.failures.push(Failure {
                location: (&session.location).into(),
                message: "native.workspace.window.dismissFailed".into(),
            });
        }
    }
    Ok(())
}

fn close_record(inner: &mut Inner, id: &str) -> Result<Option<Session>, String> {
    let mut next = inner.registry.clone();
    next.close(id);
    persist(inner, next)?;
    inner.failures.retain(|failure| failure.location.id != id);
    Ok(inner
        .sessions
        .iter()
        .position(|session| session.location.id == id)
        .map(|index| inner.sessions.remove(index)))
}

pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    crate::windows::setup(app)?;
    let path = app.path().app_data_dir()?.join("workspaces-v1.json");
    let loaded = Registry::load(&path);
    let (registry, error) = match loaded {
        Ok(r) => (r, None),
        Err(e) => (Registry::default(), Some(e)),
    };
    app.manage(crate::lifecycle::Quit::default());
    app.manage(Workspaces {
        inner: Mutex::new(Inner {
            registry,
            path,
            sessions: vec![],
            parents: HashMap::new(),
            ready: false,
            error,
            failures: vec![],
            #[cfg(desktop)]
            next: 0,
        }),
        quitting: AtomicBool::new(false),
    });
    super::localization::watch(app.clone());
    super::appearance::watch(app.clone());
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<Workspaces>();
        let mut inner = state.inner.lock().unwrap();
        if inner.error.is_none() {
            restore(&mut inner, &app);
        }
        inner.ready = true;
        if inner.sessions.is_empty() || cfg!(mobile) {
            let _ = entry_window(&mut inner, &app);
        }
        drop(inner);
        emit(&app);
    });
    Ok(())
}
#[cfg(any(target_os = "macos", test))]
fn stored_onboarding_incomplete(root: &Path, scope: &str) -> Result<bool, String> {
    Ok(
        situate_core::onboarding::OnboardingStorage::open(root, scope)?
            .load()?
            .record
            .is_some_and(|record| {
                !record.entered && record.step != situate_core::onboarding::Step::Complete
            }),
    )
}

fn onboarding_incomplete(app: &tauri::AppHandle, location: &Location) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let root =
            crate::files::local_root(app, location)?.ok_or("native.onboarding.storage.failed")?;
        stored_onboarding_incomplete(&root, &location.id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, location);
        Ok(false)
    }
}

fn restore(inner: &mut Inner, app: &tauri::AppHandle) {
    for location in inner.registry.restore.clone() {
        let result = inspect(app, &location).and_then(|l| open(inner, app, l, false, None));
        if let Err(message) = result {
            inner.failures.push(Failure {
                location: (&location).into(),
                message,
            });
        }
    }
}

#[tauri::command]
pub async fn workspace_snapshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspaces>();
        let inner = state
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        let current = if cfg!(mobile) {
            inner.sessions.last()
        } else {
            inner.sessions.iter().find(|s| s.window == window.label())
        };
        Ok(Snapshot {
            ready: inner.ready,
            mobile: cfg!(mobile),
            known: inner.registry.known.iter().map(Entry::from).collect(),
            open: inner
                .sessions
                .iter()
                .rev()
                .map(|s| Entry::from(&s.location))
                .collect(),
            current: current.map(|s| Entry::from(&s.location)),
            ai_setup: current.is_some_and(|s| s.ai_setup),
            onboarding: current
                .is_some_and(|s| onboarding_incomplete(&app, &s.location).unwrap_or(true)),
            onboarding_available: cfg!(target_os = "macos"),
            failures: inner.failures.clone(),
            error: inner.error.clone(),
        })
    })
    .await
    .map_err(|_| "native.workspace.state.unavailable".to_owned())?
}

#[tauri::command]
pub async fn workspace_parent(app: tauri::AppHandle, pick: bool) -> Result<Option<Entry>, String> {
    #[cfg(feature = "native-smoke")]
    if !pick && std::env::var_os("SITUATE_ONBOARDING_HANDOFF_PHASE").is_some() {
        return smoke::smoke_parent(app).await.map(Some);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let location = native(&app, if pick { "pick" } else { "default" }, None, None)?;
        let state = app.state::<Workspaces>();
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        Ok(location.map(|l| {
            let entry = Entry::from(&l);
            inner.parents.insert(l.id.clone(), l);
            entry
        }))
    })
    .await
    .map_err(|_| "native.workspace.picker.unavailable".to_owned())?
}

#[tauri::command]
pub async fn workspace_preflight(
    app: tauri::AppHandle,
    parent: String,
    name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        situate_core::workspaces::validate_name(&name)?;
        let state = app.state::<Workspaces>();
        let inner = state
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        let location = inner
            .parents
            .get(&parent)
            .ok_or("native.workspace.parent.chooseAgain")?;
        native(&app, "preflight", Some(location), Some(&name))?;
        if location.display.starts_with("native.") || location.display.starts_with('{') {
            Ok(situate_core::messages::error(
                "native.workspace.location.child",
                serde_json::json!({"parent": location.display, "name":name}),
            ))
        } else {
            Ok(format!(
                "{}/{}",
                location.display.trim_end_matches('/'),
                name
            ))
        }
    })
    .await
    .map_err(|_| "native.workspace.create.checkFailed".to_owned())?
}

#[tauri::command]
pub async fn workspace_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    id: Option<String>,
    name: Option<String>,
    accent: Option<situate_core::appearance::Accent>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if action == "quit" {
            {
                let state = app.state::<Workspaces>();
                let inner = state
                    .inner
                    .lock()
                    .map_err(|_| "native.workspace.state.unavailable")?;
                if let Some(error) = &inner.error {
                    return Err(error.clone());
                }
            }
            crate::ai::ensure_quit(&app)?;
            let quitting_app = app.clone();
            std::thread::spawn(move || crate::lifecycle::request_quit(&quitting_app));
            return Ok(true);
        }
        if action == "close" {
            let result = close_session(
                &app,
                window.label(),
                id.as_deref().ok_or("native.workspace.choose")?,
            );
            emit(&app);
            return result;
        }
        if matches!(action.as_str(), "pick" | "regrant") {
            let Some(selected) = native(&app, "pick", None, None)? else {
                return Ok(false);
            };
            let selected = inspect(&app, &selected)?;
            if action == "regrant" && Some(selected.id.as_str()) != id.as_deref() {
                return Err("native.workspace.location.mismatch".into());
            }
            let state = app.state::<Workspaces>();
            let mut inner = state
                .inner
                .lock()
                .map_err(|_| "native.workspace.state.unavailable")?;
            if let Some(error) = &inner.error {
                return Err(error.clone());
            }
            let selected_id = selected.id.clone();
            open(&mut inner, &app, selected, action == "pick", None)?;
            inner
                .failures
                .retain(|failure| failure.location.id != selected_id);
            drop(inner);
            emit(&app);
            return Ok(true);
        }
        let state = app.state::<Workspaces>();
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        let result = act(
            &mut inner,
            &app,
            window.label(),
            &action,
            id.as_deref(),
            name.as_deref(),
            accent,
        );
        drop(inner);
        emit(&app);
        result
    })
    .await
    .map_err(|_| "native.workspace.operation.failed".to_owned())?
}
fn act(
    inner: &mut Inner,
    app: &tauri::AppHandle,
    window: &str,
    action: &str,
    id: Option<&str>,
    name: Option<&str>,
    accent: Option<situate_core::appearance::Accent>,
) -> Result<bool, String> {
    if action == "reload" && inner.error.is_some() {
        inner.registry = Registry::load(&inner.path)?;
        inner.error = None;
        restore(inner, app);
        return Ok(true);
    }
    if let Some(error) = &inner.error {
        return Err(error.clone());
    }
    let result = match action {
        "entry" => entry_window(inner, app),
        "ai-setup-done" => {
            let session = if cfg!(mobile) {
                inner.sessions.last_mut()
            } else {
                inner.sessions.iter_mut().find(|s| s.window == window)
            };
            let session = session.ok_or("native.workspace.open.required")?;
            if onboarding_incomplete(app, &session.location)? {
                return Err("native.onboarding.storage.incomplete".into());
            }
            session.ai_setup = false;
            Ok(())
        }
        "background" => {
            #[cfg(target_os = "android")]
            native(app, "background", None, None)?;
            Ok(())
        }
        "create" => {
            let name = name.ok_or("native.workspace.name.required")?;
            situate_core::workspaces::validate_name(name)?;
            let parent = inner
                .parents
                .get(id.ok_or("native.workspace.parent.choose")?)
                .ok_or("native.workspace.parent.chooseAgain")?;
            let created = native(app, "create", Some(parent), Some(name))?
                .ok_or("native.workspace.create.none")?;
            let display = created.display.clone();
            let creation_window = is_entry_window(inner, window).then_some(window);
            open_with_accent(inner, app, created, true, creation_window, accent).map_err(|e| {
                situate_core::messages::error(
                    "native.workspace.create.openFailed",
                    serde_json::json!({"display":display, "error":e}),
                )
            })?;
            if let Some(session) = inner.sessions.last_mut() {
                session.ai_setup = true;
            }
            Ok(())
        }
        "open" => {
            let id = id.ok_or("native.workspace.choose")?;
            let location = inner
                .sessions
                .iter()
                .map(|s| &s.location)
                .chain(inner.registry.known.iter())
                .chain(inner.registry.restore.iter())
                .find(|l| l.id == id)
                .cloned()
                .ok_or("native.workspace.notListed")?;
            let checked = inspect(app, &location).inspect_err(|message| {
                inner.failures.retain(|f| f.location.id != id);
                inner.failures.push(Failure {
                    location: (&location).into(),
                    message: message.clone(),
                });
            })?;
            open(inner, app, checked, false, None)?;
            inner.failures.retain(|f| f.location.id != id);
            Ok(())
        }
        "remove" => {
            let mut next = inner.registry.clone();
            next.remove(id.ok_or("native.workspace.choose")?);
            persist(inner, next)
        }
        _ => Err("native.workspace.operation.unknown".into()),
    };
    result.map(|_| true)
}

pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    #[cfg(desktop)]
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        let Some(state) = app.try_state::<Workspaces>() else {
            return;
        };
        if state.quitting.load(Ordering::SeqCst) {
            return;
        }
        api.prevent_close();
        let app = app.clone();
        let label = window.label().to_owned();
        std::thread::spawn(move || {
            let state = app.state::<Workspaces>();
            let inner = state.inner.lock().unwrap();
            if !inner.sessions.iter().any(|session| session.window == label) {
                let has_sessions = !inner.sessions.is_empty();
                drop(inner);
                if has_sessions {
                    if let Some(main) = app.get_webview_window(&label) {
                        let _ = main.hide();
                    }
                } else {
                    crate::lifecycle::request_quit(&app);
                }
            } else {
                let id = inner
                    .sessions
                    .iter()
                    .find(|s| s.window == label)
                    .map(|s| s.location.id.clone());
                drop(inner);
                if let Some(id) = id
                    && let Err(message) = close_session(&app, &label, &id)
                {
                    let mut inner = state.inner.lock().unwrap();
                    if let Some(location) = inner
                        .sessions
                        .iter()
                        .find(|s| s.location.id == id)
                        .map(|s| Entry::from(&s.location))
                    {
                        inner.failures.retain(|f| f.location.id != id);
                        inner.failures.push(Failure { location, message });
                    }
                    let _ = entry_window(&mut inner, &app);
                }
            }
            emit(&app);
        });
    }
    #[cfg(mobile)]
    let _ = (window, event);
}
pub(crate) fn authorization_expired(
    app: &tauri::AppHandle,
    window: &str,
    authorization: &AuthorizationSession,
) -> Result<bool, String> {
    app.state::<Workspaces>()
        .authorization_expired(window, authorization)
}

// Control callbacks must not acquire operation leases or perform file I/O.
pub(crate) fn with_authorized_control<T>(
    app: &tauri::AppHandle,
    window: &str,
    authorization: &AuthorizationSession,
    control: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>().with_authorized_control(
        window,
        authorization,
        || crate::lifecycle::quit_pending(app),
        control,
    )
}

pub(crate) fn with_process_control<T>(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    control: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>()
        .with_process_control(window, scope, cfg!(mobile), control)
}

pub fn file_session(
    app: &tauri::AppHandle,
    window: &str,
    id: &str,
) -> Result<(Location, Arc<super::files::Session>), String> {
    let state = app.state::<Workspaces>();
    let inner = state
        .inner
        .lock()
        .map_err(|_| "native.workspace.state.unavailable")?;
    let session = inner
        .sessions
        .iter()
        .find(|s| s.window == window && s.location.id == id)
        .ok_or("native.workspace.session.notOwned")?;
    Ok((session.location.clone(), session.files.clone()))
}
#[cfg(feature = "native-smoke")]
pub fn file_participants(
    app: &tauri::AppHandle,
) -> HashMap<String, Vec<Arc<super::files::Session>>> {
    with_file_participants(app, |participants| participants)
}
#[cfg(feature = "native-smoke")]
pub fn with_file_participants<T>(
    app: &tauri::AppHandle,
    operation: impl FnOnce(HashMap<String, Vec<Arc<super::files::Session>>>) -> T,
) -> T {
    with_lifecycle_participants(app, |participants, _| operation(participants))
}
pub(crate) fn with_lifecycle_participants<R: tauri::Runtime, T>(
    app: &tauri::AppHandle<R>,
    operation: impl FnOnce(
        HashMap<String, Vec<Arc<super::files::Session>>>,
        HashMap<String, Vec<String>>,
    ) -> T,
) -> T {
    let state = app.state::<Workspaces>();
    state.with_quit_sessions(|inner| {
        let mut participants: HashMap<String, Vec<Arc<super::files::Session>>> = HashMap::new();
        let mut workspace_ids: HashMap<String, Vec<String>> = HashMap::new();
        for session in &inner.sessions {
            participants
                .entry(session.window.clone())
                .or_default()
                .push(session.files.clone());
            workspace_ids
                .entry(session.window.clone())
                .or_default()
                .push(session.location.id.clone());
        }
        operation(participants, workspace_ids)
    })
}
pub(crate) fn reopen_recovery(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    expected: &Arc<super::files::Session>,
) -> Result<(), String> {
    let state = app.state::<Workspaces>();
    let candidate = {
        let inner = state.inner.lock().map_err(|_| "native.recovery.failed")?;
        inner
            .sessions
            .iter()
            .find(|s| {
                s.window == window && s.location.id == scope && Arc::ptr_eq(&s.files, expected)
            })
            .cloned()
            .ok_or("native.recovery.failed")?
    };
    let _lease = candidate
        .operations
        .lock()
        .map_err(|_| "native.recovery.failed")?;
    let mut inner = state.inner.lock().map_err(|_| "native.recovery.failed")?;
    let session = inner
        .sessions
        .iter_mut()
        .find(|s| s.window == window && s.location.id == scope && Arc::ptr_eq(&s.files, expected))
        .ok_or("native.recovery.failed")?;
    if let Some(preparation) = &session.preparation {
        preparation.validate()?;
    }
    let location = session.location.clone();
    let onboarding = onboarding_incomplete(app, &location)?;
    super::files::commit_quit(std::slice::from_ref(expected), false)?;
    app.state::<crate::ai_conversations::Conversations>()
        .invalidate_scope(scope);
    crate::plugin_changes::invalidate_scope(app, scope);
    crate::plugin_host::invalidate_scope(app, scope);
    crate::plugin_disable::invalidate_scope(app, scope);
    crate::plugin_actions::invalidate_scope(app, scope);
    session.files = Arc::new(super::files::Session::default());
    session.operations = Arc::new(Mutex::new(()));
    session.ai_setup = onboarding;
    super::localization::initialize(app, &location);
    Ok(())
}

pub(crate) struct RetainedLocation {
    location: Location,
    _preparation: Option<Arc<crate::workspace_preparation::PreparedWorkspace>>,
}

impl std::ops::Deref for RetainedLocation {
    type Target = Location;

    fn deref(&self) -> &Location {
        &self.location
    }
}

fn retained_locations(sessions: &[Session]) -> Vec<RetainedLocation> {
    sessions
        .iter()
        .map(|session| RetainedLocation {
            location: session.location.clone(),
            _preparation: session.preparation.clone(),
        })
        .collect()
}

pub(crate) fn observed_locations(app: &tauri::AppHandle) -> Option<Vec<RetainedLocation>> {
    let state = app.state::<Workspaces>();
    let inner = state.inner.try_lock().ok()?;
    Some(retained_locations(&inner.sessions))
}

pub(crate) fn plugin_recovery_locations(app: &tauri::AppHandle) -> Option<Vec<RetainedLocation>> {
    let state = app.state::<Workspaces>();
    let inner = state.inner.try_lock().ok()?;
    recovery_locations(&inner)
}

fn recovery_locations(inner: &Inner) -> Option<Vec<RetainedLocation>> {
    if inner.registry.restore.iter().any(|location| {
        !inner
            .sessions
            .iter()
            .any(|session| session.location.id == location.id)
    }) {
        return None;
    }
    Some(retained_locations(&inner.sessions))
}
pub fn file_locations(app: &tauri::AppHandle) -> Vec<Location> {
    app.state::<Workspaces>()
        .inner
        .lock()
        .unwrap()
        .sessions
        .iter()
        .map(|s| s.location.clone())
        .collect()
}
pub(crate) fn with_current<T>(
    app: &tauri::AppHandle,
    window: &str,
    expected: &str,
    f: impl FnOnce(&Location) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<Workspaces>();
    state.with_operation(
        window,
        expected,
        cfg!(mobile),
        || {
            crate::lifecycle::quit_pending(app)
                || crate::recovery::admission_held(app, Some(expected))
        },
        f,
    )
}
/// Persistence may settle during close/quit decisions. Use `with_current` for execution admission.
pub(crate) fn with_open_storage<R: tauri::Runtime, T>(
    app: &tauri::AppHandle<R>,
    window: &str,
    expected: &str,
    operation: impl FnOnce(&Location) -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>()
        .with_open_storage_operation(window, expected, cfg!(mobile), operation)
}

pub(crate) fn with_open_storage_root<T>(
    app: &tauri::AppHandle,
    window: &str,
    workspace_id: &str,
    operation: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    with_open_storage(app, window, workspace_id, |location| {
        let _access = crate::files::CoordinatedAccess::begin(app, location)?;
        let root =
            crate::files::local_root(app, location)?.ok_or("native.files.documents.unavailable")?;
        operation(&root)
    })
}

fn storage_session<'a>(
    sessions: &'a [Session],
    window: &str,
    expected: &str,
    mobile: bool,
) -> Result<&'a Session, String> {
    if !mobile {
        return scoped_session(sessions, window, expected, false);
    }
    sessions
        .iter()
        .find(|session| session.window == window && session.location.id == expected)
        .ok_or("native.workspace.session.inactive".into())
}
pub(crate) fn control_authorization_session<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &str,
    scope: &str,
) -> Result<AuthorizationSession, String> {
    let state = app.state::<Workspaces>();
    let inner = state
        .inner
        .lock()
        .map_err(|_| "native.workspace.state.unavailable")?;
    let session = storage_session(&inner.sessions, window, scope, cfg!(mobile))?;
    if state.quitting.load(Ordering::SeqCst) || session.window != window {
        return Err("native.workspace.session.inactive".into());
    }
    Ok(AuthorizationSession(session.clone()))
}

pub(crate) fn storage_authorization_session<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &str,
    scope: &str,
) -> Result<AuthorizationSession, String> {
    let state = app.state::<Workspaces>();
    let candidate = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "native.workspace.state.unavailable")?;
        storage_session(&inner.sessions, window, scope, cfg!(mobile))?.clone()
    };
    if candidate.window != window {
        return Err("native.workspace.session.inactive".into());
    }
    state.with_storage_candidate(window, scope, cfg!(mobile), candidate.clone(), |_| {
        Ok(AuthorizationSession(candidate))
    })
}

pub(crate) fn authorization_session<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &str,
    scope: &str,
) -> Result<AuthorizationSession, String> {
    app.state::<Workspaces>()
        .authorization_session(window, scope, cfg!(mobile), || {
            crate::lifecycle::quit_pending(app) || crate::recovery::admission_held(app, Some(scope))
        })
}

/// Continues native-held authorization after a workspace switch, but never after its session closes.
/// The callback holds the originating operation lease and must not acquire another session lease.
pub(crate) fn with_authorization_session<T>(
    app: &tauri::AppHandle,
    window: &str,
    session: &AuthorizationSession,
    f: impl FnOnce(&Location) -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>().with_authorization_session(
        window,
        session,
        || {
            crate::lifecycle::quit_pending(app)
                || crate::recovery::admission_held(app, Some(&session.0.location.id))
        },
        f,
    )
}

// Admitted work may checkpoint after admission closes, but never after its session is revoked.
pub(crate) fn with_retained_session<R: tauri::Runtime, T>(
    app: &tauri::AppHandle<R>,
    window: &str,
    session: &AuthorizationSession,
    operation: impl FnOnce(&Location) -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>()
        .with_authorization_session(window, session, || false, operation)
}

pub(crate) fn with_retained_control<R: tauri::Runtime, T>(
    app: &tauri::AppHandle<R>,
    window: &str,
    session: &AuthorizationSession,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>()
        .with_authorized_control(window, session, || false, operation)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(crate) fn with_authorized_read<P, T>(
    app: &tauri::AppHandle,
    window: &str,
    authorization: &AuthorizationSession,
    prepare: impl FnOnce(&Location) -> Result<P, String>,
    read: impl FnOnce(&P) -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>().with_authorized_read(
        window,
        authorization,
        || crate::lifecycle::quit_pending(app),
        prepare,
        read,
    )
}

pub(crate) fn with_retained_read<P, T>(
    app: &tauri::AppHandle,
    window: &str,
    authorization: &AuthorizationSession,
    prepare: impl FnOnce(&Location) -> Result<P, String>,
    read: impl FnOnce(&P) -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Workspaces>()
        .with_authorized_read(window, authorization, || false, prepare, read)
}

fn scoped_session<'a>(
    sessions: &'a [Session],
    window: &str,
    expected: &str,
    mobile: bool,
) -> Result<&'a Session, String> {
    let session = if mobile {
        sessions.last()
    } else {
        sessions.iter().find(|session| session.window == window)
    };
    session
        .filter(|session| session.location.id == expected)
        .ok_or("native.workspace.session.inactive".into())
}

pub fn exiting(app: &tauri::AppHandle) {
    crate::ai::abort_all(app);
    if let Some(state) = app.try_state::<Workspaces>() {
        state.quitting.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
pub(crate) fn with_test_storage_root<T>(
    sessions: &[(&str, Location)],
    window: &str,
    scope: &str,
    operation: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    test_workspaces(sessions).with_open_storage_operation(window, scope, false, |location| {
        operation(Path::new(&location.handle))
    })
}

#[cfg(test)]
pub(crate) fn test_workspaces(sessions: &[(&str, Location)]) -> Workspaces {
    Workspaces {
        inner: Mutex::new(Inner {
            registry: Registry::default(),
            path: PathBuf::new(),
            sessions: sessions
                .iter()
                .map(|(window, location)| Session {
                    location: location.clone(),
                    diagnostic_identity: None,
                    window: (*window).to_owned(),
                    files: Arc::new(crate::files::Session::default()),
                    operations: Arc::new(Mutex::new(())),
                    preparation: None,
                    ai_setup: false,
                })
                .collect(),
            parents: HashMap::new(),
            ready: true,
            error: None,
            failures: vec![],
            #[cfg(desktop)]
            next: 0,
        }),
        quitting: AtomicBool::new(false),
    }
}

#[cfg(test)]
pub(crate) enum TestSessionChange {
    None,
    Close,
    Reopen,
}

#[cfg(test)]
pub(crate) fn with_test_authorized_root<T>(
    sessions: &[(&str, Location)],
    window: &str,
    scope: &str,
    mutates: bool,
    change: TestSessionChange,
    operation: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let state = test_workspaces(sessions);
    let authorization = state.authorization_session(window, scope, false, || false)?;
    if !matches!(change, TestSessionChange::None) {
        state.with_close_session(window, scope, false, |session| {
            let mut inner = state.inner.lock().unwrap();
            inner
                .sessions
                .retain(|session| session.location.id != scope);
            if matches!(change, TestSessionChange::Reopen) {
                let mut reopened = session.unwrap().clone();
                reopened.operations = Arc::new(Mutex::new(()));
                reopened.files = Arc::new(crate::files::Session::default());
                inner.sessions.push(reopened);
            }
            Ok(())
        })?;
    }
    if mutates {
        state.with_authorization_session(
            window,
            &authorization,
            || false,
            |location| operation(Path::new(&location.handle)),
        )
    } else {
        state.with_authorized_read(
            window,
            &authorization,
            || false,
            |location| Ok(PathBuf::from(&location.handle)),
            |root| operation(root),
        )
    }
}

#[cfg(test)]
mod scope_tests {
    use super::*;

    #[test]
    fn onboarding_entry_does_not_require_import_or_support_completion() {
        use situate_core::onboarding::{OnboardingRecord, OnboardingStorage, Step};
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        std::fs::create_dir(root.join(".situate")).unwrap();
        let storage = OnboardingStorage::open(&root, "scope").unwrap();
        assert!(!stored_onboarding_incomplete(&root, "scope").unwrap());
        let mut saved = storage.initialize().unwrap();
        assert!(stored_onboarding_incomplete(&root, "scope").unwrap());
        for step in [Step::Sources, Step::Review, Step::Support] {
            let record = OnboardingRecord {
                step: step.clone(),
                instruction_revision: Some("a".repeat(40)),
                ..Default::default()
            };
            saved = storage
                .save(saved.revision.as_deref(), record.clone())
                .unwrap();
            assert!(stored_onboarding_incomplete(&root, "scope").unwrap());
            saved = storage
                .save(
                    saved.revision.as_deref(),
                    OnboardingRecord {
                        entered: true,
                        ..record
                    },
                )
                .unwrap();
            assert!(!stored_onboarding_incomplete(&root, "scope").unwrap());
            assert_eq!(saved.record.as_ref().unwrap().step, step);
        }
        saved = storage
            .save(
                saved.revision.as_deref(),
                OnboardingRecord {
                    step: Step::Proposal,
                    entered: true,
                    instruction_revision: Some("a".repeat(40)),
                    proposal: "Review changed instructions".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!stored_onboarding_incomplete(&root, "scope").unwrap());
        assert_eq!(storage.load().unwrap(), saved);
        saved = storage
            .save(
                saved.revision.as_deref(),
                OnboardingRecord {
                    step: Step::Complete,
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!saved.record.unwrap().entered);
        assert!(!stored_onboarding_incomplete(&root, "scope").unwrap());
        std::fs::write(root.join(".situate/native-onboarding.json"), b"corrupt").unwrap();
        assert_eq!(
            stored_onboarding_incomplete(&root, "scope").unwrap_err(),
            "native.onboarding.storage.invalid"
        );
    }

    fn scoped_location<'a>(
        sessions: &'a [Session],
        window: &str,
        expected: &str,
        mobile: bool,
    ) -> Result<&'a Location, String> {
        scoped_session(sessions, window, expected, mobile).map(|session| &session.location)
    }
    fn session(id: &str, window: &str) -> Session {
        Session {
            diagnostic_identity: None,
            location: Location {
                id: id.into(),
                name: id.into(),
                display: id.into(),
                kind: "path".into(),
                handle: id.into(),
            },
            window: window.into(),
            ai_setup: false,
            files: Arc::new(crate::files::Session::default()),
            operations: Arc::new(Mutex::new(())),
            preparation: None,
        }
    }
    #[test]
    fn plugin_recovery_defers_unadmitted_restore_inventory() {
        let (_root, state) = workspaces();
        let mut inner = state.inner.lock().unwrap();
        let admitted = inner.sessions[0].location.clone();
        inner.registry.restore = vec![admitted.clone()];
        assert!(recovery_locations(&inner).is_some());
        inner
            .registry
            .restore
            .push(session("not-admitted", "other").location);
        assert!(recovery_locations(&inner).is_none());
        inner.registry.restore.pop();
        let retained = recovery_locations(&inner).unwrap();
        assert!(retained.iter().any(|location| location.id == admitted.id));
    }

    #[test]
    fn failed_preparation_is_not_replaced_with_an_empty_session() {
        let candidate = session("existing", "main");
        let result = prepare_session(&[], &candidate.location, || {
            Err("native.workspace.migration.updateRequired".into())
        });
        assert!(
            matches!(result, Err(error) if error == "native.workspace.migration.updateRequired")
        );
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn authorization_and_background_reads_retain_prepared_ownership() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let preparation =
            Arc::new(crate::workspace_preparation::prepare_local(root.path()).unwrap());
        let weak = Arc::downgrade(&preparation);
        let mut active = session("active", "workspace-1");
        active.preparation = Some(preparation);
        let reused = prepare_session(std::slice::from_ref(&active), &active.location, || {
            panic!("an active workspace must reuse its prepared ownership")
        })
        .unwrap()
        .unwrap();
        assert!(Arc::ptr_eq(active.preparation.as_ref().unwrap(), &reused));
        drop(reused);
        let authorization = AuthorizationSession(active.clone());
        let (location, files) = authorization.file_context();
        assert_eq!(location, active.location);
        assert!(Arc::ptr_eq(&files, &active.files));
        let observations = retained_locations(&[active]);
        assert!(weak.upgrade().is_some());
        drop(authorization);
        assert!(weak.upgrade().is_some());
        drop(observations);
        assert!(weak.upgrade().is_none());
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn reopening_a_replaced_marker_does_not_reuse_old_admission() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let preparation =
            Arc::new(crate::workspace_preparation::prepare_local(root.path()).unwrap());
        let mut active = session("active", "workspace-1");
        active.preparation = Some(preparation);
        std::fs::rename(
            root.path().join(".situate"),
            root.path().join(".situate-original"),
        )
        .unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let bytes = br#"{"minimumAppVersion":"9999.0.0","lastAppliedMigration":1}"#;
        std::fs::write(root.path().join(".situate/migrations.json"), bytes).unwrap();
        let result = prepare_session(std::slice::from_ref(&active), &active.location, || {
            panic!("replacement must not bypass the active session")
        });
        assert!(result.is_err());
        assert_eq!(
            std::fs::read(root.path().join(".situate/migrations.json")).unwrap(),
            bytes
        );
        assert!(!root.path().join(".situate/localization.json").exists());
    }

    #[test]
    fn creation_handoff_changes_entry_ownership_without_changing_its_window_label() {
        let (_root, state) = workspaces();
        let mut inner = state.inner.lock().unwrap();
        assert!(is_entry_window(&inner, "main"));
        assert!(!is_entry_window(&inner, "workspace-1"));
        assert!(!is_entry_window(&inner, "plugin-preview"));
        inner.sessions.push(session("created", "main"));
        assert!(!is_entry_window(&inner, "main"));
        assert!(is_entry_window(&inner, "workspace-3"));
        drop(inner);
        assert!(
            state
                .with_close_session("main", "two", false, |_| Ok(()))
                .is_err()
        );
        assert!(
            state
                .with_close_session("main", "created", false, |_| Ok(()))
                .is_ok()
        );
        assert!(
            state
                .with_close_session("workspace-3", "two", false, |_| Ok(()))
                .is_ok()
        );
    }
    #[test]
    fn process_controls_validate_ownership_without_waiting_for_workspace_operations() {
        let (_root, state) = workspaces();
        let operations = state.inner.lock().unwrap().sessions[0].operations.clone();
        let held = operations.lock().unwrap();
        let worker = state.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            send.send(
                worker.with_process_control("workspace-1", "one", false, || Ok("controlled")),
            )
            .unwrap();
        });
        assert_eq!(
            receive
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
                .unwrap(),
            "controlled"
        );
        assert!(
            state
                .with_process_control("workspace-2", "one", false, || -> Result<(), String> {
                    panic!("foreign control")
                })
                .is_err()
        );
        assert!(
            state
                .with_process_control("workspace-1", "missing", false, || -> Result<(), String> {
                    panic!("closed control")
                })
                .is_err()
        );
        drop(held);
        thread.join().unwrap();
    }

    #[test]
    fn retained_controls_do_not_wait_for_running_io_but_reject_foreign_closed_and_reopened_sessions()
     {
        let (_root, state) = workspaces();
        let authorization = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        let held = authorization.0.operations.lock().unwrap();
        let worker = state.clone();
        let retained = authorization.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            send.send(worker.with_authorized_control(
                "workspace-1",
                &retained,
                || false,
                || Ok("controlled"),
            ))
            .unwrap();
        });
        let result = receive.recv_timeout(std::time::Duration::from_secs(5));
        drop(held);
        thread.join().unwrap();
        assert_eq!(result.unwrap().unwrap(), "controlled");
        assert!(
            state
                .with_authorized_control(
                    "workspace-2",
                    &authorization,
                    || false,
                    || -> Result<(), String> { panic!("foreign control") }
                )
                .is_err()
        );
        assert!(
            state
                .with_authorized_control(
                    "workspace-1",
                    &authorization,
                    || true,
                    || -> Result<(), String> { panic!("quit control") }
                )
                .is_err()
        );
        let original = state.inner.lock().unwrap().sessions.remove(0);
        assert!(
            state
                .with_authorized_control(
                    "workspace-1",
                    &authorization,
                    || false,
                    || -> Result<(), String> { panic!("closed control") }
                )
                .is_err()
        );
        let mut reopened = original;
        reopened.operations = Arc::new(Mutex::new(()));
        state.inner.lock().unwrap().sessions.insert(0, reopened);
        assert!(
            state
                .with_authorized_control(
                    "workspace-1",
                    &authorization,
                    || false,
                    || -> Result<(), String> { panic!("reopened control") }
                )
                .is_err()
        );
        let current = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        assert!(
            state
                .with_authorized_control("workspace-1", &current, || false, || Ok(()))
                .is_ok()
        );
    }

    #[test]
    fn quit_admission_rejection_does_not_prove_retained_authorization_expired() {
        let (_root, state) = workspaces();
        let authorization = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        for quit_pending in [false, true] {
            state.quitting.store(!quit_pending, Ordering::SeqCst);
            assert_eq!(
                state.with_authorized_control(
                    "workspace-1",
                    &authorization,
                    || quit_pending,
                    || -> Result<(), String> { panic!("quit admitted control") }
                ),
                Err("native.workspace.quitting".into())
            );
            assert!(
                !state
                    .authorization_expired("workspace-1", &authorization)
                    .unwrap()
            );
        }
        state.quitting.store(false, Ordering::SeqCst);
        assert!(
            state
                .with_authorized_control("workspace-1", &authorization, || false, || Ok(()))
                .is_ok()
        );
        assert!(
            state
                .authorization_expired("workspace-2", &authorization)
                .unwrap()
        );
        let mut closed = state.inner.lock().unwrap().sessions.remove(0);
        assert!(
            state
                .authorization_expired("workspace-1", &authorization)
                .unwrap()
        );
        closed.operations = Arc::new(Mutex::new(()));
        state.inner.lock().unwrap().sessions.insert(0, closed);
        assert!(
            state
                .authorization_expired("workspace-1", &authorization)
                .unwrap()
        );
        let reopened = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        assert!(
            !state
                .authorization_expired("workspace-1", &reopened)
                .unwrap()
        );
    }

    fn workspaces() -> (tempfile::TempDir, Arc<Workspaces>) {
        let root = tempfile::tempdir().unwrap();
        let mut sessions = vec![session("one", "workspace-1"), session("two", "workspace-2")];
        let mut registry = Registry::default();
        for session in &mut sessions {
            let path = root.path().join(&session.location.id);
            std::fs::create_dir_all(path.join(".situate")).unwrap();
            session.location.handle = path.canonicalize().unwrap().to_string_lossy().into_owned();
            registry.opened(session.location.clone(), true);
        }
        let path = root.path().join("registry.json");
        registry.save(&path).unwrap();
        let state = Workspaces {
            inner: Mutex::new(Inner {
                registry,
                path,
                sessions,
                parents: HashMap::new(),
                ready: true,
                error: None,
                failures: vec![],
                #[cfg(desktop)]
                next: 2,
            }),
            quitting: AtomicBool::new(false),
        };
        (root, Arc::new(state))
    }
    #[test]
    fn plugin_inspection_releases_the_lease_and_rejects_cancelled_or_stale_results() {
        use std::{sync::mpsc, time::Duration};
        use tokio_util::sync::CancellationToken;

        for outcome in ["cancel", "close", "reopen"] {
            let (_root, state) = workspaces();
            let authorization = state
                .authorization_session("workspace-1", "one", false, || false)
                .unwrap();
            let root = PathBuf::from(&authorization.0.location.handle);
            let code = root.join(".situate/plugins/sample/code");
            std::fs::create_dir_all(&code).unwrap();
            std::fs::write(code.join("source.js"), "retained source").unwrap();
            let token = CancellationToken::new();
            let (started_tx, started_rx) = mpsc::channel();
            let (resume_tx, resume_rx) = mpsc::channel();
            let timeout = Duration::from_secs(5);
            std::thread::scope(|threads| {
                let read_state = &state;
                let read_authorization = &authorization;
                let read_token = &token;
                let read = threads.spawn(move || {
                    read_state.with_authorized_read(
                        "workspace-1",
                        read_authorization,
                        || false,
                        |location| Ok(PathBuf::from(&location.handle)),
                        |root| {
                            started_tx.send(()).unwrap();
                            resume_rx.recv_timeout(timeout).unwrap();
                            crate::plugins::inspect_cancellable(
                                root,
                                crate::plugins::Request::Read {
                                    plugin_id: "sample".into(),
                                    path: "source.js".into(),
                                },
                                read_token,
                            )
                        },
                    )
                });
                started_rx.recv_timeout(timeout).unwrap();
                state
                    .with_authorization_session(
                        "workspace-1",
                        &authorization,
                        || false,
                        |_| {
                            if outcome == "cancel" {
                                token.cancel();
                            } else {
                                let mut inner = state.inner.lock().unwrap();
                                let index = inner
                                    .sessions
                                    .iter()
                                    .position(|s| s.location.id == "one")
                                    .unwrap();
                                let mut closed = inner.sessions.remove(index);
                                if outcome == "reopen" {
                                    closed.operations = Arc::new(Mutex::new(()));
                                    closed.files = Arc::new(crate::files::Session::default());
                                    inner.sessions.push(closed);
                                }
                            }
                            Ok(())
                        },
                    )
                    .unwrap();
                resume_tx.send(()).unwrap();
                let error = read.join().unwrap().unwrap_err();
                assert_eq!(
                    error,
                    if outcome == "cancel" {
                        "native.ai.response.stopped"
                    } else if outcome == "close" {
                        "native.workspace.session.inactive"
                    } else {
                        "This workspace session has changed. Retry the action in its current window."
                    }
                );
            });
        }
    }

    #[test]
    fn stored_references_bind_to_the_authorized_copy_without_cross_window_access() {
        use situate_core::{ai_storage::Storage, layout_storage::LayoutStorage};
        let (_root, state) = workspaces();
        let locations = {
            let mut inner = state.inner.lock().unwrap();
            let mut registry = Registry::default();
            for session in &mut inner.sessions {
                session.location =
                    situate_core::workspaces::location(Path::new(&session.location.handle))
                        .unwrap();
                session.diagnostic_identity = Some("1d44dd21-3194-42cc-bb00-a2a8e77456ca".into());
                registry.opened(session.location.clone(), true);
            }
            inner.registry = registry;
            inner.registry.save(&inner.path).unwrap();
            inner
                .sessions
                .iter()
                .map(|session| session.location.clone())
                .collect::<Vec<_>>()
        };
        let (source, copy) = (&locations[0], &locations[1]);
        assert_ne!(source.id, copy.id);
        let (original, original_layout) = state.with_open_storage_operation(
            "workspace-1", &source.id, false, |location| {
                let root = Path::new(&location.handle);
                let storage = Storage::open(root, &location.id)?;
                let mut record = storage.create_conversation("reference-copy", "References")?;
                let reference = serde_json::json!({"kind":"live","workspaceId":location.id,"path":"document.txt","anchorRevision":"b".repeat(40)});
                record.runtime = Some(serde_json::from_value(serde_json::json!({"draftReferences":[reference.clone()]})).unwrap());
                let saved = storage.save_fixture_conversation(&record, 0)?;
                let layout = LayoutStorage::open(root, &location.id)?.save(None, serde_json::json!({
                    "version":1,"pinnedViews":["files"],
                    "layout":{"activeTabId":"tab","closedTabs":[],"tabs":[{
                        "id":"tab","name":"Files","layout":{"kind":"pane","id":"pane"},
                        "panes":[{"id":"pane","navigation":{"cursor":0,"entries":[{
                            "id":"entry","target":{"kind":"view","viewId":"files","contentId":"document.txt"},
                            "presentation":{"reference":reference}
                        }]}}],"activePaneId":"pane","maximizedPaneId":null,"conversationIds":[]
                    }]}
                }))?;
                Ok((saved, layout))
            },
        ).unwrap();
        std::fs::create_dir_all(
            Path::new(&copy.handle).join(".situate/conversations/reference-copy"),
        )
        .unwrap();
        for file in [
            "conversations/reference-copy/metadata.json",
            "conversations/reference-copy/history.jsonl",
            "layout.json",
        ] {
            std::fs::copy(
                Path::new(&source.handle).join(".situate").join(file),
                Path::new(&copy.handle).join(".situate").join(file),
            )
            .unwrap();
        }
        let original_bytes = std::fs::read(
            Path::new(&source.handle).join(".situate/conversations/reference-copy/metadata.json"),
        )
        .unwrap();
        state.with_open_storage_operation("workspace-2", &copy.id, false, |location| {
            let root = Path::new(&location.handle);
            let storage = Storage::open(root, &location.id)?;
            let mut loaded = storage.read_conversation("reference-copy")?.unwrap();
            assert_eq!(loaded.revision, original.revision);
            assert_eq!(loaded.runtime.as_ref().unwrap().draft_references[0].workspace_id(), copy.id);
            assert_eq!(std::fs::read(root.join(".situate/conversations/reference-copy/metadata.json")).unwrap(), original_bytes);
            let layout = LayoutStorage::open(root, &location.id)?;
            let loaded_layout = layout.load()?;
            assert_eq!(loaded_layout.revision, original_layout.revision);
            assert_eq!(loaded_layout.data.as_ref().unwrap()["layout"]["tabs"][0]["panes"][0]["navigation"]["entries"][0]["presentation"]["reference"]["workspaceId"], copy.id);
            let layout_bytes = std::fs::read(root.join(".situate/layout.json")).unwrap();
            assert_eq!(layout.save(loaded_layout.revision.as_deref(), original_layout.data.clone().unwrap()).unwrap_err(), "native.layout.storage.invalid");
            assert_eq!(std::fs::read(root.join(".situate/layout.json")).unwrap(), layout_bytes);
            loaded.draft = "Only the copy changes".into();
            let saved = storage.save_fixture_conversation(&loaded, loaded.revision)?;
            let bytes = std::fs::read(root.join(".situate/conversations/reference-copy/metadata.json")).unwrap();
            let mut foreign = original.clone();
            foreign.revision = saved.revision;
            assert_eq!(storage.save_fixture_conversation(&foreign, saved.revision).unwrap_err(), "native.ai.conversation.versionInvalid");
            assert_eq!(std::fs::read(root.join(".situate/conversations/reference-copy/metadata.json")).unwrap(), bytes);
            Ok(())
        }).unwrap();
        assert_eq!(
            std::fs::read(
                Path::new(&source.handle)
                    .join(".situate/conversations/reference-copy/metadata.json")
            )
            .unwrap(),
            original_bytes
        );
        assert_eq!(
            state
                .with_open_storage_operation(
                    "workspace-1",
                    &copy.id,
                    false,
                    |_| -> Result<(), String> {
                        panic!("another window's copied workspace was admitted")
                    }
                )
                .unwrap_err(),
            "native.workspace.session.inactive"
        );
        assert_eq!(
            state
                .with_open_storage_operation(
                    "workspace-2",
                    &source.id,
                    false,
                    |_| -> Result<(), String> {
                        panic!("the copied workspace admitted the original window's storage")
                    }
                )
                .unwrap_err(),
            "native.workspace.session.inactive"
        );
    }

    #[test]
    fn diagnostic_identity_is_cached_scoped_and_generation_bound_without_waiting() {
        let (_root, state) = workspaces();
        let id = "1d44dd21-3194-42cc-bb00-a2a8e77456ca";
        {
            let mut inner = state.inner.lock().unwrap();
            for session in &mut inner.sessions {
                session.diagnostic_identity = Some(id.into());
            }
            assert!(
                state
                    .diagnostic_session("workspace-1", "one", false)
                    .is_none()
            );
        }
        let (identity, first) = state
            .diagnostic_session("workspace-1", "one", false)
            .unwrap();
        let (_, second) = state
            .diagnostic_session("workspace-2", "two", false)
            .unwrap();
        assert_eq!(identity, id);
        assert!(!Arc::ptr_eq(&first, &second));
        assert!(
            state
                .diagnostic_session("workspace-2", "one", false)
                .is_none()
        );
        let mut reopened = session("one", "workspace-1");
        reopened.diagnostic_identity = Some(id.into());
        state.inner.lock().unwrap().sessions[0] = reopened;
        let (_, next) = state
            .diagnostic_session("workspace-1", "one", false)
            .unwrap();
        assert!(!Arc::ptr_eq(&first, &next));
        state.quitting.store(true, Ordering::Relaxed);
        assert!(
            state
                .diagnostic_session("workspace-1", "one", false)
                .is_none()
        );
    }

    #[test]
    fn mobile_diagnostics_follow_owned_open_sessions_across_selection_changes() {
        let (_root, state) = workspaces();
        {
            let mut inner = state.inner.lock().unwrap();
            for session in &mut inner.sessions {
                session.window = "main".into();
                session.diagnostic_identity = Some("1d44dd21-3194-42cc-bb00-a2a8e77456ca".into());
            }
        }
        let (_, original) = state.diagnostic_session("main", "one", true).unwrap();
        assert!(state.diagnostic_session("main", "two", true).is_some());
        assert!(state.diagnostic_session("other", "one", true).is_none());
        state.inner.lock().unwrap().sessions.reverse();
        let (_, selected) = state.diagnostic_session("main", "one", true).unwrap();
        assert!(Arc::ptr_eq(&original, &selected));
        state.inner.lock().unwrap().sessions.pop();
        assert!(state.diagnostic_session("main", "one", true).is_none());
        let mut reopened = session("one", "main");
        reopened.diagnostic_identity = Some("1d44dd21-3194-42cc-bb00-a2a8e77456ca".into());
        state.inner.lock().unwrap().sessions.push(reopened);
        let (_, next) = state.diagnostic_session("main", "one", true).unwrap();
        assert!(!Arc::ptr_eq(&original, &next));
        state
            .inner
            .lock()
            .unwrap()
            .sessions
            .last_mut()
            .unwrap()
            .diagnostic_identity = None;
        assert!(state.diagnostic_session("main", "one", true).is_none());
    }

    #[test]
    fn mobile_continuation_scope_survives_selection_but_not_close_and_reopen() {
        let (_root, state) = workspaces();
        let original = {
            let mut inner = state.inner.lock().unwrap();
            for session in &mut inner.sessions {
                session.window = "main".into();
            }
            inner.sessions.reverse();
            inner.sessions.last().unwrap().clone()
        };
        state
            .with_operation("main", "one", true, || false, |_| Ok(()))
            .unwrap();
        state.inner.lock().unwrap().sessions.reverse();
        assert!(
            state
                .with_operation("main", "one", true, || false, |_| Ok(()))
                .is_err()
        );
        state
            .with_operation("main", "two", true, || false, |_| Ok(()))
            .unwrap();
        state
            .with_open_storage_operation("main", "one", true, |location| {
                assert_eq!(location.id, "one");
                std::fs::write(
                    Path::new(&location.handle).join("continuation.txt"),
                    b"saved",
                )
                .map_err(|error| error.to_string())
            })
            .unwrap();
        assert_eq!(
            std::fs::read(Path::new(&original.location.handle).join("continuation.txt")).unwrap(),
            b"saved"
        );
        let other = state
            .inner
            .lock()
            .unwrap()
            .sessions
            .last()
            .unwrap()
            .location
            .clone();
        assert!(!Path::new(&other.handle).join("continuation.txt").exists());
        for (window, scope) in [("other-window", "one"), ("main", "unknown")] {
            assert!(
                state
                    .with_open_storage_operation(window, scope, true, |_| -> Result<(), String> {
                        panic!("unowned continuation ran")
                    })
                    .is_err()
            );
        }
        state
            .with_close_session("main", "one", true, |_| {
                let removed = close_record(&mut state.inner.lock().unwrap(), "one")?.unwrap();
                crate::files::complete_close(&removed.files);
                Ok(())
            })
            .unwrap();
        let mut reopened = session("one", "main");
        reopened.location = original.location.clone();
        assert!(!Arc::ptr_eq(&original.files, &reopened.files));
        assert!(original.files.detached.load(Ordering::Acquire));
        assert!(!reopened.files.detached.load(Ordering::Acquire));
        state.inner.lock().unwrap().sessions.push(reopened);
        assert!(
            state
                .with_storage_candidate("main", "one", true, original, |_| -> Result<(), String> {
                    panic!("stale continuation ran")
                })
                .is_err()
        );
    }

    #[test]
    fn mobile_storage_accepts_only_owned_open_sessions_and_preserves_current_scope() {
        let sessions = vec![session("one", "main"), session("two", "main")];
        assert!(storage_session(&sessions, "main", "one", true).is_ok());
        assert!(storage_session(&sessions, "main", "two", true).is_ok());
        assert!(scoped_session(&sessions, "main", "one", true).is_err());
        assert!(storage_session(&sessions, "other", "one", true).is_err());
        assert!(storage_session(&sessions, "main", "closed", true).is_err());
        let desktop = vec![session("one", "workspace-1"), session("two", "workspace-2")];
        assert!(storage_session(&desktop, "workspace-1", "two", false).is_err());
        assert!(storage_session(&desktop, "main", "one", false).is_err());
    }

    #[test]
    fn mobile_storage_revalidates_generation_and_quit_before_writing() {
        let (_root, state) = workspaces();
        for session in &mut state.inner.lock().unwrap().sessions {
            session.window = "main".into();
        }
        let stale = state.inner.lock().unwrap().sessions[0].clone();
        state.inner.lock().unwrap().sessions[0].operations = Arc::new(Mutex::new(()));
        assert!(
            state
                .with_storage_candidate("main", "one", true, stale, |_| -> Result<(), String> {
                    panic!("stale operation ran")
                })
                .is_err()
        );
        assert!(
            state
                .with_operation(
                    "main",
                    "two",
                    true,
                    || true,
                    |_| -> Result<(), String> {
                        panic!("new execution ran during quit preparation")
                    }
                )
                .is_err()
        );
        state
            .with_open_storage_operation("main", "one", true, |location| {
                let store = situate_core::layout_storage::LayoutStorage::open(
                    std::path::Path::new(&location.handle),
                    &location.id,
                )?;
                store.save(
                    None,
                    serde_json::json!({"version":1,"layout":{},"pinnedViews":[]}),
                )?;
                Ok(())
            })
            .unwrap();
        state.quitting.store(true, Ordering::SeqCst);
        assert!(
            state
                .with_open_storage_operation("main", "one", true, |_| -> Result<(), String> {
                    panic!("storage ran after quit approval")
                })
                .is_err()
        );
        state.quitting.store(false, Ordering::SeqCst);
        state.inner.lock().unwrap().sessions.remove(0);
        assert!(
            state
                .with_open_storage_operation("main", "one", true, |_| -> Result<(), String> {
                    panic!("closed operation ran")
                })
                .is_err()
        );
    }

    fn storage(location: &Location) -> Result<situate_core::ai_storage::Storage, String> {
        situate_core::ai_storage::Storage::open(
            std::path::Path::new(&location.handle),
            &location.id,
        )
    }

    fn save_messages(
        storage: &situate_core::ai_storage::Storage,
        messages: serde_json::Value,
    ) -> Result<(), String> {
        let mut record = match storage.read_conversation("chat")? {
            Some(record) => record,
            None => storage.create_conversation("chat", "")?,
        };
        record.messages = messages;
        storage.save_fixture_conversation(&record, record.revision)?;
        Ok(())
    }

    #[test]
    fn close_drains_ai_storage_without_blocking_other_workspace_io_or_registry_snapshots() {
        use std::{sync::mpsc, time::Duration};
        let (_root, state) = workspaces();
        let (admitted, admission) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let writing = state.clone();
        let writer = std::thread::spawn(move || {
            writing.with_operation(
                "workspace-1",
                "one",
                false,
                || false,
                |location| {
                    let storage = storage(location)?;
                    admitted.send(()).unwrap();
                    resume.recv().unwrap();
                    save_messages(&storage, serde_json::json!([{"role":"user","content":"first conversation","timestamp":1}]))
                },
            )
        });
        admission.recv_timeout(Duration::from_secs(5)).unwrap();
        let (started, start) = mpsc::channel();
        let closing = state.clone();
        let closer = std::thread::spawn(move || {
            started.send(()).unwrap();
            closing.with_close_session("workspace-1", "one", false, |session| {
                assert_eq!(storage(&session.unwrap().location)?.read_conversation("chat")?.unwrap().messages,
                    serde_json::json!([{"role":"user","content":"first conversation","timestamp":1}]));
                let mut inner = closing.inner.lock().unwrap();
                close_record(&mut inner, "one")?;
                Ok(())
            })
        });
        start.recv_timeout(Duration::from_secs(5)).unwrap();
        let (inspected, inspection) = mpsc::channel();
        let other = state.clone();
        let inspector = std::thread::spawn(move || {
            assert_eq!(other.inner.lock().unwrap().sessions.len(), 2);
            other.with_operation("workspace-2", "two", false, || false, |location| {
                let storage = storage(location)?;
                save_messages(&storage, serde_json::json!([{"role":"user","content":"second conversation","timestamp":1}]))?;
                assert_eq!(storage.read_conversation("chat")?.unwrap().messages,
                    serde_json::json!([{"role":"user","content":"second conversation","timestamp":1}]));
                Ok(())
            }).unwrap();
            inspected.send(()).unwrap();
        });
        inspection.recv_timeout(Duration::from_secs(5)).unwrap();
        release.send(()).unwrap();
        writer.join().unwrap().unwrap();
        closer.join().unwrap().unwrap();
        inspector.join().unwrap();
        assert!(
            state
                .with_operation("workspace-1", "one", false, || false, |_| Ok(()))
                .is_err()
        );
        let inner = state.inner.lock().unwrap();
        assert_eq!(inner.sessions.len(), 1);
        let persisted = Registry::load(&inner.path).unwrap();
        assert_eq!(
            persisted
                .restore
                .iter()
                .map(|location| location.id.as_str())
                .collect::<Vec<_>>(),
            ["two"]
        );
    }

    #[test]
    fn queued_authorization_cannot_write_to_a_reopened_session_with_the_same_id() {
        let (_root, state) = workspaces();
        let candidate = state.current_session("workspace-1", "one", false).unwrap();
        state
            .with_close_session("workspace-1", "one", false, |_| {
                close_record(&mut state.inner.lock().unwrap(), "one")?;
                Ok(())
            })
            .unwrap();
        let mut reopened = candidate.clone();
        reopened.operations = Arc::new(Mutex::new(()));
        state.inner.lock().unwrap().sessions.push(reopened);
        let stale = state.with_operation_candidate(
            "workspace-1",
            "one",
            false,
            candidate,
            || false,
            |location| {
                save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"stale conversation","timestamp":1}]))
            },
        );
        assert!(stale.is_err());
        state
            .with_operation(
                "workspace-1",
                "one",
                false,
                || false,
                |location| {
                    assert!(storage(location)?.read_conversation("chat")?.is_none());
                    save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"new conversation","timestamp":1}]))
                },
            )
            .unwrap();
    }

    #[test]
    fn failed_close_persistence_releases_the_lease_and_preserves_the_session() {
        let (_root, state) = workspaces();
        let candidate = state.current_session("workspace-1", "one", false).unwrap();
        let path = state.inner.lock().unwrap().path.clone();
        state.inner.lock().unwrap().path = path.join("missing-parent/registry.json");
        assert!(
            state
                .with_close_session("workspace-1", "one", false, |_| {
                    close_record(&mut state.inner.lock().unwrap(), "one").map(|_| ())
                })
                .is_err()
        );
        state.inner.lock().unwrap().path = path;
        state
            .with_operation_candidate(
                "workspace-1",
                "one",
                false,
                candidate,
                || false,
                |location| {
                    save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"saved after cancellation","timestamp":1}]))
                },
            )
            .unwrap();
        assert_eq!(state.inner.lock().unwrap().sessions.len(), 2);
    }

    #[test]
    fn quit_admission_drains_storage_then_blocks_all_workspaces_until_cancelled() {
        use std::{sync::mpsc, time::Duration};
        let (_root, state) = workspaces();
        let pending = Arc::new(AtomicBool::new(false));
        let (admitted, admission) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let writing = state.clone();
        let writer = std::thread::spawn(move || {
            writing.with_operation(
                "workspace-1",
                "one",
                false,
                || false,
                |location| {
                    admitted.send(()).unwrap();
                    resume.recv().unwrap();
                    save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"saved before quit","timestamp":1}]))
                },
            )
        });
        admission.recv_timeout(Duration::from_secs(5)).unwrap();
        let quitting = state.clone();
        let quit_pending = pending.clone();
        let quitter = std::thread::spawn(move || {
            quitting.with_quit_sessions(|inner| {
                assert_eq!(
                    storage(&inner.sessions[0].location)
                        .unwrap()
                        .read_conversation("chat")
                        .unwrap()
                        .unwrap()
                        .messages,
                    serde_json::json!([{"role":"user","content":"saved before quit","timestamp":1}])
                );
                quit_pending.store(true, Ordering::Release);
            })
        });
        release.send(()).unwrap();
        writer.join().unwrap().unwrap();
        quitter.join().unwrap();
        for (window, id) in [("workspace-1", "one"), ("workspace-2", "two")] {
            assert!(
                state
                    .with_operation(
                        window,
                        id,
                        false,
                        || pending.load(Ordering::Acquire),
                        |_| Ok(())
                    )
                    .is_err()
            );
        }
        pending.store(false, Ordering::Release);
        state.with_operation("workspace-2", "two", false, || pending.load(Ordering::Acquire),
            |location| save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"saved after quit cancellation","timestamp":1}]))).unwrap();
        assert_eq!(state.inner.lock().unwrap().registry.restore.len(), 2);
    }

    #[test]
    fn mobile_switch_revalidates_queued_work_but_keeps_inactive_sessions_open() {
        let (_root, state) = workspaces();
        for session in &mut state.inner.lock().unwrap().sessions {
            session.window = "main".into();
        }
        let candidate = state.current_session("main", "two", true).unwrap();
        state.inner.lock().unwrap().sessions.swap(0, 1);
        assert!(
            state
                .with_operation_candidate(
                    "main",
                    "two",
                    true,
                    candidate,
                    || false,
                    |location| save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"stale mobile write","timestamp":1}]))
                )
                .is_err()
        );
        state
            .with_close_session("main", "two", true, |_| {
                close_record(&mut state.inner.lock().unwrap(), "two").map(|_| ())
            })
            .unwrap();
        state
            .with_operation(
                "main",
                "one",
                true,
                || false,
                |location| {
                    save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"active workspace","timestamp":1}]))
                },
            )
            .unwrap();
        assert_eq!(state.inner.lock().unwrap().sessions.len(), 1);
    }

    #[test]
    fn mobile_authorization_keeps_its_origin_without_authorizing_new_background_actions() {
        let (_root, state) = workspaces();
        {
            let mut inner = state.inner.lock().unwrap();
            for session in &mut inner.sessions {
                session.window = "main".into();
            }
            inner.sessions.swap(0, 1);
        }
        let authorization = state
            .authorization_session("main", "one", true, || false)
            .unwrap();
        state.inner.lock().unwrap().sessions.swap(0, 1);
        assert!(
            state
                .authorization_session("main", "one", true, || false)
                .is_err()
        );
        assert!(
            state
                .with_operation("main", "one", true, || false, |_| Ok(()))
                .is_err()
        );
        state
            .with_authorization_session(
                "main",
                &authorization,
                || false,
                |location| {
                    assert_eq!(location.id, "one");
                    save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"authorized in one","timestamp":1}]))
                },
            )
            .unwrap();
        state
            .with_operation(
                "main",
                "two",
                true,
                || false,
                |location| {
                    assert!(storage(location)?.read_conversation("chat")?.is_none());
                    Ok(())
                },
            )
            .unwrap();
    }

    #[test]
    fn authorization_tokens_are_window_owned_even_on_mobile() {
        let (_root, state) = workspaces();
        let authorization = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        assert!(
            state
                .with_authorization_session(
                    "workspace-2",
                    &authorization,
                    || false,
                    |_| -> Result<(), String> { panic!("wrong window admitted") }
                )
                .is_err()
        );
        assert!(
            state
                .authorization_session("workspace-1", "two", true, || false)
                .is_err()
        );
        assert!(
            state
                .with_authorization_session(
                    "main",
                    &AuthorizationSession::for_test(),
                    || false,
                    |_| -> Result<(), String> { panic!("unregistered session admitted") }
                )
                .is_err()
        );
    }

    #[test]
    fn authorization_waiting_on_close_rejects_the_reopened_generation() {
        use std::{sync::mpsc, time::Duration};
        let (_root, state) = workspaces();
        let authorization = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        let cloned = authorization.clone();
        let mut queued = None;
        state
            .with_close_session("workspace-1", "one", false, |current| {
                let current = current.unwrap();
                let (started, waiting) = mpsc::channel();
                let completing = state.clone();
                queued = Some(std::thread::spawn(move || {
                    started.send(()).unwrap();
                    completing.with_authorization_session(
                        "workspace-1",
                        &cloned,
                        || false,
                        |_| -> Result<(), String> { panic!("closed generation admitted") },
                    )
                }));
                waiting.recv_timeout(Duration::from_secs(5)).unwrap();
                let mut reopened = current.clone();
                reopened.operations = Arc::new(Mutex::new(()));
                let mut inner = state.inner.lock().unwrap();
                close_record(&mut inner, "one")?;
                inner.sessions.push(reopened);
                Ok(())
            })
            .unwrap();
        assert!(queued.unwrap().join().unwrap().is_err());
        assert!(
            state
                .with_authorization_session(
                    "workspace-1",
                    &authorization,
                    || false,
                    |_| -> Result<(), String> { panic!("stale token admitted") }
                )
                .is_err()
        );
        let replacement = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        state
            .with_authorization_session("workspace-1", &replacement, || false, |_| Ok(()))
            .unwrap();
    }

    #[test]
    fn authorization_lease_drains_before_quit_and_rechecks_both_quit_guards() {
        use std::{sync::mpsc, time::Duration};
        let (_root, state) = workspaces();
        let authorization = state
            .authorization_session("workspace-1", "one", false, || false)
            .unwrap();
        let pending = Arc::new(AtomicBool::new(false));
        let (admitted, admission) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let writing = state.clone();
        let token = authorization.clone();
        let writer = std::thread::spawn(move || {
            writing.with_authorization_session(
                "workspace-1",
                &token,
                || false,
                |location| {
                    admitted.send(()).unwrap();
                    resume.recv_timeout(Duration::from_secs(5)).unwrap();
                    save_messages(&storage(location)?, serde_json::json!([{"role":"user","content":"authorization complete","timestamp":1}]))
                },
            )
        });
        admission.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(authorization.0.operations.try_lock().is_err());
        let quitting = state.clone();
        let quit_pending = pending.clone();
        let quitter = std::thread::spawn(move || {
            quitting.with_quit_sessions(|inner| {
                let origin = inner
                    .sessions
                    .iter()
                    .find(|session| session.location.id == "one")
                    .unwrap();
                assert!(
                    storage(&origin.location)
                        .unwrap()
                        .read_conversation("chat")
                        .unwrap()
                        .is_some()
                );
                quit_pending.store(true, Ordering::SeqCst);
            });
        });
        state
            .with_operation(
                "workspace-2",
                "two",
                false,
                || false,
                |location| {
                    assert!(storage(location)?.read_conversation("chat")?.is_none());
                    Ok(())
                },
            )
            .unwrap();
        release.send(()).unwrap();
        writer.join().unwrap().unwrap();
        quitter.join().unwrap();
        assert!(
            state
                .with_authorization_session(
                    "workspace-1",
                    &authorization,
                    || pending.load(Ordering::SeqCst),
                    |_| -> Result<(), String> { panic!("quit admitted authorization") }
                )
                .is_err()
        );
        assert!(
            state
                .authorization_session("workspace-1", "one", false, || true)
                .is_err()
        );
        pending.store(false, Ordering::SeqCst);
        state
            .with_authorization_session("workspace-1", &authorization, || false, |_| Ok(()))
            .unwrap();
        state.quitting.store(true, Ordering::SeqCst);
        assert!(
            state
                .with_authorization_session(
                    "workspace-1",
                    &authorization,
                    || false,
                    |_| -> Result<(), String> { panic!("exiting admitted authorization") }
                )
                .is_err()
        );
        assert!(
            state
                .authorization_session("workspace-1", "one", false, || false)
                .is_err()
        );
    }

    #[test]
    fn incoming_window_cannot_choose_another_workspace_or_a_path() {
        let sessions = [session("one", "workspace-1"), session("two", "workspace-2")];
        assert_eq!(
            scoped_location(&sessions, "workspace-1", "one", false)
                .unwrap()
                .id,
            "one"
        );
        for (window, scope) in [
            ("workspace-1", "two"),
            ("main", "one"),
            ("workspace-1", "/tmp/arbitrary"),
            ("closed-window", "one"),
        ] {
            assert!(scoped_location(&sessions, window, scope, false).is_err());
        }
        assert!(scoped_location(&[], "workspace-1", "one", false).is_err());
    }
    #[test]
    fn a_late_mobile_command_cannot_mutate_the_new_active_workspace() {
        let sessions = [session("one", "main"), session("two", "main")];
        assert!(scoped_location(&sessions, "main", "one", true).is_err());
        assert_eq!(
            scoped_location(&sessions, "main", "two", true).unwrap().id,
            "two"
        );
    }
}
