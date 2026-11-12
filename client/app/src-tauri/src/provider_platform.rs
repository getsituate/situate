use std::path::PathBuf;
use tauri::Manager;

#[cfg(desktop)]
const SERVICE: &str = "dev.situate.provider-wrapping-key.v1";
#[cfg(any(desktop, test))]
const UNAVAILABLE: &str = "native.ai.secureStore.unavailable";
#[cfg(any(desktop, test))]
const LOCKED: &str = "native.ai.secureStore.locked";
#[cfg(any(desktop, test))]
const MISSING: &str = "native.ai.secureStore.missing";
const FAILED: &str = "native.ai.secureStore.failed";
const INVALID: &str = "native.ai.secureStore.invalid";

fn validate_account(account: &str) -> Result<(), String> {
    if account.is_empty() || account.len() > 240 || account.chars().any(char::is_control) {
        return Err(INVALID.into());
    }
    Ok(())
}

fn validate_key(key: Vec<u8>) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err(INVALID.into());
    }
    Ok(key)
}

// Call synchronous store and directory operations from a blocking worker. Mobile
// invocation needs the main event loop to remain free to dispatch plugin calls.
pub(crate) fn key_get(app: &tauri::AppHandle, account: &str) -> Result<Vec<u8>, String> {
    read_key(account, |account| platform::get(app, account))
}

fn read_key(
    account: &str,
    read: impl FnOnce(&str) -> Result<Vec<u8>, String>,
) -> Result<Vec<u8>, String> {
    validate_account(account)?;
    validate_key(read(account)?)
}

pub(crate) fn key_set(app: &tauri::AppHandle, account: &str, key: &[u8]) -> Result<(), String> {
    write_key(account, key, |account, key| {
        platform::set(app, account, key)
    })
}

fn write_key(
    account: &str,
    key: &[u8],
    write: impl FnOnce(&str, &[u8]) -> Result<(), String>,
) -> Result<(), String> {
    validate_account(account)?;
    if key.len() != 32 {
        return Err(INVALID.into());
    }
    write(account, key)
}

pub(crate) fn key_delete(app: &tauri::AppHandle, account: &str) -> Result<(), String> {
    validate_account(account)?;
    platform::delete(app, account)
}

pub(crate) fn availability(app: &tauri::AppHandle) -> Result<(), String> {
    platform::available(app)
}

pub(crate) fn credential_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(mobile)]
    {
        let result = app
            .state::<tauri_plugin_provider_platform::Platform>()
            .call(serde_json::json!({"operation":"directory"}))?;
        result
            .get("path")
            .and_then(serde_json::Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| FAILED.into())
    }
    #[cfg(desktop)]
    {
        let path = app
            .path()
            .app_local_data_dir()
            .map_err(|_| FAILED.to_string())?
            .join("provider-credentials");
        std::fs::create_dir_all(&path).map_err(|_| FAILED.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| FAILED.to_string())?;
        }
        Ok(path)
    }
}

// Call only after admitting the selected LAN destination; this may show an OS prompt.
pub(crate) async fn request_local_network_permission(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        app.state::<tauri_plugin_provider_platform::Platform>()
            .request_local_network_permission()
            .await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

fn browser_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "native.ai.browser.invalidUrl".to_string())?;
    let permitted = matches!(
        (url.host_str(), url.path()),
        (
            Some("auth.openai.com"),
            "/api/accounts/authorize" | "/oauth/authorize" | "/codex/device"
        ) | (Some("openrouter.ai"), "/auth")
    );
    if url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !permitted
    {
        return Err("native.ai.browser.invalidUrl".into());
    }
    Ok(url)
}

pub(crate) use tauri_plugin_provider_platform::AuthBrowserExit;

// Await startup before selecting browser cancellation or finishing the native attempt.
pub(crate) async fn open_auth_browser(
    app: &tauri::AppHandle,
    raw: &str,
    attempt_id: &str,
) -> Result<Option<tokio::sync::oneshot::Receiver<AuthBrowserExit>>, String> {
    let url = browser_url(raw)?;
    if attempt_id.is_empty() || attempt_id.len() > 128 || attempt_id.chars().any(char::is_control) {
        return Err("native.ai.browser.openFailed".into());
    }
    #[cfg(mobile)]
    {
        app.state::<tauri_plugin_provider_platform::Platform>()
            .open_auth_browser(url.as_str(), attempt_id)
            .await
            .map(Some)
    }
    #[cfg(desktop)]
    {
        open_browser(app, url.as_str()).await?;
        Ok(None)
    }
}

pub(crate) async fn finish_auth_browser(
    app: &tauri::AppHandle,
    attempt_id: &str,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        app.state::<tauri_plugin_provider_platform::Platform>()
            .finish_auth_browser(attempt_id)
            .await
    }
    #[cfg(desktop)]
    {
        let _ = (app, attempt_id);
        Ok(())
    }
}

pub(crate) async fn open_browser(app: &tauri::AppHandle, raw: &str) -> Result<(), String> {
    let url = browser_url(raw)?;
    #[cfg(mobile)]
    {
        app.state::<tauri_plugin_provider_platform::Platform>()
            .open_browser(url.as_str())
            .await
    }
    #[cfg(desktop)]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || desktop_browser(url.as_str()))
            .await
            .map_err(|_| "native.ai.browser.openFailed".to_string())?
    }
}

#[cfg(desktop)]
fn desktop_browser(url: &str) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let success = {
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("/usr/bin/open");
        #[cfg(target_os = "linux")]
        let mut command = std::process::Command::new("xdg-open");
        #[cfg(target_os = "macos")]
        command.arg("--");
        command
            .arg(url)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    };
    #[cfg(target_os = "windows")]
    let success = {
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let url: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            ) as isize
                > 32
        }
    };
    if success {
        Ok(())
    } else {
        Err("native.ai.browser.openFailed".into())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use security_framework::passwords::{
        PasswordOptions, delete_generic_password_options, generic_password,
        set_generic_password_options,
    };
    fn options(account: &str) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(SERVICE, account);
        options.set_access_synchronized(Some(false));
        options
    }
    fn error(error: security_framework::base::Error) -> String {
        match error.code() {
            -25300 => MISSING,
            -25308 | -25293 => LOCKED,
            -25291 => UNAVAILABLE,
            _ => FAILED,
        }
        .into()
    }
    pub(super) fn get(_: &tauri::AppHandle, account: &str) -> Result<Vec<u8>, String> {
        generic_password(options(account)).map_err(error)
    }
    pub(super) fn set(_: &tauri::AppHandle, account: &str, key: &[u8]) -> Result<(), String> {
        set_generic_password_options(key, options(account)).map_err(error)
    }
    pub(super) fn delete(_: &tauri::AppHandle, account: &str) -> Result<(), String> {
        match delete_generic_password_options(options(account)) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(error(e)),
        }
    }
    pub(super) fn available(app: &tauri::AppHandle) -> Result<(), String> {
        match get(app, "availability-probe") {
            Ok(_) => Ok(()),
            Err(e) if e == MISSING => Ok(()),
            Err(e) => Err(e),
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use secret_service::{EncryptionType, blocking::SecretService};
    use std::collections::HashMap;
    fn service() -> Result<SecretService<'static>, String> {
        SecretService::connect(EncryptionType::Dh).map_err(|_| UNAVAILABLE.into())
    }
    fn collection<'a>(
        service: &'a SecretService<'a>,
    ) -> Result<secret_service::blocking::Collection<'a>, String> {
        let collection = service
            .get_default_collection()
            .map_err(|_| UNAVAILABLE.to_string())?;
        if collection.is_locked().map_err(|_| FAILED.to_string())? {
            return Err(LOCKED.into());
        }
        Ok(collection)
    }
    fn attributes(account: &str) -> HashMap<&str, &str> {
        HashMap::from([("service", SERVICE), ("account", account)])
    }
    pub(super) fn available(_: &tauri::AppHandle) -> Result<(), String> {
        let service = service()?;
        collection(&service)?;
        Ok(())
    }
    pub(super) fn get(_: &tauri::AppHandle, account: &str) -> Result<Vec<u8>, String> {
        let service = service()?;
        let collection = collection(&service)?;
        let items = collection
            .search_items(attributes(account))
            .map_err(|_| FAILED.to_string())?;
        if items.len() > 1 {
            return Err(INVALID.into());
        }
        let item = items.first().ok_or_else(|| MISSING.to_string())?;
        if item.is_locked().map_err(|_| FAILED.to_string())? {
            return Err(LOCKED.into());
        }
        item.get_secret().map_err(|_| FAILED.into())
    }
    pub(super) fn set(_: &tauri::AppHandle, account: &str, key: &[u8]) -> Result<(), String> {
        let service = service()?;
        collection(&service)?
            .create_item(
                "Situate provider wrapping key",
                attributes(account),
                key,
                true,
                "application/octet-stream",
            )
            .map_err(|_| FAILED.to_string())?;
        Ok(())
    }
    pub(super) fn delete(_: &tauri::AppHandle, account: &str) -> Result<(), String> {
        let service = service()?;
        let collection = collection(&service)?;
        let items = collection
            .search_items(attributes(account))
            .map_err(|_| FAILED.to_string())?;
        for item in &items {
            if item.is_locked().map_err(|_| FAILED.to_string())? {
                return Err(LOCKED.into());
            }
        }
        for item in items {
            item.delete().map_err(|_| FAILED.to_string())?;
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{
            ERROR_ACCESS_DENIED, ERROR_NO_SUCH_LOGON_SESSION, ERROR_NOT_FOUND, GetLastError,
        },
        Security::Credentials::*,
    };
    fn target(account: &str) -> Vec<u16> {
        format!("{SERVICE}:{account}")
            .encode_utf16()
            .chain(Some(0))
            .collect()
    }
    fn error() -> String {
        match unsafe { GetLastError() } {
            ERROR_NOT_FOUND => MISSING,
            ERROR_NO_SUCH_LOGON_SESSION => UNAVAILABLE,
            ERROR_ACCESS_DENIED => LOCKED,
            _ => FAILED,
        }
        .into()
    }
    pub(super) fn get(_: &tauri::AppHandle, account: &str) -> Result<Vec<u8>, String> {
        let mut credential = std::ptr::null_mut();
        if unsafe {
            CredReadW(
                target(account).as_ptr(),
                CRED_TYPE_GENERIC,
                0,
                &mut credential,
            )
        } == 0
        {
            return Err(error());
        }
        unsafe {
            let result = if (*credential).CredentialBlobSize == 32
                && !(*credential).CredentialBlob.is_null()
            {
                Ok(std::slice::from_raw_parts((*credential).CredentialBlob, 32).to_vec())
            } else {
                Err(INVALID.into())
            };
            CredFree(credential.cast());
            result
        }
    }
    pub(super) fn set(_: &tauri::AppHandle, account: &str, key: &[u8]) -> Result<(), String> {
        let mut name = target(account);
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            CredentialBlobSize: key.len() as u32,
            CredentialBlob: key.as_ptr() as *mut u8,
            // Persistence is local to this computer; Credential Manager still scopes access to the current user.
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            Err(error())
        } else {
            Ok(())
        }
    }
    pub(super) fn delete(_: &tauri::AppHandle, account: &str) -> Result<(), String> {
        if unsafe { CredDeleteW(target(account).as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
            return Ok(());
        }
        let error = error();
        if error == MISSING { Ok(()) } else { Err(error) }
    }
    pub(super) fn available(app: &tauri::AppHandle) -> Result<(), String> {
        match get(app, "availability-probe") {
            Ok(_) => Ok(()),
            Err(e) if e == MISSING => Ok(()),
            Err(e) => Err(e),
        }
    }
}

#[cfg(mobile)]
mod platform {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    fn call(
        app: &tauri::AppHandle,
        operation: &str,
        account: &str,
        key: Option<&[u8]>,
    ) -> Result<serde_json::Value, String> {
        app.state::<tauri_plugin_provider_platform::Platform>().call(serde_json::json!({"operation":operation,"account":account,"key":key.map(|k| STANDARD.encode(k))}))
    }
    pub(super) fn get(app: &tauri::AppHandle, account: &str) -> Result<Vec<u8>, String> {
        let result = call(app, "get", account, None)?;
        STANDARD
            .decode(
                result
                    .get("key")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| INVALID.to_string())?,
            )
            .map_err(|_| INVALID.into())
    }
    pub(super) fn set(app: &tauri::AppHandle, account: &str, key: &[u8]) -> Result<(), String> {
        call(app, "set", account, Some(key)).map(|_| ())
    }
    pub(super) fn delete(app: &tauri::AppHandle, account: &str) -> Result<(), String> {
        call(app, "delete", account, None).map(|_| ())
    }
    pub(super) fn available(app: &tauri::AppHandle) -> Result<(), String> {
        call(app, "availability", "", None).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_handoff_only_accepts_fixed_https_provider_destinations() {
        for url in [
            "https://auth.openai.com/api/accounts/authorize?state=synthetic",
            "https://auth.openai.com/codex/device",
            "https://openrouter.ai/auth?code_challenge=synthetic",
        ] {
            assert!(browser_url(url).is_ok());
        }
        for url in [
            "http://auth.openai.com/codex/device",
            "https://auth.openai.com.evil.invalid/codex/device",
            "https://user@auth.openai.com/codex/device",
            "https://auth.openai.com:444/codex/device",
            "file:///tmp/test",
            "https://auth.openai.com/codex/device#secret",
            "https://auth.openai.com/logout",
        ] {
            assert!(browser_url(url).is_err(), "{url}");
        }
    }
    #[test]
    fn synthetic_store_preserves_failures_and_rejects_corrupt_keys() {
        for reason in [MISSING, LOCKED, UNAVAILABLE, FAILED] {
            assert_eq!(
                read_key("synthetic", |_| Err(reason.into())),
                Err(reason.into())
            );
            assert_eq!(
                write_key("synthetic", &[7; 32], |_, _| Err(reason.into())),
                Err(reason.into())
            );
        }
        assert_eq!(
            read_key("synthetic", |_| Ok(vec![7; 31])),
            Err(INVALID.into())
        );
        assert_eq!(read_key("synthetic", |_| Ok(vec![7; 32])), Ok(vec![7; 32]));
        assert_eq!(
            write_key("synthetic", &[7; 31], |_, _| panic!(
                "invalid key reached OS"
            )),
            Err(INVALID.into())
        );
        assert_eq!(
            read_key("", |_| panic!("invalid account reached OS")),
            Err(INVALID.into())
        );
    }

    #[test]
    fn wrapping_keys_are_bounded_and_accounts_are_not_paths() {
        assert!(validate_key(vec![1; 32]).is_ok());
        for n in [0, 31, 33, 4096] {
            assert!(validate_key(vec![1; n]).is_err());
        }
        for account in ["", "line\nbreak", "nul\0byte"] {
            assert!(validate_account(account).is_err());
        }
        assert!(validate_account(&"a".repeat(241)).is_err());
        assert!(validate_account("workspace:connection:key-version").is_ok());
    }
}
