use super::*;
use std::fs;

fn root() -> tempfile::TempDir {
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    root
}

#[test]
fn ignored_artifacts_are_excluded_from_plugin_scans_and_snapshots() {
    let root = root();
    create(root.path(), "sample").unwrap();
    let code = root.path().join(".situate/plugins/sample/code");
    fs::create_dir(code.join("nested")).unwrap();
    fs::write(code.join("nested/.env"), "synthetic").unwrap();
    let before = snapshot(root.path(), "sample").unwrap();
    fs::write(code.join(".DS_Store"), "finder").unwrap();
    fs::write(code.join("nested/.module.js.swp"), "swap").unwrap();
    fs::create_dir(code.join(".AppleDouble")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("/unavailable", code.join(".AppleDouble/link")).unwrap();
    assert_eq!(
        files(root.path(), "sample")
            .unwrap()
            .into_iter()
            .map(|file| file.path)
            .collect::<Vec<_>>(),
        vec!["nested", "nested/.env"]
    );
    assert_eq!(super::super::files(root.path(), "sample").unwrap().len(), 2);
    assert_eq!(snapshot(root.path(), "sample").unwrap(), before);
    fs::write(code.join(".DS_Store"), "changed").unwrap();
    assert_eq!(snapshot(root.path(), "sample").unwrap(), before);
    assert_eq!(fs::read(code.join(".DS_Store")).unwrap(), b"changed");
    fs::write(code.join("nested/.env"), "changed content").unwrap();
    assert_ne!(snapshot(root.path(), "sample").unwrap(), before);
}

#[test]
fn historical_paths_include_deleted_files_without_manifest_validation_or_source_observation() {
    let root = root();
    create(root.path(), "sample").unwrap();
    write(
        root.path(),
        "sample",
        "plugin.json",
        "incomplete manifest",
        None,
    )
    .unwrap();
    mkdir(root.path(), "sample", "nested").unwrap();
    write(
        root.path(),
        "sample",
        "nested/deleted.js",
        "recorded bytes",
        None,
    )
    .unwrap();
    let before = snapshot(root.path(), "sample").unwrap();
    remove(root.path(), "sample", "nested/deleted.js").unwrap();
    let after = snapshot(root.path(), "sample").unwrap();
    let code = root.path().join(".situate/plugins/sample/code");
    fs::write(code.join("plugin.json"), vec![b'x'; MAX_TEXT as usize + 1]).unwrap();
    fs::write(code.join("external.js"), "not recorded").unwrap();
    assert_eq!(
        files_at_revision(root.path(), "sample", &before.revision).unwrap(),
        vec![
            PluginFile {
                path: "nested".into(),
                is_directory: true
            },
            PluginFile {
                path: "nested/deleted.js".into(),
                is_directory: false
            },
            PluginFile {
                path: "plugin.json".into(),
                is_directory: false
            },
        ]
    );
    assert_eq!(
        files_at_revision(root.path(), "sample", &after.revision).unwrap(),
        vec![
            PluginFile {
                path: "nested".into(),
                is_directory: true
            },
            PluginFile {
                path: "plugin.json".into(),
                is_directory: false
            },
        ]
    );
    assert_eq!(
        revision(root.path(), "sample", "nested/deleted.js", &before.revision).unwrap(),
        b"recorded bytes"
    );
    assert_eq!(
        serde_json::to_value(
            changes_between(root.path(), "sample", &before.revision, &after.revision).unwrap()
        )
        .unwrap(),
        serde_json::json!([
            {"path":"nested/deleted.js", "status":"D"}
        ])
    );
    assert!(at_revision(root.path(), &before).is_err());
    assert_eq!(head(root.path(), "sample").unwrap(), after);
}

#[test]
fn historical_listing_rejects_invalid_revisions_and_does_not_initialize_missing_history() {
    let root = root();
    let plugin = root.path().join(".situate/plugins/sample");
    fs::create_dir_all(plugin.join("code")).unwrap();
    for revision in [
        "HEAD",
        "../unsafe",
        "0000000000000000000000000000000000000000",
    ] {
        assert!(files_at_revision(root.path(), "sample", revision).is_err());
        assert!(changes_between(root.path(), "sample", revision, revision).is_err());
        assert!(!plugin.join(".situate").exists());
    }
    assert!(files_at_revision(root.path(), "../sample", &"a".repeat(40)).is_err());
}

#[test]
fn historical_listing_does_not_require_reading_oversized_blob_contents() {
    let root = root();
    create(root.path(), "sample").unwrap();
    let code = root.path().join(".situate/plugins/sample/code");
    fs::write(code.join("large.js"), vec![b'x'; MAX_TEXT as usize + 1]).unwrap();
    let marker = root.path().join(".situate/plugins/sample/.situate");
    let mut store = ContentStore::open_with_history(&code, &marker).unwrap();
    let captured = store.record_external_changes().unwrap();
    drop(store);
    assert_eq!(
        files_at_revision(root.path(), "sample", &captured).unwrap(),
        vec![PluginFile {
            path: "large.js".into(),
            is_directory: false
        }]
    );
    assert!(revision(root.path(), "sample", "large.js", &captured).is_err());
}

#[test]
fn historical_path_bounds_reject_whole_listing() {
    for invalid_path in [false, true] {
        let root = root();
        create(root.path(), "sample").unwrap();
        let before = head(root.path(), "sample").unwrap();
        let code = root.path().join(".situate/plugins/sample/code");
        if invalid_path {
            fs::write(code.join("unsafe name.js"), "source").unwrap();
        } else {
            for index in 0..=MAX_FILES {
                fs::write(code.join(format!("file-{index}.js")), "source").unwrap();
            }
        }
        let marker = root.path().join(".situate/plugins/sample/.situate");
        let mut store = ContentStore::open_with_history(&code, &marker).unwrap();
        let revision = store.record_external_changes().unwrap();
        drop(store);
        assert_eq!(
            changes_between(root.path(), "sample", &before.revision, &revision).unwrap_err(),
            if invalid_path {
                PluginError::InvalidPath
            } else {
                PluginError::TooLarge
            }
            .to_string()
        );
        assert_eq!(
            files_at_revision(root.path(), "sample", &revision).unwrap_err(),
            if invalid_path {
                PluginError::InvalidPath
            } else {
                PluginError::TooLarge
            }
            .to_string()
        );
    }
}
