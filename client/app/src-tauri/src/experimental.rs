use std::{io::Write, path::PathBuf, sync::Mutex};
use tauri::Manager;

const ERROR: &str = "native.experimental.storage";

#[derive(Default)]
pub(crate) struct Preferences(Mutex<()>);

fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| ERROR)?
        .join("gmail-experiment"))
}

fn read(path: PathBuf) -> Result<bool, String> {
    match std::fs::read(path) {
        Ok(bytes) if bytes == b"on\n" => Ok(true),
        Ok(bytes) if bytes == b"off\n" => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        _ => Err(ERROR.into()),
    }
}

pub(crate) fn enabled(app: &tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<Preferences>();
    let _lock = state.0.lock().map_err(|_| ERROR)?;
    read(path(app)?)
}

#[tauri::command]
pub(crate) async fn gmail_experiment(
    app: tauri::AppHandle,
    enabled: Option<bool>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(value) = enabled else {
            return self::enabled(&app);
        };
        let state = app.state::<Preferences>();
        let _lock = state.0.lock().map_err(|_| ERROR)?;
        let path = path(&app)?;
        let directory = path.parent().ok_or(ERROR)?;
        std::fs::create_dir_all(directory).map_err(|_| ERROR)?;
        let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|_| ERROR)?;
        file.write_all(if value { b"on\n" } else { b"off\n" })
            .map_err(|_| ERROR)?;
        file.as_file().sync_all().map_err(|_| ERROR)?;
        file.persist(&path).map_err(|_| ERROR)?;
        std::fs::File::open(directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| ERROR)?;
        Ok(value)
    })
    .await
    .map_err(|_| ERROR)?
}
