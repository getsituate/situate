use super::{
    Snapshot, Updates,
    cache::Cache,
    diagnostics,
    policy::{self, Phase, Retry},
};
use sha2::{Digest, Sha256};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
#[path = "feed.rs"]
mod feed;

pub struct Native {
    pub cache: Cache,
    pub data: Mutex<Data>,
    pub working: AtomicBool,
    pub disabled: AtomicBool,
    initialized: AtomicBool,
}
pub struct Data {
    pub verified: Option<Update>,
    verified_bytes: u64,
    candidate: Option<Update>,
    check_retry: Retry,
    download_retry: Retry,
    discovery_needed: bool,
}
pub(super) fn artifact_id(update: &Update) -> String {
    let mut digest = Sha256::new();
    digest.update(update.version.as_bytes());
    digest.update([0]);
    digest.update(update.signature.as_bytes());
    digest.update([0]);
    digest.update(update.download_url.as_str().as_bytes());
    format!("{:x}", digest.finalize())
}
impl Data {
    pub(super) fn confirmed(&self, id: &str) -> Result<Update, String> {
        self.verified
            .as_ref()
            .filter(|update| artifact_id(update) == id)
            .cloned()
            .ok_or_else(|| "native.updates.changed".into())
    }
    fn present(&self, snapshot: &mut Snapshot, phase: Phase, error: Option<String>) {
        snapshot.error = error;
        snapshot.artifact_id = self.verified.as_ref().map(artifact_id);
        if let Some(update) = &self.verified {
            snapshot.phase = Phase::Ready;
            snapshot.available_version = Some(update.version.clone());
            snapshot.downloaded_bytes = self.verified_bytes;
            snapshot.total_bytes = Some(self.verified_bytes);
        } else {
            snapshot.phase = phase;
        }
    }
    fn due(&mut self, now: u64, last: Option<u64>, manual: bool, connected: Option<bool>) -> bool {
        self.check_retry.reconcile_clock(now);
        self.download_retry.reconcile_clock(now);
        if connected == Some(true) {
            self.check_retry.connected();
        }
        manual
            || self.candidate.is_some() && now >= self.download_retry.due
            || self.discovery_needed && now >= self.check_retry.due
            || policy::check_due(now, last, &self.check_retry)
    }
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
fn endpoint() -> Result<url::Url, String> {
    let url = url::Url::parse(
        option_env!("SITUATE_UPDATER_ENDPOINT").unwrap_or(policy::DEFAULT_ENDPOINT),
    )
    .map_err(|_| "native.updates.invalidConfiguration")?;
    if !policy::secure_url(&url) {
        return Err("native.updates.invalidConfiguration".into());
    }
    Ok(url)
}
fn secure_client(client: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    client
        .https_only(true)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 || !policy::secure_url(attempt.url()) {
                attempt.error("Unsafe update redirect")
            } else {
                attempt.follow()
            }
        }))
}
fn reachable(flags: system_configuration::network_reachability::ReachabilityFlags) -> bool {
    use system_configuration::network_reachability::ReachabilityFlags;
    flags.contains(ReachabilityFlags::REACHABLE)
        && !flags.contains(ReachabilityFlags::CONNECTION_REQUIRED)
}
fn network_available() -> Option<bool> {
    use system_configuration::network_reachability::SCNetworkReachability;
    let available = [
        std::net::SocketAddr::from(([0, 0, 0, 0], 0)),
        std::net::SocketAddr::from(([0u16; 8], 0)),
    ]
    .into_iter()
    .map(|address| {
        SCNetworkReachability::from(address)
            .reachability()
            .ok()
            .map(reachable)
    })
    .collect::<Vec<_>>();
    if available.contains(&Some(true)) {
        Some(true)
    } else if available.iter().all(Option::is_some) {
        Some(false)
    } else {
        None
    }
}
async fn bounded_check(
    client: reqwest::Client,
    url: url::Url,
) -> Result<Option<serde_json::Value>, (String, bool, &'static str)> {
    tokio::time::timeout(Duration::from_secs(30), feed::fetch(client, url))
        .await
        .map_err(|_| {
            (
                "native.updates.checkFailed".to_owned(),
                network_available() == Some(false),
                "timeout",
            )
        })?
        .map_err(|e| {
            let offline = matches!(&e, feed::Error::Request(e) if e.is_connect())
                && network_available() == Some(false);
            let class = match &e {
                feed::Error::Request(error) => diagnostics::request_error(error),
                feed::Error::Invalid => "invalid_response",
            };
            ("native.updates.checkFailed".to_owned(), offline, class)
        })
}
pub fn updater<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    include_installed: bool,
) -> Result<Updater, String> {
    app.updater_builder()
        .version_comparator(move |current, release| include_installed || release.version > current)
        .endpoints(vec![endpoint()?])
        .map_err(|_| "native.updates.invalidConfiguration")?
        .configure_client(secure_client)
        .build()
        .map_err(|_| "native.updates.invalidConfiguration".into())
}
pub fn service(app: &tauri::AppHandle) -> Result<Arc<Native>, String> {
    let state = app.state::<Updates>();
    if !state
        .snapshot
        .lock()
        .map_err(|_| "native.updates.busy")?
        .supported
    {
        return Err("native.updates.unsupported".into());
    }
    let service = state
        .native
        .lock()
        .map_err(|_| "native.updates.busy")?
        .clone()
        .ok_or("native.updates.invalidConfiguration")?;
    if !service.initialized.load(Ordering::Acquire) {
        return Err("native.updates.busy".into());
    }
    Ok(service)
}
pub fn setup(app: &tauri::AppHandle) {
    if !policy::direct(option_env!("SITUATE_DISTRIBUTION"), true) {
        return;
    }
    let result = (|| {
        let key = option_env!("SITUATE_UPDATER_PUBLIC_KEY")
            .filter(|v| !v.trim().is_empty())
            .ok_or("native.updates.invalidConfiguration")?;
        endpoint()?;
        app.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(key.trim())
                .build(),
        )
        .map_err(|_| "native.updates.invalidConfiguration")?;
        let cache = Cache::open(
            app.path()
                .app_local_data_dir()
                .map_err(|_| "native.updates.cacheFailed")?
                .join("updates"),
        )?;
        Ok::<_, String>(Arc::new(Native {
            cache,
            data: Mutex::new(Data {
                verified: None,
                verified_bytes: 0,
                candidate: None,
                check_retry: Retry::default(),
                download_retry: Retry::default(),
                discovery_needed: false,
            }),
            working: AtomicBool::new(false),
            disabled: AtomicBool::new(false),
            initialized: AtomicBool::new(false),
        }))
    })();
    let service = match result {
        Ok(service) => service,
        Err(error) => {
            diagnostics::record(app, "setup", Some(&error), false);
            app.state::<Updates>().change(app, |s| {
                s.phase = Phase::CheckFailed;
                s.error = Some(error);
            });
            return;
        }
    };
    diagnostics::record(app, "setup", None, false);
    *app.state::<Updates>().native.lock().unwrap() = Some(service.clone());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let owner = service.clone();
        let handle = app.clone();
        diagnostics::record(&app, "cache_restore_started", None, false);
        let restored = tauri::async_runtime::spawn_blocking(move || owner.restore(&handle)).await;
        let restore_error = match &restored {
            Ok(Ok(())) => None,
            Ok(Err(error)) => Some(error.as_str()),
            Err(tauri::Error::JoinError(error)) if error.is_panic() => Some("panic"),
            Err(_) => Some("interrupted"),
        };
        diagnostics::record(&app, "cache_restore_finished", restore_error, false);
        if !matches!(restored, Ok(Ok(()))) {
            if !service.cache.interrupted() {
                let _ = service.cache.clear();
                let _ = service.cache.clear_pending();
                service.data.lock().unwrap().discovery_needed = true;
            }
            app.state::<Updates>().change(&app, |s| {
                s.phase = Phase::DownloadFailed;
                s.error = Some("native.updates.cacheFailed".into());
            });
        }
        if service.cache.interrupted() {
            service.recovery(&app, false);
        }
        service.initialized.store(true, Ordering::Release);
        loop {
            service.tick(&app).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}
impl Native {
    fn report<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        phase: Phase,
        error: Option<String>,
    ) {
        let data = self.data.lock().unwrap();
        app.state::<Updates>()
            .change(app, |s| data.present(s, phase, error));
    }
    fn restore<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>) -> Result<(), String> {
        app.state::<Updates>().change(app, |s| {
            s.last_successful_check = self.cache.last_check().filter(|t| *t <= now())
        });
        let record = self.cache.record()?;
        self.cache.clean_candidates(record.as_ref())?;
        if let Some(record) = record {
            let installed = &app.package_info().version;
            let update = restored(updater(app, true)?, record.release.clone())?;
            let bytes = self.cache.read(&record)?;
            if update.version != record.version {
                return Err("native.updates.cacheFailed".into());
            }
            update.verify(&bytes).map_err(|error| {
                diagnostics::record(
                    app,
                    "cache_verify",
                    Some(diagnostics::updater_error(&error)),
                    false,
                );
                "native.updates.cacheFailed"
            })?;
            let version = semver::Version::parse(&update.version)
                .map_err(|_| "native.updates.cacheFailed")?;
            if version <= *installed {
                self.cache.clear()?;
                self.cache.clear_installing()?;
            } else {
                let size = bytes.len() as u64;
                let id = artifact_id(&update);
                {
                    let mut data = self.data.lock().map_err(|_| "native.updates.busy")?;
                    data.verified = Some(update);
                    data.verified_bytes = size;
                }
                app.state::<Updates>().change(app, |s| {
                    s.phase = Phase::Ready;
                    s.available_version = Some(record.version);
                    s.artifact_id = Some(id);
                    s.downloaded_bytes = size;
                    s.total_bytes = Some(size);
                    s.error = None;
                });
            }
        }
        if let Err(error) = self.restore_pending(app) {
            diagnostics::record(app, "cache_pending_restore", Some(&error), false);
            let _ = self.cache.clear_pending();
            {
                let mut data = self.data.lock().map_err(|_| "native.updates.busy")?;
                data.candidate = None;
                data.discovery_needed = true;
            }
            self.report(app, Phase::DownloadFailed, Some(error));
        }
        Ok(())
    }
    fn restore_pending<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>) -> Result<(), String> {
        if let Some(raw) = self.cache.pending()? {
            let candidate = updater(app, false)?.restore_update(raw).map_err(|error| {
                diagnostics::record(
                    app,
                    "cache_verify",
                    Some(diagnostics::updater_error(&error)),
                    false,
                );
                "native.updates.cacheFailed"
            })?;
            let mut data = self.data.lock().map_err(|_| "native.updates.busy")?;
            if let Some(candidate) = candidate {
                if data.verified.as_ref().is_none_or(|v| {
                    semver::Version::parse(&candidate.version).ok()
                        > semver::Version::parse(&v.version).ok()
                }) {
                    if !policy::secure_url(&candidate.download_url)
                        || candidate
                            .raw_json
                            .get("distribution")
                            .and_then(|v| v.as_str())
                            != Some("direct")
                    {
                        return Err("native.updates.cacheFailed".into());
                    }
                    data.candidate = Some(candidate);
                } else {
                    self.cache.clear_pending()?;
                }
            } else {
                self.cache.clear_pending()?;
            }
        }
        Ok(())
    }
    pub fn recovery<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, forced: bool) {
        diagnostics::record(app, "recovery", Some("interrupted"), forced);
        self.disabled.store(true, Ordering::Release);
        // A live install retains its sealed preparation; a previous process owns no runtime barriers.
        app.state::<Updates>().change(app, |s| {
            s.phase = Phase::RecoveryRequired;
            s.error = Some("native.updates.recoveryRequired".into());
        });
    }
    async fn tick(self: &Arc<Self>, app: &tauri::AppHandle) {
        if self.disabled.load(Ordering::Acquire) || super::admission_held(app) {
            return;
        }
        let running = crate::ai::has_running_actions(app).unwrap_or(true);
        let changed = app
            .state::<Updates>()
            .snapshot
            .lock()
            .is_ok_and(|s| s.running_actions != running);
        if changed {
            app.state::<Updates>().change(app, |_| {});
        }
        self.check(app.clone(), false);
    }
    pub fn check(self: &Arc<Self>, app: tauri::AppHandle, manual: bool) {
        if !self.initialized.load(Ordering::Acquire)
            || self.disabled.load(Ordering::Acquire)
            || super::admission_held(&app)
        {
            return;
        }
        let due = {
            let mut data = self.data.lock().unwrap();
            let last = app
                .state::<Updates>()
                .snapshot
                .lock()
                .ok()
                .and_then(|s| s.last_successful_check);
            // Local route observation sends no probe request and never bypasses server-error backoff.
            data.due(now(), last, manual, network_available())
        };
        if !due
            || self
                .working
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return;
        }
        let owner = self.clone();
        self.report(&app, Phase::Checking, None);
        tauri::async_runtime::spawn(async move {
            let pending = {
                let data = owner.data.lock().unwrap();
                let last = app
                    .state::<Updates>()
                    .snapshot
                    .lock()
                    .ok()
                    .and_then(|s| s.last_successful_check);
                if data.discovery_needed || policy::check_due(now(), last, &data.check_retry) {
                    None
                } else {
                    data.candidate.clone()
                }
            };
            if let Some(update) = pending {
                owner.download(&app, update).await;
            } else {
                owner.discover(&app).await;
            }
            owner.working.store(false, Ordering::Release);
        });
    }
    async fn discover(&self, app: &tauri::AppHandle) {
        diagnostics::record(app, "check_started", None, false);
        let result = async {
            let updater = updater(app, false).map_err(|e| (e, false, "configuration"))?;
            let client = secure_client(reqwest::Client::builder())
                .build()
                .map_err(|e| {
                    (
                        "native.updates.checkFailed".into(),
                        false,
                        diagnostics::request_error(&e),
                    )
                })?;
            let checked =
                bounded_check(client, endpoint().map_err(|e| (e, false, "configuration"))?).await?;
            let checked = checked
                .map(|raw| release(updater, raw))
                .transpose()
                .map_err(|(e, class)| (e, false, class))?
                .flatten();
            Ok::<_, (String, bool, &'static str)>(checked)
        }
        .await;
        match result {
            Ok(update) => {
                let time = now();
                let persisted = match &update {
                    Some(update) => self.cache.save_pending(&update.raw_json),
                    None => self.cache.clear_pending(),
                }
                .and_then(|()| self.cache.save_check(time));
                if persisted.is_err() {
                    diagnostics::record(app, "check_finished", Some("cache"), false);
                    self.report(
                        app,
                        Phase::CheckFailed,
                        Some("native.updates.cacheFailed".into()),
                    );
                    self.data.lock().unwrap().check_retry.failed(time, false);
                    return;
                }
                diagnostics::record(app, "check_finished", None, false);
                {
                    let mut data = self.data.lock().unwrap();
                    data.check_retry.succeeded();
                    data.discovery_needed = false;
                }
                app.state::<Updates>().change(app, |s| {
                    s.last_successful_check = Some(time);
                    s.error = None;
                });
                if let Some(update) = update {
                    let retained = self.data.lock().unwrap().verified.clone();
                    if retained.as_ref().is_some_and(|v| {
                        semver::Version::parse(&v.version).ok()
                            >= semver::Version::parse(&update.version).ok()
                    }) {
                        let _ = self.cache.clear_pending();
                        app.state::<Updates>().change(app, |s| {
                            s.phase = Phase::Ready;
                            s.available_version = retained.map(|u| u.version);
                        });
                    } else {
                        self.download(app, update).await;
                    }
                } else {
                    let retained = self.data.lock().unwrap().verified.is_some();
                    app.state::<Updates>().change(app, |s| {
                        s.phase = if retained {
                            Phase::Ready
                        } else {
                            Phase::Current
                        };
                    });
                }
            }
            Err((error, offline, class)) => {
                diagnostics::record(app, "check_finished", Some(class), false);
                self.data.lock().unwrap().check_retry.failed(now(), offline);
                self.report(app, Phase::CheckFailed, Some(error));
            }
        }
    }
    async fn download(&self, app: &tauri::AppHandle, update: Update) {
        diagnostics::record(app, "download_started", None, false);
        self.data.lock().unwrap().candidate = Some(update.clone());
        let retained = self.data.lock().unwrap().verified.is_some();
        if !retained {
            app.state::<Updates>().change(app, |s| {
                s.available_version = Some(update.version.clone());
                s.downloaded_bytes = 0;
                s.total_bytes = None;
            });
        }
        self.report(app, Phase::Downloading, None);
        let mut downloaded = 0u64;
        let mut expected = None;
        let mut last_event = std::time::Instant::now();
        let result = update
            .download(
                |size, total| {
                    downloaded = downloaded.saturating_add(size as u64);
                    expected = total;
                    if !retained && last_event.elapsed() >= Duration::from_millis(250) {
                        app.state::<Updates>().change(app, |s| {
                            s.downloaded_bytes = downloaded;
                            s.total_bytes = total;
                        });
                        last_event = std::time::Instant::now();
                    }
                },
                || {},
            )
            .await;
        if !retained {
            app.state::<Updates>().change(app, |s| {
                s.downloaded_bytes = downloaded;
                s.total_bytes = expected;
            });
        }
        // The library's finished callback runs before signature verification. Only its successful return is ready.
        let result = match result {
            Ok(bytes) => self
                .cache
                .retain(update.version.clone(), update.raw_json.clone(), &bytes)
                .inspect_err(|_| {
                    diagnostics::record(app, "download_finished", Some("cache"), false)
                }),
            Err(error) => {
                diagnostics::record(
                    app,
                    "download_finished",
                    Some(diagnostics::updater_error(&error)),
                    false,
                );
                Err("native.updates.downloadFailed".into())
            }
        };
        match result {
            Ok(()) => {
                diagnostics::record(app, "download_finished", None, false);
                let mut data = self.data.lock().unwrap();
                data.verified = Some(update);
                data.verified_bytes = downloaded;
                data.candidate = None;
                data.download_retry.succeeded();
                let _ = self.cache.clear_pending();
                drop(data);
                self.report(app, Phase::Ready, None);
            }
            Err(error) => {
                self.data
                    .lock()
                    .unwrap()
                    .download_retry
                    .failed(now(), false);
                self.report(app, Phase::DownloadFailed, Some(error));
            }
        }
    }
}
#[cfg(test)]
#[path = "native_tests.rs"]
mod tests;

fn restored(updater: Updater, raw: serde_json::Value) -> Result<Update, String> {
    release(updater, raw)
        .map_err(|(error, _)| error)?
        .ok_or_else(|| "native.updates.checkFailed".into())
}
fn release(
    updater: Updater,
    raw: serde_json::Value,
) -> Result<Option<Update>, (String, &'static str)> {
    if raw.get("distribution").and_then(|v| v.as_str()) != Some("direct") {
        return Err(("native.updates.checkFailed".into(), "invalid_response"));
    }
    // restore_update forces signed-version verification even if a merged plugin config changed its default.
    let update = updater.restore_update(raw).map_err(|error| {
        (
            "native.updates.checkFailed".into(),
            diagnostics::updater_error(&error),
        )
    })?;
    if update
        .as_ref()
        .is_some_and(|u| !policy::secure_url(&u.download_url))
    {
        return Err(("native.updates.checkFailed".into(), "configuration"));
    }
    Ok(update)
}
