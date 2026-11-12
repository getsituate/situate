#[cfg(feature = "native-smoke")]
use super::{Diagnostics, directories};
#[cfg(feature = "native-smoke")]
use tauri::Manager;
#[cfg(feature = "native-smoke")]
#[path = "diagnostics_timing.rs"]
mod timing;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
#[cfg(feature = "native-smoke")]
use std::{sync::LazyLock, time::Instant};
#[cfg(feature = "native-smoke")]
pub use timing::{FileStage, record_file_stage};

#[cfg(feature = "native-smoke")]
pub static BATCH_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
#[cfg(feature = "native-smoke")]
static PROFILE: LazyLock<Arc<ProfileState>> = LazyLock::new(|| Arc::new(ProfileState::default()));

#[derive(Default)]
struct ProfileState {
    initialized: AtomicBool,
    writer_entered: AtomicBool,
    session_id: std::sync::OnceLock<String>,
}

impl ProfileState {
    fn validate(&self, mode: &MeasurementMode) -> Result<Value, String> {
        let initialized = self.initialized.load(Ordering::Acquire);
        let writer_entered = self.writer_entered.load(Ordering::Acquire);
        if initialized != (*mode != MeasurementMode::Disabled) {
            return Err("Collector initialization does not match the requested profile".into());
        }
        if matches!(mode, MeasurementMode::Slow | MeasurementMode::Blocked) && !writer_entered {
            return Err("The delayed diagnostic writer was not entered".into());
        }
        let observed_writer = matches!(mode, MeasurementMode::Slow | MeasurementMode::Blocked)
            .then_some(writer_entered);
        Ok(serde_json::json!({"initialized": initialized, "writer_entered": observed_writer}))
    }
}

#[derive(serde::Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum MeasurementMode {
    Disabled,
    Healthy,
    Slow,
    Blocked,
}

fn measurement_mode(value: Option<&str>) -> std::io::Result<MeasurementMode> {
    match value {
        None | Some("healthy") => Ok(MeasurementMode::Healthy),
        Some("disabled") => Ok(MeasurementMode::Disabled),
        Some("slow") => Ok(MeasurementMode::Slow),
        Some("blocked") => Ok(MeasurementMode::Blocked),
        Some(_) => Err(std::io::Error::other("Unknown diagnostic measurement mode")),
    }
}

#[cfg(feature = "native-smoke")]
pub fn start_collector(
    directory: &Path,
    identity: situate_core::diagnostics::HostIdentity,
) -> std::io::Result<situate_core::diagnostics::Collector> {
    let mode = measurement_mode(std::env::var("SITUATE_DIAGNOSTICS_PROFILE").ok().as_deref())?;
    start_profile_collector(directory, identity, mode, Arc::clone(&PROFILE))
}

fn start_profile_collector(
    directory: &Path,
    identity: situate_core::diagnostics::HostIdentity,
    mode: MeasurementMode,
    state: Arc<ProfileState>,
) -> std::io::Result<situate_core::diagnostics::Collector> {
    use situate_core::diagnostics::{
        Collector, Destination, DestinationFilter, DestinationRegistration, FileDestination,
    };
    struct DelayedFile {
        file: FileDestination,
        blocked: bool,
        state: Arc<ProfileState>,
    }
    impl Destination for DelayedFile {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
            self.state.writer_entered.store(true, Ordering::Release);
            if self.blocked {
                loop {
                    std::thread::park();
                }
            }
            std::thread::sleep(Duration::from_millis(10));
            self.file.write(bytes)
        }
    }
    let session_id = identity.session_id.clone();
    let collector = match mode {
        MeasurementMode::Healthy => Collector::start(directory, identity),
        MeasurementMode::Disabled => Err(std::io::Error::other("Diagnostic baseline disabled")),
        mode @ (MeasurementMode::Slow | MeasurementMode::Blocked) => Collector::with_destinations(
            identity,
            vec![DestinationRegistration {
                destination: Box::new(DelayedFile {
                    file: FileDestination::open(directory)?,
                    blocked: mode == MeasurementMode::Blocked,
                    state: Arc::clone(&state),
                }),
                filter: DestinationFilter::default(),
            }],
        ),
    }?;
    state
        .session_id
        .set(session_id)
        .map_err(|_| std::io::Error::other("Diagnostic profile was already initialized"))?;
    state.initialized.store(true, Ordering::Release);
    Ok(collector)
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct UiMeasurement {
    requests: u32,
    duration_ms: f64,
    request_p95_ms: f64,
    frame_p95_ms: Option<f64>,
    frame_max_ms: Option<f64>,
    visible: bool,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MeasurementPhase {
    Ready,
    Idle,
    Burst,
}

#[cfg(feature = "native-smoke")]
#[tauri::command]
pub async fn smoke_measure_diagnostics(
    app: tauri::AppHandle,
    phase: MeasurementPhase,
    ui: Option<UiMeasurement>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (directory, _, _) = directories(&app).map_err(|_| "Diagnostic directory unavailable")?;
        let value = std::env::var("SITUATE_DIAGNOSTICS_PROFILE").map_err(|_| "Diagnostic profiling is not enabled")?;
        let mode = measurement_mode(Some(&value)).map_err(|_| "Invalid diagnostic measurement mode")?;
        let collector = PROFILE.validate(&mode)?;
        // Log inspection is deferred until after the final resource sample.
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let resources = {
            let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
            if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 { return Err("Host resource usage unavailable".into()); }
            let usage = unsafe { usage.assume_init() };
            let cpu_ms = (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) as f64 * 1000.0 + (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) as f64 / 1000.0;
            let rss_scale = if cfg!(target_os = "macos") { 1 } else { 1024 };
            serde_json::json!({"host_cpu_ms":cpu_ms,"host_peak_rss_bytes":usage.ru_maxrss as u64 * rss_scale})
        };
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let resources = Value::Null;
        let file_timings = match phase {
            MeasurementPhase::Idle => { timing::begin_file_timings()?; Value::Null },
            MeasurementPhase::Burst => timing::finish_file_timings()?,
            MeasurementPhase::Ready => Value::Null,
        };
        let totals = measurement_totals(&directory, &mode, &phase)?;
        let report = serde_json::json!({"mode":mode,"phase":phase,"ui":ui,"totals":totals,"file_timings":file_timings,"collector":collector,"resources":resources,"ipc_batches":BATCH_COUNT.load(std::sync::atomic::Ordering::Relaxed)});
        println!("SITUATE_DIAGNOSTICS_MEASUREMENT {report}");
        Ok(())
    }).await.map_err(|_| "Diagnostic measurement worker failed".to_owned())?
}

#[cfg(test)]
mod measurement_tests {
    use super::*;

    #[test]
    fn profiling_requires_known_modes_and_never_echoes_unknown_values() {
        assert!(matches!(
            measurement_mode(None),
            Ok(MeasurementMode::Healthy)
        ));
        for (name, expected) in [
            ("healthy", MeasurementMode::Healthy),
            ("disabled", MeasurementMode::Disabled),
            ("slow", MeasurementMode::Slow),
            ("blocked", MeasurementMode::Blocked),
        ] {
            assert!(measurement_mode(Some(name)).is_ok_and(|value| value == expected));
        }
        let error = measurement_mode(Some("PRIVATE_MODE_VALUE")).err().unwrap();
        assert!(!error.to_string().contains("PRIVATE_MODE_VALUE"));
    }

    #[test]
    fn only_disabled_totals_allow_a_missing_directory() {
        let root = tempfile::tempdir().unwrap();
        let logs = root.path().join("logs");
        assert_eq!(
            measurement_totals(&logs, &MeasurementMode::Disabled, &MeasurementPhase::Burst)
                .unwrap(),
            serde_json::json!({"records":0,"serialized_bytes":0,"reported_drops":0})
        );
        for mode in [
            MeasurementMode::Healthy,
            MeasurementMode::Slow,
            MeasurementMode::Blocked,
        ] {
            assert!(measurement_totals(&logs, &mode, &MeasurementPhase::Burst).is_err());
        }
        fs::write(&logs, b"not a directory").unwrap();
        assert!(
            measurement_totals(&logs, &MeasurementMode::Disabled, &MeasurementPhase::Burst)
                .is_err()
        );
    }

    #[test]
    fn disabled_totals_reject_persisted_records() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("segment.jsonl"), b"{}\n").unwrap();
        assert!(
            measurement_totals(
                root.path(),
                &MeasurementMode::Disabled,
                &MeasurementPhase::Burst
            )
            .is_err()
        );
    }

    #[test]
    fn quota_verification_includes_an_open_segment() {
        let root = tempfile::tempdir().unwrap();
        let file = fs::File::create(root.path().join("segment.jsonl")).unwrap();
        file.set_len(situate_core::diagnostics::TOTAL_BYTES + 1)
            .unwrap();
        assert_eq!(
            records(root.path()).unwrap_err(),
            "Diagnostic quota exceeded"
        );
        drop(file);
    }

    #[test]
    fn log_inspection_waits_for_the_final_phase() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("segment.jsonl"), b"invalid JSON\n").unwrap();
        for phase in [MeasurementPhase::Ready, MeasurementPhase::Idle] {
            assert_eq!(
                measurement_totals(root.path(), &MeasurementMode::Healthy, &phase).unwrap(),
                Value::Null
            );
        }
        assert!(
            measurement_totals(
                root.path(),
                &MeasurementMode::Healthy,
                &MeasurementPhase::Burst
            )
            .is_err()
        );
    }

    #[test]
    fn delayed_profiles_require_initialization_and_writer_entry() {
        let state = ProfileState::default();
        assert!(state.validate(&MeasurementMode::Disabled).is_ok());
        assert!(state.validate(&MeasurementMode::Healthy).is_err());
        for mode in [MeasurementMode::Slow, MeasurementMode::Blocked] {
            assert!(state.validate(&mode).is_err());
        }
        state.initialized.store(true, Ordering::Release);
        assert!(state.validate(&MeasurementMode::Healthy).is_ok());
        assert!(state.validate(&MeasurementMode::Disabled).is_err());
        for mode in [MeasurementMode::Slow, MeasurementMode::Blocked] {
            assert!(state.validate(&mode).is_err());
        }
        state.writer_entered.store(true, Ordering::Release);
        for mode in [MeasurementMode::Slow, MeasurementMode::Blocked] {
            assert!(state.validate(&mode).is_ok());
        }
    }

    #[test]
    fn destination_initialization_failure_cannot_pass_as_a_delayed_profile() {
        let root = tempfile::tempdir().unwrap();
        let logs = root.path().join("logs");
        fs::write(&logs, b"not a directory").unwrap();
        for mode in [MeasurementMode::Slow, MeasurementMode::Blocked] {
            let state = Arc::new(ProfileState::default());
            let identity = situate_core::diagnostics::HostIdentity {
                device_id: "11111111-1111-4111-8111-111111111111".into(),
                session_id: "22222222-2222-4222-8222-222222222222".into(),
                app_version: "0.0.0".into(),
                platform: "android".into(),
                platform_version: "test".into(),
            };
            assert!(start_profile_collector(&logs, identity, mode, Arc::clone(&state)).is_err());
            assert!(state.validate(&MeasurementMode::Slow).is_err());
            assert!(state.validate(&MeasurementMode::Blocked).is_err());
        }
    }

    #[test]
    fn ui_measurements_admit_only_numeric_observations_and_visibility() {
        let mut value = serde_json::json!({"requests":1000,"duration_ms":12000,"request_p95_ms":18,"frame_p95_ms":null,"frame_max_ms":null,"visible":false});
        assert!(serde_json::from_value::<UiMeasurement>(value.clone()).is_ok());
        value["text"] = Value::String("PRIVATE_UI_CONTENT".into());
        assert!(serde_json::from_value::<UiMeasurement>(value).is_err());
    }
}

fn measurement_totals(
    directory: &Path,
    mode: &MeasurementMode,
    phase: &MeasurementPhase,
) -> Result<Value, String> {
    if !matches!(phase, MeasurementPhase::Burst) {
        return Ok(Value::Null);
    }
    let records = match fs::read_dir(directory) {
        Ok(entries) => read_records(entries)?,
        Err(error)
            if *mode == MeasurementMode::Disabled
                && error.kind() == std::io::ErrorKind::NotFound =>
        {
            Vec::new()
        }
        Err(_) => return Err("Diagnostic files are not available".into()),
    };
    if *mode == MeasurementMode::Disabled && !records.is_empty() {
        return Err("Disabled collector wrote diagnostic records".into());
    }
    let bytes: usize = records
        .iter()
        .map(|record| serde_json::to_vec(record).unwrap().len() + 1)
        .sum();
    let dropped: u64 = records
        .iter()
        .filter(|record| record["event"] == "diagnostics.dropped")
        .filter_map(|record| record["attributes"]["count"].as_u64())
        .sum();
    Ok(
        serde_json::json!({"records":records.len(),"serialized_bytes":bytes,"reported_drops":dropped}),
    )
}

fn records(directory: &Path) -> Result<Vec<Value>, String> {
    read_records(fs::read_dir(directory).map_err(|_| "Diagnostic files are not available")?)
}

fn read_records(entries: fs::ReadDir) -> Result<Vec<Value>, String> {
    let mut records = Vec::new();
    let mut total = 0u64;
    for entry in entries {
        let entry = entry.map_err(|_| "Diagnostic directory could not be read")?;
        if entry
            .path()
            .extension()
            .is_none_or(|value| value != "jsonl")
        {
            continue;
        }
        let file =
            fs::File::open(entry.path()).map_err(|_| "Diagnostic segment could not be read")?;
        // NTFS directory-entry lengths can lag behind the open writer handle.
        total += file
            .metadata()
            .map_err(|_| "Diagnostic metadata could not be read")?
            .len();
        let mut text = String::new();
        file.take(8 * 1024 * 1024)
            .read_to_string(&mut text)
            .map_err(|_| "Diagnostic segment is not UTF-8")?;
        if text.contains("PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL") || text.contains("native-editor.md")
        {
            return Err("Workspace content leaked into diagnostics".into());
        }
        for line in text
            .split_inclusive('\n')
            .filter(|line| line.ends_with('\n'))
        {
            let record: Value =
                serde_json::from_str(line).map_err(|_| "Invalid diagnostic JSON line")?;
            if record.get("user_id").is_some()
                || record.get("workspace_ref").is_some()
                || record.get("message").is_some()
            {
                return Err("Unexpected private diagnostic field".into());
            }
            records.push(record);
            if records.len() > 10_000 {
                return Err("Unexpected diagnostic smoke volume".into());
            }
        }
    }
    if total > situate_core::diagnostics::TOTAL_BYTES {
        return Err("Diagnostic quota exceeded".into());
    }
    Ok(records)
}

fn correlated(records: &[Value], session_id: &str) -> bool {
    records.iter().any(|native| {
        native["session_id"] == session_id
            && native["origin"] == "native"
            && native["event"] == "operation.finished"
            && native["category"] == "storage"
            && native["workspace_id"]
                .as_str()
                .is_some_and(situate_core::diagnostics::valid_uuid)
            && records.iter().any(|frontend| {
                frontend["origin"] == "frontend"
                    && frontend["event"] == "operation.started"
                    && frontend["context"]["span_id"].is_string()
                    && frontend["context"]["span_id"] == native["context"]["parent_span_id"]
                    && frontend["context"]["trace_id"] == native["context"]["trace_id"]
                    && frontend["workspace_id"] == native["workspace_id"]
                    && frontend["device_id"] == native["device_id"]
                    && frontend["session_id"] == native["session_id"]
            })
    })
}

fn script_failure(records: &[Value], session_id: &str) -> bool {
    records.iter().any(|record| {
        record["session_id"] == session_id
            && record["origin"] == "frontend"
            && record["event"] == "runtime.failed"
            && record["category"] == "app"
            && record["level"] == "error"
            && record.get("workspace_id").is_none()
            && record.get("context").is_none()
            && record["attributes"]
                == serde_json::json!({"boundary":"script","error_code":"unknown"})
    })
}

#[cfg(feature = "native-smoke")]
#[tauri::command]
pub async fn smoke_verify_diagnostics(app: tauri::AppHandle) -> Result<(), String> {
    let session_id = app
        .state::<Diagnostics>()
        .runtime
        .lock()
        .await
        .as_ref()
        .ok_or("Diagnostic session is unavailable")?
        .session_id
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (directory, _, _) =
            directories(&app).map_err(|_| "Diagnostic storage is unavailable")?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let result = records(&directory);
            match result {
                Ok(records)
                    if correlated(&records, &session_id)
                        && script_failure(&records, &session_id) =>
                {
                    return Ok(());
                }
                Err(error) if !error.contains("not available") => return Err(error),
                _ if Instant::now() >= deadline => {
                    return Err("Diagnostic operation or script failure was not recorded".into());
                }
                _ => std::thread::sleep(Duration::from_millis(25)),
            }
        }
    })
    .await
    .map_err(|_| "Diagnostic smoke worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn pair(session: &str) -> [Value; 2] {
        let workspace = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        let trace = Uuid::new_v4().to_string();
        let span = Uuid::new_v4().to_string();
        [
            json!({
                "origin": "frontend", "event": "operation.started",
                "session_id": session, "device_id": device, "workspace_id": workspace,
                "context": { "trace_id": trace, "span_id": span }
            }),
            json!({
                "origin": "native", "event": "operation.finished", "category": "storage",
                "session_id": session, "device_id": device, "workspace_id": workspace,
                "context": { "trace_id": trace, "parent_span_id": span }
            }),
        ]
    }

    fn write_segment(directory: &Path, name: &str, values: &[Value]) {
        let text: String = values.iter().map(|value| format!("{value}\n")).collect();
        fs::write(directory.join(name), text).unwrap();
    }

    #[test]
    fn retained_pairs_cannot_satisfy_a_new_session_without_its_own_pair() {
        let directory = tempfile::tempdir().unwrap();
        let old = Uuid::new_v4().to_string();
        let current = Uuid::new_v4().to_string();
        write_segment(directory.path(), "old.jsonl", &pair(&old));
        let started = json!({ "event": "app.started", "session_id": current });
        write_segment(directory.path(), "current.jsonl", &[started]);
        assert!(!correlated(&records(directory.path()).unwrap(), &current));

        let current_pair = pair(&current);
        write_segment(directory.path(), "current.jsonl", &current_pair[..1]);
        assert!(!correlated(&records(directory.path()).unwrap(), &current));
        write_segment(directory.path(), "current.jsonl", &current_pair);
        let all = records(directory.path()).unwrap();
        assert!(correlated(&all, &current));
        assert!(correlated(&all, &old));
    }

    #[test]
    fn current_session_still_requires_matching_causal_identity() {
        let current = Uuid::new_v4().to_string();
        let valid = pair(&current);
        assert!(correlated(&valid, &current));
        for field in ["session_id", "device_id", "workspace_id"] {
            let mut mismatched = valid.clone();
            mismatched[0][field] = json!(Uuid::new_v4().to_string());
            assert!(!correlated(&mismatched, &current), "{field}");
        }
        for field in ["trace_id", "span_id"] {
            let mut mismatched = valid.clone();
            mismatched[0]["context"][field] = json!(Uuid::new_v4().to_string());
            assert!(!correlated(&mismatched, &current), "{field}");
        }
        assert!(!correlated(&[], &current));
    }

    #[test]
    fn script_failure_requires_current_session_and_safe_application_scope() {
        let session = Uuid::new_v4().to_string();
        let valid = json!({
            "session_id":session, "origin":"frontend", "event":"runtime.failed",
            "category":"app", "level":"error",
            "attributes":{"boundary":"script","error_code":"unknown"}
        });
        assert!(script_failure(std::slice::from_ref(&valid), &session));
        for (field, value) in [
            ("session_id", json!(Uuid::new_v4().to_string())),
            ("origin", json!("native")),
            ("workspace_id", json!(Uuid::new_v4().to_string())),
            ("context", json!({"trace_id":Uuid::new_v4().to_string()})),
            (
                "attributes",
                json!({"boundary":"script","error_code":"unknown","message":"PRIVATE_SENTINEL"}),
            ),
        ] {
            let mut invalid = valid.clone();
            invalid[field] = value;
            assert!(!script_failure(&[invalid], &session));
        }
    }

    #[test]
    fn retained_segments_are_still_checked_for_private_content() {
        let directory = tempfile::tempdir().unwrap();
        write_segment(
            directory.path(),
            "old.jsonl",
            &[json!({ "message": "PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL" })],
        );
        assert!(records(directory.path()).is_err());
    }
}
