use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

#[test]
fn recovery_preserves_live_install_barriers_without_freezing_a_new_process() {
    for live_install in [false, true] {
        let app = host();
        app.manage(crate::ai_executor::Executors::default());
        let state = app.state::<Updates>();
        state
            .preparation
            .held
            .store(live_install, Ordering::Release);
        state
            .preparation
            .sealed
            .store(live_install, Ordering::Release);
        if live_install {
            crate::ai_executor::prepare_close(app.handle(), "workspace").unwrap();
        }
        let directory = tempfile::tempdir().unwrap();
        let cache = Cache::open(directory.path().into()).unwrap();
        cache.mark_installing("2.0.0").unwrap();
        let service = Native {
            cache,
            data: Mutex::new(Data {
                verified: None,
                verified_bytes: 0,
                candidate: None,
                check_retry: Retry::default(),
                download_retry: Retry::default(),
                discovery_needed: false,
            }),
            working: AtomicBool::new(false),
            disabled: AtomicBool::new(false),
            initialized: AtomicBool::new(true),
        };
        service.recovery(app.handle(), false);
        assert!(service.disabled.load(Ordering::Acquire));
        assert!(service.cache.interrupted());
        assert!(matches!(
            state.snapshot.lock().unwrap().phase,
            Phase::RecoveryRequired
        ));
        assert_eq!(state.preparation.held.load(Ordering::Acquire), live_install);
        assert_eq!(
            state.preparation.sealed.load(Ordering::Acquire),
            live_install
        );
        assert_eq!(
            super::super::ensure_mutation_admitted(app.handle()).is_err(),
            live_install
        );
        assert_eq!(
            crate::ai_executor::ensure_capture_available(app.handle(), "workspace").is_err(),
            live_install
        );
    }
}

#[test]
fn scheduler_reconciles_host_connectivity_without_skipping_server_cooldowns() {
    let mut data = Data {
        verified: None,
        verified_bytes: 0,
        candidate: None,
        check_retry: Retry::default(),
        download_retry: Retry::default(),
        discovery_needed: false,
    };
    for _ in 0..4 {
        data.check_retry.failed(1_000, true);
    }
    assert_eq!(data.check_retry.due, 3_601_000);
    assert!(!data.due(2_000, None, false, Some(false)));
    assert!(!data.due(2_000, None, false, None));
    assert!(data.due(2_000, None, false, Some(true)));
    data.check_retry.failed(2_000, false);
    assert!(!data.due(3_000, None, false, Some(true)));
    assert!(!data.due(3_000, None, false, Some(false)));
    assert!(!data.due(3_000, None, false, Some(true)));
    assert!(data.due(3_000, None, true, Some(true)));
    data.check_retry.succeeded();
    assert!(!data.due(policy::DAY, Some(policy::DAY), false, Some(true)));
    assert!(data.due(policy::DAY * 2, Some(policy::DAY), false, Some(true)));
    assert!(data.due(100, Some(policy::DAY), false, Some(true)));
    data.check_retry.failed(policy::DAY, false);
    assert!(data.due(100, Some(policy::DAY), false, Some(true)));
}
#[test]
fn retained_package_remains_the_install_target_when_checks_or_replacement_downloads_fail() {
    let app = host();
    let verified = restored(test_updater(app.handle()), manifest()).unwrap();
    let mut newer = manifest();
    newer["version"] = json!("3.0.0");
    let candidate = restored(test_updater(app.handle()), newer).unwrap();
    let mut data = Data {
        verified: Some(verified),
        verified_bytes: 4,
        candidate: Some(candidate),
        check_retry: Retry::default(),
        download_retry: Retry::default(),
        discovery_needed: false,
    };
    data.download_retry.failed(1_000, false);
    let mut snapshot = Updates::new("1.0.0".into()).snapshot.into_inner().unwrap();
    for phase in [
        Phase::Checking,
        Phase::Downloading,
        Phase::CheckFailed,
        Phase::DownloadFailed,
    ] {
        data.present(
            &mut snapshot,
            phase,
            Some("native.updates.downloadFailed".into()),
        );
        let value = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(value["phase"], "ready");
        assert_eq!(value["availableVersion"], "2.0.0");
        assert_eq!(value["downloadedBytes"], 4);
        assert_eq!(value["error"], "native.updates.downloadFailed");
    }
    assert_eq!(data.candidate.as_ref().unwrap().version, "3.0.0");
    assert!(!data.due(2_000, Some(1_000), false, Some(true)));
    assert!(data.due(61_000, Some(1_000), false, Some(true)));
}
#[test]
fn host_reachability_accepts_cellular_and_does_not_require_wifi() {
    use system_configuration::network_reachability::ReachabilityFlags as Flags;
    assert!(reachable(Flags::REACHABLE | Flags::IS_WWAN));
    assert!(reachable(Flags::REACHABLE));
    assert!(!reachable(Flags::empty()));
    assert!(!reachable(Flags::REACHABLE | Flags::CONNECTION_REQUIRED));
}

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../tests/fixtures/updater/version-binding.json"
    ))
    .unwrap()
}
fn host() -> tauri::App<tauri::test::MockRuntime> {
    let key = STANDARD.encode(fixture()["publicKey"].as_str().unwrap());
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({"pubkey":"", "requireSignedVersion":true}),
    );
    tauri::test::mock_builder()
        .manage(Updates::new("1.0.0".into()))
        .manage(crate::ai::Ai::default())
        .manage(crate::plugin_host::Hosts::default())
        .plugin(tauri_plugin_updater::Builder::new().pubkey(key).build())
        .build(context)
        .unwrap()
}
fn test_updater(app: &tauri::AppHandle<tauri::test::MockRuntime>) -> Updater {
    app.updater_builder()
        .target("test-target")
        .executable_path("/tmp/Synthetic.app/Contents/MacOS/Synthetic")
        .endpoints(vec!["https://example.invalid/feed".parse().unwrap()])
        .unwrap()
        .configure_client(|_| panic!("Cached verification must not request the network"))
        .build()
        .unwrap()
}
fn manifest() -> Value {
    json!({"distribution":"direct","version":"2.0.0","platforms":{"test-target":{
        "url":"https://example.invalid/package","signature":STANDARD.encode(fixture()["signature"].as_str().unwrap())
    }}})
}

#[test]
fn native_host_restores_and_reverifies_signed_cache_without_network() {
    let app = host();
    let dir = tempfile::tempdir().unwrap();
    let cache = Cache::open(dir.path().into()).unwrap();
    let update = restored(test_updater(app.handle()), manifest()).unwrap();
    update.verify(b"test").unwrap();
    cache
        .retain(update.version, update.raw_json, b"test")
        .unwrap();
    drop(cache);
    let cache = Cache::open(dir.path().into()).unwrap();
    let record = cache.record().unwrap().unwrap();
    let update = restored(test_updater(app.handle()), record.release.clone()).unwrap();
    update.verify(&cache.read(&record).unwrap()).unwrap();
    assert!(update.verify(b"tampered").is_err());
    let mut inflated = manifest();
    inflated["version"] = json!("9.0.0");
    assert!(
        restored(test_updater(app.handle()), inflated)
            .unwrap()
            .verify(b"test")
            .is_err()
    );
    assert_eq!(
        cache.read(&cache.record().unwrap().unwrap()).unwrap(),
        b"test"
    );
}

#[test]
fn pending_download_damage_never_discards_a_verified_installable_package() {
    for damage in ["invalid-json", "unreadable", "unsafe-url"] {
        let app = host();
        let directory = tempfile::tempdir().unwrap();
        let cache = Cache::open(directory.path().into()).unwrap();
        let mut release = manifest();
        let target = release["platforms"]["test-target"].clone();
        for platform in ["darwin-aarch64", "darwin-x86_64"] {
            release["platforms"][platform] = target.clone();
        }
        cache.retain("2.0.0".into(), release, b"test").unwrap();
        let pending = directory.path().join("download.json");
        match damage {
            "invalid-json" => std::fs::write(&pending, b"{").unwrap(),
            "unreadable" => std::fs::create_dir(&pending).unwrap(),
            _ => {
                let mut release = manifest();
                release["version"] = json!("3.0.0");
                let mut target = target;
                target["url"] = json!("http://example.invalid/package");
                for platform in ["darwin-aarch64", "darwin-x86_64"] {
                    release["platforms"][platform] = target.clone();
                }
                cache.save_pending(&release).unwrap();
            }
        }
        let service = Native {
            cache,
            data: Mutex::new(Data {
                verified: None,
                verified_bytes: 0,
                candidate: None,
                check_retry: Retry::default(),
                download_retry: Retry::default(),
                discovery_needed: false,
            }),
            working: AtomicBool::new(false),
            disabled: AtomicBool::new(false),
            initialized: AtomicBool::new(false),
        };
        service.restore(app.handle()).unwrap();
        let record = service.cache.record().unwrap().unwrap();
        assert_eq!(record.version, "2.0.0");
        let data = service.data.lock().unwrap();
        let update = data.verified.as_ref().unwrap();
        update
            .verify(&service.cache.read(&record).unwrap())
            .unwrap();
        assert!(data.candidate.is_none());
        assert!(data.discovery_needed);
        let state = app.state::<Updates>();
        let snapshot = state.snapshot.lock().unwrap();
        assert!(matches!(snapshot.phase, Phase::Ready));
        assert_eq!(snapshot.available_version.as_deref(), Some("2.0.0"));
        assert_eq!(
            snapshot.error.as_deref(),
            Some("native.updates.cacheFailed")
        );
        assert!(
            data.confirmed(snapshot.artifact_id.as_ref().unwrap())
                .is_ok()
        );
    }
}

#[test]
fn confirmation_rejects_changes_to_version_signature_or_source() {
    let app = host();
    let verified = restored(test_updater(app.handle()), manifest()).unwrap();
    let id = artifact_id(&verified);
    let mut data = Data {
        verified: Some(verified.clone()),
        verified_bytes: 4,
        candidate: None,
        check_retry: Retry::default(),
        download_retry: Retry::default(),
        discovery_needed: false,
    };
    assert!(data.confirmed(&id).is_ok());
    for field in ["version", "signature", "source"] {
        let mut replacement = verified.clone();
        match field {
            "version" => replacement.version = "3.0.0".into(),
            "signature" => replacement.signature.push('x'),
            _ => replacement.download_url = "https://example.invalid/replacement".parse().unwrap(),
        }
        data.verified = Some(replacement);
        assert!(matches!(data.confirmed(&id), Err(error) if error == "native.updates.changed"));
    }
}

#[test]
fn native_host_rejects_external_and_unsafe_artifact_metadata() {
    let app = host();
    let mut external = manifest();
    external["distribution"] = json!("external");
    assert!(restored(test_updater(app.handle()), external).is_err());
    for url in [
        "http://example.invalid/package",
        "https://user:password@example.invalid/package",
        "file:///tmp/package",
    ] {
        let mut metadata = manifest();
        metadata["platforms"]["test-target"]["url"] = json!(url);
        assert!(restored(test_updater(app.handle()), metadata).is_err());
    }
    let mut stale = manifest();
    stale["version"] = json!("0.0.0");
    assert!(restored(test_updater(app.handle()), stale).is_err());
}

#[tokio::test]
async fn native_feed_deadline_includes_a_stalled_tls_handshake() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("https://{}/feed", listener.local_addr().unwrap())
        .parse()
        .unwrap();
    let client = secure_client(reqwest::Client::builder())
        .no_proxy()
        .build()
        .unwrap();
    let checked = tokio::spawn(async move { bounded_check(client, url).await });
    let (_socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
        .await
        .unwrap()
        .unwrap();
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(31)).await;
    let result = checked.await.unwrap();
    assert!(matches!(result, Err((ref key, _, "timeout")) if key == "native.updates.checkFailed"));
}

#[tokio::test]
async fn native_transport_refuses_plaintext_without_sending_a_request() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = secure_client(reqwest::Client::builder())
        .no_proxy()
        .build()
        .unwrap();
    let url = format!("http://{}/artifact", listener.local_addr().unwrap());
    assert!(client.get(url).send().await.is_err());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), listener.accept())
            .await
            .is_err()
    );
}
