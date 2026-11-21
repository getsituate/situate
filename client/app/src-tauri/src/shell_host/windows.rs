use super::{Capture, CommandOutcome, CommandRequest, CommandResult, ShellError};
use std::{
    collections::BTreeMap,
    ffi::{OsStr, OsString},
    fs::File,
    io::{self, Read},
    mem::{size_of, size_of_val},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::PathBuf,
    ptr::{null, null_mut},
    time::Duration,
};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use windows_sys::Win32::{
    Foundation::{
        ERROR_BROKEN_PIPE, ERROR_NO_DATA, HANDLE, HANDLE_FLAG_INHERIT, SetHandleInformation,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    System::{
        JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
            QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
        },
        Pipes::{CreatePipe, PeekNamedPipe},
        SystemInformation::{GetSystemDirectoryW, GetWindowsDirectoryW},
        Threading::{
            CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
            DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess,
            InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
            STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute, WaitForSingleObject,
        },
    },
};

const POLL: Duration = Duration::from_millis(5);
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
const TERMINATED_EXIT_CODE: u32 = 1;

fn system_path(get: unsafe extern "system" fn(*mut u16, u32) -> u32) -> Option<PathBuf> {
    let mut buffer = [0; 1024];
    // The Windows APIs return the required size instead of a path if the buffer is too small.
    let len = unsafe { get(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    (len > 0 && len < buffer.len()).then(|| PathBuf::from(OsString::from_wide(&buffer[..len])))
}

pub(super) fn power_shell() -> Option<String> {
    let path = system_path(GetSystemDirectoryW)?.join(r"WindowsPowerShell\v1.0\powershell.exe");
    if !path.is_file() {
        return None;
    }
    path.into_os_string().into_string().ok()
}

fn environment() -> Result<Vec<u16>, ShellError> {
    let system = system_path(GetSystemDirectoryW).ok_or(ShellError::SpawnFailed)?;
    let root = system_path(GetWindowsDirectoryW).ok_or(ShellError::SpawnFailed)?;
    let path = std::env::join_paths([system, root.clone()]).map_err(|_| ShellError::SpawnFailed)?;
    // Windows expects a sorted, double-NUL-terminated UTF-16 environment block.
    let mut vars = BTreeMap::from([
        ("PATH", path),
        ("SYSTEMROOT", root.as_os_str().to_owned()),
        ("WINDIR", root.into_os_string()),
    ]);
    for key in ["TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"] {
        if let Some(value) = std::env::var_os(key) {
            vars.insert(key, value);
        }
    }
    let mut block = Vec::new();
    for (key, value) in vars {
        block.extend(key.encode_utf16());
        block.push(b'=' as u16);
        block.extend(value.encode_wide());
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

fn wide(value: &OsStr) -> Result<Vec<u16>, ShellError> {
    let mut value: Vec<_> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err(ShellError::InvalidRequest);
    }
    value.push(0);
    Ok(value)
}

fn command_line(request: &CommandRequest) -> Result<Vec<u16>, ShellError> {
    // CreateProcessW accepts a command line, not argv. Quote for Windows argv decoding;
    // do not run it through cmd.exe (and never implicitly execute a batch file).
    const QUOTE: u16 = b'"' as u16;
    const SLASH: u16 = b'\\' as u16;
    let mut line = Vec::new();
    for arg in
        std::iter::once(request.executable.as_os_str()).chain(request.args.iter().map(OsStr::new))
    {
        if !line.is_empty() {
            line.push(b' ' as u16);
        }
        line.push(QUOTE);
        let mut slashes = 0;
        for ch in arg.encode_wide() {
            match ch {
                0 => return Err(ShellError::InvalidRequest),
                SLASH => {
                    slashes += 1;
                    continue;
                }
                QUOTE => slashes = slashes * 2 + 1,
                _ => {}
            }
            line.extend(std::iter::repeat_n(SLASH, slashes));
            slashes = 0;
            line.push(ch);
        }
        line.extend(std::iter::repeat_n(SLASH, slashes * 2));
        line.push(QUOTE);
    }
    line.push(0);
    if line.len() > 32_767 {
        return Err(ShellError::InvalidRequest);
    }
    Ok(line)
}

fn owned_job() -> Result<OwnedHandle, ShellError> {
    // The unnamed job handle is not inheritable. Its last close terminates the job.
    let raw = unsafe { CreateJobObjectW(null(), null()) };
    if raw.is_null() {
        return Err(ShellError::SpawnFailed);
    }
    let job = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let set = unsafe {
        SetInformationJobObject(
            raw,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of_val(&limits) as u32,
        )
    };
    if set == 0 {
        return Err(ShellError::SpawnFailed);
    }
    Ok(job)
}

fn pipe(child_reads: bool) -> Result<(OwnedHandle, OwnedHandle), ShellError> {
    let (mut read, mut write) = (null_mut(), null_mut());
    if unsafe { CreatePipe(&mut read, &mut write, null(), 0) } == 0 {
        return Err(ShellError::SpawnFailed);
    }
    // Only the child's end may be inherited; the parent keeps the other end private.
    let read = unsafe { OwnedHandle::from_raw_handle(read) };
    let write = unsafe { OwnedHandle::from_raw_handle(write) };
    let (child, parent) = if child_reads {
        (read, write)
    } else {
        (write, read)
    };
    if unsafe {
        SetHandleInformation(
            child.as_raw_handle(),
            HANDLE_FLAG_INHERIT,
            HANDLE_FLAG_INHERIT,
        )
    } == 0
    {
        return Err(ShellError::SpawnFailed);
    }
    Ok((child, parent))
}

struct Attributes(Vec<usize>);

impl Attributes {
    fn new() -> Result<Self, ShellError> {
        let mut bytes = 0;
        unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes) };
        if bytes == 0 {
            return Err(ShellError::SpawnFailed);
        }
        let mut storage = vec![0; bytes.div_ceil(size_of::<usize>())];
        if unsafe {
            InitializeProcThreadAttributeList(storage.as_mut_ptr().cast(), 2, 0, &mut bytes)
        } == 0
        {
            return Err(ShellError::SpawnFailed);
        }
        Ok(Self(storage))
    }

    fn as_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.0.as_mut_ptr().cast()
    }

    /// The array and handles must outlive this list.
    unsafe fn handles(&mut self, key: u32, handles: &[HANDLE]) -> Result<(), ShellError> {
        let updated = unsafe {
            UpdateProcThreadAttribute(
                self.as_ptr(),
                0,
                key as usize,
                handles.as_ptr().cast(),
                size_of_val(handles),
                null_mut(),
                null(),
            )
        };
        if updated == 0 {
            return Err(ShellError::SpawnFailed);
        }
        Ok(())
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.as_ptr()) };
    }
}

struct Child {
    process: OwnedHandle,
    job: OwnedHandle,
    stdout: File,
    stderr: File,
}

impl Child {
    fn spawn(request: &CommandRequest) -> Result<Self, ShellError> {
        if !request
            .executable
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            return Err(ShellError::InvalidRequest);
        }
        let executable = wide(request.executable.as_os_str())?;
        // Windows PowerShell cannot use a verbatim DOS path as its working directory.
        let cwd = wide(dunce::simplified(&request.cwd).as_os_str())?;
        let mut command = command_line(request)?;
        let environment = environment()?;
        let job = owned_job()?;
        let (stdin, writer) = pipe(true)?;
        drop(writer); // Immediate EOF, like /dev/null.
        let (out, stdout) = pipe(false)?;
        let (err, stderr) = pipe(false)?;
        let handles = [
            stdin.as_raw_handle(),
            out.as_raw_handle(),
            err.as_raw_handle(),
        ];
        let jobs = [job.as_raw_handle()];
        let mut attributes = Attributes::new()?;
        // Both arrays and the owned handles outlive the attribute list. Assign the job
        // at creation so no user code can run before membership is established.
        unsafe {
            attributes.handles(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles)?;
            attributes.handles(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
        }
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = size_of_val(&startup) as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = handles[0];
        startup.StartupInfo.hStdOutput = handles[1];
        startup.StartupInfo.hStdError = handles[2];
        startup.lpAttributeList = attributes.as_ptr();
        let mut info = PROCESS_INFORMATION::default();
        let created = unsafe {
            CreateProcessW(
                executable.as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
                environment.as_ptr().cast(),
                cwd.as_ptr(),
                (&raw const startup).cast(),
                &mut info,
            )
        };
        if created == 0 {
            return Err(ShellError::SpawnFailed);
        }
        // A successful CreateProcessW transfers both handles to the caller.
        let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
        drop(unsafe { OwnedHandle::from_raw_handle(info.hThread) });
        Ok(Self {
            process,
            job,
            stdout: File::from(stdout),
            stderr: File::from(stderr),
        })
    }

    fn exit_code(&self) -> Result<Option<i32>, ShellError> {
        match unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut code = 0;
                if unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) } == 0 {
                    return Err(ShellError::WaitFailed);
                }
                Ok(Some(code as i32))
            }
            _ => Err(ShellError::WaitFailed),
        }
    }

    fn active_processes(&self) -> Result<u32, ShellError> {
        let mut stats = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let queried = unsafe {
            QueryInformationJobObject(
                self.job.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&raw mut stats).cast(),
                size_of_val(&stats) as u32,
                null_mut(),
            )
        };
        if queried == 0 {
            return Err(ShellError::WaitFailed);
        }
        Ok(stats.ActiveProcesses)
    }
}

fn read_chunk(pipe: &mut File, capture: &mut Capture, limit: usize) -> bool {
    if capture.eof {
        return false;
    }
    let mut available = 0;
    // One reader per pipe. Read only the bytes already buffered, so an empty pipe never blocks.
    if unsafe {
        PeekNamedPipe(
            pipe.as_raw_handle(),
            null_mut(),
            0,
            null_mut(),
            &mut available,
            null_mut(),
        )
    } == 0
    {
        let code = io::Error::last_os_error()
            .raw_os_error()
            .map(|code| code as u32);
        capture.eof = true;
        capture.failed = !matches!(code, Some(ERROR_BROKEN_PIPE | ERROR_NO_DATA));
        return false;
    }
    if available == 0 {
        return false;
    }
    let mut bytes = [0; 8192];
    let len = bytes.len().min(available as usize);
    match pipe.read(&mut bytes[..len]) {
        Ok(0) => capture.eof = true,
        Ok(count) => {
            capture.append(&bytes[..count], limit);
            return true;
        }
        Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
        Err(_) => {
            capture.failed = true;
            capture.eof = true;
        }
    }
    false
}

pub(super) async fn execute(
    request: CommandRequest,
    cancellation: CancellationToken,
) -> Result<CommandResult, ShellError> {
    if cancellation.is_cancelled() {
        return Ok(super::cancelled_before_start());
    }
    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    let mut child = Child::spawn(&request)?;
    let mut out = Capture::default();
    let mut err = Capture::default();
    let (outcome, code) = loop {
        if cancellation.is_cancelled() {
            break (CommandOutcome::Cancelled, None);
        }
        if Instant::now() >= deadline {
            break (CommandOutcome::TimedOut, None);
        }
        if let Some(code) = child.exit_code()? {
            break (CommandOutcome::Exited, Some(code));
        }
        if read_chunk(&mut child.stdout, &mut out, request.output_limit_bytes)
            | read_chunk(&mut child.stderr, &mut err, request.output_limit_bytes)
        {
            tokio::task::yield_now().await;
        } else {
            tokio::select! {
                _ = cancellation.cancelled() => {},
                _ = tokio::time::sleep_until(deadline.min(Instant::now() + POLL)) => {},
            }
        }
    };
    // Also terminate remaining descendants after an ordinary exit of the leader.
    if child.active_processes()? != 0
        && unsafe { TerminateJobObject(child.job.as_raw_handle(), TERMINATED_EXIT_CODE) } == 0
        && child.active_processes()? != 0
    {
        return Err(ShellError::WaitFailed);
    }
    let cleanup = Instant::now() + CLEANUP_TIMEOUT;
    loop {
        if child.active_processes()? == 0 && out.eof && err.eof {
            break;
        }
        if Instant::now() >= cleanup {
            if child.active_processes()? != 0 {
                return Err(ShellError::WaitFailed);
            }
            break; // An inherited pipe can outlive the job; mark its output incomplete.
        }
        if read_chunk(&mut child.stdout, &mut out, request.output_limit_bytes)
            | read_chunk(&mut child.stderr, &mut err, request.output_limit_bytes)
        {
            tokio::task::yield_now().await;
        } else {
            tokio::time::sleep(POLL).await;
        }
    }
    Ok(CommandResult {
        outcome,
        exit_code: code,
        signal: None,
        stdout: out.finish(),
        stderr: err.finish(),
    })
}
