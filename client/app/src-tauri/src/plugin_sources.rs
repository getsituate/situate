use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use situate_core::{
    content::{OperationOutcome, SaveOutcome},
    plugins::sources,
};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Create {
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
    Write {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        path: String,
        text: String,
        #[serde(rename = "expectedRevision", deserialize_with = "required_revision")]
        expected_revision: Option<String>,
    },
    Mkdir {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        path: String,
    },
    Remove {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        path: String,
    },
    Rename {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        path: String,
        destination: String,
    },
    Capture {
        #[serde(rename = "pluginId")]
        plugin_id: String,
    },
}
fn required_revision<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::deserialize(d)
}
fn structural_change(
    root: &Path,
    id: &str,
    path: &str,
    destination: Option<&str>,
) -> Result<Value, String> {
    let before = sources::capture(root, id)?;
    let prefix = format!("{path}/");
    let paths = sources::files_at_revision(root, id, &before.revision)?
        .into_iter()
        .filter(|file| !file.is_directory && (file.path == path || file.path.starts_with(&prefix)))
        .map(|file| file.path)
        .collect::<Vec<_>>();
    let outcome = match destination {
        Some(target) => sources::rename(root, id, path, target)?,
        None => sources::remove(root, id, path)?,
    };
    Ok(structural_reply(
        root,
        id,
        path,
        destination,
        &before,
        paths,
        outcome,
    ))
}

fn structural_reply(
    root: &Path,
    id: &str,
    path: &str,
    destination: Option<&str>,
    before: &sources::PackageRevision,
    paths: Vec<String>,
    outcome: OperationOutcome,
) -> Value {
    let mut reply = json!({"outcome":outcome,"comparisonUnavailable":matches!(&outcome, OperationOutcome::PartialFailure { .. })});
    if let OperationOutcome::Complete { history_revision } = outcome {
        let mut covered = std::collections::HashSet::new();
        let mut changes = paths.into_iter().map(|old| {
            covered.insert(old.clone());
            let after = destination.map(|target| {
                let target = format!("{target}{}", &old[path.len()..]);
                covered.insert(target.clone());
                json!({"path":target,"revision":history_revision})
            });
            json!({"store":"plugin","pluginId":id,"operation":if destination.is_some(){"renamed"}else{"deleted"},"before":{"path":old,"revision":before.revision},"after":after,"attribution":"uncertain"})
        }).collect::<Vec<_>>();
        match sources::changes_between(root, id, &before.revision, &history_revision) {
            Ok(deltas) => {
                let collateral = crate::change_history::recorded_changes(
                    deltas
                        .into_iter()
                        .filter(|delta| !covered.contains(&delta.path))
                        .collect(),
                    &before.revision,
                    &history_revision,
                    Some(id),
                );
                if let Value::Array(collateral) = collateral {
                    changes.extend(collateral);
                }
            }
            Err(_) => reply["comparisonUnavailable"] = json!(true),
        }
        reply["changes"] = json!(changes);
    }
    reply
}
pub(crate) fn dispatch(root: &Path, request: Request) -> Result<Value, String> {
    match request {
        Request::Create { plugin_id } => {
            sources::create(root, &plugin_id)?;
            Ok(json!({"pluginId":plugin_id,"created":true}))
        }
        Request::Mkdir { plugin_id, path } => {
            let outcome = sources::mkdir(root, &plugin_id, &path)?;
            Ok(
                json!({"outcome":outcome,"comparisonUnavailable":matches!(&outcome, OperationOutcome::PartialFailure { .. })}),
            )
        }
        Request::Remove { plugin_id, path } => structural_change(root, &plugin_id, &path, None),
        Request::Rename {
            plugin_id,
            path,
            destination,
        } => structural_change(root, &plugin_id, &path, Some(&destination)),
        Request::Capture { plugin_id } => {
            let before = sources::head(root, &plugin_id).ok();
            let after = sources::snapshot(root, &plugin_id)?;
            let comparison = before.as_ref().and_then(|before| {
                sources::changes_between(root, &plugin_id, &before.revision, &after.revision)
                    .ok()
                    .map(|changes| {
                        crate::change_history::recorded_changes(
                            changes,
                            &before.revision,
                            &after.revision,
                            Some(&plugin_id),
                        )
                    })
            });
            Ok(
                json!({"pluginId":plugin_id,"revision":after.revision,"comparisonUnavailable":comparison.is_none(),"changes":comparison.unwrap_or_else(|| json!([]))}),
            )
        }
        Request::Write {
            plugin_id,
            path,
            text,
            expected_revision,
        } => {
            let existed = expected_revision.is_some();
            let before = sources::capture(root, &plugin_id)?;
            let outcome =
                sources::write(root, &plugin_id, &path, &text, expected_revision.as_deref())?;
            let mut reply = json!({"outcome":outcome,"comparisonUnavailable":matches!(&outcome, SaveOutcome::SavedHistoryFailed { .. })});
            let after = match &outcome {
                SaveOutcome::Saved {
                    history_revision,
                    version,
                }
                | SaveOutcome::SavedDraftCleanupFailed {
                    history_revision,
                    version,
                    ..
                } => Some((history_revision, version)),
                _ => None,
            };
            if let Some((after, version)) =
                after.filter(|(after, _)| after.as_str() != before.revision)
            {
                let before_matches = match expected_revision.as_deref() {
                    None => true,
                    Some(expected) => {
                        match sources::revision(root, &plugin_id, &path, &before.revision) {
                            Ok(bytes) => {
                                String::from_utf8(bytes)
                                    .ok()
                                    .and_then(|text| {
                                        situate_core::content::revision_for_text(&text).ok()
                                    })
                                    .as_deref()
                                    == Some(expected)
                            }
                            Err(_) => {
                                reply["comparisonUnavailable"] = json!(true);
                                false
                            }
                        }
                    }
                };
                let after_bytes = sources::revision(root, &plugin_id, &path, after);
                if after_bytes.is_err() {
                    reply["comparisonUnavailable"] = json!(true);
                }
                let recorded = before_matches
                    && after_bytes.is_ok_and(|bytes| bytes == version.text.as_bytes());
                reply["change"] = json!({
                    "store":"plugin","pluginId":plugin_id,"operation":if existed {"modified"} else {"added"},
                    "before":if existed {Some(json!({"path":path,"revision":before.revision}))} else {None},
                    "after":{"path":path,"revision":after},"attribution":if recorded{"recorded"}else{"uncertain"}
                });
            }
            Ok(reply)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_source_requests_require_explicit_creation_or_read_revision() {
        for value in [
            json!({"operation":"write","pluginId":"notes","path":"index.js","text":"x"}),
            json!({"operation":"read","pluginId":"notes","path":"index.js","draftId":"other"}),
            json!({"operation":"create","pluginId":"notes","enabled":true}),
        ] {
            assert!(serde_json::from_value::<Request>(value).is_err());
        }
    }
    #[test]
    fn structural_receipts_and_external_observations_keep_historical_source_paths() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        sources::create(root.path(), "mail").unwrap();
        sources::mkdir(root.path(), "mail", "views").unwrap();
        sources::write(
            root.path(),
            "mail",
            "views/old.js",
            "export const count=1;",
            None,
        )
        .unwrap();
        let moved = dispatch(
            root.path(),
            Request::Rename {
                plugin_id: "mail".into(),
                path: "views".into(),
                destination: "screens".into(),
            },
        )
        .unwrap();
        assert_eq!(moved["changes"][0]["before"]["path"], "views/old.js");
        assert_eq!(moved["changes"][0]["after"]["path"], "screens/old.js");
        assert_eq!(moved["changes"][0]["operation"], "renamed");
        let prior = sources::head(root.path(), "mail").unwrap();
        std::fs::write(
            root.path()
                .join(".situate/plugins/mail/code/screens/old.js"),
            "export const count=2;",
        )
        .unwrap();
        assert_eq!(sources::head(root.path(), "mail").unwrap(), prior);
        let observed = dispatch(
            root.path(),
            Request::Capture {
                plugin_id: "mail".into(),
            },
        )
        .unwrap();
        assert_eq!(observed["changes"].as_array().unwrap().len(), 1);
        assert_eq!(observed["changes"][0]["attribution"], "uncertain");
        assert_eq!(observed["changes"][0]["before"]["revision"], prior.revision);
        let removed = dispatch(
            root.path(),
            Request::Remove {
                plugin_id: "mail".into(),
                path: "screens".into(),
            },
        )
        .unwrap();
        assert_eq!(removed["changes"][0]["operation"], "deleted");
        assert!(removed["changes"][0]["after"].is_null());
        assert_eq!(
            sources::revision(
                root.path(),
                "mail",
                "screens/old.js",
                removed["changes"][0]["before"]["revision"]
                    .as_str()
                    .unwrap()
            )
            .unwrap(),
            b"export const count=2;"
        );
    }
    #[test]
    fn rename_receipts_include_collateral_skill_links_without_duplicate_move_deltas() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        sources::create(root.path(), "mail").unwrap();
        sources::write(
            root.path(),
            "mail",
            "entry.js",
            "export const value=1;",
            None,
        )
        .unwrap();
        sources::write(
            root.path(),
            "mail",
            "SKILL.md",
            "# Mail\n[Entry](entry.js)\n",
            None,
        )
        .unwrap();
        let reply = dispatch(
            root.path(),
            Request::Rename {
                plugin_id: "mail".into(),
                path: "entry.js".into(),
                destination: "main.js".into(),
            },
        )
        .unwrap();
        let changes = reply["changes"].as_array().unwrap();
        assert_eq!(changes.len(), 2);
        assert_eq!(reply["comparisonUnavailable"], false);
        let moved = changes
            .iter()
            .find(|change| change["operation"] == "renamed")
            .unwrap();
        assert_eq!(moved["before"]["path"], "entry.js");
        assert_eq!(moved["after"]["path"], "main.js");
        let skill = changes
            .iter()
            .find(|change| change["operation"] == "modified")
            .unwrap();
        assert_eq!(skill["before"]["path"], "SKILL.md");
        assert_eq!(skill["after"]["path"], "SKILL.md");
        assert_eq!(skill["attribution"], "uncertain");
        let before = sources::revision(
            root.path(),
            "mail",
            "SKILL.md",
            skill["before"]["revision"].as_str().unwrap(),
        )
        .unwrap();
        let after = sources::revision(
            root.path(),
            "mail",
            "SKILL.md",
            skill["after"]["revision"].as_str().unwrap(),
        )
        .unwrap();
        assert!(String::from_utf8(before).unwrap().contains("(entry.js)"));
        assert!(String::from_utf8(after).unwrap().contains("(main.js)"));
    }

    #[test]
    fn source_capture_without_prior_history_retains_an_unavailable_comparison() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let code = root.path().join(".situate/plugins/mail/code");
        std::fs::create_dir_all(&code).unwrap();
        std::fs::write(code.join("entry.js"), "external source").unwrap();
        let reply = dispatch(
            root.path(),
            Request::Capture {
                plugin_id: "mail".into(),
            },
        )
        .unwrap();
        assert_eq!(reply["comparisonUnavailable"], true);
        assert_eq!(reply["changes"], json!([]));
        assert!(reply["revision"].as_str().is_some());
    }

    #[test]
    fn partial_structural_outcomes_and_missing_history_preserve_comparison_uncertainty() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        sources::create(root.path(), "mail").unwrap();
        sources::write(root.path(), "mail", "old.js", "source", None).unwrap();
        let before = sources::capture(root.path(), "mail").unwrap();
        sources::rename(root.path(), "mail", "old.js", "new.js").unwrap();
        let outcome = OperationOutcome::PartialFailure {
            changed_paths: vec!["old.js".into(), "new.js".into()],
            recovery_revision: before.revision.clone(),
            error: "native.content.history.unavailable".into(),
        };
        let reply = structural_reply(
            root.path(),
            "mail",
            "old.js",
            Some("new.js"),
            &before,
            vec!["old.js".into()],
            outcome,
        );
        assert_eq!(reply["comparisonUnavailable"], true);
        assert_eq!(
            reply["outcome"]["PartialFailure"]["changed_paths"],
            json!(["old.js", "new.js"])
        );
        assert!(reply.get("changes").is_none());
        assert_eq!(
            sources::read(root.path(), "mail", "new.js").unwrap().text,
            "source"
        );
        let reply = structural_reply(
            root.path(),
            "mail",
            "old.js",
            Some("new.js"),
            &before,
            vec!["old.js".into()],
            OperationOutcome::Complete {
                history_revision: "a".repeat(40),
            },
        );
        assert_eq!(reply["comparisonUnavailable"], true);
        assert_eq!(reply["changes"].as_array().unwrap().len(), 1);
        assert_eq!(reply["changes"][0]["attribution"], "uncertain");
    }

    #[test]
    fn shared_writes_record_source_revision_pairs_without_activating_code() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        dispatch(
            root.path(),
            Request::Create {
                plugin_id: "notes".into(),
            },
        )
        .unwrap();
        let added = dispatch(
            root.path(),
            Request::Write {
                plugin_id: "notes".into(),
                path: "index.js".into(),
                text: "export const limit=10;".into(),
                expected_revision: None,
            },
        )
        .unwrap();
        assert_eq!(added["change"]["operation"], "added");
        assert!(added["change"]["before"].is_null());
        assert_eq!(added["change"]["attribution"], "recorded");
        let revision = sources::read(root.path(), "notes", "index.js")
            .unwrap()
            .revision;
        let changed = dispatch(
            root.path(),
            Request::Write {
                plugin_id: "notes".into(),
                path: "index.js".into(),
                text: "export const limit=20;".into(),
                expected_revision: Some(revision),
            },
        )
        .unwrap();
        assert_eq!(changed["change"]["operation"], "modified");
        assert_eq!(changed["change"]["attribution"], "recorded");
        assert_ne!(
            changed["change"]["before"]["revision"],
            changed["change"]["after"]["revision"]
        );
        assert!(situate_core::plugins::runtime::check_enabled(root.path(), "notes").is_err());
        let before = changed["change"]["before"]["revision"].as_str().unwrap();
        assert_eq!(
            sources::revision(root.path(), "notes", "index.js", before).unwrap(),
            b"export const limit=10;"
        );
    }
}
