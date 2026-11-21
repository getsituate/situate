"""Stage, render and install an export using opened destination directories."""
from contextlib import ExitStack
import errno
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from atomic_directory import rename_exclusive


DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
RENDERER = Path(__file__).resolve().with_name('render-export.mjs')


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

        staged = private_staging(staging)
        staging_name = leaf(request['staging'])

        def verify_staging():
            current = os.stat(staging_name, dir_fd=parent, follow_symlinks=False)
            if not os.path.samestat(current, staged):
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


def private_staging(staging):
    info = os.fstat(staging)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Expected a private staging directory')
    return info


def create_staging(parent):
    name = f'.situate-onboarding-{uuid.uuid4().hex}'
    os.mkdir(name, 0o700, dir_fd=parent)
    staging = os.open(name, DIRECTORY, dir_fd=parent)
    try:
        private_staging(staging)
        if os.listdir(staging):
            raise ValueError('Expected an empty staging directory')
        return name, staging
    except Exception:
        os.close(staging)
        raise


def discard_staging(parent, name, staging):
    # Python 3.9 has no dir_fd for rmtree; resolve children from the pinned cwd.
    os.fchdir(staging)
    for child in os.listdir(staging):
        if stat.S_ISDIR(os.stat(child, dir_fd=staging, follow_symlinks=False).st_mode):
            shutil.rmtree(child)
        else:
            os.unlink(child, dir_fd=staging)
    try:
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if os.path.samestat(current, os.fstat(staging)):
            # Only an empty directory can be removed by this name-based operation.
            os.rmdir(name, dir_fd=parent)
    except FileNotFoundError:
        pass


def verify_destination(path, directory):
    try:
        current = os.stat(path, follow_symlinks=False)
    except FileNotFoundError as error:
        raise ValueError('Export directory changed while rendering.') from error
    if not os.path.samestat(current, os.fstat(directory)):
        raise ValueError('Export directory changed while rendering.')


def export(request, node, parent, review, stdout):
    if not os.path.isabs(node):
        raise ValueError('Expected an absolute Node.js executable path')
    proofs = request['proofParts'] is not None
    name, staging = create_staging(parent)
    try:
        try:
            os.fchdir(staging)
            subprocess.run(
                [node, RENDERER, request['date'], 'proofs' if proofs else 'no-proofs'],
                check=True, stdout=stdout,
            )
            verify_destination(request['parent'], parent)
            if proofs:
                verify_destination(request['proofAnchor'], review)
            install({**request, 'staging': name}, parent, staging, review)
        except BaseException:
            discard_staging(parent, name, staging)
            raise
    finally:
        os.close(staging)


def report(operation):
    try:
        operation()
    except OSError as error:
        print(json.dumps({'code': errno.errorcode.get(error.errno), 'message': error.strerror}))
    except ValueError as error:
        print(json.dumps({'message': str(error)}))
    except subprocess.CalledProcessError:
        print(json.dumps({'message': 'Export rendering failed. See the renderer output.'}))


if __name__ == '__main__':
    report(lambda: export(json.loads(sys.argv[2]), sys.argv[1], 3, 4, 5))
