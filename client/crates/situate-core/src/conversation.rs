use serde_json::Value;
#[cfg(test)]
use serde_json::json;

const ERROR: &str = "native.ai.conversation.versionInvalid";

fn fields(value: &Value, required: &[&str], optional: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        required.iter().all(|key| object.contains_key(*key))
            && object
                .keys()
                .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str()))
    })
}
fn number(value: &Value) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number >= 0.0)
}
fn accounting_number(value: &Value) -> bool {
    value.is_null() || number(value)
}
fn continuation(value: &Value) -> bool {
    fields(value, &["format", "data"], &[])
        && matches!(
            value["format"].as_str(),
            Some(
                "openai-responses"
                    | "openai-completions"
                    | "openai-codex-responses"
                    | "anthropic-messages"
            )
        )
        && (value["data"].is_object() || value["data"].is_array())
}
fn optional_strings(value: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .all(|key| value.get(*key).is_none_or(Value::is_string))
}
fn block(value: &Value, assistant: bool) -> bool {
    if value
        .get("continuation")
        .is_some_and(|value| !continuation(value))
    {
        return false;
    }
    match value["type"].as_str() {
        Some("text") => {
            fields(value, &["type", "text"], &["textSignature", "continuation"])
                && value["text"].is_string()
                && optional_strings(value, &["textSignature"])
        }
        Some("image") if !assistant => {
            fields(value, &["type", "data", "mimeType"], &[])
                && value["data"].is_string()
                && value["mimeType"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
        }
        Some("toolCall") if assistant => {
            fields(
                value,
                &["type", "id", "name", "arguments"],
                &["thoughtSignature", "namespace", "continuation"],
            ) && ["id", "name"]
                .iter()
                .all(|key| value[*key].as_str().is_some_and(|value| !value.is_empty()))
                && value["arguments"].is_object()
                && optional_strings(value, &["thoughtSignature", "namespace"])
        }
        Some("thinking") if assistant => {
            fields(
                value,
                &["type", "thinking"],
                &["thinkingSignature", "redacted", "continuation"],
            ) && value["thinking"].is_string()
                && optional_strings(value, &["thinkingSignature"])
                && value.get("redacted").is_none_or(Value::is_boolean)
        }
        _ => false,
    }
}
fn nested_calls(value: &Value) -> bool {
    fields(value, &["calls", "complete"], &[])
        && value["complete"].is_boolean()
        && value["calls"].as_array().is_some_and(|calls| {
            calls.iter().all(|call| {
                fields(
                    call,
                    &["id", "name", "status"],
                    &["arguments", "argumentsBytes", "durationMs", "error"],
                ) && optional_strings(call, &["id", "name", "error"])
                    && matches!(call["status"].as_str(), Some("ok" | "error" | "unfinished"))
                    && call.get("arguments").is_none_or(Value::is_object)
                    && call.get("argumentsBytes").is_none_or(Value::is_u64)
                    && call.get("durationMs").is_none_or(number)
            })
        })
}
pub(crate) fn usage(value: &Value) -> bool {
    if value.is_null() {
        return true;
    }
    let counts = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
    fields(
        value,
        &[
            "input",
            "output",
            "cacheRead",
            "cacheWrite",
            "totalTokens",
            "cost",
        ],
        &["cacheWrite1h", "reasoning"],
    ) && counts.iter().all(|key| accounting_number(&value[*key]))
        && ["cacheWrite1h", "reasoning"]
            .iter()
            .all(|key| value.get(*key).is_none_or(accounting_number))
        && (value["cost"].is_null()
            || (fields(
                &value["cost"],
                &["input", "output", "cacheRead", "cacheWrite", "total"],
                &[],
            ) && ["input", "output", "cacheRead", "cacheWrite", "total"]
                .iter()
                .all(|key| accounting_number(&value["cost"][*key]))))
}
pub fn validate(messages: &Value) -> Result<(), String> {
    let messages = messages.as_array().ok_or(ERROR)?;
    for message in messages {
        let valid = number(&message["timestamp"])
            && match message["role"].as_str() {
                Some("user") => {
                    fields(message, &["role", "content", "timestamp"], &[])
                        && (message["content"].is_string()
                            || message["content"].as_array().is_some_and(|blocks| {
                                blocks.iter().all(|value| block(value, false))
                            }))
                }
                Some("toolResult") => {
                    fields(
                        message,
                        &[
                            "role",
                            "toolCallId",
                            "toolName",
                            "content",
                            "isError",
                            "timestamp",
                        ],
                        &[
                            "details",
                            "structuredContent",
                            "usage",
                            "nestedCalls",
                            "durationMs",
                        ],
                    ) && ["toolCallId", "toolName"].iter().all(|key| {
                        message[*key]
                            .as_str()
                            .is_some_and(|value| !value.is_empty())
                    }) && message["isError"].is_boolean()
                        && message.get("durationMs").is_none_or(number)
                        && message.get("usage").is_none_or(usage)
                        && message.get("nestedCalls").is_none_or(nested_calls)
                        && message["content"]
                            .as_array()
                            .is_some_and(|blocks| blocks.iter().all(|value| block(value, false)))
                }
                Some("assistant") => {
                    let optional = ["responseId", "rawStopReason"];
                    fields(
                        message,
                        &["role", "content", "timestamp", "usage", "stopReason"],
                        &[
                            "responseId",
                            "rawStopReason",
                            "endTurn",
                            "durationMs",
                            "continuation",
                        ],
                    ) && message.get("continuation").is_none_or(continuation)
                        && optional_strings(message, &optional)
                        && message.get("durationMs").is_none_or(number)
                        && message.get("endTurn").is_none_or(Value::is_boolean)
                        && matches!(
                            message["stopReason"].as_str(),
                            Some("stop" | "length" | "toolUse" | "error" | "aborted")
                        )
                        && usage(&message["usage"])
                        && message["content"]
                            .as_array()
                            .is_some_and(|blocks| blocks.iter().all(|value| block(value, true)))
                }
                _ => false,
            };
        if !valid {
            return Err(ERROR.into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_message_arrays_without_accepting_envelopes() {
        validate(&json!([{"role":"user","content":"Hello","timestamp":1}])).unwrap();
        for value in [
            json!({"version":1,"messages":[]}),
            json!({"version":2,"messages":[]}),
            json!(null),
        ] {
            assert!(validate(&value).is_err());
        }
    }

    #[test]
    fn validates_assistant_metadata_and_reasoning() {
        let assistant = json!({
            "role":"assistant", "content":[{"type":"text","text":"Reply","textSignature":"signature"},{"type":"thinking","thinking":"","thinkingSignature":"opaque","redacted":true}],
            "timestamp":2,"stopReason":"stop",
            "usage":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0,"totalTokens":3,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}
        });
        let messages = json!([assistant.clone()]);
        validate(&messages).unwrap();
        for (field, value) in [
            ("usage", json!({})),
            ("content", json!([{"type":"text","text":3}])),
            ("stopReason", json!("unknown")),
            ("errorMessage", json!("private")),
            ("thinkingLevel", json!("high")),
            ("providerThinkingLevel", json!("high")),
            ("api", json!("openai-responses")),
            ("provider", json!("openai")),
            ("model", json!("test")),
            ("responseModel", json!("test-version")),
        ] {
            let mut invalid = assistant.clone();
            invalid[field] = value;
            assert!(validate(&json!([invalid])).is_err());
        }
    }

    #[test]
    fn tool_calls_results_and_images_preserve_structured_metadata() {
        let messages = json!([
            {"role":"user","content":[{"type":"image","data":"aGVsbG8=","mimeType":"image/png"}],"timestamp":1},
            {"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"note.md"},"thoughtSignature":"opaque","namespace":"workspace"}],
             "timestamp":2,"stopReason":"toolUse",
             "responseId":"response-1","rawStopReason":"tool_call","endTurn":false,
             "usage":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0,"totalTokens":3,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}},
            {"role":"toolResult","toolCallId":"call-1","toolName":"read","content":[{"type":"text","text":"Note"},{"type":"image","data":"aGVsbG8=","mimeType":"image/png"}],"details":{"revision":"abc","nested":[1,true,null]},"isError":false,"timestamp":3,
             "nestedCalls":{"calls":[{"id":"nested-1","name":"read","arguments":{"path":"note.md"},"status":"ok","durationMs":1}],"complete":true}}
        ]);
        validate(&messages).unwrap();
        for (index, field, value) in [
            (
                0,
                "content",
                json!([{"type":"image","data":3,"mimeType":"image/png"}]),
            ),
            (
                1,
                "content",
                json!([{"type":"toolCall","id":"call-1","name":"read","arguments":[]} ]),
            ),
            (2, "isError", json!("false")),
            (2, "toolCallId", json!(null)),
            (2, "nestedCalls", json!({"calls":[],"complete":"yes"})),
        ] {
            let mut invalid = messages.clone();
            invalid[index][field] = value;
            assert!(validate(&invalid).is_err());
        }
    }

    #[test]
    fn provider_usage_costs_keep_exact_f64_values_through_storage_json() {
        let wire = br#"[{"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"ls","arguments":{}}],"timestamp":1,"stopReason":"toolUse","usage":{"input":1,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":6,"cost":{"input":0.0000012499999999999999,"output":0.0000037500000000000005,"cacheRead":0,"cacheWrite":0,"total":0.000005}}}]"#;
        let messages: Value = serde_json::from_slice(wire).unwrap();
        validate(&messages).unwrap();
        assert_eq!(
            messages[0]["usage"]["cost"]["input"].as_f64(),
            Some(0.0000012499999999999999)
        );
        assert_eq!(
            messages[0]["usage"]["cost"]["output"].as_f64(),
            Some(0.0000037500000000000005)
        );
        let serialized = serde_json::to_vec(&messages).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&serialized).unwrap(),
            messages
        );
    }

    #[test]
    fn validates_optional_durations() {
        let mut messages = json!([
            {"role":"assistant","content":[],"timestamp":10000,"stopReason":"aborted",
             "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}},
            {"role":"toolResult","toolCallId":"call","toolName":"read","content":[],"isError":true,"timestamp":20000}
        ]);
        validate(&messages).unwrap();
        assert!(messages[0].get("durationMs").is_none());
        assert!(messages[1].get("durationMs").is_none());
        messages[0]["durationMs"] = json!(1234.5);
        messages[1]["durationMs"] = json!(0);
        validate(&messages).unwrap();
        for index in [0, 1] {
            for value in [json!(-1), json!(null), json!("12")] {
                let mut invalid = messages.clone();
                invalid[index]["durationMs"] = value;
                assert!(validate(&invalid).is_err());
            }
        }
    }

    #[test]
    fn malformed_message_content_and_private_errors_are_rejected() {
        for message in [
            json!({"role":"user","content":"Hello"}),
            json!({"role":"user","content":null,"timestamp":1}),
            json!({"role":"user","content":[{"type":"text","text":42}],"timestamp":1}),
            json!({"role":"system","content":"Hello","timestamp":1}),
            json!({"role":"user","content":"Hello","timestamp":-1}),
            json!({"role":"user","content":"Hello","timestamp":1,"errorMessage":"private"}),
        ] {
            assert!(validate(&json!([message])).is_err());
        }
    }
}
