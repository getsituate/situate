"""Privileged SSH route lifetime bound to a caller-owned stdin pipe."""
import json
import os
from pathlib import PurePosixPath
import re
import select
import signal
import stat
import subprocess
import sys
import time

GUARDIAN_READY_SECONDS = 30
GUARDIAN_STOP_SECONDS = 10
GUARDIAN_POLL_SECONDS = 0.1


class GuardianClosed(Exception):
    pass


def guardian_request(request):
    if not isinstance(request, dict) or set(request) != {'route', 'ssh'}:
        raise ValueError('Invalid guardian request')
    route, ssh = request['route'], request['ssh']
    if not isinstance(route, dict) or set(route) != {'operationId', 'operationNonce', 'hostname', 'privateAddress', 'localPort'}:
        raise ValueError('Invalid guardian route')
    for key in ['operationId', 'operationNonce']:
        if not isinstance(route[key], str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', route[key]):
            raise ValueError('Invalid guardian operation identity')
    if (route['privateAddress'] != '127.0.0.2' or type(route['localPort']) is not int or route['localPort'] != 443
            or not isinstance(route['hostname'], str)
            or not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', route['hostname']) or '.' not in route['hostname']):
        raise ValueError('Invalid guardian loopback route')
    if not isinstance(ssh, dict) or set(ssh) != {'host', 'identityPath', 'knownHostsPath', 'hostPort'}:
        raise ValueError('Invalid guardian SSH configuration')
    if not isinstance(ssh['host'], str) or not re.fullmatch(r'(?:[a-z_][a-z0-9_-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*', ssh['host']):
        raise ValueError('Invalid guardian SSH host')
    for key in ['identityPath', 'knownHostsPath']:
        path = ssh[key]
        if (not isinstance(path, str) or not path.startswith('/') or path.startswith('//')
                or any(ord(character) < 32 or ord(character) == 127 for character in path)
                or '..' in PurePosixPath(path).parts):
            raise ValueError('Explicit absolute guardian SSH paths are required')
    if type(ssh['hostPort']) is not int or not 1024 <= ssh['hostPort'] <= 65535:
        raise ValueError('Invalid guardian host loopback port')
    return route, ssh


def guardian_ssh_arguments(ssh, socket):
    return ['/usr/bin/ssh', '-F', '/dev/null', '-S', str(socket),
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ConnectionAttempts=1', '-o', 'ConnectTimeout=10',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
            '-o', 'IdentitiesOnly=yes', '-i', ssh['identityPath'],
            '-o', 'UserKnownHostsFile=' + ssh['knownHostsPath']]


def guardian_socket(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.geteuid():
        raise ValueError('Guardian control socket ownership differs')
    return info.st_dev, info.st_ino


def guardian_record(runner, route, child):
    path = runner.RUNNER_LOCK / 'state.json'
    state = json.loads(runner.read(path))
    if state['request'] != route:
        raise ValueError('Guardian runner ownership differs')
    state['guardian'] = {'pid': os.getpid(), 'sshPid': child.pid if child else None,
                         'controlPath': str(runner.RUNNER_LOCK / 'ssh')}
    runner.save(path, state)


def guardian_lifeline(buffer):
    readable, _, _ = select.select([sys.stdin], [], [], GUARDIAN_POLL_SECONDS)
    if not readable:
        return False
    data = os.read(sys.stdin.fileno(), 64)
    if not data:
        return True
    buffer.extend(data)
    if bytes(buffer) == b'close\n':
        return True
    if len(buffer) >= 6 or not b'close\n'.startswith(bytes(buffer)):
        raise ValueError('Invalid guardian lifeline message')
    return False


def guardian_emit(value):
    os.write(sys.stdout.fileno(), (json.dumps(value, separators=(',', ':')) + '\n').encode())


def guardian_stop(child, args, ssh, socket, socket_identity, environment):
    ownership_changed = False
    try:
        current = guardian_socket(socket)
        if current is not None and socket_identity is not None and current != socket_identity:
            raise ValueError('Guardian control socket ownership changed')
        if current is not None and child.poll() is None:
            try:
                subprocess.run(args + ['-O', 'exit', ssh['host']],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    env=environment, timeout=GUARDIAN_STOP_SECONDS)
            except (OSError, subprocess.SubprocessError):
                pass
    except (OSError, ValueError):
        ownership_changed = True
    try:
        try:
            child.wait(timeout=GUARDIAN_STOP_SECONDS)
        except subprocess.TimeoutExpired:
            child.terminate()
            try:
                child.wait(timeout=GUARDIAN_STOP_SECONDS)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=GUARDIAN_STOP_SECONDS)
        return not ownership_changed and child.poll() is not None and guardian_socket(socket) is None
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def guardian_main(runner, request):
    os.umask(0o077)
    route, ssh = guardian_request(request)
    input_mode = os.fstat(sys.stdin.fileno()).st_mode
    if not (stat.S_ISFIFO(input_mode) or stat.S_ISSOCK(input_mode)):
        raise ValueError('Guardian stdin must be a caller-owned pipe')
    socket = runner.RUNNER_LOCK / 'ssh'
    args = guardian_ssh_arguments(ssh, socket)
    environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C'}
    child = None
    owned = False
    ready = False
    cleaned = False
    failure = None
    socket_identity = None
    buffer = bytearray()
    launching = False
    interrupted = False

    def stopped(_signum, _frame):
        nonlocal interrupted
        interrupted = True
        if not launching:
            raise GuardianClosed()

    previous = {item: signal.signal(item, stopped) for item in [signal.SIGTERM, signal.SIGINT]}
    try:
        failure = 'prepare'
        runner.runner_perform('runner-prepare', route)
        owned = True
        guardian_record(runner, route, child)
        if guardian_lifeline(buffer):
            failure = None
        else:
            failure = 'ssh-start'
            if guardian_socket(socket) is not None:
                raise ValueError('Guardian control socket already exists')
            runner.runner_perform('runner-ssh-pending', route)
            # Keep the child handle reachable before a signal can enter teardown.
            launching = True
            try:
                child = subprocess.Popen(args + ['-M', '-N', '-T', '-o', 'ControlMaster=yes',
                    '-o', 'ControlPersist=no', '-o', 'ForkAfterAuthentication=no',
                    '-o', 'ExitOnForwardFailure=yes', '-L',
                    '127.0.0.2:443:127.0.0.1:' + str(ssh['hostPort']), ssh['host']],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    env=environment, start_new_session=True)
            finally:
                launching = False
            if interrupted:
                raise GuardianClosed()
            guardian_record(runner, route, child)
            deadline = time.monotonic() + GUARDIAN_READY_SECONDS
            while True:
                if child.poll() is not None:
                    raise RuntimeError('Guardian SSH exited before readiness')
                candidate = guardian_socket(socket)
                if candidate is not None:
                    if socket_identity is not None and candidate != socket_identity:
                        raise ValueError('Guardian control socket changed')
                    socket_identity = candidate
                    checked = subprocess.run(args + ['-O', 'check', ssh['host']],
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        env=environment, timeout=min(GUARDIAN_STOP_SECONDS, max(0.01, deadline - time.monotonic())))
                    if checked.returncode == 0:
                        runner.runner_perform('runner-serving', route)
                        guardian_emit({'ready': True, 'operationNonce': route['operationNonce']})
                        ready = True
                        failure = None
                        break
                if time.monotonic() >= deadline:
                    raise TimeoutError('Guardian SSH readiness timed out')
                if guardian_lifeline(buffer):
                    raise GuardianClosed()
            while ready:
                if child.poll() is not None or guardian_socket(socket) != socket_identity:
                    failure = 'ssh-lost'
                    raise RuntimeError('Guardian SSH lifetime ended unexpectedly')
                if guardian_lifeline(buffer):
                    break
    except GuardianClosed:
        failure = failure or 'interrupted'
    except BaseException:
        failure = failure or 'guardian'
    finally:
        for item in previous:
            signal.signal(item, signal.SIG_IGN)
        try:
            if owned:
                journal_known = True
                if failure:
                    try:
                        runner.runner_perform('runner-failed', route)
                    except BaseException:
                        journal_known = False
                if child is not None:
                    stopped_known = guardian_stop(child, args, ssh, socket, socket_identity, environment)
                else:
                    stopped_known = guardian_socket(socket) is None
                if not journal_known or not stopped_known:
                    raise RuntimeError('Guardian SSH teardown or journal is uncertain')
                runner.runner_perform('runner-cleanup', route)
                cleaned = True
        except BaseException:
            failure = 'teardown'
            if owned:
                try:
                    runner.runner_perform('runner-failed', route)
                except BaseException:
                    pass
        finally:
            try:
                guardian_emit({'closed': True, 'operationNonce': route['operationNonce'],
                               'cleaned': cleaned, 'uncertain': not cleaned, 'failure': failure})
            except (OSError, ValueError):
                pass
            for item, handler in previous.items():
                signal.signal(item, handler)
    return 0 if cleaned and failure is None else 1
