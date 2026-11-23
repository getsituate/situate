use std::{
    collections::VecDeque,
    fs, io,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};
use tauri::Manager;

const LIMIT: usize = 1024 * 1024;
const ENABLED: &str = "enabled";
const REPORT: &str = "latest-model-failure.log";
const ERROR: &str = "settings.modelDiagnostics.error";

#[derive(Default)]
pub(crate) struct ModelFailureCapture(Mutex<u64>);

pub(crate) struct Capture {
    directory: PathBuf,
    generation: u64,
    tail: VecDeque<u8>,
    total: usize,
}

impl Capture {
    pub(crate) fn push(&mut self, bytes: &[u8]) {
        self.total = self.total.saturating_add(bytes.len());
        let bytes = &bytes[bytes.len().saturating_sub(LIMIT)..];
        let discard = (self.tail.len() + bytes.len()).saturating_sub(LIMIT);
        self.tail.drain(..discard);
        self.tail.extend(bytes);
    }

    pub(crate) async fn failed(self, app: tauri::AppHandle, code: &'static str) {
        if !self.tail.is_empty() {
            let _ = tauri::async_runtime::spawn_blocking(move || {
                app.state::<ModelFailureCapture>().save(self, code)
            })
            .await;
        }
    }
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    if !cfg!(target_os = "macos") {
        return Err(ERROR);
    }
    app.path()
        .app_data_dir()
        .map(|p| p.join("model-failure-capture"))
        .map_err(|_| ERROR)
}

fn remove(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

impl ModelFailureCapture {
    pub(crate) fn start(&self, app: &tauri::AppHandle) -> Option<Capture> {
        self.start_in(directory(app).ok()?)
    }

    fn start_in(&self, directory: PathBuf) -> Option<Capture> {
        let generation = self.0.lock().ok()?;
        directory.join(ENABLED).is_file().then(|| Capture {
            directory,
            generation: *generation,
            tail: VecDeque::new(),
            total: 0,
        })
    }

    fn set(&self, dir: &Path, enabled: bool) -> io::Result<()> {
        let mut generation = self.0.lock().map_err(|_| io::ErrorKind::Other)?;
        if enabled {
            fs::create_dir_all(dir)?;
            tempfile::NamedTempFile::new_in(dir)?.persist(dir.join(ENABLED))?;
        } else {
            remove(&dir.join(ENABLED))?;
        }
        *generation += 1;
        Ok(())
    }

    fn save(&self, mut capture: Capture, code: &str) -> io::Result<()> {
        let generation = self.0.lock().map_err(|_| io::ErrorKind::Other)?;
        if *generation != capture.generation || !capture.directory.join(ENABLED).is_file() {
            return Ok(());
        }
        let mut file = tempfile::NamedTempFile::new_in(&capture.directory)?;
        let timestamp = SystemTime::UNIX_EPOCH.elapsed().unwrap_or_default();
        writeln!(file, "Timestamp (Unix ms): {}", timestamp.as_millis())?;
        writeln!(file, "Error: {code}")?;
        writeln!(
            file,
            "Response bytes omitted: {}\n",
            capture.total - capture.tail.len()
        )?;
        file.write_all(capture.tail.make_contiguous())?;
        file.as_file().sync_all()?;
        file.persist(capture.directory.join(REPORT))?;
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn model_failure_snapshot(app: tauri::AppHandle) -> Result<bool, &'static str> {
    directory(&app)?
        .join(ENABLED)
        .try_exists()
        .map_err(|_| ERROR)
}

#[tauri::command]
pub(crate) fn model_failure_set(app: tauri::AppHandle, enabled: bool) -> Result<(), &'static str> {
    app.state::<ModelFailureCapture>()
        .set(&directory(&app)?, enabled)
        .map_err(|_| ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opt_in_survives_reopen_and_records_only_the_bounded_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        let state = ModelFailureCapture::default();
        assert!(state.start_in(path.into()).is_none());
        state.set(path, true).unwrap();
        let state = ModelFailureCapture::default();
        let mut capture = state.start_in(path.into()).unwrap();
        capture.push(b"discard me");
        capture.push(&vec![b'a'; LIMIT]);
        capture.push(b"failure frame");
        state.save(capture, "providerRejected").unwrap();
        let report = fs::read_to_string(path.join(REPORT)).unwrap();
        let (header, body) = report.split_once("\n\n").unwrap();
        assert!(header.contains("Response bytes omitted: 23"));
        assert_eq!(body.len(), LIMIT);
        assert!(body.ends_with("failure frame"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path.join(REPORT))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }

        let mut unfinished = state.start_in(path.into()).unwrap();
        unfinished.push(b"do not retain this response");
        drop(unfinished);
        assert_eq!(fs::read_to_string(path.join(REPORT)).unwrap(), report);

        let stale = state.start_in(path.into()).unwrap();
        state.set(path, false).unwrap();
        assert!(state.start_in(path.into()).is_none());
        assert_eq!(fs::read_to_string(path.join(REPORT)).unwrap(), report);
        state.set(path, true).unwrap();
        state.save(stale, "stale").unwrap();
        assert_eq!(fs::read_to_string(path.join(REPORT)).unwrap(), report);
    }
}
