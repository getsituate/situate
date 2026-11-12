use serde::Serialize;
use situate_core::{
    localization::{Preferences, Storage},
    workspaces::Location,
};
use tauri::Emitter;

#[derive(Serialize)]
pub struct Snapshot {
    #[serde(flatten)]
    preferences: Preferences,
    writable: bool,
}

#[tauri::command]
pub async fn localization_snapshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: Option<String>,
) -> Result<Snapshot, String> {
    let diagnostic_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let defaults = super::device_locale::preferences(&app);
        let Some(scope) = scope else {
            return Ok(Snapshot {
                preferences: defaults,
                writable: false,
            });
        };
        super::workspaces::with_current(&app, window.label(), &scope, |location| {
            snapshot(&app, location, &defaults)
        })
    })
    .await;
    crate::diagnostics::observe_command(&diagnostic_app, result)
        .map_err(|_| "native.localization.storage".to_owned())?
}

fn snapshot(
    app: &tauri::AppHandle,
    location: &Location,
    defaults: &Preferences,
) -> Result<Snapshot, String> {
    if let Some(root) = super::files::local_root(app, location)? {
        let storage = Storage::open(&root)?;
        let writable = storage.writable();
        let preferences = storage.snapshot(defaults, writable)?;
        return Ok(Snapshot {
            preferences,
            writable,
        });
    }
    #[cfg(mobile)]
    {
        use tauri::Manager;
        let response = app
            .state::<tauri_plugin_workspace_access::Access>()
            .content(serde_json::json!({"operation":"localization", "location":location}))?;
        let bytes = response
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(str::as_bytes);
        let (_, preferences, _) = situate_core::localization::decode(bytes, defaults)?;
        Ok(Snapshot {
            preferences,
            writable: false,
        })
    }
    #[cfg(desktop)]
    Err("native.localization.storage".into())
}

#[tauri::command]
pub async fn localization_update(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    preferences: Preferences,
    expected: Preferences,
) -> Result<Snapshot, String> {
    let diagnostic_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        super::workspaces::with_open_storage(&app, window.label(), &scope, |location| {
            let root =
                super::files::local_root(&app, location)?.ok_or("native.localization.readOnly")?;
            let storage = Storage::open(&root)?;
            if !storage.writable() {
                return Err("native.localization.readOnly".into());
            }
            storage.update(
                &super::device_locale::preferences(&app),
                &preferences,
                &expected,
            )?;
            let _ = app.emit("localization-changed", serde_json::json!({"scope":scope}));
            Ok(Snapshot {
                preferences,
                writable: true,
            })
        })
    })
    .await;
    crate::diagnostics::observe_command(&diagnostic_app, result)
        .map_err(|_| "native.localization.storage".to_owned())?
}

pub fn language(
    app: &tauri::AppHandle,
    location: &Location,
) -> situate_core::localization::Language {
    let defaults = super::device_locale::preferences(app);
    snapshot(app, location, &defaults).map_or(defaults.language, |s| s.preferences.language)
}

pub fn initialize(app: &tauri::AppHandle, location: &Location) {
    // A settings failure must not prevent access to the workspace's content.
    let _ = snapshot(app, location, &super::device_locale::preferences(app));
}

pub fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut observed = std::collections::HashMap::new();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(750));
            let Some(locations) = super::workspaces::observed_locations(&app) else {
                continue;
            };
            observed.retain(|scope, _| locations.iter().any(|l| &l.id == scope));
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
                        "localization-changed",
                        serde_json::json!({"scope":location.id}),
                    );
                }
            }
        }
    });
}
fn fingerprint(app: &tauri::AppHandle, location: &Location) -> Result<Option<Vec<u8>>, String> {
    if let Some(root) = super::files::local_root(app, location)? {
        return Storage::open(&root)?.bytes();
    }
    #[cfg(mobile)]
    {
        use tauri::Manager;
        let response = app
            .state::<tauri_plugin_workspace_access::Access>()
            .content(serde_json::json!({"operation":"localization", "location":location}))?;
        Ok(response
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(|s| s.as_bytes().to_vec()))
    }
    #[cfg(desktop)]
    Err("native.localization.storage".into())
}
