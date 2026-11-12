use super::*;
use serde_json::json;
use std::io::Write;

const SESSION: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const TRACE: &str = "33333333-3333-4333-8333-333333333333";

fn record(session: &str, event: &str) -> String {
    format!(
        "{}\n",
        json!({
            "schema_version": 1, "timestamp_ms": 42, "event": event, "category": "app",
            "level": "info", "origin": "native", "session_id": session,
            "context": {"trace_id": TRACE, "span_id": OTHER, "initiator": "user"}
        })
    )
}
fn publish(logs: &ApplicationLogs, directory: &Path, session: &str, status: &str) {
    let staging = logs.launch.path().join("staging");
    fs::write(
        &staging,
        json!({"version":1,"directory":directory,"session_id":session,"status":status}).to_string(),
    )
    .unwrap();
    fs::rename(staging, logs.manifest_path()).unwrap();
}
fn segment(directory: &Path, index: usize) -> PathBuf {
    directory.join(format!("segment-{index:020}.jsonl"))
}
fn append(path: &Path, value: &str) {
    fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(value.as_bytes())
        .unwrap();
}
fn fixture() -> (ApplicationLogs, tempfile::TempDir) {
    let logs = ApplicationLogs::new().unwrap();
    let directory = tempfile::tempdir().unwrap();
    publish(&logs, directory.path(), SESSION, "ready");
    (logs, directory)
}

#[test]
fn launch_discovery_is_private_scoped_and_cleaned_up() {
    let logs = ApplicationLogs::new().unwrap();
    let second = ApplicationLogs::new().unwrap();
    let path = logs.manifest_path();
    assert!(path.is_absolute());
    assert_ne!(path, second.manifest_path());
    assert_eq!(
        fs::metadata(path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    drop(logs);
    assert!(!path.parent().unwrap().exists());
}

#[test]
fn discovery_distinguishes_waiting_unavailable_and_writer_recovery() {
    let mut logs = ApplicationLogs::new().unwrap();
    logs.poll();
    assert!(logs.status.contains("not confirmed"));
    publish(&logs, Path::new(""), SESSION, "unavailable");
    logs.poll();
    assert_eq!(logs.status, "Native diagnostic storage/writer unavailable");
    assert!(logs.cursors.is_empty());
    let directory = tempfile::tempdir().unwrap();
    publish(&logs, directory.path(), SESSION, "ready");
    logs.poll();
    assert_eq!(logs.status, "Waiting for records from this launch");
    publish(&logs, directory.path(), SESSION, "unavailable");
    logs.poll();
    assert_eq!(logs.status, "Native diagnostic storage/writer unavailable");
    fs::write(logs.manifest_path(), "{\"version\":2}").unwrap();
    logs.poll();
    assert!(logs.status.contains("not confirmed"));
}

#[test]
fn partial_records_rotation_and_sessions_do_not_mix() {
    let (mut logs, directory) = fixture();
    let first = segment(directory.path(), 0);
    let value = record(SESSION, "app.started");
    fs::write(&first, &value[..value.len() - 1]).unwrap();
    logs.poll();
    assert!(logs.records.is_empty());
    append(&first, "\n");
    logs.poll();
    assert_eq!(logs.records.len(), 1);
    assert_eq!(
        logs.records[0].line(),
        format!("00:00:00.042Z info app app.started native trace={TRACE} span={OTHER} user")
    );
    fs::write(
        segment(directory.path(), 1),
        record(OTHER, "app.started") + &record(SESSION, "app.stopped"),
    )
    .unwrap();
    fs::remove_file(first).unwrap();
    logs.poll();
    assert_eq!(
        logs.records
            .iter()
            .map(|r| r.event.as_str())
            .collect::<Vec<_>>(),
        ["app.started", "app.stopped"]
    );
    logs.poll();
    assert_eq!(logs.records.len(), 2);
    publish(&logs, directory.path(), OTHER, "ready");
    logs.poll();
    assert_eq!(logs.records.len(), 1);
    assert_eq!(logs.records[0].session_id, OTHER);
}

#[test]
fn replacement_truncation_and_same_inode_rewrites_are_followed() {
    let (mut logs, directory) = fixture();
    let path = segment(directory.path(), 0);
    fs::write(&path, record(SESSION, "app.started")).unwrap();
    logs.poll();
    let replacement = directory.path().join("replacement");
    fs::write(&replacement, record(SESSION, "app.stopped")).unwrap();
    fs::rename(replacement, &path).unwrap();
    logs.poll();
    assert_eq!(logs.records.back().unwrap().event, "app.stopped");
    fs::write(&path, "").unwrap();
    logs.poll();
    fs::write(&path, record(SESSION, "app.started")).unwrap();
    logs.poll();
    fs::write(&path, record(SESSION, "app.changed")).unwrap();
    logs.poll();
    assert_eq!(logs.records.len(), 4);
    assert_eq!(logs.records.back().unwrap().event, "app.changed");
}

#[test]
fn invalid_oversized_and_unsupported_lines_are_counted_without_echoing_content() {
    let (mut logs, directory) = fixture();
    let bad = "private-sentinel\x1b]52;c;clipboard\x07";
    let input = format!(
        "{bad}\n{{\"schema_version\":7}}\n{}\n{}{}",
        "x".repeat(LINE_BYTES + 1),
        record(SESSION, "app.\u{001b}[31mstarted"),
        record(SESSION, "app.started")
    );
    let path = segment(directory.path(), 0);
    fs::write(&path, input).unwrap();
    logs.poll();
    assert_eq!(logs.omitted, 3);
    assert_eq!(logs.unsupported, 1);
    assert_eq!(logs.records.len(), 1);
    assert!(!logs.records[0].line().contains("private-sentinel"));
    assert_eq!(
        safe_text(
            "safe\x1b[31mred\x1b[0m\x1b]8;;https://example.invalid\x07link\x1b]8;;\x07\x07\u{202e}"
        ),
        "saferedlink"
    );
    fs::write(&path, vec![b'x'; LINE_BYTES + 10]).unwrap();
    logs.poll();
    fs::remove_file(path).unwrap();
    logs.poll();
    assert_eq!(logs.omitted, 4);
}

#[test]
fn record_and_byte_buffers_and_per_poll_input_are_bounded() {
    let (mut logs, directory) = fixture();
    let input = record(SESSION, "app.started").repeat(RECORDS + 10);
    fs::write(segment(directory.path(), 0), &input).unwrap();
    logs.poll();
    assert!(logs.cursors.values().map(|c| c.offset).sum::<u64>() <= POLL_BYTES as u64);
    for _ in 0..20 {
        logs.poll();
    }
    assert_eq!(logs.records.len(), RECORDS);
    assert_eq!(logs.evicted, 10);
    let mut padded: serde_json::Value =
        serde_json::from_str(&record(SESSION, "app.started")).unwrap();
    padded["ignored"] = json!("x".repeat(8000));
    let padded = format!("{padded}\n");
    for _ in 0..1000 {
        logs.admit(padded.as_bytes());
    }
    assert!(logs.bytes <= BUFFER_BYTES);
    assert!(logs.records.len() < RECORDS);
    assert!(logs.cursors.values().all(|c| c.partial.len() <= LINE_BYTES));
}

#[test]
fn level_category_trace_filters_and_pause_only_change_the_viewer() {
    let (mut logs, directory) = fixture();
    let path = segment(directory.path(), 0);
    let mut second: serde_json::Value =
        serde_json::from_str(&record(SESSION, "operation.finished")).unwrap();
    second["level"] = json!("error");
    second["category"] = json!("storage");
    second["context"]["trace_id"] = json!(OTHER);
    let input = record(SESSION, "app.started") + &format!("{second}\n");
    fs::write(&path, &input).unwrap();
    logs.poll();
    logs.cycle_level();
    logs.cycle_level();
    logs.cycle_level();
    assert_eq!(logs.visible().len(), 1);
    assert_eq!(logs.visible()[0].level, "error");
    logs.cycle_level();
    logs.cycle_level();
    logs.cycle_category();
    assert_eq!(logs.visible()[0].event, "app.started");
    logs.cycle_category();
    assert_eq!(logs.visible()[0].category, "storage");
    logs.cycle_category();
    logs.cycle_trace();
    assert_eq!(logs.visible()[0].context.as_ref().unwrap().trace_id, OTHER);
    logs.cycle_trace();
    logs.cycle_trace();
    logs.paused = true;
    append(&path, &record(SESSION, "app.stopped"));
    logs.poll();
    assert_eq!(logs.records.len(), 2);
    logs.paused = false;
    logs.poll();
    assert_eq!(logs.records.len(), 3);
    assert_eq!(
        fs::read_to_string(path).unwrap(),
        input + &record(SESSION, "app.stopped")
    );
}

#[test]
fn only_reviewed_scalar_attributes_reach_the_display() {
    let (mut logs, _) = fixture();
    logs.session = Some(SESSION.into());
    let mut event: serde_json::Value =
        serde_json::from_str(&record(SESSION, "operation.finished")).unwrap();
    event["attributes"] = json!({
        "action":"read", "component":"files", "outcome":"failure", "error_code":"io", "duration_ms":125.5,
        "message":"PRIVATE_SENTINEL", "stage":"PRIVATE_SENTINEL", "count":-1, "bytes":{"secret":"PRIVATE_SENTINEL"}
    });
    logs.admit(event.to_string().as_bytes());
    let line = logs.records.back().unwrap().line();
    assert!(
        line.contains(
            " action=read component=files duration_ms=125.5 error_code=io outcome=failure"
        )
    );
    assert!(!line.contains("PRIVATE_SENTINEL"));
    assert!(!line.contains("stage="));
    assert!(!line.contains("bytes="));
    assert_eq!(logs.records.back().unwrap().attributes.len(), 5);
    assert_eq!(logs.omitted, 1);
    event["event"] = json!("runtime.failed");
    event["attributes"] = json!({"boundary":"script","error_code":"unknown"});
    logs.admit(event.to_string().as_bytes());
    assert!(
        logs.records
            .back()
            .unwrap()
            .line()
            .contains(" boundary=script error_code=unknown")
    );
    event["attributes"] = json!({"boundary":"task","error_code":"io"});
    logs.admit(event.to_string().as_bytes());
    assert!(
        logs.records
            .back()
            .unwrap()
            .line()
            .contains(" boundary=task error_code=io")
    );
    event["event"] = json!("operation.finished");
    event["attributes"] = json!({"outcome":"interrupted","error_code":"interrupted"});
    logs.admit(event.to_string().as_bytes());
    assert!(
        logs.records
            .back()
            .unwrap()
            .line()
            .contains(" error_code=interrupted outcome=interrupted")
    );
    assert_eq!(logs.omitted, 1);
}

#[test]
fn omission_and_eviction_counters_saturate() {
    let (mut logs, _) = fixture();
    logs.session = Some(SESSION.into());
    logs.omitted = usize::MAX;
    logs.unsupported = usize::MAX;
    logs.evicted = usize::MAX;
    logs.admit(b"malformed");
    logs.admit(b"{\"schema_version\":2}");
    for _ in 0..=RECORDS {
        logs.admit(record(SESSION, "app.started").as_bytes());
    }
    assert_eq!(logs.omitted, usize::MAX);
    assert_eq!(logs.unsupported, usize::MAX);
    assert_eq!(logs.evicted, usize::MAX);
}

#[test]
fn symlinked_segments_are_not_followed_and_discovery_is_bounded() {
    let (mut logs, directory) = fixture();
    let outside = directory.path().join("outside");
    fs::write(&outside, record(SESSION, "app.started")).unwrap();
    std::os::unix::fs::symlink(&outside, segment(directory.path(), 0)).unwrap();
    logs.poll();
    assert!(logs.records.is_empty());
    fs::write(logs.manifest_path(), "x".repeat(4097)).unwrap();
    logs.poll();
    assert!(logs.status.contains("not confirmed"));
}
