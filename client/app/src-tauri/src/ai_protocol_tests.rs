// Synthetic wire fixtures adapted from Situate's adapters.test.ts and
// recommendation-adapters.test.ts. See ai_protocol.rs for upstream MIT notice.
use super::*;

fn model(api: &str) -> Value {
    json!({"id":"fixture","api":api,"provider":match api {
        "anthropic-messages"=>"anthropic","openai-codex-responses"=>"openai-codex",_=>"openai"
    },"baseUrl":if api == "openai-codex-responses" {"https://chatgpt.com/backend-api"} else {"https://fixture.invalid"},"reasoning":true,"maxTokens":32000,
        "cost":{"input":1,"output":2,"cacheRead":0.5,"cacheWrite":1.25}})
}
fn same_origin(mut message: Value) -> Value {
    message["continuationAllowed"] = json!(true);
    message
}
fn tool() -> Value {
    json!({"name":"lookup_note","description":"Read a note","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}})
}
fn user() -> Value {
    json!({"role":"user","content":[{"type":"text","text":"Read note.md"}],"timestamp":1})
}
fn encoded(events: &[Value]) -> Vec<u8> {
    events
        .iter()
        .map(|e| {
            format!(
                "event: {}\r\ndata: {e}\r\n\r\n",
                e["type"].as_str().unwrap_or("message")
            )
        })
        .collect::<String>()
        .into_bytes()
}
fn assemble(api: &str, model: Value, events: &[Value], chunk: usize) -> Value {
    let mut parser = Assembler::new(api, model, 42).unwrap();
    for bytes in encoded(events).chunks(chunk) {
        parser.push(bytes).unwrap();
    }
    parser.finish().unwrap()
}
fn response_events(tool: bool) -> Vec<Value> {
    let item = if tool {
        json!({"id":"fc_note","type":"function_call","call_id":"call_note","name":"lookup_note","arguments":"{\"path\":\"note.md\"}","status":"completed"})
    } else {
        json!({"id":"msg_note","type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Saved note. 🦀","annotations":[]}]})
    };
    let mut events =
        vec![json!({"type":"response.created","response":{"id":"resp_note","output":[]}})];
    if tool {
        let mut initial = item.clone();
        initial["arguments"] = json!("");
        events.push(json!({"type":"response.output_item.added","output_index":0,"item":initial}));
        events.push(json!({"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\"path\":"}));
        events.push(json!({"type":"response.function_call_arguments.delta","output_index":0,"delta":"\"note.md\"}"}));
    } else {
        let mut initial = item.clone();
        initial["content"] = json!([]);
        events.push(json!({"type":"response.output_item.added","output_index":0,"item":initial}));
        events.push(json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_note","delta":"Saved note. 🦀"}));
        events.push(
            json!({"type":"response.output_text.done","output_index":0,"text":"Saved note. 🦀"}),
        );
    }
    events.push(json!({"type":"response.output_item.done","output_index":0,"item":item}));
    events.push(json!({"type":"response.completed","response":{"id":"resp_note","status":"completed","output":[item],"usage":{"input_tokens":2,"output_tokens":8,"total_tokens":10}}}));
    events
}
fn anthropic_events(tool: bool) -> Vec<Value> {
    let mut events = vec![
        json!({"type":"message_start","message":{"id":"msg_note","usage":{"input_tokens":2,"output_tokens":0}}}),
    ];
    if tool {
        events.extend([
            json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Read the note."}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"synthetic-"}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signature"}}),
            json!({"type":"content_block_stop","index":0}),
            json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_note","name":"lookup_note","input":{}}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"note.md\"}"}}),
            json!({"type":"content_block_stop","index":1}),
        ]);
    } else {
        events.extend([
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Saved note. 🦀"}}),
            json!({"type":"content_block_stop","index":0}),
        ]);
    }
    events.extend([
        json!({"type":"message_delta","delta":{"stop_reason":if tool {"tool_use"} else {"end_turn"}},"usage":{"output_tokens":8}}),
        json!({"type":"message_stop"}),
    ]);
    events
}
fn completion_events(tool: bool) -> Vec<Value> {
    if tool {
        vec![
            json!({"id":"chat_note","choices":[{"index":0,"delta":{"reasoning":"Read the note."},"finish_reason":null}]}),
            json!({"id":"chat_note","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_note","type":"function","function":{"name":"lookup_note","arguments":"{\"path\":"}}]},"finish_reason":null}]}),
            json!({"id":"chat_note","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"note.md\"}"}}]},"finish_reason":null}]}),
            json!({"id":"chat_note","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
        ]
    } else {
        vec![
            json!({"id":"chat_note","choices":[{"index":0,"delta":{"content":"Saved note. 🦀"},"finish_reason":null}]}),
            json!({"id":"chat_note","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}),
        ]
    }
}

#[test]
fn every_protocol_decodes_text_at_every_byte_boundary_without_duplicate_done_text() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
        "openai-completions",
    ] {
        let events = match api {
            "anthropic-messages" => anthropic_events(false),
            "openai-completions" => completion_events(false),
            _ => response_events(false),
        };
        for chunk in [1, 2, 3, 7, 1024, 65536] {
            let reply = assemble(api, model(api), &events, chunk);
            assert_eq!(reply["role"], "assistant");
            assert_eq!(reply["timestamp"], 42);
            assert_eq!(reply["stopReason"], "stop");
            assert_eq!(reply["content"].as_array().unwrap().len(), 1);
            assert_eq!(reply["content"][0]["text"], "Saved note. 🦀");
            for field in ["api", "provider", "model"] {
                assert!(reply.get(field).is_none());
            }
        }
    }
}

#[test]
fn every_protocol_round_trips_tool_calls_with_fragmented_arguments() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
        "openai-completions",
    ] {
        let events = match api {
            "anthropic-messages" => anthropic_events(true),
            "openai-completions" => completion_events(true),
            _ => response_events(true),
        };
        let reply = assemble(api, model(api), &events, 1);
        assert_eq!(reply["stopReason"], "toolUse");
        let call = reply["content"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["type"] == "toolCall")
            .unwrap();
        assert_eq!(call["arguments"], json!({"path":"note.md"}));
        assert_eq!(call["name"], "lookup_note");
        let result = json!({"role":"toolResult","toolCallId":call["id"],"toolName":"lookup_note","content":[{"type":"text","text":"Note contents."}],"isError":false});
        let context = [
            json!({"role":"system","content":"Read notes before answering."}),
            user(),
            reply,
            result,
        ];
        let request =
            build_request(api, &model(api), "medium", &context, &[tool()], Some(16000)).unwrap();
        let body = request.body.to_string();
        assert!(body.contains("Note contents."));
        assert!(body.contains("lookup_note"));
        assert!(!request.headers.contains_key("authorization"));
        assert!(!request.headers.contains_key("x-api-key"));
    }
}

#[test]
fn codex_has_distinct_instructions_encrypted_reasoning_and_done_contract() {
    let api = "openai-codex-responses";
    let mut model = model(api);
    model["thinkingLevelMap"] = json!({"minimal":"low","off":null});
    let request = build_request(
        api,
        &model,
        "minimal",
        &[json!({"role":"system","content":"Answer briefly."}), user()],
        &[tool()],
        Some(256),
    )
    .unwrap();
    assert_eq!(request.body["instructions"], "Answer briefly.");
    assert_eq!(request.body["input"][0]["role"], "user");
    assert_eq!(request.body["store"], false);
    assert_eq!(
        request.body["reasoning"],
        json!({"effort":"low","summary":"auto"})
    );
    assert_eq!(
        request.body["include"],
        json!(["reasoning.encrypted_content"])
    );
    assert_eq!(request.body["text"], json!({"verbosity":"low"}));
    assert_eq!(request.body["tool_choice"], "auto");
    assert_eq!(request.body["parallel_tool_calls"], true);
    assert!(request.body["tools"][0].get("strict").unwrap().is_null());
    for field in [
        "max_output_tokens",
        "prompt_cache_retention",
        "prompt_cache_options",
        "reasoning_effort",
    ] {
        assert!(request.body.get(field).is_none());
    }
    assert!(request.headers.is_empty());
    assert!(
        build_request(api, &model, "off", &[user()], &[], None)
            .unwrap()
            .body
            .get("reasoning")
            .is_none()
    );
    let mut events = response_events(true);
    events.last_mut().unwrap()["type"] = json!("response.done");
    let reply = assemble(api, model.clone(), &events, 3);
    assert_eq!(reply["stopReason"], "toolUse");
    assert_eq!(reply["responseId"], "resp_note");
    model["baseUrl"] = json!("https://other.invalid");
    assert!(build_request(api, &model, "off", &[user()], &[], None).is_err());
}

#[test]
fn responses_reasoning_and_phase_survive_native_continuation_without_encoded_signatures() {
    for api in ["openai-responses", "openai-codex-responses"] {
        let reasoning = json!({"id":"rs_note","type":"reasoning","summary":[{"type":"summary_text","text":"Read the note."}],"encrypted_content":"synthetic-encrypted-reasoning"});
        let events = vec![
            json!({"type":"response.output_item.added","output_index":0,"item":{"id":"rs_note","type":"reasoning","summary":[]}}),
            json!({"type":"response.reasoning_summary_text.delta","output_index":0,"delta":"Read the note."}),
            json!({"type":"response.output_item.done","output_index":0,"item":reasoning}),
            json!({"type":"response.completed","response":{"id":"resp_note","status":"completed","output":[reasoning]}}),
        ];
        let reply = assemble(api, model(api), &events, 1);
        assert_eq!(reply["content"][0]["thinking"], "Read the note.");
        assert_eq!(
            reply["content"][0]["thinkingSignature"],
            "synthetic-encrypted-reasoning"
        );
        let request = build_request(
            api,
            &model(api),
            "medium",
            &[user(), same_origin(reply)],
            &[],
            None,
        )
        .unwrap();
        assert_eq!(request.body["input"][1], reasoning);
        let reply = same_origin(assemble(api, model(api), &response_events(false), 8));
        let request = build_request(api, &model(api), "off", &[reply], &[], None).unwrap();
        assert_eq!(request.body["input"][0]["id"], "msg_note");
        assert_eq!(request.body["input"][0]["phase"], "final_answer");
    }
}

#[test]
fn anthropic_preserves_reasoning_signatures_and_redaction_in_native_blocks() {
    let api = "anthropic-messages";
    let mut events = anthropic_events(true);
    events.insert(6,json!({"type":"content_block_start","index":2,"content_block":{"type":"redacted_thinking","data":"opaque-redaction"}}));
    events.insert(7, json!({"type":"content_block_stop","index":2}));
    let reply = same_origin(assemble(api, model(api), &events, 2));
    assert_eq!(
        reply["content"][0]["thinkingSignature"],
        "synthetic-signature"
    );
    let request = build_request(api, &model(api), "medium", &[reply], &[], None).unwrap();
    assert_eq!(
        request.body["messages"][0]["content"][0],
        json!({"type":"thinking","thinking":"Read the note.","signature":"synthetic-signature"})
    );
    assert_eq!(
        request.body["messages"][0]["content"][1],
        json!({"type":"redacted_thinking","data":"opaque-redaction"})
    );
}

#[test]
fn anthropic_adaptive_managed_and_budget_reasoning_payloads() {
    let api = "anthropic-messages";
    let mut model = model(api);
    model["compat"] = json!({"forceAdaptiveThinking":true,"supportsMidConvoEffort":true});
    for thinking in ["low", "medium", "high", "xhigh", "max"] {
        let request =
            build_request(api, &model, thinking, &[user()], &[tool()], Some(20000)).unwrap();
        assert_eq!(
            request.body["thinking"],
            json!({"type":"adaptive","display":"summarized","block_binding":{"prefix_mismatch_behavior":"drop_block"}})
        );
        assert_eq!(request.body["output_config"], json!({"effort":"high"}));
        assert_eq!(
            request.body["messages"].as_array().unwrap().last().unwrap()["output_config"],
            json!({"effort":thinking})
        );
        assert_eq!(request.headers["anthropic-version"], "2023-06-01");
        assert_eq!(
            request.headers["anthropic-beta"],
            "mid-conversation-output-config-2026-07-01,thinking-binding-controls-2026-08-01"
        );
        assert_eq!(
            request.body["tools"][0]["input_schema"]["required"],
            json!(["path"])
        );
    }
    model["compat"] = json!({"forceAdaptiveThinking":true});
    let request = build_request(api, &model, "medium", &[user()], &[], None).unwrap();
    assert_eq!(
        request.body["thinking"],
        json!({"type":"adaptive","display":"summarized"})
    );
    assert_eq!(request.body["output_config"], json!({"effort":"medium"}));
    model["compat"] = json!({});
    let request = build_request(api, &model, "medium", &[user()], &[], Some(4096)).unwrap();
    assert_eq!(request.body["thinking"]["budget_tokens"], 3072);
    assert!(request.headers["anthropic-beta"].contains("interleaved-thinking"));
    assert!(build_request(api, &model, "high", &[user()], &[], Some(1024)).is_err());
    assert_eq!(
        build_request(api, &model, "off", &[user()], &[], None)
            .unwrap()
            .body["thinking"],
        json!({"type":"disabled"})
    );
}

#[test]
fn completions_custom_local_and_openrouter_requests_do_not_conflate_reasoning_shapes() {
    let api = "openai-completions";
    let mut model = model(api);
    model["provider"] = json!("custom");
    model["reasoning"] = json!(false);
    model["compat"] = json!({"supportsStore":false,"supportsDeveloperRole":false,"supportsReasoningEffort":false,"supportsUsageInStreaming":false,"maxTokensField":"max_tokens"});
    let request = build_request(api, &model, "off", &[user()], &[tool()], Some(256)).unwrap();
    assert_eq!(request.body["max_tokens"], 256);
    for field in [
        "store",
        "stream_options",
        "reasoning_effort",
        "max_completion_tokens",
    ] {
        assert!(request.body.get(field).is_none());
    }
    assert_eq!(request.body["tools"][0]["function"]["name"], "lookup_note");
    model["provider"] = json!("openrouter");
    model["reasoning"] = json!(true);
    model["compat"] = json!({"thinkingFormat":"openrouter","supportsStrictMode":true});
    let request = build_request(api, &model, "medium", &[user()], &[], None).unwrap();
    assert_eq!(request.body["reasoning"], json!({"effort":"medium"}));
    assert!(request.body.get("reasoning_effort").is_none());
    assert_eq!(request.body["stream_options"]["include_usage"], true);
    model["provider"] = json!("openai");
    model["compat"] = json!({});
    let request = build_request(api, &model, "medium", &[user()], &[], Some(256)).unwrap();
    assert_eq!(request.body["reasoning_effort"], "medium");
    assert_eq!(request.body["max_completion_tokens"], 256);
}

#[test]
fn responses_direct_chatgpt_uses_admitted_compat_without_identity_or_credential_access() {
    let api = "openai-responses";
    let mut model = model(api);
    model["compat"] = json!({"supportsMaxOutputTokens":false});
    let request = build_request(api, &model, "medium", &[user()], &[], Some(256)).unwrap();
    assert!(request.body.get("max_output_tokens").is_none());
    assert_eq!(request.body["store"], false);
    assert!(request.headers.is_empty());
    model["compat"] = json!({});
    assert_eq!(
        build_request(api, &model, "off", &[user()], &[], Some(256))
            .unwrap()
            .body["max_output_tokens"],
        256
    );
}

#[test]
fn usage_splits_cache_reads_and_writes_without_double_counting_reasoning() {
    for api in [
        "openai-completions",
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
    ] {
        let mut events = match api {
            "openai-completions" => completion_events(false),
            "anthropic-messages" => anthropic_events(false),
            _ => response_events(false),
        };
        if api == "openai-completions" {
            events.push(json!({"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"prompt_tokens_details":{"cached_tokens":30,"cache_write_tokens":10},"completion_tokens_details":{"reasoning_tokens":5}}}));
        } else if api == "anthropic-messages" {
            events
                .iter_mut()
                .find(|e| e["type"] == "message_delta")
                .unwrap()["usage"] = json!({"input_tokens":60,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":10,"output_tokens_details":{"thinking_tokens":5}});
        } else {
            events.last_mut().unwrap()["response"]["usage"] = json!({"input_tokens":100,"output_tokens":20,"total_tokens":120,"input_tokens_details":{"cached_tokens":30,"cache_write_tokens":10},"output_tokens_details":{"reasoning_tokens":5}});
        }
        let reply = assemble(api, model(api), &events, 7);
        assert_eq!(reply["usage"]["input"], 60);
        assert_eq!(reply["usage"]["output"], 20);
        assert_eq!(reply["usage"]["cacheRead"], 30);
        assert_eq!(reply["usage"]["cacheWrite"], 10);
        assert_eq!(reply["usage"]["reasoning"], 5);
        assert_eq!(reply["usage"]["totalTokens"], 120);
        assert!((reply["usage"]["cost"]["total"].as_f64().unwrap() - 0.0001275).abs() < 1e-12);
    }
}

#[test]
fn unknown_counters_and_costs_are_null_including_missing_custom_rates() {
    let api = "openai-completions";
    let mut model = model(api);
    model["provider"] = json!("custom");
    model["cost"] = Value::Null;
    let reply = assemble(api, model.clone(), &completion_events(false), 4);
    for field in [
        "input",
        "output",
        "cacheRead",
        "cacheWrite",
        "reasoning",
        "totalTokens",
    ] {
        assert!(reply["usage"][field].is_null());
    }
    for field in ["input", "output", "cacheRead", "cacheWrite", "total"] {
        assert!(reply["usage"]["cost"][field].is_null());
    }
    let mut events = completion_events(false);
    events.push(json!({"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}));
    let reply = assemble(api, model, &events, 9);
    assert!(reply["usage"]["input"].is_null());
    assert_eq!(reply["usage"]["output"], 20);
    assert_eq!(reply["usage"]["totalTokens"], 120);
    assert!(reply["usage"]["cost"]["total"].is_null());
}

#[test]
fn cost_tiers_use_total_prompt_including_cache() {
    let api = "openai-responses";
    let mut model = model(api);
    model["cost"]["tiers"] =
        json!([{"inputTokensAbove":50,"input":3,"output":4,"cacheRead":1,"cacheWrite":2}]);
    let mut events = response_events(false);
    events.last_mut().unwrap()["response"]["usage"] =
        json!({"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":90}});
    let reply = assemble(api, model, &events, 6);
    assert_eq!(reply["usage"]["input"], 10);
    assert!((reply["usage"]["cost"]["total"].as_f64().unwrap() - 0.0002).abs() < 1e-12);
}

#[test]
fn context_id_pairs_normalize_collisions_without_mutating_history() {
    for api in [
        "openai-responses",
        "openai-completions",
        "anthropic-messages",
    ] {
        let context = vec![
            user(),
            json!({"role":"assistant","content":[{"type":"toolCall","id":"same/id","name":"lookup_note","arguments":{}},{"type":"toolCall","id":"same?id","name":"lookup_note","arguments":{}}]}),
            json!({"role":"toolResult","toolCallId":"same?id","content":"second"}),
            json!({"role":"toolResult","toolCallId":"same/id","content":"first"}),
            json!({"role":"toolResult","toolCallId":"orphan","content":"ignore"}),
        ];
        let saved = context.clone();
        let request = build_request(api, &model(api), "off", &context, &[tool()], None).unwrap();
        let encoded = request.body.to_string();
        assert!(!encoded.contains("same/id"));
        assert!(!encoded.contains("same?id"));
        assert!(encoded.contains("same_id"));
        assert!(encoded.contains("same_id_1"));
        assert!(!encoded.contains("orphan"));
        assert_eq!(context, saved);
        let messages = if api == "openai-responses" {
            &request.body["input"]
        } else {
            &request.body["messages"]
        };
        let encoded = messages.to_string();
        assert!(encoded.contains("first"));
        assert!(encoded.contains("second"));
    }
}

#[test]
fn missing_results_are_wire_only_and_failed_turns_do_not_replay_tools() {
    let api = "openai-completions";
    let call = json!({"role":"assistant","content":[{"type":"toolCall","id":"call_x","name":"lookup_note","arguments":{}}]});
    let request = build_request(
        api,
        &model(api),
        "off",
        &[call.clone(), user()],
        &[tool()],
        None,
    )
    .unwrap();
    assert_eq!(request.body["messages"][1]["role"], "tool");
    assert_eq!(request.body["messages"][1]["tool_call_id"], "call_x");
    let mut failed = call;
    failed["stopReason"] = json!("aborted");
    let request =
        build_request(api, &model(api), "off", &[failed, user()], &[tool()], None).unwrap();
    assert_eq!(request.body["messages"].as_array().unwrap().len(), 1);
}

#[test]
fn native_image_blocks_are_mapped_in_user_and_tool_results() {
    let image = json!({"type":"image","mimeType":"image/png","data":"c3ludGhldGlj"});
    for api in [
        "openai-responses",
        "anthropic-messages",
        "openai-completions",
    ] {
        let context = [
            json!({"role":"user","content":[image.clone()]}),
            json!({"role":"assistant","content":[{"type":"toolCall","id":"call_x","name":"lookup_note","arguments":{}}]}),
            json!({"role":"toolResult","toolCallId":"call_x","content":[{"type":"text","text":"Image result"},image]}),
        ];
        let request = build_request(api, &model(api), "off", &context, &[tool()], None).unwrap();
        let body = request.body.to_string();
        assert!(body.contains("c3ludGhldGlj"));
        assert!(body.contains("Image result"));
        if api == "anthropic-messages" {
            assert_eq!(
                request.body["messages"][0]["content"][0]["source"]["media_type"],
                "image/png"
            );
        } else {
            assert!(body.contains("data:image/png;base64,"));
        }
    }
}

#[test]
fn protocol_switch_never_replays_foreign_opaque_reasoning_or_ids() {
    let reply = assemble(
        "anthropic-messages",
        model("anthropic-messages"),
        &anthropic_events(true),
        10,
    );
    let request = build_request(
        "openai-responses",
        &model("openai-responses"),
        "off",
        &[reply],
        &[tool()],
        None,
    )
    .unwrap();
    assert!(!request.body.to_string().contains("synthetic-signature"));
    assert!(request.body.to_string().contains("Read the note."));
    let reply = assemble(
        "openai-responses",
        model("openai-responses"),
        &response_events(false),
        4,
    );
    let request = build_request(
        "anthropic-messages",
        &model("anthropic-messages"),
        "off",
        &[reply],
        &[],
        None,
    )
    .unwrap();
    assert!(!request.body.to_string().contains("msg_note"));
}

#[test]
fn openrouter_reasoning_details_are_merged_as_replay_metadata_not_duplicate_text() {
    let api = "openai-completions";
    let mut events = completion_events(true);
    events[0]["choices"][0]["delta"] = json!({"reasoning_content":"Read the note.","reasoning":"duplicate","reasoning_details":[{"type":"reasoning.encrypted","id":"rs_note","index":0,"data":"opaque-","format":"fixture"}]});
    events.insert(1,json!({"choices":[{"index":0,"delta":{"reasoning_details":[{"type":"reasoning.encrypted","id":"rs_note","index":0,"data":"reasoning","format":"fixture"}]},"finish_reason":null}]}));
    let reply = assemble(api, model(api), &events, 1);
    assert_eq!(reply["content"][0]["thinking"], "Read the note.");
    let request = build_request(
        api,
        &model(api),
        "medium",
        &[same_origin(reply)],
        &[tool()],
        None,
    )
    .unwrap();
    assert_eq!(
        request.body["messages"][0]["reasoning_details"][0]["data"],
        "opaque-reasoning"
    );
}

#[test]
fn finish_reasons_are_preserved_and_filtering_is_terminal() {
    for (reason, expected) in [
        ("stop", "stop"),
        ("length", "length"),
        ("tool_calls", "toolUse"),
    ] {
        let api = "openai-completions";
        let events =
            [json!({"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":reason}]})];
        let reply = assemble(api, model(api), &events, 1);
        assert_eq!(reply["stopReason"], expected);
        assert_eq!(reply["rawStopReason"], reason);
    }
    let api = "openai-responses";
    let events = [
        json!({"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[]}}),
    ];
    assert_eq!(
        assemble(api, model(api), &events, 1)["stopReason"],
        "length"
    );
    for reason in ["content_filter", "network_error", "unknown"] {
        let mut parser =
            Assembler::new("openai-completions", model("openai-completions"), 1).unwrap();
        assert_eq!(
            parser
                .push(&encoded(&[
                    json!({"choices":[{"index":0,"delta":{},"finish_reason":reason}]})
                ]))
                .unwrap_err(),
            REJECTED
        );
    }
}

#[test]
fn provider_errors_are_safe_sticky_and_leave_renderable_partial_content() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
        "openai-completions",
    ] {
        let mut parser = Assembler::new(api, model(api), 1).unwrap();
        let first = match api {
            "anthropic-messages" => {
                json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Retained"}})
            }
            "openai-completions" => {
                json!({"choices":[{"index":0,"delta":{"content":"Retained"},"finish_reason":null}]})
            }
            _ => json!({"type":"response.output_text.delta","output_index":0,"delta":"Retained"}),
        };
        parser.push(&encoded(&[first])).unwrap();
        let error = parser.push(&encoded(&[json!({"type":"error","error":{"code":"denied","message":"secret-token and private prompt"}})])).unwrap_err();
        assert_eq!(error, REJECTED);
        assert_eq!(parser.partial()["content"][0]["text"], "Retained");
        assert_eq!(parser.partial()["stopReason"], "error");
        assert!(!parser.partial().to_string().contains("secret-token"));
        assert_eq!(parser.push(b"data: {}\n\n").unwrap_err(), REJECTED);
        assert_eq!(parser.finish().unwrap_err(), REJECTED);
    }
}

#[test]
fn incomplete_and_malformed_streams_never_become_success() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
        "openai-completions",
    ] {
        assert_eq!(
            Assembler::new(api, model(api), 1)
                .unwrap()
                .finish()
                .unwrap_err(),
            INCOMPLETE
        );
        for bytes in [b"data: {bad}\n\n".as_slice(), b"data: \xff\n\n".as_slice()] {
            let mut parser = Assembler::new(api, model(api), 1).unwrap();
            assert_eq!(parser.push(bytes).unwrap_err(), INVALID);
            assert_eq!(parser.finish().unwrap_err(), INVALID);
        }
        let mut parser = Assembler::new(api, model(api), 1).unwrap();
        parser.push(b"data: {").unwrap();
        assert_eq!(parser.finish().unwrap_err(), INVALID);
    }
}

#[test]
fn sse_comments_multiline_data_bom_and_eof_dispatch_are_supported() {
    let api = "openai-completions";
    let wire = "\u{feff}: keepalive\r\nid: ignored\r\nretry: 1000\r\nevent: message\r\ndata: {\r\ndata: \"choices\":[{\"index\":0,\"delta\":{\"content\":\"🦀\"},\"finish_reason\":\"stop\"}]}";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    for byte in wire.as_bytes() {
        parser.push(&[*byte]).unwrap();
    }
    let reply = parser.finish().unwrap();
    assert_eq!(reply["content"][0]["text"], "🦀");
}

#[test]
fn completions_usage_after_finish_and_done_does_not_get_lost() {
    let api = "openai-completions";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    parser.push(&encoded(&completion_events(false))).unwrap();
    parser.push(b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":6}}\n\ndata: [DONE]\n\n").unwrap();
    let reply = parser.finish().unwrap();
    assert_eq!(reply["usage"]["totalTokens"], 11);
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    assert_eq!(parser.push(b"data: [DONE]\n\n").unwrap_err(), INCOMPLETE);
}

#[test]
fn malformed_final_tool_arguments_are_rejected_not_replaced_with_empty_objects() {
    let api = "openai-completions";
    for args in ["{\"path\":", "[]", "null", "false"] {
        let events = [
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_note","function":{"name":"lookup_note","arguments":args}}]},"finish_reason":"tool_calls"}]}),
        ];
        let mut parser = Assembler::new(api, model(api), 1).unwrap();
        parser.push(&encoded(&events)).unwrap();
        assert_eq!(parser.finish().unwrap_err(), INVALID);
    }
}

#[test]
fn raw_json_is_incremental_including_pretty_printed_objects() {
    let api = "openai-completions";
    let wire = "{\n  \"id\": \"json_note\",\n  \"choices\": [{\"index\":0,\"message\":{\"content\":\"🦀\"},\"finish_reason\":\"stop\"}]\n}";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    for byte in wire.as_bytes() {
        parser.push(&[*byte]).unwrap();
    }
    assert_eq!(parser.finish().unwrap()["content"][0]["text"], "🦀");
}

#[test]
fn unfinished_or_unidentified_response_tools_are_not_executable() {
    let api = "openai-responses";
    for arguments in ["{\"path\":\"note.md\"}", "{\"path\":"] {
        let events = [
            json!({"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_note","call_id":"call_note","name":"lookup_note","arguments":""}}),
            json!({"type":"response.function_call_arguments.delta","output_index":0,"delta":arguments}),
            json!({"type":"response.completed","response":{"status":"completed","output":[]}}),
        ];
        let mut parser = Assembler::new(api, model(api), 1).unwrap();
        parser.push(&encoded(&events)).unwrap();
        assert_eq!(parser.finish().unwrap_err(), INCOMPLETE);
    }
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    assert_eq!(parser.push(&encoded(&[json!({"type":"response.output_item.added","item":{"type":"function_call","call_id":"x","name":"lookup_note","arguments":"{}"}})])).unwrap_err(),INVALID);
}

#[test]
fn only_complete_anthropic_blocks_can_finish_a_turn() {
    let api = "anthropic-messages";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    let events = [
        json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_note","name":"lookup_note","input":{}}}),
        json!({"type":"message_delta","delta":{"stop_reason":"tool_use"}}),
        json!({"type":"message_stop"}),
    ];
    assert_eq!(parser.push(&encoded(&events)).unwrap_err(), INCOMPLETE);
    assert_eq!(parser.partial()["stopReason"], "error");
}

#[test]
fn multiple_response_content_parts_replay_as_one_item_with_one_identity() {
    let api = "openai-responses";
    let item = json!({"type":"message","id":"msg_parts","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"First"},{"type":"output_text","text":"Second"}]});
    let reply = assemble(
        api,
        model(api),
        &[json!({"type":"response.completed","response":{"status":"completed","output":[item]}})],
        1,
    );
    assert_eq!(reply["content"].as_array().unwrap().len(), 2);
    let request = build_request(api, &model(api), "off", &[same_origin(reply)], &[], None).unwrap();
    assert_eq!(request.body["input"].as_array().unwrap().len(), 1);
    assert_eq!(
        request.body["input"][0]["content"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(request.body["input"][0]["phase"], "commentary");
}

#[test]
fn anthropic_long_cache_writes_are_a_subset_with_separate_pricing() {
    let api = "anthropic-messages";
    let events = [
        json!({"type":"message_start","message":{"id":"msg_note","usage":{"input_tokens":60,"output_tokens":0,"cache_read_input_tokens":30,"cache_creation_input_tokens":10,"cache_creation":{"ephemeral_1h_input_tokens":4,"ephemeral_5m_input_tokens":6}}}}),
        json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}),
        json!({"type":"message_stop"}),
    ];
    let reply = assemble(api, model(api), &events, 1);
    assert_eq!(reply["usage"]["cacheWrite"], 10);
    assert_eq!(reply["usage"]["cacheWrite1h"], 4);
    assert_eq!(reply["usage"]["totalTokens"], 120);
    assert!((reply["usage"]["cost"]["cacheWrite"].as_f64().unwrap() - 0.0000155).abs() < 1e-12);
}

#[test]
fn explicit_null_or_invalid_optional_counters_are_not_invented_as_zero() {
    let api = "openai-responses";
    for value in [Value::Null, json!(-1), json!("unknown")] {
        let events = [
            json!({"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":value}}}}),
        ];
        let reply = assemble(api, model(api), &events, 1);
        assert!(reply["usage"]["input"].is_null());
        assert!(reply["usage"]["cacheRead"].is_null());
        assert!(reply["usage"]["cost"]["total"].is_null());
    }
    let events = [
        json!({"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":null,"output_tokens_details":null}}}),
    ];
    let reply = assemble(api, model(api), &events, 1);
    for field in ["input", "cacheRead", "cacheWrite", "reasoning"] {
        assert!(reply["usage"][field].is_null());
    }
}

#[test]
fn continuation_is_native_format_and_data_without_identity_attribution() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
        "openai-completions",
    ] {
        let events = match api {
            "anthropic-messages" => anthropic_events(true),
            "openai-completions" => completion_events(true),
            _ => response_events(true),
        };
        let reply = assemble(api, model(api), &events, 1);
        for block in reply["content"].as_array().unwrap() {
            if let Some(metadata) = block.get("continuation") {
                assert_eq!(metadata["format"], api);
                assert!(metadata["data"].is_object());
                assert_eq!(metadata.as_object().unwrap().len(), 2);
                for key in [
                    "model",
                    "provider",
                    "connection",
                    "authorization",
                    "credentials",
                ] {
                    assert!(metadata["data"].get(key).is_none());
                }
            }
        }
    }
}

#[test]
fn every_supported_catalog_model_builds_without_provider_retry_or_fallback_settings() {
    let catalog: Value =
        serde_json::from_str(include_str!("../../src/ai/catalog.generated.json")).unwrap();
    let mut exercised = HashSet::new();
    for provider in catalog["providers"].as_array().unwrap() {
        if !matches!(
            provider["id"].as_str(),
            Some("openai" | "openai-codex" | "anthropic" | "openrouter")
        ) {
            continue;
        }
        for model in provider["models"].as_array().unwrap() {
            let api = model["api"].as_str().unwrap();
            if Protocol::parse(api).is_err() || model["type"] == "classifier" {
                continue;
            }
            for thinking in if model["reasoning"] == true {
                vec!["off", "medium"]
            } else {
                vec!["off"]
            } {
                let request =
                    build_request(api, model, thinking, &[user()], &[tool()], Some(16000))
                        .unwrap_or_else(|error| {
                            panic!("{}/{}/{thinking}: {error}", provider["id"], model["id"])
                        });
                assert_eq!(request.body["model"], model["id"]);
                assert_eq!(request.body["stream"], true);
                for field in ["fallbacks", "models", "retries"] {
                    assert!(request.body.get(field).is_none());
                }
                exercised.insert(api.to_owned());
            }
        }
    }
    assert_eq!(exercised.len(), 4);
}

#[test]
fn custom_zero_price_placeholders_stay_unknown_even_when_usage_is_known() {
    let api = "openai-completions";
    let mut model = model(api);
    model["provider"] = json!("custom");
    model["cost"] = json!({"input":0,"output":0,"cacheRead":0,"cacheWrite":0});
    let mut events = completion_events(false);
    events.push(json!({"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0}}}));
    let reply = assemble(api, model, &events, 1);
    assert_eq!(reply["usage"]["input"], 10);
    assert_eq!(reply["usage"]["totalTokens"], 30);
    assert!(reply["usage"]["cost"]["input"].is_null());
    assert!(reply["usage"]["cost"]["output"].is_null());
    assert!(reply["usage"]["cost"]["total"].is_null());
}

#[test]
fn unknown_finish_reason_does_not_expose_provider_error_text_in_partial_history() {
    let api = "openai-completions";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    let event = json!({"choices":[{"index":0,"delta":{"content":"Observed"},"finish_reason":"private-prompt-and-secret"}]});
    assert_eq!(parser.push(&encoded(&[event])).unwrap_err(), REJECTED);
    assert!(
        !parser
            .partial()
            .to_string()
            .contains("private-prompt-and-secret")
    );
    assert_eq!(parser.partial()["content"][0]["text"], "Observed");
}

#[test]
fn partial_tool_calls_only_expose_available_canonical_identity_and_object_arguments() {
    let api = "openai-completions";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    parser.push(&encoded(&[json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]},"finish_reason":null}]})])).unwrap();
    assert_eq!(parser.partial()["content"], json!([]));
    parser.push(&encoded(&[json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_note","function":{"name":"lookup_note","arguments":"\"note.md\"}"}}]},"finish_reason":null}]})])).unwrap();
    assert_eq!(
        parser.partial()["content"][0]["arguments"],
        json!({"path":"note.md"})
    );
    assert_eq!(parser.partial()["stopReason"], "pending");
}

#[test]
fn opaque_replay_requires_live_verified_origin_even_for_the_same_protocol() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
        "openai-completions",
    ] {
        let mut content = vec![
            json!({"type":"text","text":"Visible answer","continuation":{"format":api,"data":{"item":{"id":"msg_old","phase":"final_answer"}}}}),
            json!({"type":"thinking","thinking":"Visible reasoning","thinkingSignature":"opaque-old-signature","continuation":{"format":api,"data":if api == "openai-completions" {json!({"reasoningDetails":[{"type":"reasoning.encrypted","id":"rs_old","data":"opaque-old-signature"}]})} else {json!({"item":{"type":"reasoning","id":"rs_old","summary":[{"type":"summary_text","text":"Visible reasoning"}],"encrypted_content":"opaque-old-signature"}})}}}),
            json!({"type":"thinking","thinking":"","redacted":true,"thinkingSignature":"opaque-redaction","continuation":{"format":api,"data":{}}}),
            json!({"type":"toolCall","id":"call/old","name":"lookup_note","arguments":{"path":"note.md"},"continuation":{"format":api,"data":{"item":{"id":"fc_old","type":"function_call"}}}}),
        ];
        if api == "openai-completions" {
            content[2]["continuation"]["data"] = json!({"reasoningDetails":[{"type":"reasoning.encrypted","id":"rs_redacted","data":"opaque-redaction"}]});
        }
        let message = json!({"role":"assistant","content":content,"timestamp":1,"stopReason":"toolUse","usage":null,"responseId":"resp_old"});
        let saved = message.clone();
        let mut target = model(api);
        target["id"] = json!("different-model");
        for allowed in [None, Some(false), Some(true)] {
            let mut projected = message.clone();
            if let Some(allowed) = allowed {
                projected["continuationAllowed"] = json!(allowed);
            }
            let result =
                json!({"role":"toolResult","toolCallId":"call/old","content":"Observed result"});
            let request = build_request(
                api,
                &target,
                "medium",
                &[projected, result],
                &[tool()],
                None,
            )
            .unwrap();
            let wire = request.body.to_string();
            assert!(!wire.contains("continuationAllowed"));
            assert!(!wire.contains("resp_old"));
            assert!(!wire.contains("call/old"));
            assert!(wire.contains("call_old"));
            assert!(wire.contains("Observed result"));
            if allowed == Some(true) {
                assert!(wire.contains("opaque-old-signature"));
            } else {
                assert!(wire.contains("Visible reasoning"));
                for opaque in [
                    "opaque-old-signature",
                    "opaque-redaction",
                    "msg_old",
                    "rs_old",
                    "fc_old",
                ] {
                    assert!(!wire.contains(opaque), "{api}: {opaque}");
                }
                assert!(!wire.contains("redacted_thinking"));
                assert!(!wire.contains("reasoning_details"));
                assert!(!wire.contains("\"type\":\"reasoning\""));
            }
        }
        assert_eq!(message, saved);
    }
}

#[test]
fn catalog_effort_mapping_controls_off_without_leaving_reasoning_at_provider_defaults() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "openai-completions",
    ] {
        let mut model = model(api);
        model["thinkingLevelMap"] = json!({"off":"none","minimal":"low"});
        if api == "openai-completions" {
            model["provider"] = json!("openrouter");
        }
        let off = build_request(api, &model, "off", &[user()], &[], None).unwrap();
        assert_eq!(off.body["reasoning"]["effort"], "none");
        let low = build_request(api, &model, "minimal", &[user()], &[], None).unwrap();
        assert_eq!(low.body["reasoning"]["effort"], "low");
        model["thinkingLevelMap"]["off"] = Value::Null;
        assert!(
            build_request(api, &model, "off", &[user()], &[], None)
                .unwrap()
                .body
                .get("reasoning")
                .is_none()
        );
    }
}

#[test]
fn known_responses_service_tiers_adjust_rates_and_unpriced_tiers_stay_unknown() {
    let api = "openai-responses";
    for (tier, multiplier) in [
        ("flex", Some(0.5)),
        ("priority", Some(2.0)),
        ("default", Some(1.0)),
        ("unpriced", None),
    ] {
        let mut events = response_events(false);
        events.last_mut().unwrap()["response"]["service_tier"] = json!(tier);
        let reply = assemble(api, model(api), &events, 1);
        if let Some(multiplier) = multiplier {
            assert!(
                (reply["usage"]["cost"]["total"].as_f64().unwrap() - 0.000018 * multiplier).abs()
                    < 1e-12
            );
        } else {
            assert!(reply["usage"]["cost"]["total"].is_null());
        }
    }
}

#[test]
fn non_consuming_finalization_retains_eof_dispatched_output_on_failure() {
    let api = "openai-completions";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    let frame = json!({"id":"chat_eof","choices":[{"index":0,"delta":{"content":"Observed at EOF"},"finish_reason":null}],"usage":{"prompt_tokens":3,"completion_tokens":4}});
    parser.push(format!("data: {frame}").as_bytes()).unwrap();
    assert_eq!(parser.partial()["content"], json!([]));
    assert_eq!(parser.finalize().unwrap_err(), INCOMPLETE);
    let partial = parser.partial();
    assert_eq!(partial["content"][0]["text"], "Observed at EOF");
    assert_eq!(partial["responseId"], "chat_eof");
    assert_eq!(partial["usage"]["totalTokens"], 7);
    assert_eq!(partial["stopReason"], "error");
    assert_eq!(parser.finalize().unwrap_err(), INCOMPLETE);
    assert_eq!(parser.push(b"data: [DONE]\n\n").unwrap_err(), INCOMPLETE);
    assert_eq!(parser.partial(), partial);
}

#[test]
fn non_consuming_finalization_marks_invalid_tool_output_as_error_without_losing_it() {
    let api = "openai-completions";
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    let frame = json!({"choices":[{"index":0,"delta":{"content":"Observed","tool_calls":[{"index":0,"id":"call_note","function":{"name":"lookup_note","arguments":"{\"path\":"}}]},"finish_reason":"tool_calls"}]});
    parser.push(&encoded(&[frame])).unwrap();
    assert_eq!(parser.finalize().unwrap_err(), INVALID);
    let partial = parser.partial();
    assert_eq!(partial["stopReason"], "error");
    assert_eq!(partial["content"][0]["text"], "Observed");
    assert_eq!(partial["content"][1]["id"], "call_note");
    assert_eq!(partial["rawStopReason"], "tool_calls");
    assert_eq!(partial["endTurn"], false);
}

#[test]
fn non_consuming_finalization_matches_finish_on_success_including_eof_frames() {
    let api = "openai-completions";
    let frame = json!({"choices":[{"index":0,"delta":{"content":"Observed at EOF"},"finish_reason":"stop"}]});
    let mut parser = Assembler::new(api, model(api), 1).unwrap();
    let mut consuming = Assembler::new(api, model(api), 1).unwrap();
    let bytes = format!("data: {frame}");
    parser.push(bytes.as_bytes()).unwrap();
    consuming.push(bytes.as_bytes()).unwrap();
    let result = parser.finalize().unwrap();
    assert_eq!(result, consuming.finish().unwrap());
    assert_eq!(parser.partial(), result);
    assert_eq!(result["content"][0]["text"], "Observed at EOF");
    assert_eq!(result["stopReason"], "stop");
}

#[test]
fn responses_failed_and_codex_cancelled_terminals_are_safe_errors_not_success() {
    for api in ["openai-responses", "openai-codex-responses"] {
        for event in [
            json!({"type":"response.failed","response":{"status":"failed","error":{"code":"fixture","message":"private-provider-detail"}}}),
            json!({"type":"response.completed","response":{"status":"failed","error":{"message":"private-provider-detail"}}}),
            json!({"type":"response.done","response":{"status":"cancelled","output":[]}}),
        ] {
            let mut parser = Assembler::new(api, model(api), 1).unwrap();
            parser.push(&encoded(&[json!({"type":"response.output_text.delta","output_index":0,"delta":"Observed"})])).unwrap();
            assert_eq!(parser.push(&encoded(&[event])).unwrap_err(), REJECTED);
            assert_eq!(parser.partial()["content"][0]["text"], "Observed");
            assert_eq!(parser.partial()["stopReason"], "error");
            assert!(
                !parser
                    .partial()
                    .to_string()
                    .contains("private-provider-detail")
            );
            assert_eq!(parser.finalize().unwrap_err(), REJECTED);
        }
        let mut parser = Assembler::new(api, model(api), 1).unwrap();
        parser.push(&encoded(&[json!({"type":"response.created","response":{"id":"resp_unfinished","status":"in_progress","output":[]}})])).unwrap();
        assert_eq!(parser.finalize().unwrap_err(), INCOMPLETE);
        assert_eq!(parser.partial()["responseId"], "resp_unfinished");
    }
}

#[test]
fn request_builder_excludes_catalog_credentials_destinations_and_transient_flags() {
    for api in [
        "openai-responses",
        "openai-codex-responses",
        "openai-completions",
        "anthropic-messages",
    ] {
        let mut descriptor = model(api);
        descriptor["headers"] = json!({"authorization":"synthetic-private-access","x-api-key":"synthetic-private-key","x-unknown":"synthetic-private-header"});
        descriptor["apiKey"] = json!("synthetic-private-key");
        let mut message = user();
        message["continuationAllowed"] = json!(true);
        message["connection"] = json!({"key":"synthetic-private-key"});
        let prepared = build_request(api, &descriptor, "off", &[message], &[], None).unwrap();
        let wire = format!("{} {:?}", prepared.body, prepared.headers);
        for private in [
            "synthetic-private-access",
            "synthetic-private-key",
            "synthetic-private-header",
            "continuationAllowed",
            descriptor["baseUrl"].as_str().unwrap(),
        ] {
            assert!(!wire.contains(private), "{api}: {private}");
        }
        assert!(!prepared.headers.contains_key("authorization"));
        assert!(!prepared.headers.contains_key("x-api-key"));
    }
}

#[test]
fn native_e2e_fixture_usage_preserves_large_input_cache_and_catalog_pricing() {
    let api = "openai-responses";
    let catalog: Value =
        serde_json::from_str(include_str!("../../src/ai/catalog.generated.json")).unwrap();
    let model = catalog["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "openai")
        .unwrap()["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "gpt-4.1-mini")
        .unwrap()
        .clone();
    let mut events = response_events(false);
    events.last_mut().unwrap()["response"]["usage"] = json!({"input_tokens":1000003,"input_tokens_details":{"cached_tokens":17},"output_tokens":997,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":1001000});
    let reply = assemble(api, model, &events, 1);
    assert_eq!(reply["rawStopReason"], "completed");
    assert_eq!(reply["usage"]["input"], 999986);
    assert_eq!(reply["usage"]["cacheRead"], 17);
    assert_eq!(reply["usage"]["output"], 997);
    assert_eq!(reply["usage"]["totalTokens"], 1001000);
    assert!((reply["usage"]["cost"]["total"].as_f64().unwrap() - 0.4015913).abs() < 1e-12);
}

#[test]
fn anthropic_off_never_turns_gateway_effort_aliases_into_enabled_thinking() {
    let api = "anthropic-messages";
    for adaptive in [false, true] {
        for off in ["none", "high"] {
            let mut descriptor = model(api);
            descriptor["provider"] = json!("openrouter");
            descriptor["compat"] = json!({"forceAdaptiveThinking":adaptive});
            descriptor["thinkingLevelMap"] = json!({"off":off});
            let request = build_request(api, &descriptor, "off", &[user()], &[], Some(96)).unwrap();
            assert_eq!(request.body["thinking"], json!({"type":"disabled"}));
            for field in ["output_config", "reasoning", "reasoning_effort"] {
                assert!(request.body.get(field).is_none());
            }
        }
    }
}

#[test]
fn managed_anthropic_off_uses_fixed_high_controls_not_gateway_none_aliases() {
    let api = "anthropic-messages";
    let mut descriptor = model(api);
    descriptor["compat"] = json!({"forceAdaptiveThinking":true,"supportsMidConvoEffort":true});
    descriptor["thinkingLevelMap"] = json!({"off":"none"});
    let request = build_request(api, &descriptor, "off", &[user()], &[], Some(96)).unwrap();
    assert_eq!(request.body["thinking"]["type"], "adaptive");
    assert_eq!(request.body["output_config"], json!({"effort":"high"}));
    assert_eq!(
        request.body["messages"].as_array().unwrap().last().unwrap()["output_config"],
        json!({"effort":"high"})
    );
    assert!(request.body.get("reasoning").is_none());
}

#[test]
fn verified_native_thinking_levels_use_their_protocol_specific_control_fields() {
    let catalog: Value =
        serde_json::from_str(include_str!("../../src/ai/catalog.generated.json")).unwrap();
    let recommendations: Value =
        serde_json::from_str(include_str!("../../src/ai/model-recommendations.json")).unwrap();
    let mut protocols = HashSet::new();
    for entry in recommendations["verifiedThinking"].as_array().unwrap() {
        if !matches!(
            entry["provider"].as_str(),
            Some("openai" | "openai-codex" | "anthropic" | "openrouter")
        ) {
            continue;
        }
        let descriptor = catalog["providers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == entry["provider"])
            .unwrap()["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == entry["modelId"])
            .unwrap();
        let api = entry["api"].as_str().unwrap();
        for thinking in entry["levels"].as_array().unwrap() {
            let request = build_request(
                api,
                descriptor,
                thinking.as_str().unwrap(),
                &[user()],
                &[tool()],
                Some(96),
            )
            .unwrap();
            assert!(request.body.get("reasoning_effort").is_none());
            if api == "anthropic-messages" {
                assert_eq!(
                    request.body["thinking"],
                    json!({"type":"adaptive","display":"summarized","block_binding":{"prefix_mismatch_behavior":"drop_block"}})
                );
                assert_eq!(request.body["output_config"], json!({"effort":"high"}));
                assert_eq!(
                    request.body["messages"].as_array().unwrap().last().unwrap()["output_config"],
                    json!({"effort":thinking})
                );
                assert!(request.body.get("reasoning").is_none());
            } else {
                assert_eq!(request.body["reasoning"]["effort"], *thinking);
                assert!(request.body.get("thinking").is_none());
                assert!(request.body.get("output_config").is_none());
            }
            if api == "openai-codex-responses" {
                assert_eq!(request.body["store"], false);
                assert!(request.body.get("max_output_tokens").is_none());
            }
        }
        protocols.insert(api);
    }
    assert_eq!(protocols.len(), 4);
}

#[test]
fn unsupported_api_invalid_model_and_tool_definitions_fail_before_transport() {
    assert!(Assembler::new("missing", model("missing"), 0).is_err());
    assert!(build_request("missing", &model("missing"), "off", &[], &[], None).is_err());
    assert!(
        build_request(
            "openai-responses",
            &model("anthropic-messages"),
            "off",
            &[],
            &[],
            None
        )
        .is_err()
    );
    for bad in [
        json!({"name":"bad name","parameters":{}}),
        json!({"name":"lookup_note","parameters":null}),
    ] {
        assert!(
            build_request(
                "openai-responses",
                &model("openai-responses"),
                "off",
                &[user()],
                &[bad],
                None
            )
            .is_err()
        );
    }
    assert!(
        build_request(
            "openai-responses",
            &model("openai-responses"),
            "recommended",
            &[user()],
            &[],
            None
        )
        .is_err()
    );
}
