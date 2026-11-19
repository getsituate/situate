use serde_json::{Value, json};
use situate_core::{
    ai_storage::Storage,
    content::{ContentStore, SaveOutcome},
    conversation_history::{ConversationMetadata, HistoryEntry},
    onboarding::{OnboardingStorage, Step},
    plugins::{publication, runtime, sources},
    workspace_identity, workspaces,
};
use std::{env, path::Path};

const PLUGIN: &str = "upgrade-fixture";

fn saved(result: SaveOutcome) -> String {
    match result {
        SaveOutcome::Saved {
            history_revision, ..
        } => history_revision,
        _ => panic!("Fixture write did not commit history"),
    }
}

fn plugin(root: &Path) {
    sources::create(root, PLUGIN).unwrap();
    let manifest = json!({
        "schemaVersion":2,"id":PLUGIN,"name":"Archive index","description":"Index of sample field notes.",
        "kind":"connection","serviceEntry":"service.js","exports":["documentSourceDescribe","documentSourceList","documentSourceContent"]
    });
    for (file, source) in [
        ("plugin.json", manifest.to_string()),
        ("service.js", include_str!("service.js").into()),
    ] {
        saved(sources::write(root, PLUGIN, file, &source, None).unwrap());
    }
    let revisions = [sources::snapshot(root, PLUGIN).unwrap()];
    let closure = publication::checked_closure(root, &revisions).unwrap();
    assert_eq!(
        publication::publish(root, &revisions, &closure, &[])
            .unwrap()
            .status,
        publication::PublicationStatus::Published
    );
    let state = runtime::list(root).unwrap();
    runtime::set_enabled(root, PLUGIN, true, state.revision.as_deref()).unwrap();
}

fn conversation(store: &Storage, id: &str, title: &str, tools: &[(&str, Value, Value, bool)]) {
    store
        .create_conversation_metadata(&ConversationMetadata::new(id, title))
        .unwrap();
    let mut entries = Vec::new();
    let mut push = |kind, data| {
        let id = format!("entry-{:02}", entries.len());
        let parent = entries.last().map(|entry: &HistoryEntry| entry.id.clone());
        entries.push(HistoryEntry::new(id, parent, kind, data));
    };
    push(
        "message",
        json!({"message":{"role":"user","content":"Review the field notes and their history.","timestamp":1700000000000u64}}),
    );
    let usage = json!({"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}});
    for (i, (name, arguments, output, failed)) in tools.iter().enumerate() {
        let call = format!("call-{i:02}");
        push(
            "message",
            json!({"message":{"role":"assistant","content":[{"type":"toolCall","id":call,"name":name,"arguments":arguments}],"stopReason":"toolUse","usage":usage,"timestamp":1700000000001u64}}),
        );
        push(
            "message",
            json!({"message":{"role":"toolResult","toolName":name,"toolCallId":call,"content":[{"type":"text","text":output.to_string()}],"structuredContent":output,"isError":failed,"timestamp":1700000000002u64}}),
        );
    }
    push(
        "message",
        json!({"message":{"role":"assistant","content":[{"type":"text","text":"The field notes are ready to review."}],"stopReason":"stop","usage":usage,"timestamp":1700000000003u64}}),
    );
    store
        .append_conversation_entries(id, 0, &entries, entries.last().map(|e| e.id.as_str()))
        .unwrap();
}

fn main() {
    let parent = env::args_os()
        .nth(1)
        .expect("Provide a fresh fixture parent directory");
    let parent = Path::new(&parent);
    assert!(parent.is_absolute());
    assert!(std::fs::read_dir(parent).unwrap().next().is_none());
    let name = "Upgrade workspace";
    workspaces::create_for_onboarding(parent, name).unwrap();
    let root = &parent.join(name);
    let scope = workspace_identity::read(root).unwrap();
    let mut files = ContentStore::open(root).unwrap();
    let first = saved(
        files
            .create_text("Field notes.md", "# Field notes\n\nStation A: dry.\n")
            .unwrap(),
    );
    let base = files.read_text("Field notes.md").unwrap();
    saved(
        files
            .save(
                "Field notes.md",
                &base,
                "# Field notes\n\nStation A: light rain.\n",
            )
            .unwrap(),
    );
    saved(
        files
            .create_text(
                "Checklist.md",
                "# Checklist\n\n- [x] Visit station A\n- [ ] Visit station B\n",
            )
            .unwrap(),
    );
    saved(
        files
            .create_text(
                ".situate/working-method.md",
                "# Working method\n\nKeep the original field notes and revise copies.\n",
            )
            .unwrap(),
    );
    let onboarding = OnboardingStorage::open(root, &scope).unwrap();
    let state = onboarding.load().unwrap();
    let mut record = state.record.unwrap();
    record.step = Step::Complete;
    record.entered = true;
    record.instruction_revision = Some(files.working_method().unwrap().unwrap().revision);
    onboarding.save(state.revision.as_deref(), record).unwrap();
    plugin(root);
    let store = Storage::open(root, &scope).unwrap();
    let a = "21111111-1111-4111-8111-111111111111";
    let b = "22222222-2222-4222-8222-222222222222";
    conversation(
        &store,
        a,
        "Field notebook review",
        &[
            (
                "ls",
                json!({}),
                json!(["Field notes.md", "Checklist.md"]),
                false,
            ),
            (
                "read",
                json!({"path":"Field notes.md"}),
                json!({"text":base.text}),
                false,
            ),
            (
                "find",
                json!({"query":"notes"}),
                json!(["Field notes.md"]),
                false,
            ),
            (
                "grep",
                json!({"query":"Station"}),
                json!({"matches":1}),
                false,
            ),
            (
                "history",
                json!({"path":"Field notes.md"}),
                json!({"revision":first}),
                false,
            ),
            (
                "read_revision",
                json!({"path":"Field notes.md","revision":first}),
                json!({"text":"Station A: dry."}),
                false,
            ),
            (
                "write",
                json!({"path":"Checklist.md","text":"# Checklist","expectedRevision":null}),
                json!({"code":"destination-occupied"}),
                true,
            ),
            (
                "edit",
                json!({"path":"Field notes.md","expectedRevision":base.revision,"edits":[{"oldText":"dry","newText":"light rain"}]}),
                json!({"path":"Field notes.md"}),
                false,
            ),
            (
                "create_batch",
                json!({"entries":[{"path":"Checklist.md","text":"# Checklist"}]}),
                json!({"files":[]}),
                true,
            ),
        ],
    );
    conversation(
        &store,
        b,
        "Archive follow-up",
        &[
            ("list_conversations", json!({}), json!([a]), false),
            (
                "read_conversation",
                json!({"conversationId":a}),
                json!({"title":"Field notebook review"}),
                false,
            ),
            (
                "web_search",
                json!({"query":"sample weather archive"}),
                json!({"results":[]}),
                false,
            ),
            (
                "web_fetch",
                json!({"url":"https://example.invalid/archive"}),
                json!({"reason":"not available"}),
                true,
            ),
            (
                "open_view",
                json!({"viewId":"files"}),
                json!({"viewId":"files"}),
                false,
            ),
            (
                "reveal_content",
                json!({"viewId":"files","contentId":"Field notes.md","revision":first}),
                json!({"viewId":"files"}),
                false,
            ),
            (
                "open_conversation",
                json!({"conversationId":a}),
                json!({"conversationId":a}),
                false,
            ),
            (
                "shell",
                json!({"command":"printf '%s\\n' station-a"}),
                json!({"exitCode":0,"stdout":"station-a\n"}),
                false,
            ),
            (
                "ask_question",
                json!({"prompt":"Which station is next?"}),
                json!({"answer":"Station B"}),
                false,
            ),
        ],
    );
}
