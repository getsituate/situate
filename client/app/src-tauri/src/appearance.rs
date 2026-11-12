use situate_core::{
    appearance::{Snapshot, Storage},
    workspaces::Location,
};
use tauri::Emitter;

#[tauri::command]
pub async fn appearance_snapshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: Option<String>,
) -> Result<Snapshot, String> {
    let diagnostic_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let Some(scope) = scope else {
            return Ok(Snapshot::default());
        };
        super::workspaces::with_current(&app, window.label(), &scope, |location| {
            snapshot(&app, location)
        })
    })
    .await;
    crate::diagnostics::observe_command(&diagnostic_app, result)
        .map_err(|_| "native.appearance.storage".to_owned())?
}

fn snapshot(app: &tauri::AppHandle, location: &Location) -> Result<Snapshot, String> {
    if let Some(root) =
        super::files::local_root(app, location).map_err(|_| "native.appearance.storage")?
    {
        return Storage::open(&root)?.snapshot();
    }
    let (_, snapshot) =
        situate_core::appearance::decode(provider_bytes(app, location)?.as_deref())?;
    Ok(snapshot)
}

fn provider_bytes(app: &tauri::AppHandle, location: &Location) -> Result<Option<Vec<u8>>, String> {
    #[cfg(mobile)]
    {
        use tauri::Manager;
        let response = app
            .state::<tauri_plugin_workspace_access::Access>()
            .content(serde_json::json!({"operation":"appearance", "location":location}))
            .map_err(|error| {
                if error == "native.appearance.invalid" {
                    error
                } else {
                    "native.appearance.storage".into()
                }
            })?;
        Ok(response
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(|text| text.as_bytes().to_vec()))
    }
    #[cfg(desktop)]
    {
        let _ = (app, location);
        Err("native.appearance.storage".into())
    }
}

#[tauri::command]
pub async fn appearance_update(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    accent: String,
    expected_revision: Option<String>,
) -> Result<Snapshot, String> {
    let diagnostic_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        super::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            let accent = serde_json::from_value(serde_json::Value::String(accent))
                .map_err(|_| "native.appearance.invalid")?;
            let root = super::files::local_root(&app, location)
                .map_err(|_| "native.appearance.storage")?
                .ok_or("native.appearance.readOnly")?;
            let saved = Storage::open(&root)?.update(accent, expected_revision.as_deref())?;
            let _ = app.emit("appearance-changed", serde_json::json!({"scope":scope}));
            Ok(saved)
        })
    })
    .await;
    crate::diagnostics::observe_command(&diagnostic_app, result)
        .map_err(|_| "native.appearance.storage".to_owned())?
}

pub fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut observed = std::collections::HashMap::new();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(750));
            let Some(locations) = super::workspaces::observed_locations(&app) else {
                continue;
            };
            observed.retain(|scope, _| locations.iter().any(|location| &location.id == scope));
            for location in locations {
                let current = fingerprint(&app, &location);
                if current.is_err() && observed.get(&location.id) != Some(&current) {
                    crate::diagnostics::runtime_failure(&app, "task", "io");
                }
                if observed
                    .insert(location.id.clone(), current.clone())
                    .as_ref()
                    != Some(&current)
                {
                    let _ = app.emit(
                        "appearance-changed",
                        serde_json::json!({"scope":location.id}),
                    );
                }
            }
        }
    });
}
fn fingerprint(
    app: &tauri::AppHandle,
    location: &Location,
) -> Result<(Option<Vec<u8>>, bool), String> {
    if let Some(root) =
        super::files::local_root(app, location).map_err(|_| "native.appearance.storage")?
    {
        let storage = Storage::open(&root)?;
        return Ok((storage.bytes()?, storage.writable()));
    }
    Ok((provider_bytes(app, location)?, false))
}
