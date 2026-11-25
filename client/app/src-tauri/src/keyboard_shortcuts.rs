use serde_json::{Value, json};
use situate_core::keyboard_shortcuts::{self as core, Platform, PluginDefaults, Snapshot, Update};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct ShortcutPlugins(Mutex<HashMap<(String, String), Vec<PluginDefaults>>>);

fn plugins(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
) -> Result<Vec<PluginDefaults>, String> {
    Ok(app
        .state::<ShortcutPlugins>()
        .0
        .lock()
        .map_err(|_| "native.shortcuts.storage")?
        .get(&(window.into(), scope.into()))
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn keyboard_shortcuts_snapshot(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if Platform::current().is_none() {
            return Err("native.shortcuts.unavailable".into());
        }
        super::workspaces::with_open_storage_root(&app, window.label(), &scope, core::snapshot)
    })
    .await
    .map_err(|_| "native.shortcuts.storage")?
}

#[tauri::command]
pub fn keyboard_shortcuts_plugins(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    registrations: Vec<PluginDefaults>,
) -> Result<(), String> {
    if registrations.len() > 512
        || registrations.iter().any(|entry| {
            entry.id.len() > 257
                || entry.defaults.len() > 2
                || entry.defaults.values().any(|key| key.len() > 80)
        })
    {
        return Err("native.shortcuts.invalid".into());
    }
    let state = app.state::<ShortcutPlugins>();
    let key = (window.label().to_owned(), scope.clone());
    if registrations.is_empty() {
        state
            .0
            .lock()
            .map_err(|_| "native.shortcuts.storage")?
            .remove(&key);
        return Ok(());
    }
    super::workspaces::with_current(&app, window.label(), &scope, |_| {
        state
            .0
            .lock()
            .map_err(|_| "native.shortcuts.storage")?
            .insert(key, registrations);
        Ok(())
    })
}

#[tauri::command]
pub async fn keyboard_shortcuts_update(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: Update,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let platform = Platform::current().ok_or("native.shortcuts.unavailable")?;
        if request.platform.is_some() {
            return Err("native.shortcuts.invalid".into());
        }
        let registrations = plugins(&app, window.label(), &scope)?;
        let result =
            super::workspaces::with_open_storage_root(&app, window.label(), &scope, |root| {
                core::update(root, platform, request, &registrations)
            })?;
        let _ = app.emit("keyboard-shortcuts-changed", &scope);
        Ok(result)
    })
    .await
    .map_err(|_| "native.shortcuts.storage")?
}

pub(super) fn agent_tool(
    app: &tauri::AppHandle,
    window: &str,
    location: &situate_core::workspaces::Location,
    name: &str,
    arguments: Value,
) -> Result<Value, String> {
    let current = Platform::current().ok_or("native.shortcuts.unavailable")?;
    let registrations = plugins(app, window, &location.id)?;
    let _access = super::files::CoordinatedAccess::begin(app, location)?;
    let root = super::files::local_root(app, location)?.ok_or("native.shortcuts.unavailable")?;
    if name == "read_keyboard_shortcuts" {
        if arguments != json!({}) {
            return Err("native.shortcuts.invalid".into());
        }
        return Ok(
            json!({"platform":current,"configuration":core::snapshot(&root)?,"defaults":core::defaults(),"pluginDefaults":registrations.iter().map(|entry| json!({"id":entry.id,"defaults":entry.defaults})).collect::<Vec<_>>()}),
        );
    }
    if name != "update_keyboard_shortcut" || arguments.get("expectedRevision").is_none() {
        return Err("native.shortcuts.invalid".into());
    }
    let request: Update =
        serde_json::from_value(arguments).map_err(|_| "native.shortcuts.invalid")?;
    let platform = request.platform.unwrap_or(current);
    let configuration = core::update(&root, platform, request, &registrations)?;
    let _ = app.emit("keyboard-shortcuts-changed", &location.id);
    Ok(json!({"platform":platform,"configuration":configuration}))
}
