use super::*;
use base64::Engine;
use objc2::AnyThread;
use objc2_app_kit::NSBitmapImageRep;
use objc2_foundation::NSData;
use std::{future::Future, task::Poll};
use tauri_plugin_executor_platform::CaptureRect;

pub(super) async fn check(app: AppHandle) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let executor = Executor::new(app.clone());
    let handle = executor
        .open(
            OpenRequest {
                workspace_generation: "preview-fixture".into(),
                document_kind: DocumentKind::Preview,
                supervisor_source: r#"
                const style = document.createElement('style');
                style.textContent = 'body { margin:0; background:#0000ff }';
                document.head.append(style);
                globalThis.__SITUATE_EXECUTOR__.receive = () =>
                    globalThis.__SITUATE_EXECUTOR__.send('painted');
            "#
                .into(),
            },
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .await?;
    executor.close_generation("absent-fixture").await?;
    handle.send(json!("paint")).await?;
    message(&mut rx, json!("painted")).await?;
    let labels = executor.supervisor_window_labels();
    let window = app
        .get_webview_window(labels.first().ok_or("preview-window-missing")?)
        .ok_or("preview-window-missing")?;
    if window.is_visible().map_err(|e| e.to_string())?
        || window.is_focused().map_err(|e| e.to_string())?
    {
        return Err("preview-visible-or-focused".into());
    }
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    if size.width != 1024.0 || size.height != 768.0 {
        return Err("preview-geometry".into());
    }
    let rect = CaptureRect {
        x: 10.0,
        y: 10.0,
        width: 40.0,
        height: 60.0,
    };
    let png = handle.capture(rect).await?;
    assert_blue_png(png)?;
    for invalid in [
        CaptureRect { width: 0.0, ..rect },
        CaptureRect { x: 1020.0, ..rect },
        CaptureRect {
            width: 2049.0,
            ..rect
        },
    ] {
        if handle.capture(invalid).await.is_ok() {
            return Err("preview-invalid-capture-admitted".into());
        }
    }
    if window.is_visible().map_err(|e| e.to_string())? {
        return Err("preview-capture-showed-window".into());
    }
    let mut dropped = Box::pin(handle.capture(rect));
    std::future::poll_fn(|cx| match dropped.as_mut().poll(cx) {
        Poll::Pending => Poll::Ready(Ok(())),
        Poll::Ready(_) => Poll::Ready(Err("preview-capture-not-pending")),
    })
    .await?;
    drop(dropped);
    let mut pending = Box::pin(handle.capture(rect));
    std::future::poll_fn(|cx| match pending.as_mut().poll(cx) {
        Poll::Pending => Poll::Ready(Ok(())),
        Poll::Ready(_) => Poll::Ready(Err("preview-capture-not-pending")),
    })
    .await?;
    executor.close_generation("preview-fixture").await?;
    executor.close_generation("preview-fixture").await?;
    if pending.await != Err("executor.closed".into()) {
        return Err("preview-close-did-not-fence-pending-capture".into());
    }
    if handle.capture(rect).await.is_ok() {
        return Err("preview-closed-capture-admitted".into());
    }
    if !app.webview_windows().is_empty() {
        return Err("preview-window-retained".into());
    }
    let failed = executor
        .open(
            OpenRequest {
                workspace_generation: "failed-preview-fixture".into(),
                document_kind: DocumentKind::Preview,
                supervisor_source: "throw new Error('synthetic bootstrap failure')".into(),
            },
            Arc::new(|_| {}),
        )
        .await;
    if failed.is_ok() {
        return Err("preview-bootstrap-failure-not-reported".into());
    }
    executor.close_generation("failed-preview-fixture").await?;
    executor.close_generation("failed-preview-fixture").await?;
    if !app.webview_windows().is_empty() {
        return Err("failed-preview-window-retained".into());
    }
    Ok(())
}

fn assert_blue_png(png: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png)
        .map_err(|e| e.to_string())?;
    let data = NSData::with_bytes(&bytes);
    let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &data)
        .ok_or("preview-invalid-png")?;
    if bitmap.pixelsWide() != 40 || bitmap.pixelsHigh() != 60 {
        return Err("preview-pixel-dimensions".into());
    }
    let color = bitmap.colorAtX_y(20, 30).ok_or("preview-missing-pixel")?;
    if color.redComponent() > 0.04 || color.greenComponent() > 0.04 || color.blueComponent() < 0.96
    {
        return Err("preview-pixel-not-blue".into());
    }
    Ok(())
}
