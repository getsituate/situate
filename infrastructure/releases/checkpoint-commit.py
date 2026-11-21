"""Create and install private restore staging in the selected local directory."""
from contextlib import contextmanager
import errno
import os
from pathlib import Path
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from atomic_directory import rename_exclusive


DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
SEARCH_DIRECTORY = DIRECTORY | getattr(os, 'O_SEARCH', getattr(os, 'O_PATH', 0))


def identity(info):
    return f'{info.st_dev}:{info.st_ino}'


@contextmanager
def restore_parent(source, destination=None):
    if (not source.is_absolute() or not source.name or '..' in source.parts or
            (destination is not None and (not destination.name or source.parent != destination.parent
                                          or source == destination or '..' in destination.parts))):
        raise ValueError('Restore staging must be an absolute sibling of its destination')
    fd = os.open('/', SEARCH_DIRECTORY)
    try:
        for part in source.parent.parts[1:]:
            try:
                child = os.open(part, SEARCH_DIRECTORY, dir_fd=fd)
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise ValueError('Restore path traverses linked storage or a non-directory') from error
                raise
            os.close(fd)
            fd = child
        parent = os.open('.', DIRECTORY, dir_fd=fd)
        try:
            yield parent
        finally:
            os.close(parent)
    finally:
        os.close(fd)


@contextmanager
def private_staging(parent, name):
    fd = os.open(name, DIRECTORY, dir_fd=parent)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('Restore staging must be an owned private directory')
        yield info
    finally:
        os.close(fd)


def create(source, destination=None):
    source = Path(source)
    if destination is not None:
        destination = Path(destination)
    with restore_parent(source, destination) as parent:
        if destination is not None:
            try:
                os.stat(destination.name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise FileExistsError('Restore destination already exists')
        os.mkdir(source.name, mode=0o700, dir_fd=parent)
        os.fsync(parent)
        with private_staging(parent, source.name) as info:
            print(identity(os.fstat(parent)), identity(info))


def commit(source, destination, parent_identity, staging_identity):
    source, destination = Path(source), Path(destination)
    with restore_parent(source, destination) as parent:
        if identity(os.fstat(parent)) != parent_identity:
            raise ValueError('Restore parent directory changed')
        with private_staging(parent, source.name) as info:
            if identity(info) != staging_identity:
                raise ValueError('Restore staging directory changed')
            rename_exclusive(parent, source.name, destination.name)
            os.fsync(parent)


if __name__ == '__main__':
    action, *args = sys.argv[1:]
    if action == 'create':
        create(*args)
    elif action == 'commit':
        commit(*args)
    else:
        raise ValueError('Select restore staging creation or installation')
