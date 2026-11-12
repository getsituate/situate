use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

const UNAVAILABLE: &str = "native.plugins.unavailable";
const BUSY: &str = "native.plugins.stateBusy";
const UNKNOWN: &str = "native.plugins.stateOutcomeUnknown";

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Begin {
        #[serde(deserialize_with = "request_id")]
        id: String,
        #[serde(rename = "pluginId")]
        plugin_id: String,
        #[serde(rename = "expectedRevision", deserialize_with = "required_revision")]
        expected_revision: Option<String>,
    },
    Status {
        id: String,
    },
    Cancel {
        id: String,
    },
    Stop {
        id: String,
    },
}

fn request_id<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let id = String::deserialize(d)?;
    uuid::Uuid::parse_str(&id).map_err(serde::de::Error::custom)?;
    Ok(id)
}

fn required_revision<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Waiting,
    Saving,
    Disabled,
    Cancelled,
    Failed,
    Uncertain,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningAction {
    pub(crate) plugin_id: String,
    pub(crate) count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    id: String,
    plugin_id: String,
    phase: Phase,
    running_actions: Vec<RunningAction>,
    pending_requests: usize,
    error: Option<String>,
}

#[derive(Default)]
pub struct Disables(Mutex<HashMap<String, Arc<Disable>>>);

struct Disable {
    id: String,
    plugin_id: String,
    window: String,
    authorization: crate::workspaces::AuthorizationSession,
    affected: Vec<String>,
    incarnations: crate::plugin_actions::Incarnations,
    expected_revision: Option<String>,
    cancel: CancellationToken,
    state: Mutex<State>,
}

struct State {
    phase: Phase,
    error: Option<String>,
    gate: Option<Arc<crate::plugin_actions::PublicationGate>>,
}

impl State {
    fn waiting(&self) -> bool {
        self.phase == Phase::Waiting
    }
    fn pending_write(&self) -> bool {
        matches!(self.phase, Phase::Waiting | Phase::Saving)
    }
    fn blocks_begin(&self) -> bool {
        self.pending_write() || self.phase == Phase::Uncertain
    }
    fn release(&mut self) {
        if let Some(gate) = self.gate.take() {
            gate.release();
        }
    }
}

impl Disable {
    fn cancel(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| UNAVAILABLE)?;
        if state.waiting() {
            self.cancel.cancel();
            state.phase = Phase::Cancelled;
            state.release();
        }
        Ok(())
    }

    fn saving(&self) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| UNAVAILABLE)?;
        if !state.waiting() || self.cancel.is_cancelled() {
            return Ok(false);
        }
        // Cancel and the durable-write boundary are ordered by this mutex.
        state.phase = Phase::Saving;
        Ok(true)
    }

    fn commit(&self, write: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        if !self.saving()? {
            return Err("native.plugins.hostCancelled".into());
        }
        write()
    }

    fn finish(&self, result: Result<(), String>) {
        if let Ok(mut state) = self.state.lock() {
            if state.pending_write() {
                match result {
                    Ok(()) => state.phase = Phase::Disabled,
                    Err(error) => {
                        state.phase = if error == UNKNOWN {
                            Phase::Uncertain
                        } else {
                            Phase::Failed
                        };
                        state.error = Some(error);
                    }
                }
            }
            if state.phase != Phase::Uncertain {
                state.release();
            }
        }
    }

    fn invalidate(&self) {
        self.cancel.cancel();
        if let Ok(mut state) = self.state.lock() {
            if state.waiting() {
                state.phase = Phase::Cancelled;
            }
            state.release();
        }
    }

    fn validate_installations(
        &self,
        listing: &situate_core::plugins::runtime::Listing,
    ) -> Result<(), String> {
        if capture_incarnations(&self.affected, listing)? != self.incarnations {
            return Err("native.plugins.stateConflict".into());
        }
        Ok(())
    }

    fn write_disabled(&self, root: &std::path::Path) -> Result<(), String> {
        self.validate_installations(&situate_core::plugins::runtime::list(root)?)?;
        situate_core::plugins::runtime::set_enabled(
            root,
            &self.plugin_id,
            false,
            self.expected_revision.as_deref(),
        )
        .map(|_| ())
    }

    fn reconcile_observation(
        &self,
        listing: &situate_core::plugins::runtime::Listing,
        observed_phase: Phase,
    ) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| UNAVAILABLE)?;
        // A waiting read cannot resolve a write that became uncertain while the read ran.
        if state.phase != observed_phase
            || !matches!(state.phase, Phase::Waiting | Phase::Uncertain)
        {
            return Ok(());
        }
        if let Err(error) = self.validate_installations(listing) {
            self.cancel.cancel();
            state.phase = Phase::Failed;
            state.error = Some(error);
            state.release();
            return Ok(());
        }
        if state.phase != Phase::Uncertain {
            return Ok(());
        }
        let disabled = listing
            .plugins
            .iter()
            .any(|p| p.id == self.plugin_id && !p.enabled)
            && listing
                .plugins
                .iter()
                .filter(|p| self.affected.contains(&p.id))
                .all(|p| !p.enabled);
        if disabled {
            state.phase = Phase::Disabled;
            state.error = None;
        } else if listing.revision == self.expected_revision {
            state.phase = Phase::Failed;
            state.error = Some("native.plugins.stateSaveFailed".into());
        } else {
            return Ok(());
        }
        state.release();
        Ok(())
    }

    fn check_begin(&self, id: &str) -> Result<(), String> {
        if self.id == id || self.state.lock().map_err(|_| UNAVAILABLE)?.blocks_begin() {
            return Err(BUSY.into());
        }
        Ok(())
    }

    fn snapshot(&self, activity: (Vec<RunningAction>, usize)) -> Result<Snapshot, String> {
        let state = self.state.lock().map_err(|_| UNAVAILABLE)?;
        Ok(Snapshot {
            id: self.id.clone(),
            plugin_id: self.plugin_id.clone(),
            phase: state.phase,
            running_actions: activity.0,
            pending_requests: activity.1,
            error: state.error.clone(),
        })
    }
}

impl Disables {
    fn owned(&self, scope: &str, window: &str, id: &str) -> Result<Arc<Disable>, String> {
        let jobs = self.0.lock().map_err(|_| UNAVAILABLE)?;
        let job = jobs
            .get(scope)
            .filter(|job| job.id == id && job.window == window)
            .ok_or(UNAVAILABLE)?;
        Ok(job.clone())
    }

    fn discard_expired(&self, scope: &str, expected: &Arc<Disable>, expired: Result<bool, String>) {
        if !matches!(expired, Ok(true)) {
            return;
        }
        if let Ok(mut jobs) = self.0.lock()
            && jobs
                .get(scope)
                .is_some_and(|job| Arc::ptr_eq(job, expected))
            && let Some(job) = jobs.remove(scope)
        {
            job.invalidate();
        }
    }

    fn invalidate(&self, scope: &str) {
        if let Ok(mut jobs) = self.0.lock()
            && let Some(job) = jobs.remove(scope)
        {
            job.invalidate();
        }
    }
}

pub(crate) fn invalidate_scope(app: &tauri::AppHandle, scope: &str) {
    if let Some(jobs) = app.try_state::<Disables>() {
        jobs.invalidate(scope);
    }
}

fn affected(plugin_id: &str, listing: &situate_core::plugins::runtime::Listing) -> Vec<String> {
    let mut affected = HashSet::from([plugin_id.to_owned()]);
    loop {
        let before = affected.len();
        for plugin in listing.plugins.iter().filter(|p| p.enabled) {
            if plugin
                .manifest
                .as_ref()
                .and_then(|m| m.dependencies.as_ref())
                .is_some_and(|dependencies| dependencies.iter().any(|id| affected.contains(id)))
            {
                affected.insert(plugin.id.clone());
            }
        }
        if before == affected.len() {
            break;
        }
    }
    let mut affected: Vec<_> = affected.into_iter().collect();
    affected.sort();
    affected
}

fn capture_incarnations(
    affected: &[String],
    listing: &situate_core::plugins::runtime::Listing,
) -> Result<crate::plugin_actions::Incarnations, String> {
    affected
        .iter()
        .map(|id| {
            let incarnation = listing
                .plugins
                .iter()
                .find(|plugin| plugin.id == *id)
                .and_then(|plugin| plugin.incarnation.clone())
                .ok_or("native.plugins.stateConflict")?;
            Ok((id.clone(), incarnation))
        })
        .collect()
}

async fn run(app: tauri::AppHandle, scope: String, job: Arc<Disable>) {
    let gate = job.state.lock().ok().and_then(|state| state.gate.clone());
    let Some(gate) = gate else {
        return;
    };
    let result = async {
        gate.wait(&job.cancel).await?;
        crate::ai_executor::retire_affected(&app, &scope, &job.incarnations).await
    }
    .await;
    if let Err(error) = result {
        job.finish(Err(error));
        return;
    }
    let worker = job.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_authorization_session(
            &app,
            &worker.window,
            &worker.authorization,
            |location| {
                let root = crate::files::local_root(&app, location)?.ok_or(UNAVAILABLE)?;
                worker.commit(|| {
                    worker.write_disabled(&root)?;
                    crate::plugin_recovery::reconcile(&app).map_err(|_| UNKNOWN.to_owned())
                })
            },
        )
    })
    .await
    .unwrap_or_else(|_| Err(UNKNOWN.into()));
    job.finish(result);
}

#[tauri::command]
pub async fn plugin_disable(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: Request,
) -> Result<Snapshot, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let label = window.label().to_owned();
        tauri::async_runtime::spawn_blocking(move || match request {
            Request::Begin {
                id,
                plugin_id,
                expected_revision,
            } => {
                let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
                crate::workspaces::with_authorization_session(
                    &app,
                    &label,
                    &authorization,
                    |location| {
                        let disables = app.state::<Disables>();
                        let mut jobs = disables.0.lock().map_err(|_| UNAVAILABLE)?;
                        if let Some(job) = jobs.get(&scope) {
                            job.check_begin(&id)?;
                        }
                        let root = crate::files::local_root(&app, location)?.ok_or(UNAVAILABLE)?;
                        let listing = situate_core::plugins::runtime::list(&root)?;
                        if listing.revision != expected_revision {
                            return Err("native.plugins.stateConflict".into());
                        }
                        let affected = affected(&plugin_id, &listing);
                        let incarnations = capture_incarnations(&affected, &listing)?;
                        let gate = crate::plugin_actions::begin_disable(&app, &scope, &affected)?;
                        let job = Arc::new(Disable {
                            id,
                            plugin_id,
                            window: label.clone(),
                            authorization: authorization.clone(),
                            affected,
                            incarnations,
                            expected_revision,
                            cancel: CancellationToken::new(),
                            state: Mutex::new(State {
                                phase: Phase::Waiting,
                                error: None,
                                gate: Some(Arc::new(gate)),
                            }),
                        });
                        let snapshot = job.snapshot(crate::plugin_actions::activity(
                            &app,
                            &scope,
                            &job.affected,
                        )?)?;
                        jobs.insert(scope.clone(), job.clone());
                        tauri::async_runtime::spawn(run(app.clone(),scope.clone(), job));
                        Ok(snapshot)
                    },
                )
            }
            request => {
                let id = match &request {
                    Request::Status { id } | Request::Cancel { id } | Request::Stop { id } => id,
                    _ => unreachable!(),
                };
                let job = app.state::<Disables>().owned(&scope, &label, id)?;
                let observed_phase = job.state.lock().map_err(|_| UNAVAILABLE)?.phase;
                let reconciliation = if matches!(&request, Request::Status { .. } | Request::Stop { .. })
                    && matches!(observed_phase, Phase::Waiting | Phase::Uncertain)
                {
                    Some(crate::workspaces::with_authorized_read(
                        &app,
                        &label,
                        &job.authorization,
                        |location| {
                            crate::files::local_root(&app, location)?.ok_or(UNAVAILABLE.into())
                        },
                        |root| situate_core::plugins::runtime::list(root),
                    ))
                } else {
                    None
                };
                let mut authorized = false;
                let result = crate::workspaces::with_authorized_control(
                    &app,
                    &label,
                    &job.authorization,
                    || {
                        authorized = true;
                        if let Some(reconciliation) = reconciliation {
                            job.reconcile_observation(&reconciliation?, observed_phase)?;
                        }
                        match request {
                            Request::Cancel { .. } => job.cancel()?,
                            Request::Stop { .. } => {
                                let state = job.state.lock().map_err(|_| UNAVAILABLE)?;
                                if state.waiting() {
                                    app.emit(
                                    "plugin-actions-stop",
                                    serde_json::json!({"scope": scope, "pluginIds": job.affected, "incarnations": job.incarnations}),
                                )
                                .map_err(|_| UNAVAILABLE)?;
                                    crate::plugin_host::stop_affected(&app, &scope, &job.incarnations)?;
                                }
                            }
                            _ => {}
                        }
                        job.snapshot(crate::plugin_actions::activity(
                            &app,
                            &scope,
                            &job.affected,
                        )?)
                    },
                );
                if !authorized {
                    app.state::<Disables>().discard_expired(
                        &scope,
                        &job,
                        crate::workspaces::authorization_expired(&app, &label, &job.authorization),
                    );
                }
                result
            }
        })
        .await
        .map_err(|_| UNKNOWN.to_owned())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (app, window, scope, request);
        Err(UNAVAILABLE.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};

    const ID: &str = "c7bff8e3-8c12-41d2-940c-fdd405c922f5";

    fn job() -> (Arc<Disable>, impl Fn() -> bool) {
        let (gate, admission) = crate::plugin_actions::test_publication_gate();
        (
            Arc::new(Disable {
                id: ID.into(),
                plugin_id: "sample".into(),
                window: "main".into(),
                authorization: crate::workspaces::AuthorizationSession::for_test(),
                affected: vec!["sample".into()],
                incarnations: HashMap::from([("sample".into(), "sample-installation".into())]),
                expected_revision: None,
                cancel: CancellationToken::new(),
                state: Mutex::new(State {
                    phase: Phase::Waiting,
                    error: None,
                    gate: Some(Arc::new(gate)),
                }),
            }),
            admission,
        )
    }

    #[test]
    fn strict_request_and_snapshot_contract() {
        for value in [
            json!({"operation":"begin","id":ID,"pluginId":"sample"}),
            json!({"operation":"begin","id":ID,"pluginId":"sample","expectedRevision":4}),
            json!({"operation":"begin","id":ID,"pluginId":"sample","expectedRevision":null,"enabled":false}),
            json!({"operation":"begin","pluginId":"sample","expectedRevision":null}),
            json!({"operation":"begin","id":"invalid","pluginId":"sample","expectedRevision":null}),
            json!({"operation":"begin","id":null,"pluginId":"sample","expectedRevision":null}),
            json!({"operation":"status","id":"one","scope":"other"}),
            json!({"operation":"cancel"}),
            json!({"operation":"abort","id":"one"}),
        ] {
            assert!(serde_json::from_value::<Request>(value).is_err());
        }
        for value in [
            json!({"operation":"begin","id":ID,"pluginId":"sample","expectedRevision":null}),
            json!({"operation":"begin","id":ID,"pluginId":"sample","expectedRevision":"revision"}),
            json!({"operation":"status","id":"one"}),
            json!({"operation":"cancel","id":"one"}),
            json!({"operation":"stop","id":"one"}),
        ] {
            assert!(serde_json::from_value::<Request>(value).is_ok());
        }
        let (job, _) = job();
        assert_eq!(
            serde_json::to_value(
                job.snapshot((
                    vec![RunningAction {
                        plugin_id: "consumer".into(),
                        count: 2
                    }],
                    3
                ))
                .unwrap()
            )
            .unwrap(),
            json!({"id":ID,"pluginId":"sample","phase":"waiting","runningActions":[{"pluginId":"consumer","count":2}],"pendingRequests":3,"error":null})
        );
    }

    #[test]
    fn cancel_before_commit_reopens_admission_and_prevents_delayed_mutation() {
        let (job, admission) = job();
        assert!(!admission());
        job.cancel().unwrap();
        assert!(admission());
        let wrote = AtomicBool::new(false);
        assert_eq!(
            job.commit(|| {
                wrote.store(true, Ordering::SeqCst);
                Ok(())
            }),
            Err("native.plugins.hostCancelled".into())
        );
        assert!(!wrote.load(Ordering::SeqCst));
        job.finish(Err(UNKNOWN.into()));
        let snapshot = job.snapshot((vec![], 0)).unwrap();
        assert_eq!(snapshot.phase, Phase::Cancelled);
        assert!(snapshot.error.is_none());
    }

    #[test]
    fn commit_wins_cancel_and_retains_gate_until_actual_outcome() {
        let (job, admission) = job();
        let (entered, ready) = std::sync::mpsc::sync_channel(0);
        let (release, released) = std::sync::mpsc::sync_channel(0);
        let worker = job.clone();
        let thread = std::thread::spawn(move || {
            let result = worker.commit(|| {
                entered.send(()).unwrap();
                released.recv().unwrap();
                Ok(())
            });
            worker.finish(result);
        });
        ready.recv().unwrap();
        job.cancel().unwrap();
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Saving);
        assert!(!job.cancel.is_cancelled());
        assert!(!admission());
        release.send(()).unwrap();
        thread.join().unwrap();
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Disabled);
        assert!(admission());
        job.cancel().unwrap();
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Disabled);
    }

    #[test]
    fn terminal_outcomes_are_retained_and_never_rewritten_by_cancel() {
        for (result, phase) in [
            (Err(UNKNOWN.into()), Phase::Uncertain),
            (Err("native.plugins.stateConflict".into()), Phase::Failed),
        ] {
            let (job, admission) = job();
            assert!(job.saving().unwrap());
            job.finish(result);
            job.cancel().unwrap();
            let snapshot = job.snapshot((vec![], 0)).unwrap();
            assert_eq!(snapshot.phase, phase);
            assert!(snapshot.error.is_some());
            assert_eq!(admission(), phase != Phase::Uncertain);
            assert_eq!(job.check_begin(ID), Err(BUSY.into()));
            assert_eq!(
                job.check_begin("different"),
                if phase == Phase::Uncertain {
                    Err(BUSY.into())
                } else {
                    Ok(())
                }
            );
        }
    }

    fn listing(
        revision: Option<&str>,
        plugins: &[(&str, bool)],
    ) -> situate_core::plugins::runtime::Listing {
        situate_core::plugins::runtime::Listing {
            revision: revision.map(str::to_owned),
            plugins: plugins
                .iter()
                .map(|(id, enabled)| situate_core::plugins::runtime::Summary {
                    id: (*id).into(),
                    enabled: *enabled,
                    manifest: None,
                    error: None,
                    revision: None,
                    incarnation: Some(format!("{id}-installation")),
                })
                .collect(),
        }
    }

    #[test]
    fn uncertain_status_retains_admission_until_all_affected_installed_plugins_are_disabled() {
        let (mut job, admission) = job();
        let setup = Arc::get_mut(&mut job).unwrap();
        setup.expected_revision = Some("original".into());
        setup.affected.push("consumer".into());
        setup
            .incarnations
            .insert("consumer".into(), "consumer-installation".into());
        let result = job.commit(|| Err(UNKNOWN.into()));
        job.finish(result);
        assert!(!admission());
        assert_eq!(job.check_begin("different"), Err(BUSY.into()));
        job.cancel().unwrap();
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Uncertain);
        assert!(!admission());
        for current in [
            listing(
                Some("changed"),
                &[("sample", true), ("consumer", true), ("other", false)],
            ),
            listing(Some("changed"), &[("sample", false), ("consumer", true)]),
        ] {
            job.reconcile_observation(&current, Phase::Uncertain)
                .unwrap();
            assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Uncertain);
            assert!(!admission());
        }
        job.reconcile_observation(
            &listing(
                Some("saved"),
                &[("sample", false), ("consumer", false), ("other", true)],
            ),
            Phase::Uncertain,
        )
        .unwrap();
        let snapshot = job.snapshot((vec![], 0)).unwrap();
        assert_eq!(snapshot.phase, Phase::Disabled);
        assert!(snapshot.error.is_none());
        assert!(admission());
        assert!(job.commit(|| panic!("status repeated write")).is_err());
    }

    #[test]
    fn unchanged_durable_revision_resolves_uncertainty_as_not_saved_including_legacy_none() {
        for expected in [None, Some("original")] {
            let (mut job, admission) = job();
            Arc::get_mut(&mut job).unwrap().expected_revision = expected.map(str::to_owned);
            assert!(job.saving().unwrap());
            job.finish(Err(UNKNOWN.into()));
            job.reconcile_observation(&listing(expected, &[("sample", true)]), Phase::Uncertain)
                .unwrap();
            let snapshot = job.snapshot((vec![], 0)).unwrap();
            assert_eq!(snapshot.phase, Phase::Failed);
            assert_eq!(
                snapshot.error.as_deref(),
                Some("native.plugins.stateSaveFailed")
            );
            assert!(admission());
            assert!(job.check_begin("different").is_ok());
            assert_eq!(job.check_begin(ID), Err(BUSY.into()));
        }
    }

    #[test]
    fn closing_or_discarding_stale_uncertain_jobs_releases_retained_gates() {
        for stale in [false, true] {
            let jobs = Disables::default();
            let (job, admission) = job();
            jobs.0
                .lock()
                .unwrap()
                .insert("workspace".into(), job.clone());
            assert!(job.saving().unwrap());
            job.finish(Err(UNKNOWN.into()));
            assert!(!admission());
            if stale {
                jobs.discard_expired("workspace", &job, Ok(true));
            } else {
                jobs.invalidate("workspace");
            }
            assert!(admission());
            assert!(jobs.owned("workspace", "main", ID).is_err());
            assert!(
                job.commit(|| panic!("invalidated uncertain job wrote"))
                    .is_err()
            );
        }
    }

    #[test]
    fn temporary_admission_rejection_keeps_unresolved_jobs_recoverable_and_gates_closed() {
        for uncertain in [false, true] {
            for expired in [Ok(false), Err("native.workspace.state.unavailable".into())] {
                let jobs = Disables::default();
                let (job, admission) = job();
                jobs.0
                    .lock()
                    .unwrap()
                    .insert("workspace".into(), job.clone());
                if uncertain {
                    assert!(job.saving().unwrap());
                    job.finish(Err(UNKNOWN.into()));
                }
                jobs.discard_expired("workspace", &job, expired);
                assert!(!admission());
                let retained = jobs.owned("workspace", "main", ID).unwrap();
                assert_eq!(retained.check_begin("different"), Err(BUSY.into()));
                assert_eq!(
                    retained.snapshot((vec![], 0)).unwrap().phase,
                    if uncertain {
                        Phase::Uncertain
                    } else {
                        Phase::Waiting
                    }
                );
                if uncertain {
                    retained
                        .reconcile_observation(
                            &listing(Some("saved"), &[("sample", false)]),
                            Phase::Uncertain,
                        )
                        .unwrap();
                    assert_eq!(
                        retained.snapshot((vec![], 0)).unwrap().phase,
                        Phase::Disabled
                    );
                } else {
                    retained.cancel().unwrap();
                    assert_eq!(
                        retained.snapshot((vec![], 0)).unwrap().phase,
                        Phase::Cancelled
                    );
                }
                assert!(admission());
            }
        }
    }

    #[test]
    fn repeated_begin_ids_never_restart_retained_jobs() {
        for phase in [
            Phase::Waiting,
            Phase::Saving,
            Phase::Uncertain,
            Phase::Cancelled,
            Phase::Disabled,
            Phase::Failed,
        ] {
            let (job, _) = job();
            job.state.lock().unwrap().phase = phase;
            assert_eq!(job.check_begin(ID), Err(BUSY.into()));
            let blocked = matches!(phase, Phase::Waiting | Phase::Saving | Phase::Uncertain);
            assert_eq!(job.check_begin("different").is_err(), blocked);
        }
        let request: Request = serde_json::from_value(
            json!({"operation":"begin","id":ID,"pluginId":"sample","expectedRevision":null}),
        )
        .unwrap();
        assert!(matches!(request, Request::Begin { id, .. } if id == ID));
    }

    #[test]
    fn status_ids_are_scope_and_window_owned_and_close_discards_jobs() {
        let jobs = Disables::default();
        let (job, admission) = job();
        jobs.0
            .lock()
            .unwrap()
            .insert("workspace".into(), job.clone());
        assert!(jobs.owned("other", "main", &job.id).is_err());
        assert!(jobs.owned("workspace", "other", &job.id).is_err());
        assert!(jobs.owned("workspace", "main", "stale").is_err());
        assert!(Arc::ptr_eq(
            &jobs.owned("workspace", "main", &job.id).unwrap(),
            &job
        ));
        jobs.invalidate("workspace");
        assert!(jobs.owned("workspace", "main", &job.id).is_err());
        assert!(job.cancel.is_cancelled());
        assert!(admission());
        assert!(job.commit(|| panic!("closed job wrote")).is_err());
    }

    #[test]
    fn expired_or_reopened_authorization_prevents_commit() {
        use crate::workspaces::{TestSessionChange, with_test_authorized_root};
        let root = tempfile::tempdir().unwrap();
        let location = situate_core::workspaces::Location {
            id: "workspace".into(),
            name: "Workspace".into(),
            display: "Workspace".into(),
            kind: "path".into(),
            handle: root.path().to_string_lossy().into_owned(),
        };
        for change in [TestSessionChange::Close, TestSessionChange::Reopen] {
            let (job, _) = job();
            let result = with_test_authorized_root(
                &[("main", location.clone())],
                "main",
                "workspace",
                true,
                change,
                |_| job.commit(|| panic!("expired session wrote")),
            );
            assert!(result.is_err());
            assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Waiting);
        }
    }

    fn installed_job() -> (tempfile::TempDir, Arc<Disable>, impl Fn() -> bool) {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        for (id, dependencies) in [("sample", vec![]), ("consumer", vec!["sample"])] {
            install(root.path(), id, dependencies);
            let revision = situate_core::plugins::runtime::list(root.path())
                .unwrap()
                .revision;
            situate_core::plugins::runtime::set_enabled(root.path(), id, true, revision.as_deref())
                .unwrap();
        }
        let listing = situate_core::plugins::runtime::list(root.path()).unwrap();
        let (mut job, admission) = job();
        let setup = Arc::get_mut(&mut job).unwrap();
        setup.affected = affected("sample", &listing);
        setup.incarnations = capture_incarnations(&setup.affected, &listing).unwrap();
        setup.expected_revision = listing.revision;
        (root, job, admission)
    }

    fn install(root: &std::path::Path, id: &str, dependencies: Vec<&str>) {
        let code = root.join(format!(".situate/plugins/{id}/code"));
        std::fs::create_dir_all(&code).unwrap();
        std::fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":id,"name":id,"description":"Synthetic plugin","serviceEntry":"entry.js","dependencies":dependencies}).to_string()).unwrap();
        std::fs::write(code.join("entry.js"), "export default {};").unwrap();
    }

    fn remove_or_replace(root: &std::path::Path, id: &str, replace: bool) {
        std::fs::remove_dir_all(root.join(format!(".situate/plugins/{id}"))).unwrap();
        if replace {
            install(
                root,
                id,
                if id == "consumer" {
                    vec!["sample"]
                } else {
                    vec![]
                },
            );
        }
    }

    #[test]
    fn delayed_write_never_disables_replacements_or_recreates_removed_installations() {
        for id in ["sample", "consumer"] {
            for replace in [false, true] {
                let (root, job, admission) = installed_job();
                remove_or_replace(root.path(), id, replace);
                let before = situate_core::plugins::runtime::list(root.path()).unwrap();
                let result = job.commit(|| job.write_disabled(root.path()));
                assert_eq!(result, Err("native.plugins.stateConflict".into()));
                job.finish(result);
                assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Failed);
                assert!(admission());
                let after = situate_core::plugins::runtime::list(root.path()).unwrap();
                assert_eq!(
                    serde_json::to_value(after).unwrap(),
                    serde_json::to_value(before).unwrap()
                );
                assert_eq!(
                    root.path().join(format!(".situate/plugins/{id}")).exists(),
                    replace
                );
            }
        }
    }

    #[test]
    fn removal_or_replacement_during_wait_or_uncertainty_releases_stale_gates_without_writing() {
        for phase in [Phase::Waiting, Phase::Uncertain] {
            for id in ["sample", "consumer"] {
                for replace in [false, true] {
                    let (root, job, admission) = installed_job();
                    if phase == Phase::Uncertain {
                        assert!(job.saving().unwrap());
                        job.finish(Err(UNKNOWN.into()));
                    }
                    assert!(!admission());
                    remove_or_replace(root.path(), id, replace);
                    let listing = situate_core::plugins::runtime::list(root.path()).unwrap();
                    job.reconcile_observation(&listing, phase).unwrap();
                    let snapshot = job.snapshot((vec![], 0)).unwrap();
                    assert_eq!(snapshot.phase, Phase::Failed);
                    assert_eq!(
                        snapshot.error.as_deref(),
                        Some("native.plugins.stateConflict")
                    );
                    assert!(admission());
                    assert!(job.commit(|| panic!("stale job wrote")).is_err());
                    assert_eq!(
                        serde_json::to_value(
                            situate_core::plugins::runtime::list(root.path()).unwrap()
                        )
                        .unwrap(),
                        serde_json::to_value(listing).unwrap(),
                    );
                    assert_eq!(
                        root.path().join(format!(".situate/plugins/{id}")).exists(),
                        replace
                    );
                }
            }
        }
    }

    #[test]
    fn waiting_status_read_cannot_resolve_a_later_uncertain_write() {
        let (job, admission) = job();
        let before = listing(None, &[("sample", true)]);
        assert!(job.saving().unwrap());
        job.finish(Err(UNKNOWN.into()));
        job.reconcile_observation(&before, Phase::Waiting).unwrap();
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Uncertain);
        assert!(!admission());
    }

    #[test]
    fn affected_closure_matches_atomic_disable_and_revision_conflicts_do_not_write() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        for (id, dependencies) in [
            ("sample", vec![]),
            ("consumer", vec!["sample"]),
            ("indirect", vec!["consumer", "sample"]),
            ("unrelated", vec![]),
        ] {
            install(root.path(), id, dependencies);
            let revision = situate_core::plugins::runtime::list(root.path())
                .unwrap()
                .revision;
            situate_core::plugins::runtime::set_enabled(root.path(), id, true, revision.as_deref())
                .unwrap();
        }
        let listing = situate_core::plugins::runtime::list(root.path()).unwrap();
        assert_eq!(
            affected("sample", &listing),
            vec!["consumer", "indirect", "sample"]
        );
        let (job, _) = job();
        let result = job.commit(|| {
            situate_core::plugins::runtime::set_enabled(root.path(), "sample", false, Some("stale"))
                .map(|_| ())
        });
        job.finish(result);
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Failed);
        assert!(
            situate_core::plugins::runtime::list(root.path())
                .unwrap()
                .plugins
                .iter()
                .all(|p| p.enabled)
        );
        let (mut job, admission) = self::job();
        let setup = Arc::get_mut(&mut job).unwrap();
        setup.expected_revision = listing.revision.clone();
        setup.affected = vec!["sample".into(), "consumer".into(), "indirect".into()];
        setup.incarnations = capture_incarnations(&setup.affected, &listing).unwrap();
        let retained = root
            .path()
            .join(".situate/plugins/sample/data/settings.json");
        std::fs::create_dir_all(retained.parent().unwrap()).unwrap();
        std::fs::write(&retained, b"synthetic settings").unwrap();
        let result = job.commit(|| {
            job.write_disabled(root.path())?;
            Err(UNKNOWN.into())
        });
        job.finish(result);
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Uncertain);
        assert!(!admission());
        let path = root
            .path()
            .join(".situate/plugins/sample/.runtime/runtime-state.json");
        let saved = std::fs::read(&path).unwrap();
        let listing = situate_core::plugins::runtime::list(root.path()).unwrap();
        job.reconcile_observation(&listing, Phase::Uncertain)
            .unwrap();
        assert_eq!(job.snapshot((vec![], 0)).unwrap().phase, Phase::Disabled);
        assert!(admission());
        job.reconcile_observation(&listing, Phase::Disabled)
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), saved);
        assert_eq!(std::fs::read(retained).unwrap(), b"synthetic settings");
        assert!(
            root.path()
                .join(".situate/plugins/sample/code/entry.js")
                .exists()
        );
        for plugin in listing.plugins {
            assert_eq!(plugin.enabled, plugin.id == "unrelated");
        }
    }
}
