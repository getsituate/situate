"""Validate an owned native-test package and supervise its guest execution."""

import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time


cancelled = False


def cancel(_signal, _frame):
    global cancelled
    cancelled = True


def private_directory(directory):
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Run directories must be private and owned by the guest user.")


def validate_root(request):
    root = Path(request["root"])
    if not re.fullmatch(r"[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}", request["id"]):
        raise ValueError("Invalid run identifier.")
    if root != Path.home() / ".situate-test-runs" / request["id"]:
        raise ValueError("Invalid guest run root.")
    for directory in reversed(root.parent.parents):
        if directory.is_symlink():
            raise ValueError("Symlink in guest run ancestry.")
    private_directory(root.parent)
    return root


def metadata(root):
    return root.parent / ".native-vm-owners" / root.name


def owned(root, identifier):
    private_directory(root)
    private_directory(metadata(root).parent)
    private_directory(metadata(root))
    marker = metadata(root) / ".native-vm-owner"
    info = root.lstat()
    expected = {"id": identifier, "device": info.st_dev, "inode": info.st_ino}
    if marker.is_symlink() or json.loads(marker.read_text()) != expected:
        raise ValueError("Guest run ownership does not match.")


def state(root, value=None):
    marker = metadata(root) / ".native-vm-state"
    if marker.is_symlink():
        raise ValueError("Invalid guest state file.")
    if value is not None:
        marker.write_text(value)
    return marker.read_text()


def safe_path(name):
    return (isinstance(name, str) and bool(name) and not name.startswith("/")
            and all(part not in ("", ".", "..") for part in name.split("/"))
            and not any(ord(char) < 32 or ord(char) == 127 or char == "\\" for char in name)
            and not name.split("/")[0].startswith(".native-vm-"))


def upload(root):
    if state(root) != "created":
        raise ValueError("Package was already uploaded.")
    state(root, "uploading")
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|*") as archive:
        seen = set()
        for member in archive:
            name = member.name.removeprefix("./").rstrip("/")
            if member.name in (".", "./") and member.isdir():
                continue
            if not safe_path(name) or name in seen or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe package archive member.")
            seen.add(name)
            destination = metadata(root) / "manifest.json" if name == ".situate-manifest.json" else root / name
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if member.isdir():
                destination.mkdir(mode=0o700, exist_ok=True)
            else:
                with destination.open("xb") as target:
                    shutil.copyfileobj(archive.extractfile(member), target)
                destination.chmod(member.mode & 0o777)
    manifest = metadata(root) / "manifest.json"
    entries = json.loads(manifest.read_text())
    expected = set()
    for entry in entries:
        name = entry["path"]
        if not safe_path(name) or name in expected:
            raise ValueError("Invalid package manifest path.")
        expected.add(name)
        file = root / name
        if not file.is_file() or stat.S_IMODE(file.stat().st_mode) != entry["mode"] or hashlib.sha256(file.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("Package hash mismatch.")
    actual = {str(file.relative_to(root)) for file in root.rglob("*") if file.is_file()}
    if expected != actual:
        raise ValueError("Package manifest does not cover the archive.")
    state(root, "uploaded")


def snapshot():
    output = subprocess.check_output(["/bin/ps", "-A", "-o", "pid=,ppid=,pgid=,stat=,lstart="], text=True, timeout=10)
    result = {}
    for line in output.splitlines():
        match = re.match(r"\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$", line)
        if match and not match[4].startswith("Z"):
            result[int(match[1])] = (int(match[2]), int(match[3]), match[5])
    return result


def observe(known, processes, group, leader_reserved):
    live = {pid for pid, born in known.items() if pid in processes and processes[pid][2] == born}
    group_owned = leader_reserved or any(processes[pid][1] == group for pid in live)
    changed = True
    while changed:
        changed = False
        for pid, (parent, pgid, born) in processes.items():
            if pid not in live and (parent in live or (group_owned and pgid == group)):
                known[pid] = born
                live.add(pid)
                changed = True
    return live


def disconnected(last_heartbeat):
    if cancelled:
        return True, last_heartbeat
    readable, _, _ = select.select([sys.stdin.buffer], [], [], 0)
    if readable:
        if not os.read(sys.stdin.fileno(), 4096):
            return True, last_heartbeat
        last_heartbeat = time.monotonic()
    return time.monotonic() - last_heartbeat > 10, last_heartbeat


def execute(root, request):
    last_heartbeat = time.monotonic()
    lock = root.parent / ".native-vm-queue"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
        os.close(fd)
        raise ValueError("Invalid VM execution lock.")
    child = None
    known = {}
    try:
        while True:
            stopped, last_heartbeat = disconnected(last_heartbeat)
            if stopped:
                return 130
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(0.05)
        deadline = time.monotonic() + request["timeoutMs"] / 1000
        for sibling in metadata(root).parent.iterdir():
            if sibling.is_dir() and not sibling.is_symlink() and sibling != metadata(root):
                marker = sibling / ".native-vm-state"
                if marker.exists() and marker.read_text() == "running":
                    raise ValueError("An earlier VM run has uncertain process ownership; recovery is required.")
        if state(root) != "uploaded" or not safe_path(request["entrypoint"]):
            raise ValueError("Invalid executable package.")
        entrypoint = root / request["entrypoint"]
        if not entrypoint.is_file() or entrypoint.is_symlink():
            raise ValueError("Package entrypoint is missing.")
        node = request["node"]
        environment = {"PATH": str(Path(node).parent) + ":/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(Path.home()), "SITUATE_NATIVE_EXECUTOR": "local", "CI": "true"}
        state(root, "running")
        # Keep the group leader alive until the supervisor releases it, so its PID
        # cannot be reused while remaining descendants are being drained.
        wrapper = "import subprocess,sys,signal,os; p=subprocess.Popen(sys.argv[2:]); c=p.wait(); f=open(sys.argv[1]+'.tmp','x'); f.write(str(c)); f.close(); os.rename(sys.argv[1]+'.tmp',sys.argv[1]); signal.pause()"
        child = subprocess.Popen([sys.executable, "-c", wrapper, str(metadata(root) / ".native-vm-exit"), node, str(entrypoint), *request["args"]], cwd=root, env=environment, stdin=subprocess.DEVNULL, start_new_session=True)
        code = 130
        while True:
            stopped, last_heartbeat = disconnected(last_heartbeat)
            if stopped:
                break
            if time.monotonic() >= deadline:
                code = 124
                break
            try:
                processes = snapshot()
            except (OSError, subprocess.SubprocessError):
                print("Cannot inspect guest processes; preserving the running command and VM lease.", file=sys.stderr)
                time.sleep(0.2)
                continue
            observe(known, processes, child.pid, child.returncode is None)
            stopped, last_heartbeat = disconnected(last_heartbeat)
            if stopped:
                break
            if time.monotonic() >= deadline:
                code = 124
                break
            if child.poll() is not None:
                raise RuntimeError("Guest process owner exited unexpectedly.")
            result = metadata(root) / ".native-vm-exit"
            if result.exists():
                code = int(result.read_text())
                code = code if code >= 0 else 128 - code
                break
            time.sleep(0.05)
        return code
    finally:
        if child is not None:
            term_started = None
            while True:
                try:
                    processes = snapshot()
                    live = observe(known, processes, child.pid, child.returncode is None)
                    child.poll()
                    if not live:
                        child.wait()
                        state(root, "completed")
                        break
                    # Kill children before the group leader; retain its identity
                    # until all observed descendants have disappeared.
                    victims = live - {child.pid}
                    if not victims:
                        victims = live
                    for pid in victims:
                        try:
                            name = signal.SIGTERM if term_started is None or time.monotonic() - term_started < 2 else signal.SIGKILL
                            os.kill(pid, name)
                            if term_started is None:
                                term_started = time.monotonic()
                        except ProcessLookupError:
                            pass
                except (OSError, subprocess.SubprocessError):
                    print("Cannot confirm guest process teardown; retaining VM lease and run root.", file=sys.stderr)
                time.sleep(0.05)
        os.close(fd)


def main():
    request = json.loads(base64.b64decode(sys.argv[1]))
    root = validate_root(request)
    operation = request["operation"]
    if operation == "create":
        private_directory(metadata(root).parent)
        metadata(root).mkdir(mode=0o700)
        root.mkdir(mode=0o700)
        info = root.lstat()
        (metadata(root) / ".native-vm-owner").write_text(json.dumps({"id": request["id"], "device": info.st_dev, "inode": info.st_ino}))
        state(root, "created")
        return 0
    owned(root, request["id"])
    if operation == "upload":
        upload(root)
    elif operation == "execute":
        for name in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(name, cancel)
        return execute(root, request)
    elif operation == "cleanup":
        if state(root) not in ("created", "uploading", "uploaded", "completed"):
            raise ValueError("Guest run may still own processes; retaining its root.")
        retention = root / ".native-vm-retain"
        if retention.exists() or retention.is_symlink():
            raise ValueError("Guest requested recovery retention; retaining its root.")
        shutil.rmtree(root)
        shutil.rmtree(metadata(root))
    else:
        raise ValueError("Unknown native VM operation.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
