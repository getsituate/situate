use super::*;

#[tauri::command]
pub async fn smoke_login_ownership(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<(), String> {
    let (_, login) = begin(&app, window.label(), &scope)?;
    let result = async {
        let foreign = app
            .get_webview_window("main")
            .filter(|other| other.label() != window.label())
            .ok_or("The ownership check requires a separate shell window")?;
        for result in [
            tokio::time::timeout(
                Duration::from_secs(1),
                ai_openai_wait(
                    app.clone(),
                    foreign.clone(),
                    scope.clone(),
                    login.id.clone(),
                ),
            )
            .await
            .map_err(|_| "A foreign window waited on a pending login attempt")?
            .map(|_| ()),
            tokio::time::timeout(
                Duration::from_secs(1),
                ai_openai_cancel(app.clone(), foreign, scope.clone(), login.id.clone()),
            )
            .await
            .map_err(|_| "A foreign window cancelled a pending login attempt")?,
        ] {
            if result.err().as_deref() != Some("native.workspace.session.inactive") {
                return Err("A foreign window accessed an existing login attempt".into());
            }
        }
        if !login.pending() || login.cancel.is_cancelled() {
            return Err("A foreign window changed a pending login attempt".into());
        }
        login
            .result
            .send_replace(Some(Err(oauth::CANCELLED.into())));
        if ai_openai_wait(app.clone(), window.clone(), scope.clone(), login.id.clone())
            .await
            .err()
            .as_deref()
            != Some(oauth::CANCELLED)
        {
            return Err("The owning window could not read its completed login attempt".into());
        }
        ai_openai_cancel(app.clone(), window, scope.clone(), login.id.clone()).await
    }
    .await;
    login.cancel();
    login
        .result
        .send_replace(Some(Err(oauth::CANCELLED.into())));
    let state = app.state::<Ai>();
    let mut logins = state.logins.lock().map_err(|_| oauth::ERROR)?;
    if logins
        .get(&scope)
        .is_some_and(|stored| stored.id == login.id)
    {
        logins.remove(&scope);
    }
    result
}
