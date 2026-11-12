use serde_json::Value;
use situate_core::layout_storage::{Incarnations, LayoutStorage, Snapshot};

fn retry_layout_admission<T>(
    mut operation: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    let mut result = operation();
    for _ in 0..99 {
        if !matches!(&result, Err(error) if error == "native.layout.storage.busy") {
            break;
        }
        // Busy is returned before mutation; conflict and uncertain-write errors are never replayed.
        std::thread::sleep(std::time::Duration::from_millis(10));
        result = operation();
    }
    result
}

fn with_storage<T>(
    app: &tauri::AppHandle,
    window: &str,
    workspace_id: &str,
    operation: impl Fn(&LayoutStorage) -> Result<T, String>,
) -> Result<T, String> {
    crate::workspaces::with_open_storage_root(app, window, workspace_id, |root| {
        let storage = LayoutStorage::open(root, workspace_id)?;
        retry_layout_admission(|| operation(&storage))
    })
}

#[tauri::command]
pub async fn layout_load(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    workspace_id: String,
) -> Result<Snapshot, String> {
    let label = window.label().to_owned();
    let diagnostic_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &label, &workspace_id, |storage| storage.load())
    })
    .await;
    crate::diagnostics::observe_command(&diagnostic_app, result)
        .map_err(|_| "native.layout.storage.failed".to_owned())?
}

#[tauri::command]
pub async fn layout_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    workspace_id: String,
    expected_revision: Option<String>,
    data: Value,
    plugin_incarnations: Option<Incarnations>,
) -> Result<Snapshot, String> {
    let label = window.label().to_owned();
    let diagnostic_app = app.clone();
    let incarnations = plugin_incarnations.unwrap_or_default();
    let result = tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &label, &workspace_id, |storage| {
            storage.save_with_plugins(expected_revision.as_deref(), data.clone(), &incarnations)
        })
    })
    .await;
    crate::diagnostics::observe_command(&diagnostic_app, result)
        .map_err(|_| "native.layout.storage.failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn layout_save_waits_for_admission_without_changing_its_expected_revision() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        fs::create_dir(root.join(".situate")).unwrap();
        let storage = LayoutStorage::open(&root, "fixture").unwrap();
        let original =
            json!({"version":1,"layout":{"tabs":[],"activeTabId":null},"pinnedViews":["files"]});
        let saved = storage.save(None, original.clone()).unwrap();
        let bytes = fs::read(root.join(".situate/layout.json")).unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join(".situate/plugin-state.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        let mut lock = Some(lock);
        let mut changed = original;
        changed["pinnedViews"] = json!(["files", "notes"]);
        let mut attempts = 0;
        let result = retry_layout_admission(|| {
            attempts += 1;
            let result = storage.save(saved.revision.as_deref(), changed.clone());
            if attempts == 1 {
                assert_eq!(result.as_ref().unwrap_err(), "native.layout.storage.busy");
                assert_eq!(fs::read(root.join(".situate/layout.json")).unwrap(), bytes);
                drop(lock.take());
            }
            result
        })
        .unwrap();
        assert_eq!(attempts, 2);
        assert_eq!(result.data, Some(changed));
        assert_ne!(result.revision, saved.revision);
    }

    #[test]
    fn layout_admission_does_not_retry_conflicts_uncertain_writes_or_session_errors() {
        for error in [
            "native.layout.storage.conflict",
            "native.layout.storage.durability",
            "native.layout.storage.failed",
            "native.workspace.session.inactive",
            "unexpected",
        ] {
            let mut attempts = 0;
            let result: Result<(), String> = retry_layout_admission(|| {
                attempts += 1;
                Err(error.into())
            });
            assert_eq!(result.unwrap_err(), error);
            assert_eq!(attempts, 1);
        }
    }

    #[test]
    fn a_conflict_after_contention_is_not_replayed() {
        let mut attempts = 0;
        let result: Result<(), String> = retry_layout_admission(|| {
            attempts += 1;
            Err(if attempts == 1 {
                "native.layout.storage.busy"
            } else {
                "native.layout.storage.conflict"
            }
            .into())
        });
        assert_eq!(result.unwrap_err(), "native.layout.storage.conflict");
        assert_eq!(attempts, 2);
    }

    #[test]
    fn permanent_contention_has_a_finite_admission_budget() {
        let mut attempts = 0;
        let result: Result<(), String> = retry_layout_admission(|| {
            attempts += 1;
            Err("native.layout.storage.busy".into())
        });
        assert_eq!(result.unwrap_err(), "native.layout.storage.busy");
        assert_eq!(attempts, 100);
    }
}
