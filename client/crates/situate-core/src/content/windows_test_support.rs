use std::{
    io,
    os::windows::io::{AsRawHandle, FromRawHandle},
};
use windows_sys::Win32::Foundation::ERROR_NO_TOKEN;

pub(super) struct RevertImpersonation(std::marker::PhantomData<std::rc::Rc<()>>);

impl Drop for RevertImpersonation {
    fn drop(&mut self) {
        if unsafe { windows_sys::Win32::Security::RevertToSelf() } == 0 {
            eprintln!(
                "Could not restore the test thread token: {:?}",
                io::Error::last_os_error()
            );
            std::process::abort();
        }
    }
}

pub(super) fn restricted_context() -> io::Result<RevertImpersonation> {
    use std::os::windows::io::OwnedHandle;
    use windows_sys::Win32::{
        Security::{
            CheckTokenMembership, CreateRestrictedToken, CreateWellKnownSid, DISABLE_MAX_PRIVILEGE,
            ImpersonateLoggedOnUser, SECURITY_MAX_SID_SIZE, SID_AND_ATTRIBUTES, TOKEN_DUPLICATE,
            TOKEN_QUERY, WinBuiltinAdministratorsSid,
        },
        System::Threading::{
            GetCurrentProcess, GetCurrentThread, OpenProcessToken, OpenThreadToken,
        },
    };
    let mut previous = std::ptr::null_mut();
    if unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut previous) } != 0 {
        let _previous = unsafe { OwnedHandle::from_raw_handle(previous) };
        return Err(io::Error::other(
            "The test thread already has an impersonation token.",
        ));
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(ERROR_NO_TOKEN as i32) {
        return Err(error);
    }
    let mut administrator_sid = [0u32; SECURITY_MAX_SID_SIZE as usize / 4];
    let mut sid_size = SECURITY_MAX_SID_SIZE;
    let sid = administrator_sid.as_mut_ptr().cast();
    if unsafe {
        CreateWellKnownSid(
            WinBuiltinAdministratorsSid,
            std::ptr::null_mut(),
            sid,
            &mut sid_size,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut process = std::ptr::null_mut();
    if unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE | TOKEN_QUERY,
            &mut process,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let process = unsafe { OwnedHandle::from_raw_handle(process) };
    let disabled = SID_AND_ATTRIBUTES {
        Sid: sid,
        Attributes: 0,
    };
    let mut restricted = std::ptr::null_mut();
    if unsafe {
        CreateRestrictedToken(
            process.as_raw_handle(),
            DISABLE_MAX_PRIVILEGE,
            1,
            &disabled,
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            &mut restricted,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let restricted = unsafe { OwnedHandle::from_raw_handle(restricted) };
    if unsafe { ImpersonateLoggedOnUser(restricted.as_raw_handle()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let guard = RevertImpersonation(std::marker::PhantomData);
    let mut administrator = 0;
    if unsafe { CheckTokenMembership(std::ptr::null_mut(), sid, &mut administrator) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if administrator != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "The restricted token still enables administrator membership.",
        ));
    }
    eprintln!(
        "restricted-token: effective administrator membership=false; privilege restriction=DISABLE_MAX_PRIVILEGE"
    );
    Ok(guard)
}
