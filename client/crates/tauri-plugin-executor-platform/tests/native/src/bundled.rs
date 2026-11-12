use super::*;

fn load(generation: u64, service: &str) -> Value {
    json!({
        "type":"load", "generation":generation, "pluginId":"fixture",
        "source": {
            "manifest":{"schemaVersion":2,"id":"fixture","name":"Fixture","description":"Fixture","skills":[],"serviceEntry":"service.js"},
            "serviceEntry":service, "uiEntry":null,
            "modules":{"lib.js":"export const value = 42;"}, "skills":[],
        }
    })
}

async fn event(
    rx: &mut mpsc::UnboundedReceiver<ExecutorEvent>,
    kind: &str,
    generation: u64,
) -> Result<Value, String> {
    match next(rx)
        .await
        .map_err(|error| format!("{error}:{kind}:{generation}"))?
    {
        ExecutorEvent::Message { payload, .. }
            if payload["type"] == kind && payload["generation"] == generation =>
        {
            Ok(payload)
        }
        event => Err(format!("unexpected-bundled-event:{event:?}")),
    }
}

pub(super) async fn check(app: AppHandle, source: String) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let handle = Executor::new(app)
        .open(
            OpenRequest {
                document_kind: tauri_plugin_executor_platform::DocumentKind::Supervisor,
                workspace_generation: "bundled-fixture".into(),
                supervisor_source: source,
            },
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .await?;
    let service = r#"import {value} from './lib.js';
      export default () => ({
        exports:{answer:(args,context)=>({value:value + args.offset,invocationId:context.invocationId})},
        tools:[{name:'loop',description:'Loop',parameters:{type:'object'},execute(_args,context){context.progress('entered');for(;;){}}}]
      });"#;
    handle.send(load(1, service)).await?;
    let ready = event(&mut rx, "ready", 1).await?;
    if ready["exports"] != json!(["answer"]) {
        return Err("bundled-exports-missing".into());
    }
    handle.send(json!({"type":"invoke","generation":1,"invocationId":"native-probe","kind":"export","name":"answer","args":{"offset":0}})).await?;
    let result = event(&mut rx, "result", 1).await?;
    if result["result"] != json!({"value":42,"invocationId":"native-probe"}) {
        return Err("bundled-result-mismatch".into());
    }
    handle
        .send(json!({"type":"terminate","generation":1}))
        .await?;
    event(&mut rx, "terminated", 1).await?;

    handle
        .send(load(
            2,
            "postMessage({type:'ready',generation:2,tools:[],exports:[]});for(;;){}",
        ))
        .await?;
    event(&mut rx, "ready", 2).await?;
    handle
        .send(json!({"type":"terminate","generation":2}))
        .await?;
    event(&mut rx, "terminated", 2).await?;

    for (generation, kind) in [(3, "tool"), (4, "check")] {
        handle.send(load(generation, service)).await?;
        event(&mut rx, "ready", generation).await?;
        handle.send(json!({"type":"invoke","generation":generation,"invocationId":"loop","kind":kind,"name":"loop","args":{},"script":"host.progress('entered');for(;;){}"})).await?;
        event(&mut rx, "progress", generation).await?;
        handle
            .send(json!({"type":"terminate","generation":generation}))
            .await?;
        event(&mut rx, "terminated", generation).await?;
    }
    handle.close().await?;
    match next(&mut rx).await? {
        ExecutorEvent::Lost {
            reason: LossReason::Closed,
            ..
        } => {}
        _ => return Err("bundled-close-not-revoked".into()),
    }
    match next(&mut rx).await? {
        ExecutorEvent::Stopped { .. } => Ok(()),
        _ => Err("bundled-close-not-stopped".into()),
    }
}
