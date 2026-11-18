mod conversation;
pub use conversation::FixtureConversations;

use serde_json::json;
use situate_core::{
    ConversationRecord,
    ai_storage::Storage,
    content::{ContentStore, SaveOutcome, WORKING_METHOD_PATH},
    onboarding::{OnboardingRecord, OnboardingStorage, Step},
    workspaces::{self, Location},
};
use std::path::Path;

pub fn seed_conversation(
    storage: &Storage,
    id: &str,
    title: &str,
    draft: &str,
    message: &str,
) -> Result<ConversationRecord, String> {
    if message.is_empty() {
        return storage.create_conversation_with_draft(
            id,
            title,
            draft.into(),
            Default::default(),
            None,
        );
    }
    let mut record = storage.create_conversation(id, title)?;
    record.draft = draft.into();
    record.messages = json!([{"role":"user","content":message,"timestamp":1}]);
    storage.save_fixture_conversation(&record, record.revision)
}

pub fn create(scenario: &str, parent: &Path, name: &str) -> Result<Location, String> {
    if scenario != "used-workspace" {
        return Err("Unknown workspace template".into());
    }
    let location = workspaces::create(parent, name)?;
    seed_used_workspace(&location).map_err(|error| {
        format!(
            "Workspace created at {}, but setup failed: {error}",
            location.handle
        )
    })?;
    Ok(location)
}

fn seed_used_workspace(location: &Location) -> Result<(), String> {
    let root = Path::new(&location.handle);
    let _lease = situate_migrations::prepare(root, situate_core::application_version())
        .map_err(|error| error.to_string())?;
    let mut files = ContentStore::open(root).map_err(|error| error.to_string())?;
    for (path, markdown) in [
        (
            "Weekly review.md",
            "# Weekly review\n\nReview open tasks every Friday.\n",
        ),
        (
            "Project notes.md",
            "# Project notes\n\n- [x] Collect ideas <!-- situate-task-id: null -->\n- [ ] Pick the next step <!-- situate-task-id: null -->\n",
        ),
    ] {
        let outcome = files
            .agent_write(path, None, markdown)
            .map_err(|error| error.to_string())?;
        if !matches!(outcome, SaveOutcome::Saved { .. }) {
            return Err(format!("Could not finish saving {path}: {outcome:?}"));
        }
    }
    let storage = Storage::open(root, &location.id)?;
    seed_conversation(
        &storage,
        "fixture-weekly-review",
        "Weekly review",
        "",
        "Help me plan my weekly review.",
    )?;
    let SaveOutcome::Saved { version, .. } = files
        .create_text(
            WORKING_METHOD_PATH,
            "# Working method\n\nKeep project notes together and review open tasks every Friday.\n",
        )
        .map_err(|error| error.to_string())?
    else {
        return Err("Could not finish saving the working method".into());
    };
    OnboardingStorage::open(root, &location.id)?.save(
        None,
        OnboardingRecord {
            step: Step::Complete,
            entered: true,
            proposal: version.text.clone(),
            instruction_revision: Some(version.revision.clone()),
            instruction_base: Some(situate_core::onboarding::InstructionBase {
                text: version.text,
                revision: version.revision,
            }),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Requires a confirmed canonical workspace path. Never migrates or edits an open workspace.
pub fn apply(scenario: &str, target: &Path) -> Result<ConversationRecord, String> {
    if scenario != "chat-draft" {
        return Err("Unknown workspace action".into());
    }
    let location = workspaces::inspect(target)?;
    let root = Path::new(&location.handle);
    if target.as_os_str() != root.as_os_str() {
        return Err("Confirm the canonical workspace path before applying a fixture".into());
    }
    let lease =
        situate_migrations::lock_current_exclusively(root, situate_core::application_version())
            .map_err(|error| {
                format!(
                    "Workspace must be closed and already opened with a compatible client: {error}"
                )
            })?;
    lease.validate().map_err(|error| error.to_string())?;
    add_chat_draft(&Storage::open(root, &location.id)?)
}

pub fn add_chat_draft(storage: &Storage) -> Result<ConversationRecord, String> {
    seed_conversation(
        storage,
        &uuid::Uuid::new_v4().to_string(),
        "Draft: weekly review",
        "What should I review before Friday?",
        "",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn used_workspace_reopens_as_setup_with_notes_tasks_and_history() {
        let parent = tempfile::tempdir().unwrap();
        let location = create("used-workspace", parent.path(), "Sample").unwrap();
        let root = Path::new(&location.handle);
        let files = ContentStore::open(root).unwrap();
        assert!(
            files
                .read_text("Weekly review.md")
                .unwrap()
                .text
                .contains("every Friday")
        );
        let tasks = files.read_text("Project notes.md").unwrap().text;
        assert!(tasks.contains("- [x] Collect ideas"));
        assert!(!tasks.contains("situate-task-id: null"));
        let record = OnboardingStorage::open(root, &location.id)
            .unwrap()
            .load()
            .unwrap()
            .record
            .unwrap();
        assert_eq!(record.step, Step::Complete);
        let storage = Storage::open(root, &location.id).unwrap();
        let record = storage
            .read_conversation("fixture-weekly-review")
            .unwrap()
            .unwrap();
        assert_eq!(
            record.messages[0]["content"],
            "Help me plan my weekly review."
        );
        assert!(create("used-workspace", parent.path(), "Sample").is_err());
    }

    #[test]
    fn adding_a_draft_respects_open_sessions_and_preserves_existing_content() {
        let parent = tempfile::tempdir().unwrap();
        let location = workspaces::create(parent.path(), "Existing").unwrap();
        let root = Path::new(&location.handle);
        fs::write(root.join("Keep.md"), "Keep me").unwrap();
        let session =
            situate_migrations::prepare(root, situate_core::application_version()).unwrap();
        assert!(apply("chat-draft", root).is_err());
        drop(session);
        let storage = Storage::open(root, &location.id).unwrap();
        let original = storage
            .create_conversation("existing", "Keep this too")
            .unwrap();
        let draft = apply("chat-draft", root).unwrap();
        let reopened = Storage::open(root, &location.id).unwrap();
        assert_eq!(
            reopened
                .read_conversation(&draft.id)
                .unwrap()
                .unwrap()
                .draft,
            "What should I review before Friday?"
        );
        assert_eq!(
            reopened
                .read_conversation(&original.id)
                .unwrap()
                .unwrap()
                .title,
            "Keep this too"
        );
        assert_eq!(fs::read_to_string(root.join("Keep.md")).unwrap(), "Keep me");
    }
}
