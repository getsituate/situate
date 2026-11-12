use tauri::{AppHandle, WebviewWindow, WebviewWindowBuilder, utils::config::WindowConfig};

pub fn build(app: &AppHandle, config: WindowConfig) -> tauri::Result<WebviewWindow> {
    #[cfg(target_os = "macos")]
    {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            return build_on_main_thread(app, &config, mtm);
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let mtm =
                objc2::MainThreadMarker::new().expect("window creation runs on the UI thread");
            let _ = sender.send(build_on_main_thread(&handle, &config, mtm));
        })?;
        receiver
            .recv()
            .map_err(|_| tauri::Error::FailedToReceiveMessage)?
    }
    #[cfg(not(target_os = "macos"))]
    WebviewWindowBuilder::from_config(app, &config)?.build()
}

#[cfg(target_os = "macos")]
fn build_on_main_thread(
    app: &AppHandle,
    config: &WindowConfig,
    mtm: objc2::MainThreadMarker,
) -> tauri::Result<WebviewWindow> {
    use objc2::{msg_send, sel};
    use objc2_app_kit::NSWritingToolsBehavior;
    use objc2_foundation::NSObjectProtocol;
    use objc2_web_kit::WKWebViewConfiguration;

    // WebKit copies this configuration at creation; changing it on an existing view has no effect.
    let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
    if configuration.respondsToSelector(sel!(setWritingToolsBehavior:)) {
        // objc2-web-kit does not expose this public macOS 15+ property yet.
        unsafe {
            let _: () =
                msg_send![&configuration, setWritingToolsBehavior: NSWritingToolsBehavior::None];
        }
    }
    WebviewWindowBuilder::from_config(app, config)?
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .with_webview_configuration(configuration)
        .build()
}

#[cfg(target_os = "macos")]
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    if let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
    {
        build(app, config.clone())?;
    }
    Ok(())
}
