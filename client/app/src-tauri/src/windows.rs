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
fn swipe_history_direction(
    phase: objc2_app_kit::NSEventPhase,
    delta_x: f64,
) -> Option<&'static str> {
    use objc2_app_kit::NSEventPhase;
    match (phase, delta_x) {
        (NSEventPhase::Ended | NSEventPhase::None, x) if x > 0.0 => Some("back"),
        (NSEventPhase::Ended | NSEventPhase::None, x) if x < 0.0 => Some("forward"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn install_mouse_history(app: &AppHandle) {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSEvent, NSEventMask, NSEventType};
    use tauri::{Emitter, Manager};

    let app = app.clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
        let Some(mtm) = MainThreadMarker::new() else {
            return event.as_ptr();
        };
        // AppKit supplies a live event for the duration of this callback.
        let mouse = unsafe { event.as_ref() };
        let event_type = mouse.r#type();
        let direction = match event_type {
            NSEventType::OtherMouseDown | NSEventType::OtherMouseUp => match mouse.buttonNumber() {
                3 => Some("back"),
                4 => Some("forward"),
                _ => None,
            },
            // Some mouse drivers send a page swipe instead of a button event.
            NSEventType::Swipe => swipe_history_direction(mouse.phase(), mouse.deltaX()),
            _ => None,
        };
        let Some(direction) = direction else {
            return event.as_ptr();
        };
        let Some(native) = mouse.window(mtm).or_else(|| {
            let application = NSApplication::sharedApplication(mtm);
            application
                .isActive()
                .then(|| application.keyWindow())
                .flatten()
        }) else {
            return event.as_ptr();
        };
        let Some(window) = app.webview_windows().into_values().find(|window| {
            (window.label() == "main" || window.label().starts_with("workspace-"))
                && window
                    .ns_window()
                    .is_ok_and(|ptr| std::ptr::eq(ptr.cast(), &*native))
        }) else {
            return event.as_ptr();
        };
        if event_type != NSEventType::OtherMouseDown {
            let _ = app.emit_to(window.label(), "mouse-history", direction);
        }
        std::ptr::null_mut()
    });
    // WebKit may consume these inputs or use them for its own history.
    unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::OtherMouseDown | NSEventMask::OtherMouseUp | NSEventMask::Swipe,
            &handler,
        );
    }
}

#[cfg(target_os = "macos")]
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    install_mouse_history(app);
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::swipe_history_direction;
    use objc2_app_kit::NSEventPhase;

    #[test]
    fn only_completed_horizontal_swipes_navigate() {
        assert_eq!(
            swipe_history_direction(NSEventPhase::Ended, 1.0),
            Some("back")
        );
        assert_eq!(
            swipe_history_direction(NSEventPhase::Ended, -1.0),
            Some("forward")
        );
        assert_eq!(
            swipe_history_direction(NSEventPhase::None, -1.0),
            Some("forward")
        );
        assert_eq!(swipe_history_direction(NSEventPhase::Ended, 0.0), None);
        assert_eq!(swipe_history_direction(NSEventPhase::Began, 1.0), None);
        assert_eq!(swipe_history_direction(NSEventPhase::Cancelled, -1.0), None);
    }
}
