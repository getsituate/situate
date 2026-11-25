use super::*;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    root
}
fn change(action: &str, expected_revision: Option<String>, change: BindingChange) -> Update {
    Update {
        action: action.into(),
        expected_revision,
        change,
        platform: None,
    }
}
fn keys(keys: &str) -> BindingChange {
    BindingChange::Set { keys: keys.into() }
}

#[test]
fn defaults_are_valid_and_unique_on_each_platform() {
    for platform in [Platform::Macos, Platform::Windows] {
        let mut used = std::collections::BTreeSet::new();
        for keys in defaults().values().map(|entry| &entry[platform.key()]) {
            assert!(valid_binding(keys, platform), "invalid binding: {keys}");
            assert!(used.insert(keys), "duplicate binding: {keys}");
        }
    }
}

#[test]
fn reads_legacy_workspace_without_creating_file_and_reopens_platform_overrides() {
    let root = workspace();
    let other = workspace();
    let path = root.path().join(".situate").join(FILE);
    assert!(snapshot(root.path()).unwrap().revision.is_none());
    assert!(!path.exists());
    let first = update(
        root.path(),
        Platform::Macos,
        change("layout.new-tab", None, keys("Meta+J")),
        &[],
    )
    .unwrap();
    update(
        root.path(),
        Platform::Windows,
        change("layout.new-tab", first.revision, BindingChange::Remove),
        &[],
    )
    .unwrap();
    let reopened = snapshot(root.path()).unwrap();
    assert_eq!(
        reopened.bindings["macos"]["layout.new-tab"].as_deref(),
        Some("Meta+J")
    );
    assert_eq!(reopened.bindings["windows"]["layout.new-tab"], None);
    let restored = update(
        root.path(),
        Platform::Windows,
        change("layout.new-tab", reopened.revision, BindingChange::Restore),
        &[],
    )
    .unwrap();
    assert!(!restored.bindings["windows"].contains_key("layout.new-tab"));
    assert!(snapshot(other.path()).unwrap().bindings.is_empty());
}

#[test]
fn retains_unknown_fields_and_rejects_stale_edits_and_unavailable_keys() {
    let root = workspace();
    let path = root.path().join(".situate").join(FILE);
    let original = json!({"version":1,"future":{"nested":[1,2]},"bindings":{"windows":{"layout.future":{"keep":true}},"futurePlatform":{"layout.new-tab":"Meta+Z"}}});
    fs::write(&path, original.to_string()).unwrap();
    let first = snapshot(root.path()).unwrap();
    let actual = update(
        root.path(),
        Platform::Windows,
        change("layout.new-tab", first.revision.clone(), keys("Control+J")),
        &[],
    )
    .unwrap();
    let saved = fs::read(&path).unwrap();
    let updated: Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(updated["future"], original["future"]);
    assert_eq!(
        updated["bindings"]["futurePlatform"],
        original["bindings"]["futurePlatform"]
    );
    assert_eq!(
        updated["bindings"]["windows"]["layout.future"],
        original["bindings"]["windows"]["layout.future"]
    );
    assert_eq!(
        update(
            root.path(),
            Platform::Windows,
            change("layout.new-tab", first.revision, keys("Control+K")),
            &[]
        )
        .unwrap_err(),
        CHANGED
    );
    assert_eq!(
        update(
            root.path(),
            Platform::Windows,
            change(
                "layout.new-tab",
                actual.revision.clone(),
                keys("Alt+ArrowLeft")
            ),
            &[]
        )
        .unwrap_err(),
        "native.shortcuts.conflict"
    );
    assert_eq!(
        update(
            root.path(),
            Platform::Windows,
            change("layout.new-tab", actual.revision, keys("Control+Alt+Q")),
            &[]
        )
        .unwrap_err(),
        INVALID
    );
    assert_eq!(fs::read(path).unwrap(), saved);
}

#[test]
fn respects_active_plugin_defaults_but_not_contested_proposals() {
    let root = workspace();
    let plugin = [PluginDefaults {
        id: "demo:open".into(),
        defaults: BTreeMap::from([("windows".into(), "Control+J".into())]),
    }];
    assert_eq!(
        update(
            root.path(),
            Platform::Windows,
            change("layout.new-tab", None, keys("Control+J")),
            &plugin
        )
        .unwrap_err(),
        "native.shortcuts.conflict"
    );
    let changed = update(
        root.path(),
        Platform::Windows,
        change("demo:open", None, keys("Control+L")),
        &plugin,
    )
    .unwrap();
    assert!(
        update(
            root.path(),
            Platform::Windows,
            change("layout.new-tab", changed.revision, keys("Control+J")),
            &plugin
        )
        .is_ok()
    );
}

#[test]
fn does_not_overwrite_unreadable_or_duplicate_configuration() {
    let root = workspace();
    let path = root.path().join(".situate").join(FILE);
    for bytes in [
        r#"{"version":2,"bindings":{}}"#,
        r#"{"version":1,"bindings":{"macos":{},"macos":{}}}"#,
        "{",
    ] {
        fs::write(&path, bytes).unwrap();
        assert_eq!(snapshot(root.path()).unwrap_err(), INVALID);
        assert_eq!(
            update(
                root.path(),
                Platform::Macos,
                change("layout.new-tab", None, keys("Meta+J")),
                &[]
            )
            .unwrap_err(),
            INVALID
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
    }
}

#[cfg(unix)]
#[test]
fn rejects_a_symlink_at_the_configuration_path() {
    let root = workspace();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), "do not replace").unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join(".situate").join(FILE)).unwrap();
    assert!(
        update(
            root.path(),
            Platform::Macos,
            change("layout.new-tab", None, keys("Meta+J")),
            &[]
        )
        .is_err()
    );
    assert_eq!(
        fs::read_to_string(outside.path()).unwrap(),
        "do not replace"
    );
}
