use super::*;
#[cfg(desktop)]
use std::fs;

#[tauri::command]
pub async fn smoke_parent(app: tauri::AppHandle) -> Result<Entry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspaces>();
        let mut inner = state.inner.lock().unwrap();
        #[cfg(desktop)]
        let location = {
            let path = inner.path.parent().unwrap().join(format!(
                "workspace-smoke-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).map_err(|e| e.to_string())?;
            situate_core::workspaces::location(&path)?
        };
        #[cfg(mobile)]
        let location = native(&app, "default", None, None)?
            .ok_or("No isolated application Documents folder")?;
        let result = Entry::from(&location);
        inner.parents.insert(location.id.clone(), location);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

// Keep the orchestration WebView outside workspace ownership during shell/reload journeys.
#[tauri::command]
pub async fn smoke_create_fixture(
    app: tauri::AppHandle,
    parent: String,
    name: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspaces>();
        let mut inner = state.inner.lock().unwrap();
        let parent = inner.parents.get(&parent).ok_or("No fixture parent")?;
        let location =
            native(&app, "create", Some(parent), Some(&name))?.ok_or("No fixture workspace")?;
        #[cfg(target_os = "ios")]
        crate::agent_e2e::mobile::seed_workspace(&app, &location)?;
        open(&mut inner, &app, location, true, None)?;
        drop(inner);
        emit(&app);
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn smoke_start_recovery(app: tauri::AppHandle, workspace_id: String) -> Result<(), String> {
    let state = app.state::<Workspaces>();
    let inner = state.inner.lock().unwrap();
    let session = inner
        .sessions
        .iter()
        .find(|session| session.location.id == workspace_id)
        .ok_or("The recovery workspace is not open")?;
    app.get_webview_window(&session.window)
        .ok_or("The recovery window is unavailable")?
        .eval("window.runRecoverySmoke(false).catch(error => window.__TAURI_INTERNALS__.invoke('finish_smoke_test', { error: String(error) }));")
        .map_err(|error| error.to_string())
}

#[cfg(desktop)]
fn valid_smoke_window_owner(
    label: &str,
    ui_owned: bool,
    supervisor_windows: &[String],
    visible: Option<bool>,
) -> bool {
    if supervisor_windows.iter().any(|owned| owned == label) {
        visible == Some(false)
    } else {
        ui_owned
    }
}

#[tauri::command]
pub async fn verify_smoke_registry(
    app: tauri::AppHandle,
    known: Vec<String>,
    restore: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Workspaces>();
        let inner = state.inner.lock().unwrap();
        let disk = Registry::load(&inner.path)?;
        if disk != inner.registry {
            return Err("In-memory state differs from durable registry".into());
        }
        if disk.known.iter().map(|l| l.id.clone()).collect::<Vec<_>>() != known
            || disk
                .restore
                .iter()
                .map(|l| l.id.clone())
                .collect::<Vec<_>>()
                != restore
        {
            return Err("Unexpected known or restore membership".into());
        }
        for session in &inner.sessions {
            inspect(&app, &session.location)?;
        }
        #[cfg(desktop)]
        {
            let windows = app.webview_windows();
            let sessions: Vec<_> = inner
                .sessions
                .iter()
                .map(|session| (session.window.clone(), session.location.handle.clone()))
                .collect();
            let ui_windows: Vec<_> = windows
                .keys()
                .filter(|label| {
                    is_entry_window(&inner, label)
                        || sessions.iter().any(|(window, _)| window == *label)
                })
                .cloned()
                .collect();
            // Native visibility queries may synchronously dispatch to the main thread.
            drop(inner);
            let supervisors = tauri_plugin_executor_platform::Executor::new(app.clone())
                .supervisor_window_labels();
            if sessions
                .iter()
                .any(|(label, _)| !windows.contains_key(label))
                || windows.iter().any(|(label, window)| {
                    let visible = supervisors
                        .contains(label)
                        .then(|| window.is_visible().ok())
                        .flatten();
                    !valid_smoke_window_owner(
                        label,
                        ui_windows.contains(label),
                        &supervisors,
                        visible,
                    )
                })
            {
                return Err("Unexpected desktop window ownership".into());
            }
            for (_, handle) in &sessions {
                let child = Path::new(handle);
                if !child.join(".situate").is_dir() {
                    return Err("The workspace marker is missing".into());
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(all(test, desktop))]
mod window_ownership_tests {
    use super::valid_smoke_window_owner;

    #[test]
    fn unknown_windows_are_not_supervisors_even_with_executor_labels() {
        let supervisors = vec!["executor-1".to_owned()];
        for label in ["executor-forged", "executor-2", "unowned"] {
            assert!(!valid_smoke_window_owner(
                label,
                false,
                &supervisors,
                Some(false)
            ));
        }
    }

    #[test]
    fn registered_supervisors_must_be_hidden_even_when_ui_marked() {
        let supervisors = vec!["executor-1".to_owned()];
        for ui_owned in [false, true] {
            assert!(valid_smoke_window_owner(
                "executor-1",
                ui_owned,
                &supervisors,
                Some(false)
            ));
            assert!(!valid_smoke_window_owner(
                "executor-1",
                ui_owned,
                &supervisors,
                Some(true)
            ));
            assert!(!valid_smoke_window_owner(
                "executor-1",
                ui_owned,
                &supervisors,
                None
            ));
        }
    }

    #[test]
    fn workspace_and_entry_ownership_remain_independent_of_visibility() {
        let supervisors = vec!["executor-1".to_owned()];
        for label in ["main", "workspace-1"] {
            assert!(valid_smoke_window_owner(
                label,
                true,
                &supervisors,
                Some(true)
            ));
            assert!(valid_smoke_window_owner(label, true, &supervisors, None));
            assert!(!valid_smoke_window_owner(
                label,
                false,
                &supervisors,
                Some(false)
            ));
        }
    }
}
