"""Write local publication data below a directory opened by the caller."""
import hashlib
import json
import os
import re
import stat
import sys
import tarfile
from uuid import uuid4


JOURNAL = 'publication-journal.json'
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_NOFOLLOW | os.O_NONBLOCK


def open_regular(directory, name, flags=os.O_RDONLY):
    fd = os.open(name, flags | FILE_FLAGS, 0o600, dir_fd=directory)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Expected a single-link regular publication file')
        return os.fdopen(fd, 'rb' if flags == os.O_RDONLY else 'r+b')
    except BaseException:
        os.close(fd)
        raise


def read_journal(directory):
    try:
        stream = open_regular(directory, JOURNAL)
    except FileNotFoundError:
        return
    with stream:
        limit = 1024 * 1024
        data = stream.read(limit + 1)
        if not data or len(data) > limit:
            raise ValueError('Expected a nonempty publication journal of at most 1 MiB')
        sys.stdout.buffer.write(data)


def save_journal(directory, exclusive):
    target = JOURNAL
    name = target if exclusive else f'{target}.{uuid4()}.tmp'
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(sys.stdin.buffer.read())
            stream.flush()
            os.fsync(stream.fileno())
        if not exclusive:
            os.replace(name, target, src_dir_fd=directory, dst_dir_fd=directory)
    finally:
        if not exclusive:
            try:
                os.unlink(name, dir_fd=directory)
            except FileNotFoundError:
                pass
    os.fsync(directory)


def write_archive(directory, names, output):
    metadata = None
    try:
        top = sorted(os.listdir(directory))
        parents = [('', directory, [name for name in top if name != 'metadata'])]
        if 'metadata' in top:
            metadata = os.open('metadata', DIRECTORY_FLAGS, dir_fd=directory)
            parents.append(('metadata/', metadata, sorted(os.listdir(metadata))))
        members = {}
        for prefix, parent, entries in parents:
            for member in entries:
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*', member):
                    raise ValueError('Invalid staged publication file name')
                members[prefix + member] = parent, member
        if set(names) != members.keys():
            raise ValueError('Publication archive inventory does not match staged files')
        with tarfile.open(fileobj=output, mode='w|') as archive:
            for name, (parent, member) in members.items():
                with open_regular(parent, member) as source:
                    info = os.fstat(source.fileno())
                    entry = tarfile.TarInfo(name)
                    entry.size = info.st_size
                    entry.mode = stat.S_IMODE(info.st_mode) & 0o777
                    archive.addfile(entry, source)
    finally:
        if metadata is not None:
            os.close(metadata)


def archive_leaf(stage):
    if not isinstance(stage, str) or not stage or stage in ('.', '..') or '/' in stage:
        raise ValueError('Expected a stage directory name')
    return stage + '.tar'


def archive_digest(stream):
    stream.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


def prepare_archive(parent, request):
    stage = request['stage']
    name = archive_leaf(stage)
    try:
        stream = open_regular(parent, name)
    except FileNotFoundError:
        names = request['names']
        if (not isinstance(names, list) or not names or
                any(not isinstance(name, str) or not re.fullmatch(r'(?:metadata/)?[A-Za-z0-9][A-Za-z0-9._+-]*', name)
                    for name in names) or len(set(names)) != len(names)):
            return {'error': 'Invalid publication archive inventory.'}
        directory = os.open(stage, DIRECTORY_FLAGS, dir_fd=parent)
        try:
            with open_regular(parent, name, os.O_RDWR | os.O_CREAT | os.O_EXCL) as output:
                write_archive(directory, names, output)
                output.flush()
                os.fsync(output.fileno())
                os.fsync(parent)
                return {'digest': archive_digest(output)}
        finally:
            os.close(directory)
    with stream:
        if 'expectedDigest' not in request:
            return {'error': 'A transport archive already exists; inspect it before reconciliation.'}
        digest = archive_digest(stream)
        if request['expectedDigest'] != digest:
            return {'error': 'A differing transport archive exists; inspect it before reconciliation.'}
        return {'digest': digest}


def send_archive(parent, request, args):
    with open_regular(parent, archive_leaf(request['stage'])) as stream:
        if archive_digest(stream) != request['digest']:
            raise ValueError('Transport archive changed before transfer')
        os.lseek(stream.fileno(), 0, os.SEEK_SET)
        os.dup2(stream.fileno(), 0)
        os.close(parent)
        os.execv('/usr/bin/ssh', ['/usr/bin/ssh', *args])


if __name__ == '__main__':
    operation, *args = sys.argv[1:]
    if operation == 'prepare-archive':
        print(json.dumps(prepare_archive(3, json.load(sys.stdin))))
    elif operation == 'send-archive':
        send_archive(3, json.load(sys.stdin), args)
    elif operation == 'read-journal':
        read_journal(3)
    elif operation in ('create-journal', 'replace-journal'):
        save_journal(3, operation == 'create-journal')
    else:
        raise ValueError('Unknown publication storage operation')
