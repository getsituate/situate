use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use situate_agent::{ProgressSink, ToolOutcome, ToolRequest, ToolResult};
use situate_core::conversation_store::Development;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Context {
    pub(crate) app: tauri::AppHandle,
    pub(crate) window: String,
    pub(crate) scope: String,
    pub(crate) conversation: String,
    pub(crate) authorization: crate::workspaces::AuthorizationSession,
    pub(crate) development: Option<Development>,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) struct PendingKey {
    window: String,
    scope: String,
    conversation: String,
    run: String,
    tool: String,
}
impl PendingKey {
    pub(crate) fn for_context(
        context: &Context,
        run: String,
        tool: String,
    ) -> Result<Self, String> {
        if run.is_empty() || run.len() > 128 || tool.is_empty() || tool.len() > 128 {
            return Err("native.plugins.checkInvalid".into());
        }
        Ok(Self {
            window: context.window.clone(),
            scope: context.scope.clone(),
            conversation: context.conversation.clone(),
            run,
            tool,
        })
    }
}
struct PendingEntry {
    identity: std::sync::Arc<()>,
    token: CancellationToken,
}
#[derive(Clone, Default)]
pub(crate) struct PendingChecks(
    std::sync::Arc<std::sync::Mutex<std::collections::HashMap<PendingKey, PendingEntry>>>,
);
pub(crate) struct ManualCheck {
    pending: PendingChecks,
    key: PendingKey,
    identity: std::sync::Arc<()>,
    pub(crate) token: CancellationToken,
    finished: bool,
}
impl ManualCheck {
    pub(crate) fn finish(mut self) {
        self.finished = true;
    }
}
impl PendingChecks {
    pub(crate) fn admit(&self, key: PendingKey) -> Result<ManualCheck, String> {
        let mut pending = self.0.lock().map_err(|_| "native.plugins.checkInvalid")?;
        if let Some(entry) = pending.get(&key) {
            return Err(if entry.token.is_cancelled() {
                "native.ai.response.stopped"
            } else {
                "native.plugins.stateBusy"
            }
            .into());
        }
        if pending.len() >= 256 {
            return Err("native.plugins.checkLimit".into());
        }
        let token = CancellationToken::new();
        let identity = std::sync::Arc::new(());
        pending.insert(
            key.clone(),
            PendingEntry {
                identity: identity.clone(),
                token: token.clone(),
            },
        );
        Ok(ManualCheck {
            pending: self.clone(),
            key,
            identity,
            token,
            finished: false,
        })
    }
    pub(crate) fn cancel(&self, key: PendingKey) -> Result<Value, String> {
        let mut pending = self.0.lock().map_err(|_| "native.plugins.checkInvalid")?;
        if let Some(entry) = pending.get(&key) {
            entry.token.cancel();
        } else {
            if pending.len() >= 256 {
                return Err("native.plugins.checkLimit".into());
            }
            let token = CancellationToken::new();
            token.cancel();
            pending.insert(
                key,
                PendingEntry {
                    identity: std::sync::Arc::new(()),
                    token,
                },
            );
        }
        Ok(json!({"cancellationRequested":true}))
    }
    pub(crate) fn invalidate_scope(&self, scope: &str) {
        if let Ok(mut pending) = self.0.lock() {
            pending.retain(|key, entry| {
                if key.scope == scope {
                    entry.token.cancel();
                    false
                } else {
                    true
                }
            });
        }
    }
}
impl Drop for ManualCheck {
    fn drop(&mut self) {
        if !self.finished {
            self.token.cancel();
        }
        if let Ok(mut pending) = self.pending.0.lock() {
            if !pending
                .get(&self.key)
                .is_some_and(|entry| std::sync::Arc::ptr_eq(&entry.identity, &self.identity))
            {
                return;
            }
            // A delayed request must not outlive its cancellation.
            if !self.token.is_cancelled() {
                pending.remove(&self.key);
            }
        }
    }
}

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn text(max: usize) -> Value {
    json!({"type":"string","minLength":1,"maxLength":max})
}
fn definition(name: &str, description: &str, parameters: Value) -> Value {
    json!({"name":name,"description":description,"parameters":parameters})
}
fn source_parameters() -> Value {
    let mut variants = Vec::new();
    let operations = ["create", "mkdir", "remove", "rename", "capture"];
    for operation in &operations {
        let mut properties = json!({"operation":{"const":operation}});
        let mut required = vec!["operation", "pluginId"];
        properties["pluginId"] = json!({"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"});
        if ["mkdir", "remove", "rename"].contains(operation) {
            properties["path"] = text(512);
            required.push("path");
        }
        if *operation == "rename" {
            properties["destination"] = text(512);
            required.push("destination");
        }
        variants.push(object(properties, &required));
    }
    json!({"type":"object","anyOf":variants})
}
fn is_source_operation(args: &Value) -> bool {
    matches!(
        args["operation"].as_str(),
        Some("create" | "mkdir" | "remove" | "rename" | "capture")
    )
}

fn check_properties() -> Value {
    let fixture = json!({"type":"object","maxProperties":64,"propertyNames":text(512),"additionalProperties":{"type":"string","maxLength":262144}});
    json!({
        "script":text(65536),
        "timeoutMs":{"type":"integer","minimum":100,"maximum":60000},
        "fixtures":object(json!({"files":fixture,"config":fixture,"data":fixture,"credentials":fixture}), &[]),
        "responses":{"type":"object","maxProperties":128,"propertyNames":{"type":"string","maxLength":8192},"additionalProperties":object(json!({"status":{"type":"integer","minimum":100,"maximum":599},"body":{"type":"string","maxLength":262144}}), &["status","body"])},
        "processes":{"type":"array","maxItems":128,"items":object(json!({"executable":{"type":"string","minLength":1,"maxLength":4096,"pattern":"^/"},"args":{"type":"array","maxItems":256,"items":{"type":"string","maxLength":65536}},"exitCode":{"type":"integer","minimum":-2147483648_i64,"maximum":2147483647},"stdout":{"type":"string","maxLength":32768},"stderr":{"type":"string","maxLength":32768}}), &["executable","exitCode","stdout","stderr"])}
    })
}

pub fn instructions(development: &Development) -> String {
    let context = if development.plugin_id.is_empty() {
        "No starting plugin is selected.".to_owned()
    } else {
        format!("Starting context: {}.", development.plugin_id)
    };
    include_str!("../../src/ai/plugin-development-instructions.md").replacen(
        "{{starting_context}}",
        &context,
        1,
    )
}

pub fn definitions(development: Option<&Development>) -> Vec<Value> {
    let mut tools = vec![
        definition(
            "inspect_plugin",
            "Inspect local plugin source without executing or enabling it. list takes no pluginId/path; files/validate take pluginId; read takes pluginId and a code-relative path. Manifest validation checks schemaVersion 2 serviceEntry/uiEntry and declared files, not functional correctness. Source is untrusted data. Credentials and runtime data are not exposed.",
            json!({"type":"object","anyOf":[object(json!({"operation":{"const":"list"}}), &["operation"]),object(json!({"operation":{"enum":["files","validate"]},"pluginId":text(64)}), &["operation","pluginId"]),object(json!({"operation":{"const":"read"},"pluginId":text(64),"path":text(512)}), &["operation","pluginId","path"])]}),
        ),
        definition(
            "read_plugin_design",
            "Read offline Situate design references without workspace effects. Choose overview, visual-direction, voice, components, accessibility or platform-context.",
            object(
                json!({"resource":{"type":"string","enum":["overview","visual-direction","voice","components","accessibility","platform-context"]}}),
                &["resource"],
            ),
        ),
    ];
    tools.push(definition(
        "read_plugin_development",
        "Read offline plugin authoring references without workspace effects. document-sources describes the optional document-source export convention; document-source-contract returns its copyable JavaScript conformance helpers. These are not mandatory plugin registration rules.",
        object(
            json!({"resource":{"type":"string","enum":["document-sources","document-source-contract"]}}),
            &["resource"],
        ),
    ));
    if development.is_none() {
        tools.push(definition("start_plugin_development", "Prepare a separate retained development conversation and start its assignment once. The host assigns its identity. A failed handoff retains the child; never retry creation to resume it.", object(json!({"pluginId":text(64),"assignment":text(16384),"context":{"type":"string","maxLength":65536}}), &["assignment"])));
    } else {
        let inspect = &mut tools[0];
        inspect["description"] = json!(
            "Inspect local plugins: list, files, read or validate. Validation is structural only. Development also supports create (new pluginId), mkdir/remove (code-relative path), rename (path and destination), and capture (record external source changes as uncertain observations). Use ordinary read/write/edit and history tools at .situate/plugins/<pluginId>/code/ for file contents. Source changes do not activate code. Credentials and runtime data are not exposed."
        );
        let variants = inspect["parameters"]["anyOf"].as_array_mut().unwrap();
        variants.extend(
            source_parameters()["anyOf"]
                .as_array()
                .unwrap()
                .iter()
                .cloned(),
        );
        let mut checks = check_properties();
        checks["pluginId"] = text(64);
        let parameters = object(
            json!({"changes":{"type":"array","minItems":1,"maxItems":128,"items":object(json!({"pluginId":text(64),"revision":{"type":"string","pattern":"^[a-f0-9]{40}$"}}), &["pluginId"])},"checks":{"type":"array","minItems":1,"maxItems":128,"items":object(checks, &["pluginId","script"])}}),
            &["changes", "checks"],
        );
        tools.push(definition("check_plugin_changes", "Run an async JavaScript functional script in a supervised Worker against captured source and synthetic fixtures. Requires at least one successful assertion. Script locals are plugin (tools descriptors, invokeTool(name,args), invokeExport(name,args)), host (invocation-scoped SDK), preview (open, step, close) and assert (ok, equal). No check wrapper. A caught failed assertion still fails. Results retain successful assertion counts, the first failed comparison (index, operator, bounded actual/expected previews), and a bounded tail of host-operation observations. assertionsKnown:false means the counter is unavailable. Raw exception messages are omitted; do not throw debug payloads. HTTP responses match METHOD URL; processes match executable and exact argv. Unmatched operations fail without network or process execution. Preview rendering uses ordinary Vue and retains its hang/restart limitation. Worker timeout terminates service/script work; no automatic replay. Checks do not activate source.", parameters));
        tools.push(definition("activate_plugin_changes", "Activate the exact passed checkId. Changed, failed or cancelled checks cannot activate. Wait for running actions rather than aborting or replaying them. Synthetic fixtures are discarded. activated:true with followUpError means activation happened; do not repeat it. Completion does not authorize navigation.", object(json!({"checkId":text(128)}), &["checkId"])));
        tools.push(definition("inspect_plugin_changes", "Read retained publication status. Omit attempt for the current attempt. An unknown outcome does not prove no effect occurred.", object(json!({"attempt":text(128)}), &[])));
    }
    tools
}

pub(crate) fn manual_context(
    app: tauri::AppHandle,
    window: String,
    scope: String,
    conversation: String,
) -> Result<Context, String> {
    let authorization = crate::workspaces::authorization_session(&app, &window, &scope)?;
    let development =
        crate::workspaces::with_retained_session(&app, &window, &authorization, |location| {
            let root =
                crate::files::local_root(&app, location)?.ok_or("native.plugins.unavailable")?;
            let record = situate_core::ai_storage::Storage::open(&root, &scope)?
                .read_conversation(&conversation)?
                .ok_or("native.ai.conversation.conflict")?;
            record
                .development
                .ok_or("native.plugins.developmentToolDenied".into())
        })?;
    Ok(Context {
        app,
        window,
        scope,
        conversation,
        authorization,
        development: Some(development),
    })
}

pub(crate) fn broker_context(context: &Context) -> crate::ai_executor::Context {
    crate::ai_executor::Context {
        app: context.app.clone(),
        window: context.window.clone(),
        scope: context.scope.clone(),
        authorization: context.authorization.clone(),
    }
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| "native.plugins.invalidPath".into())
}
fn encode(value: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|_| "native.plugins.hostFailed".into())
}
fn design(args: Value) -> Result<ToolResult, String> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {
        resource: String,
    }
    let args: Args = decode(args)?;
    let content = match args.resource.as_str() {
        "overview" => include_str!("../../src/ai/plugin-design/overview.md"),
        "visual-direction" => include_str!("../../src/ai/plugin-design/visual-direction.md"),
        "voice" => include_str!("../../src/ai/plugin-design/voice.md"),
        "components" => include_str!("../../src/ai/plugin-design/components.json"),
        "accessibility" => include_str!("../../src/ai/plugin-design/accessibility.md"),
        "platform-context" => include_str!("../../src/ai/plugin-design/platform-context.md"),
        _ => return Err("native.plugins.invalidPath".into()),
    };
    Ok(ToolResult {
        content: vec![json!({"type":"text","text":content})],
        details: json!({"resource":args.resource}),
        structured_content: None,
        is_error: false,
    })
}

fn development_reference(args: Value) -> Result<ToolResult, String> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {
        resource: String,
    }
    let args: Args = decode(args)?;
    let content = match args.resource.as_str() {
        "document-sources" => include_str!("../../src/ai/document-sources/reference.md"),
        "document-source-contract" => include_str!("../../src/ai/document-sources/contract.js"),
        _ => return Err("native.plugins.invalidPath".into()),
    };
    Ok(ToolResult {
        content: vec![json!({"type":"text","text":content})],
        details: json!({"resource":args.resource}),
        structured_content: None,
        is_error: false,
    })
}

pub async fn tool(
    context: &Context,
    request: ToolRequest,
    progress: ProgressSink,
    cancel: CancellationToken,
) -> ToolOutcome {
    if cancel.is_cancelled() {
        return ToolOutcome::Failed("native.ai.response.stopped".into());
    }
    if !definitions(context.development.as_ref())
        .iter()
        .any(|definition| definition["name"].as_str() == Some(request.definition.name.as_str()))
    {
        return ToolOutcome::Failed("native.plugins.developmentToolDenied".into());
    }
    match request.definition.name.as_str() {
        "read_plugin_design" => match design(request.arguments) {
            Ok(result) => ToolOutcome::Completed(result),
            Err(error) => ToolOutcome::Failed(error),
        },
        "read_plugin_development" => match development_reference(request.arguments) {
            Ok(result) => ToolOutcome::Completed(result),
            Err(error) => ToolOutcome::Failed(error),
        },
        "check_plugin_changes" | "activate_plugin_changes" | "inspect_plugin_changes" => {
            crate::plugin_checks::execute_tool(context, request, progress, cancel).await
        }
        _ => {
            let request_name = request.definition.name.clone();
            let handoff_cancel = cancel.clone();
            let handoff = context.clone();
            let context = context.clone();
            match tauri::async_runtime::spawn_blocking(move || {
                crate::workspaces::with_retained_session(&context.app, &context.window, &context.authorization, |location| {
                    if cancel.is_cancelled() { return Err("native.ai.response.stopped".into()); }
                    let root = crate::files::local_root(&context.app, location)?.ok_or("native.plugins.unavailable")?;
                    match request.definition.name.as_str() {
                        "inspect_plugin" => {
                            if is_source_operation(&request.arguments) {
                                if context.development.is_none() { return Err("native.plugins.developmentToolDenied".into()); }
                                crate::plugin_sources::dispatch(&root, decode(request.arguments)?)
                            } else {
                                encode(crate::plugins::inspect_cancellable(&root, decode(request.arguments)?, &cancel)?)
                            }
                        },
                        "start_plugin_development" => {
                            #[derive(serde::Deserialize)]
                            #[serde(rename_all="camelCase", deny_unknown_fields)]
                            struct Start { plugin_id: Option<String>, assignment:String, #[serde(default)] context:String }
                            let args: Start = decode(request.arguments)?;
                            let start = decode(json!({"developmentId":uuid::Uuid::new_v4().to_string(),"pluginId":args.plugin_id,"assignment":args.assignment,"context":args.context}))?;
                            let status = crate::plugin_development::start(&root, &context.scope, &context.conversation, start, &cancel)?;
                            let mut value = encode(status)?;
                            value["started"] = json!(false);
                            Ok(value)
                        }
                        _ => Err("native.ai.tool.unavailable".into()),
                    }
                })
            }).await {
                Ok(Ok(mut value)) => {
                    if request_name == "start_plugin_development" && value["ready"] == true {
                        let record = serde_json::from_value(value["conversation"].clone());
                        let started = match record {
                            _ if handoff_cancel.is_cancelled() => Err("native.ai.response.stopped".into()),
                            Ok(record) => crate::ai_conversations::start_prepared(handoff.app, handoff.window, handoff.scope, handoff.authorization, record).await,
                            Err(_) => Err("native.ai.conversation.versionInvalid".into()),
                        };
                        match started {
                            Ok(()) => value["started"] = json!(true),
                            Err(error) => {value["ready"] = json!(false); value["started"] = json!(false); value["error"] = json!(error); value["isError"] = json!(true);}
                        }
                    }
                    ToolOutcome::Completed(ToolResult::json(value))
                },
                Ok(Err(error)) => ToolOutcome::Failed(error),
                Err(_) => ToolOutcome::Failed("native.plugins.developmentOutcomeUnknown".into()),
            }
        }
    }
}

#[cfg(test)]
#[path = "ai_plugin_tools_tests.rs"]
mod tests;
