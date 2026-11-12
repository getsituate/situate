use crate::*;
use situate_core::conversation_runtime::{Checkpoint, Pending, Runtime};

#[derive(Clone)]
pub(crate) struct Batch {
    pub(crate) entries: Vec<HistoryEntry>,
    pub(crate) metadata: ConversationMetadata,
    expected_revision: u64,
    message_ids: Vec<String>,
    clear_legacy_draft: bool,
    result_refs: Vec<(String, String, String)>,
}

pub(crate) fn original(input: &Input, timestamp: u64) -> Value {
    json!({"role":"user","content":input.text,"timestamp":timestamp})
}

pub(crate) fn message_text(message: &Value) -> String {
    message["content"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| {
            message["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
}

pub(crate) fn tool_result(message: &Value) -> Value {
    let mut result = json!({"content":message["content"],"details":message["details"]});
    if let Some(structured) = message.get("structuredContent") {
        result["structuredContent"] = structured.clone();
    }
    result
}

pub(crate) fn receipt(raw: &Value) -> Value {
    let mut action = raw.clone();
    if let Some(object) = action.as_object_mut() {
        object.remove("input");
    }
    action
}

fn known_fields(value: &Value, fields: &[&str]) -> Value {
    let mut value = value.clone();
    if let Some(object) = value.as_object_mut() {
        object.retain(|key, _| fields.contains(&key.as_str()));
    }
    value
}

pub(crate) fn project(
    context: &ConversationContext,
) -> Result<(ConversationRecord, Vec<String>), String> {
    let metadata = &context.metadata;
    let mut record = ConversationRecord {
        version: 2,
        id: metadata.id.clone(),
        title: metadata.title.clone(),
        title_input: metadata.title_input.clone(),
        revision: metadata.revision,
        messages: json!([]),
        draft: String::new(),
        development: metadata.development.clone(),
        runtime: Some(Runtime::default()),
    };
    let mut ids = Vec::new();
    for entry in context
        .entries
        .iter()
        .filter(|entry| entry.kind == "message")
    {
        transcript::validate(&entry.data["message"])?;
        record
            .messages
            .as_array_mut()
            .unwrap()
            .push(entry.data["message"].clone());
        ids.push(entry.id.clone());
    }
    let mut seen = std::collections::HashSet::new();
    for entry in context.active_entries.iter().chain(context.entries.iter()) {
        if !seen.insert(&entry.id) {
            continue;
        }
        match entry.kind.as_str() {
            "message" => {
                let message = entry.data["message"].clone();
                transcript::validate(&message)?;
                if let Some(input) = entry.data.get("input") {
                    let pending = Pending {
                        id: input["id"]
                            .as_str()
                            .ok_or("native.ai.conversation.versionInvalid")?
                            .into(),
                        kind: input["kind"].as_str().unwrap_or("steering").into(),
                        state: if matches!(input["state"].as_str(), Some("waiting" | "pending")) {
                            "pending"
                        } else {
                            "consumed"
                        }
                        .into(),
                        text: message_text(&message),
                        timestamp: input["timestamp"].as_u64().unwrap_or_default(),
                        attachments: serde_json::from_value(input["attachments"].clone())
                            .map_err(|_| "native.ai.conversation.versionInvalid")?,
                        references: serde_json::from_value(
                            input.get("references").cloned().unwrap_or(json!([])),
                        )
                        .map_err(|_| "native.ai.conversation.versionInvalid")?,
                    };
                    record.runtime.as_mut().unwrap().pending.push(pending);
                }
            }
            "event" => record.runtime.as_mut().unwrap().events.push(
                serde_json::from_value(known_fields(
                    &entry.data,
                    &["id", "runId", "sequence", "type", "data"],
                ))
                .map_err(|_| "native.ai.conversation.versionInvalid")?,
            ),
            "run" => {
                let run: Run = serde_json::from_value(known_fields(
                    &entry.data,
                    &["id", "state", "startedAt", "endedAt", "usage", "references"],
                ))
                .map_err(|_| "native.ai.conversation.versionInvalid")?;
                let runs = &mut record.runtime.as_mut().unwrap().runs;
                if let Some(previous) = runs.iter_mut().find(|previous| previous.id == run.id) {
                    *previous = run;
                } else {
                    runs.push(run);
                }
            }
            "inputStatus" => {
                if let Some(input) = record
                    .runtime
                    .as_mut()
                    .unwrap()
                    .pending
                    .iter_mut()
                    .find(|input| entry.data["inputId"] == input.id)
                {
                    input.state = if entry.data["state"] == "waiting" {
                        "pending"
                    } else {
                        "consumed"
                    }
                    .into();
                }
            }
            _ => {}
        }
    }
    if let Some(compaction) = &context.compaction {
        record.runtime.as_mut().unwrap().checkpoint = Some(Checkpoint {
            source_count: 0,
            summary: compaction.data["summary"]
                .as_str()
                .ok_or("native.ai.conversation.versionInvalid")?
                .into(),
            run_id: compaction.data["runId"]
                .as_str()
                .unwrap_or("retained")
                .into(),
        });
    }
    if let Some(legacy) = &metadata.legacy_draft {
        record.draft = legacy["text"]
            .as_str()
            .or_else(|| legacy["draft"].as_str())
            .unwrap_or_default()
            .into();
        if let Some(attachments) = legacy
            .get("attachments")
            .or_else(|| legacy.get("draftAttachments"))
        {
            record.runtime.as_mut().unwrap().draft_attachments =
                serde_json::from_value(attachments.clone())
                    .map_err(|_| "native.ai.conversation.versionInvalid")?;
        }
        if let Some(references) = legacy
            .get("references")
            .or_else(|| legacy.get("draftReferences"))
        {
            record.runtime.as_mut().unwrap().draft_references =
                serde_json::from_value(references.clone())
                    .map_err(|_| "native.ai.conversation.versionInvalid")?;
        }
    }
    for event in &mut record.runtime.as_mut().unwrap().events {
        if let Some(id) = event.data["resultEntryId"].as_str()
            && let Some(original) = context
                .entries
                .iter()
                .chain(context.active_entries.iter())
                .find(|entry| entry.id == id)
        {
            event.data["result"] = tool_result(&original.data["message"]);
        }
    }
    record
        .runtime
        .as_mut()
        .unwrap()
        .pending
        .retain(|input| input.state == "pending");
    if record.runtime.as_ref() == Some(&Runtime::default()) {
        record.runtime = None;
    }
    Ok((record, ids))
}

pub(crate) fn input_entry_id(id: &str) -> String {
    if id.len() <= 250 {
        format!("input-{id}")
    } else {
        id.to_owned()
    }
}

pub(crate) fn entry_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_nanos();
    format!(
        "entry-{timestamp:x}-{:x}-{:x}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

impl Batch {
    fn push(&mut self, kind: &str, data: Value, id: Option<String>) -> String {
        let id = id.unwrap_or_else(entry_id);
        self.entries.push(HistoryEntry::new(
            id.clone(),
            self.metadata.selected_entry_id.clone(),
            kind,
            data,
        ));
        self.metadata.selected_entry_id = Some(id.clone());
        id
    }

    pub(crate) fn build(
        metadata: &ConversationMetadata,
        old: &ConversationRecord,
        message_ids: &[String],
        next: &ConversationRecord,
    ) -> Self {
        let mut batch = Self {
            entries: vec![],
            metadata: metadata.clone(),
            expected_revision: metadata.revision,
            message_ids: message_ids.to_vec(),
            result_refs: vec![],
            clear_legacy_draft: metadata.legacy_draft.is_some()
                && actions::draft(next) == Input::default()
                && next.runtime.as_ref().is_some_and(|runtime| {
                    runtime.pending.iter().any(|input| {
                        !old.runtime.as_ref().is_some_and(|previous| {
                            previous
                                .pending
                                .iter()
                                .any(|previous| previous.id == input.id)
                        })
                    })
                }),
        };
        let empty = Runtime::default();
        let before = old.runtime.as_ref().unwrap_or(&empty);
        let after = next.runtime.as_ref().unwrap_or(&empty);
        let mut new_inputs = after.pending.iter().filter(|input| {
            !before
                .pending
                .iter()
                .any(|previous| previous.id == input.id)
        });
        for message in next
            .messages
            .as_array()
            .unwrap()
            .iter()
            .skip(old.messages.as_array().unwrap().len())
        {
            let pending = if message["role"] == "user" {
                new_inputs.next()
            } else {
                None
            };
            let mut data = json!({"message":message});
            if let Some(input) = pending {
                data["input"] = json!({"id":input.id,"kind":input.kind,"state":"waiting","attachments":input.attachments,"references":input.references,"timestamp":input.timestamp});
            }
            let id = batch.push(
                "message",
                data,
                pending.map(|input| input_entry_id(&input.id)),
            );
            batch.message_ids.push(id);
            if let Some(input) = pending.filter(|input| input.state != "pending") {
                batch.push(
                    "inputStatus",
                    json!({"inputId":input.id,"state":"consumed"}),
                    None,
                );
            }
            batch.metadata.message_count += 1;
            if message["role"] == "user" {
                batch.metadata.last_user_message_at = message["timestamp"].as_f64();
            }
        }
        for input in &before.pending {
            let next = after.pending.iter().find(|next| next.id == input.id);
            if next.is_none() || next.is_some_and(|next| next.state != input.state) {
                batch.push("inputStatus", json!({"inputId":input.id,"state":if next.is_none() {"recalled"} else {"consumed"}}), None);
            }
        }
        for event in after.events.iter().filter(|event| {
            !before
                .events
                .iter()
                .any(|old| old.run_id == event.run_id && old.id == event.id)
        }) {
            if event.kind == "action_accepted" {
                if event.data["action"]["type"] == "draft" {
                    continue;
                }
                let mut data =
                    json!({"actionId":event.run_id,"action":receipt(&event.data["action"])});
                if event.data["action"].get("input").is_some() {
                    data["inputEntryId"] = json!(input_entry_id(&event.run_id));
                }
                batch.push("action", data, None);
            } else {
                let mut stored = serde_json::to_value(event).unwrap();
                if event.kind == "input_accepted" {
                    stored["data"] = json!({"inputId":event.run_id});
                }
                if event.kind == "tool_execution_end"
                    && let Some((index, _)) = next
                        .messages
                        .as_array()
                        .unwrap()
                        .iter()
                        .enumerate()
                        .rev()
                        .find(|(_, message)| {
                            message["role"] == "toolResult"
                                && message["toolCallId"] == event.data["toolCallId"]
                        })
                {
                    stored["data"].as_object_mut().unwrap().remove("result");
                    stored["data"]["resultEntryId"] = json!(batch.message_ids[index]);
                    batch.result_refs.push((
                        event.run_id.clone(),
                        event.id.clone(),
                        batch.message_ids[index].clone(),
                    ));
                }
                batch.push("event", stored, None);
                batch.metadata.event_count += 1;
            }
        }
        for run in &after.runs {
            if before.runs.iter().find(|old| old.id == run.id) != Some(run) {
                batch.push("run", serde_json::to_value(run).unwrap(), None);
            }
        }
        if after.checkpoint != before.checkpoint
            && let Some(checkpoint) = &after.checkpoint
        {
            let id = entry_id();
            let first = batch
                .message_ids
                .get(checkpoint.source_count)
                .cloned()
                .unwrap_or_else(|| id.clone());
            batch.push("compaction", json!({"summary":checkpoint.summary,"firstKeptEntryId":first,"runId":checkpoint.run_id}), Some(id));
        }
        batch
    }
}

impl<H: Host> Owner<H> {
    pub(crate) async fn save_projection(
        &self,
        state: &mut State,
        next: &mut ConversationRecord,
    ) -> Result<(), SaveFailure> {
        let mut delta = next.clone();
        if state.batch.is_none() {
            let receipts: Vec<String> = delta
                .runtime
                .as_ref()
                .into_iter()
                .flat_map(|runtime| runtime.events.iter())
                .filter(|event| {
                    event.kind == "action_accepted" && event.data["action"]["type"] != "draft"
                })
                .map(|event| event.run_id.clone())
                .collect();
            for id in receipts {
                if self
                    .host
                    .action(id.clone())
                    .await
                    .map_err(SaveFailure::from)?
                    .is_some()
                {
                    delta
                        .runtime
                        .as_mut()
                        .unwrap()
                        .events
                        .retain(|event| event.kind != "action_accepted" || event.run_id != id);
                }
            }
        }
        let mut batch = state.batch.clone().unwrap_or_else(|| {
            Batch::build(
                &state.metadata,
                &state.saved,
                &state.snapshot.message_entry_ids,
                &delta,
            )
        });
        state.batch = Some(batch.clone());
        if !batch.entries.is_empty() {
            batch.metadata = self
                .host
                .append(
                    batch.expected_revision,
                    batch.entries.clone(),
                    batch.metadata.selected_entry_id.clone(),
                )
                .await?;
            batch.expected_revision = batch.metadata.revision;
            for entry in &batch.entries {
                if let Some(input_id) = entry.data["input"]["id"].as_str() {
                    state
                        .input_entry_ids
                        .insert(input_id.to_owned(), entry.id.clone());
                }
            }
            batch.entries.clear();
            state.batch = Some(batch.clone());
        }
        let mut metadata = batch.metadata.clone();
        metadata.title = next.title.clone();
        metadata.title_input = next.title_input.clone();
        metadata.development = next.development.clone();
        if batch.clear_legacy_draft {
            metadata.legacy_draft = None;
        }
        if metadata != batch.metadata {
            metadata = self
                .host
                .update_metadata(metadata, batch.expected_revision)
                .await?;
        }
        state.metadata = metadata;
        state.snapshot.selected_entry_id = state.metadata.selected_entry_id.clone();
        state.snapshot.has_history = state.metadata.message_count > 0;
        state.snapshot.message_entry_ids = batch.message_ids;
        for (run_id, event_id, entry_id) in batch.result_refs {
            if let Some(event) = next.runtime.as_mut().and_then(|runtime| {
                runtime
                    .events
                    .iter_mut()
                    .find(|event| event.run_id == run_id && event.id == event_id)
            }) {
                event.data["resultEntryId"] = json!(entry_id);
            }
        }
        state.saved = next.clone();
        state.saved.revision = state.metadata.revision;
        state.batch = None;
        Ok(())
    }
}
