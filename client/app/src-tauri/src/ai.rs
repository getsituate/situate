#[cfg(test)]
use crate::conversation_fixtures::FixtureConversations;
#[cfg(feature = "native-smoke")]
#[path = "../tests/support/ai_files_smoke.rs"]
pub(crate) mod file_smoke;
#[cfg(feature = "native-smoke")]
#[path = "../tests/support/plugin_checks_smoke.rs"]
pub(crate) mod plugin_checks_smoke;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use situate_core::ai_storage::{KeyStore, Storage};
use situate_core::{ConversationRecord, ConversationSummary};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, ipc::Channel};
use tokio_util::sync::CancellationToken;

#[path = "ai_conversations.rs"]
pub(crate) mod conversations;
#[path = "ai_discovery.rs"]
pub(crate) mod discovery;
#[path = "ai_login.rs"]
pub mod login;
#[path = "ai_model.rs"]
pub(crate) mod model;
#[path = "ai_native_model.rs"]
mod native_model;
#[path = "ai_storage_releases.rs"]
mod storage_releases;

const NETWORK_ERROR: &str = "native.ai.request.failed";
const REJECTED: &str = "native.ai.access.rejected";
const KEY_ERROR: &str = "native.ai.access.keyStorage";
const CATALOG: &str = include_str!("../../src/ai/catalog.generated.json");
const TRANSPORTS: &str = include_str!("../../src/ai/transport-contract.json");
const PROVIDER_POLICY: &str = include_str!("../../src/ai/provider-policy.json");

#[cfg(feature = "native-smoke")]
#[path = "../tests/support/agent_e2e_ai.rs"]
pub(crate) mod e2e;

struct OsKeys(tauri::AppHandle);
impl KeyStore for OsKeys {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        #[cfg(all(feature = "native-smoke", target_os = "macos"))]
        if crate::agent_e2e::enabled() {
            return crate::agent_e2e::keychain::get(account);
        }
        crate::provider_platform::key_get(&self.0, account)
    }
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
        #[cfg(feature = "native-smoke")]
        crate::agent_e2e::record_key(account).inspect_err(|_| {
            crate::agent_e2e::bootstrap_step("bootstrap-credential-manifest");
        })?;
        #[cfg(all(feature = "native-smoke", target_os = "macos"))]
        if crate::agent_e2e::enabled() {
            return crate::agent_e2e::keychain::set(account, key);
        }
        crate::provider_platform::key_set(&self.0, account, key)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        #[cfg(all(feature = "native-smoke", target_os = "macos"))]
        if crate::agent_e2e::enabled() {
            return crate::agent_e2e::keychain::delete(account);
        }
        crate::provider_platform::key_delete(&self.0, account)
    }
}

#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    http_acknowledgement: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth: Option<AuthKind>,
    #[serde(deserialize_with = "deserialize_provider")]
    provider: String,
    #[serde(default, rename = "model", skip_serializing_if = "Option::is_none")]
    legacy_model: Option<String>,
    endpoint: Option<String>,
}
fn deserialize_provider<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    let provider = String::deserialize(deserializer)?;
    Ok(if provider == "azure-openai-responses" {
        "azure".into()
    } else {
        provider
    })
}

#[derive(Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum AuthKind {
    ApiKey,
    Oauth,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Connection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    catalog: Option<discovery::Catalog>,
    config: Config,
    key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    oauth: Option<crate::openai_oauth::Credential>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    codex: Option<crate::codex_oauth::Credential>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    catalog: discovery::Catalog,
    config: Option<Config>,
    available: bool,
    reason: Option<String>,
    selected_model: Option<String>,
    model_error: Option<String>,
    model_preference: Option<String>,
    model_inherited: bool,
    thinking_inherited: bool,
    thinking_preference: Option<String>,
    thinking_level: Option<String>,
    inherited_thinking_level: Option<String>,
    recommended_thinking_level: Option<String>,
}
struct Active {
    id: String,
    token: CancellationToken,
    dispatched: bool,
    network_done: bool,
    persisted: bool,
    transient: bool,
    choice: Option<model::Choice>,
    comment_choice: Option<model::Choice>,
    requests: HashMap<String, RequestState>,
    sequences: HashMap<RequestKind, u64>,
    tools: HashMap<String, bool>,
    location: Option<situate_core::workspaces::Location>,
    conversation_cache: situate_core::ai_storage::ConversationCache,
    generation: u64,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum RequestKind {
    Main,
    Compaction,
    Comment,
    Title,
}
struct RequestState {
    kind: RequestKind,
    done: bool,
}
impl Active {
    fn new(id: String) -> Self {
        Self {
            id,
            token: CancellationToken::new(),
            dispatched: false,
            network_done: false,
            persisted: false,
            transient: false,
            choice: None,
            comment_choice: None,
            requests: HashMap::new(),
            sequences: HashMap::new(),
            tools: HashMap::new(),
            location: None,
            conversation_cache: Default::default(),
            generation: 0,
        }
    }
    #[cfg(test)]
    fn dispatch(&mut self) -> Result<CancellationToken, String> {
        if self.token.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        if self.dispatched {
            return Err("native.ai.turn.alreadySent".into());
        }
        self.dispatched = true;
        self.generation += 1;
        self.persisted = false;
        Ok(self.token.clone())
    }
    fn can_end(&self) -> bool {
        self.requests.values().all(|request| request.done)
            && self.tools.values().all(|done| *done)
            && if self.dispatched || !self.requests.is_empty() || !self.tools.is_empty() {
                self.transient || (self.ready_to_save() && self.persisted)
            } else {
                true
            }
    }
    fn ready_to_save(&self) -> bool {
        self.network_done
            || (!self.dispatched && (!self.requests.is_empty() || !self.tools.is_empty()))
    }
    fn acknowledge_save(&mut self) {
        if self.ready_to_save()
            && self.requests.values().all(|r| r.done)
            && self.tools.values().all(|done| *done)
        {
            self.persisted = true;
        }
    }
}
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct RunKey {
    scope: String,
    conversation: String,
    title: bool,
}
impl RunKey {
    fn new(scope: &str, conversation: &str) -> Self {
        Self {
            scope: scope.into(),
            conversation: conversation.into(),
            title: false,
        }
    }
    fn title(scope: &str, conversation: &str) -> Self {
        Self {
            title: true,
            ..Self::new(scope, conversation)
        }
    }
    fn check(scope: &str, request: &str) -> Self {
        Self::new(scope, &format!("$check:{request}"))
    }
    fn credential_mutation(scope: &str) -> Self {
        // Empty IDs cannot be admitted as conversations.
        Self::new(scope, "")
    }
}

#[derive(Default)]
pub struct Ai {
    active: Mutex<HashMap<RunKey, Active>>,
    closing: Mutex<HashSet<String>>,
    rejected: Mutex<HashSet<(String, String)>>,
    credential_epochs: Mutex<HashMap<(String, String), u64>>,
    storage_releases: Mutex<HashMap<String, std::sync::Arc<storage_releases::Releases>>>,
    logins: Mutex<HashMap<String, std::sync::Arc<login::Login>>>,
    credential_gates: Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
}

impl Ai {
    // Queue this host's preparations; the filesystem lock still arbitrates other processes.
    async fn credential_guard(
        &self,
        scope: &str,
        token: &CancellationToken,
    ) -> Result<tokio::sync::OwnedMutexGuard<()>, String> {
        let gate = self
            .credential_gates
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .entry(scope.into())
            .or_default()
            .clone();
        tokio::select! {
            biased;
            _ = token.cancelled() => Err("native.ai.response.stopped".into()),
            guard = gate.lock_owned() => Ok(guard),
        }
    }

    fn reserve(&self, key: RunKey, id: String) -> Result<CancellationToken, String> {
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        if active.contains_key(&key)
            || active.contains_key(&RunKey::credential_mutation(&key.scope))
        {
            return Err("native.ai.response.finishFirst".into());
        }
        if self
            .closing
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .contains(&key.scope)
        {
            return Err("native.ai.response.closing".into());
        }
        let run = Active::new(id);
        let token = run.token.clone();
        active.insert(key, run);
        Ok(token)
    }

    fn claim_active_tool(
        &self,
        key: &RunKey,
        run_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        arguments: &Value,
        load: impl FnOnce(
            &situate_core::workspaces::Location,
            situate_core::ai_storage::ConversationCache,
        ) -> Result<ConversationRecord, String>,
    ) -> Result<CancellationToken, String> {
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active
            .get_mut(key)
            .filter(|run| run.id == run_id)
            .ok_or("native.ai.turn.inactive")?;
        if run.token.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        let record = load(
            run.location.as_ref().ok_or("native.ai.turn.inactive")?,
            run.conversation_cache.clone(),
        )?;
        claim_tool(run, &record, tool_call_id, tool_name, arguments)
    }

    #[cfg(test)]
    fn abort(&self, key: &RunKey, id: &str) -> Result<(), String> {
        let active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active
            .get(key)
            .filter(|run| run.id == id)
            .ok_or("native.ai.turn.inactive")?;
        run.token.cancel();
        Ok(())
    }

    fn end(&self, key: &RunKey, id: &str) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active
            .get(key)
            .filter(|run| run.id == id)
            .ok_or("native.ai.turn.inactive")?;
        // Title admissions own no tool effects; title writes use the ordinary conversation queue.
        if !(key.title && run.requests.values().all(|request| request.done)) && !run.can_end() {
            return Err("native.ai.conversation.saveBeforeClose".into());
        }
        run.token.cancel();
        active.remove(key);
        Ok(())
    }

    #[cfg(test)]
    fn dispatch(
        &self,
        key: &RunKey,
        id: &str,
    ) -> Result<(CancellationToken, model::Choice), String> {
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active
            .get_mut(key)
            .filter(|run| run.id == id)
            .ok_or("native.ai.turn.required")?;
        let choice = run.choice.clone().ok_or("native.ai.model.required")?;
        Ok((run.dispatch()?, choice))
    }

    #[cfg(test)]
    fn complete_request(
        &self,
        key: &RunKey,
        id: &str,
        notify: impl FnOnce(),
    ) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active
            .get_mut(key)
            .filter(|run| run.id == id && run.dispatched && !run.network_done)
            .ok_or("native.ai.turn.inactive")?;
        notify();
        run.network_done = true;
        run.generation += 1;
        Ok(())
    }

    fn dispatch_request(
        &self,
        key: &RunKey,
        id: &str,
        request_id: &str,
        kind: RequestKind,
        sequence: u64,
    ) -> Result<(CancellationToken, model::Choice), String> {
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active
            .get_mut(key)
            .filter(|run| run.id == id)
            .ok_or("native.ai.turn.inactive")?;
        if run.token.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        if !situate_core::conversation_runtime::identity(request_id)
            || run.requests.contains_key(request_id)
            || Some(sequence)
                != run
                    .sequences
                    .get(&kind)
                    .copied()
                    .unwrap_or(0)
                    .checked_add(1)
            || (key.title != (kind == RequestKind::Title))
            || (key.title && sequence != 1)
            || (run.transient && (kind != RequestKind::Main || sequence != 1))
            || (kind != RequestKind::Comment && run.tools.values().any(|done| !*done))
            || run.requests.values().any(|r| {
                !r.done
                    && (kind == RequestKind::Comment && r.kind == kind
                        || kind != RequestKind::Comment && r.kind != RequestKind::Comment)
            })
        {
            return Err("native.ai.turn.alreadySent".into());
        }
        let choice = if kind == RequestKind::Comment {
            &run.comment_choice
        } else {
            &run.choice
        }
        .clone()
        .ok_or("native.ai.model.required")?;
        let token = run.token.child_token();
        run.requests
            .insert(request_id.into(), RequestState { kind, done: false });
        run.sequences.insert(kind, sequence);
        run.generation += 1;
        if kind != RequestKind::Comment {
            run.dispatched = true;
            run.network_done = false;
        }
        run.persisted = false;
        Ok((token, choice))
    }

    fn finish_request(&self, key: &RunKey, id: &str, request_id: &str) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active
            .get_mut(key)
            .filter(|run| run.id == id)
            .ok_or("native.ai.turn.inactive")?;
        let request = run
            .requests
            .get_mut(request_id)
            .filter(|r| !r.done)
            .ok_or("native.ai.turn.inactive")?;
        request.done = true;
        run.generation += 1;
        if request.kind != RequestKind::Comment {
            run.network_done = true;
        }
        run.persisted = false;
        Ok(())
    }

    fn finish_tool(&self, key: &RunKey, id: &str, tool_id: &str) {
        if let Ok(mut active) = self.active.lock()
            && let Some(run) = active.get_mut(key).filter(|run| run.id == id)
            && let Some(done) = run.tools.get_mut(tool_id).filter(|done| !**done)
        {
            *done = true;
            run.generation += 1;
            run.persisted = false;
        }
    }

    fn ensure_idle(&self, scope: &str) -> Result<(), String> {
        if self.has_active(scope)? {
            return Err("native.ai.response.running".into());
        }
        Ok(())
    }

    fn prepare_close(&self, scope: &str) -> Result<bool, String> {
        if !self.has_active(scope)? {
            return Ok(true);
        }
        self.closing
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .insert(scope.into());
        Ok(false)
    }

    #[cfg(test)]
    fn save_test_record(
        &self,
        storage: &Storage,
        key: &RunKey,
        record: &ConversationRecord,
        expected_revision: u64,
        turn: Option<&str>,
    ) -> Result<ConversationRecord, String> {
        if record.id != key.conversation {
            return Err("native.ai.conversation.otherTurn".into());
        }
        self.save_history(key, turn, || {
            storage.save_fixture_conversation(record, expected_revision)
        })
    }

    fn has_active(&self, scope: &str) -> Result<bool, String> {
        Ok(self
            .active
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .keys()
            .any(|key| key.scope == scope))
    }

    // The caller retains the workspace operation lease across admission, storage and acknowledgement.
    fn save_history<T>(
        &self,
        key: &RunKey,
        turn: Option<&str>,
        save: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let admitted = {
            let active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
            let run = active.get(key);
            if run.map(|run| run.id.as_str()) != turn || run.is_some_and(|run| run.transient) {
                return Err("native.ai.conversation.otherTurn".into());
            }
            run.map(|run| (run.id.clone(), run.ready_to_save(), run.generation))
        };
        let saved = save()?;
        let mut active = self.active.lock().map_err(|_| NETWORK_ERROR)?;
        let run = active.get_mut(key);
        if run.as_ref().map(|run| run.id.as_str())
            != admitted.as_ref().map(|(id, _, _)| id.as_str())
        {
            return Err("native.ai.turn.inactive".into());
        }
        // Completion during storage does not prove these bytes contain the completed response.
        if let (Some(run), Some((_, true, generation))) = (run, admitted)
            && run.generation == generation
        {
            run.acknowledge_save();
        }
        Ok(saved)
    }
}

pub(crate) struct ToolAuthorization {
    app: tauri::AppHandle,
    key: RunKey,
    run_id: String,
    tool_id: String,
    token: CancellationToken,
}
impl ToolAuthorization {
    pub(crate) fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}
impl Drop for ToolAuthorization {
    fn drop(&mut self) {
        self.app
            .state::<Ai>()
            .finish_tool(&self.key, &self.run_id, &self.tool_id);
    }
}

pub(crate) fn authorize_tool(
    app: &tauri::AppHandle,
    scope: &str,
    conversation: &str,
    run_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<ToolAuthorization, String> {
    #[cfg(feature = "native-smoke")]
    if crate::agent_e2e::enabled() && tool_name == "shell" {
        return Err("native.shell.unavailable".into());
    }
    let state = app.state::<Ai>();
    let token = state.claim_active_tool(
        &RunKey::new(scope, conversation),
        run_id,
        tool_call_id,
        tool_name,
        arguments,
        |location, cache| {
            require_conversation(
                &local_storage(app, location)?.with_conversation_cache(cache),
                conversation,
            )
        },
    )?;
    Ok(ToolAuthorization {
        app: app.clone(),
        key: RunKey::new(scope, conversation),
        run_id: run_id.into(),
        tool_id: tool_call_id.into(),
        token,
    })
}

fn claim_tool(
    run: &mut Active,
    record: &ConversationRecord,
    tool_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<CancellationToken, String> {
    if run.transient || run.token.is_cancelled() || run.tools.contains_key(tool_id) {
        return Err("native.ai.turn.inactive".into());
    }
    let runtime = record.runtime.as_ref().ok_or("native.ai.turn.required")?;
    let intent = runtime.events.iter().any(|e| {
        e.run_id == run.id
            && e.data["toolCallId"] == tool_id
            && e.kind == "tool_intent"
            && e.data["name"] == tool_name
            && &e.data["args"] == arguments
    });
    let started = runtime.events.iter().any(|e| {
        e.run_id == run.id && e.kind == "tool_execution_start" && e.data["toolCallId"] == tool_id
    });
    let ended = runtime.events.iter().any(|e| {
        e.run_id == run.id && e.kind == "tool_execution_end" && e.data["toolCallId"] == tool_id
    });
    let terminal = runtime
        .runs
        .iter()
        .any(|r| r.id == run.id && r.state != "running");
    if !intent || !started || ended || terminal {
        return Err("native.ai.turn.required".into());
    }
    run.tools.insert(tool_id.into(), false);
    run.generation += 1;
    run.persisted = false;
    Ok(run.token.child_token())
}

#[derive(Serialize)]
pub struct AttachmentData {
    reference: situate_core::attachment::AttachmentRef,
    bytes: Vec<u8>,
}

#[tauri::command]
pub async fn ai_attachment_put(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    mime_type: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<situate_core::attachment::AttachmentRef, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            local_storage(&app, location)?.put_attachment(&mime_type, &name, &bytes)
        })
    })
    .await
    .map_err(|_| NETWORK_ERROR.to_owned())?
}

#[tauri::command]
pub async fn ai_attachment_read(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    id: String,
) -> Result<AttachmentData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            let (reference, bytes) = local_storage(&app, location)?.read_attachment(&id)?;
            Ok(AttachmentData { reference, bytes })
        })
    })
    .await
    .map_err(|_| NETWORK_ERROR.to_owned())?
}

pub(crate) fn local_storage(
    app: &tauri::AppHandle,
    location: &situate_core::workspaces::Location,
) -> Result<Storage, String> {
    let access = crate::files::CoordinatedAccess::begin(app, location)?;
    let path =
        crate::files::local_root(app, location)?.ok_or("native.ai.access.providerStorage")?;
    let storage = Storage::open(&path, &location.id)?;
    if access.needs_release() {
        let releases = app.state::<Ai>().release_operations(&location.id)?;
        Ok(storage.with_access_guard(releases.guard(access)))
    } else {
        Ok(storage)
    }
}
fn storage(
    app: &tauri::AppHandle,
    location: &situate_core::workspaces::Location,
) -> Result<Storage, String> {
    let storage = unrecovered_storage(app, location)?;
    recover_storage(&storage, &OsKeys(app.clone()))?;
    Ok(storage)
}
fn unrecovered_storage(
    app: &tauri::AppHandle,
    location: &situate_core::workspaces::Location,
) -> Result<Storage, String> {
    let directory = credential_directory(app)?;
    local_storage(app, location)?.with_device_store(&directory)
}
fn recover_storage(storage: &Storage, keys: &impl KeyStore) -> Result<(), String> {
    if storage.has_pending_connection_publication()? {
        let _lock = storage.lock_credentials()?;
        if let Err(error) = storage.recover_connection_publication(keys)
            && error != "native.ai.storage.publicationConflict"
        {
            return Err(error);
        }
    }
    Ok(())
}
fn credential_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(feature = "native-smoke")]
    if crate::agent_e2e::enabled() {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|_| KEY_ERROR)?
            .join("provider-credentials");
        std::fs::create_dir_all(&path).map_err(|_| KEY_ERROR)?;
        return path.canonicalize().map_err(|_| KEY_ERROR.into());
    }
    crate::provider_platform::availability(app)?;
    crate::provider_platform::credential_dir(app)
}
#[cfg(test)]
fn workspace_storage(location: &situate_core::workspaces::Location) -> Result<Storage, String> {
    if location.kind != "path" {
        return Err("native.ai.access.providerStorage".into());
    }
    Storage::open(Path::new(&location.handle), &location.id)
}
fn load(storage: &Storage, app: &tauri::AppHandle) -> Result<Connection, String> {
    let bytes = storage
        .load(&OsKeys(app.clone()))?
        .ok_or("native.ai.access.required")?;
    decode_connection(&bytes)
}
fn load_connection_id(
    storage: &Storage,
    app: &tauri::AppHandle,
    id: Option<&str>,
) -> Result<Connection, String> {
    let bytes = match id {
        Some(id) => storage.load_connection(&OsKeys(app.clone()), id)?,
        None => storage.load(&OsKeys(app.clone()))?,
    }
    .ok_or("native.ai.access.required")?;
    decode_connection(&bytes)
}
fn load_conversation(
    storage: &Storage,
    app: &tauri::AppHandle,
    conversation: &str,
) -> Result<Connection, String> {
    let record =
        model::effective_record(storage, Some(conversation))?.ok_or("native.ai.access.required")?;
    load_connection_id(storage, app, Some(&record.id))
}
impl Ai {
    fn is_rejected(&self, scope: &str, connection: Option<&str>) -> Result<bool, String> {
        Ok(self
            .rejected
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .contains(&(scope.into(), connection.unwrap_or_default().into())))
    }
    fn release_operations(
        &self,
        scope: &str,
    ) -> Result<std::sync::Arc<storage_releases::Releases>, String> {
        Ok(self
            .storage_releases
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .entry(scope.into())
            .or_default()
            .clone())
    }
    fn releasing_storage(&self, scope: Option<&str>) -> Result<bool, String> {
        Ok(self
            .storage_releases
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .iter()
            .any(|(id, releases)| scope.is_none_or(|scope| id == scope) && releases.is_active()))
    }
    async fn settle_storage(&self, scope: Option<&str>) -> Result<(), String> {
        let releases = self
            .storage_releases
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .iter()
            .filter(|(id, _)| scope.is_none_or(|scope| id.as_str() == scope))
            .map(|(_, releases)| releases.clone())
            .collect::<Vec<_>>();
        let mut result = Ok(());
        for releases in releases {
            if releases.settle().await.is_err() {
                result = Err("native.ai.cleanup.failed".into());
            }
        }
        result
    }
    pub(crate) fn retain_failed_access(
        &self,
        scope: &str,
        access: crate::files::CoordinatedAccess,
        error: String,
    ) {
        let releases = self
            .storage_releases
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entry(scope.into())
            .or_default()
            .clone();
        releases.track_failed(access, error);
    }
    fn continuation_epoch(&self, scope: &str, connection: Option<&str>) -> Result<u64, String> {
        Ok(self
            .credential_epochs
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .get(&(scope.into(), connection.unwrap_or_default().into()))
            .copied()
            .unwrap_or(0))
    }
    fn clear_rejected(&self, scope: &str, connection: Option<&str>) -> Result<(), String> {
        let mut epochs = self.credential_epochs.lock().map_err(|_| NETWORK_ERROR)?;
        let epoch = epochs
            .entry((scope.into(), connection.unwrap_or_default().into()))
            .or_default();
        *epoch = epoch.checked_add(1).ok_or(NETWORK_ERROR)?;
        self.rejected
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .remove(&(scope.into(), connection.unwrap_or_default().into()));
        Ok(())
    }
}
fn mutate_preferences<T>(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    operation: impl FnOnce(&Storage) -> Result<T, String>,
) -> Result<T, String> {
    crate::workspaces::with_current(app, window, scope, |location| {
        let storage = storage(app, location)?;
        let _lock = storage.lock_preferences()?;
        operation(&storage)
    })
}
fn decode_connection(bytes: &[u8]) -> Result<Connection, String> {
    let connection: Connection =
        serde_json::from_slice(bytes).map_err(|_| "native.ai.access.invalidReconnect")?;
    validate_credentials(&connection)?;
    Ok(connection)
}
fn validate_credentials(connection: &Connection) -> Result<(), String> {
    let invalid = "native.ai.access.invalidReconnect";
    let secret = |value: &str, max: usize| {
        !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
    };
    match (
        connection.config.auth,
        connection.config.provider.as_str(),
        &connection.oauth,
        &connection.codex,
    ) {
        (Some(AuthKind::Oauth), "openai", Some(credential), None)
            if connection.key.is_empty()
                && connection.config.endpoint.is_none()
                && secret(&credential.access, 32 * 1024)
                && secret(&credential.refresh, 16 * 1024)
                && !credential.client_id.trim().is_empty()
                && !credential.subject.trim().is_empty()
                && credential
                    .scopes
                    .iter()
                    .any(|scope| scope == "chatgpt.tokens.use.direct") =>
        {
            Ok(())
        }
        (Some(AuthKind::Oauth), "openai-codex", None, Some(credential))
            if connection.key.is_empty()
                && connection.config.endpoint.is_none()
                && secret(&credential.access, 32 * 1024)
                && secret(&credential.refresh, 16 * 1024) =>
        {
            use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
            let parts: Vec<_> = credential.access.split('.').collect();
            if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
                return Err(invalid.into());
            }
            let claims: Value =
                serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| invalid)?)
                    .map_err(|_| invalid)?;
            let account = &credential.account_id;
            if account.is_empty()
                || account.len() > 256
                || !account
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                || claims["https://api.openai.com/auth"]["chatgpt_account_id"].as_str()
                    != Some(account.as_str())
            {
                return Err(invalid.into());
            }
            Ok(())
        }
        (None | Some(AuthKind::ApiKey), provider, None, None) if provider != "openai-codex" => {
            Ok(())
        }
        _ => Err(invalid.into()),
    }
}
fn admit_method(config: &Config) -> Result<(), String> {
    let policy: Value = serde_json::from_str(PROVIDER_POLICY).map_err(|_| NETWORK_ERROR)?;
    let provider = policy["providers"]
        .get(&config.provider)
        .ok_or("native.ai.provider.choose")?;
    let method = if config.auth == Some(AuthKind::Oauth) {
        "oauth"
    } else {
        "api_key"
    };
    if provider["methods"][method]["status"] != "implemented" {
        return Err("native.ai.provider.authenticationUnavailable".into());
    }
    Ok(())
}
fn validate_endpoint(endpoint: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| "native.ai.endpoint.requiredValid")?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || endpoint.contains(['{', '}'])
    {
        return Err("native.ai.endpoint.unsafe".into());
    }
    Ok(url)
}
fn validate_http_consent(config: &Config, endpoint: &str, new_save: bool) -> Result<(), String> {
    let url = validate_endpoint(endpoint)?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() == "http"
        && (new_save || !local)
        && config.http_acknowledgement.as_deref() != Some(url.as_str())
    {
        return Err("native.ai.endpoint.httpAcknowledgementRequired".into());
    }
    Ok(())
}
fn target(
    config: &Config,
    selected_model: &str,
) -> Result<(String, String, HashMap<String, String>), String> {
    admit_method(config)?;
    if config.auth == Some(AuthKind::Oauth)
        && !matches!(config.provider.as_str(), "openai" | "openai-codex")
    {
        return Err("native.ai.provider.authenticationUnavailable".into());
    }
    if selected_model.trim().is_empty()
        || selected_model.len() > 256
        || selected_model.chars().any(char::is_control)
    {
        return Err("native.ai.model.choose".into());
    }
    let transports: Value = serde_json::from_str(TRANSPORTS).map_err(|_| NETWORK_ERROR)?;
    let mut fixed_headers = HashMap::new();
    let (api, base) = if config.provider == "custom" {
        (
            "openai-completions".to_owned(),
            config
                .endpoint
                .clone()
                .ok_or("native.ai.endpoint.required")?,
        )
    } else {
        if config.endpoint.is_some() {
            return Err("native.ai.endpoint.builtinOverride".into());
        }
        let catalog: Value =
            serde_json::from_str(CATALOG).map_err(|_| "native.ai.catalog.unavailable")?;
        let provider = catalog["providers"]
            .as_array()
            .and_then(|providers| providers.iter().find(|p| p["id"] == config.provider))
            .ok_or("native.ai.provider.choose")?;
        let method = if config.auth == Some(AuthKind::Oauth) {
            "oauth"
        } else {
            "api_key"
        };
        if !provider["methods"]
            .as_array()
            .is_some_and(|methods| methods.iter().any(|entry| entry["id"] == method))
        {
            return Err("native.ai.provider.authenticationUnavailable".into());
        }
        let model = provider["models"]
            .as_array()
            .and_then(|models| models.iter().find(|m| m["id"] == selected_model))
            .ok_or("native.ai.model.chooseCatalog")?;
        if model.get("type").is_some_and(|kind| kind != "chat")
            || !model["input"]
                .as_array()
                .is_some_and(|inputs| inputs.iter().any(|input| input == "text"))
        {
            return Err("native.ai.model.openaiTextRequired".into());
        }
        if let Some(headers) = model["headers"].as_object() {
            for (name, value) in headers {
                let name = name.to_ascii_lowercase();
                if !transports["modelHeaders"]
                    .as_array()
                    .is_some_and(|allowed| {
                        allowed.iter().any(|header| header.as_str() == Some(&name))
                    })
                {
                    return Err("native.ai.model.headersUnsupported".into());
                }
                fixed_headers.insert(
                    name,
                    value
                        .as_str()
                        .ok_or("native.ai.model.headersInvalid")?
                        .to_owned(),
                );
            }
        }
        (
            model["api"].as_str().unwrap_or_default().into(),
            model["baseUrl"].as_str().unwrap_or_default().into(),
        )
    };
    let path = transports["apis"][&api]["suffix"]
        .as_str()
        .ok_or("native.ai.model.transportUnsupported")?;
    if config.auth == Some(AuthKind::Oauth) {
        let expected = match config.provider.as_str() {
            "openai" => ("openai-responses", "https://api.openai.com/v1"),
            "openai-codex" => ("openai-codex-responses", "https://chatgpt.com/backend-api"),
            _ => return Err("native.ai.provider.authenticationUnavailable".into()),
        };
        if (api.as_str(), base.as_str()) != expected {
            return Err("native.ai.model.openaiRequired".into());
        }
    }
    if api == "openai-codex-responses" {
        if config.provider != "openai-codex"
            || config.auth != Some(AuthKind::Oauth)
            || base != "https://chatgpt.com/backend-api"
            || path != "/codex/responses"
        {
            return Err("native.ai.model.transportUnsupported".into());
        }
        let native = transports["apis"][&api]["nativeHeaders"]
            .as_object()
            .ok_or(NETWORK_ERROR)?;
        for (name, value) in native {
            fixed_headers.insert(name.clone(), value.as_str().ok_or(NETWORK_ERROR)?.into());
        }
    }
    validate_http_consent(config, &base, false)?;
    let url = reqwest::Url::parse(&format!("{}{path}", base.trim_end_matches('/')))
        .map_err(|_| "native.ai.endpoint.invalid")?
        .to_string();
    Ok((api, url, fixed_headers))
}

pub fn ensure_idle(app: &tauri::AppHandle, scope: &str) -> Result<(), String> {
    login::ensure_idle(app, scope)?;
    if app
        .state::<conversations::Conversations>()
        .has_active(scope)?
    {
        return Err("native.ai.response.running".into());
    }
    app.state::<Ai>().ensure_idle(scope)
}
pub fn prepare_close(app: &tauri::AppHandle, scope: &str, window: &str) -> Result<bool, String> {
    crate::ai_executor::prepare_close(app, scope)?;
    app.state::<Ai>()
        .closing
        .lock()
        .map_err(|_| NETWORK_ERROR)?
        .insert(scope.into());
    if crate::plugin_host::prepare_process_close(app, scope)? {
        let _ = app.emit_to(
            window,
            "ai-close-requested",
            serde_json::json!({"scope":scope,"processes":true}),
        );
        return Ok(false);
    }
    if !login::prepare_close(app, scope, window)? {
        return Ok(false);
    }
    if !app.state::<Ai>().prepare_close(scope)?
        || app
            .state::<conversations::Conversations>()
            .has_active(scope)?
        || crate::ai_executor::has_active(app, scope)?
    {
        let _ = app.emit_to(
            window,
            "ai-close-requested",
            serde_json::json!({"scope":scope,"processes":false}),
        );
        return Ok(false);
    }
    tauri::async_runtime::block_on(async {
        app.state::<Ai>().settle_storage(Some(scope)).await?;
        crate::ai_executor::abort_all(app, scope).await
    })?;
    Ok(true)
}
pub fn cancel_close<R: tauri::Runtime>(app: &tauri::AppHandle<R>, scope: &str) {
    crate::plugin_host::resume_processes(app, scope);
    crate::ai_executor::cancel_close(app, scope);
    if let Ok(mut closing) = app.state::<Ai>().closing.lock() {
        closing.remove(scope);
    }
}
#[tauri::command]
pub async fn ai_prepare_close(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<Value, String> {
    crate::workspaces::with_process_control(&app, window.label(), &scope, || {
        app.state::<Ai>()
            .closing
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .insert(scope.clone());
        crate::ai_executor::prepare_close(&app, &scope)?;
        let processes = crate::plugin_host::prepare_process_close(&app, &scope)?;
        Ok(serde_json::json!({"processes":processes}))
    })
}
#[tauri::command]
pub async fn ai_cancel_close(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<(), String> {
    crate::workspaces::with_process_control(&app, window.label(), &scope, || {
        cancel_close(&app, &scope);
        Ok(())
    })
}
pub(crate) fn has_running_actions<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let owners = app
        .try_state::<conversations::Conversations>()
        .map(|state| state.has_any_active())
        .transpose()?
        .unwrap_or(false);
    Ok(owners || has_non_conversation_actions(app, None)?)
}
pub(crate) fn has_non_conversation_actions<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    retained: Option<&conversations::UpdateQuiescence>,
) -> Result<bool, String> {
    Ok(crate::plugin_host::has_processes(app)?
        || login::has_pending(app)?
        || crate::ai_executor::has_any_active(app)?
        || app
            .state::<Ai>()
            .active
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .iter()
            .any(|(key, run)| {
                !retained.is_some_and(|state| state.retains(key, &run.id))
                    || key.title
                    || key.conversation.is_empty()
                    || key.conversation.starts_with("$check:")
                    || run.transient
                    || run.requests.values().any(|request| !request.done)
                    || run.tools.values().any(|done| !done)
            })
        || app.state::<Ai>().releasing_storage(None)?)
}
pub fn ensure_quit(app: &tauri::AppHandle) -> Result<(), String> {
    if let Err(error) = tauri::async_runtime::block_on(app.state::<Ai>().settle_storage(None)) {
        let _ = app.emit("ai-quit-blocked", &error);
        return Err(error);
    }
    login::ensure_quit(app)?;
    if has_running_actions(app)? {
        let _ = app.emit("ai-quit-blocked", "native.ai.quit.responsesPending");
        return Err("native.ai.quit.responsesPending".into());
    }
    for scope in crate::ai_executor::scopes(app)? {
        let result = tauri::async_runtime::block_on(crate::ai_executor::abort_all(app, &scope));
        crate::ai_executor::cancel_close(app, &scope);
        result?;
    }
    Ok(())
}
pub(crate) async fn stop_for_recovery(app: &tauri::AppHandle, scope: &str) -> Result<(), String> {
    let state = app.state::<Ai>();
    state
        .closing
        .lock()
        .map_err(|_| NETWORK_ERROR)?
        .insert(scope.into());
    crate::ai_executor::prepare_close(app, scope)?;
    app.state::<conversations::Conversations>()
        .abort(Some(scope));
    {
        let active = state.active.lock().map_err(|_| NETWORK_ERROR)?;
        for (_, run) in active.iter().filter(|(key, _)| key.scope == scope) {
            run.token.cancel();
        }
    }
    let owners = app.state::<conversations::Conversations>();
    let (login, processes, owner_result, executors) = tokio::join!(
        login::stop_scope(app, scope),
        crate::plugin_host::abort_scope_for_recovery(app, scope),
        owners.wait_scope(scope),
        crate::ai_executor::abort_all(app, scope),
    );
    let storage = state.settle_storage(Some(scope)).await;
    loop {
        let report = owners.recovery_quiescence(Some(scope)).await?;
        let other_active = state
            .active
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .iter()
            .any(|(key, run)| key.scope == scope && !report.retains(key, &run.id));
        if !other_active
            && matches!(
                report.status,
                situate_agent::Quiescence::Idle | situate_agent::Quiescence::PersistenceFailed
            )
        {
            login?;
            processes?;
            owner_result?;
            executors?;
            storage?;
            return if report.status == situate_agent::Quiescence::Idle {
                Ok(())
            } else {
                Err(NETWORK_ERROR.into())
            };
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

pub fn abort_all(app: &tauri::AppHandle) {
    login::abort_all(app);
    if let Some(owners) = app.try_state::<conversations::Conversations>() {
        owners.abort(None);
    }
    if let Some(state) = app.try_state::<Ai>()
        && let Ok(active) = state.active.lock()
    {
        for run in active.values() {
            run.token.cancel();
        }
    }
}

fn mutate_connection<T>(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    operation: impl FnOnce(&Storage) -> Result<T, String>,
) -> Result<T, String> {
    with_connection_mutation(app, window, scope, |location| {
        let storage = storage(app, location)?;
        let _lock = storage.lock_credentials()?;
        operation(&storage)
    })
}
fn with_connection_mutation<T>(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    operation: impl FnOnce(&situate_core::workspaces::Location) -> Result<T, String>,
) -> Result<T, String> {
    let location = crate::workspaces::with_current(app, window, scope, |location| {
        ensure_idle(app, scope)?;
        let state = app.state::<Ai>();
        if state
            .closing
            .lock()
            .map_err(|_| NETWORK_ERROR)?
            .contains(scope)
        {
            return Err("native.ai.access.closing".into());
        }
        state.active.lock().map_err(|_| NETWORK_ERROR)?.insert(
            RunKey::credential_mutation(scope),
            Active::new(uuid::Uuid::new_v4().to_string()),
        );
        Ok(location.clone())
    })?;
    let result = operation(&location);
    app.state::<Ai>()
        .active
        .lock()
        .map_err(|_| NETWORK_ERROR)?
        .remove(&RunKey::credential_mutation(scope));
    result
}

#[path = "ai_connections.rs"]
pub mod connections;

#[tauri::command]
pub async fn ai_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    config: Config,
    key: String,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_connection(&app, window.label(), &scope, |storage| {
            model::validate_config(&config)?;
            if config.legacy_model.is_some() {
                return Err("native.ai.model.chooseAfterConnect".into());
            }
            if key.len() > 16_384
                || key.chars().any(char::is_control)
                || (config.provider != "custom" && key.trim().is_empty())
            {
                return Err("native.ai.access.keyInvalid".into());
            }
            if config.auth == Some(AuthKind::Oauth) {
                return Err("native.ai.login.required".into());
            }
            let (config, replacing) = connections::prepare_config(storage, config)?;
            let mut connection = Connection {
                catalog: None,
                config,
                key,
                oauth: None,
                codex: None,
            };
            let expected = if replacing {
                Some(
                    storage.connection_record(
                        connection
                            .config
                            .connection_id
                            .as_deref()
                            .ok_or(KEY_ERROR)?,
                    )?,
                )
            } else {
                None
            };
            let catalog = discovery::fetch_for_app(&app, &connection);
            if let Some(expected) = &expected {
                discovery::ensure_unchanged(storage, expected)?;
            }
            discovery::attach(&mut connection, catalog)?;
            connections::save(storage, &app, &connection, replacing)?;
            model::initialize(
                storage,
                &connection.config,
                &discovery::catalog(&connection),
            )?;
            app.state::<Ai>()
                .clear_rejected(&scope, connection.config.connection_id.as_deref())?;
            Ok(discovery::status(storage, &connection, false))
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
#[tauri::command]
pub async fn ai_select_model(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    model: String,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_preferences(&app, window.label(), &scope, |storage| {
            let connection = load(storage, &app)?;
            if model != "recommended" {
                discovery::catalog(&connection).admits(&model)?;
            }
            model::save(storage, &connection.config, model)?;
            let status = discovery::status(storage, &connection, false);
            app.state::<Ai>()
                .clear_rejected(&scope, connection.config.connection_id.as_deref())?;
            Ok(status)
        })
    })
    .await
    .map_err(|_| "native.ai.model.saveFailed".to_owned())?
}

#[tauri::command]
pub async fn ai_remove(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        mutate_connection(&app, window.label(), &scope, |storage| {
            let removed_id =
                connection_id.or(storage.selected_connection()?.map(|record| record.id));
            storage.remove_connection(&OsKeys(app.clone()), removed_id.as_deref())?;
            app.state::<Ai>()
                .clear_rejected(&scope, removed_id.as_deref())?;
            Ok(())
        })
    })
    .await
    .map_err(|_| KEY_ERROR.to_owned())?
}
fn require_conversation(
    storage: &Storage,
    conversation: &str,
) -> Result<ConversationRecord, String> {
    storage
        .read_conversation(conversation)?
        .ok_or_else(|| "native.ai.conversation.readFailed".into())
}

#[tauri::command]
pub async fn ai_conversations(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<Vec<ConversationSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            local_storage(&app, location)?.list_conversations()
        })
    })
    .await
    .map_err(|_| "native.ai.conversation.storageUnavailable".to_owned())?
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadConversation {
    scope: String,
    conversation: String,
}

fn read_conversation_request(body: &tauri::ipc::InvokeBody) -> Result<ReadConversation, String> {
    let parsed = match body {
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone()),
        tauri::ipc::InvokeBody::Raw(bytes) => serde_json::from_slice(bytes),
    };
    parsed.map_err(|_| "native.ai.conversation.versionInvalid".into())
}

#[tauri::command]
pub async fn ai_conversation_read(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<ConversationRecord, String> {
    let ReadConversation {
        scope,
        conversation,
    } = read_conversation_request(request.body())?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            require_conversation(&local_storage(&app, location)?, &conversation)
        })
    })
    .await
    .map_err(|_| "native.ai.conversation.storageUnavailable".to_owned())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InitialConversation {
    draft: String,
    #[serde(default)]
    attachments: Vec<situate_core::attachment::AttachmentRef>,
    #[serde(default)]
    references: Vec<situate_core::conversation_runtime::ContentReference>,
    development: Option<situate_core::conversation_store::Development>,
}

#[tauri::command]
pub async fn ai_create_conversation(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    id: String,
    title: String,
    initial: Option<InitialConversation>,
) -> Result<ConversationRecord, String> {
    let authorization =
        crate::workspaces::storage_authorization_session(&app, window.label(), &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_retained_session(&app, window.label(), &authorization, |location| {
            let storage = local_storage(&app, location)?;
            match initial {
                Some(initial) => storage.create_conversation_with_draft(
                    &id,
                    &title,
                    initial.draft,
                    situate_core::conversation_runtime::Runtime {
                        draft_attachments: initial.attachments,
                        draft_references: initial.references,
                        ..Default::default()
                    },
                    initial.development,
                ),
                None => storage.create_conversation(&id, &title),
            }
        })
    })
    .await
    .map_err(|_| "native.ai.conversation.storageUnavailable".to_owned())?
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Frame {
    Headers { status: u16 },
    Data { bytes: Vec<u8> },
    Done,
}

fn validate_headers(api: &str, headers: &HashMap<String, String>) -> Result<(), String> {
    let transports: Value = serde_json::from_str(TRANSPORTS).map_err(|_| NETWORK_ERROR)?;
    for (name, value) in headers {
        let allowed = transports["apis"][api]["headers"][name]
            .as_array()
            .ok_or("native.ai.protocol.headerForbidden")?;
        if value.split(',').any(|part| {
            !allowed
                .iter()
                .any(|entry| entry.as_str() == Some(part.trim()))
        }) {
            return Err("native.ai.protocol.headerValueUnsupported".into());
        }
    }
    Ok(())
}
struct CredentialSnapshot {
    manifest: situate_core::ai_storage::connections::Manifest,
    record: situate_core::ai_storage::connections::Record,
}
fn credential_snapshot(
    storage: &Storage,
    connection: &Connection,
    keys: &impl KeyStore,
) -> Result<Option<CredentialSnapshot>, String> {
    let manifest = storage.connection_manifest()?;
    #[cfg(test)]
    if manifest.is_none() {
        return Ok(None);
    }
    if storage.has_pending_connection_publication()? {
        return Err("native.ai.storage.publicationPending".into());
    }
    let manifest = manifest.ok_or(KEY_ERROR)?;
    let id = connection
        .config
        .connection_id
        .as_deref()
        .ok_or(KEY_ERROR)?;
    let record = manifest
        .connections
        .iter()
        .find(|record| record.id == id)
        .cloned()
        .ok_or(KEY_ERROR)?;
    if record.config != serde_json::to_value(&connection.config).map_err(|_| KEY_ERROR)? {
        return Err("native.ai.access.changedDuringTurn".into());
    }
    let bytes = storage
        .load_captured_connection(keys, &manifest, &record)?
        .ok_or("native.ai.access.required")?;
    let authenticated = decode_connection(&bytes)?;
    if serde_json::to_value(&authenticated).map_err(|_| KEY_ERROR)?
        != serde_json::to_value(connection).map_err(|_| KEY_ERROR)?
    {
        return Err("native.ai.access.changedDuringTurn".into());
    }
    Ok(Some(CredentialSnapshot { manifest, record }))
}
async fn prepare_refresh<K: KeyStore + Send + 'static>(
    storage: Storage,
    connection: Connection,
    keys: K,
) -> Result<(Storage, Connection, K, Option<CredentialSnapshot>), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = credential_snapshot(&storage, &connection, &keys)?;
        Ok((storage, connection, keys, snapshot))
    })
    .await
    .map_err(|_| KEY_ERROR)?
}
fn save_rotated_credentials(
    storage: &Storage,
    keys: &impl KeyStore,
    expected: Option<CredentialSnapshot>,
    bytes: &[u8],
) -> Result<(), String> {
    #[cfg(test)]
    if expected.is_none() {
        return storage.save(keys, bytes);
    }
    let expected = expected.ok_or(KEY_ERROR)?;
    storage.refresh_connection(keys, &expected.manifest, &expected.record, bytes)
}
async fn refresh_connection<K, F, Fut>(
    storage: Storage,
    mut connection: Connection,
    token: CancellationToken,
    keys: K,
    refresh: F,
) -> Result<Connection, String>
where
    K: KeyStore + Send + 'static,
    F: FnOnce(crate::openai_oauth::Credential, CancellationToken) -> Fut,
    Fut: std::future::Future<Output = Result<crate::openai_oauth::Credential, String>>,
{
    if let Some(old) = connection.oauth.clone() {
        if old.expired() {
            if token.is_cancelled() {
                return Err("native.ai.response.stopped".into());
            }
            let (storage, authenticated, keys, expected) =
                prepare_refresh(storage, connection, keys).await?;
            connection = authenticated;
            if token.is_cancelled() {
                return Err("native.ai.response.stopped".into());
            }
            // Once sent, refresh may rotate the token. Stop must not discard its response.
            let credential = refresh(old.clone(), CancellationToken::new()).await?;
            connection.oauth = Some(credential);
            let bytes = serde_json::to_vec(&connection).map_err(|_| KEY_ERROR)?;
            // A successful refresh may rotate the refresh token even if the chat was stopped.
            tauri::async_runtime::spawn_blocking(move || {
                save_rotated_credentials(&storage, &keys, expected, &bytes)
            })
            .await
            .map_err(|_| KEY_ERROR)??;
        }
        connection.key = connection.oauth.as_ref().ok_or(REJECTED)?.access.clone();
    }
    Ok(connection)
}

#[cfg(test)]
async fn refresh_codex_connection<K, F, Fut>(
    storage: Storage,
    mut connection: Connection,
    token: CancellationToken,
    keys: K,
    refresh: F,
) -> Result<Connection, String>
where
    K: KeyStore + Send + 'static,
    F: FnOnce(crate::codex_oauth::Credential, CancellationToken) -> Fut,
    Fut: std::future::Future<Output = Result<crate::codex_oauth::Credential, String>>,
{
    validate_credentials(&connection)?;
    let old = connection.codex.clone().ok_or(REJECTED)?;
    if old.expired() {
        if token.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        let (storage, authenticated, keys, expected) =
            prepare_refresh(storage, connection, keys).await?;
        connection = authenticated;
        if token.is_cancelled() {
            return Err("native.ai.response.stopped".into());
        }
        // The caller retains both credential locks until this save finishes, including on Stop.
        let credential = refresh(old.clone(), CancellationToken::new()).await?;
        if credential.account_id != old.account_id {
            return Err(REJECTED.into());
        }
        connection.codex = Some(credential);
        validate_credentials(&connection)?;
        let bytes = serde_json::to_vec(&connection).map_err(|_| KEY_ERROR)?;
        tauri::async_runtime::spawn_blocking(move || {
            save_rotated_credentials(&storage, &keys, expected, &bytes)
        })
        .await
        .map_err(|_| KEY_ERROR)??;
    }
    Ok(connection)
}

fn is_local_network(endpoint: &str) -> Result<bool, String> {
    let url = validate_endpoint(endpoint)?;
    let host = url.host_str().ok_or("native.ai.endpoint.requiredValid")?;
    if host == "localhost" {
        return Ok(false);
    }
    if host.ends_with(".local") {
        return Ok(true);
    }
    let address = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>();
    Ok(match address {
        Ok(std::net::IpAddr::V4(ip)) => {
            !ip.is_loopback() && (ip.is_private() || ip.is_link_local())
        }
        Ok(std::net::IpAddr::V6(ip)) => {
            !ip.is_loopback() && (ip.is_unique_local() || ip.is_unicast_link_local())
        }
        Err(_) => false,
    })
}
async fn request_local_network_permission(
    app: &tauri::AppHandle,
    config: &Config,
) -> Result<(), String> {
    if config.provider == "custom" {
        let endpoint = config
            .endpoint
            .as_deref()
            .ok_or("native.ai.endpoint.required")?;
        validate_http_consent(config, endpoint, false)?;
        if is_local_network(endpoint)? {
            crate::provider_platform::request_local_network_permission(app).await?;
        }
    }
    Ok(())
}
// Match Pi's HTTP idle timeout and Undici's connection deadline, not a total stream deadline.
fn model_client() -> Result<reqwest::Client, String> {
    let transports: Value = serde_json::from_str(TRANSPORTS).map_err(|_| NETWORK_ERROR)?;
    reqwest::Client::builder()
        .user_agent(transports["userAgent"].as_str().ok_or(NETWORK_ERROR)?)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| NETWORK_ERROR.into())
}

type ModelRequest = (Connection, String, String, String, HashMap<String, String>);

async fn send(
    (connection, api, url, body, headers): ModelRequest,
    token: CancellationToken,
    mut on_frame: impl FnMut(Frame) -> Result<(), String> + Send,
    diagnostic: Option<&crate::diagnostics::Operation>,
) -> Result<(), String> {
    if token.is_cancelled() {
        return Err("native.ai.response.stopped".into());
    }
    let client = model_client()?;
    let mut stage = "request_headers";
    let mut size = 0_u64;
    let mut status_code = None;
    let mut last_activity = Instant::now();
    let operation = async {
        let mut request = client
            .post(url)
            .header("content-type", "application/json")
            .body(body);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        if api == "openai-codex-responses" {
            validate_credentials(&connection)?;
            let credential = connection.codex.as_ref().ok_or(REJECTED)?;
            request = request
                .bearer_auth(&credential.access)
                .header("chatgpt-account-id", &credential.account_id)
                .header("accept", "text/event-stream");
        } else if api == "anthropic-messages" {
            request = request
                .header("anthropic-version", "2023-06-01")
                .header("x-api-key", &connection.key);
        } else if !connection.key.is_empty() {
            request = request.bearer_auth(&connection.key);
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() && error.is_connect() {
                "native.ai.request.connectTimeout"
            } else if error.is_timeout() {
                "native.ai.request.responseTimeout"
            } else {
                "native.ai.request.connectionFailed"
            }
        })?;
        let status = response.status();
        status_code = Some(status.as_u16());
        last_activity = Instant::now();
        if matches!(status.as_u16(), 401 | 403) {
            return Err(REJECTED.into());
        }
        if !status.is_success() {
            return Err("native.ai.request.rejected".into());
        }
        stage = "response_body";
        if let Some(diagnostic) = diagnostic {
            diagnostic.model_response(stage, None, status_code, size, 0.0);
        }
        on_frame(Frame::Headers {
            status: status.as_u16(),
        })?;
        let mut stream = response.bytes_stream();
        while let Some(bytes) = stream.next().await {
            let bytes = bytes.map_err(|error| {
                if error.is_timeout() {
                    "native.ai.response.idleTimeout"
                } else {
                    "native.ai.response.interrupted"
                }
            })?;
            size += bytes.len() as u64;
            last_activity = Instant::now();
            if size > 33_554_432 {
                return Err("native.ai.response.tooLarge".into());
            }
            on_frame(Frame::Data {
                bytes: bytes.to_vec(),
            })?;
        }
        on_frame(Frame::Done)?;
        Ok(())
    };
    let result: Result<(), String> = tokio::select! { biased; _ = token.cancelled() => Err("native.ai.response.stopped".into()), result = operation => result };
    if let Some(diagnostic) = diagnostic {
        diagnostic.model_response(
            stage,
            result.as_ref().err().map(|error| model_error_code(error)),
            status_code,
            size,
            last_activity.elapsed().as_secs_f64() * 1000.0,
        );
    }
    result
}

pub(crate) fn model_error_code(error: &str) -> &'static str {
    match error {
        "native.ai.request.connectTimeout"
        | "native.ai.request.responseTimeout"
        | "native.ai.response.idleTimeout" => "timeout",
        "native.ai.request.rejected" => "http_status",
        "native.ai.access.rejected" => "permission_denied",
        "native.ai.response.tooLarge" => "response_too_large",
        "native.ai.response.stopped" | "native.ai.response.stoppedBilling" => "cancelled",
        _ => "transport",
    }
}

#[cfg(test)]
#[path = "ai_codex_tests.rs"]
mod codex_tests;

#[cfg(test)]
#[path = "ai_transport_tests.rs"]
mod transport_tests;

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) struct UpdateActivity<R: tauri::Runtime> {
        app: tauri::AppHandle<R>,
        key: RunKey,
    }
    impl<R: tauri::Runtime> Drop for UpdateActivity<R> {
        fn drop(&mut self) {
            self.app
                .state::<Ai>()
                .end(&self.key, "update-activity")
                .unwrap();
        }
    }
    pub(crate) fn retain_update_activity<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
        scope: &str,
    ) -> UpdateActivity<R> {
        let key = RunKey::credential_mutation(scope);
        app.state::<Ai>()
            .reserve(key.clone(), "update-activity".into())
            .unwrap();
        UpdateActivity {
            app: app.clone(),
            key,
        }
    }

    fn update_activity_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Ai::default());
        app.manage(crate::plugin_host::Hosts::default());
        app.manage(crate::ai_executor::Executors::default());
        app
    }

    #[test]
    fn retained_failed_run_leases_are_not_pending_update_io_or_released_owners() {
        for terminal in [false, true] {
            let app = update_activity_app();
            let state = app.state::<Ai>();
            let key = RunKey::new("workspace", "chat");
            state.reserve(key.clone(), "run".into()).unwrap();
            if terminal {
                let mut active = state.active.lock().unwrap();
                let run = active.get_mut(&key).unwrap();
                run.dispatched = true;
                run.network_done = true;
                run.requests.insert(
                    "main".into(),
                    RequestState {
                        kind: RequestKind::Main,
                        done: true,
                    },
                );
                run.tools.insert("write".into(), true);
            }
            let mut retained = conversations::UpdateQuiescence::default();
            retained.retain_failure(key.clone(), "run".into());
            assert!(has_running_actions(app.handle()).unwrap());
            assert!(!has_non_conversation_actions(app.handle(), Some(&retained)).unwrap());
            assert_eq!(
                retained.status,
                situate_agent::Quiescence::PersistenceFailed
            );
            assert!(has_running_actions(app.handle()).unwrap());
            let active = state.active.lock().unwrap();
            assert_eq!(active.len(), 1);
            assert!(!active[&key].persisted);
        }
    }

    #[test]
    fn failed_owner_exclusion_preserves_real_work_and_requires_the_exact_run() {
        let app = update_activity_app();
        let state = app.state::<Ai>();
        let key = RunKey::new("workspace", "chat");
        state.reserve(key.clone(), "run".into()).unwrap();
        let mut retained = conversations::UpdateQuiescence::default();
        retained.retain_failure(key.clone(), "old-run".into());
        assert!(has_non_conversation_actions(app.handle(), Some(&retained)).unwrap());
        retained.retain_failure(key.clone(), "run".into());
        state
            .active
            .lock()
            .unwrap()
            .get_mut(&key)
            .unwrap()
            .requests
            .insert(
                "main".into(),
                RequestState {
                    kind: RequestKind::Main,
                    done: false,
                },
            );
        assert!(has_non_conversation_actions(app.handle(), Some(&retained)).unwrap());
        {
            let mut active = state.active.lock().unwrap();
            let run = active.get_mut(&key).unwrap();
            run.requests.get_mut("main").unwrap().done = true;
            run.tools.insert("write".into(), false);
        }
        assert!(has_non_conversation_actions(app.handle(), Some(&retained)).unwrap());
        state
            .active
            .lock()
            .unwrap()
            .get_mut(&key)
            .unwrap()
            .tools
            .insert("write".into(), true);
        assert!(!has_non_conversation_actions(app.handle(), Some(&retained)).unwrap());
        state
            .reserve(RunKey::new("workspace", "other"), "other-run".into())
            .unwrap();
        assert!(has_non_conversation_actions(app.handle(), Some(&retained)).unwrap());
        for key in [
            RunKey::credential_mutation("workspace"),
            RunKey::title("workspace", "chat"),
            RunKey::check("workspace", "check"),
        ] {
            state.active.lock().unwrap().clear();
            state.reserve(key.clone(), "run".into()).unwrap();
            retained.retain_failure(key, "run".into());
            assert!(has_non_conversation_actions(app.handle(), Some(&retained)).unwrap());
        }
    }

    #[test]
    fn initial_conversation_accepts_draft_fields_but_no_execution_state() {
        use serde_json::json;
        let initial: InitialConversation = serde_json::from_value(json!({
            "draft": "Question", "attachments": [], "references": []
        }))
        .unwrap();
        assert_eq!(initial.draft, "Question");
        assert!(initial.attachments.is_empty());
        assert!(initial.references.is_empty());
        assert!(serde_json::from_value::<InitialConversation>(json!({"draft":"Question"})).is_ok());
        for invalid in [
            json!({"draft":1}),
            json!({"draft":"Question","attachments":"unstructured"}),
            json!({"draft":"Question","references":null}),
            json!({"draft":"Question","runtime":{}}),
            json!({"draft":"Question","messages":[]}),
            json!({"draft":"Question","pending":[]}),
            json!({"draft":"Question","runs":[]}),
            json!({"draft":"Question","events":[]}),
            json!({"draft":"Question","checkpoint":null}),
        ] {
            assert!(serde_json::from_value::<InitialConversation>(invalid).is_err());
        }
    }

    #[test]
    fn canonical_conversation_reads_reject_all_write_arguments() {
        use tauri::ipc::InvokeBody;
        let body = serde_json::json!({"scope":"workspace","conversation":"chat"});
        for body in [
            InvokeBody::Json(body.clone()),
            InvokeBody::Raw(serde_json::to_vec(&body).unwrap()),
        ] {
            let request = read_conversation_request(&body).unwrap();
            assert_eq!(request.scope, "workspace");
            assert_eq!(request.conversation, "chat");
        }
        for key in [
            "record",
            "messages",
            "draft",
            "runtime",
            "revision",
            "unexpected",
        ] {
            let mut body = serde_json::json!({"scope":"workspace","conversation":"chat"});
            body[key] = serde_json::json!({});
            assert!(read_conversation_request(&InvokeBody::Json(body.clone())).is_err());
            assert!(
                read_conversation_request(&InvokeBody::Raw(serde_json::to_vec(&body).unwrap()))
                    .is_err()
            );
        }
    }

    #[test]
    fn workspace_drafts_do_not_require_credential_platform_support() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join(".situate")).unwrap();
        let mut location = situate_core::workspaces::Location {
            id: "offline-workspace".into(),
            name: "Offline workspace".into(),
            display: "Offline workspace".into(),
            kind: "path".into(),
            handle: directory
                .path()
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        };
        let store = workspace_storage(&location).unwrap();
        let mut record = store
            .create_conversation("conversation", "Offline conversation")
            .unwrap();
        record.draft = "Keep this draft".into();
        let saved = store
            .save_fixture_conversation(&record, record.revision)
            .unwrap();
        drop(store);
        let reopened = workspace_storage(&location)
            .unwrap()
            .read_conversation("conversation")
            .unwrap()
            .unwrap();
        assert_eq!(reopened.draft, "Keep this draft");
        assert_eq!(reopened.revision, saved.revision);
        location.kind = "provider".into();
        assert!(
            matches!(workspace_storage(&location), Err(error) if error == "native.ai.access.providerStorage")
        );
    }

    fn local_server(response: String) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        );
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = [0; 8192];
            let count = socket.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).into_owned();
            socket.write_all(response.as_bytes()).unwrap();
            request
        });
        (url, handle)
    }
    pub(super) fn connection() -> Connection {
        Connection {
            catalog: None,
            config: Config {
                connection_id: None,
                label: None,
                http_acknowledgement: None,
                auth: None,
                provider: "custom".into(),
                legacy_model: Some("test".into()),
                endpoint: Some("http://localhost/v1".into()),
            },
            key: "test-secret-never-display".into(),
            oauth: None,
            codex: None,
        }
    }
    #[derive(Clone, Default)]
    struct TestKeys {
        values: std::sync::Arc<Mutex<HashMap<String, Vec<u8>>>>,
        fail: std::sync::Arc<std::sync::atomic::AtomicBool>,
    }
    impl KeyStore for TestKeys {
        fn get(&self, account: &str) -> Result<Vec<u8>, String> {
            self.values
                .lock()
                .unwrap()
                .get(account)
                .cloned()
                .ok_or(KEY_ERROR.into())
        }
        fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
            if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(KEY_ERROR.into());
            }
            self.values
                .lock()
                .unwrap()
                .insert(account.into(), key.into());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), String> {
            self.values.lock().unwrap().remove(account);
            Ok(())
        }
    }
    fn browser_connection(expires: u64) -> Connection {
        Connection {
            catalog: None,
            config: Config {
                connection_id: None,
                label: None,
                http_acknowledgement: None,
                auth: Some(AuthKind::Oauth),
                provider: "openai".into(),
                legacy_model: Some("gpt-5.4".into()),
                endpoint: None,
            },
            key: String::new(),
            codex: None,
            oauth: Some(crate::openai_oauth::Credential {
                access: "synthetic-access".into(),
                refresh: "synthetic-refresh".into(),
                expires,
                client_id: "issued-client".into(),
                subject: "synthetic-subject".into(),
                scopes: vec!["chatgpt.tokens.use.direct".into()],
            }),
        }
    }
    #[tokio::test]
    async fn same_workspace_preparations_wait_for_rotated_credentials_while_other_scopes_proceed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let other_directory = tempfile::tempdir().unwrap();
        let other_path = other_directory.path().canonicalize().unwrap();
        std::fs::create_dir(other_path.join(".situate")).unwrap();
        let keys = TestKeys::default();
        Storage::open(&path, "one")
            .unwrap()
            .save(&keys, &serde_json::to_vec(&browser_connection(0)).unwrap())
            .unwrap();
        let state = Ai::default();
        let first_token = CancellationToken::new();
        let second_token = CancellationToken::new();
        let (release, response) = tokio::sync::oneshot::channel();
        let (entered, dispatched) = tokio::sync::oneshot::channel();
        let mut first = Box::pin(async {
            let _gate = state.credential_guard("one", &first_token).await?;
            let storage = Storage::open(&path, "one")?;
            let _lock = storage.lock_credentials()?;
            let connection = serde_json::from_slice(&storage.load(&keys)?.unwrap()).unwrap();
            refresh_connection(
                storage,
                connection,
                first_token.clone(),
                keys.clone(),
                |mut old, _| async move {
                    entered.send(()).unwrap();
                    response.await.unwrap();
                    old.access = "rotated-access".into();
                    old.refresh = "rotated-refresh".into();
                    old.expires = crate::openai_oauth::now() + 600_000;
                    Ok(old)
                },
            )
            .await
        });
        tokio::select! {
            result = &mut first => panic!("Refresh completed before its response: {}", result.is_ok()),
            ready = dispatched => ready.unwrap(),
        }
        let mut second = Box::pin(async {
            let _gate = state.credential_guard("one", &second_token).await?;
            let storage = Storage::open(&path, "one")?;
            let _lock = storage.lock_credentials()?;
            let connection: Connection =
                serde_json::from_slice(&storage.load(&keys)?.unwrap()).unwrap();
            assert_eq!(
                connection.oauth.as_ref().unwrap().refresh,
                "rotated-refresh"
            );
            refresh_connection(storage, connection, second_token.clone(), keys.clone(), |_, _| async {
                panic!("Queued preparation must reload the persisted credential without rotating again")
            }).await
        });
        assert!(futures_util::poll!(&mut second).is_pending());
        let other_token = CancellationToken::new();
        let _other_gate = tokio::time::timeout(
            Duration::from_secs(1),
            state.credential_guard("two", &other_token),
        )
        .await
        .unwrap()
        .unwrap();
        let other = Storage::open(&other_path, "two").unwrap();
        let _other_lock = other.lock_credentials().unwrap();
        other.save(&keys, b"independent").unwrap();
        assert_eq!(&**other.load(&keys).unwrap().unwrap(), b"independent");
        first_token.cancel();
        assert!(futures_util::poll!(&mut first).is_pending());
        assert!(futures_util::poll!(&mut second).is_pending());
        release.send(()).unwrap();
        assert_eq!(first.await.unwrap().key, "rotated-access");
        assert_eq!(second.await.unwrap().key, "rotated-access");
        let uncoordinated = Storage::open(&path, "one").unwrap();
        let _external_lock = uncoordinated.lock_credentials().unwrap();
        let _gate = state.credential_guard("one", &second_token).await.unwrap();
        assert_eq!(
            Storage::open(&path, "one")
                .unwrap()
                .lock_credentials()
                .unwrap_err(),
            "native.ai.storage.busy"
        );
    }

    #[tokio::test]
    async fn stopping_a_queued_request_completes_without_waiting_for_the_credential_owner() {
        let state = Ai::default();
        let first_key = RunKey::new("workspace", "first");
        let second_key = RunKey::new("workspace", "second");
        admit(&state, &first_key, "one", "model-one");
        admit(&state, &second_key, "two", "model-two");
        let (first_token, _) = state.dispatch(&first_key, "one").unwrap();
        let (second_token, _) = state.dispatch(&second_key, "two").unwrap();
        let owner = state
            .credential_guard("workspace", &first_token)
            .await
            .unwrap();
        let mut waiting = Box::pin(async {
            let result = state
                .credential_guard("workspace", &second_token)
                .await
                .map(drop);
            state.complete_request(&second_key, "two", || {}).unwrap();
            result
        });
        assert!(futures_util::poll!(&mut waiting).is_pending());
        state.abort(&second_key, "two").unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), waiting)
                .await
                .unwrap()
                .unwrap_err(),
            "native.ai.response.stopped"
        );
        assert!(!first_token.is_cancelled());
        assert!(state.end(&second_key, "two").is_err());
        state
            .save_history(&second_key, Some("two"), || Ok(()))
            .unwrap();
        state.end(&second_key, "two").unwrap();
        assert!(state.ensure_idle("workspace").is_err());
        assert!(!state.active.lock().unwrap()[&first_key].network_done);
        drop(owner);
        assert_eq!(
            state
                .credential_guard("workspace", &second_token)
                .await
                .unwrap_err(),
            "native.ai.response.stopped"
        );
        assert!(
            state
                .credential_guard("workspace", &first_token)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn refresh_is_persisted_before_access_is_returned_and_fresh_credentials_do_not_refresh() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let keys = TestKeys::default();
        let stored = Storage::open(&path, "one").unwrap();
        stored
            .save(&keys, &serde_json::to_vec(&browser_connection(0)).unwrap())
            .unwrap();
        let lock = stored.lock_credentials().unwrap();
        assert!(
            Storage::open(&path, "one")
                .unwrap()
                .lock_credentials()
                .is_err()
        );
        let connection = refresh_connection(
            stored,
            browser_connection(0),
            CancellationToken::new(),
            keys.clone(),
            |mut old, _| async move {
                assert_eq!(old.refresh, "synthetic-refresh");
                old.access = "rotated-access".into();
                old.refresh = "rotated-refresh".into();
                old.expires = crate::openai_oauth::now() + 600_000;
                Ok(old)
            },
        )
        .await
        .unwrap();
        assert_eq!(connection.key, "rotated-access");
        drop(lock);
        let reopened = Storage::open(&path, "one").unwrap();
        let _lock = reopened.lock_credentials().unwrap();
        let data = reopened.load(&keys).unwrap().unwrap();
        let connection: Connection = serde_json::from_slice(&data).unwrap();
        assert!(connection.key.is_empty());
        assert_eq!(
            connection.oauth.as_ref().unwrap().refresh,
            "rotated-refresh"
        );
        let fresh = refresh_connection(
            reopened,
            connection,
            CancellationToken::new(),
            keys,
            |_, _| async { panic!("fresh token must not refresh") },
        )
        .await
        .unwrap();
        assert_eq!(fresh.key, "rotated-access");
    }
    #[tokio::test]
    async fn stop_during_rotating_refresh_waits_for_persistence_and_sends_no_chat() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let keys = TestKeys::default();
        storage
            .save(&keys, &serde_json::to_vec(&browser_connection(0)).unwrap())
            .unwrap();
        let _lock = storage.lock_credentials().unwrap();
        let stop = CancellationToken::new();
        let (release, response) = tokio::sync::oneshot::channel();
        let (entered, dispatched) = tokio::sync::oneshot::channel();
        let mut refreshing = Box::pin(refresh_connection(
            storage,
            browser_connection(0),
            stop.clone(),
            keys.clone(),
            |mut old, refresh_cancel| async move {
                entered.send(()).unwrap();
                response.await.unwrap();
                assert!(!refresh_cancel.is_cancelled());
                old.refresh = "rotated-after-stop".into();
                old.access = "access-after-stop".into();
                old.expires = crate::openai_oauth::now() + 600_000;
                Ok(old)
            },
        ));
        tokio::select! {
            result = &mut refreshing => panic!("Refresh completed before its response: {}", result.is_ok()),
            ready = dispatched => ready.unwrap(),
        }
        stop.cancel();
        assert!(futures_util::poll!(&mut refreshing).is_pending());
        release.send(()).unwrap();
        let connection = refreshing.await.unwrap();
        let data = Storage::open(&path, "one")
            .unwrap()
            .load(&keys)
            .unwrap()
            .unwrap();
        let saved: Connection = serde_json::from_slice(&data).unwrap();
        assert_eq!(saved.oauth.unwrap().refresh, "rotated-after-stop");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let channel = Channel::new(|_| panic!("stopped chat emitted data"));
        let url = format!("http://{}/v1/responses", listener.local_addr().unwrap());
        assert!(
            send(
                (
                    connection,
                    "openai-responses".into(),
                    url,
                    "{}".into(),
                    HashMap::new()
                ),
                stop,
                |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
                None,
            )
            .await
            .is_err()
        );
        assert!(listener.accept().is_err());
    }
    #[tokio::test]
    async fn stop_before_refresh_dispatch_does_not_consume_a_refresh_token() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let stop = CancellationToken::new();
        stop.cancel();
        let result = refresh_connection(
            Storage::open(&path, "one").unwrap(),
            browser_connection(0),
            stop,
            TestKeys::default(),
            |_, _| async { panic!("cancelled refresh must not dispatch") },
        )
        .await;
        assert!(result.is_err());
    }
    #[tokio::test]
    async fn refresh_storage_failure_returns_no_access_and_preserves_previous_encrypted_connection()
    {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let keys = TestKeys::default();
        storage
            .save(&keys, &serde_json::to_vec(&browser_connection(0)).unwrap())
            .unwrap();
        keys.fail.store(true, std::sync::atomic::Ordering::SeqCst);
        let error = refresh_connection(
            storage,
            browser_connection(0),
            CancellationToken::new(),
            keys.clone(),
            |mut old, _| async move {
                old.refresh = "rotated".into();
                Ok(old)
            },
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error, KEY_ERROR);
        let data = Storage::open(&path, "one")
            .unwrap()
            .load(&keys)
            .unwrap()
            .unwrap();
        let retained: Connection = serde_json::from_slice(&data).unwrap();
        assert_eq!(retained.oauth.unwrap().refresh, "synthetic-refresh");
    }
    #[test]
    fn old_api_key_envelopes_keep_the_default_and_oauth_routes_use_the_direct_openai_api() {
        let old: Connection = serde_json::from_str(r#"{"config":{"provider":"openai","model":"gpt-4o-mini","endpoint":null},"key":"synthetic-key"}"#).unwrap();
        assert!(old.config.auth.is_none());
        assert!(old.oauth.is_none());
        assert_eq!(
            target(&old.config, "gpt-4o-mini").unwrap().1,
            "https://api.openai.com/v1/responses"
        );
        let mut connection = browser_connection(0);
        assert_eq!(
            target(&connection.config, "gpt-5.4").unwrap().1,
            "https://api.openai.com/v1/responses"
        );
        connection.config.provider = "openai-codex".into();
        assert!(target(&connection.config, "gpt-5.4").is_err());
    }
    #[test]
    fn native_record_keeps_exact_priced_tool_usage_without_provider_attribution() {
        let cost = 1.0_f64 / 1_000_000.0 * 1.25;
        let usage = serde_json::json!({"input":1,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":1,"cost":{"input":cost,"output":0,"cacheRead":0,"cacheWrite":0,"total":cost}});
        let expected = serde_json::json!({
            "version":2,"id":"conversation","title":"Work","revision":0,"draft":"",
            "messages":[{"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"ls","arguments":{}}],"timestamp":1,"stopReason":"toolUse","usage":usage}],
            "runtime":{"draftAttachments":[],"pending":[],"events":[],"runs":[{"id":"run","state":"running","startedAt":1,"usage":[{"kind":"main","requestId":"request-1","usage":usage}]}]}
        });
        let request: ConversationRecord =
            serde_json::from_slice(&serde_json::to_vec(&expected).unwrap()).unwrap();
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join(".situate")).unwrap();
        let storage =
            Storage::open(&directory.path().canonicalize().unwrap(), "workspace").unwrap();
        storage.create_conversation("conversation", "Work").unwrap();
        let saved = storage.save_fixture_conversation(&request, 0).unwrap();
        let reply: Value = serde_json::from_slice(&serde_json::to_vec(&saved).unwrap()).unwrap();
        assert_eq!(reply["messages"], expected["messages"]);
        assert_eq!(reply["runtime"], expected["runtime"]);
        assert_eq!(reply["revision"], 1);
        assert_eq!(
            storage
                .read_conversation("conversation")
                .unwrap()
                .unwrap()
                .messages,
            expected["messages"]
        );
    }

    #[test]
    fn two_native_http_requests_share_run_without_retries() {
        let state = Ai::default();
        let key = RunKey::new("workspace", "conversation");
        admit(&state, &key, "run", "test");
        for sequence in 1..=2 {
            let request_id = format!("request-{sequence}");
            let (token, _) = state
                .dispatch_request(&key, "run", &request_id, RequestKind::Main, sequence)
                .unwrap();
            let payload = "data: {}\n\n";
            let (url, server) = local_server(format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                payload.len()
            ));
            let frames = std::sync::Arc::new(Mutex::new(Vec::new()));
            let captured = frames.clone();
            let channel = Channel::new(move |frame| {
                if let tauri::ipc::InvokeResponseBody::Json(json) = frame {
                    captured.lock().unwrap().push(json);
                }
                Ok(())
            });
            tauri::async_runtime::block_on(send(
                (
                    connection(),
                    "openai-completions".into(),
                    url,
                    "{}".into(),
                    HashMap::new(),
                ),
                token,
                |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
                None,
            ))
            .unwrap();
            assert!(server.join().unwrap().starts_with("POST "));
            assert_eq!(
                frames
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|frame| frame.contains("\"done\""))
                    .count(),
                1
            );
            state.finish_request(&key, "run", &request_id).unwrap();
            assert!(
                state
                    .dispatch_request(&key, "run", &request_id, RequestKind::Main, sequence + 1)
                    .is_err()
            );
        }
        state.save_history(&key, Some("run"), || Ok(())).unwrap();
        state.end(&key, "run").unwrap();
    }

    #[test]
    fn live_tool_claims_read_original_jsonl_run_state_and_require_an_active_lease() {
        use situate_core::conversation_history::HistoryEntry;
        for tool in ["ls", "read"] {
            let directory = tempfile::tempdir().unwrap();
            std::fs::create_dir(directory.path().join(".situate")).unwrap();
            let root = directory.path().canonicalize().unwrap();
            let cache = situate_core::ai_storage::ConversationCache::default();
            let storage = Storage::open(&root, "workspace")
                .unwrap()
                .with_conversation_cache(cache.clone());
            storage.create_conversation("conversation", "Work").unwrap();
            let args = if tool == "read" {
                serde_json::json!({"path":"seed.md"})
            } else {
                serde_json::json!({})
            };
            let entries = [
                HistoryEntry::new(
                    "run",
                    None,
                    "run",
                    serde_json::json!({"id":"run","state":"running","startedAt":1}),
                ),
                HistoryEntry::new(
                    "intent",
                    Some("run".into()),
                    "event",
                    serde_json::json!({"id":"intent","runId":"run","sequence":1,"type":"tool_intent","data":{"toolCallId":"call","name":tool,"args":args}}),
                ),
                HistoryEntry::new(
                    "start",
                    Some("intent".into()),
                    "event",
                    serde_json::json!({"id":"start","runId":"run","sequence":2,"type":"tool_execution_start","data":{"toolCallId":"call"}}),
                ),
            ];
            let saved = storage
                .append_conversation_entries("conversation", 0, &entries, Some("start"))
                .unwrap();
            let state = Ai::default();
            let key = RunKey::new("workspace", "conversation");
            let location = situate_core::workspaces::Location {
                id: "workspace".into(),
                name: "Workspace".into(),
                display: "Workspace".into(),
                kind: "path".into(),
                handle: root.to_string_lossy().into_owned(),
            };
            let load = |location: &situate_core::workspaces::Location, cache| {
                let reopened = Storage::open(Path::new(&location.handle), &location.id)?
                    .with_conversation_cache(cache);
                require_conversation(&reopened, "conversation")
            };
            assert_eq!(
                state
                    .claim_active_tool(&key, "run", "call", tool, &args, |_, _| panic!(
                        "inactive lease read storage"
                    ))
                    .unwrap_err(),
                "native.ai.turn.inactive"
            );
            state.reserve(key.clone(), "run".into()).unwrap();
            {
                let mut active = state.active.lock().unwrap();
                let run = active.get_mut(&key).unwrap();
                run.location = Some(location);
                run.conversation_cache = cache;
            }
            assert!(
                state
                    .claim_active_tool(&key, "run", "call", tool, &args, load)
                    .is_ok()
            );
            assert_eq!(
                state
                    .claim_active_tool(&key, "run", "call", tool, &args, load)
                    .unwrap_err(),
                "native.ai.turn.inactive"
            );
            state.finish_tool(&key, "run", "call");
            let ended = HistoryEntry::new(
                "end",
                Some("start".into()),
                "event",
                serde_json::json!({"id":"end","runId":"run","sequence":3,"type":"tool_execution_end","data":{"toolCallId":"call"}}),
            );
            let saved = storage
                .append_conversation_entries("conversation", saved.revision, &[ended], Some("end"))
                .unwrap();
            state
                .active
                .lock()
                .unwrap()
                .get_mut(&key)
                .unwrap()
                .tools
                .clear();
            assert_eq!(
                state
                    .claim_active_tool(&key, "run", "call", tool, &args, load)
                    .unwrap_err(),
                "native.ai.turn.required"
            );
            let terminal = [
                HistoryEntry::new(
                    "terminal-intent",
                    Some("end".into()),
                    "event",
                    serde_json::json!({"id":"terminal-intent","runId":"run","sequence":4,"type":"tool_intent","data":{"toolCallId":"terminal-call","name":tool,"args":args}}),
                ),
                HistoryEntry::new(
                    "terminal-start",
                    Some("terminal-intent".into()),
                    "event",
                    serde_json::json!({"id":"terminal-start","runId":"run","sequence":5,"type":"tool_execution_start","data":{"toolCallId":"terminal-call"}}),
                ),
                HistoryEntry::new(
                    "terminal",
                    Some("terminal-start".into()),
                    "run",
                    serde_json::json!({"id":"run","state":"completed","startedAt":1,"endedAt":2}),
                ),
            ];
            storage
                .append_conversation_entries(
                    "conversation",
                    saved.revision,
                    &terminal,
                    Some("terminal"),
                )
                .unwrap();
            assert_eq!(
                state
                    .claim_active_tool(&key, "run", "terminal-call", tool, &args, load)
                    .unwrap_err(),
                "native.ai.turn.required"
            );
        }
    }

    #[test]
    fn durable_tool_intent_started_and_one_shot_claim_are_required() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join(".situate")).unwrap();
        let storage =
            Storage::open(&directory.path().canonicalize().unwrap(), "workspace").unwrap();
        let mut record = storage.create_conversation("conversation", "Work").unwrap();
        let mut run = Active::new("run".into());
        assert!(claim_tool(&mut run, &record, "call", "write", &serde_json::json!({})).is_err());
        record.runtime = Some(serde_json::from_value(serde_json::json!({"events":[
            {"id":"intent-1","runId":"run","sequence":1,"type":"tool_intent","data":{"toolCallId":"call","name":"write","args":{}}}
        ]})).unwrap());
        record = storage.save_fixture_conversation(&record, 0).unwrap();
        assert!(claim_tool(&mut run, &record, "call", "write", &serde_json::json!({})).is_err());
        record.runtime.as_mut().unwrap().events.push(serde_json::from_value(serde_json::json!({"id":"start","runId":"run","sequence":2,"type":"tool_execution_start","data":{"toolCallId":"call"}})).unwrap());
        record = storage.save_fixture_conversation(&record, 1).unwrap();
        let reopened = storage.read_conversation("conversation").unwrap().unwrap();
        for (name, args) in [
            ("read", serde_json::json!({})),
            ("write", serde_json::json!({"path":"other"})),
            ("write", serde_json::json!({"text":"different"})),
            ("shell", serde_json::json!({"command":"exit"})),
        ] {
            assert!(claim_tool(&mut run, &reopened, "call", name, &args).is_err());
        }
        let token =
            claim_tool(&mut run, &reopened, "call", "write", &serde_json::json!({})).unwrap();
        assert_eq!(
            storage
                .read_conversation("conversation")
                .unwrap()
                .unwrap()
                .revision,
            2
        );
        assert!(claim_tool(&mut run, &reopened, "call", "write", &serde_json::json!({})).is_err());
        run.token.cancel();
        assert!(token.is_cancelled());
        assert!(claim_tool(&mut run, &reopened, "call", "write", &serde_json::json!({})).is_err());
        let mut new_run = Active::new("new-run".into());
        assert!(
            claim_tool(
                &mut new_run,
                &record,
                "call",
                "write",
                &serde_json::json!({})
            )
            .is_err()
        );
    }

    #[test]
    fn tool_claims_require_exact_intent_in_both_conversation_modes() {
        for (development, name) in [
            (true, "write"),
            (false, "write"),
            (true, "create_batch"),
            (false, "create_batch"),
            (true, "edit"),
            (false, "edit"),
            (true, "shell"),
            (false, "shell"),
            (true, "start_plugin_development"),
            (false, "start_plugin_development"),
            (true, "edit_plugin_sources"),
            (false, "edit_plugin_sources"),
        ] {
            let mut record: ConversationRecord = serde_json::from_value(serde_json::json!({
                "version":2,"id":"e428b825-a91e-4c65-b39c-bdc940cf404d","title":"Work","revision":0,"messages":[],"draft":"",
                "runtime":{"events":[
                    {"id":"call","runId":"run","sequence":1,"type":"tool_intent","data":{"toolCallId":"call","name":name,"args":{"operation":"files"}}},
                    {"id":"start","runId":"run","sequence":2,"type":"tool_execution_start","data":{"toolCallId":"call"}}
                ]}
            })).unwrap();
            if development {
                record.development = Some(situate_core::conversation_store::Development {
                    version: Some(2),
                    plugin_id: "sample".into(),
                    origin_conversation_id: Some("origin".into()),
                });
            }
            let mut run = Active::new("run".into());
            assert!(
                claim_tool(
                    &mut run,
                    &record,
                    "call",
                    name,
                    &serde_json::json!({"operation":"write"})
                )
                .is_err()
            );
            assert!(run.tools.is_empty());
            let args = serde_json::json!({"operation":"files"});
            assert!(claim_tool(&mut run, &record, "call", name, &args).is_ok());
            assert!(claim_tool(&mut run, &record, "call", name, &args).is_err());
            let mut stopped = Active::new("run".into());
            stopped.token.cancel();
            assert!(claim_tool(&mut stopped, &record, "call", name, &args).is_err());
            assert!(stopped.tools.is_empty());
        }
    }

    #[test]
    fn tool_lease_blocks_end_and_requires_save_after_cleanup() {
        let state = std::sync::Arc::new(Ai::default());
        let key = RunKey::new("workspace", "conversation");
        admit(&state, &key, "run", "test");
        state
            .dispatch_request(&key, "run", "request", RequestKind::Main, 1)
            .unwrap();
        state.finish_request(&key, "run", "request").unwrap();
        state.save_history(&key, Some("run"), || Ok(())).unwrap();
        let record: ConversationRecord = serde_json::from_value(serde_json::json!({
            "version":2,"id":"conversation","title":"Work","revision":0,"messages":[],"draft":"",
            "runtime":{"events":[
                {"id":"call","runId":"run","sequence":1,"type":"tool_intent","data":{"toolCallId":"call","name":"write","args":{"path":"note.md","text":"new"}}},
                {"id":"start","runId":"run","sequence":2,"type":"tool_execution_start","data":{"toolCallId":"call"}}
            ]}
        })).unwrap();
        let token = claim_tool(
            state.active.lock().unwrap().get_mut(&key).unwrap(),
            &record,
            "call",
            "write",
            &serde_json::json!({"path":"note.md","text":"new"}),
        )
        .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let worker_barrier = barrier.clone();
        let worker_state = state.clone();
        let worker_key = key.clone();
        let worker = std::thread::spawn(move || {
            worker_barrier.wait();
            worker_state.finish_tool(&worker_key, "run", "call");
        });
        assert!(!state.prepare_close("workspace").unwrap());
        assert!(
            state
                .dispatch_request(&key, "run", "too-early", RequestKind::Main, 2)
                .is_err()
        );
        assert!(state.end(&key, "run").is_err());
        state.save_history(&key, Some("run"), || Ok(())).unwrap();
        assert!(state.end(&key, "run").is_err());
        state.abort(&key, "run").unwrap();
        assert!(token.is_cancelled());
        assert!(state.end(&key, "run").is_err());
        barrier.wait();
        worker.join().unwrap();
        assert!(state.end(&key, "run").is_err());
        state.save_history(&key, Some("run"), || Ok(())).unwrap();
        state.end(&key, "run").unwrap();
        assert!(!state.has_active("workspace").unwrap());
    }

    #[test]
    fn native_transport_streams_without_cors_and_attaches_only_workspace_key() {
        let payload = "data: {\"choices\":[]}\n\n";
        let (url, server) = local_server(format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.len()
        ));
        let frames = std::sync::Arc::new(Mutex::new(Vec::new()));
        let captured = frames.clone();
        let channel = Channel::new(move |frame| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = frame {
                captured.lock().unwrap().push(json);
            }
            Ok(())
        });
        tauri::async_runtime::block_on(send(
            (
                connection(),
                "openai-completions".into(),
                url,
                "{}".into(),
                HashMap::new(),
            ),
            CancellationToken::new(),
            |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
            None,
        ))
        .unwrap();
        let request = server.join().unwrap().to_lowercase();
        assert!(request.contains("authorization: bearer test-secret-never-display"));
        assert!(request.contains("user-agent: pi (browser)"));
        let frames = frames.lock().unwrap().join("\n");
        assert!(frames.contains("headers"));
        assert!(frames.contains("data"));
        assert!(frames.contains("done"));
        assert!(!frames.contains("test-secret"));
    }
    #[test]
    fn redirects_and_credential_errors_never_forward_response_body_or_follow_location() {
        for code in [302, 401] {
            let destination = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            destination.set_nonblocking(true).unwrap();
            let (url, server) = local_server(format!(
                "HTTP/1.1 {code} Error\r\nLocation: http://{}/stolen\r\nContent-Length: 26\r\nConnection: close\r\n\r\ntest-secret-never-display!!",
                destination.local_addr().unwrap()
            ));
            let channel = Channel::new(|_| {
                panic!("Failed requests must not expose provider response bodies")
            });
            let error = tauri::async_runtime::block_on(send(
                (
                    connection(),
                    "openai-completions".into(),
                    url,
                    "{}".into(),
                    HashMap::new(),
                ),
                CancellationToken::new(),
                |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
                None,
            ))
            .unwrap_err();
            server.join().unwrap();
            assert!(!error.contains("test-secret"));
            assert!(destination.accept().is_err());
            if code == 401 {
                assert_eq!(error, REJECTED);
            }
        }
    }
    #[test]
    fn cancellation_before_dispatch_does_not_make_a_network_request() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let token = CancellationToken::new();
        token.cancel();
        let url = format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        );
        let channel = Channel::new(|_| panic!("Cancelled request emitted a frame"));
        assert!(
            tauri::async_runtime::block_on(send(
                (
                    connection(),
                    "openai-completions".into(),
                    url,
                    "{}".into(),
                    HashMap::new()
                ),
                token,
                |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
                None,
            ))
            .is_err()
        );
        assert!(listener.accept().is_err());
    }
    fn admit(state: &Ai, key: &RunKey, id: &str, model: &str) {
        state.reserve(key.clone(), id.into()).unwrap();
        state.active.lock().unwrap().get_mut(key).unwrap().choice = Some(
            serde_json::from_value(serde_json::json!({
                "version": 1,
                "connection": {"provider": "custom", "endpoint": "http://localhost:8080"},
                "model": model,
            }))
            .unwrap(),
        );
    }

    #[test]
    fn model_probes_never_persist_or_replace_conversations_across_completion_stop_and_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "workspace").unwrap();
        let retained = storage.create_conversation("setup", "Setup").unwrap();
        let user = storage.create_conversation("user", "My notes").unwrap();
        let before = storage.list_conversations().unwrap();
        for cancelled in [false, true, false] {
            let id = uuid::Uuid::new_v4().to_string();
            let state = Ai::default();
            let key = RunKey::check("workspace", &id);
            admit(&state, &key, "probe-run", "selected-model");
            state
                .active
                .lock()
                .unwrap()
                .get_mut(&key)
                .unwrap()
                .transient = true;
            assert!(
                claim_tool(
                    state.active.lock().unwrap().get_mut(&key).unwrap(),
                    &user,
                    "tool",
                    "write",
                    &serde_json::json!({})
                )
                .is_err()
            );
            let (token, _) = state
                .dispatch_request(&key, "probe-run", "request", RequestKind::Main, 1)
                .unwrap();
            assert!(state.end(&key, "probe-run").is_err());
            if cancelled {
                state.abort(&key, "probe-run").unwrap();
                assert!(token.is_cancelled());
            }
            state.finish_request(&key, "probe-run", "request").unwrap();
            assert!(
                state
                    .save_history(&key, Some("probe-run"), || -> Result<(), String> {
                        panic!("Probe history must never be saved")
                    })
                    .is_err()
            );
            assert!(
                state
                    .dispatch_request(&key, "probe-run", "again", RequestKind::Main, 2)
                    .is_err()
            );
            assert!(
                state
                    .dispatch_request(&key, "probe-run", "comment", RequestKind::Comment, 1)
                    .is_err()
            );
            state.end(&key, "probe-run").unwrap();
            assert!(!state.has_active("workspace").unwrap());
            assert!(storage.read_conversation(&id).unwrap().is_none());
            assert_eq!(storage.list_conversations().unwrap(), before);
        }
        let reopened = Storage::open(&path, "workspace").unwrap();
        assert_eq!(reopened.list_conversations().unwrap(), before);
        assert_eq!(
            reopened.read_conversation("setup").unwrap().unwrap(),
            retained
        );
        assert_eq!(reopened.read_conversation("user").unwrap().unwrap(), user);
    }

    #[test]
    fn model_check_keys_cannot_claim_or_cancel_conversation_or_credential_work() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "workspace").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let record = storage.create_conversation(&id, "My conversation").unwrap();
        let state = Ai::default();
        let ordinary = RunKey::new("workspace", &id);
        let check = RunKey::check("workspace", &id);
        assert_ne!(ordinary, check);
        assert_ne!(check, RunKey::credential_mutation("workspace"));
        let conversation = state
            .reserve(ordinary.clone(), "conversation".into())
            .unwrap();
        let probe = state.reserve(check.clone(), "probe".into()).unwrap();
        state.abort(&check, "probe").unwrap();
        assert!(probe.is_cancelled());
        assert!(!conversation.is_cancelled());
        state.end(&check, "probe").unwrap();
        state.end(&ordinary, "conversation").unwrap();
        assert_eq!(storage.read_conversation(&id).unwrap(), Some(record));
    }

    #[test]
    fn compaction_requests_keep_the_admitted_model_and_thinking() {
        let state = Ai::default();
        let key = RunKey::new("workspace", "conversation");
        state.reserve(key.clone(), "run".into()).unwrap();
        state.active.lock().unwrap().get_mut(&key).unwrap().choice = Some(
            serde_json::from_value(serde_json::json!({
                "version": 1,
                "connection": {"provider": "openai", "endpoint": null},
                "model": "gpt-6.1-sol",
                "thinking": "medium"
            }))
            .unwrap(),
        );
        let (_, choice) = state
            .dispatch_request(&key, "run", "summary", RequestKind::Compaction, 1)
            .unwrap();
        assert_eq!(choice.model, "gpt-6.1-sol");
        assert_eq!(choice.thinking, "medium");
        let payload = serde_json::json!({
            "model": "gpt-6.1-sol", "stream": true,
            "reasoning": {"effort": "medium"}
        });
        assert!(model::validate_payload(&choice, &payload).is_ok());
        let mut disabled = payload;
        disabled["reasoning"]["effort"] = serde_json::json!("none");
        assert_eq!(
            model::validate_payload(&choice, &disabled).unwrap_err(),
            "native.ai.model.requestMismatch",
        );
        disabled.as_object_mut().unwrap().remove("reasoning");
        assert_eq!(
            model::validate_payload(&choice, &disabled).unwrap_err(),
            "native.ai.model.requestMismatch",
        );
    }

    #[test]
    fn sequential_requests_independent_comments_and_late_completion() {
        let state = Ai::default();
        let key = RunKey::new("workspace", "first");
        admit(&state, &key, "run", "test");
        let (first, _) = state
            .dispatch_request(&key, "run", "request-1", RequestKind::Main, 1)
            .unwrap();
        assert!(
            state
                .dispatch_request(&key, "run", "overlap", RequestKind::Main, 2)
                .is_err()
        );
        {
            let mut active = state.active.lock().unwrap();
            let run = active.get_mut(&key).unwrap();
            run.comment_choice = run.choice.clone();
            run.comment_choice.as_mut().unwrap().model = "comment-model".into();
        }
        let (comment, comment_choice) = state
            .dispatch_request(&key, "run", "comment-1", RequestKind::Comment, 1)
            .unwrap();
        assert_eq!(comment_choice.model, "comment-model");
        comment.cancel();
        assert!(!first.is_cancelled());
        state.finish_request(&key, "run", "comment-1").unwrap();
        assert!(!state.active.lock().unwrap()[&key].network_done);
        state.finish_request(&key, "run", "request-1").unwrap();
        assert!(
            state
                .dispatch_request(&key, "run", "request-1", RequestKind::Main, 2)
                .is_err()
        );
        assert!(
            state
                .dispatch_request(&key, "run", "request-2", RequestKind::Main, 1)
                .is_err()
        );
        let (second, _) = state
            .dispatch_request(&key, "run", "request-2", RequestKind::Main, 2)
            .unwrap();
        assert!(state.finish_request(&key, "run", "request-1").is_err());
        state.abort(&key, "run").unwrap();
        assert!(second.is_cancelled());
        state.finish_request(&key, "run", "request-2").unwrap();
        assert!(
            state
                .dispatch_request(&key, "run", "request-3", RequestKind::Main, 3)
                .is_err()
        );
        assert!(state.end(&key, "run").is_err());
        state.save_history(&key, Some("run"), || Ok(())).unwrap();
        state.end(&key, "run").unwrap();
        assert!(state.finish_request(&key, "run", "request-2").is_err());
        admit(&state, &key, "new-run", "test");
        assert!(
            state
                .dispatch_request(&key, "run", "late", RequestKind::Main, 3)
                .is_err()
        );
    }

    #[test]
    fn request_completion_during_save_does_not_acknowledge_new_request_generation() {
        let state = Ai::default();
        let key = RunKey::new("workspace", "conversation");
        admit(&state, &key, "run", "test");
        state
            .dispatch_request(&key, "run", "one", RequestKind::Main, 1)
            .unwrap();
        state.finish_request(&key, "run", "one").unwrap();
        state
            .save_history(&key, Some("run"), || {
                state.dispatch_request(&key, "run", "two", RequestKind::Main, 2)?;
                state.finish_request(&key, "run", "two")
            })
            .unwrap();
        assert!(state.end(&key, "run").is_err());
        state.save_history(&key, Some("run"), || Ok(())).unwrap();
        state.end(&key, "run").unwrap();
    }

    #[test]
    fn title_requests_have_independent_admission_completion_and_cancellation() {
        let state = Ai::default();
        let main = RunKey::new("workspace", "garden");
        let title = RunKey::title("workspace", "garden");
        admit(&state, &main, "main-run", "chat-model");
        admit(&state, &title, "title-run", "small-model");
        let (title_token, _) = state
            .dispatch_request(&title, "title-run", "title-request", RequestKind::Title, 1)
            .unwrap();
        assert!(
            state
                .dispatch_request(&title, "title-run", "main-request", RequestKind::Main, 1)
                .is_err()
        );
        assert!(
            state
                .dispatch_request(&main, "main-run", "title-request", RequestKind::Title, 1)
                .is_err()
        );
        state.end(&main, "main-run").unwrap();
        assert!(!title_token.is_cancelled());
        assert!(state.has_active("workspace").unwrap());
        assert!(state.end(&title, "title-run").is_err());
        state
            .finish_request(&title, "title-run", "title-request")
            .unwrap();
        assert!(
            state
                .dispatch_request(&title, "title-run", "again", RequestKind::Title, 2)
                .is_err()
        );
        state.end(&title, "title-run").unwrap();
        assert!(!state.has_active("workspace").unwrap());
    }

    #[test]
    fn independent_conversations_keep_cancellation_saves_and_close_barriers_separate() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "workspace").unwrap();
        let first = storage.create_conversation("first", "First").unwrap();
        let second = storage.create_conversation("second", "Second").unwrap();
        let state = Ai::default();
        let first_key = RunKey::new("workspace", "first");
        let second_key = RunKey::new("workspace", "second");
        admit(&state, &first_key, "one", "model-one");
        admit(&state, &second_key, "two", "model-two");
        assert!(
            state
                .reserve(first_key.clone(), "duplicate".into())
                .is_err()
        );
        assert!(state.ensure_idle("workspace").is_err());
        assert!(state.ensure_idle("another-workspace").is_ok());
        assert!(state.dispatch(&first_key, "two").is_err());
        assert!(
            state
                .dispatch(&RunKey::new("another-workspace", "first"), "one")
                .is_err()
        );
        let (first_token, first_choice) = state.dispatch(&first_key, "one").unwrap();
        let (second_token, second_choice) = state.dispatch(&second_key, "two").unwrap();
        assert_eq!(first_choice.model, "model-one");
        assert_eq!(second_choice.model, "model-two");
        assert!(state.dispatch(&first_key, "one").is_err());
        assert!(state.abort(&first_key, "two").is_err());
        state.abort(&first_key, "one").unwrap();
        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
        assert!(state.end(&first_key, "one").is_err());
        assert!(!state.prepare_close("workspace").unwrap());
        assert!(
            state
                .reserve(RunKey::new("workspace", "third"), "three".into())
                .is_err()
        );
        assert!(
            state
                .complete_request(&first_key, "two", || panic!("Cross-conversation callback"))
                .is_err()
        );
        state.complete_request(&first_key, "one", || {}).unwrap();
        state.complete_request(&second_key, "two", || {}).unwrap();
        assert!(
            state
                .complete_request(&first_key, "one", || panic!("Repeated callback"))
                .is_err()
        );
        assert!(
            state
                .save_test_record(&storage, &first_key, &second, 0, Some("one"))
                .is_err()
        );
        assert!(
            state
                .save_test_record(&storage, &second_key, &second, 0, Some("one"))
                .is_err()
        );
        let first = state
            .save_test_record(&storage, &first_key, &first, 0, Some("one"))
            .unwrap();
        assert_eq!(first.revision, 1);
        state.end(&first_key, "one").unwrap();
        assert!(state.ensure_idle("workspace").is_err());
        assert!(!state.prepare_close("workspace").unwrap());
        assert!(state.end(&second_key, "two").is_err());
        state
            .save_test_record(&storage, &second_key, &second, 0, Some("two"))
            .unwrap();
        state.end(&second_key, "two").unwrap();
        assert!(state.prepare_close("workspace").unwrap());
        assert!(state.ensure_idle("workspace").is_ok());
        state.closing.lock().unwrap().remove("workspace");
        admit(&state, &first_key, "next", "model-next");
        assert!(state.abort(&first_key, "one").is_err());
        assert!(state.end(&first_key, "one").is_err());
        assert!(state.dispatch(&first_key, "one").is_err());
        assert!(
            state
                .complete_request(&first_key, "one", || panic!("Stale callback"))
                .is_err()
        );
        assert!(
            state
                .save_test_record(&storage, &first_key, &first, 1, Some("one"))
                .is_err()
        );
        let (next_token, next_choice) = state.dispatch(&first_key, "next").unwrap();
        assert!(!next_token.is_cancelled());
        assert_eq!(next_choice.model, "model-next");
        assert_eq!(first_choice.model, "model-one");
    }

    #[test]
    fn credential_mutation_blocks_every_conversation_and_missing_records_are_not_admitted() {
        let state = Ai::default();
        state.active.lock().unwrap().insert(
            RunKey::credential_mutation("workspace"),
            Active::new("credentials".into()),
        );
        for conversation in ["first", "second", "legacy"] {
            assert!(
                state
                    .reserve(RunKey::new("workspace", conversation), conversation.into())
                    .is_err()
            );
        }
        assert!(state.ensure_idle("workspace").is_err());
        state
            .reserve(RunKey::new("another-workspace", "first"), "other".into())
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "workspace").unwrap();
        assert!(require_conversation(&storage, "missing").is_err());
        assert!(require_conversation(&storage, "../escape").is_err());
        assert!(require_conversation(&storage, "legacy").is_err());
    }

    #[test]
    fn stale_revisions_and_ended_turns_cannot_acknowledge_saves() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "workspace").unwrap();
        let record = storage.create_conversation("first", "First").unwrap();
        storage.save_fixture_conversation(&record, 0).unwrap();
        let state = Ai::default();
        let key = RunKey::new("workspace", "first");
        admit(&state, &key, "one", "model-one");
        state.dispatch(&key, "one").unwrap();
        state
            .active
            .lock()
            .unwrap()
            .get_mut(&key)
            .unwrap()
            .network_done = true;
        assert!(
            state
                .save_test_record(&storage, &key, &record, 0, Some("one"))
                .is_err()
        );
        assert!(state.end(&key, "one").is_err());
        let record = require_conversation(&storage, "first").unwrap();
        let record = state
            .save_test_record(&storage, &key, &record, 1, Some("one"))
            .unwrap();
        state.end(&key, "one").unwrap();
        assert!(
            state
                .save_test_record(&storage, &key, &record, 2, Some("one"))
                .is_err()
        );
        assert_eq!(require_conversation(&storage, "first").unwrap().revision, 2);
        assert_eq!(
            state
                .save_test_record(&storage, &key, &record, 2, None)
                .unwrap()
                .revision,
            3
        );
    }

    #[test]
    fn conversation_storage_does_not_lock_other_turns_or_lose_abort_state() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        std::fs::create_dir(path.join(".situate")).unwrap();
        let storage = Storage::open(&path, "one").unwrap();
        let state = Ai::default();
        let mut finished = Active::new("first".into());
        finished.dispatch().unwrap();
        finished.network_done = true;
        state
            .active
            .lock()
            .unwrap()
            .insert(RunKey::new("one", "legacy"), finished);
        state
            .active
            .lock()
            .unwrap()
            .insert(RunKey::new("two", "legacy"), Active::new("second".into()));
        let mut record = storage.create_conversation("legacy", "").unwrap();
        record.messages =
            serde_json::json!([{"content":"Saved response","role":"user","timestamp":1}]);
        state
            .save_history(&RunKey::new("one", "legacy"), Some("first"), || {
                {
                    let mut active = state
                        .active
                        .try_lock()
                        .expect("Storage must not hold the active-turn mutex");
                    active
                        .get_mut(&RunKey::new("two", "legacy"))
                        .unwrap()
                        .dispatch()
                        .unwrap();
                    for run in active.values() {
                        run.token.cancel();
                    }
                }
                storage.save_fixture_conversation(&record, record.revision)
            })
            .unwrap();
        assert_eq!(
            require_conversation(&storage, "legacy").unwrap().messages,
            record.messages
        );
        let active = state.active.lock().unwrap();
        assert!(active[&RunKey::new("one", "legacy")].can_end());
        assert!(active[&RunKey::new("one", "legacy")].persisted);
        assert!(active[&RunKey::new("one", "legacy")].token.is_cancelled());
        assert!(active[&RunKey::new("two", "legacy")].dispatched);
        assert!(active[&RunKey::new("two", "legacy")].token.is_cancelled());
        assert!(!active[&RunKey::new("two", "legacy")].persisted);
    }
    #[test]
    fn network_completion_during_storage_requires_a_subsequent_save() {
        let state = Ai::default();
        let mut run = Active::new("turn".into());
        run.dispatch().unwrap();
        state
            .active
            .lock()
            .unwrap()
            .insert(RunKey::new("one", "legacy"), run);
        state
            .save_history(&RunKey::new("one", "legacy"), Some("turn"), || {
                let mut active = state.active.try_lock().unwrap();
                active
                    .get_mut(&RunKey::new("one", "legacy"))
                    .unwrap()
                    .network_done = true;
                Ok(())
            })
            .unwrap();
        {
            let active = state.active.lock().unwrap();
            assert!(active[&RunKey::new("one", "legacy")].network_done);
            assert!(!active[&RunKey::new("one", "legacy")].persisted);
            assert!(!active[&RunKey::new("one", "legacy")].can_end());
        }
        state
            .save_history(&RunKey::new("one", "legacy"), Some("turn"), || Ok(()))
            .unwrap();
        assert!(state.active.lock().unwrap()[&RunKey::new("one", "legacy")].can_end());
    }
    #[test]
    fn changed_turns_are_not_acknowledged_after_storage() {
        for initial in [false, true] {
            for replacement in [false, true] {
                if !initial && !replacement {
                    continue;
                }
                let state = Ai::default();
                if initial {
                    let mut run = Active::new("old".into());
                    run.dispatch().unwrap();
                    run.network_done = true;
                    state
                        .active
                        .lock()
                        .unwrap()
                        .insert(RunKey::new("one", "legacy"), run);
                }
                let result = state.save_history(
                    &RunKey::new("one", "legacy"),
                    initial.then_some("old"),
                    || {
                        let mut active = state.active.try_lock().unwrap();
                        active.remove(&RunKey::new("one", "legacy"));
                        if replacement {
                            let mut run = Active::new("new".into());
                            run.dispatch().unwrap();
                            run.network_done = true;
                            active.insert(RunKey::new("one", "legacy"), run);
                        }
                        Ok(())
                    },
                );
                assert_eq!(result.unwrap_err(), "native.ai.turn.inactive");
                let active = state.active.lock().unwrap();
                if replacement {
                    assert_eq!(active[&RunKey::new("one", "legacy")].id, "new");
                    assert!(!active[&RunKey::new("one", "legacy")].persisted);
                    assert!(!active[&RunKey::new("one", "legacy")].can_end());
                } else {
                    assert!(!active.contains_key(&RunKey::new("one", "legacy")));
                }
            }
        }
    }
    #[test]
    fn failed_or_unadmitted_history_saves_do_not_acknowledge_a_turn() {
        let state = Ai::default();
        let mut run = Active::new("turn".into());
        run.dispatch().unwrap();
        run.network_done = true;
        state
            .active
            .lock()
            .unwrap()
            .insert(RunKey::new("one", "legacy"), run);
        assert!(
            state
                .save_history::<()>(&RunKey::new("one", "legacy"), Some("other"), || panic!(
                    "Unadmitted save ran"
                ))
                .is_err()
        );
        assert!(
            state
                .save_history::<()>(&RunKey::new("one", "legacy"), None, || panic!(
                    "Unadmitted save ran"
                ))
                .is_err()
        );
        assert_eq!(
            state
                .save_history(
                    &RunKey::new("one", "legacy"),
                    Some("turn"),
                    || Err::<(), _>("Storage failed.".into())
                )
                .unwrap_err(),
            "Storage failed."
        );
        assert!(!state.active.lock().unwrap()[&RunKey::new("one", "legacy")].can_end());
        state
            .save_history(&RunKey::new("empty", "legacy"), None, || Ok(()))
            .unwrap();
        assert!(
            !state
                .active
                .lock()
                .unwrap()
                .contains_key(&RunKey::new("empty", "legacy"))
        );
    }
    #[test]
    fn admitted_turn_remembers_stop_before_dispatch_and_cannot_be_dispatched_twice() {
        let mut stopped = Active::new("one".into());
        stopped.token.cancel();
        assert!(stopped.dispatch().is_err());
        assert!(stopped.can_end());
        let mut running = Active::new("two".into());
        assert!(running.dispatch().is_ok());
        assert!(running.dispatch().is_err());
    }
    #[test]
    fn http_completion_does_not_release_the_persistence_lease() {
        let mut run = Active::new("turn".into());
        run.dispatch().unwrap();
        run.acknowledge_save();
        assert!(!run.can_end());
        run.network_done = true;
        assert!(!run.can_end());
        run.token.cancel();
        assert!(!run.can_end());
        run.acknowledge_save();
        assert!(run.can_end());
    }
    #[test]
    fn upstream_header_metadata_does_not_admit_deferred_providers() {
        let catalog: Value = serde_json::from_str(CATALOG).unwrap();
        let model_for = |id| {
            catalog["providers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|provider| provider["id"] == id)
                .unwrap()["models"][0]["id"]
                .as_str()
                .unwrap()
                .to_owned()
        };
        let nvidia = Config {
            connection_id: None,
            label: None,
            http_acknowledgement: None,
            auth: None,
            provider: "nvidia".into(),
            legacy_model: Some(model_for("nvidia")),
            endpoint: None,
        };
        assert_eq!(
            target(&nvidia, nvidia.legacy_model.as_deref().unwrap()).unwrap_err(),
            "native.ai.provider.choose"
        );
        let copilot = Config {
            connection_id: None,
            label: None,
            http_acknowledgement: None,
            auth: None,
            provider: "github-copilot".into(),
            legacy_model: Some(model_for("github-copilot")),
            endpoint: None,
        };
        assert_eq!(
            target(&copilot, copilot.legacy_model.as_deref().unwrap()).unwrap_err(),
            "native.ai.provider.choose"
        );
    }
    #[test]
    fn anthropic_route_and_protocol_headers_are_precise() {
        let config = Config {
            connection_id: None,
            label: None,
            http_acknowledgement: None,
            auth: None,
            provider: "anthropic".into(),
            legacy_model: Some("claude-sonnet-4-5".into()),
            endpoint: None,
        };
        assert_eq!(
            target(&config, "claude-sonnet-4-5").unwrap().1,
            "https://api.anthropic.com/v1/messages?beta=true"
        );
        assert!(
            validate_headers(
                "anthropic-messages",
                &HashMap::from([("anthropic-version".into(), "2023-06-01".into())])
            )
            .is_ok()
        );
        assert!(
            validate_headers(
                "anthropic-messages",
                &HashMap::from([("authorization".into(), "injected".into())])
            )
            .is_err()
        );
        assert!(
            validate_headers(
                "anthropic-messages",
                &HashMap::from([("anthropic-beta".into(), "unregistered".into())])
            )
            .is_err()
        );
    }
    #[test]
    fn endpoint_policy_rejects_credentials_and_url_injection() {
        let config = Config {
            connection_id: None,
            label: None,
            http_acknowledgement: None,
            auth: None,
            provider: "custom".into(),
            legacy_model: Some("local-model".into()),
            endpoint: Some("http://LOCALHOST:80/v1/".into()),
        };
        assert_eq!(
            target(&config, "local-model").unwrap().1,
            "http://localhost/v1/chat/completions"
        );
        for url in [
            "https://secret@example.com/v1",
            "https://example.com?key=x",
            "https://example.com/#fragment",
            "file:///tmp",
            "https://{tenant}/v1",
        ] {
            assert!(validate_endpoint(url).is_err(), "{url}");
        }
        for url in [
            "http://example.com/v1",
            "https://example.com/v1",
            "http://127.0.0.1:8888/v1",
            "http://localhost:8888/v1",
        ] {
            assert!(validate_endpoint(url).is_ok());
        }
    }
    #[test]
    fn built_in_target_comes_from_pinned_catalog_not_ui_override() {
        let mut config = Config {
            connection_id: None,
            label: None,
            http_acknowledgement: None,
            auth: None,
            provider: "openai".into(),
            legacy_model: Some("gpt-4o-mini".into()),
            endpoint: None,
        };
        assert_eq!(
            target(&config, "gpt-4o-mini").unwrap().1,
            "https://api.openai.com/v1/responses"
        );
        config.endpoint = Some("https://attacker.invalid".into());
        assert!(target(&config, "gpt-4o-mini").is_err());
        config.endpoint = None;
        assert!(target(&config, "unregistered").is_err());
    }
}
