"""Commit a verified local restore without replacing any destination entry."""
import ctypes
import os
from pathlib import Path
import stat
import sys


def commit(source, destination):
    source, destination = Path(source), Path(destination)
    if (not source.is_absolute() or not destination.is_absolute() or source.parent != destination.parent
            or source == destination or not source.name or not destination.name
            or '..' in source.parts or '..' in destination.parts):
        raise ValueError('Restore staging must be an absolute sibling of its destination')
    descriptor = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        metadata = os.stat(source.name, dir_fd=descriptor, follow_symlinks=False)
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise ValueError('Restore staging must be an owned private directory')
        library = ctypes.CDLL(None, use_errno=True)
        if sys.platform == 'darwin':
            rename, exclusive = library.renameatx_np, 4  # RENAME_EXCL
        elif sys.platform.startswith('linux'):
            rename, exclusive = library.renameat2, 1  # RENAME_NOREPLACE
        else:
            raise ValueError('Atomic non-replacing restore is unsupported on this host')
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(descriptor, os.fsencode(source.name), descriptor, os.fsencode(destination.name), exclusive) != 0:
            raise OSError(ctypes.get_errno(), 'Atomic restore commitment failed')
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise ValueError('Select exact restore staging and destination paths')
    commit(sys.argv[1], sys.argv[2])
