"""Write local publication data below a directory opened by the caller."""
import json
import os
import re
import stat
import sys
import tarfile
from uuid import uuid4


def save_journal(directory, exclusive):
    target = 'publication-journal.json'
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


def write_archive(directory, names):
    if (not isinstance(names, list) or not names
            or any(not isinstance(name, str) or not re.fullmatch(r'(?:metadata/)?[A-Za-z0-9][A-Za-z0-9._+-]*', name)
                   for name in names)
            or len(set(names)) != len(names)):
        raise ValueError('Invalid publication archive inventory')
    metadata = None
    try:
        if any(name.startswith('metadata/') for name in names):
            metadata = os.open('metadata', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
        with tarfile.open(fileobj=sys.stdout.buffer, mode='w|') as archive:
            for name in names:
                member = name.rsplit('/', 1)[-1]
                parent = metadata if name.startswith('metadata/') else directory
                fd = os.open(member, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                with os.fdopen(fd, 'rb') as source:
                    info = os.fstat(source.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                        raise ValueError('Expected single-link regular publication archive members')
                    entry = tarfile.TarInfo(name)
                    entry.size = info.st_size
                    entry.mode = stat.S_IMODE(info.st_mode) & 0o777
                    archive.addfile(entry, source)
    finally:
        if metadata is not None:
            os.close(metadata)


if __name__ == '__main__':
    operation, = sys.argv[1:]
    if operation == 'archive':
        write_archive(3, json.load(sys.stdin))
    elif operation in ('create-journal', 'replace-journal'):
        save_journal(3, operation == 'create-journal')
    else:
        raise ValueError('Unknown publication storage operation')
