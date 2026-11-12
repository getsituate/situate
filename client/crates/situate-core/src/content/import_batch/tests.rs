use super::super::history_records::{Envelope, Fact};
use super::*;
use std::fs;

pub(super) fn workspace() -> (tempfile::TempDir, ContentStore) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    fs::create_dir(temp.path().join("Notes")).unwrap();
    let store = ContentStore::open(temp.path()).unwrap();
    (temp, store)
}

fn manifest(root: &Path, entries: &[(&str, &str)]) {
    manifest_rows(
        root,
        &entries
            .iter()
            .map(|(path, text)| serde_json::json!({"path": path, "text": text}))
            .collect::<Vec<_>>(),
    );
}

fn manifest_rows(root: &Path, entries: &[serde_json::Value]) {
    let text = entries
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(root.join(".situate/batch-batch.jsonl"), text).unwrap();
}

fn source(id: &str) -> String {
    format!(
        "---\nsituate-id: {id}\nsource-code: garden-84\n---\n# Garden\n- [ ] Ordinary checklist\n"
    )
}

#[test]
fn manifests_are_revision_checked_internal_staging_not_user_content_or_history() {
    let (temp, mut store) = workspace();
    let before = store.record_external_changes().unwrap();
    let text = "{\"path\":\"Notes/a.md\",\"text\":\"# A\"}";
    let first = store
        .write_batch_manifest(".situate/batch-test.jsonl", None, text)
        .unwrap();
    assert_eq!(
        store
            .read_batch_manifest(".situate/batch-test.jsonl")
            .unwrap(),
        first
    );
    assert!(
        store
            .write_batch_manifest(".situate/batch-test.jsonl", None, "replacement")
            .is_err()
    );
    assert!(
        store
            .write_batch_manifest(
                ".situate/batch-test.jsonl",
                Some(&"0".repeat(40)),
                "replacement"
            )
            .is_err()
    );
    let updated = store
        .write_batch_manifest(".situate/batch-test.jsonl", Some(&first.revision), text)
        .unwrap();
    assert_eq!(updated, first);
    assert_eq!(store.record_external_changes().unwrap(), before);
    assert!(
        !store
            .list()
            .unwrap()
            .iter()
            .any(|entry| entry.path.contains("import-test"))
    );
    for path in [
        "manifest.jsonl",
        "Notes/manifest.jsonl",
        ".situate/batch-../outside.jsonl",
        ".situate/history.git/config",
    ] {
        assert!(
            store.write_batch_manifest(path, None, text).is_err(),
            "{path}"
        );
        assert!(store.create_batch(path, true, || Ok(())).is_err(), "{path}");
    }
    fs::write(temp.path().join("manifest.jsonl"), text).unwrap();
    assert!(
        store
            .create_batch("manifest.jsonl", true, || Ok(()))
            .is_err()
    );
    assert!(!temp.path().join("Notes/a.md").exists());
    let imported = store
        .create_batch(".situate/batch-test.jsonl", true, || Ok(()))
        .unwrap();
    assert_eq!(imported.files.len(), 1);
    assert_eq!(
        fs::read_to_string(temp.path().join("manifest.jsonl")).unwrap(),
        text
    );
    manifest(
        temp.path(),
        &[(".situate/working-method.md", "Unexpected rules")],
    );
    assert!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    assert!(!temp.path().join(".situate/working-method.md").exists());
}

#[test]
fn copies_share_one_completed_history_change_and_retarget_cross_file_links() {
    let (temp, mut store) = workspace();
    let a = "00000000-0000-0000-0000-000000000001";
    let b = "00000000-0000-0000-0000-000000000002";
    let task = "00000000-0000-0000-0000-000000000003";
    let first = format!(
        "{}[Other](situate:{b})\n- [x] Visit <!-- {{\"situate-task-id\":\"{task}\",\"due\":\"2030-04-17\",\"custom\":\"kept\"}} -->\n",
        source(a)
    );
    let second = format!("{}[Task](situate:{task})\n", source(b));
    manifest(
        temp.path(),
        &[("Notes/a.md", &first), ("Notes/b.md", &second)],
    );
    let original_manifest = fs::read(temp.path().join(".situate/batch-batch.jsonl")).unwrap();
    let outcome = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    assert!(matches!(outcome.outcome, OperationOutcome::Complete { .. }));
    assert_eq!(outcome.files.len(), 2);
    let created = store.read_text("Notes/a.md").unwrap();
    let other = store.read_text("Notes/b.md").unwrap();
    let new_task = crate::metadata::inspect_tasks(&created.text).unwrap();
    assert_eq!(new_task.len(), 1);
    assert!(new_task[0].completed);
    assert!(created.text.contains("source-code: garden-84"));
    assert!(created.text.contains(&format!("situate-id: {a}")));
    assert!(
        created
            .text
            .contains("\"due\":\"2030-04-17\",\"custom\":\"kept\"")
    );
    assert!(created.text.contains(&format!("[Other](situate:{})", b)));
    assert!(
        other
            .text
            .contains(&format!("[Task](situate:{})", new_task[0].id))
    );
    assert_eq!(
        uuid::Uuid::parse_str(&new_task[0].id)
            .unwrap()
            .get_version_num(),
        4
    );
    assert_ne!(new_task[0].id, task);
    assert_eq!(outcome.identity_map.len(), 1);
    assert_eq!(created.revision, outcome.files[0].revision);
    let history = store.validated_history().unwrap();
    assert_eq!(
        history
            .iter()
            .filter(|entry| matches!(entry.fact, Fact::Completed { .. }))
            .count(),
        1
    );
    assert_eq!(
        history
            .iter()
            .filter(|entry| matches!(entry.operation, Some(Operation::CreateBatch { .. })))
            .count(),
        1
    );
    let revision = match &outcome.outcome {
        OperationOutcome::Complete { history_revision } => history_revision.clone(),
        _ => unreachable!(),
    };
    drop(history);
    drop(store);
    let mut reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(
        reopened.read_revision("Notes/a.md", &revision).unwrap(),
        created.text.as_bytes()
    );
    let reference = reopened
        .capture_reference("workspace", "Notes/a.md", Some(&created.revision))
        .unwrap();
    assert!(reference.validate());
    assert_eq!(
        fs::read(temp.path().join(".situate/batch-batch.jsonl")).unwrap(),
        original_manifest
    );
    assert!(
        reopened
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    assert_eq!(reopened.read_text("Notes/a.md").unwrap(), created);
}

#[test]
fn general_creation_preserves_nested_metadata_attachments_links_and_cancelled_entries() {
    let (temp, mut store) = workspace();
    let attachment = b"%PDF-1.7\nsynthetic attachment\n";
    fs::write(temp.path().join("Notes/plan.pdf"), attachment).unwrap();
    let body = "# Garden\n\n[Plan](plan.pdf)\n\n- [-] Cancelled visit\n";
    let metadata = "source: example\nsource_attachments: [{name: plan.pdf, url: plan.pdf}]\nproject: Garden\nstatus: active\narea: Outdoors\ndue: 2030-04-17\neditorial:\n  reviewers: [alpha, beta]\n  draft: true\n";
    for (path, prepare_copy) in [("Notes/garden.md", false), ("Notes/copied-garden.md", true)] {
        manifest(
            temp.path(),
            &[(path, &format!("---\n{metadata}---\n{body}"))],
        );
        store
            .create_batch(".situate/batch-batch.jsonl", prepare_copy, || Ok(()))
            .unwrap();
        let text = store.read_text(path).unwrap().text;
        assert_eq!(text, format!("---\n{metadata}---\n{body}"));
        assert!(crate::metadata::inspect_tasks(&text).unwrap().is_empty());
    }
    assert_eq!(
        fs::read(temp.path().join("Notes/plan.pdf")).unwrap(),
        attachment
    );
}

#[test]
fn ordinary_batches_preserve_bytes_and_prepared_batches_allocate_task_intents() {
    let (temp, mut store) = workspace();
    let original = "---\nsituate-id: ordinary-value\ncustom: kept\n---\n- [ ] First <!-- situate-task-id: null -->\n- [x] Second <!-- situate-task-id: null -->\n- [ ] Checklist\n";
    manifest(
        temp.path(),
        &[
            ("Notes/original.md", original),
            ("Notes/data.json", "{\"value\":1}\r\n"),
        ],
    );
    let ordinary = store
        .create_batch(".situate/batch-batch.jsonl", false, || Ok(()))
        .unwrap();
    assert!(ordinary.identity_map.is_empty());
    assert_eq!(store.read_text("Notes/original.md").unwrap().text, original);
    assert_eq!(
        store.read_text("Notes/data.json").unwrap().text,
        "{\"value\":1}\r\n"
    );
    manifest(temp.path(), &[("Notes/copy.md", original)]);
    let prepared = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    assert!(prepared.identity_map.is_empty());
    let copy = store.read_text("Notes/copy.md").unwrap();
    assert!(
        copy.text
            .starts_with("---\nsituate-id: ordinary-value\ncustom: kept\n---\n")
    );
    assert!(copy.text.ends_with("- [ ] Checklist\n"));
    let tasks = crate::metadata::inspect_tasks(&copy.text).unwrap();
    assert_eq!(tasks.len(), 2);
    assert_ne!(tasks[0].id, tasks[1].id);
    assert!(!tasks[0].completed);
    assert!(tasks[1].completed);
    assert_eq!(store.read_text("Notes/original.md").unwrap().text, original);
}

#[test]
fn task_intents_share_the_identity_bound_and_cannot_publish_oversized_preparation() {
    let (temp, mut store) = workspace();
    let tasks = "- [ ] Task <!-- situate-task-id: null -->\n".repeat(MAX_IDENTITIES + 1);
    manifest(temp.path(), &[("Notes/tasks.md", &tasks)]);
    assert_eq!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .unwrap_err()
            .to_string(),
        "native.content.operation.tooLarge"
    );
    assert!(!temp.path().join("Notes/tasks.md").exists());
}

#[test]
fn invalid_batches_publish_nothing_and_preserve_existing_files_and_drafts() {
    for entries in [
        vec![("Notes/a.md", "# A"), ("Notes/a.md", "# Duplicate")],
        vec![("Notes/a.md", "# A"), ("../escape.md", "# Unsafe")],
        vec![("Notes/a.md", "# A"), ("missing/b.md", "# Missing parent")],
        vec![
            ("Notes/a.md", "# A"),
            ("Notes/existing.md", "# Replacement"),
        ],
        vec![
            ("Notes/a.md", "# A"),
            (
                "Notes/b.md",
                "- [ ] Task <!-- {\"situate-task-id\":\"invalid\"} -->",
            ),
        ],
    ] {
        let (temp, mut store) = workspace();
        fs::write(temp.path().join("Notes/existing.md"), "original").unwrap();
        manifest(temp.path(), &entries);
        assert!(
            store
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .is_err()
        );
        assert!(!temp.path().join("Notes/a.md").exists());
        assert_eq!(
            fs::read_to_string(temp.path().join("Notes/existing.md")).unwrap(),
            "original"
        );
    }
    let (temp, mut store) = workspace();
    manifest(temp.path(), &[("Notes/a.md", "# A"), ("Notes/b.md", "# B")]);
    store
        .stage_draft(&Draft {
            path: "Notes/b.md".into(),
            base: None,
            text: "draft".into(),
        })
        .unwrap();
    assert!(matches!(
        store.create_batch(".situate/batch-batch.jsonl", true, || Ok(())),
        Err(ContentError::Busy)
    ));
    assert!(!temp.path().join("Notes/a.md").exists());
    assert_eq!(store.drafts().unwrap()[0].text, "draft");
}

#[test]
fn prepared_batches_preserve_source_bytes_with_metadata_warnings() {
    let (temp, mut store) = workspace();
    let source = "---\neditorial: [broken\n---\n# Kept\n";
    manifest(temp.path(), &[("Notes/note.md", source)]);
    store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    let text = store.read_text("Notes/note.md").unwrap().text;
    assert_eq!(text, source);
    assert!(!crate::metadata::inspect(&text).issues.is_empty());
}

#[test]
fn malformed_empty_oversized_and_ambiguous_manifests_are_rejected() {
    let (temp, mut store) = workspace();
    for bytes in [
        "",
        "{\"path\":\"a.md\"}",
        "{\"path\":\"a.md\",\"text\":\"A\",\"extra\":true}",
    ] {
        fs::write(temp.path().join(".situate/batch-batch.jsonl"), bytes).unwrap();
        assert!(
            store
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .is_err()
        );
    }
    let too_big = "x".repeat(MAX_FILE_BYTES + 1);
    manifest(temp.path(), &[("a.md", &too_big)]);
    assert!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    let tasks = (0..MAX_IDENTITIES + 1)
        .map(|i| {
            format!(
                "- [ ] Task <!-- {{\"situate-task-id\":\"{}\"}} -->",
                uuid::Uuid::from_u128(i as u128 + 1)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    manifest(temp.path(), &[("Tasks.md", &tasks)]);
    assert_eq!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .unwrap_err()
            .to_string(),
        "native.content.operation.tooLarge"
    );
    assert!(!temp.path().join("Tasks.md").exists());
    let id = "00000000-0000-0000-0000-000000000001";
    let task = format!("- [ ] Task <!-- {{\"situate-task-id\":\"{id}\"}} -->");
    manifest(temp.path(), &[("a.md", &task), ("b.md", &task)]);
    assert!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    let records = (0..MAX_FILES + 1)
        .map(|i| serde_json::json!({"path": format!("n{i}.md"), "text": "# Note"}).to_string())
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(temp.path().join(".situate/batch-batch.jsonl"), records).unwrap();
    assert!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    assert!(!temp.path().join("a.md").exists());
    assert!(!temp.path().join("n0.md").exists());
}

#[cfg(unix)]
#[test]
fn symlinked_manifests_parents_and_destinations_are_not_followed() {
    use std::os::unix::fs::symlink;
    let (temp, mut store) = workspace();
    let outside = tempfile::tempdir().unwrap();
    fs::write(
        outside.path().join("data.jsonl"),
        "{\"path\":\"a.md\",\"text\":\"A\"}",
    )
    .unwrap();
    symlink(
        outside.path().join("data.jsonl"),
        temp.path().join(".situate/batch-link.jsonl"),
    )
    .unwrap();
    assert!(
        store
            .create_batch(".situate/batch-link.jsonl", true, || Ok(()))
            .is_err()
    );
    assert!(
        store
            .write_batch_manifest(".situate/batch-link.jsonl", None, "replacement")
            .is_err()
    );
    symlink(outside.path(), temp.path().join("linked")).unwrap();
    manifest(temp.path(), &[("linked/a.md", "# A")]);
    assert!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    symlink(
        outside.path().join("new.md"),
        temp.path().join("Notes/a.md"),
    )
    .unwrap();
    manifest(temp.path(), &[("Notes/a.md", "# A")]);
    assert!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    assert!(!outside.path().join("a.md").exists());
    assert!(!outside.path().join("new.md").exists());
}

#[test]
fn cancellation_keeps_verified_copies_and_does_not_replay_after_restart() {
    let (temp, mut store) = workspace();
    manifest(temp.path(), &[("Notes/a.md", "# A"), ("Notes/b.md", "# B")]);
    let outcome = store
        .create_batch(".situate/batch-batch.jsonl", true, || {
            if temp.path().join("Notes/a.md").exists() {
                Err(ContentError::History("native.ai.request.cancelled".into()))
            } else {
                Ok(())
            }
        })
        .unwrap();
    assert!(matches!(
        outcome.outcome,
        OperationOutcome::PartialFailure { .. }
    ));
    assert_eq!(outcome.files.len(), 1);
    assert!(temp.path().join("Notes/a.md").exists());
    assert!(!temp.path().join("Notes/b.md").exists());
    drop(store);
    let mut reopened = ContentStore::open(temp.path()).unwrap();
    assert!(!temp.path().join("Notes/b.md").exists());
    assert!(
        reopened
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .is_err()
    );
    assert!(
        reopened
            .validated_history()
            .unwrap()
            .iter()
            .any(|entry| matches!(entry.fact, Fact::Interrupted))
    );
}

#[test]
fn late_collision_and_ancestor_replacement_cannot_be_acknowledged_as_success() {
    for replace_parent in [false, true] {
        let (temp, mut store) = workspace();
        manifest(temp.path(), &[("Notes/a.md", "# A"), ("Notes/b.md", "# B")]);
        let mut changed = false;
        let outcome = store
            .create_batch(".situate/batch-batch.jsonl", true, || {
                if !changed && temp.path().join("Notes/a.md").exists() {
                    changed = true;
                    if replace_parent {
                        fs::rename(temp.path().join("Notes"), temp.path().join("detached"))
                            .unwrap();
                        fs::create_dir(temp.path().join("Notes")).unwrap();
                    } else {
                        fs::write(temp.path().join("Notes/b.md"), "independent").unwrap();
                    }
                }
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            outcome.outcome,
            OperationOutcome::PartialFailure { .. }
        ));
        assert_eq!(outcome.files.len(), 1);
        if replace_parent {
            assert!(!temp.path().join("Notes/b.md").exists());
            assert!(!temp.path().join("detached/b.md").exists());
        } else {
            assert_eq!(
                fs::read_to_string(temp.path().join("Notes/b.md")).unwrap(),
                "independent"
            );
        }
    }
}

#[test]
fn history_publication_failure_retains_copies_and_never_reports_completion() {
    let (temp, mut store) = workspace();
    manifest(temp.path(), &[("Notes/a.md", "# A"), ("Notes/b.md", "# B")]);
    let mut injected = false;
    let outcome = store
        .create_batch(".situate/batch-batch.jsonl", true, || {
            if !injected && temp.path().join("Notes/a.md").exists() {
                injected = true;
                super::super::git_storage::FAIL_REF_SYNC.set(Some(0));
            }
            Ok(())
        })
        .unwrap();
    assert!(matches!(
        outcome.outcome,
        OperationOutcome::PartialFailure { .. }
    ));
    assert_eq!(outcome.files.len(), 2);
    assert!(temp.path().join("Notes/a.md").exists());
    assert!(temp.path().join("Notes/b.md").exists());
    super::super::git_storage::FAIL_REF_SYNC.set(None);
    drop(store);
    let reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(
        reopened.read_text("Notes/a.md").unwrap().revision,
        outcome.files[0].revision
    );
}

#[test]
fn linked_partial_retries_can_be_reconciled_using_the_returned_identity_maps() {
    let (temp, mut store) = workspace();
    let a = "00000000-0000-0000-0000-000000000001";
    let b = "00000000-0000-0000-0000-000000000002";
    let first =
        format!("- [ ] First <!-- {{\"situate-task-id\":\"{a}\"}} -->\n[Other](situate:{b})\n");
    let second =
        format!("- [ ] Second <!-- {{\"situate-task-id\":\"{b}\"}} -->\n[First](situate:{a})\n");
    manifest(
        temp.path(),
        &[("Notes/a.md", &first), ("Notes/b.md", &second)],
    );
    let partial = store
        .create_batch(".situate/batch-batch.jsonl", true, || {
            if temp.path().join("Notes/a.md").exists() {
                Err(ContentError::History("native.ai.request.cancelled".into()))
            } else {
                Ok(())
            }
        })
        .unwrap();
    assert_eq!(partial.files.len(), 1);
    let native_a = partial.identity_map[a].clone();
    let planned_b = partial.identity_map[b].clone();
    let second = crate::metadata::retarget_identity_links(
        &second,
        &HashMap::from([(a.into(), native_a.clone())]),
    );
    manifest(temp.path(), &[("Notes/b.md", &second)]);
    let retried = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    assert!(matches!(retried.outcome, OperationOutcome::Complete { .. }));
    let native_b = retried.identity_map[b].clone();
    assert_ne!(planned_b, native_b);
    let current = store.read_text("Notes/a.md").unwrap();
    let corrected = crate::metadata::retarget_identity_links(
        &current.text,
        &HashMap::from([(planned_b, native_b.clone())]),
    );
    assert!(matches!(
        store
            .agent_write("Notes/a.md", Some(&current.revision), &corrected)
            .unwrap(),
        SaveOutcome::Saved { .. }
    ));
    let first = store.read_text("Notes/a.md").unwrap();
    let second = store.read_text("Notes/b.md").unwrap();
    assert_eq!(crate::metadata::inspect(&first.text).tasks[0].id, native_a);
    assert!(first.text.contains(&format!("[Other](situate:{native_b})")));
    assert!(
        second
            .text
            .contains(&format!("[First](situate:{native_a})"))
    );
}

#[test]
fn links_across_batches_can_be_reconciled_without_rewriting_identities() {
    let (temp, mut store) = workspace();
    let a = "00000000-0000-0000-0000-000000000001";
    let b = "00000000-0000-0000-0000-000000000002";
    manifest(
        temp.path(),
        &[(
            "Notes/a.md",
            &format!(
                "- [ ] First <!-- {{\"situate-task-id\":\"{a}\"}} -->\n[Other](situate:{b})\n"
            ),
        )],
    );
    let first = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    let second = crate::metadata::retarget_identity_links(
        &format!("- [ ] Second <!-- {{\"situate-task-id\":\"{b}\"}} -->\n[First](situate:{a})\n"),
        &first.identity_map,
    );
    manifest(temp.path(), &[("Notes/b.md", &second)]);
    let next = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    let current = store.read_text("Notes/a.md").unwrap();
    let corrected = crate::metadata::retarget_identity_links(&current.text, &next.identity_map);
    store
        .agent_write("Notes/a.md", Some(&current.revision), &corrected)
        .unwrap();
    assert!(
        store
            .read_text("Notes/a.md")
            .unwrap()
            .text
            .contains(&format!("situate:{}", next.identity_map[b]))
    );
    assert!(
        store
            .read_text("Notes/b.md")
            .unwrap()
            .text
            .contains(&format!("situate:{}", first.identity_map[a]))
    );
}

#[test]
fn batch_history_does_not_claim_unrelated_external_edits() {
    let (temp, mut store) = workspace();
    manifest(temp.path(), &[("Notes/a.md", "# A"), ("Notes/b.md", "# B")]);
    let mut injected = false;
    let result = store
        .create_batch(".situate/batch-batch.jsonl", true, || {
            if !injected && temp.path().join("Notes/a.md").exists() {
                injected = true;
                fs::write(temp.path().join("external.txt"), "independent edit").unwrap();
            }
            Ok(())
        })
        .unwrap();
    let OperationOutcome::Complete { history_revision } = result.outcome else {
        panic!("batch did not complete")
    };
    let batch_commit = store.validated_revision(&history_revision).unwrap();
    assert!(
        batch_commit
            .tree()
            .unwrap()
            .get_path(Path::new("external.txt"))
            .is_err()
    );
    let current = store.repo.head().unwrap().peel_to_commit().unwrap();
    assert_ne!(current.id().to_string(), history_revision);
    assert!(matches!(
        Envelope::read(&current).unwrap().fact,
        Fact::Observation
    ));
    assert_eq!(
        fs::read_to_string(temp.path().join("external.txt")).unwrap(),
        "independent edit"
    );
}

#[test]
fn maximum_file_count_succeeds_and_combined_path_limit_fails_before_staging() {
    let (temp, mut store) = workspace();
    let entries = (0..MAX_FILES)
        .map(|i| (format!("Notes/{i}.md"), "# Note"))
        .collect::<Vec<_>>();
    manifest(
        temp.path(),
        &entries
            .iter()
            .map(|(path, text)| (path.as_str(), *text))
            .collect::<Vec<_>>(),
    );
    let outcome = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    assert!(matches!(outcome.outcome, OperationOutcome::Complete { .. }));
    assert_eq!(outcome.files.len(), MAX_FILES);

    let (temp, mut store) = workspace();
    let parent = format!("Notes/{}", "p".repeat(120));
    fs::create_dir(temp.path().join(&parent)).unwrap();
    let entries = (0..MAX_FILES)
        .map(|i| (format!("{parent}/{i}-{}.md", "n".repeat(160)), "# Note"))
        .collect::<Vec<_>>();
    manifest(
        temp.path(),
        &entries
            .iter()
            .map(|(path, text)| (path.as_str(), *text))
            .collect::<Vec<_>>(),
    );
    assert_eq!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .unwrap_err()
            .to_string(),
        "native.content.operation.tooLarge"
    );
    assert_eq!(fs::read_dir(temp.path().join(&parent)).unwrap().count(), 0);
    let file = fs::File::create(temp.path().join(".situate/batch-batch.jsonl")).unwrap();
    file.set_len(MAX_MANIFEST_BYTES + 1).unwrap();
    assert_eq!(
        store
            .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
            .unwrap_err()
            .to_string(),
        "native.content.operation.tooLarge"
    );
}

#[test]
fn mixed_batches_preserve_attachment_bytes_links_sources_and_history() {
    let (temp, mut store) = workspace();
    fs::create_dir_all(temp.path().join(".situate/import-media/assets")).unwrap();
    fs::create_dir(temp.path().join("Notes/assets")).unwrap();
    let png = b"\x89PNG\r\n\x1a\n\0\xffimage";
    let pdf = b"%PDF-1.7\n\0\xffdocument";
    let unknown = b"\xff\x80\x81";
    for (name, bytes) in [
        ("photo.png", png.as_slice()),
        ("paper.pdf", pdf),
        ("raw.bin", unknown),
    ] {
        fs::write(
            temp.path()
                .join(format!(".situate/import-media/assets/{name}")),
            bytes,
        )
        .unwrap();
    }
    let note = "---\ncustom: kept\n---\n![Photo](assets/photo.png)\n[Paper](assets/paper.pdf)\n- [ ] Task <!-- situate-task-id: null -->\n";
    fs::write(temp.path().join(".situate/import-media/note.md"), note).unwrap();
    manifest_rows(
        temp.path(),
        &[
            serde_json::json!({"path":"Notes/note.md","sourcePath":".situate/import-media/note.md"}),
            serde_json::json!({"path":"Notes/assets/photo.png","sourcePath":".situate/import-media/assets/photo.png"}),
            serde_json::json!({"path":"Notes/assets/paper.pdf","sourcePath":".situate/import-media/assets/paper.pdf"}),
            serde_json::json!({"path":"Notes/assets/raw.bin","sourcePath":".situate/import-media/assets/raw.bin"}),
            serde_json::json!({"path":"Notes/inline.md","text":"# Inline text"}),
        ],
    );
    let outcome = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    let OperationOutcome::Complete { history_revision } = outcome.outcome else {
        panic!("mixed batch did not complete");
    };
    assert_eq!(outcome.files.len(), 5);
    assert_eq!(
        fs::read_to_string(temp.path().join(".situate/import-media/note.md")).unwrap(),
        note
    );
    let imported = store.read_text("Notes/note.md").unwrap();
    let tasks = crate::metadata::inspect(&imported.text).tasks;
    assert_eq!(tasks.len(), 1);
    uuid::Uuid::parse_str(&tasks[0].id).unwrap();
    assert!(imported.text.contains("custom: kept"));
    assert!(imported.text.contains("![Photo](assets/photo.png)"));
    assert!(imported.text.contains("[Paper](assets/paper.pdf)"));
    for (name, bytes) in [
        ("photo.png", png.as_slice()),
        ("paper.pdf", pdf),
        ("raw.bin", unknown),
    ] {
        assert_eq!(
            fs::read(
                temp.path()
                    .join(format!(".situate/import-media/assets/{name}"))
            )
            .unwrap(),
            bytes
        );
        assert_eq!(
            fs::read(temp.path().join(format!("Notes/assets/{name}"))).unwrap(),
            bytes
        );
        assert_eq!(
            store
                .read_revision(&format!("Notes/assets/{name}"), &history_revision)
                .unwrap(),
            bytes
        );
    }
    drop(store);
    let reopened = ContentStore::open(temp.path()).unwrap();
    assert_eq!(
        reopened
            .read_revision("Notes/assets/photo.png", &history_revision)
            .unwrap(),
        png
    );
    assert!(
        reopened
            .list_revision(&history_revision)
            .unwrap()
            .iter()
            .all(|entry| !entry.path.starts_with(".situate/import-"))
    );
}

#[test]
fn staged_files_can_exceed_inline_text_limit_and_remain_byte_exact() {
    let (temp, mut store) = workspace();
    fs::create_dir(temp.path().join(".situate/import-large")).unwrap();
    let bytes = vec![0xff; MAX_FILE_BYTES + 1];
    fs::write(temp.path().join(".situate/import-large/file"), &bytes).unwrap();
    manifest_rows(
        temp.path(),
        &[serde_json::json!({"path":"Notes/large.bin","sourcePath":".situate/import-large/file"})],
    );
    let outcome = store
        .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
        .unwrap();
    assert!(matches!(outcome.outcome, OperationOutcome::Complete { .. }));
    assert_eq!(
        fs::read(temp.path().join("Notes/large.bin")).unwrap(),
        bytes
    );
}

#[test]
fn invalid_staging_sources_and_ambiguous_rows_publish_nothing() {
    for source in [
        "outside.bin",
        "/tmp/outside.bin",
        ".situate/history.git/config",
        ".situate/import-/file",
        ".situate/import-files",
        ".situate/import-files/../file",
        ".situate/import-files//file",
        ".situate/import-files/.git/config",
        ".situate/import-files/missing",
        ".situate/import-files/folder",
    ] {
        let (temp, mut store) = workspace();
        fs::create_dir_all(temp.path().join(".situate/import-files/folder")).unwrap();
        manifest_rows(
            temp.path(),
            &[
                serde_json::json!({"path":"Notes/a.md","text":"# Note"}),
                serde_json::json!({"path":"Notes/file.bin","sourcePath":source}),
            ],
        );
        assert!(
            store
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .is_err(),
            "{source}"
        );
        assert!(!temp.path().join("Notes/a.md").exists());
        assert!(!temp.path().join("Notes/file.bin").exists());
    }
    let (temp, mut store) = workspace();
    fs::create_dir(temp.path().join(".situate/import-files")).unwrap();
    fs::write(temp.path().join(".situate/import-files/file"), b"bytes").unwrap();
    for row in [
        serde_json::json!({"path":"Notes/file.bin","sourcePath":".situate/import-files/file","text":"both"}),
        serde_json::json!({"path":"Notes/file.bin","sourcePath":".situate/import-files/file","extra":true}),
        serde_json::json!({"path":"Notes/file.bin","sourcePath":null}),
    ] {
        manifest_rows(temp.path(), &[row]);
        assert!(
            store
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .is_err()
        );
    }
    assert!(!temp.path().join("Notes/file.bin").exists());
}

#[cfg(unix)]
#[test]
fn staging_symlinks_and_special_files_are_not_followed() {
    use std::os::unix::fs::symlink;
    let (temp, mut store) = workspace();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("file"), b"outside").unwrap();
    fs::create_dir(temp.path().join(".situate/import-files")).unwrap();
    symlink(outside.path(), temp.path().join(".situate/import-linked")).unwrap();
    symlink(
        outside.path(),
        temp.path().join(".situate/import-files/linked"),
    )
    .unwrap();
    symlink(
        outside.path().join("file"),
        temp.path().join(".situate/import-files/file"),
    )
    .unwrap();
    std::os::unix::net::UnixListener::bind(temp.path().join(".situate/import-files/socket"))
        .unwrap();
    for source in [
        ".situate/import-linked/file",
        ".situate/import-files/linked/file",
        ".situate/import-files/file",
        ".situate/import-files/socket",
    ] {
        manifest_rows(
            temp.path(),
            &[serde_json::json!({"path":"Notes/file.bin","sourcePath":source})],
        );
        assert!(
            store
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .is_err(),
            "{source}"
        );
        assert!(!temp.path().join("Notes/file.bin").exists());
    }
    assert_eq!(fs::read(outside.path().join("file")).unwrap(), b"outside");
}

#[test]
fn staged_file_and_aggregate_byte_limits_fail_before_publication() {
    for inline_first in [false, true] {
        let (temp, mut store) = workspace();
        fs::create_dir(temp.path().join(".situate/import-large")).unwrap();
        fs::File::create(temp.path().join(".situate/import-large/file"))
            .unwrap()
            .set_len(MAX_OPERATION_BYTES + u64::from(!inline_first))
            .unwrap();
        let mut rows = Vec::new();
        if inline_first {
            rows.push(serde_json::json!({"path":"Notes/a.md","text":"x"}));
        }
        rows.push(
            serde_json::json!({"path":"Notes/large.bin","sourcePath":".situate/import-large/file"}),
        );
        manifest_rows(temp.path(), &rows);
        assert_eq!(
            store
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .unwrap_err()
                .to_string(),
            "native.content.operation.tooLarge"
        );
        assert_eq!(fs::read_dir(temp.path().join("Notes")).unwrap().count(), 0);
    }
}

#[test]
fn staging_mutation_or_replacement_before_publication_is_rejected() {
    for replace in [false, true] {
        let (temp, mut store) = workspace();
        fs::create_dir(temp.path().join(".situate/import-files")).unwrap();
        let source = temp.path().join(".situate/import-files/file");
        fs::write(&source, b"original").unwrap();
        manifest_rows(
            temp.path(),
            &[
                serde_json::json!({"path":"Notes/file.bin","sourcePath":".situate/import-files/file"}),
            ],
        );
        let mut changed = false;
        let result = store.create_batch(".situate/batch-batch.jsonl", true, || {
            if !changed
                && fs::read_dir(temp.path().join("Notes"))
                    .unwrap()
                    .next()
                    .is_some()
            {
                changed = true;
                if replace {
                    fs::rename(&source, source.with_extension("old")).unwrap();
                    fs::write(&source, b"original").unwrap();
                } else {
                    fs::write(&source, b"changed").unwrap();
                }
            }
            Ok(())
        });
        assert!(changed);
        assert!(result.is_err());
        assert!(!temp.path().join("Notes/file.bin").exists());
    }
}

#[test]
fn mixed_batch_interruption_preserves_verified_attachments_without_replay() {
    for mutate_source in [false, true] {
        let (temp, mut store) = workspace();
        fs::create_dir(temp.path().join(".situate/import-files")).unwrap();
        let source = temp.path().join(".situate/import-files/file");
        fs::write(&source, b"\0\xffattachment").unwrap();
        manifest_rows(
            temp.path(),
            &[
                serde_json::json!({"path":"Notes/a.bin","sourcePath":".situate/import-files/file"}),
                serde_json::json!({"path":"Notes/b.bin","sourcePath":".situate/import-files/file"}),
                serde_json::json!({"path":"Notes/note.md","text":"[Attachment](a.bin)"}),
            ],
        );
        let outcome = store
            .create_batch(".situate/batch-batch.jsonl", true, || {
                if temp.path().join("Notes/a.bin").exists() {
                    if mutate_source {
                        fs::write(&source, b"changed").unwrap();
                    } else {
                        return Err(ContentError::History("native.ai.request.cancelled".into()));
                    }
                }
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            outcome.outcome,
            OperationOutcome::PartialFailure { .. }
        ));
        assert_eq!(outcome.files.len(), 1);
        assert_eq!(outcome.files[0].path, "Notes/a.bin");
        drop(store);
        let mut reopened = ContentStore::open(temp.path()).unwrap();
        assert_eq!(
            fs::read(temp.path().join("Notes/a.bin")).unwrap(),
            b"\0\xffattachment"
        );
        assert!(!temp.path().join("Notes/b.bin").exists());
        assert!(!temp.path().join("Notes/note.md").exists());
        assert!(
            reopened
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .is_err()
        );
    }
}

#[test]
#[ignore = "Measures real filesystem and Git synchronization; run explicitly without concurrent builds"]
fn benchmark_import_batch() {
    let count = 32;
    let mut timings = Vec::new();
    for batched in [false, true, true, false] {
        let (temp, mut store) = workspace();
        let prepare = std::time::Instant::now();
        let entries = (0..count)
            .map(|i| {
                (
                    format!("Notes/n{i}.md"),
                    format!(
                        "# Note {i}\n\n{}\n- [ ] Ordinary checklist\n",
                        "Synthetic source text. ".repeat(200)
                    ),
                )
            })
            .collect::<Vec<_>>();
        manifest(
            temp.path(),
            &entries
                .iter()
                .map(|(path, text)| (path.as_str(), text.as_str()))
                .collect::<Vec<_>>(),
        );
        let preparation = prepare.elapsed();
        let start = std::time::Instant::now();
        if batched {
            let result = store
                .create_batch(".situate/batch-batch.jsonl", true, || Ok(()))
                .unwrap();
            assert!(matches!(result.outcome, OperationOutcome::Complete { .. }));
            assert_eq!(result.files.len(), count);
        } else {
            for (path, text) in &entries {
                let text = crate::metadata::regenerate_copy(text).unwrap();
                assert!(matches!(
                    store.agent_write(path, None, &text).unwrap(),
                    SaveOutcome::Saved { .. }
                ));
            }
        }
        let elapsed = start.elapsed();
        let history = store.validated_history().unwrap();
        let completed = history
            .iter()
            .filter(|entry| {
                matches!(
                    Envelope::read(&entry.commit).unwrap().fact,
                    Fact::Completed { .. }
                )
            })
            .count();
        timings.push(
            serde_json::json!({"mode": if batched { "batch" } else { "single" }, "files": count,
            "manifestPreparationMs": preparation.as_secs_f64() * 1000.0,
            "storageAndHistoryMs": elapsed.as_secs_f64() * 1000.0, "completedChanges": completed}),
        );
    }
    eprintln!("{}", serde_json::to_string(&timings).unwrap());
}
