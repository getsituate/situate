pub(crate) fn web_url(target: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(target).map_err(|error| {
        situate_core::messages::supplied(error, "native.files.operation.failed")
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("native.files.link.httpOnly".into());
    }
    Ok(url)
}

pub(crate) fn executable_signature(bytes: &[u8]) -> bool {
    [
        b"MZ".as_slice(),
        b"\x7fELF",
        b"\xfe\xed\xfa\xce",
        b"\xce\xfa\xed\xfe",
        b"\xfe\xed\xfa\xcf",
        b"\xcf\xfa\xed\xfe",
        b"\xca\xfe\xba\xbe",
        b"\xbe\xba\xfe\xca",
        b"\xca\xfe\xba\xbf",
        b"\xbf\xba\xfe\xca",
    ]
    .iter()
    .any(|magic| bytes.starts_with(magic))
}

#[tauri::command]
pub(crate) async fn open_web_link(href: String) -> Result<(), String> {
    let url = web_url(&href).map_err(|_| "native.files.link.httpOnly".to_string())?;
    let failed = || "native.files.external.openFailed".to_string();
    #[cfg(desktop)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            crate::provider_platform::desktop_browser(url.as_str())
        })
        .await
        .map_err(|_| failed())?
        .map_err(|_| failed())
    }
    #[cfg(mobile)]
    {
        let _ = url;
        Err(failed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permits_web_links_with_ports_queries_and_fragments() {
        for href in [
            "http://localhost:8080/docs?q=a%20b#part",
            "https://example.org/docs?q=a%20b#part",
        ] {
            assert_eq!(web_url(href).unwrap().as_str(), href);
        }
    }

    #[tokio::test]
    async fn refuses_non_web_and_credential_links_before_launching() {
        for href in [
            "javascript:void(0)",
            "file:///tmp/notes.md",
            "mailto:someone@example.org",
            "my-app://action",
            "//example.org/path",
            "https://user:pass@example.org/",
        ] {
            assert_eq!(
                open_web_link(href.to_string()).await,
                Err("native.files.link.httpOnly".into()),
            );
        }
    }
}
