use serde::{Deserialize, Serialize};
use situate_core::plugins::{PluginFile, PluginManifest, PluginSummary};

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    List {},
    Files {
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
    Read {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        path: String,
    },
    Validate {
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum Reply {
    List { plugins: Vec<PluginSummary> },
    Files { files: Vec<PluginFile> },
    Read { text: String },
    Validate { manifest: Box<PluginManifest> },
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
fn inspect(root: &std::path::Path, request: Request) -> Result<Reply, String> {
    use situate_core::plugins;
    match request {
        Request::List {} => plugins::list(root).map(|plugins| Reply::List { plugins }),
        Request::Files { plugin_id } => {
            plugins::files(root, &plugin_id).map(|files| Reply::Files { files })
        }
        Request::Read { plugin_id, path } => {
            plugins::read(root, &plugin_id, &path).map(|text| Reply::Read { text })
        }
        Request::Validate { plugin_id } => {
            plugins::validate(root, &plugin_id).map(|manifest| Reply::Validate {
                manifest: Box::new(manifest),
            })
        }
    }
    .map_err(|error| error.to_string())
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
pub(crate) fn inspect_cancellable(
    root: &std::path::Path,
    request: Request,
    token: &tokio_util::sync::CancellationToken,
) -> Result<Reply, String> {
    if token.is_cancelled() {
        return Err("native.ai.response.stopped".to_owned());
    }
    let result = inspect(root, request);
    if token.is_cancelled() {
        return Err("native.ai.response.stopped".to_owned());
    }
    result
}

#[tauri::command]
pub async fn plugins_source(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: Request,
) -> Result<Reply, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let label = window.label().to_owned();
        let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
        tauri::async_runtime::spawn_blocking(move || {
            crate::workspaces::with_authorized_read(
                &app,
                &label,
                &authorization,
                |location| {
                    crate::files::local_root(&app, location)?
                        .ok_or("native.plugins.unavailable".into())
                },
                |root| inspect(root, request),
            )
        })
        .await
        .map_err(|_| "native.plugins.readFailed".to_owned())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (app, window, scope, request);
        Err("native.plugins.unavailable".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn rejects_unknown_fields_and_invalid_operation_arguments() {
        for value in [
            json!({"operation":"list","pluginId":"sample"}),
            json!({"operation":"list","path":"plugin.json"}),
            json!({"operation":"list","root":"/tmp"}),
            json!({"operation":"files"}),
            json!({"operation":"files","pluginId":"sample","path":"plugin.json"}),
            json!({"operation":"read","pluginId":"sample"}),
            json!({"operation":"read","pluginId":"sample","path":null}),
            json!({"operation":"read","pluginId":"sample","path":"plugin.json","execute":true}),
            json!({"operation":"validate","pluginId":"sample","path":"plugin.json"}),
            json!({"operation":"activate","pluginId":"sample"}),
        ] {
            assert!(
                serde_json::from_value::<Request>(value.clone()).is_err(),
                "{value}"
            );
        }
    }

    #[test]
    fn authorization_arguments_preserve_the_exact_request() {
        for value in [
            json!({"operation":"list"}),
            json!({"operation":"files","pluginId":"sample"}),
            json!({"operation":"read","pluginId":"sample","path":"notes/guide.md"}),
            json!({"operation":"validate","pluginId":"sample"}),
        ] {
            let parsed: Request = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        }
    }

    #[test]
    fn workspace_authorization_rejects_foreign_and_closed_scopes_before_reading() {
        let root = tempfile::tempdir().unwrap();
        let code = root.path().join(".situate/plugins/sample/code");
        std::fs::create_dir_all(&code).unwrap();
        std::fs::write(code.join("source.js"), "workspace one").unwrap();
        let location = situate_core::workspaces::Location {
            id: "one".into(),
            name: "One".into(),
            display: "One".into(),
            kind: "path".into(),
            handle: root.path().to_string_lossy().into_owned(),
        };
        let sessions = [("window-one", location)];
        for (open, window, scope) in [
            (&sessions[..], "window-two", "one"),
            (&sessions[..], "window-one", "two"),
            (&[][..], "window-one", "one"),
        ] {
            let mut read_started = false;
            let result = crate::workspaces::with_test_storage_root(open, window, scope, |root| {
                read_started = true;
                request(
                    root,
                    json!({"operation":"read","pluginId":"sample","path":"source.js"}),
                )
            });
            assert_eq!(result.unwrap_err(), "native.workspace.session.inactive");
            assert!(!read_started);
        }
        let result =
            crate::workspaces::with_test_storage_root(&sessions, "window-one", "one", |root| {
                request(
                    root,
                    json!({"operation":"read","pluginId":"sample","path":"source.js"}),
                )
            })
            .unwrap();
        assert_eq!(result, json!({"text":"workspace one"}));
    }

    #[test]
    fn cancelled_inspection_does_not_read_source() {
        let root = tempfile::tempdir().unwrap();
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();
        assert_eq!(
            inspect_cancellable(
                root.path(),
                Request::Read {
                    plugin_id: "missing".into(),
                    path: "missing.js".into(),
                },
                &token
            )
            .unwrap_err(),
            "native.ai.response.stopped"
        );
    }

    #[test]
    fn core_errors_remain_localized_and_invalid_packages_remain_visible() {
        let root = tempfile::tempdir().unwrap();
        let code = root.path().join(".situate/plugins/broken/code");
        std::fs::create_dir_all(&code).unwrap();
        std::fs::write(code.join("plugin.json"), "not JSON").unwrap();
        assert_eq!(
            request(root.path(), json!({"operation":"list"})).unwrap(),
            json!({"plugins":[{"id":"broken","manifest":null,"error":"native.plugins.invalidManifest"}]})
        );
        assert_eq!(
            request(
                root.path(),
                json!({"operation":"validate","pluginId":"broken"})
            )
            .unwrap_err(),
            "native.plugins.invalidManifest"
        );
        assert_eq!(
            request(
                root.path(),
                json!({"operation":"read","pluginId":"broken","path":"../secret"})
            )
            .unwrap_err(),
            "native.plugins.invalidPath"
        );
    }

    fn request(root: &std::path::Path, value: Value) -> Result<Value, String> {
        inspect(root, serde_json::from_value(value).unwrap())
            .map(|reply| serde_json::to_value(reply).unwrap())
    }

    #[test]
    fn routes_source_inspection_to_core_without_executing_or_changing_files() {
        let root = tempfile::tempdir().unwrap();
        let code = root.path().join(".situate/plugins/sample/code");
        std::fs::create_dir_all(&code).unwrap();
        let manifest = json!({"schemaVersion":2,"id":"sample","name":"Sample","description":"A sample plugin","skills":[],"serviceEntry":"entry.js"});
        let source = "throw new Error('must not execute');";
        std::fs::write(code.join("plugin.json"), manifest.to_string()).unwrap();
        std::fs::write(code.join("entry.js"), source).unwrap();
        assert_eq!(
            request(root.path(), json!({"operation":"list"})).unwrap(),
            json!({"plugins":[{"id":"sample","manifest":manifest,"error":null}]})
        );
        assert_eq!(
            request(
                root.path(),
                json!({"operation":"files","pluginId":"sample"})
            )
            .unwrap(),
            json!({"files":[{"path":"entry.js","isDirectory":false},{"path":"plugin.json","isDirectory":false}]})
        );
        assert_eq!(
            request(
                root.path(),
                json!({"operation":"read","pluginId":"sample","path":"entry.js"})
            )
            .unwrap(),
            json!({"text":source})
        );
        assert_eq!(
            request(
                root.path(),
                json!({"operation":"validate","pluginId":"sample"})
            )
            .unwrap(),
            json!({"manifest":manifest})
        );
        assert_eq!(
            std::fs::read_to_string(code.join("entry.js")).unwrap(),
            source
        );
        assert_eq!(
            std::fs::read_to_string(code.join("plugin.json")).unwrap(),
            manifest.to_string()
        );
        assert_eq!(std::fs::read_dir(&code).unwrap().count(), 2);
    }
}
