use super::*;
#[derive(Default)]
struct Keys(Mutex<HashMap<String, Vec<u8>>>);
impl KeyStore for Keys {
    fn get(&self, account: &str) -> Result<Vec<u8>, String> {
        self.0
            .lock()
            .unwrap()
            .get(account)
            .cloned()
            .ok_or(ERROR.into())
    }
    fn set(&self, account: &str, key: &[u8]) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.into(), key.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}
fn temp() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}
fn credential_root() -> tempfile::TempDir {
    let root = temp();
    for id in ["demo", "other"] {
        std::fs::create_dir_all(root.path().join(".situate/plugins").join(id)).unwrap();
    }
    root
}
fn credentials(
    root: &Path,
    scope: &str,
    plugin: &str,
    request: Request,
    keys: &impl KeyStore,
) -> Result<Value, String> {
    super::credentials(root, scope, plugin, request, keys, &root.join("master"))
}
fn set(value: &str) -> Request {
    Request::CredentialSet {
        name: "service".into(),
        value: value.into(),
    }
}
fn get() -> Request {
    Request::CredentialGet {
        name: "service".into(),
    }
}
#[test]
fn credentials_are_encrypted_isolated_bounded_and_fail_closed() {
    let root = credential_root();
    let keys = Keys::default();
    assert_eq!(
        credentials(root.path(), "one", "demo", get(), &keys).unwrap_err(),
        "native.plugins.credentialMissing"
    );
    credentials(root.path(), "one", "demo", set("synthetic-value"), &keys).unwrap();
    assert_eq!(
        credentials(root.path(), "one", "demo", get(), &keys).unwrap(),
        json!("synthetic-value")
    );
    for (scope, plugin) in [("two", "demo"), ("one", "other")] {
        assert!(credentials(root.path(), scope, plugin, get(), &keys).is_err());
    }
    assert!(
        keys.0
            .lock()
            .unwrap()
            .keys()
            .all(|account| account.starts_with("plugin-"))
    );
    let envelope = root
        .path()
        .join(".situate/plugins/demo/.runtime/credentials.json");
    let before = std::fs::read(&envelope).unwrap();
    assert!(!String::from_utf8_lossy(&before).contains("synthetic-value"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&envelope).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert!(credentials(root.path(), "one", "demo", set(&"x".repeat(16_385)), &keys).is_err());
    assert_eq!(std::fs::read(&envelope).unwrap(), before);
    assert!(credentials(root.path(), "one", "demo", get(), &Keys::default()).is_err());
    assert_eq!(std::fs::read(&envelope).unwrap(), before);
    std::fs::write(&envelope, "corrupt").unwrap();
    for request in [
        get(),
        set("replacement"),
        Request::CredentialRemove {
            name: "service".into(),
        },
    ] {
        assert_eq!(
            credentials(root.path(), "one", "demo", request, &keys).unwrap_err(),
            ERROR
        );
        assert_eq!(std::fs::read(&envelope).unwrap(), b"corrupt");
    }
}
#[cfg(unix)]
#[test]
fn credential_symlinks_cannot_read_or_replace_another_store() {
    let root = credential_root();
    let outside = temp();
    let keys = Keys::default();
    let path = root.path().join(".situate/plugins/demo");
    std::fs::remove_dir_all(&path).unwrap();
    std::os::unix::fs::symlink(outside.path(), &path).unwrap();
    assert!(credentials(root.path(), "one", "demo", set("synthetic"), &keys).is_err());
    assert!(credentials(root.path(), "one", "demo", get(), &keys).is_err());
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    assert!(keys.0.lock().unwrap().is_empty());
}
#[test]
fn removing_one_credential_preserves_other_entries() {
    let root = credential_root();
    let keys = Keys::default();
    credentials(root.path(), "one", "demo", set("synthetic"), &keys).unwrap();
    credentials(
        root.path(),
        "one",
        "demo",
        Request::CredentialSet {
            name: "second".into(),
            value: "other".into(),
        },
        &keys,
    )
    .unwrap();
    credentials(
        root.path(),
        "one",
        "demo",
        Request::CredentialRemove {
            name: "service".into(),
        },
        &keys,
    )
    .unwrap();
    assert!(credentials(root.path(), "one", "demo", get(), &keys).is_err());
    assert_eq!(
        credentials(
            root.path(),
            "one",
            "demo",
            Request::CredentialGet {
                name: "second".into()
            },
            &keys
        )
        .unwrap(),
        json!("other")
    );
}
#[test]
fn legacy_credentials_migrate_durably_and_fresh_installations_do_not_inherit_them() {
    let root = credential_root();
    let keys = Keys::default();
    let legacy_base = root.path().join("legacy-credentials");
    let master_base = root.path().join("master");
    let (legacy_path, legacy_identity) = credential_location(&legacy_base, "one", "demo");
    private_directory(&legacy_path.join(".situate")).unwrap();
    let old = Storage::open(&legacy_path, &legacy_identity).unwrap();
    old.save(&keys, br#"{"service":"synthetic-secret"}"#)
        .unwrap();
    drop(old);
    let code = root.path().join(".situate/plugins/demo/code");
    std::fs::create_dir(&code).unwrap();
    std::fs::write(code.join("plugin.json"), json!({"schemaVersion":2,"id":"demo","name":"Demo","description":"Synthetic","serviceEntry":"entry.js"}).to_string()).unwrap();
    std::fs::write(code.join("entry.js"), "export default {};").unwrap();
    let package = situate_core::plugins::sources::snapshot(root.path(), "demo").unwrap();
    std::fs::write(
        root.path().join(".situate/plugin-state.json"),
        json!({
            "version":1,"generation":"00000000-0000-4000-8000-000000000001",
            "plugins":[{"id":"demo","enabled":false,"revision":package.revision}],
        })
        .to_string(),
    )
    .unwrap();
    situate_core::plugins::runtime::prepare(root.path()).unwrap();
    let pending = situate_core::plugins::credentials::pending_migration(root.path()).unwrap();
    assert_eq!(pending, vec!["demo"]);
    migrate_credentials(
        root.path(),
        "one",
        &pending,
        &legacy_base,
        &master_base,
        &keys,
    )
    .unwrap();
    assert!(!legacy_path.exists());
    assert!(
        situate_core::plugins::credentials::pending_migration(root.path())
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        credentials(root.path(), "one", "demo", get(), &keys).unwrap(),
        json!("synthetic-secret")
    );
    assert_eq!(keys.0.lock().unwrap().len(), 1);
    let envelope = std::fs::read(
        root.path()
            .join(".situate/plugins/demo/.runtime/credentials.json"),
    )
    .unwrap();
    assert!(!String::from_utf8_lossy(&envelope).contains("synthetic-secret"));
    std::fs::remove_dir_all(root.path().join(".situate/plugins/demo")).unwrap();
    assert!(credentials(root.path(), "one", "demo", set("late"), &keys).is_err());
    assert!(!root.path().join(".situate/plugins/demo").exists());
    std::fs::create_dir(root.path().join(".situate/plugins/demo")).unwrap();
    assert_eq!(
        credentials(root.path(), "one", "demo", get(), &keys).unwrap_err(),
        "native.plugins.credentialMissing"
    );
    assert_eq!(keys.0.lock().unwrap().len(), 1);
}

#[test]
fn damaged_owner_credentials_preserve_the_legacy_envelope_on_migration_failure() {
    let root = credential_root();
    let keys = Keys::default();
    let legacy_base = root.path().join("legacy-credentials");
    let (path, identity) = credential_location(&legacy_base, "one", "demo");
    private_directory(&path.join(".situate")).unwrap();
    Storage::open(&path, &identity)
        .unwrap()
        .save(&keys, br#"{"service":"keep"}"#)
        .unwrap();
    situate_core::plugins::folder::incarnation(root.path(), "demo").unwrap();
    std::fs::write(
        root.path()
            .join(".situate/plugins/demo/.runtime/credentials.json"),
        "corrupt",
    )
    .unwrap();
    assert!(
        migrate_credentials(
            root.path(),
            "one",
            &["demo".into()],
            &legacy_base,
            &root.path().join("master"),
            &keys
        )
        .is_err()
    );
    assert!(path.join(".situate/ai-connection.json").exists());
    assert_eq!(
        std::fs::read_to_string(
            root.path()
                .join(".situate/plugins/demo/.runtime/credentials.json")
        )
        .unwrap(),
        "corrupt"
    );
}

fn make_host(scope: &str) -> Arc<Host> {
    Arc::new(Host {
        incarnations: HashMap::new(),
        window: "window".into(),
        scope: scope.into(),
        plugin: "demo".into(),
        revisions: HashMap::new(),
        authorization: crate::workspaces::AuthorizationSession::for_test(),
        test_id: None,
        test_files: Arc::default(),
        test_keys: Arc::default(),
        responses: HashMap::new(),
        processes: Vec::new(),
        cancelled: CancellationToken::new(),
        requests: Mutex::default(),
    })
}
#[test]
fn stop_uses_captured_dependency_incarnations_across_windows_without_closing_hosts() {
    let hosts = Hosts::default();
    let mut first = make_host("workspace");
    let first_mut = Arc::get_mut(&mut first).unwrap();
    first_mut.plugin = "consumer".into();
    first_mut
        .incarnations
        .insert("connection".into(), "installation".into());
    first_mut
        .revisions
        .insert("connection".into(), Some("connection-revision".into()));
    let mut second = make_host("workspace");
    let second_mut = Arc::get_mut(&mut second).unwrap();
    second_mut.window = "second".into();
    second_mut.plugin = "indirect".into();
    second_mut
        .incarnations
        .insert("connection".into(), "installation".into());
    second_mut.revisions.insert(
        "connection".into(),
        Some("older-connection-revision".into()),
    );
    let unrelated = make_host("workspace");
    let mut other_scope = make_host("other-workspace");
    Arc::get_mut(&mut other_scope)
        .unwrap()
        .incarnations
        .insert("connection".into(), "installation".into());
    Arc::get_mut(&mut other_scope)
        .unwrap()
        .revisions
        .insert("connection".into(), None);
    let mut test_host = make_host("workspace");
    let test_mut = Arc::get_mut(&mut test_host).unwrap();
    test_mut.test_id = Some("check".into());
    test_mut
        .incarnations
        .insert("connection".into(), "installation".into());
    test_mut.revisions.insert("connection".into(), None);
    let mut replacement = make_host("workspace");
    Arc::get_mut(&mut replacement)
        .unwrap()
        .incarnations
        .insert("connection".into(), "replacement".into());
    let all = [
        &first,
        &second,
        &unrelated,
        &other_scope,
        &test_host,
        &replacement,
    ];
    let tokens: Vec<_> = all
        .iter()
        .map(|host| {
            hosts.insert((*host).clone()).unwrap();
            begin_request(host, "running").unwrap()
        })
        .collect();
    hosts
        .stop_affected(
            "workspace",
            &HashMap::from([("connection".into(), "installation".into())]),
        )
        .unwrap();
    assert_eq!(
        tokens
            .iter()
            .map(CancellationToken::is_cancelled)
            .collect::<Vec<_>>(),
        vec![true, true, false, false, false, false]
    );
    assert_eq!(hosts.0.lock().unwrap().len(), 6);
    for host in all {
        assert!(!host.cancelled.is_cancelled());
        assert!(!begin_request(host, "later").unwrap().is_cancelled());
    }
}

#[test]
fn process_close_admission_and_abort_are_scoped_without_invalidating_hosts() {
    let state = Arc::new(Processes::default());
    let host = make_host("one");
    let first = begin_request(&host, "process").unwrap();
    let process = state.admit("one", &first).unwrap();
    let other = CancellationToken::new();
    let other_process = state.admit("other", &other).unwrap();
    assert!(state.prepare_close("one").unwrap());
    assert!(!first.is_cancelled());
    assert!(!other.is_cancelled());
    assert!(state.admit("one", &CancellationToken::new()).is_err());
    state.resume("one");
    assert!(!first.is_cancelled());
    let later = state.admit("one", &CancellationToken::new()).unwrap();
    drop(later);
    let completions = state.abort("one").unwrap();
    assert!(first.is_cancelled());
    assert!(!host.cancelled.is_cancelled());
    assert!(!other.is_cancelled());
    assert_eq!(completions.len(), 1);
    assert!(!completions[0].is_cancelled());
    assert!(state.has_active().unwrap());
    drop(process);
    assert!(completions[0].is_cancelled());
    state.resume("one");
    let next = begin_request(&host, "next").unwrap();
    let process = state.admit("one", &next).unwrap();
    assert!(!next.is_cancelled());
    drop(process);
    drop(other_process);
    assert!(!state.has_active().unwrap());
    assert!(!state.prepare_close("idle").unwrap());
    assert!(state.admit("idle", &CancellationToken::new()).is_err());
    state.resume("idle");
}

#[cfg(target_os = "macos")]
#[test]
fn close_decisions_do_not_wait_for_content_lock_or_abort_until_explicitly_requested() {
    let root = temp();
    std::fs::create_dir(root.path().join(".situate")).unwrap();
    let files = Arc::new(crate::files::Session::default());
    let state = Arc::new(Processes::default());
    let token = CancellationToken::new();
    let lease = state.admit("one", &token).unwrap();
    let command = crate::shell_host::CommandRequest {
        cwd: root.path().to_owned(),
        executable: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            "printf ready > ready.txt; /bin/sleep 30; printf late > late.txt".into(),
        ],
        timeout_ms: 30_000,
        output_limit_bytes: 32_768,
    };
    let worker_files = files.clone();
    let worker_token = token.clone();
    let (send, receive) = std::sync::mpsc::channel();
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let reply =
            crate::files::execute_test_process(&worker_files, command, worker_token).unwrap();
        drop(lease);
        send.send(reply).unwrap();
    });
    drop(worker);
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::fs::read(root.path().join("ready.txt")).ok().as_deref() != Some(b"ready") {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    // These checks must complete while execution retains the content mutation window.
    assert!(state.prepare_close("one").unwrap());
    assert!(state.has_active().unwrap());
    assert!(!token.is_cancelled());
    state.resume("one");
    assert!(!token.is_cancelled());
    assert!(receive.try_recv().is_err());
    let completions = state.abort("one").unwrap();
    tauri::async_runtime::block_on(async {
        for completed in completions {
            tokio::time::timeout(Duration::from_secs(10), completed.cancelled())
                .await
                .unwrap();
        }
    });
    let reply = receive.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(reply["commandResult"]["Ok"]["outcome"], "cancelled");
    assert!(!state.has_active().unwrap());
    assert!(!root.path().join("late.txt").exists());
    crate::files::complete_close(&files);
    let store = situate_core::content::ContentStore::open(root.path()).unwrap();
    assert_eq!(
        store
            .read_revision("ready.txt", reply["afterHistoryRevision"].as_str().unwrap())
            .unwrap(),
        b"ready"
    );
}

#[test]
fn cancellation_before_admission_never_starts_work_and_tracking_is_bounded() {
    let host = make_host("one");
    cancel_request(&host, "queued".into()).unwrap();
    assert_eq!(begin_request(&host, "queued").unwrap_err(), CANCELLED);
    let token = begin_request(&host, "running").unwrap();
    cancel_request(&host, "running".into()).unwrap();
    assert!(token.is_cancelled());
    for i in 0..33 {
        cancel_request(&host, format!("unknown-{i}")).unwrap();
    }
    assert!(host.requests.lock().unwrap().len() <= 32);
    assert!(host.cancelled.is_cancelled());
    assert_eq!(begin_request(&host, "late").unwrap_err(), CANCELLED);
}
#[tokio::test]
async fn dropped_frontend_wait_does_not_release_native_request_tracking_early() {
    let host = make_host("scope");
    begin_request(&host, "running").unwrap();
    let cleanup = RequestCleanup {
        host: host.clone(),
        id: "running".into(),
    };
    let (started, observed) = tokio::sync::oneshot::channel();
    let (finish, finished) = std::sync::mpsc::channel();
    let (done, completed) = tokio::sync::oneshot::channel();
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let cleanup = cleanup;
        started.send(()).unwrap();
        finished.recv().unwrap();
        drop(cleanup);
        done.send(()).unwrap();
    });
    observed.await.unwrap();
    drop(worker);
    assert!(host.requests.lock().unwrap().contains_key("running"));
    finish.send(()).unwrap();
    completed.await.unwrap();
    assert!(!host.requests.lock().unwrap().contains_key("running"));
}

#[test]
fn closed_scopes_release_handles_and_cancel_requests_without_exhausting_capacity() {
    let state = Hosts::default();
    let other = make_host("other");
    state.insert(other.clone()).unwrap();
    for _ in 0..256 {
        let host = make_host("closed");
        let request = host.cancelled.child_token();
        let id = state.insert(host).unwrap();
        state.invalidate_scope("closed");
        assert!(request.is_cancelled());
        assert!(!state.0.lock().unwrap().contains_key(&id));
        assert_eq!(state.0.lock().unwrap().len(), 1);
        assert!(!other.cancelled.is_cancelled());
    }
}
#[test]
fn recovery_and_disabled_plugins_are_denied_before_operations() {
    let root = temp();
    assert_eq!(
        authorize_plugin(root.path(), "demo", true).unwrap_err(),
        "native.plugins.recoveryBlocked"
    );
    std::fs::create_dir(root.path().join(".situate")).unwrap();
    assert_eq!(
        authorize_plugin(root.path(), "demo", false).unwrap_err(),
        "native.plugins.disabled"
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    let host = make_host("one");
    let token = host.cancelled.child_token();
    host.cancelled.cancel();
    assert_eq!(active(&host, &token).unwrap_err(), CANCELLED);
}
#[test]
fn host_paths_cannot_reach_technical_state() {
    for path in [
        "../outside",
        "/outside",
        "a//b",
        "a/../b",
        "a\\b",
        ".situate/ai-connection.json",
    ] {
        assert!(file_path(path).is_err());
    }
}
#[test]
fn closed_reopened_and_foreign_sessions_do_not_start_host_mutations() {
    use crate::workspaces::{TestSessionChange, with_test_authorized_root};
    let root = temp();
    std::fs::write(root.path().join("untouched.txt"), "original").unwrap();
    let location = Location {
        id: "one".into(),
        name: "One".into(),
        display: "One".into(),
        kind: "path".into(),
        handle: root.path().to_string_lossy().into_owned(),
    };
    for (window, scope, change) in [
        ("other", "one", TestSessionChange::None),
        ("window", "two", TestSessionChange::None),
        ("window", "one", TestSessionChange::Close),
        ("window", "one", TestSessionChange::Reopen),
    ] {
        assert!(
            with_test_authorized_root::<()>(
                &[("window", location.clone())],
                window,
                scope,
                true,
                change,
                |_| {
                    panic!("stale host reached mutation");
                }
            )
            .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("untouched.txt")).unwrap(),
            "original"
        );
    }
}
#[test]
fn file_queries_deserialize_the_direct_read_only_contract() {
    let list: Request =
        serde_json::from_value(json!({"operation":"filesList","query":{}})).unwrap();
    assert!(
        matches!(list, Request::FilesList { query } if query.roots.is_none() && query.extensions.is_none())
    );
    let search: Request = serde_json::from_value(json!({
        "operation":"filesSearch", "query":{"roots":["notes"],"extensions":[".MD"],"text":"literal.*"}
    })).unwrap();
    assert!(
        matches!(search, Request::FilesSearch { query } if query.text == "literal.*" && query.roots == Some(vec!["notes".into()]) && query.extensions == Some(vec![".MD".into()]))
    );
    let read: Request =
        serde_json::from_value(json!({"operation":"filesReadMany","paths":["b.md","a.md"]}))
            .unwrap();
    assert!(matches!(read, Request::FilesReadMany { paths } if paths == ["b.md", "a.md"]));
    for invalid in [
        json!({"operation":"filesList"}),
        json!({"operation":"filesList","query":{"text":"wrong operation"}}),
        json!({"operation":"filesSearch","query":{}}),
        json!({"operation":"filesSearch","query":{"text":"x","limit":1}}),
        json!({"operation":"filesReadMany"}),
        json!({"operation":"filesReadMany","paths":[],"area":"config"}),
    ] {
        assert!(serde_json::from_value::<Request>(invalid).is_err());
    }
}

#[test]
fn file_queries_recheck_session_lifecycle_and_cancellation_after_work() {
    use std::sync::atomic::Ordering;
    let host = make_host("scope");
    for close in [true, false] {
        let files = crate::files::Session::default();
        let token = CancellationToken::new();
        let result = file_query(&host, &files, &token, || {
            if close {
                files.close_ready.store(true, Ordering::Release);
            } else {
                files.detached.store(true, Ordering::Release);
            }
            Ok(vec!["stale result"])
        });
        assert_eq!(
            result.unwrap_err(),
            if close {
                "native.files.workspace.closing"
            } else {
                "native.files.editor.closed"
            }
        );
        assert!(
            file_query(&host, &files, &token, || -> Result<(), String> {
                panic!("closed session reached filesystem")
            })
            .is_err()
        );
    }
    let files = crate::files::Session::default();
    let token = CancellationToken::new();
    assert_eq!(
        file_query(&host, &files, &token, || {
            token.cancel();
            Ok("stale result")
        })
        .unwrap_err(),
        CANCELLED
    );
    assert_eq!(
        file_query(&host, &files, &CancellationToken::new(), || {
            host.cancelled.cancel();
            Ok("stale result")
        })
        .unwrap_err(),
        CANCELLED
    );
}

#[test]
fn requests_require_explicit_revision_and_validate_http_destinations() {
    assert!(
        serde_json::from_value::<Request>(
            json!({"operation":"write","area":"files","path":"note.txt","text":"new"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<Request>(
            json!({"operation":"http","url":"https://example.invalid","approved":true})
        )
        .is_err()
    );
    tauri::async_runtime::block_on(async {
        let token = CancellationToken::new();
        for url in [
            "file:///tmp/example",
            "https://synthetic:private@example.invalid",
            "https://example.invalid/#fragment",
        ] {
            assert_eq!(
                http(url.into(), None, BTreeMap::new(), None, &token)
                    .await
                    .unwrap_err(),
                ERROR
            );
        }
        token.cancel();
        assert_eq!(
            http(
                "https://example.invalid".into(),
                None,
                BTreeMap::new(),
                None,
                &token
            )
            .await
            .unwrap_err(),
            CANCELLED
        );
    });
}

#[test]
fn http_write_methods_execute_once_without_an_execution_decision() {
    tauri::async_runtime::block_on(async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = async {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                loop {
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert_ne!(count, 0);
                    request.extend_from_slice(&buffer[..count]);
                    assert!(request.len() < 8192);
                    if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n")
                        && request.len() >= end + 4 + 2
                    {
                        break;
                    }
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with(&format!("{method} /effect HTTP/1.1\r\n")));
                assert!(request.ends_with("{}"));
                stream
                    .write_all(
                        b"HTTP/1.1 201 Created\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    )
                    .await
                    .unwrap();
                request
            };
            let token = CancellationToken::new();
            let (observed, result) = tokio::join!(
                tokio::time::timeout(std::time::Duration::from_secs(5), server),
                http(
                    format!("http://{address}/effect"),
                    Some(method.into()),
                    BTreeMap::new(),
                    Some("{}".into()),
                    &token
                )
            );
            observed.unwrap();
            assert_eq!(result.unwrap(), json!({"status":201,"body":"ok"}));
        }
    });
}

#[test]
fn process_requests_execute_directly_and_reject_forged_fields() {
    let unavailable = process_capability(false, false);
    assert!(!unavailable.available);
    let synthetic = process_capability(true, false);
    assert!(synthetic.available);
    assert_eq!(synthetic.implementation, "syntheticProcess");
    assert_eq!(synthetic.ownership, "none");
    assert_eq!(
        synthetic.interpreter,
        crate::shell_host::capability().interpreter
    );
    assert!(!synthetic.detached_descendants_contained);
    assert_eq!(synthetic.max_output_bytes_per_stream, 32_768);
    assert_eq!(synthetic.max_timeout_ms, 300_000);
    let valid = json!({"operation":"process","executable":"/usr/bin/tool"});
    let Request::Process {
        args, timeout_ms, ..
    } = serde_json::from_value(valid.clone()).unwrap()
    else {
        panic!()
    };
    assert!(args.is_empty());
    assert_eq!(timeout_ms, None);
    assert!(serde_json::from_value::<Request>(json!({"operation":"processCapability"})).is_ok());
    assert!(
        serde_json::from_value::<Request>(json!({"operation":"processCapability","cwd":"/tmp"}))
            .is_err()
    );
    for (key, value) in [
        ("cwd", json!("/tmp")),
        ("env", json!({})),
        ("command", json!("echo")),
        ("approved", Value::Null),
        ("approved", json!(true)),
        ("approved", json!(false)),
        ("approved", json!("true")),
        ("args", json!("one")),
        ("args", json!([1])),
        ("timeoutMs", json!(-1)),
        ("timeoutMs", json!(1.5)),
    ] {
        let mut forged = valid.clone();
        forged[key] = value;
        assert!(serde_json::from_value::<Request>(forged).is_err(), "{key}");
    }
    for (executable, args, timeout) in [
        ("relative", vec![], 30_000),
        ("/tool\0", vec![], 30_000),
        ("/tool", vec!["\0".into()], 30_000),
        ("/tool", vec!["x".into(); 257], 30_000),
        ("/tool", vec!["x".repeat(65_537)], 30_000),
        ("/tool", vec![], 0),
        ("/tool", vec![], 300_001),
    ] {
        assert!(crate::files::validate_process(executable, &args, timeout).is_err());
    }
    assert!(crate::files::validate_process(&format!("/{}", "x".repeat(4096)), &[], 1).is_err());
    assert!(crate::files::validate_process("/tool", &vec!["x".repeat(256); 256], 300_000).is_ok());
}

#[cfg(target_os = "macos")]
#[test]
fn synthetic_shell_connections_use_declared_interpreter_with_offline_fixtures() {
    let capability = process_capability(true, true);
    assert!(capability.available);
    assert_eq!(capability.implementation, "syntheticProcess");
    assert_eq!(capability.ownership, "none");
    assert_eq!(capability.interpreter, Some("/bin/sh"));
    assert_eq!(capability.interpreter_dialect, Some("posixSh"));
    assert_eq!(capability.interpreter_args, ["-c"]);
    let executable = capability.interpreter.unwrap();
    let args: Vec<String> = capability
        .interpreter_args
        .iter()
        .map(|arg| (*arg).to_owned())
        .chain(["exit 19".into()])
        .collect();
    let fixture = crate::plugin_checks::ProcessFixture {
        executable: executable.into(),
        args: Some(args.clone()),
        exit_code: 0,
        stdout: "offline shell result".into(),
        stderr: String::new(),
    };
    let reply = synthetic_process(&[fixture], executable, &args).unwrap();
    assert_eq!(reply["isError"], false);
    assert_eq!(reply["commandResult"]["Ok"]["exitCode"], 0);
    assert_eq!(
        reply["commandResult"]["Ok"]["stdout"]["text"],
        "offline shell result"
    );
    assert_eq!(
        synthetic_process(&[], executable, &args).unwrap_err(),
        "native.plugins.testProcessBlocked"
    );
}

#[test]
fn synthetic_processes_match_only_exact_argv_and_return_shell_wire_shape_offline() {
    let fixture: crate::plugin_checks::ProcessFixture = serde_json::from_value(json!({
        "executable":"/not-installed/synthetic-tool", "args":["a b", ";exit"],
        "exitCode":7, "stdout":"synthetic output", "stderr":"synthetic error"
    }))
    .unwrap();
    crate::plugin_checks::validate_processes(std::slice::from_ref(&fixture)).unwrap();
    let first = vec![fixture];
    let reply = synthetic_process(
        &first,
        "/not-installed/synthetic-tool",
        &["a b".into(), ";exit".into()],
    )
    .unwrap();
    assert_eq!(
        reply,
        json!({
            "isError":true,
            "commandResult":{"Ok":{"outcome":"exited","exitCode":7,"signal":null,
                "stdout":{"text":"synthetic output","capturedBytes":16,"totalBytes":16,"truncated":false,"incomplete":false},
                "stderr":{"text":"synthetic error","capturedBytes":15,"totalBytes":15,"truncated":false,"incomplete":false}}},
            "beforeHistoryRevision":null,"afterHistoryRevision":null,"reconciliationError":null,
            "attribution":"uncertainExternalChangesMayCoexist"
        })
    );
    for (executable, args) in [
        ("/not-installed/synthetic-tool", vec![]),
        (
            "/not-installed/synthetic-tool",
            vec!["a".into(), "b".into(), ";exit".into()],
        ),
        (
            "/not-installed/other-tool",
            vec!["a b".into(), ";exit".into()],
        ),
    ] {
        assert_eq!(
            synthetic_process(&first, executable, &args).unwrap_err(),
            "native.plugins.testProcessBlocked"
        );
    }
    assert!(
        synthetic_process(
            &[],
            "/not-installed/synthetic-tool",
            &["a b".into(), ";exit".into()]
        )
        .is_err()
    );
    let mut second = first.clone();
    second[0].exit_code = 0;
    second[0].stdout = "other session".into();
    let reply = synthetic_process(
        &second,
        "/not-installed/synthetic-tool",
        &["a b".into(), ";exit".into()],
    )
    .unwrap();
    assert_eq!(reply["isError"], false);
    assert_eq!(
        reply["commandResult"]["Ok"]["stdout"]["text"],
        "other session"
    );
}
