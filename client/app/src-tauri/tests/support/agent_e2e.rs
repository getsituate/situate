use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use situate_core::{content::ContentStore, workspace_registry::Registry, workspaces::Location};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::Manager;

#[cfg(target_os = "macos")]
#[path = "agent_e2e_keychain.rs"]
pub(crate) mod keychain;

#[cfg(target_os = "ios")]
#[path = "mobile_smoke.rs"]
pub(crate) mod mobile;

const ERROR: &str = "Agent E2E isolation or configuration is invalid";
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Observation {
    has_composer: bool,
    has_send: bool,
    has_stop: bool,
    has_alert: bool,
    conversation_count: u32,
    user_messages: u32,
    assistant_messages: u32,
    tool_results: u32,
    draft_chars: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    identified_tasks: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    metadata_issues: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    main_requests: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auxiliary_requests: Option<u32>,
    run_states: Vec<ObservedRunState>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ObservedRunState {
    Running,
    Completed,
    Cancelled,
    Failed,
    Error,
    Interrupted,
    Unknown,
}
impl Observation {
    fn bounded(mut self) -> Self {
        for count in [
            &mut self.conversation_count,
            &mut self.user_messages,
            &mut self.assistant_messages,
            &mut self.tool_results,
            &mut self.draft_chars,
        ] {
            *count = (*count).min(100_000_000);
        }
        for count in [
            &mut self.identified_tasks,
            &mut self.metadata_issues,
            &mut self.main_requests,
            &mut self.auxiliary_requests,
        ]
        .into_iter()
        .flatten()
        {
            *count = (*count).min(100_000_000);
        }
        self.run_states.truncate(32);
        self
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    workspace_root: PathBuf,
    provider_base_url: String,
    provider_token: String,
    model: String,
    mode: String,
    journey: String,
    report_path: PathBuf,
    phase: String,
    max_output_tokens: u64,
    #[serde(default = "default_timeout")]
    timeout_ms: u64,
}
fn default_timeout() -> u64 {
    300_000
}
pub(crate) fn timeout() -> std::time::Duration {
    std::time::Duration::from_millis(
        ENVIRONMENT
            .get()
            .map_or(45_000, |env| env.config.timeout_ms),
    )
}
struct Environment {
    config: Config,
    service: String,
    ready: Mutex<BTreeSet<String>>,
    keys: Mutex<()>,
}
static ENVIRONMENT: OnceLock<Environment> = OnceLock::new();
static BOOTSTRAP_STEP: Mutex<&'static str> = Mutex::new("bootstrap");
static KEYCHAIN_FAILURE: Mutex<Option<(&'static str, i32)>> = Mutex::new(None);
pub(crate) fn keychain_failure(operation: &'static str, status: i32) {
    if enabled() {
        KEYCHAIN_FAILURE
            .lock()
            .unwrap()
            .get_or_insert((operation, status));
    }
}
pub(crate) fn bootstrap_step(step: &'static str) {
    *BOOTSTRAP_STEP.lock().unwrap() = step;
}
pub(crate) fn report_bootstrap_failure() {
    let stage = match *KEYCHAIN_FAILURE.lock().unwrap() {
        Some((operation, status)) => format!("credential-{operation}-os-{status}"),
        None => BOOTSTRAP_STEP.lock().unwrap().to_string(),
    };
    let _ = report("blocked", &stage);
}
static RESTART_PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(crate) fn cleanup_on_exit() {
    // Mobile finish owns cleanup; synchronous bridge calls cannot block the iOS exit callback.
    #[cfg(not(target_os = "ios"))]
    if !RESTART_PENDING.load(std::sync::atomic::Ordering::Acquire) {
        let _ = cleanup();
    }
}

fn regular(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ERROR)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(ERROR.into());
    }
    Ok(())
}
fn owned_file(root: &Path, path: &Path) -> Result<(), String> {
    if path.parent() != Some(root) || path.file_name().is_none() {
        return Err(ERROR.into());
    }
    if path.exists() {
        regular(path)?;
    }
    Ok(())
}
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let root = path.parent().ok_or(ERROR)?;
    owned_file(root, path)?;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|_| ERROR)?;
    file.write_all(bytes).map_err(|_| ERROR)?;
    file.as_file().sync_all().map_err(|_| ERROR)?;
    file.persist(path).map_err(|_| ERROR)?;
    fs::File::open(root)
        .and_then(|f| f.sync_all())
        .map_err(|_| ERROR)?;
    Ok(())
}
fn validate_broker(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| ERROR)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.port() == Some(0)
        || url.path() != "/v1/responses"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ERROR.into());
    }
    Ok(())
}
fn load_config(path: &Path) -> Result<Environment, String> {
    regular(path)?;
    let config: Config =
        serde_json::from_slice(&fs::read(path).map_err(|_| ERROR)?).map_err(|_| ERROR)?;
    let root = &config.workspace_root;
    let owner = std::env::var("SITUATE_SMOKE_OWNER").map_err(|_| ERROR)?;
    let expected_root = std::env::var("SITUATE_SMOKE_ROOT").map_err(|_| ERROR)?;
    if !root.is_absolute()
        || fs::symlink_metadata(root)
            .map_err(|_| ERROR)?
            .file_type()
            .is_symlink()
        || Path::new(&expected_root) != root.as_path()
        || owner.len() < 16
        || owner.len() > 80
        || !owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !matches!(config.mode.as_str(), "fixture" | "live")
        || !matches!(config.phase.as_str(), "exercise" | "reopen")
        || !matches!(
            config.journey.as_str(),
            "workspace" | "onboarding" | "plugins"
        )
        || (config.journey == "plugins" && config.mode != "fixture")
        || !matches!(config.model.as_str(), "gpt-4.1-mini" | "gpt-6.1-sol")
        || !(1..=4096).contains(&config.max_output_tokens)
        || !(1..=900_000).contains(&config.timeout_ms)
        || config.provider_token.len() < 16
        || config.provider_token.len() > 256
        || !config
            .provider_token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err(ERROR.into());
    }
    regular(&root.join(".smoke-owner"))?;
    if fs::read_to_string(root.join(".smoke-owner")).map_err(|_| ERROR)? != owner {
        return Err(ERROR.into());
    }
    owned_file(root, path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(root).map_err(|_| ERROR)?.permissions().mode() & 0o077 != 0
            || fs::metadata(path).map_err(|_| ERROR)?.permissions().mode() & 0o077 != 0
        {
            return Err(ERROR.into());
        }
    }
    owned_file(root, &config.report_path)?;
    validate_broker(&config.provider_base_url)?;
    Ok(Environment {
        config,
        service: format!("dev.situate.agent-e2e.{owner}"),
        ready: Mutex::default(),
        keys: Mutex::new(()),
    })
}

pub(crate) fn initialize() -> bool {
    let Some(path) = std::env::var_os("SITUATE_AGENT_E2E_CONFIG") else {
        if std::env::var_os("SITUATE_AGENT_E2E_CLEANUP").is_some() {
            std::process::exit(1);
        }
        return true;
    };
    let environment = load_config(Path::new(&path)).unwrap_or_else(|_| std::process::exit(1));
    if ENVIRONMENT.set(environment).is_err() {
        std::process::exit(1);
    }
    if std::env::var("SITUATE_AGENT_E2E_CLEANUP").as_deref() == Ok("1") {
        std::process::exit(if cleanup().is_ok() { 0 } else { 1 });
    }
    true
}
pub(crate) fn disabled_shell_capability() -> crate::shell_host::ShellCapability {
    let mut shell = crate::shell_host::capability();
    shell.available = false;
    shell.implementation = "unavailable";
    shell.interpreter = None;
    shell.interpreter_dialect = None;
    shell.interpreter_args.clear();
    shell.unavailable_reason = Some("isolatedTestExecutionDisabled");
    shell.ownership = "none";
    shell
}
pub(crate) fn enabled() -> bool {
    ENVIRONMENT.get().is_some()
}
fn environment() -> Result<&'static Environment, String> {
    ENVIRONMENT.get().ok_or_else(|| ERROR.into())
}
pub(crate) fn record_key(account: &str) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    mobile::record_key(account)?;
    let Some(env) = ENVIRONMENT.get() else {
        return Ok(());
    };
    let _guard = env.keys.lock().map_err(|_| ERROR)?;
    let path = env.config.workspace_root.join("agent-e2e-keys.json");
    owned_file(&env.config.workspace_root, &path)?;
    let mut keys: BTreeSet<String> = if path.exists() {
        serde_json::from_slice(&fs::read(&path).map_err(|_| ERROR)?).map_err(|_| ERROR)?
    } else {
        BTreeSet::new()
    };
    keys.insert(account.into());
    write_private(&path, &serde_json::to_vec(&keys).map_err(|_| ERROR)?)
}
pub(crate) fn cleanup() -> Result<(), String> {
    let Some(env) = ENVIRONMENT.get() else {
        return Ok(());
    };
    let _guard = env.keys.lock().map_err(|_| ERROR)?;
    let path = env.config.workspace_root.join("agent-e2e-keys.json");
    owned_file(&env.config.workspace_root, &path)?;
    let keys: BTreeSet<String> = if path.exists() {
        serde_json::from_slice(&fs::read(&path).map_err(|_| ERROR)?).map_err(|_| ERROR)?
    } else {
        BTreeSet::new()
    };
    #[cfg(target_os = "macos")]
    keychain::cleanup(&keys)?;
    #[cfg(target_os = "ios")]
    mobile::cleanup_keys(&keys)?;
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = keys;
    write_private(&path, b"[]")
}

pub(crate) fn provider_request(
    api: &str,
    url: &str,
    body: &str,
) -> Result<(String, String), String> {
    let Some(env) = ENVIRONMENT.get() else {
        return Ok((url.into(), body.into()));
    };
    redirect_request(&env.config, api, url, body)
}
fn redirect_request(
    config: &Config,
    api: &str,
    url: &str,
    body: &str,
) -> Result<(String, String), String> {
    if api != "openai-responses" || url != "https://api.openai.com/v1/responses" {
        return Err("native.ai.request.destinationMismatch".into());
    }
    let mut body: Value = serde_json::from_str(body).map_err(|_| ERROR)?;
    if body["model"] != config.model || body["stream"] != true {
        return Err(ERROR.into());
    }
    let limit = body
        .get("max_output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(config.max_output_tokens)
        .min(config.max_output_tokens);
    if limit == 0 {
        return Err(ERROR.into());
    }
    body["max_output_tokens"] = json!(limit);
    Ok((config.provider_base_url.clone(), body.to_string()))
}

fn locations(env: &Environment) -> Result<Vec<Location>, String> {
    ["Alpha", "Beta"]
        .iter()
        .map(|name| {
            situate_core::workspaces::inspect(
                &env.config.workspace_root.join("workspaces").join(name),
            )
        })
        .collect()
}
pub(crate) fn bootstrap(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    return mobile::bootstrap();
    #[allow(unreachable_code)]
    let Some(env) = ENVIRONMENT.get() else {
        return Ok(());
    };
    bootstrap_step("bootstrap-directory");
    if app
        .path()
        .app_data_dir()
        .map_err(|_| ERROR)?
        .canonicalize()
        .map_err(|_| ERROR)?
        != env
            .config
            .workspace_root
            .canonicalize()
            .map_err(|_| ERROR)?
    {
        return Err(ERROR.into());
    }
    let first = env.config.phase == "exercise";
    #[cfg(target_os = "macos")]
    keychain::prepare(first)?;
    let root = &env.config.workspace_root;
    if first {
        bootstrap_step("bootstrap-workspaces-directory");
        fs::create_dir(root.join("workspaces")).map_err(|_| ERROR)?;
        for name in ["Alpha", "Beta"] {
            bootstrap_step("bootstrap-workspace-create");
            #[cfg(target_os = "macos")]
            let create = if name == "Alpha" && env.config.journey != "plugins" {
                situate_core::workspaces::create_for_onboarding
            } else {
                situate_core::workspaces::create
            };
            #[cfg(not(target_os = "macos"))]
            let create = situate_core::workspaces::create;
            let location = create(&root.join("workspaces"), name)?;
            if name == "Alpha" {
                #[cfg(not(target_os = "macos"))]
                situate_core::onboarding::OnboardingStorage::open(
                    Path::new(&location.handle),
                    &location.id,
                )?
                .initialize()?;
                bootstrap_step("bootstrap-image-seed");
                let image = base64::engine::general_purpose::STANDARD.decode(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
                ).map_err(|_| ERROR)?;
                write_private(&Path::new(&location.handle).join("e2e-image.png"), &image)?;
            }
            bootstrap_step("bootstrap-content-open");
            let mut store =
                ContentStore::open(Path::new(&location.handle)).map_err(|e| e.to_string())?;
            if name == "Alpha" {
                bootstrap_step("bootstrap-seed-write");
                if env.config.journey == "plugins" {
                    seed_plugin_capabilities(Path::new(&location.handle), &location.id)?;
                }
                if env.config.journey == "onboarding" {
                    let sources = root.join("sources");
                    fs::create_dir(&sources).map_err(|_| ERROR)?;
                    write_private(
                        &sources.join("seed.json"),
                        include_bytes!("onboarding-source.json"),
                    )?;
                    write_private(
                        &sources.join("seed.md"),
                        include_bytes!("onboarding-source.md"),
                    )?;
                } else {
                    store
                        .create_text("seed.md", "# Fixture\n\nsource-token-731\n")
                        .map_err(|e| e.to_string())?;
                }
            }
            bootstrap_step("bootstrap-localization");
            let localization =
                situate_core::localization::Storage::open(Path::new(&location.handle))?;
            let english = situate_core::localization::Preferences::initial("en", None, None, None);
            let expected = localization.snapshot(&english, false)?;
            localization.update(&english, &english, &expected)?;
        }
    } else {
        bootstrap_step("bootstrap-restart-checkpoint");
        regular(&root.join("smoke-restart.json"))?;
    }
    bootstrap_step("bootstrap-workspace-inspect");
    let locations = locations(env)?;
    for location in &locations {
        crate::ai::e2e::configure(
            app,
            location,
            &env.config.model,
            &env.config.provider_token,
            first,
        )?;
    }
    bootstrap_step("bootstrap-registry");
    if first {
        let mut registry = Registry::default();
        for location in locations {
            registry.opened(location, true);
        }
        registry.save(&root.join("workspaces-v1.json"))?;
    } else {
        let registry = Registry::load(&root.join("workspaces-v1.json"))?;
        if registry.restore.len() != 2
            || locations
                .iter()
                .any(|location| !registry.restore.contains(location))
        {
            return Err(ERROR.into());
        }
    }
    Ok(())
}
pub(crate) fn script() -> Result<String, String> {
    let env = environment()?;
    let path = env.config.workspace_root.join("agent-e2e.js");
    regular(&path)?;
    fs::read_to_string(path).map_err(|_| ERROR.into())
}
fn current(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<Option<Location>, String> {
    let env = environment()?;
    Ok(locations(env)?.into_iter().find(|location| {
        crate::workspaces::file_session(app, window.label(), &location.id).is_ok()
    }))
}
fn ready(env: &Environment) -> Result<Vec<String>, String> {
    Ok(env
        .ready
        .lock()
        .map_err(|_| ERROR)?
        .iter()
        .cloned()
        .collect())
}
#[tauri::command]
pub(crate) async fn agent_e2e_info(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let env = environment()?;
    let location = current(&app, &window)?;
    let role = match location.as_ref().map(|l| l.name.as_str()) {
        Some("Alpha") => "primary",
        Some("Beta") => "secondary",
        _ => "controller",
    };
    if role == "primary" && ready(env)?.iter().any(|scope| Some(scope) != location.as_ref().map(|location| &location.id)) {
        #[cfg(target_os = "macos")]
        app.show().map_err(|_| ERROR)?;
        window.show().map_err(|_| ERROR)?;
        #[cfg(desktop)]
        window.unminimize().map_err(|_| ERROR)?;
        window.set_focus().map_err(|_| ERROR)?;
    }
    let checkpoint = if role == "primary" && env.config.phase == "reopen" && matches!(env.config.journey.as_str(), "onboarding" | "plugins") {
        Some(read_checkpoint(env)?)
    } else {
        None
    };
    Ok(
        json!({"mode":env.config.mode,"phase":env.config.phase,"journey":env.config.journey,"role":role,"scope":location.map(|l|l.id),"model":env.config.model,"readyScopes":ready(env)?,"checkpoint":checkpoint}),
    )
    })
    .await
    .map_err(|_| ERROR.to_owned())?
}
#[tauri::command]
pub(crate) async fn agent_e2e_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let env = environment()?;
        let location = current(&app, &window)?.ok_or(ERROR)?;
        env.ready.lock().map_err(|_| ERROR)?.insert(location.id);
        Ok(())
    })
    .await
    .map_err(|_| ERROR.to_owned())?
}
fn snapshot_error(step: &str, error: impl std::fmt::Display) -> String {
    let error = error.to_string();
    let reason = match error.as_str() {
        "native.ai.storage.busy"
        | "native.ai.storage.failed"
        | "native.ai.conversation.versionInvalid"
        | "native.files.operation.unavailable"
        | "native.files.operation.failed"
        | "native.workspace.session.inactive"
        | "native.content.store.busy" => error.replace('.', "-"),
        _ => "failed".into(),
    };
    format!("snapshot-{step}-{reason}")
}
fn observe_storage<T>(
    timeout: std::time::Duration,
    mut read: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let error = match read() {
            Ok(value) => return Ok(value),
            Err(error) => error,
        };
        if !matches!(
            error.as_str(),
            "snapshot-list-conversations-native-ai-storage-busy"
                | "snapshot-read-conversation-native-ai-storage-busy"
                | "snapshot-settings-read-native-ai-storage-busy"
        ) || std::time::Instant::now() >= deadline
        {
            return Err(error);
        }
        std::thread::sleep(
            std::time::Duration::from_millis(10)
                .min(deadline.saturating_duration_since(std::time::Instant::now())),
        );
    }
}
fn seed_plugin_capabilities(root: &Path, scope: &str) -> Result<(), String> {
    use situate_core::{
        content::SaveOutcome,
        plugins::{publication, runtime, sources},
    };
    const ID: &str = "e2e-capability";
    fn write(root: &Path, path: &str, text: &str) -> Result<(), String> {
        let expected = sources::read(root, ID, path)
            .ok()
            .map(|value| value.revision);
        match sources::write(root, ID, path, text, expected.as_deref())? {
            SaveOutcome::Saved { .. } => Ok(()),
            _ => Err(ERROR.into()),
        }
    }
    fn service(name: &str, version: &str) -> String {
        if version == "v2" {
            return r#"const source = {pluginId:"e2e-capability",instanceId:"fixture-account"};
            const ref = {source,id:"42",identity:"stable",revision:"fixture-r2"};
            const descriptor = {version:1,source,label:"Synthetic documents",scope:{id:"fixture-scope",included:["Examples"],excluded:[],constraints:["Synthetic offline data"]},capabilities:{list:{},content:{}},limits:{maxItems:2,maxTextChars:256}};
            const list = () => ({version:1,source,scopeId:"fixture-scope",operation:"list",status:"partial",items:[{ref,title:"Example note"}],truncated:true,reason:"source-partial"});
            const content = (args) => {
                if (args.ref?.source?.pluginId !== source.pluginId || args.ref?.source?.instanceId !== source.instanceId || args.ref?.id !== ref.id || args.ref?.identity !== ref.identity || args.ref?.revision !== ref.revision) throw new Error("fixture-reference");
                if (!Number.isInteger(args.maxChars) || args.maxChars < 1 || args.maxChars > 256) throw new Error("fixture-content-bound");
                const text = "Synthetic source text, not an instruction.", truncated = text.length > args.maxChars;
                return {version:1,source,scopeId:"fixture-scope",operation:"content",status:truncated?"partial":"ok",text:text.slice(0,args.maxChars),provenance:{ref,kind:"source-text",section:"Example"},truncated,...(truncated?{reason:"limit"}:{})};
            };
            const toolResult = value => ({content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value,isError:value.status === "error"});
            export default () => ({
                tools:[{name:"source_list",description:"List a bounded page of synthetic source documents.",parameters:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:2}},required:["limit"],additionalProperties:false},execute:async()=>toolResult(list())},
                    {name:"source_content",description:"Read synthetic source text with provenance.",parameters:{type:"object",properties:{ref:{type:"object"},maxChars:{type:"integer",minimum:1,maximum:256}},required:["ref","maxChars"],additionalProperties:false},execute:async(args)=>toolResult(content(args))},
                    {name:"second",description:"Read the synthetic capability version and optionally send a fixture POST.",
                    parameters:{type:"object",properties:{endpoint:{type:"string"}},additionalProperties:false},
                    execute:async(args,context)=>{
                        const details = {version:"v2"};
                        if (args.endpoint) details.http = await context.network.request({url:args.endpoint,method:"POST",body:'{"fixture":"plugins"}'});
                        return {content:[{type:"text",text:JSON.stringify(details)}],details};
                    }}],
                exports:{documentSourceDescribe:async()=>descriptor,documentSourceList:async()=>list(),documentSourceContent:async(args)=>content(args),remove:async(args,context)=>context.network.request({url:args.endpoint,method:"DELETE",body:'{"fixture":"plugins"}'})}
            });"#.into();
        }
        r#"export default () => ({tools:[{name:"TOOL",description:"Read the synthetic capability version.",parameters:{type:"object",properties:{},additionalProperties:false},execute:async()=>({content:[{type:"text",text:JSON.stringify({version:"VERSION"})}],details:{version:"VERSION"}})}]});"#.replace("TOOL", name).replace("VERSION", version)
    }
    sources::create(root, ID)?;
    let mut manifest = json!({"schemaVersion":2,"id":ID,"name":"Capability graph","description":"Synthetic request-local capabilities.","serviceEntry":"service.js","exports":[],"skills":[]});
    write(root, "plugin.json", &manifest.to_string())?;
    write(root, "service.js", &service("first", "v1"))?;
    let selected = vec![sources::snapshot(root, ID)?];
    let checked = publication::checked_closure(root, &selected)?;
    if publication::publish(root, &selected, &checked, &[])?.status
        != publication::PublicationStatus::Published
    {
        return Err(ERROR.into());
    }
    let state = runtime::list(root)?;
    runtime::set_enabled(root, ID, true, state.revision.as_deref())?;
    write(root, "service.js", &service("second", "v2"))?;
    manifest["exports"] = json!([
        "remove",
        "documentSourceDescribe",
        "documentSourceList",
        "documentSourceContent"
    ]);
    write(root, "plugin.json", &manifest.to_string())?;
    situate_core::ai_storage::Storage::open(root, scope)?.create_assignment_conversation(
        "55555555-5555-4555-8555-555555555555",
        Some(ID),
        None,
        "Plugin capability graph",
        "Check and activate the candidate capability, then use the current tool.",
        "",
    )?;
    Ok(())
}

fn read_fixture_file(directory: &cap_std::fs::Dir, path: &str) -> Result<Value, String> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
    use std::io::Read;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_fs_ext::OpenOptionsSyncExt;
        options.nonblock(true);
    }
    let file = directory
        .open_with(path, &options)
        .map_err(|e| snapshot_error("file-open", e))?;
    if !file
        .metadata()
        .map_err(|e| snapshot_error("file-meta", e))?
        .is_file()
    {
        return Err(snapshot_error("file-kind", ERROR));
    }
    let mut bytes = Vec::new();
    file.take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|e| snapshot_error("file-read", e))?;
    if bytes.len() > 1_048_576 {
        return Err(snapshot_error("file-size", ERROR));
    }
    let text = String::from_utf8(bytes.clone()).map_err(|e| snapshot_error("file-utf8", e))?;
    let revision = situate_core::content::revision_for_text(&text)
        .map_err(|e| snapshot_error("file-revision", e))?;
    Ok(json!({"path":path,"text":text,"revision":revision,"bytes":bytes}))
}

#[tauri::command]
pub(crate) async fn agent_e2e_snapshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let env = environment().map_err(|e| snapshot_error("environment", e))?;
        let location = current(&app, &window)
            .map_err(|e| snapshot_error("current-session", e))?
            .ok_or_else(|| snapshot_error("current-session", ERROR))?;
        let root = Path::new(&location.handle);
        let (records, settings) = observe_storage(std::time::Duration::from_secs(2), || crate::workspaces::with_current(&app, window.label(), &location.id, |_| {
            let storage = crate::ai::e2e::snapshot_storage(&app, &location).map_err(|e| snapshot_error("storage-open", e))?;
            let summaries = storage.list_conversations().map_err(|e| snapshot_error("list-conversations", e))?;
            let records = summaries.iter().map(|summary| {
                storage.read_conversation(&summary.id)
                    .map_err(|e| snapshot_error("read-conversation", e))?
                    .ok_or_else(|| snapshot_error("missing-conversation", ERROR))
            }).collect::<Result<Vec<_>, _>>()?;
            let connection = storage.selected_connection().map_err(|e| snapshot_error("settings-read", e))?
                .ok_or_else(|| snapshot_error("settings-missing", ERROR))?;
            let bytes = storage.read_connection_settings(&connection.id).map_err(|e| snapshot_error("settings-read", e))?
                .ok_or_else(|| snapshot_error("settings-missing", ERROR))?;
            let settings: Value = serde_json::from_slice(&bytes).map_err(|e| snapshot_error("settings-decode", e))?;
            Ok((records, settings))
        })).map_err(|error| {
            if error.starts_with("snapshot-") { error } else { snapshot_error("storage-session", error) }
        })?;
        let mut history = Vec::new();
        let directory = cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority())
            .map_err(|e| snapshot_error("cap-open", e))?;
        let files = ["seed.md", "e2e-note.md"].iter()
            .filter(|path| root.join(path).exists())
            .map(|path| {
                let document = read_fixture_file(&directory, path)?;
                let request = serde_json::from_value(json!({"operation":"history","path":path,"limit":200}))
                    .map_err(|e| snapshot_error("history-request", e))?;
                let session = crate::workspaces::file_session(&app, window.label(), &location.id)
                    .map_err(|e| snapshot_error("history-session", e))?;
                let page = crate::files::agent_request(&app, session, request, None)
                    .map_err(|e| snapshot_error("history", e))?;
                history.extend(page["entries"].as_array()
                    .ok_or_else(|| snapshot_error("history-page", ERROR))?.iter().cloned());
                Ok(document)
            }).collect::<Result<Vec<Value>, String>>()?;
        let source_files = if env.config.journey == "onboarding" && location.name == "Alpha" {
            use cap_fs_ext::DirExt;
            let root = cap_std::fs::Dir::open_ambient_dir(&env.config.workspace_root, cap_std::ambient_authority()).map_err(|e| snapshot_error("cap-open", e))?;
            let sources = root.open_dir_nofollow("sources").map_err(|e| snapshot_error("cap-open", e))?;
            ["seed.json", "seed.md"].iter().map(|path| read_fixture_file(&sources, path)).collect::<Result<Vec<_>, _>>()?
        } else { Vec::new() };
        Ok(json!({"conversations":records,"files":files,"sourceFiles":source_files,"history":history,"settings":settings["settings"],"readyScopes":ready(env).map_err(|e|snapshot_error("ready",e))?}))
    })
    .await
    .map_err(|e| snapshot_error("task", e))?
}
fn read_checkpoint(env: &Environment) -> Result<Value, String> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
    use std::io::Read;
    let root = cap_std::fs::Dir::open_ambient_dir(
        &env.config.workspace_root,
        cap_std::ambient_authority(),
    )
    .map_err(|_| ERROR)?;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_fs_ext::OpenOptionsSyncExt;
        options.nonblock(true);
    }
    let file = root
        .open_with("smoke-restart.json", &options)
        .map_err(|_| ERROR)?;
    if !file.metadata().map_err(|_| ERROR)?.is_file() {
        return Err(ERROR.into());
    }
    let mut bytes = Vec::new();
    file.take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|_| ERROR)?;
    if bytes.len() > 65_536 {
        return Err(ERROR.into());
    }
    serde_json::from_slice(&bytes).map_err(|_| ERROR.into())
}

#[tauri::command]
pub(crate) async fn agent_e2e_checkpoint(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    baseline: Option<Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let env = environment()?;
        if current(&app, &window)?.is_none_or(|l| l.name != "Alpha") || ready(env)?.len() != 2 {
            return Err(ERROR.into());
        }
        let bytes =
            serde_json::to_vec(&baseline.unwrap_or_else(|| json!({}))).map_err(|_| ERROR)?;
        if bytes.len() > 65_536 {
            return Err(ERROR.into());
        }
        write_private(
            &env.config.workspace_root.join("smoke-restart.json"),
            &bytes,
        )
    })
    .await
    .map_err(|_| ERROR.to_owned())?
}
fn permits_control(mode: &str, action: &str, marker: &str) -> bool {
    mode == "fixture"
        && match action {
            "wait" => matches!(
                marker,
                "[e2e:queue]" | "[e2e:consume]" | "[e2e:stop]" | "[e2e:plugins]"
            ),
            "release" => matches!(marker, "[e2e:queue]" | "[e2e:consume]" | "[e2e:plugins]"),
            _ => false,
        }
}
#[tauri::command]
pub(crate) async fn agent_e2e_control(action: String, marker: String) -> Result<(), String> {
    let env = environment()?;
    if !permits_control(&env.config.mode, &action, &marker) {
        return Err(ERROR.into());
    }
    let mut url = reqwest::Url::parse(&env.config.provider_base_url).map_err(|_| ERROR)?;
    url.set_path("/control");
    let response = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| ERROR)?
        .post(url)
        .bearer_auth(&env.config.provider_token)
        .json(&json!({"action":action,"marker":marker}))
        .send()
        .await
        .map_err(|_| ERROR)?;
    if !response.status().is_success() {
        return Err(ERROR.into());
    }
    Ok(())
}
pub(crate) fn report(category: &str, stage: &str) -> Result<(), String> {
    report_observation(category, stage, None)
}
fn report_observation(
    category: &str,
    stage: &str,
    observation: Option<Observation>,
) -> Result<(), String> {
    let env = environment()?;
    let stage = if stage.len() <= 80
        && stage
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        stage
    } else {
        "journey"
    };
    let mut report = json!({"passed":category=="passed","category":category,"phase":env.config.phase,"stage":stage});
    if let Some(observation) = observation {
        report["observation"] = serde_json::to_value(observation.bounded()).map_err(|_| ERROR)?;
    }
    write_private(&env.config.report_path, report.to_string().as_bytes())
}
#[tauri::command]
pub(crate) async fn agent_e2e_finish(
    app: tauri::AppHandle,
    error: Option<String>,
    stage: Option<String>,
    observation: Option<Observation>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || finish(app, error, stage, observation))
        .await
        .map_err(|_| ERROR.to_owned())?
}
pub(crate) fn finish(
    app: tauri::AppHandle,
    error: Option<String>,
    stage: Option<String>,
    observation: Option<Observation>,
) -> Result<(), String> {
    let env = environment()?;
    let passed = error.is_none() && ready(env)?.len() == 2;
    let restart = passed && env.config.phase == "exercise";
    if restart {
        regular(&env.config.workspace_root.join("smoke-restart.json"))?;
    }
    let category = if !restart && cleanup().is_err() {
        "cleanup"
    } else if !passed {
        "assertion"
    } else {
        "passed"
    };
    report_observation(category, stage.as_deref().unwrap_or("journey"), observation)?;
    RESTART_PENDING.store(restart, std::sync::atomic::Ordering::Release);
    crate::files::approve_smoke_exit(&app);
    app.exit(if category == "passed" { 0 } else { 1 });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_controls_observe_stop_without_releasing_it() {
        let allowed = [
            ("wait", "[e2e:queue]"),
            ("wait", "[e2e:consume]"),
            ("wait", "[e2e:stop]"),
            ("release", "[e2e:queue]"),
            ("release", "[e2e:consume]"),
        ];
        for mode in ["fixture", "live"] {
            for action in ["wait", "release", "hold", "other"] {
                for marker in ["[e2e:queue]", "[e2e:consume]", "[e2e:stop]", "other"] {
                    let expected = mode == "fixture" && allowed.contains(&(action, marker));
                    assert_eq!(
                        permits_control(mode, action, marker),
                        expected,
                        "{mode} {action} {marker}"
                    );
                }
            }
        }
    }
    #[test]
    fn snapshot_diagnostics_preserve_only_known_machine_errors() {
        assert_eq!(
            snapshot_error("list-conversations", "native.ai.storage.busy"),
            "snapshot-list-conversations-native-ai-storage-busy"
        );
        assert_eq!(
            snapshot_error("file-read", "private-path: secret-value"),
            "snapshot-file-read-failed"
        );
        assert_eq!(
            snapshot_error("history", "native.arbitrarySecret"),
            "snapshot-history-failed"
        );
    }
    #[test]
    fn storage_observation_waits_for_a_complete_read_after_contention() {
        let mut reads = 0;
        let value = observe_storage(std::time::Duration::from_secs(2), || {
            reads += 1;
            match reads {
                1 => Err("snapshot-list-conversations-native-ai-storage-busy".into()),
                2 => Err("snapshot-read-conversation-native-ai-storage-busy".into()),
                3 => Err("snapshot-settings-read-native-ai-storage-busy".into()),
                _ => Ok(json!({"conversations": ["complete"], "settings": {}})),
            }
        })
        .unwrap();
        assert_eq!(reads, 4);
        assert_eq!(
            value,
            json!({"conversations": ["complete"], "settings": {}})
        );
    }
    #[test]
    fn storage_observation_preserves_other_errors_and_expired_contention() {
        for (timeout, error) in [
            (
                std::time::Duration::from_secs(2),
                "snapshot-read-conversation-native-ai-storage-failed",
            ),
            (
                std::time::Duration::from_secs(2),
                "snapshot-missing-conversation-failed",
            ),
            (
                std::time::Duration::ZERO,
                "snapshot-list-conversations-native-ai-storage-busy",
            ),
        ] {
            let mut reads = 0;
            let result = observe_storage::<()>(timeout, || {
                reads += 1;
                Err(error.to_owned())
            });
            assert_eq!(reads, 1);
            assert_eq!(result, Err(error.to_owned()));
        }
    }
    #[test]
    fn observations_only_accept_bounded_counts_flags_and_known_states() {
        let mut input = json!({"hasComposer":true,"hasSend":false,"hasStop":false,"hasAlert":true,"conversationCount":2,"userMessages":1,"assistantMessages":0,"toolResults":0,"draftChars":u32::MAX,"runStates":vec!["running"; 40]});
        let observation: Observation = serde_json::from_value(input.clone()).unwrap();
        let report = serde_json::to_value(observation.bounded()).unwrap();
        assert_eq!(report["draftChars"], 100_000_000);
        assert_eq!(report["runStates"].as_array().unwrap().len(), 32);
        assert_eq!(report["conversationCount"], 2);
        input["runStates"] = json!(["arbitrary-text"]);
        assert!(serde_json::from_value::<Observation>(input.clone()).is_err());
        input["runStates"] = json!([
            "completed",
            "cancelled",
            "failed",
            "error",
            "interrupted",
            "unknown"
        ]);
        assert!(serde_json::from_value::<Observation>(input.clone()).is_ok());
        input["error"] = json!("untrusted-text");
        assert!(serde_json::from_value::<Observation>(input).is_err());
    }
    #[test]
    fn broker_is_only_an_explicit_ipv4_loopback_responses_endpoint() {
        assert!(validate_broker("http://127.0.0.1:12345/v1/responses").is_ok());
        for url in [
            "https://api.openai.com/v1/responses",
            "http://localhost:12/v1/responses",
            "http://127.0.0.1/v1/responses",
            "http://127.0.0.1:12/v1/responses?key=a",
            "http://user@127.0.0.1:12/v1/responses",
            "http://127.0.0.1:12/control",
        ] {
            assert!(validate_broker(url).is_err(), "{url}");
        }
    }
    #[test]
    fn isolated_shell_capability_does_not_advertise_an_executable() {
        let shell = disabled_shell_capability();
        assert!(!shell.available);
        assert!(shell.interpreter.is_none());
        assert!(shell.interpreter_args.is_empty());
        assert_eq!(shell.implementation, "unavailable");
    }
    fn fixture_config() -> Config {
        Config {
            workspace_root: PathBuf::from("/unused"),
            provider_base_url: "http://127.0.0.1:12345/v1/responses".into(),
            provider_token: "synthetic-broker-token".into(),
            model: "gpt-4.1-mini".into(),
            mode: "fixture".into(),
            journey: "workspace".into(),
            report_path: PathBuf::from("/unused/report.json"),
            phase: "exercise".into(),
            max_output_tokens: 256,
            timeout_ms: 30_000,
        }
    }
    #[test]
    fn restart_baseline_is_bounded_and_does_not_follow_nonfiles() {
        let temp = tempfile::tempdir().unwrap();
        let environment = Environment {
            config: Config {
                workspace_root: temp.path().to_owned(),
                ..fixture_config()
            },
            service: "synthetic".into(),
            ready: Mutex::default(),
            keys: Mutex::new(()),
        };
        let path = temp.path().join("smoke-restart.json");
        fs::write(&path, br#"{"taskIds":["retained"]}"#).unwrap();
        assert_eq!(
            read_checkpoint(&environment).unwrap(),
            json!({"taskIds":["retained"]})
        );
        for bytes in [b"invalid".to_vec(), vec![b' '; 65_537]] {
            fs::write(&path, bytes).unwrap();
            assert!(read_checkpoint(&environment).is_err());
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(read_checkpoint(&environment).is_err());
        fs::remove_dir(&path).unwrap();
        #[cfg(unix)]
        {
            let target = temp.path().join("other.json");
            fs::write(&target, "{}").unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
            assert!(read_checkpoint(&environment).is_err());
            assert_eq!(fs::read_to_string(target).unwrap(), "{}");
        }
    }
    #[test]
    fn redirect_preserves_responses_payload_except_explicit_output_budget() {
        let config = fixture_config();
        let payload = json!({"model":"gpt-4.1-mini","stream":true,"input":[{"role":"user","content":"fixture"}],"tools":[{"type":"function","name":"read","parameters":{"type":"object"}}]});
        for supplied in [None, Some(128), Some(10000)] {
            let mut request = payload.clone();
            if let Some(limit) = supplied {
                request["max_output_tokens"] = json!(limit);
            }
            let (url, body) = redirect_request(
                &config,
                "openai-responses",
                "https://api.openai.com/v1/responses",
                &request.to_string(),
            )
            .unwrap();
            assert_eq!(url, "http://127.0.0.1:12345/v1/responses");
            let mut expected = payload.clone();
            expected["max_output_tokens"] = json!(supplied.unwrap_or(256).min(256));
            assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), expected);
            assert!(!body.contains("synthetic-broker-token"));
        }
    }
    #[test]
    fn redirect_cannot_switch_provider_model_or_protocol() {
        let config = fixture_config();
        let payload = json!({"model":"gpt-4.1-mini","stream":true});
        for (api, url) in [
            ("anthropic-messages", "https://api.openai.com/v1/responses"),
            ("openai-responses", "http://127.0.0.1:12345/v1/responses"),
            (
                "openai-responses",
                "https://api.openai.com/v1/chat/completions",
            ),
        ] {
            assert!(redirect_request(&config, api, url, &payload.to_string()).is_err());
        }
        for extra in [
            json!({"model":"other","stream":true}),
            json!({"model":"gpt-4.1-mini","stream":false}),
            json!({"model":"gpt-4.1-mini","stream":true,"max_output_tokens":0}),
        ] {
            assert!(
                redirect_request(
                    &config,
                    "openai-responses",
                    "https://api.openai.com/v1/responses",
                    &extra.to_string()
                )
                .is_err()
            );
        }
    }
    #[test]
    fn owned_output_refuses_nested_paths_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        assert!(owned_file(dir.path(), &dir.path().join("report.json")).is_ok());
        assert!(owned_file(dir.path(), &dir.path().join("nested/report.json")).is_err());
        #[cfg(unix)]
        {
            let target = dir.path().join("target");
            fs::write(&target, "unchanged").unwrap();
            let link = dir.path().join("link");
            std::os::unix::fs::symlink(&target, &link).unwrap();
            assert!(write_private(&link, b"changed").is_err());
            assert_eq!(fs::read_to_string(target).unwrap(), "unchanged");
        }
    }
}
