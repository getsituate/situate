use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_executor_platform::{
    DocumentKind, Executor, ExecutorEvent, LossReason, OpenRequest,
};
use tokio::{sync::mpsc, time::timeout};

const SUPERVISOR: &str = include_str!("../supervisor.js");

mod bundled;
#[allow(dead_code)]
#[path = "../../../src/document.rs"]
mod document;
mod hung_ui;
mod preview;

async fn next(rx: &mut mpsc::UnboundedReceiver<ExecutorEvent>) -> Result<ExecutorEvent, String> {
    timeout(Duration::from_secs(25), rx.recv())
        .await
        .map_err(|_| "event-timeout")?
        .ok_or_else(|| "event-channel-closed".into())
}
async fn message(
    rx: &mut mpsc::UnboundedReceiver<ExecutorEvent>,
    expected: Value,
) -> Result<(), String> {
    match next(rx).await? {
        ExecutorEvent::Message { payload, .. } if payload == expected => Ok(()),
        event => Err(format!("unexpected-event:{event:?}")),
    }
}

async fn check(app: AppHandle, bundle: Option<String>) -> Result<(), String> {
    preview::check(app.clone()).await?;
    let executor = Executor::new(app.clone());
    let (tx, mut rx) = mpsc::unbounded_channel();
    let handle = executor
        .open(
            OpenRequest {
                document_kind: tauri_plugin_executor_platform::DocumentKind::Supervisor,
                workspace_generation: "native-fixture".into(),
                supervisor_source: SUPERVISOR.into(),
            },
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .await?;
    if app.get_webview_window("main").is_some() {
        return Err("unexpected-main-ui".into());
    }
    let duplicate = executor
        .open(
            OpenRequest {
                document_kind: tauri_plugin_executor_platform::DocumentKind::Supervisor,
                workspace_generation: "native-fixture".into(),
                supervisor_source: SUPERVISOR.into(),
            },
            Arc::new(|_| {}),
        )
        .await;
    if duplicate.is_ok() {
        return Err("duplicate-workspace-admitted".into());
    }
    handle.send(json!("worker")).await?;
    message(
        &mut rx,
        json!({"worker":{"value":42,"network":"blocked","generated":42}}),
    )
    .await?;
    handle.send(json!("stop")).await?;
    message(&mut rx, json!({"stopped":true})).await?;
    handle.send(json!("network")).await?;
    message(&mut rx, json!({"network":"blocked"})).await?;
    handle.close().await?;
    match next(&mut rx).await? {
        ExecutorEvent::Lost {
            reason: LossReason::Closed,
            ..
        } => {}
        _ => return Err("close-not-reported".into()),
    }
    match next(&mut rx).await? {
        ExecutorEvent::Stopped { .. } => {}
        _ => return Err("close-not-stopped".into()),
    }
    handle.close().await?;
    if rx.try_recv().is_ok() {
        return Err("duplicate-loss".into());
    }
    if handle.send(json!("worker")).await.is_ok() {
        return Err("closed-send-admitted".into());
    }

    let (tx, mut rx) = mpsc::unbounded_channel();
    let hung = executor
        .open(
            OpenRequest {
                document_kind: tauri_plugin_executor_platform::DocumentKind::Supervisor,
                workspace_generation: "native-watchdog".into(),
                supervisor_source: SUPERVISOR.into(),
            },
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .await?;
    hung.send(json!("hang")).await?;
    match next(&mut rx).await? {
        ExecutorEvent::Lost {
            reason: LossReason::HeartbeatExpired,
            ..
        } => {}
        _ => return Err("watchdog-not-reported".into()),
    }
    match next(&mut rx).await? {
        ExecutorEvent::Stopped { .. } => {}
        _ => return Err("watchdog-not-stopped".into()),
    }
    hung.close().await?;
    if !app.webview_windows().is_empty() {
        return Err("executor-view-retained".into());
    }
    if let Some(bundle) = bundle {
        let ui = hung_ui::HungUi::open(app.clone()).await?;
        let result = bundled::check(app, bundle).await;
        let answered_canary = ui.answered_canary();
        let closed = ui.close().await;
        result?;
        if answered_canary {
            return Err("main-ui-loop-did-not-block-canary".into());
        }
        closed?;
    }
    Ok(())
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let bundle = args
        .iter()
        .position(|arg| arg == "--supervisor")
        .map(|index| {
            std::fs::read_to_string(args.get(index + 1).expect("missing supervisor path"))
                .expect("could not read shipped supervisor")
        });
    if args.iter().any(|arg| arg == "--print-ios-fixture") {
        println!(
            "{}",
            document::document(
                bundle.as_deref().unwrap_or(SUPERVISOR),
                "event => window.webkit.messageHandlers.executor.postMessage(event)",
                DocumentKind::Supervisor
            )
            .unwrap()
        );
        return;
    }
    tauri::Builder::default()
        .manage(hung_ui::LoopEntry::default())
        .invoke_handler(hung_ui::invoke)
        .plugin(tauri_plugin_executor_platform::init())
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match check(app.clone(), bundle).await {
                    Ok(()) => {
                        println!("executor-native-test: passed");
                        app.exit(0);
                    }
                    Err(error) => {
                        eprintln!("executor-native-test: {error}");
                        app.exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("native fixture application failed")
        .run(|_, event| {
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
            }
        });
}
