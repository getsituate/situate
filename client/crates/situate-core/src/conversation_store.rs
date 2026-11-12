use crate::{
    ai_storage::Storage,
    conversation_history::{ConversationContext, ConversationMetadata, validate_id},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const INVALID: &str = "native.ai.conversation.versionInvalid";
const CONFLICT: &str = "native.ai.conversation.conflict";
const STORAGE: &str = "native.ai.storage.failed";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[serde(bound(deserialize = "R: Deserialize<'de>"))]
pub struct ConversationRecord<R = crate::conversation_runtime::ContentReference> {
    pub version: u8,
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_input: Option<String>,
    pub revision: u64,
    pub messages: Value,
    pub draft: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub development: Option<Development>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<crate::conversation_runtime::Runtime<R>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_user_message_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub development: Option<Development>,
    pub id: String,
    pub title: String,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Development {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u8>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub plugin_id: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_origin"
    )]
    pub origin_conversation_id: Option<String>,
}
fn present_origin<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

impl ConversationContext {
    pub fn project_record(&self) -> Result<ConversationRecord, String> {
        let metadata = &self.metadata;
        let mut runtime = crate::conversation_runtime::Runtime::default();
        let mut messages = Vec::new();
        let mut selected: Vec<_> = self
            .active_entries
            .iter()
            .filter(|entry| !self.entries.iter().any(|e| e.id == entry.id))
            .cloned()
            .collect();
        selected.extend(self.entries.iter().cloned());
        for entry in &self.entries {
            if entry.kind == "message" {
                messages.push(entry.data["message"].clone());
            }
        }
        for entry in &selected {
            match entry.kind.as_str() {
                "message" => {
                    if let Some(input) = entry.data.get("input") {
                        let mut input = input.clone();
                        let content = &entry.data["message"]["content"];
                        input["text"] =
                            json!(content.as_str().map(str::to_owned).unwrap_or_else(|| {
                                content
                                    .as_array()
                                    .map(|blocks| {
                                        blocks
                                            .iter()
                                            .filter(|b| b["type"] == "text")
                                            .filter_map(|b| b["text"].as_str())
                                            .collect::<Vec<_>>()
                                            .join("")
                                    })
                                    .unwrap_or_default()
                            }));
                        if matches!(input["state"].as_str(), Some("waiting" | "pending")) {
                            input["state"] = json!("pending");
                        }
                        runtime.pending.push(
                            serde_json::from_value(project_fields(
                                &input,
                                &[
                                    "id",
                                    "kind",
                                    "state",
                                    "text",
                                    "attachments",
                                    "references",
                                    "timestamp",
                                ],
                            ))
                            .map_err(|_| INVALID)?,
                        );
                    }
                }
                "inputStatus" => {
                    if let Some(input) = runtime
                        .pending
                        .iter_mut()
                        .find(|p| Some(p.id.as_str()) == entry.data["inputId"].as_str())
                    {
                        input.state = entry.data["state"].as_str().ok_or(INVALID)?.into();
                    }
                }
                "event" => {
                    let event: crate::conversation_runtime::Event = serde_json::from_value(
                        project_fields(&entry.data, &["id", "runId", "sequence", "type", "data"]),
                    )
                    .map_err(|_| INVALID)?;
                    if let Some(old) = runtime
                        .events
                        .iter_mut()
                        .find(|e| e.id == event.id && e.run_id == event.run_id)
                    {
                        *old = event;
                    } else {
                        runtime.events.push(event);
                    }
                }
                "run" => {
                    let run: crate::conversation_runtime::Run =
                        serde_json::from_value(project_fields(
                            &entry.data,
                            &["id", "state", "startedAt", "endedAt", "usage", "references"],
                        ))
                        .map_err(|_| INVALID)?;
                    if let Some(old) = runtime.runs.iter_mut().find(|r| r.id == run.id) {
                        *old = run;
                    } else {
                        runtime.runs.push(run);
                    }
                }
                _ => (),
            }
        }
        runtime
            .pending
            .retain(|p| matches!(p.state.as_str(), "waiting" | "pending"));
        for event in &mut runtime.events {
            if let Some(result) = event.data["resultEntryId"]
                .as_str()
                .and_then(|id| self.entries.iter().find(|e| e.id == id))
            {
                event.data["result"] = tool_result(&result.data["message"]);
            }
        }
        let draft = metadata
            .legacy_draft
            .as_ref()
            .and_then(|v| v["text"].as_str())
            .unwrap_or("")
            .to_owned();
        if let Some(legacy) = &metadata.legacy_draft {
            runtime.draft_attachments =
                serde_json::from_value(legacy.get("attachments").cloned().unwrap_or(json!([])))
                    .map_err(|_| INVALID)?;
            runtime.draft_references =
                serde_json::from_value(legacy.get("references").cloned().unwrap_or(json!([])))
                    .map_err(|_| INVALID)?;
        }
        if let Some(compaction) = &self.compaction {
            runtime.checkpoint = Some(crate::conversation_runtime::Checkpoint {
                source_count: 0,
                summary: compaction.data["summary"].as_str().ok_or(INVALID)?.into(),
                run_id: compaction.data["runId"]
                    .as_str()
                    .unwrap_or("compaction")
                    .into(),
            });
        }
        let has_runtime = !runtime.pending.is_empty()
            || !runtime.events.is_empty()
            || !runtime.runs.is_empty()
            || !runtime.draft_attachments.is_empty()
            || !runtime.draft_references.is_empty()
            || runtime.checkpoint.is_some();
        Ok(ConversationRecord {
            version: 2,
            id: metadata.id.clone(),
            title: metadata.title.clone(),
            title_input: metadata.title_input.clone(),
            revision: metadata.revision,
            messages: Value::Array(messages),
            draft,
            development: metadata.development.clone(),
            runtime: has_runtime.then_some(runtime),
        })
    }
}
fn project_fields(value: &Value, fields: &[&str]) -> Value {
    Value::Object(
        fields
            .iter()
            .filter_map(|field| {
                value
                    .get(*field)
                    .map(|value| ((*field).to_owned(), value.clone()))
            })
            .collect(),
    )
}
fn tool_result(message: &Value) -> Value {
    let mut result = json!({"content":message["content"],"details":message["details"]});
    if let Some(structured) = message.get("structuredContent") {
        result["structuredContent"] = structured.clone();
    }
    result
}
impl Storage {
    pub fn project_conversation_context(
        &self,
        context: &ConversationContext,
    ) -> Result<ConversationRecord, String> {
        let mut record = context.project_record()?;
        if let Some(runtime) = &mut record.runtime {
            for event in &mut runtime.events {
                if event.data.get("result").is_none()
                    && let Some(id) = event.data["resultEntryId"].as_str()
                {
                    let entry = self
                        .read_conversation_entry(&context.metadata.id, id)?
                        .ok_or(INVALID)?;
                    if entry.kind != "message" || entry.data["message"]["role"] != "toolResult" {
                        return Err(INVALID.into());
                    }
                    event.data["result"] = tool_result(&entry.data["message"]);
                }
            }
        }
        Ok(record)
    }
    pub fn list_conversations(&self) -> Result<Vec<ConversationSummary>, String> {
        let _lock = self.lock_named("conversations.lock")?;
        let Some(root) = self.conversations_directory(false)? else {
            return Ok(Vec::new());
        };
        let mut summaries = Vec::new();
        for entry in root.entries().map_err(|_| STORAGE)? {
            let entry = entry.map_err(|_| STORAGE)?;
            let name = entry.file_name();
            let id = name.to_str().ok_or(INVALID)?;
            validate_id(id)?;
            let metadata = self
                .read_conversation_metadata_unlocked(id)?
                .ok_or(INVALID)?;
            if metadata.development.as_ref().is_some_and(|d| {
                d.origin_conversation_id.is_none()
                    && metadata.title_input.as_deref() == Some("")
                    && metadata.message_count == 0
                    && metadata.event_count == 0
            }) {
                continue;
            }
            summaries.push(ConversationSummary {
                last_user_message_at: metadata.last_user_message_at,
                development: metadata.development,
                id: metadata.id,
                title: metadata.title,
                revision: metadata.revision,
            });
        }
        summaries.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(summaries)
    }
    pub fn create_conversation(&self, id: &str, title: &str) -> Result<ConversationRecord, String> {
        self.create_prepared_conversation(id, title, None, String::new(), None, None)
    }
    pub fn create_conversation_with_draft(
        &self,
        id: &str,
        title: &str,
        draft: String,
        runtime: crate::conversation_runtime::Runtime,
        development: Option<Development>,
    ) -> Result<ConversationRecord, String> {
        if development
            .as_ref()
            .is_some_and(|d| d.version != Some(2) || d.origin_conversation_id.is_some())
        {
            return Err(INVALID.into());
        }
        self.create_prepared_conversation(id, title, None, draft, development, Some(runtime))
    }
    pub fn create_development_conversation(
        &self,
        id: &str,
        plugin_id: &str,
        origin_conversation_id: Option<&str>,
        title: &str,
        assignment: &str,
        context: &str,
    ) -> Result<ConversationRecord, String> {
        if let Some(origin) = origin_conversation_id {
            self.read_conversation_metadata(origin)?.ok_or(CONFLICT)?;
        }
        self.create_prepared_conversation(
            id,
            title,
            None,
            if context.is_empty() {
                assignment.into()
            } else {
                format!("{assignment}\n\n{context}")
            },
            Some(Development {
                version: Some(2),
                plugin_id: plugin_id.into(),
                origin_conversation_id: origin_conversation_id.map(str::to_owned),
            }),
            None,
        )
    }
    pub fn create_assignment_conversation(
        &self,
        id: &str,
        initial_plugin_id: Option<&str>,
        origin_conversation_id: Option<&str>,
        title: &str,
        assignment: &str,
        context: &str,
    ) -> Result<ConversationRecord, String> {
        if let Some(origin) = origin_conversation_id {
            self.read_conversation_metadata(origin)?.ok_or(CONFLICT)?;
        }
        self.create_prepared_conversation(
            id,
            title,
            Some(assignment.into()),
            if context.is_empty() {
                assignment.into()
            } else {
                format!("{assignment}\n\n{context}")
            },
            Some(Development {
                version: Some(2),
                plugin_id: initial_plugin_id.unwrap_or_default().into(),
                origin_conversation_id: origin_conversation_id.map(str::to_owned),
            }),
            None,
        )
    }
    fn create_prepared_conversation(
        &self,
        id: &str,
        title: &str,
        title_input: Option<String>,
        draft: String,
        development: Option<Development>,
        runtime: Option<crate::conversation_runtime::Runtime>,
    ) -> Result<ConversationRecord, String> {
        validate_id(id)?;
        if let Some(d) = &development {
            if d.version != Some(2)
                || (!d.plugin_id.is_empty() && !crate::plugins::valid_id(&d.plugin_id))
                || !uuid::Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id)
                || d.origin_conversation_id.as_deref() == Some(id)
            {
                return Err(INVALID.into());
            }
            if let Some(origin) = &d.origin_conversation_id {
                validate_id(origin)?;
            }
        }
        let mut metadata = ConversationMetadata::new(id, title);
        metadata.title_input = title_input;
        metadata.development = development;
        let runtime = runtime.unwrap_or_default();
        if !runtime.pending.is_empty()
            || !runtime.events.is_empty()
            || !runtime.runs.is_empty()
            || runtime.checkpoint.is_some()
        {
            return Err(INVALID.into());
        }
        if !draft.is_empty()
            || !runtime.draft_attachments.is_empty()
            || !runtime.draft_references.is_empty()
        {
            metadata.legacy_draft = Some(
                json!({"text":draft,"attachments":runtime.draft_attachments,"references":runtime.draft_references}),
            );
        }
        self.create_conversation_metadata(&metadata)?;
        self.read_conversation(id)?.ok_or_else(|| STORAGE.into())
    }
    pub fn read_conversation(&self, id: &str) -> Result<Option<ConversationRecord>, String> {
        self.read_conversation_context(id)?
            .map(|context| self.project_conversation_context(&context))
            .transpose()
    }
    pub fn recover_conversation(&self, id: &str) -> Result<Option<ConversationRecord>, String> {
        self.read_conversation(id)
    }
}

#[cfg(test)]
impl Storage {
    pub(crate) fn persist_runtime_fixture(
        &self,
        record: &ConversationRecord,
        expected_revision: u64,
    ) -> Result<ConversationRecord, String> {
        use crate::conversation_history::HistoryEntry;
        let mut metadata = self
            .read_conversation_metadata(&record.id)?
            .ok_or(CONFLICT)?;
        if metadata.revision != expected_revision {
            return Err(CONFLICT.into());
        }
        metadata.legacy_draft = Some(
            json!({"text":record.draft,"attachments":record.runtime.as_ref().map(|r|r.draft_attachments.clone()).unwrap_or_default(),"references":record.runtime.as_ref().map(|r|r.draft_references.clone()).unwrap_or_default()}),
        );
        metadata = self.update_conversation_metadata(&metadata, expected_revision)?;
        let mut entries = Vec::new();
        let mut parent = None;
        if let Some(runtime) = &record.runtime {
            for pending in &runtime.pending {
                let id = format!("input-{}", pending.id);
                let mut input = serde_json::to_value(pending).map_err(|_| INVALID)?;
                input.as_object_mut().unwrap().remove("text");
                input["state"] = json!("waiting");
                entries.push(HistoryEntry::new(&id,parent,"message",json!({"message":{"role":"user","content":pending.text,"timestamp":pending.timestamp},"input":input})));
                parent = Some(id);
            }
            for run in &runtime.runs {
                let id = format!("run-{}", run.id);
                entries.push(HistoryEntry::new(
                    &id,
                    parent,
                    "run",
                    serde_json::to_value(run).map_err(|_| INVALID)?,
                ));
                parent = Some(id);
            }
            for event in &runtime.events {
                let id = format!("event-{}", event.id);
                entries.push(HistoryEntry::new(
                    &id,
                    parent,
                    "event",
                    serde_json::to_value(event).map_err(|_| INVALID)?,
                ));
                parent = Some(id);
            }
        }
        self.append_conversation_entries(
            &record.id,
            metadata.revision,
            &entries,
            parent.as_deref(),
        )?;
        self.read_conversation(&record.id)?
            .ok_or_else(|| STORAGE.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation_history::HistoryEntry;
    use std::fs;
    fn workspace() -> (tempfile::TempDir, Storage) {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join(".situate")).unwrap();
        let storage = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
        (temp, storage)
    }
    #[test]
    fn creation_listing_drafts_and_metadata_updates_reopen() {
        let (temp, storage) = workspace();
        let record = storage
            .create_conversation_with_draft(
                "one",
                "First",
                "Unsent".into(),
                Default::default(),
                None,
            )
            .unwrap();
        assert_eq!(record.draft, "Unsent");
        assert_eq!(record.messages, json!([]));
        let mut metadata = storage.read_conversation_metadata("one").unwrap().unwrap();
        metadata.title = "Renamed".into();
        let saved = storage.update_conversation_metadata(&metadata, 0).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(
            storage.update_conversation_metadata(&metadata, 0).unwrap(),
            saved
        );
        let reopened = Storage::open(&temp.path().canonicalize().unwrap(), "test").unwrap();
        assert_eq!(
            reopened.read_conversation("one").unwrap().unwrap().title,
            "Renamed"
        );
        assert_eq!(reopened.list_conversations().unwrap().len(), 1);
        assert!(
            !temp
                .path()
                .join(".situate/native-conversation-one.json")
                .exists()
        );
    }
    #[test]
    fn development_identity_is_immutable_and_unsubmitted_assignments_are_hidden() {
        let (_temp, storage) = workspace();
        let id = "00000000-0000-4000-8000-000000000001";
        let record = storage
            .create_assignment_conversation(id, Some("sample"), None, "New", "", "")
            .unwrap();
        assert!(storage.list_conversations().unwrap().is_empty());
        let mut metadata = storage.read_conversation_metadata(id).unwrap().unwrap();
        metadata.development = None;
        assert_eq!(
            storage.update_conversation_metadata(&metadata, 0),
            Err(CONFLICT.into())
        );
        let entry = HistoryEntry::new(
            "input",
            None,
            "message",
            json!({"message":{"role":"user","content":"Build it","timestamp":1}}),
        );
        storage
            .append_conversation_entries(id, 0, &[entry], Some("input"))
            .unwrap();
        assert_eq!(storage.list_conversations().unwrap().len(), 1);
        assert_eq!(
            record.development,
            storage.read_conversation(id).unwrap().unwrap().development
        );
    }
    #[test]
    fn invalid_ids_and_development_metadata_do_not_create_paths() {
        let (_temp, storage) = workspace();
        for id in [
            "",
            ".",
            "..",
            "../outside",
            "UPPER",
            "a/b",
            "a\\b",
            "ümlaut",
        ] {
            assert!(storage.create_conversation(id, "Title").is_err());
            assert!(storage.read_conversation(id).is_err());
        }
        assert!(
            storage
                .create_development_conversation("not-a-uuid", "sample", None, "Title", "", "")
                .is_err()
        );
        assert!(
            storage
                .create_development_conversation(
                    "00000000-0000-4000-8000-000000000001",
                    "../outside",
                    None,
                    "Title",
                    "",
                    ""
                )
                .is_err()
        );
    }
    #[test]
    fn recovery_preserves_original_run_state_without_mutating_or_replaying() {
        let (temp, storage) = workspace();
        storage.create_conversation("one", "Work").unwrap();
        let run = HistoryEntry::new(
            "run",
            None,
            "run",
            json!({"id":"run-1","state":"running","startedAt":1}),
        );
        let call = HistoryEntry::new(
            "call",
            Some("run".into()),
            "event",
            json!({"id":"call-1","runId":"run-1","sequence":1,"type":"tool_intent","data":{"name":"write","args":{"path":"note.md"}}}),
        );
        storage
            .append_conversation_entries("one", 0, &[run, call], Some("call"))
            .unwrap();
        let before =
            fs::read(temp.path().join(".situate/conversations/one/history.jsonl")).unwrap();
        let recovered = storage.recover_conversation("one").unwrap().unwrap();
        assert_eq!(recovered.revision, 1);
        assert_eq!(recovered.runtime.unwrap().runs[0].state, "running");
        assert_eq!(
            fs::read(temp.path().join(".situate/conversations/one/history.jsonl")).unwrap(),
            before
        );
        assert!(!temp.path().join("note.md").exists());
    }
}
