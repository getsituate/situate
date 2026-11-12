use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use situate_core::plugins::{
    publication,
    sources::{self, PackageRevision},
};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

const INVALID: &str = "native.plugins.checkInvalid";
const LIMIT: &str = "native.plugins.checkLimit";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    plugin_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revision: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Test {
    plugin_id: String,
    script: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fixtures: Option<crate::plugin_checks::Fixtures>,
    #[serde(skip_serializing_if = "Option::is_none")]
    responses: Option<HashMap<String, crate::plugin_checks::HttpFixture>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    processes: Option<Vec<crate::plugin_checks::ProcessFixture>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_ms: Option<u64>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultEvidence {
    plugin_id: String,
    passed: bool,
    assertions: u32,
}
impl ResultEvidence {
    fn from_worker(plugin_id: String, outcome: &Value) -> Result<Self, String> {
        let (passed, assertions) = match outcome["passed"].as_bool() {
            Some(true) => (true, crate::plugin_checks::worker_evidence(outcome)?),
            Some(false) => (
                false,
                outcome["assertions"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .ok_or(INVALID)?,
            ),
            _ => return Err(INVALID.into()),
        };
        Ok(Self {
            plugin_id,
            passed,
            assertions,
        })
    }
}
#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Check {
        changes: Vec<Selection>,
        checks: Vec<Test>,
    },
    CancelPending {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
    },
    Begin {
        changes: Vec<Selection>,
        checks: Vec<Test>,
    },
    Finish {
        #[serde(rename = "checkId")]
        check_id: String,
        results: Vec<ResultEvidence>,
    },
    Cancel {
        #[serde(rename = "checkId")]
        check_id: String,
    },
    Activate {
        #[serde(rename = "checkId")]
        check_id: String,
    },
    Describe {
        #[serde(rename = "checkId")]
        check_id: String,
    },
    Status {
        attempt: Option<String>,
    },
}
struct Session {
    window: String,
    scope: String,
    conversation: String,
    run_id: String,
    tool_call_id: String,
    authorization: crate::workspaces::AuthorizationSession,
    publish: Vec<PackageRevision>,
    checked: Vec<PackageRevision>,
    restore: Vec<String>,
    tests: Vec<String>,
    responses: HashMap<String, HashMap<String, crate::plugin_checks::HttpFixture>>,
    processes: HashMap<String, Vec<crate::plugin_checks::ProcessFixture>>,
    files: Arc<crate::files::Session>,
    root: tempfile::TempDir,
    keys: Arc<crate::plugin_host::EphemeralKeys>,
    token: CancellationToken,
    pending: bool,
    passed: bool,
    activating: bool,
    activation: CancellationToken,
    expires: Instant,
    gate: Option<crate::plugin_actions::PublicationGate>,
    outcome: Option<Value>,
}
impl Session {
    fn require_publication(&self) -> Result<(), String> {
        if self.activation.is_cancelled()
            || !self.activating
            || !self.passed
            || self.outcome.is_some()
        {
            return Err("native.ai.response.stopped".into());
        }
        Ok(())
    }
    fn cancel(&mut self) -> Value {
        self.activation.cancel();
        expire_pending(self);
        self.passed = false;
        json!({"cancelled":self.outcome.is_none(),"outcome":self.outcome})
    }
    fn finish_trial(&mut self, passed: bool) -> Result<(), String> {
        self.passed = false;
        self.pending = false;
        crate::plugin_development::clear_trial_storage(self.root.path())?;
        self.passed = passed;
        Ok(())
    }

    fn retained_activation(&self) -> Result<Option<Value>, String> {
        if self.activating {
            return Err("native.plugins.stateBusy".into());
        }
        Ok(self.outcome.clone())
    }

    fn finish_activation(
        &mut self,
        mut outcome: Value,
        refreshed: Result<(), String>,
    ) -> Result<Value, String> {
        if !self.activating || outcome["activated"] != true {
            return Err(INVALID.into());
        }
        if refreshed.is_err() {
            outcome["followUpError"] = json!("plugins.activationFollowUpFailed");
        }
        self.gate.take();
        self.activating = false;
        self.passed = false;
        self.outcome = Some(outcome.clone());
        Ok(outcome)
    }

    fn description(&self) -> Value {
        json!({"plugins":self.publish,"passed":self.passed,"outcome":self.outcome,"activationPending":self.activating})
    }
    fn retained(&self) -> bool {
        self.gate.is_some()
            || self
                .outcome
                .as_ref()
                .is_some_and(|v| v["publication"]["status"] == "outcomeUnknown")
            || self.activating
            || (self.expires > Instant::now()
                && ((self.pending && !self.token.is_cancelled())
                    || self.passed
                    || self.outcome.is_some()))
    }
}
#[derive(Default)]
pub struct Changes(
    Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    crate::ai_plugin_tools::PendingChecks,
);

fn lookup(app: &tauri::AppHandle, id: &str) -> Result<Arc<Mutex<Session>>, String> {
    app.state::<Changes>()
        .0
        .lock()
        .map_err(|_| INVALID)?
        .get(id)
        .cloned()
        .ok_or(INVALID.into())
}
pub(crate) fn contains(app: &tauri::AppHandle, id: &str) -> bool {
    app.try_state::<Changes>().is_some_and(|state| {
        state
            .0
            .lock()
            .is_ok_and(|sessions| sessions.contains_key(id))
    })
}
pub(crate) fn invalidate_scope(app: &tauri::AppHandle, scope: &str) {
    if let Some(state) = app.try_state::<Changes>() {
        state.1.invalidate_scope(scope);
    }
    if let Some(state) = app.try_state::<Changes>()
        && let Ok(mut sessions) = state.0.lock()
    {
        sessions.retain(|_, s| s.lock().is_ok_and(|s| s.scope != scope));
    }
}
fn same_owner(
    s: &Session,
    window: &str,
    scope: &str,
    conversation: Option<&str>,
) -> Result<(), String> {
    if s.window != window || s.scope != scope || conversation.is_some_and(|id| id != s.conversation)
    {
        return Err(INVALID.into());
    }
    Ok(())
}
fn owned(s: &Session, window: &str, scope: &str, conversation: Option<&str>) -> Result<(), String> {
    same_owner(s, window, scope, conversation)?;
    if (s.expires <= Instant::now() && s.gate.is_none() && !s.activating)
        || (s.pending && s.token.is_cancelled())
    {
        return Err(INVALID.into());
    }
    Ok(())
}
fn expire_pending(session: &mut Session) {
    if session.pending {
        session.token.cancel();
        session.pending = false;
        session.passed = false;
    }
}
fn watch_pending(session: &Arc<Mutex<Session>>) -> tauri::async_runtime::JoinHandle<()> {
    let weak = Arc::downgrade(session);
    let token = session.lock().expect("new check session").token.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! { _=token.cancelled()=>{}, _=tokio::time::sleep(Duration::from_secs(1800))=>{} }
        if let Some(session) = weak.upgrade()
            && let Ok(mut session) = session.lock()
        {
            expire_pending(&mut session);
        }
    })
}
pub(crate) fn with_test_context<T>(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    id: &str,
    plugin: &str,
    callback: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let state = lookup(app, id)?;
    let auth = state.lock().map_err(|_| INVALID)?.authorization.clone();
    crate::workspaces::with_retained_session(app, window, &auth, |_| {
        let s = state.lock().map_err(|_| INVALID)?;
        owned(&s, window, scope, None)?;
        if !s.pending || !s.checked.iter().any(|p| p.plugin_id == plugin) {
            return Err(INVALID.into());
        }
        callback(s.root.path())
    })
}
pub(crate) fn test_keys(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    id: &str,
    plugin: &str,
) -> Result<Arc<crate::plugin_host::EphemeralKeys>, String> {
    let keys = lookup(app, id)?.lock().map_err(|_| INVALID)?.keys.clone();
    with_test_context(app, window, scope, id, plugin, |_| Ok(keys))
}

pub(crate) fn test_files(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    id: &str,
    plugin: &str,
) -> Result<Arc<crate::files::Session>, String> {
    let files = lookup(app, id)?.lock().map_err(|_| INVALID)?.files.clone();
    with_test_context(app, window, scope, id, plugin, |_| Ok(files))
}

pub(crate) fn responses(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    id: &str,
    plugin: &str,
) -> Result<HashMap<String, crate::plugin_checks::HttpFixture>, String> {
    let state = lookup(app, id)?;
    let s = state.lock().map_err(|_| INVALID)?;
    owned(&s, window, scope, None)?;
    if !s.pending || !s.checked.iter().any(|p| p.plugin_id == plugin) {
        return Err(INVALID.into());
    }
    Ok(s.responses.get(plugin).cloned().unwrap_or_default())
}
pub(crate) fn processes(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    id: &str,
    plugin: &str,
) -> Result<Vec<crate::plugin_checks::ProcessFixture>, String> {
    let state = lookup(app, id)?;
    let s = state.lock().map_err(|_| INVALID)?;
    owned(&s, window, scope, None)?;
    if !s.pending || !s.checked.iter().any(|p| p.plugin_id == plugin) {
        return Err(INVALID.into());
    }
    Ok(s.processes.get(plugin).cloned().unwrap_or_default())
}
fn validate(changes: &[Selection], checks: &[Test]) -> Result<(), String> {
    for check in checks {
        crate::plugin_checks::validate_processes(check.processes.as_deref().unwrap_or_default())?;
    }
    let mut ids = HashSet::new();
    if changes.is_empty()
        || changes.len() > 128
        || checks.is_empty()
        || checks.len() > 128
        || changes.iter().any(|c| !ids.insert(&c.plugin_id))
    {
        return Err(INVALID.into());
    }
    ids.clear();
    if checks.iter().any(|c| {
        !ids.insert(&c.plugin_id)
            || c.script.trim().is_empty()
            || c.script.len() > 65_536
            || c.timeout_ms.is_some_and(|ms| !(100..=60_000).contains(&ms))
            || c.responses.as_ref().is_some_and(|r| {
                r.len() > 128 || r.values().any(|v| !(100..=599).contains(&v.status))
            })
    }) {
        return Err(INVALID.into());
    }
    if serde_json::to_vec(&(changes, checks))
        .map_err(|_| INVALID)?
        .len()
        > 4_194_304
    {
        return Err(LIMIT.into());
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceSnapshot {
    plugin_id: String,
    revision: String,
    source: situate_core::plugins::runtime::Sources,
}
struct PreparedChanges {
    publish: Vec<PackageRevision>,
    checked: Vec<PackageRevision>,
    restore: Vec<String>,
    snapshots: Vec<SourceSnapshot>,
    required: Vec<String>,
}
fn prepare(root: &Path, changes: &[Selection]) -> Result<PreparedChanges, String> {
    let mut publish = Vec::new();
    let mut restore = Vec::new();
    for selection in changes {
        let latest = sources::snapshot(root, &selection.plugin_id)?;
        let chosen = match &selection.revision {
            Some(revision) => {
                if revision != &latest.revision {
                    restore.push(selection.plugin_id.clone());
                }
                PackageRevision {
                    incarnation: Some(situate_core::plugins::folder::incarnation(
                        root,
                        &selection.plugin_id,
                    )?),
                    plugin_id: selection.plugin_id.clone(),
                    revision: revision.clone(),
                }
            }
            None => latest,
        };
        publish.push(chosen);
    }
    let checked = publication::checked_closure(root, &publish)?;
    let mut snapshots = Vec::new();
    let mut bytes = 0;
    let mut affected: HashSet<String> = publish.iter().map(|p| p.plugin_id.clone()).collect();
    for package in &checked {
        let source = sources::at_revision(root, package)?;
        let snapshot = SourceSnapshot {
            plugin_id: package.plugin_id.clone(),
            revision: package.revision.clone(),
            source,
        };
        bytes += serde_json::to_vec(&snapshot).map_err(|_| INVALID)?.len();
        if bytes > 16_777_216 {
            return Err(LIMIT.into());
        }
        snapshots.push(snapshot);
    }
    loop {
        let previous = affected.len();
        for snapshot in &snapshots {
            if snapshot
                .source
                .manifest
                .dependencies
                .as_ref()
                .is_some_and(|dependencies| dependencies.iter().any(|id| affected.contains(id)))
            {
                affected.insert(snapshot.plugin_id.clone());
            }
        }
        if previous == affected.len() {
            break;
        }
    }
    let mut required: Vec<_> = affected.into_iter().collect();
    required.sort();
    Ok(PreparedChanges {
        publish,
        checked,
        restore,
        snapshots,
        required,
    })
}

async fn request(
    context: &crate::ai_plugin_tools::Context,
    run_id: String,
    tool_call_id: String,
    args: Request,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let Request::Activate { check_id } = &args else {
        return request_inner(context, run_id, tool_call_id, args, cancel).await;
    };
    let session = lookup(&context.app, check_id)?;
    let retained = crate::workspaces::with_retained_session(
        &context.app,
        &context.window,
        &context.authorization,
        |_| {
            let session = session.lock().map_err(|_| INVALID)?;
            owned(
                &session,
                &context.window,
                &context.scope,
                Some(&context.conversation),
            )?;
            session.retained_activation()
        },
    )?;
    if let Some(outcome) = retained {
        return Ok(outcome);
    }
    let outcome = request_inner(context, run_id, tool_call_id, args, cancel).await?;
    if outcome["activated"] != true {
        session.lock().map_err(|_| INVALID)?.activating = false;
        return Ok(outcome);
    }
    let (plugins, cancellation) = {
        let session = session.lock().map_err(|_| INVALID)?;
        (
            session
                .publish
                .iter()
                .map(|package| package.plugin_id.clone())
                .collect::<Vec<_>>(),
            session.activation.clone(),
        )
    };
    let refreshed = crate::ai_executor::refresh(
        &crate::ai_plugin_tools::broker_context(context),
        &plugins,
        cancellation,
    )
    .await;
    let mut outcome = session
        .lock()
        .map_err(|_| INVALID)?
        .finish_activation(outcome, refreshed)?;
    if context
        .app
        .emit(
            "plugin-executor-updated",
            json!({"scope":context.scope,"pluginIds":plugins}),
        )
        .is_err()
    {
        outcome["followUpError"] = json!("plugins.activationFollowUpFailed");
        session.lock().map_err(|_| INVALID)?.outcome = Some(outcome.clone());
    }
    Ok(outcome)
}

async fn request_inner(
    context: &crate::ai_plugin_tools::Context,
    run_id: String,
    tool_call_id: String,
    request: Request,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let app = context.app.clone();
    let label = context.window.clone();
    let scope = context.scope.clone();
    let conversation = context.conversation.clone();
    if !cfg!(any(target_os = "macos", target_os = "ios", test)) {
        return Err("native.plugins.unavailable".into());
    }
    let authorization = context.authorization.clone();
    match request {
        Request::Check { .. } | Request::CancelPending { .. } => Err(INVALID.into()),
        Request::Begin { changes, checks } => {
            validate(&changes, &checks)?;
            tauri::async_runtime::spawn_blocking(move || {
                crate::workspaces::with_retained_session(&app, &label, &authorization, |location| {
                    if cancel.is_cancelled() { return Err("native.ai.response.stopped".into()); }
                    let root = crate::files::local_root(&app, location)?.ok_or("native.plugins.unavailable")?;
                    let PreparedChanges{publish,checked,restore,snapshots,required}=prepare(&root,&changes)?;
                    let supplied:HashSet<_> = checks.iter().map(|c|c.plugin_id.as_str()).collect();
                    let missing:Vec<_> = required.iter().filter(|id| !supplied.contains(id.as_str())).collect();
                    if !missing.is_empty() { return Ok(json!({"needsChecks":missing,"requiredChecks":required})); }
                    if supplied.iter().any(|id|!checked.iter().any(|p| p.plugin_id == *id)) { return Err(INVALID.into()); }
                    let synthetic = crate::plugin_checks::synthetic_root(&checked.iter().map(|package| package.plugin_id.as_str()).collect::<Vec<_>>())?;
                    let id = uuid::Uuid::new_v4().to_string();
                    let session = Session {
                        window:label.clone(), scope:scope.clone(),conversation:conversation.clone(),run_id:run_id.clone(),tool_call_id:tool_call_id.clone(),authorization:authorization.clone(),
                        publish:publish.clone(), checked:checked.clone(), restore, tests:checks.iter().map(|c|c.plugin_id.clone()).collect(),
                        processes:checks.iter().map(|c|(c.plugin_id.clone(),c.processes.clone().unwrap_or_default())).collect(),
                        responses:checks.into_iter().map(|c|(c.plugin_id,c.responses.unwrap_or_default())).collect(),files:Arc::default(),root:synthetic,keys:Arc::default(),token:cancel,pending:true,passed:false,activating:false,activation:CancellationToken::new(),
                        expires:Instant::now()+Duration::from_secs(1800),gate:None,outcome:None,
                    };
                    let state = app.state::<Changes>(); let mut sessions = state.0.lock().map_err(|_| INVALID)?;
                    sessions.retain(|_,s|s.lock().is_ok_and(|s|s.retained()));
                    if sessions.len() >= 64 { return Err(LIMIT.into()); }
                    let session=Arc::new(Mutex::new(session));
                    drop(watch_pending(&session));
                    sessions.insert(id.clone(),session);
                    Ok(json!({"checkId":id,"publish":publish,"checked":checked,"snapshots":snapshots,"requiredChecks":required}))
                })
            }).await.map_err(|_| "native.plugins.developmentOutcomeUnknown".to_owned())?
        }
        Request::Status { attempt } => {
            let auth = authorization;
            crate::workspaces::with_retained_session(&app, &label, &auth, |location| {
                let root = crate::files::local_root(&app, location)?
                    .ok_or("native.plugins.unavailable")?;
                let status = match attempt {
                    Some(attempt) => Some(publication::status(&root, &attempt)?),
                    None => publication::current(&root)?,
                };
                Ok(json!({"publication":status}))
            })
        }
        Request::Activate { check_id } => {
            let session = lookup(&app, &check_id)?;
            let (auth, selected) = {
                let mut s = session.lock().map_err(|_| INVALID)?;
                owned(&s, &label, &scope, Some(&conversation))?;
                if !s.passed || s.activating || s.outcome.is_some() {
                    return Err(INVALID.into());
                }
                s.activating = true;
                s.activation = cancel.child_token();
                (
                    s.authorization.clone(),
                    s.publish
                        .iter()
                        .map(|p| p.plugin_id.clone())
                        .collect::<Vec<_>>(),
                )
            };
            let activation = session.lock().map_err(|_| INVALID)?.activation.clone();
            let gate = match crate::plugin_actions::acquire_publication(
                &app,
                &scope,
                &selected,
                &activation,
            )
            .await
            {
                Ok(gate) => gate,
                Err(error) => {
                    session.lock().map_err(|_| INVALID)?.activating = false;
                    return Err(error);
                }
            };
            tauri::async_runtime::spawn_blocking(move || {
                let result = crate::workspaces::with_retained_session(&app,&label,&auth,|location| {
                    let mut s=session.lock().map_err(|_| INVALID)?;
                    owned(&s,&label,&scope,Some(&conversation))?;
                    s.require_publication()?;
                    if cancel.is_cancelled() { return Err("native.ai.response.stopped".into()); }
                    let root=crate::files::local_root(&app,location)?.ok_or("native.plugins.unavailable")?;
                    s.gate=Some(gate);
                    let publication=publication::publish(&root,&s.publish,&s.checked,&s.restore)?;
                    let mut outcome=json!({"publication":publication,"plugins":s.publish,"activated":publication.status == publication::PublicationStatus::Published});
                    s.passed=false;
                    if outcome["activated"] == true {
                        match s.gate.as_mut().ok_or(INVALID)?.published() {
                            Ok(_)=>{},
                            Err(_)=>outcome["followUpError"]=json!("plugins.activationFollowUpFailed"),
                        }
                        for id in &selected {
                            match crate::plugin_recovery::resume(&app,&scope,Some(id)) {
                                Ok(_)=>{},
                                Err(_)=>outcome["followUpError"]=json!("plugins.activationFollowUpFailed"),
                            }
                        }
                    } else if publication.status != publication::PublicationStatus::OutcomeUnknown { s.gate.take(); }
                    s.outcome=Some(outcome.clone());
                    Ok(outcome)
                });
                if result.is_err() { let mut s=session.lock().map_err(|_| INVALID)?; s.activating=false; s.gate.take(); }
                result
            }).await.map_err(|_| "native.plugins.developmentOutcomeUnknown".to_owned())?
        }
        other => {
            let id = match &other {
                Request::Finish { check_id, .. }
                | Request::Cancel { check_id }
                | Request::Describe { check_id } => check_id.clone(),
                _ => unreachable!(),
            };
            let state = lookup(&app, &id)?;
            let auth = state.lock().map_err(|_| INVALID)?.authorization.clone();
            crate::workspaces::with_retained_session(&app, &label, &auth, |_| {
                let mut s = state.lock().map_err(|_| INVALID)?;
                if matches!(other, Request::Cancel { .. } | Request::Describe { .. }) {
                    same_owner(&s, &label, &scope, Some(&conversation))?;
                } else {
                    owned(&s, &label, &scope, Some(&conversation))?;
                }
                match other {
                    Request::Finish { results, .. } => {
                        if !s.pending
                            || s.run_id != run_id
                            || s.tool_call_id != tool_call_id
                            || s.token.is_cancelled()
                        {
                            return Err(INVALID.into());
                        }
                        let ids: HashSet<_> =
                            results.iter().map(|r| r.plugin_id.as_str()).collect();
                        if ids.len() != results.len()
                            || results.len() != s.tests.len()
                            || s.tests.iter().any(|id| !ids.contains(id.as_str()))
                        {
                            return Err(INVALID.into());
                        }
                        s.finish_trial(results.iter().all(|r| r.passed && r.assertions > 0))?;
                        Ok(json!({"passed":s.passed,"checkId":id}))
                    }
                    Request::Cancel { .. } => {
                        let result = s.cancel();
                        crate::plugin_development::clear_trial_storage(s.root.path())?;
                        Ok(result)
                    }
                    Request::Describe { .. } => Ok(s.description()),
                    _ => unreachable!(),
                }
            })
        }
    }
}

pub(crate) async fn execute_tool(
    context: &crate::ai_plugin_tools::Context,
    tool: situate_agent::ToolRequest,
    progress: situate_agent::ProgressSink,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let mut args = tool.arguments;
    let operation = match tool.definition.name.as_str() {
        "check_plugin_changes" => "check",
        "activate_plugin_changes" => "activate",
        "inspect_plugin_changes" => "status",
        _ => return Err(INVALID.into()),
    };
    args.as_object_mut()
        .ok_or(INVALID)?
        .insert("operation".into(), json!(operation));
    let args: Request = serde_json::from_value(args).map_err(|_| INVALID)?;
    match args {
        Request::Check { changes, checks } => {
            execute(
                context,
                tool.run_id,
                tool.id,
                changes,
                checks,
                progress,
                cancel,
            )
            .await
        }
        args => request(context, tool.run_id, tool.id, args, cancel).await,
    }
}

async fn execute(
    context: &crate::ai_plugin_tools::Context,
    run_id: String,
    tool_call_id: String,
    changes: Vec<Selection>,
    checks: Vec<Test>,
    progress: situate_agent::ProgressSink,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let cancel = cancel.child_token();
    let begun = request(
        context,
        run_id.clone(),
        tool_call_id.clone(),
        Request::Begin {
            changes,
            checks: checks.clone(),
        },
        cancel.clone(),
    )
    .await
    .inspect_err(|error| crate::ai_executor::check_diagnostic("begin", error))?;
    if begun.get("needsChecks").is_some() {
        return Ok(begun);
    }
    let id = begun["checkId"].as_str().ok_or(INVALID)?.to_owned();
    let mut stage = "fixtures";
    let result:Result<Value,String> = async {
        let snapshots = begun["snapshots"].as_array().ok_or(INVALID)?;
        let sources: Vec<_> = snapshots.iter().map(|snapshot| snapshot["source"].clone()).collect();
        // Dependencies need their fixtures before any consumer code runs.
        for check in &checks {
            let keys = test_keys(&context.app, &context.window, &context.scope, &id, &check.plugin_id)?;
            with_test_context(&context.app, &context.window, &context.scope, &id, &check.plugin_id, |root| crate::plugin_checks::seed_fixtures(root, &context.scope, &check.plugin_id, check.fixtures.as_ref(), &keys))?;
        }
        let mut results = Vec::new();
        let mut evidence = Vec::new();
        let mut images = Vec::new();
        stage="worker";
        for check in checks {
            let source = sources.iter().find(|source| source["manifest"]["id"] == check.plugin_id).ok_or(INVALID)?;
            let payload = json!({"source":source,"sources":sources});
            let outcome = crate::ai_executor::check(&crate::ai_plugin_tools::broker_context(context), payload, id.clone(), check.script, check.timeout_ms.unwrap_or(30_000), progress.clone(), cancel.clone()).await?;
            let result = ResultEvidence::from_worker(check.plugin_id,&outcome)?;
            let mut row=json!({"pluginId":result.plugin_id,"passed":result.passed,"assertions":result.assertions});
            for field in ["error", "failure", "observations", "observationsTruncated", "assertionsKnown"] {
                if let Some(value) = outcome.get(field) { row[field] = value.clone(); }
            }
            evidence.push(row);
            results.push(result);
            images.extend(outcome.get("images").and_then(Value::as_array).cloned().unwrap_or_default());
        }
        stage="finish";
        let mut finished = request(context, run_id.clone(), tool_call_id.clone(), Request::Finish {check_id:id.clone(), results}, cancel.clone()).await?;
        finished["results"] = json!(evidence);
        finished["images"] = json!(images);
        finished["checked"] = begun["checked"].clone();
        finished["publish"] = begun["publish"].clone();
        Ok(finished)
    }.await;
    if let Err(error) = &result {
        crate::ai_executor::check_diagnostic(stage, error);
        request(
            context,
            run_id,
            tool_call_id,
            Request::Cancel { check_id: id },
            CancellationToken::new(),
        )
        .await?;
    }
    result
}

#[tauri::command]
pub async fn plugin_changes_check(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    conversation: String,
    run_id: String,
    tool_call_id: String,
    request: Request,
) -> Result<Value, String> {
    let context = crate::ai_plugin_tools::manual_context(
        app,
        window.label().to_owned(),
        scope,
        conversation,
    )?;
    if context
        .development
        .as_ref()
        .is_none_or(|development| development.version != Some(2))
    {
        return Err(INVALID.into());
    }
    match request {
        Request::CancelPending { tool_call_id } => {
            let key =
                crate::ai_plugin_tools::PendingKey::for_context(&context, run_id, tool_call_id)?;
            context.app.state::<Changes>().1.cancel(key)
        }
        Request::Check { changes, checks } => {
            let key = crate::ai_plugin_tools::PendingKey::for_context(
                &context,
                run_id.clone(),
                tool_call_id.clone(),
            )?;
            let pending = context.app.state::<Changes>().1.admit(key)?;
            let (progress, mut receiver) = situate_agent::ProgressSink::channel(32);
            let drain =
                tauri::async_runtime::spawn(
                    async move { while receiver.recv().await.is_some() {} },
                );
            let result = execute(
                &context,
                run_id,
                tool_call_id,
                changes,
                checks,
                progress,
                pending.token.clone(),
            )
            .await;
            drain.abort();
            pending.finish();
            result
        }
        Request::Begin { .. } | Request::Finish { .. } => Err(INVALID.into()),
        args => {
            self::request(
                &context,
                run_id,
                tool_call_id,
                args,
                CancellationToken::new(),
            )
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_worker_evidence_finishes_a_failed_trial_without_certifying_activation() {
        let failed = ResultEvidence::from_worker(
            "sample".into(),
            &json!({"passed":false,"assertions":3,"error":"plugins.checkAssertionFailed"}),
        )
        .unwrap();
        assert!(!failed.passed);
        assert_eq!(failed.assertions, 3);
        let mut trial = session();
        trial
            .finish_trial(failed.passed && failed.assertions > 0)
            .unwrap();
        assert!(!trial.passed);
        for invalid in [
            json!({"passed":true,"assertions":0}),
            json!({"passed":false,"assertions":-1}),
            json!({"passed":false,"assertions":4294967296_u64}),
            json!({"assertions":1}),
        ] {
            assert!(ResultEvidence::from_worker("sample".into(), &invalid).is_err());
        }
        let passed =
            ResultEvidence::from_worker("sample".into(), &json!({"passed":true,"assertions":2}))
                .unwrap();
        assert!(passed.passed);
        assert_eq!(passed.assertions, 2);
    }
    fn session() -> Session {
        Session {
            window: "window".into(),
            scope: "workspace".into(),
            conversation: "conversation".into(),
            run_id: "run".into(),
            tool_call_id: "tool".into(),
            authorization: crate::workspaces::AuthorizationSession::for_test(),
            publish: vec![],
            checked: vec![],
            restore: vec![],
            tests: vec![],
            responses: HashMap::new(),
            processes: HashMap::new(),
            files: Arc::default(),
            root: tempfile::tempdir().unwrap(),
            keys: Arc::default(),
            token: CancellationToken::new(),
            pending: true,
            passed: false,
            activating: false,
            activation: CancellationToken::new(),
            expires: Instant::now() + Duration::from_secs(60),
            gate: None,
            outcome: None,
        }
    }
    #[tokio::test]
    async fn cancelled_pending_checks_are_cleaned_and_do_not_consume_session_capacity() {
        let session = Arc::new(Mutex::new(session()));
        let cleanup = watch_pending(&session);
        session.lock().unwrap().token.cancel();
        cleanup.await.unwrap();
        let session = session.lock().unwrap();
        assert!(!session.pending);
        assert!(!session.passed);
        assert!(!session.retained());
    }
    #[tokio::test]
    async fn checked_evidence_survives_its_original_run_but_cancel_revokes_pending_publication() {
        let mut checked = session();
        checked.pending = false;
        checked.passed = true;
        let checked = Arc::new(Mutex::new(checked));
        let cleanup = watch_pending(&checked);
        checked.lock().unwrap().token.cancel();
        cleanup.await.unwrap();
        let mut checked = checked.lock().unwrap();
        assert!(checked.passed);
        assert!(checked.retained());
        checked.activating = true;
        assert!(checked.require_publication().is_ok());
        let reply = checked.cancel();
        assert_eq!(reply["cancelled"], true);
        assert!(checked.activation.is_cancelled());
        assert!(checked.require_publication().is_err());
    }
    #[test]
    fn cleanup_and_status_remain_owner_scoped_after_expiry_and_publication_is_not_undone() {
        let mut checked = session();
        checked.pending = false;
        checked.passed = true;
        checked.expires = Instant::now();
        assert!(owned(&checked, "window", "workspace", Some("conversation")).is_err());
        assert!(same_owner(&checked, "window", "workspace", Some("conversation")).is_ok());
        assert!(same_owner(&checked, "other", "workspace", Some("conversation")).is_err());
        assert!(same_owner(&checked, "window", "other", Some("conversation")).is_err());
        assert!(same_owner(&checked, "window", "workspace", Some("other")).is_err());
        checked.activating = true;
        assert!(owned(&checked, "window", "workspace", Some("conversation")).is_ok());
        assert!(checked.retained());
        checked.outcome = Some(
            json!({"activated":true,"publication":{"status":"published","attempt":"attempt"}}),
        );
        let reply = checked.cancel();
        assert_eq!(reply["cancelled"], false);
        assert_eq!(reply["outcome"]["activated"], true);
        assert!(checked.require_publication().is_err());
    }
    #[cfg(unix)]
    #[test]
    fn failed_finish_disposal_never_certifies_activation_without_a_frontend_cancel() {
        let mut checked = session();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(checked.root.path().join("keep"), b"synthetic").unwrap();
        std::os::unix::fs::symlink(outside.path(), checked.root.path().join("link")).unwrap();
        assert!(checked.finish_trial(true).is_err());
        checked.activating = true;
        assert!(checked.require_publication().is_err());
        assert!(!checked.passed);
        assert!(!checked.pending);
        assert!(checked.root.path().join("keep").exists());
    }

    #[test]
    fn native_activation_releases_the_published_gate_even_when_broker_refresh_fails() {
        for succeeds in [false, true] {
            let mut checked = session();
            checked.pending = false;
            checked.passed = false;
            checked.activating = true;
            let publication = json!({"activated":true,"publication":{"attempt":"observed-attempt","status":"published"}});
            checked.outcome = Some(publication.clone());
            let (mut gate, can_admit) = crate::plugin_actions::test_publication_gate();
            gate.published().unwrap();
            checked.gate = Some(gate);
            assert!(!can_admit());
            assert!(checked.retained_activation().is_err());
            let refreshed = if succeeds {
                Ok(())
            } else {
                Err("native.plugins.unavailable".into())
            };
            let outcome = checked.finish_activation(publication, refreshed).unwrap();
            assert_eq!(outcome["activated"], true);
            assert_eq!(outcome["publication"]["attempt"], "observed-attempt");
            assert_eq!(outcome.get("followUpError").is_some(), !succeeds);
            assert!(can_admit());
            assert!(checked.gate.is_none());
            assert!(!checked.activating);
            assert!(!checked.passed);
            assert_eq!(
                checked.retained_activation().unwrap(),
                Some(outcome.clone())
            );
            assert_eq!(checked.retained_activation().unwrap(), Some(outcome));
        }
    }

    #[test]
    fn uncertain_publication_preserves_its_gate_and_is_not_republished() {
        let mut checked = session();
        checked.pending = false;
        checked.passed = false;
        checked.activating = true;
        let outcome = json!({"activated":false,"publication":{"attempt":"uncertain-attempt","status":"outcomeUnknown"}});
        checked.outcome = Some(outcome.clone());
        let (gate, can_admit) = crate::plugin_actions::test_publication_gate();
        checked.gate = Some(gate);
        assert!(
            checked
                .finish_activation(outcome.clone(), Err("unavailable".into()))
                .is_err()
        );
        assert!(!can_admit());
        assert!(checked.gate.is_some());
        checked.activating = false;
        assert_eq!(
            checked.retained_activation().unwrap(),
            Some(outcome.clone())
        );
        assert_eq!(checked.outcome, Some(outcome));
    }

    fn package(root: &Path, id: &str, dependencies: &[&str]) -> PackageRevision {
        sources::create(root, id).unwrap();
        sources::write(root,id,"plugin.json",&json!({"schemaVersion":2,"id":id,"name":id,"description":"Synthetic","serviceEntry":"entry.js","dependencies":dependencies}).to_string(),None).unwrap();
        sources::write(
            root,
            id,
            "entry.js",
            "export default async function defineService(){return {};}",
            None,
        )
        .unwrap();
        sources::snapshot(root, id).unwrap()
    }
    #[test]
    fn discovery_checks_current_consumers_without_publishing_unactivated_dependency_or_consumer_edits()
     {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let connection = package(root.path(), "mail", &[]);
        let a = package(root.path(), "consumer-a", &["mail"]);
        let b = package(root.path(), "consumer-b", &["mail"]);
        let other = package(root.path(), "other", &[]);
        let selected = vec![connection.clone(), a.clone(), b.clone(), other];
        let checked = publication::checked_closure(root.path(), &selected).unwrap();
        assert_eq!(
            publication::publish(root.path(), &selected, &checked, &[])
                .unwrap()
                .status,
            publication::PublicationStatus::Published
        );
        let old = sources::read(root.path(), "mail", "entry.js").unwrap();
        sources::write(
            root.path(),
            "mail",
            "entry.js",
            "export default async function defineService(){return {exports:{changed:async()=>true}};}",
            Some(&old.revision),
        )
        .unwrap();
        std::fs::write(
            root.path()
                .join(".situate/plugins/consumer-a/code/entry.js"),
            "unactivated",
        )
        .unwrap();
        let PreparedChanges {
            publish,
            checked,
            restore,
            snapshots,
            required,
        } = prepare(
            root.path(),
            &[Selection {
                plugin_id: "mail".into(),
                revision: None,
            }],
        )
        .unwrap();
        assert_eq!(publish.len(), 1);
        assert_eq!(publish[0].plugin_id, "mail");
        assert_ne!(publish[0], connection);
        assert!(restore.is_empty());
        assert_eq!(required, vec!["consumer-a", "consumer-b", "mail"]);
        assert!(checked.contains(&a));
        assert!(checked.contains(&b));
        assert_eq!(checked.len(), 3);
        assert_eq!(
            snapshots
                .iter()
                .find(|s| s.plugin_id == "consumer-a")
                .unwrap()
                .source
                .service_entry
                .as_deref(),
            Some("export default async function defineService(){return {};}")
        );
        let restored = prepare(
            root.path(),
            &[Selection {
                plugin_id: "mail".into(),
                revision: Some(connection.revision),
            }],
        )
        .unwrap();
        assert_eq!(restored.restore, vec!["mail"]);
    }
    #[test]
    fn description_distinguishes_observed_publication_from_pending_native_refresh() {
        let mut checked = session();
        checked.pending = false;
        checked.passed = false;
        checked.activating = true;
        let outcome =
            json!({"activated":true,"publication":{"attempt":"attempt","status":"published"}});
        checked.outcome = Some(outcome.clone());
        assert_eq!(checked.description()["outcome"], outcome);
        assert_eq!(checked.description()["activationPending"], true);
        let finished = checked.finish_activation(outcome, Ok(())).unwrap();
        assert_eq!(checked.description()["outcome"], finished);
        assert_eq!(checked.description()["activationPending"], false);
        assert!(finished.get("refreshId").is_none());
        assert!(finished.get("recovery").is_none());
    }
    #[test]
    fn checks_reject_duplicates_empty_scripts_and_unbounded_inputs() {
        let selection = Selection {
            plugin_id: "notes".into(),
            revision: None,
        };
        let test = |script: &str| Test {
            plugin_id: "notes".into(),
            script: script.into(),
            fixtures: None,
            responses: None,
            processes: None,
            timeout_ms: None,
        };
        assert!(validate(&[selection], &[test("assert")]).is_ok());
        let fixture =
            json!({"executable":"/synthetic/tool","args":[],"exitCode":0,"stdout":"","stderr":""});
        let wire = json!({"pluginId":"notes","script":"assert","processes":[fixture.clone()]});
        let parsed: Test = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), wire);
        assert!(
            validate(
                &[Selection {
                    plugin_id: "notes".into(),
                    revision: None
                }],
                &[parsed]
            )
            .is_ok()
        );
        for processes in [
            json!([fixture.clone(), fixture]),
            json!([{"executable":"relative","exitCode":0,"stdout":"","stderr":""}]),
        ] {
            let parsed: Test = serde_json::from_value(
                json!({"pluginId":"notes","script":"assert","processes":processes}),
            )
            .unwrap();
            assert!(
                validate(
                    &[Selection {
                        plugin_id: "notes".into(),
                        revision: None
                    }],
                    &[parsed]
                )
                .is_err()
            );
        }
        assert!(
            validate(
                &[Selection {
                    plugin_id: "notes".into(),
                    revision: None
                }],
                &[test(" ")]
            )
            .is_err()
        );
        assert!(
            validate(
                &[Selection {
                    plugin_id: "notes".into(),
                    revision: None
                }],
                &[test("x"), test("x")]
            )
            .is_err()
        );
    }
}
