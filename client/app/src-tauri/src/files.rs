#[cfg(feature = "native-smoke")]
#[path = "../tests/support/editor_smoke.rs"]
pub mod smoke;

#[cfg(test)]
#[path = "files_tests.rs"]
mod tests;

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
#[path = "files_contract.rs"]
mod contracts;
use contracts::Choice;
#[path = "files_contract_reply.rs"]
mod replies;
use serde_json::{Value, json};
use situate_core::{
    content::{ContentStore, Draft, SaveOutcome, TextVersion, VersionChoice},
    metadata, rendering,
    workspaces::Location,
};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Manager;

#[derive(Default)]
pub struct Session {
    inner: Mutex<ContentSession>,
    pub detached: AtomicBool,
    pub close_ready: AtomicBool,
}
#[derive(Default)]
struct ContentSession {
    store: Option<ContentStore>,
    root: Option<PathBuf>,
    reviews: HashMap<String, ReviewInfo>,
    paused: Option<String>,
    pending_paths: HashSet<String>,
}
struct ReviewInfo {
    path: String,
    editor_revision: String,
    external_revision: String,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum Operation {
    Snapshot,
    Read,
    InspectTasks,
    CaptureReference,
    ResolveReference,
    Stage,
    Save,
    Resolve,
    Discard,
    Create,
    Mkdir,
    Rename,
    Copy,
    Delete,
    History,
    Revision,
    Restore,
    HistoricalCopy,
    Revert,
    OpenExternal,
    Resource,
    Export,
    Detach,
    QuitReady,
    CancelQuit,
}
#[derive(Debug)]
pub struct Request {
    workspace_id: String,
    plugin_id: Option<String>,
    operation: Operation,
    path: Option<String>,
    destination: Option<String>,
    href: Option<String>,
    text: Option<String>,
    base: Option<TextVersion>,
    token: Option<String>,
    choice: Option<Choice>,
    revision: Option<String>,
    expected_revision: Option<String>,
    reference: Option<situate_core::conversation_runtime::ContentReference>,
    render: bool,
    force: bool,
    confirm_id_change: bool,
    exact_path: bool,
    include_deleted: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestFields {
    workspace_id: String,
    plugin_id: Option<String>,
    operation: Operation,
    path: Option<String>,
    destination: Option<String>,
    href: Option<String>,
    text: Option<String>,
    base: Option<TextVersion>,
    token: Option<String>,
    choice: Option<Choice>,
    revision: Option<String>,
    expected_revision: Option<String>,
    reference: Option<situate_core::conversation_runtime::ContentReference>,
    #[serde(default)]
    render: bool,
    #[serde(default)]
    force: bool,
    #[serde(default)]
    confirm_id_change: bool,
    #[serde(default)]
    exact_path: bool,
    #[serde(default)]
    include_deleted: bool,
}
impl From<RequestFields> for Request {
    fn from(value: RequestFields) -> Self {
        Self {
            workspace_id: value.workspace_id,
            plugin_id: value.plugin_id,
            operation: value.operation,
            path: value.path,
            destination: value.destination,
            href: value.href,
            text: value.text,
            base: value.base,
            token: value.token,
            choice: value.choice,
            revision: value.revision,
            expected_revision: value.expected_revision,
            reference: value.reference,
            render: value.render,
            force: value.force,
            confirm_id_change: value.confirm_id_change,
            exact_path: value.exact_path,
            include_deleted: value.include_deleted,
        }
    }
}
fn required<'a>(value: &'a Option<String>, message: &str) -> Result<&'a str, String> {
    value.as_deref().ok_or_else(|| message.to_owned())
}
fn err(e: impl std::fmt::Display) -> String {
    situate_core::messages::supplied(e, "native.files.operation.failed")
}

#[tauri::command]
pub async fn files_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
    diagnostic: Option<Value>,
) -> Result<replies::Reply, String> {
    #[cfg(feature = "native-smoke")]
    let diagnostic_started = std::time::Instant::now();
    let diagnostic = crate::diagnostics::Operation::begin(
        &app,
        window.label(),
        &request.workspace_id,
        crate::diagnostics::OperationKind::File(request.operation.diagnostic_action()),
        diagnostic.and_then(crate::diagnostics::parse_context),
    );
    #[cfg(feature = "native-smoke")]
    crate::diagnostics::smoke::record_file_stage(
        crate::diagnostics::smoke::FileStage::DiagnosticStart,
        diagnostic_started.elapsed(),
    );
    let result = execute_request(app, window, request).await;
    #[cfg(feature = "native-smoke")]
    let diagnostic_finished = std::time::Instant::now();
    if let Some(diagnostic) = diagnostic {
        let (outcome, error) = diagnostic_outcome(&result);
        diagnostic.finish(outcome, error);
    }
    #[cfg(feature = "native-smoke")]
    crate::diagnostics::smoke::record_file_stage(
        crate::diagnostics::smoke::FileStage::DiagnosticFinish,
        diagnostic_finished.elapsed(),
    );
    result
}

pub(crate) fn recorded_revision(
    root: &Path,
    session: &Session,
    path: &str,
    revision: &str,
) -> Result<Vec<u8>, String> {
    let content = session.inner.lock().map_err(err)?;
    require_active(session, &content)?;
    if let Some(store) = content.store.as_ref() {
        return store
            .read_revision_bounded(path, revision, 1_048_576)
            .map_err(err);
    }
    ContentStore::open_existing_history(root, &root.join(".situate"))
        .map_err(err)?
        .read_revision_bounded(path, revision, 1_048_576)
        .map_err(err)
}

pub(crate) fn recorded_changes_between(
    root: &Path,
    session: &Session,
    before: &str,
    after: &str,
) -> Result<Vec<situate_core::content::RevisionChange>, String> {
    let content = session.inner.lock().map_err(err)?;
    require_active(session, &content)?;
    if let Some(store) = content.store.as_ref() {
        return store.changes_between_revisions(before, after).map_err(err);
    }
    ContentStore::open_existing_history(root, &root.join(".situate"))
        .map_err(err)?
        .changes_between_revisions(before, after)
        .map_err(err)
}

fn diagnostic_outcome(
    result: &Result<replies::Reply, String>,
) -> (&'static str, Option<&'static str>) {
    use replies::Reply;
    match result {
        Err(_) => ("failure", Some("unknown")),
        Ok(Reply::Cancelled) => ("cancelled", None),
        Ok(
            Reply::Conflict { .. }
            | Reply::Changed { .. }
            | Reply::IdentityConfirmation
            | Reply::Deleted,
        ) => ("rejected", Some("conflict")),
        Ok(
            Reply::SavedHistoryFailed { .. }
            | Reply::SavedDraftCleanupFailed { .. }
            | Reply::PartialFailure { .. },
        ) => ("failure", Some("io")),
        Ok(_) => ("success", None),
    }
}

impl Operation {
    fn diagnostic_action(self) -> &'static str {
        match self {
            Self::Stage => "stage",
            Self::Save | Self::Resolve => "save",
            Self::Create | Self::Mkdir => "create",
            Self::Rename => "rename",
            Self::Copy | Self::HistoricalCopy | Self::Export => "copy",
            Self::Delete | Self::Discard => "delete",
            Self::History | Self::Revision => "history",
            Self::Restore | Self::Revert => "restore",
            Self::OpenExternal => "open",
            Self::Detach | Self::QuitReady => "close",
            Self::CancelQuit => "cancel",
            Self::Snapshot
            | Self::Read
            | Self::InspectTasks
            | Self::CaptureReference
            | Self::ResolveReference
            | Self::Resource => "read",
        }
    }
}

async fn execute_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<replies::Reply, String> {
    #[cfg(feature = "native-smoke")]
    let authorization_started = std::time::Instant::now();
    let (authorization, ownership) = if matches!(
        request.operation,
        Operation::QuitReady | Operation::CancelQuit
    ) {
        (None, None)
    } else {
        let ownership = super::workspaces::control_authorization_session(
            &app,
            window.label(),
            &request.workspace_id,
        )?;
        let session = ownership.file_context();
        (Some(session), Some(ownership))
    };
    #[cfg(feature = "native-smoke")]
    crate::diagnostics::smoke::record_file_stage(
        crate::diagnostics::smoke::FileStage::Authorization,
        authorization_started.elapsed(),
    );
    #[cfg(feature = "native-smoke")]
    let queued = std::time::Instant::now();
    tauri::async_runtime::spawn_blocking(move || {
        let _ownership = ownership;
        #[cfg(feature = "native-smoke")]
        let started = std::time::Instant::now();
        #[cfg(feature = "native-smoke")]
        crate::diagnostics::smoke::record_file_stage(
            crate::diagnostics::smoke::FileStage::DispatchQueue,
            queued.elapsed(),
        );
        let result = (|| {
            let operation = request.operation;
            let value = dispatch(&app, window.label(), request, authorization)?;
            replies::Reply::validate(&operation, value)
        })();
        #[cfg(feature = "native-smoke")]
        crate::diagnostics::smoke::record_file_stage(
            crate::diagnostics::smoke::FileStage::Execution,
            started.elapsed(),
        );
        result
    })
    .await
    .map_err(|_| "native.files.operation.failed".to_owned())?
}

fn dispatch(
    app: &tauri::AppHandle,
    window: &str,
    request: Request,
    authorization: Option<(Location, Arc<Session>)>,
) -> Result<Value, String> {
    if request.operation == Operation::CancelQuit {
        return crate::lifecycle::cancel_quit(
            app,
            window,
            required(&request.token, "native.files.quit.tokenMissing")?,
        );
    }
    if request.operation == Operation::QuitReady {
        return crate::lifecycle::quit_ready(
            app,
            window,
            required(&request.token, "native.files.quit.tokenMissing")?,
        );
    }
    let (location, session) = authorization.ok_or("native.files.workspace.sessionRequired")?;
    if session.detached.load(Ordering::Acquire) {
        return if request.operation == Operation::Detach {
            Ok(json!({"status":"ok"}))
        } else {
            Err("native.files.editor.closed".into())
        };
    }
    if request.operation == Operation::Export {
        return match export(
            app,
            &session,
            required(&request.text, "native.files.export.textMissing")?,
            request.path.as_deref().unwrap_or(""),
        )? {
            true => Ok(json!({"status":"ok"})),
            false => Ok(json!({"status":"cancelled"})),
        };
    }
    let mut content = session.inner.lock().map_err(err)?;
    require_active(&session, &content)?;
    if let Some(plugin_id) = &request.plugin_id {
        let root = local_root(app, &location)?.ok_or("native.plugins.unavailable")?;
        let _coordination = CoordinatedAccess::begin(app, &location)?;
        return plugin_request(&root, plugin_id, &request, |target| {
            if remote_url(target).is_ok() {
                return open_external(app, &location, None, target);
            }
            #[cfg(desktop)]
            {
                launch_default(target)
            }
            #[cfg(mobile)]
            {
                Err("native.files.provider.unavailableOnDevice".into())
            }
        });
    }
    if request.operation == Operation::Detach {
        prepare_close(&session, &content, request.force)?;
        return Ok(json!({"status":"ok"}));
    }
    if matches!(
        location.kind.as_str(),
        "path" | "android-documents" | "ios-documents"
    ) && (matches!(
        request.operation,
        Operation::Stage | Operation::Save | Operation::Resolve
    ) || request.operation == Operation::Restore && request.text.is_some())
    {
        content
            .pending_paths
            .insert(required(&request.path, "native.files.choose")?.into());
    }
    let root = local_root(app, &location)?;
    let _coordination = CoordinatedAccess::begin(app, &location)?;
    if let Some(root) = &root {
        content.root = Some(root.clone());
        if content.store.is_none() {
            match ContentStore::open(root) {
                Ok(store) => content.store = Some(store),
                Err(error) if request.operation == Operation::Snapshot => {
                    let drafts = situate_core::content::read_recovery_drafts(root).map_err(err)?;
                    let entries = situate_core::content::list_content(root)
                        .map_err(err)?
                        .into_iter()
                        .map(|e| json!({"path":e.path,"isDirectory":e.is_directory}))
                        .collect::<Vec<_>>();
                    return Ok(
                        json!({"status":"ok", "snapshot":{"writable":false,"canExport":cfg!(desktop),"reason":error.to_string(),"entries":entries,"drafts":drafts}}),
                    );
                }
                Err(_) if request.operation == Operation::Discard => {
                    let path = required(&request.path, "native.files.draft.choose")?;
                    let discarded = situate_core::content::discard_recovery_draft(root, path);
                    let local = content.pending_paths.remove(path);
                    if discarded.is_err() && local {
                        return Ok(
                            json!({"status":"ok","message":"native.files.draft.cleanupFailed"}),
                        );
                    }
                    discarded.map_err(err)?;
                    return Ok(json!({"status":"ok"}));
                }
                Err(_)
                    if matches!(
                        request.operation,
                        Operation::Read
                            | Operation::InspectTasks
                            | Operation::Resource
                            | Operation::OpenExternal
                    ) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    if request.operation == Operation::OpenExternal {
        let target = open_target(
            request.path.as_deref(),
            request.href.as_deref(),
            request.destination.as_deref(),
        )?;
        let target = if let Some(id) = target.strip_prefix("situate:") {
            resolve_identity(app, &location, &content, id)?
        } else {
            target
        };
        if remote_url(&target).is_err()
            && text_from_bytes(&read_bytes(
                app,
                &location,
                content.root.as_deref(),
                &target,
            )?)?
            .is_some()
        {
            let version = if let Some(store) = &content.store {
                store.read_text(&target).map_err(err)?
            } else {
                TextVersion {
                    text: String::from_utf8(read_bytes(
                        app,
                        &location,
                        content.root.as_deref(),
                        &target,
                    )?)
                    .map_err(err)?,
                    revision: "provider-read-only".into(),
                }
            };
            return Ok(
                json!({"status":"ok","document":document(app,&location,content.root.as_deref(),&target,version,None)}),
            );
        }
        let root = content.root.clone();
        drop(_coordination);
        drop(content);
        open_external(app, &location, root.as_deref(), &target)?;
        return Ok(json!({"status":"ok"}));
    }
    execute(app, &location, &mut content, request)
}

fn text_from_bytes(bytes: &[u8]) -> Result<Option<&str>, String> {
    use situate_core::content::{FileContent, classify_file};
    match classify_file(bytes).map_err(err)? {
        FileContent::Text(text) => Ok(Some(text)),
        FileContent::Binary => Ok(None),
    }
}

fn plugin_document(
    root: &Path,
    plugin_id: &str,
    path: &str,
    preview: Option<&str>,
) -> Result<Value, String> {
    let bytes = situate_core::plugins::read_bytes(root, plugin_id, path).map_err(err)?;
    let Some(text) = text_from_bytes(&bytes)? else {
        return Ok(json!({"status":"binary"}));
    };
    let version = TextVersion {
        text: text.into(),
        revision: situate_core::content::revision_for_text(text).map_err(err)?,
    };
    let source = preview.unwrap_or(text);
    let (html, issues) = if markdown(path).is_ok() {
        let html = rendering::render_markdown(source, |url| {
            if remote_url(url).is_ok() {
                return Some(url.into());
            }
            let path = relative_resource(path, url).ok()?;
            let bytes = situate_core::plugins::read_bytes(root, plugin_id, &path).ok()?;
            image_bytes(&bytes).ok()
        });
        (html, metadata::inspect(source).issues)
    } else {
        (String::new(), Vec::new())
    };
    Ok(
        json!({"status":"ok","document":{"path":path,"version":version,"html":html,"issues":issues}}),
    )
}

fn plugin_request(
    root: &Path,
    plugin_id: &str,
    request: &Request,
    open: impl Fn(&str) -> Result<(), String>,
) -> Result<Value, String> {
    match request.operation {
        Operation::Snapshot => {
            let entries = situate_core::plugins::files(root, plugin_id).map_err(err)?;
            Ok(
                json!({"status":"ok","snapshot":{"writable":false,"reason":null,"entries":entries,"drafts":[]}}),
            )
        }
        Operation::Read => plugin_document(
            root,
            plugin_id,
            required(&request.path, "native.files.choose")?,
            request.text.as_deref(),
        ),
        Operation::OpenExternal => {
            let target = open_target(
                request.path.as_deref(),
                request.href.as_deref(),
                request.destination.as_deref(),
            )?;
            // Even remote links must come from an authorized package.
            situate_core::plugins::files(root, plugin_id).map_err(err)?;
            if remote_url(&target).is_ok() {
                return open(&target).map(|_| json!({"status":"ok"}));
            }
            let reply = plugin_document(root, plugin_id, &target, None)?;
            if reply["status"] != "binary" {
                return Ok(reply);
            }
            let bytes = situate_core::plugins::read_bytes(root, plugin_id, &target).map_err(err)?;
            require_external_binary(&target, &bytes)?;
            let path = root
                .join(".situate/plugins")
                .join(plugin_id)
                .join("code")
                .join(&target);
            open(path.to_str().ok_or("native.files.path.unsupported")?)?;
            Ok(json!({"status":"ok"}))
        }
        _ => Err("native.files.provider.readOnly".into()),
    }
}

fn require_external_binary(path: &str, bytes: &[u8]) -> Result<(), String> {
    if text_from_bytes(bytes)?.is_some() {
        return Err("native.files.external.openFailed".into());
    }
    let executable = [
        b"MZ".as_slice(),
        b"\x7fELF",
        b"\xfe\xed\xfa\xce",
        b"\xce\xfa\xed\xfe",
        b"\xfe\xed\xfa\xcf",
        b"\xcf\xfa\xed\xfe",
        b"\xca\xfe\xba\xbe",
        b"\xbe\xba\xfe\xca",
        b"\xca\xfe\xba\xbf",
        b"\xbf\xba\xfe\xca",
    ]
    .iter()
    .any(|magic| bytes.starts_with(magic));
    let extension = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if executable
        || matches!(
            extension.as_str(),
            "app"
                | "exe"
                | "com"
                | "bat"
                | "cmd"
                | "command"
                | "sh"
                | "bash"
                | "zsh"
                | "fish"
                | "ps1"
                | "scpt"
                | "scptd"
                | "applescript"
                | "workflow"
                | "js"
                | "mjs"
                | "cjs"
                | "py"
                | "rb"
                | "pl"
                | "php"
                | "jar"
                | "desktop"
                | "url"
                | "webloc"
                | "lnk"
                | "vbs"
                | "wsf"
                | "hta"
        )
    {
        return Err("native.files.external.openFailed".into());
    }
    Ok(())
}

#[cfg(desktop)]
fn launch_default(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("/usr/bin/open")
        .arg("--")
        .arg(target)
        .status();
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("xdg-open").arg(target).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", target])
        .status();
    if !status.map_err(err)?.success() {
        return Err("native.files.external.openFailed".into());
    }
    Ok(())
}

fn require_active(session: &Session, content: &ContentSession) -> Result<(), String> {
    if session.detached.load(Ordering::Acquire) {
        return Err("native.files.editor.closed".into());
    }
    if session.close_ready.load(Ordering::Acquire) {
        return Err("native.files.workspace.closing".into());
    }
    if content.paused.is_some() {
        return Err("native.files.quit.otherWindows".into());
    }
    Ok(())
}
fn prepare_close(session: &Session, content: &ContentSession, force: bool) -> Result<(), String> {
    if !force {
        ensure_secured(content)?;
    }
    session.close_ready.store(true, Ordering::Release);
    Ok(())
}
pub fn resume_close(session: &Session) {
    session.close_ready.store(false, Ordering::Release);
}
pub fn complete_close(session: &Session) {
    let mut content = session
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    session.detached.store(true, Ordering::Release);
    content.store = None;
}
fn detach(session: &Session, content: &mut ContentSession) -> Result<(), String> {
    ensure_secured(content)?;
    session.detached.store(true, Ordering::Release);
    content.store = None;
    Ok(())
}

fn ensure_secured(content: &ContentSession) -> Result<(), String> {
    if !content.pending_paths.is_empty() {
        return Err("native.files.draft.remain".into());
    }
    Ok(())
}

pub(crate) struct CoordinatedAccess {
    app: tauri::AppHandle,
    scope: String,
    token: Option<String>,
}
impl CoordinatedAccess {
    pub(crate) fn begin(app: &tauri::AppHandle, location: &Location) -> Result<Self, String> {
        #[cfg(target_os = "ios")]
        let token = if location.kind == "ios-documents" {
            let result = native_content(app, location, "beginAccess", "")?;
            Some(
                result["token"]
                    .as_str()
                    .ok_or("native.files.coordination.startFailed")?
                    .to_owned(),
            )
        } else {
            None
        };
        #[cfg(not(target_os = "ios"))]
        let token = None;
        Ok(Self {
            app: app.clone(),
            scope: location.id.clone(),
            token,
        })
    }

    pub(crate) fn needs_release(&self) -> bool {
        self.token.is_some()
    }

    pub(crate) fn finish(&mut self) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        if let Some(token) = &self.token {
            self.app
                .state::<tauri_plugin_workspace_access::Access>()
                .content(json!({"operation":"endAccess","token":token}))?;
        }
        self.token = None;
        Ok(())
    }
}
impl Drop for CoordinatedAccess {
    fn drop(&mut self) {
        if let Err(error) = self.finish() {
            let access = Self {
                app: self.app.clone(),
                scope: self.scope.clone(),
                token: self.token.take(),
            };
            self.app
                .state::<crate::ai::Ai>()
                .retain_failed_access(&self.scope, access, error);
        }
    }
}

pub(crate) fn local_root(
    app: &tauri::AppHandle,
    location: &Location,
) -> Result<Option<PathBuf>, String> {
    #[cfg(desktop)]
    {
        let _ = app;
        if location.kind != "path" {
            return Err("native.files.workspace.handleUnsupported".into());
        }
        Ok(Some(PathBuf::from(&location.handle)))
    }
    #[cfg(mobile)]
    {
        if !matches!(
            location.kind.as_str(),
            "android-documents" | "ios-documents"
        ) {
            return Ok(None);
        }
        let result = native_content(app, location, "localRoot", "")?;
        Ok(Some(PathBuf::from(
            result["path"]
                .as_str()
                .ok_or("native.files.documents.unavailable")?,
        )))
    }
}

fn prepare_agent_creation(path: &str, text: String, prepare_copy: bool) -> Result<String, String> {
    if !prepare_copy || markdown(path).is_err() {
        return Ok(text);
    }
    metadata::regenerate_copy(&text)
}

fn execute(
    app: &tauri::AppHandle,
    location: &Location,
    session: &mut ContentSession,
    request: Request,
) -> Result<Value, String> {
    let path = request.path.as_deref().unwrap_or("");
    match request.operation {
        Operation::Snapshot => {
            if let Some(store) = &mut session.store {
                store.record_external_changes().map_err(err)?;
                let entries: Vec<_> = store
                    .list()
                    .map_err(err)?
                    .into_iter()
                    .map(|e| json!({"path":e.path,"isDirectory":e.is_directory}))
                    .collect();
                let mut snapshot = json!({"writable":true,"canExport":cfg!(desktop),"reason":null,"entries":entries,"drafts":store.drafts().map_err(err)?});
                if request.include_deleted {
                    snapshot["deleted"] = json!(store.deleted_files().map_err(err)?.into_iter().map(|entry| json!({"path":entry.path,"revision":entry.revision,"isDirectory":entry.is_directory})).collect::<Vec<_>>());
                }
                Ok(json!({"status":"ok", "snapshot":snapshot}))
            } else {
                let entries = provider_list(app, location, "")?;
                Ok(
                    json!({"status":"ok","snapshot":{"writable":false,"canExport":cfg!(desktop),"reason":"native.files.workspace.readOnly","entries":entries,"drafts":[]}}),
                )
            }
        }
        Operation::CaptureReference => {
            let store = session
                .store
                .as_mut()
                .ok_or("native.files.provider.readOnly")?;
            let reference = store
                .capture_reference(&location.id, path, request.expected_revision.as_deref())
                .map_err(err)?;
            Ok(json!({"status":"ok", "reference":reference}))
        }
        Operation::ResolveReference => {
            let store = session
                .store
                .as_mut()
                .ok_or("native.files.provider.readOnly")?;
            let reference = request
                .reference
                .as_ref()
                .ok_or("native.content.reference.invalid")?;
            if reference.workspace_id() != location.id {
                return Err("native.content.reference.invalid".into());
            }
            let selected = if request.render {
                store.observe_reference(reference)
            } else {
                store.resolve_reference(reference)
            }
            .map_err(err)?;
            match selected {
                Some((reference, path, version)) => {
                    let document = if request.render {
                        if matches!(
                            reference,
                            situate_core::conversation_runtime::ContentReference::Historical { .. }
                        ) {
                            historical_view(store, &path, version)
                        } else {
                            document(app, location, session.root.as_deref(), &path, version, None)
                        }
                    } else {
                        // Sending a reference does not load additional files reached
                        // through image links.
                        let html = rendering::render_markdown(&version.text, |_| None);
                        json!({"path":path, "issues":metadata::inspect(&version.text).issues, "html":html, "version":version})
                    };
                    Ok(json!({"status":"ok", "reference":reference, "document":document}))
                }
                None => Ok(json!({"status":"deleted"})),
            }
        }
        Operation::Read | Operation::InspectTasks => {
            if request.operation == Operation::InspectTasks {
                markdown(path)?;
            }
            let bytes = read_bytes(app, location, session.root.as_deref(), path)?;
            if text_from_bytes(&bytes)?.is_none() {
                return if request.operation == Operation::Read {
                    Ok(json!({"status":"binary"}))
                } else {
                    Err("native.content.file.invalidUtf8".into())
                };
            }
            let version = if let Some(store) = &mut session.store {
                store.observe_text(path).map_err(err)?
            } else {
                let text =
                    String::from_utf8(read_bytes(app, location, session.root.as_deref(), path)?)
                        .map_err(err)?;
                TextVersion {
                    revision: "provider-read-only".into(),
                    text,
                }
            };
            if request.operation == Operation::InspectTasks {
                let tasks = metadata::inspect_tasks(&version.text)?;
                let html = rendering::render_markdown(&version.text, |_| None);
                Ok(
                    json!({"status":"ok", "document":{"path":path, "issues":metadata::inspect(&version.text).issues, "html":html, "version":version}, "tasks":tasks}),
                )
            } else {
                Ok(
                    json!({"status":"ok","document":document(app, location, session.root.as_deref(), path, version, request.text.as_deref())}),
                )
            }
        }
        Operation::Resource => Ok(
            json!({"status":"ok","dataUrl":image_data(app, location, session.root.as_deref(), path)?}),
        ),
        _ => {
            let store = session
                .store
                .as_mut()
                .ok_or("native.files.provider.readOnly")?;
            let mut submitted_revision = None;
            let outcome = match request.operation {
                Operation::Stage => {
                    safe_parts(path)?;
                    store
                        .stage_draft(&Draft {
                            path: path.into(),
                            base: request.base,
                            text: required(&request.text, "native.files.draft.textMissing")?.into(),
                        })
                        .map_err(err)?;
                    return Ok(json!({"status":"ok"}));
                }
                Operation::Discard => {
                    store.discard_draft(path).map_err(err)?;
                    session.pending_paths.remove(path);
                    return Ok(json!({"status":"ok"}));
                }
                Operation::Save => {
                    safe_parts(path)?;
                    let base = request
                        .base
                        .as_ref()
                        .ok_or("native.files.editor.baseMissing")?;
                    let text = required(&request.text, "native.files.editor.textMissing")?;
                    if markdown(path).is_ok()
                        && !request.confirm_id_change
                        && metadata::requires_identity_confirmation(&base.text, text)
                    {
                        store
                            .stage_draft(&Draft {
                                path: path.into(),
                                base: Some(base.clone()),
                                text: text.into(),
                            })
                            .map_err(err)?;
                        return Ok(json!({"status":"identityConfirmation"}));
                    }
                    submitted_revision =
                        Some(situate_core::content::revision_for_text(text).map_err(err)?);
                    store.save(path, base, text).map_err(err)?
                }
                Operation::Resolve => {
                    safe_parts(path)?;
                    let token = required(&request.token, "native.files.conflict.tokenMissing")?;
                    let review = session
                        .reviews
                        .get(token)
                        .filter(|review| review.path == path)
                        .ok_or("native.files.conflict.reviewRequired")?;
                    let choice = request
                        .choice
                        .ok_or("native.files.conflict.chooseVersion")?;
                    submitted_revision = Some(match choice {
                        Choice::Editor => review.editor_revision.clone(),
                        Choice::External => review.external_revision.clone(),
                    });
                    store
                        .resolve(
                            token,
                            match choice {
                                Choice::Editor => VersionChoice::Editor,
                                Choice::External => VersionChoice::External,
                            },
                        )
                        .map_err(err)?
                }
                Operation::Create => {
                    let destination = request.destination.as_deref().unwrap_or(path);
                    safe_parts(destination)?;
                    let text = request.text.as_deref().unwrap_or("");
                    let outcome = if request.destination.is_some() {
                        store
                            .create_from_draft(path, destination, text)
                            .map_err(err)?
                    } else {
                        store.create_text(destination, text).map_err(err)?
                    };
                    return save_reply(
                        app,
                        location,
                        session.root.as_deref(),
                        destination,
                        outcome,
                    );
                }
                Operation::History => {
                    return Ok(
                        json!({"status":"ok","history":if path.is_empty() {store.history().map_err(err)?} else if request.exact_path {store.historical_file_history(path,required(&request.revision,"native.files.deleted.chooseRevision")?).map_err(err)?} else {store.file_history(path).map_err(err)?}}),
                    );
                }
                Operation::Revision => {
                    let revision =
                        required(&request.revision, "native.files.history.chooseRevision")?;
                    let historical = if request.exact_path {
                        path.to_owned()
                    } else {
                        match store.resolved_revision_path(path, revision) {
                            Ok(path) => path,
                            Err(situate_core::content::ContentError::Io(error))
                                if error.kind() == std::io::ErrorKind::NotFound =>
                            {
                                return Ok(json!({"status":"deleted"}));
                            }
                            Err(error) => return Err(error.to_string()),
                        }
                    };
                    return historical_document(store, &historical, revision);
                }
                Operation::Mkdir => {
                    return operation_reply(store.create_folder(path).map_err(err)?);
                }
                Operation::Rename => {
                    return operation_reply(
                        store
                            .move_entry(
                                path,
                                required(&request.destination, "native.files.destination.choose")?,
                            )
                            .map_err(err)?,
                    );
                }
                Operation::Copy => {
                    return operation_reply(
                        store
                            .copy_entry(
                                path,
                                required(&request.destination, "native.files.destination.choose")?,
                            )
                            .map_err(err)?,
                    );
                }
                Operation::Delete => {
                    return operation_reply(store.delete_entry(path).map_err(err)?);
                }
                Operation::HistoricalCopy => {
                    let revision =
                        required(&request.revision, "native.files.history.chooseRevision")?;
                    let historical = if request.exact_path {
                        path.to_owned()
                    } else {
                        store.resolved_revision_path(path, revision).map_err(err)?
                    };
                    return operation_reply(
                        store
                            .historical_copy(
                                &historical,
                                revision,
                                required(&request.destination, "native.files.destination.choose")?,
                            )
                            .map_err(err)?,
                    );
                }
                Operation::Restore => {
                    if let Some(revision) = &request.revision {
                        return operation_reply(
                            store
                                .restore_deleted(
                                    path,
                                    revision,
                                    request.destination.as_deref().unwrap_or(path),
                                )
                                .map_err(err)?,
                        );
                    }
                    let base = request
                        .base
                        .as_ref()
                        .ok_or("native.files.deleted.baseMissing")?;
                    let text = required(&request.text, "native.files.draft.retainedTextMissing")?;
                    if markdown(path).is_ok()
                        && metadata::requires_identity_confirmation(&base.text, text)
                    {
                        return Err("native.files.restore.identityChanged".into());
                    }
                    store.restore_draft(path, base, text).map_err(err)?
                }
                Operation::Revert => match store
                    .reverse_entry_change(
                        path,
                        required(&request.revision, "native.files.history.chooseRevision")?,
                    )
                    .map_err(err)?
                {
                    situate_core::content::ReversalOutcome::Content(outcome) => outcome,
                    situate_core::content::ReversalOutcome::Structure(outcome) => {
                        return operation_reply(outcome);
                    }
                },
                _ => return Err("native.files.operation.unavailable".into()),
            };
            if let SaveOutcome::Conflict {
                review_token,
                editor,
                external,
            } = &outcome
            {
                session.reviews.retain(|_, review| review.path != path);
                session.reviews.insert(
                    review_token.clone(),
                    ReviewInfo {
                        path: path.into(),
                        editor_revision: situate_core::content::revision_for_text(editor)
                            .map_err(err)?,
                        external_revision: external.revision.clone(),
                    },
                );
            }
            if matches!(outcome, SaveOutcome::Saved { .. }) {
                session.pending_paths.remove(path);
            }
            let conflict_base = if matches!(
                outcome,
                SaveOutcome::Conflict { .. } | SaveOutcome::ChangedSinceReview
            ) {
                store
                    .drafts()
                    .map_err(err)?
                    .into_iter()
                    .find(|draft| draft.path == path)
                    .and_then(|draft| draft.base)
            } else {
                None
            };
            let mut reply = save_reply(app, location, session.root.as_deref(), path, outcome)?;
            if reply.get("document").is_some() {
                reply["submittedRevision"] = json!(submitted_revision);
            }
            if let Some(base) = conflict_base {
                reply["base"] = json!(base);
            }
            Ok(reply)
        }
    }
}

pub(crate) fn process_capability(path_backed: bool) -> crate::shell_host::ShellCapability {
    let mut capability = crate::shell_host::capability();
    #[cfg(feature = "native-smoke")]
    if crate::agent_e2e::enabled() {
        return crate::agent_e2e::disabled_shell_capability();
    }
    if !path_backed {
        capability.available = false;
        capability.unavailable_reason = Some("pathBackedWorkspaceRequired");
    }
    capability
}

pub(crate) fn validate_process(
    executable: &str,
    args: &[String],
    timeout_ms: u64,
) -> Result<(), String> {
    if !Path::new(executable).is_absolute()
        || executable.len() > 4096
        || executable.contains('\0')
        || args.len() > 256
        || args.iter().map(String::len).sum::<usize>() > 65_536
        || args.iter().any(|arg| arg.contains('\0'))
        || !(1..=300_000).contains(&timeout_ms)
    {
        return Err("native.plugins.invalidPath".into());
    }
    Ok(())
}

pub(crate) fn process_request(
    app: &tauri::AppHandle,
    (location, session): (Location, Arc<Session>),
    executable: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    token: tokio_util::sync::CancellationToken,
) -> Result<Value, String> {
    let timeout_ms = timeout_ms.unwrap_or(30_000);
    validate_process(&executable, &args, timeout_ms)?;
    if !cfg!(target_os = "macos") || !process_capability(location.kind == "path").available {
        return Err("native.files.operation.unavailable".into());
    }
    let mut content = session.inner.lock().map_err(err)?;
    require_active(&session, &content)?;
    let root = local_root(app, &location)?.ok_or("native.files.workspace.folderUnavailable")?;
    let _coordination = CoordinatedAccess::begin(app, &location)?;
    content.root = Some(root.clone());
    if content.store.is_none() {
        content.store = ContentStore::open(&root).ok();
    }
    execute_process(
        &mut content,
        crate::shell_host::CommandRequest {
            cwd: root,
            executable: executable.into(),
            args,
            timeout_ms,
            output_limit_bytes: 32_768,
        },
        token,
    )
}

#[cfg(test)]
pub(crate) fn execute_test_process(
    session: &Session,
    request: crate::shell_host::CommandRequest,
    token: tokio_util::sync::CancellationToken,
) -> Result<Value, String> {
    let mut content = session.inner.lock().map_err(err)?;
    require_active(session, &content)?;
    content.root = Some(request.cwd.clone());
    if content.store.is_none() {
        content.store = Some(ContentStore::open(&request.cwd).map_err(err)?);
    }
    execute_process(&mut content, request, token)
}

fn execute_process(
    content: &mut ContentSession,
    request: crate::shell_host::CommandRequest,
    token: tokio_util::sync::CancellationToken,
) -> Result<Value, String> {
    if token.is_cancelled() {
        return Err("native.ai.request.cancelled".into());
    }
    if !content.pending_paths.is_empty() {
        return Err("native.content.store.busy".into());
    }
    let store = content
        .store
        .as_mut()
        .ok_or("native.files.operation.unavailable")?;
    if !store.drafts().map_err(err)?.is_empty() {
        return Err("native.content.store.busy".into());
    }
    let before_revision = store.record_external_changes().map_err(err)?;
    let outcome = tauri::async_runtime::block_on(crate::shell_host::execute(request, token));
    let reconciliation = store.record_external_changes();
    process_reply(
        outcome,
        Some(before_revision),
        reconciliation.as_ref().ok().cloned(),
        reconciliation.err().map(err),
    )
}

pub(crate) fn process_reply(
    outcome: Result<crate::shell_host::CommandResult, crate::shell_host::ShellError>,
    before_revision: Option<String>,
    after_revision: Option<String>,
    reconciliation_error: Option<String>,
) -> Result<Value, String> {
    let is_error = reconciliation_error.is_some()
        || !matches!(&outcome, Ok(result) if result.outcome == crate::shell_host::CommandOutcome::Exited && result.exit_code == Some(0));
    Ok(
        json!({"isError":is_error,"commandResult":outcome,"beforeHistoryRevision":before_revision,"afterHistoryRevision":after_revision,"reconciliationError":reconciliation_error,"attribution":"uncertainExternalChangesMayCoexist"}),
    )
}

pub(crate) fn with_content_store<T>(
    app: &tauri::AppHandle,
    (location, session): &(Location, Arc<Session>),
    operation: impl FnOnce(&mut ContentStore) -> Result<T, String>,
) -> Result<T, String> {
    let mut content = session.inner.lock().map_err(err)?;
    require_active(session, &content)?;
    let root = local_root(app, location)?.ok_or("native.files.workspace.folderUnavailable")?;
    let _coordination = CoordinatedAccess::begin(app, location)?;
    content.root = Some(root.clone());
    if content.store.is_none() {
        content.store = Some(ContentStore::open(&root).map_err(err)?);
    }
    operation(
        content
            .store
            .as_mut()
            .ok_or("native.files.provider.readOnly")?,
    )
}

pub(crate) fn agent_request(
    app: &tauri::AppHandle,
    (location, session): (Location, Arc<Session>),
    request: crate::file_tool::ToolRequest,
    token: Option<tokio_util::sync::CancellationToken>,
) -> Result<Value, String> {
    let mut content = session.inner.lock().map_err(err)?;
    require_active(&session, &content)?;
    let check_cancelled = || {
        if token.as_ref().is_some_and(|t| t.is_cancelled()) {
            Err("native.ai.request.cancelled".to_owned())
        } else {
            Ok(())
        }
    };
    check_cancelled()?;
    let root = local_root(app, &location)?;
    let _coordination = CoordinatedAccess::begin(app, &location)?;
    if let Some(root) = &root {
        content.root = Some(root.clone());
        if content.store.is_none() {
            content.store = ContentStore::open(root).ok();
        }
    }
    if request.operation == "capabilities" {
        let shell = crate::shell_host::capability();
        #[cfg(feature = "native-smoke")]
        let shell = if crate::agent_e2e::enabled() {
            crate::agent_e2e::disabled_shell_capability()
        } else {
            shell
        };
        let plugin_sources = cfg!(any(target_os = "macos", target_os = "ios")) && root.is_some();
        #[cfg(feature = "native-smoke")]
        let plugin_sources = plugin_sources && !crate::agent_e2e::enabled();
        return Ok(
            json!({"writable":content.store.is_some(),"history":content.store.is_some(),"conversations":root.is_some(),"pluginSources":plugin_sources,"shell":if content.store.is_some() { Some(shell) } else { None }}),
        );
    }
    if matches!(
        request.operation.as_str(),
        "list_conversations" | "read_conversation"
    ) {
        let root = root
            .as_deref()
            .ok_or("native.files.operation.unavailable")?;
        let storage = situate_core::ai_storage::Storage::open(root, &location.id)?;
        return crate::file_tool::conversation_history(&storage, &request);
    }
    if crate::plugin_source_files::target(&request.path)?.is_some() {
        let root = root.as_deref().ok_or("native.plugins.unavailable")?;
        return crate::plugin_source_files::request(root, &request, check_cancelled);
    }
    if request.operation == "history" {
        let store = content
            .store
            .as_ref()
            .ok_or("native.files.operation.unavailable")?;
        let entries = store
            .file_history(&request.path)
            .map_err(err)?
            .into_iter()
            .map(|entry| serde_json::to_value(entry).map_err(err))
            .collect::<Result<Vec<_>, _>>()?;
        return crate::file_tool::entries_page(
            entries,
            request.offset,
            request.limit.unwrap_or(100),
        );
    }
    if request.operation == "shell" {
        let capability = process_capability(root.is_some());
        let interpreter = capability
            .interpreter
            .filter(|_| capability.available)
            .ok_or("native.files.operation.unavailable")?;
        let command = request.command.ok_or("native.content.base.mismatch")?;
        return execute_process(
            &mut content,
            crate::shell_host::CommandRequest {
                cwd: root.ok_or("native.files.workspace.folderUnavailable")?,
                executable: interpreter.into(),
                args: capability
                    .interpreter_args
                    .iter()
                    .map(|arg| (*arg).to_owned())
                    .chain([command, "situate-command".into()])
                    .collect(),
                timeout_ms: request.timeout_ms.unwrap_or(30_000),
                output_limit_bytes: 32_768,
            },
            token.ok_or("native.ai.access.rejected")?,
        );
    }
    let read = |path: &str| read_bytes(app, &location, root.as_deref(), path);
    if request.operation == "create_batch" {
        if !content.pending_paths.is_empty() {
            return Err("native.content.store.busy".into());
        }
        let store = content
            .store
            .as_mut()
            .ok_or("native.files.operation.unavailable")?;
        let cancelled = || check_cancelled().map_err(situate_core::content::ContentError::History);
        let batch = if let Some(entries) = request.entries {
            store.create_batch_entries(entries, request.prepare_copy, cancelled)
        } else {
            store.create_batch(&request.path, request.prepare_copy, cancelled)
        }
        .map_err(err)?;
        return Ok(create_batch_reply(&location.id, batch));
    }
    if matches!(request.operation.as_str(), "write" | "edit")
        && !request.prepare_copy
        && situate_core::content::is_batch_manifest_path(&request.path)
    {
        let store = content
            .store
            .as_mut()
            .ok_or("native.files.operation.unavailable")?;
        let text = if request.operation == "edit" {
            let before = store.read_batch_manifest(&request.path).map_err(err)?;
            if request.expected_revision.as_deref() != Some(&before.revision) {
                return Err("native.content.base.mismatch".into());
            }
            situate_core::content::apply_exact_edits(&before.text, &request.edits).map_err(err)?
        } else {
            request.text.ok_or("native.files.export.textMissing")?
        };
        check_cancelled()?;
        let version = store
            .write_batch_manifest(&request.path, request.expected_revision.as_deref(), &text)
            .map_err(err)?;
        return Ok(json!({"path":request.path,"revision":version.revision}));
    }
    if matches!(request.operation.as_str(), "write" | "edit") {
        safe_parts(&request.path)?;
        if content.pending_paths.contains(&request.path) {
            return Err("native.content.store.busy".into());
        }
        let store = content
            .store
            .as_mut()
            .ok_or("native.files.operation.unavailable")?;
        let before = match store.agent_read_source(&request.path) {
            Ok(value) => Some(value),
            Err(situate_core::content::ContentError::Io(e))
                if e.kind() == std::io::ErrorKind::NotFound =>
            {
                None
            }
            Err(e) => return Err(err(e)),
        };
        let text = if request.operation == "edit" {
            let source = before.as_ref().ok_or("native.content.base.mismatch")?;
            if request.expected_revision.as_deref() != Some(&source.revision) {
                return Err("native.content.base.mismatch".into());
            }
            situate_core::content::apply_exact_edits(&source.text, &request.edits).map_err(err)?
        } else {
            request.text.ok_or("native.files.export.textMissing")?
        };
        if text.len() > 1_048_576 {
            return Err("native.files.read.tooLarge".into());
        }
        if before.is_some() && request.prepare_copy {
            return Err("native.content.base.mismatch".into());
        }
        let text = if before.is_none() {
            prepare_agent_creation(&request.path, text, request.prepare_copy)?
        } else {
            text
        };
        if text.len() > 1_048_576 {
            return Err("native.files.read.tooLarge".into());
        }
        let generated_task_ids: Vec<_> =
            if before.is_none() && request.prepare_copy && markdown(&request.path).is_ok() {
                metadata::inspect(&text)
                    .tasks
                    .into_iter()
                    .map(|task| task.id)
                    .collect()
            } else {
                Vec::new()
            };
        check_cancelled()?;
        let outcome = store
            .agent_write(&request.path, request.expected_revision.as_deref(), &text)
            .map_err(err)?;
        let (version, history_revision, warning) = match outcome {
            SaveOutcome::Saved {
                version,
                history_revision,
            } => (version, Some(history_revision), None),
            SaveOutcome::SavedHistoryFailed { version, error } => (version, None, Some(error)),
            SaveOutcome::SavedDraftCleanupFailed {
                version,
                history_revision,
                error,
            } => (version, Some(history_revision), Some(error)),
            other => return Ok(json!({"isError":true,"outcome":other})),
        };
        return Ok(
            json!({"isError":warning.is_some(),"change":{"path":request.path,"before":before.as_ref().map(|v| &v.text),"after":version.text,"beforeRevision":before.map(|v|v.revision),"afterRevision":version.revision},"historyRevision":history_revision,"warning":warning,"generatedTaskIds":generated_task_ids}),
        );
    }
    if matches!(request.operation.as_str(), "read" | "read_revision") {
        let bytes = if request.operation == "read_revision" {
            content
                .store
                .as_ref()
                .ok_or("native.files.operation.unavailable")?
                .read_revision(
                    &request.path,
                    request
                        .revision
                        .as_deref()
                        .ok_or("native.content.base.mismatch")?,
                )
                .map_err(err)?
        } else {
            read(&request.path)?
        };
        if bytes.len() > 16_777_216 {
            return Err("native.files.read.tooLarge".into());
        }
        if let Ok(image) = image_bytes(&bytes) {
            if bytes.len() > 2_097_152 {
                return Err("native.files.read.tooLarge".into());
            }
            return Ok(json!({"image":image,"path":request.path}));
        }
        let text = String::from_utf8(bytes).map_err(|_| "native.files.history.notText")?;
        let mut page =
            crate::file_tool::text_page(&text, request.offset, request.limit.unwrap_or(16_384))?;
        page["revision"] = json!(situate_core::content::revision_for_text(&text).map_err(err)?);
        page["path"] = json!(request.path);
        return Ok(page);
    }
    if request.operation == "instructions" {
        let method = if let Some(store) = &content.store {
            store.working_method().map_err(err)?
        } else {
            working_method_version(app, &location, root.as_deref())?
        };
        let entries = if method.is_some() {
            vec![json!({"path":situate_core::content::WORKING_METHOD_PATH})]
        } else {
            vec![]
        };
        return Ok(json!({"text":crate::file_tool::instructions(&entries, |_| {
            Ok(method.as_ref().ok_or("native.onboarding.storage.invalid")?.text.as_bytes().to_vec())
        })?}));
    }
    let mut entries = if let Some(root) = &root {
        situate_core::content::list_content(root)
            .map_err(err)?
            .into_iter()
            .map(|e| json!({"path":e.path,"isDirectory":e.is_directory}))
            .collect::<Vec<_>>()
    } else {
        provider_list(app, &location, "")?
    };
    entries.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    crate::file_tool::search(&request, entries, read, check_cancelled)
}

fn create_batch_reply(scope: &str, batch: situate_core::content::CreateBatchOutcome) -> Value {
    let references: Vec<_> = match &batch.outcome {
        situate_core::content::OperationOutcome::Complete { history_revision } => batch
            .files
            .iter()
            .map(|file| {
                json!({
                    "kind": "live",
                    "workspaceId": scope,
                    "path": file.path,
                    "anchorRevision": history_revision,
                })
            })
            .collect(),
        _ => Vec::new(),
    };
    json!({
        "isError": !matches!(batch.outcome, situate_core::content::OperationOutcome::Complete { .. }),
        "files": batch.files,
        "references": references,
        "identityMap": batch.identity_map,
        "historyRevision": match &batch.outcome {
            situate_core::content::OperationOutcome::Complete { history_revision } => Some(history_revision),
            _ => None,
        },
        "outcome": batch.outcome,
    })
}

fn historical_document(store: &ContentStore, path: &str, revision: &str) -> Result<Value, String> {
    let entry = store
        .list_revision(revision)
        .map_err(err)?
        .into_iter()
        .find(|e| e.path == path);
    let Some(entry) = entry else {
        return Ok(json!({"status":"deleted"}));
    };
    if entry.is_directory {
        return Err("native.files.history.selectFile".into());
    }
    safe_parts(path)?;
    let bytes = store.read_revision(path, revision).map_err(err)?;
    let text = text_from_bytes(&bytes)?
        .ok_or("native.files.history.notText")?
        .to_owned();
    Ok(
        json!({"status":"ok","document":historical_view(store, path, TextVersion { text, revision: revision.into() })}),
    )
}

fn historical_view(store: &ContentStore, path: &str, version: TextVersion) -> Value {
    if markdown(path).is_err() {
        return json!({"path":path,"issues":[],"html":"","version":version});
    }
    let html = rendering::render_markdown(&version.text, |url| {
        if remote_url(url).is_ok() {
            return Some(url.into());
        }
        let resource = relative_resource(path, url).ok()?;
        let bytes = store.read_revision(&resource, &version.revision).ok()?;
        image_bytes(&bytes).ok()
    });
    json!({"path":path,"issues":metadata::inspect(&version.text).issues,"html":html,"version":version})
}

fn operation_reply(outcome: situate_core::content::OperationOutcome) -> Result<Value, String> {
    use situate_core::content::OperationOutcome;
    match outcome {
        OperationOutcome::Complete { .. } => Ok(json!({"status":"ok"})),
        OperationOutcome::PartialFailure {
            changed_paths,
            recovery_revision,
            error,
        } => Ok(
            json!({"status":"partialFailure","changedPaths":changed_paths,"recoveryRevision":recovery_revision,"message":error}),
        ),
    }
}
fn save_reply(
    app: &tauri::AppHandle,
    location: &Location,
    root: Option<&Path>,
    path: &str,
    outcome: SaveOutcome,
) -> Result<Value, String> {
    let (status, version, message) = match outcome {
        SaveOutcome::Saved { version, .. } => ("saved", version, None),
        SaveOutcome::SavedHistoryFailed { version, error } => {
            ("savedHistoryFailed", version, Some(error))
        }
        SaveOutcome::SavedDraftCleanupFailed { version, error, .. } => {
            ("savedDraftCleanupFailed", version, Some(error))
        }
        SaveOutcome::ExternalDeleted => return Ok(json!({"status":"deleted"})),
        SaveOutcome::ChangedSinceReview => return Ok(json!({"status":"changed"})),
        SaveOutcome::Conflict {
            editor,
            external,
            review_token,
        } => {
            return Ok(
                json!({"status":"conflict","editor":editor,"external":external,"token":review_token}),
            );
        }
    };
    Ok(
        json!({"status":status,"message":message,"document":document(app,location,root,path,version,None)}),
    )
}
fn document(
    app: &tauri::AppHandle,
    location: &Location,
    root: Option<&Path>,
    path: &str,
    version: TextVersion,
    preview: Option<&str>,
) -> Value {
    let source = preview.unwrap_or(&version.text);
    if markdown(path).is_err() {
        return json!({"path":path,"issues":[],"html":"","version":version});
    }
    let html = rendering::render_markdown(source, |url| {
        if remote_url(url).is_ok() {
            return Some(url.into());
        }
        let resolved = relative_resource(path, url).ok()?;
        image_data(app, location, root, &resolved).ok()
    });
    json!({"path":path,"issues":metadata::inspect(source).issues,"html":html,"version":version})
}
fn resolve_identity(
    app: &tauri::AppHandle,
    location: &Location,
    session: &ContentSession,
    id: &str,
) -> Result<String, String> {
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("native.files.identity.linkInvalid".into());
    }
    let paths: Vec<String> = if let Some(store) = &session.store {
        store
            .list()
            .map_err(err)?
            .into_iter()
            .filter(|e| !e.is_directory)
            .map(|e| e.path)
            .collect()
    } else {
        provider_list(app, location, "")?
            .into_iter()
            .filter(|e| e["isDirectory"] == false)
            .filter_map(|e| e["path"].as_str().map(str::to_owned))
            .collect()
    };
    let mut matches = Vec::new();
    for path in paths.into_iter().filter(|p| markdown(p).is_ok()) {
        let text = String::from_utf8(read_bytes(app, location, session.root.as_deref(), &path)?)
            .map_err(err)?;
        let meta = metadata::inspect(&text);
        for task in meta.tasks {
            if task.id.eq_ignore_ascii_case(id) {
                matches.push(path.clone());
            }
        }
    }
    if matches.len() != 1 {
        return Err("native.files.identity.linkAmbiguous".into());
    }
    Ok(matches.remove(0))
}
fn markdown(path: &str) -> Result<(), String> {
    safe_parts(path)?;
    if !path.to_ascii_lowercase().ends_with(".md")
        && !path.to_ascii_lowercase().ends_with(".markdown")
    {
        return Err("native.files.editor.markdownOnly".into());
    }
    Ok(())
}
fn safe_parts(path: &str) -> Result<Vec<&str>, String> {
    if path == situate_core::content::WORKING_METHOD_PATH
        || situate_core::content::is_batch_manifest_path(path)
    {
        return Ok(path.split('/').collect());
    }
    situate_core::content::validate_provider_path(path).map_err(err)
}
fn open_target(
    path: Option<&str>,
    href: Option<&str>,
    document: Option<&str>,
) -> Result<String, String> {
    if let Some(href) = href {
        if path.is_some() {
            return Err("native.files.link.choosePathOrLink".into());
        }
        let document = document.ok_or("native.files.link.sourceMissing")?;
        safe_parts(document)?;
        if remote_url(href).is_ok() || href.starts_with("situate:") {
            return Ok(href.into());
        }
        safe_parts(document)?;
        if href.starts_with('#') {
            return Ok(document.into());
        }
        relative_resource(document, href)
    } else {
        if document.is_some() {
            return Err("native.files.link.contextMissing".into());
        }
        let path = path.ok_or("native.files.choose")?;
        safe_parts(path)?;
        Ok(path.into())
    }
}
fn relative_resource(document: &str, target: &str) -> Result<String, String> {
    let target = target.split(['#', '?']).next().unwrap_or("");
    let target = percent_encoding::percent_decode_str(target)
        .decode_utf8()
        .map_err(err)?;
    if target.starts_with("//") {
        return Err("native.files.link.protocolRelative".into());
    }
    let mut parts: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        document
            .rsplit_once('/')
            .map(|(parent, _)| parent.split('/').collect())
            .unwrap_or_default()
    };
    for part in target.strip_prefix('/').unwrap_or(&target).split('/') {
        match part {
            "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("native.files.resource.outsideWorkspace".into());
                }
            }
            _ => {
                safe_parts(part)?;
                parts.push(part);
            }
        }
    }
    let result = parts.join("/");
    safe_parts(&result)?;
    Ok(result)
}
fn remote_url(target: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(target).map_err(err)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("native.files.link.httpOnly".into());
    }
    Ok(url)
}

fn read_local(root: &Path, path: &str) -> Result<Vec<u8>, String> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
    use std::io::Read;
    let parts = safe_parts(path)?;
    let mut dir =
        cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(err)?;
    for part in &parts[..parts.len() - 1] {
        dir = cap_std::fs::Dir::from_std_file(
            cap_primitives::fs::open_dir_nofollow(&dir.into_std_file(), Path::new(part))
                .map_err(err)?,
        );
    }
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = dir
        .open_with(parts.last().unwrap(), &options)
        .map_err(err)?;
    if !file.metadata().map_err(err)?.is_file() {
        return Err("native.files.read.regularOnly".into());
    }
    let mut bytes = Vec::new();
    file.take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("native.files.read.tooLarge".into());
    }
    Ok(bytes)
}
fn working_method_version(
    app: &tauri::AppHandle,
    location: &Location,
    root: Option<&Path>,
) -> Result<Option<TextVersion>, String> {
    if let Some(root) = root {
        return situate_core::content::read_working_method(root).map_err(err);
    }
    let response = native_content(app, location, "workingMethod", "")?;
    response
        .get("text")
        .map(|value| {
            let text = value.as_str().ok_or("native.content.file.invalidUtf8")?;
            if text.len() > 65_536 {
                return Err("native.files.read.tooLarge".into());
            }
            Ok(TextVersion {
                text: text.into(),
                revision: situate_core::content::revision_for_text(text).map_err(err)?,
            })
        })
        .transpose()
}

fn read_bytes(
    app: &tauri::AppHandle,
    location: &Location,
    root: Option<&Path>,
    path: &str,
) -> Result<Vec<u8>, String> {
    safe_parts(path)?;
    if let Some(root) = root {
        return read_local(root, path);
    }
    if path == situate_core::content::WORKING_METHOD_PATH {
        return working_method_version(app, location, None)?
            .map(|version| version.text.into_bytes())
            .ok_or("native.files.provider.noContent".into());
    }
    let response = native_content(app, location, "read", path)?;
    STANDARD
        .decode(
            response["base64"]
                .as_str()
                .ok_or("native.files.provider.noContent")?,
        )
        .map_err(err)
}
fn image_data(
    app: &tauri::AppHandle,
    location: &Location,
    root: Option<&Path>,
    path: &str,
) -> Result<String, String> {
    let bytes = read_bytes(app, location, root, path)?;
    image_bytes(&bytes)
}
fn image_bytes(bytes: &[u8]) -> Result<String, String> {
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        return Err("native.files.image.unsupported".into());
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}
fn provider_list(
    app: &tauri::AppHandle,
    location: &Location,
    path: &str,
) -> Result<Vec<Value>, String> {
    let mut result = Vec::new();
    let mut pending = vec![path.to_owned()];
    while let Some(parent) = pending.pop() {
        let response = native_content(app, location, "list", &parent)?;
        for entry in response["entries"]
            .as_array()
            .ok_or("native.files.provider.invalidListing")?
        {
            let name = entry["name"]
                .as_str()
                .ok_or("native.files.provider.invalidName")?;
            if safe_parts(name)?.len() != 1 {
                return Err("native.files.provider.invalidName".into());
            }
            let path = if parent.is_empty() {
                name.into()
            } else {
                format!("{parent}/{name}")
            };
            let directory = entry["directory"]
                .as_bool()
                .ok_or("native.files.provider.invalidEntry")?;
            if directory {
                pending.push(path.clone());
            }
            result.push(json!({"path":path,"isDirectory":directory}));
            if result.len() > 100_000 {
                return Err("native.files.list.tooLarge".into());
            }
        }
    }
    Ok(result)
}
fn native_content(
    app: &tauri::AppHandle,
    location: &Location,
    operation: &str,
    path: &str,
) -> Result<Value, String> {
    #[cfg(mobile)]
    {
        app.state::<tauri_plugin_workspace_access::Access>()
            .content(json!({"operation":operation,"location":location,"path":path}))
    }
    #[cfg(desktop)]
    {
        let _ = (app, location, operation, path);
        Err("native.files.provider.unavailableOnDevice".into())
    }
}

fn open_external(
    app: &tauri::AppHandle,
    location: &Location,
    root: Option<&Path>,
    path: &str,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let _ = (app, location);
        let target = if let Ok(url) = remote_url(path) {
            url.to_string()
        } else {
            let root = root.ok_or("native.files.workspace.folderUnavailable")?;
            require_external_binary(path, &read_local(root, path)?)?;
            root.join(path)
                .to_str()
                .ok_or("native.files.path.unsupported")?
                .to_owned()
        };
        launch_default(&target)
    }
    #[cfg(mobile)]
    {
        if remote_url(path).is_err() {
            require_external_binary(path, &read_bytes(app, location, root, path)?)?;
        }
        native_content(app, location, "openExternal", path).map(|_| ())
    }
}
#[cfg(desktop)]
fn session_language(
    app: &tauri::AppHandle,
    session: &Session,
) -> situate_core::localization::Language {
    let defaults = super::device_locale::preferences(app);
    session
        .inner
        .lock()
        .ok()
        .and_then(|content| {
            situate_core::localization::Storage::open(content.root.as_deref()?)
                .ok()?
                .snapshot(&defaults, false)
                .ok()
        })
        .map_or(defaults.language, |p| p.language)
}
fn export(
    app: &tauri::AppHandle,
    session: &Session,
    text: &str,
    path: &str,
) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        let recovered_name = situate_core::messages::text(
            session_language(app, session),
            "native.files.dialog.recoveredName",
        );
        let name = Path::new(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&recovered_name);
        let Some(destination) = rfd::FileDialog::new()
            .set_title(situate_core::messages::text(
                session_language(app, session),
                "native.files.dialog.export",
            ))
            .set_file_name(name)
            .save_file()
        else {
            return Ok(false);
        };
        let roots = super::workspaces::file_locations(app)
            .into_iter()
            .map(|location| local_root(app, &location))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let content = session.inner.lock().map_err(err)?;
        require_active(session, &content)?;
        persist_export(&destination, &roots, text)?;
        Ok(true)
    }
    #[cfg(mobile)]
    {
        let _ = session;
        app.state::<tauri_plugin_workspace_access::Access>()
            .content(json!({"operation":"export","text":text,"path":path}))
            .map(|_| true)
    }
}

#[cfg(desktop)]
fn persist_export(
    destination: &Path,
    workspace_roots: &[PathBuf],
    text: &str,
) -> Result<(), String> {
    use std::io::Write;
    let parent = destination
        .parent()
        .ok_or("native.files.export.destinationUnavailable")?
        .canonicalize()
        .map_err(err)?;
    for root in workspace_roots {
        if parent.starts_with(root.canonicalize().map_err(err)?) {
            return Err("native.files.export.outsideWorkspaces".into());
        }
    }
    let destination = parent.join(
        destination
            .file_name()
            .ok_or("native.files.filename.choose")?,
    );
    let mut temp = tempfile::NamedTempFile::new_in(&parent).map_err(err)?;
    temp.write_all(text.as_bytes()).map_err(err)?;
    temp.as_file().sync_all().map_err(err)?;
    let saved = temp
        .persist_noclobber(&destination)
        .map_err(|_| "native.files.export.destinationExists".to_owned())?;
    saved.sync_all().map_err(err)?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(err)?;
    Ok(())
}

#[cfg(feature = "native-smoke")]
use crate::lifecycle::{Quit, QuitAttempt, cancel_quit};
#[cfg(feature = "native-smoke")]
pub use crate::lifecycle::{approve_smoke_exit, quit_pending, request_quit};

pub(crate) fn pause_for_quit(session: &Session, token: &str, force: bool) -> Result<(), String> {
    let mut content = session.inner.lock().map_err(err)?;
    if !force {
        ensure_secured(&content)?;
    }
    content.paused = Some(token.into());
    Ok(())
}

pub(crate) fn resume_quit(session: &Session, token: &str) {
    let mut content = session
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if content.paused.as_deref() == Some(token) {
        content.paused = None;
    }
}

pub(crate) fn commit_quit(sessions: &[Arc<Session>], force: bool) -> Result<(), String> {
    let mut contents = sessions
        .iter()
        .map(|session| session.inner.lock().map_err(err))
        .collect::<Result<Vec<_>, _>>()?;
    if !force {
        for content in &contents {
            ensure_secured(content)?;
        }
    }
    for (session, content) in sessions.iter().zip(contents.iter_mut()) {
        if force {
            session.detached.store(true, Ordering::Release);
            content.store = None;
        } else {
            detach(session, content)?;
        }
    }
    Ok(())
}
