"""Commit a verified local restore without replacing any destination entry."""
import os
from pathlib import Path
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from atomic_directory import rename_exclusive


def commit(source, destination, parent_identity, staging_identity):
    source, destination = Path(source), Path(destination)
    if (not source.is_absolute() or not destination.is_absolute() or source.parent != destination.parent
            or source == destination or not source.name or not destination.name
            or '..' in source.parts or '..' in destination.parts):
        raise ValueError('Restore staging must be an absolute sibling of its destination')
    descriptor = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parent = os.fstat(descriptor)
        if f'{parent.st_dev}:{parent.st_ino}' != parent_identity:
            raise ValueError('Restore parent directory changed')
        metadata = os.stat(source.name, dir_fd=descriptor, follow_symlinks=False)
        if f'{metadata.st_dev}:{metadata.st_ino}' != staging_identity:
            raise ValueError('Restore staging directory changed')
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise ValueError('Restore staging must be an owned private directory')
        rename_exclusive(descriptor, source.name, destination.name)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise ValueError('Select exact restore staging and destination paths and identities')
    commit(*sys.argv[1:])
