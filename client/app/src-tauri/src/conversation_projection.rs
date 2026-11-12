use serde_json::json;
use situate_core::{ai_storage::Storage, conversation_history::HistoryEntry};

pub(crate) fn hydrate_event(
    storage: &Storage,
    conversation: &str,
    entry: &mut HistoryEntry,
) -> Result<(), String> {
    if entry.kind != "event" {
        return Ok(());
    }
    let Some(id) = entry.data["data"]["resultEntryId"].as_str() else {
        return Ok(());
    };
    let original = storage
        .find_conversation_entry(conversation, id)?
        .ok_or("native.ai.conversation.versionInvalid")?;
    if original.kind != "message" || original.data["message"]["role"] != "toolResult" {
        return Err("native.ai.conversation.versionInvalid".into());
    }
    let message = &original.data["message"];
    let mut result = json!({"content":message["content"],"details":message["details"]});
    if let Some(structured) = message.get("structuredContent") {
        result["structuredContent"] = structured.clone();
    }
    entry.data["data"]["result"] = result;
    Ok(())
}

fn image_block(attachment: &situate_core::attachment::AttachmentRef) -> Option<serde_json::Value> {
    matches!(attachment.mime_type.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp")
        .then(|| json!({"type":"image","mimeType":attachment.mime_type,"data":format!("attachment:{}",attachment.id)}))
}

pub(crate) fn attachment_block(
    storage: &Storage,
    attachment: &situate_core::attachment::AttachmentRef,
) -> Result<serde_json::Value, String> {
    let (retained, bytes) = storage.read_attachment(&attachment.id)?;
    if retained != *attachment {
        return Err("chat.attachmentUnsupported".into());
    }
    if let Some(image) = image_block(attachment) {
        return Ok(image);
    }
    if attachment.mime_type != "text/plain" {
        return Err("chat.attachmentUnsupported".into());
    }
    Ok(
        json!({"type":"text","text":format!("{}\n{}",attachment.name,String::from_utf8(bytes).map_err(|_| "chat.attachmentEncoding")?)}),
    )
}

pub(crate) fn hydrate_input(storage: &Storage, entry: &mut HistoryEntry) -> Result<(), String> {
    if entry.kind != "message" || entry.data["message"]["role"] != "user" {
        return Ok(());
    }
    let Some(attachments) = entry.data["input"].get("attachments") else {
        return Ok(());
    };
    let attachments: Vec<situate_core::attachment::AttachmentRef> =
        serde_json::from_value(attachments.clone())
            .map_err(|_| "native.ai.conversation.versionInvalid")?;
    if attachments.is_empty() {
        return Ok(());
    }
    let content = &entry.data["message"]["content"];
    let mut blocks = if let Some(text) = content.as_str() {
        if text.is_empty() {
            vec![]
        } else {
            vec![json!({"type":"text","text":text})]
        }
    } else {
        content
            .as_array()
            .cloned()
            .ok_or("native.ai.conversation.versionInvalid")?
    };
    for attachment in attachments {
        let block = image_block(&attachment).unwrap_or_else(|| {
            attachment_block(storage, &attachment)
                .unwrap_or_else(|_| json!({"type":"text","text":attachment.name}))
        });
        blocks.push(block);
    }
    entry.data["message"]["content"] = json!(blocks);
    Ok(())
}

pub(crate) async fn present_snapshot<F>(
    snapshot: situate_agent::Snapshot,
    validate: impl FnOnce() -> Result<(), String>,
    hydrate: impl FnOnce(situate_agent::Snapshot) -> F,
) -> Result<situate_agent::Snapshot, String>
where
    F: std::future::Future<Output = Result<situate_agent::Snapshot, String>>,
{
    validate()?;
    if snapshot.phase == situate_agent::Phase::PersistenceFailed {
        return Ok(snapshot);
    }
    hydrate(snapshot).await
}

pub(crate) fn snapshot_envelope(
    snapshot: &situate_agent::Snapshot,
    generation: &str,
) -> Result<serde_json::Value, String> {
    let messages = snapshot
        .record
        .messages
        .as_array()
        .ok_or("native.ai.conversation.versionInvalid")?;
    let mut value = serde_json::to_value(snapshot).map_err(|_| "native.ai.request.failed")?;
    if snapshot.phase == situate_agent::Phase::PersistenceFailed
        && snapshot.message_entry_ids.len() != messages.len()
    {
        value
            .as_object_mut()
            .ok_or("native.ai.conversation.versionInvalid")?
            .remove("messageEntryIds");
    }
    value["version"] = json!(1);
    value["generation"] = json!(generation);
    Ok(value)
}

pub(crate) fn hydrate_snapshot(
    storage: &Storage,
    snapshot: &mut situate_agent::Snapshot,
) -> Result<(), String> {
    let messages = snapshot
        .record
        .messages
        .as_array_mut()
        .ok_or("native.ai.conversation.versionInvalid")?;
    for (message, id) in messages.iter_mut().zip(&snapshot.message_entry_ids) {
        if message["role"] != "user" {
            continue;
        }
        if let Some(mut entry) = storage.find_conversation_entry(&snapshot.record.id, id)? {
            if entry.kind != "message" {
                continue;
            }
            entry.data["message"] = message.clone();
            hydrate_input(storage, &mut entry)?;
            *message = entry.data["message"].clone();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn attachment_fixture() -> (tempfile::TempDir, Storage) {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let storage = Storage::open(&root.path().canonicalize().unwrap(), "scope").unwrap();
        storage.create_conversation("chat", "Chat").unwrap();
        let image = storage
            .put_attachment("image/png", "pixel.png", b"\x89PNG\r\n\x1a\n")
            .unwrap();
        let text = storage
            .put_attachment("text/plain", "note.txt", b"Attached text")
            .unwrap();
        let input = HistoryEntry::new(
            "input",
            None,
            "message",
            json!({"message":{"role":"user","content":"Request","timestamp":1},"input":{"id":"request","kind":"steering","state":"waiting","timestamp":1,"attachments":[image,text],"references":[]}}),
        );
        let consumed = HistoryEntry::new(
            "consumed",
            Some("input".into()),
            "inputStatus",
            json!({"inputId":"request","state":"consumed"}),
        );
        storage
            .append_conversation_entries("chat", 0, &[input, consumed], Some("consumed"))
            .unwrap();
        (root, storage)
    }
    fn snapshot(storage: &Storage) -> situate_agent::Snapshot {
        situate_agent::Snapshot {
            record: storage.read_conversation("chat").unwrap().unwrap(),
            message_entry_ids: vec!["input".into()],
            selected_entry_id: Some("consumed".into()),
            history_before: None,
            message_offset: 0,
            event_offset: 0,
            has_history: true,
            phase: situate_agent::Phase::Idle,
            action_id: None,
            error: None,
            task_active: false,
            position: 7,
            partial_message: None,
            activity_comment: String::new(),
            question_busy: false,
        }
    }
    #[test]
    fn snapshots_present_user_attachments_without_changing_originals_or_starting_work() {
        let (root, storage) = attachment_fixture();
        let history = root
            .path()
            .join(".situate/conversations/chat/history.jsonl");
        let before = std::fs::read(&history).unwrap();
        let mut live = snapshot(&storage);
        hydrate_snapshot(&storage, &mut live).unwrap();
        assert_eq!(live.record.messages[0]["content"][1]["type"], "image");
        assert!(
            live.record.messages[0]["content"][1]["data"]
                .as_str()
                .unwrap()
                .starts_with("attachment:")
        );
        assert_eq!(
            live.record.messages[0]["content"][2]["text"],
            "note.txt\nAttached text"
        );
        assert_eq!(live.message_entry_ids, ["input"]);
        assert_eq!(
            snapshot_envelope(&live, "owner").unwrap()["messageEntryIds"],
            json!(["input"])
        );
        assert_eq!(
            (live.message_offset, live.event_offset, live.position),
            (0, 0, 7)
        );
        assert!(!live.task_active);
        assert_eq!(
            storage.read_conversation("chat").unwrap().unwrap().messages[0]["content"],
            "Request"
        );
        assert_eq!(std::fs::read(history).unwrap(), before);
    }
    #[tokio::test]
    async fn failed_persistence_keeps_unsaved_outcomes_without_accessing_the_presentation_loader() {
        let (_root, storage) = attachment_fixture();
        let mut retained = snapshot(&storage);
        retained.phase = situate_agent::Phase::PersistenceFailed;
        retained.error = Some("native.ai.conversation.saveFailed".into());
        retained.record.messages.as_array_mut().unwrap().push(json!({"role":"toolResult","toolCallId":"unsaved","toolName":"read","content":[{"type":"text","text":"Retained outcome"}],"isError":false,"timestamp":2}));
        let expected = serde_json::to_value(&retained).unwrap();
        let loads = std::cell::Cell::new(0);
        let presented = present_snapshot(
            retained.clone(),
            || Ok(()),
            |_| {
                loads.set(loads.get() + 1);
                std::future::ready(Err("scratch-index-disk-full".into()))
            },
        )
        .await
        .unwrap();
        assert_eq!(loads.get(), 0);
        assert_eq!(serde_json::to_value(&presented).unwrap(), expected);
        let wire = snapshot_envelope(&presented, "owner").unwrap();
        assert!(wire.get("messageEntryIds").is_none());
        assert_eq!(wire["record"], expected["record"]);
        assert_eq!(presented.message_entry_ids, ["input"]);
        let mut aligned = presented.clone();
        aligned.message_entry_ids.push("planned-outcome".into());
        assert_eq!(
            snapshot_envelope(&aligned, "owner").unwrap()["messageEntryIds"],
            json!(["input", "planned-outcome"])
        );
        let mut deferred = presented.clone();
        deferred.record.messages.as_array_mut().unwrap().push(json!({"role":"toolResult","toolCallId":"later","toolName":"read","content":[{"type":"text","text":"Later observed outcome"}],"isError":false,"timestamp":3}));
        let wire = snapshot_envelope(&deferred, "owner").unwrap();
        assert!(wire.get("messageEntryIds").is_none());
        assert_eq!(wire["record"]["messages"].as_array().unwrap().len(), 3);
        let error = present_snapshot(
            retained,
            || Err("native.workspace.session.inactive".into()),
            |_| {
                loads.set(loads.get() + 1);
                std::future::ready(Err("scratch-index-disk-full".into()))
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error, "native.workspace.session.inactive");
        assert_eq!(loads.get(), 0);
    }
    #[test]
    fn reopened_snapshots_and_older_pages_share_attachment_presentation() {
        let (root, storage) = attachment_fixture();
        drop(storage);
        let reopened = Storage::open(&root.path().canonicalize().unwrap(), "scope").unwrap();
        let mut snapshot = snapshot(&reopened);
        hydrate_snapshot(&reopened, &mut snapshot).unwrap();
        let mut page = reopened
            .read_conversation_history("chat", Some("consumed"), 1)
            .unwrap();
        assert_eq!(page.entries.len(), 1);
        let original = page.entries[0].clone();
        hydrate_input(&reopened, &mut page.entries[0]).unwrap();
        assert_eq!(page.entries[0].data["message"], snapshot.record.messages[0]);
        assert_eq!(page.entries[0].id, original.id);
        assert_eq!((page.message_offset, page.event_offset), (0, 0));
        assert_eq!(
            reopened
                .find_conversation_entry("chat", "input")
                .unwrap()
                .unwrap(),
            original
        );
    }
    #[test]
    fn missing_attachments_keep_the_message_names_and_image_reference_readable() {
        let (root, storage) = attachment_fixture();
        let original = storage
            .find_conversation_entry("chat", "input")
            .unwrap()
            .unwrap();
        for attachment in original.data["input"]["attachments"].as_array().unwrap() {
            std::fs::remove_file(root.path().join(format!(
                ".situate/attachment-{}.bin",
                attachment["id"].as_str().unwrap()
            )))
            .unwrap();
        }
        let mut snapshot = snapshot(&storage);
        hydrate_snapshot(&storage, &mut snapshot).unwrap();
        assert_eq!(snapshot.record.messages[0]["content"][0]["text"], "Request");
        assert!(
            snapshot.record.messages[0]["content"][1]["data"]
                .as_str()
                .unwrap()
                .starts_with("attachment:")
        );
        assert_eq!(
            snapshot.record.messages[0]["content"][2]["text"],
            "note.txt"
        );
        assert_eq!(
            storage
                .find_conversation_entry("chat", "input")
                .unwrap()
                .unwrap(),
            original
        );
    }
    #[test]
    fn streamed_history_keeps_user_attachment_content_and_references_accessible() {
        let (_root, storage) = attachment_fixture();
        let request = crate::file_tool::parse_native(
            "read_conversation",
            json!({"conversationId":"chat","limit":32768}),
        )
        .unwrap();
        let result = crate::file_tool::conversation_history(&storage, &request).unwrap();
        let history: serde_json::Value =
            serde_json::from_str(result["text"].as_str().unwrap()).unwrap();
        assert_eq!(history["messages"][0]["content"][1]["type"], "image");
        assert_eq!(
            history["messages"][0]["content"][2]["text"],
            "note.txt\nAttached text"
        );
        assert!(
            history["messages"][0]["content"][1]["data"]
                .as_str()
                .unwrap()
                .starts_with("attachment:")
        );
    }
    #[test]
    fn original_tool_details_are_loaded_without_replacing_the_transcript_window() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let storage = Storage::open(&root.path().canonicalize().unwrap(), "scope").unwrap();
        storage.create_conversation("chat", "Chat").unwrap();
        let original = HistoryEntry::new(
            "original",
            None,
            "message",
            json!({"message":{"role":"toolResult","toolCallId":"call","toolName":"read","content":[{"type":"text","text":"Original"}],"details":{"opaque":[7]},"isError":false,"timestamp":1}}),
        );
        let mut event = HistoryEntry::new(
            "event",
            Some("original".into()),
            "event",
            json!({"id":"end","runId":"run","sequence":1,"type":"tool_execution_end","data":{"toolCallId":"call","resultEntryId":"original"}}),
        );
        storage
            .append_conversation_entries("chat", 0, &[original, event.clone()], Some("event"))
            .unwrap();
        hydrate_event(&storage, "chat", &mut event).unwrap();
        assert_eq!(
            event.data["data"]["result"]["details"],
            json!({"opaque":[7]})
        );
        assert!(
            storage
                .find_conversation_entry("chat", "event")
                .unwrap()
                .unwrap()
                .data["data"]
                .get("result")
                .is_none()
        );
    }
}
