use tauri::Manager;
mod ai;
pub(crate) use ai::conversations as ai_conversations;
mod ai_builtin_tools;
mod ai_executor;
mod ai_onboarding;
mod ai_plugin_tools;
mod ai_protocol;
mod appearance;
mod change_history;
mod codex_oauth;
#[cfg(any(test, feature = "native-smoke"))]
mod conversation_fixtures;
mod conversation_projection;
mod device_locale;
mod diagnostics;
mod dictation;
mod file_tool;
mod files;
mod layout;
mod lifecycle;
mod localization;
mod onboarding;
mod openai_oauth;
mod plugin_actions;
mod plugin_changes;
mod plugin_checks;
mod plugin_development;
mod plugin_disable;
mod plugin_file_queries;
mod plugin_host;
mod plugin_preview;
mod plugin_recovery;
mod plugin_runtime;
mod plugin_source_files;
mod plugin_sources;
mod plugins;
mod provider_platform;
mod recovery;
mod recovery_email;
mod shell_host;
mod updates;
mod web_tools;
mod windows;
mod workspace_preparation;
mod workspaces;

#[cfg(feature = "native-smoke")]
#[path = "../tests/support/agent_e2e.rs"]
mod agent_e2e;
#[cfg(feature = "native-smoke")]
#[path = "../tests/support/native_smoke.rs"]
mod native_smoke;

macro_rules! application_handler {
    ($($extra:path),* $(,)?) => {
        tauri::generate_handler![
            crate::save_text,
            crate::updates::updates_snapshot,
            crate::updates::updates_check,
            crate::updates::updates_install,
            crate::updates::updates_prepare_ack,
            crate::updates::updates_preparation_status,
            crate::dictation::dictation_snapshot,
            crate::dictation::dictation_start,
            crate::dictation::dictation_control,
            crate::plugin_recovery::plugin_recovery_mode,
            crate::plugin_recovery::plugin_recovery_state,
            crate::plugin_recovery::plugin_recovery_resume,
            crate::plugins::plugins_source,
            crate::onboarding::onboarding_load,
            crate::onboarding::onboarding_preview,
            crate::onboarding::onboarding_prepare_instructions,
            crate::onboarding::onboarding_save,
            crate::onboarding::onboarding_action,
            crate::onboarding::onboarding_development_prepare,
            crate::plugin_development::plugin_development_create,
            crate::ai_executor::plugin_executor,
            crate::plugin_disable::plugin_disable,
            crate::plugin_changes::plugin_changes_check,
            crate::change_history::change_revision,
            crate::change_history::change_list,
            crate::plugin_host::plugin_process_abort,
            crate::plugin_development::plugin_development_status,
            crate::plugin_runtime::plugin_runtime,
            crate::appearance::appearance_snapshot,
            crate::appearance::appearance_update,
            crate::localization::localization_snapshot,
            crate::localization::localization_update,
            crate::files::files_request,
            crate::diagnostics::diagnostics_register,
            crate::diagnostics::diagnostics_emit,
            crate::diagnostics::diagnostics_release,
            crate::layout::layout_load,
            crate::layout::layout_save,
            crate::lifecycle::lifecycle_status,
            crate::recovery::recovery_register,
            crate::recovery::recovery_request,
            crate::recovery::recovery_status,
            crate::recovery::recovery_ack,
            crate::recovery_email::recovery_open_email,
            crate::workspaces::workspace_snapshot,
            crate::workspaces::workspace_parent,
            crate::workspaces::workspace_preflight,
            crate::workspaces::workspace_action,
            crate::ai::connections::ai_status,
            crate::ai::connections::ai_preview_conversation_status,
            crate::ai::connections::ai_connections,
            crate::ai::discovery::ai_refresh_models,
            crate::ai::connections::ai_select_connection,
            crate::ai::connections::ai_rename_connection,
            crate::ai::connections::ai_select_conversation_model,
            crate::ai::connections::ai_select_conversation_thinking,
            crate::ai::connections::ai_forget_connection,
            crate::ai::ai_select_model,
            crate::ai::model::ai_settings_load,
            crate::ai::model::ai_settings_save,
            crate::ai::ai_save,
            crate::ai::ai_remove,
            crate::ai_conversations::ai_conversation_snapshot,
            crate::ai_conversations::ai_conversation_history,
            crate::ai_conversations::ai_conversation_ancestor,
            crate::ai_conversations::ai_conversation_subscribe,
            crate::ai_conversations::ai_conversation_ack,
            crate::ai_conversations::ai_conversations_abort,
            crate::ai_conversations::ai_conversation_action,
            crate::ai_conversations::ai_presentation_take,
            crate::ai_conversations::ai_presentation_ack,
            crate::ai_conversations::ai_model_check,
            crate::ai_conversations::ai_model_check_cancel,
            crate::ai::ai_attachment_put,
            crate::ai::ai_attachment_read,
            crate::ai::ai_conversations,
            crate::ai::ai_conversation_read,
            crate::ai::ai_create_conversation,
            crate::ai::ai_prepare_close,
            crate::ai::ai_cancel_close,
            crate::ai::login::ai_openai_start,
            crate::ai::login::ai_openai_wait,
            crate::ai::login::ai_openai_cancel,
            crate::ai::login::codex::ai_codex_start,
            crate::ai::login::codex::ai_codex_wait,
            crate::ai::login::codex::ai_codex_cancel,
            crate::ai::login::codex::ai_codex_open,
            $($extra),*
        ]
    };
}
#[cfg(feature = "native-smoke")]
pub(crate) use application_handler;

#[tauri::command]
fn save_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "native.storage.appDataUnavailable".to_owned())?;
    situate_core::save_text(&directory, &text).map_err(|_| "native.storage.saveFailed".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let recovery_mode = plugin_recovery::PluginRecoveryMode::capture();
    #[cfg(feature = "native-smoke")]
    if !agent_e2e::initialize() {
        return;
    }
    let builder = tauri::Builder::default()
        .manage(recovery_mode)
        .manage(recovery::Recovery::default())
        .manage(plugin_changes::Changes::default())
        .manage(plugin_actions::Actions::default())
        .manage(plugin_disable::Disables::default())
        .manage(plugin_host::Hosts::default())
        .manage(plugin_preview::Renderers::default())
        .manage(ai::Ai::default())
        .manage(ai_conversations::Conversations::default())
        .manage(ai_executor::Executors::default())
        .manage(dictation::Dictation::default())
        .manage(diagnostics::Diagnostics::default())
        .plugin(tauri_plugin_workspace_access::init())
        .plugin(tauri_plugin_provider_platform::init())
        .plugin(tauri_plugin_executor_platform::init())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                updates::window_changed(window.app_handle(), window.label());
                recovery::window_changed(window.app_handle(), window.label());
                window
                    .app_handle()
                    .state::<ai_conversations::Conversations>()
                    .detach_window(window.label());
                plugin_preview::forget_window(window.app_handle(), window.label());
                diagnostics::forget_window(window.app_handle(), window.label());
                dictation::forget_window(window.app_handle(), window.label());
            }
            workspaces::window_event(window, event);
        });

    #[cfg(not(feature = "native-smoke"))]
    let builder = builder
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                updates::window_changed(webview.app_handle(), webview.label());
                recovery::window_changed(webview.app_handle(), webview.label());
                webview
                    .app_handle()
                    .state::<ai_conversations::Conversations>()
                    .detach_window(webview.label());
                plugin_preview::forget_window(webview.app_handle(), webview.label());
                diagnostics::forget_window(webview.app_handle(), webview.label());
                dictation::forget_window(webview.app_handle(), webview.label());
            }
        })
        .setup(|app| {
            diagnostics::setup(app.handle());
            dictation::setup(app.handle());
            workspaces::setup(app.handle())?;
            updates::setup(app.handle());
            Ok(())
        })
        .invoke_handler(application_handler![]);

    #[cfg(feature = "native-smoke")]
    let builder = native_smoke::configure(builder);

    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    for window in &mut context.config_mut().app.windows {
        if window.label == "main" {
            // Supply the native WebView configuration before loading any content.
            window.create = false;
        }
    }

    builder
        .build(context)
        .expect("could not run Situate")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                lifecycle::exit_requested(app, api);
            }
            if matches!(event, tauri::RunEvent::Exit) {
                diagnostics::shutdown(app);
            }
            #[cfg(feature = "native-smoke")]
            if matches!(event, tauri::RunEvent::Exit) {
                agent_e2e::cleanup_on_exit();
            }
        });
}
