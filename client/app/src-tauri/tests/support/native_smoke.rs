use std::{
    collections::VecDeque,
    fs,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

#[path = "plugin_runtime_smoke.rs"]
pub(crate) mod plugin_runtime;

fn smoke_application_window(label: &str) -> bool {
    label == "main" || label.starts_with("workspace-")
}

fn watchdog_seconds(
    interactive: bool,
    diagnostics_profile: bool,
    public_repository_only: bool,
    process_connection_only: bool,
    blocking_plugin_view: bool,
) -> u64 {
    // Group builds happen before the blocking-view observation starts.
    if public_repository_only || process_connection_only || blocking_plugin_view {
        180
    } else if interactive {
        300
    } else if diagnostics_profile {
        90
    } else {
        // Both workspace windows run their editor journeys before the process finishes.
        90
    }
}

#[cfg(test)]
mod watchdog_tests {
    use super::watchdog_seconds;

    #[test]
    fn public_repository_deadline_does_not_change_existing_phases() {
        assert_eq!(watchdog_seconds(false, false, false, false, false), 90);
        assert_eq!(watchdog_seconds(false, true, false, false, false), 90);
        assert_eq!(watchdog_seconds(true, false, false, false, false), 300);
        assert_eq!(watchdog_seconds(true, true, false, false, false), 300);
        for interactive in [false, true] {
            for profile in [false, true] {
                assert_eq!(
                    watchdog_seconds(interactive, profile, true, false, false),
                    180
                );
                assert_eq!(
                    watchdog_seconds(interactive, profile, false, true, false),
                    180
                );
            }
        }
    }

    #[test]
    fn blocking_plugin_setup_has_its_own_budget() {
        assert_eq!(watchdog_seconds(false, false, false, false, true), 180);
        assert_eq!(watchdog_seconds(false, true, false, false, true), 180);
    }
}

static FINISHED: AtomicBool = AtomicBool::new(false);
static READY_WINDOWS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(Default::default);
use tauri::{Manager, webview::PageLoadEvent};

static NAVIGATIONS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, u64>>> =
    std::sync::LazyLock::new(Default::default);
static STARTED: std::sync::LazyLock<Instant> = std::sync::LazyLock::new(Instant::now);
static PROGRESS: std::sync::Mutex<VecDeque<serde_json::Value>> =
    std::sync::Mutex::new(VecDeque::new());

pub(crate) fn progress(window: &str, stage: &str, details: serde_json::Value) {
    let event = serde_json::json!({
        "elapsedMs": STARTED.elapsed().as_millis(),
        "window": window,
        "stage": stage,
        "details": details,
    });
    let mut events = PROGRESS.lock().unwrap();
    if events.len() == 64 {
        events.pop_front();
    }
    events.push_back(event.clone());
    println!("SITUATE_SMOKE_PROGRESS {event}");
}

#[tauri::command]
fn verify_smoke_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let actual = fs::read(path.join("text.txt")).map_err(|e| e.to_string())?;
    if actual != text.as_bytes() {
        return Err("Stored bytes do not match the submitted text".into());
    }
    Ok(())
}

#[tauri::command]
fn smoke_progress(window: tauri::WebviewWindow, stage: String) {
    progress(window.label(), &stage, serde_json::Value::Null);
}
#[tauri::command]
fn smoke_localization_replace(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    preferences: situate_core::localization::Preferences,
) -> Result<(), String> {
    let (location, _) = super::workspaces::file_session(&app, window.label(), &scope)?;
    let root = super::files::local_root(&app, &location)?.ok_or("Smoke workspace is not local")?;
    let storage = situate_core::localization::Storage::open(&root)?;
    let defaults = super::device_locale::preferences(&app);
    let expected = storage.snapshot(&defaults, false)?;
    storage.update(&defaults, &preferences, &expected)
}

#[tauri::command]
fn smoke_appearance_replace(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<(), String> {
    super::workspaces::with_current(&app, window.label(), &scope, |location| {
        let root =
            super::files::local_root(&app, location)?.ok_or("Smoke workspace is not local")?;
        fs::write(
            root.join(".situate/appearance.json"),
            br#"{"version":1,"accent":"lemon"}"#,
        )
        .map_err(|_| "Smoke appearance replacement failed".into())
    })
}

#[tauri::command]
async fn smoke_window_state(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    focus: Option<bool>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if focus.unwrap_or(false) {
            #[cfg(target_os = "macos")]
            app.show().map_err(|error| error.to_string())?;
            window.show().map_err(|error| error.to_string())?;
            #[cfg(desktop)]
            window.unminimize().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
        }
        #[cfg(target_os = "macos")]
        let identity = {
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            window
                .with_webview(move |platform| {
                    let _ = sender.send(serde_json::json!({
                        "nativeWindow": format!("{:p}", platform.ns_window()),
                        "webview": format!("{:p}", platform.inner()),
                    }));
                })
                .map_err(|error| error.to_string())?;
            receiver.recv().map_err(|error| error.to_string())?
        };
        #[cfg(not(target_os = "macos"))]
        let identity = serde_json::Value::Null;
        let mut windows: Vec<_> = app.webview_windows().into_keys().collect();
        windows.sort();
        Ok(serde_json::json!({
            "label": window.label(),
            "process": std::process::id(),
            "identity": identity,
            "windows": windows,
            "navigations": NAVIGATIONS.lock().unwrap().get(window.label()).copied().unwrap_or(0),
            "visible": window.is_visible().map_err(|error| error.to_string())?,
            "focused": window.is_focused().map_err(|error| error.to_string())?,
            "size": window.inner_size().map_err(|error| error.to_string())?,
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn smoke_shell_ready(window: tauri::WebviewWindow) {
    READY_WINDOWS.lock().unwrap().insert(window.label().into());
    progress(window.label(), "shell-ready", serde_json::Value::Null);
}

fn diagnostics_selected(directory: &std::path::Path, from_environment: bool) -> bool {
    from_environment || directory.join("smoke-diagnostics").is_file()
}

#[tauri::command]
fn smoke_phase(app: tauri::AppHandle) -> serde_json::Value {
    let directory = app.path().app_data_dir().unwrap();
    let path = directory.join("smoke-restart.json");
    let participants = super::workspaces::file_participants(&app);
    let ready = READY_WINDOWS.lock().unwrap();
    let shell_ready =
        !participants.is_empty() && participants.keys().all(|window| ready.contains(window));
    serde_json::json!({ "restart": path.exists(), "shellReady": shell_ready,
        "isolated": cfg!(desktop),
        "entryCloseOnly": std::env::var("SITUATE_ENTRY_CLOSE_ONLY").as_deref() == Ok("1"),
        "pluginDrafts": cfg!(target_os = "macos"),
        "pluginChecksMode": std::env::var("SITUATE_PLUGIN_CHECKS_PHASE").ok(),
        "handoff": std::env::var("SITUATE_ONBOARDING_HANDOFF_PHASE").ok(),
        "diagnostics": diagnostics_selected(&directory, std::env::var_os("SITUATE_DIAGNOSTICS_SMOKE").is_some()),
        "diagnosticsProfile": std::env::var("SITUATE_DIAGNOSTICS_PROFILE").ok(),
        "picker": path.with_file_name("smoke-use-picker").exists() })
}

#[tauri::command]
fn smoke_checkpoint(app: tauri::AppHandle, restart: bool) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("smoke-restart.json");
    if restart {
        fs::write(path, "{}").map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn finish_smoke_test(app: tauri::AppHandle, error: Option<String>) {
    if crate::agent_e2e::enabled() {
        let _ = crate::agent_e2e::finish(app, error, Some("deadline".into()), None);
        return;
    }
    if FINISHED.swap(true, Ordering::SeqCst) {
        return;
    }
    let passed = error.is_none();
    let report = serde_json::json!({
        "passed": passed,
        "error": error,
        "diagnostics": *PROGRESS.lock().unwrap(),
    });
    let path = app.path().app_data_dir().expect("smoke data directory");
    fs::write(path.join("smoke-result.json"), report.to_string()).expect("write smoke report");
    println!("SITUATE_NATIVE_SMOKE {report}");
    #[cfg(desktop)]
    {
        if passed && super::workspaces::file_participants(&app).is_empty() {
            app.get_webview_window("main")
                .expect("entry window")
                .close()
                .expect("request entry window closure");
        } else {
            super::files::approve_smoke_exit(&app);
            app.exit(if passed { 0 } else { 1 });
        }
    }
}

#[cfg(target_os = "ios")]
macro_rules! smoke_handler {
    ($($extra:path),* $(,)?) => {
        crate::application_handler![$($extra,)* crate::agent_e2e::mobile::mobile_smoke_info,
            crate::agent_e2e::mobile::mobile_smoke_prepare, crate::agent_e2e::mobile::mobile_smoke_finish]
    };
}
#[cfg(not(target_os = "ios"))]
macro_rules! smoke_handler {
    ($($extra:path),* $(,)?) => { crate::application_handler![$($extra),*] };
}

pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .invoke_handler(smoke_handler![
            super::files::smoke::smoke_editor_file,
            super::files::smoke::smoke_reference_fixture,
            super::files::smoke::smoke_recovery_file,
            super::workspaces::smoke::smoke_start_recovery,
            verify_smoke_text,
            plugin_runtime::smoke_plugin_runtime_source,
            crate::ai::plugin_checks_smoke::smoke_plugin_check_prepare,
            crate::ai::plugin_checks_smoke::smoke_public_repository_stores,
            crate::ai::plugin_checks_smoke::smoke_document_source_verify,
            crate::ai::plugin_checks_smoke::smoke_plugin_source_request,
            crate::ai::plugin_checks_smoke::smoke_plugin_assignment,
            crate::ai::plugin_checks_smoke::smoke_conversation_fixture,
            crate::ai::plugin_checks_smoke::smoke_plugin_check_verify,
            crate::ai::plugin_checks_smoke::smoke_plugin_process_lifecycle,
            crate::diagnostics::smoke::smoke_verify_diagnostics,
            crate::diagnostics::smoke::smoke_measure_diagnostics,
            smoke_localization_replace,
            smoke_appearance_replace,
            finish_smoke_test,
            smoke_shell_ready,
            smoke_window_state,
            crate::ai::login::smoke::smoke_login_ownership,
            smoke_progress,
            smoke_phase,
            smoke_checkpoint,
            super::workspaces::smoke::smoke_parent,
            super::workspaces::smoke::smoke_create_fixture,
            super::workspaces::smoke::verify_smoke_registry,
            super::workspaces::failure_smoke::smoke_failure_cases,
            super::workspaces::failure_smoke::smoke_failed_creation,
            super::workspaces::failure_smoke::smoke_close_window,
            super::workspaces::failure_smoke::smoke_unavailable_restore,
            crate::agent_e2e::agent_e2e_info,
            crate::agent_e2e::agent_e2e_snapshot,
            crate::agent_e2e::agent_e2e_ready,
            crate::agent_e2e::agent_e2e_checkpoint,
            crate::agent_e2e::agent_e2e_control,
            crate::agent_e2e::agent_e2e_finish
        ])
        .setup(|app| {
            // A separate application identity keeps tests away from normal app data.
            if app.config().identifier != "dev.situate.client.smoke"
                && !(crate::agent_e2e::enabled()
                    && app
                        .config()
                        .identifier
                        .starts_with("dev.situate.client.smoke."))
            {
                return Err("Native smoke tests require tests/smoke.conf.json".into());
            }
            #[cfg(target_os = "ios")]
            crate::agent_e2e::mobile::guard(app.handle())?;
            let directory = app.path().app_data_dir()?;
            #[cfg(desktop)]
            {
                let root = std::path::PathBuf::from(std::env::var("SITUATE_SMOKE_ROOT")?);
                let owner = std::env::var("SITUATE_SMOKE_OWNER")?;
                if !root.is_absolute()
                    || owner.is_empty()
                    || fs::symlink_metadata(&root)?.file_type().is_symlink()
                    || directory.canonicalize()? != root.canonicalize()?
                    || fs::read_to_string(root.join(".smoke-owner"))? != owner
                {
                    return Err(
                        "Native smoke tests require an owned, isolated data directory".into(),
                    );
                }
            }
            fs::create_dir_all(&directory)?;
            let report = directory.join("smoke-result.json");
            if report.exists() {
                fs::remove_file(report)?;
            }
            #[cfg(desktop)]
            if !directory.join("smoke-restart.json").exists() {
                let registry = directory.join("workspaces-v1.json");
                if registry.exists() {
                    fs::remove_file(registry)?;
                }
            }
            progress("", "setup", serde_json::Value::Null);
            if let Err(error) = crate::agent_e2e::bootstrap(app.handle()) {
                let _ = crate::agent_e2e::cleanup();
                crate::agent_e2e::report_bootstrap_failure();
                return Err(error.into());
            }
            crate::diagnostics::setup(app.handle());
            super::workspaces::setup(app.handle())?;
            crate::updates::setup(app.handle());
            progress("", "workspaces-configured", serde_json::Value::Null);
            let handle = app.handle().clone();
            thread::spawn(move || {
                let interactive = handle
                    .path()
                    .app_data_dir()
                    .unwrap()
                    .join("smoke-use-picker")
                    .exists();
                let timeout = if crate::agent_e2e::enabled() {
                    crate::agent_e2e::timeout()
                } else {
                    let public_repository_only =
                        std::env::var("SITUATE_PUBLIC_REPOSITORY_ONLY").as_deref() == Ok("1");
                    let process_connection_only =
                        std::env::var("SITUATE_PROCESS_CONNECTION_ONLY").as_deref() == Ok("1");
                    let seconds = watchdog_seconds(
                        interactive,
                        std::env::var_os("SITUATE_DIAGNOSTICS_PROFILE").is_some(),
                        public_repository_only,
                        process_connection_only,
                        std::env::var("SITUATE_PLUGIN_CHECKS_PHASE").as_deref() == Ok("block"),
                    );
                    progress(
                        "",
                        "watchdog-configured",
                        serde_json::json!({
                            "seconds": seconds,
                            "publicRepositoryOnly": public_repository_only,
                            "processConnectionOnly": process_connection_only,
                        }),
                    );
                    Duration::from_secs(seconds)
                };
                thread::sleep(timeout);
                finish_smoke_test(handle, Some("Native smoke deadline exceeded".into()));
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if !smoke_application_window(webview.label()) {
                return;
            }
            if payload.event() == PageLoadEvent::Started {
                *NAVIGATIONS
                    .lock()
                    .unwrap()
                    .entry(webview.label().into())
                    .or_default() += 1;
                crate::diagnostics::forget_window(webview.app_handle(), webview.label());
            }
            progress(
                webview.label(),
                match payload.event() {
                    PageLoadEvent::Started => "navigation-started",
                    PageLoadEvent::Finished => "navigation-finished",
                },
                serde_json::json!({ "scheme": payload.url().scheme() }),
            );
            if payload.event() == PageLoadEvent::Finished {
                #[cfg(target_os = "macos")]
                webview
                    .with_webview(|platform| {
                        use objc2::{msg_send, sel};
                        use objc2_app_kit::NSWritingToolsBehavior;
                        use objc2_foundation::NSObjectProtocol;
                        use objc2_web_kit::WKWebView;

                        // Inspect the live view's copy, not the configuration used by the builder.
                        let view = unsafe { &*platform.inner().cast::<WKWebView>() };
                        let configuration = unsafe { view.configuration() };
                        if configuration.respondsToSelector(sel!(writingToolsBehavior)) {
                            let behavior: NSWritingToolsBehavior =
                                unsafe { msg_send![&configuration, writingToolsBehavior] };
                            assert_eq!(behavior, NSWritingToolsBehavior::None);
                        }
                    })
                    .expect("inspect native writing tools configuration");
                webview
                    .eval(include_str!("native-wait.js"))
                    .expect("load native test wait");
                #[cfg(target_os = "ios")]
                {
                    webview
                        .eval(include_str!("mobile-smoke.js"))
                        .expect("load native iOS smoke test");
                }
                #[cfg(not(target_os = "ios"))]
                {
                    webview
                        .eval(include_str!("onboarding-smoke.js"))
                        .expect("load native onboarding smoke test");
                    if std::env::var_os("SITUATE_ONBOARDING_HANDOFF_PHASE").is_some() {
                        webview
                            .eval(include_str!("creation-handoff-smoke.js"))
                            .expect("load native creation handoff test");
                        return;
                    }
                    if crate::agent_e2e::enabled() {
                        match crate::agent_e2e::script().and_then(|script| {
                            webview
                                .eval(script)
                                .map_err(|_| "Agent E2E script injection failed".into())
                        }) {
                            Ok(()) => {}
                            Err(_) => {
                                let _ = crate::agent_e2e::report("blocked", "script");
                                webview.app_handle().exit(1);
                            }
                        }
                        return;
                    }
                    webview
                        .eval(format!(
                            "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
                            include_str!("native-wait.js"),
                            include_str!("diagnostics-smoke.js"),
                            include_str!("read-menu-trace.js"),
                            include_str!("references-smoke.js"),
                            include_str!("editor-smoke.js"),
                            include_str!("layout-smoke.js"),
                            include_str!("appearance-smoke.js"),
                            include_str!("plugin-runtime-smoke.js"),
                            include_str!("plugin-checks-smoke.js"),
                        ))
                        .expect("load native editor smoke test");
                    webview
                        .eval(if webview.label() == "main" {
                            include_str!("workspace-smoke.js")
                        } else {
                            include_str!("smoke.js")
                        })
                        .expect("load native smoke test");
                    let label = webview.label().to_owned();
                    webview
                        .eval_with_callback(
                            r#"({
                            readyState: document.readyState,
                            visibility: document.visibilityState,
                            ipc: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
                            editor: typeof window.runEditorSmoke === 'function'
                        })"#,
                            move |result| {
                                progress(
                                    &label,
                                    "script-evaluated",
                                    serde_json::from_str(&result)
                                        .unwrap_or(serde_json::Value::Null),
                                );
                            },
                        )
                        .expect("inspect native smoke script readiness");
                }
            }
        })
}

#[cfg(test)]
mod tests {
    use super::{diagnostics_selected, smoke_application_window};
    use std::fs;

    #[test]
    fn smoke_bootstrap_only_targets_application_windows() {
        for label in ["main", "workspace-1", "workspace-42"] {
            assert!(smoke_application_window(label));
        }
        for label in ["executor-1", "executor-42", "utility", "", "other"] {
            assert!(!smoke_application_window(label));
        }
    }

    #[test]
    fn diagnostics_selection_requires_an_explicit_flag_or_marker() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        assert!(!diagnostics_selected(root, false));
        assert!(diagnostics_selected(root, true));
        let marker = root.join("smoke-diagnostics");
        fs::create_dir(&marker).unwrap();
        assert!(!diagnostics_selected(root, false));
        fs::remove_dir(&marker).unwrap();
        fs::write(&marker, []).unwrap();
        assert!(diagnostics_selected(root, false));
        fs::remove_file(&marker).unwrap();
        assert!(!diagnostics_selected(root, false));
    }
}
