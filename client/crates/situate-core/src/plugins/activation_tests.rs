use super::*;
use std::{fs, path::PathBuf};

thread_local! {
    static FAILURE: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}

pub(super) fn fail_at(point: &str) -> io::Result<()> {
    if FAILURE.get() == Some(point) {
        FAILURE.set(None);
        Err(io::Error::other("injected persistence failure"))
    } else {
        Ok(())
    }
}

fn artifacts(code: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<_> = fs::read_dir(code.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("activation-")
        })
        .collect();
    paths.sort();
    paths
}

fn tempdir() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}

const ID: &str = "ae33fbf1-b47d-4f92-a249-a6f020bc4e4f";
const OTHER: &str = "be33fbf1-b47d-4f92-a249-a6f020bc4e4f";

fn setup(root: &Path) -> PathBuf {
    let code = root.join(".situate/plugins/demo/code");
    fs::create_dir_all(&code).unwrap();
    fs::write(code.join("plugin.json"), r#"{"schemaVersion":2,"id":"demo","name":"Demo","description":"Synthetic","serviceEntry":"main.js"}"#).unwrap();
    fs::write(code.join("main.js"), "export default {};").unwrap();
    fs::write(code.join("asset.bin"), [0, 255, 128]).unwrap();
    for name in ["config", "data"] {
        fs::create_dir(code.parent().unwrap().join(name)).unwrap();
        fs::write(code.parent().unwrap().join(name).join("retained"), name).unwrap();
    }
    drafts::create(root, ID, "demo").unwrap();
    code
}
fn draft(root: &Path, id: &str) -> PathBuf {
    root.join(".situate/plugins/demo/drafts")
        .join(id)
        .join("code")
}
fn assert_retained(code: &Path) {
    assert_eq!(
        fs::read_to_string(code.join("main.js")).unwrap(),
        "export default {};"
    );
    for name in ["config", "data"] {
        assert_eq!(
            fs::read_to_string(code.parent().unwrap().join(name).join("retained")).unwrap(),
            name
        );
    }
}

#[test]
fn legacy_snapshot_freezes_helper_modules_and_helper_changes_invalidate_publication() {
    let temp = tempdir();
    let root = temp.path();
    setup(root);
    let code = draft(root, ID);
    fs::create_dir(code.join("parts")).unwrap();
    fs::write(
        code.join("main.js"),
        "import { value } from './parts/value.js'; export default () => value;",
    )
    .unwrap();
    fs::write(code.join("parts/value.js"), "export const value = 42;").unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(code.join("plugin.json")).unwrap()).unwrap();
    manifest["uiEntry"] = serde_json::json!("view.js");
    fs::write(code.join("plugin.json"), manifest.to_string()).unwrap();
    let ui = "import { value } from './parts/value.js'; export default { template: '<p>{{ value }}</p>' };";
    fs::write(code.join("view.js"), ui).unwrap();
    let captured = snapshot(root, ID).unwrap();
    assert_eq!(
        captured.sources().unwrap().modules["parts/value.js"],
        "export const value = 42;"
    );
    fs::write(code.join("parts/value.js"), "export const value = 99;").unwrap();
    fs::write(code.join("view.js"), "export default {};").unwrap();
    assert_eq!(captured.sources().unwrap().ui_entry.as_deref(), Some(ui));
    assert_eq!(captured.sources().unwrap().modules.len(), 1);
    assert_eq!(
        captured.sources().unwrap().modules["parts/value.js"],
        "export const value = 42;"
    );
    assert_ne!(snapshot(root, ID).unwrap().digest(), captured.digest());
    assert!(matches!(
        publish(root, ID, captured.digest()),
        Err(ActivationError::Changed)
    ));
    let latest = snapshot(root, ID).unwrap();
    publish(root, ID, latest.digest()).unwrap();
    assert_eq!(
        runtime::load(root, "demo").unwrap().ui_entry.as_deref(),
        Some("export default {};")
    );
    assert_eq!(
        runtime::load(root, "demo").unwrap().modules["parts/value.js"],
        "export const value = 99;"
    );
}

#[test]
fn digest_covers_binary_bytes_and_reverted_code_not_history() {
    let temp = tempdir();
    let root = temp.path();
    setup(root);
    let first = snapshot(root, ID).unwrap();
    assert_eq!(
        first.sources().unwrap().service_entry.as_deref(),
        Some("export default {};")
    );
    assert_eq!(first.info().id, ID);
    assert_eq!(first.manifest().id, "demo");
    assert_eq!(
        first
            .entries()
            .iter()
            .find(|e| e.path == "asset.bin")
            .unwrap()
            .bytes
            .as_deref(),
        Some(&[0, 255, 128][..])
    );
    fs::write(draft(root, ID).join("asset.bin"), [0, 255, 129]).unwrap();
    assert_ne!(snapshot(root, ID).unwrap().digest(), first.digest());
    assert!(matches!(
        publish(root, ID, first.digest()),
        Err(ActivationError::Changed)
    ));
    fs::write(draft(root, ID).join("asset.bin"), [0, 255, 128]).unwrap();
    let original = drafts::read(root, ID, "main.js").unwrap();
    drafts::write(root, ID, "main.js", "changed", Some(&original.revision)).unwrap();
    let changed = drafts::read(root, ID, "main.js").unwrap();
    drafts::write(root, ID, "main.js", &original.text, Some(&changed.revision)).unwrap();
    assert_eq!(snapshot(root, ID).unwrap().digest(), first.digest());
}

#[test]
fn new_plugin_publication_needs_no_previous_installation() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    let checked = snapshot(root, ID).unwrap();
    fs::remove_dir_all(&code).unwrap();
    assert!(runtime::list(root).unwrap().plugins.is_empty());
    publish(root, ID, checked.digest()).unwrap();
    runtime::check_enabled(root, "demo").unwrap();
    assert_eq!(
        fs::read_to_string(code.join("main.js")).unwrap(),
        "export default {};"
    );
    assert_eq!(snapshot(root, ID).unwrap().digest(), checked.digest());
}

#[test]
fn successive_same_plugin_publications_enable_and_retain_both_drafts() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    drafts::create(root, OTHER, "demo").unwrap();
    fs::write(draft(root, ID).join("main.js"), "first").unwrap();
    fs::write(draft(root, OTHER).join("main.js"), "second").unwrap();
    let first = snapshot(root, ID).unwrap();
    let second = snapshot(root, OTHER).unwrap();
    assert!(!publish(root, ID, first.digest()).unwrap().cleanup_pending);
    assert!(artifacts(&code).is_empty());
    runtime::check_enabled(root, "demo").unwrap();
    assert_eq!(fs::read_to_string(code.join("main.js")).unwrap(), "first");
    assert!(
        !publish(root, OTHER, second.digest())
            .unwrap()
            .cleanup_pending
    );
    assert!(artifacts(&code).is_empty());
    assert_eq!(fs::read_to_string(code.join("main.js")).unwrap(), "second");
    assert_eq!(fs::read(code.join("asset.bin")).unwrap(), [0, 255, 128]);
    assert_eq!(snapshot(root, ID).unwrap().digest(), first.digest());
    assert_eq!(snapshot(root, OTHER).unwrap().digest(), second.digest());
    for name in ["config", "data"] {
        assert_eq!(
            fs::read_to_string(code.parent().unwrap().join(name).join("retained")).unwrap(),
            name
        );
    }
}

#[test]
fn installed_history_retains_code_and_binary_versions_without_configuration() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    fs::write(draft(root, ID).join("main.js"), "first version").unwrap();
    fs::write(draft(root, ID).join("asset.bin"), [1, 2, 255]).unwrap();
    publish(root, ID, snapshot(root, ID).unwrap().digest()).unwrap();
    fs::write(draft(root, ID).join("main.js"), "second version").unwrap();
    publish(root, ID, snapshot(root, ID).unwrap().digest()).unwrap();
    let history = crate::content::ContentStore::open_with_history(
        &code,
        &code.parent().unwrap().join(".situate"),
    )
    .unwrap();
    let versions = history.file_history("main.js").unwrap();
    let texts: Vec<_> = versions
        .iter()
        .map(|v| history.read_file_revision("main.js", &v.revision).unwrap())
        .collect();
    for text in ["export default {};", "first version", "second version"] {
        assert!(texts.contains(&text.as_bytes().to_vec()));
    }
    let first = versions
        .iter()
        .find(|v| history.read_file_revision("main.js", &v.revision).unwrap() == b"first version")
        .unwrap();
    assert_eq!(
        history
            .read_file_revision("asset.bin", &first.revision)
            .unwrap(),
        [1, 2, 255]
    );
    assert!(
        history
            .list()
            .unwrap()
            .iter()
            .all(|entry| !entry.path.starts_with("config") && !entry.path.starts_with("data"))
    );
}

#[test]
fn legacy_publication_updates_a_pinned_active_revision_without_following_later_edits() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    runtime::set_enabled(
        root,
        "demo",
        true,
        runtime::list(root).unwrap().revision.as_deref(),
    )
    .unwrap();
    let old = super::super::sources::read(root, "demo", "main.js").unwrap();
    super::super::sources::write(
        root,
        "demo",
        "main.js",
        "prepared source",
        Some(&old.revision),
    )
    .unwrap();
    let previous = runtime::list(root).unwrap().plugins[0]
        .revision
        .clone()
        .unwrap();
    fs::write(draft(root, ID).join("main.js"), "published draft").unwrap();
    publish(root, ID, snapshot(root, ID).unwrap().digest()).unwrap();
    let active = runtime::list(root).unwrap().plugins[0]
        .revision
        .clone()
        .unwrap();
    assert_ne!(active, previous);
    assert_eq!(
        runtime::load(root, "demo")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("published draft")
    );
    fs::write(code.join("main.js"), "later unchecked edit").unwrap();
    assert_eq!(
        runtime::load(root, "demo")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("published draft")
    );
}

#[test]
fn uncertain_history_recording_retains_published_code_and_its_backup() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    fs::write(draft(root, ID).join("main.js"), "published").unwrap();
    FAILURE.set(Some("history"));
    assert!(matches!(
        publish(root, ID, snapshot(root, ID).unwrap().digest()),
        Err(ActivationError::OutcomeUnknown { .. })
    ));
    assert_eq!(
        fs::read_to_string(code.join("main.js")).unwrap(),
        "published"
    );
    let retained = artifacts(&code);
    assert_eq!(retained.len(), 1);
    assert_eq!(
        fs::read_to_string(retained[0].join("main.js")).unwrap(),
        "export default {};"
    );
}

#[test]
fn damaged_installed_history_blocks_publication_without_resetting_it() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    let checked = snapshot(root, ID).unwrap();
    publish(root, ID, checked.digest()).unwrap();
    let marker = code.parent().unwrap().join(".situate");
    fs::remove_dir_all(marker.join("history.git")).unwrap();
    fs::write(draft(root, ID).join("main.js"), "unpublished").unwrap();
    assert!(publish(root, ID, snapshot(root, ID).unwrap().digest()).is_err());
    assert_retained(&code);
    assert!(!marker.join("history.git").exists());
}

#[test]
fn invalid_and_missing_manifests_preserve_active_code_config_and_data() {
    for invalid in [
        Some("{"),
        Some(
            r#"{"schemaVersion":2,"id":"demo","name":"Demo","description":"Synthetic","serviceEntry":"../escape.js"}"#,
        ),
        None,
    ] {
        let temp = tempdir();
        let root = temp.path();
        let code = setup(root);
        let checked = snapshot(root, ID).unwrap();
        let path = draft(root, ID).join("plugin.json");
        if let Some(text) = invalid {
            fs::write(path, text).unwrap();
        } else {
            fs::remove_file(path).unwrap();
        }
        assert!(snapshot(root, ID).is_err());
        assert!(publish(root, ID, checked.digest()).is_err());
        assert_retained(&code);
    }
}

#[test]
fn runtime_save_failure_restores_code_and_cleans_own_stage() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    fs::write(draft(root, ID).join("main.js"), "replacement").unwrap();
    let checked = snapshot(root, ID).unwrap();
    // A directory cannot be opened as the runtime state lock file.
    fs::create_dir(root.join(".situate/plugin-state.lock")).unwrap();
    assert!(matches!(
        publish(root, ID, checked.digest()),
        Err(ActivationError::State(_))
    ));
    assert_retained(&code);
    assert!(artifacts(&code).is_empty());
    assert!(runtime::check_enabled(root, "demo").is_err());
}

#[test]
fn failed_preflight_cleans_only_its_stage_and_preserves_prior_artifacts() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    let prior = code.parent().unwrap().join("activation-prior-staged");
    fs::create_dir(&prior).unwrap();
    fs::write(prior.join("evidence"), "retained").unwrap();
    let checked = snapshot(root, ID).unwrap();
    FAILURE.set(Some("preflight"));
    assert!(publish(root, ID, checked.digest()).is_err());
    assert_retained(&code);
    assert_eq!(artifacts(&code), vec![prior.clone()]);
    assert_eq!(
        fs::read_to_string(prior.join("evidence")).unwrap(),
        "retained"
    );
    assert_eq!(snapshot(root, ID).unwrap().digest(), checked.digest());
}

#[test]
fn uncertain_publication_retains_both_attempt_artifacts_without_compensation() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    fs::write(draft(root, ID).join("main.js"), "replacement").unwrap();
    let checked = snapshot(root, ID).unwrap();
    FAILURE.set(Some("backup-sync"));
    let Err(ActivationError::OutcomeUnknown { attempt, .. }) = publish(root, ID, checked.digest())
    else {
        panic!("expected uncertain publication");
    };
    assert!(!code.exists());
    let parent = code.parent().unwrap();
    assert_eq!(
        fs::read_to_string(parent.join(format!("{attempt}-backup/main.js"))).unwrap(),
        "export default {};"
    );
    assert_eq!(
        fs::read_to_string(parent.join(format!("{attempt}-staged/main.js"))).unwrap(),
        "replacement"
    );
    assert_eq!(artifacts(&code).len(), 2);
    assert_eq!(snapshot(root, ID).unwrap().digest(), checked.digest());
}

#[test]
fn cleanup_sync_failure_does_not_reverse_successful_publication() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    fs::write(draft(root, ID).join("main.js"), "replacement").unwrap();
    let checked = snapshot(root, ID).unwrap();
    FAILURE.set(Some("cleanup-sync"));
    assert!(publish(root, ID, checked.digest()).unwrap().cleanup_pending);
    assert_eq!(
        fs::read_to_string(code.join("main.js")).unwrap(),
        "replacement"
    );
    assert!(artifacts(&code).is_empty());
    runtime::check_enabled(root, "demo").unwrap();
}

#[test]
fn cleanup_failure_keeps_success_and_eventually_blocks_new_artifacts() {
    let temp = tempdir();
    let root = temp.path();
    let code = setup(root);
    fs::write(draft(root, ID).join("main.js"), "replacement").unwrap();
    let checked = snapshot(root, ID).unwrap();
    for count in 1..=7 {
        FAILURE.set(Some("cleanup"));
        assert!(publish(root, ID, checked.digest()).unwrap().cleanup_pending);
        assert_eq!(artifacts(&code).len(), count);
        assert_eq!(
            fs::read_to_string(code.join("main.js")).unwrap(),
            "replacement"
        );
        runtime::check_enabled(root, "demo").unwrap();
    }
    let before = artifacts(&code);
    assert!(matches!(
        publish(root, ID, checked.digest()),
        Err(ActivationError::Draft(drafts::DraftError::Plugin(
            PluginError::TooLarge
        )))
    ));
    assert_eq!(artifacts(&code), before);
    assert_eq!(snapshot(root, ID).unwrap().digest(), checked.digest());
}

#[test]
fn snapshot_rejects_limits_and_unsafe_paths() {
    for kind in ["size", "total", "depth", "count", "path"] {
        let temp = tempdir();
        let root = temp.path();
        let active = setup(root);
        let code = draft(root, ID);
        match kind {
            "size" => fs::File::create(code.join("large.bin"))
                .unwrap()
                .set_len(MAX_TEXT + 1)
                .unwrap(),
            "total" => {
                for index in 0..65 {
                    fs::File::create(code.join(format!("{index}.bin")))
                        .unwrap()
                        .set_len(MAX_TEXT)
                        .unwrap();
                }
            }
            "depth" => {
                fs::create_dir_all(code.join(vec!["deep"; MAX_DEPTH + 1].join("/"))).unwrap()
            }
            "count" => {
                for index in 0..MAX_FILES {
                    fs::write(code.join(format!("{index}.bin")), []).unwrap();
                }
            }
            _ => fs::write(code.join("bad name"), []).unwrap(),
        }
        assert!(snapshot(root, ID).is_err(), "{kind}");
        assert_retained(&active);
    }
    let temp = tempdir();
    assert!(snapshot(temp.path(), "../escape").is_err());
}

#[cfg(unix)]
#[test]
fn symlinks_are_rejected_at_source_and_destination_boundaries() {
    use std::os::unix::fs::symlink;
    let temp = tempdir();
    let root = temp.path();
    let active = setup(root);
    let outside = tempdir();
    fs::write(outside.path().join("private"), "retained").unwrap();
    symlink(outside.path(), draft(root, ID).join("escape")).unwrap();
    assert!(snapshot(root, ID).is_err());
    fs::remove_file(draft(root, ID).join("escape")).unwrap();
    let checked = snapshot(root, ID).unwrap();
    fs::rename(&active, active.with_file_name("original")).unwrap();
    symlink(outside.path(), &active).unwrap();
    assert!(publish(root, ID, checked.digest()).is_err());
    assert_eq!(
        fs::read_to_string(outside.path().join("private")).unwrap(),
        "retained"
    );
}
