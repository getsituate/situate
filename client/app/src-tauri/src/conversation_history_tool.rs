use serde_json::{Value, json};
use situate_core::{
    ai_storage::Storage,
    conversation_history::{ConversationHistoryReader, HistoryReadEntry},
};
use std::io::Write;

const FAILED: &str = "native.ai.storage.failed";

struct Window {
    offset: usize,
    limit: usize,
    total: usize,
    bytes: Vec<u8>,
}
impl Write for Window {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let start = self.offset.saturating_sub(self.total).min(bytes.len());
        let end = self
            .offset
            .saturating_add(self.limit)
            .saturating_add(4)
            .saturating_sub(self.total)
            .min(bytes.len());
        if start < end {
            self.bytes.extend_from_slice(&bytes[start..end]);
        }
        self.total = self.total.saturating_add(bytes.len());
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl Window {
    fn value(&mut self, value: &impl serde::Serialize) -> Result<(), String> {
        serde_json::to_writer(self, value).map_err(|_| FAILED.into())
    }
    fn literal(&mut self, value: &[u8]) -> Result<(), String> {
        self.write_all(value).map_err(|_| FAILED.into())
    }
    fn finish(self) -> Result<Value, String> {
        if self.offset > self.total {
            return Err("native.content.base.mismatch".into());
        }
        let text = match std::str::from_utf8(&self.bytes) {
            Ok(text) => text,
            Err(error) if error.error_len().is_none() => {
                std::str::from_utf8(&self.bytes[..error.valid_up_to()])
                    .map_err(|_| "native.content.base.mismatch")?
            }
            Err(_) => return Err("native.content.base.mismatch".into()),
        };
        let mut end = self.limit.min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        if end == 0 && !text.is_empty() {
            end = text.chars().next().unwrap().len_utf8();
        }
        let next = self.offset + end;
        Ok(
            json!({"text":&text[..end],"offset":self.offset,"nextOffset":(next < self.total).then_some(next),"totalBytes":self.total}),
        )
    }
}

#[cfg(test)]
thread_local! {static HISTORY_VISITS:std::cell::Cell<usize>=const {std::cell::Cell::new(0)};}
fn chronological(
    reader: &mut ConversationHistoryReader<'_>,
    mut visit: impl FnMut(HistoryReadEntry) -> Result<(), String>,
) -> Result<(), String> {
    reader.rewind()?;
    while let Some(entry) = reader.next_entry()? {
        #[cfg(test)]
        HISTORY_VISITS.set(HISTORY_VISITS.get() + 1);
        visit(entry)?;
    }
    Ok(())
}

pub(crate) fn read(
    storage: &Storage,
    id: &str,
    revision: Option<u64>,
    offset: usize,
    limit: usize,
) -> Result<Value, String> {
    let mut history = storage.conversation_history_reader(id, revision)?;
    let record_revision = history.metadata().revision;
    let record_id = history.metadata().id.clone();
    let record_title = history.metadata().title.clone();
    let mut output = Window {
        offset,
        limit: limit.clamp(1, 32_768),
        total: 0,
        bytes: Vec::new(),
    };
    output.literal(b"{\"events\":[")?;
    let mut first = true;
    chronological(&mut history, |item| {
        let mut entry = item.entry;
        if entry.kind == "event"
            && !matches!(
                entry.data["type"].as_str(),
                Some("action_accepted" | "input_accepted")
            )
        {
            if !first {
                output.literal(b",")?;
            }
            first = false;
            crate::conversation_projection::hydrate_event(storage, id, &mut entry)?;
            output.value(&entry.data)?;
        }
        Ok(())
    })?;
    output.literal(b"],\"id\":")?;
    output.value(&record_id)?;
    output.literal(b",\"messages\":[")?;
    first = true;
    chronological(&mut history, |item| {
        let mut entry = item.entry;
        if entry.kind != "message" {
            return Ok(());
        }
        if entry.data.get("input").is_some() && !item.input_consumed {
            return Ok(());
        }
        if !first {
            output.literal(b",")?;
        }
        first = false;
        crate::conversation_projection::hydrate_input(storage, &mut entry)?;
        output.value(&entry.data["message"])
    })?;
    output.literal(b"],\"runs\":[")?;
    first = true;
    chronological(&mut history, |item| {
        let entry = item.entry;
        if entry.kind != "run" || !item.latest_run {
            return Ok(());
        }
        if !first {
            output.literal(b",")?;
        }
        first = false;
        output.value(&entry.data)
    })?;
    output.literal(b"],\"title\":")?;
    output.value(&record_title)?;
    output.literal(b"}")?;
    history.validate()?;
    let mut result = output.finish()?;
    result["recordRevision"] = json!(record_revision);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use situate_core::conversation_history::HistoryEntry;

    #[test]
    fn original_outcomes_attachments_and_latest_selected_runs_keep_exact_serialization() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let storage = Storage::open(&root.path().canonicalize().unwrap(), "scope").unwrap();
        storage.create_conversation("chat", "Chat é🙂").unwrap();
        let attachment = storage
            .put_attachment("text/plain", "notes.txt", b"Saved attachment")
            .unwrap();
        let input = json!({"role":"user","content":"Ask é🙂","timestamp":1});
        let result = json!({"role":"toolResult","toolCallId":"call","toolName":"read","content":[{"type":"text","text":"Observed output"}],"details":{"path":"note.txt"},"structuredContent":{"rows":1},"isError":false,"timestamp":2});
        let event = json!({"id":"ended","runId":"run","sequence":1,"type":"tool_execution_end","data":{"toolCallId":"call","resultEntryId":"result","isError":false}});
        let completed = json!({"id":"run","state":"completed","startedAt":1,"endedAt":2,"opaque":{"retained":true}});
        let entries = [
            HistoryEntry::new(
                "running",
                None,
                "run",
                json!({"id":"run","state":"running","startedAt":1}),
            ),
            HistoryEntry::new(
                "input",
                Some("running".into()),
                "message",
                json!({"message":input,"input":{"id":"request","kind":"followUp","state":"waiting","attachments":[attachment],"references":[],"timestamp":1}}),
            ),
            HistoryEntry::new(
                "consumed",
                Some("input".into()),
                "inputStatus",
                json!({"inputId":"request","state":"consumed"}),
            ),
            HistoryEntry::new(
                "result",
                Some("consumed".into()),
                "message",
                json!({"message":result}),
            ),
            HistoryEntry::new("event", Some("result".into()), "event", event.clone()),
            HistoryEntry::new("completed", Some("event".into()), "run", completed.clone()),
            HistoryEntry::new(
                "fork-recall",
                Some("input".into()),
                "inputStatus",
                json!({"inputId":"request","state":"recalled"}),
            ),
            HistoryEntry::new(
                "fork-run",
                Some("fork-recall".into()),
                "run",
                json!({"id":"run","state":"error","startedAt":1}),
            ),
            HistoryEntry::new(
                "summary",
                Some("completed".into()),
                "compaction",
                json!({"summary":"Not an original","firstKeptEntryId":"summary"}),
            ),
        ];
        let saved = storage
            .append_conversation_entries("chat", 0, &entries, Some("summary"))
            .unwrap();
        let mut hydrated_input = input;
        hydrated_input["content"] = json!([{"type":"text","text":"Ask é🙂"},{"type":"text","text":"notes.txt\nSaved attachment"}]);
        let mut hydrated_event = event;
        hydrated_event["data"]["result"] = json!({"content":result["content"],"details":result["details"],"structuredContent":result["structuredContent"]});
        let expected=serde_json::to_string(&json!({"events":[hydrated_event],"id":"chat","messages":[hydrated_input,result],"runs":[completed],"title":"Chat é🙂"})).unwrap();
        let full = read(&storage, "chat", Some(saved.revision), 0, usize::MAX).unwrap();
        assert_eq!(full["text"], expected);
        assert_eq!(full["totalBytes"], expected.len());
        assert_eq!(full["recordRevision"], saved.revision);
        assert!(full["nextOffset"].is_null());
        let accent = expected.find('é').unwrap();
        let unicode = read(&storage, "chat", None, accent, 1).unwrap();
        assert_eq!(unicode["text"], "é");
        assert_eq!(unicode["offset"], accent);
        assert_eq!(unicode["nextOffset"], accent + 2);
        assert_eq!(
            read(&storage, "chat", None, accent + 1, 17),
            Err("native.content.base.mismatch".into())
        );
        assert_eq!(
            read(&storage, "chat", None, expected.len() + 1, 17),
            Err("native.content.base.mismatch".into())
        );
        assert_eq!(read(&storage, "chat", None, 0, 0).unwrap()["text"], "{");
        assert_eq!(
            read(&storage, "chat", Some(saved.revision + 1), 0, 1),
            Err("native.ai.conversation.conflict".into())
        );
    }

    #[test]
    fn each_history_query_visits_selected_entries_only_three_times_as_inputs_and_runs_grow() {
        for count in [40usize, 400, 1200] {
            let root = tempfile::tempdir().unwrap();
            std::fs::create_dir(root.path().join(".situate")).unwrap();
            let storage = Storage::open(&root.path().canonicalize().unwrap(), "scope").unwrap();
            storage.create_conversation("chat", "Chat").unwrap();
            let mut entries = Vec::new();
            let mut parent = None;
            let mut messages = Vec::new();
            let mut runs = Vec::new();
            for i in 0..count {
                let input_id = format!("input-{i}");
                let request = format!("request-{i}");
                let message =
                    json!({"role":"user","content":format!("Original {i} é🙂"),"timestamp":i});
                entries.push(HistoryEntry::new(&input_id,parent,"message",json!({"message":message,"input":{"id":request,"kind":"followUp","state":"waiting","attachments":[],"references":[],"timestamp":i}})));
                let status = format!("status-{i}");
                let state = ["consumed", "waiting", "recalled"][i % 3];
                entries.push(HistoryEntry::new(
                    &status,
                    Some(input_id.clone()),
                    "inputStatus",
                    json!({"inputId":request,"state":state}),
                ));
                if state == "consumed" {
                    messages.push(message);
                }
                let run = format!("run-{i}");
                let start = format!("start-{i}");
                let end = format!("end-{i}");
                entries.push(HistoryEntry::new(
                    &start,
                    Some(status),
                    "run",
                    json!({"id":run,"state":"running","startedAt":i}),
                ));
                let completed = json!({"id":run,"state":"completed","startedAt":i,"endedAt":i+1});
                entries.push(HistoryEntry::new(
                    &end,
                    Some(start),
                    "run",
                    completed.clone(),
                ));
                runs.push(completed);
                parent = Some(end);
                let fork = format!("fork-{i}");
                entries.push(HistoryEntry::new(
                    &fork,
                    Some(input_id),
                    "inputStatus",
                    json!({"inputId":request,"state":"recalled"}),
                ));
                entries.push(HistoryEntry::new(
                    format!("fork-run-{i}"),
                    Some(fork),
                    "run",
                    json!({"id":run,"state":"error","startedAt":i}),
                ));
            }
            let saved = storage
                .append_conversation_entries("chat", 0, &entries, parent.as_deref())
                .unwrap();
            let expected = serde_json::to_string(
                &json!({"events":[],"id":"chat","messages":messages,"runs":runs,"title":"Chat"}),
            )
            .unwrap();
            HISTORY_VISITS.set(0);
            let output = read(&storage, "chat", Some(saved.revision), 0, usize::MAX).unwrap();
            let visits = HISTORY_VISITS.get();
            assert_eq!(visits, count * 4 * 3);
            assert_eq!(output["totalBytes"], expected.len());
            let text = output["text"].as_str().unwrap();
            assert_eq!(text, &expected[..text.len()]);
            assert!(text.len() <= 32768);
            println!(
                "selected_entries={} serializer_entry_visits={visits}",
                count * 4
            );
        }
    }

    #[test]
    fn utf8_windows_stay_bounded_and_reject_offsets_inside_characters() {
        let text = "aé🙂z";
        let mut window = Window {
            offset: 1,
            limit: 1,
            total: 0,
            bytes: vec![],
        };
        for byte in text.as_bytes() {
            window.write_all(&[*byte]).unwrap();
        }
        assert!(window.bytes.len() <= 5);
        let result = window.finish().unwrap();
        assert_eq!(result["text"], "é");
        assert_eq!(result["nextOffset"], 3);
        let mut window = Window {
            offset: 2,
            limit: 2,
            total: 0,
            bytes: vec![],
        };
        window.write_all(text.as_bytes()).unwrap();
        assert!(window.finish().is_err());
    }
    #[test]
    fn history_spans_store_pages_without_summaries_or_waiting_and_recalled_inputs() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let storage = Storage::open(&root.path().canonicalize().unwrap(), "scope").unwrap();
        storage.create_conversation("chat", "Chat").unwrap();
        let mut entries = vec![];
        let mut parent = None;
        for index in 0..205 {
            let id = format!("message-{index}");
            entries.push(HistoryEntry::new(id.clone(), parent, "message", json!({"message":{"role":"user","content":format!("Original {index} é🙂"),"timestamp":index}})));
            parent = Some(id);
        }
        for (id, state) in [
            ("waiting", "waiting"),
            ("recalled", "recalled"),
            ("consumed", "consumed"),
        ] {
            entries.push(HistoryEntry::new(id, parent, "message", json!({"message":{"role":"user","content":id,"timestamp":206},"input":{"id":id,"kind":"followUp","state":"waiting","attachments":[],"references":[],"timestamp":206}})));
            let status_id = format!("status-{id}");
            entries.push(HistoryEntry::new(
                status_id.clone(),
                Some(id.into()),
                "inputStatus",
                json!({"inputId":id,"state":state}),
            ));
            parent = Some(status_id);
        }
        entries.push(HistoryEntry::new(
            "summary",
            parent,
            "compaction",
            json!({"summary":"Summary is not original history","firstKeptEntryId":"message-200"}),
        ));
        let saved = storage
            .append_conversation_entries("chat", 0, &entries, Some("summary"))
            .unwrap();
        let mut offset = 0;
        let mut source = String::new();
        loop {
            let page = read(&storage, "chat", Some(saved.revision), offset, 997).unwrap();
            source.push_str(page["text"].as_str().unwrap());
            match page["nextOffset"].as_u64() {
                Some(next) => offset = next as usize,
                None => break,
            }
        }
        let value: Value = serde_json::from_str(&source).unwrap();
        let messages = value["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 206);
        assert_eq!(messages[0]["content"], "Original 0 é🙂");
        assert_eq!(messages[204]["content"], "Original 204 é🙂");
        assert_eq!(messages[205]["content"], "consumed");
        assert!(!source.contains("Summary is not original history"));
        assert!(!source.contains("waiting"));
        assert!(!source.contains("recalled"));
    }
}
