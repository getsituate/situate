use super::*;
use std::fs;

fn workspace() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join(".situate")).unwrap();
    temp
}
fn open(temp: &tempfile::TempDir) -> OnboardingStorage {
    OnboardingStorage::open(&temp.path().canonicalize().unwrap(), "test").unwrap()
}
fn idea() -> SupportIdea {
    SupportIdea {
        id: "task-view".into(),
        title: "Task view".into(),
        detail: "Show today's tasks".into(),
        reason: "Review".into(),
        assignment: "Build a task view".into(),
        choice: Some(Choice::Develop),
        development_id: "7f43d37a-3a98-4a31-970d-7bf95f7a35be".into(),
        plugin_id: "task-view".into(),
        note_path: None,
    }
}

#[test]
fn open_points_are_optional_bounded_and_preserved_without_changing_the_draft() {
    let temp = workspace();
    let storage = open(&temp);
    let initial = storage.initialize().unwrap();
    let mut record = initial.record.unwrap();
    let legacy = serde_json::to_value(&record).unwrap();
    assert!(legacy.get("openPoints").is_none());
    assert!(
        serde_json::from_value::<OnboardingRecord>(legacy)
            .unwrap()
            .open_points
            .is_empty()
    );
    record.proposal = "# Instructions\nKeep reviews flexible.".into();
    record.open_points = vec!["How often should reviews happen?".into()];
    let saved = storage
        .save(initial.revision.as_deref(), record.clone())
        .unwrap();
    assert_eq!(open(&temp).load().unwrap(), saved);
    assert_eq!(saved.record.unwrap().proposal, record.proposal);
    for points in [
        vec![String::new()],
        vec!["ä".repeat(1025)],
        vec!["Question".into(); 9],
    ] {
        record.open_points = points;
        assert!(record.validate("test").is_err());
    }
}

#[test]
fn native_initialization_ignores_prototype_progress_without_modifying_it() {
    let temp = workspace();
    let prototype = temp.path().join(".situate/onboarding.json");
    let bytes = b"prototype state is not a native record";
    fs::write(&prototype, bytes).unwrap();
    assert!(open(&temp).load().unwrap().record.is_none());
    let saved = open(&temp).initialize().unwrap();
    assert_eq!(saved.record, Some(OnboardingRecord::default()));
    assert_eq!(fs::read(&prototype).unwrap(), bytes);
    assert!(
        temp.path()
            .join(".situate/native-onboarding.json")
            .is_file()
    );
}

#[test]
fn conversational_progress_is_durable_without_advancing_the_step() {
    let temp = workspace();
    let record = OnboardingRecord {
        step: Step::Sources,
        conversation_id: Some("setup-1".into()),
        fresh: true,
        intent: Intent::Keep,
        entered: true,
        instruction_revision: Some("a".repeat(40)),
        description: "Keep weekly reviews".into(),
        source_description: "Notes to copy later".into(),
        ..Default::default()
    };
    let saved = open(&temp).save(None, record.clone()).unwrap();
    assert_eq!(open(&temp).initialize().unwrap(), saved);
    assert_eq!(saved.record, Some(record));
}

#[test]
fn invalid_conversational_fields_and_entry_without_confirmed_instructions_fail_closed() {
    let temp = workspace();
    let storage = open(&temp);
    let saved = storage.initialize().unwrap();
    let path = temp.path().join(".situate/native-onboarding.json");
    let original = fs::read(&path).unwrap();
    for (field, value) in [
        ("conversationId", serde_json::json!("")),
        ("conversationId", serde_json::json!("Setup/1")),
        ("conversationId", serde_json::json!("a".repeat(65))),
        ("conversationId", serde_json::json!(false)),
        ("fresh", serde_json::json!(null)),
        ("fresh", serde_json::json!("true")),
        ("intent", serde_json::json!("other")),
        ("intent", serde_json::json!(null)),
        ("entered", serde_json::json!(null)),
        ("entered", serde_json::json!(1)),
        ("entered", serde_json::json!(true)),
    ] {
        let mut invalid: serde_json::Value = serde_json::from_slice(&original).unwrap();
        invalid["record"][field] = value;
        let bytes = serde_json::to_vec(&invalid).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert_eq!(storage.load().unwrap_err(), INVALID, "{field}");
        assert!(storage.initialize().is_err());
        assert!(
            storage
                .save(saved.revision.as_deref(), OnboardingRecord::default())
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    fs::write(&path, &original).unwrap();
    assert_eq!(
        storage
            .save(
                saved.revision.as_deref(),
                OnboardingRecord {
                    step: Step::Sources,
                    entered: true,
                    ..Default::default()
                }
            )
            .unwrap_err(),
        INVALID
    );
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn confirmed_revision_does_not_allow_entry_before_the_confirmed_phase() {
    let temp = workspace();
    let storage = open(&temp);
    let saved = storage.initialize().unwrap();
    let path = temp.path().join(".situate/native-onboarding.json");
    let original = fs::read(&path).unwrap();
    for step in [Step::Access, Step::Method, Step::Proposal] {
        let record = OnboardingRecord {
            step,
            entered: true,
            instruction_revision: Some("a".repeat(40)),
            ..Default::default()
        };
        assert_eq!(
            storage
                .save(saved.revision.as_deref(), record.clone())
                .unwrap_err(),
            INVALID
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        let bytes = encode(record.clone()).unwrap();
        fs::write(&path, &bytes).unwrap();
        if record.step == Step::Proposal {
            assert_eq!(storage.load().unwrap().record, Some(record));
        } else {
            assert_eq!(storage.load().unwrap_err(), INVALID);
        }
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::write(&path, &original).unwrap();
    }
    for step in [Step::Sources, Step::Review, Step::Support, Step::Complete] {
        let record = OnboardingRecord {
            step,
            entered: true,
            instruction_revision: Some("a".repeat(40)),
            ..Default::default()
        };
        assert!(record.validate("test").is_ok());
    }
    assert!(
        OnboardingRecord {
            step: Step::Complete,
            entered: false,
            instruction_revision: None,
            ..Default::default()
        }
        .validate("test")
        .is_ok()
    );
}

#[test]
fn entered_proposal_requires_prior_entry_but_remains_reopenable() {
    let temp = workspace();
    let storage = open(&temp);
    let proposal = OnboardingRecord {
        step: Step::Proposal,
        entered: true,
        instruction_revision: Some("a".repeat(40)),
        instruction_base: Some(InstructionBase {
            text: "Externally updated instructions".into(),
            revision: "b".repeat(40),
        }),
        proposal: "Review updated instructions".into(),
        ..Default::default()
    };
    assert_eq!(storage.save(None, proposal.clone()).unwrap_err(), INVALID);
    let initial = storage.initialize().unwrap();
    assert_eq!(storage.save(None, proposal.clone()).unwrap_err(), CONFLICT);
    assert_eq!(
        storage
            .save(initial.revision.as_deref(), proposal.clone())
            .unwrap_err(),
        INVALID
    );
    assert_eq!(storage.load().unwrap(), initial);
    let entered = storage
        .save(
            initial.revision.as_deref(),
            OnboardingRecord {
                step: Step::Sources,
                entered: true,
                instruction_revision: Some("a".repeat(40)),
                ..Default::default()
            },
        )
        .unwrap();
    let review = storage
        .save(entered.revision.as_deref(), proposal.clone())
        .unwrap();
    assert_eq!(open(&temp).initialize().unwrap(), review);
    assert_eq!(review.record, Some(proposal.clone()));
    let repeated = open(&temp)
        .save(review.revision.as_deref(), proposal)
        .unwrap();
    assert!(repeated.record.unwrap().entered);
}

#[test]
fn legacy_missing_is_not_initialized_by_loading() {
    let temp = workspace();
    assert_eq!(
        open(&temp).load().unwrap(),
        Snapshot {
            record: None,
            revision: None,
            writable: true
        }
    );
    assert!(!temp.path().join(".situate/native-onboarding.json").exists());
}

#[test]
fn initialization_is_durable_and_never_resets_progress() {
    let temp = workspace();
    let storage = open(&temp);
    let initial = storage.initialize().unwrap();
    assert_eq!(initial.record, Some(OnboardingRecord::default()));
    assert_eq!(open(&temp).load().unwrap(), initial);
    let mut record = initial.record.unwrap();
    record.step = Step::Sources;
    record.description = "  My weekly review\n".into();
    record.proposal = "Use weekly reviews".into();
    record.instruction_revision = Some("a".repeat(40));
    record.method_conversation_id = Some("method-1".into());
    record.source_conversation_id = Some("source-1".into());
    record.paused = true;
    let saved = storage.save(initial.revision.as_deref(), record).unwrap();
    assert_eq!(open(&temp).initialize().unwrap(), saved);
}

#[test]
fn copy_rebinds_references_and_preserves_complete_dispatch_ids() {
    let source = workspace();
    let destination = workspace();
    let mut record = OnboardingRecord {
        step: Step::Complete,
        ideas: vec![idea()],
        open_points: vec!["Choose a review rhythm.".into()],
        ..Default::default()
    };
    record.imported = vec![
        ContentReference::Live {
            workspace_id: "test".into(),
            path: "notes/today.md".into(),
            anchor_revision: "a".repeat(40),
        },
        ContentReference::Historical {
            workspace_id: "test".into(),
            path: "notes/old.md".into(),
            revision: "b".repeat(40),
        },
    ];
    let saved = open(&source).save(None, record).unwrap();
    assert_eq!(open(&source).load().unwrap(), saved);
    fs::copy(
        source.path().join(".situate/native-onboarding.json"),
        destination.path().join(".situate/native-onboarding.json"),
    )
    .unwrap();
    let copied =
        OnboardingStorage::open(&destination.path().canonicalize().unwrap(), "destination")
            .unwrap()
            .load()
            .unwrap();
    assert_eq!(copied.revision, saved.revision);
    let copied = copied.record.unwrap();
    assert_eq!(copied.step, Step::Complete);
    assert_eq!(copied.ideas, vec![idea()]);
    assert_eq!(copied.open_points, vec!["Choose a review rhythm."]);
    assert!(
        copied
            .imported
            .iter()
            .all(|r| r.workspace_id() == "destination")
    );
    let bytes = fs::read_to_string(source.path().join(".situate/native-onboarding.json")).unwrap();
    assert!(!bytes.contains("workspaceId"));
}

#[test]
fn stale_revisions_and_external_changes_do_not_lose_bytes() {
    let temp = workspace();
    let storage = open(&temp);
    let first = storage.initialize().unwrap();
    assert_eq!(
        storage.save(None, OnboardingRecord::default()).unwrap_err(),
        CONFLICT
    );
    let second = storage
        .save(first.revision.as_deref(), OnboardingRecord::default())
        .unwrap();
    assert_ne!(first.revision, second.revision);
    assert_eq!(
        storage
            .save(first.revision.as_deref(), OnboardingRecord::default())
            .unwrap_err(),
        CONFLICT
    );
    let path = temp.path().join(".situate/native-onboarding.json");
    let mut bytes = fs::read(&path).unwrap();
    bytes.push(b' ');
    fs::write(&path, &bytes).unwrap();
    assert_eq!(
        storage
            .save(second.revision.as_deref(), OnboardingRecord::default())
            .unwrap_err(),
        CONFLICT
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn corrupt_unsupported_and_malformed_records_are_preserved() {
    let temp = workspace();
    let path = temp.path().join(".situate/native-onboarding.json");
    let storage = open(&temp);
    for bytes in [
        b"not JSON".to_vec(),
        br#"{"version":99}"#.to_vec(),
        br#"{"version":1,"record":{"schemaVersion":99}}"#.to_vec(),
    ] {
        fs::write(&path, &bytes).unwrap();
        assert!(storage.load().is_err());
        assert!(storage.initialize().is_err());
        assert!(storage.save(None, OnboardingRecord::default()).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    let mut value = serde_json::to_value(OnboardingRecord::default()).unwrap();
    value.as_object_mut().unwrap().remove("instructionBase");
    assert!(serde_json::from_value::<OnboardingRecord>(value).is_err());
}

#[test]
fn invalid_records_and_busy_writes_leave_saved_progress_reopenable() {
    let temp = workspace();
    let storage = open(&temp);
    let saved = storage.initialize().unwrap();
    let invalid = OnboardingRecord {
        description: "x".repeat(65_537),
        ..Default::default()
    };
    assert_eq!(
        storage
            .save(saved.revision.as_deref(), invalid)
            .unwrap_err(),
        INVALID
    );
    let mut invalid = OnboardingRecord {
        ideas: vec![idea(), idea()],
        ..Default::default()
    };
    assert_eq!(
        storage
            .save(saved.revision.as_deref(), invalid.clone())
            .unwrap_err(),
        INVALID
    );
    invalid.ideas.truncate(1);
    invalid.ideas[0].plugin_id = "../outside".into();
    assert_eq!(
        storage
            .save(saved.revision.as_deref(), invalid)
            .unwrap_err(),
        INVALID
    );
    let other = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
    let _lock = other.lock_named("native-onboarding.lock").unwrap();
    assert_eq!(
        storage
            .save(saved.revision.as_deref(), OnboardingRecord::default())
            .unwrap_err(),
        "native.onboarding.storage.busy"
    );
    assert_eq!(open(&temp).load().unwrap(), saved);
}

#[cfg(unix)]
#[test]
fn symlink_records_locks_and_storage_directories_are_not_followed() {
    use std::os::unix::fs::symlink;
    let temp = workspace();
    let outside = workspace();
    let storage = open(&temp);
    let saved = storage.initialize().unwrap();
    let outside_file = outside.path().join("keep.json");
    fs::write(&outside_file, "keep").unwrap();
    let path = temp.path().join(".situate/native-onboarding.json");
    fs::remove_file(&path).unwrap();
    symlink(&outside_file, &path).unwrap();
    assert!(storage.load().is_err());
    assert!(
        storage
            .save(saved.revision.as_deref(), OnboardingRecord::default())
            .is_err()
    );
    assert_eq!(fs::read_to_string(&outside_file).unwrap(), "keep");
    fs::remove_file(&path).unwrap();
    let lock = temp.path().join(".situate/native-onboarding.lock");
    fs::remove_file(&lock).unwrap();
    symlink(&outside_file, &lock).unwrap();
    assert!(storage.initialize().is_err());
    assert_eq!(fs::read_to_string(&outside_file).unwrap(), "keep");
    fs::remove_file(&lock).unwrap();
    fs::remove_dir(temp.path().join(".situate")).unwrap();
    symlink(
        outside.path().join(".situate"),
        temp.path().join(".situate"),
    )
    .unwrap();
    assert!(OnboardingStorage::open(&temp.path().canonicalize().unwrap(), "test").is_err());
}

#[cfg(unix)]
#[test]
fn failed_publication_preserves_previous_progress() {
    use std::os::unix::fs::PermissionsExt;
    let temp = workspace();
    let storage = open(&temp);
    let saved = storage.initialize().unwrap();
    let marker = temp.path().join(".situate");
    fs::set_permissions(&marker, fs::Permissions::from_mode(0o500)).unwrap();
    let result = storage.save(saved.revision.as_deref(), OnboardingRecord::default());
    fs::set_permissions(&marker, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    assert_eq!(open(&temp).load().unwrap(), saved);
}
