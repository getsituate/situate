"""Own a command's resource lease and descendants independently of its caller."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import subprocess
import sys
import tempfile
import time


BUILD_SLOTS = 2
cancelled = False


def cancel(_signal=None, _frame=None):
    global cancelled
    cancelled = True


def caller_closed():
    if cancelled:
        return True
    readable, _, _ = select.select([sys.stdin.buffer], [], [], 0)
    return bool(readable) and not os.read(sys.stdin.fileno(), 4096)


def snapshot():
    listing = subprocess.check_output(
        ["ps", "-A", "-o", "pid=,ppid=,pgid=,stat=,lstart="],
        text=True, timeout=10,
    )
    result = {}
    for line in listing.splitlines():
        match = re.match(r"\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$", line)
        if match and not match[4].startswith("Z"):
            result[int(match[1])] = (int(match[2]), int(match[3]), match[5])
    return result


def observe(known, processes, group, ancestors):
    live = {pid for pid, born in known.items()
            if pid in processes and processes[pid][2] == born}
    group_owned = any(processes[pid][1] == group for pid in live)
    changed = True
    while changed:
        changed = False
        for pid, (parent, pgid, born) in processes.items():
            if pid not in live and (parent in live or (group_owned and pgid == group)):
                known[pid] = born
                live.add(pid)
                changed = True
        for pid in live:
            parent = processes[pid][0]
            if parent not in live:
                continue
            lineage = ancestors.setdefault(pid, set())
            previous = len(lineage)
            lineage.add((parent, known[parent]))
            lineage.update(ancestors.get(parent, set()))
            if len(lineage) != previous:
                changed = True
    return live


def send_owned(known, processes, live, name, ancestors):
    if name == signal.SIGKILL:
        # Reparenting must not let a nested supervisor lose its lease before an orphan exits.
        parents = {parent for pid in live for parent, born in ancestors.get(pid, set())
                   if parent in live and known[parent] == born}
        live = live - parents
    sent = False
    for pid in sorted(live, reverse=True):
        if processes.get(pid, (None, None, None))[2] != known[pid]:
            continue
        try:
            os.kill(pid, name)
            sent = True
        except ProcessLookupError:
            pass
    return sent


def drain(child, known, ancestors):
    term_started = None
    while True:
        try:
            processes = snapshot()
        except (OSError, subprocess.SubprocessError):
            print("Cannot inspect owned processes; retaining the resource lease.", file=sys.stderr)
            time.sleep(0.2)
            continue
        if not known and child.returncode is None:
            for pid, (_, pgid, born) in processes.items():
                if pgid == child.pid:
                    known[pid] = born
        child.poll()
        live = observe(known, processes, child.pid, ancestors)
        if not live:
            child.wait()
            return
        name = signal.SIGTERM if term_started is None or time.monotonic() - term_started < 2 else signal.SIGKILL
        if send_owned(known, processes, live, name, ancestors) and term_started is None:
            term_started = time.monotonic()
        time.sleep(0.05)


def release_dependency_directories(directory, known):
    # Only this supervised process tree's metadata can authorize removal. Empty
    # legacy locks and locks belonging to earlier runs remain untouched.
    for workspace in (".", "client", "requirements"):
        path = directory / workspace
        if not path.is_dir():
            continue
        identity = hashlib.sha256(str(path.resolve()).encode()).hexdigest()
        lock = Path(tempfile.gettempdir()) / ("situate-npm-" + identity + ".lock")
        owner = lock / "owner.json"
        try:
            if lock.is_symlink() or owner.is_symlink() or set(lock.iterdir()) != {owner}:
                continue
            metadata = owner.stat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
                continue
            data = json.loads(owner.read_text())
            if not isinstance(data, dict):
                continue
            pid = data.get("pid")
            if type(pid) is not int or pid not in known or known[pid] != data.get("born"):
                continue
            owner.unlink()
            lock.rmdir()
        except (OSError, ValueError, TypeError):
            continue


def worktree_root(directory):
    try:
        root = subprocess.check_output(
            ["git", "-C", str(directory), "rev-parse", "--show-toplevel"],
            text=True, stderr=subprocess.DEVNULL, timeout=3,
        ).strip()
        return Path(root).resolve(strict=True)
    except (OSError, subprocess.SubprocessError):
        return directory


def timing(phase, resource, wait_ms, run_ms=0):
    try:
        mode = os.fstat(3).st_mode
        if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
            return
        os.write(3, (json.dumps({"phase": phase, "resource": resource,
                               "waitMs": wait_ms, "runMs": run_ms}) + "\n").encode())
    except OSError:
        pass


def acquire(resource, directory, base=None):
    # App fixtures override TMPDIR; the desktop lease must still be machine-local.
    if base is None:
        base = Path("/tmp").resolve() / ("situate-coordination-" + str(os.getuid()))
    base.mkdir(mode=0o700, exist_ok=True)
    info = base.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("The coordination directory must be private and owned by the current user.")
    keys = ([f"build:{index}" for index in range(BUILD_SLOTS)] if resource == "build" else
            [resource if resource == "desktop" else "worktree:" + str(worktree_root(directory))])
    descriptors = []
    try:
        for key in keys:
            name = hashlib.sha256(key.encode()).hexdigest() + ".lock"
            fd = os.open(base / name, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            descriptors.append(fd)
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
                raise RuntimeError("The coordination lock must be a private regular file.")
    except Exception:
        for fd in descriptors:
            os.close(fd)
        raise
    waiting = False
    while not caller_closed():
        for fd in descriptors:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                os.ftruncate(fd, 0)
                os.write(fd, json.dumps({"pid": os.getpid(), "resource": resource}).encode())
                for other in descriptors:
                    if other != fd:
                        os.close(other)
                return fd
            except BlockingIOError:
                pass
        if not waiting:
            print("Waiting for the current " + resource + " command to finish…", file=sys.stderr)
            waiting = True
        time.sleep(0.05)
    for fd in descriptors:
        os.close(fd)
    return None


def main(coordination_directory=None):
    resource, directory, command, *args = sys.argv[1:]
    if resource not in ("worktree", "desktop", "build"):
        raise ValueError("Unknown coordinated resource.")
    directory = Path(directory).resolve(strict=True)
    for name in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(name, cancel)
    queued = time.monotonic()
    lease = acquire(resource, directory, coordination_directory)
    if lease is None:
        return 130
    acquired = time.monotonic()
    wait_ms = round((acquired - queued) * 1000)
    timing("acquired", resource, wait_ms)
    child = None
    drained = False
    known = {}
    ancestors = {}
    try:
        if caller_closed():
            return 130
        env = dict(os.environ)
        if resource == "worktree":
            env["SITUATE_COORDINATED_WORKTREE"] = str(worktree_root(directory))
            env["SITUATE_WORKTREE_WAIT_MS"] = str(wait_ms)
        elif resource == "desktop":
            env["SITUATE_COORDINATED_DESKTOP"] = "1"
        child = subprocess.Popen([command, *args], cwd=directory, env=env,
                                 stdin=subprocess.DEVNULL, start_new_session=True)
        aborted = False
        while True:
            if caller_closed():
                aborted = True
                break
            try:
                processes = snapshot()
            except (OSError, subprocess.SubprocessError):
                print("Cannot inspect owned processes; preserving the running command and resource lease.", file=sys.stderr)
                time.sleep(0.2)
                continue
            # The unreaped child reserves its process-group identity even after exit.
            for pid, (_, pgid, born) in processes.items():
                if pgid == child.pid:
                    known[pid] = born
            observe(known, processes, child.pid, ancestors)
            if child.poll() is not None:
                break
            time.sleep(0.05)
        drain(child, known, ancestors)
        drained = True
        if resource == "worktree":
            release_dependency_directories(worktree_root(directory), known)
        return 130 if aborted else (child.returncode if child.returncode >= 0 else 128 - child.returncode)
    finally:
        if child is not None and not drained:
            drain(child, known, ancestors)
            if resource == "worktree":
                release_dependency_directories(worktree_root(directory), known)
        # Keep the inode: unlinking a flock file can create two independent leases.
        os.close(lease)
        timing("released", resource, wait_ms, round((time.monotonic() - acquired) * 1000))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
