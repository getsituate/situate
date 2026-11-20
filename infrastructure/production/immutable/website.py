#!/usr/bin/env python3
"""Select an immutable static website tree without touching the serving stack."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ROOT = Path('/srv/situate-state/website')
VERSION = re.compile(r'[a-f0-9]{64}')
NAME = re.compile(r'[A-Za-z0-9_][A-Za-z0-9._-]*')


def directory(path):
    if not stat.S_ISDIR(path.lstat().st_mode):
        raise ValueError(f'Expected a real directory: {path}')


def exists(path):
    return os.path.lexists(path)


def fingerprint(source, destination=None):
    directory(source)
    catalog = []

    def scan(parent):
        for item in sorted((source / parent).iterdir()):
            name = item.relative_to(source)
            if not NAME.fullmatch(item.name) or name.parts[0] in {'releases', 'healthz', 'robots.txt'}:
                raise ValueError(f'Reserved or unsafe website path: {name}')
            info = item.lstat()
            output = destination / name if destination else None
            if stat.S_ISDIR(info.st_mode):
                catalog.append(['directory', name.as_posix()])
                if output:
                    output.mkdir(mode=0o700)
                scan(name)
                if output:
                    output.chmod(0o755)
                    sync_dir(output)
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError(f'Expected a single-link regular file: {name}')
            with os.fdopen(os.open(item, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
                current = os.fstat(stream.fileno())
                if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
                    raise ValueError(f'Website input changed: {name}')
                digest = hashlib.sha256()
                writer = output.open('xb') if output else None
                try:
                    while data := stream.read(1024 * 1024):
                        digest.update(data)
                        if writer:
                            writer.write(data)
                    if writer:
                        writer.flush()
                        os.fchmod(writer.fileno(), 0o644)
                        os.fsync(writer.fileno())
                finally:
                    if writer:
                        writer.close()
                catalog.append(['file', name.as_posix(), digest.hexdigest()])

    scan(Path())
    if not any(entry[:2] == ['file', 'index.html'] and entry[2] != hashlib.sha256(b'').hexdigest()
               for entry in catalog):
        raise ValueError('Website requires a nonempty index.html.')
    return hashlib.sha256(json.dumps(catalog, separators=(',', ':')).encode()).hexdigest()


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def settled(root):
    directory(root)
    directory(root / 'versions')
    if any(exists(root / name) for name in ('website.pending', 'current.next')):
        raise ValueError('Website activation is unresolved. Inspect the pending record and pointer before continuing.')
    if any(path.name.startswith('.incoming-') for path in (root / 'versions').iterdir()):
        raise ValueError('Website upload is unresolved. Inspect the retained staging tree.')
    pointer = root / 'current'
    if not exists(pointer):
        return None
    target = re.fullmatch(r'versions/([a-f0-9]{64})', os.readlink(pointer))
    if not target or fingerprint(root / 'versions' / target[1]) != target[1]:
        raise ValueError('Active website bytes do not match the content address.')
    return target[1]


def activate(root, version, source=None, *, seed=False, confirm=lambda: True):
    if not VERSION.fullmatch(version):
        raise ValueError('Expected the reviewed website SHA-256.')
    previous = settled(root)
    if seed != (previous is None):
        raise ValueError('Only seed an unpublished website; activation requires an existing pointer.')
    destination = root / 'versions' / version
    if exists(destination):
        if fingerprint(destination) != version:
            raise ValueError('Existing website bytes do not match the content address.')
    elif source is None:
        raise ValueError('The selected website version is not stored.')
    if source is not None and fingerprint(source) != version:
        raise ValueError('Delivered website differs from the reviewed content address.')
    if previous == version:
        raise ValueError('Website version is already active.')
    pending = root / 'website.pending'
    with os.fdopen(os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump({'previous': previous, 'next': version}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    sync_dir(root)
    if not exists(destination):
        staged = Path(tempfile.mkdtemp(prefix='.incoming-', dir=root / 'versions'))
        if fingerprint(source, staged) != version:
            raise ValueError('Website input changed during copy. Inspect pending evidence.')
        staged.chmod(0o755)
        sync_dir(staged)
        staged.rename(destination)
        sync_dir(destination.parent)
    temporary = root / 'current.next'
    temporary.symlink_to(f'versions/{version}')
    temporary.replace(root / 'current')
    sync_dir(root)
    accepted = confirm()
    if not accepted:
        if previous is None:
            raise ValueError('Cannot roll back the initial seed.')
        temporary.symlink_to(f'versions/{previous}')
        temporary.replace(root / 'current')
        sync_dir(root)
    pending.unlink()
    sync_dir(root)
    return accepted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('digest').add_argument('source', type=Path)
    for command in ('seed', 'activate'):
        selection = commands.add_parser(command)
        selection.add_argument('version')
        selection.add_argument('source', nargs='?' if command == 'activate' else None, type=Path)
        selection.add_argument('--confirm-website', required=True)
    args = parser.parse_args()
    if args.command == 'digest':
        print(fingerprint(args.source))
        return
    if os.geteuid() != 0 or args.confirm_website != args.version:
        raise ValueError('Run as root and confirm the exact reviewed website digest.')
    os.umask(0o077)
    with open('/run/situate-state/lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        subprocess.run(['/usr/local/lib/situate/state.sh', 'mounted'], check=True)
        if args.command == 'activate':
            subprocess.run(['/usr/local/lib/situate/state.sh', 'writable'], check=True)
        serving = subprocess.run(['systemctl', 'is-active', '--quiet', 'situate-serving.service']).returncode
        if (args.command == 'seed' and serving != 3) or (args.command == 'activate' and serving != 0):
            raise ValueError('Seed before starting service; activate only on the running host.')
        activate(ROOT, args.version, args.source, seed=args.command == 'seed')
        print(args.version)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
