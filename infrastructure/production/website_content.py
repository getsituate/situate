#!/usr/bin/env python3
"""Publish static content without access to Docker, the proxy or app releases."""

import argparse
import base64
import binascii
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/situate-production/website-content')
ORIGIN = 'https://getsituate.com'
MARKER = 'website-revision.txt'
PROBE = '/__website_delivery'
FEEDS = ('/releases/current/download.json', '/releases/current/update.json')
LIMIT = 16 * 1024 * 1024
MESSAGE_LIMIT = LIMIT * 2
MAX_FILES = 2048
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'[0-9a-f]{64}')
RELEASE = re.compile(r'[0-9a-f]{40}-[0-9a-f]{64}')
PART = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,119}')
EXTENSIONS = {'.html', '.css', '.js', '.svg', '.webp', '.png', '.jpg', '.txt'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode() + b'\n'


def read_message(stream, limit=MESSAGE_LIMIT):
    raw = stream.readline(limit + 1)
    if len(raw) > limit or not raw.endswith(b'\n'):
        raise ValueError('Missing or oversized website delivery message.')
    return json.loads(raw)


def file_name(value):
    parts = value.split('/') if isinstance(value, str) else []
    if (not parts or len(parts) > 12 or any(not PART.fullmatch(part) for part in parts)
            or parts[0] in {'releases', 'system', 'healthz', 'robots.txt', MARKER}
            or Path(parts[-1]).suffix not in EXTENSIONS):
        raise ValueError('Unsupported path in website package.')
    return value


def unpack(bundle):
    if (not isinstance(bundle, dict) or set(bundle) != {'sha', 'run', 'files'}
            or not isinstance(bundle['sha'], str) or not SHA.fullmatch(bundle['sha'])
            or type(bundle['run']) is not int or not 0 < bundle['run'] < 2**53
            or not isinstance(bundle['files'], dict) or len(bundle['files']) > MAX_FILES
            or 'index.html' not in bundle['files']):
        raise ValueError('Invalid website package.')
    files = {}
    size = 0
    for name, value in bundle['files'].items():
        file_name(name)
        if not isinstance(value, str):
            raise ValueError('Invalid website file encoding.')
        try:
            data = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('Invalid website file encoding.') from None
        size += len(data)
        if size > LIMIT:
            raise ValueError('Website package is too large.')
        files[name] = data
    manifest = {name: digest(data) for name, data in files.items()}
    return files, manifest, digest(encode(manifest))


def package(directory, sha, run):
    files = {}
    size = 0
    for path in sorted(directory.rglob('*')):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise ValueError('Website build contains a non-regular file.')
        name = file_name(path.relative_to(directory).as_posix())
        size += path.stat().st_size
        if size > LIMIT or len(files) >= MAX_FILES:
            raise ValueError('Website build exceeds package limits.')
        files[name] = base64.b64encode(path.read_bytes()).decode('ascii')
    value = {'sha': sha, 'run': run, 'files': files}
    unpack(value)
    return value


def write(path, data):
    with path.open('xb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def sync_directory(path):
    with directory_fd(path) as fd:
        os.fsync(fd)


@contextmanager
def directory_fd(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        yield fd
    finally:
        os.close(fd)


def save(root, state):
    temporary = root / '.state.next'
    temporary.unlink(missing_ok=True)
    write(temporary, encode(state))
    temporary.chmod(0o600)
    temporary.replace(root / '.state.json')
    sync_directory(root)


def state_at(root):
    path = root / '.state.json'
    if not path.exists():
        return {'run': 0, 'candidate': None, 'active': None, 'previous': None, 'pending': None}
    return json.loads(path.read_bytes())


def current(root):
    path = root / 'current'
    if not path.is_symlink() and not path.exists():
        return None
    target = os.readlink(path)
    name = target.removeprefix('versions/')
    if not RELEASE.fullmatch(name) or target != 'versions/' + name or not path.is_dir():
        raise ValueError('Unexpected active website path. Inspect the host.')
    return name


def switch(root, target):
    pointer = root / 'current'
    temporary = root / '.current.next'
    temporary.unlink(missing_ok=True)
    if target is None:
        pointer.unlink(missing_ok=True)
    else:
        if not RELEASE.fullmatch(target) or not (root / 'versions' / target).is_dir():
            raise ValueError('The selected website version is missing.')
        temporary.symlink_to('versions/' + target)
        temporary.replace(pointer)
    sync_directory(root)


def stage(root, candidate, files):
    versions = root / 'versions'
    versions.mkdir(mode=0o755, exist_ok=True)
    target = versions / candidate
    if target.is_dir():
        existing = {p.relative_to(target).as_posix(): p.read_bytes()
                    for p in target.rglob('*') if p.is_file()}
        if existing != files:
            raise ValueError('Stored website version differs from the package.')
        return
    directory = Path(tempfile.mkdtemp(prefix='.stage-', dir=versions))
    try:
        for name, data in files.items():
            path = directory / name
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            write(path, data)
        for path, _, _ in os.walk(directory, topdown=False):
            sync_directory(path)
        directory.chmod(0o755)
        directory.rename(target)
        sync_directory(versions)
        sync_directory(root)
    finally:
        if directory.exists():
            shutil.rmtree(directory)


def finish(root, state, decision):
    pending = state['pending']
    if not pending or current(root) not in {pending['from'], pending['to']}:
        raise ValueError('Website state does not match the pending operation.')
    if decision == 'commit' and current(root) == pending['to']:
        state.update(active=pending['to'], previous=pending['from'])
    elif decision == 'rollback':
        switch(root, pending['from'])
    else:
        raise ValueError('The requested website operation cannot be confirmed.')
    state['pending'] = None
    save(root, state)


def publish(root, bundle, reply, decision):
    files, _, checksum = unpack(bundle)
    candidate = bundle['sha'] + '-' + checksum
    state = state_at(root)
    active = state['active']
    if state['pending'] or current(root) != active:
        raise ValueError('An unresolved website delivery exists. Inspect the host before retrying.')
    if bundle['run'] < state['run']:
        reply({'status': 'superseded'})
        return
    if bundle['run'] == state['run'] and (state['candidate'] != candidate or not active
                                          or not active.endswith('-' + checksum)):
        raise ValueError('This workflow run is already recorded with a different outcome.')
    state.update(run=bundle['run'], candidate=candidate)
    if active and active.endswith('-' + checksum):
        save(root, state)
        reply({'status': 'unchanged', 'revision': active})
        return
    files[MARKER] = (candidate + '\n').encode()
    stage(root, candidate, files)
    state['pending'] = {'from': active, 'to': candidate}
    save(root, state)
    switch(root, candidate)
    reply({'status': 'pending', 'revision': candidate})
    finish(root, state, decision())
    reply({'status': 'complete'})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def get(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(ORIGIN + path, headers={'Cache-Control': 'no-cache'})
    try:
        with opener.open(request, timeout=6) as response:
            return response.status, response.read(LIMIT + 1)
    except urllib.error.HTTPError as error:
        with error:
            return error.code, b''


def feeds_available():
    for path in FEEDS:
        status, body = get(path)
        if status != 200 or not isinstance(json.loads(body), dict):
            raise ValueError('App release metadata is not healthy; inspect the app publication state.')


def check_public(manifest, revision):
    expected = {'/' + name: checksum for name, checksum in manifest.items()
                if name.endswith('.html') or name == 'analytics-config.js'}
    expected['/'] = expected.pop('/index.html')
    expected['/' + MARKER] = digest((revision + '\n').encode())
    for path, checksum in expected.items():
        status, body = get(path)
        if status >= 500:
            raise ValueError('Public website verification is inconclusive; inspect the pending operation.')
        if status != 200 or digest(body) != checksum:
            return False
    return True


def send(bundle, ssh):
    _, manifest, checksum = unpack(bundle)
    if get(PROBE) != (200, b'website-content-v1\n'):
        raise ValueError('The production content mount is not ready for automated publication.')
    feeds_available()
    environment = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
    with subprocess.Popen(ssh, stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=environment) as child:
        try:
            child.stdin.write(encode(bundle))
            child.stdin.flush()
            outcome = receive(child)
            status = outcome.get('status')
            if status == 'superseded':
                if child.wait(timeout=15):
                    raise ValueError('Could not confirm the superseded deployment.')
                print('A newer website run is already recorded.')
                return
            revision = outcome.get('revision', '')
            if (status not in {'pending', 'unchanged'} or not RELEASE.fullmatch(revision)
                    or not revision.endswith('-' + checksum)
                    or (status == 'pending' and not revision.startswith(bundle['sha'] + '-'))):
                raise ValueError('Unexpected website activation receipt; inspect the host.')
            for attempt in range(2):
                healthy = check_public(manifest, revision)
                if healthy:
                    break
                if not attempt:
                    time.sleep(2)
            if status == 'pending':
                if healthy:
                    feeds_available()
                child.stdin.write(encode('commit' if healthy else 'rollback'))
                child.stdin.flush()
                if receive(child) != {'status': 'complete'}:
                    raise ValueError('Website outcome is uncertain; inspect the host.')
                if not healthy:
                    feeds_available()
                    if get('/')[0] != 200:
                        raise ValueError('Website rollback completed, but the home page is not reachable.')
            if child.wait(timeout=15):
                raise ValueError('Website SSH completion is uncertain; inspect the host.')
            if not healthy:
                raise ValueError('Public website bytes did not match the package.')
            if status == 'unchanged':
                feeds_available()
            print(f'Verified website revision: {revision}')
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()


def receive(child):
    if not select.select([child.stdout], [], [], 120)[0]:
        raise ValueError('Website SSH response timed out; inspect the host.')
    return read_message(child.stdout, 4096)


def ssh_command(directory):
    host = os.environ.get('WEBSITE_CONTENT_HOST', '')
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*', host):
        raise ValueError('Set WEBSITE_CONTENT_HOST to the restricted SSH account and host.')
    identity, known = (directory / name for name in ('identity', 'known_hosts'))
    for name, path in [('WEBSITE_CONTENT_SSH_KEY', identity), ('WEBSITE_CONTENT_KNOWN_HOSTS', known)]:
        value = os.environ.get(name, '')
        if not value.strip():
            raise ValueError(f'Set {name} before deploying.')
        write(path, (value.rstrip('\n') + '\n').encode())
        path.chmod(0o600)
    return ['ssh', '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3',
            '-o', f'UserKnownHostsFile={known}', '-i', str(identity), host, 'publish-website']


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    deploy = commands.add_parser('deploy')
    deploy.add_argument('directory', type=Path)
    deploy.add_argument('sha')
    deploy.add_argument('run', type=int)
    commands.add_parser('receive')
    commands.add_parser('status')
    recover = commands.add_parser('recover')
    recover.add_argument('revision')
    recover.add_argument('decision', choices=['commit', 'rollback'])
    revert = commands.add_parser('revert')
    revert.add_argument('revision')
    args = parser.parse_args()
    os.umask(0o022)
    if args.command == 'deploy':
        bundle = package(args.directory.resolve(strict=True), args.sha, args.run)
        with tempfile.TemporaryDirectory(prefix='situate-website-ssh-') as directory:
            send(bundle, ssh_command(Path(directory)))
        return
    if args.command == 'receive' and os.environ.get('SSH_ORIGINAL_COMMAND') != 'publish-website':
        raise ValueError('Expected the website publication command.')
    bundle = read_message(sys.stdin.buffer) if args.command == 'receive' else None
    with (ROOT / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX if bundle is not None else fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = state_at(ROOT)
        if args.command == 'status':
            print(json.dumps({**state, 'served': current(ROOT)}, indent=2))
        elif args.command == 'recover':
            if not state['pending'] or state['pending']['to'] != args.revision:
                raise ValueError('The requested revision is not pending.')
            finish(ROOT, state, args.decision)
        elif args.command == 'revert':
            if state['pending'] or state['active'] != args.revision or current(ROOT) != args.revision:
                raise ValueError('The requested revision is not the confirmed active revision.')
            state['pending'] = {'from': state['active'], 'to': state['previous']}
            save(ROOT, state)
            switch(ROOT, state['previous'])
            finish(ROOT, state, 'commit')
        else:
            def reply(value):
                sys.stdout.buffer.write(encode(value))
                sys.stdout.buffer.flush()

            def decide():
                if not select.select([sys.stdin.buffer], [], [], 110)[0]:
                    raise ValueError('Website verification timed out; inspect the pending operation.')
                return read_message(sys.stdin.buffer, 128)

            publish(ROOT, bundle, reply, decide)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
