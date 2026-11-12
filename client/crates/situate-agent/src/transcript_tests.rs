use super::*;
use rig_core::{
    completion::ToolDefinition,
    message::{AssistantContent, ToolName},
};
use serde_json::json;

#[test]
fn scheduler_does_not_own_continuation_or_accounting() {
    let message = json!({"role":"assistant","content":[
        {"type":"thinking","thinking":"Plan"},
        {"type":"text","text":"Reading"},
        {"type":"toolCall","id":"call","name":"read","arguments":{"path":"note.md"}}
    ],"timestamp":2,"stopReason":"toolUse","usage":null,"responseId":"response",
    "continuation":{"format":"anthropic-messages","data":{"signature":"opaque"}}});
    let original = message.clone();
    let definitions = vec![ToolDefinition::new(
        ToolName::new("read").unwrap(),
        "Read a file",
        json!({"type":"object"}),
    )];
    let scheduled = scheduling(&message, &definitions).unwrap();
    assert_eq!(
        scheduled.choice,
        vec![
            AssistantContent::text("Reading"),
            AssistantContent::tool_call(
                "call",
                ToolName::new("read").unwrap(),
                json!({"path":"note.md"})
            )
        ]
    );
    assert_eq!(scheduled.usage, Usage::new());
    assert_eq!(scheduled.response_id, None);
    assert_eq!(message, original);
}

#[test]
fn failed_canonical_turns_never_schedule_partial_tool_calls() {
    for stop in ["error", "aborted"] {
        let message = json!({"role":"assistant","content":[{"type":"toolCall","id":"partial","name":"read","arguments":{}}],"timestamp":1,"stopReason":stop,"usage":null});
        assert!(scheduling(&message, &[]).is_err());
    }
}

#[test]
fn empty_and_rich_tool_outputs_need_no_provider_conversion_for_scheduling() {
    for content in [
        vec![],
        vec![json!({"type":"image","data":"attachment:image","mimeType":"image/png"})],
    ] {
        let original = content.clone();
        assert!(rig_core::tool::ToolOutput::content(tool_content(&content).unwrap()).is_ok());
        assert_eq!(content, original);
    }
}
