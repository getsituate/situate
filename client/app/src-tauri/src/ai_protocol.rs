// Wire behavior adapted from @earendil-works/pi-ai 1.0.2/1.1.0,
// packages/ai/src/api/{openai-responses,openai-responses-shared,
// openai-completions,anthropic-messages}.ts and Situate's adapters.ts.
// https://github.com/earendil-works/pi
// MIT License
// Copyright (c) 2025 Mario Zechner
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

const INVALID: &str = "native.ai.protocol.invalidData";
const REJECTED: &str = "native.ai.protocol.providerRejected";
const INCOMPLETE: &str = "native.ai.protocol.incompleteStream";
const UNSUPPORTED: &str = "native.ai.protocol.unsupported";
const MAX_FRAME: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Protocol {
    Responses,
    Codex,
    Completions,
    Anthropic,
}
impl Protocol {
    fn parse(api: &str) -> Result<Self, String> {
        match api {
            "openai-responses" => Ok(Self::Responses),
            "openai-codex-responses" => Ok(Self::Codex),
            "openai-completions" => Ok(Self::Completions),
            "anthropic-messages" => Ok(Self::Anthropic),
            _ => Err(UNSUPPORTED.into()),
        }
    }
    fn api(self) -> &'static str {
        match self {
            Self::Responses => "openai-responses",
            Self::Codex => "openai-codex-responses",
            Self::Completions => "openai-completions",
            Self::Anthropic => "anthropic-messages",
        }
    }
    fn responses(self) -> bool {
        matches!(self, Self::Responses | Self::Codex)
    }
}

pub(crate) struct PreparedRequest {
    pub(crate) body: Value,
    pub(crate) headers: HashMap<String, String>,
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key].as_str().ok_or_else(|| INVALID.into())
}
fn flag(model: &Value, key: &str, default: bool) -> bool {
    model["compat"][key].as_bool().unwrap_or(default)
}
fn blocks(message: &Value) -> Result<Vec<Value>, String> {
    match &message["content"] {
        Value::String(text) => Ok(vec![json!({"type":"text","text":text})]),
        Value::Array(content) => Ok(content.clone()),
        _ => Err(INVALID.into()),
    }
}
fn text(content: &[Value]) -> String {
    content
        .iter()
        .filter_map(|b| b["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
fn continuation(block: &Value, protocol: Protocol, allowed: bool) -> Option<&Value> {
    let metadata = &block["continuation"];
    (allowed && metadata["format"] == protocol.api()).then_some(&metadata["data"])
}
fn image_url(block: &Value) -> Result<String, String> {
    let mime = string(block, "mimeType")?;
    if !matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return Err(UNSUPPORTED.into());
    }
    Ok(format!("data:{mime};base64,{}", string(block, "data")?))
}
fn input_blocks(content: &[Value], protocol: Protocol) -> Result<Vec<Value>, String> {
    content.iter().map(|block| match block["type"].as_str() {
        Some("text") => Ok(match protocol {
            Protocol::Responses | Protocol::Codex => json!({"type":"input_text","text":string(block,"text")?}),
            _ => json!({"type":"text","text":string(block,"text")?}),
        }),
        Some("image") => match protocol {
            Protocol::Anthropic => {
                image_url(block)?;
                Ok(json!({"type":"image","source":{"type":"base64","media_type":block["mimeType"],"data":block["data"]}}))
            },
            Protocol::Completions => Ok(json!({"type":"image_url","image_url":{"url":image_url(block)?}})),
            _ => Ok(json!({"type":"input_image","image_url":image_url(block)?,"detail":"auto"})),
        },
        _ => Err(UNSUPPORTED.into()),
    }).collect()
}

// IDs are projected as pairs, never rewritten in retained history. Collision
// suffixes also distinguish different IDs that sanitize to the same wire ID.
fn normalized_context(context: &[Value], protocol: Protocol) -> Result<Vec<Value>, String> {
    let mut result = Vec::new();
    let mut used = HashSet::new();
    let mut pending: Vec<(String, String)> = Vec::new();
    for message in context {
        let role = string(message, "role")?;
        if role != "toolResult" {
            for (_, id) in pending.drain(..) {
                result.push(json!({"role":"toolResult","toolCallId":id,"isError":true,"content":[{"type":"text","text":"Tool execution was interrupted; no result is available."}]}));
            }
        }
        if role == "assistant"
            && matches!(message["stopReason"].as_str(), Some("error" | "aborted"))
        {
            continue;
        }
        let mut message = message.clone();
        if role == "assistant" {
            let mut content = blocks(&message)?;
            for block in &mut content {
                if block["type"] != "toolCall" {
                    continue;
                }
                let original = string(block, "id")?.to_owned();
                if original.is_empty()
                    || !block["arguments"].is_object()
                    || string(block, "name")?.is_empty()
                {
                    return Err(INVALID.into());
                }
                let max = if protocol == Protocol::Completions {
                    40
                } else {
                    64
                };
                let base: String = original
                    .chars()
                    .map(|c| {
                        if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') {
                            c
                        } else {
                            '_'
                        }
                    })
                    .take(max - 10)
                    .collect();
                let base = if base.is_empty() {
                    "call".to_owned()
                } else {
                    base
                };
                let mut id = base.clone();
                let mut suffix = 1;
                while !used.insert(id.clone()) {
                    id = format!("{base}_{suffix}");
                    suffix += 1;
                }
                if pending.iter().any(|(old, _)| old == &original) {
                    return Err(INVALID.into());
                }
                block["id"] = json!(id);
                pending.push((original, id));
            }
            message["content"] = json!(content);
        } else if role == "toolResult" {
            let original = string(&message, "toolCallId")?;
            let Some(index) = pending.iter().position(|(old, _)| old == original) else {
                continue;
            };
            let (_, id) = pending.remove(index);
            message["toolCallId"] = json!(id);
        } else if !matches!(role, "system" | "user") {
            return Err(UNSUPPORTED.into());
        }
        result.push(message);
    }
    for (_, id) in pending {
        result.push(json!({"role":"toolResult","toolCallId":id,"isError":true,"content":[{"type":"text","text":"Tool execution was interrupted; no result is available."}]}));
    }
    Ok(result)
}

fn effort(model: &Value, thinking: &str, codex: bool) -> Result<Option<String>, String> {
    if !matches!(
        thinking,
        "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
    ) {
        return Err(INVALID.into());
    }
    if let Some(mapped) = model["thinkingLevelMap"].get(thinking) {
        return if mapped.is_null() {
            Ok(None)
        } else {
            Ok(Some(mapped.as_str().ok_or(INVALID)?.to_owned()))
        };
    }
    if thinking == "off" {
        Ok((codex && model["reasoning"] == true).then(|| "none".into()))
    } else {
        Ok(Some(thinking.into()))
    }
}

fn request_tools(tools: &[Value], protocol: Protocol, model: &Value) -> Result<Vec<Value>, String> {
    if tools.len() > 128 {
        return Err(INVALID.into());
    }
    tools.iter().map(|tool| {
        let name = string(tool,"name")?;
        if name.is_empty() || name.len() > 128 || !name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b,b'_'|b'-')) || !tool["parameters"].is_object() { return Err(INVALID.into()); }
        let description = tool["description"].as_str().unwrap_or("");
        let mut function = json!({"name":name,"description":description,"parameters":tool["parameters"]});
        if protocol == Protocol::Anthropic {
            let mut wire = json!({"name":name,"description":description,"input_schema":tool["parameters"]});
            if flag(model,"supportsStrictTools",false) && tool["strict"] == true { wire["strict"] = json!(true); }
            return Ok(wire);
        }
        if flag(model,"supportsStrictMode",protocol.responses()) {
            function["strict"] = if protocol == Protocol::Codex { Value::Null } else { json!(tool["strict"].as_bool().unwrap_or(false)) };
        }
        if protocol == Protocol::Completions { Ok(json!({"type":"function","function":function})) }
        else { function["type"] = json!("function"); Ok(function) }
    }).collect()
}

// The caller supplies an admitted model and hydrated native context. Direct
// ChatGPT access must set compat.supportsMaxOutputTokens=false at admission.
// Only a context message's transient continuationAllowed=true permits opaque
// replay; the host must verify its live connection/model/protocol fingerprint.
pub(crate) fn build_request(
    api: &str,
    model: &Value,
    thinking: &str,
    context: &[Value],
    tools: &[Value],
    max_tokens: Option<u64>,
) -> Result<PreparedRequest, String> {
    let protocol = Protocol::parse(api)?;
    if model["api"] != api || string(model, "id")?.is_empty() || max_tokens == Some(0) {
        return Err(INVALID.into());
    }
    if protocol == Protocol::Codex
        && (model["provider"] != "openai-codex"
            || model["baseUrl"] != "https://chatgpt.com/backend-api")
    {
        return Err(UNSUPPORTED.into());
    }
    let effort = effort(model, thinking, protocol == Protocol::Codex)?
        .filter(|_| protocol != Protocol::Anthropic || thinking != "off");
    let context = normalized_context(context, protocol)?;
    let wire_tools = request_tools(tools, protocol, model)?;
    let mut body = json!({"model":model["id"],"stream":true});
    let mut headers = HashMap::new();
    let messages = if protocol.responses() {
        responses_context(&context, protocol, model)?
    } else if protocol == Protocol::Anthropic {
        anthropic_context(&context, model)?
    } else {
        completions_context(&context, model)?
    };
    if protocol.responses() {
        body["input"] = json!(messages);
        body["store"] = json!(false);
        if protocol != Protocol::Codex
            && flag(model, "supportsMaxOutputTokens", true)
            && let Some(max) = max_tokens
        {
            body["max_output_tokens"] = json!(max);
        }
        if let Some(ref effort) = effort {
            body["reasoning"] = json!({"effort":effort});
            if thinking != "off" {
                body["reasoning"]["summary"] = json!("auto");
            }
            body["include"] = json!(["reasoning.encrypted_content"]);
        }
        if protocol == Protocol::Codex {
            let instructions = context
                .iter()
                .take_while(|m| m["role"] == "system")
                .map(|m| blocks(m).map(|b| text(&b)))
                .collect::<Result<Vec<_>, _>>()?
                .join("\n");
            body["instructions"] = json!(if instructions.is_empty() {
                "You are a helpful assistant."
            } else {
                &instructions
            });
            body["text"] = json!({"verbosity":"low"});
            body["include"] = json!(["reasoning.encrypted_content"]);
            body["tool_choice"] = json!("auto");
            body["parallel_tool_calls"] = json!(true);
        }
    } else if protocol == Protocol::Anthropic {
        body["messages"] = json!(messages);
        let system = context
            .iter()
            .take_while(|m| m["role"] == "system")
            .map(|m| blocks(m).map(|b| text(&b)))
            .collect::<Result<Vec<_>, _>>()?
            .join("\n");
        if !system.is_empty() {
            body["system"] = json!([{"type":"text","text":system}]);
        }
        let limit = max_tokens
            .or_else(|| model["maxTokens"].as_u64())
            .unwrap_or(4096);
        body["max_tokens"] = json!(limit);
        headers.insert("anthropic-version".into(), "2023-06-01".into());
        let mut betas = Vec::new();
        if flag(model, "supportsMidConvoEffort", false) {
            body["thinking"] = json!({"type":"adaptive","display":"summarized","block_binding":{"prefix_mismatch_behavior":"drop_block"}});
            body["output_config"] = json!({"effort":"high"});
            body["messages"].as_array_mut().unwrap().push(json!({"role":"system","content":[],"output_config":{"effort":effort.as_deref().unwrap_or("high")}}));
            betas.extend([
                "mid-conversation-output-config-2026-07-01",
                "thinking-binding-controls-2026-08-01",
            ]);
        } else if let Some(ref effort) = effort {
            if flag(model, "forceAdaptiveThinking", false) {
                body["thinking"] = json!({"type":"adaptive","display":"summarized"});
                body["output_config"] = json!({"effort":effort});
            } else {
                let budget = match thinking {
                    "minimal" => 1024,
                    "low" => 2048,
                    "medium" => 8192,
                    _ => 16384,
                };
                if limit <= 1024 {
                    return Err(INVALID.into());
                }
                body["thinking"] = json!({"type":"enabled","budget_tokens":budget.min(limit-1024),"display":"summarized"});
                betas.push("interleaved-thinking-2025-05-14");
            }
        } else if model["reasoning"] == true
            && model["thinkingLevelMap"].get("off") != Some(&Value::Null)
        {
            body["thinking"] = json!({"type":"disabled"});
        }
        if !betas.is_empty() {
            headers.insert("anthropic-beta".into(), betas.join(","));
        }
    } else {
        body["messages"] = json!(messages);
        if flag(model, "supportsUsageInStreaming", true) {
            body["stream_options"] = json!({"include_usage":true});
        }
        if flag(model, "supportsStore", false) {
            body["store"] = json!(false);
        }
        if let Some(max) = max_tokens {
            let field = model["compat"]["maxTokensField"]
                .as_str()
                .unwrap_or("max_completion_tokens");
            if !matches!(field, "max_tokens" | "max_completion_tokens") {
                return Err(UNSUPPORTED.into());
            }
            body[field] = json!(max);
        }
        if let Some(ref effort) = effort {
            if model["provider"] == "openrouter"
                || model["compat"]["thinkingFormat"] == "openrouter"
            {
                body["reasoning"] = json!({"effort":effort});
            } else if flag(model, "supportsReasoningEffort", true) {
                body["reasoning_effort"] = json!(effort);
            } else {
                return Err(UNSUPPORTED.into());
            }
        }
        if let Some(routing) = model["compat"].get("openRouterRouting") {
            body["provider"] = routing.clone();
        }
    }
    if !wire_tools.is_empty() || context.iter().any(|m| m["role"] == "toolResult") {
        body["tools"] = json!(wire_tools);
    }
    Ok(PreparedRequest { body, headers })
}

fn responses_context(
    context: &[Value],
    protocol: Protocol,
    model: &Value,
) -> Result<Vec<Value>, String> {
    let mut wire = Vec::new();
    let mut initial = true;
    for message in context {
        let role = string(message, "role")?;
        let content = blocks(message)?;
        if role == "system" {
            if !(protocol == Protocol::Codex && initial) {
                wire.push(json!({"role":if model["reasoning"] == true {"developer"} else {"system"},"content":text(&content)}));
            }
            continue;
        }
        initial = false;
        match role {
            "user" => wire.push(json!({"role":"user","content":input_blocks(&content,protocol)?})),
            "toolResult" => {
                let output = if content.iter().any(|b| b["type"] == "image") {
                    json!(input_blocks(&content, protocol)?)
                } else {
                    json!(text(&content))
                };
                wire.push(json!({"type":"function_call_output","call_id":message["toolCallId"],"output":output}));
            }
            "assistant" => {
                for block in &content {
                    match block["type"].as_str() {
                        Some("text") => {
                            let mut item = json!({"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":string(block,"text")?,"annotations":[]}]});
                            if let Some(metadata) = continuation(
                                block,
                                protocol,
                                message["continuationAllowed"] == true,
                            ) {
                                for field in ["id", "phase"] {
                                    if let Some(value) = metadata["item"].get(field) {
                                        item[field] = value.clone();
                                    }
                                }
                            }
                            let merge = item["id"].as_str().is_some()
                                && wire.last().is_some_and(|previous| {
                                    previous["type"] == "message"
                                        && previous["id"] == item["id"]
                                        && previous["phase"] == item["phase"]
                                });
                            if merge {
                                wire.last_mut().unwrap()["content"]
                                    .as_array_mut()
                                    .unwrap()
                                    .extend(item["content"].as_array().unwrap().iter().cloned());
                            } else {
                                wire.push(item);
                            }
                        }
                        Some("thinking") => {
                            if let Some(item) = continuation(
                                block,
                                protocol,
                                message["continuationAllowed"] == true,
                            )
                            .and_then(|c| c.get("item"))
                            {
                                if item["type"] == "reasoning" {
                                    wire.push(item.clone());
                                }
                            } else if block["redacted"] != true
                                && block["thinking"].as_str().is_some_and(|s| !s.is_empty())
                            {
                                wire.push(json!({"role":"assistant","content":block["thinking"]}));
                            }
                        }
                        Some("toolCall") => {
                            let mut item = json!({"type":"function_call","call_id":block["id"],"name":string(block,"name")?,"arguments":serde_json::to_string(&block["arguments"]).map_err(|_| INVALID)?});
                            if let Some(id) = continuation(
                                block,
                                protocol,
                                message["continuationAllowed"] == true,
                            )
                            .and_then(|c| c["item"]["id"].as_str())
                                && id.starts_with("fc_")
                                && id.len() <= 64
                                && id
                                    .bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
                            {
                                item["id"] = json!(id);
                            }
                            if let Some(namespace) = block.get("namespace") {
                                item["namespace"] = namespace.clone();
                            }
                            wire.push(item);
                        }
                        _ => return Err(UNSUPPORTED.into()),
                    }
                }
            }
            _ => return Err(UNSUPPORTED.into()),
        }
    }
    Ok(wire)
}

fn anthropic_context(context: &[Value], model: &Value) -> Result<Vec<Value>, String> {
    let mut wire: Vec<Value> = Vec::new();
    let mut initial = true;
    for message in context {
        let role = string(message, "role")?;
        if role == "system" && initial {
            continue;
        }
        initial = false;
        let content = blocks(message)?;
        let (wire_role, converted) = match role {
            "system" => {
                if flag(model, "supportsMidConvoSystemMessages", false) {
                    ("system", json!([{"type":"text","text":text(&content)}]))
                } else {
                    ("user", json!([{"type":"text","text":text(&content)}]))
                }
            }
            "user" => ("user", json!(input_blocks(&content, Protocol::Anthropic)?)),
            "toolResult" => (
                "user",
                json!([{"type":"tool_result","tool_use_id":message["toolCallId"],"content":input_blocks(&content,Protocol::Anthropic)?,"is_error":message["isError"].as_bool().unwrap_or(false)}]),
            ),
            "assistant" => {
                let mut converted = Vec::new();
                for block in &content {
                    match block["type"].as_str() {
                        Some("text") => converted.push(json!({"type":"text","text":string(block,"text")?})),
                        Some("thinking") => {
                            let signed = continuation(block,Protocol::Anthropic,message["continuationAllowed"] == true).is_some() && block["thinkingSignature"].as_str().is_some_and(|s| !s.is_empty());
                            if signed && block["redacted"] == true { converted.push(json!({"type":"redacted_thinking","data":block["thinkingSignature"]})); }
                            else if signed { converted.push(json!({"type":"thinking","thinking":block["thinking"],"signature":block["thinkingSignature"]})); }
                            else if block["redacted"] != true && block["thinking"].as_str().is_some_and(|s| !s.is_empty()) { converted.push(json!({"type":"text","text":block["thinking"]})); }
                        },
                        Some("toolCall") => converted.push(json!({"type":"tool_use","id":block["id"],"name":string(block,"name")?,"input":block["arguments"]})),
                        _ => return Err(UNSUPPORTED.into()),
                    }
                }
                ("assistant", json!(converted))
            }
            _ => return Err(UNSUPPORTED.into()),
        };
        if wire.last().is_some_and(|m| m["role"] == wire_role) {
            wire.last_mut().unwrap()["content"]
                .as_array_mut()
                .unwrap()
                .extend(converted.as_array().unwrap().iter().cloned());
        } else {
            wire.push(json!({"role":wire_role,"content":converted}));
        }
    }
    Ok(wire)
}

fn completions_context(context: &[Value], model: &Value) -> Result<Vec<Value>, String> {
    let mut wire = Vec::new();
    for message in context {
        let role = string(message, "role")?;
        let content = blocks(message)?;
        match role {
            "system" => wire.push(json!({"role":if model["reasoning"] == true && flag(model,"supportsDeveloperRole",model["provider"] == "openai") {"developer"} else {"system"},"content":text(&content)})),
            "user" => {
                if flag(model,"requiresAssistantAfterToolResult",false) && wire.last().is_some_and(|m| m["role"] == "tool") { wire.push(json!({"role":"assistant","content":"Done."})); }
                wire.push(json!({"role":"user","content":input_blocks(&content,Protocol::Completions)?}));
            },
            "toolResult" => {
                let mut item = json!({"role":"tool","tool_call_id":message["toolCallId"],"content":text(&content)});
                if flag(model,"requiresToolResultName",false) { item["name"] = message["toolName"].clone(); }
                wire.push(item);
                if content.iter().any(|b| b["type"] == "image") {
                    let images: Vec<_> = content.iter().filter(|b| b["type"] == "image").cloned().collect();
                    wire.push(json!({"role":"user","content":input_blocks(&images,Protocol::Completions)?}));
                }
            },
            "assistant" => {
                let mut item = json!({"role":"assistant","content":Value::Null});
                let mut texts = Vec::new();
                let mut calls = Vec::new();
                let mut details = Vec::new();
                for block in &content {
                    match block["type"].as_str() {
                        Some("text") => texts.push(string(block,"text")?.to_owned()),
                        Some("thinking") if block["redacted"] != true => {
                            if let Some(metadata) = continuation(block,Protocol::Completions,message["continuationAllowed"] == true) {
                                if let Some(preserved) = metadata["reasoningDetails"].as_array() { details.extend(preserved.iter().cloned()); }
                                else {
                                    let field = metadata["field"].as_str().unwrap_or("reasoning_content");
                                    if !matches!(field,"reasoning"|"reasoning_content"|"reasoning_text") { return Err(INVALID.into()); }
                                    item[field] = block["thinking"].clone();
                                }
                            } else if block["thinking"].as_str().is_some_and(|s| !s.is_empty()) { texts.push(block["thinking"].as_str().unwrap().to_owned()); }
                        },
                        Some("thinking") => {
                            if let Some(preserved) = continuation(block,Protocol::Completions,message["continuationAllowed"] == true).and_then(|c| c["reasoningDetails"].as_array()) { details.extend(preserved.iter().cloned()); }
                        },
                        Some("toolCall") => calls.push(json!({"id":block["id"],"type":"function","function":{"name":string(block,"name")?,"arguments":serde_json::to_string(&block["arguments"]).map_err(|_| INVALID)?}})),
                        _ => return Err(UNSUPPORTED.into()),
                    }
                }
                if !texts.is_empty() { item["content"] = json!(texts.join("\n")); }
                if !calls.is_empty() { item["tool_calls"] = json!(calls); }
                if !details.is_empty() { item["reasoning_details"] = json!(details); }
                if flag(model,"requiresReasoningContentOnAssistantMessages",false) && item.get("reasoning_content").is_none() { item["reasoning_content"] = json!(""); }
                wire.push(item);
            },
            _ => return Err(UNSUPPORTED.into()),
        }
    }
    Ok(wire)
}

struct Slot {
    key: String,
    block: Value,
    arguments: String,
    complete: bool,
}

pub(crate) struct Assembler {
    protocol: Protocol,
    model: Value,
    timestamp: u64,
    buffer: Vec<u8>,
    data: String,
    event: String,
    slots: Vec<Slot>,
    usage: Value,
    response_id: Option<String>,
    stop: Option<String>,
    raw_finish: Value,
    terminal: bool,
    error: Option<String>,
}

impl Assembler {
    pub(crate) fn new(api: &str, model: Value, timestamp: u64) -> Result<Self, String> {
        let protocol = Protocol::parse(api)?;
        if model["api"] != api {
            return Err(INVALID.into());
        }
        Ok(Self {
            protocol,
            model,
            timestamp,
            buffer: Vec::new(),
            data: String::new(),
            event: String::new(),
            slots: Vec::new(),
            usage: json!({}),
            response_id: None,
            stop: None,
            raw_finish: Value::Null,
            terminal: false,
            error: None,
        })
    }

    // `pending` is transient; the owner marks observed output error/aborted
    // before retaining it after a transport failure or cancellation.
    pub(crate) fn partial(&self) -> Value {
        let mut message = json!({"role":"assistant","content":self.slots.iter().filter(|s| s.block["type"] != "toolCall" || (s.block["id"].as_str().is_some_and(|s| !s.is_empty()) && s.block["name"].as_str().is_some_and(|s| !s.is_empty()))).map(|s| s.block.clone()).collect::<Vec<_>>(),"timestamp":self.timestamp,"stopReason":self.stop.as_deref().unwrap_or("pending"),"usage":accounting(&self.usage,self.protocol,&self.model)});
        if let Some(id) = &self.response_id {
            message["responseId"] = json!(id);
        }
        if !self.raw_finish.is_null() {
            message["rawStopReason"] = self.raw_finish.clone();
            message["endTurn"] = json!(
                self.terminal
                    && self.stop.as_deref() == Some("stop")
                    && self.raw_finish != "pause_turn"
            );
        }
        message
    }

    fn fail<T>(&mut self, error: &str) -> Result<T, String> {
        self.error = Some(error.into());
        self.stop = Some("error".into());
        Err(error.into())
    }

    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<Option<Value>, String> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        if self.buffer.len().saturating_add(bytes.len()) > MAX_FRAME {
            return self.fail(INVALID);
        }
        self.buffer.extend_from_slice(bytes);
        let before = self.partial();
        if let Err(error) = self.drain(false) {
            return self.fail(&error);
        }
        let partial = self.partial();
        Ok((partial != before).then_some(partial))
    }

    #[cfg(test)]
    pub(crate) fn finish(mut self) -> Result<Value, String> {
        self.finalize()
    }

    // Retain EOF-dispatched output for partial() when final validation fails after transport succeeds.
    pub(crate) fn finalize(&mut self) -> Result<Value, String> {
        match self.finish_inner() {
            Ok(message) => Ok(message),
            Err(error) => self.fail(&error),
        }
    }

    fn finish_inner(&mut self) -> Result<Value, String> {
        if let Some(error) = self.error.clone() {
            return Err(error);
        }
        self.drain(true)?;
        if !self.terminal {
            return Err(INCOMPLETE.into());
        }
        for slot in &mut self.slots {
            if slot.block["type"] == "toolCall" {
                if self.protocol != Protocol::Completions && !slot.complete {
                    return Err(INCOMPLETE.into());
                }
                if self.protocol != Protocol::Anthropic && slot.arguments.is_empty() {
                    return Err(INVALID.into());
                }
                if !slot.arguments.is_empty() {
                    let args: Value = serde_json::from_str(&slot.arguments).map_err(|_| INVALID)?;
                    if !args.is_object() {
                        return Err(INVALID.into());
                    }
                    slot.block["arguments"] = args;
                }
                if !slot.block["arguments"].is_object()
                    || slot.block["id"].as_str().is_none_or(|s| s.is_empty())
                    || slot.block["name"].as_str().is_none_or(|s| s.is_empty())
                {
                    return Err(INVALID.into());
                }
            }
        }
        if self.stop.as_deref() == Some("stop")
            && self.slots.iter().any(|s| s.block["type"] == "toolCall")
        {
            self.stop = Some("toolUse".into());
        }
        Ok(self.partial())
    }

    fn drain(&mut self, eof: bool) -> Result<(), String> {
        if self.buffer.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{') {
            let mut stream =
                serde_json::Deserializer::from_slice(&self.buffer).into_iter::<Value>();
            match stream.next() {
                Some(Ok(frame)) => {
                    let consumed = stream.byte_offset();
                    self.buffer.drain(..consumed);
                    self.frame(frame)?;
                    return self.drain(eof);
                }
                Some(Err(error)) if error.is_eof() && !eof => return Ok(()),
                _ => return Err(INVALID.into()),
            }
        }
        while let Some(index) = self.buffer.iter().position(|b| matches!(b, b'\r' | b'\n')) {
            if self.buffer[index] == b'\r' && index + 1 == self.buffer.len() && !eof {
                break;
            }
            let count = index
                + if self.buffer[index] == b'\r' && self.buffer.get(index + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
            let line = std::str::from_utf8(&self.buffer[..index])
                .map_err(|_| INVALID)?
                .to_owned();
            self.buffer.drain(..count);
            self.line(&line)?;
        }
        if eof {
            if !self.buffer.is_empty() {
                let line =
                    String::from_utf8(std::mem::take(&mut self.buffer)).map_err(|_| INVALID)?;
                self.line(&line)?;
            }
            self.dispatch()?;
        }
        Ok(())
    }
    fn line(&mut self, line: &str) -> Result<(), String> {
        let line = line.trim_start_matches('\u{feff}');
        if line.is_empty() {
            return self.dispatch();
        }
        if line.starts_with(':') {
            return Ok(());
        }
        if line.starts_with('{') {
            let value = serde_json::from_str(line).map_err(|_| INVALID)?;
            return self.frame(value);
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "data" => {
                if self.data.len() + value.len() + 1 > MAX_FRAME {
                    return Err(INVALID.into());
                }
                self.data.push_str(value);
                self.data.push('\n');
            }
            "event" => self.event = value.to_owned(),
            "id" | "retry" => (),
            _ => (),
        }
        Ok(())
    }
    fn dispatch(&mut self) -> Result<(), String> {
        let data = std::mem::take(&mut self.data);
        let event = std::mem::take(&mut self.event);
        let data = data.trim();
        if data.is_empty() {
            return Ok(());
        }
        if data == "[DONE]" {
            if self.protocol != Protocol::Completions {
                return Err(INCOMPLETE.into());
            }
            if self.stop.is_none() && flag(&self.model, "supportsFinishReason", true) {
                return Err(INCOMPLETE.into());
            }
            self.terminal = true;
            if self.stop.is_none() {
                self.stop = Some("stop".into());
            }
            return Ok(());
        }
        let mut frame: Value = serde_json::from_str(data).map_err(|_| INVALID)?;
        if frame.get("type").is_none() && !event.is_empty() {
            frame["type"] = json!(event);
        }
        self.frame(frame)
    }
    fn slot(&mut self, key: String, block: Value) -> &mut Slot {
        if let Some(index) = self.slots.iter().position(|s| s.key == key) {
            return &mut self.slots[index];
        }
        self.slots.push(Slot {
            key,
            block,
            arguments: String::new(),
            complete: false,
        });
        self.slots.last_mut().unwrap()
    }
    fn frame(&mut self, frame: Value) -> Result<(), String> {
        if !frame.is_object() {
            return Err(INVALID.into());
        }
        if frame.get("error").is_some_and(|e| !e.is_null())
            || frame["type"] == "error"
            || matches!(
                frame["type"].as_str(),
                Some("response.failed" | "response.error")
            )
        {
            return Err(REJECTED.into());
        }
        match self.protocol {
            Protocol::Responses | Protocol::Codex => self.responses_frame(&frame),
            Protocol::Completions => self.completions_frame(&frame),
            Protocol::Anthropic => self.anthropic_frame(&frame),
        }
    }
    fn merge_usage(&mut self, usage: &Value) {
        if let Some(usage) = usage.as_object() {
            for (key, value) in usage {
                self.usage[key] = value.clone();
            }
        }
    }
    fn set_stop(&mut self, raw: &str) -> Result<(), String> {
        self.stop = Some(
            match raw {
                "stop" | "end" | "end_turn" | "stop_sequence" | "completed" | "pause_turn" => {
                    "stop"
                }
                "length" | "max_tokens" | "max_output_tokens" | "model_context_window_exceeded" => {
                    "length"
                }
                "tool_calls" | "function_call" | "tool_use" => "toolUse",
                "content_filter" | "network_error" | "refusal" | "sensitive" => {
                    self.raw_finish = json!(raw);
                    return Err(REJECTED.into());
                }
                _ => return Err(REJECTED.into()),
            }
            .into(),
        );
        self.raw_finish = json!(raw);
        Ok(())
    }

    fn completions_frame(&mut self, frame: &Value) -> Result<(), String> {
        if let Some(id) = frame["id"].as_str() {
            self.response_id = Some(id.into());
        }
        self.merge_usage(&frame["usage"]);
        let choices = frame["choices"].as_array().ok_or(INVALID)?;
        for choice in choices {
            if choice["index"].as_u64().unwrap_or(0) != 0 {
                continue;
            }
            let delta = choice
                .get("delta")
                .or_else(|| choice.get("message"))
                .ok_or(INVALID)?;
            if let Some(content) = delta["content"].as_str() {
                let slot = self.slot("text".into(), json!({"type":"text","text":""}));
                append(&mut slot.block, "text", content)?;
            }
            for field in ["reasoning_content", "reasoning", "reasoning_text"] {
                if let Some(reasoning) = delta[field].as_str().filter(|s| !s.is_empty()) {
                    let api = self.protocol.api();
                    let slot = self.slot("thinking".into(),json!({"type":"thinking","thinking":"","continuation":{"format":api,"data":{"field":field}}}));
                    append(&mut slot.block, "thinking", reasoning)?;
                    break;
                }
            }
            if let Some(details) = delta["reasoning_details"].as_array() {
                let api = self.protocol.api();
                let slot = self.slot("thinking".into(),json!({"type":"thinking","thinking":"","continuation":{"format":api,"data":{}}}));
                if !slot.block["continuation"]["data"]["reasoningDetails"].is_array() {
                    slot.block["continuation"]["data"]["reasoningDetails"] = json!([]);
                }
                for detail in details {
                    merge_reasoning_detail(
                        slot.block["continuation"]["data"]["reasoningDetails"]
                            .as_array_mut()
                            .unwrap(),
                        detail,
                    );
                }
            }
            if let Some(calls) = delta["tool_calls"].as_array() {
                for call in calls {
                    let index = call["index"].as_u64().ok_or(INVALID)?;
                    let slot = self.slot(
                        format!("call:{index}"),
                        json!({"type":"toolCall","id":"","name":"","arguments":{}}),
                    );
                    if let Some(id) = call["id"].as_str() {
                        append(&mut slot.block, "id", id)?;
                    }
                    if let Some(name) = call["function"]["name"].as_str() {
                        append(&mut slot.block, "name", name)?;
                    }
                    if let Some(arguments) = call["function"]["arguments"].as_str() {
                        append_arguments(slot, arguments)?;
                    }
                }
            }
            if let Some(function) = delta.get("function_call") {
                let slot = self.slot(
                    "call:0".into(),
                    json!({"type":"toolCall","id":"call_0","name":"","arguments":{}}),
                );
                if let Some(name) = function["name"].as_str() {
                    append(&mut slot.block, "name", name)?;
                }
                if let Some(args) = function["arguments"].as_str() {
                    append_arguments(slot, args)?;
                }
            }
            if let Some(reason) = choice["finish_reason"].as_str() {
                self.set_stop(reason)?;
                self.terminal = true;
            }
        }
        Ok(())
    }

    fn responses_frame(&mut self, frame: &Value) -> Result<(), String> {
        let kind = string(frame, "type")?;
        if let Some(id) = frame["response"]["id"].as_str() {
            self.response_id = Some(id.into());
        }
        let indexed = kind.starts_with("response.output_")
            || kind.starts_with("response.function_call_arguments.")
            || kind.starts_with("response.reasoning_")
            || kind.starts_with("response.refusal.");
        let index = if indexed {
            frame["output_index"].as_u64().ok_or(INVALID)?
        } else {
            0
        };
        match kind {
            "response.output_item.added" | "response.output_item.done" => {
                self.response_item(index, &frame["item"], kind.ends_with("done"))?
            }
            "response.output_text.delta" | "response.refusal.delta" => {
                let ci = frame["content_index"].as_u64().unwrap_or(0);
                let api = self.protocol.api();
                let slot = self.slot(format!("item:{index}:text:{ci}"),json!({"type":"text","text":"","continuation":{"format":api,"data":{"item":{"type":"message","id":frame["item_id"]}}}}));
                append(&mut slot.block, "text", string(frame, "delta")?)?;
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                let api = self.protocol.api();
                let slot = self.slot(format!("item:{index}:thinking"),json!({"type":"thinking","thinking":"","continuation":{"format":api,"data":{"item":{"id":frame["item_id"],"type":"reasoning","summary":[]}}}}));
                append(&mut slot.block, "thinking", string(frame, "delta")?)?;
            }
            "response.reasoning_summary_part.added" => {
                if frame["summary_index"].as_u64().unwrap_or(0) > 0
                    && let Some(slot) = self
                        .slots
                        .iter_mut()
                        .find(|s| s.key == format!("item:{index}:thinking"))
                {
                    append(&mut slot.block, "thinking", "\n")?;
                }
            }
            "response.function_call_arguments.delta" => {
                let key = format!("item:{index}:call");
                let slot = self
                    .slots
                    .iter_mut()
                    .find(|s| s.key == key)
                    .ok_or(INVALID)?;
                append_arguments(slot, string(frame, "delta")?)?;
            }
            "response.function_call_arguments.done" => {
                let slot = self
                    .slots
                    .iter_mut()
                    .find(|s| s.key == format!("item:{index}:call"))
                    .ok_or(INVALID)?;
                slot.arguments = string(frame, "arguments")?.into();
                let args: Value = serde_json::from_str(&slot.arguments).map_err(|_| INVALID)?;
                if !args.is_object() {
                    return Err(INVALID.into());
                }
                slot.block["arguments"] = args;
            }
            "response.completed" | "response.done" | "response.incomplete" => {
                let response = &frame["response"];
                if response["error"].is_object()
                    || matches!(
                        response["status"].as_str(),
                        Some("failed" | "cancelled" | "queued" | "in_progress")
                    )
                {
                    return Err(REJECTED.into());
                }
                if let Some(output) = response["output"].as_array() {
                    for (index, item) in output.iter().enumerate() {
                        self.response_item(index as u64, item, true)?;
                    }
                }
                self.merge_usage(&response["usage"]);
                if let Some(tier) = response.get("service_tier") {
                    self.usage["service_tier"] = tier.clone();
                }
                let reason = if kind == "response.incomplete" || response["status"] == "incomplete"
                {
                    response["incomplete_details"]["reason"]
                        .as_str()
                        .ok_or(REJECTED)?
                } else {
                    "completed"
                };
                self.set_stop(reason)?;
                if response["status"] == "incomplete" || kind == "response.incomplete" {
                    self.raw_finish = json!(format!("incomplete.{reason}"));
                }
                self.terminal = true;
            }
            _ => (),
        }
        Ok(())
    }
    fn response_item(&mut self, index: u64, item: &Value, done: bool) -> Result<(), String> {
        let api = self.protocol.api();
        match item["type"].as_str() {
            Some("message") => {
                if let Some(content) = item["content"].as_array() {
                    for (ci, part) in content.iter().enumerate() {
                        let value = match part["type"].as_str() {
                            Some("output_text") => part["text"].as_str(),
                            Some("refusal") => part["refusal"].as_str(),
                            _ => return Err(UNSUPPORTED.into()),
                        }
                        .ok_or(INVALID)?;
                        let slot = self.slot(
                            format!("item:{index}:text:{ci}"),
                            json!({"type":"text","text":""}),
                        );
                        if done || slot.block["text"] == "" {
                            slot.block["text"] = json!(value);
                        }
                        let mut metadata = json!({"type":"message"});
                        for key in ["id", "phase"] {
                            if let Some(value) = item.get(key) {
                                metadata[key] = value.clone();
                            }
                        }
                        slot.block["continuation"] = json!({"format":api,"data":{"item":metadata}});
                    }
                }
            }
            Some("reasoning") => {
                let slot = self.slot(
                    format!("item:{index}:thinking"),
                    json!({"type":"thinking","thinking":""}),
                );
                let summary = item["summary"]
                    .as_array()
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|p| p["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n\n")
                    })
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        item["content"]
                            .as_array()
                            .map(|parts| {
                                parts
                                    .iter()
                                    .filter_map(|p| p["text"].as_str())
                                    .collect::<Vec<_>>()
                                    .join("\n\n")
                            })
                            .filter(|s| !s.is_empty())
                    });
                if let Some(summary) = summary {
                    slot.block["thinking"] = json!(summary);
                }
                let mut metadata = json!({"type":"reasoning"});
                for field in ["id", "summary", "content", "encrypted_content", "status"] {
                    if let Some(value) = item.get(field) {
                        metadata[field] = value.clone();
                    }
                }
                slot.block["continuation"] = json!({"format":api,"data":{"item":metadata}});
                if let Some(signature) = item.get("encrypted_content") {
                    slot.block["thinkingSignature"] = signature.clone();
                }
            }
            Some("function_call") => {
                let slot = self.slot(format!("item:{index}:call"),json!({"type":"toolCall","id":string(item,"call_id")?,"name":string(item,"name")?,"arguments":{}}));
                slot.block["id"] = json!(string(item, "call_id")?);
                slot.block["name"] = json!(string(item, "name")?);
                if let Some(namespace) = item.get("namespace") {
                    slot.block["namespace"] = namespace.clone();
                }
                slot.complete = done;
                slot.block["continuation"] =
                    json!({"format":api,"data":{"item":{"id":item["id"],"type":"function_call"}}});
                if let Some(args) = item["arguments"].as_str()
                    && (done || !args.is_empty())
                {
                    slot.arguments = args.into();
                    if let Ok(args) = serde_json::from_str::<Value>(args)
                        && args.is_object()
                    {
                        slot.block["arguments"] = args;
                    }
                }
            }
            _ => return Err(UNSUPPORTED.into()),
        }
        Ok(())
    }

    fn anthropic_frame(&mut self, frame: &Value) -> Result<(), String> {
        let kind = string(frame, "type")?;
        let index = frame["index"].as_u64().unwrap_or(0);
        let key = format!("block:{index}");
        match kind {
            "message_start" => {
                self.response_id = frame["message"]["id"].as_str().map(str::to_owned);
                self.merge_usage(&frame["message"]["usage"]);
            }
            "content_block_start" => {
                let block = &frame["content_block"];
                let content = match block["type"].as_str() {
                    Some("text") => json!({"type":"text","text":string(block,"text")?}),
                    Some("thinking") => {
                        json!({"type":"thinking","thinking":block["thinking"].as_str().unwrap_or(""),"thinkingSignature":block["signature"].as_str().unwrap_or(""),"continuation":{"format":self.protocol.api(),"data":{}}})
                    }
                    Some("redacted_thinking") => {
                        json!({"type":"thinking","thinking":"","redacted":true,"thinkingSignature":string(block,"data")?,"continuation":{"format":self.protocol.api(),"data":{}}})
                    }
                    Some("tool_use") => {
                        if !block["input"].is_object() {
                            return Err(INVALID.into());
                        }
                        json!({"type":"toolCall","id":string(block,"id")?,"name":string(block,"name")?,"arguments":block["input"]})
                    }
                    _ => return Err(UNSUPPORTED.into()),
                };
                if self.slots.iter().any(|s| s.key == key) {
                    return Err(INVALID.into());
                }
                self.slot(key, content);
            }
            "content_block_delta" => {
                let slot = self
                    .slots
                    .iter_mut()
                    .find(|s| s.key == key)
                    .ok_or(INVALID)?;
                let delta = &frame["delta"];
                match delta["type"].as_str() {
                    Some("text_delta") => append(&mut slot.block, "text", string(delta, "text")?)?,
                    Some("thinking_delta") => {
                        append(&mut slot.block, "thinking", string(delta, "thinking")?)?
                    }
                    Some("signature_delta") => append(
                        &mut slot.block,
                        "thinkingSignature",
                        string(delta, "signature")?,
                    )?,
                    Some("input_json_delta") => {
                        append_arguments(slot, string(delta, "partial_json")?)?
                    }
                    _ => return Err(UNSUPPORTED.into()),
                }
            }
            "content_block_stop" => {
                let slot = self
                    .slots
                    .iter_mut()
                    .find(|s| s.key == key)
                    .ok_or(INVALID)?;
                if slot.block["type"] == "toolCall" && !slot.arguments.is_empty() {
                    slot.block["arguments"] =
                        serde_json::from_str(&slot.arguments).map_err(|_| INVALID)?;
                }
                slot.complete = true;
            }
            "message_delta" => {
                self.merge_usage(&frame["usage"]);
                if let Some(reason) = frame["delta"]["stop_reason"].as_str() {
                    self.set_stop(reason)?;
                }
            }
            "message_stop" => {
                if self.stop.is_none() || self.slots.iter().any(|s| !s.complete) {
                    return Err(INCOMPLETE.into());
                }
                self.terminal = true;
            }
            "ping" => (),
            _ => (),
        }
        Ok(())
    }
}

fn append(block: &mut Value, field: &str, delta: &str) -> Result<(), String> {
    let current = block[field].as_str().ok_or(INVALID)?;
    if current.len().saturating_add(delta.len()) > MAX_FRAME {
        return Err(INVALID.into());
    }
    block[field] = json!(format!("{current}{delta}"));
    Ok(())
}
fn append_arguments(slot: &mut Slot, delta: &str) -> Result<(), String> {
    if slot.block["type"] != "toolCall" {
        return Err(INVALID.into());
    }
    if slot.arguments.len().saturating_add(delta.len()) > MAX_FRAME {
        return Err(INVALID.into());
    }
    slot.arguments.push_str(delta);
    if let Ok(args) = serde_json::from_str::<Value>(&slot.arguments)
        && args.is_object()
    {
        slot.block["arguments"] = args;
    }
    Ok(())
}
fn merge_reasoning_detail(details: &mut Vec<Value>, detail: &Value) {
    let matching = details.iter().position(|d| {
        d["type"] == detail["type"] && d["id"] == detail["id"] && d["index"] == detail["index"]
    });
    if let Some(index) = matching {
        if let Some(fields) = detail.as_object() {
            for (key, value) in fields {
                if matches!(key.as_str(), "text" | "summary" | "data") && value.is_string() {
                    let previous = details[index][key].as_str().unwrap_or("");
                    details[index][key] = json!(format!("{previous}{}", value.as_str().unwrap()));
                } else {
                    details[index][key] = value.clone();
                }
            }
        }
    } else {
        details.push(detail.clone());
    }
}

fn count(value: &Value) -> Option<u64> {
    value.as_u64()
}
fn sum(values: &[Option<u64>]) -> Option<u64> {
    values
        .iter()
        .try_fold(0u64, |total, value| total.checked_add((*value)?))
}
fn accounting(raw: &Value, protocol: Protocol, model: &Value) -> Value {
    let anthropic = protocol == Protocol::Anthropic;
    let completions = protocol == Protocol::Completions;
    let known_openai = matches!(model["provider"].as_str(), Some("openai" | "openai-codex"));
    let input_total = count(
        &raw[if completions {
            "prompt_tokens"
        } else {
            "input_tokens"
        }],
    );
    let output = count(
        &raw[if completions {
            "completion_tokens"
        } else {
            "output_tokens"
        }],
    );
    let detail = &raw[if completions {
        "prompt_tokens_details"
    } else {
        "input_tokens_details"
    }];
    let read = if anthropic {
        raw.get("cache_read_input_tokens")
    } else {
        detail
            .get("cached_tokens")
            .or_else(|| raw.get("prompt_cache_hit_tokens"))
            .or_else(|| raw.get("cached_tokens"))
    };
    let write = if anthropic {
        raw.get("cache_creation_input_tokens")
    } else {
        detail.get("cache_write_tokens")
    };
    // Only absent optional OpenAI counters have defined zero semantics. Explicit
    // null, malformed counters and unspecified custom-endpoint usage stay unknown.
    let optional = |value: Option<&Value>, reported: bool| match value {
        Some(value) => count(value),
        None if known_openai && reported => Some(0),
        None => None,
    };
    let cache_details_known = raw
        .get(if completions {
            "prompt_tokens_details"
        } else {
            "input_tokens_details"
        })
        .is_none_or(Value::is_object);
    let read = optional(read, input_total.is_some() && cache_details_known);
    let write = optional(write, input_total.is_some() && cache_details_known);
    let reasoning = optional(
        raw[if completions {
            "completion_tokens_details"
        } else {
            "output_tokens_details"
        }]
        .get(if anthropic {
            "thinking_tokens"
        } else {
            "reasoning_tokens"
        }),
        output.is_some()
            && raw
                .get(if completions {
                    "completion_tokens_details"
                } else {
                    "output_tokens_details"
                })
                .is_none_or(Value::is_object),
    );
    let long_write = if anthropic {
        match raw["cache_creation"].get("ephemeral_1h_input_tokens") {
            Some(value) => count(value),
            None if write.is_some() => Some(0),
            None => None,
        }
    } else {
        None
    };
    let input = if anthropic {
        input_total
    } else {
        input_total.and_then(|n| n.checked_sub(read?).and_then(|n| n.checked_sub(write?)))
    };
    let total = count(&raw["total_tokens"]).or_else(|| sum(&[input, output, read, write]));
    let prompt = if anthropic {
        sum(&[input, read, write])
    } else {
        input_total
    };
    let mut rates = &model["cost"];
    // Manual custom-model zero placeholders are not verified server prices.
    if model["provider"] == "custom"
        && ["input", "output", "cacheRead", "cacheWrite"]
            .iter()
            .all(|key| model["cost"][*key].as_f64() == Some(0.0))
    {
        rates = &Value::Null;
    }
    if let Some(tiers) = model["cost"]["tiers"]
        .as_array()
        .filter(|tiers| !tiers.is_empty())
    {
        if let Some(prompt) = prompt {
            if let Some(tier) = tiers
                .iter()
                .filter(|tier| {
                    tier["inputTokensAbove"]
                        .as_u64()
                        .is_some_and(|threshold| prompt > threshold)
                })
                .max_by_key(|tier| tier["inputTokensAbove"].as_u64())
            {
                rates = tier;
            }
        } else {
            rates = &Value::Null;
        }
    }
    let rate = |key: &str| rates[key].as_f64().filter(|r| r.is_finite() && *r >= 0.0);
    let multiplier = if known_openai && protocol.responses() {
        match raw["service_tier"].as_str() {
            Some("flex") => Some(0.5),
            Some("priority" | "fast") => Some(if model["id"] == "gpt-5.5" { 2.5 } else { 2.0 }),
            None | Some("default" | "auto" | "standard") => Some(1.0),
            _ => None,
        }
    } else {
        Some(1.0)
    };
    let mut cost = json!({});
    for (key, tokens) in [
        ("input", input),
        ("output", output),
        ("cacheRead", read),
        ("cacheWrite", write),
    ] {
        let amount = tokens
            .and_then(|tokens| {
                if key == "cacheWrite" && anthropic {
                    let long = long_write?;
                    Some(
                        (tokens.checked_sub(long)? as f64 * rate(key)?
                            + long as f64 * rate("input")? * 2.0)
                            / 1_000_000.0,
                    )
                } else {
                    Some(tokens as f64 * rate(key)? / 1_000_000.0)
                }
            })
            .and_then(|cost| Some(cost * multiplier?));
        cost[key] = json!(amount);
    }
    cost["total"] = json!(
        ["input", "output", "cacheRead", "cacheWrite"]
            .iter()
            .try_fold(0.0, |total, key| Some(total + cost[*key].as_f64()?))
    );
    let mut usage = json!({"input":input,"output":output,"cacheRead":read,"cacheWrite":write,"reasoning":reasoning,"totalTokens":total,"cost":cost});
    if anthropic {
        usage["cacheWrite1h"] = json!(long_write);
    }
    usage
}

#[cfg(test)]
#[path = "ai_protocol_tests.rs"]
mod tests;
