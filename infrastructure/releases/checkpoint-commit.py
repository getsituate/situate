"""Commit a verified local restore without replacing any destination entry."""
import ctypes
import os
from pathlib import Path
import stat
import sys


def commit(source, destination):
    source, destination = Path(source), Path(destination)
    if not source.is_absolute() or not destination.is_absolute() or source.parent != destination.parent or source == destination:
        raise ValueError('Restore staging must be an absolute sibling of its destination')
    metadata = source.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise ValueError('Restore staging must be an owned private directory')
    library = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        rename = library.renamex_np
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        result = rename(os.fsencode(source), os.fsencode(destination), 4)
    elif sys.platform.startswith('linux'):
        rename = library.renameat2
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        result = rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1)
    else:
        raise ValueError('Atomic non-replacing restore is unsupported on this host')
    if result != 0:
        code = ctypes.get_errno()
        raise OSError(code, 'Atomic restore commitment failed')
    descriptor = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise ValueError('Select exact restore staging and destination paths')
    commit(sys.argv[1], sys.argv[2])
