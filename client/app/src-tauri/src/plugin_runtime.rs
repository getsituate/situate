use serde::{Deserialize, Serialize};
use situate_core::plugins::runtime::{Listing, Sources};

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    List {},
    Load {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        #[serde(default)]
        revision: Option<String>,
    },
    Check {
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
    Uninstall {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        #[serde(rename = "expectedRevision", deserialize_with = "required_revision")]
        expected_revision: Option<String>,
    },
    SetEnabled {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        enabled: bool,
        #[serde(rename = "expectedRevision", deserialize_with = "required_revision")]
        expected_revision: Option<String>,
    },
}

fn required_revision<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
impl Request {
    fn mutates(&self) -> bool {
        // Listing can initialize identities, pin legacy source, and migrate credentials.
        matches!(
            self,
            Self::List {}
                | Self::Load { revision: None, .. }
                | Self::SetEnabled { .. }
                | Self::Uninstall { .. }
        )
    }
    fn requires_plugins(&self) -> bool {
        matches!(
            self,
            Self::Load { .. } | Self::Check { .. } | Self::SetEnabled { enabled: true, .. }
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum Reply {
    List(Listing),
    Load(Box<Sources>),
    Check { enabled: bool },
    SetEnabled { revision: String },
    Uninstall { revision: Option<String> },
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
fn prepare_listing(
    mut prepare: impl FnMut() -> Result<Listing, String>,
) -> Result<Listing, String> {
    let mut result = prepare();
    for _ in 0..99 {
        if !matches!(&result, Err(error) if error == "native.plugins.stateBusy") {
            break;
        }
        // Preparation refuses contended state/migration locks before changing retained state.
        std::thread::sleep(std::time::Duration::from_millis(10));
        result = prepare();
    }
    result
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
pub(super) fn dispatch(
    root: &std::path::Path,
    recovery: bool,
    request: Request,
) -> Result<Reply, String> {
    use situate_core::plugins::runtime;
    if recovery && request.requires_plugins() {
        return Err("native.plugins.recoveryBlocked".into());
    }
    match request {
        Request::List {} => prepare_listing(|| runtime::prepare(root)).map(Reply::List),
        Request::Load {
            plugin_id,
            revision,
        } => {
            if let Some(revision) = revision {
                runtime::check_enabled(root, &plugin_id)?;
                let list = runtime::list(root)?;
                if list
                    .plugins
                    .iter()
                    .find(|p| p.id == plugin_id)
                    .and_then(|p| p.revision.as_deref())
                    != Some(revision.as_str())
                {
                    return Err("native.plugins.stateConflict".into());
                }
                situate_core::plugins::sources::at_revision(
                    root,
                    &situate_core::plugins::sources::PackageRevision {
                        incarnation: None,
                        plugin_id,
                        revision,
                    },
                )
                .map(Box::new)
                .map(Reply::Load)
            } else {
                runtime::check_enabled(root, &plugin_id)?;
                let listing = runtime::prepare(root)?;
                if let Some(error) = listing
                    .plugins
                    .iter()
                    .find(|p| p.id == plugin_id)
                    .and_then(|p| p.error.as_ref())
                {
                    return Err(error.clone());
                }
                runtime::load(root, &plugin_id)
                    .map(Box::new)
                    .map(Reply::Load)
            }
        }
        Request::Check { plugin_id } => {
            runtime::check_enabled(root, &plugin_id).map(|_| Reply::Check { enabled: true })
        }
        Request::Uninstall {
            plugin_id,
            expected_revision,
        } => runtime::uninstall(root, &plugin_id, expected_revision.as_deref())
            .map(|revision| Reply::Uninstall { revision }),
        Request::SetEnabled {
            plugin_id,
            enabled,
            expected_revision,
        } => runtime::set_enabled(root, &plugin_id, enabled, expected_revision.as_deref())
            .map(|revision| Reply::SetEnabled { revision }),
    }
}

#[tauri::command]
pub async fn plugin_runtime(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    request: Request,
) -> Result<Reply, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let label = window.label().to_owned();
        let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
        let failure = if request.mutates() {
            "native.plugins.stateOutcomeUnknown"
        } else {
            "native.plugins.readFailed"
        };
        let request_mutates = request.mutates();
        let publication = match &request {
            Request::Uninstall { plugin_id, .. } => Some(crate::plugin_actions::acquire_removal(
                &app, &scope, plugin_id,
            )?),
            Request::SetEnabled {
                plugin_id,
                enabled: false,
                ..
            } => Some(
                crate::plugin_actions::acquire_publication(
                    &app,
                    &scope,
                    std::slice::from_ref(plugin_id),
                    &tokio_util::sync::CancellationToken::new(),
                )
                .await?,
            ),
            _ => None,
        };
        if publication.is_some() {
            let (plugin_id, expected) = match &request {
                Request::Uninstall {
                    plugin_id,
                    expected_revision,
                }
                | Request::SetEnabled {
                    plugin_id,
                    enabled: false,
                    expected_revision,
                } => (plugin_id, expected_revision),
                _ => unreachable!(),
            };
            let captured = crate::workspaces::with_authorization_session(
                &app,
                &label,
                &authorization,
                |location| {
                    let root = crate::files::local_root(&app, location)?
                        .ok_or("native.plugins.unavailable")?;
                    let listing = situate_core::plugins::runtime::list(&root)?;
                    if &listing.revision != expected {
                        return Err("native.plugins.stateConflict".into());
                    }
                    let incarnation = listing
                        .plugins
                        .iter()
                        .find(|plugin| &plugin.id == plugin_id)
                        .and_then(|plugin| plugin.incarnation.clone())
                        .ok_or("native.plugins.unavailable")?;
                    Ok(std::collections::HashMap::from([(
                        plugin_id.clone(),
                        incarnation,
                    )]))
                },
            )?;
            crate::ai_executor::retire_affected(&app, &scope, &captured).await?;
        }
        tauri::async_runtime::spawn_blocking(move || {
            let _publication = publication;
            let root = |location: &situate_core::workspaces::Location| {
                crate::files::local_root(&app, location)?
                    .ok_or_else(|| "native.plugins.unavailable".to_owned())
            };
            let execute = |root: &std::path::Path| {
                let recovery = match &request {
                    Request::Load { plugin_id, .. } | Request::Check { plugin_id } => {
                        crate::plugin_recovery::blocked(&app, &scope, plugin_id)
                    }
                    _ => false,
                };
                let changed = match &request {
                    Request::SetEnabled {
                        plugin_id, enabled, ..
                    } => Some((plugin_id.clone(), *enabled)),
                    Request::Uninstall { plugin_id, .. } => Some((plugin_id.clone(), false)),
                    _ => None,
                };
                let preparing = matches!(request, Request::List {});
                let reply = dispatch(root, recovery, request)?;
                if preparing {
                    crate::plugin_host::prepare_credentials(&app, root, &scope)?;
                }
                if let Some((id, enabled)) = changed {
                    if enabled {
                        crate::ai_executor::clear_unavailable(&app, &scope, Some(&id));
                        crate::plugin_recovery::resume(&app, &scope, Some(&id))?;
                    } else {
                        crate::plugin_recovery::reconcile(&app)?;
                    }
                }
                Ok(reply)
            };
            if request_mutates {
                crate::workspaces::with_authorization_session(
                    &app,
                    &label,
                    &authorization,
                    |location| execute(&root(location)?),
                )
            } else {
                crate::workspaces::with_authorized_read(
                    &app,
                    &label,
                    &authorization,
                    root,
                    |root| execute(root),
                )
            }
        })
        .await
        .map_err(|_| failure.to_owned())?
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
    use crate::workspaces::TestSessionChange;
    use serde_json::json;

    #[test]
    fn metadata_preparation_requests_use_leased_admission() {
        assert!(Request::List {}.mutates());
        assert!(
            Request::Load {
                plugin_id: "sample".into(),
                revision: None
            }
            .mutates()
        );
        assert!(
            !Request::Check {
                plugin_id: "sample".into()
            }
            .mutates()
        );
        assert!(
            !Request::Load {
                plugin_id: "sample".into(),
                revision: Some("pinned".into())
            }
            .mutates()
        );
    }

    #[test]
    fn listing_preparation_retries_only_refused_lock_admission() {
        let mut attempts = 0;
        let listing = prepare_listing(|| {
            attempts += 1;
            if attempts == 1 {
                Err("native.plugins.stateBusy".into())
            } else {
                Ok(Listing {
                    plugins: vec![],
                    revision: None,
                })
            }
        })
        .unwrap();
        assert!(listing.plugins.is_empty());
        assert_eq!(attempts, 2);
        for error in [
            "native.plugins.stateInvalid",
            "native.plugins.stateConflict",
            "native.plugins.stateOutcomeUnknown",
            "native.workspace.session.inactive",
        ] {
            let mut attempts = 0;
            assert_eq!(
                prepare_listing(|| {
                    attempts += 1;
                    Err(error.into())
                })
                .unwrap_err(),
                error
            );
            assert_eq!(attempts, 1);
        }
    }

    #[test]
    fn listing_preparation_keeps_a_finite_contention_budget() {
        let mut attempts = 0;
        assert_eq!(
            prepare_listing(|| {
                attempts += 1;
                Err("native.plugins.stateBusy".into())
            })
            .unwrap_err(),
            "native.plugins.stateBusy"
        );
        assert_eq!(attempts, 100);
    }

    #[test]
    fn strict_request_and_reply_contract() {
        for value in [
            json!({"operation":"setEnabled","pluginId":"sample","enabled":true}),
            json!({"operation":"setEnabled","pluginId":"sample","enabled":true,"expectedRevision":5}),
            json!({"operation":"load","pluginId":"sample","root":"/tmp"}),
            json!({"operation":"list","enabled":true}),
            json!({"operation":"activate","pluginId":"sample"}),
        ] {
            assert!(serde_json::from_value::<Request>(value).is_err());
        }
        assert_eq!(
            serde_json::to_value(Reply::Check { enabled: true }).unwrap(),
            json!({"enabled":true})
        );
        assert!(serde_json::from_value::<Request>(json!({"operation":"setEnabled","pluginId":"sample","enabled":false,"expectedRevision":null})).is_ok());
    }

    #[test]
    fn recovery_denies_sources_and_enabling_before_filesystem_access() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let missing = root.path().join("missing");
        for request in [
            Request::Load {
                plugin_id: "sample".into(),
                revision: None,
            },
            Request::Check {
                plugin_id: "sample".into(),
            },
            Request::SetEnabled {
                plugin_id: "sample".into(),
                enabled: true,
                expected_revision: None,
            },
        ] {
            assert_eq!(
                dispatch(&missing, true, request).unwrap_err(),
                "native.plugins.recoveryBlocked"
            );
        }
        let code = root.path().join(".situate/plugins/sample/code");
        std::fs::create_dir_all(&code).unwrap();
        std::fs::write(code.join("plugin.json"), "invalid manifest").unwrap();
        let disabled = dispatch(
            root.path(),
            true,
            Request::SetEnabled {
                plugin_id: "sample".into(),
                enabled: false,
                expected_revision: situate_core::plugins::runtime::list(root.path())
                    .unwrap()
                    .revision,
            },
        )
        .unwrap();
        assert!(serde_json::to_value(disabled).unwrap()["revision"].is_string());
        assert!(dispatch(root.path(), true, Request::List {}).is_ok());
        assert_eq!(
            dispatch(
                root.path(),
                false,
                Request::Load {
                    plugin_id: "sample".into(),
                    revision: None,
                }
            )
            .unwrap_err(),
            "native.plugins.disabled"
        );
    }

    #[test]
    fn check_uses_retained_authorization_without_loading_changed_sources() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let code = root.path().join(".situate/plugins/sample/code");
        std::fs::create_dir_all(&code).unwrap();
        std::fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":"sample","name":"Sample","description":"Synthetic plugin","serviceEntry":"entry.js"}).to_string()).unwrap();
        std::fs::write(code.join("entry.js"), "export default {};").unwrap();
        let revision = situate_core::plugins::runtime::set_enabled(
            root.path(),
            "sample",
            true,
            situate_core::plugins::runtime::list(root.path())
                .unwrap()
                .revision
                .as_deref(),
        )
        .unwrap();
        std::fs::write(code.join("entry.js"), [0xff]).unwrap();
        let check = || Request::Check {
            plugin_id: "sample".into(),
        };
        assert_eq!(
            serde_json::to_value(dispatch(root.path(), false, check()).unwrap()).unwrap(),
            json!({"enabled":true})
        );
        assert!(
            dispatch(
                root.path(),
                false,
                Request::Load {
                    plugin_id: "sample".into(),
                    revision: None,
                }
            )
            .is_err()
        );
        assert_eq!(
            dispatch(root.path(), true, check()).unwrap_err(),
            "native.plugins.recoveryBlocked"
        );
        situate_core::plugins::runtime::set_enabled(root.path(), "sample", false, Some(&revision))
            .unwrap();
        assert_eq!(
            dispatch(root.path(), false, check()).unwrap_err(),
            "native.plugins.disabled"
        );
    }

    #[test]
    fn rejects_foreign_closed_and_reopened_sessions_before_access() {
        let root = tempfile::tempdir().unwrap();
        let location = situate_core::workspaces::Location {
            id: "one".into(),
            name: "One".into(),
            display: "One".into(),
            kind: "path".into(),
            handle: root.path().to_string_lossy().into_owned(),
        };
        for value in [
            json!({"operation":"list"}),
            json!({"operation":"load","pluginId":"sample"}),
            json!({"operation":"check","pluginId":"sample"}),
            json!({"operation":"setEnabled","pluginId":"sample","enabled":false,"expectedRevision":null}),
            json!({"operation":"uninstall","pluginId":"sample","expectedRevision":null}),
        ] {
            for (window, scope, change) in [
                ("other", "one", TestSessionChange::None),
                ("window", "other", TestSessionChange::None),
                ("window", "one", TestSessionChange::Close),
                ("window", "one", TestSessionChange::Reopen),
            ] {
                let request: Request = serde_json::from_value(value.clone()).unwrap();
                let mut started = false;
                let result = crate::workspaces::with_test_authorized_root(
                    &[("window", location.clone())],
                    window,
                    scope,
                    request.mutates(),
                    change,
                    |root| {
                        started = true;
                        dispatch(root, false, request)
                    },
                );
                assert!(result.is_err());
                assert!(!started);
            }
        }
        assert!(!root.path().join(".situate").exists());
    }
}
