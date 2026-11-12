use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use situate_core::{
    ai_storage::{KeyStore, Storage},
    plugins::storage,
    workspaces::Location,
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

const ERROR: &str = "native.plugins.hostFailed";
const INVALID: &str = "native.plugins.invalidPath";
const CANCELLED: &str = "native.plugins.hostCancelled";
const LIMIT: usize = 1_048_576;

#[derive(Default)]
pub struct Hosts(Mutex<HashMap<String, Arc<Host>>>, Arc<Processes>);

#[derive(Default)]
struct Processes(Mutex<ProcessState>);
#[derive(Default)]
struct ProcessState {
    closing: HashSet<String>,
    active: HashMap<String, ProcessWorker>,
}
struct ProcessWorker {
    scope: String,
    cancellation: CancellationToken,
    completed: CancellationToken,
}
struct ProcessLease {
    state: Arc<Processes>,
    id: String,
    completed: CancellationToken,
}
impl Drop for ProcessLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.0.lock() {
            state.active.remove(&self.id);
        }
        self.completed.cancel();
    }
}
impl Processes {
    fn admit(
        self: &Arc<Self>,
        scope: &str,
        token: &CancellationToken,
    ) -> Result<ProcessLease, String> {
        let mut state = self.0.lock().map_err(|_| ERROR)?;
        if state.closing.contains(scope) {
            return Err("native.ai.response.closing".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let completed = CancellationToken::new();
        state.active.insert(
            id.clone(),
            ProcessWorker {
                scope: scope.into(),
                cancellation: token.clone(),
                completed: completed.clone(),
            },
        );
        Ok(ProcessLease {
            state: self.clone(),
            id,
            completed,
        })
    }
    fn prepare_close(&self, scope: &str) -> Result<bool, String> {
        let mut state = self.0.lock().map_err(|_| ERROR)?;
        state.closing.insert(scope.into());
        Ok(state.active.values().any(|worker| worker.scope == scope))
    }
    fn resume(&self, scope: &str) {
        if let Ok(mut state) = self.0.lock() {
            state.closing.remove(scope);
        }
    }
    fn has_active(&self) -> Result<bool, String> {
        Ok(!self.0.lock().map_err(|_| ERROR)?.active.is_empty())
    }
    fn abort(&self, scope: &str) -> Result<Vec<CancellationToken>, String> {
        let mut state = self.0.lock().map_err(|_| ERROR)?;
        state.closing.insert(scope.into());
        Ok(state
            .active
            .values()
            .filter(|worker| worker.scope == scope)
            .map(|worker| {
                worker.cancellation.cancel();
                worker.completed.clone()
            })
            .collect())
    }
}
pub(crate) fn prepare_process_close(app: &tauri::AppHandle, scope: &str) -> Result<bool, String> {
    app.state::<Hosts>().1.prepare_close(scope)
}
pub(crate) fn resume_processes<R: tauri::Runtime>(app: &tauri::AppHandle<R>, scope: &str) {
    app.state::<Hosts>().1.resume(scope);
}
pub(crate) async fn abort_scope_for_recovery(
    app: &tauri::AppHandle,
    scope: &str,
) -> Result<(), String> {
    let completed = app.state::<Hosts>().1.abort(scope)?;
    for worker in completed {
        worker.cancelled().await;
    }
    Ok(())
}

pub(crate) async fn abort_for_update(app: &tauri::AppHandle) -> Result<(), String> {
    let completed = {
        let hosts = app.state::<Hosts>();
        let state = hosts.1.0.lock().map_err(|_| ERROR)?;
        state
            .active
            .values()
            .map(|worker| {
                worker.cancellation.cancel();
                worker.completed.clone()
            })
            .collect::<Vec<_>>()
    };
    for worker in completed {
        worker.cancelled().await;
    }
    Ok(())
}
pub(crate) fn has_processes<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<bool, String> {
    app.state::<Hosts>().1.has_active()
}

#[tauri::command]
pub async fn plugin_process_abort(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<(), String> {
    let completed = crate::workspaces::with_process_control(&app, window.label(), &scope, || {
        app.state::<Hosts>().1.abort(&scope)
    })?;
    // Worker leases outlive process teardown and history reconciliation, not the IPC waiter.
    for worker in completed {
        worker.cancelled().await;
    }
    Ok(())
}
impl Hosts {
    fn insert(&self, host: Arc<Host>) -> Result<String, String> {
        let mut hosts = self.0.lock().map_err(|_| ERROR)?;
        if hosts.len() >= 128 {
            return Err("native.plugins.stateBusy".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        hosts.insert(id.clone(), host);
        Ok(id)
    }
    fn stop_affected(
        &self,
        scope: &str,
        incarnations: &crate::plugin_actions::Incarnations,
    ) -> Result<(), String> {
        let hosts = self.0.lock().map_err(|_| ERROR)?;
        for host in hosts.values().filter(|host| {
            host.scope == scope
                && host.test_id.is_none()
                && incarnations
                    .iter()
                    .any(|(id, incarnation)| host.incarnations.get(id) == Some(incarnation))
                && incarnations.iter().all(|(id, incarnation)| {
                    host.incarnations
                        .get(id)
                        .is_none_or(|captured| captured == incarnation)
                })
        }) {
            for token in host.requests.lock().map_err(|_| ERROR)?.values() {
                token.cancel();
            }
        }
        Ok(())
    }

    fn invalidate_scope(&self, scope: &str) {
        let removed = {
            let Ok(mut hosts) = self.0.lock() else {
                return;
            };
            hosts
                .extract_if(|_, host| host.scope == scope)
                .map(|(_, host)| host)
                .collect::<Vec<_>>()
        };
        for host in removed {
            host.cancelled.cancel();
        }
    }
}
pub(crate) fn stop_affected(
    app: &tauri::AppHandle,
    scope: &str,
    incarnations: &crate::plugin_actions::Incarnations,
) -> Result<(), String> {
    crate::ai_executor::stop_affected(app, scope, incarnations)?;
    app.state::<Hosts>().stop_affected(scope, incarnations)
}

pub(crate) fn invalidate_scope(app: &tauri::AppHandle, scope: &str) {
    crate::ai_executor::invalidate_scope(app, scope);
    if let Some(hosts) = app.try_state::<Hosts>() {
        hosts.invalidate_scope(scope);
    }
}
struct Host {
    window: String,
    scope: String,
    plugin: String,
    incarnations: crate::plugin_actions::Incarnations,
    revisions: crate::plugin_actions::Revisions,
    authorization: crate::workspaces::AuthorizationSession,
    test_id: Option<String>,
    test_files: Arc<crate::files::Session>,
    test_keys: Arc<EphemeralKeys>,
    responses: HashMap<String, crate::plugin_checks::HttpFixture>,
    processes: Vec<crate::plugin_checks::ProcessFixture>,
    cancelled: CancellationToken,
    requests: Mutex<HashMap<String, CancellationToken>>,
}
struct RequestCleanup {
    host: Arc<Host>,
    id: String,
}
impl Drop for RequestCleanup {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.host.requests.lock() {
            requests.remove(&self.id);
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Area {
    Files,
    Config,
    Data,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Read {
        area: Area,
        path: String,
    },
    FilesList {
        query: crate::plugin_file_queries::Query,
    },
    FilesSearch {
        query: crate::plugin_file_queries::SearchQuery,
    },
    FilesReadMany {
        paths: Vec<String>,
    },
    Write {
        area: Area,
        path: String,
        text: String,
        #[serde(rename = "expectedRevision", deserialize_with = "required_revision")]
        expected_revision: Option<String>,
    },
    CredentialGet {
        name: String,
    },
    CredentialSet {
        name: String,
        value: String,
    },
    CredentialRemove {
        name: String,
    },
    ProcessCapability {},
    Process {
        executable: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(rename = "timeoutMs")]
        timeout_ms: Option<u64>,
    },
    Http {
        url: String,
        method: Option<String>,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        body: Option<String>,
    },
}
pub(crate) async fn request_native(
    app: tauri::AppHandle,
    window: &str,
    host_id: &str,
    request_id: String,
    request: Request,
    cancel: CancellationToken,
) -> Result<Value, String> {
    identifier(&request_id)?;
    let host = owned(&app, window, host_id)?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let operation = execute_request(app, host.clone(), request_id, request);
    tokio::pin!(operation);
    tokio::select! {
        result = &mut operation => result,
        _ = cancel.cancelled() => {
            host.cancelled.cancel();
            operation.await
        }
    }
}

pub(crate) fn close_native(
    app: &tauri::AppHandle,
    window: &str,
    host_id: &str,
) -> Result<(), String> {
    let host = owned(app, window, host_id)?;
    host.cancelled.cancel();
    app.state::<Hosts>()
        .0
        .lock()
        .map_err(|_| ERROR)?
        .remove(host_id);
    Ok(())
}

fn required_revision<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::deserialize(d)
}
pub(crate) fn identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
        || matches!(value, "." | "..")
    {
        return Err(INVALID.into());
    }
    Ok(())
}
fn check_recovery(
    app: &tauri::AppHandle,
    scope: &str,
    plugin: &str,
    testing: bool,
) -> Result<(), String> {
    if !testing && crate::plugin_recovery::blocked(app, scope, plugin) {
        Err("native.plugins.recoveryBlocked".into())
    } else {
        Ok(())
    }
}
fn authorize_plugin(root: &Path, plugin: &str, recovery: bool) -> Result<(), String> {
    if recovery {
        return Err("native.plugins.recoveryBlocked".into());
    }
    situate_core::plugins::runtime::check_enabled(root, plugin)
}
fn active(host: &Host, token: &CancellationToken) -> Result<(), String> {
    if host.cancelled.is_cancelled() || token.is_cancelled() {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}
fn owned(app: &tauri::AppHandle, window: &str, id: &str) -> Result<Arc<Host>, String> {
    app.state::<Hosts>()
        .0
        .lock()
        .map_err(|_| ERROR)?
        .get(id)
        .filter(|h| h.window == window)
        .cloned()
        .ok_or_else(|| "native.plugins.unavailable".into())
}

pub(crate) async fn open_native(
    context: &crate::ai_executor::Context,
    plugin_id: String,
    test_id: Option<String>,
    revisions: Option<crate::plugin_actions::Revisions>,
    incarnations: Option<crate::plugin_actions::Incarnations>,
) -> Result<String, String> {
    let crate::ai_executor::Context {
        app,
        window: label,
        scope,
        authorization,
    } = context.clone();
    identifier(&plugin_id)?;
    check_recovery(&app, &scope, &plugin_id, test_id.is_some())?;
    tauri::async_runtime::spawn_blocking(move || {
        let responses = match &test_id {
            Some(id) => crate::plugin_changes::responses(&app, &label, &scope, id, &plugin_id)?,
            None => HashMap::new(),
        };
        let processes = match &test_id {
            Some(id) => crate::plugin_changes::processes(&app, &label, &scope, id, &plugin_id)?,
            None => Vec::new(),
        };
        let revisions = if test_id.is_some() {
            HashMap::new()
        } else {
            crate::workspaces::with_retained_session(&app, &label, &authorization, |location| {
                let root = crate::files::local_root(&app, location)?.ok_or(ERROR)?;
                crate::plugin_actions::capture_host(
                    &app,
                    &scope,
                    &root,
                    &plugin_id,
                    revisions.as_ref(),
                    incarnations.as_ref(),
                )
            })?
        };
        let test_files = match test_id.as_deref() {
            Some(id) if crate::plugin_changes::contains(&app, id) => {
                crate::plugin_changes::test_files(&app, &label, &scope, id, &plugin_id)?
            }
            _ => Arc::default(),
        };
        // Trial hosts share the wrapping master used by their credential envelopes.
        let test_keys = match test_id.as_deref() {
            Some(id) => crate::plugin_changes::test_keys(&app, &label, &scope, id, &plugin_id)?,
            None => Arc::default(),
        };
        let host = Arc::new(Host {
            incarnations: incarnations.unwrap_or_default(),
            revisions,
            responses,
            processes,
            window: label,
            scope,
            plugin: plugin_id,
            authorization,
            test_id,
            test_files,
            test_keys,
            cancelled: CancellationToken::new(),
            requests: Mutex::default(),
        });
        if let Some(test_id) = &host.test_id {
            crate::plugin_changes::with_test_context(
                &app,
                &host.window,
                &host.scope,
                test_id,
                &host.plugin,
                |_| app.state::<Hosts>().insert(host.clone()),
            )
        } else {
            crate::workspaces::with_retained_session(
                &app,
                &host.window,
                &host.authorization,
                |location| {
                    check_recovery(&app, &host.scope, &host.plugin, false)?;
                    let root = crate::files::local_root(&app, location)?.ok_or(ERROR)?;
                    authorize_plugin(
                        &root,
                        &host.plugin,
                        crate::plugin_recovery::blocked(&app, &host.scope, &host.plugin),
                    )?;
                    app.state::<Hosts>().insert(host.clone())
                },
            )
        }
    })
    .await
    .map_err(|_| ERROR.to_owned())?
}
#[cfg(test)]
fn cancel_request(host: &Host, request_id: String) -> Result<(), String> {
    let mut requests = host.requests.lock().map_err(|_| ERROR)?;
    if let Some(token) = requests.get(&request_id) {
        token.cancel();
    } else if requests.len() < 32 {
        // Cancellation may precede asynchronous request admission.
        let token = host.cancelled.child_token();
        token.cancel();
        requests.insert(request_id, token);
    } else {
        drop(requests);
        host.cancelled.cancel();
    }
    Ok(())
}
fn begin_request(host: &Host, request_id: &str) -> Result<CancellationToken, String> {
    let token = host.cancelled.child_token();
    active(host, &token)?;
    let mut requests = host.requests.lock().map_err(|_| ERROR)?;
    if requests
        .get(request_id)
        .is_some_and(CancellationToken::is_cancelled)
    {
        requests.remove(request_id);
        return Err(CANCELLED.into());
    }
    if requests.len() >= 32 || requests.contains_key(request_id) {
        return Err("native.plugins.stateBusy".into());
    }
    requests.insert(request_id.into(), token.clone());
    Ok(token)
}
async fn execute_request(
    app: tauri::AppHandle,
    host: Arc<Host>,
    request_id: String,
    request: Request,
) -> Result<Value, String> {
    let token = begin_request(&host, &request_id)?;
    let cleanup = RequestCleanup {
        host: host.clone(),
        id: request_id,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _cleanup = cleanup;
        active(&host, &token)?;
        check_recovery(&app, &host.scope, &host.plugin, host.test_id.is_some())?;
        if let Some(test_id) = &host.test_id {
            return crate::plugin_changes::with_test_context(
                &app,
                &host.window,
                &host.scope,
                test_id,
                &host.plugin,
                |root| {
                    active(&host, &token)?;
                    let location = Location {
                        id: format!("test-{test_id}"),
                        name: String::new(),
                        display: String::new(),
                        kind: "path".into(),
                        handle: root.to_string_lossy().into_owned(),
                    };
                    dispatch(
                        &app,
                        &host,
                        root,
                        (location, host.test_files.clone()),
                        request,
                        &token,
                    )
                },
            );
        }
        // Long-running work must release the workspace operation lock so Stop can cancel it.
        #[cfg(target_os = "macos")]
        if matches!(
            request,
            Request::Read { .. }
                | Request::FilesList { .. }
                | Request::FilesSearch { .. }
                | Request::FilesReadMany { .. }
                | Request::Process { .. }
        ) {
            let is_process = matches!(request, Request::Process { .. });
            return crate::workspaces::with_retained_read(
                &app,
                &host.window,
                &host.authorization,
                |location| {
                    active(&host, &token)?;
                    check_recovery(&app, &host.scope, &host.plugin, false)?;
                    let root = crate::files::local_root(&app, location)?.ok_or(ERROR)?;
                    authorize_plugin(
                        &root,
                        &host.plugin,
                        crate::plugin_recovery::blocked(&app, &host.scope, &host.plugin),
                    )?;
                    let (_, files) =
                        crate::workspaces::file_session(&app, &host.window, &host.scope)?;
                    let lease = crate::plugin_actions::lease_request(
                        &app,
                        &host.scope,
                        &root,
                        &host.plugin,
                        &host.revisions,
                        &host.incarnations,
                    )?;
                    let process = if is_process {
                        Some(app.state::<Hosts>().1.admit(&host.scope, &token)?)
                    } else {
                        None
                    };
                    Ok((root, location.clone(), files, lease, process))
                },
                |(root, location, files, _lease, _process)| {
                    authorize_plugin(
                        root,
                        &host.plugin,
                        crate::plugin_recovery::blocked(&app, &host.scope, &host.plugin),
                    )?;
                    dispatch(
                        &app,
                        &host,
                        root,
                        (location.clone(), files.clone()),
                        request,
                        &token,
                    )
                },
            );
        }
        crate::workspaces::with_retained_session(
            &app,
            &host.window,
            &host.authorization,
            |location| {
                active(&host, &token)?;
                check_recovery(&app, &host.scope, &host.plugin, false)?;
                let root = crate::files::local_root(&app, location)?.ok_or(ERROR)?;
                authorize_plugin(
                    &root,
                    &host.plugin,
                    crate::plugin_recovery::blocked(&app, &host.scope, &host.plugin),
                )?;
                let (_, files) = crate::workspaces::file_session(&app, &host.window, &host.scope)?;
                let _lease = crate::plugin_actions::lease_request(
                    &app,
                    &host.scope,
                    &root,
                    &host.plugin,
                    &host.revisions,
                    &host.incarnations,
                )?;
                dispatch(
                    &app,
                    &host,
                    &root,
                    (location.clone(), files),
                    request,
                    &token,
                )
            },
        )
    })
    .await
    .map_err(|_| ERROR.to_owned())
    .and_then(|r| r)
}
fn file_path(path: &str) -> Result<String, String> {
    if path.is_empty()
        || path.len() > 1024
        || path.split('/').any(|p| {
            p.is_empty()
                || matches!(p, "." | "..")
                || p.starts_with('.')
                || p.contains(['\\', ':'])
                || p.chars().any(char::is_control)
        })
    {
        return Err(INVALID.into());
    }
    Ok(path.into())
}
impl Area {
    fn storage(self) -> Option<storage::Area> {
        match self {
            Self::Files => None,
            Self::Config => Some(storage::Area::Config),
            Self::Data => Some(storage::Area::Data),
        }
    }
}
fn file_query<T: serde::Serialize>(
    host: &Host,
    files: &crate::files::Session,
    token: &CancellationToken,
    query: impl FnOnce() -> Result<T, String>,
) -> Result<Value, String> {
    let check = || -> Result<(), String> {
        use std::sync::atomic::Ordering;
        active(host, token)?;
        if files.detached.load(Ordering::Acquire) {
            return Err("native.files.editor.closed".into());
        }
        if files.close_ready.load(Ordering::Acquire) {
            return Err("native.files.workspace.closing".into());
        }
        Ok(())
    };
    check()?;
    let result = query();
    check()?;
    serde_json::to_value(result?).map_err(|_| ERROR.into())
}

fn dispatch(
    app: &tauri::AppHandle,
    host: &Host,
    root: &Path,
    (location, files): (Location, Arc<crate::files::Session>),
    request: Request,
    token: &CancellationToken,
) -> Result<Value, String> {
    active(host, token)?;
    if let Some(expected) = host.incarnations.get(&host.plugin)
        && situate_core::plugins::folder::incarnation(root, &host.plugin)? != *expected
    {
        return Err("native.plugins.stateConflict".into());
    }
    check_recovery(app, &host.scope, &host.plugin, host.test_id.is_some())?;
    match request {
        Request::FilesList { query } => {
            let _coordination = crate::files::CoordinatedAccess::begin(app, &location)?;
            file_query(host, &files, token, || {
                crate::plugin_file_queries::list(root, query, None, token)
            })
        }
        Request::FilesSearch { query } => {
            let _coordination = crate::files::CoordinatedAccess::begin(app, &location)?;
            let crate::plugin_file_queries::SearchQuery {
                roots,
                extensions,
                text,
            } = query;
            file_query(host, &files, token, || {
                crate::plugin_file_queries::list(
                    root,
                    crate::plugin_file_queries::Query { roots, extensions },
                    Some(&text),
                    token,
                )
            })
        }
        Request::FilesReadMany { paths } => {
            let _coordination = crate::files::CoordinatedAccess::begin(app, &location)?;
            file_query(host, &files, token, || {
                crate::plugin_file_queries::read_many(root, paths, token)
            })
        }
        Request::Read { area, path } => {
            let path = file_path(&path)?;
            if let Some(area) = area.storage() {
                return serde_json::to_value(storage::read(root, &host.plugin, area, &path)?)
                    .map_err(|_| ERROR.into());
            }
            let mut text = String::new();
            let mut revision = None;
            loop {
                active(host, token)?;
                let request = serde_json::from_value(
                    json!({"operation":"read","path":path,"limit":32_768,"offset":text.len()}),
                )
                .map_err(|_| ERROR)?;
                let page = crate::files::agent_request(
                    app,
                    (location.clone(), files.clone()),
                    request,
                    Some(token.clone()),
                )?;
                let current = page["revision"].as_str().ok_or(ERROR)?;
                if revision.as_deref().is_some_and(|r| r != current) {
                    return Err("native.content.base.mismatch".into());
                }
                revision = Some(current.to_owned());
                if page["totalBytes"].as_u64().ok_or(ERROR)? > LIMIT as u64 {
                    return Err("native.plugins.tooLarge".into());
                }
                text.push_str(page["text"].as_str().ok_or(ERROR)?);
                if page["nextOffset"].is_null() {
                    break;
                }
            }
            Ok(json!({"text":text,"revision":revision}))
        }
        Request::Write {
            area,
            path,
            text,
            expected_revision,
        } => {
            if text.len() > LIMIT {
                return Err("native.plugins.tooLarge".into());
            }
            let path = file_path(&path)?;
            if let Some(area) = area.storage() {
                return serde_json::to_value(storage::write(
                    root,
                    &host.plugin,
                    area,
                    &path,
                    &text,
                    expected_revision.as_deref(),
                )?)
                .map_err(|_| ERROR.into());
            }
            let request=serde_json::from_value(json!({"operation":"write","path":path,"text":text,"expectedRevision":expected_revision})).map_err(|_| ERROR)?;
            crate::files::agent_request(app, (location, files), request, Some(token.clone()))
        }
        Request::ProcessCapability {} => serde_json::to_value(process_capability(
            host.test_id.is_some(),
            location.kind == "path",
        ))
        .map_err(|_| ERROR.into()),
        Request::Process {
            executable,
            args,
            timeout_ms,
        } => {
            crate::files::validate_process(&executable, &args, timeout_ms.unwrap_or(30_000))?;
            if host.test_id.is_some() {
                return synthetic_process(&host.processes, &executable, &args);
            }
            if !process_capability(false, location.kind == "path").available {
                return Err("native.files.operation.unavailable".into());
            }
            crate::files::process_request(
                app,
                (location, files),
                executable,
                args,
                timeout_ms,
                token.clone(),
            )
        }
        Request::Http {
            url,
            method,
            headers,
            body,
        } => {
            if host.test_id.is_some() {
                let key = format!(
                    "{} {}",
                    method.as_deref().unwrap_or("GET").to_ascii_uppercase(),
                    url
                );
                let response = host
                    .responses
                    .get(&key)
                    .ok_or("native.plugins.testNetworkBlocked")?;
                return serde_json::to_value(response).map_err(|_| ERROR.into());
            }
            tauri::async_runtime::block_on(http(url, method, headers, body, token))
        }
        request => {
            let base = if host.test_id.is_some() {
                root.join(".situate/test-credential-master")
            } else {
                app.path()
                    .app_local_data_dir()
                    .map_err(|_| ERROR)?
                    .join("plugin-credential-master")
            };
            if host.test_id.is_some() {
                credentials(
                    root,
                    &host.scope,
                    &host.plugin,
                    request,
                    host.test_keys.as_ref(),
                    &base,
                )
            } else {
                credentials(
                    root,
                    &host.scope,
                    &host.plugin,
                    request,
                    &PlatformKeys(app),
                    &base,
                )
            }
        }
    }
}
fn process_capability(testing: bool, path_backed: bool) -> crate::shell_host::ShellCapability {
    let mut capability = if testing {
        crate::shell_host::capability()
    } else {
        crate::files::process_capability(path_backed)
    };
    if testing {
        capability.available = true;
        capability.implementation = "syntheticProcess";
        capability.ownership = "none";
        capability.unavailable_reason = None;
    } else if !cfg!(target_os = "macos") {
        capability.available = false;
        capability.unavailable_reason = Some("platformHostNotImplemented");
    }
    capability.max_output_bytes_per_stream = 32_768;
    capability
}

fn synthetic_process(
    fixtures: &[crate::plugin_checks::ProcessFixture],
    executable: &str,
    args: &[String],
) -> Result<Value, String> {
    let fixture = fixtures
        .iter()
        .find(|f| f.executable == executable && f.args.as_deref().unwrap_or_default() == args)
        .ok_or("native.plugins.testProcessBlocked")?;
    let output = |text: &str| crate::shell_host::CommandOutput {
        text: text.into(),
        captured_bytes: text.len(),
        total_bytes: text.len() as u64,
        truncated: false,
        incomplete: false,
    };
    crate::files::process_reply(
        Ok(crate::shell_host::CommandResult {
            outcome: crate::shell_host::CommandOutcome::Exited,
            exit_code: Some(fixture.exit_code),
            signal: None,
            stdout: output(&fixture.stdout),
            stderr: output(&fixture.stderr),
        }),
        None,
        None,
        None,
    )
}

#[derive(Default)]
pub(crate) struct EphemeralKeys(Mutex<HashMap<String, Vec<u8>>>);
impl KeyStore for EphemeralKeys {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        self.0
            .lock()
            .map_err(|_| ERROR)?
            .get(account)
            .cloned()
            .ok_or(ERROR.into())
    }
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| ERROR)?
            .insert(account.into(), key.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().map_err(|_| ERROR)?.remove(account);
        Ok(())
    }
}
struct PlatformKeys<'a>(&'a tauri::AppHandle);
impl KeyStore for PlatformKeys<'_> {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        #[cfg(feature = "native-smoke")]
        if let Some(keys) = crate::ai::plugin_checks_smoke::document_source_keys(self.0)? {
            return keys.get(account);
        }
        crate::provider_platform::key_get(self.0, account)
    }
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
        #[cfg(feature = "native-smoke")]
        if let Some(keys) = crate::ai::plugin_checks_smoke::document_source_keys(self.0)? {
            return keys.set(account, key);
        }
        crate::provider_platform::key_set(self.0, account, key)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        #[cfg(feature = "native-smoke")]
        if let Some(keys) = crate::ai::plugin_checks_smoke::document_source_keys(self.0)? {
            return keys.delete(account);
        }
        crate::provider_platform::key_delete(self.0, account)
    }
}
pub(crate) fn seed_test_credential(
    root: &Path,
    scope: &str,
    plugin: &str,
    name: &str,
    value: &str,
    keys: &EphemeralKeys,
) -> Result<(), String> {
    credentials(
        root,
        scope,
        plugin,
        Request::CredentialSet {
            name: name.into(),
            value: value.into(),
        },
        keys,
        &root.join(".situate/test-credential-master"),
    )
    .map(|_| ())
}

fn private_directory(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        private_directory(parent)?;
    }
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = std::fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path).map_err(|_| ERROR)?;
        }
        _ => return Err(ERROR.into()),
    }
    Ok(())
}
fn master_storage(base: &Path) -> Result<Storage, String> {
    private_directory(&base.join(".situate"))?;
    Storage::open(base, "plugin-credential-master-v1")
}
fn master_key(
    storage: &Storage,
    keys: &impl KeyStore,
) -> Result<situate_core::plugins::credentials::Secret, String> {
    if let Some(key) = storage.load(keys)? {
        return Ok(key);
    }
    let key = situate_core::plugins::credentials::new_key();
    storage.save(keys, &key)?;
    Ok(key)
}

pub(crate) fn prepare_credentials(
    app: &tauri::AppHandle,
    root: &Path,
    scope: &str,
) -> Result<(), String> {
    let pending = situate_core::plugins::credentials::pending_migration(root)?;
    if pending.is_empty() {
        return Ok(());
    }
    let base = app.path().app_local_data_dir().map_err(|_| ERROR)?;
    migrate_credentials(
        root,
        scope,
        &pending,
        &base.join("plugin-credentials"),
        &base.join("plugin-credential-master"),
        &PlatformKeys(app),
    )
}

fn migrate_credentials(
    root: &Path,
    scope: &str,
    pending: &[String],
    legacy_base: &Path,
    master_base: &Path,
    keys: &impl KeyStore,
) -> Result<(), String> {
    let master = master_storage(master_base)?;
    let _lock = master.lock_credentials()?;
    let key = master_key(&master, keys)?;
    for plugin in pending {
        let incarnation = situate_core::plugins::folder::incarnation(root, plugin)?;
        let (path, identity) = credential_location(legacy_base, scope, plugin);
        match std::fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
                let old = Storage::open(&path, &identity)?;
                let _old_lock = old.lock_credentials()?;
                if let Some(bytes) = old.load(keys)? {
                    if situate_core::plugins::credentials::load(
                        root,
                        plugin,
                        scope,
                        &key,
                        &incarnation,
                    )?
                    .is_none()
                    {
                        situate_core::plugins::credentials::save(
                            root,
                            plugin,
                            scope,
                            &key,
                            &bytes,
                            &incarnation,
                        )?;
                    }
                    situate_core::plugins::credentials::sync(root, plugin)?;
                    if situate_core::plugins::folder::incarnation(root, plugin)? != incarnation {
                        return Err("native.plugins.stateConflict".into());
                    }
                    old.remove(keys)?;
                }
                drop(_old_lock);
                drop(old);
                std::fs::remove_dir_all(&path).map_err(|_| ERROR)?;
                let parent = std::fs::File::open(legacy_base).map_err(|_| ERROR)?;
                parent
                    .sync_all()
                    .map_err(|_| "native.plugins.stateOutcomeUnknown")?;
            }
            _ => return Err(ERROR.into()),
        }
        situate_core::plugins::credentials::finish_migration(root, plugin)?;
    }
    Ok(())
}

fn credential_location(base: &Path, scope: &str, plugin: &str) -> (PathBuf, String) {
    let identity = format!("plugin:{}:{scope}:{plugin}", scope.len());
    let hash = format!("{:x}", Sha256::digest(identity.as_bytes()));
    (base.join(&hash), format!("plugin-{hash}"))
}
fn credentials(
    root: &Path,
    scope: &str,
    plugin: &str,
    request: Request,
    keys: &impl KeyStore,
    master_base: &Path,
) -> Result<Value, String> {
    let (name, value, remove) = match request {
        Request::CredentialGet { name } => (name, None, false),
        Request::CredentialSet { name, value } => (name, Some(value), false),
        Request::CredentialRemove { name } => (name, None, true),
        _ => return Err(ERROR.into()),
    };
    identifier(&name)?;
    if value.as_ref().is_some_and(|v| v.len() > 16_384) {
        return Err("native.plugins.tooLarge".into());
    }
    let incarnation = situate_core::plugins::folder::incarnation(root, plugin)?;
    let master_store = master_storage(master_base)?;
    let _lock = master_store.lock_credentials().map_err(|_| ERROR)?;
    let key = master_key(&master_store, keys)?;
    let stored = situate_core::plugins::credentials::load(root, plugin, scope, &key, &incarnation)?;
    let mut values: BTreeMap<String, String> = match stored {
        Some(bytes) => serde_json::from_slice(&bytes).map_err(|_| ERROR)?,
        None if remove => return Err("native.plugins.credentialMissing".into()),
        None => BTreeMap::new(),
    };
    if value.is_none() && !remove {
        return values
            .get(&name)
            .map(|v| json!(v))
            .ok_or_else(|| "native.plugins.credentialMissing".into());
    }
    if let Some(value) = value {
        values.insert(name, value);
    } else {
        values.remove(&name);
    }
    let bytes = serde_json::to_vec(&values).map_err(|_| ERROR)?;
    if values.len() > 64 || bytes.len() > 65_536 {
        return Err("native.plugins.tooLarge".into());
    }
    situate_core::plugins::credentials::save(root, plugin, scope, &key, &bytes, &incarnation)?;
    Ok(Value::Null)
}
async fn http(
    url: String,
    method: Option<String>,
    headers: BTreeMap<String, String>,
    body: Option<String>,
    token: &CancellationToken,
) -> Result<Value, String> {
    if url.len() > 8192 {
        return Err(ERROR.into());
    }
    let url = reqwest::Url::parse(&url).map_err(|_| ERROR)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(ERROR.into());
    }
    let method = method.as_deref().unwrap_or("GET");
    if !matches!(method, "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE")
        || headers.len() > 32
        || headers
            .iter()
            .map(|(k, v)| k.len() + v.len())
            .sum::<usize>()
            > 16_384
        || body.as_ref().is_some_and(|v| v.len() > LIMIT)
    {
        return Err(ERROR.into());
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| ERROR)?;
    let operation = async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| ERROR)?;
        let mut request = client.request(method, url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        if let Some(body) = body {
            request = request.body(body);
        }
        let response = request.send().await.map_err(|_| ERROR)?;
        let status = response.status().as_u16();
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| ERROR)?;
            if bytes.len() + chunk.len() > LIMIT {
                return Err("native.plugins.tooLarge".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = String::from_utf8(bytes).map_err(|_| ERROR)?;
        Ok(json!({"status":status,"body":body}))
    };
    tokio::select! {biased; _=token.cancelled()=>Err(CANCELLED.into()),result=operation=>result}
}

#[cfg(test)]
#[path = "plugin_host_tests.rs"]
mod tests;
