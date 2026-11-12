use super::*;
fn config() -> crate::RunConfig {
    crate::RunConfig {
        settings: Value::Null,
        instructions: vec![],
        context_window: 1024,
        max_tokens: 256,
        generate_title: false,
        generate_comments: false,
    }
}
fn user(text: &str) -> Value {
    json!({"role":"user","content":text,"timestamp":1})
}
fn call(ids: &[&str]) -> Value {
    json!({"role":"assistant","content":ids.iter().map(|id|json!({"type":"toolCall","id":id,"name":"read","arguments":{}})).collect::<Vec<_>>(),"timestamp":2,"stopReason":"toolUse","usage":null})
}
fn result(id: &str, name: &str, text: &str, error: bool) -> Value {
    json!({"role":"toolResult","toolCallId":id,"toolName":name,"content":[{"type":"text","text":text}],"isError":error,"timestamp":3,"details":{"receipt":"unchanged"}})
}

#[test]
fn summary_chunks_exclude_opaque_continuation_without_mutating_canonical_records() {
    let source = vec![
        json!({"role":"assistant","timestamp":1,"stopReason":"toolUse","usage":null,
        "continuation":{"format":"anthropic-messages","data":{"signature":"OpaqueSentinel-root"}},
        "textSignature":"OpaqueSentinel-root-text","thinkingSignature":"OpaqueSentinel-root-thinking","thoughtSignature":"OpaqueSentinel-root-call",
        "content":[
            {"type":"text","text":"Visible answer","textSignature":"OpaqueSentinel-text","continuation":{"data":"OpaqueSentinel-text-continuation"}},
            {"type":"thinking","thinking":"Visible reasoning","thinkingSignature":"OpaqueSentinel-thinking"},
            {"type":"thinking","thinking":"OpaqueSentinel-redacted","redacted":true,"thinkingSignature":"OpaqueSentinel-redacted-signature","continuation":{"data":"OpaqueSentinel-redacted-continuation"}},
            {"type":"toolCall","id":"call","name":"read","arguments":{"path":"note.md"},"thoughtSignature":"OpaqueSentinel-call","continuation":{"data":"OpaqueSentinel-call-continuation"}}
        ]}),
    ];
    let original = source.clone();
    let summary = chunks(&source, &summary_config(&config()))
        .unwrap()
        .concat();
    assert!(!summary.contains("OpaqueSentinel"));
    let projected: Value = serde_json::from_str(&summary).unwrap();
    assert_eq!(projected[0]["content"][0]["text"], "Visible answer");
    assert_eq!(projected[0]["content"][1]["thinking"], "Visible reasoning");
    assert_eq!(
        projected[0]["content"][2],
        json!({"type":"thinking","thinking":"","redacted":true})
    );
    assert_eq!(
        projected[0]["content"][3]["arguments"],
        json!({"path":"note.md"})
    );
    assert_eq!(source, original);
}

#[test]
fn summary_budget_uses_own_instructions_and_reserves_bounded_output_and_previous_summary() {
    let mut main = config();
    main.context_window = 32768;
    main.max_tokens = 16384;
    main.instructions =
        vec![json!({"role":"system","content":"PrivateMainInstructions".repeat(1000)})];
    main.generate_title = true;
    main.generate_comments = true;
    let summary = summary_config(&main);
    assert_eq!(summary.max_tokens, 4096);
    assert_eq!(summary.context_window, main.context_window);
    assert!(!summary.generate_title && !summary.generate_comments);
    assert!(
        !serde_json::to_string(&summary.instructions)
            .unwrap()
            .contains("PrivateMainInstructions")
    );
    let source = vec![user(&"x".repeat(100000))];
    let larger = chunks(&source, &summary).unwrap();
    let mut small_output = main.clone();
    small_output.max_tokens = 256;
    assert_eq!(summary_config(&small_output).max_tokens, 256);
    let mut smaller = summary.clone();
    smaller.context_window = 1024;
    smaller.max_tokens = 256;
    let smaller_chunks = chunks(&source, &smaller).unwrap();
    assert!(smaller_chunks[0].len() < larger[0].len());
    let instructions = smaller.instructions.iter().map(tokens).sum::<u64>();
    let wrapper = tokens(&json!({"content":"Previous summary:\n\nSegment:\n"}));
    assert!(
        instructions + wrapper + smaller.max_tokens * 2 + text_tokens(&smaller_chunks[0])
            <= smaller.context_window
    );
    smaller.context_window = 256;
    smaller.max_tokens = 256;
    assert_eq!(
        chunks(&source, &smaller),
        Err("chat.compactionFailed".into())
    );
}

#[test]
fn older_observations_can_be_masked_but_not_receipts_failures_or_current_request() {
    for (name, error, masked) in [
        ("read", false, true),
        ("read_plugin_development", false, true),
        ("write", false, false),
        ("read", true, false),
        ("plugin", false, false),
    ] {
        let source = vec![
            user("Original"),
            call(&["old"]),
            result("old", name, &"Observation".repeat(1000), error),
            user(&"Current request".repeat(500)),
        ];
        let original = source.clone();
        let (messages, boundary) = plan(&source, None, &config(), &[]);
        assert_eq!(
            messages[2]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains(OMITTED),
            masked
        );
        assert_eq!(messages[2]["details"], source[2]["details"]);
        assert_eq!(messages.last(), source.last());
        assert!(boundary.is_some());
        assert_eq!(source, original);
    }
}

#[test]
fn image_sizing_does_not_depend_on_base64_and_old_screenshots_keep_receipts() {
    let mut source = vec![
        user("Original"),
        call(&["image"]),
        result("image", "write", "Receipt", false),
        user(&"Latest".repeat(1000)),
    ];
    source[2]["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"image","data":"image-bytes","mimeType":"image/png"}));
    let (messages, boundary) = plan(&source, None, &config(), &[]);
    assert_eq!(messages[2]["content"][0]["text"], "Receipt");
    assert_eq!(messages[2]["content"][1]["text"], OMITTED);
    assert_eq!(messages[2]["details"], source[2]["details"]);
    source[2]["content"][1]["data"] = json!("x".repeat(100000));
    assert_eq!(plan(&source, None, &config(), &[]).1, boundary);
}

#[test]
fn retention_boundaries_do_not_split_parallel_tool_batches() {
    let source = vec![
        user("Earlier"),
        call(&["one", "two"]),
        result("one", "write", &"x".repeat(2000), false),
        result("two", "write", "short", false),
        user("Latest"),
    ];
    let mut cfg = config();
    cfg.context_window = 256;
    cfg.max_tokens = 64;
    let (_, boundary) = plan(&source, None, &cfg, &[]);
    assert_eq!(boundary, Some(1));
}

#[test]
fn an_unchanged_checkpoint_and_only_active_request_are_not_summarized_again() {
    let source = vec![
        user("Earlier"),
        call(&["old"]),
        result("old", "write", "Completed", false),
        user(&"Current".repeat(2000)),
    ];
    let checkpoint = Checkpoint {
        source_count: 3,
        summary: "Completed earlier effects".into(),
        run_id: "run".into(),
    };
    assert_eq!(plan(&source, Some(&checkpoint), &config(), &[]).1, None);
    assert_eq!(
        plan(&[user(&"Active".repeat(2000))], None, &config(), &[]).1,
        None
    );
}
