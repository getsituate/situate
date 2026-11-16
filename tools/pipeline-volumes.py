"""Keep compiler and download caches in private Docker-managed volumes."""

import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

KEYS = {'npm', 'browsers', 'cargo-registry', 'cargo-git', 'client-target', 'tools-dev-tui-target'}
IMAGE = re.compile(r'ghcr\.io/getsituate/situate-ci-linux@sha256:[a-f0-9]{64}\Z')
INIT_SCRIPT = 'set -eu; chown 0:0 /cache; chmod 0700 /cache; chown "$1:$2" /cache'


def private_directory(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Volume cache paths must be absolute and canonical.')
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.getuid()):
            raise ValueError('Volume cache paths cannot contain symlinks or unowned directories.')
        if info.st_mode & 0o022 and not (info.st_uid == 0 and info.st_mode & stat.S_ISVTX):
            raise ValueError('Volume cache ancestors must not be writable by other users.')
    info = path.lstat()
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Volume cache directory must be private and owned.')
    return path


def private_file(fd):
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or info.st_nlink != 1 or info.st_mode & 0o077):
        raise ValueError('Volume initialization metadata must be private and owned.')
    return info


def receipt(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'rb') as stream:
        info = private_file(stream.fileno())
        if info.st_size > 16384:
            raise ValueError('Volume initialization receipt exceeds its size limit.')
        value = json.loads(stream.read(16385))
    if (not isinstance(value, dict) or set(value) != {'version', 'engine', 'volume'}
            or type(value['version']) is not int or value['version'] != 1
            or not isinstance(value['engine'], str) or not isinstance(value['volume'], dict)):
        raise ValueError('Invalid volume initialization receipt.')
    return value


def save_receipt(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.volume-receipt-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def docker_environment(environment):
    spec = importlib.util.spec_from_file_location('volume_owner', Path(__file__).with_name('worktree-supervisor.py'))
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    return {key: value for key, value in environment.items() if key in owner.DOCKER_ENVIRONMENT | {'PATH'}}


def command(arguments, environment):
    result = subprocess.run(['docker', *arguments], capture_output=True, text=True,
                            env=environment, timeout=120)
    return result


def inspect_volume(name, labels, environment):
    result = command(['volume', 'inspect', name], environment)
    if result.returncode:
        missing = re.fullmatch(r'(?:(?:Error response from daemon: |Error: )?No such volume: ' + re.escape(name)
                               + r'|Error response from daemon: get ' + re.escape(name) + r': no such volume)', result.stderr.strip())
        if result.returncode == 1 and missing:
            return None
        raise RuntimeError('Docker volume inspection is unavailable or uncertain.')
    records = json.loads(result.stdout)
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise ValueError('Invalid Docker volume inspection result.')
    value = records[0]
    if (value.get('Name') != name or value.get('Driver') != 'local' or value.get('Scope') != 'local'
            or value.get('Options') not in (None, {}) or value.get('Labels') != labels
            or not isinstance(value.get('CreatedAt'), str) or not value['CreatedAt']
            or not isinstance(value.get('Mountpoint'), str) or not value['Mountpoint'].startswith('/')):
        raise ValueError('Docker volume ownership or storage configuration differs.')
    # Recreated volumes must not reuse an earlier initialization receipt.
    return value


def wait_initializer_absent(name, labels, environment):
    deadline = time.monotonic() + 10
    while True:
        result = command(['container', 'inspect', name], environment)
        if result.returncode:
            missing = re.fullmatch(r'(?:Error response from daemon: |Error: )?No such (?:container|object): ' + re.escape(name), result.stderr.strip())
            if result.returncode == 1 and missing:
                return
            raise RuntimeError('Docker cache initializer absence is uncertain.')
        records = json.loads(result.stdout)
        if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
            raise ValueError('Invalid Docker cache initializer inspection.')
        container = records[0]
        actual = container.get('Config', {}).get('Labels', {})
        if (container.get('Name') != '/' + name or not re.fullmatch(r'[a-f0-9]{64}', container.get('Id', ''))
                or not isinstance(actual, dict) or any(actual.get(key) != value for key, value in labels.items())):
            raise ValueError('Docker cache initializer ownership differs.')
        if time.monotonic() >= deadline:
            raise RuntimeError('Docker cache initializer still exists; retry after its absence is confirmed.')
        time.sleep(0.1)


def prepare_volumes(paths, platform, image, environment):
    if set(paths) != KEYS:
        raise ValueError('Expected the six dedicated container cache directories.')
    if platform not in ('linux/amd64', 'linux/arm64') or not isinstance(image, str) or not IMAGE.fullmatch(image):
        raise ValueError('Expected a supported platform and pinned tool image.')
    uid, gid = os.getuid(), os.getgid()
    if uid == 0:
        raise ValueError('Container caches require a non-root host user.')
    directories = {key: private_directory(path) for key, path in paths.items()}
    if len(set(directories.values())) != len(KEYS):
        raise ValueError('Container cache directories must be distinct.')
    client = docker_environment(environment)
    engine = command(['info', '--format', '{{json .ID}}'], client)
    if engine.returncode:
        raise RuntimeError('Cannot identify the Docker engine.')
    engine_id = json.loads(engine.stdout)
    if not isinstance(engine_id, str) or not engine_id or len(engine_id) > 256:
        raise ValueError('Invalid Docker engine identity.')
    volumes = {}
    for key, path in directories.items():
        identity = hashlib.sha256(json.dumps([str(path), uid, platform, image], separators=(',', ':')).encode()).hexdigest()
        name = 'situate-cache-' + str(uid) + '-' + identity
        labels = {'dev.situate.cache-kind': 'pipeline-v1', 'dev.situate.cache-uid': str(uid),
                  'dev.situate.cache-gid': str(gid), 'dev.situate.cache-path': identity,
                  'dev.situate.cache-platform': platform, 'dev.situate.cache-image': image}
        fd = os.open(path / '.docker-volume.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            private_file(fd)
            fcntl.flock(fd, fcntl.LOCK_EX)
            receipt_path = path / '.docker-volume.json'
            previous = receipt(receipt_path)
            initializer = name + '-init'
            init_labels = {**labels, 'dev.situate.cache-init': 'pipeline-v1'}
            wait_initializer_absent(initializer, init_labels, client)
            volume = inspect_volume(name, labels, client)
            if volume is None:
                args = ['volume', 'create', '--driver', 'local']
                for label, value in sorted(labels.items()):
                    args += ['--label', label + '=' + value]
                created = command([*args, name], client)
                if created.returncode:
                    raise RuntimeError('Docker cache volume creation failed.')
                volume = inspect_volume(name, labels, client)
                if volume is None:
                    raise RuntimeError('Docker cache volume creation is unconfirmed.')
            current = {'version': 1, 'engine': engine_id, 'volume': volume}
            if previous != current:
                ownership = []
                for label, value in sorted(init_labels.items()):
                    ownership += ['--label', label + '=' + value]
                initialized = command(['run', '--rm', '--pull', 'never', '--platform', platform, '--name', initializer, *ownership,
                                       '--network', 'none', '--read-only', '--user', '0:0',
                                       '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
                                       '--security-opt', 'no-new-privileges',
                                       '--mount', 'type=volume,src=' + name + ',dst=/cache,volume-nocopy',
                                       '--entrypoint', '/bin/sh', image, '-c', INIT_SCRIPT,
                                       'cache-init', str(uid), str(gid)], client)
                wait_initializer_absent(initializer, init_labels, client)
                if initialized.returncode:
                    raise RuntimeError('Docker cache volume initialization failed.')
                if inspect_volume(name, labels, client) != volume:
                    raise RuntimeError('Docker cache volume changed during initialization.')
                save_receipt(receipt_path, current)
            volumes[key] = name
        finally:
            os.close(fd)
    return volumes
