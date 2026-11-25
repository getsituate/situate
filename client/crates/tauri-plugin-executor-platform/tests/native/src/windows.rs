use super::*;
use ::windows::core::Interface;
use base64::Engine;
use std::{future::Future, io::Cursor, task::Poll};
use tauri_plugin_executor_platform::CaptureRect;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller3;

const WORKER_SUPERVISOR: &str = r#"
const source = URL.createObjectURL(new Blob([
  `onmessage = ({data}) => {
    if (data === 'pending') {
      setTimeout(() => postMessage('late'), 2000);
      postMessage('pending');
    } else {
      postMessage(42);
    }
  };`
], {type:'text/javascript'}));
const worker = new Worker(source, {type:'module'});
worker.onmessage = ({data}) => __SITUATE_EXECUTOR__.send(data);
__SITUATE_EXECUTOR__.receive = value => worker.postMessage(value);
"#;

pub(super) async fn check(app: AppHandle) -> Result<(), String> {
    let executor = Executor::new(app.clone());
    let open = |generation: &str| {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            OpenRequest {
                document_kind: DocumentKind::Supervisor,
                workspace_generation: generation.into(),
                supervisor_source: WORKER_SUPERVISOR.into(),
            },
            Arc::new(move |event| {
                let _ = tx.send(event);
            }) as tauri_plugin_executor_platform::EventCallback,
            rx,
        )
    };
    let (request, callback, mut first) = open("first");
    let first_handle = executor.open(request, callback).await?;
    let (request, callback, mut second) = open("second");
    let second_handle = executor.open(request, callback).await?;

    first_handle.send(json!("run")).await?;
    expect_message(&mut first, "first", json!(42)).await?;
    first_handle.send(json!("pending")).await?;
    expect_message(&mut first, "first", json!("pending")).await?;

    executor.close_generation("first").await?;
    if !matches!(
        next(&mut first).await?,
        ExecutorEvent::Lost { workspace_generation, reason: LossReason::Closed }
        if workspace_generation == "first"
    ) || !matches!(
        next(&mut first).await?,
        ExecutorEvent::Stopped { workspace_generation } if workspace_generation == "first"
    ) || first_handle.send(json!("run")).await.is_ok()
        || app.webview_windows().len() != 1
    {
        return Err("first-executor-not-closed".into());
    }

    second_handle.send(json!("run")).await?;
    expect_message(&mut second, "second", json!(42)).await?;
    executor.close_generation("second").await?;
    if !app.webview_windows().is_empty() {
        return Err("closed-executor-still-active".into());
    }
    if let Ok(Some(event)) = timeout(Duration::from_millis(2200), first.recv()).await {
        return Err(format!("event-after-close:{event:?}"));
    }
    check_preview(app, executor).await
}

async fn check_preview(app: AppHandle, executor: Executor) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let handle = executor.open(OpenRequest {
        document_kind: DocumentKind::Preview,
        workspace_generation: "windows-preview".into(),
        supervisor_source: r#"
            const style = document.createElement('style');
            style.textContent = `body { margin:0; background:#ff0000 }
                div { position:fixed; left:100px; top:160px; width:40px; height:60px; background:#0000ff }
                span { display:block; height:32px; background:#00ff00 }`;
            document.head.append(style);
            const box = document.createElement('div');
            box.append(document.createElement('span'));
            document.body.append(box);
            __SITUATE_EXECUTOR__.receive = () => {
                const scaled = matchMedia('(resolution: 1.25dppx)');
                const ready = () => __SITUATE_EXECUTOR__.send('scaled');
                if (scaled.matches) ready();
                else scaled.addEventListener('change', ready, { once: true });
            };
        "#.into(),
    }, Arc::new(move |event| { let _ = tx.send(event); })).await?;
    let windows = app.webview_windows();
    let window = windows.values().next().ok_or("preview-window-missing")?;
    let (scaled, applied) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |view| {
            let controller = view.controller();
            let result = (|| {
                let controller3 = controller.cast::<ICoreWebView2Controller3>()?;
                // Match production's disabled DevTools UI and change only this view's scale.
                unsafe {
                    controller
                        .CoreWebView2()?
                        .Settings()?
                        .SetAreDevToolsEnabled(false)?;
                    controller3.SetShouldDetectMonitorScaleChanges(false)?;
                    controller3.SetRasterizationScale(1.25)
                }
            })();
            let _ = scaled.send(result.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    applied.await.map_err(|e| e.to_string())??;
    handle.send(json!("paint")).await?;
    expect_message(&mut rx, "windows-preview", json!("scaled")).await?;
    let rect = CaptureRect {
        x: 100.0,
        y: 160.0,
        width: 40.0,
        height: 60.0,
    };
    let image = handle
        .capture(rect)
        .await
        .map_err(|e| format!("preview-capture:{e}"))?;
    assert_preview_png(&image)?;
    if handle.capture(CaptureRect { x: 1010.0, ..rect }).await
        != Err("native.plugins.checkInvalid".into())
    {
        return Err("preview-out-of-bounds-admitted".into());
    }
    if window.is_visible().map_err(|e| e.to_string())?
        || window.is_focused().map_err(|e| e.to_string())?
    {
        return Err("preview-visible-or-focused".into());
    }
    let mut pending = Box::pin(handle.capture(rect));
    std::future::poll_fn(|cx| match pending.as_mut().poll(cx) {
        Poll::Pending => Poll::Ready(Ok(())),
        Poll::Ready(_) => Poll::Ready(Err("preview-capture-not-pending")),
    })
    .await?;
    handle.close().await?;
    if pending.await != Err("executor.closed".into())
        || handle.capture(rect).await != Err("executor.closed".into())
        || !app.webview_windows().is_empty()
    {
        return Err("preview-close-did-not-fence-capture".into());
    }
    Ok(())
}

fn assert_preview_png(image: &str) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image)
        .map_err(|e| e.to_string())?;
    let mut reader = png::Decoder::new(Cursor::new(bytes))
        .read_info()
        .map_err(|e| e.to_string())?;
    let mut pixels = vec![0; reader.output_buffer_size().ok_or("preview-invalid-png")?];
    let info = reader.next_frame(&mut pixels).map_err(|e| e.to_string())?;
    if (info.width, info.height) != (40, 60) || info.bit_depth != png::BitDepth::Eight {
        return Err(format!("preview-size:{}x{}", info.width, info.height));
    }
    let channels = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        _ => return Err("preview-color-type".into()),
    };
    for (i, pixel) in pixels[..info.buffer_size()]
        .chunks_exact(channels)
        .enumerate()
    {
        let expected = if i / 40 < 32 {
            [0, 255, 0]
        } else {
            [0, 0, 255]
        };
        if pixel[..3] != expected {
            return Err(format!("preview-wrong-pixel:{i}:{pixel:?}"));
        }
    }
    Ok(())
}

async fn expect_message(
    rx: &mut mpsc::UnboundedReceiver<ExecutorEvent>,
    generation: &str,
    expected: Value,
) -> Result<(), String> {
    match next(rx).await? {
        ExecutorEvent::Message {
            workspace_generation,
            payload,
        } if workspace_generation == generation && payload == expected => Ok(()),
        event => Err(format!("unexpected-executor-event:{event:?}")),
    }
}
