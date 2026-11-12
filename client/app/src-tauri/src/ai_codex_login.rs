use super::*;
use crate::codex_oauth as codex;
use serde::Serialize;
use tokio::sync::oneshot;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogin {
    id: String,
    #[serde(flatten)]
    challenge: codex::Challenge,
}

fn error(error: codex::Error) -> String {
    match error {
        codex::Error::Cancelled => oauth::CANCELLED,
        codex::Error::Denied => "native.ai.login.denied",
        codex::Error::Expired => "native.ai.login.timeout",
        codex::Error::Failed => oauth::ERROR,
    }
    .into()
}

#[tauri::command]
pub async fn ai_codex_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    connection_id: Option<String>,
    label: Option<String>,
) -> Result<DeviceLogin, String> {
    let config = Config {
        connection_id,
        label,
        http_acknowledgement: None,
        provider: "openai-codex".into(),
        legacy_model: None,
        endpoint: None,
        auth: Some(AuthKind::Oauth),
    };
    model::validate_config(&config)?;
    let (location, login) = begin(&app, window.label(), &scope)?;
    let (ready, challenge) = oneshot::channel();
    let pending = login.clone();
    let worker = tauri::async_runtime::spawn(async move {
        let result = run(
            &app,
            window.label(),
            &scope,
            location,
            config,
            &pending,
            ready,
        )
        .await;
        if let Ok(mut url) = pending.browser_url.lock() {
            *url = None;
        }
        pending.result.send_replace(Some(result));
    });
    observe_login(login.clone(), worker);
    match challenge.await {
        Ok(challenge) => Ok(challenge),
        Err(_) => Err(login
            .wait()
            .await
            .err()
            .unwrap_or_else(|| oauth::ERROR.into())),
    }
}

#[tauri::command]
pub async fn ai_codex_wait(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    id: String,
) -> Result<Status, String> {
    ai_openai_wait(app, window, scope, id).await
}

#[tauri::command]
pub async fn ai_codex_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    id: String,
) -> Result<(), String> {
    ai_openai_cancel(app, window, scope, id).await
}

#[tauri::command]
pub async fn ai_codex_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    id: String,
) -> Result<(), String> {
    crate::workspaces::with_current(&app, window.label(), &scope, |_| Ok(()))?;
    let login = scoped(&app, window.label(), &scope, &id)?
        .filter(|login| login.pending() && !login.cancel.is_cancelled())
        .ok_or("native.ai.login.inactive")?;
    let url = login
        .browser_url
        .lock()
        .map_err(|_| oauth::ERROR)?
        .clone()
        .ok_or("native.ai.login.inactive")?;
    crate::provider_platform::open_browser(&app, &url).await
}

async fn run(
    app: &tauri::AppHandle,
    window: &str,
    scope: &str,
    location: situate_core::workspaces::Location,
    config: Config,
    login: &Arc<Login>,
    ready: oneshot::Sender<DeviceLogin>,
) -> Result<Status, String> {
    let diagnostic = crate::diagnostics::Operation::begin(
        app,
        window,
        scope,
        crate::diagnostics::OperationKind::CodexLogin,
        None,
    );
    let result = async {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(900);
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
                    .map(|bytes| -> Result<String, String> {
                        let old = decode_connection(&bytes)
                            .map_err(|_| "native.ai.login.savedIdentityInvalid")?;
                        old.codex
                            .map(|credential| credential.account_id)
                            .filter(|account| !account.trim().is_empty())
                            .ok_or_else(|| "native.ai.login.savedIdentityInvalid".into())
                    })
                    .transpose()?
            } else {
                None
            };
            Ok::<_, String>((storage, lock, config, replacing, previous))
        });
        let (storage, lock, config, replacing, previous) =
            finish_preparation(preparation, &login.cancel, deadline, diagnostic.as_ref()).await?;
        let operation = async {
            let challenge = codex::start(&login.cancel).await.map_err(error)?;
            *login.browser_url.lock().map_err(|_| oauth::ERROR)? =
                Some(challenge.verification_uri.clone());
            ready
                .send(DeviceLogin {
                    id: login.id.clone(),
                    challenge: challenge.clone(),
                })
                .map_err(|_| oauth::CANCELLED)?;
            codex::poll(&challenge, &login.cancel).await.map_err(error)
        };
        let credential = tokio::time::timeout_at(deadline, operation)
            .await
            .map_err(|_| "native.ai.login.timeout")??;
        if previous
            .as_ref()
            .is_some_and(|account| account != &credential.account_id)
        {
            return Err("native.ai.login.savedIdentityInvalid".into());
        }
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
        let save_app = app.clone();
        let status = observe_login_join(
            tauri::async_runtime::spawn_blocking(move || {
                let _lock = lock;
                let connection = Connection {
                    catalog: Some(discovery::Catalog::static_models(&config)),
                    config,
                    key: String::new(),
                    oauth: None,
                    codex: Some(credential),
                };
                connections::save(&storage, &save_app, &connection, replacing)?;
                model::initialize(
                    &storage,
                    &connection.config,
                    &discovery::catalog(&connection),
                )?;
                Ok::<_, String>(discovery::status(&storage, &connection, false))
            })
            .await,
            diagnostic.as_ref(),
        )
        .map_err(|_| KEY_ERROR)??;
        app.state::<Ai>().clear_rejected(
            scope,
            status
                .config
                .as_ref()
                .and_then(|config| config.connection_id.as_deref()),
        )?;
        Ok(status)
    }
    .await;
    if let Some(diagnostic) = diagnostic {
        diagnostic.result(&result);
    }
    result
}
