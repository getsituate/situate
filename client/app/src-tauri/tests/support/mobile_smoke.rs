use base64::Engine;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use situate_core::{ai_storage::Storage, workspaces::Location};
use std::{collections::BTreeSet, fs, path::PathBuf, sync::OnceLock};
use tauri::Manager;

const INVALID: &str = "Native iOS smoke isolation is invalid";
const PLUGIN: &str = "native-ios-worker";
const EFFECT: &str = "Synthetic iOS Worker effect\n";
const NOTE: &str = "Synthetic native iOS note\n";
const ATTACHED_TEXT: &str = "Synthetic iOS attachment: retained Unicode 🌍\n";
const REFERENCE_TEXT: &str = "Synthetic iOS referenced source\n";
const IMAGE: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const RELEASE_CONVERSATION: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../crates/situate-migrations/tests/fixtures/m0001/releases/0.1.3/native-conversation-compatibility.json.fixture"
));
const RELEASE_OPAQUE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../crates/situate-migrations/tests/fixtures/m0001/releases/0.1.3/opaque-state.json.fixture"
));
const SERVICE: &str = r#"export default () => ({
  tools: [{name:'record',description:'Record one synthetic native Worker effect.',parameters:{type:'object',properties:{},additionalProperties:false},
    async execute(_args,host) {
      const saved = await host.files.write('ios-worker-effect.txt','Synthetic iOS Worker effect\n',null);
      if(saved.isError !== false || !saved.historyRevision) throw new Error('effect-not-saved');
      return {content:[{type:'text',text:'Synthetic iOS Worker effect recorded.'}],details:{saved:true}};
    }}],
  exports: {
    async readEffect(_args,host) { return (await host.files.read('ios-worker-effect.txt')).text; },
    hang(_args,host) {
      host.files.write('ios-worker-running.txt','Synthetic Worker entered\n',null).catch(()=>{});
      for(;;){}
    },
    hangClose(_args,host) {
      host.files.write('ios-worker-closing.txt','Synthetic closing Worker entered\n',null).catch(()=>{});
      for(;;){}
    }
  }
});"#;

struct Run {
    app: tauri::AppHandle,
    id: String,
    launch: String,
    phase: String,
    root: PathBuf,
    container: PathBuf,
    documents: PathBuf,
    provider: String,
    token: String,
    supervisor: String,
}
static RUN: OnceLock<Run> = OnceLock::new();
static DELETED_KEYS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
fn run() -> Result<&'static Run, String> {
    RUN.get().ok_or_else(|| INVALID.into())
}
fn variable(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| INVALID.into())
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn regular(path: &std::path::Path, limit: u64) -> Result<Vec<u8>, String> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
    use std::io::Read;
    use std::os::unix::fs::MetadataExt;
    let directory = cap_std::fs::Dir::open_ambient_dir(
        path.parent().ok_or(INVALID)?,
        cap_std::ambient_authority(),
    )
    .map_err(|_| INVALID)?;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = directory
        .open_with(path.file_name().ok_or(INVALID)?, &options)
        .map_err(|_| INVALID)?
        .into_std();
    let metadata = file.metadata().map_err(|_| INVALID)?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > limit {
        return Err(INVALID.into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| INVALID)?;
    if bytes.len() as u64 > limit {
        return Err(INVALID.into());
    }
    Ok(bytes)
}
fn marker(path: &std::path::Path) -> Result<Value, String> {
    serde_json::from_slice(&regular(path, 4096)?).map_err(|_| INVALID.into())
}
fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn workspace_name(run: &Run) -> String {
    format!("Native iOS {}", run.id)
}
fn conversation(run: &Run) -> String {
    format!("native-ios-{}", run.id)
}

pub(crate) fn guard(app: &tauri::AppHandle) -> Result<(), String> {
    if app.config().identifier != "dev.situate.client.smoke" {
        return Err(INVALID.into());
    }
    let id = variable("SITUATE_NATIVE_IOS_RUN_ID")?;
    let launch = variable("SITUATE_NATIVE_IOS_LAUNCH_ID")?;
    let phase = variable("SITUATE_NATIVE_IOS_PHASE")?;
    let provider = variable("SITUATE_NATIVE_IOS_PROVIDER")?;
    let token = variable("SITUATE_NATIVE_IOS_TOKEN")?;
    let supervisor = variable("SITUATE_NATIVE_IOS_SUPERVISOR")?;
    if !uuid(&id)
        || !uuid(&launch)
        || !matches!(phase.as_str(), "exercise" | "reopen" | "cleanup")
        || token.len() != 64
        || !token.bytes().all(|b| b.is_ascii_hexdigit())
        || supervisor.len() != 64
        || !supervisor.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(INVALID.into());
    }
    crate::agent_e2e::validate_broker(&provider)?;
    let documents = app.path().document_dir().map_err(|_| INVALID)?;
    let container = documents
        .parent()
        .ok_or(INVALID)?
        .canonicalize()
        .map_err(|_| INVALID)?;
    let raw_root = app.path().app_data_dir().map_err(|_| INVALID)?;
    let relative = raw_root
        .strip_prefix(documents.parent().ok_or(INVALID)?)
        .map_err(|_| INVALID)?;
    if !relative
        .components()
        .all(|part| matches!(part, std::path::Component::Normal(_)))
        || marker(&container.join(".native-ios-smoke-owner"))? != json!({"version":1,"runId":id})
    {
        return Err(INVALID.into());
    }
    let root = container.join(relative);
    for path in root
        .ancestors()
        .take_while(|path| *path != container.as_path())
    {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(INVALID.into()),
        }
    }
    match fs::symlink_metadata(&documents) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&documents).map_err(|_| INVALID)?
        }
        _ => return Err(INVALID.into()),
    }
    let documents = documents.canonicalize().map_err(|_| INVALID)?;
    if documents.parent() != Some(container.as_path()) {
        return Err(INVALID.into());
    }
    if phase == "exercise" {
        if root.join("workspaces-v1.json").exists()
            || root.join("mobile-smoke-checkpoint.json").exists()
        {
            return Err(INVALID.into());
        }
    } else if phase == "reopen"
        && marker(&root.join("mobile-smoke-checkpoint.json"))?["runId"] != id
    {
        return Err(INVALID.into());
    }
    let asset = app
        .asset_resolver()
        .get("executor-supervisor.js".into())
        .ok_or(INVALID)?;
    if digest(&asset.bytes) != supervisor {
        return Err("Native iOS executor artifact does not match the build".into());
    }
    RUN.set(Run {
        app: app.clone(),
        id,
        launch,
        phase,
        root,
        container,
        documents,
        provider,
        token,
        supervisor,
    })
    .map_err(|_| INVALID.to_owned())
}

pub(crate) fn bootstrap() -> Result<(), String> {
    let run = run()?;
    crate::agent_e2e::ENVIRONMENT
        .set(crate::agent_e2e::Environment {
            config: crate::agent_e2e::Config {
                workspace_root: run.root.clone(),
                provider_base_url: run.provider.clone(),
                provider_token: run.token.clone(),
                model: "gpt-4.1-mini".into(),
                mode: "fixture".into(),
                journey: "workspace".into(),
                report_path: run.root.join("mobile-agent-report.json"),
                phase: run.phase.clone(),
                max_output_tokens: 1024,
                timeout_ms: 120_000,
            },
            service: format!("dev.situate.native-ios.{}", run.id),
            ready: Default::default(),
            keys: Default::default(),
        })
        .map_err(|_| INVALID.to_owned())?;
    crate::agent_e2e::RESTART_PENDING.store(
        run.phase == "exercise",
        std::sync::atomic::Ordering::Release,
    );
    Ok(())
}

fn owned_workspace(app: &tauri::AppHandle, location: &Location) -> Result<PathBuf, String> {
    let run = run()?;
    if location.kind != "ios-documents" || location.name != workspace_name(run) {
        return Err(INVALID.into());
    }
    let root = crate::files::local_root(app, location)?
        .ok_or(INVALID)?
        .canonicalize()
        .map_err(|_| INVALID)?;
    if root != run.documents.join(workspace_name(run))
        || marker(&run.container.join(".native-ios-smoke-owner"))?
            != json!({"version":1,"runId":run.id})
    {
        return Err(INVALID.into());
    }
    Ok(root)
}

pub(crate) fn seed_workspace(app: &tauri::AppHandle, location: &Location) -> Result<(), String> {
    use std::io::Write;
    let run = run()?;
    let root = owned_workspace(app, location)?;
    let managed = root.join(".situate");
    let info = fs::symlink_metadata(&managed).map_err(|_| INVALID)?;
    if run.phase != "exercise"
        || !info.is_dir()
        || info.file_type().is_symlink()
        || managed.join("migrations.json").exists()
    {
        return Err(INVALID.into());
    }
    let mut conversation: Value =
        serde_json::from_slice(RELEASE_CONVERSATION).map_err(|_| INVALID)?;
    let opaque: Value = serde_json::from_slice(RELEASE_OPAQUE).map_err(|_| INVALID)?;
    conversation["nativeFixtureOpaque"] = opaque["unknown"].clone();
    let conversation = serde_json::to_vec(&conversation).map_err(|_| INVALID)?;
    for (name, bytes) in [
        (
            "native-conversation-compatibility.json",
            conversation.as_slice(),
        ),
        ("opaque-state.json", RELEASE_OPAQUE),
    ] {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(managed.join(name))
            .map_err(|_| INVALID)?;
        file.write_all(bytes).map_err(|_| INVALID)?;
        file.sync_all().map_err(|_| INVALID)?;
    }
    Ok(())
}

fn verify_migration(root: &std::path::Path, storage: &Storage) -> Result<(), String> {
    let source: Value = serde_json::from_slice(RELEASE_CONVERSATION).map_err(|_| INVALID)?;
    let context = storage
        .read_conversation_context("compatibility")?
        .ok_or(INVALID)?;
    let record = context.project_record()?;
    if root
        .join(".situate/native-conversation-compatibility.json")
        .exists()
        || regular(&root.join(".situate/opaque-state.json"), 4096)? != RELEASE_OPAQUE
        || marker(&root.join(".situate/migrations.json"))?["lastAppliedMigration"] != 2
        || marker(&root.join(".situate/migrations.json"))?["minimumAppVersion"] != "0.1.6"
        || !context.entries.iter().any(|entry| {
            entry.kind == "legacy"
                && entry.data["field"] == "nativeFixtureOpaque"
                && entry.data["value"] == json!({"retain":[1,2,3]})
        })
        || context
            .entries
            .iter()
            .filter(|entry| entry.kind == "message")
            .count()
            != 2
        || record.title != source["title"].as_str().ok_or(INVALID)?
        || record.draft != source["draft"].as_str().ok_or(INVALID)?
        || record.messages[0] != source["messages"][0]
        || record.runtime.as_ref().is_none_or(|runtime| {
            !runtime.runs.is_empty()
                || runtime.pending.len() != 1
                || runtime.pending[0].id != "queued-1"
                || runtime.pending[0].text != "Retained queued input"
                || runtime.pending[0].state != "pending"
        })
    {
        return Err("Native iOS migration did not preserve retained work".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn mobile_smoke_info() -> Result<Value, String> {
    let run = run()?;
    Ok(
        json!({"runId":run.id,"phase":run.phase,"workspaceName":workspace_name(run),"conversation":conversation(run),"textAttachment":ATTACHED_TEXT,"referenceText":REFERENCE_TEXT,"imageBase64":IMAGE}),
    )
}

#[tauri::command]
pub(crate) async fn mobile_smoke_prepare(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let run = run()?;
        crate::workspaces::with_current(&app, window.label(), &scope, |location| {
            let root = owned_workspace(&app, location)?;
            verify_migration(&root, &Storage::open(&root, &scope)?)?;
            crate::ai::e2e::configure(&app, location, "gpt-4.1-mini", &run.token, run.phase == "exercise")?;
            if run.phase == "exercise" {
                use situate_core::plugins::{publication, runtime, sources};
                let _access = crate::files::CoordinatedAccess::begin(&app, location)?;
                sources::create(&root, PLUGIN)?;
                for (path, text) in [("plugin.json", json!({"schemaVersion":2,"id":PLUGIN,"name":"Native iOS Worker","description":"Synthetic native invocation fixture.","serviceEntry":"service.js","exports":["readEffect","hang","hangClose"]}).to_string()), ("service.js", SERVICE.to_string())] {
                    match sources::write(&root, PLUGIN, path, &text, None)? {
                        situate_core::content::SaveOutcome::Saved { .. } => {},
                        _ => return Err("Native iOS fixture source was not saved".into()),
                    }
                }
                let selected = vec![sources::snapshot(&root, PLUGIN)?];
                let checked = publication::checked_closure(&root, &selected)?;
                if publication::publish(&root, &selected, &checked, &[])?.status != publication::PublicationStatus::Published { return Err("Native iOS fixture publication failed".into()); }
                let before = runtime::list(&root)?;
                runtime::set_enabled(&root, PLUGIN, true, before.revision.as_deref())?;
            }
            Ok(())
        })
    }).await.map_err(|_| INVALID.to_owned())?
}

fn key_missing(result: Result<Vec<u8>, String>) -> Result<bool, String> {
    match result {
        Ok(_) => Ok(false),
        Err(error) if error == "native.ai.secureStore.missing" => Ok(true),
        Err(error) => Err(error),
    }
}

fn validate_key_account(account: &str) -> Result<(), String> {
    let suffix = account.strip_prefix("connection:").ok_or(INVALID)?;
    if suffix.len() != 48
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(INVALID.into());
    }
    Ok(())
}

pub(super) fn record_key(account: &str) -> Result<(), String> {
    let run = run()?;
    if marker(&run.container.join(".native-ios-smoke-owner"))?
        != json!({"version":1,"runId":run.id})
    {
        return Err(INVALID.into());
    }
    validate_key_account(account)
}

pub(crate) fn cleanup_keys(keys: &BTreeSet<String>) -> Result<(), String> {
    let run = run()?;
    if marker(&run.container.join(".native-ios-smoke-owner"))?
        != json!({"version":1,"runId":run.id})
    {
        return Err(INVALID.into());
    }
    for account in keys {
        validate_key_account(account)?;
    }
    for account in keys {
        let existed = !key_missing(crate::provider_platform::key_get(&run.app, account))?;
        crate::provider_platform::key_delete(&run.app, account)?;
        if !key_missing(crate::provider_platform::key_get(&run.app, account))? {
            return Err("Native iOS credential cleanup failed".into());
        }
        if existed {
            DELETED_KEYS.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
    }
    Ok(())
}

fn failure_stage(stage: Option<&str>) -> &str {
    match stage {
        Some(
            stage @ ("bootstrap"
            | "workspace-parent"
            | "workspace-create"
            | "workspace-open"
            | "workspace-prepare"
            | "migration"
            | "attachments"
            | "references"
            | "presentation"
            | "workspace-close"
            | "workspace-close-dialog"
            | "workspace-close-cancel"
            | "workspace-close-drain"
            | "workspace-reopen"
            | "conversation"
            | "native-terminal"
            | "worker-enter"
            | "worker-stop"
            | "worker-outcome"
            | "worker-idle"
            | "worker-readback"
            | "verify"),
        ) => stage,
        _ => "verification",
    }
}

fn cleanup_error_code(error: &str) -> &str {
    match error {
        code @ ("native.ai.secureStore.locked"
        | "native.ai.secureStore.unavailable"
        | "native.ai.secureStore.failed"
        | "native.ai.secureStore.invalid") => code,
        _ => "native.smoke.cleanupFailed",
    }
}

fn sanitize_ipc_trace(trace: Option<&Value>) -> Value {
    let Some(rows) = trace.and_then(Value::as_array) else {
        return json!([]);
    };
    json!(
        rows.iter()
            .take(32)
            .filter_map(|row| {
                let command = row["command"].as_str()?;
                let operation = row["operation"].as_str()?;
                if !matches!(
                    (command, operation),
                    ("plugin_executor", "stop")
                        | ("plugin_process_abort", "abort")
                        | ("ai_conversations_abort", "abort")
                        | ("ai_conversation_action", "draft")
                        | ("workspace_action", "close")
                ) {
                    return None;
                }
                let status = row["status"].as_str()?;
                if !matches!(status, "pending" | "completed" | "rejected") {
                    return None;
                }
                let code = if status == "rejected" {
                    Some(match row["code"].as_str() {
                        Some(
                            code @ ("native.plugins.unavailable"
                            | "native.plugins.hostCancelled"
                            | "native.plugins.stateSaveFailed"
                            | "native.plugins.actionSaveFailed"
                            | "native.plugins.stateOutcomeUnknown"
                            | "native.ai.request.failed"
                            | "native.ai.turn.inactive"
                            | "native.ai.conversation.unsaved"),
                        ) => code,
                        _ => "unclassified",
                    })
                } else {
                    None
                };
                Some(json!({"command":command,"operation":operation,"status":status,"code":code}))
            })
            .collect::<Vec<_>>()
    )
}

#[tauri::command]
pub(crate) async fn mobile_smoke_finish(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: Option<String>,
    failure: Option<String>,
    ipc_trace: Option<Value>,
) -> Result<(), String> {
    let verified = if run()?.phase == "cleanup" {
        Ok(())
    } else if failure.is_none() {
        let scope = scope.ok_or(INVALID)?;
        let verify_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let run = run()?;
            crate::workspaces::with_open_storage(&verify_app, window.label(), &scope, |location| {
                let root = owned_workspace(&verify_app, location)?;
                let files = crate::workspaces::file_session(&verify_app, window.label(), &scope)?;
                crate::files::with_content_store(&verify_app, &files, |content| {
                    let storage = Storage::open(&root, &scope)?;
                    verify_migration(&root, &storage)?;
                    let record = storage.read_conversation(&conversation(run))?.ok_or(INVALID)?;
                    let page = storage.read_conversation_history(&conversation(run), None, 128)?;
                    let original = page.entries.iter().find(|entry| entry.kind == "message" && entry.data.get("input").is_some()).ok_or(INVALID)?;
                    let attachments: Vec<situate_core::attachment::AttachmentRef> = serde_json::from_value(original.data["input"]["attachments"].clone()).map_err(|_| INVALID)?;
                    let references: Vec<situate_core::conversation_runtime::ContentReference> = serde_json::from_value(original.data["input"]["references"].clone()).map_err(|_| INVALID)?;
                    if attachments.len() != 2 || references.len() != 1 || references[0].workspace_id() != scope {
                        return Err("Native iOS retained input identities are invalid".into());
                    }
                    let image = base64::engine::general_purpose::STANDARD.decode(IMAGE).map_err(|_| INVALID)?;
                    for (index, (name, mime, expected)) in [("ios-source.txt", "text/plain", ATTACHED_TEXT.as_bytes()), ("ios-pixel.png", "image/png", image.as_slice())].into_iter().enumerate() {
                        let (saved, bytes) = storage.read_attachment(&attachments[index].id)?;
                        if saved != attachments[index] || saved.name != name || saved.mime_type != mime || bytes != expected {
                            return Err("Native iOS retained attachment bytes changed".into());
                        }
                    }
                    let (_, path, version) = content.resolve_reference(&references[0]).map_err(|error| error.to_string())?.ok_or(INVALID)?;
                    if path != "ios-reference-moved.txt" || version.text != REFERENCE_TEXT || record.runtime.as_ref().and_then(|runtime| runtime.runs.first()).is_none_or(|run| run.references != references) {
                        return Err("Native iOS retained reference changed identity or contents".into());
                    }
                    if record.version != 2 || record.runtime.as_ref().is_none_or(|runtime| runtime.runs.len() != 1 || runtime.runs[0].state != "completed")
                        || record.messages.as_array().is_none_or(|messages| messages.iter().filter(|message| message["role"] == "toolResult").count() != 3 || messages.iter().any(|message| message["role"] == "toolResult" && message["isError"] != false))
                        || content.read_text("ios-smoke-note.txt").map_err(|e| e.to_string())?.text != NOTE
                        || content.read_text("ios-worker-effect.txt").map_err(|e| e.to_string())?.text != EFFECT
                        || content.read_text("ios-worker-running.txt").map_err(|e| e.to_string())?.text != "Synthetic Worker entered\n"
                        || content.read_text("ios-worker-closing.txt").map_err(|e| e.to_string())?.text != "Synthetic closing Worker entered\n" { return Err("Native iOS durable results are invalid".into()); }
                    let checkpoint = json!({"version":1,"runId":run.id,"recordDigest":digest(&serde_json::to_vec(&record).map_err(|_| INVALID)?),"historyCount":content.history().map_err(|e| e.to_string())?.len(),"migrationHistoryDigest":digest(&regular(&root.join(".situate/conversations/compatibility/history.jsonl"), 65536)?)});
                    if run.phase == "exercise" {
                        crate::agent_e2e::write_private(&run.root.join("mobile-smoke-checkpoint.json"), &serde_json::to_vec(&checkpoint).map_err(|_| INVALID)?)?;
                        crate::agent_e2e::write_private(&run.root.join("smoke-restart.json"), b"{}")?;
                    } else if marker(&run.root.join("mobile-smoke-checkpoint.json"))? != checkpoint { return Err("Native iOS relaunch changed retained work".into()); }
                    Ok(())
                })
            })
        }).await.map_err(|_| INVALID.to_owned())?
    } else {
        Err("Native iOS journey failed".into())
    };
    let run = run()?;
    let should_cleanup = run.phase != "exercise" || verified.is_err();
    let cleanup_result = if should_cleanup {
        crate::agent_e2e::RESTART_PENDING.store(false, std::sync::atomic::Ordering::Release);
        tauri::async_runtime::spawn_blocking(crate::agent_e2e::cleanup)
            .await
            .unwrap_or_else(|_| Err("native.smoke.cleanupFailed".into()))
    } else {
        Ok(())
    };
    let keys_deleted = should_cleanup && cleanup_result.is_ok();
    let cleanup_error = cleanup_result
        .err()
        .map(|error| cleanup_error_code(&error).to_owned());
    let passed = verified.is_ok()
        && cleanup_error.is_none()
        && (run.phase != "reopen" || DELETED_KEYS.load(std::sync::atomic::Ordering::Acquire) > 0);
    let report = json!({"version":1,"runId":run.id,"launchId":run.launch,"phase":run.phase,"passed":passed,"qualification":"debug","locationKind":"ios-documents","supervisorSha256":run.supervisor,"ipcTrace":sanitize_ipc_trace(ipc_trace.as_ref()),"keysDeleted":keys_deleted,"cleanupError":cleanup_error,"deletedKeys":DELETED_KEYS.load(std::sync::atomic::Ordering::Acquire),"stage":if passed {if run.phase == "cleanup" {"cleanup"} else {"complete"}} else if run.phase == "cleanup" {"cleanup"} else {failure_stage(failure.as_deref())}});
    let url = run.provider.replace("/v1/responses", "/report");
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| INVALID)?
        .post(url)
        .bearer_auth(&run.token)
        .json(&report)
        .send()
        .await
        .map_err(|_| INVALID)?
        .error_for_status()
        .map_err(|_| INVALID)?;
    // Report acknowledgement must not trigger another cleanup attempt in the WebView.
    Ok(())
}
