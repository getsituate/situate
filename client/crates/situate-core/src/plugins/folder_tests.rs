use super::*;
use serde_json::json;
use std::fs;

fn root() -> tempfile::TempDir {
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    root
}

fn install(root: &Path, id: &str, dependencies: &[&str]) -> sources::PackageRevision {
    sources::create(root, id).unwrap();
    let code = root.join(".situate/plugins").join(id).join("code");
    fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":id,"name":id,"description":"Synthetic fixture","serviceEntry":"entry.js","dependencies":dependencies}).to_string()).unwrap();
    fs::write(code.join("entry.js"), "export default {};").unwrap();
    sources::snapshot(root, id).unwrap()
}

fn enable(root: &Path, id: &str, enabled: bool) {
    let revision = runtime::list(root).unwrap().revision;
    runtime::set_enabled(root, id, enabled, revision.as_deref()).unwrap();
    runtime::prepare(root).unwrap();
}

fn legacy_state(root: &Path, package: &sources::PackageRevision) {
    fs::remove_file(
        root.join(".situate/plugins")
            .join(&package.plugin_id)
            .join(".runtime/fresh-installation"),
    )
    .unwrap();
    let attempt = "00000000-0000-4000-8000-000000000002";
    fs::write(
        root.join(".situate/plugin-state.json"),
        json!({
            "version":1,"generation":"00000000-0000-4000-8000-000000000001",
            "plugins":[{"id":package.plugin_id,"enabled":true,"revision":package.revision},
                       {"id":"ghost","enabled":false}],"publication":attempt,
        })
        .to_string(),
    )
    .unwrap();
    fs::write(
        root.join(format!(".situate/plugin-publication-{attempt}.json")),
        json!({"attempt":attempt,"status":"published"}).to_string(),
    )
    .unwrap();
}

#[test]
fn migration_external_deletion_reopen_and_fresh_identity_never_resurrect_state() {
    let root = root();
    let package = install(root.path(), "sample", &[]);
    legacy_state(root.path(), &package);
    fs::write(root.path().join("ordinary.md"), "keep").unwrap();
    let prepared = runtime::prepare(root.path()).unwrap();
    assert_eq!(prepared.plugins.len(), 1);
    assert!(prepared.plugins[0].enabled);
    assert_eq!(
        prepared.plugins[0].revision.as_deref(),
        Some(package.revision.as_str())
    );
    assert!(!root.path().join(".situate/plugins/ghost").exists());
    assert!(!root.path().join(".situate/plugin-state.json").exists());
    assert!(
        fs::read_dir(root.path().join(".situate"))
            .unwrap()
            .all(|e| !e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("plugin-publication-"))
    );
    storage::write(
        root.path(),
        "sample",
        storage::Area::Data,
        "state.json",
        "private fixture",
        None,
    )
    .unwrap();
    let old_identity = prepared.plugins[0].incarnation.clone();
    fs::remove_dir_all(root.path().join(".situate/plugins/sample")).unwrap();
    assert!(runtime::prepare(root.path()).unwrap().plugins.is_empty());
    assert_eq!(runtime::list(root.path()).unwrap().revision, None);
    assert!(
        storage::write(
            root.path(),
            "sample",
            storage::Area::Data,
            "late.json",
            "late",
            None
        )
        .is_err()
    );
    assert!(!root.path().join(".situate/plugins/sample").exists());
    let fresh = install(root.path(), "sample", &[]);
    let listing = runtime::prepare(root.path()).unwrap();
    assert_ne!(listing.plugins[0].incarnation, old_identity);
    assert!(!listing.plugins[0].enabled);
    assert!(listing.plugins[0].revision.is_none());
    assert!(!root.path().join(".situate/plugins/sample/data").exists());
    assert_ne!(listing.revision, prepared.revision);
    assert!(runtime::uninstall(root.path(), "sample", prepared.revision.as_deref()).is_err());
    assert!(
        publication::publish(
            root.path(),
            std::slice::from_ref(&package),
            std::slice::from_ref(&package),
            &[]
        )
        .is_err()
    );
    assert_ne!(fresh.incarnation, package.incarnation);
    assert_eq!(
        fs::read_to_string(root.path().join("ordinary.md")).unwrap(),
        "keep"
    );
}

#[test]
fn fresh_installation_does_not_adopt_stale_global_metadata() {
    let root = root();
    let package = install(root.path(), "sample", &[]);
    legacy_state(root.path(), &package);
    fs::remove_dir_all(root.path().join(".situate/plugins/sample")).unwrap();
    let fresh = install(root.path(), "sample", &[]);
    let listing = runtime::prepare(root.path()).unwrap();
    assert!(!listing.plugins[0].enabled);
    assert!(listing.plugins[0].revision.is_none());
    assert_eq!(listing.plugins[0].incarnation, fresh.incarnation);
    assert!(
        credentials::pending_migration(root.path())
            .unwrap()
            .is_empty()
    );
    assert!(
        !root
            .path()
            .join(".situate/plugins/sample/.runtime/runtime-state.json")
            .exists()
    );
    assert!(
        fs::read_dir(root.path().join(".situate/plugins/sample/.runtime"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("plugin-publication-"))
    );
}

#[test]
fn raw_replacement_before_first_migration_cannot_inherit_unproven_state() {
    for pinned in [false, true] {
        let root = root();
        let package = install(root.path(), "sample", &[]);
        legacy_state(root.path(), &package);
        if !pinned {
            let path = root.path().join(".situate/plugin-state.json");
            let mut legacy: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            legacy["plugins"][0]
                .as_object_mut()
                .unwrap()
                .remove("revision");
            fs::write(path, legacy.to_string()).unwrap();
        }
        let owner = root.path().join(".situate/plugins/sample");
        fs::remove_dir_all(&owner).unwrap();
        fs::create_dir_all(owner.join("code")).unwrap();
        fs::write(owner.join("code/plugin.json"), json!({"schemaVersion":2,"id":"sample","name":"Fresh","description":"Synthetic","serviceEntry":"entry.js"}).to_string()).unwrap();
        fs::write(owner.join("code/entry.js"), "export default {};").unwrap();
        assert!(!owner.join(".runtime").exists());
        let listing = runtime::prepare(root.path()).unwrap();
        assert_eq!(listing.plugins.len(), 1);
        assert!(!listing.plugins[0].enabled);
        assert!(listing.plugins[0].revision.is_none());
        assert!(
            credentials::pending_migration(root.path())
                .unwrap()
                .is_empty()
        );
        assert!(!owner.join(".runtime/runtime-state.json").exists());
        assert!(!root.path().join(".situate/plugin-state.json").exists());
        let recovery = root.path().join(".situate/plugin-metadata-legacy/plugin-state-00000000-0000-4000-8000-000000000001.json");
        let retained: serde_json::Value =
            serde_json::from_slice(&fs::read(recovery).unwrap()).unwrap();
        assert_eq!(retained["plugins"][0]["enabled"], true);
        assert_eq!(
            retained["plugins"][0]["revision"].as_str(),
            pinned.then_some(package.revision.as_str())
        );
    }
}

#[test]
fn migration_retry_flushes_existing_destination_before_removing_legacy_evidence() {
    let root = root();
    let package = install(root.path(), "sample", &[]);
    legacy_state(root.path(), &package);
    let presentation = root
        .path()
        .join(".situate/plugins/sample/.runtime/presentation/nested");
    fs::create_dir_all(&presentation).unwrap();
    fs::write(presentation.join("state.json"), "{}").unwrap();
    publication::inject_failure("migration-sync");
    let listing = runtime::prepare(root.path()).unwrap();
    assert!(!listing.plugins[0].enabled);
    assert_eq!(
        listing.plugins[0].error.as_deref(),
        Some("native.plugins.stateOutcomeUnknown")
    );
    assert!(root.path().join(".situate/plugin-state.json").is_file());
    assert!(
        root.path()
            .join(".situate/plugins/sample/.runtime/runtime-state.json")
            .is_file()
    );
    publication::inject_failure("migration-sync");
    let listing = runtime::prepare(root.path()).unwrap();
    assert!(!listing.plugins[0].enabled);
    assert_eq!(
        listing.plugins[0].error.as_deref(),
        Some("native.plugins.stateOutcomeUnknown")
    );
    assert!(root.path().join(".situate/plugin-state.json").is_file());
    let listing = runtime::prepare(root.path()).unwrap();
    assert!(listing.plugins[0].enabled);
    assert!(!root.path().join(".situate/plugin-state.json").exists());
    assert_eq!(
        runtime::list(root.path()).unwrap().revision,
        listing.revision
    );
}

#[test]
fn corrupt_or_missing_retained_identity_is_never_reminted() {
    for missing in [false, true] {
        let root = root();
        install(root.path(), "sample", &[]);
        enable(root.path(), "sample", true);
        let identity = root
            .path()
            .join(".situate/plugins/sample/.runtime/identity");
        if missing {
            fs::remove_file(&identity).unwrap();
        } else {
            fs::write(&identity, "corrupt").unwrap();
        }
        let listing = runtime::prepare(root.path()).unwrap();
        assert!(!listing.plugins[0].enabled);
        assert_eq!(
            listing.plugins[0].error.as_deref(),
            Some("native.plugins.stateInvalid")
        );
        assert!(runtime::uninstall(root.path(), "sample", None).is_err());
        if missing {
            assert!(!identity.exists());
        } else {
            assert_eq!(fs::read_to_string(identity).unwrap(), "corrupt");
        }
        assert!(root.path().join(".situate/plugins/sample/code").exists());
    }
}

#[test]
fn uninstall_blocks_disabled_consumers_and_removes_only_the_owner_tree() {
    let root = root();
    install(root.path(), "provider", &[]);
    install(root.path(), "consumer", &["provider"]);
    install(root.path(), "indirect", &["consumer"]);
    enable(root.path(), "consumer", false);
    enable(root.path(), "indirect", false);
    fs::create_dir_all(root.path().join(".situate/chats")).unwrap();
    fs::write(root.path().join(".situate/chats/keep"), "conversation").unwrap();
    fs::create_dir_all(root.path().join(".situate/history.git")).unwrap();
    fs::write(
        root.path().join(".situate/history.git/keep"),
        "workspace history",
    )
    .unwrap();
    let listing = runtime::list(root.path()).unwrap();
    assert_eq!(
        runtime::uninstall(root.path(), "provider", listing.revision.as_deref()).unwrap_err(),
        "native.plugins.stateBusy"
    );
    assert!(root.path().join(".situate/plugins/provider").exists());
    for id in ["indirect", "consumer", "provider"] {
        let before = runtime::list(root.path()).unwrap();
        let revision = runtime::uninstall(root.path(), id, before.revision.as_deref()).unwrap();
        assert_eq!(runtime::list(root.path()).unwrap().revision, revision);
        assert!(!root.path().join(".situate/plugins").join(id).exists());
    }
    assert_eq!(
        fs::read_to_string(root.path().join(".situate/chats/keep")).unwrap(),
        "conversation"
    );
    assert_eq!(
        fs::read_to_string(root.path().join(".situate/history.git/keep")).unwrap(),
        "workspace history"
    );
}

#[test]
fn uninstall_distinguishes_refusal_from_uncertain_durability() {
    let root = root();
    install(root.path(), "sample", &[]);
    let listing = runtime::list(root.path()).unwrap();
    publication::inject_failure("uninstall-before");
    assert_eq!(
        runtime::uninstall(root.path(), "sample", listing.revision.as_deref()).unwrap_err(),
        "native.plugins.stateBusy"
    );
    assert!(root.path().join(".situate/plugins/sample").exists());
    publication::inject_failure("uninstall-sync");
    assert_eq!(
        runtime::uninstall(root.path(), "sample", listing.revision.as_deref()).unwrap_err(),
        "native.plugins.stateOutcomeUnknown"
    );
    assert!(!root.path().join(".situate/plugins/sample").exists());
    assert!(runtime::list(root.path()).unwrap().plugins.is_empty());
}

#[test]
fn partially_removed_retained_installation_is_not_reported_absent_or_reidentified() {
    let root = root();
    install(root.path(), "sample", &[]);
    enable(root.path(), "sample", true);
    let before = runtime::list(root.path()).unwrap();
    publication::inject_failure("uninstall-partial");
    assert_eq!(
        runtime::uninstall(root.path(), "sample", before.revision.as_deref()).unwrap_err(),
        "native.plugins.stateOutcomeUnknown"
    );
    assert!(root.path().join(".situate/plugins/sample").is_dir());
    assert!(
        !root
            .path()
            .join(".situate/plugins/sample/.runtime/identity")
            .exists()
    );
    let listing = runtime::prepare(root.path()).unwrap();
    assert!(!listing.plugins[0].enabled && listing.plugins[0].error.is_some());
    assert!(
        !root
            .path()
            .join(".situate/plugins/sample/.runtime/identity")
            .exists()
    );
}

#[test]
fn drafts_migrate_only_existing_owners_and_orphans_stay_inert() {
    let root = root();
    let retained = install(root.path(), "retained", &[]);
    install(root.path(), "removed", &[]);
    let a = "00000000-0000-4000-8000-000000000001";
    let b = "00000000-0000-4000-8000-000000000002";
    drafts::create(root.path(), a, "retained").unwrap();
    drafts::create(root.path(), b, "removed").unwrap();
    let legacy = root.path().join(".situate/plugin-drafts");
    fs::create_dir(&legacy).unwrap();
    for (plugin, id) in [("retained", a), ("removed", b)] {
        fs::rename(
            root.path()
                .join(".situate/plugins")
                .join(plugin)
                .join("drafts")
                .join(id),
            legacy.join(id),
        )
        .unwrap();
    }
    fs::remove_dir_all(root.path().join(".situate/plugins/removed")).unwrap();
    legacy_state(root.path(), &retained);
    install(root.path(), "removed", &[]);
    assert_eq!(drafts::list(root.path()).unwrap().len(), 1);
    assert!(drafts::inspect(root.path(), a).is_ok());
    assert!(drafts::inspect(root.path(), b).is_err());
    assert!(
        root.path()
            .join(".situate/plugin-drafts-legacy")
            .join(b)
            .is_dir()
    );
    assert!(drafts::inspect(root.path(), b).is_err());
    assert_eq!(drafts::list(root.path()).unwrap().len(), 1);
}

#[test]
fn raw_replacement_cannot_adopt_a_legacy_draft_by_id() {
    let root = root();
    install(root.path(), "sample", &[]);
    let id = "00000000-0000-4000-8000-000000000001";
    drafts::create(root.path(), id, "sample").unwrap();
    let legacy = root.path().join(".situate/plugin-drafts");
    fs::create_dir(&legacy).unwrap();
    fs::rename(
        root.path().join(".situate/plugins/sample/drafts").join(id),
        legacy.join(id),
    )
    .unwrap();
    fs::remove_dir_all(root.path().join(".situate/plugins/sample")).unwrap();
    fs::create_dir_all(root.path().join(".situate/plugins/sample/code")).unwrap();
    assert!(drafts::list(root.path()).unwrap().is_empty());
    assert!(drafts::inspect(root.path(), id).is_err());
    assert!(
        root.path()
            .join(".situate/plugin-drafts-legacy")
            .join(id)
            .is_dir()
    );
    assert!(!root.path().join(".situate/plugins/sample/drafts").exists());
}

#[test]
fn identical_dependency_code_cannot_reuse_a_previous_installations_check_receipt() {
    let root = root();
    let dependency = install(root.path(), "dependency", &[]);
    enable(root.path(), "dependency", true);
    let consumer = install(root.path(), "consumer", &["dependency"]);
    let checked =
        publication::checked_closure(root.path(), std::slice::from_ref(&consumer)).unwrap();
    let history = root
        .path()
        .join(".situate/plugins/dependency/.situate/history.git");
    let saved = root.path().join("saved-history.git");
    fs::rename(&history, &saved).unwrap();
    fs::remove_dir_all(root.path().join(".situate/plugins/dependency")).unwrap();
    install(root.path(), "dependency", &[]);
    fs::remove_dir_all(&history).unwrap();
    fs::rename(saved, history).unwrap();
    enable(root.path(), "dependency", true);
    let fresh = sources::snapshot(root.path(), "dependency").unwrap();
    assert_eq!(fresh.revision, dependency.revision);
    assert_ne!(fresh.incarnation, dependency.incarnation);
    assert_eq!(
        publication::publish(root.path(), std::slice::from_ref(&consumer), &checked, &[])
            .unwrap_err(),
        "native.plugins.stateConflict"
    );
    assert!(
        !runtime::list(root.path())
            .unwrap()
            .plugins
            .iter()
            .find(|p| p.id == "consumer")
            .unwrap()
            .enabled
    );
}

#[test]
fn unattributable_legacy_artifacts_are_preserved_without_creating_owners() {
    let root = root();
    let attempt = "00000000-0000-4000-8000-000000000001";
    let name = format!("plugin-publication-{attempt}.json");
    fs::write(
        root.path().join(".situate").join(&name),
        "retained recovery bytes",
    )
    .unwrap();
    let listing = runtime::prepare(root.path()).unwrap();
    assert!(listing.plugins.is_empty());
    assert!(!root.path().join(".situate/plugins").exists());
    assert_eq!(
        fs::read_to_string(
            root.path()
                .join(".situate/plugin-metadata-legacy")
                .join(name)
        )
        .unwrap(),
        "retained recovery bytes"
    );
}

#[test]
fn interrupted_multi_package_state_switch_never_exposes_a_partial_group() {
    let root = root();
    let a = install(root.path(), "one", &[]);
    let b = install(root.path(), "two", &[]);
    enable(root.path(), "one", true);
    enable(root.path(), "two", true);
    let selected = [a, b];
    let checked = publication::checked_closure(root.path(), &selected).unwrap();
    publication::inject_failure("state-entry");
    let outcome = publication::publish(root.path(), &selected, &checked, &[]).unwrap();
    assert_eq!(
        outcome.status,
        publication::PublicationStatus::OutcomeUnknown
    );
    assert_eq!(publication::current(root.path()).unwrap(), Some(outcome));
    assert!(runtime::load(root.path(), "one").is_err());
    assert!(runtime::load(root.path(), "two").is_err());
    assert!(runtime::check_enabled(root.path(), "one").is_err());
    assert!(runtime::check_enabled(root.path(), "two").is_err());
    let listing = runtime::prepare(root.path()).unwrap();
    assert_eq!(listing.plugins.len(), 2);
    assert!(listing.plugins.iter().all(|plugin| !plugin.enabled
        && plugin.error.as_deref() == Some("native.plugins.stateOutcomeUnknown")));
}

#[test]
fn manifest_presence_alone_identifies_installed_plugins() {
    let root = root();
    install(root.path(), "sample", &[]);
    enable(root.path(), "sample", true);
    let inventory = root.path().join(".situate/plugins");
    for name in [".DS_Store", "unexpected-file"] {
        fs::write(inventory.join(name), "not a plugin").unwrap();
    }
    fs::create_dir_all(inventory.join("unfinished/code")).unwrap();
    fs::create_dir_all(inventory.join("unfinished/.runtime")).unwrap();
    fs::write(
        inventory.join("unfinished/.runtime/runtime-state.json"),
        "invalid",
    )
    .unwrap();
    let listing = runtime::prepare(root.path()).unwrap();
    assert_eq!(listing.plugins.len(), 1);
    assert_eq!(listing.plugins[0].id, "sample");
    assert!(listing.plugins[0].enabled && listing.plugins[0].error.is_none());
    assert!(runtime::load(root.path(), "sample").is_ok());

    let state_path = inventory.join("sample/.runtime/runtime-state.json");
    let before = fs::read(&state_path).unwrap();
    fs::remove_file(inventory.join("sample/code/plugin.json")).unwrap();
    assert!(runtime::prepare(root.path()).unwrap().plugins.is_empty());
    assert!(runtime::check_enabled(root.path(), "sample").is_err());
    assert!(runtime::load(root.path(), "sample").is_err());
    assert_eq!(fs::read(state_path).unwrap(), before);
}

#[test]
fn unreadable_plugins_do_not_block_healthy_plugins_or_overwrite_retained_errors() {
    for artifact in [
        "code/plugin.json",
        ".runtime/runtime-state.json",
        ".runtime/identity",
    ] {
        let root = root();
        install(root.path(), "healthy", &[]);
        enable(root.path(), "healthy", true);
        install(root.path(), "broken", &[]);
        if artifact != "code/plugin.json" {
            enable(root.path(), "broken", true);
        }
        install(root.path(), "unpinned", &[]);
        let revision = runtime::list(root.path()).unwrap().revision;
        runtime::set_enabled(root.path(), "unpinned", true, revision.as_deref()).unwrap();
        let path = root.path().join(".situate/plugins/broken").join(artifact);
        fs::write(&path, "unreadable fixture").unwrap();

        for _ in 0..2 {
            let listing = runtime::prepare(root.path()).unwrap();
            assert_eq!(listing.plugins.len(), 3);
            let broken = listing
                .plugins
                .iter()
                .find(|plugin| plugin.id == "broken")
                .unwrap();
            assert!(!broken.enabled && broken.error.is_some(), "{artifact}");
            assert!(runtime::load(root.path(), "broken").is_err());
            for id in ["healthy", "unpinned"] {
                let healthy = listing
                    .plugins
                    .iter()
                    .find(|plugin| plugin.id == id)
                    .unwrap();
                assert!(
                    healthy.enabled && healthy.error.is_none() && healthy.revision.is_some(),
                    "{artifact}: {id}"
                );
                assert!(runtime::check_enabled(root.path(), id).is_ok());
                assert!(runtime::load(root.path(), id).is_ok());
            }
            assert_eq!(fs::read_to_string(&path).unwrap(), "unreadable fixture");
        }
    }
}
