use tauri::plugin::{Builder, TauriPlugin};
#[cfg(mobile)]
use tauri::{Manager, plugin::PluginHandle};
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_provider_platform);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthBrowserExit {
    Cancelled,
    Failed,
}

#[cfg(target_os = "android")]
mod android_finish;
#[cfg(any(mobile, test))]
mod auth_browser;

#[cfg(mobile)]
pub struct Platform(PluginHandle<tauri::Wry>, auth_browser::Callbacks);
#[cfg(mobile)]
impl Platform {
    pub fn call(&self, payload: serde_json::Value) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin("store", payload)
            .map_err(|error| localized_error(error, "native.ai.secureStore.failed"))
    }
    #[cfg(target_os = "android")]
    pub async fn request_local_network_permission(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin_async::<serde_json::Value>(
                "requestLocalNetwork",
                serde_json::json!({}),
            )
            .await
            .map(|_| ())
            .map_err(|error| localized_error(error, "native.ai.permission.localNetworkDenied"))
    }
    pub async fn open_browser(&self, url: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin_async::<serde_json::Value>(
                "openBrowser",
                serde_json::json!({"url":url}),
            )
            .await
            .map(|_| ())
            .map_err(|error| localized_error(error, "native.ai.browser.openFailed"))
    }
}
#[cfg(mobile)]
fn localized_error(error: tauri::plugin::mobile::PluginInvokeError, fallback: &str) -> String {
    if let tauri::plugin::mobile::PluginInvokeError::InvokeRejected(response) = error {
        if let Some(message) = response.message {
            if matches!(
                message.as_str(),
                "native.ai.secureStore.unavailable"
                    | "native.ai.secureStore.locked"
                    | "native.ai.secureStore.missing"
                    | "native.ai.secureStore.failed"
                    | "native.ai.secureStore.invalid"
                    | "native.ai.browser.invalidUrl"
                    | "native.ai.browser.openFailed"
                    | "native.ai.browser.busy"
                    | "native.ai.permission.localNetworkDenied"
            ) {
                return message;
            }
        }
    }
    fallback.into()
}
fn native_only<R: tauri::Runtime>(invoke: tauri::ipc::Invoke<R>) -> bool {
    invoke.resolver.reject("native.ai.secureStore.failed");
    // Returning true prevents Tauri's mobile fallback, even if a future capability grants a command.
    true
}

fn builder<R: tauri::Runtime>() -> Builder<R> {
    Builder::new("provider-platform").invoke_handler(native_only)
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    builder()
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Platform(
                _api.register_android_plugin("dev.situate.providers", "ProviderPlatformPlugin")?,
                auth_browser::Callbacks::new(),
            ));
            #[cfg(target_os = "ios")]
            _app.manage(Platform(
                _api.register_ios_plugin(init_plugin_provider_platform)?,
                auth_browser::Callbacks::new(),
            ));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod native_only_tests;
