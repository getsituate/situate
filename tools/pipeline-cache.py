"""Private, ownership-marked download and worktree build caches."""

import fcntl
import hashlib
import os
from pathlib import Path
import stat
import sys

MARKER = '{"kind":"situate-container-cache","version":1}\n'


def directory(path):
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Container cache directories must be private, owned and not symlinks.')
    return path


def cache_root(environment, checkout):
    if environment.get('SITUATE_CONTAINER_CACHE') == '0':
        return None
    # CI jobs must not write a developer's retained cache, even with an override.
    if any(environment.get(key) not in (None, '', '0', 'false') for key in ('CI', 'GITHUB_ACTIONS', 'BUILD_ID', 'TF_BUILD')):
        return None
    override = environment.get('SITUATE_CONTAINER_CACHE_DIR')
    if override is not None:
        root = Path(override)
        if not root.is_absolute():
            raise ValueError('Container cache override must be absolute.')
    else:
        if not environment.get('HOME'):
            return None
        home = Path(environment['HOME']).resolve(strict=True)
        if sys.platform == 'darwin':
            base = home / 'Library/Caches'
        else:
            base = Path(environment.get('XDG_CACHE_HOME', str(home / '.cache')))
        if not base.is_absolute():
            raise ValueError('Cache base must be absolute.')
        root = base / 'situate/container-v1'
    if '..' in root.parts:
        raise ValueError('Container cache paths cannot contain parent traversal.')
    checkout = Path(checkout).resolve(strict=True)
    if environment.get('HOME'):
        home = Path(environment['HOME']).resolve(strict=True)
        cargo = Path(environment.get('CARGO_HOME', str(home / '.cargo'))).resolve()
        if root == home or root.is_relative_to(cargo):
            raise ValueError('Container caches cannot reuse a host home or Cargo home.')
    if root == Path('/') or root.is_relative_to(checkout) or checkout.is_relative_to(root):
        raise ValueError('Container caches must be dedicated and outside the checkout.')
    # Inspect every component before creating anything; never adopt a symlinked path.
    for ancestor in reversed([root, *root.parents][:-1]):
        if ancestor.is_symlink():
            raise ValueError('Container cache paths cannot contain symlinks.')
        if ancestor.exists():
            info = ancestor.lstat()
            if (info.st_uid not in (0, os.getuid()) or
                    (info.st_mode & 0o022 and not (info.st_uid == 0 and info.st_mode & stat.S_ISVTX))):
                raise ValueError('Container cache ancestors must not be replaceable by other users.')
    missing = []
    parent = root
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for item in reversed(missing):
        directory(item)
    directory(root)
    lock = root / '.marker-lock'
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ValueError('Invalid container cache initialization lock.')
        fcntl.flock(fd, fcntl.LOCK_EX)
        marker = root / '.situate-container-cache'
        if not marker.exists() and not marker.is_symlink():
            if set(root.iterdir()) != {lock}:
                raise ValueError('Refusing to adopt an unmarked nonempty cache directory.')
            temporary = root / '.marker.publishing'
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(MARKER)
                stream.flush()
                os.fsync(stream.fileno())
            os.rename(temporary, marker)
        descriptor = os.open(marker, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor) as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077
                    or info.st_nlink != 1 or info.st_size != len(MARKER) or stream.read() != MARKER):
                raise ValueError('Invalid container cache ownership marker.')
        return root
    finally:
        os.close(fd)


def layout(root, platform, image, checkout):
    namespace = directory(root / platform.replace('/', '-'))
    namespace = directory(namespace / hashlib.sha256(image.encode()).hexdigest())
    shared = directory(namespace / 'downloads')
    worktrees = directory(namespace / 'worktrees')
    worktree = directory(worktrees / hashlib.sha256(str(Path(checkout).resolve()).encode()).hexdigest())
    return {
        'npm': directory(shared / 'npm'),
        'browsers': directory(shared / 'browsers'),
        # Cargo's package-cache locks live above registry/git. Keeping these downloads
        # worktree-local avoids sharing unlocked stores or exposing a Cargo home.
        'cargo-registry': directory(worktree / 'cargo-registry'),
        'cargo-git': directory(worktree / 'cargo-git'),
        'client-target': directory(worktree / 'client-target'),
        'tools-dev-tui-target': directory(worktree / 'tools-dev-tui-target'),
    }
