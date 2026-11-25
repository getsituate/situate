use super::{ID, Owner, STORAGE, UNAVAILABLE, access};
use sha2::{Digest, Sha256};
use situate_core::{
    content::SaveOutcome,
    plugins::{publication, sources},
};
use std::path::Path;
use tauri::Emitter;

const PACKAGE: [(&str, &str); 4] = [
    (
        "plugin.json",
        include_str!("../../plugins/gmail/plugin.json"),
    ),
    ("service.js", include_str!("../../plugins/gmail/service.js")),
    ("ui.js", include_str!("../../plugins/gmail/ui.js")),
    ("README.md", include_str!("../../plugins/gmail/README.md")),
];

const PREVIOUS_UI_SHA256: &str = "8dc62e7b2d3d6fdfc27a939e9df433007e14932028bcb96979c6d541d64c069b";

fn matches_package(source: &serde_json::Value) -> bool {
    let Ok(manifest) = serde_json::from_str::<situate_core::plugins::PluginManifest>(PACKAGE[0].1)
    else {
        return false;
    };
    serde_json::to_value(manifest).is_ok_and(|manifest| source["manifest"] == manifest)
        && source["serviceEntry"] == PACKAGE[1].1
        && source["modules"]
            .as_object()
            .is_some_and(|modules| modules.is_empty())
}

fn previous_bundle(source: &serde_json::Value) -> bool {
    matches_package(source)
        && source["uiEntry"]
            .as_str()
            .is_some_and(|ui| format!("{:x}", Sha256::digest(ui.as_bytes())) == PREVIOUS_UI_SHA256)
}

fn current_bundle(source: &serde_json::Value) -> bool {
    matches_package(source) && source["uiEntry"] == PACKAGE[2].1
}

pub(crate) fn bundled(source: &serde_json::Value) -> bool {
    current_bundle(source) || previous_bundle(source)
}

fn install_package(
    root: &Path,
    bind: impl FnOnce(String) -> Result<(), String>,
) -> Result<(), String> {
    sources::create(root, ID).map_err(|error| {
        if error == "native.plugins.stateConflict" {
            "native.gmail.packageExists".into()
        } else {
            error
        }
    })?;
    for (path, text) in PACKAGE {
        if !matches!(
            sources::write(root, ID, path, text, None)?,
            SaveOutcome::Saved { .. }
        ) {
            return Err("native.plugins.stateSaveFailed".into());
        }
    }
    let revision = sources::snapshot(root, ID)?;
    if !current_bundle(&package(root, &revision)?) {
        return Err("native.plugins.stateConflict".into());
    }
    let selected = std::slice::from_ref(&revision);
    let checked = publication::checked_closure(root, selected)?;
    bind(revision.incarnation.clone().ok_or(UNAVAILABLE)?)?;
    publication_result(publication::publish(root, selected, &checked, &[])?)
}

fn package(root: &Path, revision: &sources::PackageRevision) -> Result<serde_json::Value, String> {
    serde_json::to_value(sources::at_revision(root, revision)?).map_err(|_| UNAVAILABLE.into())
}

fn update_package(root: &Path, active: &sources::PackageRevision) -> Result<(), String> {
    let conflict = "native.plugins.stateConflict";
    let summary = situate_core::plugins::runtime::list(root)?
        .plugins
        .into_iter()
        .find(|entry| entry.id == ID)
        .ok_or(UNAVAILABLE)?;
    if !summary.enabled
        || summary.revision.as_ref() != Some(&active.revision)
        || summary.incarnation != active.incarnation
        || !previous_bundle(&package(root, active)?)
    {
        return Err(conflict.into());
    }
    let current_ui = sources::read(root, ID, "ui.js")?;
    let mut revision = sources::snapshot(root, ID)?;
    if &revision == active {
        if !matches!(
            sources::write(root, ID, "ui.js", PACKAGE[2].1, Some(&current_ui.revision))?,
            SaveOutcome::Saved { .. }
        ) {
            return Err(conflict.into());
        }
        revision = sources::snapshot(root, ID)?;
    }
    // A retry can finish a staged update but must not publish other source edits.
    let changes = sources::changes_between(root, ID, &active.revision, &revision.revision)?;
    if revision.incarnation != active.incarnation
        || !current_bundle(&package(root, &revision)?)
        || !matches!(changes.as_slice(), [change] if change.path == "ui.js")
    {
        return Err(conflict.into());
    }
    let checked = publication::checked_closure(root, std::slice::from_ref(&revision))?;
    publication_result(publication::replace_active(
        root, active, &revision, &checked,
    )?)
}

fn publication_result(publication: publication::Publication) -> Result<(), String> {
    match publication.status {
        publication::PublicationStatus::Published => Ok(()),
        publication::PublicationStatus::NeedsRecheck => Err("native.plugins.stateConflict".into()),
        publication::PublicationStatus::NotPublished => {
            Err("native.plugins.stateSaveFailed".into())
        }
        publication::PublicationStatus::OutcomeUnknown => {
            Err("native.plugins.stateOutcomeUnknown".into())
        }
    }
}

fn unavailable_update(install: bool) -> Result<bool, String> {
    if install {
        Err("native.plugins.stateConflict".into())
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub(crate) async fn gmail_install(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    install: bool,
    update: Option<bool>,
) -> Result<bool, String> {
    if !cfg!(target_os = "macos") {
        return Err(UNAVAILABLE.into());
    }
    let owner = Owner::new(app, &window, scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        let installed = owner.authorized(|location| {
            let root = crate::files::local_root(&owner.app, location)?.ok_or(UNAVAILABLE)?;
            if update == Some(true) {
                let listing = situate_core::plugins::runtime::list(&root)?;
                let active = listing
                    .plugins
                    .into_iter()
                    .find(|plugin| plugin.id == ID && plugin.enabled)
                    .and_then(|plugin| {
                        Some(sources::PackageRevision {
                            plugin_id: plugin.id,
                            revision: plugin.revision?,
                            incarnation: Some(plugin.incarnation?),
                        })
                    });
                let Some(active) = active else {
                    return unavailable_update(install);
                };
                let owned = access(&owner.app, |state| {
                    Ok((
                        state.owns(
                            &owner.scope,
                            active.incarnation.as_deref().ok_or(UNAVAILABLE)?,
                        ),
                        false,
                    ))
                })?;
                if !owned || !previous_bundle(&package(&root, &active)?) {
                    return unavailable_update(install);
                }
                if install {
                    owner.enabled()?;
                    update_package(&root, &active)?;
                }
                return Ok(true);
            }
            if !install {
                let listing = situate_core::plugins::runtime::list(&root)?;
                let Some(incarnation) = listing
                    .plugins
                    .iter()
                    .find(|plugin| plugin.id == ID && plugin.revision.is_some())
                    .and_then(|plugin| plugin.incarnation.as_deref())
                else {
                    return Ok(false);
                };
                return access(&owner.app, |state| {
                    Ok((state.owns(&owner.scope, incarnation), false))
                });
            }
            owner.enabled()?;
            install_package(&root, |incarnation| {
                access(&owner.app, |state| {
                    state.workspaces.insert(
                        owner.scope.clone(),
                        super::Workspace {
                            incarnation: Some(incarnation),
                            ..Default::default()
                        },
                    );
                    Ok(((), true))
                })
            })?;
            Ok(true)
        })?;
        if install {
            let _ = owner.app.emit(
                "plugin-executor-updated",
                serde_json::json!({"scope":owner.scope,"pluginIds":[ID]}),
            );
        }
        Ok(installed)
    })
    .await
    .map_err(|_| STORAGE)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::{Reply, Request, inspect_cancellable};
    use situate_core::plugins;
    use tokio_util::sync::CancellationToken;

    fn previous_installation(root: &Path) -> sources::PackageRevision {
        const UI: &str = include_str!("../../tests/fixtures/gmail/previous-ui.js");
        std::fs::create_dir(root.join(".situate")).unwrap();
        sources::create(root, ID).unwrap();
        for (path, text) in PACKAGE {
            let text = if path == "ui.js" { UI } else { text };
            assert!(matches!(
                sources::write(root, ID, path, text, None).unwrap(),
                SaveOutcome::Saved { .. }
            ));
        }
        let previous = sources::snapshot(root, ID).unwrap();
        let selected = std::slice::from_ref(&previous);
        let checked = publication::checked_closure(root, selected).unwrap();
        publication_result(publication::publish(root, selected, &checked, &[]).unwrap()).unwrap();
        previous
    }

    #[test]
    fn settings_update_keeps_the_installation_and_trusts_both_bundle_revisions() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let root = temp.path();
        let previous = previous_installation(root);
        update_package(root, &previous).unwrap();

        let installed = plugins::runtime::list(root).unwrap().plugins.remove(0);
        let current = sources::snapshot(root, ID).unwrap();
        assert_eq!(installed.incarnation, previous.incarnation);
        assert_ne!(installed.revision.as_ref(), Some(&previous.revision));
        assert_eq!(installed.revision.as_ref(), Some(&current.revision));
        assert!(installed.enabled);
        assert!(current_bundle(&package(root, &current).unwrap()));
        assert!(bundled(&package(root, &previous).unwrap()));
        assert_eq!(
            publication::replace_active(root, &previous, &current, std::slice::from_ref(&current))
                .unwrap_err(),
            "native.plugins.stateConflict"
        );
    }

    #[test]
    fn settings_update_can_finish_after_the_source_was_saved() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let root = temp.path();
        let previous = previous_installation(root);
        let ui = sources::read(root, ID, "ui.js").unwrap();
        assert!(matches!(
            sources::write(root, ID, "ui.js", PACKAGE[2].1, Some(&ui.revision)).unwrap(),
            SaveOutcome::Saved { .. }
        ));
        let staged = sources::snapshot(root, ID).unwrap();
        update_package(root, &previous).unwrap();
        let installed = plugins::runtime::list(root).unwrap().plugins.remove(0);
        assert_eq!(installed.revision.as_ref(), Some(&staged.revision));
    }

    #[test]
    fn settings_update_does_not_overwrite_edited_source() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let root = temp.path();
        let previous = previous_installation(root);
        let ui = sources::read(root, ID, "ui.js").unwrap();
        let local = format!("{}\n// Local edit\n", ui.text);
        assert!(matches!(
            sources::write(root, ID, "ui.js", &local, Some(&ui.revision)).unwrap(),
            SaveOutcome::Saved { .. }
        ));
        assert_eq!(
            update_package(root, &previous).unwrap_err(),
            "native.plugins.stateConflict"
        );
        assert_eq!(sources::read(root, ID, "ui.js").unwrap().text, local);
        let retained = plugins::runtime::list(root).unwrap();
        assert_eq!(
            retained.plugins[0].revision.as_ref(),
            Some(&previous.revision)
        );
    }

    #[test]
    fn installed_gmail_is_an_inspectable_active_connection_and_cannot_overwrite_a_package() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let mut authorized = None;
        install_package(root.path(), |incarnation| {
            authorized = Some(incarnation);
            Ok(())
        })
        .unwrap();
        let token = CancellationToken::new();
        let Reply::List { plugins: inventory } =
            inspect_cancellable(root.path(), Request::List {}, &token).unwrap()
        else {
            panic!("expected workspace inventory");
        };
        let [connection] = inventory.as_slice() else {
            panic!("expected one installed package");
        };
        assert_eq!(connection.id, "situate-gmail");
        let manifest = connection.manifest.as_ref().unwrap();
        assert_eq!(manifest.kind, Some(plugins::PluginKind::Connection));
        assert!(
            manifest
                .exports
                .as_ref()
                .unwrap()
                .contains(&"listMetadata".into())
        );
        let Reply::Read { text: guide } = inspect_cancellable(
            root.path(),
            Request::Read {
                plugin_id: connection.id.clone(),
                path: "README.md".to_owned(),
            },
            &token,
        )
        .unwrap() else {
            panic!("expected package guide");
        };
        assert!(guide.contains("Checking a consumer"));
        assert!(
            plugins::read(root.path(), "situate-gmail", "service.js")
                .unwrap()
                .contains("listMetadata")
        );
        let runtime = plugins::runtime::list(root.path()).unwrap();
        assert!(runtime.plugins[0].enabled);
        assert_eq!(authorized, runtime.plugins[0].incarnation);
        let mut source =
            serde_json::to_value(plugins::runtime::load(root.path(), ID).unwrap()).unwrap();
        assert!(bundled(&source));
        let revision = plugins::sources::snapshot(root.path(), ID).unwrap();
        let published =
            serde_json::to_value(plugins::sources::at_revision(root.path(), &revision).unwrap())
                .unwrap();
        assert!(bundled(&published));

        plugins::sources::create(root.path(), "mail-briefing").unwrap();
        let manifest = r#"{"schemaVersion":3,"id":"mail-briefing","name":"Mail briefing","description":"Show recent subjects.","dependencies":["situate-gmail"],"serviceEntry":"service.js"}"#;
        assert!(matches!(
            plugins::sources::write(root.path(), "mail-briefing", "plugin.json", manifest, None)
                .unwrap(),
            SaveOutcome::Saved { .. }
        ));
        assert!(matches!(
            plugins::sources::write(
                root.path(),
                "mail-briefing",
                "service.js",
                "export default () => ({})",
                None
            )
            .unwrap(),
            SaveOutcome::Saved { .. }
        ));
        let consumer = plugins::sources::snapshot(root.path(), "mail-briefing").unwrap();
        let checked =
            plugins::publication::checked_closure(root.path(), std::slice::from_ref(&consumer))
                .unwrap();
        assert!(checked.contains(&revision));
        assert!(checked.contains(&consumer));

        source["serviceEntry"] = serde_json::json!("export default () => ({})");
        assert!(!bundled(&source));
        assert_eq!(
            install_package(root.path(), |_| panic!(
                "existing package acquired authorization"
            ))
            .unwrap_err(),
            "native.gmail.packageExists"
        );
    }
}
