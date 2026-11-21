use std::sync::OnceLock;

use serde_json::Value;
use tauri::Manager;

pub(super) use situate_host_macos::dictation::command;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn receive(data: &str) {
    let Ok(event) = serde_json::from_str::<Value>(data) else {
        return;
    };
    if let Some(app) = APP.get() {
        super::receive(app, event);
    }
}

pub(super) fn setup(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let Ok(directory) = app.path().app_data_dir() else {
        return;
    };
    let (library, loader) = if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("dictation");
        (
            root.join(".build/media/libSituateMedia.dylib"),
            root.join("Media/loader.pl"),
        )
    } else {
        let Ok(resources) = app.path().resource_dir() else {
            return;
        };
        (
            resources.join("../Frameworks/libSituateMedia.dylib"),
            resources.join("dictation/loader.pl"),
        )
    };
    situate_host_macos::dictation::setup(
        &directory.join("dictation"),
        &library,
        &loader,
        option_env!("SITUATE_DICTATION_MODEL_SOURCE").unwrap_or(""),
        receive,
    );
}
