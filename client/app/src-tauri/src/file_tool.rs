use serde::Deserialize;
use serde_json::{Value, json};
use situate_core::content::ExactEdit;
#[path = "conversation_history_tool.rs"]
mod conversation_history_tool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolRequest {
    pub operation: String,
    #[serde(default)]
    pub prepare_copy: bool,
    #[serde(default)]
    pub path: String,
    pub text: Option<String>,
    pub entries: Option<Vec<situate_core::content::PreparedFile>>,
    pub expected_revision: Option<String>,
    pub revision: Option<String>,
    pub conversation_id: Option<String>,
    pub record_revision: Option<u64>,
    #[serde(default)]
    pub edits: Vec<ExactEdit>,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
    pub command: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Arguments {
    operation: String,
    #[serde(default = "empty_arguments")]
    arguments: Value,
}
fn empty_arguments() -> Value {
    serde_json::json!({})
}
impl Arguments {
    fn parse(&self) -> Result<ToolRequest, String> {
        let mut arguments = self
            .arguments
            .as_object()
            .cloned()
            .ok_or("native.content.base.mismatch")?;
        let allowed: &[&str] = match self.operation.as_str() {
            "read" => &["path", "offset", "limit"],
            "history" => &["path", "offset", "limit"],
            "read_revision" => &["path", "revision", "offset", "limit"],
            "list_conversations" => &["offset", "limit"],
            "read_conversation" => &["conversationId", "recordRevision", "offset", "limit"],
            "ls" => &["path", "offset", "limit"],
            "find" | "grep" => &["path", "query", "offset", "limit"],
            "write" => &["path", "text", "expectedRevision", "prepareCopy"],
            "create_batch" => &["entries", "manifestPath", "prepareCopy"],
            "edit" => &["path", "expectedRevision", "edits"],
            "shell" => &["command", "timeoutMs"],
            "capabilities" | "instructions" => &[],
            _ => return Err("native.content.base.mismatch".into()),
        };
        if arguments.keys().any(|key| !allowed.contains(&key.as_str()))
            || self.operation == "write" && !arguments.contains_key("expectedRevision")
        {
            return Err("native.content.base.mismatch".into());
        }
        if self.operation == "create_batch" {
            if arguments.contains_key("manifestPath") == arguments.contains_key("entries") {
                return Err("native.content.base.mismatch".into());
            }
            if let Some(path) = arguments.remove("manifestPath") {
                arguments.insert("path".into(), path);
            }
        }
        arguments.insert("operation".into(), Value::String(self.operation.clone()));
        let parsed: ToolRequest = serde_json::from_value(Value::Object(arguments))
            .map_err(|_| "native.content.base.mismatch")?;
        parsed.validate()?;
        Ok(parsed)
    }
}

pub(crate) fn parse_native(operation: &str, arguments: Value) -> Result<ToolRequest, String> {
    Arguments {
        operation: operation.into(),
        arguments,
    }
    .parse()
}

impl ToolRequest {
    fn validate(&self) -> Result<(), String> {
        if self.entries.is_some() && self.operation != "create_batch"
            || self.path.len() > 4096
            || self.query.len() > 1024
            || self.edits.len() > 100
            || self
                .text
                .as_ref()
                .is_some_and(|text| text.len() > 1_048_576)
            || self
                .edits
                .iter()
                .map(|edit| edit.old_text.len().saturating_add(edit.new_text.len()))
                .sum::<usize>()
                > 1_048_576
            || self.limit.is_some_and(|limit| {
                limit == 0
                    || limit
                        > if matches!(
                            self.operation.as_str(),
                            "read" | "read_revision" | "read_conversation"
                        ) {
                            32_768
                        } else {
                            200
                        }
            })
        {
            return Err("native.content.base.mismatch".into());
        }
        if self.prepare_copy
            && (self.operation != "write" && self.operation != "create_batch"
                || self.expected_revision.is_some())
        {
            return Err("native.content.base.mismatch".into());
        }
        let valid = match self.operation.as_str() {
            "capabilities" | "instructions" | "ls" | "find" => true,
            "read" | "history" => !self.path.is_empty(),
            "create_batch" => match &self.entries {
                Some(entries) => {
                    self.path.is_empty() && !entries.is_empty() && entries.len() <= 256
                }
                None => !self.path.is_empty(),
            },
            "read_revision" => !self.path.is_empty() && self.revision.is_some(),
            "list_conversations" => true,
            "read_conversation" => self
                .conversation_id
                .as_ref()
                .is_some_and(|id| !id.is_empty() && id.len() <= 64),
            "grep" => !self.query.is_empty(),
            "write" => !self.path.is_empty() && self.text.is_some(),
            "edit" => {
                !self.path.is_empty() && self.expected_revision.is_some() && !self.edits.is_empty()
            }
            "shell" => {
                self.command
                    .as_ref()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 65_536)
                    && self.timeout_ms.is_none_or(|t| (1..=300_000).contains(&t))
            }
            _ => false,
        };
        if valid {
            Ok(())
        } else {
            Err("native.content.base.mismatch".into())
        }
    }
}

pub(crate) fn entries_page(
    entries: Vec<Value>,
    offset: usize,
    limit: usize,
) -> Result<Value, String> {
    if offset > entries.len() {
        return Err("native.content.base.mismatch".into());
    }
    let end = offset
        .saturating_add(limit.clamp(1, 200))
        .min(entries.len());
    Ok(
        json!({"entries":&entries[offset..end],"nextOffset":(end < entries.len()).then_some(end),"total":entries.len()}),
    )
}

pub(crate) fn conversation_history(
    storage: &situate_core::ai_storage::Storage,
    request: &ToolRequest,
) -> Result<Value, String> {
    if request.operation == "list_conversations" {
        let entries = storage
            .list_conversations()?
            .into_iter()
            .map(|entry| {
                serde_json::to_value(entry).map_err(|_| "native.ai.storage.failed".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        return entries_page(entries, request.offset, request.limit.unwrap_or(100));
    }
    let id = request
        .conversation_id
        .as_deref()
        .ok_or("native.ai.conversation.invalidId")?;
    conversation_history_tool::read(
        storage,
        id,
        request.record_revision,
        request.offset,
        request.limit.unwrap_or(16_384),
    )
}

pub(crate) fn text_page(text: &str, offset: usize, limit: usize) -> Result<Value, String> {
    if offset > text.len() || !text.is_char_boundary(offset) {
        return Err("native.content.base.mismatch".into());
    }
    let mut end = offset
        .saturating_add(limit.clamp(1, 32_768))
        .min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    if end == offset && end < text.len() {
        end += text[offset..].chars().next().unwrap().len_utf8();
    }
    Ok(
        serde_json::json!({"text":&text[offset..end],"offset":offset,"nextOffset":(end < text.len()).then_some(end),"totalBytes":text.len()}),
    )
}

pub(crate) fn search(
    request: &ToolRequest,
    entries: Vec<Value>,
    read: impl Fn(&str) -> Result<Vec<u8>, String>,
    check_cancelled: impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    if !request.path.is_empty() && crate::plugin_source_files::target(&request.path)?.is_none() {
        situate_core::content::validate_provider_path(&request.path)
            .map_err(|error| error.to_string())?;
    }
    let prefix = if request.path.is_empty() {
        String::new()
    } else {
        format!("{}/", request.path.trim_end_matches('/'))
    };
    let mut results = Vec::new();
    let limit = request.limit.unwrap_or(100).clamp(1, 200);
    let mut matched = 0usize;
    let mut collect = |entry: Value| {
        if matched >= request.offset {
            results.push(entry);
        }
        matched = matched.saturating_add(1);
        results.len() > limit
    };
    'scan: for entry in entries {
        check_cancelled()?;
        let path = entry["path"].as_str().unwrap_or("");
        if !path.starts_with(&prefix) && !(request.operation == "grep" && path == request.path) {
            continue;
        }
        match request.operation.as_str() {
            "ls" if !path[prefix.len()..].contains('/') => {
                if collect(entry) {
                    break;
                }
            }
            "find" if path.contains(&request.query) => {
                if collect(entry) {
                    break;
                }
            }
            "grep" if entry["isDirectory"] == false => {
                if request.query.is_empty() {
                    return Err("native.content.base.mismatch".into());
                }
                let bytes = match read(path) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        if collect(json!({"path":path,"error":error})) {
                            break;
                        }
                        continue;
                    }
                };
                if let Ok(text) = String::from_utf8(bytes) {
                    for (line, text) in text.lines().enumerate() {
                        check_cancelled()?;
                        if text.contains(&request.query)
                            && collect(
                                json!({"path":path,"line":line+1,"text":text_page(text,0,1024)?["text"]}),
                            )
                        {
                            break 'scan;
                        }
                    }
                }
            }
            "ls" | "find" | "grep" => {}
            _ => return Err("native.files.operation.unavailable".into()),
        }
    }
    let more = results.len() > limit;
    results.truncate(limit);
    Ok(json!({"entries":results,"nextOffset":more.then_some(request.offset.saturating_add(limit))}))
}

pub(crate) fn instructions(
    entries: &[Value],
    read: impl Fn(&str) -> Result<Vec<u8>, String>,
) -> Result<String, String> {
    let mut paths: Vec<_> = entries
        .iter()
        .filter_map(|entry| entry["path"].as_str())
        .filter(|path| *path == situate_core::content::WORKING_METHOD_PATH)
        .collect();
    paths.sort_unstable();
    paths.dedup();
    let mut result = String::new();
    for path in paths {
        let header = format!("\n## {path}\n");
        if result.len() + header.len() + 128 >= 32_768 {
            break;
        }
        let text = String::from_utf8(read(path)?).map_err(|_| "native.files.history.notText")?;
        let source = text.as_str();
        let page = text_page(
            source,
            0,
            (32_768 - result.len() - header.len() - 128).min(8192),
        )?;
        result.push_str(&header);
        result.push_str(page["text"].as_str().unwrap_or(""));
        if !page["nextOffset"].is_null() {
            result.push_str("\nUse the workspace read tool on this path for full instructions.\n");
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::conversation_fixtures::FixtureConversations;
    use serde_json::json;

    #[test]
    fn copy_preparation_is_explicit_and_only_for_new_publication() {
        let value = json!({"operation":"write", "arguments":{"path":"created.md","text":"# Note","expectedRevision":null,"prepareCopy":true}});
        let request: super::Arguments = serde_json::from_value(value.clone()).unwrap();
        let parsed = request.parse().unwrap();
        assert_eq!(parsed.operation, "write");
        assert!(parsed.prepare_copy);
        assert!(parsed.expected_revision.is_none());
        let mut existing = value.clone();
        existing["arguments"]["expectedRevision"] = json!("revision");
        assert!(
            serde_json::from_value::<super::Arguments>(existing)
                .unwrap()
                .parse()
                .is_err()
        );
        let mut ordinary = value.clone();
        ordinary["arguments"]
            .as_object_mut()
            .unwrap()
            .remove("prepareCopy");
        assert!(
            !serde_json::from_value::<super::Arguments>(ordinary)
                .unwrap()
                .parse()
                .unwrap()
                .prepare_copy
        );
        for operation in ["import_copy", "import_copy_batch"] {
            let mut obsolete = value.clone();
            obsolete["operation"] = json!(operation);
            assert!(
                serde_json::from_value::<super::Arguments>(obsolete)
                    .unwrap()
                    .parse()
                    .is_err()
            );
        }
    }

    #[test]
    fn batch_creation_accepts_only_an_explicit_manifest_path() {
        let value = json!({"operation":"create_batch","arguments":{"manifestPath":".situate/batch-test.jsonl"}});
        let request: super::Arguments = serde_json::from_value(value.clone()).unwrap();
        let parsed = request.parse().unwrap();
        assert_eq!(parsed.path, ".situate/batch-test.jsonl");
        assert_eq!(parsed.operation, "create_batch");
        for arguments in [
            json!({}),
            json!({"manifestPath":""}),
            json!({"path":".situate/batch-test.jsonl"}),
            json!({"manifestPath":".situate/batch-test.jsonl","copyIdentities":true}),
            json!({"manifestPath":".situate/batch-test.jsonl","expectedRevision":null}),
        ] {
            let mut invalid = value.clone();
            invalid["arguments"] = arguments;
            assert!(
                serde_json::from_value::<super::Arguments>(invalid)
                    .unwrap()
                    .parse()
                    .is_err()
            );
        }
    }

    #[test]
    fn direct_batch_arguments_require_exactly_one_input_and_valid_entries() {
        let entries = json!([
            {"path":"note.md","text":"# Note"},
            {"path":"photo.png","sourcePath":"/authorized/photo.png"}
        ]);
        let parsed = super::parse_native(
            "create_batch",
            json!({
                "entries":entries,"prepareCopy":true
            }),
        )
        .unwrap();
        assert!(parsed.path.is_empty());
        assert_eq!(parsed.entries.unwrap().len(), 2);
        for arguments in [
            json!({"entries":[]}),
            json!({"entries":null}),
            json!({"entries":[{"path":"note.md","text":"text","sourcePath":"/source"}]}),
            json!({"entries":[{"path":"note.md","text":"text","unexpected":true}]}),
            json!({"entries":[{"path":"note.md"}]}),
            json!({"entries":entries,"manifestPath":".situate/batch-old.jsonl"}),
            json!({"entries":entries,"expectedRevision":null}),
        ] {
            assert!(super::parse_native("create_batch", arguments).is_err());
        }
    }

    #[test]
    fn malformed_bootstrap_requests_cannot_bypass_argument_validation() {
        for operation in ["capabilities", "instructions"] {
            for arguments in [
                json!({"path":"../outside"}),
                json!({"scope":"other"}),
                json!({"runId":"run"}),
            ] {
                let request: super::Arguments = serde_json::from_value(json!({
                    "operation":operation, "arguments":arguments
                }))
                .unwrap();
                assert!(request.parse().is_err());
            }
        }
    }
    #[test]
    fn conversation_history_is_paginated_and_excludes_unsubmitted_input() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        let storage = situate_core::ai_storage::Storage::open(
            &root.path().canonicalize().unwrap(),
            "workspace",
        )
        .unwrap();
        let mut record = storage
            .create_conversation("earlier", "Earlier work")
            .unwrap();
        record.messages = json!([
            {"role":"user","content":"submitted request","timestamp":1},
            {"role":"user","content":"submitted answer","timestamp":2}
        ]);
        record.draft = "unsubmitted draft".into();
        record.runtime = Some(serde_json::from_value(json!({
            "pending":[{"id":"queued","kind":"followUp","state":"pending","text":"unsubmitted queue","attachments":[],"timestamp":1}],
            "events":[
                {"id":"action_accepted-1","runId":"draft-edit","sequence":1,"type":"action_accepted","data":{"action":{"version":1,"type":"draft","expected":{"text":"unsubmitted old draft","attachments":[],"references":[]},"input":{"text":"unsubmitted replaced draft","attachments":[],"references":[]}}}},
                {"id":"action_accepted-1","runId":"queued","sequence":1,"type":"action_accepted","data":{"action":{"version":1,"type":"enqueue","kind":"followUp","input":{"text":"unsubmitted queue","attachments":[],"references":[]},"timestamp":1}}},
                {"id":"action_accepted-1","runId":"run","sequence":1,"type":"action_accepted","data":{"action":{"version":1,"type":"submit","input":{"text":"submitted request","attachments":[],"references":[]},"timestamp":1}}},
                {"id":"input_accepted-2","runId":"run","sequence":2,"type":"input_accepted","data":{"input":{"text":"submitted request","attachments":[],"references":[]}}},
                {"id":"input_consumed-3","runId":"run","sequence":3,"type":"input_consumed","data":{"inputId":"run"}},
                {"id":"tool_execution_start-4","runId":"run","sequence":4,"type":"tool_execution_start","data":{"toolCallId":"call","args":{"path":"note.md","text":"observed change"}}},
                {"id":"tool_execution_end-5","runId":"run","sequence":5,"type":"tool_execution_end","data":{"toolCallId":"call","result":"observed change","outcome":"observed"}},
                {"id":"action_accepted-1","runId":"answer","sequence":1,"type":"action_accepted","data":{"action":{"version":1,"type":"answerQuestion","response":{"questionId":"question","choiceId":"yes"},"input":{"text":"unsubmitted answer composer","attachments":[],"references":[]},"timestamp":2}}},
                {"id":"question_answered-2","runId":"answer","sequence":2,"type":"question_answered","data":{"questionId":"question","inputId":"answer","answer":{"text":"submitted answer","choiceId":"yes"},"response":{"questionId":"question","choiceId":"yes"}}},
                {"id":"action_accepted-1","runId":"not-consumed","sequence":1,"type":"action_accepted","data":{"action":{"version":1,"type":"submit","input":{"text":"unsubmitted interrupted submission","attachments":[],"references":[]},"timestamp":3}}},
                {"id":"input_accepted-2","runId":"not-consumed","sequence":2,"type":"input_accepted","data":{"input":{"text":"unsubmitted interrupted submission","attachments":[],"references":[]}}}
            ],
            "runs":[{"id":"run","state":"completed","startedAt":1,"endedAt":2}]
        })).unwrap());
        let saved = storage.save_fixture_conversation(&record, 0).unwrap();
        let mut request: super::ToolRequest = serde_json::from_value(
            json!({"operation":"read_conversation","conversationId":"earlier","limit":20}),
        )
        .unwrap();
        let first = super::conversation_history(&storage, &request).unwrap();
        assert_eq!(first["recordRevision"], saved.revision);
        assert_eq!(first["nextOffset"], 20);
        let mut source = first["text"].as_str().unwrap().to_owned();
        request.offset = 20;
        request.limit = Some(32768);
        request.record_revision = Some(saved.revision);
        source.push_str(
            super::conversation_history(&storage, &request).unwrap()["text"]
                .as_str()
                .unwrap(),
        );
        let retained: serde_json::Value = serde_json::from_str(&source).unwrap();
        assert_eq!(retained["messages"], record.messages);
        assert!(source.contains("observed change"));
        assert!(!source.contains("unsubmitted"), "{source}");
        assert!(retained.get("draft").is_none());
        let runtime = record.runtime.as_ref().unwrap();
        assert_eq!(
            retained["events"],
            json!([
                runtime.events[4],
                runtime.events[5],
                runtime.events[6],
                runtime.events[8]
            ])
        );
        assert_eq!(retained["runs"], json!(runtime.runs));
        assert_eq!(source.matches("submitted request").count(), 1);
        assert_eq!(storage.read_conversation("earlier").unwrap(), Some(saved));
        request.record_revision = Some(999);
        assert!(super::conversation_history(&storage, &request).is_err());
        request.record_revision = None;
        request.conversation_id = Some("../other-workspace".into());
        assert!(super::conversation_history(&storage, &request).is_err());
        storage.create_conversation("later", "Later work").unwrap();
        request.operation = "list_conversations".into();
        request.offset = 0;
        request.limit = Some(1);
        let listed = super::conversation_history(&storage, &request).unwrap();
        assert_eq!(listed["entries"].as_array().unwrap().len(), 1);
        assert_eq!(listed["entries"][0]["id"], "earlier");
        assert_eq!(listed["total"], 2);
        assert_eq!(listed["nextOffset"], 1);
        request.offset = 1;
        let last = super::conversation_history(&storage, &request).unwrap();
        assert_eq!(last["entries"][0]["id"], "later");
        assert!(last["nextOffset"].is_null());
    }
    #[test]
    fn search_pages_real_workspace_content_and_honors_cancellation() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        std::fs::create_dir(root.path().join("folder")).unwrap();
        std::fs::write(root.path().join("a.md"), "match one\nmatch two\nother").unwrap();
        std::fs::write(root.path().join("folder/b.md"), "match three").unwrap();
        let entries: Vec<_> = situate_core::content::list_content(root.path())
            .unwrap()
            .into_iter()
            .map(|entry| serde_json::json!({"path":entry.path,"isDirectory":entry.is_directory}))
            .collect();
        let read =
            |path: &str| std::fs::read(root.path().join(path)).map_err(|error| error.to_string());
        let mut request: super::ToolRequest = serde_json::from_value(
            serde_json::json!({"operation":"grep","query":"match","limit":1}),
        )
        .unwrap();
        let page = super::search(&request, entries.clone(), read, || Ok(())).unwrap();
        assert_eq!(
            page["entries"],
            serde_json::json!([{"path":"a.md","line":1,"text":"match one"}])
        );
        assert_eq!(page["nextOffset"], 1);
        request.offset = 1;
        assert_eq!(
            super::search(&request, entries.clone(), read, || Ok(())).unwrap()["entries"][0]["line"],
            2
        );
        request.offset = 2;
        let last = super::search(&request, entries.clone(), read, || Ok(())).unwrap();
        assert_eq!(last["entries"][0]["path"], "folder/b.md");
        assert!(last["nextOffset"].is_null());
        request.path = "a.md".into();
        request.offset = 0;
        assert_eq!(
            super::search(&request, entries.clone(), read, || Ok(())).unwrap()["entries"][0]["path"],
            "a.md"
        );
        request.path.clear();
        assert!(
            super::search(&request, entries.clone(), read, || Err("cancelled".into())).is_err()
        );
        request.operation = "ls".into();
        request.offset = 0;
        request.limit = Some(10);
        assert_eq!(
            super::search(&request, entries.clone(), read, || Ok(())).unwrap()["entries"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        request.operation = "find".into();
        request.query = "b.md".into();
        assert_eq!(
            super::search(&request, entries, read, || Ok(())).unwrap()["entries"][0]["path"],
            "folder/b.md"
        );
    }
    #[test]
    fn wire_arguments_cannot_override_admission() {
        for value in [
            serde_json::json!({"operation":"read","arguments":{"path":"a.md","command":"echo test"}}),
            serde_json::json!({"operation":"shell","arguments":{"command":"echo test","approved":true}}),
            serde_json::json!({"operation":"write","arguments":{"path":"a.md","text":"new"}}),
        ] {
            let request: super::Arguments = serde_json::from_value(value).unwrap();
            assert!(request.parse().is_err());
        }
    }
    #[test]
    fn native_validation_rejects_unbounded_or_invalid_requests() {
        for fields in [
            serde_json::json!({"operation":"edit", "path":"a.md", "edits":[]}),
            serde_json::json!({"operation":"read", "path":"a.md", "limit":32769}),
            serde_json::json!({"operation":"shell", "command":""}),
            serde_json::json!({"operation":"shell", "command":"echo test", "timeoutMs":0}),
            serde_json::json!({"operation":"shell", "command":"echo test", "timeoutMs":300001}),
            serde_json::json!({"operation":"grep", "query":""}),
        ] {
            let request: super::ToolRequest = serde_json::from_value(fields).unwrap();
            assert!(request.validate().is_err());
        }
    }
    #[test]
    fn shell_requests_need_no_approval_and_reject_obsolete_approval_fields() {
        let value = json!({"operation":"shell","arguments":{"command":"echo test"}});
        let request: super::Arguments = serde_json::from_value(value.clone()).unwrap();
        request.parse().unwrap();
        for approved in [true, false] {
            let mut obsolete = value.clone();
            obsolete["approved"] = json!(approved);
            assert!(serde_json::from_value::<super::Arguments>(obsolete).is_err());
            assert!(
                serde_json::from_value::<super::ToolRequest>(
                    json!({"operation":"shell","command":"echo test","approved":approved})
                )
                .is_err()
            );
        }
    }
    #[test]
    fn instruction_discovery_uses_only_internal_working_method_and_is_bounded() {
        let entries = serde_json::json!([
            {"path":"nested/AGENTS.md"}, {"path":"/global/.pi/AGENTS.md"},
            {"path":".pi/skills/good/SKILL.md"}, {"path":"AGENTS.md"},
            {"path":".situate/working-method.md"}, {"path":"nested/.situate/working-method.md"},
            {"path":".pi/skills/nested/no/SKILL.md"},
            {"path":"Situate/working-method.md"}
        ]);
        let result = super::instructions(entries.as_array().unwrap(), |path| match path {
            ".situate/working-method.md" => Ok(
                b"---\nsituate-id: method-id\n---\n# Working method\nReview each Friday.".to_vec(),
            ),
            _ => panic!("unexpected path {path}"),
        })
        .unwrap();
        assert!(result.starts_with("\n## .situate/working-method.md\n"));
        assert!(result.contains("# Working method\nReview each Friday."));
        assert!(!result.contains("AGENTS.md"));
        assert!(!result.contains("SKILL.md"));
        let external = serde_json::json!([
            {"path":"AGENTS.md"}, {"path":".pi/skills/good/SKILL.md"},
            {"path":"Situate/working-method.md"}
        ]);
        assert_eq!(
            super::instructions(external.as_array().unwrap(), |_| {
                panic!("user-owned files must not be read as instructions")
            })
            .unwrap(),
            ""
        );
        let bounded =
            super::instructions(entries.as_array().unwrap(), |_| Ok(vec![b'x'; 100_000])).unwrap();
        assert!(bounded.len() <= 32_768);
        assert!(bounded.contains("full instructions"));
    }
    #[test]
    fn continuation_preserves_unicode() {
        let page = super::text_page("a🦀b", 0, 3).unwrap();
        assert_eq!(page["text"], "a");
        assert_eq!(page["nextOffset"], 1);
        assert_eq!(super::text_page("a🦀b", 1, 3).unwrap()["text"], "🦀");
        assert!(super::text_page("a🦀b", 2, 3).is_err());
    }
}
