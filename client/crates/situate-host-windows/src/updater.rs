use std::{
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr,
};
use windows_sys::Win32::System::Threading::{
    CREATE_SUSPENDED, CreateProcessW, PROCESS_INFORMATION, ResumeThread, STARTUPINFOW,
    TerminateProcess,
};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WOW64_64KEY},
};

pub fn network_available() -> Option<bool> {
    use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let level = NetworkInformation::GetInternetConnectionProfile()
        .and_then(|profile| profile.GetNetworkConnectivityLevel());
    if initialized.is_ok() {
        unsafe { CoUninitialize() };
    }
    match level {
        Ok(level) => Some(level == NetworkConnectivityLevel::InternetAccess),
        Err(error) if error.code() == windows::Win32::Foundation::E_POINTER => Some(false),
        Err(_) => None,
    }
}

pub fn installed_version(product: &str, executable: &Path) -> io::Result<String> {
    if product.is_empty() || product.contains(['\\', '/']) {
        return Err(io::Error::other("Invalid installer product name"));
    }
    let registration = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
        format!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{product}"),
        KEY_READ | KEY_WOW64_64KEY,
    )?;
    let location: String = registration.get_value("InstallLocation")?;
    let binary: String = registration.get_value("MainBinaryName")?;
    let location = Path::new(
        location
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or(&location),
    );
    if !location.is_absolute()
        || executable
            .file_name()
            .is_none_or(|name| name != binary.as_str())
        || !same_file::is_same_file(location.join(binary), executable)?
    {
        return Err(io::Error::other(
            "Installation registration does not match executable",
        ));
    }
    registration.get_value("DisplayVersion")
}

pub struct PreparedInstaller {
    process: OwnedHandle,
    thread: OwnedHandle,
    started: bool,
}

impl PreparedInstaller {
    /// Keep NSIS suspended until the application has committed shutdown.
    pub fn create(executable: &Path) -> io::Result<Self> {
        if !executable.is_absolute() {
            return Err(io::Error::other("Installer path must be absolute"));
        }
        let mut command = vec![u16::from(b'"')];
        command.extend(executable.as_os_str().encode_wide());
        command.extend("\" /P /UPDATE /R".encode_utf16());
        command.push(0);
        let path: Vec<_> = executable.as_os_str().encode_wide().chain([0]).collect();
        let startup = STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOW>() as u32,
            ..Default::default()
        };
        let mut process = PROCESS_INFORMATION::default();
        if unsafe {
            CreateProcessW(
                path.as_ptr(),
                command.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                0,
                CREATE_SUSPENDED,
                ptr::null(),
                ptr::null(),
                &startup,
                &mut process,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            process: unsafe { OwnedHandle::from_raw_handle(process.hProcess) },
            thread: unsafe { OwnedHandle::from_raw_handle(process.hThread) },
            started: false,
        })
    }

    pub fn start(mut self) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        if unsafe { ResumeThread(self.thread.as_raw_handle()) } == u32::MAX {
            return Err(io::Error::last_os_error());
        }
        self.started = true;
        Ok(())
    }
}

impl Drop for PreparedInstaller {
    fn drop(&mut self) {
        use std::os::windows::io::AsRawHandle;
        if !self.started {
            let _ = unsafe { TerminateProcess(self.process.as_raw_handle(), 1) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::windows::io::AsRawHandle, path::PathBuf};
    use windows_sys::Win32::{
        Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::Threading::{GetExitCodeProcess, WaitForSingleObject},
    };

    #[test]
    fn prepared_installer_cannot_execute_until_handoff() {
        let program =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/where.exe");
        let installer = PreparedInstaller::create(&program).unwrap();
        let process = installer.process.try_clone().unwrap();
        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 200) },
            WAIT_TIMEOUT
        );
        installer.start().unwrap();
        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 5000) },
            WAIT_OBJECT_0
        );
    }

    #[test]
    fn dropping_an_uncommitted_handoff_terminates_the_suspended_child() {
        let program =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/where.exe");
        let installer = PreparedInstaller::create(&program).unwrap();
        let process = installer.process.try_clone().unwrap();
        drop(installer);
        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 5000) },
            WAIT_OBJECT_0
        );
        let mut status = 0;
        assert_ne!(
            unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut status) },
            0
        );
        assert_eq!(status, 1);
    }
}
