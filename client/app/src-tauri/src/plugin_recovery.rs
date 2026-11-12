use serde::Serialize;
#[cfg(any(desktop, test))]
use std::ffi::OsString;
use std::{collections::BTreeSet, sync::Mutex};
use tauri::{Emitter, Manager};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryState {
    revision: u64,
    recovery: bool,
    resumed: BTreeSet<(String, String)>,
}
pub(crate) struct PluginRecoveryMode(Mutex<RecoveryState>);
impl PluginRecoveryMode {
    pub(crate) fn capture() -> Self {
        #[cfg(desktop)]
        {
            Self::from_args(std::env::args_os())
        }
        #[cfg(mobile)]
        {
            Self(Mutex::default())
        }
    }
    #[cfg(any(desktop, test))]
    fn from_args(args: impl IntoIterator<Item = OsString>) -> Self {
        Self(Mutex::new(RecoveryState {
            recovery: args
                .into_iter()
                .skip(1)
                .take_while(|arg| arg != "--")
                .any(|arg| arg == "--recovery" || arg == "--without-plugins"),
            ..RecoveryState::default()
        }))
    }
    fn blocked(&self, scope: &str, plugin: &str) -> bool {
        self.0
            .lock()
            .map(|state| state.recovery && !state.resumed.contains(&(scope.into(), plugin.into())))
            .unwrap_or(true)
    }
}
#[tauri::command]
pub(crate) fn plugin_recovery_mode(mode: tauri::State<'_, PluginRecoveryMode>) -> bool {
    mode.0.lock().map(|state| state.recovery).unwrap_or(true)
}
#[tauri::command]
pub(crate) fn plugin_recovery_state(
    mode: tauri::State<'_, PluginRecoveryMode>,
) -> Result<RecoveryState, String> {
    mode.0
        .lock()
        .map(|state| state.clone())
        .map_err(|_| "native.plugins.unavailable".into())
}
pub(crate) fn blocked(app: &tauri::AppHandle, scope: &str, plugin: &str) -> bool {
    app.state::<PluginRecoveryMode>().blocked(scope, plugin)
}
/// Called only after a user resumption or successful checked publication.
pub(crate) fn resume(
    app: &tauri::AppHandle,
    scope: &str,
    plugin: Option<&str>,
) -> Result<RecoveryState, String> {
    let mode = app.state::<PluginRecoveryMode>();
    {
        let mut state = mode.0.lock().map_err(|_| "native.plugins.unavailable")?;
        if let Some(plugin) = plugin {
            state.resumed.insert((scope.into(), plugin.into()));
        } else {
            state.recovery = false;
            state.resumed.clear();
        }
        state.revision += 1;
    }
    reconcile(app)?;
    let state = plugin_recovery_state(app.state())?;
    app.emit("plugin-recovery-changed", &state)
        .map_err(|_| "native.plugins.unavailable")?;
    Ok(state)
}
pub(crate) fn forget_scope(app: &tauri::AppHandle, scope: &str) {
    let Some(mode) = app.try_state::<PluginRecoveryMode>() else {
        return;
    };
    if let Ok(mut state) = mode.0.lock() {
        state.resumed.retain(|(workspace, _)| workspace != scope);
        state.revision += 1;
        let _ = app.emit("plugin-recovery-changed", &*state);
    }
}
pub(crate) fn reconcile(app: &tauri::AppHandle) -> Result<(), String> {
    if !plugin_recovery_mode(app.state()) {
        return Ok(());
    }
    // Unknown inventories keep recovery active; never infer that an unreadable plugin is safe.
    let Some(locations) = crate::workspaces::plugin_recovery_locations(app) else {
        return Ok(());
    };
    let mut enabled = Vec::new();
    for location in locations {
        let Ok(Some(root)) = crate::files::local_root(app, &location) else {
            return Ok(());
        };
        let Ok(list) = situate_core::plugins::runtime::list(&root) else {
            return Ok(());
        };
        enabled.extend(
            list.plugins
                .into_iter()
                .filter(|p| p.enabled)
                .map(|p| (location.id.clone(), p.id)),
        );
    }
    let mode = app.state::<PluginRecoveryMode>();
    let mut state = mode.0.lock().map_err(|_| "native.plugins.unavailable")?;
    if enabled.iter().all(|key| state.resumed.contains(key)) {
        state.recovery = false;
        state.revision += 1;
        app.emit("plugin-recovery-changed", &*state)
            .map_err(|_| "native.plugins.unavailable")?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn plugin_recovery_resume(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    plugin_id: Option<String>,
) -> Result<RecoveryState, String> {
    let label = window.label().to_owned();
    let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_authorization_session(&app, &label, &authorization, |location| {
            if let Some(id) = &plugin_id {
                let root = crate::files::local_root(&app, location)?
                    .ok_or("native.plugins.unavailable")?;
                situate_core::plugins::runtime::check_enabled(&root, id)?;
            }
            resume(&app, &scope, plugin_id.as_deref())
        })
    })
    .await
    .map_err(|_| "native.plugins.unavailable".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_only_exact_flags_before_separator() {
        for (args, expected) in [
            (vec!["Situate"], false),
            (vec!["Situate", "--recovery"], true),
            (vec!["Situate", "--without-plugins"], true),
            (vec!["--recovery"], false),
            (vec!["Situate", "--recovery=true"], false),
            (vec!["Situate", "--", "--recovery"], false),
        ] {
            let mode = PluginRecoveryMode::from_args(args.iter().map(OsString::from));
            assert_eq!(mode.blocked("one", "sample"), expected);
        }
    }
    #[cfg(unix)]
    #[test]
    fn tolerates_non_unicode_arguments() {
        use std::os::unix::ffi::OsStringExt;
        let mode = PluginRecoveryMode::from_args([
            OsString::from("Situate"),
            OsString::from_vec(vec![0xff]),
            OsString::from("--recovery"),
        ]);
        assert!(mode.blocked("one", "sample"));
    }
    #[test]
    fn command_reports_captured_mode_without_mutating_preferences() {
        for enabled in [false, true] {
            let mode = PluginRecoveryMode(Mutex::new(RecoveryState {
                recovery: enabled,
                ..RecoveryState::default()
            }));
            let app = tauri::test::mock_builder()
                .manage(mode)
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .unwrap();
            assert_eq!(plugin_recovery_mode(app.state()), enabled);
            assert_eq!(
                plugin_recovery_state(app.state()).unwrap().recovery,
                enabled
            );
        }
    }
    #[test]
    fn resumption_is_scoped_and_does_not_release_other_plugins() {
        let mode = PluginRecoveryMode::from_args(["Situate", "--recovery"].map(OsString::from));
        mode.0
            .lock()
            .unwrap()
            .resumed
            .insert(("one".into(), "sample".into()));
        assert!(!mode.blocked("one", "sample"));
        assert!(mode.blocked("two", "sample"));
        assert!(mode.blocked("one", "other"));
    }
}
