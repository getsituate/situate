use super::{ERROR, Native, Phase, Updates};
use crate::updates::diagnostics;
use sha2::{Digest, Sha256};
use situate_host_windows::updater::{PreparedInstaller, installed_version};
use std::{
    fs::OpenOptions,
    io::{self, Read},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    sync::Arc,
};
use tauri::Manager;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
};

pub(in crate::updates) fn windows_installed_version(
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let executable = std::env::current_exe().map_err(|_| ERROR)?;
    installed_version(&app.package_info().name, &executable).map_err(|_| ERROR.into())
}

impl Native {
    pub(super) async fn handoff(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        token: String,
        artifact_id: String,
        forced: bool,
    ) {
        let owner = self.clone();
        let handle = app.clone();
        let prepared = tauri::async_runtime::spawn_blocking(move || {
            owner.prepare_installer(&handle, &artifact_id, forced)
        })
        .await;
        let state = app.state::<Updates>();
        let installer = match prepared {
            Ok(Ok(installer)) => installer,
            Ok(Err(error)) if error == "native.updates.recoveryRequired" => {
                self.recovery(app, forced);
                return;
            }
            Ok(Err(error)) => {
                state.preparation.unchanged(app, &token);
                self.failed(app, error, forced);
                return;
            }
            Err(_) => {
                self.recovery(app, forced);
                return;
            }
        };
        state.change(app, |snapshot| {
            snapshot.phase = Phase::Installing;
            snapshot.error = None;
        });
        if state.preparation.finalize(app, &token).is_err() {
            self.recovery(app, forced);
            return;
        }
        diagnostics::record(app, "install_replace", None, forced);
        if installer.start().is_err() {
            self.recovery(app, forced);
            return;
        }
        diagnostics::record(app, "install_restart", None, forced);
        app.exit(0);
    }

    fn prepare_installer(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        forced: bool,
    ) -> Result<PreparedInstaller, String> {
        diagnostics::record(app, "install_validate", None, forced);
        let update = self.data.lock().map_err(|_| ERROR)?.confirmed(id)?;
        let record = self
            .cache
            .record()?
            .filter(|r| r.version == update.version)
            .ok_or(ERROR)?;
        let bytes = self.cache.read(&record)?;
        if !bytes.starts_with(b"MZ") || update.verify(&bytes).is_err() {
            diagnostics::record(app, "install_validate", Some("signature"), forced);
            return Err(ERROR.into());
        }
        let path = self.cache.stage_installer(&bytes)?;
        let result = (|| {
            let file = OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&path)
                .map_err(|_| ERROR)?;
            let info = file.metadata().map_err(|_| ERROR)?;
            if !info.is_file()
                || info.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || info.len() != bytes.len() as u64
            {
                return Err(ERROR.into());
            }
            let mut hash = Sha256::new();
            io::copy(&mut (&file).take(info.len()), &mut hash).map_err(|_| ERROR)?;
            if hash.finalize() != Sha256::digest(&bytes) {
                return Err(ERROR.into());
            }
            if windows_installed_version(app).as_deref()
                != Ok(app.package_info().version.to_string().as_str())
            {
                self.cache.mark_installing(&update.version)?;
                return Err("native.updates.recoveryRequired".into());
            }
            let installer = PreparedInstaller::create(&path).map_err(|_| ERROR)?;
            self.cache.mark_installing(&update.version)?;
            Ok(installer)
        })();
        if result.is_err() && !self.cache.interrupted() {
            let _ = self.cache.remove_installer();
        }
        result
    }
}
