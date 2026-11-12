use super::*;
use std::time::Duration;
use tempfile::TempDir;

fn request(cwd: &std::path::Path, script: &str) -> CommandRequest {
    CommandRequest {
        cwd: cwd.to_path_buf(),
        executable: PathBuf::from("/bin/sh"),
        args: vec!["-c".into(), script.into(), "situate-command".into()],
        timeout_ms: 5_000,
        output_limit_bytes: 65_536,
    }
}

async fn run(request: CommandRequest) -> CommandResult {
    execute(request, CancellationToken::new()).await.unwrap()
}

async fn wait_for_file(path: &std::path::Path) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("child did not become ready");
}

#[tokio::test]
async fn real_workspace_unicode_arguments_streams_and_nonzero_write() {
    let root = TempDir::new().unwrap();
    let cwd = root.path().join("workspace space 雪");
    std::fs::create_dir(&cwd).unwrap();
    let mut command = request(
        &cwd,
        "printf '%s' \"$1\"; printf 'warning 雪' >&2; printf changed > output.txt; pwd > cwd.txt; exit 7",
    );
    command.args.push("literal ; $(not-executed) 雪".into());
    let result = run(command).await;
    assert_eq!(result.outcome, CommandOutcome::Exited);
    assert_eq!(result.exit_code, Some(7));
    assert_eq!(result.signal, None);
    assert_eq!(result.stdout.text, "literal ; $(not-executed) 雪");
    assert_eq!(result.stderr.text, "warning 雪");
    assert!(!result.stdout.incomplete);
    assert!(!result.stderr.incomplete);
    assert_eq!(
        std::fs::read_to_string(cwd.join("output.txt")).unwrap(),
        "changed"
    );
    let actual_cwd = std::fs::read_to_string(cwd.join("cwd.txt")).unwrap();
    assert_eq!(
        PathBuf::from(actual_cwd.trim()).canonicalize().unwrap(),
        cwd.canonicalize().unwrap()
    );
}

#[tokio::test]
async fn direct_executable_does_not_interpret_arguments() {
    let root = TempDir::new().unwrap();
    let mut command = request(root.path(), "unused");
    command.executable = PathBuf::from("/usr/bin/printf");
    command.args = vec!["%s".into(), "a; echo bad > injected".into()];
    let result = run(command).await;
    assert_eq!(result.stdout.text, "a; echo bad > injected");
    assert!(!root.path().join("injected").exists());
}

#[tokio::test]
async fn concurrent_commands_keep_cwd_and_streams_separate() {
    let first = TempDir::new().unwrap();
    let second = TempDir::new().unwrap();
    let (a, b) = tokio::join!(
        run(request(
            first.path(),
            "printf first > marker; printf a-out; printf a-err >&2"
        )),
        run(request(
            second.path(),
            "printf second > marker; printf b-out; printf b-err >&2"
        )),
    );
    assert_eq!(
        (a.stdout.text.as_str(), a.stderr.text.as_str()),
        ("a-out", "a-err")
    );
    assert_eq!(
        (b.stdout.text.as_str(), b.stderr.text.as_str()),
        ("b-out", "b-err")
    );
    assert_eq!(
        std::fs::read_to_string(first.path().join("marker")).unwrap(),
        "first"
    );
    assert_eq!(
        std::fs::read_to_string(second.path().join("marker")).unwrap(),
        "second"
    );
}

#[tokio::test]
async fn both_pipes_are_drained_after_the_capture_limit() {
    let root = TempDir::new().unwrap();
    let mut command = request(
        root.path(),
        "i=0; while [ \"$i\" -lt 12000 ]; do printf '12345678'; printf 'abcdefgh' >&2; i=$((i+1)); done",
    );
    command.output_limit_bytes = 17;
    let result = run(command).await;
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.stdout.text, "12345678123456781");
    assert_eq!(result.stderr.text, "abcdefghabcdefgha");
    for stream in [result.stdout, result.stderr] {
        assert_eq!(stream.captured_bytes, 17);
        assert_eq!(stream.total_bytes, 96_000);
        assert!(stream.truncated);
        assert!(!stream.incomplete);
    }
}

#[tokio::test]
async fn split_unicode_and_invalid_bytes_are_explicitly_lossy() {
    let root = TempDir::new().unwrap();
    let mut command = request(root.path(), "printf '\\351\\233\\252\\377'");
    command.output_limit_bytes = 2;
    let result = run(command).await;
    assert_eq!(result.stdout.captured_bytes, 2);
    assert_eq!(result.stdout.total_bytes, 4);
    assert_eq!(result.stdout.text, "�");
    assert!(result.stdout.truncated);
}

#[tokio::test]
async fn deadline_kills_background_writer_and_drains_partial_output() {
    let root = TempDir::new().unwrap();
    let mut command = request(
        root.path(),
        "(sleep 1; printf escaped > late) & printf started; printf error >&2; wait",
    );
    command.timeout_ms = 100;
    let result = run(command).await;
    assert_eq!(result.outcome, CommandOutcome::TimedOut);
    assert_eq!(result.signal, Some(libc::SIGKILL));
    assert_eq!(result.stdout.text, "started");
    assert_eq!(result.stderr.text, "error");
    assert!(!result.stdout.incomplete);
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert!(!root.path().join("late").exists());
}

#[tokio::test]
async fn cancellation_kills_owned_descendants_without_stopping_other_command() {
    let cancelled = TempDir::new().unwrap();
    let other = TempDir::new().unwrap();
    let token = CancellationToken::new();
    let job = tokio::spawn(execute(
        request(
            cancelled.path(),
            "(sleep 1; printf escaped > late) & printf ready > ready; wait",
        ),
        token.clone(),
    ));
    wait_for_file(&cancelled.path().join("ready")).await;
    let unaffected = tokio::spawn(execute(
        request(
            other.path(),
            "sleep 0.2; printf survived > result; printf ok",
        ),
        CancellationToken::new(),
    ));
    token.cancel();
    let result = job.await.unwrap().unwrap();
    assert_eq!(result.outcome, CommandOutcome::Cancelled);
    assert_eq!(result.signal, Some(libc::SIGKILL));
    let result = unaffected.await.unwrap().unwrap();
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.stdout.text, "ok");
    assert_eq!(
        std::fs::read_to_string(other.path().join("result")).unwrap(),
        "survived"
    );
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert!(!cancelled.path().join("late").exists());
}

#[tokio::test]
async fn leader_exit_does_not_leave_background_writer_alive() {
    let root = TempDir::new().unwrap();
    let result = run(request(
        root.path(),
        "(sleep 1; printf escaped > late) & printf done; exit 3",
    ))
    .await;
    assert_eq!(result.exit_code, Some(3));
    assert_eq!(result.stdout.text, "done");
    assert!(!result.stdout.incomplete);
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert!(!root.path().join("late").exists());
}

#[tokio::test]
async fn abandoning_the_future_still_kills_ordinary_descendants() {
    let root = TempDir::new().unwrap();
    let job = tokio::spawn(execute(
        request(
            root.path(),
            "(sleep 1; printf escaped > late) & printf ready > ready; wait",
        ),
        CancellationToken::new(),
    ));
    wait_for_file(&root.path().join("ready")).await;
    job.abort();
    assert!(job.await.unwrap_err().is_cancelled());
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert!(!root.path().join("late").exists());
}

#[tokio::test]
async fn pre_cancelled_command_never_starts() {
    let root = TempDir::new().unwrap();
    let token = CancellationToken::new();
    token.cancel();
    let result = execute(request(root.path(), "printf bad > marker"), token)
        .await
        .unwrap();
    assert_eq!(result.outcome, CommandOutcome::Cancelled);
    assert_eq!(result.exit_code, None);
    assert!(!root.path().join("marker").exists());
}

#[tokio::test]
async fn invalid_bounds_relative_executable_and_spawn_failure_are_distinct() {
    let root = TempDir::new().unwrap();
    let mut command = request(root.path(), "true");
    command.timeout_ms = 0;
    assert_eq!(
        execute(command, CancellationToken::new())
            .await
            .unwrap_err(),
        ShellError::InvalidRequest
    );
    let mut command = request(root.path(), "true");
    command.executable = PathBuf::from("sh");
    assert_eq!(
        execute(command, CancellationToken::new())
            .await
            .unwrap_err(),
        ShellError::InvalidRequest
    );
    let mut command = request(root.path(), "true");
    command.executable = root.path().join("nonexistent");
    assert_eq!(
        execute(command, CancellationToken::new())
            .await
            .unwrap_err(),
        ShellError::SpawnFailed
    );
}

#[tokio::test]
async fn child_environment_excludes_application_specific_variables() {
    let root = TempDir::new().unwrap();
    let result = run(request(root.path(), "env")).await;
    for line in result.stdout.text.lines() {
        let name = line.split('=').next().unwrap();
        assert!(
            [
                "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "PWD", "SHLVL", "_"
            ]
            .contains(&name),
            "unexpected environment variable name: {name}"
        );
    }
}

#[tokio::test]
async fn cwd_is_not_a_filesystem_jail() {
    let root = TempDir::new().unwrap();
    let cwd = root.path().join("workspace");
    std::fs::create_dir(&cwd).unwrap();
    let result = run(request(&cwd, "printf outside > ../outside")).await;
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(
        std::fs::read_to_string(root.path().join("outside")).unwrap(),
        "outside"
    );
}

#[test]
fn capability_names_the_actual_interpreter_and_ownership_limit() {
    let facts = capability();
    assert!(facts.available);
    assert_eq!(facts.interpreter, Some("/bin/sh"));
    assert_eq!(facts.interpreter_dialect, Some("posixSh"));
    assert_eq!(facts.interpreter_args, vec!["-c"]);
    assert_eq!(facts.ownership, "processGroup");
    assert!(!facts.detached_descendants_contained);
    assert!(
        serde_json::to_value(&facts)
            .unwrap()
            .get("requiresExecutionApproval")
            .is_none()
    );
}
