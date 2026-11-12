use rig_agent::run::{ModelTurn, TurnPolicy};
use rig_core::{
    completion::{FinishReason, Usage},
    message::{AssistantContent, AssistantMessage, Text, ToolName, ToolResultContent},
};
use serde_json::Value;

pub(crate) fn validate(message: &Value) -> Result<(), String> {
    situate_core::conversation::validate(&Value::Array(vec![message.clone()]))
}

pub(crate) fn interrupted(
    mut message: Value,
    timestamp: u64,
    cancelled: bool,
) -> Result<Value, String> {
    let object = message
        .as_object_mut()
        .ok_or("native.ai.response.invalid")?;
    object.retain(|key, _| {
        matches!(
            key.as_str(),
            "role"
                | "content"
                | "timestamp"
                | "usage"
                | "responseId"
                | "continuation"
                | "rawStopReason"
                | "endTurn"
                | "durationMs"
        )
    });
    object.insert("role".into(), serde_json::json!("assistant"));
    object.insert(
        "stopReason".into(),
        serde_json::json!(if cancelled { "aborted" } else { "error" }),
    );
    object
        .entry("timestamp")
        .or_insert_with(|| serde_json::json!(timestamp));
    object
        .entry("content")
        .or_insert_with(|| serde_json::json!([]));
    object.entry("usage").or_insert(Value::Null);
    if validate(&message).is_err() {
        message["usage"] = Value::Null;
        validate(&message)?;
    }
    Ok(message)
}

/// Rig receives scheduling data only. Provider context, continuation metadata and
/// accounting remain in canonical domain messages and never round-trip through Rig.
pub(crate) fn scheduling(
    message: &Value,
    definitions: &[rig_core::completion::ToolDefinition],
) -> Result<ModelTurn, String> {
    validate(message)?;
    if message["role"] != "assistant" {
        return Err("native.ai.response.invalid".into());
    }
    let choice = message["content"]
        .as_array()
        .ok_or("native.ai.response.invalid")?
        .iter()
        .filter_map(|block| match block["type"].as_str() {
            Some("text") => Some(Ok(AssistantContent::text(block["text"].as_str().unwrap()))),
            Some("toolCall") => Some(
                ToolName::new(block["name"].as_str().unwrap())
                    .map_err(|_| "native.ai.response.invalid".to_owned())
                    .map(|name| {
                        AssistantContent::tool_call(
                            block["id"].as_str().unwrap(),
                            name,
                            block["arguments"].clone(),
                        )
                    }),
            ),
            _ => None,
        })
        .collect::<Result<Vec<_>, _>>()?;
    let finish = match message["stopReason"].as_str() {
        Some("stop") => FinishReason::Stop,
        Some("toolUse") => FinishReason::ToolCalls,
        Some("length") => FinishReason::Length,
        _ => return Err("native.ai.response.stopped".into()),
    };
    Ok(ModelTurn::new(
        AssistantMessage::default(),
        choice,
        Usage::new(),
        TurnPolicy::new(
            definitions.iter().map(|d| d.name.to_string()).collect(),
            None,
            None,
        )
        .map_err(|_| "native.ai.response.invalid")?,
        Value::Null,
    )
    .with_finish_reason(Some(finish)))
}

pub(crate) fn tool_content(blocks: &[Value]) -> Result<Vec<ToolResultContent>, String> {
    // Tool payload is persisted canonically before this scheduling-only receipt.
    // Rig need not hydrate image bytes or understand provider-native result items.
    let text = blocks
        .iter()
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(vec![ToolResultContent::Text(Text::new(text))])
}

#[cfg(test)]
#[path = "transcript_tests.rs"]
mod tests;
