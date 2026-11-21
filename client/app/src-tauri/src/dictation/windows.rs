use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use serde_json::json;
use situate_host_windows::dictation::{self, CaptureError, RecognitionError, model};
use tauri::Manager;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default)]
pub(super) struct Session {
    pub stop: CancellationToken,
    pub discard: CancellationToken,
}

pub(super) struct Paths {
    runtime: PathBuf,
    model: PathBuf,
    retry: Notify,
    mobile: AtomicBool,
}

pub(super) fn setup(app: &tauri::AppHandle) {
    let (Ok(resources), Ok(data)) = (app.path().resource_dir(), app.path().app_local_data_dir())
    else {
        return;
    };
    let runtime = resources.join("dictation").join("sherpa-onnx-2.0.2");
    if !runtime.is_dir() {
        return;
    }
    app.manage(Paths {
        runtime: runtime.clone(),
        model: data.join("dictation").join("parakeet-tdt-v3-int8-ed5d7456"),
        retry: Notify::new(),
        mobile: AtomicBool::new(false),
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let paths = app.state::<Paths>();
        if !tokio::task::spawn_blocking(move || dictation::runtime_available(&runtime))
            .await
            .unwrap_or(false)
        {
            super::receive(&app, json!({"model": "failed", "progress": 0}));
            return;
        }
        let mut model_state = ("checking", 0);
        loop {
            super::receive(
                &app,
                json!({"model": model_state.0, "progress": model_state.1}),
            );
            let mut progress = model_state.1;
            let result = model::provision(&paths.model, &paths.mobile, |next| {
                if next != progress && next < 100 {
                    progress = next;
                    super::receive(&app, json!({"model": "downloading", "progress": next}));
                }
            })
            .await;
            let status = match result {
                Ok(()) => {
                    super::receive(&app, json!({"model": "ready", "progress": 100}));
                    break;
                }
                Err(model::ProvisionError::Waiting) => "waiting",
                Err(model::ProvisionError::Storage) => "storage",
                Err(model::ProvisionError::Failed) => "failed",
            };
            super::receive(&app, json!({"model": status, "progress": progress}));
            if status == "storage" {
                paths.retry.notified().await;
            } else {
                let delay = if status == "waiting" { 5 } else { 45 };
                let _ =
                    tokio::time::timeout(Duration::from_secs(delay), paths.retry.notified()).await;
            }
            model_state = (status, progress);
        }
    });
}

pub(super) fn retry(app: &tauri::AppHandle, action: &str) {
    if let Some(paths) = app.try_state::<Paths>() {
        if action == "download" {
            paths.mobile.store(true, Ordering::Relaxed);
        }
        paths.retry.notify_one();
    }
}

pub(super) fn start(app: &tauri::AppHandle, id: &str, session: Session) {
    let app = app.clone();
    let id = id.to_owned();
    tauri::async_runtime::spawn(async move {
        let worker_app = app.clone();
        let worker_id = id.clone();
        let result = tokio::task::spawn_blocking(move || {
            capture_and_transcribe(&worker_app, &worker_id, session)
        })
        .await;
        let event = match result {
            Ok(Ok(text)) if !text.is_empty() => {
                json!({"id": id, "phase": "finished", "text": text})
            }
            Ok(Ok(_)) => json!({"id": id, "phase": "finished", "notice": "noSpeech"}),
            Ok(Err(None)) => json!({"id": id, "phase": "finished"}),
            Ok(Err(Some(notice))) => json!({"id": id, "phase": "finished", "notice": notice}),
            Err(_) => json!({"id": id, "phase": "finished", "notice": "failed"}),
        };
        super::receive(&app, event);
    });
}

fn capture_and_transcribe(
    app: &tauri::AppHandle,
    id: &str,
    session: Session,
) -> Result<String, Option<&'static str>> {
    let started = || super::receive(app, json!({"id": id, "phase": "recording"}));
    let level = |level: f32| super::receive(app, json!({"id": id, "level": level}));
    let audio = capture(app, &session, started, level).map_err(|error| match error {
        CaptureError::Discarded => None,
        CaptureError::PermissionDenied => Some("denied"),
        CaptureError::Interrupted | CaptureError::Unavailable | CaptureError::Capacity => {
            Some("interrupted")
        }
    })?;
    super::receive(app, json!({"id": id, "phase": "transcribing"}));
    let paths = app.state::<Paths>();
    dictation::transcribe(&paths.runtime, &paths.model, &audio, &session.discard).map_err(|error| {
        match error {
            RecognitionError::Discarded => None,
            RecognitionError::Failed | RecognitionError::Unavailable => Some("failed"),
        }
    })
}

fn capture(
    _app: &tauri::AppHandle,
    session: &Session,
    started: impl FnOnce(),
    level: impl FnMut(f32),
) -> Result<Vec<f32>, CaptureError> {
    #[cfg(feature = "native-smoke")]
    if let Ok(root) = _app.path().app_data_dir() {
        let fixture = root.join("smoke-dictation.pcm16");
        if fixture.is_file() {
            if root.join("smoke-dictation-denied").is_file() {
                return Err(CaptureError::PermissionDenied);
            }
            if std::fs::metadata(&fixture).map_or(true, |m| m.len() > 320_000) {
                return Err(CaptureError::Capacity);
            }
            let bytes = std::fs::read(fixture).map_err(|_| CaptureError::Unavailable)?;
            return dictation::record_fixture(&session.stop, &session.discard, &bytes, started);
        }
    }
    dictation::record(&session.stop, &session.discard, started, level)
}
