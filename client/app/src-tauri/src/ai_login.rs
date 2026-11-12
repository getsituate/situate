use super::*;
use crate::openai_oauth as oauth;
use std::sync::Arc;
use tokio::sync::watch;

#[path = "ai_codex_login.rs"]
pub mod codex;
#[cfg(feature = "native-smoke")]
#[path = "../tests/support/ai_login_smoke.rs"]
pub(crate) mod smoke;

pub struct Login {
    id: String,
    session: crate::workspaces::AuthorizationSession,
    cancel: CancellationToken,
    result: watch::Sender<Option<Result<Status, String>>>,
    // Cancellation and the start of the durable write have one ordering point.
    committing: Mutex<bool>,
    browser_url: Mutex<Option<String>>,
}
impl Login {
    fn pending(&self) -> bool {
        self.result.borrow().is_none()
    }
    fn cancel(&self) {
        if let Ok(committing) = self.committing.lock()
            && !*committing
        {
            self.cancel.cancel();
        }
    }
    fn commit(&self) -> Result<(), String> {
        let mut committing = self.committing.lock().map_err(|_| oauth::ERROR)?;
        if self.cancel.is_cancelled() {
            return Err(oauth::CANCELLED.into());
        }
        *committing = true;
        Ok(())
    }
    async fn wait(&self) -> Result<Status, String> {
        let mut receiver = self.result.subscribe();
        loop {
            if let Some(result) = receiver.borrow_and_update().clone() {
                return result;
            }
            receiver.changed().await.map_err(|_| oauth::ERROR)?;
        }
    }
}
pub fn ensure_idle(app: &tauri::AppHandle, scope: &str) -> Result<(), String> {
    if app
        .state::<Ai>()
        .logins
        .lock()
        .map_err(|_| oauth::ERROR)?
        .get(scope)
        .is_some_and(|login| login.pending())
    {
        return Err("native.ai.login.pending".into());
    }
    Ok(())
}
pub fn prepare_close(app: &tauri::AppHandle, scope: &str, window: &str) -> Result<bool, String> {
    let state = app.state::<Ai>();
    let logins = state.logins.lock().map_err(|_| oauth::ERROR)?;
    if let Some(login) = logins.get(scope).filter(|login| login.pending()) {
        state
            .closing
            .lock()
            .map_err(|_| oauth::ERROR)?
            .insert(scope.into());
        login.cancel();
        let _ = app.emit_to(window, "ai-login-close-requested", ());
        return Ok(false);
    }
    Ok(true)
}
pub(super) fn has_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<bool, String> {
    Ok(app
        .state::<Ai>()
        .logins
        .lock()
        .map_err(|_| oauth::ERROR)?
        .values()
        .any(|login| login.pending()))
}
pub fn ensure_quit(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Ai>();
    let logins = state.logins.lock().map_err(|_| oauth::ERROR)?;
    if logins.values().any(|login| login.pending()) {
        for login in logins.values() {
            login.cancel();
        }
        let message = "native.ai.login.finishing";
        let _ = app.emit("ai-quit-blocked", message);
        return Err(message.into());
    }
    Ok(())
}
pub(super) async fn stop_scope(app: &tauri::AppHandle, scope: &str) -> Result<(), String> {
    let login = app
        .state::<Ai>()
        .logins
        .lock()
        .map_err(|_| oauth::ERROR)?
        .get(scope)
        .cloned();
    if let Some(login) = login {
        login.cancel();
        let _ = login.wait().await;
        if login.pending() {
            return Err(oauth::ERROR.into());
        }
    }
    Ok(())
}

pub fn abort_all(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Ai>()
        && let Ok(logins) = state.logins.lock()
    {
        for login in logins.values() {
            login.cancel();
        }
    }
}
fn scoped(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    id: &str,
) -> Result<Option<Arc<Login>>, String> {
    let login = app
        .state::<Ai>()
        .logins
        .lock()
        .map_err(|_| oauth::ERROR)?
        .get(scope)
        .filter(|login| login.id == id)
        .cloned();
    if let Some(login) = &login {
        crate::workspaces::with_authorization_session(app, window, &login.session, |_| Ok(()))?;
    }
    Ok(login)
}
fn begin(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
) -> Result<(situate_core::workspaces::Location, Arc<Login>), String> {
    let session = crate::workspaces::authorization_session(app, window, scope)?;
    crate::workspaces::with_authorization_session(app, window, &session, |location| {
        super::ensure_idle(app, scope)?;
        let state = app.state::<Ai>();
        if state
            .closing
            .lock()
            .map_err(|_| oauth::ERROR)?
            .contains(scope)
        {
            return Err("native.ai.login.closing".into());
        }
        let login = Arc::new(Login {
            id: uuid::Uuid::new_v4().to_string(),
            session: session.clone(),
            cancel: CancellationToken::new(),
            result: watch::channel(None).0,
            committing: Mutex::new(false),
            browser_url: Mutex::new(None),
        });
        state
            .logins
            .lock()
            .map_err(|_| oauth::ERROR)?
            .insert(scope.to_owned(), login.clone());
        Ok((location.clone(), login))
    })
}

#[tauri::command]
pub async fn ai_openai_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: Option<String>,
    label: Option<String>,
    diagnostic: Option<serde_json::Value>,
) -> Result<String, String> {
    let config = Config {
        connection_id,
        label,
        http_acknowledgement: None,
        provider: "openai".into(),
        legacy_model: None,
        endpoint: None,
        auth: Some(AuthKind::Oauth),
    };
    let diagnostic = crate::diagnostics::Operation::begin(
        &app,
        window.label(),
        &scope,
        crate::diagnostics::OperationKind::OpenAiLogin,
        diagnostic.and_then(crate::diagnostics::parse_context),
    );
    oauth::checkpoint(diagnostic.as_ref(), "admission");
    let (location, login) =
        match model::validate_config(&config).and_then(|_| begin(&app, window.label(), &scope)) {
            Ok(started) => started,
            Err(error) => {
                if let Some(operation) = diagnostic {
                    operation.result::<()>(&Err(error.clone()));
                }
                return Err(error);
            }
        };
    let id = login.id.clone();
    let observer = login.clone();
    let worker = tauri::async_runtime::spawn(async move {
        let result = run(
            &app,
            window.label(),
            &scope,
            location,
            config,
            &login,
            diagnostic.as_ref(),
        )
        .await;
        finish_login(
            &login,
            result,
            crate::provider_platform::finish_auth_browser(&app, &login.id),
            diagnostic,
        )
        .await;
    });
    observe_login(observer, worker);
    Ok(id)
}

fn observe_login(login: Arc<Login>, worker: tauri::async_runtime::JoinHandle<()>) {
    tauri::async_runtime::spawn(async move {
        if worker.await.is_err() {
            if let Ok(mut url) = login.browser_url.lock() {
                *url = None;
            }
            // The worker's operation guard owns the panic or interruption record.
            login.result.send_replace(Some(Err(oauth::ERROR.into())));
        }
    });
}
#[tauri::command]
pub async fn ai_openai_wait(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    id: String,
) -> Result<Status, String> {
    scoped(&app, window.label(), &scope, &id)?
        .ok_or("native.ai.login.inactive")?
        .wait()
        .await
}
#[tauri::command]
pub async fn ai_openai_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    id: String,
) -> Result<(), String> {
    if let Some(login) = scoped(&app, window.label(), &scope, &id)? {
        login.cancel();
        let _ = login.wait().await;
    }
    Ok(())
}
async fn finish_login(
    login: &Login,
    result: Result<Status, String>,
    cleanup: impl std::future::Future<Output = Result<(), String>>,
    diagnostic: Option<crate::diagnostics::Operation>,
) {
    oauth::checkpoint(diagnostic.as_ref(), "cleanup");
    if cleanup.await.is_err() {
        // A browser cleanup failure must not report a durably saved connection as failed.
        oauth::diagnostic_error(diagnostic.as_ref(), "cleanup", "browser_cleanup");
    }
    if let Some(operation) = diagnostic {
        operation.result(&result);
    }
    login.result.send_replace(Some(result));
}

async fn browser_closed(
    exit: Option<tokio::sync::oneshot::Receiver<crate::provider_platform::AuthBrowserExit>>,
) -> String {
    use crate::provider_platform::AuthBrowserExit;
    match exit {
        Some(exit) => match exit.await {
            Ok(AuthBrowserExit::Cancelled) => oauth::CANCELLED.into(),
            Ok(AuthBrowserExit::Failed) | Err(_) => "native.ai.browser.openFailed".into(),
        },
        None => std::future::pending().await,
    }
}

async fn run(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    location: situate_core::workspaces::Location,
    config: Config,
    login: &Arc<Login>,
    diagnostic: oauth::Trace<'_>,
) -> Result<Status, String> {
    if login.cancel.is_cancelled() {
        return Err(oauth::CANCELLED.into());
    }
    oauth::checkpoint(diagnostic, "prepare");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "native.ai.login.portBusy".to_owned())?;
    let app_data = app.path().app_data_dir().map_err(|_| oauth::ERROR)?;
    let language = crate::localization::language(app, &location);
    let port = listener.local_addr().map_err(|_| oauth::ERROR)?.port();
    let preparation_app = app.clone();
    let preparation = tauri::async_runtime::spawn_blocking(move || {
        let storage = storage(&preparation_app, &location)?;
        let lock = storage.lock_credentials()?;
        let (config, replacing) = connections::prepare_config(&storage, config)?;
        let previous = if replacing {
            storage
                .load_connection(
                    &OsKeys(preparation_app),
                    config.connection_id.as_deref().ok_or(KEY_ERROR)?,
                )?
                .map(|bytes| previous_credential(&bytes))
                .transpose()?
                .flatten()
        } else {
            None
        };
        let device = device_id(&app_data)?;
        Ok::<_, String>((storage, lock, device, previous, config, replacing))
    });
    let (storage, lock, device, previous, config, replacing) =
        finish_preparation(preparation, &login.cancel, deadline, diagnostic).await?;
    let authorization = oauth::Authorization::new(previous, port);
    oauth::checkpoint(diagnostic, "browser_open");
    let browser =
        crate::provider_platform::open_auth_browser(app, &authorization.url(device), &login.id)
            .await?;
    let mut browser_response = None;
    let operation = async {
        oauth::checkpoint(diagnostic, "callback_wait");
        let (callback, response) = authorization.listen(listener, language).await?;
        browser_response = Some(response);
        oauth::checkpoint(diagnostic, "callback_received");
        let credential = authorization
            .exchange(callback, &login.cancel, diagnostic)
            .await?;
        Ok::<_, String>((storage, lock, credential))
    };
    let (storage, lock, credential) = tokio::select! {
        biased;
        _ = login.cancel.cancelled() => return Err(oauth::CANCELLED.into()),
        error = browser_closed(browser) => return Err(error),
        result = tokio::time::timeout_at(deadline, operation) => result.map_err(|_| "native.ai.login.timeout".to_owned())??,
    };
    // The lease prevents closure/replacement while this worker owns the save.
    crate::workspaces::with_authorization_session(app, window, &login.session, |_| {
        if app
            .state::<Ai>()
            .closing
            .lock()
            .map_err(|_| oauth::ERROR)?
            .contains(scope)
        {
            return Err(oauth::CANCELLED.into());
        }
        login.commit()
    })?;
    oauth::checkpoint(diagnostic, "persist_connection");
    let save_app = app.clone();
    let status = observe_login_join(
        tauri::async_runtime::spawn_blocking(move || {
            let _lock = lock;
            let mut connection = Connection {
                catalog: None,
                config,
                key: String::new(),
                oauth: Some(credential),
                codex: None,
            };
            connections::save(&storage, &save_app, &connection, replacing)?;
            discovery::finish_setup(&storage, &save_app, &mut connection)
        })
        .await,
        diagnostic,
    )
    .map_err(|_| KEY_ERROR)??;
    oauth::checkpoint(diagnostic, "connection_ready");
    app.state::<Ai>().clear_rejected(
        scope,
        status
            .config
            .as_ref()
            .and_then(|config| config.connection_id.as_deref()),
    )?;
    if let Some(response) = browser_response {
        response
            .complete(
                status.available && status.selected_model.is_some() && status.model_error.is_none(),
            )
            .await;
    }
    Ok(status)
}
fn observe_login_join<T>(
    result: tauri::Result<T>,
    diagnostic: oauth::Trace<'_>,
) -> tauri::Result<T> {
    if let Some(diagnostic) = diagnostic {
        diagnostic.observe_join(&result);
    }
    result
}

async fn finish_preparation<T: Send + 'static>(
    mut task: tauri::async_runtime::JoinHandle<Result<T, String>>,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
    diagnostic: oauth::Trace<'_>,
) -> Result<T, String> {
    // Blocking filesystem work cannot be aborted; retain the login lease until its resources drop.
    tokio::select! {
        biased;
        _ = cancel.cancelled() => { let _ = observe_login_join(task.await, diagnostic); Err(oauth::CANCELLED.into()) },
        _ = tokio::time::sleep_until(deadline) => { let _ = observe_login_join(task.await, diagnostic); Err("native.ai.login.timeout".into()) },
        result = &mut task => {
            let value = observe_login_join(result, diagnostic).map_err(|_| oauth::ERROR.to_owned())??;
            if cancel.is_cancelled() { return Err(oauth::CANCELLED.into()); }
            if tokio::time::Instant::now() >= deadline { return Err("native.ai.login.timeout".into()); }
            Ok(value)
        },
    }
}

fn previous_credential(bytes: &[u8]) -> Result<Option<oauth::Credential>, String> {
    let invalid = "native.ai.login.savedIdentityInvalid";
    let connection = decode_connection(bytes).map_err(|_| invalid)?;
    let browser = connection.config.auth == Some(AuthKind::Oauth);
    if browser != connection.oauth.is_some() || connection.codex.is_some() {
        return Err(invalid.into());
    }
    let Some(credential) = connection.oauth else {
        return Ok(None);
    };
    if connection.config.provider != "openai"
        || credential.subject.trim().is_empty()
        || credential.client_id.trim().is_empty()
    {
        return Err(invalid.into());
    }
    Ok(Some(credential))
}

fn device_id(directory: &Path) -> Result<uuid::Uuid, String> {
    use std::io::Write;
    std::fs::create_dir_all(directory).map_err(|_| oauth::ERROR)?;
    let path = directory.join("openai-agent-host-id");
    match std::fs::read_to_string(&path) {
        Ok(value) => uuid::Uuid::parse_str(value.trim()).map_err(|_| oauth::ERROR.into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let id = uuid::Uuid::new_v4();
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|_| oauth::ERROR)?;
            file.write_all(id.to_string().as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|_| oauth::ERROR)?;
            Ok(id)
        }
        Err(_) => Err(oauth::ERROR.into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn login() -> Login {
        Login {
            id: "test-attempt".into(),
            session: crate::workspaces::AuthorizationSession::for_test(),
            cancel: CancellationToken::new(),
            result: watch::channel(None).0,
            committing: Mutex::new(false),
            browser_url: Mutex::new(None),
        }
    }
    #[tokio::test]
    async fn login_supervisor_releases_waiters_after_worker_panic_or_abort() {
        const CHILD: &str = "SITUATE_LOGIN_OBSERVER_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "login_supervisor_releases_waiters_after_worker_panic_or_abort",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .status()
                .unwrap();
            assert!(status.success());
            return;
        }
        for aborted in [false, true] {
            let login = Arc::new(login());
            *login.browser_url.lock().unwrap() = Some("https://synthetic.invalid".into());
            let (entered, ready) = tokio::sync::oneshot::channel();
            let worker = tauri::async_runtime::spawn(async move {
                entered.send(()).unwrap();
                if aborted {
                    std::future::pending::<()>().await;
                }
                panic!("PRIVATE_LOGIN_PANIC_SENTINEL");
            });
            ready.await.unwrap();
            if aborted {
                worker.abort();
            }
            observe_login(login.clone(), worker);
            let result = tokio::time::timeout(Duration::from_secs(2), login.wait())
                .await
                .unwrap();
            assert_eq!(result.err().unwrap(), oauth::ERROR);
            assert!(!login.pending());
            assert!(login.browser_url.lock().unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn login_supervisor_preserves_requested_cancellation() {
        let login = Arc::new(login());
        let pending = login.clone();
        let worker = tauri::async_runtime::spawn(async move {
            pending
                .result
                .send_replace(Some(Err(oauth::CANCELLED.into())));
        });
        observe_login(login.clone(), worker);
        let result = tokio::time::timeout(Duration::from_secs(2), login.wait())
            .await
            .unwrap();
        assert_eq!(result.err().unwrap(), oauth::CANCELLED);
    }

    #[tokio::test]
    async fn browser_dismissal_is_never_authentication_success() {
        use crate::provider_platform::AuthBrowserExit;
        for (event, expected) in [
            (AuthBrowserExit::Cancelled, oauth::CANCELLED),
            (AuthBrowserExit::Failed, "native.ai.browser.openFailed"),
        ] {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            assert!(sender.send(event).is_ok());
            assert_eq!(browser_closed(Some(receiver)).await, expected);
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        drop(sender);
        assert_eq!(
            browser_closed(Some(receiver)).await,
            "native.ai.browser.openFailed"
        );
        assert!(
            futures_util::future::poll_immediate(browser_closed(None))
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn browser_cleanup_retains_the_login_lease_and_the_durable_result() {
        let login = Arc::new(login());
        login.commit().unwrap();
        let worker = login.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        let finishing = tokio::spawn(async move {
            let saved = Status {
                catalog: discovery::Catalog::default(),
                config: Some(
                    serde_json::from_value(serde_json::json!({
                        "connectionId": "11111111-1111-4111-8111-111111111111",
                        "provider": "openai", "auth": "oauth", "endpoint": null
                    }))
                    .unwrap(),
                ),
                available: true,
                reason: None,
                selected_model: Some("gpt-6.1-sol".into()),
                model_error: None,
                model_preference: None,
                model_inherited: true,
                thinking_inherited: true,
                thinking_preference: None,
                thinking_level: None,
                inherited_thinking_level: None,
                recommended_thinking_level: None,
            };
            finish_login(
                &worker,
                Ok(saved),
                async {
                    started.send(()).unwrap();
                    released.await.unwrap();
                    Err("native.ai.browser.openFailed".into())
                },
                None,
            )
            .await;
        });
        ready.await.unwrap();
        assert!(login.pending());
        login.cancel();
        assert!(!login.cancel.is_cancelled());
        release.send(()).unwrap();
        finishing.await.unwrap();
        assert!(login.wait().await.unwrap().available);
        assert!(!login.pending());
    }

    #[tokio::test]
    async fn browser_cleanup_preserves_the_original_failure() {
        let login = login();
        finish_login(
            &login,
            Err(oauth::CANCELLED.into()),
            async { Err("native.ai.browser.openFailed".into()) },
            None,
        )
        .await;
        assert!(matches!(login.wait().await, Err(error) if error == oauth::CANCELLED));
    }

    #[test]
    fn returning_identity_is_loaded_only_from_a_complete_openai_connection() {
        let record = serde_json::json!({
            "config": { "provider": "openai", "auth": "oauth" },
            "key": "",
            "oauth": {
                "access": "synthetic-access", "refresh": "synthetic-refresh", "expires": 1,
                "clientId": "issued-client", "subject": "synthetic-subject",
                "scopes": ["chatgpt.tokens.use.direct"]
            }
        });
        let read = |value: &Value| previous_credential(&serde_json::to_vec(value).unwrap());
        let previous = read(&record).unwrap().unwrap();
        assert_eq!(previous.client_id, "issued-client");
        assert_eq!(previous.subject, "synthetic-subject");
        for malformed in [b"{".as_slice(), b"null"] {
            assert!(previous_credential(malformed).is_err());
        }
        for field in ["subject", "clientId"] {
            let mut unknown = record.clone();
            unknown["oauth"].as_object_mut().unwrap().remove(field);
            assert!(read(&unknown).is_err());
            let mut empty = record.clone();
            empty["oauth"][field] = serde_json::json!(" ");
            assert!(read(&empty).is_err());
        }
        let mut missing = record.clone();
        missing.as_object_mut().unwrap().remove("oauth");
        assert!(read(&missing).is_err());
        let mut other_provider = record.clone();
        other_provider["config"]["provider"] = serde_json::json!("anthropic");
        assert!(read(&other_provider).is_err());
        let mut key_auth = record;
        key_auth["config"]["auth"] = serde_json::json!("api_key");
        assert!(read(&key_auth).is_err());
        key_auth.as_object_mut().unwrap().remove("oauth");
        for provider in ["openai", "anthropic"] {
            key_auth["config"]["provider"] = serde_json::json!(provider);
            assert!(read(&key_auth).unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn nested_login_panics_survive_join_mapping_and_cancelled_or_timed_out_drains() {
        const CHILD: &str = "SITUATE_NESTED_LOGIN_PANIC_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "nested_login_panics_survive_join_mapping_and_cancelled_or_timed_out_drains",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .status()
                .unwrap();
            assert!(status.success());
            return;
        }
        use crate::openai_oauth::diagnostic_tests::Capture;
        for mode in ["completed", "cancelled", "timeout", "persisted"] {
            let capture = Capture::new();
            let diagnostic = capture.operation(None);
            let (started, ready) = tokio::sync::oneshot::channel();
            let (release, blocked) = std::sync::mpsc::channel();
            let task = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                started.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
                panic!("PRIVATE_NESTED_LOGIN_PANIC_SENTINEL");
            });
            ready.await.unwrap();
            let cancel = CancellationToken::new();
            if mode == "cancelled" {
                cancel.cancel();
            }
            if mode == "timeout" {
                tokio::time::pause();
            }
            let deadline = tokio::time::Instant::now()
                + if mode == "timeout" {
                    Duration::ZERO
                } else {
                    Duration::from_secs(5)
                };
            // A pending poll alone does not prove that timeout draining has started.
            if mode == "timeout" {
                tokio::time::sleep_until(deadline).await;
            }
            let result = if mode == "persisted" {
                release.send(()).unwrap();
                observe_login_join(task.await, Some(&diagnostic))
                    .map_err(|_| KEY_ERROR.to_owned())
                    .and_then(|result| result)
            } else {
                let mut finishing = Box::pin(finish_preparation(
                    task,
                    &cancel,
                    deadline,
                    Some(&diagnostic),
                ));
                assert!(futures_util::poll!(&mut finishing).is_pending());
                if mode == "timeout" {
                    tokio::time::advance(Duration::from_millis(1)).await;
                    assert!(futures_util::poll!(&mut finishing).is_pending());
                }
                release.send(()).unwrap();
                finishing.await
            };
            if mode == "timeout" {
                tokio::time::resume();
            }
            let expected = match mode {
                "cancelled" => oauth::CANCELLED,
                "timeout" => "native.ai.login.timeout",
                "persisted" => KEY_ERROR,
                _ => oauth::ERROR,
            };
            assert_eq!(result.as_ref().err().unwrap(), expected);
            diagnostic.result(&result);
            let records = capture.records();
            assert_eq!(records.len(), 2);
            let terminal = &records[1];
            assert_eq!(terminal["event"], "operation.finished");
            assert_eq!(terminal["level"], "error");
            assert_eq!(terminal["attributes"]["outcome"], "failure");
            assert_eq!(terminal["attributes"]["error_code"], "panic");
            assert_eq!(
                terminal["context"]["span_id"],
                records[0]["context"]["span_id"]
            );
            assert!(
                !serde_json::to_string(&records)
                    .unwrap()
                    .contains("PRIVATE_NESTED_LOGIN_PANIC_SENTINEL")
            );
        }
    }

    #[tokio::test]
    async fn nested_login_task_cancellation_is_interruption_not_user_cancellation() {
        use crate::openai_oauth::diagnostic_tests::Capture;
        let capture = Capture::new();
        let diagnostic = capture.operation(None);
        let task = tauri::async_runtime::spawn(std::future::pending::<Result<(), String>>());
        task.abort();
        let result = finish_preparation(
            task,
            &CancellationToken::new(),
            tokio::time::Instant::now() + Duration::from_secs(5),
            Some(&diagnostic),
        )
        .await;
        assert_eq!(result.as_ref().err().unwrap(), oauth::ERROR);
        diagnostic.result(&result);
        let records = capture.records();
        assert_eq!(records.len(), 2);
        assert_eq!(records[1]["level"], "warn");
        assert_eq!(records[1]["attributes"]["outcome"], "interrupted");
        assert_eq!(records[1]["attributes"]["error_code"], "interrupted");
    }

    #[tokio::test]
    async fn cancelled_or_timed_out_preparation_drains_worker_before_releasing_resources() {
        for timeout in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().canonicalize().unwrap();
            std::fs::create_dir(path.join(".situate")).unwrap();
            let storage = Storage::open(&path, "one").unwrap();
            let contender = Storage::open(&path, "one").unwrap();
            let (ready, prepared) = tokio::sync::oneshot::channel();
            let (release, blocked) = std::sync::mpsc::channel();
            let worker = tauri::async_runtime::spawn_blocking(move || {
                let lock = storage.lock_credentials()?;
                ready.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(lock)
            });
            prepared.await.unwrap();
            let cancel = CancellationToken::new();
            if !timeout {
                cancel.cancel();
            }
            let deadline = tokio::time::Instant::now()
                + if timeout {
                    Duration::ZERO
                } else {
                    Duration::from_secs(5)
                };
            let mut finishing = Box::pin(finish_preparation(worker, &cancel, deadline, None));
            assert!(futures_util::poll!(&mut finishing).is_pending());
            assert!(contender.lock_credentials().is_err());
            release.send(()).unwrap();
            let error = finishing.await.err().unwrap();
            assert_eq!(
                error,
                if timeout {
                    "native.ai.login.timeout"
                } else {
                    oauth::CANCELLED
                }
            );
            assert!(contender.lock_credentials().is_ok());
        }
    }
    #[tokio::test]
    async fn cancellation_retains_the_lease_until_work_has_settled() {
        let login = login();
        login.cancel();
        assert!(login.pending());
        assert!(login.commit().is_err());
        let mut waiting = Box::pin(login.wait());
        assert!(futures_util::poll!(&mut waiting).is_pending());
        login
            .result
            .send_replace(Some(Err(oauth::CANCELLED.into())));
        assert_eq!(waiting.await.err().unwrap(), oauth::CANCELLED);
        assert!(!login.pending());
    }
    #[tokio::test]
    async fn cancellation_after_commit_started_waits_for_the_actual_storage_outcome() {
        let login = login();
        login.commit().unwrap();
        login.cancel();
        assert!(!login.cancel.is_cancelled());
        assert!(login.pending());
        login.result.send_replace(Some(Err(KEY_ERROR.into())));
        assert_eq!(login.wait().await.err().unwrap(), KEY_ERROR);
    }
}
