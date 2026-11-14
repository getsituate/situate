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


DOCKER_ENVIRONMENT = {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY',
                      'DOCKER_CERT_PATH', 'DOCKER_API_VERSION', 'SSH_AUTH_SOCK', 'HOME'}
BUILD_SLOTS = 2
cancelled = False
subreaper = False


def enable_subreaper():
    global subreaper
    if sys.platform != 'linux':
        return
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'Cannot own orphaned command descendants.')
    subreaper = True


def reap_adopted(child):
    if not subreaper:
        return False
    # Keep Popen responsible for its child's exit status; reap only adopted children.
    children = Path('/proc/self/task') / str(os.getpid()) / 'children'
    pending = False
    for pid in map(int, children.read_text().split()):
        if pid == child.pid:
            continue
        try:
            reaped, _ = os.waitpid(pid, os.WNOHANG)
            pending = pending or reaped == 0
        except ChildProcessError:
            pass
    return pending


def report(message):
    # A dead caller's output pipe cannot release a resource lease.
    try:
        print(message, file=sys.stderr, flush=True)
    except OSError:
        pass


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
            # Commands start new sessions; the supervisor's own ps helpers do not.
            if pid not in live and (parent in live or (group_owned and pgid == group)
                                    or (subreaper and parent == os.getpid() and pgid != os.getpgrp())):
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


def send_owned(known, processes, live, name, ancestors, attempted=None):
    if name == signal.SIGKILL:
        # Reparenting must not let a nested supervisor lose its lease before an orphan exits.
        parents = {parent for pid in live for parent, born in ancestors.get(pid, set())
                   if parent in live and known[parent] == born}
        live = live - parents
    sent = False
    for pid in sorted(live, reverse=True):
        if processes.get(pid, (None, None, None))[2] != known[pid]:
            continue
        identity = (pid, known[pid], name)
        if attempted is not None:
            if identity in attempted:
                continue
            attempted.add(identity)
        try:
            os.kill(pid, name)
            sent = True
        except PermissionError:
            report("Cannot signal an owned process; retaining the resource lease until its absence is verified.")
            sent = True
        except ProcessLookupError:
            pass
    return sent


def drain(child, known, ancestors, docker_lease=None, cleanup_grace_ms=2000):
    term_started = None
    attempted = set()
    while True:
        try:
            processes = snapshot()
            child.poll()
            adopted_live = reap_adopted(child)
        except (OSError, subprocess.SubprocessError):
            report("Cannot inspect owned processes; retaining the resource lease.")
            time.sleep(0.2)
            continue
        if not known and child.returncode is None:
            for pid, (_, pgid, born) in processes.items():
                if pgid == child.pid:
                    known[pid] = born
        live = observe(known, processes, child.pid, ancestors)
        if not live:
            if adopted_live:
                continue
            child.wait()
            return
        if docker_lease is not None and wait_for_docker_creation(docker_lease):
            continue
        name = signal.SIGTERM if term_started is None or time.monotonic() - term_started < cleanup_grace_ms / 1000 else signal.SIGKILL
        if send_owned(known, processes, live, name, ancestors, attempted) and term_started is None:
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


def build_slots():
    value = os.environ.get('SITUATE_TOOL_BUILD_SLOTS', str(BUILD_SLOTS))
    if value not in ('1', '2'):
        raise ValueError('SITUATE_TOOL_BUILD_SLOTS must be 1 or 2.')
    return int(value)


def acquire(resource, directory, base=None, child=None):
    # App fixtures override TMPDIR; the desktop lease must still be machine-local.
    if base is None:
        base = Path("/tmp").resolve() / ("situate-coordination-" + str(os.getuid()))
    base.mkdir(mode=0o700, exist_ok=True)
    info = base.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("The coordination directory must be private and owned by the current user.")
    keys = ([f"build:{index}" for index in range(build_slots())] if resource == "build" else
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
    while not caller_closed() and (child is None or child.poll() is None):
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
            report("Waiting for the current " + resource + " command to finish…")
            waiting = True
        time.sleep(0.05)
    for fd in descriptors:
        os.close(fd)
    return None


def read_docker_lease(path):
    if not path.is_absolute():
        raise ValueError('Docker lease path must be absolute.')
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('Docker lease directory must be private and owned.')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_nlink != 1 or info.st_mode & 0o077 or info.st_size > 4096):
            raise ValueError('Docker lease must be a private owned single-link regular file.')
        data = stream.read(4097)
    current = path.lstat()
    if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
        raise ValueError('Docker lease changed during inspection.')
    value = json.loads(data)
    uuid = r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'
    if (not isinstance(value, dict) or not {'name', 'token'} <= set(value)
            or set(value) - {'name', 'token', 'creationPending', 'dockerEnvironment', 'buildPending'}
            or type(value.get('creationPending', False)) is not bool
            or type(value.get('buildPending', False)) is not bool
            or (value.get('buildPending') and not value.get('creationPending'))
            or not isinstance(value['name'], str) or not re.fullmatch('situate-pipeline-' + uuid, value['name'])
            or not isinstance(value['token'], str) or not re.fullmatch(uuid, value['token'])):
        raise ValueError('Invalid Docker lease identity.')
    if 'dockerEnvironment' in value:
        environment = value['dockerEnvironment']
        if (not isinstance(environment, dict) or set(environment) - DOCKER_ENVIRONMENT
                or any(not isinstance(item, str) or '\0' in item for item in environment.values())):
            raise ValueError('Invalid Docker cleanup environment.')
    return value, (info.st_dev, info.st_ino)


def docker_build_ack(path, value):
    ack = Path(str(path) + '.' + value['token'] + '.build')
    try:
        fd = os.open(ack, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_nlink != 1 or info.st_mode & 0o077 or info.st_size > 4096):
            raise ValueError('Docker build acknowledgement must be private and owned.')
        contents = json.loads(stream.read(4097))
    current = ack.lstat()
    if ((info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)
            or contents != {'name': value['name'], 'token': value['token']}):
        raise ValueError('Docker build acknowledgement differs from its attempt.')
    return info.st_dev, info.st_ino


class DockerBuildAdmission:
    def __init__(self, directory, base):
        self.directory = directory
        self.base = base
        self.fd = None
        self.identity = None

    def release(self):
        if self.fd is not None:
            os.close(self.fd)
        self.fd = None
        self.identity = None

    def poll(self, path, child):
        try:
            lease = read_docker_lease(path)
        except (OSError, ValueError, TypeError):
            report('Cannot inspect Docker build admission; retaining the resource lease.')
            return True
        value = lease[0] if lease else None
        identity = (value['name'], value['token']) if value and value.get('buildPending') else None
        if identity == self.identity:
            return True
        self.release()
        if identity is None:
            return True
        self.fd = acquire('build', self.directory, self.base, child=child)
        if self.fd is None:
            return False
        self.identity = identity
        fresh = read_docker_lease(path)
        if caller_closed() or child.poll() is not None:
            return False
        if fresh is None or fresh != lease:
            self.release()
            return True
        ack = Path(str(path) + '.' + value['token'] + '.build')
        temporary = Path(str(ack) + '.publishing')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump({'name': value['name'], 'token': value['token']}, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.link(temporary, ack)
        finally:
            temporary.unlink()
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return True


def docker_build_unstarted(path):
    try:
        lease = read_docker_lease(path)
        return (lease is not None and lease[0].get('buildPending')
                and docker_build_ack(path, lease[0]) is None
                and docker_cid(path, lease[0]['token']) is None)
    except (OSError, ValueError, TypeError):
        return False


def docker_cid(path, token):
    cid = Path(str(path) + '.' + token + '.cid')
    try:
        fd = os.open(cid, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'r') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_nlink != 1 or info.st_mode & 0o077 or info.st_size > 128):
            raise ValueError('Docker CID must be a private owned single-link regular file.')
        value = stream.read(129).strip()
    current = cid.lstat()
    if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('Invalid Docker creation acknowledgement.')
    return value, (info.st_dev, info.st_ino)


def wait_for_docker_creation(path):
    warned = False
    while True:
        try:
            lease = read_docker_lease(Path(path))
            if lease is None or not lease[0].get('creationPending') or docker_cid(path, lease[0]['token']) is not None:
                return warned
        except (OSError, ValueError, TypeError):
            pass
        if not warned:
            try:
                print('Docker creation is unacknowledged; retaining its client and resource lease.', file=sys.stderr, flush=True)
            except OSError:
                pass
            warned = True
        time.sleep(0.2)


def inspect_docker_container(name, environment=None):
    result = subprocess.run(['docker', 'container', 'inspect', name],
                            capture_output=True, text=True, timeout=10, env=environment)
    if result.returncode != 0:
        absent = re.fullmatch(r'(?:Error response from daemon: |Error: )?No such (?:container|object): ' + re.escape(name),
                              result.stderr.strip())
        if result.returncode == 1 and absent:
            return None
        raise RuntimeError('Docker inspection is unavailable or uncertain.')
    records = json.loads(result.stdout)
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise ValueError('Invalid Docker inspection result.')
    container = records[0]
    if container.get('Name') != '/' + name or not re.fullmatch(r'[a-f0-9]{64}', container.get('Id', '')):
        raise ValueError('Docker inspection identity differs.')
    return container


def cleanup_docker_lease(path, remove_directory=False, creation_started=True):
    path = Path(path)
    warned = False
    while True:
        try:
            lease = read_docker_lease(path)
            if lease is not None:
                value, identity = lease
                cid = docker_cid(path, value['token']) if value.get('creationPending') else None
                ack = docker_build_ack(path, value) if value.get('buildPending') else None
                unstarted = creation_started is False and value.get('creationPending') and cid is None
                if value.get('creationPending') and cid is None and not unstarted:
                    raise RuntimeError('Docker creation remains unacknowledged.')
                environment = None
                if 'dockerEnvironment' in value:
                    environment = {key: item for key, item in os.environ.items() if key not in DOCKER_ENVIRONMENT}
                    environment.update(value['dockerEnvironment'])
                container = None if unstarted else inspect_docker_container(value['name'], environment)
                if container is not None:
                    if cid is not None and container['Id'] != cid[0]:
                        raise ValueError('Docker CID differs from the created container.')
                    config = container.get('Config')
                    labels = config.get('Labels') if isinstance(config, dict) else None
                    if not isinstance(labels, dict) or labels.get('dev.situate.ci-run') != value['token']:
                        raise ValueError('Docker container ownership differs.')
                    # Names can be reused; only the inspected immutable ID may be removed.
                    subprocess.run(['docker', 'container', 'rm', '--force', container['Id']],
                                   capture_output=True, text=True, timeout=30, env=environment)
                    if inspect_docker_container(value['name'], environment) is not None:
                        raise RuntimeError('Docker container removal remains unresolved.')
                current = path.lstat()
                if (current.st_dev, current.st_ino) != identity:
                    raise ValueError('Docker lease changed before cleanup completed.')
                if cid is not None:
                    acknowledged = Path(str(path) + '.' + value['token'] + '.cid')
                    info = acknowledged.lstat()
                    if (info.st_dev, info.st_ino) != cid[1]:
                        raise ValueError('Docker CID changed during cleanup.')
                if ack is not None:
                    acknowledged_build = Path(str(path) + '.' + value['token'] + '.build')
                    info = acknowledged_build.lstat()
                    if (info.st_dev, info.st_ino) != ack:
                        raise ValueError('Docker build acknowledgement changed during cleanup.')
                path.unlink()
                if ack is not None:
                    try:
                        acknowledged_build.unlink()
                    except OSError:
                        pass
                if cid is not None:
                    try:
                        acknowledged.unlink()
                    except OSError:
                        pass
            if remove_directory:
                try:
                    path.parent.rmdir()
                except OSError:
                    pass
            return
        except (OSError, ValueError, TypeError, RuntimeError, subprocess.SubprocessError):
            if not warned:
                try:
                    print('Docker cleanup is unverified; retaining the resource lease until ownership and absence are confirmed.',
                          file=sys.stderr, flush=True)
                except OSError:
                    pass
                warned = True
            time.sleep(0.2)


def main(coordination_directory=None):
    arguments = sys.argv[1:]
    cleanup_grace_ms = 2000
    if arguments[:1] == ['--cleanup-grace-ms']:
        if (len(arguments) < 2 or not re.fullmatch(r'[0-9]+', arguments[1])
                or not 1 <= int(arguments[1]) <= 120000):
            raise ValueError('Coordinated cleanup grace must be an integer from 1 to 120000 ms.')
        cleanup_grace_ms = int(arguments[1])
        arguments = arguments[2:]
    docker_lease = None
    if arguments[:1] == ['--docker-lease']:
        docker_lease = Path(arguments[1])
        arguments = arguments[2:]
    resource, directory, *args = arguments
    if args[:1] == ['--docker-lease']:
        if docker_lease is not None:
            raise ValueError('Docker lease option was repeated.')
        docker_lease = Path(args[1])
        args = args[2:]
    command, *args = args
    if resource not in ("worktree", "desktop", "build"):
        raise ValueError("Unknown coordinated resource.")
    if docker_lease is not None and resource != 'worktree':
        raise ValueError('Only a worktree owner can supervise a Docker lease.')
    directory = Path(directory).resolve(strict=True)
    enable_subreaper()
    for name in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(name, cancel)
    queued = time.monotonic()
    lease = acquire(resource, directory, coordination_directory)
    if lease is None:
        if docker_lease is not None:
            cleanup_docker_lease(docker_lease, remove_directory=True, creation_started=False)
        return 130
    acquired = time.monotonic()
    wait_ms = round((acquired - queued) * 1000)
    timing("acquired", resource, wait_ms)
    child = None
    admission = DockerBuildAdmission(directory, coordination_directory) if docker_lease is not None else None
    drained = False
    known = {}
    ancestors = {}
    try:
        if caller_closed():
            return 130
        env = dict(os.environ)
        if docker_lease is not None:
            env['SITUATE_DOCKER_LEASE'] = str(docker_lease)
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
            if admission is not None and not admission.poll(docker_lease, child):
                aborted = caller_closed()
                break
            try:
                processes = snapshot()
            except (OSError, subprocess.SubprocessError):
                report("Cannot inspect owned processes; preserving the running command and resource lease.")
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
        creating = docker_lease if docker_lease is not None and not docker_build_unstarted(docker_lease) else None
        if creating is not None:
            wait_for_docker_creation(creating)
        drain(child, known, ancestors, docker_lease=creating, cleanup_grace_ms=cleanup_grace_ms)
        drained = True
        if resource == "worktree":
            release_dependency_directories(worktree_root(directory), known)
        return 130 if aborted else (child.returncode if child.returncode >= 0 else 128 - child.returncode)
    finally:
        creation_started = child is not None and (docker_lease is None or not docker_build_unstarted(docker_lease))
        if child is not None and not drained:
            creating = docker_lease if creation_started else None
            if creating is not None:
                wait_for_docker_creation(creating)
            drain(child, known, ancestors, docker_lease=creating, cleanup_grace_ms=cleanup_grace_ms)
            if resource == "worktree":
                release_dependency_directories(worktree_root(directory), known)
        if docker_lease is not None:
            cleanup_docker_lease(docker_lease, remove_directory=True, creation_started=creation_started)
        if admission is not None:
            admission.release()
        # Keep the inode: unlinking a flock file can create two independent leases.
        os.close(lease)
        timing("released", resource, wait_ms, round((time.monotonic() - acquired) * 1000))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
