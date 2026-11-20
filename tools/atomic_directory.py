"""Install a directory without replacing any existing destination entry."""
import ctypes
import os
import sys


def rename_exclusive(parent, source, destination):
    library = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        rename, exclusive = library.renameatx_np, 4  # RENAME_EXCL
    elif sys.platform.startswith('linux'):
        rename, exclusive = library.renameat2, 1  # RENAME_NOREPLACE
    else:
        raise ValueError('Atomic non-replacing installation is unsupported on this host')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(parent, os.fsencode(source), parent, os.fsencode(destination), exclusive) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))
