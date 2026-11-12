use tauri::plugin::{Builder, TauriPlugin};
#[cfg(mobile)]
use tauri::{Manager, plugin::PluginHandle};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_workspace_access);

#[cfg(mobile)]
pub struct Access(PluginHandle<tauri::Wry>);

#[cfg(mobile)]
impl Access {
    #[cfg(target_os = "ios")]
    pub fn recovery_email(&self, url: &str) -> Result<bool, String> {
        self.0
            .run_mobile_plugin("recoveryEmail", serde_json::json!({"url": url}))
            .map_err(localized_error)
    }

    pub fn content(&self, payload: serde_json::Value) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin("content", payload)
            .map_err(localized_error)
    }

    pub fn request(&self, payload: serde_json::Value) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin("access", payload)
            .map_err(localized_error)
    }
}

#[cfg(target_os = "ios")]
pub struct SessionAccess {
    app: tauri::AppHandle,
    token: String,
    root: std::path::PathBuf,
}

#[cfg(target_os = "ios")]
impl SessionAccess {
    pub fn begin(app: &tauri::AppHandle, location: serde_json::Value) -> Result<Self, String> {
        let response = app.state::<Access>().content(serde_json::json!({
            "operation": "beginSession", "location": location
        }))?;
        let token = response["token"]
            .as_str()
            .ok_or("native.files.coordination.startFailed")?;
        let root = response["path"]
            .as_str()
            .ok_or("native.files.documents.unavailable")?;
        Ok(Self {
            app: app.clone(),
            token: token.into(),
            root: root.into(),
        })
    }

    // Coordination ends before normal native reads; the security scope remains session-owned.
    pub fn prepare<T>(
        &self,
        operation: impl FnOnce(&std::path::Path) -> Result<T, String>,
    ) -> Result<T, String> {
        let response = self.app.state::<Access>().content(serde_json::json!({
            "operation": "beginPreparation", "token": self.token
        }))?;
        let token = response["token"]
            .as_str()
            .ok_or("native.files.coordination.startFailed")?;
        let mut coordination = PreparationAccess {
            app: &self.app,
            token: Some(token),
        };
        let result = operation(&self.root);
        // A failed coordination acknowledgement must not admit a session.
        coordination.finish()?;
        result
    }
}

#[cfg(target_os = "ios")]
struct PreparationAccess<'a> {
    app: &'a tauri::AppHandle,
    token: Option<&'a str>,
}

#[cfg(target_os = "ios")]
impl PreparationAccess<'_> {
    fn finish(&mut self) -> Result<(), String> {
        if let Some(token) = self.token {
            self.app.state::<Access>().content(serde_json::json!({
                "operation": "endAccess", "token": token
            }))?;
            self.token = None;
        }
        Ok(())
    }
}

#[cfg(target_os = "ios")]
impl Drop for PreparationAccess<'_> {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

#[cfg(target_os = "ios")]
impl Drop for SessionAccess {
    fn drop(&mut self) {
        let _ = self.app.state::<Access>().content(serde_json::json!({
            "operation": "endSession", "token": self.token
        }));
    }
}

#[cfg(mobile)]
fn localized_error(error: tauri::plugin::mobile::PluginInvokeError) -> String {
    if let tauri::plugin::mobile::PluginInvokeError::InvokeRejected(response) = error {
        if let Some(message) = response.message {
            if message.starts_with("native.")
                || serde_json::from_str::<serde_json::Value>(&message)
                    .ok()
                    .and_then(|v| {
                        v.get("key")
                            .and_then(serde_json::Value::as_str)
                            .map(|s| s.starts_with("native."))
                    })
                    .unwrap_or(false)
            {
                return message;
            }
        }
    }
    "native.provider.content.failed".into()
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("workspace-access")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Access(_api.register_android_plugin(
                "dev.situate.access",
                "WorkspaceAccessPlugin",
            )?));
            #[cfg(target_os = "ios")]
            _app.manage(Access(
                _api.register_ios_plugin(init_plugin_workspace_access)?,
            ));
            Ok(())
        })
        .build()
}
