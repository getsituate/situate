mod conversation;
mod full_workspace;
pub use conversation::FixtureConversations;

use serde_json::json;
use situate_core::{
    ConversationRecord,
    ai_storage::Storage,
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
    full_workspace::seed(&location).map_err(|error| {
        format!(
            "Workspace created at {}, but setup failed: {error}",
            location.handle
        )
    })?;
    Ok(location)
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
    let lease = situate_migrations::lock_current_exclusively(root).map_err(|error| {
        format!("Workspace must be closed and already opened with a compatible client: {error}")
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
    use situate_core::{
        content::ContentStore,
        onboarding::{OnboardingStorage, Step},
        plugins::runtime,
    };
    use std::fs;

    #[test]
    fn full_workspace_reopens_with_notes_tasks_chats_and_plugins() {
        let parent = tempfile::tempdir().unwrap();
        let location = create("used-workspace", parent.path(), "Sample").unwrap();
        let root = Path::new(&location.handle);
        let files = ContentStore::open(root).unwrap();
        assert!(
            files
                .read_text("Reviews/Weekly review.md")
                .unwrap()
                .text
                .contains("every Friday")
        );
        let tasks = files
            .read_text("Projects/Spring open day/Plan.md")
            .unwrap()
            .text;
        assert!(tasks.contains("- [x] Reserve the garden gate"));
        assert!(!tasks.contains("situate-task-id: null"));
        let record = OnboardingStorage::open(root, &location.id)
            .unwrap()
            .load()
            .unwrap()
            .record
            .unwrap();
        assert_eq!(record.step, Step::Complete);
        let storage = Storage::open(root, &location.id).unwrap();
        assert_eq!(storage.list_conversations().unwrap().len(), 3);
        let record = storage
            .read_conversation("fixture-open-day")
            .unwrap()
            .unwrap();
        let messages = record.messages.as_array().unwrap();
        assert!(messages.len() >= 30);
        assert_eq!(messages.first().unwrap()["role"], "user");
        assert_eq!(messages.last().unwrap()["role"], "assistant");
        assert!(!record.draft.is_empty());

        let listing = runtime::list(root).unwrap();
        assert_eq!(listing.plugins.len(), 4);
        assert!(listing.plugins.iter().all(|plugin| {
            plugin.enabled && plugin.revision.is_some() && plugin.error.is_none()
        }));
        let skill = runtime::load(root, "garden-review").unwrap();
        assert_eq!(skill.manifest.skills, ["review.md"]);
        assert!(skill.service_entry.is_none() && skill.ui_entry.is_none());
        let board = runtime::load(root, "garden-board").unwrap();
        assert!(board.ui_entry.is_some() && board.service_entry.is_none());
        assert!(board.manifest.skills.is_empty());
        assert_eq!(
            board.manifest.dependencies.unwrap(),
            ["garden-calendar", "garden-archive"]
        );
        let calendar = runtime::load(root, "garden-calendar").unwrap();
        assert_eq!(
            calendar.manifest.kind,
            Some(situate_core::plugins::PluginKind::Connection)
        );
        assert_eq!(calendar.manifest.exports.unwrap(), ["listEvents"]);
        let archive = runtime::load(root, "garden-archive").unwrap();
        assert_eq!(
            archive.manifest.exports.unwrap(),
            ["documentSourceDescribe", "documentSourceList"]
        );
        assert!(create("used-workspace", parent.path(), "Sample").is_err());
    }

    #[test]
    fn adding_a_draft_respects_open_sessions_and_preserves_existing_content() {
        let parent = tempfile::tempdir().unwrap();
        let location = workspaces::create(parent.path(), "Existing").unwrap();
        let root = Path::new(&location.handle);
        fs::write(root.join("Keep.md"), "Keep me").unwrap();
        let session = situate_migrations::prepare(root).unwrap();
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
