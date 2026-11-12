#[cfg(test)]
use crate::conversation_fixtures::FixtureConversations;
use situate_core::onboarding::{OnboardingRecord, OnboardingStorage, Snapshot};

#[tauri::command]
pub async fn onboarding_load(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<Snapshot, String> {
    let label = window.label().to_owned();
    let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_authorization_session(&app, &label, &authorization, |location| {
            OnboardingStorage::from_storage(crate::ai::local_storage(&app, location)?).load()
        })
    })
    .await
    .map_err(|_| "native.onboarding.storage.failed".to_owned())?
}

#[tauri::command]
pub async fn onboarding_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    text: String,
) -> Result<String, String> {
    if text.len() > 65_536 {
        return Err("native.onboarding.storage.tooLarge".into());
    }
    let authorization = crate::workspaces::authorization_session(&app, window.label(), &scope)?;
    crate::workspaces::with_authorization_session(&app, window.label(), &authorization, |_| {
        Ok(situate_core::rendering::render_markdown(&text, |_| None))
    })
}

#[tauri::command]
pub async fn onboarding_prepare_instructions(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    text: String,
) -> Result<String, String> {
    if text.len() > 65_536 {
        return Err("native.onboarding.storage.tooLarge".into());
    }
    if text.trim().is_empty() {
        return Err("native.onboarding.storage.invalid".into());
    }
    let label = window.label().to_owned();
    let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_authorization_session(&app, &label, &authorization, |location| {
            OnboardingStorage::from_storage(crate::ai::local_storage(&app, location)?)
                .load()?
                .record
                .ok_or("native.onboarding.storage.invalid")?;
            Ok(text)
        })
    })
    .await
    .map_err(|_| "native.onboarding.storage.failed".to_owned())?
}

#[tauri::command]
pub async fn onboarding_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    record: OnboardingRecord,
    expected_revision: Option<String>,
) -> Result<Snapshot, String> {
    let label = window.label().to_owned();
    let authorization = crate::workspaces::storage_authorization_session(&app, &label, &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_retained_session(&app, &label, &authorization, |location| {
            OnboardingStorage::from_storage(crate::ai::local_storage(&app, location)?)
                .save(expected_revision.as_deref(), record)
        })
    })
    .await
    .map_err(|_| "native.onboarding.storage.failed".to_owned())?
}

#[tauri::command]
pub async fn onboarding_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    action: String,
    expected: Option<OnboardingRecord>,
) -> Result<Snapshot, String> {
    let label = window.label().to_owned();
    let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
    let finish = action == "finish";
    let operation_app = app.clone();
    let operation_label = label.clone();
    let operation_authorization = authorization.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_authorization_session(
            &operation_app,
            &operation_label,
            &operation_authorization,
            |location| {
                let files = crate::workspaces::file_session(
                    &operation_app,
                    &operation_label,
                    &location.id,
                )?;
                crate::files::with_content_store(&operation_app, &files, |content| {
                    let root = crate::files::local_root(&operation_app, location)?
                        .ok_or("native.onboarding.storage.failed")?;
                    let storage = OnboardingStorage::from_storage(
                        situate_core::ai_storage::Storage::open(&root, &location.id)?,
                    );
                    crate::ai_onboarding::action(&storage, content, &action, expected)
                })
            },
        )
    })
    .await
    .map_err(|_| "native.onboarding.storage.failed".to_owned())??;
    if finish && let Some(record) = snapshot.record.clone() {
        crate::ai_conversations::start_setup_developments(app, label, scope, authorization, record)
            .await?;
    }
    Ok(snapshot)
}

pub(crate) fn prepare(
    root: &std::path::Path,
    scope: &str,
    development_id: &str,
) -> Result<crate::plugin_development::Status, String> {
    use situate_core::{
        ai_storage::Storage,
        onboarding::{Choice, Step},
        plugins::sources,
    };
    let record = OnboardingStorage::open(root, scope)?
        .load()?
        .record
        .ok_or("native.plugins.developmentToolDenied")?;
    if record.step != Step::Complete {
        return Err("native.plugins.developmentToolDenied".into());
    }
    let idea = record
        .ideas
        .iter()
        .find(|idea| idea.development_id == development_id && idea.choice == Some(Choice::Develop))
        .ok_or("native.plugins.developmentToolDenied")?;
    let storage = Storage::open(root, scope)?;
    // Retained children are authoritative, including user edits and interrupted runs.
    let conversation = if let Some(existing) = storage.read_conversation(development_id)? {
        if !existing.development.as_ref().is_some_and(|development| {
            development.version == Some(2)
                && development.plugin_id == idea.plugin_id
                && development.origin_conversation_id.is_none()
        }) {
            return Err("native.plugins.developmentToolDenied".into());
        }
        existing
    } else {
        storage.create_assignment_conversation(
            development_id,
            Some(&idea.plugin_id),
            None,
            &idea.title,
            &idea.assignment,
            "",
        )?
    };
    let source_path = root.join(".situate/plugins").join(&idea.plugin_id);
    let error = match std::fs::symlink_metadata(source_path) {
        Ok(_) => sources::files(root, &idea.plugin_id).err(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => Some(error.to_string()),
    };
    Ok(crate::plugin_development::Status {
        conversation,
        ready: error.is_none(),
        error,
    })
}

#[tauri::command]
pub async fn onboarding_development_prepare(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    development_id: String,
) -> Result<crate::plugin_development::Status, String> {
    let label = window.label().to_owned();
    let authorization = crate::workspaces::authorization_session(&app, &label, &scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::workspaces::with_authorization_session(&app, &label, &authorization, |location| {
            let _access = crate::ai::local_storage(&app, location)?;
            let root =
                crate::files::local_root(&app, location)?.ok_or("native.plugins.unavailable")?;
            prepare(&root, &scope, &development_id)
        })
    })
    .await
    .map_err(|_| "native.plugins.developmentOutcomeUnknown".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use situate_core::{
        ai_storage::Storage,
        onboarding::{Choice, Step, SupportIdea},
    };
    const ID: &str = "7f43d37a-3a98-4a31-970d-7bf95f7a35be";
    fn fixture(complete: bool) -> tempfile::TempDir {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        OnboardingStorage::open(root.path(), "scope")
            .unwrap()
            .save(
                None,
                OnboardingRecord {
                    step: if complete {
                        Step::Complete
                    } else {
                        Step::Support
                    },
                    entered: true,
                    description: "Weekly review".into(),
                    proposal: "Review tasks each Friday".into(),
                    instruction_revision: Some("a".repeat(40)),
                    ideas: vec![SupportIdea {
                        id: "task-view".into(),
                        title: "Task view".into(),
                        detail: "Tasks".into(),
                        reason: "Review".into(),
                        assignment: "Build a view".into(),
                        choice: Some(Choice::Develop),
                        development_id: ID.into(),
                        plugin_id: "task-view".into(),
                        note_path: None,
                    }],
                    ..Default::default()
                },
            )
            .unwrap();
        root
    }

    #[test]
    fn preparation_is_idempotent_without_an_origin_run_and_preserves_user_edits() {
        let root = fixture(true);
        let first = prepare(root.path(), "scope", ID).unwrap();
        assert!(first.ready);
        assert_eq!(first.conversation.draft, "Build a view");
        assert_eq!(
            first
                .conversation
                .development
                .as_ref()
                .unwrap()
                .origin_conversation_id,
            None
        );
        let second = prepare(root.path(), "scope", ID).unwrap();
        assert!(second.ready);
        assert_eq!(second.conversation, first.conversation);
        let storage = Storage::open(root.path(), "scope").unwrap();
        let mut edited = first.conversation;
        edited.draft = "A follow-up question".into();
        let edited = storage.save_fixture_conversation(&edited, 0).unwrap();
        assert_eq!(
            prepare(root.path(), "scope", ID).unwrap().conversation,
            edited
        );
        assert_eq!(
            storage
                .list_conversations()
                .unwrap()
                .iter()
                .filter(|c| c.development.is_some())
                .count(),
            1
        );
    }

    #[test]
    fn initial_prompt_contains_only_the_chosen_plugin_commission() {
        let root = fixture(true);
        let onboarding = OnboardingStorage::open(root.path(), "scope").unwrap();
        let snapshot = onboarding.load().unwrap();
        let mut record = snapshot.record.unwrap();
        record.description =
            "Organize everything by season. Previously import 17 notebooks.".into();
        record.source_description = "Import from a synthetic archive account.".into();
        record.proposal =
            format!("---\nsituate-id: {ID}\n---\n# Working method\nReview every Friday.");
        let commission = "Develop a read-only saved-link library.\n\n\
            - Read Markdown links and available attachment URLs/titles at runtime.\n\
            - Show note references and deduplicate only in the view.\n\
            - Do not edit or delete notes, create tasks or fetch external content.\n\
            - Preserve the existing organization. Never embed personal runtime data in code or tests.";
        record.ideas[0].assignment = commission.into();
        record.ideas[0].detail =
            "A proposal for after setup, not authorization during setup.".into();
        record.ideas[0].reason = "Fits the historical import.".into();
        let mut other = record.ideas[0].clone();
        other.id = "other-view".into();
        other.development_id = "b998aa23-d88e-4314-a4ba-d1d03a869c78".into();
        other.plugin_id = "other-view".into();
        other.assignment = "Develop an unrelated calendar view.".into();
        record.ideas.push(other);
        onboarding
            .save(snapshot.revision.as_deref(), record)
            .unwrap();

        let prepared = prepare(root.path(), "scope", ID).unwrap();
        assert_eq!(prepared.conversation.draft, commission);
        assert_eq!(prepared.conversation.messages, serde_json::json!([]));
        assert!(prepared.conversation.runtime.is_none());
        assert!(
            Storage::open(root.path(), "scope")
                .unwrap()
                .read_conversation("b998aa23-d88e-4314-a4ba-d1d03a869c78")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn saved_and_discarded_ideas_cannot_prepare_development() {
        for choice in [None, Some(Choice::Save), Some(Choice::Discard)] {
            let root = fixture(true);
            let onboarding = OnboardingStorage::open(root.path(), "scope").unwrap();
            let snapshot = onboarding.load().unwrap();
            let mut record = snapshot.record.unwrap();
            record.ideas[0].choice = choice;
            onboarding
                .save(snapshot.revision.as_deref(), record)
                .unwrap();
            assert_eq!(
                prepare(root.path(), "scope", ID).unwrap_err(),
                "native.plugins.developmentToolDenied"
            );
            assert!(
                Storage::open(root.path(), "scope")
                    .unwrap()
                    .read_conversation(ID)
                    .unwrap()
                    .is_none()
            );
            assert!(!root.path().join(".situate/plugin-drafts").exists());
        }
    }

    #[test]
    fn incomplete_unselected_and_foreign_scope_cannot_prepare() {
        let root = fixture(false);
        assert_eq!(
            prepare(root.path(), "scope", ID).unwrap_err(),
            "native.plugins.developmentToolDenied"
        );
        let root = fixture(true);
        assert_eq!(
            prepare(root.path(), "scope", "b998aa23-d88e-4314-a4ba-d1d03a869c78").unwrap_err(),
            "native.plugins.developmentToolDenied"
        );
        let location = situate_core::workspaces::Location {
            id: "scope".into(),
            name: "Workspace".into(),
            display: "Workspace".into(),
            kind: "path".into(),
            handle: root.path().to_str().unwrap().into(),
        };
        let result = crate::workspaces::with_test_authorized_root(
            &[("workspace", location)],
            "workspace",
            "foreign",
            true,
            crate::workspaces::TestSessionChange::None,
            |path| prepare(path, "foreign", ID),
        );
        assert_eq!(result.unwrap_err(), "native.workspace.session.inactive");
        assert!(
            Storage::open(root.path(), "scope")
                .unwrap()
                .read_conversation(ID)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn preparation_does_not_create_sources_and_rejects_mismatched_child_metadata() {
        for foreign_origin in [false, true] {
            let root = fixture(true);
            let storage = Storage::open(root.path(), "scope").unwrap();
            if foreign_origin {
                storage
                    .create_conversation("other-origin", "Other conversation")
                    .unwrap();
            }
            storage
                .create_assignment_conversation(
                    ID,
                    Some(if foreign_origin {
                        "task-view"
                    } else {
                        "other-plugin"
                    }),
                    if foreign_origin {
                        Some("other-origin")
                    } else {
                        None
                    },
                    "Other commission",
                    "Build a view",
                    "",
                )
                .unwrap();
            assert_eq!(
                prepare(root.path(), "scope", ID).unwrap_err(),
                "native.plugins.developmentToolDenied"
            );
            assert!(!root.path().join(".situate/plugins").exists());
        }
        let root = fixture(true);
        assert!(prepare(root.path(), "scope", ID).unwrap().ready);
        assert!(!root.path().join(".situate/plugins").exists());
        assert!(!root.path().join(".situate/plugin-drafts").exists());
    }

    #[cfg(unix)]
    #[test]
    fn invalid_existing_sources_keep_assignment_child_identity_and_readiness_error() {
        let root = fixture(true);
        let code = root.path().join(".situate/plugins/task-view/code");
        std::fs::create_dir_all(&code).unwrap();
        std::os::unix::fs::symlink("missing", code.join("entry.js")).unwrap();
        let first = prepare(root.path(), "scope", ID).unwrap();
        assert!(!first.ready);
        assert!(first.error.is_some());
        assert!(first.conversation.draft.contains("Build a view"));
        let second = prepare(root.path(), "scope", ID).unwrap();
        assert!(!second.ready);
        assert_eq!(second.conversation, first.conversation);
        assert_eq!(
            Storage::open(root.path(), "scope")
                .unwrap()
                .list_conversations()
                .unwrap()
                .iter()
                .filter(|c| c.development.is_some())
                .count(),
            1
        );
    }
}
