use super::*;
use serde_json::{Value, json};
use std::{
    fs, io,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

fn identity() -> HostIdentity {
    HostIdentity {
        device_id: Uuid::new_v4().to_string(),
        session_id: Uuid::new_v4().to_string(),
        app_version: "0.0.1".into(),
        platform: "test".into(),
        platform_version: "1".into(),
    }
}
fn bound() -> BoundContext {
    BoundContext {
        origin: Origin::Native,
        workspace_id: None,
    }
}
fn event(level: Level, sequence: u64) -> EventInput {
    EventInput {
        schema_version: 1,
        event: "app.started".into(),
        category: "app".into(),
        level,
        timestamp_ms: 0,
        sequence,
        context: None,
        attributes: Default::default(),
    }
}
fn admit(producer: &Producer, input: EventInput) {
    let deadline = Instant::now() + Duration::from_secs(1);
    while !producer.emit(input.clone()) {
        assert!(Instant::now() < deadline);
        thread::yield_now();
    }
}

#[derive(Clone, Default)]
struct Memory(Arc<Mutex<Vec<Value>>>);
impl Destination for Memory {
    fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::from_slice(bytes).unwrap());
        Ok(())
    }
}
fn registration(destination: impl Destination) -> DestinationRegistration {
    DestinationRegistration {
        destination: Box::new(destination),
        filter: DestinationFilter::default(),
    }
}

#[test]
fn hard_linked_segment_cannot_modify_an_outside_file() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), b"outside content without a newline").unwrap();
    fs::hard_link(
        outside.path(),
        root.path().join("segment-00000000000000000001.jsonl"),
    )
    .unwrap();
    assert!(FileDestination::open(root.path()).is_err());
    assert_eq!(
        fs::read(outside.path()).unwrap(),
        b"outside content without a newline"
    );
}

#[test]
fn updater_failure_is_recorded_and_private_fields_are_rejected() {
    let memory = Memory::default();
    let collector =
        Collector::with_destinations(identity(), vec![registration(memory.clone())]).unwrap();
    let producer = collector.producer(bound()).unwrap();
    let mut input = event(Level::Error, 0);
    input.event = "update.progress".into();
    input.attributes = serde_json::from_value(json!({
        "stage": "download_finished", "error_code": "signature", "forced": 0
    }))
    .unwrap();
    for attributes in [
        json!({"stage":"/private/PRIVATE_SENTINEL"}),
        json!({"error_code":"https://user:PRIVATE_SENTINEL@example.invalid"}),
        json!({"stage":"install_finished", "path":"PRIVATE_SENTINEL"}),
        json!({"stage":"prepare_window", "forced":true}),
        json!({"stage":"prepare_window", "forced":2}),
    ] {
        let mut rejected = input.clone();
        rejected.attributes = serde_json::from_value(attributes).unwrap();
        assert!(!producer.emit(rejected));
    }
    admit(&producer, input);
    assert!(collector.shutdown(Duration::from_secs(1)));
    let records = memory.0.lock().unwrap();
    let update = records
        .iter()
        .find(|value| value["event"] == "update.progress")
        .unwrap();
    assert_eq!(
        update["attributes"],
        json!({"stage":"download_finished", "error_code":"signature", "forced":0})
    );
    assert_eq!(update["origin"], "native");
    assert!(update.get("workspace_id").is_none());
    assert!(
        !serde_json::to_string(&*records)
            .unwrap()
            .contains("PRIVATE_SENTINEL")
    );
}

#[test]
fn shared_contract_accepts_only_catalog_values() {
    let catalog: Value = serde_json::from_str(CONTRACT).unwrap();
    for value in catalog["valid"].as_array().unwrap() {
        assert!(
            EventInput::from_json(&serde_json::to_vec(value).unwrap()).is_some(),
            "{value}"
        );
    }
    for value in catalog["invalid"].as_array().unwrap() {
        assert!(EventInput::from_json(&serde_json::to_vec(value).unwrap()).is_none());
    }
    for attributes in [
        json!({"action":{"nested":"PRIVATE_SENTINEL"}}),
        json!({"bytes":-1}),
        json!({"attempt":0.5}),
        json!({"count":9007199254740992u64}),
        json!({"duration_ms":86400001}),
        json!({"error":"PRIVATE_SENTINEL"}),
    ] {
        let mut value = catalog["valid"][0].clone();
        value["attributes"] = attributes;
        assert!(EventInput::from_json(&serde_json::to_vec(&value).unwrap()).is_none());
    }
    assert!(EventInput::from_json(&vec![b' '; MAX_EVENT_BYTES + 1]).is_none());
    assert!(EventInput::from_json(br#"{"schema_version":1,"event":"app.started","level":"info","category":"app","timestamp_ms":1.5,"sequence":0,"attributes":{}}"#).is_none());
}

#[test]
fn privacy_boundary_and_independent_destination_filters() {
    let all = Memory::default();
    let errors = Memory::default();
    let mut error_sink = registration(errors.clone());
    error_sink.filter.minimum_level = Level::Error;
    let host = identity();
    let collector =
        Collector::with_destinations(host.clone(), vec![registration(all.clone()), error_sink])
            .unwrap();
    let producer = collector.producer(bound()).unwrap();
    let mut unsafe_event = event(Level::Error, 0);
    unsafe_event
        .attributes
        .insert("message".into(), json!("PRIVATE_SENTINEL"));
    assert!(!producer.emit(unsafe_event));
    admit(&producer, event(Level::Trace, 1));
    admit(&producer, event(Level::Error, 2));
    assert!(collector.shutdown(Duration::from_secs(1)));
    let all_values = all.0.lock().unwrap();
    let values: Vec<_> = all_values
        .iter()
        .filter(|v| v["event"] != "diagnostics.dropped")
        .collect();
    assert_eq!(values.len(), 2);
    assert_eq!(values[0]["device_id"], host.device_id);
    assert_eq!(values[0]["producer_id"], producer.id());
    assert!(values[0].get("workspace_id").is_none());
    assert!(
        !serde_json::to_string(&*values)
            .unwrap()
            .contains("PRIVATE_SENTINEL")
    );
    assert_eq!(
        errors
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|v| v["event"] != "diagnostics.dropped")
            .count(),
        1
    );
}

#[test]
fn plugin_and_sync_adapters_share_workspace_context_without_private_payloads() {
    let memory = Memory::default();
    let collector =
        Collector::with_destinations(identity(), vec![registration(memory.clone())]).unwrap();
    let workspace = "11111111-1111-4111-8111-111111111111";
    let plugin = collector
        .producer(BoundContext {
            origin: Origin::Plugin,
            workspace_id: Some(workspace.into()),
        })
        .unwrap();
    let sync = collector
        .producer(BoundContext {
            origin: Origin::Native,
            workspace_id: Some(workspace.into()),
        })
        .unwrap();
    for (producer, name, category, sequence) in [
        (&plugin, "plugin.loaded", "plugin", 0),
        (&sync, "sync.started", "sync", 0),
        (&sync, "sync.finished", "sync", 1),
    ] {
        let mut input = event(Level::Info, sequence);
        input.event = name.into();
        input.category = category.into();
        admit(producer, input);
    }
    assert!(collector.shutdown(Duration::from_secs(1)));
    let records = memory.0.lock().unwrap();
    let records: Vec<_> = records
        .iter()
        .filter(|event| event["event"] != "diagnostics.dropped")
        .collect();
    assert_eq!(records.len(), 3);
    assert_eq!(records[0]["origin"], "plugin");
    assert_eq!(records[1]["origin"], "native");
    assert!(
        records
            .iter()
            .all(|event| event["workspace_id"] == workspace)
    );
    assert!(records.iter().all(|event| event.get("user_id").is_none()));
}

#[test]
fn producer_admission_releases_on_last_clone() {
    let collector =
        Collector::with_destinations(identity(), vec![registration(NoopDestination)]).unwrap();
    let mut producers: Vec<_> = (0..MAX_PRODUCERS)
        .map(|_| collector.producer(bound()).unwrap())
        .collect();
    assert!(collector.producer(bound()).is_none());
    let copy = producers[0].clone();
    producers.remove(0);
    assert!(collector.producer(bound()).is_none());
    drop(copy);
    assert!(collector.producer(bound()).is_some());
    assert!(collector.shutdown(Duration::from_secs(1)));
}

struct Blocked {
    entered: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
    finished: mpsc::SyncSender<()>,
    memory: Memory,
}
impl Destination for Blocked {
    fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        let record: Value = serde_json::from_slice(bytes).unwrap();
        // Admission retries can emit loss summaries before the initial application event.
        if record["event"] == "app.started" && record["sequence"] == 0 {
            self.entered.send(()).unwrap();
            self.release.recv().unwrap();
        }
        self.memory.write(bytes)
    }
}

impl Drop for Blocked {
    fn drop(&mut self) {
        let _ = self.finished.try_send(());
    }
}

#[test]
fn blocked_writer_bounds_admission_prioritizes_errors_and_shutdown() {
    let (entered_send, entered) = mpsc::sync_channel(1);
    let (release, release_receive) = mpsc::sync_channel(1);
    let (finished_send, finished) = mpsc::sync_channel(1);
    let memory = Memory::default();
    let collector = Collector::with_destinations(
        identity(),
        vec![registration(Blocked {
            entered: entered_send,
            release: release_receive,
            finished: finished_send,
            memory: memory.clone(),
        })],
    )
    .unwrap();
    let producer = collector.producer(bound()).unwrap();
    admit(&producer, event(Level::Info, 0));
    entered.recv_timeout(Duration::from_secs(1)).unwrap();
    let accepted = (1..2000)
        .filter(|i| producer.emit(event(Level::Trace, *i)))
        .count();
    assert_eq!(accepted, QUEUE_BYTES / 4096 - 1);
    assert!(producer.emit(event(Level::Error, 2000)));
    let start = Instant::now();
    assert!(!collector.shutdown(Duration::from_millis(10)));
    drop(collector);
    assert!(start.elapsed() < Duration::from_millis(500));
    assert!(!producer.emit(event(Level::Error, 2001)));
    release.send(()).unwrap();
    finished.recv_timeout(Duration::from_secs(2)).unwrap();
    let records = memory.0.lock().unwrap();
    let sequences: Vec<_> = records
        .iter()
        .filter(|v| v["event"] == "app.started")
        .map(|v| v["sequence"].as_u64().unwrap())
        .collect();
    let expected: Vec<_> = std::iter::once(0)
        .chain(2..=accepted as u64)
        .chain(std::iter::once(2000))
        .collect();
    assert_eq!(sequences, expected);
    assert!(
        records.iter().any(|v| v["event"] == "diagnostics.dropped"
            && v["attributes"]["count"].as_u64().unwrap() > 0)
    );
}

#[test]
fn concurrent_producers_keep_contexts_separate() {
    let memory = Memory::default();
    let collector =
        Collector::with_destinations(identity(), vec![registration(memory.clone())]).unwrap();
    let mut handles = Vec::new();
    let mut workspaces = Vec::new();
    for _ in 0..4 {
        let workspace = Uuid::new_v4().to_string();
        workspaces.push(workspace.clone());
        let producer = collector
            .producer(BoundContext {
                origin: Origin::Frontend,
                workspace_id: Some(workspace),
            })
            .unwrap();
        handles.push(thread::spawn(move || {
            for sequence in 0..100 {
                producer.emit(event(Level::Info, sequence));
            }
        }));
    }
    for handle in handles {
        handle.join().unwrap();
    }
    assert!(collector.shutdown(Duration::from_secs(1)));
    let values = memory.0.lock().unwrap();
    assert!(!values.is_empty());
    for value in values
        .iter()
        .filter(|v| v["event"] != "diagnostics.dropped")
    {
        assert!(workspaces.iter().any(|w| value["workspace_id"] == *w));
    }
    let sequences: Vec<_> = values
        .iter()
        .map(|v| v["collector_sequence"].as_u64().unwrap())
        .collect();
    assert!(sequences.windows(2).all(|pair| pair[0] < pair[1]));
}

fn log_bytes(path: &std::path::Path) -> u64 {
    fs::read_dir(path)
        .unwrap()
        .map(|e| e.unwrap())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".jsonl"))
        // Windows directory entries can retain stale sizes while a writer is open.
        .map(|e| fs::File::open(e.path()).unwrap().metadata().unwrap().len())
        .sum()
}

#[test]
fn rotation_and_restart_never_exceed_total_or_split_records() {
    assert_eq!(TOTAL_BYTES, 268435456);
    assert_eq!(SEGMENT_BYTES, 4194304);
    let temp = tempfile::tempdir().unwrap();
    for _ in 0..3 {
        let mut writer = FileDestination::with_limits(temp.path(), 128, 64).unwrap();
        for number in 0..100 {
            let bytes = format!("{{\"n\":{number},\"value\":\"é\"}}\n");
            writer.write(bytes.as_bytes()).unwrap();
            assert!(log_bytes(temp.path()) <= 128);
        }
    }
    for entry in fs::read_dir(temp.path())
        .unwrap()
        .map(Result::unwrap)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".jsonl"))
    {
        let bytes = fs::read(entry.path()).unwrap();
        assert!(bytes.len() <= 64);
        assert_eq!(bytes.last(), Some(&b'\n'));
        for line in String::from_utf8(bytes).unwrap().lines() {
            serde_json::from_str::<Value>(line).unwrap();
        }
    }
}

#[test]
fn startup_evicts_old_history_and_repairs_only_torn_tail() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(
        temp.path().join("segment-00000000000000000001.jsonl"),
        [b'x'; 100],
    )
    .unwrap();
    fs::write(
        temp.path().join("segment-00000000000000000002.jsonl"),
        b"{\"schema_version\":0}\nTORN",
    )
    .unwrap();
    let mut writer = FileDestination::with_limits(temp.path(), 64, 64).unwrap();
    assert!(
        !temp
            .path()
            .join("segment-00000000000000000001.jsonl")
            .exists()
    );
    writer.write(b"{\"new\":true}\n").unwrap();
    assert_eq!(
        fs::read(temp.path().join("segment-00000000000000000002.jsonl")).unwrap(),
        b"{\"schema_version\":0}\n{\"new\":true}\n"
    );
}

#[test]
fn writer_lock_huge_records_and_unexpected_files_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    let mut writer = FileDestination::open(temp.path()).unwrap();
    assert!(FileDestination::open(temp.path()).is_err());
    let mut huge = vec![b'x'; MAX_EVENT_BYTES];
    huge.push(b'\n');
    assert!(writer.write(&huge).is_err());
    assert_eq!(log_bytes(temp.path()), 0);
    assert!(writer.write(b"{}\n").is_err());
    drop(writer);
    let mut recovered = FileDestination::open(temp.path()).unwrap();
    recovered.write(b"{}\n").unwrap();
    drop(recovered);
    fs::write(temp.path().join("unrelated"), b"preserve").unwrap();
    assert!(FileDestination::open(temp.path()).is_err());
    assert_eq!(
        fs::read(temp.path().join("unrelated")).unwrap(),
        b"preserve"
    );
}

#[test]
fn device_identity_persists_but_corruption_is_preserved() {
    let temp = tempfile::tempdir().unwrap();
    let id = load_or_create_device_id(temp.path()).unwrap();
    assert_eq!(id, load_or_create_device_id(temp.path()).unwrap());
    let other = tempfile::tempdir().unwrap();
    assert_ne!(id, load_or_create_device_id(other.path()).unwrap());
    fs::write(temp.path().join("device-id"), b"corrupt").unwrap();
    assert!(load_or_create_device_id(temp.path()).is_err());
    assert_eq!(fs::read(temp.path().join("device-id")).unwrap(), b"corrupt");
}

#[cfg(unix)]
#[test]
fn symlinks_hardlinks_and_deletion_substitution_are_not_followed() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let target = external.path().join("private");
    fs::write(&target, b"preserve").unwrap();
    let segment = temp.path().join("segment-00000000000000000001.jsonl");
    symlink(&target, &segment).unwrap();
    assert!(FileDestination::open(temp.path()).is_err());
    fs::remove_file(&segment).unwrap();
    fs::hard_link(&target, &segment).unwrap();
    assert!(FileDestination::open(temp.path()).is_err());
    fs::remove_file(&segment).unwrap();
    let mut writer = FileDestination::with_limits(temp.path(), 16, 16).unwrap();
    writer.write(b"{\"a\":12345}\n").unwrap();
    fs::remove_file(&segment).unwrap();
    symlink(&target, &segment).unwrap();
    assert!(writer.write(b"{\"a\":12345}\n").is_err());
    assert_eq!(fs::read(target).unwrap(), b"preserve");
}

#[test]
fn exact_whole_record_limits_include_active_file() {
    let temp = tempfile::tempdir().unwrap();
    let mut writer = FileDestination::with_limits(temp.path(), 16, 16).unwrap();
    let exact = b"{\"text\":\"abcd\"}\n";
    assert_eq!(exact.len(), 16);
    writer.write(exact).unwrap();
    assert_eq!(log_bytes(temp.path()), 16);
    writer.write(exact).unwrap();
    assert_eq!(log_bytes(temp.path()), 16);
    assert!(writer.write(b"{\"text\":\"abcde\"}\n").is_err());
    assert_eq!(log_bytes(temp.path()), 16);
}

#[test]
fn local_collector_records_jsonl_with_host_identity() {
    let temp = tempfile::tempdir().unwrap();
    let host = identity();
    let collector = Collector::start(temp.path(), host.clone()).unwrap();
    let producer = collector.producer(bound()).unwrap();
    admit(&producer, event(Level::Info, 0));
    assert!(collector.shutdown(Duration::from_secs(1)));
    let entry = fs::read_dir(temp.path())
        .unwrap()
        .map(Result::unwrap)
        .find(|entry| entry.file_name().to_string_lossy().ends_with(".jsonl"))
        .unwrap();
    let bytes = fs::read(entry.path()).unwrap();
    let text = String::from_utf8(bytes).unwrap();
    let record = text
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|v| v["event"] == "app.started")
        .unwrap();
    assert_eq!(record["device_id"], host.device_id);
    assert_eq!(record["session_id"], host.session_id);
    assert_eq!(record["event"], "app.started");
}

#[test]
fn lock_is_exclusive_across_processes() {
    const CHILD_DIRECTORY: &str = "SITUATE_DIAGNOSTICS_LOCK_TEST";
    if let Some(path) = std::env::var_os(CHILD_DIRECTORY) {
        assert!(FileDestination::open(std::path::Path::new(&path)).is_err());
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    let _writer = FileDestination::open(temp.path()).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "diagnostics::tests::lock_is_exclusive_across_processes",
        ])
        .env(CHILD_DIRECTORY, temp.path())
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn rotation_deletion_failure_preserves_unknown_entries() {
    let temp = tempfile::tempdir().unwrap();
    let mut writer = FileDestination::with_limits(temp.path(), 16, 16).unwrap();
    writer.write(b"{\"text\":\"abcd\"}\n").unwrap();
    let path = temp.path().join("segment-00000000000000000001.jsonl");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    fs::write(path.join("unrelated"), b"preserve").unwrap();
    assert!(writer.write(b"{\"text\":\"abcd\"}\n").is_err());
    assert_eq!(fs::read(path.join("unrelated")).unwrap(), b"preserve");
}

#[cfg(unix)]
#[test]
fn directory_symlink_is_rejected_without_changing_target_permissions() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let temp = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    fs::set_permissions(target.path(), fs::Permissions::from_mode(0o755)).unwrap();
    let link = temp.path().join("diagnostics");
    symlink(target.path(), &link).unwrap();
    assert!(FileDestination::open(&link).is_err());
    assert_eq!(
        fs::metadata(target.path()).unwrap().permissions().mode() & 0o777,
        0o755
    );
}

struct Failing;
impl Destination for Failing {
    fn write(&mut self, _: &[u8]) -> io::Result<()> {
        Err(io::ErrorKind::StorageFull.into())
    }
}
#[test]
fn sink_failure_does_not_prevent_other_destinations_or_quit() {
    let memory = Memory::default();
    let collector = Collector::with_destinations(
        identity(),
        vec![registration(Failing), registration(memory.clone())],
    )
    .unwrap();
    let producer = collector.producer(bound()).unwrap();
    admit(&producer, event(Level::Error, 0));
    assert!(collector.shutdown(Duration::from_secs(1)));
    assert!(
        memory
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|v| v["event"] == "app.started")
    );
}
