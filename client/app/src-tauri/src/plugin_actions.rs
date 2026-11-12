use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

const UNAVAILABLE: &str = "native.plugins.unavailable";
const BUSY: &str = "native.plugins.stateBusy";
const CANCELLED: &str = "native.plugins.hostCancelled";

#[derive(Default)]
pub struct Actions(Mutex<HashMap<String, Arc<Scope>>>);

#[derive(Default)]
struct Scope {
    inner: Mutex<ScopeState>,
    changed: Notify,
}

#[derive(Default)]
struct ScopeState {
    closed: bool,
    actions: HashMap<String, Action>,
    requests: HashMap<String, HashSet<String>>,
    gates: HashMap<String, Gate>,
}

struct Gate {
    affected: HashSet<String>,
    phase: Phase,
}

enum Phase {
    Roots,
    Requests,
    Published,
}

impl ScopeState {
    fn close_request_admission(&mut self) {
        for gate in self.gates.values_mut() {
            if matches!(gate.phase, Phase::Roots)
                && self
                    .actions
                    .values()
                    .all(|action| action.required.is_disjoint(&gate.affected))
            {
                gate.phase = Phase::Requests;
            }
        }
    }
}

struct Action {
    plugin_id: String,
    window: String,
    _authorization: crate::workspaces::AuthorizationSession,
    required: HashSet<String>,
}

impl Actions {
    fn scope(&self, scope: &str) -> Result<Arc<Scope>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .entry(scope.into())
            .or_default()
            .clone())
    }

    fn invalidate(&self, scope: &str) {
        if let Ok(mut scopes) = self.0.lock()
            && let Some(scope) = scopes.remove(scope)
        {
            if let Ok(mut state) = scope.inner.lock() {
                state.closed = true;
                state.actions.clear();
                state.requests.clear();
                state.gates.clear();
            }
            scope.changed.notify_waiters();
        }
    }
}

pub(crate) fn invalidate_scope(app: &tauri::AppHandle, scope: &str) {
    if let Some(actions) = app.try_state::<Actions>() {
        actions.invalidate(scope);
    }
}

#[derive(Deserialize)]
struct Dependencies {
    #[serde(default)]
    dependencies: Vec<String>,
}

fn required_closure(
    root: &str,
    mut manifest: impl FnMut(&str) -> Result<Value, String>,
) -> Result<HashSet<String>, String> {
    let mut required = HashSet::new();
    let mut pending = vec![root.to_owned()];
    while let Some(id) = pending.pop() {
        if !required.insert(id.clone()) {
            continue;
        }
        let view: Dependencies =
            serde_json::from_value(manifest(&id)?).map_err(|_| "native.plugins.invalidManifest")?;
        pending.extend(view.dependencies);
    }
    Ok(required)
}

pub(crate) type Revisions = HashMap<String, Option<String>>;
pub(crate) type Incarnations = HashMap<String, String>;

fn current_incarnations(
    root: &std::path::Path,
    revisions: &Revisions,
) -> Result<Incarnations, String> {
    revisions
        .keys()
        .map(|id| {
            Ok((
                id.clone(),
                situate_core::plugins::folder::incarnation(root, id)?,
            ))
        })
        .collect()
}

fn validate_incarnations(
    expected: Option<&Incarnations>,
    current: &Incarnations,
) -> Result<(), String> {
    if expected != Some(current) {
        return Err("native.plugins.stateConflict".into());
    }
    Ok(())
}

fn current_revisions(required: &HashSet<String>, listing: Value) -> Result<Revisions, String> {
    #[derive(Deserialize)]
    struct Listing {
        plugins: Vec<Summary>,
    }
    #[derive(Deserialize)]
    struct Summary {
        id: String,
        enabled: bool,
        #[serde(default)]
        revision: Option<String>,
    }
    let listing: Listing = serde_json::from_value(listing).map_err(|_| UNAVAILABLE)?;
    let active: HashMap<_, _> = listing
        .plugins
        .into_iter()
        .filter(|plugin| plugin.enabled && required.contains(&plugin.id))
        .map(|plugin| (plugin.id, plugin.revision))
        .collect();
    if active.len() != required.len() {
        return Err("native.plugins.stateConflict".into());
    }
    Ok(active)
}

fn validate_captured(revisions: Option<&Revisions>, active: &Revisions) -> Result<(), String> {
    if match revisions {
        Some(revisions) => revisions != active,
        None => active.values().any(Option::is_some),
    } {
        return Err("native.plugins.stateConflict".into());
    }
    Ok(())
}

#[cfg(test)]
fn validate_revisions(
    required: &HashSet<String>,
    revisions: Option<&Revisions>,
    listing: Value,
) -> Result<(), String> {
    validate_captured(revisions, &current_revisions(required, listing)?)
}

fn active_revisions(
    root: &std::path::Path,
    plugin: &str,
    blocked: impl Fn(&str) -> bool,
) -> Result<Revisions, String> {
    let required = required_closure(plugin, |id| {
        if blocked(id) {
            return Err("native.plugins.recoveryBlocked".into());
        }
        let sources = situate_core::plugins::runtime::load(root, id)?;
        serde_json::to_value(sources.manifest).map_err(|_| UNAVAILABLE.into())
    })?;
    let listing = situate_core::plugins::runtime::list(root)?;
    current_revisions(
        &required,
        serde_json::to_value(listing).map_err(|_| UNAVAILABLE)?,
    )
}

pub(crate) fn capture_host(
    app: &tauri::AppHandle,
    scope: &str,
    root: &std::path::Path,
    plugin: &str,
    revisions: Option<&Revisions>,
    incarnations: Option<&Incarnations>,
) -> Result<Revisions, String> {
    let captured = active_revisions(root, plugin, |id| {
        crate::plugin_recovery::blocked(app, scope, id)
    })?;
    validate_captured(revisions, &captured)?;
    validate_incarnations(incarnations, &current_incarnations(root, &captured)?)?;
    Ok(captured)
}

pub(crate) fn capture_revisions(
    app: &tauri::AppHandle,
    scope: &str,
    root: &std::path::Path,
    plugin: &str,
) -> Result<Revisions, String> {
    active_revisions(root, plugin, |id| {
        crate::plugin_recovery::blocked(app, scope, id)
    })
}

pub(crate) struct ActionLease {
    scope: Arc<Scope>,
    window: String,
    id: String,
}
impl Drop for ActionLease {
    fn drop(&mut self) {
        let _ = self.scope.end(&self.window, &self.id);
    }
}
pub(crate) fn begin_native(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    authorization: crate::workspaces::AuthorizationSession,
    plugin: &str,
    revisions: &Revisions,
    incarnations: &Incarnations,
) -> Result<ActionLease, String> {
    crate::workspaces::with_authorization_session(app, window, &authorization, |location| {
        let root = crate::files::local_root(app, location)?.ok_or(UNAVAILABLE)?;
        let state = app.state::<Actions>().scope(scope)?;
        let id = state.begin(plugin, window, authorization.clone(), || {
            let current = active_revisions(&root, plugin, |id| {
                crate::plugin_recovery::blocked(app, scope, id)
            })?;
            validate_captured(Some(revisions), &current)?;
            validate_incarnations(Some(incarnations), &current_incarnations(&root, &current)?)?;
            Ok(current.into_keys().collect())
        })?;
        Ok(ActionLease {
            scope: state,
            window: window.into(),
            id,
        })
    })
}

pub(crate) struct RequestLease {
    scope: Arc<Scope>,
    token: String,
}

impl Drop for RequestLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.scope.inner.lock() {
            state.requests.remove(&self.token);
        }
        self.scope.changed.notify_waiters();
    }
}

pub(crate) fn lease_request(
    app: &tauri::AppHandle,
    scope: &str,
    root: &std::path::Path,
    plugin: &str,
    captured: &Revisions,
    incarnations: &Incarnations,
) -> Result<RequestLease, String> {
    app.state::<Actions>().scope(scope)?.request(|| {
        let current = active_revisions(root, plugin, |id| {
            crate::plugin_recovery::blocked(app, scope, id)
        })?;
        validate_captured(Some(captured), &current)?;
        validate_incarnations(Some(incarnations), &current_incarnations(root, &current)?)?;
        Ok(current.into_keys().collect())
    })
}

impl Scope {
    fn request(
        self: &Arc<Self>,
        required: impl FnOnce() -> Result<HashSet<String>, String>,
    ) -> Result<RequestLease, String> {
        let mut state = self.inner.lock().map_err(|_| UNAVAILABLE)?;
        if state.closed {
            return Err(UNAVAILABLE.into());
        }
        let required = required()?;
        state.close_request_admission();
        if state.gates.values().any(|gate| {
            matches!(gate.phase, Phase::Requests) && !gate.affected.is_disjoint(&required)
        }) {
            return Err(BUSY.into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        state.requests.insert(token.clone(), required);
        Ok(RequestLease {
            scope: self.clone(),
            token,
        })
    }

    fn begin(
        &self,
        plugin_id: &str,
        window: &str,
        authorization: crate::workspaces::AuthorizationSession,
        required: impl FnOnce() -> Result<HashSet<String>, String>,
    ) -> Result<String, String> {
        let mut state = self.inner.lock().map_err(|_| UNAVAILABLE)?;
        if state.closed {
            return Err(UNAVAILABLE.into());
        }
        // Read active manifests and admit atomically with respect to publication gates.
        let required = required()?;
        if state
            .gates
            .values()
            .any(|gate| !gate.affected.is_disjoint(&required))
        {
            return Err(BUSY.into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        state.actions.insert(
            id.clone(),
            Action {
                plugin_id: plugin_id.into(),
                window: window.into(),
                _authorization: authorization,
                required,
            },
        );
        Ok(id)
    }

    #[cfg(test)]
    fn authorization(
        &self,
        window: &str,
        id: &str,
    ) -> Result<crate::workspaces::AuthorizationSession, String> {
        let state = self.inner.lock().map_err(|_| UNAVAILABLE)?;
        let action = state.actions.get(id).ok_or(UNAVAILABLE)?;
        if state.closed || action.window != window {
            return Err(UNAVAILABLE.into());
        }
        Ok(action._authorization.clone())
    }

    fn end(&self, window: &str, id: &str) -> Result<(), String> {
        let mut state = self.inner.lock().map_err(|_| UNAVAILABLE)?;
        if state.closed
            || !state
                .actions
                .get(id)
                .is_some_and(|action| action.window == window)
        {
            return Err(UNAVAILABLE.into());
        }
        state.actions.remove(id);
        state.close_request_admission();
        self.changed.notify_waiters();
        Ok(())
    }
}

pub(crate) struct PublicationGate {
    scope: Arc<Scope>,
    token: String,
}

impl Drop for PublicationGate {
    fn drop(&mut self) {
        if let Ok(mut state) = self.scope.inner.lock() {
            state.gates.remove(&self.token);
        }
        self.scope.changed.notify_waiters();
    }
}

impl Scope {
    fn exclusive(self: &Arc<Self>, affected: &[String]) -> Result<PublicationGate, String> {
        let gate = self.gate(affected)?;
        {
            let state = self.inner.lock().map_err(|_| UNAVAILABLE)?;
            let affected = &state.gates.get(&gate.token).ok_or(UNAVAILABLE)?.affected;
            if state
                .actions
                .values()
                .any(|action| !action.required.is_disjoint(affected))
                || state
                    .requests
                    .values()
                    .any(|required| !required.is_disjoint(affected))
            {
                return Err(BUSY.into());
            }
        }
        Ok(gate)
    }

    fn gate(self: &Arc<Self>, affected: &[String]) -> Result<PublicationGate, String> {
        let mut state = self.inner.lock().map_err(|_| UNAVAILABLE)?;
        if state.closed {
            return Err(UNAVAILABLE.into());
        }
        let affected: HashSet<_> = affected.iter().cloned().collect();
        if state
            .gates
            .values()
            .any(|gate| !gate.affected.is_disjoint(&affected))
        {
            return Err(BUSY.into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        state.gates.insert(
            token.clone(),
            Gate {
                affected,
                phase: Phase::Roots,
            },
        );
        state.close_request_admission();
        Ok(PublicationGate {
            scope: self.clone(),
            token,
        })
    }
}

#[cfg(test)]
pub(crate) fn test_publication_gate() -> (PublicationGate, impl Fn() -> bool) {
    let scope = Arc::new(Scope::default());
    let gate = scope.gate(&["sample".into()]).unwrap();
    (gate, move || scope.gate(&["sample".into()]).is_ok())
}

impl PublicationGate {
    pub(crate) fn published(&mut self) -> Result<(), String> {
        let mut state = self.scope.inner.lock().map_err(|_| UNAVAILABLE)?;
        if state.closed {
            return Err(UNAVAILABLE.into());
        }
        let gate = state.gates.get(&self.token).ok_or(UNAVAILABLE)?;
        if !matches!(gate.phase, Phase::Requests)
            || state
                .requests
                .values()
                .any(|required| !required.is_disjoint(&gate.affected))
        {
            return Err(BUSY.into());
        }
        state.gates.get_mut(&self.token).ok_or(UNAVAILABLE)?.phase = Phase::Published;
        self.scope.changed.notify_waiters();
        Ok(())
    }

    async fn drain(self, cancel: &CancellationToken) -> Result<Self, String> {
        self.wait(cancel).await?;
        Ok(self)
    }

    pub(crate) async fn wait(&self, cancel: &CancellationToken) -> Result<(), String> {
        loop {
            let changed = self.scope.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if cancel.is_cancelled() {
                return Err(CANCELLED.into());
            }
            {
                let mut state = self.scope.inner.lock().map_err(|_| UNAVAILABLE)?;
                if state.closed {
                    return Err(UNAVAILABLE.into());
                }
                state.close_request_admission();
                let gate = state.gates.get(&self.token).ok_or(UNAVAILABLE)?;
                if matches!(gate.phase, Phase::Requests)
                    && state
                        .requests
                        .values()
                        .all(|required| required.is_disjoint(&gate.affected))
                {
                    break;
                }
            }
            tokio::select! {
                _ = cancel.cancelled() => return Err(CANCELLED.into()),
                _ = &mut changed => {}
            }
        }
        Ok(())
    }

    pub(crate) fn release(&self) {
        if let Ok(mut state) = self.scope.inner.lock() {
            state.gates.remove(&self.token);
        }
        self.scope.changed.notify_waiters();
    }
}

impl Scope {
    fn counts(
        &self,
        affected: &[String],
    ) -> Result<(Vec<crate::plugin_disable::RunningAction>, usize), String> {
        let state = self.inner.lock().map_err(|_| UNAVAILABLE)?;
        if state.closed {
            return Err(UNAVAILABLE.into());
        }
        let affected: HashSet<_> = affected.iter().cloned().collect();
        let mut counts = std::collections::BTreeMap::<String, usize>::new();
        for action in state.actions.values() {
            if !action.required.is_disjoint(&affected) {
                *counts.entry(action.plugin_id.clone()).or_default() += 1;
            }
        }
        Ok((
            counts
                .into_iter()
                .map(|(plugin_id, count)| crate::plugin_disable::RunningAction { plugin_id, count })
                .collect(),
            state
                .requests
                .values()
                .filter(|required| !required.is_disjoint(&affected))
                .count(),
        ))
    }
}

pub(crate) fn activity(
    app: &tauri::AppHandle,
    scope: &str,
    affected: &[String],
) -> Result<(Vec<crate::plugin_disable::RunningAction>, usize), String> {
    app.state::<Actions>().scope(scope)?.counts(affected)
}

pub(crate) fn begin_disable(
    app: &tauri::AppHandle,
    scope: &str,
    affected: &[String],
) -> Result<PublicationGate, String> {
    app.state::<Actions>().scope(scope)?.gate(affected)
}

pub(crate) fn acquire_removal(
    app: &tauri::AppHandle,
    scope: &str,
    plugin: &str,
) -> Result<PublicationGate, String> {
    app.state::<Actions>()
        .scope(scope)?
        .exclusive(&[plugin.into()])
}

pub(crate) async fn acquire_publication(
    app: &tauri::AppHandle,
    scope: &str,
    affected: &[String],
    cancel: &CancellationToken,
) -> Result<PublicationGate, String> {
    app.state::<Actions>()
        .scope(scope)?
        .gate(affected)?
        .drain(cancel)
        .await
}

#[cfg(test)]
#[path = "plugin_actions_tests.rs"]
mod tests;
