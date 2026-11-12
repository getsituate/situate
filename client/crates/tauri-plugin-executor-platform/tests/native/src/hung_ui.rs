use super::*;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, webview::PageLoadEvent};
use tokio::sync::oneshot;

#[derive(Default)]
pub(super) struct LoopEntry(Mutex<Option<oneshot::Sender<()>>>);

pub(super) fn invoke(invoke: tauri::ipc::Invoke) -> bool {
    let webview = invoke.message.webview();
    if invoke.message.command() != "main_ui_loop_entered" || webview.label() != "main-ui" {
        invoke.resolver.reject("unexpected-fixture-command");
        return true;
    }
    if let Some(tx) = webview
        .app_handle()
        .state::<LoopEntry>()
        .0
        .lock()
        .unwrap()
        .take()
    {
        let _ = tx.send(());
    }
    invoke.resolver.resolve(());
    true
}

pub(super) struct HungUi {
    window: WebviewWindow,
    canary: Arc<AtomicBool>,
    destroyed: oneshot::Receiver<()>,
}

impl HungUi {
    pub(super) async fn open(app: AppHandle) -> Result<Self, String> {
        let (created_tx, created_rx) = oneshot::channel();
        let (loaded_tx, loaded_rx) = oneshot::channel();
        let loaded = Mutex::new(Some(loaded_tx));
        let (entered_tx, entered_rx) = oneshot::channel();
        *app.state::<LoopEntry>().0.lock().unwrap() = Some(entered_tx);
        let (destroyed_tx, destroyed_rx) = oneshot::channel();
        let destroyed = Mutex::new(Some(destroyed_tx));
        let target = app.clone();
        app.run_on_main_thread(move || {
            let window =
                WebviewWindowBuilder::new(&target, "main-ui", WebviewUrl::App("index.html".into()))
                    .title("Executor fixture")
                    .visible(true)
                    .focused(false)
                    .incognito(false)
                    .on_page_load(move |window, payload| {
                        if payload.event() == PageLoadEvent::Finished
                            && let Some(tx) = loaded.lock().unwrap().take()
                        {
                            let tx = Mutex::new(Some(tx));
                            let _ = window.eval_with_callback("6 * 7", move |result| {
                                if let Some(tx) = tx.lock().unwrap().take() {
                                    let _ = tx.send(result);
                                }
                            });
                        }
                    })
                    .build()
                    .map_err(|_| "main-ui-create-failed".to_string());
            if let Ok(window) = &window {
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Destroyed)
                        && let Some(tx) = destroyed.lock().unwrap().take()
                    {
                        let _ = tx.send(());
                    }
                });
            }
            let _ = created_tx.send(window);
        })
        .map_err(|_| "main-ui-dispatch-failed")?;
        let window = timeout(Duration::from_secs(5), created_rx)
            .await
            .map_err(|_| "main-ui-create-timeout")?
            .map_err(|_| "main-ui-create-lost")??;
        let normal = timeout(Duration::from_secs(10), loaded_rx)
            .await
            .map_err(|_| "main-ui-load-timeout")?
            .map_err(|_| "main-ui-load-lost")?;
        if normal != "42" {
            return Err("main-ui-canary-mismatch".into());
        }
        window
            .eval("void window.__TAURI_INTERNALS__.invoke('main_ui_loop_entered'); for (;;) {}")
            .map_err(|_| "main-ui-loop-dispatch-failed")?;
        timeout(Duration::from_secs(5), entered_rx)
            .await
            .map_err(|_| "main-ui-loop-entry-timeout")?
            .map_err(|_| "main-ui-loop-entry-lost")?;
        let canary = Arc::new(AtomicBool::new(false));
        let observed = canary.clone();
        window
            .eval_with_callback("6 * 7", move |_| {
                observed.store(true, Ordering::SeqCst);
            })
            .map_err(|_| "main-ui-canary-dispatch-failed")?;
        Ok(Self {
            window,
            canary,
            destroyed: destroyed_rx,
        })
    }

    pub(super) fn answered_canary(&self) -> bool {
        self.canary.load(Ordering::SeqCst)
    }

    pub(super) async fn close(self) -> Result<(), String> {
        self.window
            .destroy()
            .map_err(|_| "main-ui-destroy-failed")?;
        timeout(Duration::from_secs(5), self.destroyed)
            .await
            .map_err(|_| "main-ui-destroy-timeout")?
            .map_err(|_| "main-ui-destroy-lost")?;
        Ok(())
    }
}
