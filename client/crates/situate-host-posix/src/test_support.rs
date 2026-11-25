pub use std::os::unix::{
    ffi::{OsStrExt as RawName, OsStringExt as RawNameBuf},
    fs::{MetadataExt, PermissionsExt, symlink},
    net::UnixListener,
};
use std::{
    fs,
    io::{self, Read, Write},
    os::{
        fd::AsRawFd,
        unix::{net::UnixStream, process::CommandExt},
    },
    path::Path,
    process::{Command, ExitStatus},
    thread,
    time::Duration,
};

pub fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}

pub fn make_fifo(path: &Path) -> io::Result<()> {
    let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
    if unsafe { libc::mkfifo(path.as_ptr(), 0o600) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub fn set_mode(path: impl AsRef<Path>, mode: u32) -> io::Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

pub struct PausedChild {
    connection: UnixStream,
    worker: thread::JoinHandle<ExitStatus>,
}

impl PausedChild {
    pub fn spawn() -> Self {
        let (mut connection, child) = UnixStream::pair().unwrap();
        let timeout = Some(Duration::from_secs(5));
        connection.set_read_timeout(timeout).unwrap();
        child.set_read_timeout(timeout).unwrap();
        let worker = thread::spawn(move || {
            let fd = child.as_raw_fd();
            let mut command = Command::new("/bin/sh");
            command.args(["-c", ":"]);
            // Only async-signal-safe syscalls can run before exec.
            unsafe {
                command.pre_exec(move || {
                    let mut byte = 1u8;
                    if libc::write(fd, (&byte as *const u8).cast(), 1) != 1
                        || libc::read(fd, (&mut byte as *mut u8).cast(), 1) != 1
                    {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
            let result = command.spawn();
            drop(child);
            result.unwrap().wait().unwrap()
        });
        connection.read_exact(&mut [0]).unwrap();
        Self { connection, worker }
    }

    pub fn resume(mut self) {
        self.connection.write_all(&[1]).unwrap();
        assert!(self.worker.join().unwrap().success());
    }
}
