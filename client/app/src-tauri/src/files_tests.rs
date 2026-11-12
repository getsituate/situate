use super::*;

#[test]
fn forced_update_retains_pending_edits_until_commit_and_releases_them_on_failure() {
    let session = Arc::new(Session::default());
    session
        .inner
        .lock()
        .unwrap()
        .pending_paths
        .insert("note.md".into());
    assert!(pause_for_quit(&session, "normal", false).is_err());
    assert!(commit_quit(std::slice::from_ref(&session), false).is_err());
    pause_for_quit(&session, "forced", true).unwrap();
    {
        let content = session.inner.lock().unwrap();
        assert!(require_active(&session, &content).is_err());
        assert!(content.pending_paths.contains("note.md"));
    }
    assert!(!session.detached.load(Ordering::Acquire));
    resume_quit(&session, "stale");
    assert_eq!(
        session.inner.lock().unwrap().paused.as_deref(),
        Some("forced")
    );
    resume_quit(&session, "forced");
    {
        let content = session.inner.lock().unwrap();
        assert!(require_active(&session, &content).is_ok());
        assert!(content.pending_paths.contains("note.md"));
    }
    pause_for_quit(&session, "retry", true).unwrap();
    commit_quit(std::slice::from_ref(&session), true).unwrap();
    assert!(session.detached.load(Ordering::Acquire));
}

#[test]
fn native_batch_acknowledgement_contains_compact_anchored_references() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir(temp.path().join(".situate")).unwrap();
    std::fs::write(
        temp.path().join(".situate/batch-notes.jsonl"),
        "{\"path\":\"a.md\",\"text\":\"# Note\"}\n{\"path\":\"b.md\",\"text\":\"# Other\"}",
    )
    .unwrap();
    let mut store = ContentStore::open(temp.path()).unwrap();
    let batch = store
        .create_batch(".situate/batch-notes.jsonl", false, || Ok(()))
        .unwrap();
    let value = create_batch_reply("workspace", batch);
    assert_eq!(value["isError"], false);
    assert_eq!(value["files"].as_array().unwrap().len(), 2);
    assert_eq!(value["references"].as_array().unwrap().len(), 2);
    assert!(value["historyRevision"].as_str().is_some());
    for (file, reference) in value["files"]
        .as_array()
        .unwrap()
        .iter()
        .zip(value["references"].as_array().unwrap())
    {
        assert!(file.get("text").is_none());
        assert!(file.get("after").is_none());
        assert!(file.get("fileId").is_none());
        assert_eq!(reference["kind"], "live");
        assert_eq!(reference["workspaceId"], "workspace");
        assert_eq!(reference["path"], file["path"]);
        assert_eq!(reference["anchorRevision"], value["historyRevision"]);
        assert!(reference.get("fileId").is_none());
        assert!(
            serde_json::from_value::<situate_core::conversation_runtime::ContentReference>(
                reference.clone()
            )
            .unwrap()
            .validate()
        );
    }
}

#[test]
fn native_mixed_batch_renders_imported_images_and_returns_attachment_references() {
    let root = workspace();
    let sources = tempfile::tempdir().unwrap();
    let source = sources.path().canonicalize().unwrap().join("photo.png");
    std::fs::create_dir(root.path().join("assets")).unwrap();
    let image = b"\x89PNG\r\n\x1a\n\0\xffimage";
    std::fs::write(&source, image).unwrap();
    let request = crate::file_tool::parse_native(
        "create_batch",
        json!({
            "entries":[
                {"path":"note.md","text":"![Photo](assets/photo.png)\n"},
                {"path":"assets/photo.png","sourcePath":source}
            ],
            "prepareCopy":true
        }),
    )
    .unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let batch = store
        .create_batch_entries(request.entries.unwrap(), request.prepare_copy, || Ok(()))
        .unwrap();
    assert_eq!(std::fs::read(&source).unwrap(), image);
    assert!(!root.path().join(".situate/import-images").exists());
    assert!(!root.path().join(".situate/batch-images.jsonl").exists());
    let reply = create_batch_reply("workspace", batch);
    assert_eq!(reply["isError"], false);
    let references = reply["references"].as_array().unwrap();
    assert_eq!(references.len(), 2);
    assert_eq!(references[1]["path"], "assets/photo.png");
    let revision = reply["historyRevision"].as_str().unwrap();
    let rendered = historical_document(&store, "note.md", revision).unwrap();
    assert!(
        rendered["document"]["html"]
            .as_str()
            .unwrap()
            .contains(&format!("data:image/png;base64,{}", STANDARD.encode(image)))
    );
    assert_eq!(
        store.read_revision("assets/photo.png", revision).unwrap(),
        image
    );
    assert!(reply.get("image").is_none());
}

#[test]
fn native_batch_partial_failure_keeps_verified_files_without_uncertain_references() {
    let batch = situate_core::content::CreateBatchOutcome {
        outcome: situate_core::content::OperationOutcome::PartialFailure {
            changed_paths: vec!["a.md".into()],
            recovery_revision: "a".repeat(40),
            error: "native.ai.request.cancelled".into(),
        },
        identity_map: Default::default(),
        files: vec![situate_core::content::CreatedFile {
            path: "a.md".into(),
            revision: "b".repeat(40),
        }],
    };
    let value = create_batch_reply("workspace", batch);
    assert_eq!(value["isError"], true);
    assert_eq!(value["files"].as_array().unwrap().len(), 1);
    assert!(value["references"].as_array().unwrap().is_empty());
    assert!(value["historyRevision"].is_null());
    assert!(value["outcome"].get("PartialFailure").is_some());
}

#[test]
fn ordinary_agent_creation_preserves_markdown_metadata_and_nonmarkdown_bytes() {
    for (path, original) in [
        ("Garden.md", "# Garden\n\n- [ ] Ordinary checklist\n"),
        (
            "Garden.md",
            "---\nsituate-id: user-value\ncustom: kept\n---\n# Garden\n",
        ),
        ("export.json", "{\"custom\":\"kept\"}\r\n"),
        ("Task.md", "- [ ] Task <!-- situate-task-id: null -->\n"),
    ] {
        assert_eq!(
            prepare_agent_creation(path, original.into(), false).unwrap(),
            original
        );
    }
}

#[test]
fn prepared_task_copies_preserve_source_content_and_retarget_task_links() {
    let source = "---\nsituate-id: user-value\narchive-code: garden-map-84\nproject: Garden\neditorial:\n  reviewers: [alpha, beta]\n---\n- [-] Cancelled visit\n- [ ] Book the garden visit <!-- {\"situate-task-id\":\"00000000-0000-0000-0000-000000000001\",\"due\":\"2030-04-17\"} -->\n- [x] File the itinerary <!-- {\"situate-task-id\":\"00000000-0000-0000-0000-000000000002\",\"routingCode\":\"hill-west\"} -->\n[task](situate:00000000-0000-0000-0000-000000000001)\n- [ ] Pack a spare pencil\n";
    let text = prepare_agent_creation("copied.md", source.into(), true).unwrap();
    let tasks = metadata::inspect_tasks(&text).unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(!tasks[0].completed);
    assert!(tasks[1].completed);
    assert!(text.contains(&format!("[task](situate:{})", tasks[0].id)));
    assert_ne!(tasks[0].id, tasks[1].id);
    assert!(tasks.iter().all(
        |task| uuid::Uuid::parse_str(&task.id).unwrap().get_version_num() == 4
            && !source.contains(&task.id)
    ));
    assert!(text.starts_with("---\nsituate-id: user-value\narchive-code: garden-map-84\nproject: Garden\neditorial:\n  reviewers: [alpha, beta]\n---\n"));
    assert!(text.contains("- [-] Cancelled visit\n"));
    assert!(text.contains("\"due\":\"2030-04-17\""));
    assert!(text.contains("\"routingCode\":\"hill-west\""));
    assert!(text.ends_with("- [ ] Pack a spare pencil\n"));
    assert!(
        prepare_agent_creation(
            "invalid.md",
            "- [ ] Task <!-- situate-task-id: invalid -->\n".into(),
            true
        )
        .is_err()
    );
    let json = "{\"custom\":\"kept\"}\r\n";
    assert_eq!(
        prepare_agent_creation("export.json", json.into(), true).unwrap(),
        json
    );
}

#[test]
fn prepared_tasks_accept_null_intent_without_model_generated_uuids() {
    let text = prepare_agent_creation(
        "Tasks.md",
        "- [ ] First <!-- situate-task-id: null -->\n- [x] Second <!-- situate-task-id: null -->\n"
            .into(),
        true,
    )
    .unwrap();
    let tasks = metadata::inspect_tasks(&text).unwrap();
    assert_eq!(tasks.len(), 2);
    assert_ne!(tasks[0].id, tasks[1].id);
    assert!(
        tasks
            .iter()
            .all(|task| uuid::Uuid::parse_str(&task.id).unwrap().get_version_num() == 4)
    );
    assert!(!tasks[0].completed);
    assert!(tasks[1].completed);
}

#[test]
fn provider_paths_follow_the_shared_contract() {
    let cases: Value =
        serde_json::from_str(include_str!("../../../contracts/content-paths.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let path = case["path"].as_str().unwrap();
        assert_eq!(
            safe_parts(path).is_ok(),
            case["provider"].as_bool().unwrap(),
            "{path:?}"
        );
    }
}

#[test]
fn shared_file_contracts_round_trip_and_reject_malformed_payloads() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../../contracts/files.json")).unwrap();
    for case in fixtures["valid"].as_array().unwrap() {
        let wire: contracts::WireRequest = serde_json::from_value(case["request"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(wire).unwrap(),
            case["request"],
            "{}",
            case["name"]
        );
        let request: Request = serde_json::from_value(case["request"].clone()).unwrap();
        let reply = replies::Reply::validate(&request.operation, case["reply"].clone())
            .unwrap_or_else(|error| panic!("{}: {error}", case["name"]));
        assert_eq!(
            serde_json::to_value(reply).unwrap(),
            case["reply"],
            "{}",
            case["name"]
        );
    }
    for case in fixtures["invalidRequests"].as_array().unwrap() {
        let error = serde_json::from_value::<Request>(case["request"].clone()).unwrap_err();
        assert_eq!(
            error.to_string(),
            "Invalid file request.",
            "{}",
            case["name"]
        );
    }
    for case in fixtures["invalidReplies"].as_array().unwrap() {
        let operation: Operation = serde_json::from_value(case["operation"].clone()).unwrap();
        assert_eq!(
            replies::Reply::validate(&operation, case["reply"].clone()).unwrap_err(),
            "Invalid file response.",
            "{}",
            case["name"]
        );
    }
}

#[test]
fn task_inspection_wire_contract_uses_only_saved_source() {
    let request = json!({"workspaceId":"known", "operation":"inspectTasks", "path":"Tasks.md"});
    let parsed: Request = serde_json::from_value(request.clone()).unwrap();
    assert_eq!(parsed.operation, Operation::InspectTasks);
    let wire: contracts::WireRequest = serde_json::from_value(request.clone()).unwrap();
    assert_eq!(serde_json::to_value(wire).unwrap(), request);
    let source = "- [ ] Plant <!-- situate-task-id: 83901d28-121a-4f08-a0c5-406aad7c7c17 -->\n";
    let reply = json!({"status":"ok", "document":{"path":"Tasks.md", "version":{"text":source,"revision":"saved"}, "html":"", "issues":[]}, "tasks":metadata::inspect_tasks(source).unwrap()});
    let validated = replies::Reply::validate(&Operation::InspectTasks, reply.clone()).unwrap();
    assert_eq!(serde_json::to_value(validated).unwrap(), reply);
    assert!(replies::Reply::validate(&Operation::Read, reply.clone()).is_err());
    let mut malformed = reply;
    malformed["tasks"][0]["checkboxOffset"] = json!(-1);
    assert!(replies::Reply::validate(&Operation::InspectTasks, malformed).is_err());
    for field in ["text", "base", "expectedRevision"] {
        let mut invalid = request.clone();
        invalid[field] = json!("unsaved");
        assert!(serde_json::from_value::<Request>(invalid).is_err());
    }
}

#[test]
fn task_checkbox_edit_uses_core_history_and_retains_concurrent_unrelated_content() {
    let root = workspace();
    let source = "---\ncustom: {kept: [one, two]}\n---\n# Garden\n\n- [ ] Plant <!-- situate-task-id: 83901d28-121a-4f08-a0c5-406aad7c7c17 -->\n\nFooter\n";
    std::fs::write(root.path().join("Tasks.md"), source).unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let base = store.read_text("Tasks.md").unwrap();
    let task = metadata::inspect_tasks(&base.text).unwrap().remove(0);
    let mut utf16: Vec<u16> = base.text.encode_utf16().collect();
    utf16[task.checkbox_offset] = u16::from(b'x');
    let completed = String::from_utf16(&utf16).unwrap();
    std::fs::write(
        root.path().join("Tasks.md"),
        source.replace("Footer", "Updated footer"),
    )
    .unwrap();
    assert!(matches!(
        store.save("Tasks.md", &base, &completed).unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert_eq!(
        store.read_text("Tasks.md").unwrap().text,
        completed.replace("Footer", "Updated footer")
    );
    assert!(store.history().unwrap().len() >= 3);
}

#[test]
fn reference_rendering_is_explicit_and_requires_a_boolean() {
    let reference = json!({"kind":"live", "workspaceId":"known", "path":"note.md", "anchorRevision":"a".repeat(40)});
    for render in [None, Some(false), Some(true)] {
        let mut value =
            json!({"workspaceId":"known", "operation":"resolveReference", "reference":reference});
        if let Some(render) = render {
            value["render"] = json!(render);
        }
        let request: Request = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(request.render, render.unwrap_or(false));
        let wire: contracts::WireRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(wire).unwrap(), value);
    }
    for render in [Value::Null, json!("true"), json!(1), json!({})] {
        assert!(serde_json::from_value::<Request>(json!({"workspaceId":"known", "operation":"resolveReference", "reference":reference, "render":render})).is_err());
    }
    assert!(serde_json::from_value::<Request>(json!({"workspaceId":"known", "operation":"captureReference", "path":"note.md", "render":true})).is_err());
}

#[test]
fn reference_requests_and_replies_keep_workspace_and_identity_boundaries() {
    let reference = json!({"kind":"live", "workspaceId":"known", "path":"note.md", "anchorRevision":"a".repeat(40)});
    for value in [
        json!({"workspaceId":"known", "operation":"captureReference", "path":"note.md", "expectedRevision":"a".repeat(40)}),
        json!({"workspaceId":"known", "operation":"resolveReference", "reference":reference}),
    ] {
        let request: Request = serde_json::from_value(value.clone()).unwrap();
        assert!(matches!(
            request.operation,
            Operation::CaptureReference | Operation::ResolveReference
        ));
        let wire: contracts::WireRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(wire).unwrap(), value);
    }
    for value in [
        json!({"workspaceId":"other", "operation":"resolveReference", "reference":reference}),
        json!({"workspaceId":"known", "operation":"resolveReference", "reference":reference, "root":"/tmp"}),
        json!({"workspaceId":"known", "operation":"captureReference", "path":"note.md", "expectedRevision":"HEAD"}),
        json!({"workspaceId":"known", "operation":"resolveReference", "reference":{"kind":"live", "workspaceId":"known", "path":"a.txt", "anchorRevision":"HEAD"}}),
    ] {
        assert!(serde_json::from_value::<Request>(value).is_err());
    }
    let path_reference = json!({"kind":"live", "workspaceId":"known", "path":"source.txt", "anchorRevision":"b".repeat(40)});
    let path_request =
        json!({"workspaceId":"known", "operation":"resolveReference", "reference":path_reference});
    let wire: contracts::WireRequest = serde_json::from_value(path_request.clone()).unwrap();
    assert_eq!(serde_json::to_value(wire).unwrap(), path_request);
    let _: Request = serde_json::from_value(path_request).unwrap();
    let path_capture = json!({"status":"ok", "reference":path_reference});
    assert_eq!(
        serde_json::to_value(
            replies::Reply::validate(&Operation::CaptureReference, path_capture.clone()).unwrap()
        )
        .unwrap(),
        path_capture
    );
    for mutation in [
        json!({}),
        json!({"anchorRevision":null}),
        json!({"anchorRevision":0}),
        json!({"anchorRevision":"a".repeat(39)}),
        json!({"anchorRevision":"A".repeat(40)}),
        json!({"anchorRevision":"g".repeat(40)}),
        json!({"anchorRevision":"a".repeat(41)}),
        json!({"pathEpoch":0,"pathJournalId":"00000000-0000-4000-8000-000000000002"}),
        json!({"fileId":"00000000-0000-4000-8000-000000000001","anchorRevision":"a".repeat(40)}),
    ] {
        let mut invalid = json!({"kind":"live", "workspaceId":"known", "path":"source.txt"});
        invalid
            .as_object_mut()
            .unwrap()
            .extend(mutation.as_object().unwrap().clone());
        assert!(
            serde_json::from_value::<Request>(json!({
                "workspaceId":"known", "operation":"resolveReference", "reference":invalid
            }))
            .is_err()
        );
        for operation in [Operation::CaptureReference, Operation::ResolveReference] {
            let mut reply = json!({"status":"ok", "reference":invalid});
            if matches!(operation, Operation::ResolveReference) {
                reply["document"] = json!({"path":"source.txt", "version":{"text":"body", "revision":"c".repeat(40)}, "html":"<p>body</p>", "issues":[]});
            }
            assert!(replies::Reply::validate(&operation, reply).is_err());
        }
    }
    let captured = json!({"status":"ok", "reference":reference});
    assert_eq!(
        serde_json::to_value(
            replies::Reply::validate(&Operation::CaptureReference, captured.clone()).unwrap()
        )
        .unwrap(),
        captured
    );
    let resolved = json!({"status":"ok", "reference":reference, "document":{"path":"moved.md", "version":{"text":"body", "revision":"a".repeat(40)}, "html":"<p>body</p>", "issues":[]}});
    assert_eq!(
        serde_json::to_value(
            replies::Reply::validate(&Operation::ResolveReference, resolved.clone()).unwrap()
        )
        .unwrap(),
        resolved
    );
    assert!(
        replies::Reply::validate(&Operation::ResolveReference, json!({"status":"deleted"})).is_ok()
    );
    assert!(replies::Reply::validate(&Operation::CaptureReference, json!({"status":"ok", "reference":{"kind":"live", "workspaceId":"known", "path":"a.txt"}})).is_err());
}

#[test]
fn shared_plugin_explorer_is_code_only_readonly_and_recovery_independent() {
    let root = workspace();
    let code = root.path().join(".situate/plugins/sample/code");
    std::fs::create_dir_all(code.join("notes")).unwrap();
    std::fs::write(code.join("entry.js"), "const value = 1;").unwrap();
    std::fs::write(code.join("README.md"), "# Guide\n![Image](image.png)").unwrap();
    std::fs::write(code.join("image.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    std::fs::write(code.join("notes/data.json"), "{\"value\":1}").unwrap();
    std::fs::write(
        root.path().join(".situate/plugins/sample/config.json"),
        "private",
    )
    .unwrap();
    std::fs::create_dir_all(root.path().join(".situate/drafts")).unwrap();
    std::fs::write(
        root.path().join(".situate/drafts/unsupported.json"),
        "invalid recovery",
    )
    .unwrap();
    let owner = ContentStore::open(root.path()).unwrap();
    assert!(owner.drafts().is_err());

    let request = |operation: &str, fields: Value| {
        let mut value =
            json!({"workspaceId":"workspace","operation":operation,"pluginId":"sample"});
        value
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        serde_json::from_value::<Request>(value).unwrap()
    };
    let never_open =
        |_: &str| -> Result<(), String> { panic!("text reads must not open applications") };
    let snapshot = plugin_request(
        root.path(),
        "sample",
        &request("snapshot", json!({})),
        never_open,
    )
    .unwrap();
    assert_eq!(snapshot["snapshot"]["writable"], false);
    assert_eq!(snapshot["snapshot"]["reason"], Value::Null);
    assert_eq!(snapshot["snapshot"]["drafts"], json!([]));
    assert!(
        snapshot["snapshot"]["entries"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["path"] != "config.json")
    );
    let read = plugin_request(
        root.path(),
        "sample",
        &request("read", json!({"path":"entry.js","text":"preview"})),
        never_open,
    )
    .unwrap();
    assert_eq!(read["document"]["version"]["text"], "const value = 1;");
    assert_eq!(read["document"]["html"], "");
    assert_eq!(read["document"]["issues"], json!([]));
    let markdown = plugin_document(root.path(), "sample", "README.md", None).unwrap();
    assert!(
        markdown["document"]["html"]
            .as_str()
            .unwrap()
            .contains("<h1 data-source-offset=\"0\">Guide</h1>")
    );
    assert!(
        markdown["document"]["html"]
            .as_str()
            .unwrap()
            .contains("data:image/png;base64,")
    );
    let link = plugin_request(
        root.path(),
        "sample",
        &request(
            "openExternal",
            json!({"href":"notes/data.json","destination":"README.md"}),
        ),
        never_open,
    )
    .unwrap();
    assert_eq!(link["document"]["path"], "notes/data.json");
    assert_eq!(link["document"]["html"], "");
    assert_eq!(
        plugin_document(root.path(), "sample", "image.png", None).unwrap(),
        json!({"status":"binary"})
    );
    let opened = std::cell::RefCell::new(Vec::new());
    plugin_request(
        root.path(),
        "sample",
        &request("openExternal", json!({"path":"image.png"})),
        |path| {
            opened.borrow_mut().push(path.to_owned());
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        *opened.borrow(),
        vec![code.join("image.png").to_str().unwrap().to_owned()]
    );
    for path in [
        "../config.json",
        "/entry.js",
        ".git/config",
        "notes/../../config.json",
    ] {
        assert!(
            plugin_document(root.path(), "sample", path, None).is_err(),
            "{path}"
        );
    }
    for operation in [
        "stage",
        "save",
        "delete",
        "history",
        "captureReference",
        "resource",
        "detach",
    ] {
        let value = json!({"workspaceId":"workspace","operation":operation,"pluginId":"sample","path":"entry.js"});
        assert!(
            serde_json::from_value::<Request>(value).is_err(),
            "{operation}"
        );
    }
    assert_eq!(
        std::fs::read_to_string(code.join("entry.js")).unwrap(),
        "const value = 1;"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join(".situate/drafts/unsupported.json")).unwrap(),
        "invalid recovery"
    );
}

#[test]
fn external_opener_rechecks_content_and_rejects_code() {
    assert!(require_external_binary("note.md", b"# Text").is_err());
    assert!(require_external_binary("photo.png", b"caf\xe9").is_err());
    assert!(require_external_binary("photo.png", b"\xff\xfeh\0").is_err());
    assert!(require_external_binary("script.command", b"hello\0").is_err());
    assert!(require_external_binary("image.png", b"\xcf\xfa\xed\xfe\0").is_err());
    assert!(require_external_binary("report.md", b"%PDF-1.7").is_ok());
    assert!(require_external_binary("image.png", b"\x89PNG\r\n\x1a\n").is_ok());
}

#[cfg(unix)]
#[test]
fn shared_plugin_explorer_rejects_symlink_escapes() {
    use std::os::unix::fs::symlink;
    let root = workspace();
    let code = root.path().join(".situate/plugins/sample/code");
    std::fs::create_dir_all(&code).unwrap();
    std::fs::write(root.path().join("private.txt"), "private").unwrap();
    symlink(root.path().join("private.txt"), code.join("escape.txt")).unwrap();
    assert!(plugin_document(root.path(), "sample", "escape.txt", None).is_err());
    symlink(root.path(), code.join("outside")).unwrap();
    assert!(plugin_document(root.path(), "sample", "outside/private.txt", None).is_err());
}

fn workspace() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".situate")).unwrap();
    root
}

#[test]
fn requests_reject_caller_roots_unknown_operations_and_invalid_choices() {
    for value in [
        json!({"workspaceId":"known","operation":"snapshot","root":"/tmp"}),
        json!({"workspaceId":"known","operation":"execute"}),
        json!({"workspaceId":"known","operation":"resolve","choice":"anything"}),
    ] {
        assert!(serde_json::from_value::<Request>(value).is_err());
    }
}

#[test]
fn resource_paths_cannot_escape_or_enter_technical_directories() {
    assert_eq!(
        relative_resource("notes/a.md", "images/photo.png").unwrap(),
        "notes/images/photo.png"
    );
    assert_eq!(
        relative_resource("notes/a.md", "/images/photo.png").unwrap(),
        "images/photo.png"
    );
    assert_eq!(
        relative_resource("notes/a.md", "../shared.png").unwrap(),
        "shared.png"
    );
    assert_eq!(
        relative_resource("notes/a.md", "./sibling.png").unwrap(),
        "notes/sibling.png"
    );
    assert_eq!(
        relative_resource("notes/a.md", "../image%23one%3F.png?size=2#view").unwrap(),
        "image#one?.png"
    );
    for target in [
        "../../secret",
        "%2e%2e/%2e%2e/secret",
        ".situate/history.git",
        "C:/secret",
        "file:///tmp/a",
        "\\secret",
        "%00.png",
        "images//photo.png",
    ] {
        assert!(relative_resource("notes/a.md", target).is_err(), "{target}");
    }
    assert!(remote_url("https://example.test/image.png").is_ok());
    for target in [
        "javascript:alert(1)",
        "data:text/html,hello",
        "file:///secret",
        "https://user:password@example.test/",
    ] {
        assert!(remote_url(target).is_err());
    }
}

#[test]
fn local_resources_reject_symlink_escapes_and_special_files() {
    let root = workspace();
    std::fs::create_dir(root.path().join("images")).unwrap();
    std::fs::write(root.path().join("images/a.png"), b"content").unwrap();
    assert_eq!(read_local(root.path(), "images/a.png").unwrap(), b"content");
    assert!(read_local(root.path(), "images").is_err());
    #[cfg(unix)]
    {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("private"), b"secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("private"), root.path().join("link"))
            .unwrap();
        let encoded = relative_resource("notes/a.md", "../escape/%70rivate").unwrap();
        assert!(read_local(root.path(), &encoded).is_err());
        assert!(read_local(root.path(), "escape/private").is_err());
        assert!(read_local(root.path(), "link").is_err());
    }
}

#[test]
fn detach_rejects_retained_drafts_then_releases_exclusive_store_ownership() {
    let root = workspace();
    let session = Session::default();
    let mut content = session.inner.lock().unwrap();
    content.root = Some(root.path().to_owned());
    content.store = Some(ContentStore::open(root.path()).unwrap());
    content
        .store
        .as_mut()
        .unwrap()
        .stage_draft(&Draft {
            path: "a.md".into(),
            base: None,
            text: "retained".into(),
        })
        .unwrap();
    content.pending_paths.insert("a.md".into());
    assert!(detach(&session, &mut content).is_err());
    assert!(!session.detached.load(Ordering::Acquire));
    assert!(ContentStore::open(root.path()).is_err());
    content
        .store
        .as_mut()
        .unwrap()
        .discard_draft("a.md")
        .unwrap();
    content.pending_paths.remove("a.md");
    detach(&session, &mut content).unwrap();
    assert!(ContentStore::open(root.path()).is_ok());
    assert!(require_active(&session, &content).is_err());
}

#[test]
fn failed_open_and_untouched_unsupported_recovery_records_do_not_trap_viewers() {
    let root = workspace();
    let mut owner = ContentStore::open(root.path()).unwrap();
    owner
        .stage_draft(&Draft {
            path: "other.md".into(),
            base: None,
            text: "other session".into(),
        })
        .unwrap();
    assert!(ContentStore::open(root.path()).is_err());
    let viewer = Session::default();
    let mut content = viewer.inner.lock().unwrap();
    content.root = Some(root.path().to_owned());
    detach(&viewer, &mut content).unwrap();
    assert_eq!(owner.drafts().unwrap()[0].text, "other session");
    drop(owner);
    std::fs::write(
        root.path().join(".situate/drafts/unsupported.json"),
        b"not a recovery record",
    )
    .unwrap();
    let viewer = Session::default();
    let mut content = viewer.inner.lock().unwrap();
    content.root = Some(root.path().to_owned());
    content.store = Some(ContentStore::open(root.path()).unwrap());
    assert!(content.store.as_ref().unwrap().drafts().is_err());
    detach(&viewer, &mut content).unwrap();
    assert_eq!(
        std::fs::read(root.path().join(".situate/drafts/unsupported.json")).unwrap(),
        b"not a recovery record"
    );
}

#[test]
fn queued_old_authorization_stays_closed_after_reopening_same_workspace() {
    let old = Arc::new(Session::default());
    let queued = old.clone();
    detach(&old, &mut old.inner.lock().unwrap()).unwrap();
    let reopened = Arc::new(Session::default());
    assert!(require_active(&queued, &queued.inner.lock().unwrap()).is_err());
    assert!(require_active(&reopened, &reopened.inner.lock().unwrap()).is_ok());
}

#[test]
fn recorded_text_reads_reuse_owned_history_and_do_not_observe_external_edits() {
    let root = workspace();
    std::fs::write(root.path().join("note.txt"), "before").unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let before = store.history().unwrap()[0].revision.clone();
    std::fs::write(root.path().join("note.txt"), "after").unwrap();
    let after = store.record_external_changes().unwrap();
    let session = Session::default();
    session.inner.lock().unwrap().store = Some(store);
    assert!(
        ContentStore::open_existing_history(root.path(), &root.path().join(".situate")).is_err()
    );
    assert_eq!(
        recorded_revision(root.path(), &session, "note.txt", &before).unwrap(),
        b"before"
    );
    let changes = recorded_changes_between(root.path(), &session, &before, &after).unwrap();
    assert_eq!(
        changes,
        vec![situate_core::content::RevisionChange {
            path: "note.txt".into(),
            status: situate_core::content::RevisionChangeStatus::Modified
        }]
    );
    session.inner.lock().unwrap().store.take();
    std::fs::write(root.path().join("note.txt"), "unrecorded").unwrap();
    assert_eq!(
        recorded_revision(root.path(), &session, "note.txt", &after).unwrap(),
        b"after"
    );
    let history =
        ContentStore::open_existing_history(root.path(), &root.path().join(".situate")).unwrap();
    assert_eq!(history.history().unwrap()[0].revision, after);
}

#[test]
fn historical_images_use_the_selected_revision_and_historical_parent() {
    let root = workspace();
    std::fs::create_dir(root.path().join("old")).unwrap();
    let old_image = b"\x89PNG\r\n\x1a\nold-image";
    std::fs::write(root.path().join("old/image.png"), old_image).unwrap();
    std::fs::write(root.path().join("old/note.md"), "![Old image](image.png)\n").unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    let revision = store.history().unwrap()[0].revision.clone();
    std::fs::write(
        root.path().join("old/image.png"),
        b"\x89PNG\r\n\x1a\nnew-image",
    )
    .unwrap();
    store.record_external_changes().unwrap();
    let reply = historical_document(&store, "old/note.md", &revision).unwrap();
    assert!(
        reply["document"]["html"]
            .as_str()
            .unwrap()
            .contains(&STANDARD.encode(old_image))
    );
    assert!(
        !reply["document"]["html"]
            .as_str()
            .unwrap()
            .contains(&STANDARD.encode(b"\x89PNG\r\n\x1a\nnew-image"))
    );
    assert_eq!(
        historical_document(&store, "absent.md", &revision).unwrap()["status"],
        "deleted"
    );
}

#[cfg(desktop)]
#[test]
fn export_creates_a_new_copy_and_rejects_existing_or_workspace_destinations() {
    let root = workspace();
    let outside = tempfile::tempdir().unwrap();
    let destination = outside.path().join("recovered.md");
    persist_export(&destination, &[root.path().to_owned()], "retained text").unwrap();
    assert_eq!(
        std::fs::read_to_string(&destination).unwrap(),
        "retained text"
    );
    assert!(persist_export(&destination, &[], "replacement").is_err());
    assert_eq!(
        std::fs::read_to_string(&destination).unwrap(),
        "retained text"
    );
    assert!(
        persist_export(
            &root.path().join("bypass.md"),
            &[root.path().to_owned()],
            "unversioned"
        )
        .is_err()
    );
    assert!(!root.path().join("bypass.md").exists());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.path(), outside.path().join("workspace-link")).unwrap();
        assert!(
            persist_export(
                &outside.path().join("workspace-link/bypass.md"),
                &[root.path().to_owned()],
                "unversioned"
            )
            .is_err()
        );
    }
}

#[test]
fn prepared_close_keeps_store_and_registry_failure_can_resume_saving() {
    let root = workspace();
    let session = Session::default();
    let mut content = session.inner.lock().unwrap();
    content.store = Some(ContentStore::open(root.path()).unwrap());
    content
        .store
        .as_mut()
        .unwrap()
        .create_text("note.md", "before")
        .unwrap();
    prepare_close(&session, &content, false).unwrap();
    assert!(require_active(&session, &content).is_err());
    assert!(ContentStore::open(root.path()).is_err());
    assert!(!session.detached.load(Ordering::Acquire));
    resume_close(&session);
    require_active(&session, &content).unwrap();
    let store = content.store.as_mut().unwrap();
    let base = store.read_text("note.md").unwrap();
    assert!(matches!(
        store.save("note.md", &base, "after").unwrap(),
        SaveOutcome::Saved { .. }
    ));
    assert_eq!(
        std::fs::read_to_string(root.path().join("note.md")).unwrap(),
        "after"
    );
    prepare_close(&session, &content, false).unwrap();
    drop(content);
    complete_close(&session);
    assert!(ContentStore::open(root.path()).is_ok());
}

#[test]
fn forced_close_preserves_recovery_drafts_history_and_pending_writes_on_cancellation() {
    let root = workspace();
    let session = Session::default();
    let mut content = session.inner.lock().unwrap();
    let mut store = ContentStore::open(root.path()).unwrap();
    store
        .stage_draft(&Draft {
            path: "note.md".into(),
            base: None,
            text: "retained recovery text".into(),
        })
        .unwrap();
    content.store = Some(store);
    content.pending_paths.insert("note.md".into());
    let history = root.path().join(".situate/history.git/HEAD");
    let unreadable = b"unsupported history metadata\n";
    std::fs::write(&history, unreadable).unwrap();
    assert!(content.store.as_ref().unwrap().deleted_files().is_err());
    assert_eq!(
        prepare_close(&session, &content, false).unwrap_err(),
        "native.files.draft.remain"
    );
    prepare_close(&session, &content, true).unwrap();
    assert!(session.close_ready.load(Ordering::Acquire));
    assert!(!session.detached.load(Ordering::Acquire));
    assert!(content.pending_paths.contains("note.md"));
    resume_close(&session);
    require_active(&session, &content).unwrap();
    assert!(prepare_close(&session, &content, false).is_err());
    prepare_close(&session, &content, true).unwrap();
    drop(content);
    complete_close(&session);
    assert!(session.detached.load(Ordering::Acquire));
    let drafts = situate_core::content::read_recovery_drafts(root.path()).unwrap();
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].text, "retained recovery text");
    assert_eq!(std::fs::read(&history).unwrap(), unreadable);
}

#[test]
fn failed_quit_participant_unpauses_acknowledged_peers_and_clears_only_matching_attempt() {
    let first = Arc::new(Session::default());
    let second = Arc::new(Session::default());
    second
        .inner
        .lock()
        .unwrap()
        .pending_paths
        .insert("unsaved.md".into());
    let mut pending = Some(crate::lifecycle::QuitAttempt {
        token: "current".into(),
        participants: HashMap::from([
            ("first".into(), vec![first.clone()]),
            ("second".into(), vec![second.clone()]),
        ]),
        ready: HashSet::new(),
    });
    assert_eq!(
        crate::lifecycle::acknowledge_quit(&mut pending, "first", "current").unwrap(),
        crate::lifecycle::QuitOutcome::AwaitingWindows
    );
    assert!(require_active(&first, &first.inner.lock().unwrap()).is_err());
    assert!(crate::lifecycle::acknowledge_quit(&mut pending, "second", "old-attempt").is_err());
    assert!(pending.is_some());
    assert!(crate::lifecycle::acknowledge_quit(&mut pending, "second", "current").is_err());
    assert!(pending.is_none());
    require_active(&first, &first.inner.lock().unwrap()).unwrap();
    require_active(&second, &second.inner.lock().unwrap()).unwrap();
    assert!(
        second
            .inner
            .lock()
            .unwrap()
            .pending_paths
            .contains("unsaved.md")
    );
    assert!(!first.detached.load(Ordering::Acquire));
}

#[test]
fn file_close_waits_for_an_admitted_write_while_another_workspace_can_save() {
    let first_root = workspace();
    let second_root = workspace();
    let first = Arc::new(Session::default());
    first.inner.lock().unwrap().store = Some(ContentStore::open(first_root.path()).unwrap());
    let second = Session::default();
    second.inner.lock().unwrap().store = Some(ContentStore::open(second_root.path()).unwrap());
    let (admitted, admission) = std::sync::mpsc::channel();
    let (release, resume) = std::sync::mpsc::channel();
    let writing = first.clone();
    let writer = std::thread::spawn(move || {
        let mut content = writing.inner.lock().unwrap();
        require_active(&writing, &content).unwrap();
        admitted.send(()).unwrap();
        resume.recv().unwrap();
        content
            .store
            .as_mut()
            .unwrap()
            .create_text("first.md", "first saved")
            .unwrap();
    });
    admission
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let closing = first.clone();
    let (started, start) = std::sync::mpsc::channel();
    let closer = std::thread::spawn(move || {
        started.send(()).unwrap();
        complete_close(&closing);
    });
    start
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    second
        .inner
        .lock()
        .unwrap()
        .store
        .as_mut()
        .unwrap()
        .create_text("second.md", "second saved")
        .unwrap();
    assert!(!first.detached.load(Ordering::Acquire));
    assert_eq!(
        std::fs::read_to_string(second_root.path().join("second.md")).unwrap(),
        "second saved"
    );
    release.send(()).unwrap();
    writer.join().unwrap();
    closer.join().unwrap();
    assert!(first.detached.load(Ordering::Acquire));
    assert_eq!(
        std::fs::read_to_string(first_root.path().join("first.md")).unwrap(),
        "first saved"
    );
    assert!(ContentStore::open(first_root.path()).is_ok());
    require_active(&second, &second.inner.lock().unwrap()).unwrap();
}

#[test]
fn exact_tree_paths_and_raw_document_hrefs_are_unambiguous_and_decoded_once() {
    for path in [
        "notes/literal#?.md",
        "notes/percent%25.md",
        "notes/%2e%2e.md",
    ] {
        assert_eq!(open_target(Some(path), None, None).unwrap(), path);
    }
    assert_eq!(
        open_target(
            None,
            Some("../literal%23%3F.md#anchor"),
            Some("notes/source.md")
        )
        .unwrap(),
        "literal#?.md"
    );
    assert_eq!(
        open_target(None, Some("percent%2525.md"), Some("notes/source.md")).unwrap(),
        "notes/percent%25.md"
    );
    assert!(
        open_target(
            Some("notes/file.md"),
            Some("other.md"),
            Some("notes/source.md")
        )
        .is_err()
    );
    assert!(open_target(Some("notes/file.md"), None, Some("notes/source.md")).is_err());
    assert!(open_target(None, Some("other.md"), None).is_err());
    assert!(open_target(None, Some("../../outside.md"), Some("notes/source.md")).is_err());
}

#[test]
fn stale_quit_acknowledgments_cannot_approve_another_attempt_or_window() {
    let mut attempt = crate::lifecycle::QuitAttempt {
        token: "new-attempt".into(),
        participants: HashMap::from([
            ("first".into(), vec![Arc::new(Session::default())]),
            ("second".into(), vec![Arc::new(Session::default())]),
        ]),
        ready: HashSet::new(),
    };
    assert!(attempt.require("first", "cancelled-attempt").is_err());
    assert!(attempt.require("main", "new-attempt").is_err());
    attempt.require("first", "new-attempt").unwrap();
    attempt.ready.insert("first".into());
    assert_ne!(attempt.ready.len(), attempt.participants.len());
    attempt.require("second", "new-attempt").unwrap();
    attempt.ready.insert("second".into());
    assert_eq!(attempt.ready.len(), attempt.participants.len());
}

#[cfg(target_os = "macos")]
fn process_command(root: &Path, script: &str) -> crate::shell_host::CommandRequest {
    crate::shell_host::CommandRequest {
        cwd: root.to_owned(),
        executable: "/bin/sh".into(),
        args: vec!["-c".into(), script.into()],
        timeout_ms: 30_000,
        output_limit_bytes: 32_768,
    }
}

#[cfg(target_os = "macos")]
#[test]
fn process_boundary_blocks_pending_drafted_and_cancelled_work_before_spawn() {
    let root = workspace();
    let mut content = ContentSession {
        store: Some(ContentStore::open(root.path()).unwrap()),
        ..Default::default()
    };
    let command = || process_command(root.path(), "printf spawned > spawned.txt");
    content.pending_paths.insert("note.md".into());
    assert_eq!(
        execute_process(
            &mut content,
            command(),
            tokio_util::sync::CancellationToken::new()
        )
        .unwrap_err(),
        "native.content.store.busy"
    );
    content.pending_paths.clear();
    content
        .store
        .as_mut()
        .unwrap()
        .stage_draft(&Draft {
            path: "note.md".into(),
            base: None,
            text: "retained".into(),
        })
        .unwrap();
    assert_eq!(
        execute_process(
            &mut content,
            command(),
            tokio_util::sync::CancellationToken::new()
        )
        .unwrap_err(),
        "native.content.store.busy"
    );
    assert!(!root.path().join("spawned.txt").exists());
    assert_eq!(
        content.store.as_ref().unwrap().drafts().unwrap()[0].text,
        "retained"
    );
    content
        .store
        .as_mut()
        .unwrap()
        .discard_draft("note.md")
        .unwrap();
    let token = tokio_util::sync::CancellationToken::new();
    token.cancel();
    assert!(execute_process(&mut content, command(), token).is_err());
    assert!(!root.path().join("spawned.txt").exists());
}

#[cfg(target_os = "macos")]
#[test]
fn process_boundary_records_before_and_after_even_for_nonzero_exit_and_spawn_error() {
    let root = workspace();
    let mut content = ContentSession {
        store: Some(ContentStore::open(root.path()).unwrap()),
        ..Default::default()
    };
    std::fs::write(root.path().join("note.md"), "external before").unwrap();
    let reply = execute_process(
        &mut content,
        process_command(
            root.path(),
            "printf 'process after' > note.md; printf out; printf err >&2; exit 7",
        ),
        tokio_util::sync::CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(reply["isError"], true);
    assert_eq!(reply["commandResult"]["Ok"]["exitCode"], 7);
    assert_eq!(reply["commandResult"]["Ok"]["stdout"]["text"], "out");
    assert_eq!(reply["commandResult"]["Ok"]["stderr"]["text"], "err");
    let before = reply["beforeHistoryRevision"].as_str().unwrap();
    let after = reply["afterHistoryRevision"].as_str().unwrap();
    assert_ne!(before, after);
    let store = content.store.as_ref().unwrap();
    assert_eq!(
        store.read_revision("note.md", before).unwrap(),
        b"external before"
    );
    assert_eq!(
        store.read_revision("note.md", after).unwrap(),
        b"process after"
    );
    let mut command = process_command(root.path(), "");
    command.executable = root.path().join("missing-executable");
    let reply = execute_process(
        &mut content,
        command,
        tokio_util::sync::CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(reply["commandResult"]["Err"], "spawnFailed");
    assert_eq!(
        reply["beforeHistoryRevision"],
        reply["afterHistoryRevision"]
    );
    assert!(reply["reconciliationError"].is_null());
}

#[cfg(target_os = "macos")]
#[test]
fn process_boundary_uses_verbatim_argv_fixed_cwd_and_bounded_streams() {
    let root = workspace();
    let mut content = ContentSession {
        store: Some(ContentStore::open(root.path()).unwrap()),
        ..Default::default()
    };
    let mut command = process_command(
        root.path(),
        "printf '%s' \"$1\" > verbatim.txt; pwd; head -c 40000 /dev/zero; head -c 40000 /dev/zero >&2",
    );
    command
        .args
        .extend(["test".into(), "a b; $(not-a-command)".into()]);
    let reply = execute_process(
        &mut content,
        command,
        tokio_util::sync::CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.path().join("verbatim.txt")).unwrap(),
        "a b; $(not-a-command)"
    );
    assert_eq!(reply["isError"], false);
    for stream in ["stdout", "stderr"] {
        let output = &reply["commandResult"]["Ok"][stream];
        assert_eq!(output["capturedBytes"], 32_768);
        assert_eq!(output["truncated"], true);
        assert_eq!(output["incomplete"], false);
    }
    let stdout = reply["commandResult"]["Ok"]["stdout"]["text"]
        .as_str()
        .unwrap();
    assert!(stdout.starts_with(root.path().canonicalize().unwrap().to_str().unwrap()));
}

#[cfg(target_os = "macos")]
#[test]
fn cancelled_process_keeps_mutation_window_until_teardown_and_reconciliation_after_ipc_drop() {
    let root = workspace();
    let session = Arc::new(Session::default());
    session.inner.lock().unwrap().store = Some(ContentStore::open(root.path()).unwrap());
    let token = tokio_util::sync::CancellationToken::new();
    let command = process_command(
        root.path(),
        "printf changed > changed.txt; /bin/sleep 30; printf late > late.txt",
    );
    let worker_session = session.clone();
    let worker_token = token.clone();
    let (finished, done) = std::sync::mpsc::channel();
    let frontend_wait = tauri::async_runtime::spawn_blocking(move || {
        let mut content = worker_session.inner.lock().unwrap();
        let reply = execute_process(&mut content, command, worker_token).unwrap();
        finished.send(reply).unwrap();
    });
    drop(frontend_wait);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::fs::read(root.path().join("changed.txt"))
        .ok()
        .as_deref()
        != Some(b"changed")
    {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(session.inner.try_lock().is_err());
    token.cancel();
    let reply = done
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    assert_eq!(reply["commandResult"]["Ok"]["outcome"], "cancelled");
    assert_eq!(reply["isError"], true);
    assert!(!root.path().join("late.txt").exists());
    let content = session.inner.lock().unwrap();
    assert_eq!(
        content
            .store
            .as_ref()
            .unwrap()
            .read_revision(
                "changed.txt",
                reply["afterHistoryRevision"].as_str().unwrap()
            )
            .unwrap(),
        b"changed"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn timed_out_process_still_reconciles_written_files() {
    let root = workspace();
    let mut content = ContentSession {
        store: Some(ContentStore::open(root.path()).unwrap()),
        ..Default::default()
    };
    let mut command = process_command(root.path(), "printf changed > changed.txt; /bin/sleep 30");
    command.timeout_ms = 100;
    let reply = execute_process(
        &mut content,
        command,
        tokio_util::sync::CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(reply["commandResult"]["Ok"]["outcome"], "timedOut");
    assert_eq!(reply["isError"], true);
    assert!(reply["afterHistoryRevision"].is_string());
}
