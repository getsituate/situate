use super::*;
use serde_json::json;
use std::{cell::Cell, fs};

thread_local! { static FAILURE: Cell<Option<&'static str>> = const { Cell::new(None) }; }
pub(super) fn inject_failure(point: &'static str) {
    FAILURE.with(|f| f.set(Some(point)));
}
pub(super) fn fail_at(point: &str) -> io::Result<()> {
    FAILURE.with(|failure| {
        if failure.get() == Some(point) {
            failure.set(None);
            Err(io::Error::other("injected publication failure"))
        } else {
            Ok(())
        }
    })
}
fn root() -> tempfile::TempDir {
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    root
}
fn package(root: &Path, id: &str, dependencies: &[&str]) -> PackageRevision {
    sources::create(root, id).unwrap();
    sources::write(root, id, "plugin.json", &json!({"schemaVersion":2,"id":id,"name":id,"description":"Synthetic package","serviceEntry":"entry.js","dependencies":dependencies}).to_string(), None).unwrap();
    sources::write(root, id, "entry.js", "export const value = 1;", None).unwrap();
    sources::snapshot(root, id).unwrap()
}
fn edit(root: &Path, id: &str, text: &str) -> PackageRevision {
    let before = sources::read(root, id, "entry.js").unwrap();
    assert!(matches!(
        sources::write(root, id, "entry.js", text, Some(&before.revision)).unwrap(),
        crate::content::SaveOutcome::Saved { .. }
    ));
    sources::snapshot(root, id).unwrap()
}
fn activate(root: &Path, selected: &[PackageRevision]) -> Publication {
    let checked = checked_closure(root, selected).unwrap();
    let publication = publish(root, selected, &checked, &[]).unwrap();
    assert_eq!(publication.status, PublicationStatus::Published);
    publication
}
#[test]
fn group_switch_pins_git_revisions_retains_edits_and_unselected_state() {
    let root = root();
    let connection = package(root.path(), "connection", &[]);
    let consumer = package(root.path(), "consumer", &["connection"]);
    let other = package(root.path(), "other", &[]);
    activate(root.path(), &[other]);
    activate(root.path(), &[connection.clone(), consumer.clone()]);
    let changed = edit(root.path(), "connection", "export const value = 2;");
    assert_ne!(changed, connection);
    assert_eq!(
        runtime::load(root.path(), "connection")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 1;")
    );
    assert_eq!(
        runtime::list(root.path())
            .unwrap()
            .plugins
            .iter()
            .find(|p| p.id == "connection")
            .unwrap()
            .revision
            .as_deref(),
        Some(connection.revision.as_str())
    );
    assert_eq!(
        sources::snapshot(root.path(), "connection").unwrap(),
        changed
    );
    let closure = checked_closure(root.path(), std::slice::from_ref(&changed)).unwrap();
    assert_eq!(closure, vec![changed.clone(), consumer]);
    activate(root.path(), std::slice::from_ref(&changed));
    assert_eq!(
        runtime::load(root.path(), "connection")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 2;")
    );
    assert!(runtime::load(root.path(), "other").is_ok());
    assert_eq!(
        sources::at_revision(root.path(), &connection)
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 1;")
    );
    assert!(
        sources::history(root.path(), "connection")
            .unwrap()
            .iter()
            .any(|h| h.revision == connection.revision)
    );
    assert_eq!(
        sources::snapshot(root.path(), "connection").unwrap(),
        changed
    );
}
#[test]
fn helper_edits_require_new_group_checks_and_do_not_change_active_modules() {
    let root = root();
    package(root.path(), "sample", &[]);
    sources::mkdir(root.path(), "sample", "parts").unwrap();
    sources::write(
        root.path(),
        "sample",
        "parts/value.js",
        "export const value = 42;",
        None,
    )
    .unwrap();
    let first = edit(
        root.path(),
        "sample",
        "import { value } from './parts/value.js'; export default () => value;",
    );
    activate(root.path(), std::slice::from_ref(&first));
    let checked = checked_closure(root.path(), std::slice::from_ref(&first)).unwrap();
    assert_eq!(
        sources::at_revision(root.path(), &checked[0])
            .unwrap()
            .modules["parts/value.js"],
        "export const value = 42;"
    );
    let helper = sources::read(root.path(), "sample", "parts/value.js").unwrap();
    sources::write(
        root.path(),
        "sample",
        "parts/value.js",
        "export const value = 99;",
        Some(&helper.revision),
    )
    .unwrap();
    assert_eq!(
        publish(root.path(), std::slice::from_ref(&first), &checked, &[])
            .unwrap()
            .status,
        PublicationStatus::NeedsRecheck,
    );
    assert_eq!(
        runtime::load(root.path(), "sample").unwrap().modules["parts/value.js"],
        "export const value = 42;"
    );
    let next = sources::snapshot(root.path(), "sample").unwrap();
    activate(root.path(), &[next]);
    assert_eq!(
        runtime::load(root.path(), "sample").unwrap().modules["parts/value.js"],
        "export const value = 99;"
    );
}

#[test]
fn competing_publication_does_not_reject_a_still_current_checked_source() {
    let root = root();
    let original = package(root.path(), "one", &[]);
    activate(root.path(), std::slice::from_ref(&original));
    let prepared = edit(root.path(), "one", "latest prepared source");
    let checked = checked_closure(root.path(), std::slice::from_ref(&prepared)).unwrap();
    let old_checked = checked_closure(root.path(), std::slice::from_ref(&original)).unwrap();
    assert_eq!(
        publish(root.path(), &[original], &old_checked, &["one".into()])
            .unwrap()
            .status,
        PublicationStatus::Published
    );
    assert_eq!(
        publish(root.path(), std::slice::from_ref(&prepared), &checked, &[])
            .unwrap()
            .status,
        PublicationStatus::Published
    );
    assert_eq!(
        runtime::load(root.path(), "one")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("latest prepared source")
    );
}

#[test]
fn source_and_external_drift_require_recheck_and_restore_is_per_package() {
    let root = root();
    let a = package(root.path(), "one", &[]);
    let b = package(root.path(), "two", &[]);
    let checked = checked_closure(root.path(), &[a.clone(), b.clone()]).unwrap();
    edit(root.path(), "one", "changed one");
    fs::write(
        root.path().join(".situate/plugins/two/code/entry.js"),
        "changed externally",
    )
    .unwrap();
    let result = publish(
        root.path(),
        &[a.clone(), b.clone()],
        &checked,
        &["one".into()],
    )
    .unwrap();
    assert_eq!(result.status, PublicationStatus::NeedsRecheck);
    assert_eq!(status(root.path(), &result.attempt).unwrap(), result);
    assert!(
        runtime::list(root.path())
            .unwrap()
            .plugins
            .iter()
            .all(|p| !p.enabled)
    );
    assert!(
        publish(
            root.path(),
            &[a.clone(), b.clone()],
            &checked,
            &["missing".into()]
        )
        .is_err()
    );
    assert!(
        publish(
            root.path(),
            &[a.clone(), b.clone()],
            &checked,
            &["one".into(), "one".into()]
        )
        .is_err()
    );
    let result = publish(
        root.path(),
        &[a, b],
        &checked,
        &["one".into(), "two".into()],
    )
    .unwrap();
    assert_eq!(result.status, PublicationStatus::Published);
    assert_eq!(
        sources::read(root.path(), "one", "entry.js").unwrap().text,
        "changed one"
    );
    assert_eq!(
        sources::read(root.path(), "two", "entry.js").unwrap().text,
        "changed externally"
    );
}
#[test]
fn changed_active_dependency_or_consumer_requires_exact_fresh_closure() {
    let root = root();
    let dependency = package(root.path(), "dependency", &[]);
    let consumer = package(root.path(), "consumer", &["dependency"]);
    activate(root.path(), &[dependency.clone(), consumer.clone()]);
    let changed_consumer = edit(root.path(), "consumer", "consumer v2");
    let checked = checked_closure(root.path(), std::slice::from_ref(&changed_consumer)).unwrap();
    let changed_dependency = edit(root.path(), "dependency", "dependency v2");
    activate(root.path(), std::slice::from_ref(&changed_dependency));
    assert_eq!(
        publish(
            root.path(),
            std::slice::from_ref(&changed_consumer),
            &checked,
            &[]
        )
        .unwrap()
        .status,
        PublicationStatus::NeedsRecheck
    );
    assert_eq!(
        runtime::load(root.path(), "consumer")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 1;")
    );
    let checked = checked_closure(root.path(), std::slice::from_ref(&dependency)).unwrap();
    activate(root.path(), std::slice::from_ref(&changed_consumer));
    assert_eq!(
        publish(root.path(), &[dependency], &checked, &["dependency".into()])
            .unwrap()
            .status,
        PublicationStatus::NeedsRecheck
    );
    assert_eq!(
        runtime::list(root.path())
            .unwrap()
            .plugins
            .iter()
            .find(|p| p.id == "dependency")
            .unwrap()
            .revision
            .as_deref(),
        Some(changed_dependency.revision.as_str())
    );
}
#[test]
fn closure_uses_active_dependency_not_unactivated_source_and_disabled_blocks() {
    let root = root();
    let dependency = package(root.path(), "dependency", &[]);
    activate(root.path(), std::slice::from_ref(&dependency));
    edit(root.path(), "dependency", "unchecked edit");
    let consumer = package(root.path(), "consumer", &["dependency"]);
    assert_eq!(
        checked_closure(root.path(), std::slice::from_ref(&consumer)).unwrap(),
        vec![consumer.clone(), dependency.clone()]
    );
    activate(root.path(), std::slice::from_ref(&consumer));
    let listing = runtime::list(root.path()).unwrap();
    runtime::set_enabled(
        root.path(),
        "dependency",
        false,
        listing.revision.as_deref(),
    )
    .unwrap();
    assert!(checked_closure(root.path(), std::slice::from_ref(&consumer)).is_err());
    let listing = runtime::list(root.path()).unwrap();
    assert_eq!(
        listing
            .plugins
            .iter()
            .find(|p| p.id == "dependency")
            .unwrap()
            .revision
            .as_deref(),
        Some(dependency.revision.as_str())
    );
    assert!(checked_closure(root.path(), &[consumer, dependency]).is_ok());
}
#[test]
fn unavailable_unpinned_legacy_does_not_block_independent_publication_or_become_a_dependency() {
    for oversized in [false, true] {
        let root = root();
        let code = root.path().join(".situate/plugins/invalidlegacy/code");
        fs::create_dir_all(&code).unwrap();
        fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":"invalidlegacy","name":"Legacy","description":"Synthetic legacy","serviceEntry":"entry.js"}).to_string()).unwrap();
        fs::write(code.join("entry.js"), "legacy source").unwrap();
        runtime::set_enabled(
            root.path(),
            "invalidlegacy",
            true,
            runtime::list(root.path()).unwrap().revision.as_deref(),
        )
        .unwrap();
        if oversized {
            fs::write(code.join("entry.js"), vec![b'x'; MAX_TEXT as usize + 1]).unwrap();
        } else {
            fs::write(code.join("plugin.json"), "incomplete manifest").unwrap();
            sources::snapshot(root.path(), "invalidlegacy").unwrap();
        }
        let prepared = runtime::prepare(root.path()).unwrap();
        let legacy = prepared
            .plugins
            .iter()
            .find(|p| p.id == "invalidlegacy")
            .unwrap();
        assert!(!legacy.enabled && legacy.revision.is_none() && legacy.error.is_some());
        let history_before = sources::head(root.path(), "invalidlegacy").ok();
        let marker = code.parent().unwrap().join(".situate");
        let marker_existed = marker.exists();
        let source_before =
            fs::read(code.join(if oversized { "entry.js" } else { "plugin.json" })).unwrap();
        let independent = package(root.path(), "independent", &[]);
        let checked = checked_closure(root.path(), std::slice::from_ref(&independent)).unwrap();
        assert_eq!(checked, vec![independent.clone()]);
        assert_eq!(
            publish(
                root.path(),
                std::slice::from_ref(&independent),
                &checked,
                &[]
            )
            .unwrap()
            .status,
            PublicationStatus::Published
        );
        let listing = runtime::list(root.path()).unwrap();
        let legacy = listing
            .plugins
            .iter()
            .find(|p| p.id == "invalidlegacy")
            .unwrap();
        assert!(!legacy.enabled && legacy.revision.is_none() && legacy.error.is_some());
        assert!(runtime::load(root.path(), "invalidlegacy").is_err());
        assert!(runtime::load(root.path(), "independent").is_ok());
        assert_eq!(
            sources::head(root.path(), "invalidlegacy").ok(),
            history_before
        );
        assert_eq!(marker.exists(), marker_existed);
        assert_eq!(
            fs::read(code.join(if oversized { "entry.js" } else { "plugin.json" })).unwrap(),
            source_before
        );
        let consumer = package(root.path(), "requires-legacy", &["invalidlegacy"]);
        let state_before = state_bytes(root.path());
        assert!(checked_closure(root.path(), std::slice::from_ref(&consumer)).is_err());
        assert!(
            publish(
                root.path(),
                std::slice::from_ref(&consumer),
                std::slice::from_ref(&consumer),
                &[]
            )
            .is_err()
        );
        if !oversized {
            let invalid = history_before.as_ref().unwrap();
            assert!(checked_closure(root.path(), std::slice::from_ref(invalid)).is_err());
            assert!(
                publish(
                    root.path(),
                    std::slice::from_ref(invalid),
                    std::slice::from_ref(invalid),
                    &[]
                )
                .is_err()
            );
        }
        assert_eq!(state_bytes(root.path()), state_before);
        assert_eq!(
            sources::head(root.path(), "invalidlegacy").ok(),
            history_before
        );
        assert_eq!(marker.exists(), marker_existed);
    }
}

#[test]
fn unavailable_unpinned_history_does_not_block_independent_changes_or_get_repaired() {
    for missing in [false, true] {
        let root = root();
        let legacy = package(root.path(), "brokenlegacy", &[]);
        runtime::set_enabled(
            root.path(),
            "brokenlegacy",
            true,
            runtime::list(root.path()).unwrap().revision.as_deref(),
        )
        .unwrap();
        let history = root
            .path()
            .join(".situate/plugins/brokenlegacy/.situate/history.git");
        if missing {
            fs::remove_dir_all(&history).unwrap();
        } else {
            fs::write(history.join("HEAD"), "damaged legacy history").unwrap();
        }
        let prepared = runtime::prepare(root.path()).unwrap();
        let unavailable = prepared
            .plugins
            .iter()
            .find(|p| p.id == "brokenlegacy")
            .unwrap();
        assert!(
            !unavailable.enabled && unavailable.revision.is_none() && unavailable.error.is_some()
        );
        let independent = package(root.path(), "independent", &[]);
        activate(root.path(), &[independent]);
        let consumer = package(root.path(), "requires-legacy", &["brokenlegacy"]);
        let state_before = state_bytes(root.path());
        for selected in [&legacy, &consumer] {
            assert!(checked_closure(root.path(), std::slice::from_ref(selected)).is_err());
            assert!(
                publish(
                    root.path(),
                    std::slice::from_ref(selected),
                    std::slice::from_ref(selected),
                    &[]
                )
                .is_err()
            );
        }
        let listing = runtime::prepare(root.path()).unwrap();
        let unavailable = listing
            .plugins
            .iter()
            .find(|p| p.id == "brokenlegacy")
            .unwrap();
        assert!(
            !unavailable.enabled && unavailable.revision.is_none() && unavailable.error.is_some()
        );
        assert!(runtime::load(root.path(), "independent").is_ok());
        assert!(runtime::load(root.path(), "brokenlegacy").is_err());
        assert_eq!(state_bytes(root.path()), state_before);
        assert_eq!(
            sources::read(root.path(), "brokenlegacy", "entry.js")
                .unwrap()
                .text,
            "export const value = 1;"
        );
        if missing {
            assert!(!history.exists());
        } else {
            assert_eq!(
                fs::read_to_string(history.join("HEAD")).unwrap(),
                "damaged legacy history"
            );
        }
    }
}

#[test]
fn every_runnable_affected_consumer_is_required_even_with_unavailable_legacy() {
    let root = root();
    let connection = package(root.path(), "connection", &[]);
    let a = package(root.path(), "consumer-a", &["connection"]);
    let b = package(root.path(), "consumer-b", &["connection"]);
    let indirect = package(root.path(), "indirect", &["consumer-b"]);
    activate(
        root.path(),
        &[connection, a.clone(), b.clone(), indirect.clone()],
    );
    package(root.path(), "invalidlegacy", &[]);
    let listing = runtime::list(root.path()).unwrap();
    runtime::set_enabled(
        root.path(),
        "invalidlegacy",
        true,
        listing.revision.as_deref(),
    )
    .unwrap();
    fs::write(
        root.path()
            .join(".situate/plugins/invalidlegacy/code/plugin.json"),
        "invalid",
    )
    .unwrap();
    runtime::prepare(root.path()).unwrap();
    let changed = edit(root.path(), "connection", "updated connection");
    let checked = checked_closure(root.path(), std::slice::from_ref(&changed)).unwrap();
    assert_eq!(checked, vec![changed.clone(), a, b.clone(), indirect]);
    let incomplete = checked
        .iter()
        .filter(|p| p.plugin_id != "consumer-b")
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(
        publish(
            root.path(),
            std::slice::from_ref(&changed),
            &incomplete,
            &[]
        )
        .unwrap()
        .status,
        PublicationStatus::NeedsRecheck
    );
    assert_eq!(
        publish(root.path(), std::slice::from_ref(&changed), &checked, &[])
            .unwrap()
            .status,
        PublicationStatus::Published
    );
    assert_eq!(
        runtime::list(root.path())
            .unwrap()
            .plugins
            .iter()
            .find(|p| p.id == "consumer-b")
            .unwrap()
            .revision
            .as_deref(),
        Some(b.revision.as_str())
    );
}

#[test]
fn corrupt_pinned_history_cannot_hide_a_potentially_running_consumer() {
    let root = root();
    let pinned = package(root.path(), "pinned", &[]);
    activate(root.path(), &[pinned]);
    let independent = package(root.path(), "independent", &[]);
    let history = root
        .path()
        .join(".situate/plugins/pinned/.situate/history.git/HEAD");
    fs::write(&history, "corrupt pinned history").unwrap();
    let state_before = state_bytes(root.path());
    assert!(checked_closure(root.path(), std::slice::from_ref(&independent)).is_err());
    assert!(
        publish(
            root.path(),
            std::slice::from_ref(&independent),
            std::slice::from_ref(&independent),
            &[]
        )
        .is_err()
    );
    assert_eq!(state_bytes(root.path()), state_before);
    assert_eq!(
        fs::read_to_string(history).unwrap(),
        "corrupt pinned history"
    );
}

#[test]
fn only_relevant_dependency_cycles_and_missing_edges_block_publication() {
    let root = root();
    package(root.path(), "orphan", &["missing"]);
    package(root.path(), "cycle-one", &["cycle-two"]);
    package(root.path(), "cycle-two", &["cycle-one"]);
    let mut revision = runtime::list(root.path()).unwrap().revision;
    for id in ["orphan", "cycle-one", "cycle-two"] {
        revision = Some(runtime::set_enabled(root.path(), id, true, revision.as_deref()).unwrap());
    }
    runtime::prepare(root.path()).unwrap();
    let independent = package(root.path(), "independent", &[]);
    activate(root.path(), &[independent]);
    for dependency in ["orphan", "cycle-one"] {
        let id = format!("needs-{dependency}");
        let consumer = package(root.path(), &id, &[dependency]);
        assert!(checked_closure(root.path(), std::slice::from_ref(&consumer)).is_err());
        assert!(
            publish(
                root.path(),
                std::slice::from_ref(&consumer),
                std::slice::from_ref(&consumer),
                &[]
            )
            .is_err()
        );
    }
}

#[test]
fn new_dependencies_must_be_selected_with_their_consumer() {
    let root = root();
    let dependency = package(root.path(), "connection", &[]);
    let consumer = package(root.path(), "inbox", &["connection"]);
    assert_eq!(
        checked_closure(root.path(), std::slice::from_ref(&consumer)).unwrap_err(),
        "native.plugins.dependencyUnavailable"
    );
    assert!(checked_closure(root.path(), &[consumer, dependency]).is_ok());
}

#[test]
fn missing_and_cyclic_dependencies_never_publish() {
    let root = root();
    let a = package(root.path(), "one", &["two"]);
    assert!(checked_closure(root.path(), std::slice::from_ref(&a)).is_err());
    let b = package(root.path(), "two", &["one"]);
    assert!(checked_closure(root.path(), &[a.clone(), b.clone()]).is_err());
    assert!(publish(root.path(), &[a.clone(), b.clone()], &[a, b], &[]).is_err());
    assert!(
        runtime::list(root.path())
            .unwrap()
            .plugins
            .iter()
            .all(|p| !p.enabled)
    );
}
#[test]
fn failures_do_not_expose_partial_groups_and_uncertain_switch_is_not_replayed() {
    for point in ["before-switch", "state-sync", "after-switch"] {
        let root = root();
        let a = package(root.path(), "one", &[]);
        let b = package(root.path(), "two", &[]);
        activate(root.path(), &[a.clone(), b.clone()]);
        let a2 = edit(root.path(), "one", "new one");
        let b2 = edit(root.path(), "two", "new two");
        let selected = [a2.clone(), b2.clone()];
        let checked = checked_closure(root.path(), &selected).unwrap();
        FAILURE.with(|f| f.set(Some(point)));
        let result = publish(root.path(), &selected, &checked, &[]).unwrap();
        assert_eq!(status(root.path(), &result.attempt).unwrap(), result);
        let bytes = state_bytes(root.path());
        let (state, _) = runtime::decode(Some(&bytes)).unwrap();
        let expected = if point == "before-switch" {
            [&a, &b]
        } else {
            [&a2, &b2]
        };
        for revision in expected {
            assert_eq!(
                state
                    .plugins
                    .iter()
                    .find(|p| p.id == revision.plugin_id)
                    .unwrap()
                    .revision
                    .as_deref(),
                Some(revision.revision.as_str())
            );
        }
        if point == "before-switch" {
            assert_eq!(result.status, PublicationStatus::NotPublished);
            assert_eq!(
                runtime::load(root.path(), "one")
                    .unwrap()
                    .service_entry
                    .as_deref(),
                Some("export const value = 1;")
            );
        } else {
            assert_eq!(result.status, PublicationStatus::OutcomeUnknown);
            assert_eq!(current(root.path()).unwrap(), Some(result.clone()));
            assert!(runtime::load(root.path(), "one").is_err());
            assert!(runtime::load(root.path(), "two").is_err());
            assert!(publish(root.path(), &selected, &checked, &[]).is_err());
            assert_eq!(state_bytes(root.path()), bytes);
        }
        assert!(sources::at_revision(root.path(), &a).is_ok());
        assert!(sources::at_revision(root.path(), &b).is_ok());
    }
}
#[test]
fn shared_writes_pin_enabled_legacy_before_changing_source() {
    let root = root();
    let original = package(root.path(), "legacy", &[]);
    runtime::set_enabled(
        root.path(),
        "legacy",
        true,
        runtime::list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    assert!(
        runtime::list(root.path()).unwrap().plugins[0]
            .revision
            .is_none()
    );
    edit(root.path(), "legacy", "unchecked edit");
    let listing = runtime::list(root.path()).unwrap();
    assert_eq!(
        listing.plugins[0].revision.as_deref(),
        Some(original.revision.as_str())
    );
    assert_eq!(
        runtime::load(root.path(), "legacy")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 1;")
    );
    sources::mkdir(root.path(), "legacy", "nested").unwrap();
    sources::write(root.path(), "legacy", "nested/new.js", "new", None).unwrap();
    assert_eq!(sources::files(root.path(), "legacy").unwrap().len(), 4);
    assert_eq!(
        sources::revision(root.path(), "legacy", "entry.js", &original.revision).unwrap(),
        b"export const value = 1;"
    );
}
#[test]
fn source_rename_and_delete_pin_legacy_and_retain_exact_historical_bytes() {
    let root = root();
    let original = package(root.path(), "legacy", &[]);
    runtime::set_enabled(
        root.path(),
        "legacy",
        true,
        runtime::list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    assert!(sources::rename(root.path(), "legacy", "entry.js", "../outside.js").is_err());
    let renamed = sources::rename(root.path(), "legacy", "entry.js", "renamed.js").unwrap();
    let crate::content::OperationOutcome::Complete {
        history_revision: renamed_revision,
    } = renamed
    else {
        panic!("rename was incomplete")
    };
    assert!(sources::read(root.path(), "legacy", "entry.js").is_err());
    assert_eq!(
        sources::revision(root.path(), "legacy", "renamed.js", &renamed_revision).unwrap(),
        b"export const value = 1;"
    );
    assert_eq!(
        runtime::load(root.path(), "legacy")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 1;")
    );
    sources::write(root.path(), "legacy", "occupied.js", "keep", None).unwrap();
    assert!(sources::rename(root.path(), "legacy", "renamed.js", "occupied.js").is_err());
    assert_eq!(
        sources::read(root.path(), "legacy", "occupied.js")
            .unwrap()
            .text,
        "keep"
    );
    assert!(matches!(
        sources::remove(root.path(), "legacy", "renamed.js").unwrap(),
        crate::content::OperationOutcome::Complete { .. }
    ));
    assert!(sources::read(root.path(), "legacy", "renamed.js").is_err());
    assert!(sources::remove(root.path(), "legacy", "../outside.js").is_err());
    assert_eq!(
        sources::revision(root.path(), "legacy", "entry.js", &original.revision).unwrap(),
        b"export const value = 1;"
    );
    assert_eq!(
        sources::revision(root.path(), "legacy", "renamed.js", &renamed_revision).unwrap(),
        b"export const value = 1;"
    );
    assert_eq!(
        runtime::list(root.path()).unwrap().plugins[0]
            .revision
            .as_deref(),
        Some(original.revision.as_str())
    );
    assert_eq!(
        runtime::load(root.path(), "legacy")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 1;")
    );
}

#[test]
fn historical_reads_do_not_observe_or_depend_on_mutable_source() {
    let root = root();
    let original = package(root.path(), "one", &[]);
    activate(root.path(), std::slice::from_ref(&original));
    let code = root.path().join(".situate/plugins/one/code");
    let head = sources::head(root.path(), "one").unwrap();
    for bytes in [
        b"incomplete manifest".to_vec(),
        vec![b'x'; MAX_TEXT as usize + 1],
    ] {
        fs::write(code.join("plugin.json"), bytes).unwrap();
        assert_eq!(
            runtime::load(root.path(), "one")
                .unwrap()
                .service_entry
                .as_deref(),
            Some("export const value = 1;")
        );
        assert!(
            runtime::list(root.path()).unwrap().plugins[0]
                .error
                .is_none()
        );
        assert_eq!(sources::head(root.path(), "one").unwrap(), head);
        assert_eq!(
            sources::revision(root.path(), "one", "entry.js", &original.revision).unwrap(),
            b"export const value = 1;"
        );
    }
    fs::remove_file(code.join("plugin.json")).unwrap();
    fs::write(code.join("entry.js"), "half-written source").unwrap();
    assert!(sources::at_revision(root.path(), &original).is_ok());
    assert_eq!(sources::head(root.path(), "one").unwrap(), head);
    assert!(sources::revision(root.path(), "one", "entry.js", "HEAD").is_err());
    let history = sources::history(root.path(), "one").unwrap();
    assert!(
        history
            .iter()
            .any(|entry| entry.revision == original.revision)
    );
}

#[test]
fn bounded_history_reads_validate_paths_revisions_and_blob_size() {
    let root = root();
    let original = package(root.path(), "one", &[]);
    let plugin = root.path().join(".situate/plugins/one");
    let store = crate::content::ContentStore::open_existing_history(
        &plugin.join("code"),
        &plugin.join(".situate"),
    )
    .unwrap();
    let bytes = b"export const value = 1;";
    assert_eq!(
        store
            .read_revision_bounded("entry.js", &original.revision, bytes.len() as u64)
            .unwrap(),
        bytes
    );
    assert!(
        store
            .read_revision_bounded("entry.js", &original.revision, bytes.len() as u64 - 1)
            .is_err()
    );
    assert_eq!(
        store.read_revision("entry.js", &original.revision).unwrap(),
        bytes
    );
    assert!(
        store
            .read_revision_bounded("../entry.js", &original.revision, 100)
            .is_err()
    );
    assert!(
        store
            .read_revision_bounded("entry.js", "HEAD", 100)
            .is_err()
    );
}

#[test]
fn historical_reads_never_initialize_missing_metadata_or_rewrite_configuration() {
    let root = root();
    let original = package(root.path(), "one", &[]);
    let marker = root.path().join(".situate/plugins/one/.situate");
    let config = marker.join("history.git/config");
    let repo = git2::Repository::open_bare(marker.join("history.git")).unwrap();
    repo.config()
        .unwrap()
        .set_bool("core.fsyncObjectFiles", false)
        .unwrap();
    drop(repo);
    let before = fs::read(&config).unwrap();
    sources::at_revision(root.path(), &original).unwrap();
    sources::history(root.path(), "one").unwrap();
    assert_eq!(fs::read(&config).unwrap(), before);
    for name in ["content.lock", "drafts", "history.git"] {
        let path = marker.join(name);
        if path.is_dir() {
            fs::remove_dir_all(&path).unwrap();
        } else {
            fs::remove_file(&path).unwrap();
        }
        assert!(sources::at_revision(root.path(), &original).is_err());
        assert!(!path.exists());
    }
    fs::remove_dir_all(&marker).unwrap();
    assert!(sources::history(root.path(), "one").is_err());
    assert!(!marker.exists());
}

#[test]
fn group_switch_also_pins_checked_legacy_dependencies_before_later_source_edits() {
    let root = root();
    let dependency = package(root.path(), "dependency", &[]);
    runtime::set_enabled(
        root.path(),
        "dependency",
        true,
        runtime::list(root.path()).unwrap().revision.as_deref(),
    )
    .unwrap();
    let consumer = package(root.path(), "consumer", &["dependency"]);
    activate(root.path(), &[consumer]);
    fs::write(
        root.path()
            .join(".situate/plugins/dependency/code/entry.js"),
        "external unchecked dependency",
    )
    .unwrap();
    assert_eq!(
        runtime::load(root.path(), "dependency")
            .unwrap()
            .service_entry
            .as_deref(),
        Some("export const value = 1;")
    );
    assert_eq!(
        runtime::list(root.path())
            .unwrap()
            .plugins
            .iter()
            .find(|p| p.id == "dependency")
            .unwrap()
            .revision
            .as_deref(),
        Some(dependency.revision.as_str())
    );
}

#[test]
fn missing_or_damaged_history_is_not_reinitialized() {
    for missing in [false, true] {
        let root = root();
        let a = package(root.path(), "one", &[]);
        activate(root.path(), &[a]);
        let history = root
            .path()
            .join(".situate/plugins/one/.situate/history.git");
        if missing {
            fs::remove_dir_all(&history).unwrap();
        } else {
            fs::write(history.join("HEAD"), "damaged").unwrap();
        }
        assert!(runtime::load(root.path(), "one").is_err());
        assert!(sources::write(root.path(), "one", "new.js", "new", None).is_err());
        assert!(
            !root
                .path()
                .join(".situate/plugins/one/code/new.js")
                .exists()
        );
        if missing {
            assert!(!history.exists());
        } else {
            assert_eq!(fs::read_to_string(history.join("HEAD")).unwrap(), "damaged");
        }
    }
}

fn state_bytes(root: &Path) -> Vec<u8> {
    runtime::read_state(root, &runtime::storage(root).unwrap().unwrap())
        .unwrap()
        .unwrap()
}
