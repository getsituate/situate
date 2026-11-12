use crate::attachment::AttachmentRef;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
const INVALID: &str = "native.ai.conversation.versionInvalid";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[serde(bound(deserialize = "R: Deserialize<'de>"))]
pub struct Runtime<R = ContentReference> {
    #[serde(default)]
    pub draft_attachments: Vec<AttachmentRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub draft_references: Vec<R>,
    #[serde(default)]
    pub pending: Vec<Pending<R>>,
    #[serde(default)]
    pub events: Vec<Event>,
    #[serde(default)]
    pub runs: Vec<Run<R>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<Checkpoint>,
}
impl<R> Default for Runtime<R> {
    fn default() -> Self {
        Self {
            draft_attachments: Vec::new(),
            draft_references: Vec::new(),
            pending: Vec::new(),
            events: Vec::new(),
            runs: Vec::new(),
            checkpoint: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[serde(bound(deserialize = "R: Deserialize<'de>"))]
pub struct Pending<R = ContentReference> {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub text: String,
    pub attachments: Vec<AttachmentRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<R>,
    pub timestamp: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub id: String,
    pub run_id: String,
    pub sequence: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub data: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[serde(bound(deserialize = "R: Deserialize<'de>"))]
pub struct Run<R = ContentReference> {
    pub id: String,
    pub state: String,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<R>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ContentReference {
    Live {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        path: String,
        #[serde(rename = "anchorRevision")]
        anchor_revision: String,
    },
    Historical {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        path: String,
        revision: String,
    },
}
impl ContentReference {
    pub fn workspace_id(&self) -> &str {
        match self {
            Self::Live { workspace_id, .. } | Self::Historical { workspace_id, .. } => workspace_id,
        }
    }
    pub fn validate(&self) -> bool {
        let path = match self {
            Self::Live { path, .. } | Self::Historical { path, .. } => path,
        };
        identity(self.workspace_id())
            && !path.is_empty()
            && path.len() <= 4096
            && !path
                .chars()
                .any(|c| c.is_control() || matches!(c, '\\' | ':'))
            && !path.split('/').any(|part| matches!(part, "" | "." | ".."))
            && match self {
                Self::Live {
                    anchor_revision, ..
                } => {
                    anchor_revision.len() == 40
                        && anchor_revision
                            .bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                }
                Self::Historical { revision, .. } => {
                    revision.len() == 40
                        && revision
                            .bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                }
            }
    }
}
fn references_valid(references: &[ContentReference]) -> bool {
    references.len() <= 32 && references.iter().all(ContentReference::validate)
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub source_count: usize,
    pub summary: String,
    pub run_id: String,
}
pub fn identity(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}
impl Runtime {
    pub fn validate(&self, message_count: usize) -> Result<(), String> {
        if !references_valid(&self.draft_references) {
            return Err(INVALID.into());
        }
        let mut ids = HashSet::new();
        for run in &self.runs {
            if !references_valid(&run.references)
                || !identity(&run.id)
                || !ids.insert(&run.id)
                || !matches!(
                    run.state.as_str(),
                    "running" | "completed" | "interrupted" | "error"
                )
            {
                return Err(INVALID.into());
            }
        }
        for run in &self.runs {
            if run.ended_at.is_some_and(|ended| ended < run.started_at)
                || run.usage.as_ref().is_some_and(|entries| {
                    entries.iter().any(|entry| {
                        !matches!(
                            entry["kind"].as_str(),
                            Some("main" | "compaction" | "comment" | "title")
                        ) || !crate::conversation::usage(&entry["usage"])
                            || entry.as_object().is_none_or(|entry| {
                                entry.keys().any(|key| {
                                    !matches!(key.as_str(), "kind" | "usage" | "requestId")
                                })
                            })
                    })
                })
            {
                return Err(INVALID.into());
            }
        }
        let mut events = HashSet::new();
        let mut sequences = std::collections::HashMap::new();
        for event in &self.events {
            if !identity(&event.id)
                || !identity(&event.run_id)
                || !identity(&event.kind)
                || !event.data.is_object()
                || !events.insert((&event.run_id, &event.id))
                || event.sequence <= sequences.get(&event.run_id).copied().unwrap_or(0)
            {
                return Err(INVALID.into());
            }
            match event.kind.as_str() {
                "tool_intent"
                    if !event.data["name"].as_str().is_some_and(identity)
                        || !event.data["args"].is_object() =>
                {
                    return Err(INVALID.into());
                }
                "tool_execution_start" | "tool_execution_end"
                    if !event.data["toolCallId"].as_str().is_some_and(identity) =>
                {
                    return Err(INVALID.into());
                }
                _ => {}
            }
            sequences.insert(&event.run_id, event.sequence);
        }
        let mut pending = HashSet::new();
        for entry in &self.pending {
            if !references_valid(&entry.references)
                || !identity(&entry.id)
                || !pending.insert(&entry.id)
                || !matches!(entry.kind.as_str(), "steering" | "followUp")
                || !matches!(entry.state.as_str(), "pending" | "consumed")
            {
                return Err(INVALID.into());
            }
            for attachment in &entry.attachments {
                attachment.validate()?;
            }
        }
        for attachment in &self.draft_attachments {
            attachment.validate()?;
        }
        if self
            .checkpoint
            .as_ref()
            .is_some_and(|c| c.source_count > message_count || !identity(&c.run_id))
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn work_ranges_and_call_provenance_round_trip_without_rewriting_end_only_events() {
        let value = json!({
            "draftAttachments": [], "pending": [], "runs": [],
            "events": [
                {"id":"old", "runId":"r", "sequence":1, "type":"work_block_end",
                 "data":{"messageCount":2, "durationMs":100, "outcome":"complete"}},
                {"id":"call", "runId":"r", "sequence":2, "type":"tool_intent",
                 "data":{"name":"plugin_tool", "args":{}, "messageIndex":2, "pluginId":"supplier", "pluginName":"Original supplier"}},
                {"id":"start-new", "runId":"r", "sequence":3, "type":"work_block_start",
                 "data":{"workId":"new", "startMessageCount":2}},
                {"id":"new", "runId":"r", "sequence":4, "type":"work_block_end",
                 "data":{"workId":"new", "startMessageCount":2, "messageCount":3, "durationMs":250, "outcome":"cancelled"}},
                {"id":"start-interrupted", "runId":"r", "sequence":5, "type":"work_block_start",
                 "data":{"workId":"interrupted", "startMessageCount":3}}
            ]
        });
        let runtime: Runtime = serde_json::from_value(value.clone()).unwrap();
        runtime.validate(3).unwrap();
        let saved = serde_json::to_value(runtime).unwrap();
        assert_eq!(saved["events"], value["events"]);
        assert!(saved["events"][4]["data"].get("durationMs").is_none());
        assert!(
            saved["events"][0]["data"]
                .get("startMessageCount")
                .is_none()
        );
    }

    #[test]
    fn portable_runs_reject_operational_attribution() {
        let run = json!({"id":"run", "state":"completed", "startedAt":1, "endedAt":2, "usage":[]});
        let runtime =
            json!({"draftAttachments":[], "pending":[], "events":[], "runs":[run.clone()]});
        serde_json::from_value::<Runtime>(runtime.clone())
            .unwrap()
            .validate(0)
            .unwrap();
        for key in [
            "model",
            "provider",
            "thinkingLevel",
            "commentModel",
            "commentThinkingLevel",
            "recommendationRevision",
        ] {
            let mut attributed = runtime.clone();
            attributed["runs"][0][key] = json!("local-choice");
            assert!(serde_json::from_value::<Runtime>(attributed).is_err());
        }
        let usage = json!({"input":1,"output":2,"cacheRead":0,"cacheWrite":0,"totalTokens":3,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}});
        let mut measured = runtime;
        measured["runs"][0]["usage"] =
            json!([{"kind":"main", "usage":usage, "requestId":"request"}]);
        for kind in ["main", "compaction", "comment", "title"] {
            measured["runs"][0]["usage"][0]["kind"] = json!(kind);
            serde_json::from_value::<Runtime>(measured.clone())
                .unwrap()
                .validate(0)
                .unwrap();
        }
        for key in ["model", "provider", "thinkingLevel"] {
            let mut attributed = measured.clone();
            attributed["runs"][0]["usage"][0][key] = json!("local-choice");
            assert!(
                serde_json::from_value::<Runtime>(attributed)
                    .unwrap()
                    .validate(0)
                    .is_err()
            );
        }
    }
}
