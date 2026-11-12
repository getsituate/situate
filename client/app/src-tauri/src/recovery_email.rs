#[cfg(target_os = "ios")]
use tauri::Manager;

const SUBJECT: &str = "Situate problem report";
const RECIPIENT: &str = "bugs@getsituate.com";
const BODY_LIMIT: usize = 8192;
const URL_LIMIT: usize = 24576;

fn encode(text: &str) -> String {
    let mut encoded = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}
fn draft_url(body: &str) -> Option<String> {
    if body.len() > BODY_LIMIT
        || body
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return None;
    }
    let url = format!(
        "mailto:{RECIPIENT}?subject={}&body={}",
        encode(SUBJECT),
        encode(body)
    );
    (url.len() <= URL_LIMIT).then_some(url)
}
fn handoff(body: &str, launch: impl FnOnce(&str) -> bool) -> bool {
    draft_url(body).is_some_and(|url| launch(&url))
}
#[tauri::command]
pub(crate) async fn recovery_open_email(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    body: String,
) -> bool {
    if super::recovery::local_window(&window).is_err() {
        return false;
    }
    tauri::async_runtime::spawn_blocking(move || {
        handoff(&body, |url| {
            #[cfg(target_os = "macos")]
            {
                let _ = &app;
                std::process::Command::new("/usr/bin/open")
                    .arg("--")
                    .arg(url)
                    .status()
                    .is_ok_and(|s| s.success())
            }
            #[cfg(target_os = "ios")]
            {
                app.state::<tauri_plugin_workspace_access::Access>()
                    .recovery_email(url)
                    .unwrap_or(false)
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            {
                let _ = (&app, url);
                false
            }
        })
    })
    .await
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn draft_has_fixed_headers_and_preserves_exact_utf8_body() {
        let body = "Description: Grüße & ? # + %\r\nBcc: nobody@example.invalid\n日本語";
        assert!(handoff(body, |url| {
            let url = reqwest::Url::parse(url).unwrap();
            assert_eq!(url.path(), "bugs@getsituate.com");
            let pairs = url.query_pairs().collect::<Vec<_>>();
            assert_eq!(pairs.len(), 2);
            assert_eq!(pairs[0].0, "subject");
            assert_eq!(pairs[0].1, "Situate problem report");
            assert_eq!(pairs[1].0, "body");
            assert_eq!(pairs[1].1, body);
            true
        }));
    }
    #[test]
    fn refuses_oversized_control_and_unavailable_handoffs_without_truncation() {
        assert!(!handoff(&"x".repeat(BODY_LIMIT + 1), |_| panic!(
            "launched"
        )));
        assert!(!handoff(&"界".repeat(BODY_LIMIT / 3), |_| panic!(
            "launched"
        )));
        assert!(!handoff("report\0", |_| panic!("launched")));
        assert!(!handoff("report", |_| false));
        assert!(handoff(&"x".repeat(BODY_LIMIT), |_| true));
    }
}
