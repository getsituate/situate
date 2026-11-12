use crate::{MigrationError, MigrationErrorKind, MigrationId, MigrationWorkspace, filesystem};
use serde_json::{Map, Value, json};

pub struct Migration;

impl crate::Migration for Migration {
    const VERSION: MigrationId = MigrationId(2);
    const MINIMUM_APP_VERSION: Option<&'static str> = Some("0.1.6");

    fn apply(workspace: &MigrationWorkspace<'_>) -> Result<(), MigrationError> {
        let sources = sources(workspace)?;
        if sources.is_empty() {
            return Ok(());
        }
        if filesystem::exists(workspace.managed, "conversations")? {
            return Err(invalid());
        }
        workspace.create_dir("conversations")?;
        for name in &sources {
            let record: Value =
                serde_json::from_slice(&workspace.read(name)?).map_err(|_| invalid())?;
            let (metadata, entries) = convert(&record)?;
            let id = metadata["id"].as_str().ok_or_else(invalid)?;
            if *name != format!("native-conversation-{id}.json") {
                return Err(invalid());
            }
            let directory = format!("conversations/{id}");
            workspace.create_dir(&directory)?;
            let mut history = Vec::new();
            for entry in &entries {
                serde_json::to_writer(&mut history, entry).map_err(|_| invalid())?;
                history.push(b'\n');
            }
            workspace.write(format!("{directory}/history.jsonl"), &history)?;
            workspace.write(
                format!("{directory}/metadata.json"),
                &serde_json::to_vec(&metadata).map_err(|_| invalid())?,
            )?;
            verify(workspace, &metadata, &entries)?;
            filesystem::checkpoint("conversation-converted")?;
        }
        // The runner's recoverable backup still owns all original files here.
        for name in sources {
            workspace.remove_file(name)?;
            filesystem::checkpoint("conversation-source-removed")?;
        }
        Ok(())
    }

    fn validate(workspace: &MigrationWorkspace<'_>) -> Result<(), MigrationError> {
        if !sources(workspace)?.is_empty() {
            return Err(invalid());
        }
        if !filesystem::exists(workspace.managed, "conversations")? {
            return Ok(());
        }
        let conversations = filesystem::child(workspace.managed, "conversations")?;
        for id in filesystem::names(&conversations)? {
            if !valid_id(&id) {
                return Err(invalid());
            }
            let metadata: Value = serde_json::from_slice(
                &workspace.read(format!("conversations/{id}/metadata.json"))?,
            )
            .map_err(|_| invalid())?;
            let bytes = workspace.read(format!("conversations/{id}/history.jsonl"))?;
            let mut parent = Value::Null;
            if !bytes.is_empty() && !bytes.ends_with(b"\n") {
                return Err(invalid());
            }
            for line in bytes
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.is_empty())
            {
                let entry: Value = serde_json::from_slice(line).map_err(|_| invalid())?;
                if entry["version"] != 1 || entry["parentId"] != parent {
                    return Err(invalid());
                }
                parent = entry["id"].clone();
            }
            if metadata["version"] != 3
                || metadata["id"] != id
                || metadata["selectedEntryId"] != parent
            {
                return Err(invalid());
            }
        }
        Ok(())
    }
}

fn invalid() -> MigrationError {
    MigrationError::new(MigrationErrorKind::MigrationFailed)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

fn sources(workspace: &MigrationWorkspace<'_>) -> Result<Vec<String>, MigrationError> {
    Ok(filesystem::names(workspace.managed)?
        .into_iter()
        .filter(|name| name.starts_with("native-conversation-") && name.ends_with(".json"))
        .collect())
}

fn append(entries: &mut Vec<Value>, kind: &str, data: Value) -> String {
    let id = format!("migration-{}", entries.len() + 1);
    let parent = entries.last().map(|entry| entry["id"].clone());
    entries.push(json!({"version":1,"id":id,"parentId":parent,"type":kind,"data":data}));
    id
}

fn preserve(entries: &mut Vec<Value>, scope: &str, field: &str, value: &Value) {
    if let Some(values) = value.as_array() {
        for (index, value) in values.iter().enumerate() {
            append(
                entries,
                "legacy",
                json!({"scope":scope,"field":field,"index":index,"value":value}),
            );
        }
        if values.is_empty() {
            append(
                entries,
                "legacy",
                json!({"scope":scope,"field":field,"value":value}),
            );
        }
    } else {
        append(
            entries,
            "legacy",
            json!({"scope":scope,"field":field,"value":value}),
        );
    }
}

fn convert(record: &Value) -> Result<(Value, Vec<Value>), MigrationError> {
    let object = record.as_object().ok_or_else(invalid)?;
    let id = record["id"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or_else(invalid)?;
    let title = record["title"].as_str().ok_or_else(invalid)?;
    let revision = record["revision"].as_u64().ok_or_else(invalid)?;
    let messages = record["messages"].as_array().ok_or_else(invalid)?;
    let draft = record["draft"].as_str().ok_or_else(invalid)?;
    if record["version"] != 2 {
        return Err(invalid());
    }
    let runtime = match record.get("runtime") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_object().ok_or_else(invalid)?),
    };
    let mut entries = Vec::new();
    let mut message_ids = Vec::new();
    for message in messages {
        if !message.is_object() || !message["role"].is_string() || message.get("content").is_none()
        {
            return Err(invalid());
        }
        message_ids.push(append(&mut entries, "message", json!({"message":message})));
    }
    let mut metadata = json!({
        "version":3,"id":id,"title":title,"revision":revision,"selectedEntryId":null,
        "messageCount":0,"eventCount":0
    });
    for field in ["titleInput", "development"] {
        if let Some(value) = object.get(field) {
            metadata[field] = value.clone();
        }
    }
    if let Some(timestamp) = messages
        .iter()
        .rev()
        .find(|message| message["role"] == "user")
        .and_then(|message| message.get("timestamp"))
    {
        metadata["lastUserMessageAt"] = timestamp.clone();
    }
    let empty = Map::new();
    let runtime = runtime.unwrap_or(&empty);
    let draft_attachments = runtime
        .get("draftAttachments")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let draft_references = runtime
        .get("draftReferences")
        .cloned()
        .unwrap_or_else(|| json!([]));
    if !draft.is_empty()
        || draft_attachments
            .as_array()
            .is_none_or(|values| !values.is_empty())
        || draft_references
            .as_array()
            .is_none_or(|values| !values.is_empty())
    {
        metadata["legacyDraft"] = json!({
            "text":draft,"attachments":draft_attachments,"references":draft_references
        });
    }
    for (field, kind) in [("events", "event"), ("runs", "run")] {
        if let Some(value) = runtime.get(field) {
            for value in value.as_array().ok_or_else(invalid)? {
                append(&mut entries, kind, value.clone());
            }
        }
    }
    if let Some(pending) = runtime.get("pending") {
        for input in pending.as_array().ok_or_else(invalid)? {
            if input["state"] == "pending" {
                let text = input["text"].as_str().ok_or_else(invalid)?;
                let mut attributes = input.as_object().ok_or_else(invalid)?.clone();
                attributes.remove("text");
                attributes.entry("references").or_insert_with(|| json!([]));
                attributes.insert("state".into(), json!("waiting"));
                let message = json!({"role":"user","content":text,"timestamp":input["timestamp"]});
                append(
                    &mut entries,
                    "message",
                    json!({"message":message,"input":attributes}),
                );
            } else {
                preserve(&mut entries, "runtime", "pending", input);
            }
        }
    }
    if let Some(checkpoint) = runtime.get("checkpoint").filter(|value| !value.is_null()) {
        let count = checkpoint["sourceCount"].as_u64().ok_or_else(invalid)?;
        let count = usize::try_from(count).map_err(|_| invalid())?;
        let summary = checkpoint["summary"].as_str().ok_or_else(invalid)?;
        if count > message_ids.len() {
            return Err(invalid());
        }
        let first = message_ids
            .get(count)
            .cloned()
            .unwrap_or_else(|| format!("migration-{}", entries.len() + 1));
        append(
            &mut entries,
            "compaction",
            json!({
                "summary":summary,"firstKeptEntryId":first,"runId":checkpoint["runId"]
            }),
        );
        let extra: Map<String, Value> = checkpoint
            .as_object()
            .ok_or_else(invalid)?
            .iter()
            .filter(|(field, _)| !matches!(field.as_str(), "sourceCount" | "summary" | "runId"))
            .map(|(field, value)| (field.clone(), value.clone()))
            .collect();
        if !extra.is_empty() {
            preserve(&mut entries, "runtime", "checkpoint", &Value::Object(extra));
        }
    }
    for (field, value) in runtime {
        if !matches!(
            field.as_str(),
            "draftAttachments" | "draftReferences" | "pending" | "events" | "runs" | "checkpoint"
        ) {
            preserve(&mut entries, "runtime", field, value);
        }
    }
    for (field, value) in object {
        if !matches!(
            field.as_str(),
            "id" | "title"
                | "titleInput"
                | "revision"
                | "messages"
                | "draft"
                | "development"
                | "runtime"
        ) {
            preserve(&mut entries, "record", field, value);
        }
    }
    metadata["messageCount"] = json!(
        entries
            .iter()
            .filter(|entry| entry["type"] == "message")
            .count()
    );
    metadata["eventCount"] = json!(
        entries
            .iter()
            .filter(|entry| entry["type"] == "event")
            .count()
    );
    metadata["selectedEntryId"] = entries
        .last()
        .map(|entry| entry["id"].clone())
        .unwrap_or(Value::Null);
    Ok((metadata, entries))
}

fn verify(
    workspace: &MigrationWorkspace<'_>,
    metadata: &Value,
    entries: &[Value],
) -> Result<(), MigrationError> {
    let id = metadata["id"].as_str().ok_or_else(invalid)?;
    let saved_metadata: Value =
        serde_json::from_slice(&workspace.read(format!("conversations/{id}/metadata.json"))?)
            .map_err(|_| invalid())?;
    if saved_metadata != *metadata {
        return Err(invalid());
    }
    let history = workspace.read(format!("conversations/{id}/history.jsonl"))?;
    let saved: Vec<Value> = history
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_slice(line).map_err(|_| invalid()))
        .collect::<Result<_, _>>()?;
    if saved != entries {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../tests/support/conversation_conversion.rs"]
mod tests;
