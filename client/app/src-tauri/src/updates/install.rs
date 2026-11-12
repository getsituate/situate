use super::{Updates, native::Native, policy::Phase};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::Path,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tauri::Manager;

const ERROR: &str = "native.updates.installFailed";
impl Native {
    pub fn install(
        self: &Arc<Self>,
        app: tauri::AppHandle,
        abort_running: bool,
        artifact_id: String,
        forced: bool,
    ) -> Result<(), String> {
        let abort_running = abort_running || forced;
        super::diagnostics::record(&app, "install_requested", None, forced);
        if self.disabled.load(Ordering::Acquire) {
            super::diagnostics::record(
                &app,
                "install_requested",
                Some("native.updates.recoveryRequired"),
                forced,
            );
            return Err("native.updates.recoveryRequired".into());
        }
        if super::admission_held(&app) {
            super::diagnostics::record(
                &app,
                "install_requested",
                Some("native.updates.busy"),
                forced,
            );
            return Err("native.updates.busy".into());
        }
        if !abort_running && crate::ai::has_running_actions(&app).map_err(|_| ERROR)? {
            super::diagnostics::record(
                &app,
                "install_requested",
                Some("native.updates.runningActions"),
                forced,
            );
            return Err("native.updates.runningActions".into());
        }
        self.working
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                super::diagnostics::record(&app, "install_requested", Some("busy"), forced);
                "native.updates.busy"
            })?;
        let confirmed = self
            .data
            .lock()
            .map_err(|_| ERROR.to_owned())
            .and_then(|data| data.confirmed(&artifact_id));
        if let Err(error) = confirmed {
            super::diagnostics::record(&app, "install_requested", Some(&error), forced);
            self.working.store(false, Ordering::Release);
            return Err(error);
        }
        let owner = self.clone();
        app.state::<Updates>().change(&app, |s| {
            s.phase = Phase::Preparing;
            s.error = None;
        });
        tauri::async_runtime::spawn(async move {
            owner
                .prepare_and_install(&app, abort_running, artifact_id, forced)
                .await;
            owner.working.store(false, Ordering::Release);
        });
        Ok(())
    }
    async fn prepare_and_install(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        abort_running: bool,
        artifact_id: String,
        forced: bool,
    ) {
        super::diagnostics::record(app, "prepare_started", None, forced);
        let token = match app.state::<Updates>().preparation.begin(app, forced) {
            Ok(token) => token,
            Err(error) => {
                self.failed(app, error, forced);
                return;
            }
        };
        let preparation = async {
            super::diagnostics::record(app, "prepare_actions", None, forced);
            let handle = app.clone();
            let stopped =
                tokio::spawn(async move { stop_actions(&handle, abort_running, forced).await });
            let stopped = wait_for_actions(stopped, || {
                super::diagnostics::record(app, "prepare_actions", Some("timeout"), forced);
                app.state::<Updates>().change(app, |s| {
                    s.error = Some("native.updates.stopPending".into());
                });
            })
            .await
            .inspect_err(|error| {
                super::diagnostics::record(app, "prepare_actions", Some(error), forced)
            });
            let ready = app.state::<Updates>().preparation.actions_stopped(&token);
            stopped?;
            ready?;
            super::diagnostics::record(app, "prepare_actions", None, forced);
            super::diagnostics::record(app, "prepare_windows", None, forced);
            if forced {
                crate::dictation::stop_for_update(app)
                    .await
                    .inspect_err(|_| {
                        super::diagnostics::record(
                            app,
                            "prepare_windows",
                            Some("dictation_active"),
                            forced,
                        )
                    })?;
                let handle = app.clone();
                let pause_token = token.clone();
                let paused = tokio::task::spawn_blocking(move || {
                    handle
                        .state::<Updates>()
                        .preparation
                        .force_ready(&pause_token)
                });
                wait_for_actions(paused, || {
                    super::diagnostics::record(app, "prepare_windows", Some("timeout"), forced);
                    app.state::<Updates>().change(app, |s| {
                        s.error = Some("native.updates.stopPending".into());
                    });
                })
                .await?;
            } else {
                let prepared = tokio::time::timeout(Duration::from_secs(30), async {
                    while !app.state::<Updates>().preparation.notify(app, &token)? {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    Ok::<_, String>(())
                })
                .await;
                if prepared.is_err() {
                    super::diagnostics::record(app, "prepare_windows", Some("timeout"), forced);
                }
                prepared.map_err(|_| "native.updates.preparationFailed")??;
            }
            app.state::<Updates>()
                .preparation
                .seal_for_install(app, &token)
        }
        .await;
        if let Err(error) = preparation {
            let _ = app.state::<Updates>().preparation.cancel(app, &token);
            self.failed(app, error, forced);
            return;
        }
        super::diagnostics::record(app, "prepare_finished", None, forced);
        let (restart, installed) = std::sync::mpsc::channel::<File>();
        let handle = app.clone();
        if std::thread::Builder::new()
            .name("situate-update-relaunch".into())
            .spawn(move || {
                if let Ok(lock) = installed.recv() {
                    let _installation_lock = lock;
                    super::diagnostics::record(&handle, "install_restart", None, forced);
                    handle.restart();
                }
            })
            .is_err()
        {
            app.state::<Updates>().preparation.unchanged(app, &token);
            super::diagnostics::record(app, "install_restart", Some("relaunch"), forced);
            self.failed(app, ERROR.into(), forced);
            return;
        }
        let owner = self.clone();
        let handle = app.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            owner.replace(&handle, &artifact_id, forced)
        })
        .await;
        match outcome {
            Ok(InstallOutcome::Unchanged(error)) => {
                app.state::<Updates>().preparation.unchanged(app, &token);
                self.failed(app, error, forced);
            }
            Ok(InstallOutcome::Installed(installation_lock)) => {
                if app
                    .state::<Updates>()
                    .preparation
                    .finalize(app, &token)
                    .is_err()
                {
                    self.recovery(app, forced);
                    return;
                }
                // macOS install replaces the bundle but never restarts. Closure is committed only now.
                if restart.send(installation_lock).is_err() {
                    super::diagnostics::record(app, "install_restart", Some("relaunch"), forced);
                    self.recovery(app, forced);
                }
            }
            _ => self.recovery(app, forced),
        }
    }
    fn failed(&self, app: &tauri::AppHandle, error: String, forced: bool) {
        super::diagnostics::record(app, "install_finished", Some(&error), forced);
        app.state::<Updates>().change(app, |s| {
            s.phase = Phase::InstallFailed;
            s.error = Some(error);
        });
    }
    fn replace(&self, app: &tauri::AppHandle, artifact_id: &str, forced: bool) -> InstallOutcome {
        super::diagnostics::record(app, "install_validate", None, forced);
        let before_mutation = (|| {
            let update = self
                .data
                .lock()
                .map_err(|_| ERROR)?
                .confirmed(artifact_id)?;
            let record = self.cache.record()?.ok_or(ERROR)?;
            if record.version != update.version {
                return Err(ERROR.into());
            }
            let bytes = self.cache.read(&record)?;
            update.verify(&bytes).map_err(|_| {
                super::diagnostics::record(app, "install_validate", Some("signature"), forced);
                ERROR
            })?;
            let bundle = super::cache::bundle_path(&std::env::current_exe().map_err(|_| ERROR)?)?;
            // A directory lock is shared even by processes running under another user; no key or lock file is created in the bundle.
            let lock = File::open(bundle.parent().ok_or(ERROR)?).map_err(|_| ERROR)?;
            lock.try_lock().map_err(|_| "native.updates.busy")?;
            if bundle_version(&bundle)? != app.package_info().version.to_string() {
                super::diagnostics::record(app, "install_validate", Some("bundle_changed"), forced);
                let _ = self.cache.mark_installing(&update.version);
                return Err("native.updates.recoveryRequired".into());
            }
            let digest = fingerprint(&bundle).map_err(|_| ERROR)?;
            self.cache.mark_installing(&update.version)?;
            Ok::<_, String>((update, bytes, bundle, lock, digest))
        })();
        let (update, bytes, bundle, lock, before) = match before_mutation {
            Ok(v) => v,
            Err(error) if error == "native.updates.recoveryRequired" => {
                return InstallOutcome::Uncertain;
            }
            Err(error) => {
                super::diagnostics::record(app, "install_validate", Some(&error), forced);
                return InstallOutcome::Unchanged(error);
            }
        };
        app.state::<Updates>().change(app, |s| {
            s.phase = Phase::Installing;
            s.error = None;
        });
        super::diagnostics::record(app, "install_replace", None, forced);
        let result = update.install(&bytes);
        if let Err(error) = &result {
            let class = match error {
                tauri_plugin_updater::Error::Io(_) => "bundle_io",
                _ => super::diagnostics::updater_error(error),
            };
            super::diagnostics::record(app, "install_replace", Some(class), forced);
        }
        if result.is_ok() && bundle_version(&bundle).is_ok_and(|version| version == update.version)
        {
            super::diagnostics::record(app, "install_finished", None, forced);
            return InstallOutcome::Installed(lock);
        }
        if result.is_err()
            && fingerprint(&bundle).is_ok_and(|digest| digest == before)
            && self.cache.clear_installing().is_ok()
        {
            InstallOutcome::Unchanged(ERROR.into())
        } else {
            InstallOutcome::Uncertain
        }
    }
}
async fn stop_actions(
    app: &tauri::AppHandle,
    abort_running: bool,
    forced: bool,
) -> Result<(), String> {
    const STOP_ERROR: &str = "native.updates.stopFailed";
    // Admission remains held until native persistence and executor teardown have settled.
    if crate::ai::has_running_actions(app).map_err(|_| STOP_ERROR)? {
        if !abort_running {
            return Err("native.updates.runningActions".into());
        }
        crate::ai::abort_all(app);
        crate::plugin_host::abort_for_update(app)
            .await
            .map_err(|_| STOP_ERROR)?;
    }
    for scope in crate::ai_executor::scopes(app).map_err(|_| STOP_ERROR)? {
        crate::ai_executor::abort_all(app, &scope)
            .await
            .map_err(|_| STOP_ERROR)?;
    }
    loop {
        let owners =
            if let Some(owners) = app.try_state::<crate::ai::conversations::Conversations>() {
                owners.update_quiescence().await.map_err(|_| STOP_ERROR)?
            } else {
                crate::ai::conversations::UpdateQuiescence::default()
            };
        let other_active =
            crate::ai::has_non_conversation_actions(app, Some(&owners)).map_err(|_| STOP_ERROR)?;
        match actions_stopped(owners.status, other_active) {
            Ok(true) => return Ok(()),
            Ok(false) => tokio::time::sleep(Duration::from_millis(50)).await,
            Err(error) => {
                super::diagnostics::record(
                    app,
                    "prepare_actions",
                    Some("conversation_save"),
                    forced,
                );
                return Err(error.into());
            }
        }
    }
}

fn actions_stopped(
    owners: situate_agent::Quiescence,
    other_active: bool,
) -> Result<bool, &'static str> {
    use situate_agent::Quiescence;
    if other_active || matches!(owners, Quiescence::Active | Quiescence::CleanupRequired) {
        Ok(false)
    } else if owners == Quiescence::PersistenceFailed {
        Err("native.updates.persistenceFailed")
    } else {
        Ok(true)
    }
}

async fn wait_for_actions(
    mut stopped: tokio::task::JoinHandle<Result<(), String>>,
    on_timeout: impl FnOnce(),
) -> Result<(), String> {
    match tokio::time::timeout(Duration::from_secs(30), &mut stopped).await {
        Ok(result) => result.map_err(|_| "native.updates.stopFailed")?,
        Err(_) => {
            on_timeout();
            // Dropping executor cleanup can abandon bookkeeping after a disk write has started.
            let _ = stopped.await;
            Err("native.updates.stopFailed".into())
        }
    }
}

enum InstallOutcome {
    Installed(File),
    Unchanged(String),
    Uncertain,
}

fn bundle_version(path: &Path) -> Result<String, String> {
    let value = plist::Value::from_file(path.join("Contents/Info.plist")).map_err(|_| ERROR)?;
    value
        .as_dictionary()
        .and_then(|v| v.get("CFBundleShortVersionString"))
        .and_then(plist::Value::as_string)
        .map(str::to_owned)
        .ok_or_else(|| ERROR.into())
}

fn fingerprint(root: &Path) -> std::io::Result<[u8; 32]> {
    fn visit(root: &Path, path: &Path, hash: &mut Sha256) -> std::io::Result<()> {
        use std::os::unix::{
            ffi::OsStrExt,
            fs::{MetadataExt, PermissionsExt},
        };
        let metadata = fs::symlink_metadata(path)?;
        let relative = path.strip_prefix(root).map_err(std::io::Error::other)?;
        let name = relative.as_os_str().as_bytes();
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name);
        hash.update(metadata.permissions().mode().to_le_bytes());
        hash.update(metadata.dev().to_le_bytes());
        hash.update(metadata.ino().to_le_bytes());
        hash.update(metadata.uid().to_le_bytes());
        hash.update(metadata.gid().to_le_bytes());
        hash.update(metadata.ctime().to_le_bytes());
        hash.update(metadata.ctime_nsec().to_le_bytes());
        if metadata.file_type().is_symlink() {
            hash.update(b"link");
            let target = fs::read_link(path)?;
            let bytes = target.as_os_str().as_bytes();
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
        } else if metadata.is_dir() {
            hash.update(b"directory");
            let mut entries = fs::read_dir(path)?
                .map(|e| e.map(|e| e.path()))
                .collect::<Result<Vec<_>, _>>()?;
            entries.sort();
            for entry in entries {
                visit(root, &entry, hash)?;
            }
        } else if metadata.is_file() {
            hash.update(b"file");
            hash.update(metadata.len().to_le_bytes());
            let mut file = File::open(path)?;
            let mut buffer = [0; 64 * 1024];
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
        } else {
            return Err(std::io::Error::other("Unsupported bundle entry"));
        }
        Ok(())
    }
    if !fs::symlink_metadata(root)?.is_dir() {
        return Err(std::io::Error::other("Invalid bundle"));
    }
    let mut hash = Sha256::new();
    visit(root, root, &mut hash)?;
    Ok(hash.finalize().into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settled_persistence_failure_ends_preparation_only_after_other_native_work_settles() {
        use situate_agent::Quiescence;
        assert_eq!(
            actions_stopped(Quiescence::PersistenceFailed, true),
            Ok(false)
        );
        assert_eq!(
            actions_stopped(Quiescence::PersistenceFailed, false),
            Err("native.updates.persistenceFailed")
        );
        assert_eq!(
            actions_stopped(Quiescence::CleanupRequired, false),
            Ok(false)
        );
        assert_eq!(actions_stopped(Quiescence::Active, false), Ok(false));
        assert_eq!(actions_stopped(Quiescence::Idle, true), Ok(false));
        assert_eq!(actions_stopped(Quiescence::Idle, false), Ok(true));
    }

    #[tokio::test(start_paused = true)]
    async fn stop_timeout_keeps_cleanup_owned_and_never_proceeds_to_installation() {
        use std::sync::atomic::AtomicBool;
        let persisted = Arc::new(AtomicBool::new(false));
        let completed = persisted.clone();
        let (finish, pending) = tokio::sync::oneshot::channel();
        let stopped = tokio::spawn(async move {
            pending.await.unwrap();
            completed.store(true, Ordering::Release);
            Ok(())
        });
        let timed_out = Arc::new(AtomicBool::new(false));
        let observed = timed_out.clone();
        let waiting = tokio::spawn(wait_for_actions(stopped, move || {
            observed.store(true, Ordering::Release);
        }));
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(31)).await;
        tokio::task::yield_now().await;
        assert!(timed_out.load(Ordering::Acquire));
        assert!(!waiting.is_finished());
        assert!(!persisted.load(Ordering::Acquire));
        finish.send(()).unwrap();
        assert_eq!(
            waiting.await.unwrap(),
            Err("native.updates.stopFailed".into())
        );
        assert!(persisted.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn completed_native_cleanup_can_proceed_without_a_timeout() {
        let stopped = tokio::spawn(async { Ok(()) });
        assert!(
            wait_for_actions(stopped, || panic!("unexpected timeout"))
                .await
                .is_ok()
        );
    }

    #[test]
    fn installation_directory_lock_serializes_independent_processes() {
        const DIRECTORY: &str = "SITUATE_TEST_UPDATE_LOCK_DIRECTORY";
        if let Some(path) = std::env::var_os(DIRECTORY) {
            let lock = File::open(path).unwrap();
            let expected = std::env::var("SITUATE_TEST_UPDATE_LOCK_AVAILABLE").unwrap() == "true";
            assert_eq!(lock.try_lock().is_ok(), expected);
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let lock = File::open(dir.path()).unwrap();
        lock.try_lock().unwrap();
        let child = |available: bool| {
            std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "updates::install::tests::installation_directory_lock_serializes_independent_processes"])
            .env(DIRECTORY, dir.path()).env("SITUATE_TEST_UPDATE_LOCK_AVAILABLE", available.to_string()).output().unwrap()
        };
        assert!(child(false).status.success());
        drop(lock);
        assert!(child(true).status.success());
    }
    #[test]
    fn unchanged_requires_identical_bundle_contents_modes_and_symlink_targets() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("binary"), b"original").unwrap();
        symlink("binary", dir.path().join("link")).unwrap();
        let before = fingerprint(dir.path()).unwrap();
        assert_eq!(before, fingerprint(dir.path()).unwrap());
        fs::write(dir.path().join("binary"), b"replaced").unwrap();
        assert_ne!(before, fingerprint(dir.path()).unwrap());
        fs::write(dir.path().join("binary"), b"original").unwrap();
        // Rewriting original bytes does not prove that replacement never began.
        assert_ne!(before, fingerprint(dir.path()).unwrap());
        fs::remove_file(dir.path().join("link")).unwrap();
        symlink("other", dir.path().join("link")).unwrap();
        assert_ne!(before, fingerprint(dir.path()).unwrap());
        fs::remove_file(dir.path().join("link")).unwrap();
        symlink("binary", dir.path().join("link")).unwrap();
        fs::set_permissions(dir.path().join("binary"), fs::Permissions::from_mode(0o700)).unwrap();
        assert_ne!(before, fingerprint(dir.path()).unwrap());
    }
}
