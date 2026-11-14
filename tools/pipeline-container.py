"""Run portable pipeline commands in the repository's pinned tool image."""

import glob
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
IMAGE = re.compile(r"ghcr\.io/getsituate/situate-ci-linux@sha256:[a-f0-9]{64}\Z")
CONTEXT = (
    "GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID",
    "GITHUB_REF", "GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT",
    "GITHUB_HEAD_REF", "GITHUB_BASE_REF", "PIPELINE_PLAN", "PIPELINE_PLAN_DIGEST", "PIPELINE_NEEDS",
    "MONITORING_WEEKLY", "DIAGNOSTIC_SELECTION", "DIAGNOSTIC_TARGET",
)


def mount(source, target=None, readonly=False):
    source = Path(source).resolve(strict=True)
    target = str(target or source)
    if ',' in str(source) or ',' in target:
        raise ValueError("Docker mount paths cannot contain commas.")
    return ["--mount", f"type=bind,src={source},dst={target}" + (",readonly" if readonly else "")]


def dependency_paths(root):
    paths = {root / "node_modules", root / "client/node_modules", root / "requirements/node_modules"}
    package = root / "client/package.json"
    if package.exists():
        for pattern in json.loads(package.read_text()).get("workspaces", []):
            for item in glob.glob(str(root / "client" / pattern)):
                directory = Path(item)
                if (directory / "package.json").is_file():
                    directory.resolve().relative_to(root)
                    paths.add(directory / "node_modules")
    return sorted(paths)


def git_environment():
    return {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "LC_ALL") if key in os.environ}


def git_common_dir(root):
    git = root / ".git"
    if not git.exists():
        return None
    if git.is_file():
        return Path(subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            text=True, env=git_environment()).strip()).resolve(strict=True)
    return git.resolve(strict=True)


def git_mounts(root, state, empty):
    common = git_common_dir(root)
    if common is None:
        return []
    result = mount(common, readonly=True) if (root / ".git").is_file() else []
    config = state / "git-config"
    config.write_text("[core]\n\trepositoryformatversion = 0\n\tbare = false\n")
    origin = subprocess.run(["git", "-C", str(root), "remote", "get-url", "origin"], capture_output=True, text=True, env=git_environment())
    remote = re.fullmatch(r'(?:https?://(?:[^/@]+@)?github\.com/|(?:ssh://)?git@github\.com[:/])([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)', origin.stdout.strip()) if origin.returncode == 0 else None
    if remote:
        with config.open("a") as stream:
            stream.write('[remote "origin"]\n\turl = https://github.com/' + remote[1] + '\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n')
    config.chmod(0o600)
    for directory in [common, *common.glob("worktrees/*")]:
        for name in ("config", "config.worktree"):
            if (directory / name).exists():
                result += mount(config if directory == common and name == "config" else empty, directory / name, readonly=True)
    if (common / "hooks").exists():
        result += ["--tmpfs", f"{common / 'hooks'}:mode=0555"]
    return result


def arguments(root, state, image, command, environment, name, token, lease=None):
    root = Path(root).resolve(strict=True)
    state = Path(state).resolve(strict=True)
    if not IMAGE.fullmatch(image):
        raise ValueError("Expected the pinned public CI tool image digest.")
    if os.getuid() == 0:
        raise ValueError("Run tool containers as a non-root host user.")
    cid = str(lease or state / "docker-lease.json") + "." + token + ".cid"
    args = ["run", "--rm", "--init", "--pull", "never", "--name", name, "--cidfile", cid,
            "--label", f"dev.situate.ci-run={token}", "--platform", "linux/amd64",
            "--user", f"{os.getuid()}:{os.getgid()}", "--shm-size", "2g",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
    args += mount(root) + mount(state)
    cache = state / "cache"
    cache.mkdir(exist_ok=True)
    args += mount(cache, "/ci-cache")
    for path in dependency_paths(root):
        if ',' in str(path):
            raise ValueError("Docker mount paths cannot contain commas.")
        args += ["--tmpfs", f"{path}:exec,mode=1777"]
    for relative in ("client/target", "tools/dev-tui/target"):
        target = cache / relative.replace('/', '-')
        target.mkdir(exist_ok=True)
        args += mount(target, root / relative)
    empty = state / "empty-env"
    empty.write_text("")
    empty.chmod(0o600)
    args += git_mounts(root, state, empty)
    for relative in (".env", "client/.apple-release.local.json"):
        if (root / relative).exists():
            args += mount(empty, root / relative, readonly=True)
    for relative in (".release-operations", ".release-preparation"):
        if (root / relative).exists():
            args += ["--tmpfs", f"{root / relative}:mode=0700"]
    env = {
        "CI": "true", "HOME": "/tmp/situate-ci-home", "CARGO_HOME": "/ci-cache/cargo",
        "npm_config_cache": "/ci-cache/npm", "PLAYWRIGHT_BROWSERS_PATH": "/ci-cache/browsers",
        "RUSTUP_TOOLCHAIN": rust_version(root),
        "SITUATE_TOOL_CONTAINER": "1", "SITUATE_TOOL_BUILD_SLOTS": "1", "SITUATE_CI_IMAGE": image,
        "SITUATE_COORDINATED_WORKTREE": str(root), "LIBGL_ALWAYS_SOFTWARE": "1",
        "WEBKIT_DISABLE_DMABUF_RENDERER": "1", "CARGO_INCREMENTAL": "0", "GIT_OPTIONAL_LOCKS": "0",
        "CARGO_PROFILE_DEV_DEBUG": "line-tables-only", "CARGO_PROFILE_TEST_DEBUG": "line-tables-only",
    }
    env.update({key: environment[key] for key in (*CONTEXT, "CARGO_NET_OFFLINE") if key in environment})
    if command[:2] == ["actions", "plan"] and environment.get("GH_TOKEN"):
        args += ["--env", "GH_TOKEN"]
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"):
        args += ["--env", f"{key}="]
    for key in ("GITHUB_EVENT_PATH", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY"):
        if command[:1] == ["actions"] and environment.get(key):
            path = Path(environment[key]).resolve(strict=True)
            if not path.is_relative_to(root) and not path.is_relative_to(state):
                args += mount(path, readonly=key == "GITHUB_EVENT_PATH")
            env[key] = str(path)
    for key, value in env.items():
        args += ["--env", f"{key}={value}"]
    script = ('set -eu; mkdir -p "$HOME" "$CARGO_HOME" "$npm_config_cache" "$PLAYWRIGHT_BROWSERS_PATH"; '
              'source /opt/ci-tools/ci-user.sh; git config --global --add safe.directory "$PWD"; '
              'exec /opt/volta/bin/node tools/pipeline-container-entry.mjs "$@"')
    args += ["--workdir", str(root), image, "bash", "-c", script, "pipeline", *command]
    return args


def rust_version(root):
    versions = re.findall(r'^channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$', (root / "client/rust-toolchain.toml").read_text(), re.MULTILINE)
    if len(versions) != 1:
        raise ValueError("Expected an exact Rust toolchain version.")
    return versions[0]


def write_lease(path, name, token, *, environment=None, creation_pending=False, build_pending=False):
    path = Path(path)
    parent = path.parent.lstat()
    if not path.is_absolute() or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError("Docker lease directory must be private and owned.")
    data = {"name": name, "token": token}
    if creation_pending:
        data["creationPending"] = True
    if build_pending:
        data["buildPending"] = True
    if environment is not None:
        data["dockerEnvironment"] = environment
    if len(json.dumps(data).encode()) > 4096:
        raise ValueError("Docker lease metadata exceeds its size limit.")
    # Serialize publishers so rename cannot replace another launcher's lease.
    publication = path.with_name(path.name + ".publishing")
    publication.mkdir(mode=0o700)
    temporary = publication / "container.json"
    try:
        if path.exists() or path.is_symlink():
            raise ValueError("An earlier container lease still exists.")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(data, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.rename(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)
        publication.rmdir()


def container_owner():
    spec = importlib.util.spec_from_file_location("container_owner", ROOT / "tools/worktree-supervisor.py")
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    return owner


def docker_client(lease, token, arguments, environment):
    """Wait for host build admission before issuing any Docker request."""
    owner = container_owner()
    while True:
        try:
            current = owner.read_docker_lease(Path(lease))
            if current is None or current[0]["token"] != token:
                return 130
            ready = not current[0].get("buildPending") or owner.docker_build_ack(Path(lease), current[0]) is not None
        except (OSError, ValueError, TypeError):
            ready = False
        if ready:
            try:
                os.execvpe("docker", ["docker", *arguments], environment)
            except OSError:
                owner.cleanup_docker_lease(Path(lease), creation_started=False)
                raise
        time.sleep(0.05)


def host_environment(environment, command):
    names = {"PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "TMPDIR", "TMP", "TEMP", "VOLTA_HOME", "CI", "SITUATE_COORDINATED_WORKTREE", "SITUATE_DOCKER_LEASE", "CARGO_NET_OFFLINE", "GITHUB_EVENT_PATH", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", *CONTEXT, *container_owner().DOCKER_ENVIRONMENT}
    if command[:2] == ["actions", "plan"] or command[:1] == ["_docker-client"]:
        names.add("GH_TOKEN")
    return {key: value for key, value in environment.items() if key in names}


def main(argv=None, environment=None):
    args = list(sys.argv[1:] if argv is None else argv)
    environment = host_environment(dict(os.environ if environment is None else environment), args)
    if args[:1] == ["_docker-client"]:
        if len(args) < 4:
            raise ValueError("Invalid internal Docker client request.")
        return docker_client(args[1], args[2], args[3:], environment)
    if not args or args[0] not in ("actions", "lane", "suites", "monitoring"):
        raise ValueError("Usage: python3 tools/pipeline-container.py actions|lane|suites|monitoring ARGUMENTS")
    lock = json.loads((ROOT / "tools/ci-image.lock.json").read_text())
    if lock.get("version") != 1 or lock.get("platform") != "linux/amd64" or not IMAGE.fullmatch(lock.get("image", "")):
        raise ValueError("Invalid CI tool image lock.")
    subprocess.run(["docker", "info"], check=True, stdout=subprocess.DEVNULL, env=environment)
    present = subprocess.run(["docker", "image", "inspect", lock["image"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=environment)
    if present.returncode != 0:
        subprocess.run(["docker", "pull", "--platform", lock["platform"], lock["image"]], check=True, stdout=sys.stderr, env=environment)
    common = git_common_dir(ROOT)
    mount_roots = [ROOT, *([common] if common else [])]
    with tempfile.TemporaryDirectory(prefix="situate-tool-container-") as temporary:
        context = Path(temporary).resolve()
        if any(context.is_relative_to(path) for path in mount_roots):
            raise ValueError("Container control files must remain outside the checkout. Use an external TMPDIR.")
        state = context / "data"
        state.mkdir(mode=0o700)
        command = args
        if args[0] == "lane":
            if len(args) != 5:
                raise ValueError("Lane execution requires workflow, plan file, lane and receipt file.")
            workflow, plan, lane, receipt = args[1:]
            (state / "plan.json").write_bytes(Path(plan).read_bytes())
            command = ["lane", workflow, str(state / "plan.json"), lane, str(state / "receipt.json")]
        elif args[0] == "suites":
            if len(args) != 3:
                raise ValueError("Suite execution requires a plan file and report file.")
            plan, receipt = args[1:]
            (state / "plan.json").write_bytes(Path(plan).read_bytes())
            command = ["suites", str(state / "plan.json"), str(state / "receipt.json")]
        token = str(uuid.uuid4())
        name = "situate-pipeline-" + token
        inherited = environment.get("SITUATE_DOCKER_LEASE")
        coordinated = environment.get("SITUATE_COORDINATED_WORKTREE") == str(ROOT)
        if coordinated and not inherited:
            raise ValueError("Coordinated container execution requires its owner's Docker lease.")
        lease = Path(inherited) if coordinated else context / "docker-lease.json"
        if any(lease.resolve().is_relative_to(path) for path in mount_roots):
            raise ValueError("Docker control leases must remain outside the checkout.")
        if coordinated and lease.exists():
            raise ValueError("An earlier container requires owner cleanup before another launch.")
        docker_args = arguments(ROOT, state, lock["image"], command, environment, name, token, lease)
        owner = container_owner()
        docker_environment = {key: environment[key] for key in owner.DOCKER_ENVIRONMENT if key in environment}
        build_pending = args[:2] not in (["actions", "plan"], ["actions", "aggregate"], ["actions", "monitoring-plan"])
        command_line = [sys.executable, "-B", str(ROOT / "tools/pipeline-container.py"), "_docker-client", str(lease), token, *docker_args]
        if not coordinated:
            command_line = [sys.executable, str(ROOT / "tools/worktree-supervisor.py"),
                            "worktree", str(ROOT), "--docker-lease", str(lease), *command_line]
        child = None
        cancelled = False
        def cancel(_signal, _frame):
            nonlocal cancelled
            cancelled = True
            if child is not None and child.stdin and not child.stdin.closed:
                child.stdin.close()
        handlers = {kind: signal.signal(kind, cancel) for kind in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        try:
            write_lease(lease, name, token, environment=docker_environment, creation_pending=True, build_pending=build_pending)
            if cancelled:
                owner.cleanup_docker_lease(lease, creation_started=False)
                return 130
            try:
                child = subprocess.Popen(command_line, env=environment, stdin=subprocess.PIPE if not coordinated else None, umask=0o077)
            except OSError:
                owner.cleanup_docker_lease(lease, creation_started=False)
                raise
            while True:
                if cancelled and child.stdin and not child.stdin.closed:
                    child.stdin.close()
                if coordinated and cancelled:
                    try:
                        acknowledged = owner.docker_cid(lease, token)
                    except (OSError, ValueError):
                        acknowledged = None
                    if acknowledged is not None:
                        child.send_signal(signal.SIGTERM)
                        cancelled = False
                try:
                    code = child.wait(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    pass
        finally:
            if coordinated and child is not None:
                owner.cleanup_docker_lease(lease)
            for kind, handler in handlers.items():
                signal.signal(kind, handler)
            if child is not None and child.stdin and not child.stdin.closed:
                child.stdin.close()
        if args[0] in ("lane", "suites") and (state / "receipt.json").is_file():
            Path(receipt).write_bytes((state / "receipt.json").read_bytes())
        return code if code >= 0 else 128 - code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
