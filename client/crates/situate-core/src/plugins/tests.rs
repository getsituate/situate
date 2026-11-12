use super::*;
use serde_json::{Value, json};
use std::fs;

fn package(root: &Path, id: &str) -> std::path::PathBuf {
    let code = root.join(".situate/plugins").join(id).join("code");
    fs::create_dir_all(&code).unwrap();
    fs::write(code.join("SKILL.md"), "# Synthetic skill\n").unwrap();
    fs::write(
        code.join("index.js"),
        "throw new Error('Must not execute');",
    )
    .unwrap();
    manifest(
        &code,
        json!({"schemaVersion":2,"id":id,"name":"Example","description":"Synthetic package","skills":["SKILL.md"],"serviceEntry":"index.js"}),
    );
    code
}

fn manifest(code: &Path, value: Value) {
    fs::write(
        code.join("plugin.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
}

fn snapshot(root: &Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let mut result = Vec::new();
    for entry in fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            result.push((path.clone(), Vec::new()));
            result.extend(snapshot(&path));
        } else {
            result.push((path.clone(), fs::read(&path).unwrap()));
        }
    }
    result.sort();
    result
}

#[test]
fn valid_package_inspection_is_read_only_and_serializes_contract() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    fs::create_dir(code.join(".git")).unwrap();
    fs::write(code.join(".git/HEAD"), "not exposed").unwrap();
    fs::write(code.join(".ordinary"), "visible").unwrap();
    fs::create_dir(code.join("nested")).unwrap();
    fs::write(code.join("nested/help.md"), "Help").unwrap();
    fs::create_dir_all(code.parent().unwrap().join("config")).unwrap();
    fs::write(code.parent().unwrap().join("config/private"), "not source").unwrap();
    let before = snapshot(root.path());
    let result = validate(root.path(), "demo").unwrap();
    assert_eq!(result.skills, vec!["SKILL.md"]);
    assert_eq!(result.service_entry.as_deref(), Some("index.js"));
    let inventory = serde_json::to_value(list(root.path()).unwrap()).unwrap();
    assert_eq!(inventory[0]["id"], "demo");
    assert_eq!(inventory[0]["manifest"]["schemaVersion"], 2);
    assert!(inventory[0]["error"].is_null());
    let entries = files(root.path(), "demo").unwrap();
    assert_eq!(
        entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
        vec![
            ".ordinary",
            "SKILL.md",
            "index.js",
            "nested",
            "nested/help.md",
            "plugin.json"
        ]
    );
    assert_eq!(
        serde_json::to_value(&entries[3]).unwrap(),
        json!({"path":"nested","isDirectory":true})
    );
    assert_eq!(read(root.path(), "demo", "nested/help.md").unwrap(), "Help");
    assert_eq!(snapshot(root.path()), before);
    assert!(!root.path().join(".git").exists());
}

#[test]
fn manifest_optional_metadata_preserves_shapes_and_rejects_invalid_graph_declarations() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    let base: Value = serde_json::from_slice(&fs::read(code.join("plugin.json")).unwrap()).unwrap();
    let original = serde_json::to_value(validate(root.path(), "demo").unwrap()).unwrap();
    assert_eq!(original, base);
    for (field, value) in [
        ("kind", json!("provider")),
        ("kind", Value::Null),
        ("dependencies", json!(["demo"])),
        ("dependencies", json!(["other", "other"])),
        ("dependencies", json!(["Bad-ID"])),
        ("dependencies", Value::Null),
        ("exports", json!(["method", "method"])),
        ("exports", json!(["bad.name"])),
        ("exports", json!(["1name"])),
        ("exports", json!([""])),
        ("exports", Value::Null),
        ("components", json!(["Panel", "Panel"])),
        ("components", json!(["bad.name"])),
        ("components", json!(["1Panel"])),
        ("components", json!([""])),
        ("components", json!(["x".repeat(129)])),
        ("components", json!("Panel")),
        ("components", Value::Null),
        ("platforms", json!(["android"])),
        ("platforms", json!(["macos", "macos"])),
        ("platforms", Value::Null),
    ] {
        let mut value_with_field = base.clone();
        value_with_field[field] = value;
        manifest(&code, value_with_field);
        assert!(validate(root.path(), "demo").is_err(), "accepted {field}");
    }
    let mut extended = base;
    extended["kind"] = json!("connection");
    extended["dependencies"] = json!(["other"]);
    extended["exports"] = json!(["connect", "$account", "_state2"]);
    extended["components"] = json!(["connect", "AccountPanel", "$view", "_view2"]);
    extended["platforms"] = json!(["macos", "ios"]);
    manifest(&code, extended.clone());
    let parsed = validate(root.path(), "demo").unwrap();
    assert_eq!(parsed.kind, Some(PluginKind::Connection));
    assert_eq!(serde_json::to_value(parsed).unwrap(), extended);
}

#[test]
fn absent_storage_is_empty_but_corrupt_storage_is_not() {
    let root = tempfile::tempdir().unwrap();
    assert!(list(root.path()).unwrap().is_empty());
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    fs::create_dir(root.path().join(".situate")).unwrap();
    assert!(list(root.path()).unwrap().is_empty());
    assert_eq!(
        fs::read_dir(root.path().join(".situate")).unwrap().count(),
        0
    );
    fs::write(root.path().join(".situate/plugins"), "corrupt").unwrap();
    assert_eq!(list(root.path()), Err(PluginError::InvalidPath));
    assert_eq!(
        list(&root.path().join("absent")),
        Err(PluginError::Unavailable)
    );
}

#[test]
fn malformed_packages_remain_attributable_and_source_is_inspectable() {
    let root = tempfile::tempdir().unwrap();
    package(root.path(), "z-valid");
    let bad = package(root.path(), "a-broken");
    fs::write(bad.join("plugin.json"), "{not json").unwrap();
    fs::write(root.path().join(".situate/plugins/not-directory"), "bad").unwrap();
    package(root.path(), "INVALID");
    let items = list(root.path()).unwrap();
    assert_eq!(
        items.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec!["INVALID", "a-broken", "z-valid"]
    );
    assert_eq!(
        items[0].error.as_deref(),
        Some("native.plugins.invalidPath")
    );
    assert_eq!(
        items[1].error.as_deref(),
        Some("native.plugins.invalidManifest")
    );
    assert!(items[2].manifest.is_some());
    assert_eq!(
        read(root.path(), "a-broken", "plugin.json").unwrap(),
        "{not json"
    );
    assert_eq!(files(root.path(), "a-broken").unwrap().len(), 3);
}

#[test]
fn manifest_rejects_unknown_fields_versions_types_and_invalid_declarations() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    let base: Value = serde_json::from_slice(&fs::read(code.join("plugin.json")).unwrap()).unwrap();
    for (field, value) in [
        ("schemaVersion", json!(1)),
        ("schemaVersion", json!(1.0)),
        ("unexpected", json!(true)),
        ("id", json!("other")),
        ("name", json!(" \n")),
        ("description", json!("\t")),
        ("skills", json!(["index.js"])),
        ("skills", json!(["SKILL.md", "SKILL.md"])),
        ("skills", json!(["SKILL.md", "skill.md"])),
        ("skills", Value::Null),
        ("serviceEntry", Value::Null),
        ("serviceEntry", json!("SKILL.md")),
        ("uiEntry", Value::Null),
        ("uiEntry", json!("SKILL.md")),
        ("uiEntry", json!("index.js")),
        ("uiEntry", json!("INDEX.js")),
        ("entry", json!("index.js")),
    ] {
        let mut invalid = base.clone();
        invalid[field] = value;
        manifest(&code, invalid);
        assert_eq!(
            validate(root.path(), "demo"),
            Err(PluginError::InvalidManifest),
            "{field}"
        );
    }
    manifest(
        &code,
        json!({"schemaVersion":2,"id":"demo","name":"Example","description":"Synthetic"}),
    );
    assert_eq!(
        validate(root.path(), "demo"),
        Err(PluginError::InvalidManifest)
    );
    fs::write(code.join("plugin.json"), r#"{"schemaVersion":2,"schemaVersion":2,"id":"demo","name":"Example","description":"Synthetic","serviceEntry":"index.js"}"#).unwrap();
    assert_eq!(
        validate(root.path(), "demo"),
        Err(PluginError::InvalidManifest)
    );
    for field in ["serviceEntry", "skills"] {
        let mut valid = base.clone();
        valid.as_object_mut().unwrap().remove(field);
        manifest(&code, valid);
        assert!(validate(root.path(), "demo").is_ok());
    }
}

#[test]
fn entry_roles_are_optional_individually_and_serialize_as_distinct_paths() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    for (service, ui, skills) in [
        (true, true, false),
        (true, false, false),
        (false, true, false),
        (false, false, true),
    ] {
        let mut value = json!({
            "schemaVersion": 2, "id": "demo", "name": "Example", "description": "Synthetic"
        });
        if service {
            value["serviceEntry"] = json!("index.js");
        }
        if ui {
            value["uiEntry"] = json!("view.js");
            fs::write(code.join("view.js"), "export default {};").unwrap();
        }
        if skills {
            value["skills"] = json!(["SKILL.md"]);
        }
        manifest(&code, value);
        let validated = validate(root.path(), "demo").unwrap();
        assert_eq!(
            validated.service_entry.as_deref(),
            service.then_some("index.js")
        );
        assert_eq!(validated.ui_entry.as_deref(), ui.then_some("view.js"));
        let serialized = serde_json::to_value(validated).unwrap();
        assert_eq!(serialized.get("serviceEntry").is_some(), service);
        assert_eq!(serialized.get("uiEntry").is_some(), ui);
        assert!(serialized.get("entry").is_none());
    }
}

#[test]
fn declared_sources_must_exist_and_be_utf8_regular_files() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    let mut value: Value =
        serde_json::from_slice(&fs::read(code.join("plugin.json")).unwrap()).unwrap();
    value["uiEntry"] = json!("view.js");
    manifest(&code, value);
    fs::write(code.join("view.js"), "export default {};").unwrap();
    for name in ["SKILL.md", "index.js", "view.js"] {
        let path = code.join(name);
        let original = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(validate(root.path(), "demo"), Err(PluginError::ReadFailed));
        fs::create_dir(&path).unwrap();
        assert_eq!(validate(root.path(), "demo"), Err(PluginError::InvalidPath));
        fs::remove_dir(&path).unwrap();
        fs::write(&path, [0xff]).unwrap();
        assert_eq!(validate(root.path(), "demo"), Err(PluginError::ReadFailed));
        fs::write(&path, original).unwrap();
    }
}

#[test]
fn paths_and_ids_reject_traversal_and_nonportable_aliases() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    for path in [
        "",
        "/SKILL.md",
        "../SKILL.md",
        "x/../SKILL.md",
        "./SKILL.md",
        "x//a.md",
        "C:/a.md",
        "x\\a.md",
        ".git/HEAD",
        "x/.GIT/HEAD",
        "NUL.md",
        "com1.md",
        "a.",
        "a\0.md",
    ] {
        assert_eq!(
            read(root.path(), "demo", path),
            Err(PluginError::InvalidPath),
            "{path:?}"
        );
        manifest(
            &code,
            json!({"schemaVersion":2,"id":"demo","name":"Example","description":"Synthetic","skills":[path]}),
        );
        assert_eq!(
            validate(root.path(), "demo"),
            Err(PluginError::InvalidPath),
            "{path:?}"
        );
    }
    for id in [
        "",
        "../demo",
        "DEMO",
        "con",
        "demo/other",
        "-demo",
        "demo-",
        "demo.name",
    ] {
        assert_eq!(files(root.path(), id), Err(PluginError::InvalidPath));
    }
}

#[test]
fn byte_limits_accept_boundary_and_fail_without_truncation() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    fs::write(code.join("SKILL.md"), vec![b'a'; MAX_TEXT as usize]).unwrap();
    assert_eq!(
        read(root.path(), "demo", "SKILL.md").unwrap().len(),
        MAX_TEXT as usize
    );
    assert!(validate(root.path(), "demo").is_ok());
    fs::write(code.join("SKILL.md"), vec![b'a'; MAX_TEXT as usize + 1]).unwrap();
    assert_eq!(
        read(root.path(), "demo", "SKILL.md"),
        Err(PluginError::TooLarge)
    );
    assert_eq!(validate(root.path(), "demo"), Err(PluginError::TooLarge));
    fs::write(code.join("SKILL.md"), "ok").unwrap();
    let mut bytes = fs::read(code.join("plugin.json")).unwrap();
    bytes.resize(MAX_MANIFEST as usize, b' ');
    fs::write(code.join("plugin.json"), &bytes).unwrap();
    assert!(validate(root.path(), "demo").is_ok());
    bytes.push(b' ');
    fs::write(code.join("plugin.json"), bytes).unwrap();
    assert_eq!(validate(root.path(), "demo"), Err(PluginError::TooLarge));
    assert_eq!(
        read(root.path(), "demo", &"a".repeat(MAX_PATH + 1)),
        Err(PluginError::TooLarge)
    );
    assert_eq!(
        read(root.path(), "demo", &vec!["a"; MAX_DEPTH + 1].join("/")),
        Err(PluginError::TooLarge)
    );
}

#[test]
fn validation_bounds_total_declared_source_bytes() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    let mut skills = Vec::new();
    for i in 0..8 {
        let name = format!("skill-{i}.md");
        fs::write(code.join(&name), vec![b'a'; MAX_TEXT as usize]).unwrap();
        skills.push(name);
    }
    manifest(
        &code,
        json!({"schemaVersion":2,"id":"demo","name":"Example","description":"Synthetic","skills":skills}),
    );
    assert!(validate(root.path(), "demo").is_ok());
    skills.push("SKILL.md".into());
    manifest(
        &code,
        json!({"schemaVersion":2,"id":"demo","name":"Example","description":"Synthetic","skills":skills}),
    );
    assert_eq!(validate(root.path(), "demo"), Err(PluginError::TooLarge));
}

#[test]
fn inventory_and_recursive_file_limits_fail_whole_operation() {
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    for i in 3..MAX_FILES {
        fs::write(code.join(format!("file-{i}")), "").unwrap();
    }
    assert_eq!(files(root.path(), "demo").unwrap().len(), MAX_FILES);
    fs::write(code.join("overflow"), "").unwrap();
    assert_eq!(files(root.path(), "demo"), Err(PluginError::TooLarge));
    assert_eq!(
        list(root.path()).unwrap()[0].error.as_deref(),
        Some("native.plugins.tooLarge")
    );
    for i in 1..MAX_PACKAGES {
        package(root.path(), &format!("p-{i}"));
    }
    assert_eq!(list(root.path()).unwrap().len(), MAX_PACKAGES);
    package(root.path(), "overflow");
    assert_eq!(list(root.path()), Err(PluginError::TooLarge));
}

#[cfg(unix)]
#[test]
fn symlinks_at_every_storage_boundary_and_special_files_are_rejected() {
    use std::os::unix::fs::symlink;
    let outside = tempfile::tempdir().unwrap();
    let external = package(outside.path(), "demo");
    for boundary in [
        ".situate",
        ".situate/plugins",
        ".situate/plugins/demo",
        ".situate/plugins/demo/code",
    ] {
        let root = tempfile::tempdir().unwrap();
        let link = root.path().join(boundary);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(outside.path().join(boundary), &link).unwrap();
        assert_eq!(
            validate(root.path(), "demo"),
            Err(PluginError::InvalidPath),
            "{boundary}"
        );
    }
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    symlink(&external, code.join("nested")).unwrap();
    assert_eq!(
        read(root.path(), "demo", "nested/SKILL.md"),
        Err(PluginError::InvalidPath)
    );
    assert_eq!(files(root.path(), "demo"), Err(PluginError::InvalidPath));
    fs::remove_file(code.join("nested")).unwrap();
    fs::remove_file(code.join("SKILL.md")).unwrap();
    symlink(external.join("SKILL.md"), code.join("SKILL.md")).unwrap();
    assert_eq!(validate(root.path(), "demo"), Err(PluginError::InvalidPath));
    assert_eq!(
        read(root.path(), "demo", "SKILL.md"),
        Err(PluginError::InvalidPath)
    );
    fs::remove_file(code.join("SKILL.md")).unwrap();
    let fifo = std::ffi::CString::new(code.join("SKILL.md").to_str().unwrap()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    assert_eq!(
        read(root.path(), "demo", "SKILL.md"),
        Err(PluginError::InvalidPath)
    );
    assert_eq!(validate(root.path(), "demo"), Err(PluginError::InvalidPath));
    assert_eq!(files(root.path(), "demo"), Err(PluginError::InvalidPath));
}

#[cfg(unix)]
#[test]
fn unreadable_inventory_and_sources_report_errors() {
    use std::os::unix::fs::PermissionsExt;
    if unsafe { libc::geteuid() } == 0 {
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let code = package(root.path(), "demo");
    let skill = code.join("SKILL.md");
    fs::set_permissions(&skill, fs::Permissions::from_mode(0o0)).unwrap();
    assert_eq!(
        read(root.path(), "demo", "SKILL.md"),
        Err(PluginError::ReadFailed)
    );
    assert_eq!(
        list(root.path()).unwrap()[0].error.as_deref(),
        Some("native.plugins.readFailed")
    );
    fs::set_permissions(&skill, fs::Permissions::from_mode(0o600)).unwrap();
    let plugins = root.path().join(".situate/plugins");
    fs::set_permissions(&plugins, fs::Permissions::from_mode(0o0)).unwrap();
    assert_eq!(list(root.path()), Err(PluginError::Unavailable));
    fs::set_permissions(&plugins, fs::Permissions::from_mode(0o700)).unwrap();
}
