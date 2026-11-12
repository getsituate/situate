use super::*;
use serde_json::json;
use std::fs;

fn temporary() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}

fn fixture() -> tempfile::TempDir {
    let root = temporary();
    let code = root.path().join(".situate/plugins/sample/code");
    fs::create_dir_all(&code).unwrap();
    fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":"sample","name":"Sample","description":"Synthetic plugin","serviceEntry":"entry.js","skills":["skill.md"]}).to_string()).unwrap();
    fs::write(code.join("entry.js"), "throw new Error('never execute');").unwrap();
    fs::write(code.join("skill.md"), "# Sample skill").unwrap();
    root
}

#[test]
fn runtime_modules_and_both_entries_are_pinned_not_reread_from_editable_source() {
    let root = fixture();
    let code = root.path().join(".situate/plugins/sample/code");
    fs::create_dir(code.join("parts")).unwrap();
    fs::write(
        code.join("entry.js"),
        "import { value } from './parts/value.js'; export default () => value;",
    )
    .unwrap();
    fs::write(code.join("parts/value.js"), "export const value = 42;").unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(code.join("plugin.json")).unwrap()).unwrap();
    manifest["uiEntry"] = json!("view.js");
    fs::write(code.join("plugin.json"), manifest.to_string()).unwrap();
    let ui = "import { value } from './parts/value.js'; export default { template: '<p>{{ value }}</p>' };";
    fs::write(code.join("view.js"), ui).unwrap();
    let listing = list(root.path()).unwrap();
    set_enabled(root.path(), "sample", true, listing.revision.as_deref()).unwrap();
    prepare(root.path()).unwrap();
    fs::write(code.join("parts/value.js"), "export const value = 99;").unwrap();
    fs::write(code.join("view.js"), "unpublished UI source").unwrap();
    fs::write(code.join("entry.js"), "unpublished service source").unwrap();
    fs::write(code.join("unpublished.js"), "export const value = 100;").unwrap();
    let sources = load(root.path(), "sample").unwrap();
    assert_eq!(sources.ui_entry.as_deref(), Some(ui));
    assert_eq!(
        sources.service_entry.as_deref(),
        Some("import { value } from './parts/value.js'; export default () => value;")
    );
    let serialized = serde_json::to_value(&sources).unwrap();
    assert_eq!(serialized["uiEntry"], ui);
    assert_eq!(
        serialized["serviceEntry"],
        sources.service_entry.as_deref().unwrap()
    );
    assert!(serialized.get("entry").is_none());
    assert_eq!(sources.modules.len(), 1);
    assert_eq!(
        sources.modules["parts/value.js"],
        "export const value = 42;"
    );
    assert_eq!(
        serde_json::to_value(&sources).unwrap()["modules"]["parts/value.js"],
        "export const value = 42;"
    );
    fs::remove_file(code.join("parts/value.js")).unwrap();
    assert_eq!(
        load(root.path(), "sample").unwrap().modules,
        sources.modules
    );
}

#[test]
fn ui_only_and_skills_only_sources_have_no_service_entry() {
    let root = fixture();
    let code = root.path().join(".situate/plugins/sample/code");
    for ui in [true, false] {
        let mut manifest = json!({
            "schemaVersion": 2, "id": "sample", "name": "Sample",
            "description": "Synthetic", "skills": ["skill.md"]
        });
        if ui {
            manifest["uiEntry"] = json!("entry.js");
        }
        fs::write(code.join("plugin.json"), manifest.to_string()).unwrap();
        let source = sources(root.path(), "sample").unwrap();
        let serialized = serde_json::to_value(&source).unwrap();
        assert!(serialized["serviceEntry"].is_null());
        assert_eq!(
            source.ui_entry.as_deref(),
            ui.then_some("throw new Error('never execute');")
        );
        assert_eq!(source.modules.len(), 0);
        assert_eq!(serialized["uiEntry"].is_null(), !ui);
        assert_eq!(serialized["skills"][0]["text"], "# Sample skill");
    }
}

#[test]
fn module_capture_rejects_invalid_utf8_and_combined_text_overflow() {
    let root = fixture();
    let code = root.path().join(".situate/plugins/sample/code");
    fs::write(code.join("helper.js"), [0xff]).unwrap();
    assert!(sources(root.path(), "sample").is_err());
    fs::remove_file(code.join("helper.js")).unwrap();
    for i in 0..8 {
        fs::write(
            code.join(format!("helper-{i}.js")),
            vec![b' '; MAX_TEXT as usize],
        )
        .unwrap();
    }
    assert!(matches!(
        sources(root.path(), "sample"),
        Err(PluginError::TooLarge)
    ));
}

#[test]
fn reads_never_initialize_and_dropped_sources_are_disabled() {
    let empty = temporary();
    assert!(list(empty.path()).unwrap().plugins.is_empty());
    assert_eq!(
        load(empty.path(), "sample").unwrap_err(),
        "native.plugins.disabled"
    );
    assert!(set_enabled(empty.path(), "sample", true, None).is_err());
    assert!(!empty.path().join(".situate").exists());
    let root = fixture();
    let listing = list(root.path()).unwrap();
    assert!(listing.revision.is_some());
    assert!(!listing.plugins[0].enabled);
    assert_eq!(
        load(root.path(), "sample").unwrap_err(),
        "native.plugins.disabled"
    );
    assert!(!root.path().join(".situate/plugin-state.json").exists());
    assert!(!root.path().join(".situate/plugin-state.lock").exists());
}

#[test]
fn persistence_isolation_stale_revisions_and_deleted_folder_absence() {
    let root = fixture();
    let other = fixture();
    let first = set_enabled(
        root.path(),
        "sample",
        true,
        list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    assert_eq!(
        list(root.path()).unwrap().revision.as_deref(),
        Some(first.as_str())
    );
    assert!(list(root.path()).unwrap().plugins[0].enabled);
    assert!(!list(other.path()).unwrap().plugins[0].enabled);
    let prepared = prepare(root.path()).unwrap();
    let sources = load(root.path(), "sample").unwrap();
    assert_eq!(
        sources.service_entry.as_deref(),
        Some("throw new Error('never execute');")
    );
    assert_eq!(sources.skills[0].path, "skill.md");
    assert_eq!(sources.skills[0].text, "# Sample skill");
    assert_eq!(
        set_enabled(root.path(), "sample", false, None).unwrap_err(),
        CONFLICT
    );
    assert!(set_enabled(root.path(), "missing", false, prepared.revision.as_deref()).is_err());
    let second = set_enabled(root.path(), "sample", false, prepared.revision.as_deref()).unwrap();
    assert_eq!(
        set_enabled(root.path(), "sample", false, Some(&first)).unwrap_err(),
        CONFLICT
    );
    assert_ne!(second, first);
    fs::remove_dir_all(root.path().join(".situate/plugins")).unwrap();
    assert!(set_enabled(root.path(), "sample", false, Some(&second)).is_err());
    let listing = prepare(root.path()).unwrap();
    assert_eq!(listing.revision, None);
    assert!(listing.plugins.is_empty());
    assert!(!root.path().join(".situate/plugins").exists());
}

#[test]
fn source_observations_do_not_change_retained_state_revision() {
    let root = fixture();
    set_enabled(
        root.path(),
        "sample",
        true,
        list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    let revision = prepare(root.path()).unwrap().revision;
    let code = root.path().join(".situate/plugins/sample/code");
    fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":"sample","name":"Sample","description":"Synthetic skill","skills":["skill.md"]}).to_string()).unwrap();
    let loaded = load(root.path(), "sample").unwrap();
    assert_eq!(
        loaded.service_entry.as_deref(),
        Some("throw new Error('never execute');")
    );
    assert_eq!(loaded.skills.len(), 1);
    assert_eq!(list(root.path()).unwrap().revision, revision);
}

#[test]
fn enabled_checks_do_not_reinterpret_previously_loaded_sources() {
    let root = fixture();
    assert_eq!(
        check_enabled(root.path(), "sample").unwrap_err(),
        "native.plugins.disabled"
    );
    assert_eq!(
        check_enabled(root.path(), "../sample").unwrap_err(),
        "native.plugins.invalidPath"
    );
    set_enabled(
        root.path(),
        "sample",
        true,
        list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    let revision = prepare(root.path()).unwrap().revision.unwrap();
    let offered = load(root.path(), "sample").unwrap();
    let code = root.path().join(".situate/plugins/sample/code");
    fs::write(code.join("entry.js"), [0xff]).unwrap();
    assert!(check_enabled(root.path(), "sample").is_ok());
    assert!(load(root.path(), "sample").is_ok());
    fs::write(code.join("plugin.json"), "invalid manifest").unwrap();
    assert!(check_enabled(root.path(), "sample").is_ok());
    assert!(load(root.path(), "sample").is_ok());
    fs::remove_dir_all(&code).unwrap();
    assert_eq!(
        check_enabled(root.path(), "sample").unwrap_err(),
        "native.plugins.disabled"
    );
    assert!(load(root.path(), "sample").is_err());
    assert_eq!(
        offered.service_entry.as_deref(),
        Some("throw new Error('never execute');")
    );
    assert!(set_enabled(root.path(), "sample", false, Some(&revision)).is_err());
    assert_eq!(
        check_enabled(root.path(), "sample").unwrap_err(),
        "native.plugins.disabled"
    );
    assert_eq!(
        load(root.path(), "sample").unwrap_err(),
        "native.plugins.disabled"
    );
}

#[test]
fn preparation_pins_running_revisions_before_source_writes_and_never_observes_pinned_edits() {
    let root = fixture();
    set_enabled(
        root.path(),
        "sample",
        true,
        list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    assert!(list(root.path()).unwrap().plugins[0].revision.is_none());
    assert_eq!(
        load(root.path(), "sample").unwrap_err(),
        "native.plugins.unavailable"
    );
    let prepared = prepare(root.path()).unwrap();
    let active = prepared.plugins[0].revision.clone().unwrap();
    let before = super::super::sources::read(root.path(), "sample", "entry.js").unwrap();
    super::super::sources::write(
        root.path(),
        "sample",
        "entry.js",
        "unchecked edit",
        Some(&before.revision),
    )
    .unwrap();
    let source_head = super::super::sources::head(root.path(), "sample").unwrap();
    assert_ne!(source_head.revision, active);
    assert_eq!(
        load(root.path(), "sample")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("throw new Error('never execute');")
    );
    fs::write(
        root.path().join(".situate/plugins/sample/code/entry.js"),
        vec![b'x'; MAX_TEXT as usize + 1],
    )
    .unwrap();
    let again = prepare(root.path()).unwrap();
    assert_eq!(again.plugins[0].revision.as_deref(), Some(active.as_str()));
    assert_eq!(again.revision, prepared.revision);
    assert!(again.plugins[0].error.is_none());
    assert_eq!(
        super::super::sources::head(root.path(), "sample").unwrap(),
        source_head
    );
}

#[test]
fn preparation_isolates_failed_legacy_packages_and_leaves_disabled_source_untouched() {
    let root = fixture();
    set_enabled(
        root.path(),
        "sample",
        true,
        list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    for id in ["invalid", "oversized", "disabled"] {
        let code = root.path().join(".situate/plugins").join(id).join("code");
        fs::create_dir_all(&code).unwrap();
        fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":id,"name":id,"description":"Synthetic package","serviceEntry":"entry.js"}).to_string()).unwrap();
        fs::write(code.join("entry.js"), "synthetic source").unwrap();
        set_enabled(
            root.path(),
            id,
            id != "disabled",
            list(root.path()).unwrap().revision.as_deref(),
        )
        .unwrap();
    }
    fs::write(
        root.path()
            .join(".situate/plugins/invalid/code/plugin.json"),
        "incomplete manifest",
    )
    .unwrap();
    fs::write(
        root.path().join(".situate/plugins/oversized/code/entry.js"),
        vec![b'x'; MAX_TEXT as usize + 1],
    )
    .unwrap();
    let revision = list(root.path()).unwrap().revision.unwrap();
    let prepared = prepare(root.path()).unwrap();
    assert_ne!(prepared.revision.as_deref(), Some(revision.as_str()));
    let healthy = prepared.plugins.iter().find(|p| p.id == "sample").unwrap();
    assert!(healthy.enabled && healthy.revision.is_some() && healthy.error.is_none());
    assert!(load(root.path(), "sample").is_ok());
    for id in ["invalid", "oversized"] {
        let failed = prepared.plugins.iter().find(|p| p.id == id).unwrap();
        assert!(!failed.enabled && failed.revision.is_none() && failed.error.is_some());
        assert_eq!(
            load(root.path(), id).unwrap_err(),
            "native.plugins.unavailable"
        );
    }
    let disabled = prepared
        .plugins
        .iter()
        .find(|p| p.id == "disabled")
        .unwrap();
    assert!(!disabled.enabled && disabled.revision.is_none());
    assert!(
        !root
            .path()
            .join(".situate/plugins/disabled/.situate")
            .exists()
    );
    assert_eq!(
        load(root.path(), "disabled").unwrap_err(),
        "native.plugins.disabled"
    );
}

#[test]
fn disabling_persists_transitive_consumers_without_reenabling_them_or_observing_source_edits() {
    let root = fixture();
    for (id, dependencies) in [
        ("provider", vec![]),
        ("consumer", vec!["provider"]),
        ("indirect", vec!["consumer"]),
        ("disabled", vec!["provider"]),
        ("broken", vec![]),
    ] {
        let code = root.path().join(".situate/plugins").join(id).join("code");
        fs::create_dir_all(&code).unwrap();
        fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":id,"name":id,"description":"Synthetic package","serviceEntry":"entry.js","dependencies":dependencies}).to_string()).unwrap();
        fs::write(code.join("entry.js"), "synthetic source").unwrap();
    }
    let mut revision = list(root.path()).unwrap().revision;
    for (id, enabled) in [
        ("provider", true),
        ("consumer", true),
        ("indirect", true),
        ("sample", true),
        ("disabled", false),
    ] {
        revision = Some(set_enabled(root.path(), id, enabled, revision.as_deref()).unwrap());
    }
    let prepared = prepare(root.path()).unwrap();
    let revision = set_enabled(root.path(), "broken", true, prepared.revision.as_deref()).unwrap();
    let inventory = root.path().join(".situate/plugins");
    fs::write(
        inventory.join("broken/code/plugin.json"),
        "incomplete manifest",
    )
    .unwrap();
    let edited_manifest = json!({"schemaVersion":2,"id":"consumer","name":"Consumer","description":"Unactivated source","serviceEntry":"entry.js","dependencies":[]}).to_string();
    fs::write(
        inventory.join("consumer/code/plugin.json"),
        &edited_manifest,
    )
    .unwrap();
    fs::create_dir_all(inventory.join("provider/config")).unwrap();
    fs::create_dir_all(inventory.join("provider/data")).unwrap();
    fs::write(
        inventory.join("provider/config/settings.json"),
        "synthetic settings",
    )
    .unwrap();
    fs::write(inventory.join("provider/data/state.json"), "synthetic data").unwrap();
    let history_before = super::super::sources::head(root.path(), "consumer").unwrap();
    let state_path = root
        .path()
        .join(".situate/plugins/provider/.runtime/runtime-state.json");
    let before = fs::read(&state_path).unwrap();
    assert_eq!(
        set_enabled(root.path(), "provider", false, prepared.revision.as_deref()).unwrap_err(),
        CONFLICT
    );
    assert_eq!(fs::read(&state_path).unwrap(), before);
    let disabled_revision = set_enabled(root.path(), "provider", false, Some(&revision)).unwrap();
    let listing = list(root.path()).unwrap();
    for id in ["provider", "consumer", "indirect", "disabled"] {
        assert!(
            !listing.plugins.iter().find(|p| p.id == id).unwrap().enabled,
            "{id}"
        );
    }
    assert!(
        listing
            .plugins
            .iter()
            .find(|p| p.id == "sample")
            .unwrap()
            .enabled
    );
    let broken = listing.plugins.iter().find(|p| p.id == "broken").unwrap();
    assert!(!broken.enabled && broken.error.is_some());
    assert!(
        listing
            .plugins
            .iter()
            .find(|p| p.id == "sample")
            .unwrap()
            .error
            .is_none()
    );
    let broken = listing.plugins.iter().find(|p| p.id == "broken").unwrap();
    assert!(broken.error.is_some() && broken.revision.is_none());
    assert!(!inventory.join("broken/.situate").exists());
    for plugin in &prepared.plugins {
        assert_eq!(
            listing
                .plugins
                .iter()
                .find(|p| p.id == plugin.id)
                .unwrap()
                .revision,
            plugin.revision
        );
    }
    let reenabled_revision =
        set_enabled(root.path(), "provider", true, Some(&disabled_revision)).unwrap();
    let reenabled = list(root.path()).unwrap();
    assert_eq!(reenabled.revision, Some(reenabled_revision));
    assert!(
        reenabled
            .plugins
            .iter()
            .find(|p| p.id == "provider")
            .unwrap()
            .enabled
    );
    for id in ["consumer", "indirect", "disabled"] {
        assert!(
            !reenabled
                .plugins
                .iter()
                .find(|p| p.id == id)
                .unwrap()
                .enabled,
            "{id}"
        );
    }
    assert_eq!(
        fs::read_to_string(inventory.join("consumer/code/plugin.json")).unwrap(),
        edited_manifest
    );
    assert_eq!(
        super::super::sources::head(root.path(), "consumer").unwrap(),
        history_before
    );
    assert_eq!(
        fs::read_to_string(inventory.join("provider/config/settings.json")).unwrap(),
        "synthetic settings"
    );
    assert_eq!(
        fs::read_to_string(inventory.join("provider/data/state.json")).unwrap(),
        "synthetic data"
    );
    assert_eq!(
        fs::read_to_string(inventory.join("provider/code/entry.js")).unwrap(),
        "synthetic source"
    );
}

#[test]
fn damaged_state_is_never_reset() {
    let root = fixture();
    let path = root.path().join(".situate/plugin-state.json");
    let generation = "00000000-0000-4000-8000-000000000001";
    for bytes in [
        b"not json".to_vec(),
        json!({"version":2,"generation":generation,"plugins":[]}).to_string().into_bytes(),
        json!({"version":1,"generation":generation,"plugins":[],"extra":true}).to_string().into_bytes(),
        json!({"version":1,"generation":generation,"plugins":[{"id":"sample","enabled":true},{"id":"sample","enabled":false}]}).to_string().into_bytes(),
        json!({"version":1,"generation":generation,"plugins":[{"id":"../bad","enabled":true}]}).to_string().into_bytes(),
        vec![b' '; MAX_STATE as usize + 1],
    ] {
        fs::write(&path, &bytes).unwrap();
        let listing = list(root.path()).unwrap();
        assert!(!listing.plugins[0].enabled);
        assert_eq!(listing.plugins[0].error.as_deref(), Some(INVALID));
        assert_eq!(load(root.path(), "sample").unwrap_err(), INVALID);
        assert_eq!(check_enabled(root.path(), "sample").unwrap_err(), INVALID);
        assert_eq!(set_enabled(root.path(), "sample", false, None).unwrap_err(), INVALID);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn lock_contention_and_uncertain_durability_do_not_report_success() {
    let root = fixture();
    let store = storage(root.path()).unwrap().unwrap();
    let lock = store.lock_named("plugin-state.lock").unwrap();
    assert_eq!(
        set_enabled(root.path(), "sample", true, None).unwrap_err(),
        "native.plugins.stateBusy"
    );
    assert!(!root.path().join(".situate/plugin-state.json").exists());
    drop(lock);
    let revision = set_enabled(
        root.path(),
        "sample",
        true,
        list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    let (mut state, _) = retained(root.path()).unwrap();
    state.plugins[0].enabled = false;
    state.generation = uuid::Uuid::new_v4().to_string();
    let bytes = serde_json::to_vec(&state).unwrap();
    let marker = folder::metadata(&folder::plugin(root.path(), "sample").unwrap()).unwrap();
    let renamed = folder::replace(&marker, folder::STATE, &bytes).unwrap();
    assert!(renamed);
    assert_eq!(
        save_result(Ok(false)).unwrap_err(),
        "native.plugins.stateOutcomeUnknown"
    );
    assert_eq!(
        save_result(Err("failed".into())).unwrap_err(),
        "native.plugins.stateSaveFailed"
    );
    let retained = list(root.path()).unwrap();
    assert_ne!(retained.revision.as_deref(), Some(revision.as_str()));
    assert!(!retained.plugins[0].enabled);
    assert_eq!(
        set_enabled(root.path(), "sample", true, Some(&revision)).unwrap_err(),
        CONFLICT
    );
    assert_eq!(
        fs::read(
            root.path()
                .join(".situate/plugins/sample/.runtime/runtime-state.json")
        )
        .unwrap(),
        bytes
    );
}

#[cfg(unix)]
#[test]
fn symlinks_invalid_utf8_and_oversized_sources_fail_closed() {
    use std::os::unix::fs::symlink;
    let root = fixture();
    let first = set_enabled(
        root.path(),
        "sample",
        true,
        list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    let source = root.path().join(".situate/plugins/sample/code/entry.js");
    for bytes in [vec![0xff], vec![b'a'; MAX_TEXT as usize + 1]] {
        fs::write(&source, bytes).unwrap();
        assert!(load(root.path(), "sample").is_err());
        assert!(set_enabled(root.path(), "sample", true, Some(&first)).is_err());
    }
    fs::remove_file(&source).unwrap();
    symlink("skill.md", &source).unwrap();
    assert!(load(root.path(), "sample").is_err());
    assert!(set_enabled(root.path(), "sample", false, Some(&first)).is_ok());
    let state = root
        .path()
        .join(".situate/plugins/sample/.runtime/runtime-state.json");
    fs::remove_file(&state).unwrap();
    symlink("missing", &state).unwrap();
    let listing = list(root.path()).unwrap();
    assert!(!listing.plugins[0].enabled);
    assert_eq!(listing.plugins[0].error.as_deref(), Some(INVALID));
    assert_eq!(
        set_enabled(root.path(), "sample", false, None).unwrap_err(),
        INVALID
    );
}
