use situate_host_api::external::ExternalOpenHost;
use std::{ffi::OsStr, io, os::windows::ffi::OsStrExt};
use windows_sys::Win32::{
    System::Com::{
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
    },
    UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
};

pub struct Host;

impl ExternalOpenHost for Host {
    fn open(target: &OsStr) -> io::Result<()> {
        let mut target: Vec<u16> = target.encode_wide().collect();
        if target.is_empty() || target.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid shell target",
            ));
        }
        target.push(0);
        let verb = [b'o' as u16, b'p' as u16, b'e' as u16, b'n' as u16, 0];
        let result = unsafe {
            let initialized = CoInitializeEx(
                std::ptr::null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            );
            if initialized < 0 {
                return Err(io::Error::other(format!(
                    "CoInitializeEx failed: {initialized:#x}"
                )));
            }
            let result = ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            ) as isize;
            CoUninitialize();
            result
        };
        if result > 32 {
            Ok(())
        } else {
            Err(io::Error::other(format!("ShellExecuteW failed: {result}")))
        }
    }
}
