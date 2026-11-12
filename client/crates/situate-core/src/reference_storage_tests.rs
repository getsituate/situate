use crate::{
    ai_storage::Storage,
    content::{ContentStore, Draft, revision_for_text},
    conversation_runtime::{ContentReference, Runtime},
    layout_storage::LayoutStorage,
};
use serde_json::{Value, json};
use std::{fs, path::Path};

fn scope(root: &Path) -> String {
    revision_for_text(root.canonicalize().unwrap().to_str().unwrap()).unwrap()
}
fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}
fn runtime(references: &[ContentReference], opaque: &Value) -> Runtime {
    serde_json::from_value(json!({
        "draftReferences":references,
        "pending":[{"id":"pending","kind":"followUp","state":"pending","text":opaque.to_string(),"attachments":[],"references":references,"timestamp":1}],
        "runs":[{"id":"run","state":"completed","startedAt":1,"references":references}],
        "events":[{"id":"event","runId":"run","sequence":1,"type":"custom","data":opaque}]
    })).unwrap()
}
fn layout(references: &[ContentReference], opaque: &Value) -> Value {
    let mut entries: Vec<Value> = references.iter().enumerate().map(|(i, reference)| json!({
        "id":format!("entry-{i}"),"target":{"kind":"view","viewId":"files","contentId":"original.txt"},
        "presentation":{"reference":reference,"text":opaque.to_string()}
    })).collect();
    entries.extend([
        json!({"target":{"kind":"view","viewId":"files"},"presentation":{"reference":null}}),
        json!({"target":{"kind":"view","viewId":"files"},"presentation":{}}),
        json!({"target":{"kind":"view","viewId":"plugin"},"presentation":{"reference":opaque}}),
        json!({"target":{"kind":"conversation","viewId":"files"},"presentation":{"reference":opaque}}),
    ]);
    let tab = json!({"panes":[{"navigation":{"entries":entries,"cursor":0}}]});
    json!({"version":1,"pinnedViews":[],"layout":{"tabs":[tab.clone(),tab.clone()],"activeTabId":null,"closedTabs":[{"tab":tab,"index":0}]}})
}
fn local(reference: &ContentReference) -> Value {
    let mut value = serde_json::to_value(reference).unwrap();
    value.as_object_mut().unwrap().remove("workspaceId");
    value
}

#[test]
fn closed_workspace_copy_and_move_bind_without_rewriting_and_keep_history_and_cas() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().canonicalize().unwrap().join("source");
    fs::create_dir_all(source.join(".situate")).unwrap();
    let source_scope = scope(&source);
    let markdown = format!("{}Original markdown", crate::metadata::new_document());
    fs::write(source.join("original.md"), &markdown).unwrap();
    fs::write(source.join("original.txt"), "Original text").unwrap();
    fs::write(source.join("draft.txt"), "Draft base").unwrap();
    let mut content = ContentStore::open(&source).unwrap();
    let revision = content.record_external_changes().unwrap();
    let references = vec![
        content
            .capture_reference(&source_scope, "original.md", None)
            .unwrap(),
        content
            .capture_reference(&source_scope, "original.txt", None)
            .unwrap(),
        ContentReference::Historical {
            workspace_id: source_scope.clone(),
            path: "original.txt".into(),
            revision,
        },
    ];
    let opaque = json!({"reference":references[0],"workspaceId":source_scope,"text":"original.md"});
    let storage = Storage::open(&source, &source_scope).unwrap();
    let initial = storage.create_conversation("initial", "Unopened").unwrap();
    let mut record = storage.create_conversation("chat", "Saved").unwrap();
    record.draft = opaque.to_string();
    record.runtime = Some(runtime(&references, &opaque));
    let saved = storage.persist_runtime_fixture(&record, 0).unwrap();
    let layout_store = LayoutStorage::open(&source, &source_scope).unwrap();
    let saved_layout = layout_store
        .save(None, layout(&references, &opaque))
        .unwrap();
    let base = content.read_text("draft.txt").unwrap();
    content.move_entry("original.md", "moved.md").unwrap();
    content.move_entry("original.txt", "moved.txt").unwrap();
    fs::write(source.join("original.txt"), "Replacement").unwrap();
    content
        .stage_draft(&Draft {
            path: "draft.txt".into(),
            base: Some(base),
            text: "Unsaved edit".into(),
        })
        .unwrap();
    content.record_external_changes().unwrap();
    let history = content.history().unwrap();
    let drafts = content.drafts().unwrap();
    drop((content, storage, layout_store));
    let files = [
        "conversations/chat/metadata.json",
        "conversations/initial/metadata.json",
        "layout.json",
        "conversations/chat/history.jsonl",
    ];
    let bytes: Vec<_> = files
        .iter()
        .map(|name| fs::read(source.join(".situate").join(name)).unwrap())
        .collect();
    let disk: Value = serde_json::from_slice(&bytes[0]).unwrap();
    let chat_history: Vec<Value> = std::str::from_utf8(&bytes[3])
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    for value in [
        &disk["legacyDraft"]["references"],
        &chat_history[0]["data"]["input"]["references"],
        &chat_history[1]["data"]["references"],
    ] {
        assert_eq!(
            value,
            &json!(references.iter().map(local).collect::<Vec<_>>())
        );
    }
    assert_eq!(chat_history[2]["data"]["data"], opaque);
    let disk_layout: Value = serde_json::from_slice(&bytes[2]).unwrap();
    for path in [
        "/data/layout/tabs/0",
        "/data/layout/tabs/1",
        "/data/layout/closedTabs/0/tab",
    ] {
        let entries = &disk_layout.pointer(path).unwrap()["panes"][0]["navigation"]["entries"];
        for (index, reference) in references.iter().enumerate() {
            assert_eq!(
                entries[index]["presentation"]["reference"],
                local(reference)
            );
        }
        assert!(entries[3]["presentation"]["reference"].is_null());
        assert!(entries[4]["presentation"].get("reference").is_none());
        assert_eq!(entries[5]["presentation"]["reference"], opaque);
        assert_eq!(entries[6]["presentation"]["reference"], opaque);
    }
    let copy = temp.path().canonicalize().unwrap().join("copy");
    copy_tree(&source, &copy);
    let moved = temp.path().canonicalize().unwrap().join("moved");
    fs::rename(&source, &moved).unwrap();
    assert!(copy.join(".situate/history.git").is_dir());
    let mut rebound = Vec::new();
    let mut rebound_layouts = Vec::new();
    for root in [&copy, &moved] {
        let current_scope = scope(root);
        assert_ne!(current_scope, source_scope);
        let storage = Storage::open(root, &current_scope).unwrap();
        let store = LayoutStorage::open(root, &current_scope).unwrap();
        assert_eq!(
            storage.read_conversation("initial").unwrap().unwrap(),
            initial
        );
        assert_eq!(storage.list_conversations().unwrap().len(), 2);
        let loaded = storage.read_conversation("chat").unwrap().unwrap();
        assert_eq!(loaded.revision, saved.revision);
        assert_eq!(loaded.draft, saved.draft);
        let loaded_runtime = loaded.runtime.as_ref().unwrap();
        assert_eq!(loaded_runtime.pending[0].text, opaque.to_string());
        assert_eq!(
            loaded_runtime.events,
            saved.runtime.as_ref().unwrap().events
        );
        let mut content = ContentStore::open(root).unwrap();
        assert_eq!(content.history().unwrap(), history);
        assert_eq!(content.drafts().unwrap(), drafts);
        for refs in [
            &loaded_runtime.draft_references,
            &loaded_runtime.pending[0].references,
            &loaded_runtime.runs[0].references,
        ] {
            for (index, reference) in refs.iter().enumerate() {
                assert_eq!(reference.workspace_id(), current_scope);
                assert_eq!(local(reference), local(&references[index]));
                let (anchor, path, version) =
                    content.resolve_reference(reference).unwrap().unwrap();
                if index != 0 {
                    assert_eq!(anchor, *reference);
                }
                assert_eq!(path, ["moved.md", "moved.txt", "original.txt"][index]);
                assert_eq!(
                    version.text,
                    if index == 0 {
                        &markdown
                    } else {
                        "Original text"
                    }
                );
            }
        }
        let loaded_layout = store.load().unwrap();
        assert_eq!(loaded_layout.revision, saved_layout.revision);
        assert_eq!(
            loaded_layout.data,
            Some(layout(&loaded_runtime.draft_references, &opaque))
        );
        for (name, original) in files.iter().zip(&bytes) {
            assert_eq!(
                fs::read(root.join(".situate").join(name)).unwrap(),
                *original
            );
        }
        assert!(
            storage
                .persist_runtime_fixture(&saved, saved.revision)
                .is_err()
        );
        assert!(
            store
                .save(
                    loaded_layout.revision.as_deref(),
                    saved_layout.data.clone().unwrap()
                )
                .is_err()
        );
        let saved_again = storage
            .persist_runtime_fixture(&loaded, loaded.revision)
            .unwrap();
        assert_eq!(saved_again.revision, loaded.revision + 2);
        let next = store
            .save(
                loaded_layout.revision.as_deref(),
                loaded_layout.data.clone().unwrap(),
            )
            .unwrap();
        assert_ne!(next.revision, loaded_layout.revision);
        rebound_layouts.push(next);
        assert!(
            store
                .save(
                    loaded_layout.revision.as_deref(),
                    loaded_layout.data.unwrap()
                )
                .is_err()
        );
        content.delete_entry("moved.md").unwrap();
        content.delete_entry("moved.txt").unwrap();
        fs::write(
            root.join("moved.md"),
            format!("{}Replacement", crate::metadata::new_document()),
        )
        .unwrap();
        fs::write(root.join("moved.txt"), "Replacement").unwrap();
        for reference in &loaded_runtime.draft_references[..2] {
            assert!(content.resolve_reference(reference).unwrap().is_none());
        }
        assert_eq!(
            content
                .resolve_reference(&loaded_runtime.draft_references[2])
                .unwrap()
                .unwrap()
                .2
                .text,
            "Original text"
        );
        rebound.push(saved_again);
    }
    let copy_storage = Storage::open(&copy, &scope(&copy)).unwrap();
    assert!(
        copy_storage
            .persist_runtime_fixture(&rebound[1], rebound[1].revision)
            .is_err()
    );
    assert_eq!(
        copy_storage.read_conversation("chat").unwrap().unwrap(),
        rebound[0]
    );
    let copy_layout = LayoutStorage::open(&copy, &scope(&copy)).unwrap();
    assert!(
        copy_layout
            .save(
                rebound_layouts[0].revision.as_deref(),
                rebound_layouts[1].data.clone().unwrap()
            )
            .is_err()
    );
    assert_eq!(copy_layout.load().unwrap(), rebound_layouts[0]);
}

#[test]
fn malformed_local_selectors_fail_closed_in_every_known_slot() {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    let root = temp.path().canonicalize().unwrap();
    let storage = Storage::open(&root, "current").unwrap();
    let store = LayoutStorage::open(&root, "current").unwrap();
    let reference: ContentReference = serde_json::from_value(json!({"kind":"live","workspaceId":"current","path":"a.md","anchorRevision":"a".repeat(40)})).unwrap();
    let mut record = storage.create_conversation("chat", "").unwrap();
    record.runtime = Some(runtime(std::slice::from_ref(&reference), &json!({})));
    let record = storage.persist_runtime_fixture(&record, 0).unwrap();
    let snapshot = store
        .save(None, layout(std::slice::from_ref(&reference), &json!({})))
        .unwrap();
    let chat_path = temp
        .path()
        .join(".situate/conversations/chat/metadata.json");
    let history_path = temp
        .path()
        .join(".situate/conversations/chat/history.jsonl");
    let history_bytes = fs::read(&history_path).unwrap();
    let layout_path = temp.path().join(".situate/layout.json");
    let chat_bytes = fs::read(&chat_path).unwrap();
    let layout_bytes = fs::read(&layout_path).unwrap();
    let invalid = [
        json!(null),
        json!({}),
        json!({"kind":"live","path":"a.md","fileId":null}),
        json!({"kind":"live","path":"../a.md","fileId":"00000000-0000-4000-8000-000000000001"}),
        json!({"kind":"live","path":"a.md","fileId":"00000000-0000-4000-8000-000000000001","workspaceId":null}),
        json!({"kind":"live","path":"a.md","fileId":"00000000-0000-4000-8000-000000000001","workspaceId":"current"}),
        json!({"kind":"live","path":"a.md","fileId":"00000000-0000-4000-8000-000000000001","anchorRevision":"a".repeat(40)}),
        json!({"kind":"historical","path":"a.md","revision":"a".repeat(40),"fileId":"00000000-0000-4000-8000-000000000001"}),
        json!({"kind":"historical","path":"a.md","revision":null}),
        json!({"kind":"other","path":"a.md"}),
    ];
    for bad in &invalid {
        let mut value: Value = serde_json::from_slice(&chat_bytes).unwrap();
        value["legacyDraft"]["references"][0] = bad.clone();
        let bytes = serde_json::to_vec(&value).unwrap();
        fs::write(&chat_path, &bytes).unwrap();
        assert!(storage.read_conversation("chat").is_err());
        assert!(storage.list_conversations().is_err());
        assert!(
            storage
                .persist_runtime_fixture(&record, record.revision)
                .is_err()
        );
        assert_eq!(fs::read(&chat_path).unwrap(), bytes);
        fs::write(&chat_path, &chat_bytes).unwrap();
        for pointer in ["/0/data/input/references/0", "/1/data/references/0"] {
            let mut history: Value = Value::Array(
                std::str::from_utf8(&history_bytes)
                    .unwrap()
                    .lines()
                    .map(|line| serde_json::from_str(line).unwrap())
                    .collect(),
            );
            *history.pointer_mut(pointer).unwrap() = bad.clone();
            let mut bytes = Vec::new();
            for entry in history.as_array().unwrap() {
                serde_json::to_writer(&mut bytes, entry).unwrap();
                bytes.push(b'\n');
            }
            fs::write(&history_path, &bytes).unwrap();
            let fresh = Storage::open(&root, "current").unwrap();
            assert!(fresh.read_conversation("chat").is_err());
            assert_eq!(fs::read(&history_path).unwrap(), bytes);
        }
        fs::write(&history_path, &history_bytes).unwrap();
        if bad.is_null() {
            continue;
        }
        for tab in [
            "/data/layout/tabs/0",
            "/data/layout/tabs/1",
            "/data/layout/closedTabs/0/tab",
        ] {
            let mut value: Value = serde_json::from_slice(&layout_bytes).unwrap();
            value.pointer_mut(tab).unwrap()["panes"][0]["navigation"]["entries"][0]["presentation"]
                ["reference"] = bad.clone();
            let bytes = serde_json::to_vec(&value).unwrap();
            fs::write(&layout_path, &bytes).unwrap();
            assert!(store.load().is_err());
            assert!(
                store
                    .save(snapshot.revision.as_deref(), snapshot.data.clone().unwrap())
                    .is_err()
            );
            assert_eq!(fs::read(&layout_path).unwrap(), bytes);
        }
    }
    fs::write(&layout_path, &layout_bytes).unwrap();
    for (pointer, bad) in [
        ("/layout/tabs", json!({})),
        ("/layout/tabs/0", json!(null)),
        ("/layout/tabs/0/panes", json!({})),
        ("/layout/tabs/0/panes/0", json!(null)),
        ("/layout/tabs/0/panes/0/navigation", json!(null)),
        ("/layout/tabs/0/panes/0/navigation/entries", json!(null)),
        ("/layout/closedTabs/0/tab", json!({})),
    ] {
        let mut value = snapshot.data.clone().unwrap();
        *value.pointer_mut(pointer).unwrap() = bad.clone();
        assert!(store.save(snapshot.revision.as_deref(), value).is_err());
        assert_eq!(fs::read(&layout_path).unwrap(), layout_bytes);
        let mut envelope: Value = serde_json::from_slice(&layout_bytes).unwrap();
        *envelope["data"].pointer_mut(pointer).unwrap() = bad;
        let malformed = serde_json::to_vec(&envelope).unwrap();
        fs::write(&layout_path, &malformed).unwrap();
        assert!(store.load().is_err());
        assert!(
            store
                .save(snapshot.revision.as_deref(), snapshot.data.clone().unwrap())
                .is_err()
        );
        assert_eq!(fs::read(&layout_path).unwrap(), malformed);
        fs::write(&layout_path, &layout_bytes).unwrap();
    }
}

#[test]
fn duplicate_owned_fields_are_rejected_without_touching_raw_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    fs::create_dir(root.join(".situate")).unwrap();
    let storage = Storage::open(&root, "current").unwrap();
    let record = storage.create_conversation("chat", "").unwrap();
    let path = root.join(".situate/conversations/chat/metadata.json");
    let prefix = r#"{"version":3,"id":"chat","title":"","revision":0,"selectedEntryId":null"#;
    let local = r#"{"kind":"live","path":"a.txt","anchorRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#;
    let duplicate_references = [
        local.replace(r#""path":"a.txt""#, r#""path":"b.txt","path":"a.txt""#),
        local.replace(
            r#""anchorRevision":""#,
            r#""anchorRevision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","anchorRevision":""#,
        ),
        local.replace(r#""kind":"live""#, r#""kind":"historical","kind":"live""#),
    ];
    let mut records = vec![format!("{prefix},\"revision\":1}}")];
    for reference in &duplicate_references {
        records.push(format!(
            r#"{prefix},"legacyDraft":{{"text":"","attachments":[],"references":[{reference}]}}}}"#
        ));
    }
    for bytes in records {
        fs::write(&path, &bytes).unwrap();
        assert!(storage.read_conversation("chat").is_err(), "{bytes}");
        assert!(storage.list_conversations().is_err());
        assert!(storage.persist_runtime_fixture(&record, 0).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
    }
    let store = LayoutStorage::open(&root, "current").unwrap();
    let path = root.join(".situate/layout.json");
    for reference in duplicate_references {
        let bytes = format!(
            r#"{{"version":1,"generation":"00000000-0000-4000-8000-000000000001","data":{{"version":1,"pinnedViews":[],"layout":{{"tabs":[{{"panes":[{{"navigation":{{"entries":[{{"target":{{"kind":"view","viewId":"files"}},"presentation":{{"reference":{reference}}}}}]}}}}]}}]}}}}}}"#
        );
        fs::write(&path, &bytes).unwrap();
        assert!(store.load().is_err());
        assert!(
            store
                .save(None, json!({"version":1,"pinnedViews":[],"layout":{}}))
                .is_err()
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        let opaque = bytes.replace(r#""viewId":"files""#, r#""viewId":"plugin""#);
        fs::write(&path, &opaque).unwrap();
        assert!(store.load().is_ok());
        assert_eq!(fs::read_to_string(&path).unwrap(), opaque);
    }
}

#[test]
fn recovery_preserves_run_state_and_binding_without_rewriting_history() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    fs::create_dir(root.join(".situate")).unwrap();
    let storage = Storage::open(&root, "current").unwrap();
    let reference = ContentReference::Historical {
        workspace_id: "current".into(),
        path: "a.txt".into(),
        revision: "a".repeat(40),
    };
    let mut record = storage.create_conversation("chat", "").unwrap();
    let mut state = runtime(&[reference], &json!({}));
    state.runs[0].state = "running".into();
    record.runtime = Some(state);
    let saved = storage.persist_runtime_fixture(&record, 0).unwrap();
    let path = root.join(".situate/conversations/chat/history.jsonl");
    let bytes = fs::read(&path).unwrap();
    drop(storage);
    let storage = Storage::open(&root, "reopened").unwrap();
    let loaded = storage.read_conversation("chat").unwrap().unwrap();
    assert_eq!(loaded.revision, saved.revision);
    assert_eq!(loaded.runtime.as_ref().unwrap().runs[0].state, "running");
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let recovered = storage.recover_conversation("chat").unwrap().unwrap();
    assert_eq!(recovered.revision, saved.revision);
    assert_eq!(recovered.runtime.as_ref().unwrap().runs[0].state, "running");
    let history = fs::read_to_string(&path).unwrap();
    let run: Value = serde_json::from_str(history.lines().nth(1).unwrap()).unwrap();
    assert!(run["data"]["references"][0].get("workspaceId").is_none());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(
        storage.recover_conversation("chat").unwrap().unwrap(),
        recovered
    );
}
