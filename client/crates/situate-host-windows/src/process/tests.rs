use super::*;
use std::{
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::Path,
    time::Duration,
};
use tempfile::TempDir;
use windows_sys::Win32::{
    Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
};

fn request(cwd: &Path, script: &str) -> CommandRequest {
    let shell = capability();
    assert_eq!(shell.interpreter_dialect, Some("windowsPowerShell"));
    CommandRequest {
        cwd: cwd.to_owned(),
        executable: shell
            .interpreter
            .expect("system PowerShell is required")
            .into(),
        args: make_script_args(&shell.interpreter_args, script.into()),
        timeout_ms: 60_000,
        output_limit_bytes: 32_768,
    }
}

#[tokio::test]
async fn powershell_preserves_unicode_cwd_and_drains_both_pipes_past_limit() {
    let root = TempDir::new().unwrap();
    let cwd = root.path().join("workspace space 雪");
    std::fs::create_dir(&cwd).unwrap();
    let mut command = request(
        &cwd.canonicalize().unwrap(),
        r#"
        [IO.File]::WriteAllText((Join-Path $PWD 'marker.txt'), 'expected "value" 雪');
        [Console]::Out.Write('雪' + ('a' * 96000));
        [Console]::Error.Write('警' + ('b' * 96000));
        exit 17
    "#,
    );
    command.output_limit_bytes = 8;
    let result = execute(command, CancellationToken::new()).await.unwrap();
    assert_eq!(
        result.outcome,
        CommandOutcome::Exited,
        "stdout: {:?}, stderr: {:?}",
        result.stdout,
        result.stderr
    );
    assert_eq!(result.exit_code, Some(17));
    assert_eq!(result.signal, None);
    assert_eq!(result.stdout.text, "雪aaaaa");
    assert_eq!(result.stderr.text, "警bbbbb");
    for stream in [result.stdout, result.stderr] {
        assert_eq!(stream.captured_bytes, 8);
        assert_eq!(stream.total_bytes, 96_003);
        assert!(stream.truncated && !stream.incomplete);
    }
    assert_eq!(
        std::fs::read_to_string(cwd.join("marker.txt")).unwrap(),
        "expected \"value\" 雪"
    );
}

#[test]
fn windows_job_child_fixture() {
    if std::env::var_os("SITUATE_TEST_JOB_CHILD").is_none() {
        return;
    }
    std::fs::write("child.txt", std::process::id().to_string()).unwrap();
    std::thread::sleep(Duration::from_secs(120));
}

#[tokio::test]
async fn windows_job_drains_live_children_on_cancel_timeout_and_leader_exit() {
    async fn check(expected: CommandOutcome) {
        let root = TempDir::new().unwrap();
        let exe = std::env::current_exe().unwrap();
        let exe = dunce::simplified(&exe)
            .to_str()
            .unwrap()
            .replace('\'', "''");
        let script = format!(
            r#"
            $ErrorActionPreference = 'Stop';
            $info = [Diagnostics.ProcessStartInfo]::new();
            $info.FileName = '{exe}';
            $info.WorkingDirectory = $PWD.Path;
            $info.UseShellExecute = $false;
            $info.CreateNoWindow = $true;
            $info.Arguments = '--exact process::tests::windows_job_child_fixture';
            $info.EnvironmentVariables['SITUATE_TEST_JOB_CHILD'] = '1';
            $child = [Diagnostics.Process]::Start($info);
            while (!(Test-Path -LiteralPath 'release')) {{ Start-Sleep -Milliseconds 25 }};
            exit 19
        "#
        );
        let mut command = request(root.path(), &script);
        if expected == CommandOutcome::TimedOut {
            command.timeout_ms = 45_000;
        }
        let token = CancellationToken::new();
        let worker = tokio::spawn(execute(command, token.clone()));
        let started = tokio::time::timeout(Duration::from_secs(40), async {
            loop {
                if let Ok(text) = std::fs::read_to_string(root.path().join("child.txt"))
                    && let Ok(pid) = text.parse::<u32>()
                {
                    break pid;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        let pid = match started {
            Ok(pid) => pid,
            Err(_) => {
                token.cancel();
                let result = worker.await.unwrap();
                panic!("the job's child did not start: {result:?}");
            }
        };
        let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!raw.is_null());
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        assert_eq!(
            unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) },
            WAIT_TIMEOUT
        );
        match expected {
            CommandOutcome::Cancelled => token.cancel(),
            CommandOutcome::Exited => std::fs::write(root.path().join("release"), []).unwrap(),
            CommandOutcome::TimedOut => {}
        }
        let result = worker.await.unwrap().unwrap();
        assert_eq!(result.outcome, expected, "{}", result.stderr.text);
        assert_eq!(
            result.exit_code,
            (expected == CommandOutcome::Exited).then_some(19)
        );
        assert_eq!(
            unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) },
            WAIT_OBJECT_0
        );
        assert!(!result.stdout.incomplete && !result.stderr.incomplete);
    }
    check(CommandOutcome::Cancelled).await;
    check(CommandOutcome::Exited).await;
    check(CommandOutcome::TimedOut).await;
}
