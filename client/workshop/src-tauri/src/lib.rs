use std::sync::Mutex;
use tauri::{LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const CONTROLS: &str = "design-controls";
const PREVIEW: &str = "design-preview";
const PREVIEW_URL: &str = "/?workshop=preview";

#[derive(Default)]
struct PreviewAccess(Mutex<()>);

fn require_controller(label: &str) -> Result<(), String> {
    if label == CONTROLS {
        Ok(())
    } else {
        Err("Only Design Workshop controls can manage the preview.".to_owned())
    }
}

fn validate_size(width: f64, height: f64) -> Result<(), String> {
    if !(320.0..=2560.0).contains(&width) || !(320.0..=2000.0).contains(&height) {
        return Err("Preview size must be 320–2560 wide and 320–2000 high.".to_owned());
    }
    Ok(())
}

fn window_size_for_viewport(
    width: f64,
    height: f64,
    inset_width: f64,
    inset_height: f64,
) -> Result<LogicalSize<f64>, String> {
    validate_size(width, height)?;
    if !(0.0..=200.0).contains(&inset_width) || !(0.0..=200.0).contains(&inset_height) {
        return Err("Preview content insets must be between 0 and 200.".to_owned());
    }
    Ok(LogicalSize::new(width + inset_width, height + inset_height))
}

fn title_with_worktree(title: &str, worktree: Option<&str>) -> String {
    match worktree.filter(|name| !name.trim().is_empty()) {
        Some(name) => format!("{title} — {name}"),
        None => title.to_owned(),
    }
}

fn window_title(title: &str) -> String {
    title_with_worktree(
        title,
        std::env::var("SITUATE_WORKSHOP_WORKTREE").ok().as_deref(),
    )
}

fn open_preview(app: &tauri::AppHandle) -> tauri::Result<WebviewWindow> {
    let preview = match app.get_webview_window(PREVIEW) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, PREVIEW, WebviewUrl::App(PREVIEW_URL.into()))
            .disable_drag_drop_handler()
            .title(window_title("Situate Design Preview"))
            .inner_size(1280.0, 800.0)
            .min_inner_size(320.0, 320.0)
            .build()?,
    };
    preview.unminimize()?;
    preview.show()?;
    preview.set_focus()?;
    Ok(preview)
}

#[tauri::command]
async fn workshop_open_preview(
    window: WebviewWindow,
    access: tauri::State<'_, PreviewAccess>,
) -> Result<(), String> {
    require_controller(window.label())?;
    let _guard = access
        .0
        .lock()
        .map_err(|_| "Preview access is unavailable.")?;
    open_preview(window.app_handle()).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn workshop_resize_preview(
    window: WebviewWindow,
    access: tauri::State<'_, PreviewAccess>,
    width: f64,
    height: f64,
    inset_width: f64,
    inset_height: f64,
) -> Result<(), String> {
    require_controller(window.label())?;
    let size = window_size_for_viewport(width, height, inset_width, inset_height)?;
    let _guard = access
        .0
        .lock()
        .map_err(|_| "Preview access is unavailable.")?;
    let preview = window
        .app_handle()
        .get_webview_window(PREVIEW)
        .ok_or("The design preview is closed.")?;
    // The renderer measures content insets because some hosts count the title bar
    // in both window and WebView sizes, unlike the CSS viewport.
    preview.set_size(size).map_err(|error| error.to_string())
}

fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

pub fn run() {
    tauri::Builder::default()
        .manage(PreviewAccess::default())
        .setup(|app| {
            let controls = WebviewWindowBuilder::new(
                app,
                CONTROLS,
                WebviewUrl::App("/?workshop=controls".into()),
            )
            .title(window_title("Situate Design Controls"))
            .inner_size(420.0, 800.0)
            .min_inner_size(320.0, 320.0)
            .build()?;
            open_preview(app.handle())?;
            controls.set_focus()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workshop_open_preview,
            workshop_resize_preview
        ])
        .run(context())
        .expect("could not run Situate Design Workshop");
}

#[cfg(test)]
mod tests {
    use super::{require_controller, validate_size, window_size_for_viewport};

    #[test]
    fn workshop_configuration_has_an_isolated_identity_and_window_permissions() {
        let workshop: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let context = super::context();
        assert_eq!(context.config().identifier, "dev.situate.design-workshop");
        assert_eq!(
            context.config().build.dev_url.as_ref().unwrap().port(),
            Some(1421)
        );
        assert_eq!(workshop["app"]["windows"], serde_json::json!([]));
        let capabilities = workshop["app"]["security"]["capabilities"]
            .as_array()
            .unwrap();
        assert_eq!(capabilities.len(), 1);
        assert_eq!(
            capabilities[0]["windows"],
            serde_json::json!(["design-controls", "design-preview"])
        );
        assert_eq!(
            capabilities[0]["permissions"],
            serde_json::json!([
                "core:event:allow-listen",
                "core:event:allow-unlisten",
                "core:event:allow-emit-to",
                "core:window:allow-inner-size"
            ])
        );
    }

    #[test]
    fn window_titles_identify_the_worktree_when_available() {
        for title in ["Situate Design Controls", "Situate Design Preview"] {
            assert_eq!(super::title_with_worktree(title, None), title);
            assert_eq!(super::title_with_worktree(title, Some("  ")), title);
            assert_eq!(
                super::title_with_worktree(title, Some("navigation design")),
                format!("{title} — navigation design")
            );
        }
    }

    #[test]
    fn accepts_logical_sizes_including_bounds_and_fractions() {
        for (width, height) in [(320.0, 320.0), (2560.0, 2000.0), (800.5, 640.25)] {
            assert!(validate_size(width, height).is_ok());
        }
    }

    #[test]
    fn rejects_out_of_bounds_and_non_finite_sizes() {
        for width in [319.0, 2561.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(validate_size(width, 800.0).is_err());
        }
        for height in [319.0, 2001.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(validate_size(800.0, height).is_err());
        }
    }

    #[test]
    fn sizes_the_content_area_and_rejects_invalid_insets() {
        let size = window_size_for_viewport(390.0, 844.0, 0.0, 32.0).unwrap();
        assert_eq!((size.width, size.height), (390.0, 876.0));
        for invalid in [-1.0, 201.0, f64::NAN, f64::INFINITY] {
            assert!(window_size_for_viewport(390.0, 844.0, invalid, 0.0).is_err());
            assert!(window_size_for_viewport(390.0, 844.0, 0.0, invalid).is_err());
        }
    }

    #[test]
    fn only_controls_can_invoke_preview_commands() {
        assert!(require_controller("design-controls").is_ok());
        for label in ["design-preview", "main", "workspace-example", ""] {
            assert!(require_controller(label).is_err());
        }
    }
}
