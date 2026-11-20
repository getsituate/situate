use super::*;

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
