"""Install the rendered pack and optional proofs without following new aliases."""
from contextlib import ExitStack
import errno
import json
import os
from pathlib import Path
import shutil
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from atomic_directory import rename_exclusive


DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def identity(info):
    return f'{info.st_dev}:{info.st_ino}'


def leaf(name):
    if not isinstance(name, str) or not name or name in ('.', '..') or '/' in name or '\0' in name:
        raise ValueError('Expected a single file name')
    return name


def install(request, parent, staging, review):
    with ExitStack() as stack:
        created = []

        def open_directory(name, parent):
            fd = os.open(name, DIRECTORY, dir_fd=parent)
            stack.callback(os.close, fd)
            return fd

        staged = os.fstat(staging)
        if not stat.S_ISDIR(staged.st_mode) or staged.st_uid != os.getuid() or staged.st_mode & 0o077:
            raise ValueError('Expected a private staging directory')
        staging_name = leaf(request['staging'])

        def verify_staging():
            if identity(os.stat(staging_name, dir_fd=parent, follow_symlinks=False)) != identity(staged):
                raise ValueError('Export directory changed while rendering')

        verify_staging()
        try:
            if request['proofParts'] is not None:
                target = review
                for name in request['proofParts']:
                    name = leaf(name)
                    os.mkdir(name, dir_fd=target)
                    child = open_directory(name, target)
                    created.append((os.rmdir, target, name, identity(os.fstat(child))))
                    target = child
                source = open_directory('.proofs', staging)
                for name in sorted(os.listdir(source)):
                    src = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source)
                    with os.fdopen(src, 'rb') as reader:
                        if not stat.S_ISREG(os.fstat(src).st_mode):
                            raise ValueError('Expected a regular proof file')
                        dst = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o666, dir_fd=target)
                        with os.fdopen(dst, 'wb') as writer:
                            created.append((os.unlink, target, name, identity(os.fstat(dst))))
                            shutil.copyfileobj(reader, writer)
                    os.unlink(name, dir_fd=source)
                os.rmdir('.proofs', dir_fd=staging)
            verify_staging()
            rename_exclusive(parent, staging_name, leaf(request['output']))
        except Exception as error:
            cleanup_failed = False
            for remove, fd, name, expected in reversed(created):
                try:
                    if identity(os.stat(name, dir_fd=fd, follow_symlinks=False)) == expected:
                        remove(name, dir_fd=fd)
                except FileNotFoundError:
                    pass
                except OSError:
                    cleanup_failed = True
            if cleanup_failed:
                raise ValueError('Export failed and cleanup was incomplete') from error
            raise


if __name__ == '__main__':
    try:
        # Only the launching exporter selects destination directories.
        install(json.load(sys.stdin), 3, 4, 5)
    except OSError as error:
        print(json.dumps({'code': errno.errorcode.get(error.errno), 'message': error.strerror}))
    except ValueError as error:
        print(json.dumps({'message': str(error)}))
