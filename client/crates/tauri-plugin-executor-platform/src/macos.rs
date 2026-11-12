use super::*;
use std::sync::atomic::AtomicBool;
use tauri::{WebviewUrl, WebviewWindowBuilder, WindowEvent, ipc::InvokeBody};

pub(super) fn bridge() -> &'static str {
    "event => { window.__TAURI_INTERNALS__.invoke('plugin:executor-platform|event', {event}).catch(() => {}); }"
}

pub(super) fn configure(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        .register_uri_scheme_protocol("situate-executor", |context, request| {
            let id = request.uri().path().trim_start_matches('/');
            let html = context
                .app_handle()
                .state::<Sessions>()
                .0
                .lock()
                .unwrap()
                .get(id)
                .map(|session| {
                    (
                        session.document.clone(),
                        document::policy(session.document_kind),
                    )
                });
            match html {
                Some((html, csp)) => tauri::http::Response::builder()
                    .header("Content-Type", "text/html; charset=utf-8")
                    .header("Content-Security-Policy", csp)
                    .header("Cache-Control", "no-store")
                    .body(html.into_bytes())
                    .unwrap(),
                None => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .invoke_handler(|invoke| {
            let webview = invoke.message.webview();
            let app = webview.app_handle();
            let session = app
                .state::<Sessions>()
                .0
                .lock()
                .unwrap()
                .get(webview.label())
                .cloned();
            if invoke.message.command() != "event" || session.is_none() {
                invoke.resolver.reject("executor.nativeOnly");
                return true;
            }
            let InvokeBody::Json(body) = invoke.message.payload() else {
                invoke.resolver.reject("executor.invalidMessage");
                return true;
            };
            let Some(event) = body
                .get("event")
                .filter(|v| v.to_string().len() <= document::MAX_BYTES)
            else {
                invoke.resolver.reject("executor.invalidMessage");
                return true;
            };
            ExecutorHandle {
                app: app.clone(),
                session: session.unwrap(),
            }
            .event(event.clone());
            invoke.resolver.resolve(());
            true
        })
}

pub(super) fn setup(app: &AppHandle<Wry>) -> tauri::Result<()> {
    // Grant transport only; the invoke handler additionally requires a live native-owned label.
    app.add_capability(
        tauri::ipc::CapabilityBuilder::new("executor-platform-transport")
            .webview("executor-*")
            .remote("situate-executor://localhost/*".into())
            .permission("executor-platform:allow-event"),
    )
}

pub(super) async fn open(handle: &ExecutorHandle) -> Result<(), String> {
    let target = handle.clone();
    on_main(&handle.app, move || {
        if target.session.lifecycle.lock().unwrap().is_closed() {
            return Err("executor.closed".into());
        }
        let url: tauri::Url = format!("situate-executor://localhost/{}", target.session.id)
            .parse()
            .unwrap();
        let expected_url = url.clone();
        let first_navigation = AtomicBool::new(true);
        let navigation_target = target.clone();
        let builder = WebviewWindowBuilder::new(
            &target.app,
            &target.session.id,
            WebviewUrl::CustomProtocol(url),
        )
        .title("Executor")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .decorations(false)
        .incognito(true)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_navigation(move |url| {
            if url == &expected_url && first_navigation.swap(false, Ordering::SeqCst) {
                return true;
            }
            let target = navigation_target.clone();
            tauri::async_runtime::spawn(async move {
                let _ = terminate(target, LossReason::Navigation).await;
            });
            false
        });
        let builder = if target.session.document_kind == DocumentKind::Preview {
            builder
                .inner_size(1024.0, 768.0)
                .resizable(false)
                .focusable(false)
        } else {
            builder
        };
        let window = builder.build().map_err(|_| "executor.openFailed")?;
        target.session.created.store(true, Ordering::SeqCst);
        let closed = target.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                closed.lose(LossReason::ProcessTerminated);
                let target = closed.clone();
                // Tauri drops the native WebView wrappers after notifying window listeners.
                tauri::async_runtime::spawn(async move {
                    let app = target.app.clone();
                    let _ = on_main(&app, move || {
                        target.stopped();
                        Ok(())
                    })
                    .await;
                });
            }
        });
        Ok(())
    })
    .await
}

pub(super) async fn send(handle: &ExecutorHandle, script: String) -> Result<(), String> {
    let target = handle.clone();
    on_main(&handle.app, move || {
        if target.session.lifecycle.lock().unwrap().is_closed() {
            return Err("executor.closed".into());
        }
        target
            .app
            .get_webview_window(&target.session.id)
            .ok_or("executor.closed")?
            .eval(&script)
            .map_err(|_| "executor.sendFailed".into())
    })
    .await
}

pub(super) async fn close(handle: &ExecutorHandle) -> Result<(), String> {
    let app = handle.app.clone();
    let id = handle.session.id.clone();
    let mut stopped = handle.session.stopped.subscribe();
    on_main(&handle.app, move || {
        if let Some(window) = app.get_webview_window(&id) {
            window.destroy().map_err(|_| "executor.closeFailed")?;
        }
        Ok(())
    })
    .await?;
    if handle.session.created.load(Ordering::SeqCst) {
        while !*stopped.borrow_and_update() {
            stopped
                .changed()
                .await
                .map_err(|_| "executor.closeFailed")?;
        }
    }
    Ok(())
}

async fn on_main<T: Send + 'static>(
    app: &AppHandle<Wry>,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(work());
    })
    .map_err(|_| "executor.dispatchFailed")?;
    rx.await
        .map_err(|_| "executor.dispatchFailed".to_string())?
}
