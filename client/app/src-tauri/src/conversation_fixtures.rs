use serde_json::json;
use situate_core::{ConversationRecord, ai_storage::Storage, conversation_history::HistoryEntry};

pub(crate) trait FixtureConversations {
    fn save_fixture_conversation(
        &self,
        record: &ConversationRecord,
        expected_revision: u64,
    ) -> Result<ConversationRecord, String>;
}
impl FixtureConversations for Storage {
    fn save_fixture_conversation(
        &self,
        record: &ConversationRecord,
        expected_revision: u64,
    ) -> Result<ConversationRecord, String> {
        let mut metadata = self
            .read_conversation_metadata(&record.id)?
            .ok_or("native.ai.conversation.invalidId")?;
        if metadata.revision != expected_revision {
            return Err("native.ai.conversation.conflict".into());
        }
        let previous = self
            .read_conversation(&record.id)?
            .ok_or("native.ai.conversation.invalidId")?;
        let previous_messages = previous
            .messages
            .as_array()
            .ok_or("native.ai.conversation.versionInvalid")?;
        let messages = record
            .messages
            .as_array()
            .ok_or("native.ai.conversation.versionInvalid")?;
        if !messages.starts_with(previous_messages) {
            return Err("native.ai.conversation.versionInvalid".into());
        }
        let mut entries = Vec::new();
        let mut selected = metadata.selected_entry_id.clone();
        let mut push = |kind: &str, data| {
            let id = format!("fixture-{}-{}", expected_revision, entries.len());
            entries.push(HistoryEntry::new(id.clone(), selected.clone(), kind, data));
            selected = Some(id);
        };
        for message in messages.iter().skip(previous_messages.len()) {
            push("message", json!({"message":message}));
        }
        let empty = situate_core::conversation_runtime::Runtime::default();
        let before = previous.runtime.as_ref().unwrap_or(&empty);
        let after = record.runtime.as_ref().unwrap_or(&empty);
        for input in &after.pending {
            if before
                .pending
                .iter()
                .any(|previous| previous.id == input.id)
            {
                continue;
            }
            push(
                "message",
                json!({"message":{"role":"user","content":input.text,"timestamp":input.timestamp},"input":{"id":input.id,"kind":input.kind,"state":"waiting","timestamp":input.timestamp,"attachments":input.attachments,"references":input.references}}),
            );
            if input.state == "consumed" {
                push(
                    "inputStatus",
                    json!({"inputId":input.id,"state":"consumed"}),
                );
            }
        }
        for event in &after.events {
            if !before
                .events
                .iter()
                .any(|old| old.id == event.id && old.run_id == event.run_id)
            {
                push("event", serde_json::to_value(event).unwrap());
            }
        }
        for run in &after.runs {
            if before.runs.iter().find(|old| old.id == run.id) != Some(run) {
                push("run", serde_json::to_value(run).unwrap());
            }
        }
        let legacy_draft = if record.draft.is_empty()
            && after.draft_attachments.is_empty()
            && after.draft_references.is_empty()
        {
            None
        } else {
            Some(
                json!({"text":record.draft,"attachments":after.draft_attachments,"references":after.draft_references}),
            )
        };
        if !entries.is_empty() {
            metadata = self.append_conversation_entries(
                &record.id,
                expected_revision,
                &entries,
                selected.as_deref(),
            )?;
        }
        if metadata.title != record.title
            || metadata.title_input != record.title_input
            || metadata.development != record.development
            || metadata.legacy_draft != legacy_draft
            || entries.is_empty()
        {
            metadata.title = record.title.clone();
            metadata.title_input = record.title_input.clone();
            metadata.development = record.development.clone();
            metadata.legacy_draft = legacy_draft;
            self.update_conversation_metadata(&metadata, metadata.revision)?;
        }
        self.read_conversation(&record.id)?
            .ok_or_else(|| "native.ai.conversation.invalidId".into())
    }
}
