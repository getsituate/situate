use super::{FAILED, INVALID, LOCKED, MISSING, SERVICE, UNAVAILABLE};
use windows_sys::Win32::{
    Foundation::{ERROR_ACCESS_DENIED, ERROR_NO_SUCH_LOGON_SESSION, ERROR_NOT_FOUND, GetLastError},
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
pub(crate) fn get(account: &str) -> Result<Vec<u8>, String> {
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
        let result =
            if (*credential).CredentialBlobSize == 32 && !(*credential).CredentialBlob.is_null() {
                Ok(std::slice::from_raw_parts((*credential).CredentialBlob, 32).to_vec())
            } else {
                Err(INVALID.into())
            };
        CredFree(credential.cast());
        result
    }
}
pub(crate) fn set(account: &str, key: &[u8]) -> Result<(), String> {
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
pub(crate) fn delete(account: &str) -> Result<(), String> {
    if unsafe { CredDeleteW(target(account).as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
        return Ok(());
    }
    let error = error();
    if error == MISSING { Ok(()) } else { Err(error) }
}

pub(crate) fn open_browser(url: &str) -> bool {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    struct OwnedCredential(String);

    impl Drop for OwnedCredential {
        fn drop(&mut self) {
            let _ = delete(&self.0);
        }
    }

    #[test]
    fn credential_manager_round_trip() {
        let account = format!("native-test:{}", uuid::Uuid::new_v4());
        assert_eq!(get(&account), Err(MISSING.into()));
        let owned = OwnedCredential(account);
        let key = std::array::from_fn::<_, 32, _>(|i| (i * 7) as u8);
        set(&owned.0, &key).expect("write the isolated test credential");
        assert!(get(&owned.0).is_ok_and(|value| value == key));
        delete(&owned.0).expect("remove the isolated test credential");
        assert_eq!(get(&owned.0), Err(MISSING.into()));
    }
}
