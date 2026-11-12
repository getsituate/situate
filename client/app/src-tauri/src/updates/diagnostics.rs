use serde_json::json;
use situate_core::diagnostics::{EventInput, Level};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn record<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    stage: &str,
    error: Option<&str>,
    forced: bool,
) {
    if let Some(event) = event(stage, error, forced) {
        crate::diagnostics::application_event(app, event);
    }
}

fn event(stage: &str, error: Option<&str>, forced: bool) -> Option<EventInput> {
    let stage = STAGES.iter().copied().find(|allowed| *allowed == stage)?;
    let mut attributes = serde_json::Map::from_iter([
        ("stage".into(), json!(stage)),
        ("forced".into(), json!(u8::from(forced))),
    ]);
    if let Some(error) = error {
        attributes.insert("error_code".into(), json!(error_class(error)));
    }
    let event = EventInput {
        schema_version: 1,
        event: "update.progress".into(),
        category: "app".into(),
        level: if error.is_some() {
            Level::Error
        } else {
            Level::Info
        },
        timestamp_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(9_007_199_254_740_991) as u64,
        sequence: 0,
        context: None,
        attributes,
    };
    event.is_valid().then_some(event)
}

const STAGES: &[&str] = &[
    "setup",
    "check_started",
    "check_finished",
    "download_started",
    "download_finished",
    "cache_restore_started",
    "cache_restore_finished",
    "cache_pending_restore",
    "cache_verify",
    "prepare_started",
    "prepare_finished",
    "install_started",
    "install_finished",
    "recovery",
    "install_requested",
    "prepare_actions",
    "prepare_windows",
    "prepare_window",
    "install_validate",
    "install_replace",
    "install_restart",
];

fn error_class(error: &str) -> &'static str {
    match error {
        "http" => "http",
        "connect" => "connect",
        "timeout" => "timeout",
        "signature" => "signature",
        "cache" | "native.updates.cacheFailed" => "cache",
        "install" | "native.updates.installFailed" => "install",
        "preparation" | "native.updates.preparationFailed" | "native.updates.stopFailed" => {
            "preparation"
        }
        "configuration" | "native.updates.invalidConfiguration" => "configuration",
        "invalid_response" => "invalid_response",
        "network" | "native.updates.downloadFailed" => "network",
        "busy" | "native.updates.busy" | "native.updates.runningActions" => "busy",
        "changed" | "native.updates.changed" => "changed",
        "interrupted" | "native.updates.recoveryRequired" => "interrupted",
        "panic" => "panic",
        "cancelled" => "cancelled",
        "window_missing" => "window_missing",
        "window_rejected" => "window_rejected",
        "conversation_save" | "native.updates.persistenceFailed" => "conversation_save",
        "window_error" => "window_error",
        "dictation_active" => "dictation_active",
        "files_pending" => "files_pending",
        "internal" => "internal",
        "bundle_changed" => "bundle_changed",
        "bundle_io" => "bundle_io",
        "relaunch" => "relaunch",
        _ => "unknown",
    }
}

pub(super) fn request_error(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_status() {
        "http"
    } else {
        "network"
    }
}

pub(super) fn updater_error(error: &tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error;
    match error {
        Error::Reqwest(error) => request_error(error),
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => "signature",
        Error::Network(_) => "http",
        Error::Io(_) => "cache",
        Error::Serialization(_)
        | Error::Semver(_)
        | Error::ReleaseNotFound
        | Error::TargetNotFound(_)
        | Error::TargetsNotFound(_) => "invalid_response",
        Error::InsecureTransportProtocol | Error::EmptyEndpoints | Error::UrlParse(_) => {
            "configuration"
        }
        Error::PreviousAppNotRestored(_)
        | Error::TempDirNotOnSameMountPoint
        | Error::BinaryNotFoundInArchive
        | Error::TempDirNotFound
        | Error::InvalidUpdaterFormat => "install",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_events_reach_the_existing_collector_without_private_error_payloads() {
        use situate_core::diagnostics::{BoundContext, Collector, HostIdentity, Origin};
        use std::time::{Duration, Instant};
        let dir = tempfile::tempdir().unwrap();
        let collector = Collector::start(
            dir.path(),
            HostIdentity {
                device_id: uuid::Uuid::new_v4().to_string(),
                session_id: uuid::Uuid::new_v4().to_string(),
                app_version: "1.0.0".into(),
                platform: "test".into(),
                platform_version: "1".into(),
            },
        )
        .unwrap();
        let producer = collector
            .producer(BoundContext {
                origin: Origin::Native,
                workspace_id: None,
            })
            .unwrap();
        let input = event(
            "download_finished",
            Some("PRIVATE_SENTINEL https://user:password@example.invalid /private/file"),
            false,
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        while !producer.emit(input.clone()) {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert!(collector.shutdown(Duration::from_secs(1)));
        let bytes: Vec<u8> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "jsonl")
            })
            .flat_map(|entry| std::fs::read(entry.path()).unwrap())
            .collect();
        let records: Vec<serde_json::Value> = String::from_utf8(bytes)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let record = records
            .iter()
            .find(|record| record["event"] == "update.progress")
            .unwrap();
        assert_eq!(
            record["attributes"],
            json!({"stage":"download_finished","error_code":"unknown","forced":0})
        );
        assert_eq!(record["origin"], "native");
        assert!(record.get("workspace_id").is_none());
        assert!(
            !serde_json::to_string(&records)
                .unwrap()
                .contains("PRIVATE_SENTINEL")
        );
        for stage in STAGES {
            assert!(event(stage, None, true).is_some(), "{stage}");
        }
    }

    #[test]
    fn update_events_drop_private_stages_and_normalize_private_errors() {
        assert!(event("https://private.invalid/token", None, false).is_none());
        let event = event("prepare_finished", Some("/private/token=SECRET"), true).unwrap();
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(
            value["attributes"],
            json!({"stage":"prepare_finished","error_code":"unknown","forced":1})
        );
        assert!(!value.to_string().contains("SECRET"));
        assert_eq!(
            error_class("native.updates.preparationFailed"),
            "preparation"
        );
        assert_eq!(
            updater_error(&tauri_plugin_updater::Error::SignatureUtf8("SECRET".into())),
            "signature"
        );
        assert_eq!(
            updater_error(&tauri_plugin_updater::Error::PreviousAppNotRestored(
                "/private/SECRET".into()
            )),
            "install"
        );
    }
}
