use super::{CaptureRect, LIMIT, UNAVAILABLE, complete};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::oneshot;
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2Controller, ICoreWebView2Controller3},
};
use windows::{
    Win32::Foundation::RECT,
    core::{HSTRING, Interface, w},
};

const MAX_BASE64_BYTES: usize = (8 * 1024 * 1024_usize).div_ceil(3) * 4;
const TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) async fn capture(
    window: &tauri::WebviewWindow,
    rect: CaptureRect,
    session: Arc<crate::Session>,
) -> Result<String, String> {
    let (sender, receiver) = oneshot::channel();
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    window
        .with_webview(move |platform| {
            if sender.is_closed() || tokio::time::Instant::now() >= deadline {
                return;
            }
            let closed = || session.lifecycle.lock().unwrap().is_closed();
            if closed() {
                let _ = sender.send(Err("executor.closed".into()));
                return;
            }
            let controller = platform.controller();
            let parameters = match screenshot_parameters(&controller, rect) {
                Ok(parameters) => parameters,
                Err(error) => {
                    let _ = sender.send(Err(error));
                    return;
                }
            };
            // WebView2 owns the callback after successful submission. If submission fails,
            // dropping the handler closes the channel and reports captureUnavailable.
            let completion = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, reply| {
                    complete(
                        sender,
                        deadline,
                        || session.lifecycle.lock().unwrap().is_closed(),
                        || {
                            status.map_err(|_| UNAVAILABLE)?;
                            screenshot_data(&reply)
                        },
                    );
                    Ok(())
                },
            ));
            // Use only this WebView's compositor, even when its window is hidden.
            let _ = unsafe {
                controller.CoreWebView2().and_then(|view| {
                    view.CallDevToolsProtocolMethod(
                        w!("Page.captureScreenshot"),
                        &parameters,
                        &completion,
                    )
                })
            };
        })
        .map_err(|_| UNAVAILABLE.to_string())?;
    let result = tokio::time::timeout_at(deadline, receiver)
        .await
        .map_err(|_| UNAVAILABLE.to_string())?
        .map_err(|_| UNAVAILABLE.to_string())?;
    if tokio::time::Instant::now() >= deadline {
        return Err(UNAVAILABLE.into());
    }
    result
}

fn screenshot_parameters(
    controller: &ICoreWebView2Controller,
    rect: CaptureRect,
) -> Result<HSTRING, String> {
    let controller3 = controller
        .cast::<ICoreWebView2Controller3>()
        .map_err(|_| UNAVAILABLE)?;
    let mut bounds = RECT::default();
    let mut raster = 0.0;
    let mut zoom = 0.0;
    // Wry sets the controller bounds in physical pixels, but the preview sends CSS coordinates.
    unsafe {
        controller.Bounds(&mut bounds).map_err(|_| UNAVAILABLE)?;
        controller3
            .RasterizationScale(&mut raster)
            .map_err(|_| UNAVAILABLE)?;
        controller.ZoomFactor(&mut zoom).map_err(|_| UNAVAILABLE)?;
    }
    let scale = raster * zoom;
    if !scale.is_finite() || scale <= 0.0 {
        return Err(UNAVAILABLE.into());
    }
    rect.validate_in(CaptureRect {
        x: 0.0,
        y: 0.0,
        width: (f64::from(bounds.right) - f64::from(bounds.left)) / scale,
        height: (f64::from(bounds.bottom) - f64::from(bounds.top)) / scale,
    })?;
    Ok(HSTRING::from(serde_json::json!({
        "format": "png",
        "fromSurface": true,
        "captureBeyondViewport": false,
        "clip": { "x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height, "scale": 1.0 / scale },
    }).to_string()))
}

fn screenshot_data(reply: &str) -> Result<String, String> {
    if reply.len() > MAX_BASE64_BYTES + 64 {
        return Err(LIMIT.into());
    }
    #[derive(Deserialize)]
    struct Screenshot {
        data: String,
    }
    let screenshot = serde_json::from_str::<Screenshot>(reply).map_err(|_| UNAVAILABLE)?;
    if screenshot.data.len() > MAX_BASE64_BYTES {
        return Err(LIMIT.into());
    }
    Ok(screenshot.data)
}
