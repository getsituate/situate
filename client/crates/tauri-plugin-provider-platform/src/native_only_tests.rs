use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets},
    utils::acl::ExecutionContext,
    webview::InvokeRequest,
};

#[test]
fn webview_cannot_reach_native_commands_even_with_accidental_acl_grants() {
    let commands = [
        "store",
        "key_get",
        "key_set",
        "key_delete",
        "openBrowser",
        "open_browser",
        "openAuthBrowser",
        "finishAuthBrowser",
        "open_auth_browser",
        "finish_auth_browser",
        "requestLocalNetwork",
        "registerListener",
    ];
    let mut context = mock_context(noop_assets());
    for command in commands {
        context.runtime_authority_mut().__allow_command(
            format!("plugin:provider-platform|{command}"),
            ExecutionContext::Local,
        );
    }
    let app = mock_builder()
        .plugin(super::builder().build())
        .build(context)
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for command in commands {
        let result = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: format!("plugin:provider-platform|{command}"),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: InvokeBody::Json(
                    serde_json::json!({"operation":"get","account":"synthetic"}),
                ),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        );
        assert!(
            matches!(result, Err(value) if value == serde_json::json!("native.ai.secureStore.failed")),
            "{command}"
        );
    }
}
